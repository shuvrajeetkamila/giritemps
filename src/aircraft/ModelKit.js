// ---------------------------------------------------------------------------
// ModelKit — procedural lofting primitives used to build every aircraft.
// Convention: nose along +Z, up +Y, right +X (matches the flight model).
// ---------------------------------------------------------------------------
import * as THREE from 'three';

/** Superellipse cross-section point (rounded rectangle / lifting body). */
function sectionPoint(w, h, p, t) {
  const a = t * Math.PI * 2;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = Math.sign(c) * Math.pow(Math.abs(c), p) * w;
  const dy = Math.sign(s) * Math.pow(Math.abs(s), p) * h;
  return [dx, dy];
}

/**
 * Loft a closed body through a list of stations.
 * station = { z, w, h, cx, cy, p, taper }
 */
export function loft(stations, radial = 14, opts = {}) {
  const rings = [];
  const n = radial;
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    const ring = [];
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const [dx, dy] = sectionPoint(st.w, st.h, st.p !== undefined ? st.p : 0.62, t);
      ring.push(new THREE.Vector3((st.cx || 0) + dx, (st.cy || 0) + dy, st.z));
    }
    rings.push(ring);
  }
  const positions = [];
  const indices = [];
  const uvs = [];
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j < n; j++) {
      const p = rings[i][j];
      positions.push(p.x, p.y, p.z);
      uvs.push(j / n, i / (rings.length - 1));
    }
  }
  const rIdx = (i, j) => i * n + (j % n);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = rIdx(i, j), b = rIdx(i, j + 1), c = rIdx(i + 1, j), d = rIdx(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  // caps
  const addCap = (ringIndex, flip) => {
    const base = positions.length / 3;
    let cx = 0, cy = 0, cz = stations[ringIndex].z;
    positions.push(cx, cy, cz); uvs.push(0.5, 0.5);
    for (let j = 0; j < n; j++) {
      const p = rings[ringIndex][j];
      positions.push(p.x, p.y, p.z);
      uvs.push(j / n, 0.5);
    }
    for (let j = 0; j < n; j++) {
      const a = base, b = base + 1 + j, c = base + 1 + ((j + 1) % n);
      if (flip) indices.push(a, c, b); else indices.push(a, b, c);
    }
  };
  if (opts.capFront !== false) addCap(stations.length - 1, false);
  if (opts.capBack !== false) addCap(0, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a wing / tail surface.
 * spec = { rootX, rootZ, rootChord, tipX, tipZ, tipChord, thickness,
 *          sweep, dihedral, segments, taper }
 */
export function wingSurface(spec) {
  const seg = spec.segments || 6;
  const positions = [], uvs = [], indices = [];
  const th = spec.thickness || 0.18;
  const camber = spec.camber || 0;
  const twist = spec.twist || 0;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const x = THREE.MathUtils.lerp(spec.rootX, spec.tipX, t);
    const zc = THREE.MathUtils.lerp(spec.rootZ, spec.tipZ, t);
    const chord = THREE.MathUtils.lerp(spec.rootChord, spec.tipChord, t);
    const y = THREE.MathUtils.lerp(0, spec.dihedral || 0, Math.pow(t, 1.2));
    const thick = th * (1 - t * 0.55);
    const tc = -(twist * t);
    // 4 section points: leading edge, top, trailing edge, bottom
    const pts = [
      [0.0, 0.0],
      [chord * 0.32, thick * 0.5 + camber],
      [chord, thick * 0.35],
      [chord * 0.3, -thick * 0.5 + camber]
    ];
    for (const [dz, dy] of pts) {
      const zz = zc + chord * 0.0 + dz;
      // twist rotates the section around the span axis
      const ry = tc;
      const rx = x, ryy = y + dy;
      const rz = zz;
      positions.push(rx, ryy + Math.sin(ry) * 0.0, rz);
      uvs.push(t, dz / chord);
    }
  }
  const n = 4;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j, b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n);
      indices.push(a, c, b, b, c, d);
    }
  }
  if (spec.mirror) {
    // mirror across the XY plane (z -> -z) for the opposite surface
    const count = positions.length / 3;
    for (let i = 0; i < count; i++) positions[i * 3 + 0] = positions[i * 3 + 0];
  }
  // thin back faces so wings are not paper thin: offset a copy slightly
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Simple tapered box used for flaps/ailerons/rudders. */
export function controlSurface(len, chord, thickness, taper = 0.75) {
  const g = new THREE.BufferGeometry();
  const h = thickness * 0.5;
  const pos = [];
  const c = [
    [0, 0, 0], [len, 0, 0], [len * 1.0, 0, chord * taper], [0, 0, chord],
  ];
  for (const [x, y, z] of c) {
    for (const dy of [h, -h]) pos.push(x, dy, z);
  }
  const idx = [];
  const quad = (a, b, cc, d) => idx.push(a, b, cc, a, cc, d);
  // top
  quad(0, 2, 3, 1);
  // bottom
  quad(5, 7, 6, 4);
  // leading edge
  quad(0, 1, 5, 4);
  // trailing edge
  quad(3, 2, 6, 7);
  // tip
  quad(1, 3, 7, 5);
  // root
  quad(4, 6, 2, 0);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Position a mesh so its hinge line is at the origin and it extends +X. */
export function hingeMesh(geo, hingeX, hingeZ, pivot = 0) {
  const m = new THREE.Mesh(geo);
  m.position.set(hingeX, 0, hingeZ);
  return m;
}

// ---------------------------------------------------------------------------
// Small part builders (engines, intakes, gear, canopy, lights)
// ---------------------------------------------------------------------------
export function nozzleGeometry(r1 = 0.62, r2 = 0.78, len = 1.5, petals = 12) {
  const g = new THREE.CylinderGeometry(r2, r1, len, petals, 1, true);
  g.rotateX(Math.PI / 2);
  return g;
}

export function intakeGeometry(w = 0.9, h = 0.7, len = 3.2) {
  const stations = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stations.push({
      z: -len * (1 - t), w: w * (1 - t * 0.12), h: h * (1 - t * 0.1),
      cy: 0, p: 0.7, taper: 0
    });
  }
  return loft(stations, 10, { capFront: false });
}

export function gearStrut(len = 2.2, radius = 0.09) {
  const g = new THREE.CylinderGeometry(radius, radius * 1.1, len, 6);
  g.translate(0, -len / 2, 0);
  return g;
}

export function wheelGeometry(r = 0.42, w = 0.24) {
  const g = new THREE.CylinderGeometry(r, r, w, 12);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Merges an array of {geo, color, emissive, metal, rough} into a single mesh. */
export class MaterialPool {
  constructor(maps) {
    this.maps = maps || null;
    this.cache = new Map();
  }
  get(opts = {}) {
    const key = JSON.stringify(opts);
    if (this.cache.has(key)) return this.cache.get(key);
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color !== undefined ? opts.color : 0xffffff,
      roughness: opts.rough !== undefined ? opts.rough : 0.45,
      metalness: opts.metal !== undefined ? opts.metal : 0.55,
      emissive: opts.emissive !== undefined ? opts.emissive : 0x000000,
      emissiveIntensity: opts.emissiveIntensity !== undefined ? opts.emissiveIntensity : 1,
      flatShading: !!opts.flat,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1,
      side: opts.side !== undefined ? opts.side : THREE.FrontSide,
      envMapIntensity: opts.env !== undefined ? opts.env : 1.0,
      map: opts.untextured || !this.maps ? null : this.maps.map,
      roughnessMap: opts.untextured || !this.maps ? null : this.maps.roughnessMap,
      normalMap: opts.untextured || !this.maps ? null : this.maps.normalMap,
      metalness: opts.metal !== undefined ? opts.metal : (this.maps ? this.maps.metalness : 0.55)
    });
    mat.userData.baseColor = mat.color.clone();
    this.cache.set(key, mat);
    return mat;
  }
}
