// Procedural heightmap terrain: multiple biomes, canyons, mountains, coast.
// Chunks are generated on demand with level-of-detail; no mesh or heightmap is stored.
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { fbm2, ridged2, smoothstep, clamp, lerp } from '../core/noise.js';
import { WORLD_HALF, CANYON, buildPads, SITES, AIRFIELD } from './layout.js';

const SEED = 1337;
export const CHUNK = 500;
export const CHUNK_COUNT = (WORLD_HALF * 2) / CHUNK; // 16
const LOD_SEGS = [64, 32, 16, 8];

// Distance from point to polyline segment.
function distSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export class Terrain {
  constructor(scene, csm, opts = {}) {
    this.scene = scene;
    this.csm = csm;
    this.detail = opts.detail ?? 1;               // 0..3 quality
    this.drawDist = opts.drawDistance ?? 1;       // multiplier for LOD ranges
    this.segScale = [0.5, 0.75, 1, 1.25][this.detail] ?? 1;
    this.pads = buildPads((x, z) => this.rawHeight(x, z));
    this.canyonSegs = [];
    const pts = CANYON.points;
    for (let i = 0; i < pts.length - 1; i++) this.canyonSegs.push([...pts[i], ...pts[i + 1]]);
    this.chunks = new Map();
    this.buildQueue = [];
    this.material = this.createMaterial();
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
  }

  // ---- Height function -----------------------------------------------------
  rawHeight(x, z) {
    const r = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
    const cont = fbm2(x * 0.00055 + 17, z * 0.00055 - 9, 5, SEED);
    let h = cont * 420 + 40;
    // Mountain ranges: ridged noise masked by a low-frequency mountain mask.
    const mtn = smoothstep(0.05, 0.35, fbm2(x * 0.00038 - 30, z * 0.00038 + 12, 3, SEED + 5) + 0.15);
    const ridge = ridged2(x * 0.0011, z * 0.0011, 5, SEED + 9);
    h += mtn * Math.pow(ridge * 0.5 + 0.5, 2) * 1150;
    // Rolling hills.
    h += fbm2(x * 0.004, z * 0.004, 3, SEED + 3) * 40;
    // Broad valleys (river valleys follow where a band of noise crosses zero).
    const band = Math.abs(fbm2(x * 0.0009 + 5, z * 0.0009 - 7, 3, SEED + 21));
    h -= 70 * Math.exp(-(band * band) / 0.0016) * (1 - mtn);
    // Desert canyon country in the south-west.
    const desert = smoothstep(0.08, 0.32, fbm2(x * 0.0005 - 80, z * 0.0005 + 40, 3, SEED + 31));
    const canyonLines = 1 - Math.abs(fbm2(x * 0.0016 + 3, z * 0.0016 + 3, 3, SEED + 37)) * 3.4;
    h -= 160 * desert * Math.pow(clamp(canyonLines, 0, 1), 3);
    // Coast: edges of the square sink under the sea.
    const edge = smoothstep(0.80, 0.98, r);
    h = lerp(h, -90, edge);
    // Lowlands near sea level become beaches.
    return h;
  }

  heightAt(x, z) {
    let h = this.rawHeight(x, z);
    // Canyon carve.
    for (const c of this.canyonSegs) {
      const d = distSeg(x, z, c[0], c[1], c[2], c[3]);
      const W = CANYON.width;
      if (d < W) {
        const w = 1 - smoothstep(W * 0.35, W, d);
        const floor = Math.max(h - CANYON.depth, 4);
        h = lerp(h, Math.min(h, floor + d * 0.2), w);
      }
    }
    // Flatten pads (airfield, sites, villages).
    for (const p of this.pads) {
      let dist;
      if (p.kind === 'rect') {
        const dx = Math.abs(x - p.x) - p.hx, dz = Math.abs(z - p.z) - p.hz;
        dist = Math.max(dx, dz);
      } else {
        dist = Math.hypot(x - p.x, z - p.z) - p.r;
      }
      if (dist < p.blend) {
        const w = 1 - smoothstep(0, p.blend, dist);
        h = lerp(h, p.h, w);
      }
    }
    return h;
  }

  // Biome at a point: returns a label and a vertex tint.
  biomeAt(x, z, h) {
    const moist = fbm2(x * 0.0007 + 101, z * 0.0007 + 7, 3, SEED + 40) * 0.5 + 0.5;
    const r = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
    if (h < 14 && r < 0.75 && moist > 0.45) return 'tropical';
    if (h > 880) return 'snow';
    if (h > 620) return 'mountain';
    if (moist < 0.36 && h < 260) return 'desert';
    if (moist > 0.55 && h > 30) return 'forest';
    return 'valley';
  }

  // ---- Chunk meshes --------------------------------------------------------
  createMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    if (this.csm) this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      if (csmHook) csmHook(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 layers;
          varying vec4 vLayers;
          varying vec3 vTriWorld;
          varying vec3 vTriNormal;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 twp = modelMatrix * vec4(transformed, 1.0);
          vTriWorld = twp.xyz;
          vTriNormal = normalize(mat3(modelMatrix) * objectNormal);
          vLayers = layers;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vLayers;
          varying vec3 vTriWorld;
          varying vec3 vTriNormal;
          float tHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float tNoise(vec2 p){
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1,0)), f.x), mix(tHash(i + vec2(0,1)), tHash(i + vec2(1,1)), f.x), f.y);
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // Triplanar detail: three planar noise samples blended by the world normal.
            vec3 bw = pow(abs(normalize(vTriNormal)), vec3(4.0));
            bw /= (bw.x + bw.y + bw.z);
            float nXY = tNoise(vTriWorld.xy * 0.09), nYZ = tNoise(vTriWorld.yz * 0.09), nXZ = tNoise(vTriWorld.xz * 0.09);
            float detail = nXY * bw.z + nYZ * bw.x + nXZ * bw.y;
            float fine = tNoise(vTriWorld.xz * 0.6) * 0.5 + 0.5;
            vec3 grass = mix(vec3(0.20, 0.40, 0.12), vec3(0.34, 0.50, 0.18), detail);
            vec3 rock  = mix(vec3(0.38, 0.35, 0.33), vec3(0.55, 0.52, 0.49), fine);
            vec3 sand  = mix(vec3(0.76, 0.66, 0.44), vec3(0.86, 0.78, 0.56), detail);
            vec3 snow  = mix(vec3(0.88, 0.92, 0.96), vec3(1.0, 1.0, 1.0), fine);
            float wsum = max(vLayers.x + vLayers.y + vLayers.z + vLayers.w, 1e-3);
            vec3 layerCol = (grass * vLayers.x + rock * vLayers.y + sand * vLayers.z + snow * vLayers.w) / wsum;
            diffuseColor.rgb = layerCol * vColor.rgb * 1.6;
          }`);
    };
    mat.customProgramCacheKey = () => 'terrain-triplanar-v1';
    return mat;
  }

  buildChunkGeometry(cx, cz, lod) {
    const baseSeg = Math.max(4, Math.round(LOD_SEGS[lod] * this.segScale));
    const seg = baseSeg;
    const size = CHUNK;
    const x0 = -WORLD_HALF + cx * CHUNK;
    const z0 = -WORLD_HALF + cz * CHUNK;
    const n = seg + 1;
    const pos = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const layers = new Float32Array(n * n * 4);
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + (i / seg) * size;
        const z = z0 + (j / seg) * size;
        const h = this.heightAt(x, z);
        const k = j * n + i;
        heights[k] = h;
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      }
    }
    // Normals from the grid (cheap) for slope-based layer weights.
    const normals = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const il = Math.max(0, i - 1), ir = Math.min(n - 1, i + 1);
        const jd = Math.max(0, j - 1), ju = Math.min(n - 1, j + 1);
        const dx = (heights[j * n + ir] - heights[j * n + il]) / ((ir - il) * (size / seg) || 1);
        const dz = (heights[ju * n + i] - heights[jd * n + i]) / ((ju - jd) * (size / seg) || 1);
        const len = Math.hypot(dx, 1, dz);
        const k = j * n + i;
        normals[k * 3] = -dx / len; normals[k * 3 + 1] = 1 / len; normals[k * 3 + 2] = -dz / len;
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const h = heights[k];
        const x = pos[k * 3], z = pos[k * 3 + 2];
        const slope = 1 - normals[k * 3 + 1];
        const biome = this.biomeAt(x, z, h);
        const c = BIOME_TINT[biome];
        colors[k * 3] = c[0]; colors[k * 3 + 1] = c[1]; colors[k * 3 + 2] = c[2];
        const rock = smoothstep(0.18, 0.42, slope) + smoothstep(560, 760, h) * 0.6;
        const snow = smoothstep(820, 960, h + slope * 120);
        const sand = smoothstep(7, 1, h) * (1 - snow) * (biome === 'desert' ? 1.4 : 1);
        const grass = Math.max(0, 1 - rock - snow - sand);
        layers[k * 4] = grass; layers[k * 4 + 1] = clamp(rock, 0, 1);
        layers[k * 4 + 2] = clamp(sand, 0, 1); layers[k * 4 + 3] = snow;
      }
    }
    // Index buffer plus a skirt that hides cracks between LOD levels.
    const idx = [];
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c2 = a + n, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
    const skirtStart = n * n;
    const skirtPos = [], skirtCol = [], skirtLay = [];
    const edge = (i, j) => j * n + i;
    const addSkirt = (ids) => {
      for (const k of ids) {
        skirtPos.push(pos[k * 3], pos[k * 3 + 1] - 60, pos[k * 3 + 2]);
        skirtCol.push(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2]);
        skirtLay.push(layers[k * 4], layers[k * 4 + 1], layers[k * 4 + 2], layers[k * 4 + 3]);
      }
    };
    const edges = [];
    for (let i = 0; i < n; i++) edges.push(edge(i, 0));
    for (let i = 0; i < n; i++) edges.push(edge(i, n - 1));
    for (let j = 0; j < n; j++) edges.push(edge(0, j));
    for (let j = 0; j < n; j++) edges.push(edge(n - 1, j));
    addSkirt(edges);
    const m = edges.length;
    // Skirt quads connect each edge vertex with its dropped twin (both sides of each edge).
    const allPos = new Float32Array((n * n + m) * 3);
    allPos.set(pos, 0);
    allPos.set(skirtPos, n * n * 3);
    const allCol = new Float32Array((n * n + m) * 3);
    allCol.set(colors, 0);
    allCol.set(skirtCol, n * n * 3);
    const allLay = new Float32Array((n * n + m) * 4);
    allLay.set(layers, 0);
    allLay.set(skirtLay, n * n * 4);
    // Map each edge id to its skirt twin; skirt twin index = skirtStart + e.
    for (let e = 0; e < m - 1; e++) {
      const a = edges[e], b = edges[e + 1];
      // Only connect neighbours that are adjacent along the same border.
      if (Math.abs(a - b) !== 1 && Math.abs(a - b) !== n) continue;
      const ta = skirtStart + e, tb = skirtStart + e + 1;
      idx.push(a, b, ta, b, tb, ta);
      idx.push(a, ta, b, b, ta, tb);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(allCol, 3));
    geo.setAttribute('layers', new THREE.BufferAttribute(allLay, 4));
    const nrm = new Float32Array((n * n + m) * 3);
    nrm.set(normals, 0);
    for (let e = 0; e < m; e++) {
      const k = edges[e];
      nrm[(n * n + e) * 3] = normals[k * 3]; nrm[(n * n + e) * 3 + 1] = normals[k * 3 + 1]; nrm[(n * n + e) * 3 + 2] = normals[k * 3 + 2];
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  lodForDistance(d) {
    const s = this.drawDist;
    if (d < 1400 * s) return 0;
    if (d < 2800 * s) return 1;
    if (d < 5200 * s) return 2;
    return 3;
  }

  // Called each frame: picks LOD per chunk, builds a few chunks per frame.
  update(camPos, budget = 3) {
    const want = [];
    for (let cz = 0; cz < CHUNK_COUNT; cz++) for (let cx = 0; cx < CHUNK_COUNT; cx++) {
      const cxw = -WORLD_HALF + cx * CHUNK + CHUNK / 2;
      const czw = -WORLD_HALF + cz * CHUNK + CHUNK / 2;
      const d = Math.hypot(cxw - camPos.x, czw - camPos.z);
      want.push({ cx, cz, d, lod: this.lodForDistance(d) });
    }
    let built = 0;
    for (const w of want) {
      const key = w.cx + ',' + w.cz;
      let entry = this.chunks.get(key);
      if (!entry) {
        entry = { meshes: [null, null, null, null], lod: -1 };
        this.chunks.set(key, entry);
      }
      // Build the wanted LOD within the frame budget; keep the previous LOD until then.
      if (!entry.meshes[w.lod]) {
        if (built >= budget && entry.lod >= 0) continue;
        const geo = this.buildChunkGeometry(w.cx, w.cz, w.lod);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.castShadow = w.lod <= 1 && !!this.csm && this.detail > 0;
        mesh.receiveShadow = true;
        entry.meshes[w.lod] = mesh;
        built++;
      }
      if (entry.lod !== w.lod) {
        if (entry.lod >= 0) this.group.remove(entry.meshes[entry.lod]);
        this.group.add(entry.meshes[w.lod]);
        entry.lod = w.lod;
      }
    }
    return built;
  }

  // Ground height used for collision and placement.
  groundAt(x, z) { return this.heightAt(x, z); }

  dispose() {
    for (const e of this.chunks.values()) for (const m of e.meshes) if (m) m.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

// Tints multiplied with the layer blend. Biome feel comes from these.
const BIOME_TINT = {
  valley: [1.0, 1.05, 0.95],
  forest: [0.78, 0.92, 0.72],
  desert: [1.25, 1.02, 0.78],
  tropical: [0.9, 1.15, 1.0],
  mountain: [0.92, 0.92, 0.95],
  snow: [1.0, 1.0, 1.0],
};

export { SITES, AIRFIELD };
