// Visual effects: one-draw-call billboard particle systems, instanced debris, shock rings,
// batched tracer lines and the high-level explosion/smoke helpers.
import * as THREE from 'three';

const PART_VERT = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main(){
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;
const PART_FRAG = /* glsl */`
  varying vec4 vColor;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = smoothstep(1.0, 0.2, d) * vColor.a;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

// Points-based billboard particles. All particles in one draw call.
class ParticleLayer {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alive = new Uint8Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3); this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4); this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1); this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.uniforms = { uScale: { value: 500 } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PART_VERT, fragmentShader: PART_FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 5;
    scene.add(this.points);
  }

  emit(p, v, o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.alive[i] = 1;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = o.life; this.maxLife[i] = o.life;
    this.s0[i] = o.s0 ?? 1; this.s1[i] = o.s1 ?? this.s0[i];
    const c0 = o.c0 ?? [1, 1, 1], c1 = o.c1 ?? c0;
    this.c0.set([c0[0], c0[1], c0[2], o.a0 ?? 1], i * 4);
    this.c1.set([c1[0], c1[1], c1[2], o.a1 ?? 0], i * 4);
    this.drag[i] = o.drag ?? 0.5;
    this.grav[i] = o.grav ?? 0;
  }

  update(dt, scale) {
    this.uniforms.uScale.value = scale;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) { if (this.size[i] !== 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; } continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alive[i] = 0; this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      for (let c = 0; c < 4; c++) this.col[i * 4 + c] = this.c0[i * 4 + c] + (this.c1[i * 4 + c] - this.c0[i * 4 + c]) * t;
    }
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
  }

  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}

// Debris: instanced tumbling pieces with simple ground bounce.
class DebrisPool {
  constructor(scene, count = 240) {
    this.count = count;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.6, roughness: 0.5 }), count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.items = Array.from({ length: count }, () => ({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), w: new THREE.Vector3(), s: 1, life: 0, color: new THREE.Color() }));
    this.cursor = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3(); this.e = new THREE.Euler();
    scene.add(this.mesh);
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  spawn(p, v, size, color, life = 6) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    it.alive = true; it.p.copy(p); it.v.copy(v); it.s = size; it.life = life;
    it.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.w.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
    it.color.setHex(color);
  }
  update(dt, groundAt) {
    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      if (!it.alive) { this.sc.set(0, 0, 0); this.m.compose(_zero, this.q, this.sc); this.mesh.setMatrixAt(i, this.m); continue; }
      it.life -= dt;
      it.v.y -= 9.81 * dt;
      it.p.addScaledVector(it.v, dt);
      it.r.addScaledVector(it.w, dt);
      const g = groundAt ? groundAt(it.p.x, it.p.z) : 0;
      if (it.p.y < g + it.s * 0.5) {
        it.p.y = g + it.s * 0.5;
        it.v.y = Math.abs(it.v.y) * 0.3;
        it.v.x *= 0.6; it.v.z *= 0.6;
        it.w.multiplyScalar(0.6);
      }
      if (it.life <= 0) it.alive = false;
      this.e.set(it.r.x, it.r.y, it.r.z);
      this.q.setFromEuler(this.e);
      this.sc.set(it.s, it.s * 0.6, it.s * 0.8);
      this.m.compose(it.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, it.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const _zero = new THREE.Vector3();

// Expanding shockwave rings (ground explosions).
class ShockRings {
  constructor(scene, count = 10) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.items.push({ m, t: 1, dur: 1, max: 20 });
    }
    this.cursor = 0;
  }
  spawn(p, radius, dur = 0.8, color = 0xffe6b0) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.m.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
    it.m.material.color.setHex(color);
    it.max = radius; it.t = 0; it.dur = dur; it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt / it.dur;
      if (it.t >= 1) { it.m.visible = false; continue; }
      const s = it.max * (0.1 + it.t * 0.9);
      it.m.scale.set(s, s, 1);
      it.m.material.opacity = (1 - it.t) * 0.7;
    }
  }
}

// Tracer streaks: all bullets drawn in one LineSegments buffer.
class Tracers {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }
  // items: array of { pos, prev, color: [r,g,b], hostile }
  draw(items) {
    let n = 0;
    for (const it of items) {
      if (n >= this.max) break;
      const k = n * 6;
      this.pos[k] = it.prev.x; this.pos[k + 1] = it.prev.y; this.pos[k + 2] = it.prev.z;
      this.pos[k + 3] = it.pos.x; this.pos[k + 4] = it.pos.y; this.pos[k + 5] = it.pos.z;
      const c = it.color;
      this.col[k] = c[0]; this.col[k + 1] = c[1]; this.col[k + 2] = c[2];
      this.col[k + 3] = c[0] * 0.4; this.col[k + 4] = c[1] * 0.2; this.col[k + 5] = c[2] * 0.1;
      n++;
    }
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// High level facade used by the game and weapons.
export class Effects {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.particleScale = opts.particleScale ?? 1;
    this.smoke = new ParticleLayer(scene, 9000, false);
    this.glow = new ParticleLayer(scene, 5000, true);
    this.debris = new DebrisPool(scene, 260);
    this.rings = new ShockRings(scene, 12);
    this.tracers = new Tracers(scene, 700);
    this.groundAt = null;
    this.shake = 0;
    this.events = [];
  }

  setGroundFn(fn) { this.groundAt = fn; }

  // Visible fireball: white core -> orange -> dark smoke, plus sparks and debris.
  explosion(p, scale = 1, opts = {}) {
    const k = this.particleScale;
    const n = Math.round((opts.count ?? 26) * k);
    this.glow.emit(p, _zero, { life: 0.35, s0: 18 * scale, s1: 46 * scale, c0: [1, 1, 0.9], c1: [1, 0.6, 0.2], a0: 1, a1: 0, drag: 4 });
    for (let i = 0; i < n; i++) {
      const dir = randDir();
      const v = dir.clone().multiplyScalar((8 + Math.random() * 16) * scale);
      this.glow.emit(p, v, { life: 0.6 + Math.random() * 0.6, s0: 6 * scale, s1: 22 * scale, c0: [1, 0.8, 0.3], c1: [1, 0.3, 0.05], a0: 1, a1: 0, drag: 3 });
    }
    for (let i = 0; i < Math.round(12 * k); i++) {
      const v = randDir().multiplyScalar(14 * scale);
      this.smoke.emit(p.clone().add(new THREE.Vector3(Math.random() * 3, 0, Math.random() * 3)), v, { life: 4 + Math.random() * 4, s0: 6 * scale, s1: 26 * scale, c0: [0.25, 0.22, 0.2], c1: [0.1, 0.1, 0.1], a0: 0.8, a1: 0, drag: 1.2, grav: -1 });
    }
    for (let i = 0; i < Math.round(30 * k); i++) {
      const v = randDir().multiplyScalar((18 + Math.random() * 24) * scale);
      this.glow.emit(p, v, { life: 0.5 + Math.random() * 0.8, s0: 0.6, s1: 0.2, c0: [1, 0.9, 0.5], c1: [1, 0.3, 0.1], a0: 1, a1: 0, drag: 0.6, grav: 9.8 });
    }
    const debrisN = Math.round((opts.debris ?? 10) * k);
    for (let i = 0; i < debrisN; i++) {
      const v = randDir().multiplyScalar((10 + Math.random() * 20) * scale);
      v.y = Math.abs(v.y) + 6;
      this.debris.spawn(p, v, (0.4 + Math.random() * 1.2) * Math.sqrt(scale), opts.debrisColor ?? 0x3c3f44, 6 + Math.random() * 3);
    }
    this.rings.spawn(p, 40 * scale, 0.7);
    this.shake = Math.max(this.shake, Math.min(1.2, 0.35 * scale));
    this.events.push({ type: 'explosion', p: p.clone(), scale });
  }

  sparks(p, n = 8, color = [1, 0.8, 0.3]) {
    for (let i = 0; i < n * this.particleScale; i++) {
      const v = randDir().multiplyScalar(6 + Math.random() * 10);
      this.glow.emit(p, v, { life: 0.25 + Math.random() * 0.35, s0: 0.5, s1: 0.2, c0: color, c1: [1, 0.2, 0], a0: 1, a1: 0, drag: 1, grav: 9 });
    }
  }

  muzzle(p, dir) {
    this.glow.emit(p, dir.clone().multiplyScalar(2), { life: 0.06, s0: 4, s1: 6, c0: [1, 0.9, 0.5], c1: [1, 0.5, 0.2], a0: 1, a1: 0, drag: 2 });
  }

  smokePuff(p, v, scale = 1, dark = false, life = 6) {
    const c = dark ? [0.12, 0.12, 0.13] : [0.82, 0.84, 0.86];
    this.smoke.emit(p, v, { life: life * (0.8 + Math.random() * 0.4), s0: 2.5 * scale, s1: 12 * scale, c0: c, c1: c, a0: dark ? 0.6 : 0.45, a1: 0, drag: 0.7 });
  }

  // Engine exhaust embers in afterburner.
  embers(p, dir, n = 1) {
    for (let i = 0; i < n * this.particleScale; i++) {
      const v = dir.clone().multiplyScalar(40 + Math.random() * 30).add(randDir().multiplyScalar(4));
      this.glow.emit(p, v, { life: 0.5 + Math.random() * 0.5, s0: 1.2, s1: 0.3, c0: [1, 0.7, 0.3], c1: [1, 0.2, 0.05], a0: 1, a1: 0, drag: 2.5, grav: 3 });
    }
  }

  vapor(p, v) {
    this.smoke.emit(p, v, { life: 1.6, s0: 0.8, s1: 3.2, c0: [0.95, 0.97, 1], c1: [0.95, 0.97, 1], a0: 0.5, a1: 0, drag: 1.5 });
  }

  // Metallic hit sparks on airframes, plus a light puff.
  impact(p, ground = false) {
    this.sparks(p, ground ? 14 : 6, ground ? [0.9, 0.7, 0.4] : [1, 0.85, 0.4]);
    this.smokePuff(p, new THREE.Vector3(0, 2, 0), 0.5, ground, 1.5);
  }

  update(dt, camera, viewH) {
    const scale = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.smoke.update(dt, scale);
    this.glow.update(dt, scale);
    this.debris.update(dt, this.groundAt);
    this.rings.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.4);
  }

  dispose() {
    this.smoke.dispose(); this.glow.dispose();
  }
}

function randDir() {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(a), u * 0.6 + 0.2, s * Math.sin(a));
}

export { Tracers, ParticleLayer };
