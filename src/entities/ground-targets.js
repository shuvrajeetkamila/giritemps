// Ground and naval targets: radar installations, SAM sites, AA guns, fuel depots, hangars,
// radio towers, bunkers, searchlights and the fleet. They implement the same target interface as units.
import * as THREE from 'three';
import { WEAPON_STATS } from '../combat/weapons.js';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.2, ...o });
const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// Pseudo-owner used by ground weapons so the combat system can treat them like aircraft.
function makeOwner(target) {
  const dirRef = { v: new THREE.Vector3(0, 0, -1) };
  target.aim = dirRef;
  const fm = {
    forward: (out) => out.copy(dirRef.v),
    up: (out) => out.set(0, 1, 0),
    right: (out) => out.set(1, 0, 0),
  };
  return { pos: target.pos, vel: new THREE.Vector3(), fm, team: target.team || 'enemy', isPlayer: false, missiles: { ir: 12, radar: 0 }, rockets: 0, bombs: 0, flares: 0, chaff: 0, ammo: 9999, alive: true, stats: null, afterburner: false, isGround: true, get ownerTarget() { return target; } };
}

export class GroundTarget {
  constructor(scene, { id, type, name, x, z, y, isObjective = false, hp = 300, radius = 14, team = 'enemy' }) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.kind = type === 'ship' ? 'ship' : 'ground';
    this.team = team;
    this.pos = new THREE.Vector3(x, y ?? 0, z);
    this.vel = new THREE.Vector3();
    this.radius = radius;
    this.hp = hp;
    this.hpMax = hp;
    this.alive = true;
    this.isObjective = isObjective;
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    scene.add(this.group);
    this.owner = makeOwner(this);
    this.fireCD = 4 + Math.random() * 4;
    this.smokeT = 0;
    this.spin = 0;
    this.destroyedT = -1;
    this.aim = { v: new THREE.Vector3(0, 0, -1) };
    this.build();
  }

  build() {}

  takeDamage(amount, source, info) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.onDestroyed(source); }
    return this.alive;
  }

  onDestroyed() {
    this.group.traverse((o) => { if (o.isMesh && o.material && o.material.color) o.material.color.multiplyScalar(0.35); });
  }

  update(dt, ctx) {
    // Damaged structures keep smoking.
    if (this.alive && this.hp < this.hpMax * 0.5) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.35; ctx.fx.smokePuff(this.pos.clone().add(new THREE.Vector3(0, 6, 0)), new THREE.Vector3(0, 6, 0), 1.5, true, 7); }
    }
  }
}

// Radar installation: rotating dish on a lattice mast.
class RadarSite extends GroundTarget {
  build() {
    const base = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 22), mat(0x6b6f66));
    base.position.y = 1; base.castShadow = true; base.receiveShadow = true;
    this.group.add(base);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 14, 8), mat(0xbbbbbb, { metalness: 0.5 }));
    mast.position.y = 9; mast.castShadow = true;
    this.group.add(mast);
    this.dishPivot = new THREE.Group();
    this.dishPivot.position.y = 17;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe6e6e6, { side: THREE.DoubleSide }));
    dish.rotation.x = Math.PI / 2 + 0.5;
    dish.castShadow = true;
    this.dishPivot.add(dish);
    this.group.add(this.dishPivot);
    const sec = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 10), mat(0x44534a));
    sec.position.set(-12, 1.5, 5);
    this.group.add(sec);
  }
  update(dt, ctx) {
    super.update(dt, ctx);
    if (this.alive) this.dishPivot.rotation.y += dt * 0.9;
  }
}

// Surface-to-air missile site: radar, trailer and launch rail that aims at the player.
class SamSite extends GroundTarget {
  build() {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 18), mat(0x4f5a46));
    pad.position.y = 0.25;
    this.group.add(pad);
    this.trailer = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 9), mat(0x5b6150));
    this.trailer.position.y = 1.8; this.trailer.castShadow = true;
    this.group.add(this.trailer);
    this.launcher = new THREE.Group();
    this.launcher.position.y = 3.2;
    for (let i = 0; i < 4; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 7, 8), mat(0xc9c2a8));
      tube.rotation.x = Math.PI / 2;
      tube.position.set(((i % 2) - 0.5) * 1.6, ((i >> 1) - 0.5) * 1.6, -2);
      this.launcher.add(tube);
    }
    this.group.add(this.launcher);
    this.dishPivot = new THREE.Group();
    this.dishPivot.position.set(0, 4.5, 4);
    const dish = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.4), mat(0xdddddd));
    this.dishPivot.add(dish);
    this.group.add(this.dishPivot);
    this.flashT = 0;
  }
  update(dt, ctx) {
    super.update(dt, ctx);
    if (!this.alive) return;
    const pl = ctx.player;
    if (pl && pl.alive) {
      const d = pl.pos.distanceTo(this.pos);
      const toPl = pl.pos.clone().sub(this.pos);
      const yaw = Math.atan2(toPl.x, toPl.z);
      this.group.rotation.y = yaw;
      this.dishPivot.rotation.y += dt * 3;
      const elev = Math.atan2(toPl.y - 5, Math.hypot(toPl.x, toPl.z));
      this.launcher.rotation.x = -THREE.MathUtils.clamp(elev, 0, 1.4);
      this.aim.v.copy(toPl.clone().normalize());
      this.fireCD -= dt;
      if (this.fireCD <= 0 && d < 11000 && d > 1500 && pl.pos.y < 9000) {
        this.fireCD = 11 + Math.random() * 6;
        const m = ctx.combat.fireMissile(this.owner, pl, 'ir');
        if (m) {
          m.boost = 1.3;
          this.flashT = 0.6;
          ctx.fx.explosion(this.pos.clone().add(new THREE.Vector3(0, 5, 0)), 0.35, { count: 8, debris: 0 });
          if (ctx.audio) ctx.audio.sam(this.pos);
        }
      }
    }
    if (this.flashT > 0) this.flashT -= dt;
  }
}

// Anti-aircraft gun: twin barrels that fire tracer streams toward the player.
class AAGun extends GroundTarget {
  build() {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.5, 1, 12), mat(0x59614f));
    pad.position.y = 0.5;
    this.group.add(pad);
    this.turret = new THREE.Group();
    this.turret.position.y = 1.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 3), mat(0x4a5246));
    this.turret.add(body);
    this.barrels = new THREE.Group();
    for (const sx of [-0.6, 0.6]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 4.5, 8), mat(0x222222, { metalness: 0.7 }));
      b.rotation.x = Math.PI / 2;
      b.position.set(sx, 0.4, -2.2);
      this.barrels.add(b);
    }
    this.turret.add(this.barrels);
    this.group.add(this.turret);
    this.muzzleT = 0;
  }
  update(dt, ctx) {
    super.update(dt, ctx);
    if (!this.alive) return;
    const pl = ctx.player;
    if (!pl || !pl.alive) return;
    const toPl = pl.pos.clone().sub(this.pos);
    const d = toPl.length();
    this.turret.rotation.y = Math.atan2(toPl.x, toPl.z);
    const elev = Math.atan2(toPl.y - 1.5, Math.hypot(toPl.x, toPl.z));
    this.barrels.rotation.x = -THREE.MathUtils.clamp(elev, -0.3, 1.45);
    this.fireCD -= dt;
    if (d < 2600 && this.fireCD <= 0) {
      this.fireCD = 0.18;
      const dir = toPl.clone().normalize();
      // Error grows with range; tracer stream toward the player.
      dir.x += (Math.random() - 0.5) * (0.02 + d / 40000);
      dir.y += (Math.random() - 0.5) * (0.02 + d / 40000);
      dir.normalize();
      ctx.combat.fireAA(this, dir);
      this.muzzleT = 0.05;
    }
  }
}

// Fuel depot: tanks and pipework; chain explosions and a long-lived smoke column when destroyed.
class FuelDepot extends GroundTarget {
  build() {
    for (let i = 0; i < 4; i++) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 11, 16), mat(0xb7c0c6, { metalness: 0.6, roughness: 0.4 }));
      tank.position.set(-10 + (i % 2) * 20, 5.5, -8 + Math.floor(i / 2) * 16);
      tank.castShadow = true;
      this.group.add(tank);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xb7c0c6));
      cap.position.copy(tank.position).add(new THREE.Vector3(0, 5.5, 0));
      this.group.add(cap);
    }
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 30, 6), mat(0x8a6f2f));
    pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 2.5, 0);
    this.group.add(pipe);
    this.chainT = -1;
    this.columnT = -1;
    this.chainCount = 0;
  }
  onDestroyed(source) {
    super.onDestroyed(source);
    this.chainT = 0.2;
    this.columnT = 30;
    this.chainCount = 0;
    this.pendingExplosion = true;
    this.explodeFn = null;
  }
  update(dt, ctx) {
    if (this.alive) { super.update(dt, ctx); return; }
    if (this.chainT >= 0) {
      this.chainT -= dt;
      if (this.chainT <= 0 && this.chainCount < 6) {
        this.chainCount++;
        const p = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 4, (Math.random() - 0.5) * 30));
        ctx.fx.explosion(p, 2.4, { count: 30, debris: 14, debrisColor: 0x7a8088 });
        if (ctx.audio) ctx.audio.explosion(p, 2.0);
        ctx.combat.splash(p, 30, 60, this.owner);
        this.chainT = 0.45 + Math.random() * 0.4;
        if (this.chainCount === 1) ctx.onDepotBlast && ctx.onDepotBlast(this);
      }
      if (this.chainCount >= 6) this.chainT = -1;
    }
    if (this.columnT > 0) {
      this.columnT -= dt;
      if (Math.random() < dt * 14) ctx.fx.smokePuff(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 10 + (30 - this.columnT) * 0.6, (Math.random() - 0.5) * 8)), new THREE.Vector3(0, 9, 0), 2.6, true, 14);
    }
  }
}

// Hangar: half-cylinder roof on a concrete slab.
class Hangar extends GroundTarget {
  build() {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(34, 1, 26), mat(0x6e6e6a));
    slab.position.y = 0.5;
    this.group.add(slab);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 34, 14, 1, true, 0, Math.PI), mat(0x7e8790, { side: THREE.DoubleSide, metalness: 0.4 }));
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 1;
    roof.castShadow = true;
    this.group.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 20), mat(0x39404a));
    door.position.set(0, 4, 13);
    this.group.add(door);
  }
}

// Radio tower with lattice-look mast and blinking beacon.
class RadioTower extends GroundTarget {
  build() {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.4, 60, 6, 1, true), mat(0xdedede, { side: THREE.DoubleSide }));
    mast.position.y = 30; mast.castShadow = true;
    this.group.add(mast);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 40, 6, 1, true), mat(0xd1393d, { side: THREE.DoubleSide }));
    stripe.position.y = 16;
    this.group.add(stripe);
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    this.beacon.position.y = 61;
    this.group.add(this.beacon);
  }
  update(dt, ctx) {
    super.update(dt, ctx);
    if (this.alive) this.beacon.visible = Math.floor(performance.now() / 500) % 2 === 0;
  }
}

class Bunker extends GroundTarget {
  build() {
    const b = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 22), mat(0x5c5f5a));
    b.position.y = 4; b.castShadow = true; b.receiveShadow = true;
    this.group.add(b);
    const door = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 0.6), mat(0x222426));
    door.position.set(0, 2.5, 11.2);
    this.group.add(door);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 14, 4), mat(0x999999));
    ant.position.set(10, 15, -6);
    this.group.add(ant);
  }
}

// Naval vessel with AA gun mounts that fire at aircraft near the fleet.
class Ship extends GroundTarget {
  constructor(scene, opts) {
    super(scene, { ...opts, radius: 26, hp: opts.hp ?? 800, type: 'ship' });
    this.orbitR = opts.orbitR ?? 0;
    this.orbitA = opts.orbitA ?? 0;
    this.center = opts.center ? opts.center.clone() : this.pos.clone();
    this.heading = opts.heading ?? 0;
    this.speed = opts.speed ?? 6;
    this.mounts = [];
  }
  build() {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 70), mat(0x65707a, { metalness: 0.4 }));
    hull.position.y = 1.5;
    hull.castShadow = true;
    this.group.add(hull);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 9, 12, 4), mat(0x65707a));
    bow.rotation.x = Math.PI / 2; bow.rotation.z = Math.PI / 4;
    bow.position.set(0, 1.5, -39);
    this.group.add(bow);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(10, 8, 12), mat(0xdfe3e6));
    bridge.position.set(0, 9, 6);
    bridge.castShadow = true;
    this.group.add(bridge);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 14, 5), mat(0x999999));
    mast.position.set(0, 16, 6);
    this.group.add(mast);
    for (const [x, z] of [[-6, -18], [6, -18], [-6, 22], [6, 22]]) {
      const m = new THREE.Group();
      m.position.set(x, 5, z);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 6), mat(0x333333));
      b.rotation.x = Math.PI / 2; b.position.z = -1.3;
      m.add(b);
      this.group.add(m);
      this.mounts.push({ g: m, cd: Math.random() * 0.6 });
    }
  }
  update(dt, ctx) {
    if (this.alive) {
      // Slow circle around the fleet center, keep heading tangential.
      this.orbitA += dt * this.speed / Math.max(this.orbitR, 1);
      if (this.orbitR > 0) {
        this.pos.set(this.center.x + Math.cos(this.orbitA) * this.orbitR, 0, this.center.z + Math.sin(this.orbitA) * this.orbitR);
        this.group.position.copy(this.pos);
        this.group.rotation.y = -this.orbitA + Math.PI / 2;
      }
    }
    super.update(dt, ctx);
    if (!this.alive) { this.group.position.y = Math.max(-18, this.group.position.y - dt * 0.4); return; }
    // Ship AA: track nearest aircraft within 3.5 km.
    let best = null, bd = 3500;
    for (const p of ctx.hostiles || []) {
      if (!p.alive) continue;
      const d = p.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = p; }
    }
    for (const m of this.mounts) {
      m.cd -= dt;
      if (!best) continue;
      const toP = best.pos.clone().sub(this.pos);
      m.g.rotation.y = Math.atan2(toP.x, toP.z) - this.group.rotation.y;
      m.g.rotation.x = -Math.atan2(toP.y - 5, Math.hypot(toP.x, toP.z));
      if (m.cd <= 0) {
        m.cd = 0.09;
        const dir = toP.clone().normalize();
        dir.x += (Math.random() - 0.5) * 0.04; dir.y += (Math.random() - 0.5) * 0.04;
        ctx.combat.fireAA({ pos: this.pos.clone().add(new THREE.Vector3(0, 6, 0)), owner: this.owner, team: 'enemy', kind: 'ship' }, dir.normalize(), true);
      }
    }
  }
}

// Searchlight used on night missions: a rotating beam that tracks sweep patterns.
export class Searchlight {
  constructor(scene, x, z, y = 0) {
    this.pos = new THREE.Vector3(x, y, z);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 9, 6), mat(0x3a3a3a));
    pole.position.y = 4.5;
    this.group.add(pole);
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(120, 2400, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xd8eeff, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beam.geometry.translate(0, -1200, 0);
    this.beam.position.y = 9.5;
    this.group.add(this.beam);
    scene.add(this.group);
    this.t = Math.random() * 10;
  }
  update(dt) {
    this.t += dt;
    this.group.rotation.y = Math.sin(this.t * 0.25) * 0.8;
    this.beam.rotation.x = -0.35 + Math.sin(this.t * 0.4) * 0.25;
  }
}

export function createGroundTarget(scene, cfg) {
  switch (cfg.type) {
    case 'radar': return new RadarSite(scene, cfg);
    case 'sam': return new SamSite(scene, cfg);
    case 'aaa': return new AAGun(scene, cfg);
    case 'depot': return new FuelDepot(scene, cfg);
    case 'hangar': return new Hangar(scene, cfg);
    case 'tower': return new RadioTower(scene, cfg);
    case 'bunker': return new Bunker(scene, cfg);
    case 'ship': return new Ship(scene, cfg);
    default: return new GroundTarget(scene, cfg);
  }
}

export { WEAPON_STATS, _dir, _up };
