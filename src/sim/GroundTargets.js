// ---------------------------------------------------------------------------
// GroundTargets — radar sites, SAM batteries that really fire, AAA guns with
// tracer streams, hangars, fuel depots that chain-explode, bridges, ships.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import {
  makeRadarStationGeometry, makeSAMLauncherGeometry, makeAAGunGeometry,
  makeDepotGeometry, makeFuelTankGeometry, makeRunwayGeometry,
  makeBuildingGeometry, makeTowerGeometry, makeBridgeGeometry, makeShipGeometry
} from '../world/Scenery.js';
import { injectWorldShading, WORLD_LIGHT_UNIFORMS } from '../render/Shading.js';
import { SHADOW_LAYER_OBJECTS } from '../render/CascadedShadows.js';
import { RNG, clamp, clamp01, lerp, damp, TAU } from '../core/Utils.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

const TARGET_DEFS = {
  radar: {
    name: 'EARLY WARNING RADAR', hp: 260, radius: 14, height: 22, value: 250,
    labels: ['RADAR SITE']
  },
  sam: {
    name: 'SAM BATTERY', hp: 320, radius: 12, height: 12, value: 300, armored: true,
    range: 11000, lockTime: 2.6, reload: 7.5, missiles: 8, labels: ['SAM SITE']
  },
  aaa: {
    name: 'AAA GUN', hp: 180, radius: 8, height: 9, value: 150, armored: true,
    range: 2800, reload: 0.35, labels: ['AAA']
  },
  hangar: {
    name: 'HANGAR', hp: 420, radius: 20, height: 16, value: 180, labels: ['HANGAR']
  },
  depot: {
    name: 'FUEL DEPOT', hp: 260, radius: 22, height: 14, value: 300, chained: true, labels: ['FUEL DEPOT']
  },
  fuelTank: {
    name: 'FUEL TANK', hp: 120, radius: 9, height: 14, value: 90, chained: true, labels: ['FUEL']
  },
  bridge: {
    name: 'BRIDGE', hp: 500, radius: 40, height: 12, value: 200, labels: ['BRIDGE']
  },
  ship: {
    name: 'ENEMY DESTROYER', hp: 900, radius: 24, height: 22, value: 600, armored: true,
    range: 9000, lockTime: 3.4, reload: 9.0, missiles: 12, moving: true, labels: ['WARSHIP']
  },
  command: {
    name: 'COMMAND BUNKER', hp: 900, radius: 26, height: 14, value: 800, labels: ['COMMAND POST']
  }
};

let MATERIALS = null;

function materials() {
  if (MATERIALS) return MATERIALS;
  MATERIALS = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x9c9a92, roughness: 0.9, metalness: 0.05 }),
    concreteDark: new THREE.MeshStandardMaterial({ color: 0x6e6d68, roughness: 0.92, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8b9199, roughness: 0.45, metalness: 0.85 }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x4c5158, roughness: 0.6, metalness: 0.7 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x7a5a44, roughness: 0.85, metalness: 0.3 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xb8b4a4, roughness: 0.55, metalness: 0.6 }),
    hazard: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6, metalness: 0.4 }),
    green: new THREE.MeshStandardMaterial({ color: 0x4e5a42, roughness: 0.85, metalness: 0.15 }),
    ship: new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.7, metalness: 0.5 })
  };
  return MATERIALS;
}

export function initGroundMaterials(csmUniforms) {
  const m = materials();
  const uniforms = Object.assign({}, csmUniforms || {}, WORLD_LIGHT_UNIFORMS);
  for (const key of Object.keys(m)) {
    injectWorldShading(m[key], uniforms);
  }
  return m;
}

export class GroundTarget {
  constructor(opts) {
    this.type = opts.type;
    this.def = TARGET_DEFS[opts.type] || TARGET_DEFS.hangar;
    this.team = opts.team || 'red';
    this.pos = new THREE.Vector3().copy(opts.pos);
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.armored = !!this.def.armored;
    this.maxHealth = this.def.hp * (opts.hpScale || 1);
    this.health = this.maxHealth;
    this.dead = false;
    this.world = opts.world;
    this.rng = new RNG(opts.seed || 20250);
    this.name = this.def.name;
    this.label = opts.label || this.def.name;
    this.value = this.def.value;
    this.smokeTimer = 0;
    this.fireTimer = 0;
    this.lockTimer = 0;
    this.reload = 0;
    this.ammo = this.def.missiles || 0;
    this.target = null;
    this.chainTimer = -1;
    this.yaw = opts.yaw !== undefined ? opts.yaw : this.rng.float(0, TAU);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.name = `target_${opts.type}`;
    this.buildMesh();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.layers.enable(SHADOW_LAYER_OBJECTS);
        o.userData.groundTarget = this;
      }
    });
    if (this.def.moving) {
      this.course = this.rng.float(0, TAU);
      this.speed = opts.speed || 7;
    }
  }

  buildMesh() {
    const m = materials();
    const g = this.group;
    const add = (geo, mat, y = 0, name = '') => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = y;
      if (name) mesh.name = name;
      g.add(mesh);
      return mesh;
    };
    switch (this.type) {
      case 'radar': {
        add(makeRadarStationGeometry(), m.concrete, 0);
        const dishGeo = new THREE.SphereGeometry(5.5, 14, 8, 0, Math.PI, 0, Math.PI * 0.42);
        this.dish = add(dishGeo, m.metal, 11);
        this.dish.rotation.x = Math.PI / 2;
        this.dish.name = 'dish';
        break;
      }
      case 'sam': {
        add(makeSAMLauncherGeometry(), m.green, 0);
        this.launcher = add(new THREE.BoxGeometry(3.2, 1.4, 6.4), m.metalDark, 4.2, 'launcher');
        this.launcher.rotation.x = -0.35;
        this.rails = [];
        for (let i = 0; i < 4; i++) {
          const rail = add(new THREE.CylinderGeometry(0.35, 0.35, 6.0, 8), m.metal, 4.6, 'rail');
          rail.rotation.x = Math.PI / 2 - 0.35;
          rail.position.set((i % 2 ? 1 : -1) * 0.8, 4.6, (i < 2 ? 1 : -1) * 0.9);
          this.rails.push(rail);
        }
        break;
      }
      case 'aaa': {
        add(makeAAGunGeometry(), m.green, 0);
        this.turret = add(new THREE.CylinderGeometry(1.6, 1.8, 1.2, 10), m.metalDark, 2.6, 'turret');
        this.barrels = [];
        for (let i = 0; i < 2; i++) {
          const b = add(new THREE.CylinderGeometry(0.18, 0.2, 5.2, 8), m.metalDark, 3.0, 'barrel');
          b.rotation.x = Math.PI / 2 - 0.5;
          b.position.set((i ? 0.45 : -0.45), 3.0, 1.6);
          this.barrels.push(b);
        }
        break;
      }
      case 'hangar': {
        const body = add(new THREE.BoxGeometry(34, 12, 24), m.concreteDark, 6, 'hangarBody');
        const roof = add(new THREE.CylinderGeometry(17, 17, 24, 12, 1, false, 0, Math.PI), m.concrete, 12, 'hangarRoof');
        roof.rotation.z = Math.PI / 2;
        roof.rotation.y = 0;
        roof.scale.set(1, 1, 0.42);
        add(new THREE.BoxGeometry(36, 1.2, 26), m.concrete, 12.5, 'hangarLip');
        break;
      }
      case 'depot': {
        add(makeDepotGeometry(this.rng, 5), m.concreteDark, 0);
        this.tanks = [];
        for (let i = 0; i < 4; i++) {
          const t = add(makeFuelTankGeometry(5, 9), m.tank, 0, 'tank');
          t.position.set((i % 2 ? 1 : -1) * 7, 0, (i < 2 ? 1 : -1) * 7);
          this.tanks.push(t);
        }
        break;
      }
      case 'fuelTank': {
        add(makeFuelTankGeometry(7, 12), m.tank, 0, 'tank');
        add(new THREE.CylinderGeometry(7.2, 7.2, 0.5, 14), m.hazard, 12.2);
        break;
      }
      case 'bridge': {
        add(makeBridgeGeometry(this.rng.float(60, 120), 11), m.concrete, 0);
        break;
      }
      case 'ship': {
        const ship = add(makeShipGeometry(this.rng, 'destroyer'), m.ship, 0, 'hull');
        this.mast = add(new THREE.CylinderGeometry(0.5, 0.5, 12, 8), m.metal, 18, 'mast');
        this.vls = add(new THREE.BoxGeometry(4, 1.2, 8), m.metalDark, 6, 'vls');
        break;
      }
      case 'command': {
        add(makeBuildingGeometry(this.rng, 2), m.concrete, 0);
        add(new THREE.BoxGeometry(30, 2, 22), m.concreteDark, 9);
        for (let i = 0; i < 3; i++) {
          const a = add(new THREE.CylinderGeometry(0.25, 0.3, 8, 6), m.metal, 11, 'antenna');
          a.position.x = (i - 1) * 6;
        }
        break;
      }
      default: {
        add(makeBuildingGeometry(this.rng, 0), m.concrete, 0);
      }
    }
  }

  get healthFrac() { return clamp01(this.health / this.maxHealth); }

  damage(amount, world, point) {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.destroy(world);
    } else if (amount > 40 && world && world.particles) {
      world.particles.impact(point || this.pos, { x: 0, y: 1, z: 0 }, 1.2, true);
    }
  }

  destroy(world) {
    if (this.dead) return;
    this.dead = true;
    const big = this.type === 'depot' || this.type === 'fuelTank' || this.type === 'ship' || this.type === 'command';
    const scale = big ? 3.4 : 2.0;
    if (world) {
      world.particles.explosion(_v.copy(this.pos).add(_v2.set(0, this.height * 0.4, 0)), scale, { shockwave: true, dust: true });
      world.audio.explosion(this.pos, scale * 0.8, world.listenerPos);
      if (this.def.chained) {
        // chain reaction
        for (const t of (world.targets || [])) {
          if (t.dead || t === this) continue;
          if (!t.def.chained && t.type !== 'depot') continue;
          const d = t.pos.distanceTo(this.pos);
          if (d < 120) {
            t.chainTimer = this.rng.float(0.25, 1.4) + d * 0.004;
          }
        }
      }
      if (world.game) world.game.onGroundTargetDestroyed(this);
    }
    this.group.visible = false;
  }

  update(dt, world) {
    if (this.dead) return;
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) { this.destroy(world); return; }
    }
    const frac = this.healthFrac;
    // burning when damaged
    if (frac < 0.75) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0 && world.particles) {
        this.smokeTimer = lerp(0.5, 0.08, 1 - frac);
        world.particles.alpha.spawn({
          x: this.pos.x + this.rng.float(-3, 3), y: this.pos.y + this.height * 0.6, z: this.pos.z + this.rng.float(-3, 3),
          vx: this.rng.float(-1, 1), vy: this.rng.float(4, 9), vz: this.rng.float(-1, 1),
          size: 3.5, grow: 9, r: frac < 0.35 ? 0.1 : 0.22, g: 0.1, b: 0.1, a: 0.5,
          life: this.rng.float(3, 6), sprite: 2, drag: 0.8, gravity: -0.8, fadePow: 1.1
        });
      }
      if (frac < 0.4 && this.rng.float(0, 1) < dt * 4 && world.particles) {
        world.particles.alpha.spawn({
          x: this.pos.x, y: this.pos.y + this.height * 0.5, z: this.pos.z,
          size: 1.6, grow: 2.5, r: 1, g: 0.6, b: 0.2, a: 0.7,
          life: 0.3, sprite: 1, drag: 3, fadePow: 1
        });
      }
    }
    // ---- ship movement
    if (this.def.moving && world.groundHeight) {
      const nx = this.pos.x + Math.sin(this.course) * this.speed * dt;
      const nz = this.pos.z + Math.cos(this.course) * this.speed * dt;
      const gh = world.groundHeight(nx, nz);
      if (gh > -6) { this.course += this.rng.float(0.3, 1.2); }
      else { this.pos.x = nx; this.pos.z = nz; }
      this.group.position.copy(this.pos);
      this.group.rotation.z = Math.sin(world.time * 0.6 + this.pos.x * 0.01) * 0.03;
      this.group.position.y = this.pos.y + Math.sin(world.time * 0.5 + this.pos.z * 0.02) * 1.4;
    }
    // ---- weapons
    if (this.def.range) this._engageAir(dt, world);
    // ---- animate
    if (this.dish) this.dish.rotation.y += dt * 0.6;
    if (this.turret && this.aimYaw !== undefined) this.turret.rotation.y = this.aimYaw;
  }

  _engageAir(dt, world) {
    if (this.team === 'blue') return;
    if (this.reload > 0) this.reload -= dt;
    // acquire the closest enemy aircraft
    if (!this.target || !this.target.fm.alive || this.target.fm.pos.distanceTo(this.pos) > this.def.range * 1.2) {
      let best = null, bestD = Infinity;
      for (const a of world.aircraft) {
        if (!a.fm.alive || a.faction === this.team) continue;
        const d = a.fm.pos.distanceTo(this.pos);
        // low-flying aircraft are much easier to spot
        const alt = a.fm.pos.y - Math.max(0, world.groundHeight(a.fm.pos.x, a.fm.pos.z));
        const eff = d * (alt > 2500 ? 1.6 : 1.0);
        if (eff < bestD && d < this.def.range * 1.2) { bestD = eff; best = a; }
      }
      this.target = best;
      this.lockTimer = 0;
    }
    if (!this.target) return;
    const d = this.target.fm.pos.distanceTo(this.pos);
    if (d > this.def.range) { this.target = null; return; }
    // aim the launcher / turret
    _v.copy(this.target.fm.pos).sub(this.pos);
    this.aimYaw = Math.atan2(_v.x, _v.z);
    if (this.launcher) {
      const pitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      this.launcher.rotation.x = -clamp(pitch, -0.1, 1.2);
    }
    if (this.type === 'sam' || this.type === 'ship') {
      this.lockTimer += dt * (1 / (this.def.lockTime || 3));
      if (this.lockTimer > 1 && this.reload <= 0 && this.ammo > 0) {
        this.ammo--;
        this.reload = this.def.reload;
        this.lockTimer = 0;
        _v2.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
        _v3.copy(this.target.fm.pos).sub(_v2).normalize();
        _v3.y += 0.55;
        _v3.normalize();
        const type = this.type === 'ship' ? 'patriot' : 'sam';
        world.projectiles.spawnMissile(this, type, _v2, _v3, this.target, this.team);
        world.audio.missileLaunch(0.9);
        world.particles.smokeTrail(_v2, 1.6, 0.75, 1.6, _v3);
        if (world.game) world.game.onSamLaunch(this, this.target);
      }
    } else if (this.type === 'aaa') {
      if (this.reload > 0) return;
      const dist = d;
      if (dist > this.def.range) return;
      this.reload = this.def.reload;
      // lead the target crudely, then miss by a random cone
      const lead = dist / 900;
      _v2.copy(this.target.fm.pos).addScaledVector(this.target.fm.vel, lead).sub(_v.set(this.pos.x, this.pos.y + this.height, this.pos.z));
      const dist2 = _v2.length();
      _v2.multiplyScalar(1 / dist2);
      const spread = 0.02 + 0.055 * clamp01((dist - 600) / 2200);
      _v2.x += this.rng.float(-1, 1) * spread;
      _v2.y += this.rng.float(-1, 1) * spread;
      _v2.z += this.rng.float(-1, 1) * spread;
      _v2.normalize();
      _v.set(this.pos.x, this.pos.y + this.height, this.pos.z);
      world.projectiles.spawnBullet(this, _v, _v2, 900, 14, this.team, { life: 3.4 });
    }
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
}
