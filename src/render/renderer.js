// Renderer, HDR post-processing chain and dynamic resolution.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const FINAL = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1 },
    uGrain: { value: 0 },
    uCA: { value: 0 },          // chromatic aberration strength (high G)
    uGray: { value: 0 },        // G tunnel vision 0..1
    uRed: { value: 0 },         // negative-G red-out 0..1
    uBlack: { value: 0 },       // blackout 0..1
    uSpeed: { value: 0 },       // speed lines 0..1
    uMotion: { value: 0 },      // motion blur 0..1
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uRays: { value: 0 },        // god ray strength 0..1
    uTint: { value: new THREE.Color(1, 1, 1) },
    uStorm: { value: 0 },       // desaturation during storms
    uNight: { value: 0 },       // night-vision green mode
    uCloud: { value: 0 },       // in-cloud haze overlay
    uBright: { value: 1 },
    uTexel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uGray, uRed, uBlack, uSpeed, uMotion, uRays, uStorm, uNight, uCloud, uBright;
    uniform vec2 uSunUV, uTexel;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r = length(c);
      // Chromatic aberration at screen edges (high G pushes it up).
      float ca = uCA * 0.012 * r * r * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      // Radial motion blur at speed.
      if (uMotion > 0.001) {
        vec3 acc = col;
        for (int i = 1; i < 7; i++) acc += texture2D(tDiffuse, uv - c * uMotion * float(i) * 0.012).rgb;
        col = mix(col, acc / 7.0, clamp(uMotion, 0.0, 1.0) * 0.8);
      }
      // God rays: radial accumulation of bright samples toward the sun's screen position.
      if (uRays > 0.001) {
        vec2 delta = (uv - uSunUV) * (1.0 / 48.0);
        vec2 p = uv;
        float w = 1.0;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < 40; i++) {
          p -= delta;
          vec3 s = texture2D(tDiffuse, p).rgb;
          float b = max(lum(s) - 0.85, 0.0);
          rays += s * b * w;
          w *= 0.955;
        }
        col += rays * uRays * 0.02;
      }
      // Colour grading: warm/cool/desaturated per mission state.
      col *= uTint;
      float L = lum(col);
      col = mix(vec3(L), col, 1.0 - uStorm * 0.55);
      // Night vision: phosphor-green monochrome with noise.
      if (uNight > 0.001) {
        vec3 nv = vec3(L * 0.25, L * 1.6, L * 0.3);
        nv += (hash(uv * 900.0) - 0.5) * 0.06;
        col = mix(col, nv, uNight);
      }
      // Tunnel vision for positive G.
      float tunnel = smoothstep(0.15, 0.65, r) * uGray;
      col = mix(col, vec3(lum(col) * 0.15), tunnel);
      // Red-out for negative G.
      float edge = smoothstep(0.1, 0.6, r);
      col = mix(col, col * vec3(1.0, 0.12, 0.1) + vec3(0.25, 0.0, 0.0) * uRed, uRed * edge);
      // Speed lines at maximum velocity.
      if (uSpeed > 0.001) {
        float ang = atan(c.y, c.x);
        float streak = step(0.985, hash(vec2(floor(ang * 60.0), 3.0)));
        float mask = smoothstep(0.25, 0.7, r) * streak * uSpeed;
        col += vec3(0.7, 0.8, 1.0) * mask * 0.6;
      }
      // Vignette and film grain.
      col *= mix(1.0, 1.0 - 0.55 * smoothstep(0.35, 0.95, r * 1.25), uVignette);
      col += (hash(uv * 1000.0) - 0.5) * uGrain * 0.07;
      // In-cloud haze and blackout fade.
      col = mix(col, vec3(0.72, 0.74, 0.78), uCloud * 0.55);
      col *= uBright;
      col *= 1.0 - uBlack;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.width = 1; this.height = 1;
    this.dynScale = 1;
    this.targetHeight = 1080;
    this.quality = null;
    this.composer = null;
    this.bloom = null;
    this.final = null;
  }

  // Build or rebuild the composer after quality changes.
  configure(quality, scene, camera) {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality.shadows > 0;
    const maxS = this.renderer.capabilities.maxSamples || 0;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Math.min(quality.aa || 0, maxS) });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    const strength = quality.postFx >= 1 ? 0.35 : 0.15;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), strength, 0.5, 0.92);
    this.bloom.enabled = quality.postFx >= 1;
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FINAL);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.setSize(this.width, this.height);
  }

  // Resolution: target vertical resolution times quality and dynamic scale.
  setSize(w, h) {
    this.width = w; this.height = h;
    if (!this.composer) return;
    const scale = Math.min(1, this.targetHeight / Math.max(h, 1)) * (this.quality?.resScale ?? 1) * this.dynScale;
    const pr = Math.max(0.5, Math.min((window.devicePixelRatio || 1) * scale, 2));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.final.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
  }

  // Dynamic resolution: nudge the scale to hold the frame rate.
  adaptResolution(frameMs, enabled) {
    if (!enabled) {
      if (this.dynScale !== 1) { this.dynScale = 1; this.setSize(this.width, this.height); }
      return;
    }
    if (frameMs > 19) this.dynScale = Math.max(0.55, this.dynScale - 0.03);
    else if (frameMs < 14) this.dynScale = Math.min(1, this.dynScale + 0.01);
    else return;
    this.setSize(this.width, this.height);
  }

  render(dt, time) {
    this.final.uniforms.uTime.value = time;
    if (this.bloom) this.bloom.enabled = this.quality.postFx >= 1;
    this.composer.render(dt);
  }

  dispose() { this.composer?.dispose(); this.renderer.dispose(); }
}

export { FINAL };
