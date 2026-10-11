// ---------------------------------------------------------------------------
// Scenery — procedural ground detail: forests, rocks, villages, roads' bridges,
// radio towers and naval ships.  Everything is instanced and recycled in cells
// around the player, so the world is effectively endless.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RNG, clamp, clamp01, smoothstep, lerp } from '../core/Utils.js';
import { makeConcreteTexture, makeMetalTexture, injectWorldShading, WORLD_LIGHT_UNIFORMS } from '../render/Shading.js';
import { SHADOW_LAYER_OBJECTS } from '../render/CascadedShadows.js';

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
export function mergeGeometries(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const u = g.attributes.uv ? g.attributes.uv.array : null;
    const c = g.attributes.position.count;
    pos.set(p, vo * 3);
    nrm.set(n, vo * 3);
    if (u) uv.set(u, vo * 2);
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < c; i++) idx[io + i] = i + vo;
      io += c;
    }
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

// ---------------------------------------------------------------------------
// Object factories
// ---------------------------------------------------------------------------
export function makeTreeGeometry(kind = 0, rng = new RNG(1)) {
  const parts = [];
  if (kind === 0) {          // conifer
    const trunk = new THREE.CylinderGeometry(0.7, 1.1, 6, 5, 1);
    trunk.translate(0, 3, 0);
    parts.push(trunk);
    for (let i = 0; i < 3; i++) {
      const r = 6.5 - i * 1.6;
      const c = new THREE.ConeGeometry(r, 9 - i * 1.2, 7, 1);
      c.translate(0, 8 + i * 5.2, 0);
      parts.push(c);
    }
  } else {                   // broadleaf
    const trunk = new THREE.CylinderGeometry(0.8, 1.3, 7.5, 5, 1);
    trunk.translate(0, 3.7, 0);
    parts.push(trunk);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.IcosahedronGeometry(4.4 - i * 0.55, 0);
      s.translate(rng.float(-2, 2), 9 + i * 2.6, rng.float(-2, 2));
      parts.push(s);
    }
  }
  return mergeGeometries(parts);
}

export function makeRockGeometry(rng = new RNG(2)) {
  const g = new THREE.IcosahedronGeometry(3, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.6 + rng.float(0, 0.9);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

export function makeBuildingGeometry(rng = new RNG(3), style = 0) {
  const w = rng.float(7, 14), d = rng.float(7, 14), h = rng.float(5, 14);
  const parts = [box(w, h, d, 0, h / 2, 0)];
  if (style === 0) {
    parts.push(box(w * 1.12, 0.6, d * 1.12, 0, h + 0.3, 0));   // flat roof lip
    parts.push(box(w * 0.2, 2.4, d * 0.2, 0, h + 1.6, 0));      // roof hut
  } else if (style === 1) {                                      // pitched roof
    const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.78, 3.4, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.translate(0, h + 1.7, 0);
    parts.push(roof);
  } else {                                                        // hangar
    const roof = new THREE.CylinderGeometry(w * 0.5, w * 0.5, d, 12, 1, false, 0, Math.PI);
    roof.rotateZ(Math.PI / 2);
    roof.rotateY(Math.PI / 2);
    roof.translate(0, h, 0);
    parts.push(roof);
  }
  return mergeGeometries(parts);
}

export function makeTowerGeometry() {
  const parts = [];
  const H = 46;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 2.4, z = Math.sin(a) * 2.4;
    const leg = new THREE.CylinderGeometry(0.22, 0.34, H, 4, 1);
    leg.rotateX(Math.cos(a) * 0.03);
    leg.rotateZ(-Math.sin(a) * 0.03);
    leg.translate(x, H / 2, z);
    parts.push(leg);
  }
  for (let i = 0; i < 8; i++) {
    const y = 4 + i * (H / 9);
    const r = 2.4 * (1 - i * 0.06);
    const ring = new THREE.TorusGeometry(r, 0.09, 3, 8);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }
  const dish = new THREE.CylinderGeometry(3.4, 3.4, 0.5, 12, 1, true);
  dish.translate(0, H - 2, 0);
  parts.push(dish);
  parts.push(new THREE.CylinderGeometry(0.09, 0.09, 14, 4).translate(0, H + 6, 0));
  return mergeGeometries(parts);
}

export function makeBridgeGeometry(span = 60, width = 10) {
  const parts = [];
  const deckH = 1.2;
  parts.push(box(span, deckH, width, 0, 0, 0));
  for (let i = -1; i <= 1; i += 2) {
    parts.push(box(span, 2.2, 0.6, 0, 1.7, i * width * 0.5));
  }
  const pylons = 3;
  for (let i = 0; i < pylons; i++) {
    const x = -span / 2 + (span / (pylons - 1)) * i;
    for (let s = -1; s <= 1; s += 2) {
      const p = new THREE.CylinderGeometry(0.9, 1.3, 22, 6, 1);
      p.translate(x, -11, s * width * 0.45);
      parts.push(p);
    }
  }
  return mergeGeometries(parts);
}

export function makeShipGeometry(rng = new RNG(9), kind = 'destroyer') {
  const parts = [];
  const L = kind === 'carrier' ? 330 : 155;
  const W = kind === 'carrier' ? 78 : 20;
  parts.push(box(L, 12, W, 0, 2, 0));
  const bow = new THREE.CylinderGeometry(W * 0.5, W * 0.5, 12, 8, 1, false, 0, Math.PI);
  bow.rotateZ(Math.PI / 2); bow.rotateY(Math.PI / 2);
  bow.translate(L / 2, 2, 0);
  parts.push(bow);
  if (kind === 'carrier') {
    parts.push(box(L * 0.98, 1.6, W * 1.25, 0, 9, 0));
    parts.push(box(66, 26, 22, L * 0.06, 20, -W * 0.28));    // island
    parts.push(box(4, 16, 4, L * 0.06, 34, -W * 0.28));
  } else {
    parts.push(box(46, 22, W * 0.8, -8, 18, 0));            // superstructure
    parts.push(box(16, 34, 14, -8, 26, 0));
    parts.push(new THREE.CylinderGeometry(0.4, 0.4, 22, 4).translate(2, 30, 0));
    for (let i = 0; i < 2; i++) {
      parts.push(box(18, 6, 6, L * 0.22 + i * 22, 32, 0));   // launchers
    }
    const turret = new THREE.CylinderGeometry(7, 8.5, 7, 8);
    turret.translate(-L * 0.32, 12, 0);
    parts.push(turret);
    parts.push(box(26, 1.6, 1.6, -L * 0.32 + 10, 14, 0));
  }
  return mergeGeometries(parts);
}

export function makeRadarStationGeometry() {
  const parts = [];
  parts.push(box(12, 4, 9, 0, 2, 0));
  parts.push(box(3, 12, 3, 0, 9, 0));
  const dish = new THREE.CylinderGeometry(6.5, 6.5, 0.8, 14, 1, true);
  dish.rotateX(Math.PI / 2.6);
  dish.translate(0, 16, 1.4);
  parts.push(dish);
  parts.push(new THREE.CylinderGeometry(0.5, 0.5, 7, 5).translate(0, 12, 0));
  return mergeGeometries(parts);
}

export function makeSAMLauncherGeometry() {
  const parts = [];
  parts.push(box(14, 3.4, 6, 0, 1.7, 0));
  for (let i = 0; i < 4; i++) {
    const t = new THREE.CylinderGeometry(0.55, 0.55, 7.5, 7);
    t.rotateZ(Math.PI / 2 - 0.35);
    t.translate(-1.5 + (i % 2) * 3, 4.6, -1.2 + Math.floor(i / 2) * 2.4);
    parts.push(t);
  }
  parts.push(box(7, 5, 5, 5.5, 4.5, 0));    // radar/EO director
  return mergeGeometries(parts);
}

export function makeAAGunGeometry() {
  const parts = [];
  parts.push(new THREE.CylinderGeometry(2.4, 3.2, 1.6, 8).translate(0, 0.8, 0));
  parts.push(new THREE.CylinderGeometry(1.7, 1.9, 2.2, 8).translate(0, 2.6, 0));
  for (let i = 0; i < 2; i++) {
    const b = new THREE.CylinderGeometry(0.22, 0.22, 6, 6);
    b.rotateX(Math.PI / 2 - 0.5);
    b.translate(i ? 0.8 : -0.8, 4.2, 1.8);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

export function makeDepotGeometry(rng = new RNG(11), count = 6) {
  const parts = [];
  const R = 40;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = R * rng.float(0.35, 1.0);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const cyl = new THREE.CylinderGeometry(7, 7, 11, 12);
    cyl.translate(x, 5.5, z);
    parts.push(cyl);
    const cap = new THREE.CylinderGeometry(7.2, 7.2, 0.6, 12);
    cap.translate(x, 11.2, z);
    parts.push(cap);
  }
  parts.push(box(30, 6, 16, 0, 3, R * 1.1, 0.4));
  return mergeGeometries(parts);
}

export function makeFuelTankGeometry(r = 9, h = 14) {
  const parts = [new THREE.CylinderGeometry(r, r, h, 14).translate(0, h / 2, 0)];
  const cap = new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, h, 0);
  parts.push(cap);
  return mergeGeometries(parts);
}

export function makeRunwayGeometry(length = 2200, width = 55) {
  const parts = [box(length, 0.4, width, 0, 0.2, 0)];
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// ScatterField — instanced objects recycled in cells around the camera
// ---------------------------------------------------------------------------
export class ScatterField {
  constructor(opts) {
    this.group = opts.group || new THREE.Group();
    this.cellSize = opts.cellSize || 300;
    this.radius = opts.radius || 6;               // cells
    this.capacity = opts.capacity || 4000;
    this.geometry = opts.geometry;
    this.material = opts.material;
    this.generate = opts.generate;                 // (cx, cz, out: []) => void
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.layers.enable(SHADOW_LAYER_OBJECTS);
    this.mesh.castShadow = false;
    this.mesh.userData.shadowMaterial = null;
    this.group.add(this.mesh);
    this.cells = new Map();
    this._lastCX = 1e9; this._lastCZ = 1e9;
    this._items = [];
    this._color = new THREE.Color();
    this.hasColor = opts.color === true;
    if (this.hasColor) {
      const colors = new Float32Array(this.capacity * 3).fill(1);
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    }
    this.visible = true;
  }

  update(cameraPos, field, force = false) {
    const cx = Math.floor(cameraPos.x / this.cellSize);
    const cz = Math.floor(cameraPos.z / this.cellSize);
    if (!force && cx === this._lastCX && cz === this._lastCZ) return false;
    this._lastCX = cx; this._lastCZ = cz;
    const R = this.radius;
    const wanted = new Set();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R + 1) continue;
        const gx = cx + dx, gz = cz + dz;
        const key = gx + ':' + gz;
        wanted.add(key);
        if (!this.cells.has(key)) {
          const out = [];
          this.generate(gx, gz, out);
          this.cells.set(key, out);
        }
      }
    }
    for (const key of Array.from(this.cells.keys())) if (!wanted.has(key)) this.cells.delete(key);
    // rebuild instance arrays from the active cells
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    let n = 0;
    for (const key of this.cells.keys()) {
      const items = this.cells.get(key);
      for (const it of items) {
        if (n >= this.capacity) break;
        p.set(it.x, it.y, it.z);
        e.set(it.rx || 0, it.ry || 0, it.rz || 0);
        q.setFromEuler(e);
        s.set(it.sx || it.s, it.sy || it.s, it.sz || it.s);
        m.compose(p, q, s);
        this.mesh.setMatrixAt(n, m);
        if (this.hasColor) {
          const c = it.color || 1;
          if (typeof c === 'number') this._color.setRGB(c, c, c);
          else this._color.setRGB(c[0], c[1], c[2]);
          this.mesh.setColorAt(n, this._color);
        }
        n++;
      }
      if (n >= this.capacity) break;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.hasColor && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.count = n;
    return true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Scenery manager
// ---------------------------------------------------------------------------
export class Scenery {
  constructor(field, opts = {}) {
    this.field = field;
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    this.rng = new RNG(opts.seed || 5150);
    this.counts = { trees: 0, rocks: 0, buildings: 0, towers: 0, bridges: 0 };
    this.fields_ = [];
    this._initMaterials();
    this._initFields(opts.quality || 2);
  }

  _initMaterials() {
    this.concrete = makeConcreteTexture(256);
    this.metal = makeMetalTexture(256);
    const treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.0, flatShading: true
    });
    this.treeMat = treeMat;
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x8a8378, roughness: 0.95, metalness: 0.02, flatShading: true
    });
    this.rockMat = rockMat;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2c6, roughness: 0.85, metalness: 0.05, vertexColors: true
    });
    if (this.concrete) {
      wallMat.map = this.concrete;
      wallMat.map.repeat.set(0.4, 0.4);
    }
    this.wallMat = wallMat;
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0xc8ccd2, roughness: 0.55, metalness: 0.75, vertexColors: true
    });
    if (this.metal) metalMat.map = this.metal;
    this.metalMat = metalMat;
  }

  _initFields(quality) {
    const q = clamp(quality, 0, 3);
    const trees = clamp(q, 0, 3);
    // ---- trees
    this.treeGeoConifer = makeTreeGeometry(0, this.rng);
    this.treeGeoBroad = makeTreeGeometry(1, this.rng);
    this.treeField = new ScatterField({
      group: this.group, cellSize: 340, radius: [3, 5, 7, 9][trees],
      capacity: [900, 1800, 3000, 4200][trees],
      geometry: this.treeGeoConifer, material: this.treeMat, color: true,
      generate: (cx, cz, out) => this._genTrees(cx, cz, out)
    });
    this.treeField2 = new ScatterField({
      group: this.group, cellSize: 340, radius: [3, 5, 7, 9][trees],
      capacity: [500, 900, 1500, 2100][trees],
      geometry: this.treeGeoBroad, material: this.treeMat, color: true,
      generate: (cx, cz, out) => this._genTrees2(cx, cz, out)
    });
    // ---- rocks
    this.rockGeo = makeRockGeometry(this.rng);
    this.rockField = new ScatterField({
      group: this.group, cellSize: 520, radius: [3, 5, 6, 7][trees],
      capacity: [200, 400, 700, 1000][trees],
      geometry: this.rockGeo, material: this.rockMat,
      generate: (cx, cz, out) => this._genRocks(cx, cz, out)
    });
    // ---- villages
    this.buildingGeo = makeBuildingGeometry(this.rng, 0);
    this.roofGeo = makeBuildingGeometry(this.rng, 1);
    this.hangarGeo = makeBuildingGeometry(this.rng, 2);
    this.villageField = new ScatterField({
      group: this.group, cellSize: 1400, radius: [2, 3, 4, 4][trees],
      capacity: [120, 260, 420, 600][trees],
      geometry: this.buildingGeo, material: this.wallMat, color: true,
      generate: (cx, cz, out) => this._genVillage(cx, cz, out)
    });
    // ---- towers
    this.towerGeo = makeTowerGeometry();
    this.towerField = new ScatterField({
      group: this.group, cellSize: 2600, radius: [2, 3, 4, 5][trees],
      capacity: 60,
      geometry: this.towerGeo, material: this.metalMat,
      generate: (cx, cz, out) => this._genTowers(cx, cz, out)
    });
    // ---- bridges
    this.bridgeGeo = makeBridgeGeometry(70, 11);
    this.bridgeField = new ScatterField({
      group: this.group, cellSize: 2200, radius: [2, 3, 4, 5][trees],
      capacity: 80,
      geometry: this.bridgeGeo, material: this.wallMat, color: true,
      generate: (cx, cz, out) => this._genBridges(cx, cz, out)
    });
    this.fields_ = [this.treeField, this.treeField2, this.rockField, this.villageField, this.towerField, this.bridgeField];
    // materials need CSM injection
    for (const mat of [this.treeMat, this.rockMat, this.wallMat, this.metalMat]) {
      mat.userData = mat.userData || {};
    }
  }

  injectShading(csmUniforms) {
    for (const mat of [this.treeMat, this.rockMat, this.wallMat, this.metalMat]) {
      injectWorldShading(mat, { ...csmUniforms, ...WORLD_LIGHT_UNIFORMS });
    }
  }

  update(cameraPos) {
    let changed = false;
    for (const f of this.fields_) changed = f.update(cameraPos, this.field) || changed;
    this.counts.trees = (this.treeField.mesh.count || 0) + (this.treeField2.mesh.count || 0);
    this.counts.rocks = this.rockField.mesh.count || 0;
    this.counts.buildings = this.villageField.mesh.count || 0;
    this.counts.towers = this.towerField.mesh.count || 0;
    this.counts.bridges = this.bridgeField.mesh.count || 0;
    return changed;
  }

  // ---- generators -------------------------------------------------------
  _genTrees(cx, cz, out) {
    const rng = new RNG(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const cell = this.treeField.cellSize;
    const x0 = cx * cell, z0 = cz * cell;
    const step = 22;
    const n = Math.floor(cell / step);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = x0 + i * step + rng.float(0, step);
        const z = z0 + j * step + rng.float(0, step);
        const h = this.field.heightAt(x, z);
        if (h < 4 || h > 1500) continue;
        const nrm = this.field.normalAt(x, z, 30);
        if (1 - nrm.y > 0.5) continue;
        const forest = this.field.noise.fbm2(x * 0.00035 + 91, z * 0.00035 - 12, 3);
        const density = smoothstep(-0.1, 0.45, forest);
        if (rng.next() > density * 0.75) continue;
        const scale = rng.float(0.7, 1.5);
        const green = 0.7 + rng.float(0, 0.5);
        out.push({
          x, y: h - 0.4, z, s: scale, ry: rng.float(0, Math.PI * 2),
          color: [0.80 * green, 0.95 * green, 0.72 * green]
        });
      }
    }
  }

  _genTrees2(cx, cz, out) {
    const rng = new RNG(((cx * 83492791) ^ (cz * 29846731)) >>> 0);
    const cell = this.treeField2.cellSize;
    const x0 = cx * cell, z0 = cz * cell;
    const step = 30;
    const n = Math.floor(cell / step);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = x0 + i * step + rng.float(0, step);
        const z = z0 + j * step + rng.float(0, step);
        const h = this.field.heightAt(x, z);
        if (h < 3 || h > 1100) continue;
        const nrm = this.field.normalAt(x, z, 30);
        if (1 - nrm.y > 0.45) continue;
        const forest = this.field.noise.fbm2(x * 0.00028 - 45, z * 0.00028 + 77, 3);
        if (rng.next() > smoothstep(-0.15, 0.4, forest) * 0.55) continue;
        const scale = rng.float(0.75, 1.5);
        const green = 0.75 + rng.float(0, 0.45);
        out.push({
          x, y: h - 0.4, z, s: scale, ry: rng.float(0, Math.PI * 2),
          color: [0.95 * green, 0.92 * green, 0.6 * green]
        });
      }
    }
  }

  _genRocks(cx, cz, out) {
    const rng = new RNG(((cx * 1274126177) ^ (cz * 374761393)) >>> 0);
    const cell = this.rockField.cellSize;
    const x0 = cx * cell, z0 = cz * cell;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const x = x0 + rng.float(0, cell), z = z0 + rng.float(0, cell);
      const h = this.field.heightAt(x, z);
      const nrm = this.field.normalAt(x, z, 25);
      const slope = 1 - nrm.y;
      if (slope < 0.12 && rng.next() > 0.3) continue;
      out.push({
        x, y: h - 0.6, z, s: rng.float(0.5, 2.6),
        rx: rng.float(-0.3, 0.3), ry: rng.float(0, Math.PI * 2), rz: rng.float(-0.3, 0.3)
      });
    }
  }

  _genVillage(cx, cz, out) {
    const rng = new RNG(((cx * 668265263) ^ (cz * 2246822519)) >>> 0);
    const cell = this.villageField.cellSize;
    const x0 = cx * cell, z0 = cz * cell;
    const cxw = x0 + cell * 0.5, czw = z0 + cell * 0.5;
    if (!this.field.isFlatGround(cxw, czw, 0.10, 8, 700)) return;
    // avoid water & steep rivers, favour being near a river
    const riverNear = Math.abs(this.field.riverField(cxw, czw));
    if (riverNear < 26) return;
    const biome = this.field.biomeAt(cxw, czw);
    if (biome === 'ocean' || biome === 'snow') return;
    const count = rng.int(5, 14);
    for (let i = 0; i < count; i++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(12, 190);
      const x = cxw + Math.cos(a) * r, z = czw + Math.sin(a) * r;
      const h = this.field.heightAt(x, z);
      if (h < 6) continue;
      const nrm = this.field.normalAt(x, z, 18);
      if (1 - nrm.y > 0.16) continue;
      const tone = rng.float(0.62, 1.0);
      out.push({
        x, y: h - 0.2, z, s: rng.float(0.75, 1.3), ry: rng.float(0, Math.PI * 2),
        color: [tone * 0.95, tone * 0.93, tone * 0.88]
      });
    }
  }

  _genTowers(cx, cz, out) {
    const rng = new RNG(((cx * 2246822519) ^ (cz * 3266489917)) >>> 0);
    const cell = this.towerField.cellSize;
    const x0 = cx * cell, z0 = cz * cell;
    const n = 2;
    for (let i = 0; i < n; i++) {
      if (rng.next() > 0.42) continue;
      const x = x0 + rng.float(0, cell), z = z0 + rng.float(0, cell);
      if (!this.field.isFlatGround(x, z, 0.13, 10, 900)) continue;
      const h = this.field.heightAt(x, z);
      out.push({ x, y: h - 1, z, s: rng.float(0.8, 1.4), ry: rng.float(0, 6.28) });
    }
  }

  _genBridges(cx, cz, out) {
    const rng = new RNG(((cx * 374761393) ^ (cz * 1168571521)) >>> 0);
    const cell = this.bridgeField.cellSize;
    const x0 = cx * cell, z0 = cz * cell;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const x = x0 + rng.float(0, cell), z = z0 + rng.float(0, cell);
      const r = Math.abs(this.field.riverField(x, z));
      if (r > 12) continue;
      const h = this.field.heightAt(x, z);
      if (h < 6 || h > 500) continue;
      out.push({ x, y: h + 4.5, z, s: rng.float(0.85, 1.2), ry: rng.float(0, Math.PI) });
    }
  }

  dispose() {
    for (const f of this.fields_) f.dispose();
    this.treeGeoConifer.dispose(); this.treeGeoBroad.dispose(); this.rockGeo.dispose();
    this.buildingGeo.dispose(); this.roofGeo.dispose(); this.hangarGeo.dispose();
    this.towerGeo.dispose(); this.bridgeGeo.dispose();
  }
}
