// Scatter props: villages with instanced houses, forests of instanced trees, and roads.
import * as THREE from 'three';
import { rng, clamp } from '../core/noise.js';
import { VILLAGES, WORLD_HALF } from './layout.js';

export function buildProps(scene, terrain) {
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);
  const R = rng(9001);

  // ---- Villages: houses and a church tower, instanced. ----
  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.75, 0.6, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const houseMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, color: 0x8b3d2c });
  const houseCount = VILLAGES.length * 12;
  const houses = new THREE.InstancedMesh(houseGeo, houseMat, houseCount);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, houseCount);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  const palette = [0xe8dcc4, 0xd9c7a3, 0xf2efe8, 0xbfcfd6, 0xe9b98c];
  const roofPal = [0x8b3d2c, 0x3f5d74, 0x6b4f35, 0x9c3b2e];
  let hi = 0;
  const col = new THREE.Color();
  for (const v of VILLAGES) {
    for (let k = 0; k < 12; k++) {
      const a = R() * Math.PI * 2, d = 25 + R() * 130;
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      const y = terrain.heightAt(x, z);
      const w = 7 + R() * 5, dpt = 6 + R() * 4, hgt = 4 + R() * 3;
      e.set(0, R() * Math.PI, 0);
      q.setFromEuler(e);
      s.set(w, hgt, dpt);
      p.set(x, y + hgt / 2, z);
      m.compose(p, q, s);
      houses.setMatrixAt(hi, m);
      col.setHex(palette[Math.floor(R() * palette.length)]);
      houses.setColorAt(hi, col);
      s.set(w * 0.9, dpt * 0.5 + 2, dpt * 0.9);
      p.set(x, y + hgt + 0.3, z);
      m.compose(p, q, s);
      roofs.setMatrixAt(hi, m);
      col.setHex(roofPal[Math.floor(R() * roofPal.length)]);
      roofs.setColorAt(hi, col);
      hi++;
    }
    // Church tower.
    const ty = terrain.heightAt(v.x, v.z);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 22, 10), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }));
    tower.position.set(v.x, ty + 11, v.z);
    tower.castShadow = true;
    group.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.8, 7, 10), new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.5 }));
    spire.position.set(v.x, ty + 25.5, v.z);
    group.add(spire);
  }
  houses.count = hi; roofs.count = hi;
  houses.instanceMatrix.needsUpdate = true; roofs.instanceMatrix.needsUpdate = true;
  houses.castShadow = true; houses.receiveShadow = true;
  if (houses.instanceColor) houses.instanceColor.needsUpdate = true;
  if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  group.add(houses, roofs);

  // ---- Trees: forests and valley copses. Instanced trunks and crowns. ----
  const TREE_N = 9000;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), TREE_N);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), TREE_N);
  let n = 0;
  const greens = [0x2f6b2a, 0x3d7d33, 0x24552a, 0x4c8b3b, 0x1f4a28];
  let attempts = 0;
  while (n < TREE_N && attempts < TREE_N * 6) {
    attempts++;
    const x = (R() - 0.5) * WORLD_HALF * 2 * 0.92;
    const z = (R() - 0.5) * WORLD_HALF * 2 * 0.92;
    const h = terrain.heightAt(x, z);
    if (h < 3 || h > 640) continue;
    const dh = Math.abs(terrain.heightAt(x + 6, z) - h) + Math.abs(terrain.heightAt(x, z + 6) - h);
    if (dh > 5) continue;
    const biomeOk = terrain.biomeAt(x, z, h);
    if (biomeOk === 'desert' || biomeOk === 'snow') continue;
    if (biomeOk !== 'forest' && R() > 0.25) continue;
    const size = (biomeOk === 'forest' ? 6 : 4.5) + R() * 4;
    e.set(0, R() * 6, 0); q.setFromEuler(e);
    s.set(1, size * 0.5, 1);
    p.set(x, h, z);
    m.compose(p, q, s);
    trunks.setMatrixAt(n, m);
    s.set(size * 0.7, size * 0.95, size * 0.7);
    p.set(x, h + size * 0.5, z);
    m.compose(p, q, s);
    crowns.setMatrixAt(n, m);
    col.setHex(greens[Math.floor(R() * greens.length)]);
    crowns.setColorAt(n, col);
    n++;
  }
  trunks.count = n; crowns.count = n;
  trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  trunks.castShadow = true; crowns.castShadow = true;
  group.add(trunks, crowns);

  // ---- Roads between villages and to the airfield. ----
  const roadPts = [];
  const hubs = [{ x: -1100, z: 200 }, ...VILLAGES];
  for (let i = 0; i < hubs.length - 1; i++) roadPts.push([hubs[i], hubs[i + 1]]);
  roadPts.push([VILLAGES[0], VILLAGES[3]], [VILLAGES[2], VILLAGES[4]]);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 });
  const roadGroup = new THREE.Group();
  for (const [a, b] of roadPts) roadGroup.add(roadRibbon(a, b, terrain, roadMat));
  group.add(roadGroup);

  return { group, treeCount: n };
}

function roadRibbon(a, b, terrain, mat) {
  const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 20));
  const pos = [], idx = [];
  const width = 5;
  let dx = 0, dz = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    // Wobble to avoid arrow-straight roads.
    const wob = Math.sin(t * Math.PI * 3) * 40;
    const nx = -(b.z - a.z), nz = (b.x - a.x);
    const len = Math.hypot(nx, nz) || 1;
    const px = x + (nx / len) * wob, pz = z + (nz / len) * wob;
    const h = Math.max(terrain.heightAt(px, pz), 0.5);
    dx = px; dz = pz;
    const ux = nx / len, uz = nz / len;
    pos.push(px + ux * width, h + 0.5, pz + uz * width, px - ux * width, h + 0.5, pz - uz * width);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  void dx; void dz;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export { clamp };
