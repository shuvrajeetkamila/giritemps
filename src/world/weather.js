// Dynamic weather: clear, overcast, rain, storm (with lightning and flyable storm cells), snow.
// Transitions are smoothed; the precipitation systems follow the camera.
import * as THREE from 'three';
import { rng, clamp, smoothstep } from '../core/noise.js';
import { WORLD_HALF } from './layout.js';

export const WEATHER_PRESETS = {
  clear:    { cover: 0.15, cirrus: 0.55, rain: 0, snow: 0, storm: 0, fog: 0.05, wind: 0.2, cells: 0 },
  overcast: { cover: 0.85, cirrus: 0.2, rain: 0, snow: 0, storm: 0, fog: 0.2, wind: 0.5, cells: 0.3 },
  rain:     { cover: 0.95, cirrus: 0.0, rain: 1, snow: 0, storm: 0.25, fog: 0.45, wind: 0.8, cells: 0.8 },
  storm:    { cover: 1, cirrus: 0.0, rain: 1, snow: 0, storm: 1, fog: 0.8, wind: 1, cells: 1 },
  snow:     { cover: 0.9, cirrus: 0.1, rain: 0, snow: 1, storm: 0, fog: 0.5, wind: 0.4, cells: 0.4 },
};

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(90,96,108,0.9)');
  grd.addColorStop(0.5, 'rgba(70,76,88,0.5)');
  grd.addColorStop(1, 'rgba(60,66,78,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  // Noise blotches to break up the puff silhouette.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(120,126,140,${Math.random() * 0.25})`;
    g.beginPath();
    g.arc(Math.random() * 128, Math.random() * 128, 4 + Math.random() * 14, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

export class Weather {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.type = 'clear';
    this.cur = { ...WEATHER_PRESETS.clear };
    this.target = WEATHER_PRESETS.clear;
    this.flash = 0;
    this.nextStrike = 4;
    this.inCell = false;
    this.cellStrength = 0;
    this.turbulence = 0;
    const R = rng(4242);
    this.rand = R;

    // Rain: line segments following the camera.
    this.rainCount = 2400;
    const rp = new Float32Array(this.rainCount * 6);
    this.rainPos = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) this.respawnDrop(i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xbfd6ea, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.rainPosAttr = rg.getAttribute('position');

    // Snow: points that drift.
    this.snowCount = 2600;
    const sp = new Float32Array(this.snowCount * 3);
    for (let i = 0; i < this.snowCount; i++) { sp[i * 3] = R() * 300 - 150; sp[i * 3 + 1] = R() * 150; sp[i * 3 + 2] = R() * 300 - 150; }
    this.snowBase = sp.slice();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    scene.add(this.snow);

    // Storm cells: clusters of billboard puffs; the player can fly into them.
    this.cells = [];
    const tex = puffTexture();
    this.cellGroup = new THREE.Group();
    scene.add(this.cellGroup);
    for (let c = 0; c < 14; c++) {
      const cx = (R() - 0.5) * WORLD_HALF * 1.6;
      const cz = (R() - 0.5) * WORLD_HALF * 1.6;
      const base = 900 + R() * 500;
      const radius = 600 + R() * 500;
      const sprites = [];
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff });
      for (let k = 0; k < 26; k++) {
        const s = new THREE.Sprite(mat.clone());
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * radius * 0.85;
        s.position.set(cx + Math.cos(a) * rr, base + R() * 380 - rr * 0.1, cz + Math.sin(a) * rr);
        const sc = radius * (0.5 + R() * 0.45);
        s.scale.set(sc, sc * 0.7, 1);
        this.cellGroup.add(s);
        sprites.push(s);
      }
      this.cells.push({ x: cx, y: base + 150, z: cz, r: radius, sprites });
    }

    // Lightning bolt (a jagged line from cloud base to ground).
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
    this.bolt = new THREE.Line(bg, new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0 }));
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;
    scene.add(this.bolt);
    this.boltLife = 0;
    this.boltOrigin = new THREE.Vector3();
  }

  respawnDrop(i, initial = false) {
    const R = this.rand;
    this.rainPos[i * 3] = (R() - 0.5) * 240;
    this.rainPos[i * 3 + 1] = initial ? R() * 120 : 120 + R() * 40;
    this.rainPos[i * 3 + 2] = (R() - 0.5) * 240;
  }

  setType(type) {
    if (!WEATHER_PRESETS[type]) return;
    this.type = type;
    this.target = WEATHER_PRESETS[type];
    this.rain.visible = true;
    this.snow.visible = true;
  }

  // Step weather. camPos/camVel are used to position particle systems.
  update(dt, camPos, camVel, time) {
    const t = Math.min(1, dt * 0.6);
    for (const k of Object.keys(this.target)) this.cur[k] += (this.target[k] - this.cur[k]) * t;

    // Precipitation follows the camera.
    const rainA = this.cur.rain;
    this.rainMat.opacity = rainA * 0.55;
    this.rain.visible = rainA > 0.01;
    if (this.rain.visible) {
      const wx = camVel.x * 0.05 + this.cur.wind * 4, wz = camVel.z * 0.05;
      const fall = 60;
      const arr = this.rainPosAttr.array;
      for (let i = 0; i < this.rainCount; i++) {
        this.rainPos[i * 3 + 1] -= fall * dt * (0.9 + (i % 7) * 0.02);
        this.rainPos[i * 3] += wx * dt;
        this.rainPos[i * 3 + 2] += wz * dt;
        if (this.rainPos[i * 3 + 1] < 0) this.respawnDrop(i);
        const x = this.rainPos[i * 3] + camPos.x, y = this.rainPos[i * 3 + 1] + camPos.y - 40, z = this.rainPos[i * 3 + 2] + camPos.z;
        const k = i * 6;
        arr[k] = x; arr[k + 1] = y; arr[k + 2] = z;
        arr[k + 3] = x - wx * 0.01; arr[k + 4] = y + 1.4; arr[k + 5] = z - wz * 0.01;
      }
      this.rainPosAttr.needsUpdate = true;
    }
    const snowA = this.cur.snow;
    this.snowMat.opacity = snowA * 0.9;
    this.snow.visible = snowA > 0.01;
    if (this.snow.visible) {
      const pos = this.snow.geometry.getAttribute('position');
      for (let i = 0; i < this.snowCount; i++) {
        let x = this.snowBase[i * 3] + Math.sin(time * 0.6 + i) * 2 + this.cur.wind * time * 0.0;
        let y = ((this.snowBase[i * 3 + 1] - time * 6) % 150 + 150) % 150;
        let z = this.snowBase[i * 3 + 2];
        pos.array[i * 3] = camPos.x + x;
        pos.array[i * 3 + 1] = camPos.y - 40 + y;
        pos.array[i * 3 + 2] = camPos.z + z;
      }
      pos.needsUpdate = true;
    }

    // Storm cells visibility and inside-cloud test.
    const cellA = this.cur.cells * (0.9 + 0.1 * Math.sin(time * 0.3));
    let inside = 0, cellS = 0;
    for (const c of this.cells) {
      const dx = camPos.x - c.x, dy = camPos.y - c.y, dz = camPos.z - c.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const vertical = Math.abs(dy) < 400;
      const depth = clamp(1 - d / c.r, 0, 1) * (vertical ? 1 : 0);
      if (depth > 0) { inside = Math.max(inside, depth); }
      cellS = Math.max(cellS, depth);
      for (const s of c.sprites) s.material.opacity = cellA * 0.75 * (0.85 + Math.sin(time + c.x) * 0.1);
    }
    this.cellGroup.visible = cellA > 0.02;
    this.inCell = inside > 0.35;
    this.cellStrength = inside;
    // Storm turbulence is strongest near the cell core.
    this.turbulence = (this.cur.storm * 0.6 + inside * 0.8) * (cellA > 0.1 ? 1 : 0);

    // Lightning during storms.
    this.nextStrike -= dt;
    if (this.cur.storm > 0.6 && this.nextStrike < 0) {
      this.nextStrike = 3 + this.rand() * 9;
      this.strike(camPos);
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.boltLife > 0) {
      this.boltLife -= dt;
      this.bolt.material.opacity = Math.max(0, this.boltLife * 5);
      if (this.boltLife <= 0) this.bolt.visible = false;
    }
  }

  strike(camPos) {
    const R = this.rand;
    const ang = R() * Math.PI * 2, dist = 1200 + R() * 2600;
    const x0 = camPos.x + Math.cos(ang) * dist, z0 = camPos.z + Math.sin(ang) * dist;
    const arr = this.bolt.geometry.getAttribute('position').array;
    let y = 1500 + R() * 200, x = x0, z = z0;
    const groundY = this.terrain ? Math.max(this.terrain.heightAt(x0, z0), 0) : 0;
    for (let i = 0; i < 20; i++) {
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
      const t = (i + 1) / 20;
      y = (1700 + 0) * (1 - t) + groundY * t + R() * 10;
      x = x0 + (R() - 0.5) * 60 * (1 - t);
      z = z0 + (R() - 0.5) * 60 * (1 - t);
    }
    this.bolt.geometry.getAttribute('position').needsUpdate = true;
    this.bolt.visible = true;
    this.boltLife = 0.25;
    this.bolt.material.opacity = 1;
    this.flash = 1;
  }

  // Extra turbulence jolts (m/s^2) for the flight model at a point.
  turbulenceAt() {
    return this.turbulence * 6;
  }

  get cover() { return this.cur.cover; }
  get storm() { return this.cur.storm; }
  get cirrus() { return this.cur.cirrus; }
  get fog() { return this.cur.fog; }
}

export function smoothTo(v, target, rate, dt) {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}
export { smoothstep };
