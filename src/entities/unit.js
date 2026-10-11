// An aircraft in the world: flight model + visual + damage + weapons state.
// Used for the player, allies, enemies and bombers. Implements the target interface used by combat.
import * as THREE from 'three';
import { FlightModel } from '../physics/flight.js';
import { AIRCRAFT, ENEMY_TYPES } from '../physics/aircraft-data.js';
import { buildAircraft, updateAircraftVisual } from './aircraft-models.js';

export class Unit {
  constructor({ spec, team, name, pos, heading = 0, speed = 0, colors, renderer, scene, isPlayer = false, layer = 0, loadout = {} }) {
    this.spec = spec;
    this.team = team;            // 'player' | 'ally' | 'enemy'
    this.name = name;
    this.kind = 'air';
    this.isPlayer = isPlayer;
    this.fm = new FlightModel(spec, pos, heading);
    this.fm.vel.set(0, 0, 0);
    const f = this.fm.forward(new THREE.Vector3());
    this.fm.vel.copy(f).multiplyScalar(speed);
    this.hpMax = spec.hp;
    this.hp = spec.hp;
    this.radius = Math.max(spec.wingArea ? 7 : 5, 6);
    this.alive = true;
    this.damage = { wingL: 0, wingR: 0, engine: 0, fuselage: 0 };
    this.hitCount = 0;
    this.lastAttacker = null;
    this.vis = buildAircraft(spec.model || spec.id, colors, renderer);
    this.root = this.vis.root;
    this.root.traverse((o) => { if (o.isMesh || o.isSprite) o.layers.set(layer); });
    scene.add(this.root);
    this.ammo = loadout.ammo ?? spec.ammo ?? 0;
    this.missiles = { ir: loadout.ir ?? spec.missiles?.ir ?? 0, radar: loadout.radar ?? spec.missiles?.radar ?? 0 };
    this.rockets = loadout.rockets ?? spec.rockets ?? 0;
    this.bombs = loadout.bombs ?? spec.bombs ?? 0;
    this.flares = loadout.flares ?? spec.flares ?? 0;
    this.chaff = loadout.chaff ?? spec.chaff ?? 0;
    this.gunTrigger = false;
    this.gunSpin = 0; this.spinUp = 0.25; this.gunCooldown = 0;
    this.radarLockTarget = null;
    this.missileBoost = 1;
    this.stats = isPlayer ? { shots: 0, hits: 0, missilesFired: 0, damageTaken: 0, kills: 0 } : null;
    this.controls = { pitch: 0, roll: 0, yaw: 0 };
    this.lightsOn = true;
    this.landingLight = false;
    this.afterburnerAmount = 0;
    this.gearCmd = 1;
    this.flapsCmd = 0;
    this.smokeT = 0;
    this.fireT = 0;
    this.time = 0;
    this.sparkT = 0;
    this.vaporT = 0;
    this.lockedBy = [];
  }

  get pos() { return this.fm.pos; }
  get vel() { return this.fm.vel; }
  get quat() { return this.fm.quat; }
  get radiusM() { return this.radius; }

  // Damage distribution: wing hits hit the nearest wing, engine hits when from behind.
  applyDamage(amount, info = {}) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hitCount++;
    if (this.stats) this.stats.damageTaken += amount;
    const r = Math.random();
    const s = amount / this.hpMax;
    if (info.kind === 'missile' || info.kind === 'splash' || info.kind === 'gun') {
      if (r < 0.3) this.damage.wingL = Math.min(1, this.damage.wingL + s * 2.4);
      else if (r < 0.6) this.damage.wingR = Math.min(1, this.damage.wingR + s * 2.4);
      else if (r < 0.8) this.damage.engine = Math.min(1, this.damage.engine + s * 2.2);
      else this.damage.fuselage = Math.min(1, this.damage.fuselage + s * 2.2);
    }
    this.fm.liftMul = 1 - 0.35 * Math.min(1, Math.max(this.damage.wingL, this.damage.wingR));
    this.fm.thrustMul = 1 - 0.7 * Math.max(0, this.damage.engine - 0.5) * 2;
    this.fm.controlMul = 1 - 0.3 * Math.max(this.damage.wingL, this.damage.wingR);
    if (this.hp <= 0) this.alive = false;
  }

  // Unified world damage interface.
  takeDamage(amount, source, info) { this.applyDamage(amount, info); return this.alive; }

  // Per-frame visual sync and smoke state. Called after the flight step.
  syncVisual(dt, time, skyBright = 0.5) {
    this.time = time;
    this.root.position.copy(this.fm.pos);
    this.root.quaternion.copy(this.fm.quat);
    const afterTarget = this.afterburner ? 1 : 0;
    this.afterburnerAmount += (afterTarget * (this.fm.throttle > 0.9 ? 1 : 0) - this.afterburnerAmount) * Math.min(1, dt * 6);
    updateAircraftVisual(this.vis, {
      dt, time,
      controls: this.controls,
      gear: this.fm.gear, flaps: this.fm.flaps,
      throttle: this.fm.throttle,
      afterburnerAmount: this.afterburnerAmount,
      lightsOn: this.lightsOn, landingLight: this.landingLight,
      damage: this.damage,
      skyBright,
      prop: !!this.spec.propPower,
    });
    this.vis.root.visible = this.alive || this.fireT > 0;
  }

  setLayer(layer) { this.root.traverse((o) => { if (o.isMesh || o.isSprite) o.layers.set(layer); }); }
  dispose(scene) { scene.remove(this.root); this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
}

// Factory helpers for enemy types.
export function enemySpec(key) {
  return ENEMY_TYPES[key] ? { maxSpeed: 600, ...ENEMY_TYPES[key], id: key, missiles: { ir: 4, radar: 1 }, ammo: 300, flares: 30, chaff: 15, rockets: 0, bombs: 0 } : null;
}

export { AIRCRAFT };
