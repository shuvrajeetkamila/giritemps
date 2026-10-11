// ---------------------------------------------------------------------------
// Weather — GPU-side precipitation (rain / snow) plus lightning and the
// "inside cloud" fog/audio state. Zero CPU cost per particle.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLSL_COMMON_HEAD } from '../core/glsl.js';
import { skyUniforms, SPR, fogUniforms } from '../render/Shading.js';
import { clamp01, lerp } from '../core/Utils.js';

const PRECIP_VS = /* glsl */`
precision highp float;
attribute float iSeed;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uAmount;      // 0..1 density
uniform float uFallSpeed;
uniform float uStretch;
uniform vec3 uFallDir;      // normalised fall direction (down + wind)
uniform vec3 uBox;
uniform float uSizeScale;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
varying vec2 vUv;
varying float vFade;
varying float vSeed;

vec3 wrap(vec3 rel) {
  return mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
}

void main() {
  float s = iSeed;
  vec3 base = vec3(hash11(s) - 0.5, hash11(s * 1.37 + 3.1), hash11(s * 2.11 + 7.7) - 0.5) * uBox;
  vec3 p = base;
  p.y -= uFallSpeed * uTime;
  p.xz += uFallDir.xz * uFallSpeed * uTime * 0.35;
  p.x += sin(uTime * 1.7 + s * 40.0) * (uFallSpeed < 6.0 ? 6.0 : 0.6);
  p.z += cos(uTime * 1.3 + s * 31.0) * (uFallSpeed < 6.0 ? 6.0 : 0.6);
  vec3 rel = wrap(p - 0.0);
  vec3 world = uCamPos + rel + vec3(0.0, 12.0, 0.0);

  vec2 c = position.xy;
  float scale = uSizeScale * (0.7 + hash11(s * 5.3) * 0.7);
  vec3 across = normalize(cross(uFallDir, uCamUp) + vec3(1e-4));
  vec3 up = normalize(cross(across, uFallDir));
  vec3 world2 = world + across * c.x * scale + uFallDir * (0.5 + c.y) * scale * uStretch;
  vUv = uv;
  vSeed = s;
  float dist = length(world - uCamPos);
  vFade = (1.0 - smoothstep(uBox.x * 0.4, uBox.x * 0.55, dist)) * uAmount;
  gl_Position = projectionMatrix * viewMatrix * vec4(world2, 1.0);
}
`;

const PRECIP_FS = /* glsl */`
precision highp float;
uniform sampler2D uAtlas;
uniform vec2 uAtlasOffset;
uniform vec2 uAtlasScale;
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
varying float vFade;
varying float vSeed;

void main() {
  vec2 uv = uAtlasOffset + vUv * uAtlasScale;
  vec4 t = texture2D(uAtlas, uv);
  float a = t.a * vFade * uOpacity * (0.6 + 0.6 * hash11(vSeed * 9.1));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uTint * t.rgb, a);
}
`;

export class WeatherSystem {
  constructor(atlas) {
    this.atlas = atlas;
    this.amount = 0;
    this.snowAmount = 0;
    this.rainAmount = 0;
    this.enabled = true;
    this.quality = 2;
    this.time = 0;
    this._buildRain(6000);
    this._buildSnow(4000);
    this.inCloud = 0;
    this.fogBoost = 0;
  }

  _mkInstances(count) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = (i + 1) * 0.618033988749895 % 1 + i * 0.017;
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return geo;
  }

  _buildRain(count) {
    this.rainCount = count;
    this.rainGeo = this._mkInstances(count);
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: PRECIP_VS, fragmentShader: PRECIP_FS,
      uniforms: {
        uCamPos: skyUniforms.cameraPos,
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uFallSpeed: { value: 42 },
        uStretch: { value: 90 },
        uFallDir: { value: new THREE.Vector3(0, -1, 0.1).normalize() },
        uBox: { value: new THREE.Vector3(220, 160, 220) },
        uSizeScale: { value: 1.4 },
        uAtlas: { value: this.atlas },
        uAtlasOffset: { value: new THREE.Vector2((SPR.RAIN % 4) * 0.25, Math.floor(SPR.RAIN / 4) * 0.25) },
        uAtlasScale: { value: new THREE.Vector2(0.25, 0.25) },
        uOpacity: { value: 0.5 },
        uTint: { value: new THREE.Color(0.78, 0.86, 0.98) },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) }
      },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
    this.rainMesh = new THREE.Mesh(this.rainGeo, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 8;
  }

  _buildSnow(count) {
    this.snowCount = count;
    this.snowGeo = this._mkInstances(count);
    this.snowMat = new THREE.ShaderMaterial({
      vertexShader: PRECIP_VS, fragmentShader: PRECIP_FS,
      uniforms: {
        uCamPos: skyUniforms.cameraPos,
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uFallSpeed: { value: 3.2 },
        uStretch: { value: 1.0 },
        uFallDir: { value: new THREE.Vector3(0, -1, 0.05).normalize() },
        uBox: { value: new THREE.Vector3(180, 140, 180) },
        uSizeScale: { value: 9.0 },
        uAtlas: { value: this.atlas },
        uAtlasOffset: { value: new THREE.Vector2((SPR.SNOW % 4) * 0.25, Math.floor(SPR.SNOW / 4) * 0.25) },
        uAtlasScale: { value: new THREE.Vector2(0.25, 0.25) },
        uOpacity: { value: 0.85 },
        uTint: { value: new THREE.Color(1, 1, 1) },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) }
      },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
    this.snowMesh = new THREE.Mesh(this.snowGeo, this.snowMat);
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 8;
  }

  setQuality(level) {
    this.quality = level;
    const f = [0.35, 0.6, 1.0, 1.5][Math.min(3, Math.max(0, level | 0))];
    this.rainGeo.instanceCount = Math.floor(this.rainCount * f);
    this.snowGeo.instanceCount = Math.floor(this.snowCount * f);
  }

  update(camera, env, dt, cloudField) {
    this.time += dt;
    if (this.time > 500) this._resetTime();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const camY = camera.position.y;
    const snowing = env.tempAt(camY) < 1.5;
    const inCloud = cloudField ? (cloudField.inCloudFog || 0) : 0;
    const amount = clamp01(env.precip * (1 - inCloud * 0.5));
    const rainAmount = snowing ? 0 : amount;
    const snowAmount = snowing ? amount : 0;

    // altitude limit: no rain above the cloud tops
    const inRange = 1 - clamp01((camY - (env.cloudBase + env.cloudThickness + 500)) / 2500);
    this.rainAmount = rainAmount * inRange;
    this.snowAmount = snowAmount * inRange;

    const ru = this.rainMat.uniforms;
    ru.uTime.value = this.time;
    ru.uAmount.value = this.rainAmount;
    ru.uCamRight.value.copy(right);
    ru.uCamUp.value.copy(up);
    ru.uFallDir.value.set(env.windDir.x * 0.25, -1, env.windDir.y * 0.25).normalize();
    ru.uOpacity.value = 0.42 * lerp(1, 1.4, env.stormCover);
    this.rainMesh.visible = this.rainAmount > 0.02;

    const su = this.snowMat.uniforms;
    su.uTime.value = this.time * 0.6;
    su.uAmount.value = this.snowAmount;
    su.uCamRight.value.copy(right);
    su.uCamUp.value.copy(up);
    su.uFallDir.value.set(env.windDir.x * 0.35, -1, env.windDir.y * 0.35).normalize();
    this.snowMesh.visible = this.snowAmount > 0.02;

    // in-cloud fog
    const target = cloudField ? cloudField.densityAt(camera.position) : 0;
    this.inCloud = lerp(this.inCloud, target, 1 - Math.exp(-dt * 4));
    env.inCloud = this.inCloud;
    this.fogBoost = this.inCloud;
  }

  _resetTime() {
    this.time = 0;
    // re-seed so particles jump seamlessly (rain/snow are stochastic anyway)
    for (const geo of [this.rainGeo, this.snowGeo]) {
      const a = geo.getAttribute('iSeed');
      for (let i = 0; i < a.count; i++) a.array[i] = (a.array[i] + 0.317) % 1;
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.rainGeo.dispose(); this.snowGeo.dispose();
    this.rainMat.dispose(); this.snowMat.dispose();
  }
}
