// ---------------------------------------------------------------------------
// PostFX — HDR pipeline: sky pass -> scene -> bloom -> god rays -> composite
// (ACES tonemap, colour grading, chromatic aberration, vignette, grain,
//  speed blur, depth-of-field hint) with optional FXAA.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp01 } from '../core/Utils.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

class FSPass {
  constructor(fragmentShader, uniforms = {}, opts = {}) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: opts.blending || THREE.NoBlending,
      defines: opts.defines || {}
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  set(name, value) { if (this.material.uniforms[name]) this.material.uniforms[name].value = value; }
  render(renderer, target, clear = true) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }
  dispose() { this.material.dispose(); this.mesh.geometry.dispose(); }
}

// ---------------------------------------------------------------------------
const COMMON_TONEMAP = /* glsl */`
vec3 acesFilm(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 gradeColor(vec3 c, vec3 lift, vec3 gain, float sat, float contrast) {
  c = c * gain + lift;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  c = clamp((c - 0.5) * contrast + 0.5, 0.0, 4.0);
  return c;
}
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.size = new THREE.Vector2(1, 1);
    this.rtScene = null;
    this.rtSky = null;
    this.rtLdr = null;
    this.bloomLevels = [];
    this.rtGod = null;
    this.rtLens = null;
    this.quality = 2;
    // Can this context actually render into a half-float target?  WebGL2 only
    // guarantees RGBA8 unless EXT_color_buffer_float (or the half-float variant)
    // is present.  Without it the HDR chain renders black, so fall back to 8-bit
    // and keep the exposure/tonemap maths (the range is just clipped earlier).
    const gl = renderer.getContext ? renderer.getContext() : null;
    const ext = gl && gl.getExtension
      ? (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
      : null;
    this.hdr = !!(gl && gl.RGBA16F) && (!!ext || !!(gl.getExtension && gl.getExtension('EXT_float_blend')));
    if (!this.hdr) this.hdrType = THREE.UnsignedByteType; else this.hdrType = THREE.HalfFloatType;
    this._initPasses();
  }

  _mkRT(w, h, opts = {}) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: opts.half === false ? THREE.UnsignedByteType : this.hdrType,
      depthBuffer: opts.depth !== false,
      stencilBuffer: false,
      generateMipmaps: false,
      samples: opts.samples || 0,
      colorSpace: THREE.NoColorSpace
    });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    return rt;
  }

  _initPasses() {
    this.skyBlit = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tSky;
      void main() { gl_FragColor = vec4(texture2D(tSky, vUv).rgb, 1.0); }
    `, { tSky: { value: null } });

    this.bright = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform float uThreshold;
      uniform float uSoft;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = max(max(c.r, c.g), c.b);
        float k = max(0.0, l - uThreshold) / max(1e-4, l);
        gl_FragColor = vec4(c * k * uSoft, 1.0);
      }
    `, { tDiffuse: { value: null }, uThreshold: { value: 1.0 }, uSoft: { value: 1.0 } });

    this.blur = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uDir;       // texel * direction
      void main() {
        vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
        sum += (texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
        sum += (texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
        gl_FragColor = vec4(sum, 1.0);
      }
    `, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });

    this.godrays = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uSunPos;
      uniform float uDensity;
      uniform float uDecay;
      uniform float uWeight;
      uniform float uExposure;
      void main() {
        vec2 dir = (uSunPos - vUv) * uDensity / 24.0;
        vec2 uv = vUv;
        float decay = 1.0;
        vec3 sum = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          uv += dir;
          vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
          sum += c * decay * uWeight;
          decay *= uDecay;
        }
        gl_FragColor = vec4(sum * uExposure, 1.0);
      }
    `, {
      tDiffuse: { value: null }, uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
      uDensity: { value: 0.9 }, uDecay: { value: 0.96 }, uWeight: { value: 0.9 }, uExposure: { value: 0.42 }
    });

    this.lens = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uSunPos;
      uniform float uAspect;
      uniform float uVisible;
      uniform float uIntensity;
      float ring(vec2 uv, vec2 c, float r, float w) {
        float d = length((uv - c) * vec2(uAspect, 1.0));
        return smoothstep(w, 0.0, abs(d - r));
      }
      void main() {
        vec2 dir = vUv - uSunPos;
        vec3 sum = vec3(0.0);
        vec3 tint[5];
        tint[0] = vec3(0.9, 0.6, 0.3);
        tint[1] = vec3(0.3, 0.7, 0.9);
        tint[2] = vec3(0.9, 0.35, 0.35);
        tint[3] = vec3(0.4, 0.9, 0.5);
        tint[4] = vec3(0.85, 0.85, 1.0);
        for (int i = 0; i < 5; i++) {
          float k = 0.35 + float(i) * 0.32;
          vec2 c = uSunPos + dir * k;
          float r = 0.06 + float(i) * 0.035;
          float a = ring(vUv, c, r, 0.05) * (0.35 - float(i) * 0.05);
          sum += tint[i] * a;
          sum += tint[i] * smoothstep(r * 0.7, 0.0, length((vUv - c) * vec2(uAspect, 1.0))) * 0.06;
        }
        // anamorphic streak
        float streak = smoothstep(0.012, 0.0, abs((vUv.y - uSunPos.y))) * smoothstep(1.0, 0.0, abs(vUv.x - uSunPos.x)) ;
        sum += vec3(0.55, 0.65, 1.0) * streak * 0.22;
        gl_FragColor = vec4(sum * uVisible * uIntensity, 1.0);
      }
    `, {
      tDiffuse: { value: null }, uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1.0 }, uVisible: { value: 0.0 }, uIntensity: { value: 1.0 }
    });

    this.composite = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tScene;
      uniform sampler2D tBloom;
      uniform sampler2D tGod;
      uniform sampler2D tLens;
      uniform sampler2D tDepth;
      uniform float uExposure;
      uniform float uTime;
      uniform vec3 uLift;
      uniform vec3 uGain;
      uniform float uSat;
      uniform float uContrast;
      uniform float uCA;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uSpeedBlur;
      uniform vec2 uSpeedDir;
      uniform float uRainBlur;
      uniform float uDof;
      uniform float uFlash;
      uniform vec3 uFlashColor;
      uniform float uNight;
      uniform float uShadowLift;
      uniform vec2 uResolution;
      ${COMMON_TONEMAP}

      float linearDepth(float d, float near, float far) {
        float z = d * 2.0 - 1.0;
        return 2.0 * near * far / (far + near - z * (far - near));
      }

      void main() {
        vec2 uv = vUv;
        // ---- chromatic aberration (scaled by G-load / speed)
        float r2 = length(uv - 0.5);
        float ca = uCA * (0.004 + r2 * 0.02);
        vec3 col;
        col.r = texture2D(tScene, uv + (uv - 0.5) * ca).r;
        col.g = texture2D(tScene, uv).g;
        col.b = texture2D(tScene, uv - (uv - 0.5) * ca).b;

        // ---- radial motion / speed blur + speed lines
        if (uSpeedBlur > 0.001) {
          vec3 acc = col;
          float w = 0.0;
          for (int i = 1; i <= 6; i++) {
            float t = float(i) / 6.0;
            vec2 o = (uv - 0.5) * uSpeedBlur * t * 0.06 + uSpeedDir * t * uSpeedBlur * 0.004;
            float ww = 1.0 - t;
            acc += texture2D(tScene, uv - o).rgb * ww;
            w += ww;
          }
          col = acc / (1.0 + w);
        }

        // ---- depth of field (far blur) — soft background separation
        if (uDof > 0.001) {
          float d = texture2D(tDepth, uv).x;
          float lin = linearDepth(d, 0.6, 26000.0);
          float blur = smoothstep(6000.0, 22000.0, lin) * uDof;
          if (blur > 0.01) {
            vec3 b = vec3(0.0);
            float k = 1.5 + blur * 5.0;
            b += texture2D(tScene, uv + vec2(k, k) / uResolution).rgb;
            b += texture2D(tScene, uv + vec2(-k, k) / uResolution).rgb;
            b += texture2D(tScene, uv + vec2(k, -k) / uResolution).rgb;
            b += texture2D(tScene, uv + vec2(-k, -k) / uResolution).rgb;
            col = mix(col, (b + col * 2.0) / 6.0, clamp(blur * 0.85, 0.0, 0.8));
          }
        }

        vec3 bloom = texture2D(tBloom, uv).rgb;
        vec3 god = texture2D(tGod, uv).rgb;
        col += bloom * 1.05 + god;
        col += texture2D(tLens, uv).rgb;
        col += uFlashColor * uFlash;

        col *= uExposure;
        col = acesFilm(col);
        col = gradeColor(col, uLift, uGain, uSat, uContrast);

        // ---- vignette + film grain
        float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.0, 0.95)) * 1.35);
        col *= mix(1.0, vig, uVignette * 0.85);
        float g = fract(sin(dot(uv * uResolution + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * uGrain * 0.045;

        gl_FragColor = vec4(col, 1.0);
      }
    `, {
      tScene: { value: null }, tBloom: { value: null }, tGod: { value: null },
      tLens: { value: null }, tDepth: { value: null },
      uExposure: { value: 1.0 }, uTime: { value: 0 },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1.05 }, uContrast: { value: 1.03 },
      uCA: { value: 0.25 }, uVignette: { value: 0.5 }, uGrain: { value: 0.35 },
      uSpeedBlur: { value: 0 }, uSpeedDir: { value: new THREE.Vector2() },
      uRainBlur: { value: 0 }, uDof: { value: 0.35 },
      uFlash: { value: 0 }, uFlashColor: { value: new THREE.Vector3(1, 1, 1) },
      uNight: { value: 0 }, uShadowLift: { value: 0 },
      uResolution: { value: new THREE.Vector2(1920, 1080) }
    });

    this.blitToScreen = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }
    `, { tDiffuse: { value: null } });

    this.fxaa = new FSPass(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      #define FXAA_REDUCE_MIN (1.0/128.0)
      #define FXAA_REDUCE_MUL (1.0/8.0)
      #define FXAA_SPAN_MAX 8.0
      void main() {
        vec2 rcp = 1.0 / uResolution;
        vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * rcp).rgb;
        vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * rcp).rgb;
        vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * rcp).rgb;
        vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * rcp).rgb;
        vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
        vec3 luma = vec3(0.299, 0.587, 0.114);
        float lumaNW = dot(rgbNW, luma), lumaNE = dot(rgbNE, luma);
        float lumaSW = dot(rgbSW, luma), lumaSE = dot(rgbSE, luma);
        float lumaM = dot(rgbM, luma);
        float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
        float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
        vec2 dir;
        dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
        dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));
        float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * FXAA_REDUCE_MUL, FXAA_REDUCE_MIN);
        float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
        dir = clamp(dir * rcpDirMin, vec2(-FXAA_SPAN_MAX), vec2(FXAA_SPAN_MAX)) * rcp;
        vec3 rgbA = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
                           texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tDiffuse, vUv + dir * -0.5).rgb +
                                         texture2D(tDiffuse, vUv + dir * 0.5).rgb);
        float lumaB = dot(rgbB, luma);
        gl_FragColor = vec4((lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB, 1.0);
      }
    `, { tDiffuse: { value: null }, uResolution: { value: new THREE.Vector2(1920, 1080) } });
  }

  setSize(width, height, renderScale = 1, skyScale = 0.5, samples = 0, bloomLevels = 4) {
    const w = Math.max(2, Math.floor(width * renderScale));
    const h = Math.max(2, Math.floor(height * renderScale));
    this.size.set(w, h);
    this.canvasSize = new THREE.Vector2(width, height);

    this.rtScene?.dispose();
    const depthTex = new THREE.DepthTexture(w, h);
    depthTex.type = THREE.UnsignedIntType;
    depthTex.minFilter = THREE.NearestFilter;
    depthTex.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: this.hdrType,
      depthBuffer: true,
      depthTexture: depthTex,
      stencilBuffer: false,
      samples: samples,
      colorSpace: THREE.NoColorSpace
    });

    const sw = Math.max(2, Math.floor(w * skyScale));
    const sh = Math.max(2, Math.floor(h * skyScale));
    this.rtSky?.dispose();
    this.rtSky = new THREE.WebGLRenderTarget(sw, sh, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: this.hdrType,
      depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace
    });

    for (const rt of this.bloomLevels) rt.dispose();
    this.bloomLevels = [];
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < bloomLevels; i++) {
      this.bloomLevels.push(this._mkRT(bw, bh));
      bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1);
    }
    this.rtBloomTmp = this.rtBloomTmp || this._mkRT(4, 4);
    this.rtBloomTmp.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));

    this.rtGod?.dispose();
    this.rtGod = this._mkRT(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.rtLens?.dispose();
    this.rtLens = this._mkRT(Math.max(2, w >> 2), Math.max(2, h >> 2));

    this.skyBlit.set('tSky', this.rtSky.texture);
    this.composite.set('tScene', this.rtScene.texture);
    this.composite.set('tDepthTexture', this.rtScene.depthTexture);
    this.composite.material.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.composite.set('uResolution', new THREE.Vector2(w, h));
    this.lens.set('uAspect', w / h);
    this.fxaa.set('uResolution', new THREE.Vector2(width, height));
  }

  setQuality(level, opts = {}) {
    this.quality = level;
    this.params = opts;
  }

  /** Render sky (optional, by caller) then the scene; returns nothing. */
  beginScene(renderer) {
    renderer.setRenderTarget(this.rtScene);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    // background: blit the sky render target
    this.skyBlit.render(renderer, this.rtScene, false);
  }

  endScene(renderer, scene, camera) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rtScene);
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
  }

  /** Bloom + god rays + composite to screen. */
  present(renderer, camera, params = {}) {
    const quality = this.quality;
    const bloomOn = params.bloom !== false && this.bloomLevels.length > 0;
    // ---- bright pass
    if (bloomOn) {
      this.bright.set('tDiffuse', this.rtScene.texture);
      this.bright.set('uThreshold', params.bloomThreshold !== undefined ? params.bloomThreshold : 1.05);
      this.bright.render(renderer, this.bloomLevels[0]);
      // downsample + blur chain
      for (let i = 1; i < this.bloomLevels.length; i++) {
        const src = this.bloomLevels[i - 1];
        const dst = this.bloomLevels[i];
        this.blur.set('tDiffuse', src.texture);
        this.blur.set('uDir', new THREE.Vector2(1 / src.width, 0));
        this.blur.render(renderer, this.rtBloomTmp);
        this.blur.set('tDiffuse', this.rtBloomTmp.texture);
        this.blur.set('uDir', new THREE.Vector2(0, 1 / src.height));
        this.blur.render(renderer, dst);
      }
      // upsample-add pass
      for (let i = this.bloomLevels.length - 1; i > 0; i--) {
        const src = this.bloomLevels[i];
        const dst = this.bloomLevels[i - 1];
        this.blur.set('tDiffuse', src.texture);
        this.blur.set('uDir', new THREE.Vector2(1 / src.width, 0));
        this.blur.render(renderer, this.rtBloomTmp);
        this.blur.set('tDiffuse', this.rtBloomTmp.texture);
        this.blur.set('uDir', new THREE.Vector2(0, 1 / src.height));
        // additive into dst
        const prevBlend = this.blur.material.blending;
        this.blur.material.blending = THREE.AdditiveBlending;
        this.blur.material.needsUpdate = true;
        this.blur.render(renderer, dst, false);
        this.blur.material.blending = prevBlend;
        this.blur.material.needsUpdate = true;
      }
    } else {
      renderer.setRenderTarget(this.bloomLevels[0]);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, false, false);
    }

    // ---- god rays (radial blur of bright pass)
    const sunScreen = params.sunScreen || { x: 0.5, y: 0.5, visible: false, intensity: 0 };
    if (params.godRays !== false && sunScreen.visible) {
      this.godrays.set('tDiffuse', this.bloomLevels[Math.min(1, this.bloomLevels.length - 1)].texture);
      this.godrays.set('uSunPos', new THREE.Vector2(sunScreen.x, sunScreen.y));
      this.godrays.set('uDensity', params.godDensity || 0.85);
      this.godrays.set('uExposure', (params.godExposure || 0.42) * clamp01(sunScreen.intensity));
      this.godrays.render(renderer, this.rtGod);
      // lens flare
      this.lens.set('uSunPos', new THREE.Vector2(sunScreen.x, sunScreen.y));
      this.lens.set('uVisible', clamp01(sunScreen.intensity));
      this.lens.set('uIntensity', params.lensIntensity !== undefined ? params.lensIntensity : 1.0);
      this.lens.render(renderer, this.rtLens);
    } else {
      renderer.setRenderTarget(this.rtGod);
      renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      renderer.setRenderTarget(this.rtLens);
      renderer.clear(true, false, false);
    }

    // ---- composite
    const dst = params.fxaa ? this.rtLdr : null;
    if (params.fxaa && !this.rtLdr) this.rtLdr = this._mkRT(this.canvasSize.x, this.canvasSize.y, { half: false, depth: false });
    if (params.fxaa && this.rtLdr && (this.rtLdr.width !== this.canvasSize.x || this.rtLdr.height !== this.canvasSize.y)) {
      this.rtLdr.dispose();
      this.rtLdr = this._mkRT(this.canvasSize.x, this.canvasSize.y, { half: false, depth: false });
    }
    const u = this.composite.material.uniforms;
    u.tBloom.value = bloomOn ? this.bloomLevels[0].texture : null;
    u.tGod.value = this.rtGod.texture;
    u.tLens.value = this.rtLens.texture;
    u.uExposure.value = params.exposure !== undefined ? params.exposure : 1.0;
    u.uTime.value = params.time || 0;
    if (params.lift) u.uLift.value.copy(params.lift);
    if (params.gain) u.uGain.value.copy(params.gain);
    u.uSat.value = params.saturation !== undefined ? params.saturation : 1.05;
    u.uContrast.value = params.contrast !== undefined ? params.contrast : 1.03;
    u.uCA.value = params.chromatic !== undefined ? params.chromatic : 0.25;
    u.uVignette.value = params.vignette !== undefined ? params.vignette : 0.5;
    u.uGrain.value = params.grain !== undefined ? params.grain : 0.3;
    u.uSpeedBlur.value = params.speedBlur || 0;
    if (params.speedDir) u.uSpeedDir.value.copy(params.speedDir);
    u.uFlash.value = params.flash || 0;
    if (params.flashColor) u.uFlashColor.value.copy(params.flashColor);
    u.uDof.value = params.dof !== undefined ? params.dof : 0.3;
    this.composite.render(renderer, dst || null);

    if (params.fxaa && dst) {
      this.fxaa.set('tDiffuse', dst.texture);
      this.fxaa.render(renderer, null);
    }
  }

  dispose() {
    this.rtScene?.dispose(); this.rtSky?.dispose(); this.rtLdr?.dispose();
    for (const rt of this.bloomLevels) rt.dispose();
    this.rtGod?.dispose(); this.rtLens?.dispose(); this.rtBloomTmp?.dispose();
    for (const p of [this.skyBlit, this.bright, this.blur, this.godrays, this.lens, this.composite, this.blitToScreen, this.fxaa]) p.dispose();
  }
}
