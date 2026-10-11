// ---------------------------------------------------------------------------
// glsl.js — shared GLSL chunks (simplex noise, world height field, biome splat,
// shadows/fog helpers).  The height field here MIRRORS Terrain.js `heightAt()`
// so that CPU collision/placement and GPU rendering agree.
// ---------------------------------------------------------------------------
import { RNG } from './Utils.js';

// Canonical permutation shared by CPU (Noise) and GPU (PERM[] below).
export const CANONICAL_PERM = (() => {
  const rng = new RNG(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  return p;
})();

const permList = Array.from(CANONICAL_PERM).join(',');

export const GLSL_PERM = `const int PERM[256] = int[256](${permList});`;

// ---------------------------------------------------------------------------
export const GLSL_NOISE = /* glsl */`
${GLSL_PERM}
const vec3 GRAD3[12] = vec3[12](
  vec3(1,1,0), vec3(-1,1,0), vec3(1,-1,0), vec3(-1,-1,0),
  vec3(1,0,1), vec3(-1,0,1), vec3(1,0,-1), vec3(-1,0,-1),
  vec3(0,1,1), vec3(0,-1,1), vec3(0,1,-1), vec3(0,-1,-1));

int perm(int i) { return PERM[i & 255]; }
int pmod12(int i) { return int(mod(float(PERM[i & 255]), 12.0)); }
vec3 grad3(int idx) { return GRAD3[idx]; }

float snoise2(vec2 v) {
  const float F2 = 0.3660254037844386;
  const float G2 = 0.21132486540518713;
  float n0 = 0.0, n1 = 0.0, n2 = 0.0;
  float s = (v.x + v.y) * F2;
  vec2 i = floor(v + s);
  float t = (i.x + i.y) * G2;
  vec2 x0 = v - (i - t);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 x1 = x0 - i1 + G2;
  vec2 x2 = x0 - 1.0 + 2.0 * G2;
  int ii = int(mod(i.x, 256.0));
  int jj = int(mod(i.y, 256.0));
  float t0 = 0.5 - dot(x0, x0);
  if (t0 >= 0.0) { vec3 g = grad3(pmod12(ii + perm(jj))); t0 *= t0; n0 = t0 * t0 * dot(g.xy, x0); }
  float t1 = 0.5 - dot(x1, x1);
  if (t1 >= 0.0) { vec3 g = grad3(pmod12(ii + int(i1.x) + perm(jj + int(i1.y)))); t1 *= t1; n1 = t1 * t1 * dot(g.xy, x1); }
  float t2 = 0.5 - dot(x2, x2);
  if (t2 >= 0.0) { vec3 g = grad3(pmod12(ii + 1 + perm(jj + 1))); t2 *= t2; n2 = t2 * t2 * dot(g.xy, x2); }
  return 70.0 * (n0 + n1 + n2);
}

float snoise3(vec3 v) {
  const float F3 = 0.3333333333;
  const float G3 = 0.1666666667;
  float n0 = 0.0, n1 = 0.0, n2 = 0.0, n3 = 0.0;
  float s = (v.x + v.y + v.z) * F3;
  vec3 i = floor(v + s);
  float t = (i.x + i.y + i.z) * G3;
  vec3 x0 = v - (i - t);
  vec3 i1, i2;
  if (x0.x >= x0.y) {
    if (x0.y >= x0.z) { i1 = vec3(1,0,0); i2 = vec3(1,1,0); }
    else if (x0.x >= x0.z) { i1 = vec3(1,0,0); i2 = vec3(1,0,1); }
    else { i1 = vec3(0,0,1); i2 = vec3(1,0,1); }
  } else {
    if (x0.y < x0.z) { i1 = vec3(0,0,1); i2 = vec3(0,1,1); }
    else if (x0.x < x0.z) { i1 = vec3(0,1,0); i2 = vec3(0,1,1); }
    else { i1 = vec3(0,1,0); i2 = vec3(1,1,0); }
  }
  vec3 x1 = x0 - i1 + G3;
  vec3 x2 = x0 - i2 + 2.0 * G3;
  vec3 x3 = x0 - 1.0 + 3.0 * G3;
  int ii = int(mod(i.x, 256.0)), jj = int(mod(i.y, 256.0)), kk = int(mod(i.z, 256.0));
  vec3 i1i = vec3(i1); vec3 i2i = vec3(i2);
  float t0 = 0.6 - dot(x0, x0);
  if (t0 >= 0.0) { vec3 g = grad3(pmod12(ii + perm(jj + perm(kk)))); t0 *= t0; n0 = t0 * t0 * dot(g, x0); }
  float t1 = 0.6 - dot(x1, x1);
  if (t1 >= 0.0) { vec3 g = grad3(pmod12(ii + int(i1.x) + perm(jj + int(i1.y) + perm(kk + int(i1.z))))); t1 *= t1; n1 = t1 * t1 * dot(g, x1); }
  float t2 = 0.6 - dot(x2, x2);
  if (t2 >= 0.0) { vec3 g = grad3(pmod12(ii + int(i2.x) + perm(jj + int(i2.y) + perm(kk + int(i2.z))))); t2 *= t2; n2 = t2 * t2 * dot(g, x2); }
  float t3 = 0.6 - dot(x3, x3);
  if (t3 >= 0.0) { vec3 g = grad3(pmod12(ii + 1 + perm(jj + 1 + perm(kk + 1)))); t3 *= t3; n3 = t3 * t3 * dot(g, x3); }
  return 32.0 * (n0 + n1 + n2 + n3);
}

float fbm2(vec2 p, int oct) {
  float a = 1.0, f = 1.0, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += a * snoise2(p * f);
    norm += a; a *= 0.5; f *= 2.0;
  }
  return sum / norm;
}
float fbm3(vec3 p, int oct) {
  float a = 1.0, f = 1.0, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    sum += a * snoise3(p * f);
    norm += a; a *= 0.5; f *= 2.0;
  }
  return sum / norm;
}
float ridged2(vec2 p, int oct) {
  float a = 1.0, f = 1.0, sum = 0.0, norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(snoise2(p * f));
    sum += a * n * n;
    norm += a; a *= 0.5; f *= 2.0;
  }
  return sum / norm;
}
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float worley2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float best = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = vec2(float(x), float(y));
      vec2 g = vec2(hash21(i + c + 0.13), hash21(i + c + 7.77));
      float d = length(c + g - f);
      best = min(best, d);
    }
  }
  return best;
}
`;

// ---------------------------------------------------------------------------
// World height field — MUST mirror TerrainField.heightAt in Terrain.js
// ---------------------------------------------------------------------------
export const GLSL_HEIGHT = /* glsl */`
float riverField(vec2 p) {
  vec2 warp = vec2(fbm2(p * 0.00031 + vec2(3.1, 7.7), 2), fbm2(p * 0.00027 + vec2(11.3, -4.9), 2)) * 0.35;
  float nv = fbm2(p * 0.000085 + warp * 0.004 + vec2(5.0, -2.0), 3);
  return (nv - 0.06) * 1350.0;
}

float worldHeight(vec2 p) {
  float cont = fbm2(p * 0.000045, 4);
  float dry = smoothstep(0.02, 0.55, fbm2(p * 0.00007 + vec2(-42.3, 19.5), 2));
  float slop = fbm2(p * 0.00042 + vec2(64.0, -18.0), 3) * 0.5 + 0.5;
  float mMask = smoothstep(-0.12, 0.5, fbm2(p * 0.00011 + vec2(13.7, -8.1), 3)) * smoothstep(0.25, 0.75, slop);
  float ridge = ridged2(p * 0.00030, 5);
  float base = (cont + 0.22) * 430.0;
  float mount = mMask * pow(ridge, 1.7) * 1750.0;
  float hills = fbm2(p * 0.0013, 4) * 55.0 * (0.4 + 0.6 * cont);
  float dunes = fbm2(p * 0.004, 2) * 26.0;
  float h = base + mount + hills + dry * dunes;
  float can = smoothstep(0.58, 0.95, ridged2(p * 0.00042 + vec2(70.0, 33.0), 3));
  h -= dry * can * 155.0;
  h += fbm2(p * 0.009, 3) * 6.0 + fbm2(p * 0.035, 2) * 1.6;
  float rv = 1.0 - smoothstep(0.0, 58.0, abs(riverField(p)));
  h -= rv * 24.0 * smoothstep(10.0, 170.0, h);
  return h;
}

vec3 worldNormal(vec2 p, float eps) {
  float hL = worldHeight(p - vec2(eps, 0.0));
  float hR = worldHeight(p + vec2(eps, 0.0));
  float hD = worldHeight(p - vec2(0.0, eps));
  float hU = worldHeight(p + vec2(0.0, eps));
  return normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
}

// 0..1 weights: x=grass, y=rock, z=sand, w=snow
vec4 biomeWeights(vec2 p, float h, vec3 n) {
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  float moisture = fbm2(p * 0.00013 + vec2(21.0, -9.0), 2) * 0.5 + 0.5;
  float dryness = smoothstep(0.02, 0.55, fbm2(p * 0.00007 + vec2(-42.3, 19.5), 2));
  float snow = smoothstep(760.0, 1420.0, h + fbm2(p * 0.0022, 2) * 160.0);
  float rock = smoothstep(0.24, 0.55, slope);
  float beach = (1.0 - smoothstep(1.0, 22.0, h));
  float sand = max(beach, dryness * (1.0 - smoothstep(120.0, 520.0, h)) * 0.85);
  float grass = clamp(1.0 - rock - snow, 0.0, 1.0) * (0.35 + 0.65 * moisture);
  vec4 w = vec4(grass, rock, sand, snow);
  w = pow(max(w, vec4(0.0)), vec4(1.3));
  float s = w.x + w.y + w.z + w.w;
  return s > 0.0001 ? w / s : vec4(1.0, 0.0, 0.0, 0.0);
}
`;

// ---------------------------------------------------------------------------
// Cascaded shadow maps — hand-rolled, matching render/CascadedShadows.js
// ---------------------------------------------------------------------------
export const GLSL_SHADOWS = /* glsl */`
uniform vec3 sunDirWorld;
uniform sampler2D csm0;
uniform sampler2D csm1;
uniform sampler2D csm2;
uniform mat4 csmMat0;
uniform mat4 csmMat1;
uniform mat4 csmMat2;
uniform vec4 csmParams0;   // x: texel, y: normal bias, z: depth bias, w: 0
uniform vec4 csmParams1;
uniform vec4 csmParams2;
uniform vec4 csmSplits;    // x,y,z: cascade far planes, w: shadow strength

float unpackDepthRGBA(vec4 c) {
  return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

float sampleCascade(sampler2D tex, mat4 mat, vec3 world, vec4 params, float compare) {
  vec4 sc = mat * vec4(world, 1.0);
  vec3 c = sc.xyz / sc.w;
  c = c * 0.5 + 0.5;
  if (c.x < 0.002 || c.x > 0.998 || c.y < 0.002 || c.y > 0.998 || c.z > 1.0) return 1.0;
  float bias = compare + params.z;
  float texel = params.x;
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * texel;
      float d = unpackDepthRGBA(texture2D(tex, c.xy + o));
      sum += d + bias < c.z ? 0.0 : 1.0;
    }
  }
  return sum / 9.0;
}

float getCsmShadow(vec3 world, vec3 n, float ldotn) {
  float dist = length(world - cameraPosition);
  float ndl = clamp(1.0 - ldotn, 0.0, 1.0);
  float bias = 0.00055 + ndl * 0.0022;
  float s;
  if (dist < csmSplits.x) s = sampleCascade(csm0, csmMat0, world, csmParams0, bias);
  else if (dist < csmSplits.y) s = sampleCascade(csm1, csmMat1, world, csmParams1, bias);
  else s = sampleCascade(csm2, csmMat2, world, csmParams2, bias);
  return mix(1.0, s, csmSplits.w);
}
`;

// ---------------------------------------------------------------------------
// Atmospheric fog / aerial perspective (matches Sky.js parameters)
// ---------------------------------------------------------------------------
export const GLSL_FOG = /* glsl */`
uniform vec3 fogColorHorizon;
uniform vec3 fogColorZenith;
uniform vec3 sunDirection;
uniform vec3 sunTint;
uniform vec3 camPos;
uniform vec3 fogParams;    // x: density, y: height falloff, z: storm boost, w: unused
uniform float nightFactor;
uniform float stormFactor;

float fogFactor(vec3 worldPos) {
  float dist = length(worldPos - camPos);
  float k = fogParams.x * exp(-max(worldPos.y, 0.0) * fogParams.y);
  // storm / overcast thickening near the camera
  k *= 1.0 + stormFactor * 0.9;
  return 1.0 - exp(-dist * k);
}

vec3 fogColorAt(vec3 worldPos, vec3 viewDir) {
  float h = max(worldPos.y, 0.0);
  float horizonMix = clamp(exp(-h * 0.00035) * (1.0 - abs(viewDir.y)) + 0.1, 0.0, 1.0);
  vec3 col = mix(fogColorZenith, fogColorHorizon, horizonMix);
  float sunAmt = pow(clamp(dot(viewDir, sunDirection) * 0.5 + 0.5, 0.0, 1.0), 5.0);
  col = mix(col, sunTint, sunAmt * 0.5);
  col = mix(col, fogColorHorizon * 0.85, stormFactor * 0.45);
  return col;
}
`;

export const GLSL_COMMON_HEAD = /* glsl */`
#define PI 3.14159265359
#define TAU 6.28318530718
float saturate1(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate3(vec3 x) { return clamp(x, 0.0, 1.0); }
float fresnel(float cosT, float f0) { return f0 + (1.0 - f0) * pow(1.0 - cosT, 5.0); }
float lgWeight(float x, float a) { return 1.0 / (1.0 + a * x); }
vec3 tonemapACES(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
`;
