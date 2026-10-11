// Enemy and allied AI pilots: patrol, engage, evade, retreat, formations, scripted maneuvers.
import * as THREE from 'three';
import { clamp } from '../core/noise.js';
import { angleTo, WEAPON_STATS } from '../combat/weapons.js';

export const SKILLS = {
  rookie: { reaction: 1.6, aimNoise: 0.09, fireCone: 0.07, missileChance: 0.12, evade: 0.3, maneuver: 0.25, throttleMul: 0.9, detect: 8000 },
  ace:    { reaction: 0.3, aimNoise: 0.02, fireCone: 0.05, missileChance: 0.6, evade: 0.9, maneuver: 0.85, throttleMul: 1.05, detect: 12000 },
  leader: { reaction: 0.6, aimNoise: 0.03, fireCone: 0.06, missileChance: 0.45, evade: 0.7, maneuver: 0.7, throttleMul: 1.0, detect: 11000 },
  wingman:{ reaction: 0.9, aimNoise: 0.05, fireCone: 0.06, missileChance: 0.3, evade: 0.6, maneuver: 0.55, throttleMul: 1.0, detect: 9000 },
};

const _tb = new THREE.Vector3(), _q = new THREE.Quaternion(), _inv = new THREE.Quaternion();

// Steering: convert a world point into stick inputs for the flight model.
export function steer(unit, point, gain = 1) {
  _inv.copy(unit.fm.quat).invert();
  _tb.copy(point).sub(unit.fm.pos).applyQuaternion(_inv);
  const elev = Math.atan2(_tb.y, -_tb.z);
  const az = Math.atan2(_tb.x, -_tb.z);
  const bankCur = -unit.fm.rollDeg() * Math.PI / 180;
  const bankDes = clamp(az * 1.6, -2.5, 2.5);
  const roll = clamp((bankDes - bankCur) * 2.6, -1, 1);
  const pitch = clamp(elev * 2.4 * gain, -1, 1);
  const yaw = clamp(az * 0.6, -0.5, 0.5);
  return { pitch, roll, yaw };
}

// Scripted maneuvers. Each returns {pitch, roll, throttle} for elapsed time t.
const MANEUVERS = {
  immelmann: (t) => (t < 1.4 ? { pitch: 1, roll: 0 } : t < 2.1 ? { pitch: 0, roll: 1 } : t < 3.5 ? { pitch: 0.8, roll: 0 } : t < 4.2 ? { pitch: 0, roll: -1 } : null),
  splitS: (t) => (t < 0.85 ? { pitch: 0, roll: 1 } : t < 3.0 ? { pitch: 1, roll: 0 } : t < 3.6 ? { pitch: 0, roll: -1 } : null),
  barrelRoll: (t, d) => (t < 1.5 ? { pitch: 0.35 * d, roll: d } : null),
  breakTurn: (t, d) => (t < 0.9 ? { pitch: 0.3, roll: d } : t < 2.4 ? { pitch: 1, roll: 0 } : null),
  scissors: (t, d) => { const ph = Math.floor(t / 1.1); if (t > 4.4) return null; return { pitch: 0.4, roll: ph % 2 === 0 ? d : -d }; },
};

export class AIPilot {
  constructor(unit, opts) {
    this.u = unit;
    this.skill = SKILLS[opts.skill || 'rookie'];
    this.skillName = opts.skill || 'rookie';
    this.role = opts.role || 'fighter';       // fighter | wingman | bomber | boss | drone | ally | transport
    this.state = opts.state || 'patrol';      // patrol | engage | evade | retreat | attack | escort | ferry
    this.target = null;
    this.reactT = this.skill.reaction;
    this.leader = opts.leader || null;
    this.slot = opts.slot || new THREE.Vector3(-160, 0, 180);
    this.waypoints = opts.waypoints || null;
    this.wpIndex = 0;
    this.cruise = opts.cruise || 220;
    this.altBand = opts.alt || 1500;
    this.maneuver = null;
    this.manT = 0;
    this.manDir = 1;
    this.fireBurst = 0;
    this.fireRest = 0;
    this.missileCD = 4 + Math.random() * 4;
    this.retreatT = 0;
    this.bombCD = 2;
    this.evadeCool = 0;
    this.bossPattern = { phase: 0, t: 0 };
    this.calledOut = false;
    this.home = opts.home ? opts.home.clone() : new THREE.Vector3(0, 1500, 0);
    this.escort = opts.escort || null;       // unit to protect (transport)
    this.attackPoint = opts.attackPoint || null;
    this.dropped = false;
    this.roundsSinceCalled = 0;
  }

  get fm() { return this.u.fm; }

  // Choose a hostile target: nearest alive unit from the given list within detection range.
  pickTarget(hostiles) {
    let best = null, bd = Infinity;
    for (const h of hostiles) {
      if (!h.alive) continue;
      const d = h.pos.distanceTo(this.u.pos);
      if (d < bd && d < this.skill.detect) { bd = d; best = h; }
    }
    return best;
  }

  // ctx: { hostiles: Unit[], allies: Unit[], incoming: Missile[], terrain: fn(x,z), combat, dt, time, fx, audio }
  update(dt, ctx) {
    const u = this.u;
    if (!u.alive) return;
    const fm = u.fm;
    this.evadeCool -= dt;
    this.missileCD -= dt;
    this.reactT -= dt;
    // Target maintenance.
    if (!this.target || !this.target.alive) this.target = this.pickTarget(ctx.hostiles);
    if (this.role === 'bomber' || this.role === 'drone' || this.role === 'transport') {
      // Non-combat aircraft do not dogfight.
    }

    // Damage triggers retreat for fighters.
    const hpFrac = u.hp / u.hpMax;
    if (this.state !== 'retreat' && hpFrac < 0.28 && this.role === 'fighter' || (this.state !== 'retreat' && hpFrac < 0.25 && this.role === 'wingman')) {
      this.state = 'retreat';
      this.retreatT = 0;
    }

    // Incoming missile: evade and dispense countermeasures.
    const threat = this.nearestThreat(ctx.incoming);
    if (threat && this.evadeCool <= 0 && this.role !== 'transport' && this.role !== 'drone') {
      const dist = threat.pos.distanceTo(u.pos);
      if (threat.kind === 'ir' && dist < 2600 && u.flares > 0 && Math.random() < 0.035 + this.skill.evade * 0.1) ctx.combat.deployFlares(u, 4);
      if (dist < 5000 && Math.random() < this.skill.evade) {
        const dir = Math.sign(this.signedAzimuth(threat.pos)) || 1;
        this.startManeuver(Math.random() < 0.5 ? 'breakTurn' : 'barrelRoll', dir);
        this.evadeCool = 4;
      }
      if (this.state === 'engage' && Math.random() < 0.5 * this.skill.evade) this.state = 'evade';
    }
    if (this.state === 'evade' && this.evadeCool < 1.5 && !this.maneuver) this.state = 'engage';

    // Compute inputs by state.
    let inp = { pitch: 0, roll: 0, yaw: 0 };
    let throttle = 0.75;
    let aim = null;
    let afterburner = false;
    const alive = ctx.hostiles.some((h) => h.alive);

    if (this.role === 'boss') {
      ({ inp, throttle, aim } = this.bossBrain(dt, ctx));
    } else if (this.state === 'retreat') {
      this.retreatT += dt;
      const away = fm.pos.clone().sub(this.target ? this.target.pos : this.home).setY(0);
      if (away.lengthSq() < 1) away.set(1, 0, 0);
      const pt = fm.pos.clone().add(away.normalize().multiplyScalar(4000)).setY(Math.max(this.altBand, fm.pos.y));
      inp = steer(u, pt, 0.8);
      throttle = 1; afterburner = true;
      if (Math.random() < dt * 14) ctx.fx.smokePuff(u.pos.clone().addScaledVector(fm.forward(_tb.clone()), -8), new THREE.Vector3(0, 2, 0), 1.1, true, 12);
      if (this.retreatT > 60 || u.pos.length() > 26000) { u.alive = false; u.escaped = true; }
    } else if (this.state === 'evade' && this.maneuver) {
      // Maneuver executes below.
    } else if (this.role === 'bomber') {
      const tgt = this.attackPoint || this.home;
      inp = steer(u, tgt.clone().setY(this.altBand), 1);
      throttle = 0.85;
      const d = u.pos.distanceTo(tgt);
      this.bombCD -= dt;
      if (d < 700 && this.bombCD <= 0 && u.bombs > 0 && !this.dropped) { ctx.combat.dropBomb(u); this.bombCD = 1.2; if (u.bombs <= 0) this.dropped = true; }
      if (d < 500) this.attackPoint = null;
    } else if (this.role === 'drone') {
      const wp = this.waypoints ? this.waypoints[this.wpIndex % this.waypoints.length] : this.home;
      inp = steer(u, wp.clone().setY(this.altBand), 1);
      if (u.pos.distanceTo(wp) < 400 && this.waypoints) this.wpIndex++;
      throttle = 0.7;
    } else if (this.role === 'transport') {
      const wp = this.waypoints ? this.waypoints[this.wpIndex % this.waypoints.length] : this.home;
      inp = steer(u, wp.clone().setY(this.altBand), 1);
      if (u.pos.distanceTo(wp) < 500 && this.waypoints) this.wpIndex++;
      throttle = 0.5;
      this.cruise = 110;
    } else if (this.state === 'engage' && this.target && alive) {
      if (this.reactT <= 0) {
        // Lead the target (pursuit curve with a small random aim error).
        const t = this.target;
        const dist = t.pos.distanceTo(u.pos);
        const leadT = Math.min(dist / 500, 4);
        const aimPt = t.pos.clone().addScaledVector(t.vel, leadT);
        aimPt.x += (Math.random() - 0.5) * this.skill.aimNoise * dist;
        aimPt.y += (Math.random() - 0.5) * this.skill.aimNoise * dist;
        inp = steer(u, aimPt, 1);
        // Very close: unload to avoid overshoot.
        if (dist < 350 && Math.abs(angleTo(u, t.pos)) > 1.2) inp.pitch = clamp(inp.pitch, -0.2, 1);
        throttle = clamp(0.6 + (dist - 1500) / 9000, 0.35, 1) * this.skill.throttleMul;
        afterburner = dist > 3000 && this.role !== 'wingman';
        aim = aimPt;
        this.weaponsEngage(dt, ctx, t, dist);
      } else {
        // Reacting to new threat: fly toward the target without firing.
        inp = steer(u, this.target.pos, 0.5);
        throttle = 0.8;
      }
    } else if (this.leader && this.leader.alive && this.role === 'wingman') {
      // Formation: hold a slot relative to the leader's orientation.
      const slot = this.slot.clone().applyQuaternion(this.leader.quat).add(this.leader.pos);
      inp = steer(u, slot, 1.2);
      const dd = u.pos.distanceTo(slot);
      throttle = clamp(0.6 + dd / 1500, 0.4, 1);
      afterburner = dd > 800;
    } else {
      // Patrol along waypoints around a center.
      const wp = this.waypoints ? this.waypoints[this.wpIndex % this.waypoints.length] : this.home;
      if (this.waypoints && u.pos.distanceTo(wp) < 700) this.wpIndex++;
      inp = steer(u, wp.clone().setY(this.altBand), 1);
      throttle = 0.65;
      if (this.target && this.target.alive && this.target.pos.distanceTo(u.pos) < this.skill.detect * 0.6 && this.reactT <= 0) {
        this.state = 'engage';
        this.reactT = this.skill.reaction;
      }
    }

    // Scripted maneuvers override the stick.
    if (this.maneuver) {
      this.manT += dt;
      const m = MANEUVERS[this.maneuver](this.manT, this.manDir);
      if (!m) { this.maneuver = null; } else {
        inp = { pitch: m.pitch, roll: m.roll, yaw: 0 };
      }
    }
    // Random ace maneuvers when fighting and with good energy.
    if (this.state === 'engage' && !this.maneuver && this.target && this.skill.maneuver > 0.5 && Math.random() < dt * 0.05 * this.skill.maneuver) {
      const d = this.target.pos.distanceTo(u.pos);
      const aspect = angleTo(this.target, u.pos);   // how behind the target we are
      if (aspect < 0.6 && d < 1500) this.startManeuver(Math.random() < 0.5 ? 'scissors' : 'barrelRoll', 1);
      else if (this.target.pos.y > u.pos.y + 500 && d < 3500) this.startManeuver('immelmann', 1);
      else if (this.target.pos.y < u.pos.y - 300 && d < 3500 && fm.airspeed > 200) this.startManeuver('splitS', 1);
    }

    // Ground and stall protection (predictive), overriding unless a maneuver is essential.
    const lookAhead = u.pos.clone().addScaledVector(fm.vel, 6);
    const gh = ctx.terrain(lookAhead.x, lookAhead.z);
    if (lookAhead.y < gh + 260 || (fm.pos.y < gh + 200 && fm.vel.y < -5)) {
      inp.pitch = Math.max(inp.pitch, 1);
      inp.roll = clamp(inp.roll * 0.3, -0.3, 0.3);
      throttle = 1; afterburner = true;
    }
    if (fm.airspeed < fm.stallV * 1.15 && !fm.onGround) { inp.pitch = Math.min(inp.pitch, -0.2); throttle = 1; }

    // Throttle and afterburner.
    fm.throttle += (clamp(throttle, 0, 1) - fm.throttle) * Math.min(1, dt * 2);
    u.afterburner = afterburner && fm.throttle > 0.9 && u.fuel !== 0;
    u.controls = { pitch: inp.pitch, roll: inp.roll, yaw: inp.yaw };
    u.aiAim = aim;
    this.inputs = inp;
    if (this.role === 'boss') return;
    if (!this.maneuver && this.state === 'patrol') { /* keep */ }
  }

  signedAzimuth(point) {
    const tb = point.clone().sub(this.u.pos).applyQuaternion(this.u.fm.quat.clone().invert());
    return Math.atan2(tb.x, -tb.z);
  }

  nearestThreat(list) {
    if (!list || !list.length) return null;
    let best = null, bd = Infinity;
    for (const m of list) {
      if (!m.alive || m.target !== this.u) continue;
      const d = m.pos.distanceTo(this.u.pos);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  startManeuver(name, dir) {
    this.maneuver = name;
    this.manT = 0;
    this.manDir = dir;
  }

  weaponsEngage(dt, ctx, t, dist) {
    const u = this.u;
    const ang = angleTo(u, t.pos);
    // Guns: short bursts when lined up.
    this.fireRest -= dt;
    if (ang < this.skill.fireCone && dist < 900 && u.ammo > 0 && this.fireRest <= 0) {
      this.fireBurst += dt;
      u.gunTrigger = true;
      if (this.fireBurst > 0.7) { this.fireBurst = 0; this.fireRest = 0.9; u.gunTrigger = false; }
    } else {
      u.gunTrigger = false;
    }
    // Missiles: IR inside envelope, radar when far and nose-on.
    if (this.missileCD <= 0 && Math.random() < dt * this.skill.missileChance * 2) {
      if (dist > 2200 && dist < WEAPON_STATS.irRange && ang < 0.25 && u.missiles.ir > 0 && !t.isBomber) {
        const m = ctx.combat.fireMissile(u, t, 'ir');
        if (m) this.missileCD = 9 + Math.random() * 6;
      } else if (this.skill.missileChance > 0.4 && dist > 7000 && dist < WEAPON_STATS.radarRange && ang < 0.3 && u.missiles.radar > 0) {
        u.radarLockTarget = t;
        const m = ctx.combat.fireMissile(u, t, 'radar');
        if (m) this.missileCD = 14;
      }
    }
  }

  bossBrain(dt, ctx) {
    const u = this.u;
    const fm = u.fm;
    const p = this.bossPattern;
    p.t += dt;
    const t = this.target;
    let inp = { pitch: 0, roll: 0, yaw: 0 };
    let throttle = 0.9;
    let aim = null;
    if (!t) {
      inp = steer(u, this.home.clone().setY(this.altBand), 1);
      return { inp, throttle, aim };
    }
    const dist = t.pos.distanceTo(u.pos);
    const phases = ['pursue', 'barrage', 'strafe', 'pursue', 'dive'];
    const name = phases[p.phase % phases.length];
    if (p.t > (name === 'barrage' ? 3.5 : name === 'strafe' ? 3.2 : name === 'dive' ? 3.0 : 5.0)) {
      p.phase++; p.t = 0;
    }
    if (name === 'pursue') {
      inp = steer(u, t.pos, 1);
    } else if (name === 'barrage') {
      inp = steer(u, t.pos.clone().add(new THREE.Vector3(0, 300, 0)), 1);
      if (p.t < 0.2 || (p.t > 0.8 && p.t < 0.9) || (p.t > 1.6 && p.t < 1.7) || (p.t > 2.4 && p.t < 2.5)) {
        if (u.missiles.ir > 0 && dist < 6500) ctx.combat.fireMissile(u, t, 'ir');
      }
    } else if (name === 'strafe') {
      inp = steer(u, t.pos.clone().addScaledVector(t.vel, 1), 1);
      u.gunTrigger = dist < 2200 && u.ammo > 0;
      aim = t.pos;
    } else if (name === 'dive') {
      inp = steer(u, t.pos.clone().setY(t.pos.y - 400), 1);
      inp.pitch = clamp(inp.pitch * 1.4, -1, 1);
      throttle = 1; u.afterburner = true;
    }
    if (name !== 'strafe') u.gunTrigger = false;
    // Ensure it keeps moving fast.
    if (fm.airspeed < 180) throttle = 1;
    return { inp, throttle, aim };
  }
}

// Formation helper: given a leader unit, create wingman AIs in V-shaped slots.
export function formationSlots(n) {
  const slots = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2) + 1;
    slots.push(new THREE.Vector3(side * 180 * row, (i % 2 ? -10 : 10), 200 * row));
  }
  return slots;
}
