// ---------------------------------------------------------------------------
// Sky — analytic single-scattering atmosphere, sun disc + Mie glow, moon with
// phases, procedural star field with twinkle, milky way, and two projected
// cloud decks (cumulus + cirrus) that read as a full volumetric sky.
// Rendered as a full-screen pass into a low-res HDR target.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_COMMON_HEAD } from '../core/glsl.js';
import { skyUniforms } from '../render/Shading.js';
import { clamp01, clamp, lerp, smoothstep } from '../core/Utils.js';

const SKY_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SKY_FS = /* glsl */`
precision highp float;
${GLSL_NOISE}
${GLSL_COMMON_HEAD}
varying vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunCol;
uniform float uSunElev;
uniform float uNight;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGroundCol;
uniform float uCumulusBase;
uniform float uCumulusThick;
uniform float uCirrusAlt;
uniform float uCoverage;
uniform float uStorm;
uniform float uTime;
uniform vec2 uWind;
uniform float uStormCover;
uniform vec3 uLightningPos;
uniform float uLightning;
uniform vec2 uCloudOffset;

// ---------- star field ----------
float stars(vec3 dir, float density, float seed, float t) {
  vec3 p = dir * 210.0;
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 rnd = hash33(i + seed);
  if (rnd.z > density) return 0.0;
  vec3 c = vec3(0.5) + (rnd - 0.5) * 0.72;
  float d = length(f - c);
  float mag = pow(rnd.x, 2.2);
  float tw = 0.75 + 0.25 * sin(t * (2.0 + rnd.y * 6.0) + rnd.x * 30.0);
  return smoothstep(0.16, 0.0, d) * (0.25 + mag * 2.6) * tw;
}

vec3 starField(vec3 dir, float night, float t) {
  if (night < 0.01) return vec3(0.0);
  float s1 = stars(dir, 0.055, 0.0, t);
  float s2 = stars(dir * 1.7, 0.02, 13.7, t * 0.7);
  // colour temperature variation
  float hue = hash33(floor(dir * 90.0)).x;
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hue);
  vec3 stars = tint * (s1 + s2 * 1.7);
  // milky way band
  vec3 gal = normalize(vec3(0.35, 0.28, -0.9));
  float band = exp(-pow(dot(dir, gal) * 3.2, 2.0));
  float mw = fbm3(dir * 7.0, 4) * 0.5 + 0.5;
  stars += vec3(0.55, 0.6, 0.75) * band * pow(mw, 2.2) * 0.16;
  return stars * night;
}

// ---------- projected cloud decks ----------
float cumulusField(vec2 p, float t) {
  vec2 q = p * 0.000055 + uCloudOffset * 0.000055;
  float n = fbm2(q + vec2(0.0, 0.0), 4) * 0.5 + 0.5;
  float n2 = fbm2(p * 0.00021 + vec2(11.0, -7.0) - uCloudOffset * 0.00021, 3) * 0.5 + 0.5;
  float cover = mix(uCoverage, max(uCoverage, 0.95), uStormCover);
  float cl = smoothstep(1.15 - cover * 1.1, 1.35 - cover * 1.1, n * 0.72 + n2 * 0.28);
  return cl;
}

vec3 shadeCumulus(vec2 p, float t, float night) {
  float d = cumulusField(p, t);
  if (d <= 0.001) return vec3(0.0);
  float e = 260.0;
  float dx = cumulusField(p + vec2(e, 0.0), t) - d;
  float dy = cumulusField(p + vec2(0.0, e), t) - d;
  vec3 n = normalize(vec3(-dx, 1.0, -dy) * 6.0);
  vec3 lightDir = normalize(uSunDir + vec3(0.0, 0.25, 0.0));
  float ndl = clamp(dot(n, lightDir) * 0.5 + 0.5, 0.0, 1.0);
  float thickness = 1.0 - d;
  float sunAmt = pow(ndl, 1.6);
  vec3 lit = mix(vec3(0.32, 0.36, 0.44), uSunCol * 1.35, sunAmt);
  lit = mix(lit, uHorizon * 0.9, (1.0 - sunAmt) * 0.45);
  lit *= mix(1.0, 0.4, night);
  // storm darkening + lightning glow
  lit = mix(lit, vec3(0.13, 0.13, 0.16), uStormCover * 0.72);
  if (uLightning > 0.001) {
    float d2 = length(p - uLightningPos.xz) ;
    float glow = exp(-d2 * 0.0006) * uLightning;
    lit += vec3(0.9, 0.92, 1.0) * glow * 1.6;
  }
  return lit * d;
}

vec3 shadeCirrus(vec2 p, float t, float night) {
  vec2 q = vec2(p.x * 0.000032, p.y * 0.000010) + vec2(uCloudOffset.x * 0.00002, 0.0);
  float n = fbm2(q, 4) * 0.5 + 0.5;
  float m = smoothstep(0.52, 0.78, n);
  if (m <= 0.001) return vec3(0.0);
  vec3 lit = mix(uHorizon, uSunCol, 0.35) * (1.0 - night * 0.65);
  return lit * m * 0.55;
}

void main() {
  vec4 clip = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 world = uInvViewProj * clip;
  vec3 dir = normalize(world.xyz / world.w - uCamPos);
  float y = dir.y;

  // ---------- atmosphere ----------
  float horizonF = pow(clamp(1.0 - abs(y), 0.0, 1.0), 3.2);
  vec3 sky = mix(uZenith, uHorizon, horizonF);
  // ground haze band below the horizon
  float below = smoothstep(0.0, -0.10, y);
  sky = mix(sky, uGroundCol, below * 0.85);

  float sunDot = dot(dir, uSunDir);
  // Mie forward scattering around the sun / sunset glow
  float mie = pow(max(sunDot, 0.0), 6.0) * 0.35 + pow(max(sunDot, 0.0), 90.0) * 0.7;
  sky += uSunCol * mie * (0.55 + uStorm * 0.0);
  // Rayleigh-ish blue boost high in the sky
  sky += vec3(0.05, 0.12, 0.28) * smoothstep(0.0, 0.75, y) * (1.0 - uNight * 0.85);

  // ---------- stars ----------
  sky += starField(dir, uNight, uTime);

  // ---------- moon ----------
  float moonDot = dot(dir, uMoonDir);
  float moonDisc = smoothstep(0.99955, 0.99985, moonDot);
  if (moonDisc > 0.001) {
    vec3 up = abs(uMoonDir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t1 = normalize(cross(up, uMoonDir));
    vec3 t2 = cross(uMoonDir, t1);
    vec2 uv2 = vec2(dot(dir, t1), dot(dir, t2)) * 260.0;
    float craters = fbm2(uv2 * 1.5, 4) * 0.5 + 0.5;
    float phase = clamp(dot(normalize(uMoonDir), normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
    moonDisc *= 0.55 + 0.45 * craters;
    sky += vec3(0.95, 0.96, 1.0) * moonDisc * (0.4 + phase) * 1.9;
  }
  sky += vec3(0.5, 0.58, 0.8) * pow(max(moonDot, 0.0), 220.0) * 0.35 * uNight;
  sky += vec3(0.25, 0.32, 0.5) * pow(max(moonDot, 0.0), 12.0) * 0.10 * uNight;

  // ---------- sun disc ----------
  float sunDisc = smoothstep(0.99965, 0.99992, sunDot);
  float limb = mix(1.6, 0.85, clamp(1.0 - uSunElev * 3.0, 0.0, 1.0));
  sky += uSunCol * sunDisc * 6.0 * limb * (1.0 - uNight);
  // sky glow near the horizon on the sun side at dusk/dawn
  float dusk = exp(-pow(clamp(abs(uSunElev) * 6.0, 0.0, 3.0), 2.0));
  sky += uSunCol * pow(max(sunDot, 0.0), 3.0) * dusk * 0.5 * (1.0 - uStorm * 0.4);

  // ---------- cloud decks ----------
  float camAbove = step(uCamPos.y, uCumulusBase + uCumulusThick);
  // cumulus: project onto the deck plane
  float tC = (uCumulusBase - uCamPos.y) / max(dir.y, 0.015);
  if (y > 0.004) {
    vec2 pc = uCamPos.xz + dir.xz * tC;
    float fade = 1.0 - smoothstep(45000.0, 120000.0, tC);
    vec3 cl = shadeCumulus(pc, uTime, uNight) * fade;
    float a = clamp(cl.r * 0.35 + cl.g * 0.35 + cl.b * 0.3, 0.0, 1.0);
    a = clamp(a * 1.6, 0.0, 0.98);
    sky = mix(sky, cl / max(a, 0.08), a);
  }
  // cirrus
  float tCi = (uCirrusAlt - uCamPos.y) / max(dir.y, 0.02);
  if (y > 0.01 && tCi > 0.0) {
    vec2 pi = uCamPos.xz + dir.xz * tCi;
    vec3 ci = shadeCirrus(pi, uTime, uNight);
    float a = clamp(max(max(ci.r, ci.g), ci.b), 0.0, 0.55);
    sky = mix(sky, ci / max(a, 0.05), a);
  }

  // overcast veil (storm / rain everywhere)
  sky = mix(sky, uHorizon * 0.85 * (1.0 - uNight * 0.7), uStorm * 0.30);

  gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
}
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0.3, 0.7, 0.2).normalize() },
      uMoonDir: { value: new THREE.Vector3(-0.3, 0.6, -0.2).normalize() },
      uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
      uSunElev: { value: 0.5 },
      uNight: { value: 0 },
      uZenith: { value: new THREE.Color(0.13, 0.32, 0.72) },
      uHorizon: { value: new THREE.Color(0.55, 0.68, 0.88) },
      uGroundCol: { value: new THREE.Color(0.35, 0.33, 0.3) },
      uCumulusBase: { value: 1500 },
      uCumulusThick: { value: 1400 },
      uCirrusAlt: { value: 9000 },
      uCoverage: { value: 0.45 },
      uStorm: { value: 0 },
      uStormCover: { value: 0 },
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0.3) },
      uCloudOffset: { value: new THREE.Vector2() },
      uLightningPos: { value: new THREE.Vector3() },
      uLightning: { value: 0 }
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      transparent: false
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._invVP = new THREE.Matrix4();
  }

  update(camera, env) {
    const u = this.uniforms;
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._invVP.copy(vp).invert();
    u.uInvViewProj.value.copy(this._invVP);
    u.uCamPos.value.copy(camera.position);
    u.uSunDir.value.copy(env.sunDir);
    u.uMoonDir.value.copy(env.moonDir);
    u.uSunCol.value.copy(env.sunColor);
    u.uSunElev.value = env.sunElev;
    u.uNight.value = env.nightFactor;
    u.uZenith.value.copy(env.zenith);
    u.uHorizon.value.copy(env.horizon);
    u.uGroundCol.value.copy(env.groundColor);
    u.uCoverage.value = env.cloudCoverage;
    u.uStorm.value = env.storm;
    u.uStormCover.value = env.stormCover;
    u.uCumulusBase.value = env.cloudBase;
    u.uCumulusThick.value = env.cloudThickness;
    u.uCirrusAlt.value = env.cirrusAlt;
    u.uTime.value = env.time;
    u.uCloudOffset.value.copy(env.cloudOffset);
    u.uLightning.value = env.lightning;
    if (env.lightningPos) u.uLightningPos.value.copy(env.lightningPos);
  }

  /** Render the sky into a target (usually a half-res HDR target). */
  render(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, this.camera);
  }

  /** Project the sun into screen space; returns {x, y, visible, intensity}. */
  sunScreen(camera) {
    const p = new THREE.Vector3().copy(this.uniforms.uSunDir.value).multiplyScalar(10000).add(camera.position);
    p.project(camera);
    const x = (p.x + 1) * 0.5, y = (p.y + 1) * 0.5;
    const inFront = p.z < 1 && p.z > -1 && x > -0.35 && x < 1.35 && y > -0.35 && y < 1.35;
    // fade out when the sun is behind clouds / below the horizon
    const dir = this.uniforms.uSunDir.value;
    const cover = this.uniforms.uCoverage.value;
    const storm = this.uniforms.uStormCover.value;
    const intensity = inFront ? clamp01(1.0 - storm * 0.75) * clamp01((dir.y + 0.12) * 3.2) * (1 - cover * 0.25) : 0;
    return { x, y, visible: inFront, intensity };
  }

  dispose() { this.material.dispose(); this.mesh.geometry.dispose(); }
}
