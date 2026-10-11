// ---------------------------------------------------------------------------
// Ocean — animated Gerstner-wave sea with foam, sky reflections, sun glitter
// and depth-based turquoise shallows (terrain height sampled in the shader).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_HEIGHT, GLSL_COMMON_HEAD, GLSL_FOG } from '../core/glsl.js';
import { skyUniforms, fogUniforms, WORLD_LIGHT_UNIFORMS } from '../render/Shading.js';
import { clamp01, lerp, smoothstep } from '../core/Utils.js';

const WATER_VS = /* glsl */`
${GLSL_NOISE}
uniform vec2 uCenter;
uniform float uSize;
uniform float uTime;
uniform vec2 uWind;
uniform float uWaveHeight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vDist;

vec3 gerstner(vec2 p, vec2 dir, float amp, float len, float steep, float t, out vec3 tangent, out vec3 binormal) {
  float k = 6.28318 / len;
  float c = sqrt(9.81 / k);
  vec2 d = normalize(dir);
  float f = k * (dot(d, p) - c * t);
  float a = steep / k;
  vec3 pos = vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
  tangent = vec3(1.0 - steep * sin(f) * d.x * d.x, d.x * steep * cos(f), -steep * sin(f) * d.x * d.y);
  binormal = vec3(-steep * sin(f) * d.x * d.y, d.y * steep * cos(f), 1.0 - steep * sin(f) * d.y * d.y);
  return pos;
}

void main() {
  vec2 p = uCenter + position.xz * uSize;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 offset = vec3(0.0);
  vec3 t1, b1, t2, b2, t3, b3, t4, b4;
  offset += gerstner(p, uWind + vec2(0.15, 0.0), uWaveHeight * 0.55, 62.0, 0.55, uTime, t1, b1);
  offset += gerstner(p, uWind + vec2(-0.35, 0.25), uWaveHeight * 0.30, 34.0, 0.45, uTime, t2, b2);
  offset += gerstner(p, uWind + vec2(0.5, -0.4), uWaveHeight * 0.16, 17.0, 0.35, uTime, t3, b3);
  offset += gerstner(p, uWind + vec2(-0.1, -0.6), uWaveHeight * 0.08, 8.5, 0.28, uTime, t4, b4);
  vec3 n = normalize(vec3(-(t1.x + t2.x + t3.x + t4.x - 3.0) * 0.55, 1.0, -(b1.z + b2.z + b3.z + b4.z - 3.0) * 0.55));
  // ripple detail
  float r = fbm2(p * 0.05 + uTime * 0.35, 3);
  n = normalize(n + vec3(r * 0.12, 0.0, fbm2(p * 0.05 + 31.0 - uTime * 0.31, 3) * 0.12));
  vec3 wp = vec3(p.x + offset.x, offset.y, p.y + offset.z);
  vWorld = wp;
  vNormal = n;
  vFoam = smoothstep(0.45, 1.0, offset.y / max(0.001, uWaveHeight * 0.55)) * 0.9 + 0.1;
  vDist = length(wp - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const WATER_FS = /* glsl */`
precision highp float;
${GLSL_NOISE}
${GLSL_HEIGHT}
${GLSL_COMMON_HEAD}
${GLSL_FOG}
uniform vec3 uAmbientUp;
uniform vec3 uAmbientDown;
uniform float uAmbientI;
uniform vec3 uSunCol;
uniform float uSunI;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform float uSunElev;
uniform float uNight;
uniform float uStorm;
uniform float uFoamAmount;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vDist;

void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);
  vec3 vd = normalize(p - camPos);

  // depth of the sea floor -> shallow turquoise / deep blue
  float floorH = worldHeight(p.xz);
  float depth = clamp(-floorH, 0.0, 90.0);
  vec3 shallow = vec3(0.14, 0.52, 0.55);
  vec3 deep = vec3(0.008, 0.055, 0.13);
  vec3 waterCol = mix(shallow, deep, smoothstep(1.0, 34.0, depth));
  // river/coast sand tint through the water
  float beach = 1.0 - smoothstep(0.0, 3.0, depth);
  waterCol = mix(waterCol, vec3(0.32, 0.46, 0.42), beach * 0.5);

  vec3 lightDir = normalize(sunDirWorld);
  float ndl = max(dot(n, lightDir), 0.0);
  vec3 skyRefl = mix(uSkyZenith, uSkyHorizon, clamp(1.0 - abs(vd.y) * 1.4, 0.0, 1.0));
  skyRefl = mix(skyRefl, uSunCol * 1.2, pow(max(dot(reflect(vd, n), lightDir), 0.0), 8.0) * 0.35);
  skyRefl *= 0.85 + 0.35 * uSunElev;

  float fres = fresnel(max(dot(n, -vd), 0.0), 0.02);
  fres = clamp(fres, 0.03, 0.98);
  vec3 col = mix(waterCol * (uAmbientUp * uAmbientI * 1.2 + uSunCol * uSunI * ndl * 0.22), skyRefl, fres);

  // sun glitter / specular
  float spec = pow(max(dot(reflect(vd, n), lightDir), 0.0), 220.0);
  col += uSunCol * uSunI * spec * 2.2;

  // foam on crests + shoreline foam
  float shoreFoam = (1.0 - smoothstep(0.0, 2.2, depth)) * 0.85;
  float foamMask = clamp(vFoam * uFoamAmount + shoreFoam + uStorm * 0.35, 0.0, 1.0);
  float fn = fbm2(p.xz * 0.35 + vec2(uTime * 0.2, -uTime * 0.15), 3) * 0.5 + 0.5;
  foamMask *= smoothstep(0.35, 0.75, fn * 0.6 + 0.4);
  col = mix(col, vec3(0.92, 0.95, 0.98) * (0.55 + 0.45 * (1.0 - uNight)), foamMask * 0.8);

  // wet, stormy sky darkening
  col *= mix(1.0, 0.72, uStorm);

  float f = fogFactor(p);
  col = mix(col, fogColorAt(p, vd), f);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Ocean {
  constructor(opts = {}) {
    const seg = opts.segments || 160;
    const geo = new THREE.PlaneGeometry(1, 1, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.geometry = geo;
    this.uniforms = {
      uCenter: { value: new THREE.Vector2() },
      uSize: { value: 34000 },
      uTime: { value: 0 },
      uWind: skyUniforms.windDir,
      uWaveHeight: { value: 2.2 },
      uAmbientUp: skyUniforms.ambientUp,
      uAmbientDown: skyUniforms.ambientDown,
      uAmbientI: skyUniforms.ambientIntensity,
      uSunCol: skyUniforms.sunColor,
      uSunI: skyUniforms.sunIntensity,
      uSkyZenith: skyUniforms.skyZenith,
      uSkyHorizon: skyUniforms.skyHorizon,
      uSunElev: { value: 0.4 },
      uNight: skyUniforms.nightFactor,
      uStorm: skyUniforms.stormFactor,
      uFoamAmount: { value: 1.0 },
      uTimeFog: { value: 0 },
      ...fogUniforms(),
      ...WORLD_LIGHT_UNIFORMS
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      uniforms: this.uniforms,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'ocean';
  }

  update(camera, env, dt) {
    this.uniforms.uCenter.value.set(camera.position.x, camera.position.z);
    this.uniforms.uTime.value = env.time;
    this.uniforms.uSunElev.value = env.sunElev;
    this.uniforms.uWaveHeight.value = lerp(1.6, 4.2, env.stormFactor);
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
