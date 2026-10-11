// ---------------------------------------------------------------------------
// Terrain — CPU height field (mirrors the GLSL in core/glsl.js) + clipmap
// renderer producing an effectively infinite procedural landscape.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Noise, clamp, clamp01, smoothstep } from '../core/Utils.js';
import { GLSL_NOISE, GLSL_HEIGHT, GLSL_SHADOWS, GLSL_FOG, GLSL_COMMON_HEAD, CANONICAL_PERM } from '../core/glsl.js';
import { fogUniforms, skyUniforms, WORLD_LIGHT_UNIFORMS } from '../render/Shading.js';
import { SHADOW_LAYER_TERRAIN } from '../render/CascadedShadows.js';

// ---------------------------------------------------------------------------
// CPU height field — MUST mirror GLSL_HEIGHT in core/glsl.js
// ---------------------------------------------------------------------------
export class TerrainField {
  constructor(seed = 1337) {
    this.noise = new Noise(seed);
  }

  /** Dev-time integrity check that the CPU noise table matches the GLSL one. */
  verifyNoiseTable() {
    for (let i = 0; i < 256; i++) {
      if (this.noise.perm[i] !== CANONICAL_PERM[i]) return false;
    }
    return true;
  }

  riverField(x, z) {
    const n = this.noise;
    const wx = n.fbm2(x * 0.00031 + 3.1, z * 0.00031 + 7.7, 2) * 0.35;
    const wy = n.fbm2(x * 0.00027 + 11.3, z * 0.00027 - 4.9, 2) * 0.35;
    const nv = n.fbm2(x * 0.000085 + wx * 0.004 + 5.0, z * 0.000085 + wy * 0.004 - 2.0, 3);
    return (nv - 0.06) * 1350.0;
  }

  heightAt(x, z) {
    const n = this.noise;
    const cont = n.fbm2(x * 0.000045, z * 0.000045, 4);
    const dry = smoothstep(0.02, 0.55, n.fbm2(x * 0.00007 - 42.3, z * 0.00007 + 19.5, 2));
    const slop = n.fbm2(x * 0.00042 + 64.0, z * 0.00042 - 18.0, 3) * 0.5 + 0.5;
    const mMask = smoothstep(-0.12, 0.5, n.fbm2(x * 0.00011 + 13.7, z * 0.00011 - 8.1, 3)) * smoothstep(0.25, 0.75, slop);
    const ridge = n.ridged2(x * 0.00030, z * 0.00030, 5);
    const base = (cont + 0.22) * 430.0;
    const mount = mMask * Math.pow(ridge, 1.7) * 1750.0;
    const hills = n.fbm2(x * 0.0013, z * 0.0013, 4) * 55.0 * (0.4 + 0.6 * cont);
    const dunes = n.fbm2(x * 0.004, z * 0.004, 2) * 26.0;
    let h = base + mount + hills + dry * dunes;
    const can = smoothstep(0.58, 0.95, n.ridged2(x * 0.00042 + 70.0, z * 0.00042 + 33.0, 3));
    h -= dry * can * 155.0;
    h += n.fbm2(x * 0.009, z * 0.009, 3) * 6.0 + n.fbm2(x * 0.035, z * 0.035, 2) * 1.6;
    const rv = 1.0 - smoothstep(0.0, 58.0, Math.abs(this.riverField(x, z)));
    h -= rv * 24.0 * smoothstep(10.0, 170.0, h);
    return h;
  }

  normalAt(x, z, eps = 8) {
    const hL = this.heightAt(x - eps, z), hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps), hU = this.heightAt(x, z + eps);
    const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
    const len = Math.hypot(nx, ny, nz) || 1;
    return new THREE.Vector3(nx / len, ny / len, nz / len);
  }

  /** 0..1 weights [grass, rock, sand, snow] (mirrors biomeWeights in GLSL). */
  biomeWeights(x, z, h, ny) {
    const n = this.noise;
    const slope = 1 - clamp01(ny);
    const moisture = n.fbm2(x * 0.00013 + 21.0, z * 0.00013 - 9.0, 2) * 0.5 + 0.5;
    const dryness = smoothstep(0.02, 0.55, n.fbm2(x * 0.00007 - 42.3, z * 0.00007 + 19.5, 2));
    const snow = smoothstep(760, 1420, h + n.fbm2(x * 0.0022, z * 0.0022, 2) * 160);
    const rock = smoothstep(0.24, 0.55, slope);
    const beach = 1 - smoothstep(1, 22, h);
    const sand = Math.max(beach, dryness * (1 - smoothstep(120, 520, h)) * 0.85);
    const grass = clamp01(1 - rock - snow) * (0.35 + 0.65 * moisture);
    return [grass, rock, sand, snow];
  }

  /** Biome name at a position (used by mission generation + scenery). */
  biomeAt(x, z) {
    const h = this.heightAt(x, z);
    if (h < 2) return 'ocean';
    const nrm = this.normalAt(x, z, 60);
    const w = this.biomeWeights(x, z, h, nrm.y);
    let bi = 0, bv = -1;
    for (let i = 0; i < 4; i++) if (w[i] > bv) { bv = w[i]; bi = i; }
    return ['grassland', 'mountains', 'desert', 'snow'][bi];
  }

  isFlatGround(x, z, maxSlope = 0.14, minH = 6, maxH = 1100) {
    const h = this.heightAt(x, z);
    if (h < minH || h > maxH) return false;
    const nrm = this.normalAt(x, z, 40);
    return (1 - nrm.y) < maxSlope;
  }
}

// ---------------------------------------------------------------------------
// Tile geometry — unit grid over [0,1]² with a downward skirt to hide LOD
// seams between clipmap rings.
// ---------------------------------------------------------------------------
const SKIRT_DROP = 90;

function buildTileGeometry(seg) {
  const verts = (seg + 1) * (seg + 1);
  const skirtVerts = 4 * (seg + 1);
  const total = verts + skirtVerts;
  const positions = new Float32Array(total * 3);
  const skirt = new Float32Array(total);
  const uvs = new Float32Array(total * 2);
  let vi = 0;
  for (let y = 0; y <= seg; y++) {
    for (let x = 0; x <= seg; x++, vi++) {
      const u = x / seg, v = y / seg;
      positions[vi * 3] = u;
      positions[vi * 3 + 1] = 0;
      positions[vi * 3 + 2] = v;
      uvs[vi * 2] = u; uvs[vi * 2 + 1] = v;
    }
  }
  const idxOf = (x, y) => y * (seg + 1) + x;
  const indices = [];
  for (let y = 0; y < seg; y++) {
    for (let x = 0; x < seg; x++) {
      const a = idxOf(x, y), b = idxOf(x + 1, y), c = idxOf(x, y + 1), d = idxOf(x + 1, y + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  const borders = [
    Array.from({ length: seg + 1 }, (_, i) => idxOf(i, 0)),
    Array.from({ length: seg + 1 }, (_, i) => idxOf(i, seg)),
    Array.from({ length: seg + 1 }, (_, i) => idxOf(0, i)),
    Array.from({ length: seg + 1 }, (_, i) => idxOf(seg, i))
  ];
  let si = verts;
  for (const border of borders) {
    const ringStart = si;
    for (const src of border) {
      positions[si * 3] = positions[src * 3];
      positions[si * 3 + 1] = -1;                 // flag, scaled in shader
      positions[si * 3 + 2] = positions[src * 3 + 2];
      uvs[si * 2] = uvs[src * 2]; uvs[si * 2 + 1] = uvs[src * 2 + 1];
      skirt[si] = 1;
      si++;
    }
    for (let i = 0; i < seg; i++) {
      const a = border[i], b = border[i + 1];
      const c = ringStart + i, d = ringStart + i + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0, 0.5), 1e7);
  return geo;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const TERRAIN_VS = /* glsl */`
${GLSL_NOISE}
${GLSL_HEIGHT}
uniform vec2 uOrigin;
uniform float uSize;
uniform float uSeg;
attribute float aSkirt;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying float vSlope;
varying float vDist;
varying float vRiver;

void main() {
  vec2 p = uOrigin + position.xz * uSize;
  float h = worldHeight(p);
  float drop = aSkirt * max(30.0, uSize * 0.12);
  vec3 wp = vec3(p.x, h - drop, p.y);
  float eps = max(1.5, uSize / uSeg);
  vec3 n = aSkirt > 0.5 ? vec3(0.0, 1.0, 0.0) : worldNormal(p, eps);
  vWorld = wp;
  vNormal = n;
  vHeight = wp.y;
  vSlope = 1.0 - n.y;
  vDist = length(wp - cameraPosition);
  vRiver = 1.0 - smoothstep(0.0, 58.0, abs(riverField(p)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const TERRAIN_DEPTH_VS = /* glsl */`
${GLSL_NOISE}
${GLSL_HEIGHT}
uniform vec2 uOrigin;
uniform float uSize;
uniform float uSeg;
attribute float aSkirt;
varying float vDepthCoord;
varying float vDepthW;
void main() {
  vec2 p = uOrigin + position.xz * uSize;
  float h = worldHeight(p);
  float drop = aSkirt * max(30.0, uSize * 0.12);
  vec3 wp = vec3(p.x, h - drop, p.y);
  vec4 clip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  gl_Position = clip;
  vDepthCoord = clip.z * 0.5 + 0.5 * clip.w;
  vDepthW = clip.w;
}
`;

export const TERRAIN_DEPTH_FS = /* glsl */`
varying float vDepthCoord;
varying float vDepthW;
const float PackUpscale = 256.0 / 255.0;
const float UnpackDownscale = 255.0 / 256.0;
const vec3 PackFactors = vec3(256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0);
vec4 packDepthToRGBA(const in float v) {
  vec4 r = vec4(fract(v * PackFactors), v);
  r.yzw -= r.xyz * UnpackDownscale;
  return r * PackUpscale;
}
void main() {
  gl_FragColor = packDepthToRGBA(vDepthCoord / vDepthW);
}
`;

const TERRAIN_FS = /* glsl */`
precision highp float;
precision highp sampler2DArray;
${GLSL_NOISE}
${GLSL_HEIGHT}
${GLSL_COMMON_HEAD}
${GLSL_SHADOWS}
${GLSL_FOG}
uniform sampler2DArray uTerrainTex;
uniform float uDetailScale;
uniform vec3 uAmbientUp;
uniform vec3 uAmbientDown;
uniform float uAmbientI;
uniform vec3 uSunCol;
uniform float uSunI;
uniform float uCloudShadow;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec2 uWind;
uniform float uWetness;
uniform float uSnowLine;
uniform float uStorm;
uniform float uTime;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying float vSlope;
varying float vDist;
varying float vRiver;

vec3 sampleLayer(float layer, vec2 uv) {
  return texture(uTerrainTex, vec3(uv, layer)).rgb;
}
float sampleLayerH(float layer, vec2 uv) {
  return texture(uTerrainTex, vec3(uv, layer)).a;
}

vec3 triplanar(float layer, vec3 p, vec3 n, float scale) {
  vec3 blend = pow(abs(n), vec3(4.0));
  blend /= max(1e-4, blend.x + blend.y + blend.z);
  vec3 cx = sampleLayer(layer, p.zy * scale);
  vec3 cy = sampleLayer(layer, p.xz * scale);
  vec3 cz = sampleLayer(layer, p.xy * scale);
  return cx * blend.x + cy * blend.y + cz * blend.z;
}
float triplanarH(float layer, vec3 p, vec3 n, float scale) {
  vec3 blend = pow(abs(n), vec3(4.0));
  blend /= max(1e-4, blend.x + blend.y + blend.z);
  float hx = sampleLayerH(layer, p.zy * scale);
  float hy = sampleLayerH(layer, p.xz * scale);
  float hz = sampleLayerH(layer, p.xy * scale);
  return hx * blend.x + hy * blend.y + hz * blend.z;
}

void main() {
  vec3 p = vWorld;
  vec3 n = normalize(vNormal);

  vec4 w = biomeWeights(p.xz, vHeight, n);
  float altSnow = smoothstep(uSnowLine - 240.0, uSnowLine + 200.0, vHeight + fbm2(p.xz * 0.0022, 2) * 160.0);
  w.w = max(w.w, altSnow * (1.0 - smoothstep(0.5, 0.8, vSlope)));
  float wsum = max(1e-4, w.x + w.y + w.z + w.w);
  w /= wsum;

  float scale = 0.055;
  vec3 col = vec3(0.0);
  float hAcc = 0.0;
  for (int i = 0; i < 4; i++) {
    float ww = i == 0 ? w.x : i == 1 ? w.y : i == 2 ? w.z : w.w;
    if (ww < 0.004) continue;
    col += triplanar(float(i), p, n, scale) * ww;
    hAcc += triplanarH(float(i), p, n, scale) * ww;
  }

  float macro = fbm2(p.xz * 0.00035, 3) * 0.5 + 0.5;
  col *= 0.80 + 0.42 * macro;
  col *= 1.0 + fbm2(p.xz * 0.0026 + 17.0, 3) * 0.13;

  // detail bump from the geometry derivative of vertex height + texture height
  vec3 gn = normalize(n + vec3(-dFdx(vHeight), 0.0, -dFdy(vHeight)) * 0.35);
  float bump = (hAcc - 0.5);
  gn = normalize(gn + vec3(dFdx(bump) * 1.6, 0.0, dFdy(bump) * 1.6));
  n = mix(gn, n, smoothstep(14000.0, 30000.0, vDist));

  // ---------------- river water ----------------
  float carve = 24.0 * smoothstep(10.0, 170.0, vHeight);
  float riv = clamp(vRiver, 0.0, 1.0) * (1.0 - smoothstep(2.0, 46.0, abs(riverField(p.xz))) * 0.0);
  float isWater = smoothstep(1.5, 9.0, carve * riv);
  vec3 waterCol = mix(vec3(0.05, 0.16, 0.20), vec3(0.10, 0.30, 0.32), macro);

  // ---------------- lighting ----------------
  vec3 lightDir = normalize(sunDirWorld);
  float ndl = max(dot(n, lightDir), 0.0);
  float shadow = getCsmShadow(p, n, ndl);
  float csh = fbm2(p.xz * 0.00006 + uWind * uTime * 0.8, 2) * 0.5 + 0.5;
  float cloudSh = mix(1.0, smoothstep(0.32, 0.72, csh), uCloudShadow);
  vec3 sunCol = uSunCol * uSunI;
  float ao = 1.0 - 0.32 * smoothstep(0.18, 0.75, vSlope);

  vec3 diffuse = col * sunCol * ndl * shadow * cloudSh * ao;
  vec3 skyAmb = mix(uAmbientDown, uAmbientUp, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  vec3 lit = diffuse + col * skyAmb * uAmbientI * (0.62 + 0.38 * ao);

  // snow sparkle
  lit += vec3(pow(max(0.0, fbm2(p.xz * 0.85, 2)), 10.0) * w.w * 2.2 * shadow);

  if (isWater > 0.001) {
    vec3 vd = normalize(p - camPos);
    vec3 wcol = waterCol * (skyAmb * uAmbientI * 1.7 + sunCol * 0.12);
    float fres = fresnel(max(dot(n, -vd), 0.0), 0.02);
    wcol = mix(wcol, mix(uSkyZenith, uSkyHorizon, 0.5) * (0.8 + 0.7 * ndl), fres);
    float spec = pow(max(dot(reflect(vd, n), lightDir), 0.0), 96.0);
    wcol += sunCol * spec * 1.5 * shadow;
    lit = mix(lit, wcol, isWater);
  }
  lit *= mix(1.0, 0.6, uWetness * clamp(1.0 - n.y * 0.5, 0.0, 1.0));

  // ---------------- aerial perspective ----------------
  vec3 vdir = normalize(p - camPos);
  float f = fogFactor(p);
  lit = mix(lit, fogColorAt(p, vdir), f);

  gl_FragColor = vec4(max(lit, vec3(0.0)), 1.0);
}
`;

// ---------------------------------------------------------------------------
// Clipmap renderer
// ---------------------------------------------------------------------------
const LEVELS = 6;
const RING = 6;               // tiles per side of each ring
const BASE_TILE = 384;        // metres (finest ring)

export class TerrainRenderer {
  constructor(renderer, field, opts = {}) {
    this.renderer = renderer;
    this.field = field;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    this.tiles = new Map();
    this.pending = [];
    this.geometries = [];
    this.materials = [];
    this.depthMaterials = [];
    this.detailScale = 1;
    this.maxDistance = 22000;
    this.createBudget = opts.createBudget || 4;
    this.textureArray = opts.textureArray || null;
    this.csmUniforms = opts.csmUniforms || {};
    this.tileCount = 0;
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
    this._buildResources();
  }

  _buildResources() {
    const RES = [48, 44, 40, 36, 32, 28];
    for (let l = 0; l < LEVELS; l++) {
      const seg = RES[l];
      this.geometries[l] = buildTileGeometry(seg);
      const uniforms = {
        uOrigin: { value: new THREE.Vector2() },
        uSize: { value: BASE_TILE * Math.pow(2, l) },
        uSeg: { value: seg },
        uDetailScale: { value: 1 },
        uTerrainTex: { value: this.textureArray },
        uAmbientUp: skyUniforms.ambientUp,
        uAmbientDown: skyUniforms.ambientDown,
        uAmbientI: skyUniforms.ambientIntensity,
        uSunCol: skyUniforms.sunColor,
        uSunI: skyUniforms.sunIntensity,
        uCloudShadow: skyUniforms.cloudShadowStrength,
        uSkyZenith: skyUniforms.skyZenith,
        uSkyHorizon: skyUniforms.skyHorizon,
        uWind: skyUniforms.windDir,
        uWetness: skyUniforms.wetness,
        uSnowLine: { value: 1400 },
        uStorm: skyUniforms.stormFactor,
        uTime: { value: 0 },
        ...fogUniforms(),
        ...WORLD_LIGHT_UNIFORMS,
        ...this.csmUniforms
      };
      this.materials[l] = new THREE.ShaderMaterial({
        vertexShader: TERRAIN_VS,
        fragmentShader: TERRAIN_FS,
        uniforms,
        side: THREE.FrontSide,
        fog: false
      });
      this.depthMaterials[l] = new THREE.ShaderMaterial({
        vertexShader: TERRAIN_DEPTH_VS,
        fragmentShader: TERRAIN_DEPTH_FS,
        uniforms: {
          uOrigin: { value: new THREE.Vector2() },
          uSize: { value: BASE_TILE * Math.pow(2, l) },
          uSeg: { value: seg }
        },
        side: THREE.FrontSide
      });
    }
  }

  setQuality(level, viewDistance) {
    this.maxDistance = viewDistance || [9000, 14000, 20000, 26000][clamp(level | 0, 0, 3)];
    this.detailScale = [0.55, 0.8, 1.0, 1.25][clamp(level | 0, 0, 3)];
    for (const m of this.materials) if (m) m.uniforms.uDetailScale.value = this.detailScale;
  }

  update(camera, gameTime = 0) {
    const camPos = camera.position;
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const frustum = this._frustum;
    const wanted = new Set();

    for (let l = 0; l < LEVELS; l++) {
      const tileSize = BASE_TILE * Math.pow(2, l);
      const half = RING / 2;
      const cx = Math.floor(camPos.x / tileSize);
      const cz = Math.floor(camPos.z / tileSize);
      // inner hole handled by the previous (finer) ring
      const innerR = l === 0 ? -1 : (RING / 2) * (tileSize * 0.5) * 1.05;
      for (let dz = -half; dz < half; dz++) {
        for (let dx = -half; dx < half; dx++) {
          const tx = cx + dx, tz = cz + dz;
          const x0 = tx * tileSize, z0 = tz * tileSize;
          const cxm = x0 + tileSize * 0.5, czm = z0 + tileSize * 0.5;
          const dist = Math.hypot(cxm - camPos.x, czm - camPos.z);
          if (dist > this.maxDistance + tileSize) continue;
          if (innerR > 0 && dist + tileSize * 0.71 < innerR) continue;
          const key = `${l}:${tx}:${tz}`;
          wanted.add(key);
          if (!this.tiles.has(key)) {
            if (this.pending.length < 600) this.pending.push({ l, tx, tz, x0, z0, tileSize, key, dist });
          }
        }
      }
    }
    // create tiles with a per-frame budget (spread the cost over frames)
    if (this.pending.length) {
      this.pending.sort((a, b) => a.dist - b.dist);
      let budget = this.createBudget;
      while (budget-- > 0 && this.pending.length) {
        const t = this.pending.shift();
        if (this.tiles.has(t.key)) continue;
        this._createTile(t.l, t.tx, t.tz, t.x0, t.z0, t.tileSize, t.key);
      }
    }
    // free stale tiles
    for (const [key, tile] of this.tiles) {
      if (!wanted.has(key)) {
        this.group.remove(tile.mesh);
        this.group.remove(tile.depth);
        this.tiles.delete(key);
      }
    }
    // visibility (manual frustum culling with real bounding spheres)
    let visible = 0;
    for (const tile of this.tiles.values()) {
      const c = tile.center;
      tile.sphere.center.set(c.x, (tile.hMin + tile.hMax) * 0.5, c.z);
      tile.sphere.radius = Math.max(tile.size * 0.75, (tile.hMax - tile.hMin) * 0.62 + tile.size * 0.5);
      const vis = frustum.intersectsSphere(tile.sphere) &&
        Math.hypot(c.x - camPos.x, c.z - camPos.z) < this.maxDistance + tile.size;
      tile.mesh.visible = vis;
      tile.depth.visible = vis && tile.level <= 3;
      if (vis) visible++;
    }
    for (let l = 0; l < LEVELS; l++) this.materials[l].uniforms.uTime.value = gameTime;
    this.tileCount = visible;
    return visible;
  }

  _createTile(level, tx, tz, x0, z0, size, key) {
    const field = this.field;
    let hMin = Infinity, hMax = -Infinity;
    const N = 3;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const h = field.heightAt(x0 + (i / N) * size, z0 + (j / N) * size);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
    if (!isFinite(hMin)) { hMin = 0; hMax = 100; }
    const mat = this.materials[level];
    const dmat = this.depthMaterials[level];
    const geo = this.geometries[level];

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    const setU = () => { mat.uniforms.uOrigin.value.set(x0, z0); };
    mesh.onBeforeRender = setU;
    mesh.userData.setUniforms = setU;

    const depth = new THREE.Mesh(geo, dmat);
    depth.frustumCulled = false;
    depth.matrixAutoUpdate = false;
    depth.layers.set(SHADOW_LAYER_TERRAIN);
    const setDU = () => { dmat.uniforms.uOrigin.value.set(x0, z0); };
    depth.onBeforeRender = setDU;
    depth.userData.setUniforms = setDU;
    depth.userData.shadowMaterial = dmat;
    depth.visible = false;

    const tile = {
      level, tx, tz, size, mesh, depth, hMin, hMax,
      center: new THREE.Vector3(x0 + size * 0.5, (hMin + hMax) * 0.5, z0 + size * 0.5),
      sphere: new THREE.Sphere(new THREE.Vector3(), size)
    };
    setU(); setDU();
    this.tiles.set(key, tile);
    this.group.add(mesh);
    this.group.add(depth);
    return tile;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.depthMaterials) m.dispose();
    this.tiles.clear();
  }
}
