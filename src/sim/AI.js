// ---------------------------------------------------------------------------
// AI — enemy / friendly pilots with patrol, engage, evade, retreat and ground
// attack behaviour, named manoeuvres, formation discipline, radio callouts.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, RNG, TAU, G0, airDensity } from '../core/Utils.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const DIFFICULTY = {
  rookie: {
    name: 'ROOKIE', reaction: 0.55, aimGain: 1.1, gunRange: 1000, gunAngle: 0.09,
    burstLen: 0.7, burstPause: 0.75,
    missileRange: 2600, missileAngle: 0.35, missileCooldown: 14, flareChance: 0.35,
    energy: 0.45, gTolerance: 0.55, accuracy: 0.35, aggressiveness: 0.55, evasiveSkill: 0.3
  },
  veteran: {
    name: 'VETERAN', reaction: 0.3, aimGain: 1.8, gunRange: 1400, gunAngle: 0.07,
    burstLen: 0.95, burstPause: 0.55,
    missileRange: 4200, missileAngle: 0.5, missileCooldown: 9, flareChance: 0.65,
    energy: 0.7, gTolerance: 0.8, accuracy: 0.62, aggressiveness: 0.75, evasiveSkill: 0.6
  },
  ace: {
    name: 'ACE', reaction: 0.16, aimGain: 2.6, gunRange: 1800, gunAngle: 0.055,
    burstLen: 1.25, burstPause: 0.4,
    missileRange: 6000, missileAngle: 0.62, missileCooldown: 6.5, flareChance: 0.9,
    energy: 0.88, gTolerance: 0.95, accuracy: 0.82, aggressiveness: 0.9, evasiveSkill: 0.85
  },
  leader: {
    name: 'SQUADRON LEADER', reaction: 0.11, aimGain: 3.0, gunRange: 2000, gunAngle: 0.045,
    burstLen: 1.4, burstPause: 0.35,
    missileRange: 7500, missileAngle: 0.7, missileCooldown: 5.5, flareChance: 0.98,
    energy: 0.95, gTolerance: 1.0, accuracy: 0.9, aggressiveness: 1.0, evasiveSkill: 0.95
  }
};

const MANEUVERS = {
  'SPLIT-S': { dur: 4.5, desc: 'Split-S' },
  'IMMELMANN': { dur: 5.0, desc: 'Immelmann' },
  'BARREL ROLL': { dur: 3.6, desc: 'Barrel Roll' },
  'BREAK TURN': { dur: 3.0, desc: 'Break Turn' },
  'HIGH YO-YO': { dur: 4.2, desc: 'High Yo-Yo' },
  'LOW YO-YO': { dur: 3.8, desc: 'Low Yo-Yo' },
  'SCISSORS': { dur: 4.5, desc: 'Scissors' },
  'DEFENSIVE SPIRAL': { dur: 5.5, desc: 'Defensive Spiral' },
  'ZOOM CLIMB': { dur: 4.0, desc: 'Zoom Climb' },
  'CUBAN EIGHT': { dur: 7.0, desc: 'Cuban Eight' },
  'BOOM AND ZOOM': { dur: 9.0, desc: 'Boom and Zoom' },
  'LAG PURSUIT': { dur: 6.0, desc: 'Lag Pursuit' },
  'DIVING ATTACK': { dur: 6.0, desc: 'Diving Attack' },
  'DEFENSIVE BREAK': { dur: 3.5, desc: 'Defensive Break' }
};

export class AIPilot {
  constructor(aircraft, opts = {}) {
    this.ac = aircraft;
    this.rng = new RNG(opts.seed || (aircraft.rng.int(1, 99999)));
    this.difficulty = typeof opts.difficulty === 'string' ? DIFFICULTY[opts.difficulty] : (opts.difficulty || DIFFICULTY.veteran);
    this.state = 'patrol';
    this.stateTimer = 0;
    this.target = opts.target || null;
    this.groundTarget = null;
    this.homeBase = opts.homeBase || { x: 0, z: 0, y: 1500 };
    this.patrolPoint = new THREE.Vector3(opts.patrolX || 0, 1200, opts.patrolZ || 0);
    this.maneuver = null;
    this.maneuverTimer = 0;
    this.maneuverSide = 1;
    this.reactionTimer = 0;
    this.missileCooldown = this.rng.float(3, 12);
    this.targetSwitchTimer = 0;
    this.lastCallout = 0;
    this.calloutCooldown = 0;
    this.formationRole = opts.formationRole || 'leader';
    this.leader = opts.leader || null;
    this.formationOffset = opts.formationOffset || new THREE.Vector3(0, 0, 0);
    this.avoidTimer = 0;
    this.accuracyOffset = new THREE.Vector3();
    this.aimTimer = 0;
    this.throttleCmd = 0.75;
    this.abCmd = false;
    this.evadeDir = 1;
    this.missileThreat = null;
    this.radarTarget = null;
    this.lastGunBurst = 0;
    this.burstTimer = 0;
    this.gunFiring = false;
    this.brakeCmd = 0;
    this.role = opts.role || 'fighter';
    this.skillLevel = opts.skill !== undefined ? opts.skill : this.difficulty.aggressiveness;
  }

  get fm() { return this.ac.fm; }

  // -----------------------------------------------------------------------
  update(dt, world) {
    const ac = this.ac, fm = ac.fm;
    this.worldRef = world;
    this.dt = dt;
    const cmd = { pitch: 0, roll: 0, yaw: 0 };
    this.brakeCmd = 0;
    this.attackRun = false;
    this.stateTimer += dt;
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    this.calloutCooldown = Math.max(0, this.calloutCooldown - dt);
    this.avoidTimer = Math.max(0, this.avoidTimer - dt);
    if (this.maneuverTimer > 0) {
      this.maneuverTimer -= dt;
      if (this.maneuverTimer <= 0) this.maneuver = null;
    }

    if (!fm.alive) {
      ac.setGunFiring(false);
      return cmd;
    }

    // ---- threat / situation awareness
    const threat = ac.incomingMissile(world);
    this.missileThreat = threat;
    this._pickTarget(dt, world);
    const tgt = this.target;
    const tgtDist = tgt && tgt.fm.alive ? fm.pos.distanceTo(tgt.fm.pos) : Infinity;

    // ---- state machine
    switch (this.state) {
      case 'patrol': this._patrol(dt, world, cmd); break;
      case 'engage': this._engage(dt, world, cmd, tgt, tgtDist); break;
      case 'evade': this._evade(dt, world, cmd, threat); break;
      case 'attackGround': this._attackGround(dt, world, cmd); break;
      case 'retreat': this._retreat(dt, world, cmd); break;
      case 'regroup': this._regroup(dt, world, cmd); break;
    }

    // ---- terrain avoidance overrides everything
    this._avoidTerrain(dt, world, cmd);

    // ---- weapons
    this._manageWeapons(dt, world, tgt, tgtDist, threat);

    // ---- engine orders: throttle runs to the commanded setting, afterburner
    //      only when the pilot asked for it and the jet still has fuel
    fm.throttle = lerp(fm.throttle, clamp01(this.throttleCmd), 1 - Math.exp(-dt * 2.0));
    fm.afterburner = !!this.abCmd && fm.throttle > 0.85 && fm.fuel > 0;
    // speed brakes: a turning fight is won at corner speed, and the boards are
    // the only way to get there from 400 m/s
    fm.airbrake = lerp(fm.airbrake, this.brakeCmd > 0.5 ? 1 : 0, 1 - Math.exp(-dt * 2.5));

    // ---- write the command into the aircraft
    ac.update(dt, cmd, world);
    return cmd;
  }

  setState(s, callout) {
    if (this.state === s) return;
    this.state = s;
    this.stateTimer = 0;
    if (callout) this._callout(callout, 1.15);
  }

  // -----------------------------------------------------------------------
  _pickTarget(dt, world) {
    this.targetSwitchTimer -= dt;
    const ac = this.ac, fm = ac.fm;
    // engaged by a missile? target the shooter if we have nothing better
    const threat = this.missileThreat;
    if (threat && (!this.target || !this.target.fm.alive)) {
      const shooter = threat.missile.owner;
      if (shooter && shooter.fm && shooter.fm.alive) this.target = shooter;
    }
    if (this.target && !this.target.fm.alive) this.target = null;
    if (this.target && this.targetSwitchTimer > 0 && fm.alive) return;

    let best = null, bestScore = -Infinity;
    const maxRange = this.role === 'interceptor' ? 18000 : 14000;
    for (const a of world.aircraft) {
      if (!a.fm.alive || a === ac) continue;
      if (a.faction === ac.faction) continue;
      const d = fm.pos.distanceTo(a.fm.pos);
      if (d > maxRange) continue;
      const to = _v.copy(a.fm.pos).sub(fm.pos).normalize();
      const fwd = _v2.set(0, 0, 1).applyQuaternion(fm.quat);
      const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
      let score = 4000 - d - ang * 2600;
      if (a.isPlayer) score += 2600 * (a.faction !== ac.faction ? 1 : 0);
      if (a.hitRadius) score += 200;
      if (this.target === a) score += 900;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    this.target = best;
    this.targetSwitchTimer = this.rng.float(2.5, 6.0) / Math.max(0.4, this.difficulty.aggressiveness);
  }

  _patrol(dt, world, cmd) {
    const fm = this.fm;
    const anchor = this.formationRole !== 'leader' && this.leader && this.leader.fm.alive
      ? _v.copy(this.leader.fm.pos).add(_v2.copy(this.formationOffset).applyQuaternion(this.leader.fm.quat))
      : _v.copy(this.patrolPoint).add(_v2.set(Math.cos(world.time * 0.07) * 2500, Math.sin(world.time * 0.05) * 260, Math.sin(world.time * 0.07) * 2500));
    anchor.y = Math.max(anchor.y, world.groundHeight(anchor.x, anchor.z) + 320);
    this.fightCeiling = 0;                        // transit at altitude is fine
    this._flyTo(cmd, anchor, 0.7);
    // scan for targets
    if (this.target && this.target.fm.alive) {
      const d = fm.pos.distanceTo(this.target.fm.pos);
      const contact = d < (this.role === 'interceptor' ? 14000 : 9000);
      if (contact) {
        this.setState('engage', this.formationRole === 'leader' ? 'CONTACT! ENGAGING' : null);
        if (this.formationRole === 'leader' && world.audio) this._callout('CONTACT, ENGAGING');
      }
    }
    this.throttleCmd = 0.72;
    this.abCmd = false;
  }

  _engage(dt, world, cmd, tgt, dist) {
    const ac = this.ac, fm = ac.fm;
    // a hard-turning fight belongs in thick air
    this.fightCeiling = 7000;
    // ---- disengage conditions
    const hpFrac = ac.health / ac.maxHealth;
    const outOfAmmo = ac.weapons.gun.ammo <= 0 && ac.weapons.aim9.count <= 0 && ac.weapons.aim120.count <= 0 && ac.weapons.archer.count <= 0;
    if (hpFrac < 0.22 || (outOfAmmo && this.stateTimer > 4)) {
      this.setState('retreat', 'I\'M HIT — BREAKING OFF');
      return;
    }
    // missile threat → evade
    if (this.missileThreat && this.missileThreat.distance < 2600) {
      this.setState('evade', 'MISSILE! EVADING');
      return;
    }
    if (!tgt || !tgt.fm.alive) { this.setState('patrol'); return; }

    // ---- energy reset: a slow aircraft that cannot bring its nose to bear
    //      extends straight and level for a few seconds to rebuild energy
    const corner = (this.ac.def && this.ac.def.cornerSpeed) || 155;
    if (!this.extending && fm.speed < corner * 0.95 && (fm.gLoad > 3 || this.rng.float(0, 1) < dt * 0.25)) {
      this.extending = true;
      this.extendTimer = 4.5;
    }
    if (this.extending) {
      this.extendTimer -= dt;
      _v3.copy(fm.vel).normalize();
      if (_v3.y > 0.06) _v3.y = 0.06;
      _v3.normalize();
      this._flyTo(cmd, _v4.copy(fm.pos).addScaledVector(_v3, 3000), 0.8);
      this.throttleCmd = 1;
      this.abCmd = true;
      if (this.extendTimer <= 0 || fm.speed > corner * 1.25) this.extending = false;
      return;
    }

    // ---- choose a manoeuvre
    if (!this.maneuver && this.rng.float(0, 1) < dt * 0.12) this._chooseManeuver(tgt, dist);

    const myEnergy = fm.speed;
    const tgtFwd = _v.copy(tgt.fm.vel).normalize();
    const toTgt = _v2.copy(tgt.fm.pos).sub(fm.pos);
    const d = toTgt.length();
    toTgt.multiplyScalar(1 / Math.max(1e-3, d));
    let desired = _v3;
    let throttle = 0.9;
    let ab = false;

    if (this.maneuver) {
      desired.copy(this._maneuverDir(tgt, toTgt, d));
      throttle = this.maneuver === 'ZOOM CLIMB' || this.maneuver === 'BOOM AND ZOOM' ? 1 : 0.95;
      ab = this.difficulty.energy > 0.6;
    } else if (d > 2200) {
      // ---- intercept: lead the target
      const lead = clamp(d / Math.max(200, fm.speed + 380), 0.2, 3.0);
      desired.copy(tgt.fm.pos).addScaledVector(tgt.fm.vel, lead).sub(fm.pos).normalize();
      throttle = 1.0; ab = d > 4200 && this.difficulty.energy > 0.5;
    } else {
      // ---- dogfight: fly the computed gun lead when we are inside range,
      //      otherwise lag/lead pursuit with energy management
      const tgtBehind = tgtFwd.dot(toTgt) > 0.65;    // target pointing away
      const aspect = toTgt.dot(_v4.set(0, 0, 1).applyQuaternion(tgt.fm.quat));
      // pursuit ladder: fly at the bandit to close, only fly the gun solution
      // once the range is short enough for a shot
      const aimPt = d < this.difficulty.gunRange * 1.9 ? ac.gunAimPoint(world, _v6) : null;
      if (!aimPt && d > this.difficulty.gunRange * 1.9) {
        desired.copy(tgt.fm.pos)
          .addScaledVector(tgt.fm.vel, d > 3500 ? 0 : 0.4)
          .sub(fm.pos).normalize();
        this.throttleCmd = 1;
        this.abCmd = d > 4200;
        return;
      }
      if (aimPt) {
        desired.copy(aimPt).sub(fm.pos).normalize();
        // The gun is bore-sighted: rounds leave along the *nose*, which sits
        // above the flight path by the angle of attack.  Steer the flight path
        // low by tan(aoa)·range so the nose lands on the lead — that is what
        // makes the trigger gate (nose vs solution) satisfiable at all.
        if (d < this.difficulty.gunRange * 1.6) {
          _v5.set(0, 1, 0).applyQuaternion(fm.quat);           // body up
          const off = Math.tan(clamp(fm.aoa, -0.45, 0.45)) * Math.max(300, d);
          desired.multiplyScalar(Math.max(1, d)).addScaledVector(_v5, -off).normalize();
        }
        throttle = myEnergy < 200 ? 1.0 : 0.85;
        ab = myEnergy < 230;
      } else if (aspect < -0.4) {
        // nose-to-nose: pull lead for a gun snapshot
        desired.copy(tgt.fm.pos).addScaledVector(tgt.fm.vel, 0.35).sub(fm.pos).normalize();
      } else if (tgtBehind) {
        // lag pursuit to preserve energy
        desired.copy(tgt.fm.pos).addScaledVector(tgt.fm.vel, -0.35).sub(fm.pos).normalize();
      } else {
        desired.copy(tgt.fm.pos).addScaledVector(tgt.fm.vel, 0.5).sub(fm.pos).normalize();
      }
      throttle = myEnergy < 180 ? 1.0 : (myEnergy > 340 ? 0.72 : 0.9);
      ab = myEnergy < 210;
    }

    // ---- turn performance peaks at corner speed.  Inside the merge, running
    //      the fight at full power only widens the turn circle, so pull the
    //      throttle back and open the boards until the jet is back in the band
    //      where the wing can actually out-turn the bandit.  (Applies to named
    //      manoeuvres too - they were flying straight past this discipline.)
    const cornerV = (ac.def && ac.def.cornerSpeed) || 155;
    if (d < 2800) {
      if (fm.speed > cornerV * 1.55) { throttle = Math.min(throttle, 0.0); this.brakeCmd = 1; }
      else if (fm.speed > cornerV * 1.3) { throttle = Math.min(throttle, 0.25); this.brakeCmd = 1; }
      else if (fm.speed > cornerV * 1.15) throttle = Math.min(throttle, 0.6);
      if (this.brakeCmd) ab = false;
    }

    // ---- smooth into the desired direction
    this._aimProbe = { desired: desired.clone(), vel: fm.vel.clone(), pos: fm.pos.clone(), tgtPos: tgt.fm.pos.clone() };
    this._flyTo(cmd, _v4.copy(fm.pos).addScaledVector(desired, 2000), this.difficulty.aimGain);
    this.throttleCmd = throttle;
    this.abCmd = ab;
  }

  _evade(dt, world, cmd, threat) {
    this.fightCeiling = 7500;
    const ac = this.ac, fm = ac.fm;
    if (!threat || threat.distance > 5200) {
      this.setState('engage', null);
      return;
    }
    // beam the missile: turn perpendicular and dive, then reverse
    const m = threat.missile;
    const toM = _v.copy(m.pos).sub(fm.pos);
    const dist = toM.length();
    toM.multiplyScalar(1 / Math.max(1e-3, dist));
    const rel = _v2.copy(m.vel).normalize();
    // perpendicular direction
    const perp = _v3.copy(rel).cross(_v4.set(0, 1, 0)).normalize().multiplyScalar(this.evadeDir);
    const away = _v5.copy(fm.pos).sub(m.pos).setY(0).normalize();
    const dir = _v6.copy(perp).multiplyScalar(0.85).addScaledVector(away, 0.35);
    dir.y = -0.22 - clamp01((fm.pos.y - 1500) / 4000) * 0.4;
    this._flyTo(cmd, _v4.copy(fm.pos).addScaledVector(dir, 2500), this.difficulty.aimGain * 1.2);
    this.throttleCmd = 1.0;
    this.abCmd = true;
    // beam the missile's seeker
    if (dist < 900 && this.rng.float(0, 1) < dt * 3.5) this.evadeDir *= -1;
    // drop flares when a heat seeker is close
    if (m.seeker === 'heat' && dist < 1600 && this.rng.float(0, 1) < this.difficulty.flareChance) {
      ac.dropFlares(world, 2);
      if (world.audio && this.rng.float(0, 1) < 0.35) this._callout('FLARES, FLARES!');
    }
    if (m.seeker === 'radar' && dist < 2200 && this.rng.float(0, 1) < 0.5) ac.dropChaff(world, 4);
  }

  _attackGround(dt, world, cmd) {
    this.fightCeiling = 6000;
    const fm = this.fm;
    const targets = (world.targets || []).filter((t) => !t.dead && t.team !== this.ac.faction);
    if (this.ac.weapons.bomb.count + this.ac.weapons.rocket.count + this.ac.weapons.gun.ammo <= 0) {
      this.setState('retreat', null);
      return;
    }
    if (!this.groundTarget || this.groundTarget.dead) {
      let best = null, bestD = Infinity;
      for (const t of targets) {
        const d = fm.pos.distanceTo(t.pos);
        if (d < bestD) { bestD = d; best = t; }
      }
      this.groundTarget = best;
    }
    if (!this.groundTarget) { this.setState('patrol'); return; }
    const gt = this.groundTarget;
    const d = fm.pos.distanceTo(gt.pos);
    const toT = _v.copy(gt.pos).sub(fm.pos).normalize();
    this.attackRun = d < 4200;
    // The run-in height has to respect the pull-up margin the terrain
    // avoidance needs at this speed; below it the two laws fight each other
    // and the aircraft sails over the target without ever lining up.  Slow
    // down as well: a 400 m/s strafing pass needs 2 km of clearance.
    const pullNeed = (fm.speed * fm.speed) / (2 * 4.2 * G0) + 140;
    const runAgl = clamp(pullNeed * 1.12, 260, 2600);
    if (d > 3500) {
      // ingress towards the target area
      this._flyTo(cmd, _v2.copy(gt.pos).setY(gt.pos.y + runAgl), 1.4);
      this.throttleCmd = 0.85; this.abCmd = false;
      if (fm.speed > 300) this.brakeCmd = 1;
    } else if (d > 1300) {
      this._flyTo(cmd, _v2.copy(gt.pos).setY(gt.pos.y + Math.max(runAgl * 0.7, 180, d * 0.16)), 1.7);
      this.throttleCmd = 0.5; this.abCmd = false;
      if (fm.speed > 250) this.brakeCmd = 1;
    } else {
      this._flyTo(cmd, _v2.copy(gt.pos), 2.0);
      this.throttleCmd = 0.3; this.abCmd = false;
      if (fm.speed > 230) this.brakeCmd = 1;
    }
    // release weapons on the run-in
    const fwd = _v3.set(0, 0, 1).applyQuaternion(fm.quat);
    const ang = Math.acos(clamp(fwd.dot(toT), -1, 1));
    if (ang < 0.22 && d < 2200 && this.missileCooldown <= 0) {
      if (this.ac.weapons.rocket.count > 0 && d > 900) {
        this.ac.fireRocket(world); this.missileCooldown = 0.35;
      } else if (this.ac.weapons.bomb.count > 0 && d < 1500 && d > 500) {
        this.ac.dropBomb(world); this.missileCooldown = 1.5;
      } else {
        this.ac.selectWeapon('gun');
        this.ac.setGunFiring(true); this.missileCooldown = 0.5;
      }
    } else {
      this.ac.setGunFiring(false);
    }
  }

  _retreat(dt, world, cmd) {
    this.fightCeiling = 0;
    const fm = this.fm;
    const base = this.homeBase;
    const toBase = _v.copy(base.x !== undefined ? _v3.set(base.x, base.y || 900, base.z) : fm.pos).sub(fm.pos);
    toBase.y = 0;
    const d = toBase.length();
    if (d < 2400) {
      // landed / off the map: despawn
      fm.alive = false;
      this.ac.dead = true;
      return;
    }
    toBase.normalize();
    this._flyTo(cmd, _v.set(fm.pos.x + toBase.x * 2000, (base.y || 900) + 300, fm.pos.z + toBase.z * 2000), 0.9);
    this.throttleCmd = 1.0;
    this.abCmd = true;
    this.ac.setGunFiring(false);
    if (this.stateTimer > 8 && this.rng.float(0, 1) < dt * 0.5) this._callout('RETURNING TO BASE');
  }

  _regroup(dt, world, cmd) {
    this.fightCeiling = 0;
    const lead = this.leader;
    if (!lead || !lead.fm.alive) { this.setState('patrol'); return; }
    const spot = _v.copy(lead.fm.pos).add(_v2.copy(this.formationOffset).applyQuaternion(lead.fm.quat));
    this._flyTo(cmd, spot, 1.0);
    this.throttleCmd = clamp(lead.fm.throttle + 0.08, 0.6, 1);
    this.abCmd = lead.fm.afterburner;
    if (this.fm.pos.distanceTo(spot) < 220) this.setState(this.target && this.target.fm.alive ? 'engage' : 'patrol');
  }

  // -----------------------------------------------------------------------
  /**
   * Steering controller: "fly toward world-space point".
   *
   * Everything is expressed in the *velocity* frame, which has no singular
   * cases (a horizontal frame collapses in a vertical climb — that is what
   * used to send the AI into a mushing spiral):
   *
   *   u_des      = direction to the aim point
   *   u_vel      = current flight-path direction
   *   e_perp     = component of (u_des - u_vel) perpendicular to u_vel
   *   a_steer    = k·V·|e| · ê_perp        (acceleration needed to swing the path)
   *   L          = g·up + a_steer          (lift must also carry the weight)
   *   bank       = angle between L and "wings level" up, in the plane ⟂ u_vel
   *   n_desired  = |L| / g0
   *
   * The pull is capped by what the wing can deliver at the current speed, so a
   * slow aircraft stops pulling and recovers its energy instead of parking
   * itself in a high-alpha mush.
   */
  _flyTo(cmd, point, gain = 1.6, dt) {
    const fm = this.fm;
    const g = clamp(gain, 0.4, 3.0);
    const nMax = clamp((6.2 + 2.2 * this.difficulty.energy) * this.difficulty.gTolerance, 2.5, 9.5);
    const V = Math.max(60, fm.speed);

    // ---- desired flight-path direction
    _v.copy(point).sub(fm.pos);
    const dist = Math.max(1, _v.length());
    _v.multiplyScalar(1 / dist);                    // u_des

    // ---- current flight-path direction
    _v2.copy(fm.vel);
    if (_v2.lengthSq() < 4) _v2.set(0, 0, 1).applyQuaternion(fm.quat);
    _v2.normalize();                                // u_vel

    // ---- steering error: the part of u_des that is not along u_vel
    const cosErr = clamp(_v.dot(_v2), -1, 1);
    const err = Math.acos(cosErr);                  // 0 … π
    _v3.copy(_v).addScaledVector(_v2, -cosErr);     // p = u_des - (u_des·u_vel)u_vel
    const pLen = _v3.length();

    // ---- turn direction.  When the target is astern p⊥ is ill-conditioned, so
    //      fall back on a "turn right" axis and latch the side (hysteresis).
    //      (up = (0,1,0): up·u_vel is simply u_vel.y)
    if (pLen > 0.06) {
      _v3.multiplyScalar(1 / pLen);
      if (err > 1.55) {                             // blend toward a clean side turn
        _v6.set(0, 1, 0).cross(_v2);                // port = up × forward
        const side = this.turnLock || (Math.sign(_v3.dot(_v6)) || 1);
        this.turnLock = side;
        const sideAxis = _v6.set(-_v2.z, 0, _v2.x).normalize();  // starboard: fwd × up
        if (sideAxis.dot(_v3) < 0) sideAxis.negate();
        _v3.lerp(sideAxis, clamp01((err - 1.55) / 0.8)).normalize();
      } else if (err < 0.8) {
        this.turnLock = 0;
      }
    } else if (err > 2.6) {                         // dead astern: pick and hold a side
      if (!this.turnLock) this.turnLock = 1;
      _v3.set(-_v2.z, 0, _v2.x).normalize();       // starboard
      if (this.turnLock < 0) _v3.negate();
    } else {
      _v3.set(0, 0, 0);
      this.turnLock = 0;
    }

    // ---- available turn: airframe limit and energy limit
    const nGl = clamp(Math.pow(V / 170, 2) * 7.5, 1.0, nMax);
    // The energy limit is the load the engine can pay for.  Available thrust
    // falls off with air density, so the same pull costs far more speed at
    // altitude: without this term a fight climbs into thin air until both
    // aircraft are out of energy and hanging on their tails.
    const rhoRel = clamp(airDensity(Math.max(0, fm.pos.y)) / 1.225, 0.05, 1.2);
    const nEn = clamp((1.6 + (V - 100) / 22) * (0.55 + 0.45 * rhoRel), 1.0, nMax);
    const nCap = Math.min(nGl, nEn);

    // ---- line-of-sight rate, the damping term of the pursuit.  Without it a
    //      proportional "turn toward the target" law always turns at the limit
    //      and the aircraft ends up orbiting whatever it is chasing (a target
    //      inside the turn circle is then unreachable).
    const step0 = dt || this.dt || 1 / 60;
    _v5.set(0, 0, 0);
    if (this._uvelPrev && step0 > 1e-4) {
      // achieved turn rate of the flight path = rotation of the velocity unit
      // vector; used as the rate damper so the aircraft settles onto a course
      // instead of overshooting it and orbiting the aim point.
      _v5.copy(_v2).sub(this._uvelPrev).multiplyScalar(1 / step0);
      _v5.addScaledVector(_v2, -_v5.dot(_v2));           // keep the rotation part
      const dmax = 1.5;
      if (_v5.lengthSq() > dmax * dmax) _v5.setLength(dmax);
    }
    if (!this._uvelPrev) this._uvelPrev = new THREE.Vector3();
    this._uvelPrev.copy(_v2);

    // ---- commanded turn acceleration.  The magnitude follows the pointing
    //      error; the *horizontal* part turns the flight path and the vertical
    //      part climbs or unloads.  Splitting them this way keeps the lift
    //      vector pointing up (a dive unloads the wing, it never inverts it).
    const gSteer = clamp(0.55 + 0.35 * (this.difficulty.aimGain || 1.6), 0.5, 1.5);
    const dz = 0.015;
    const errEff = err < dz ? 0 : err - dz;
    const aPerpMax = Math.max(0.2, (nCap - 1) * G0);
    const aPerp = Math.min(aPerpMax, 0.9 * gSteer * g * V * errEff);
    const damp = Math.min(0.4 * aPerpMax, 0.35 * V);
    const hLen = Math.hypot(_v3.x, _v3.z);
    const aLatMag = Math.min(aPerp * hLen, aPerpMax) - clamp(0.35 * V * _v5.x, -damp, damp);
    const aLatX = hLen > 1e-4 ? (Math.max(0, aLatMag) * _v3.x) / hLen : 0;
    const aLatZ = hLen > 1e-4 ? (Math.max(0, aLatMag) * _v3.z) / hLen : 0;
    let aVert = clamp(aPerp * _v3.y - 0.35 * V * _v5.y, -0.8 * G0, aPerpMax);
    // energy discipline: below corner speed a climb only trades away the
    // speed you need to turn, so cap the upward demand and let the nose drop
    const cornerV = (this.ac.def && this.ac.def.cornerSpeed) || 155;
    if (V < cornerV * 1.15 && aVert > 0) aVert = Math.min(aVert, 0.15 * G0);
    // ---- altitude discipline.  Thrust and lift both fall off with density
    //      (the engine keeps ~30% of its thrust at 15 km), so a turning fight
    //      up there just bleeds the aircraft down to a stall.  Two limits:
    //      the airframe's service ceiling, and the lower combat ceiling the
    //      engaging states use to drag the fight back into usable air.
    const ceiling = (((this.ac.def && this.ac.def.ceiling) || 13000) - 700);
    const altCap = Math.min(ceiling, this.fightCeiling || ceiling);
    // judge it on where the aircraft is *going*: 8 s of climb ahead.  Checking
    // the current height alone lets a zoom climb sail thousands of feet past
    // the ceiling before the error signal builds.
    const yProj = fm.pos.y + Math.max(0, fm.vel.y) * 8;
    const overCap = yProj > altCap ? clamp01((yProj - altCap) / 1200) : 0;
    if (overCap > 0) aVert = Math.min(aVert, -(0.12 + 0.45 * overCap) * G0);

    // ---- lift vector = steering accel + gravity compensation
    _v4.set(aLatX, G0 + aVert, aLatZ);
    // Only the part of that demand which is perpendicular to the flight path
    // is the wing's job (the rest is thrust/drag along the path).  Without this
    // projection a steep zoom looks like a huge load demand: at 75 deg of climb
    // almost all of the 1-g "hold your height" term lies along the velocity, so
    // the error signal collapses and a mushing aircraft never lowers its nose.
    _v4.addScaledVector(_v2, -_v4.dot(_v2));
    const nWant = _v4.length() / G0;
    const nDes = clamp(nWant, -1.2, nCap);

    // ---- bank: aim the lift vector at L, measured about the velocity axis
    //      (wings-level up = world up projected ⟂ u_vel)
    _v5.set(0, 1, 0).addScaledVector(_v2, -_v2.y);      // up ⟂ u_vel
    if (_v5.lengthSq() < 0.02) {                        // near-vertical flight
      _v5.set(0, 0, 0);                                 // hold the current bank
    } else {
      _v5.normalize();
    }
    let wantBank;
    if (_v5.lengthSq() < 0.5) {
      wantBank = fm.bodyRoll();                         // nothing to level against
    } else {
      const starboard = _v6.copy(_v2).cross(_v5);       // u_vel × up = starboard
      wantBank = clamp(Math.atan2(_v4.dot(starboard), Math.max(0.12 * G0, _v4.dot(_v5))), -1.55, 1.55);
    }

    // ---- roll command: PD on bank angle (the model's roll channel is a rate)
    const spec = this.ac.def || {};
    const rr = Math.max(1.2, (spec.rollRate || 3.6) * 1.15);
    let dRoll = wantBank - fm.bodyRoll();
    while (dRoll > Math.PI) dRoll -= Math.PI * 2;
    while (dRoll < -Math.PI) dRoll += Math.PI * 2;
    const wn = clamp(1.25 + 0.45 * g, 1.1, 2.4);
    cmd.roll = clamp((dRoll * wn * wn) / rr - (fm.angular.z * 1.6 * wn) / rr, -1, 1);
    this._lastRoll = cmd.roll;

    // ---- pull command: load-factor error + pitch-rate damping
    //      (nose-up rate shows up as negative angular.x)
    cmd.pitch = clamp((nDes - fm.gLoad) * 0.42 + fm.angular.x * 0.55, -1, 1);
    // ceiling protection: the load-factor law cannot talk a zoom climb back
    // down (a low nDes is not a descent command), so above the ceiling push the
    // nose over directly - the mirror image of the ground protection below.
    if (overCap > 0) cmd.pitch = Math.min(cmd.pitch, -(0.2 + 0.55 * overCap));
    this._lastPitch = cmd.pitch;
    this._lastYaw = err;

    // ---- stall protection: unloaded flight is how the wing gets its speed back
    if (fm.stallSeverity > 0.3) {
      cmd.pitch = Math.min(cmd.pitch, 0.15);
      this.throttleCmd = 1;
    }

    // ---- nose-down protection near the ground
    const gh = this.worldRef && this.worldRef.groundHeight ? this.worldRef.groundHeight(fm.pos.x, fm.pos.z) : 0;
    if (fm.pos.y - gh < 220 && fm.vel.y < -25) cmd.pitch = Math.max(cmd.pitch, 0.55);

    this._dbg = { err, aPerp, aVert, nDes, wantBank, nCap, altCap, gLoad: fm.gLoad, spd: fm.speed, cmdP: cmd.pitch };
    return cmd;
  }

  /**
   * Terrain avoidance.  The aircraft starts a recovery early enough to clear
   * the ground even at high speed: recovery altitude ≈ v²/(2·n·g) plus a
   * margin, and the terrain ahead along the flight path is sampled too.
   */
  _avoidTerrain(dt, world, cmd) {
    const fm = this.fm;
    const gh = (x, z) => (world && world.groundHeight ? world.groundHeight(x, z) : 0);
    const speed = Math.max(60, fm.speed);
    const agl = fm.pos.y - gh(fm.pos.x, fm.pos.z);

    // horizontally ahead: where will we be inside the recovery window?
    _v.copy(fm.vel); _v.y = 0;
    const hSpeed = _v.length();
    const look = clamp(hSpeed * 6.5, 600, 7000);
    const aheadAgl = hSpeed > 1
      ? fm.pos.y + fm.vel.y * (look / Math.max(60, hSpeed)) - gh(fm.pos.x + _v.x / hSpeed * look, fm.pos.z + _v.z / hSpeed * look)
      : agl;

    // A deliberate dive at a ground target deliberately flies into the pull-up
    // margin, so on an attack run the law reacts much later and recovers with
    // the load actually available at low speed instead of aborting the pass.
    const attack = !!this.attackRun;
    const pullDrop = (speed * speed) / (2 * (attack ? 3.0 : 4.2) * 9.80665);
    const margin = attack ? 0.45 : 1.0;
    const need = pullDrop + 140 + Math.max(0, -fm.vel.y) * (attack ? 0.6 : 2.0);
    const tImpact = fm.vel.y < -1 ? agl / -fm.vel.y : 1e9;
    const reactTime = attack ? 2.4 : 6.5;

    if (agl < need * margin || aheadAgl < need * margin * 0.95 || tImpact < reactTime) {
      const urgency = clamp01(Math.max(
        (need * margin - agl) / Math.max(200, need),
        (need * margin * 0.95 - aheadAgl) / Math.max(200, need),
        (reactTime - tImpact) / reactTime
      ));
      this.avoidTimer = Math.max(this.avoidTimer, 0.3 + urgency * 0.5);
      if (urgency > 0.6) this._calloutIfLeader('TERRAIN! PULL UP');
      this._terrainUrgency = Math.max(this._terrainUrgency || 0, urgency);
    }

    if (this.avoidTimer > 0) {
      this.avoidTimer -= dt;
      const urgency = clamp01(this._terrainUrgency || 0.5);
      const pull = 0.45 + urgency * 0.55;
      if (cmd.pitch < pull) cmd.pitch = Math.min(1, pull);
      // A banked pull turns sideways, not up: roll the wings level with a PD
      // law of its own so the whole lift vector is available for the recovery.
      const spec = this.ac.def || {};
      const rr = Math.max(1.2, (spec.rollRate || 3.6) * 1.15);
      let dRoll = -fm.bodyRoll();
      while (dRoll > Math.PI) dRoll -= Math.PI * 2;
      while (dRoll < -Math.PI) dRoll += Math.PI * 2;
      const levelCmd = clamp(dRoll * (1.5 / rr) - fm.angular.z * (1.1 / rr), -1, 1);
      cmd.roll = clamp(cmd.roll * 0.25 + levelCmd * 0.85, -1, 1);
      // never let the nose drop below the horizon while recovering
      if (fm.vel.y < -20) cmd.pitch = Math.max(cmd.pitch, 0.5 + urgency * 0.4);
      this.throttleCmd = Math.max(this.throttleCmd, urgency > 0.6 ? 1 : 0.85);
      if (urgency > 0.6) this.abCmd = true;
    } else {
      this._terrainUrgency = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Named manoeuvres
  // -----------------------------------------------------------------------
  _chooseManeuver(tgt, dist) {
    const ac = this.ac, fm = ac.fm;
    const keys = [];
    const a = this._cv1 || (this._cv1 = new THREE.Vector3());
    const b = this._cv2 || (this._cv2 = new THREE.Vector3());
    const toTgt = a.copy(tgt.fm.pos).sub(fm.pos).normalize();
    const tgtFwd = b.copy(tgt.fm.vel);
    if (tgtFwd.lengthSq() < 1) tgtFwd.copy(toTgt);
    tgtFwd.normalize();
    const aspect = tgtFwd.dot(toTgt);                       // 1 = I am astern of him
    const noseDir = this._cv3 || (this._cv3 = new THREE.Vector3());
    noseDir.set(0, 0, 1).applyQuaternion(tgt.fm.quat);
    const theirNoseDot = noseDir.dot(toTgt.negate());
    const energy = fm.speed - tgt.fm.speed;

    if (aspect > 0.35) keys.push('HIGH YO-YO', 'LAG PURSUIT', 'LOW YO-YO');
    if (theirNoseDot > 0.5) keys.push('SCISSORS', 'DEFENSIVE SPIRAL', 'DEFENSIVE BREAK');
    // vertical manoeuvres only make sense against a bandit that is already
    // pointing away and slow: picking them on raw speed alone turns every
    // merge into a climb into thin air.
    const tgtSlow = tgt.fm.speed < 200;
    if (aspect < -0.3 && tgtSlow) keys.push('BOOM AND ZOOM', 'ZOOM CLIMB', 'CUBAN EIGHT');
    if (energy > 60 && tgtSlow) keys.push('ZOOM CLIMB', 'BOOM AND ZOOM');
    if (energy < -60) keys.push('LOW YO-YO', 'SCISSORS');
    if (dist > 3000) {                                     // far out: stay on the job
      keys.length = 0;
      keys.push('LAG PURSUIT', 'HIGH YO-YO', 'LOW YO-YO');
    }
    if (this.role === 'strike') keys.push('DIVING ATTACK');
    if (!keys.length) keys.push('HIGH YO-YO', 'SCISSORS', 'BOOM AND ZOOM', 'LAG PURSUIT', 'CUBAN EIGHT');

    const name = keys[this.rng.int(0, keys.length - 1)];
    const def = MANEUVERS[name] || { dur: 4 };
    this.maneuver = name;
    this.maneuverTimer = def.dur * this.rng.float(0.8, 1.25);
    this.maneuverSide = this.rng.float(0, 1) < 0.5 ? -1 : 1;
    this._callout(name);
  }

  /**
   * Steering direction for the current manoeuvre (world space, normalised).
   * Uses its own scratch vectors: the shared module-level temporaries are also
   * used by the caller, so aliasing them here silently corrupts `toTgt`.
   */
  _maneuverDir(tgt, toTgt, dist) {
    const fm = this.fm;
    const side = this.maneuverSide;
    const out = this._mv1 || (this._mv1 = new THREE.Vector3());
    const lhs = this._mv2 || (this._mv2 = new THREE.Vector3());
    const rhs = this._mv3 || (this._mv3 = new THREE.Vector3());
    const los = this._mv4 || (this._mv4 = new THREE.Vector3());
    los.copy(toTgt);
    const up = lhs.set(0, 1, 0);
    const tgtVel = tgt.fm.vel;
    const tgtFwd = rhs.copy(tgtVel);
    if (tgtFwd.lengthSq() < 1) tgtFwd.copy(los);
    tgtFwd.normalize();

    switch (this.maneuver) {
      case 'HIGH YO-YO':
        out.copy(los).addScaledVector(up, 0.55)
          .addScaledVector(rhs.copy(up).cross(tgtFwd).normalize().multiplyScalar(side), 0.45);
        break;
      case 'LOW YO-YO':
        out.copy(los).addScaledVector(up, -0.35)
          .addScaledVector(rhs.copy(up).cross(tgtFwd).normalize().multiplyScalar(side), 0.5);
        break;
      case 'SCISSORS': {
        // reverse across the bandit's tail: fly across his nose, not away from it
        const rel = lhs.copy(fm.vel).sub(tgtVel);
        if (rel.lengthSq() < 1) rel.copy(los);
        out.copy(rel).cross(up).normalize().multiplyScalar(side)
          .addScaledVector(up, 0.12).addScaledVector(tgtFwd, 0.25);
        break;
      }
      case 'DEFENSIVE SPIRAL': {
        const rel = lhs.copy(fm.vel).sub(tgtVel);
        if (rel.lengthSq() < 1) rel.copy(los);
        out.copy(rel).cross(up).normalize().multiplyScalar(side).addScaledVector(up, -0.35);
        break;
      }
      case 'DEFENSIVE BREAK': {
        const inbound = lhs.copy(fm.pos).sub(tgt.fm.pos);
        if (inbound.lengthSq() < 1) inbound.copy(los);
        out.copy(inbound).cross(up).normalize().multiplyScalar(-side).addScaledVector(up, 0.1);
        break;
      }
      case 'ZOOM CLIMB':
        out.copy(fm.vel).normalize().addScaledVector(up, 0.85);
        break;
      case 'BOOM AND ZOOM':
        out.copy(fm.vel).normalize().multiplyScalar(0.6).addScaledVector(up, 0.5).addScaledVector(los, -0.35);
        break;
      case 'CUBAN EIGHT':
        out.copy(fm.vel).normalize().addScaledVector(up, 0.7)
          .addScaledVector(rhs.copy(up).cross(tgtFwd).normalize().multiplyScalar(side), 0.6);
        break;
      case 'LAG PURSUIT':
        out.copy(tgt.fm.pos).addScaledVector(tgtVel, -0.5).sub(fm.pos);
        break;
      case 'DIVING ATTACK': {
        const gt = this.groundTarget;
        if (gt && !gt.dead) out.copy(gt.pos).addScaledVector(los, dist * 0.3).sub(fm.pos);
        else out.copy(los);
        break;
      }
      default:
        out.copy(los);
    }
    if (out.lengthSq() < 1e-6) out.copy(los);
    return out.normalize();
  }

  // -----------------------------------------------------------------------
  // Weapons employment
  // -----------------------------------------------------------------------
  _manageWeapons(dt, world, tgt, d, threat) {
    const ac = this.ac, fm = ac.fm;
    if (!tgt || !tgt.fm || !tgt.fm.alive) { ac.setGunFiring(false); return; }
    const to = _v.copy(tgt.fm.pos).sub(fm.pos);
    const dist = to.length();
    to.multiplyScalar(1 / Math.max(1e-3, dist));
    const fwd = _v2.set(0, 0, 1).applyQuaternion(fm.quat);
    const ang = Math.acos(clamp(fwd.dot(to), -1, 1));
    const aspect = _v3.copy(tgt.fm.vel).normalize().dot(_v4.copy(fm.pos).sub(tgt.fm.pos).normalize());
    const closing = fm.vel.dot(to) - tgt.fm.vel.dot(to);

    // ---- gun: fire when the computed lead solution sits in the muzzle
    //      tolerance, in bursts, with a settle delay after lining up
    let aimAng = ang;
    const aim = ac.gunAimPoint(world, _v5);
    if (aim) {
      const adir = _v6.copy(aim).sub(fm.pos);
      if (adir.lengthSq() > 1e-6) {
        adir.normalize();
        aimAng = Math.acos(clamp(fwd.dot(adir), -1, 1));
      }
    }
    const gunTol = this.difficulty.gunAngle * (1 + 40 / Math.max(200, dist));
    const inGunRange = dist < this.difficulty.gunRange && dist > 60;
    const linedUp = aimAng < gunTol;
    this._gunDbg = { aimAng, gunTol, dist, inGunRange, linedUp, aoa: fm.aoa, aimTimer: this.aimTimer };
    if (linedUp) this.aimTimer += dt; else this.aimTimer = 0;
    const burstLen = this.difficulty.burstLen || 1.0;
    const burstPause = this.difficulty.burstPause || 0.5;
    if (inGunRange && linedUp && this.aimTimer > 0.25 && ac.weapons.gun.ammo > 0 && !ac.gunJammed) {
      this.burstTimer += dt;
      if (this.burstTimer < burstLen) {
        ac.setGunFiring(true);
        this.gunFiring = true;
      } else {
        ac.setGunFiring(false);
        this.gunFiring = false;
        if (this.burstTimer > burstLen + burstPause) this.burstTimer = 0;
      }
    } else {
      ac.setGunFiring(false);
      this.gunFiring = false;
      // bleed the burst timer down so a re-acquisition resumes quickly
      if (this.burstTimer > 0) this.burstTimer = Math.max(0, this.burstTimer - dt * 2);
    }

    // ---- missiles
    if (this.missileCooldown > 0) return;
    if (d < 900) return;                                // too close for a launch
    const rear = aspect > 0.25;                         // I am behind him
    const heat = ac.weapons.aim9.count > 0 && dist < 6000 && (rear || dist < 3200) && ang < 0.9;
    if (heat) { ac.fireMissile(world, 'aim9', tgt); this.missileCooldown = this.rng.float(6, 14); return; }
    const archerOk = ac.weapons.archer && ac.weapons.archer.count > 0 && dist < 9000 && ang < 0.8;
    if (archerOk) { ac.fireMissile(world, 'archer', tgt); this.missileCooldown = this.rng.float(7, 16); return; }
    const radarOk = ac.weapons.aim120.count > 0 && dist < 24000 && Math.abs(aspect) < 0.85 && ang < 0.7;
    if (radarOk) { ac.fireMissile(world, 'aim120', tgt); this.missileCooldown = this.rng.float(10, 22); return; }
  }

  _calloutIfLeader(text) { if (this.formationRole === 'leader') this._callout(text, 0.9); }

  /**
   * Radio callout: routed to the audio engine (radio-filtered speech) and to
   * the HUD subtitle bus.  Rate limited so a formation does not babble.
   */
  _callout(text, priority = 1) {
    if (this.calloutCooldown > 0) return;
    this.calloutCooldown = 2.4 - Math.min(1.2, priority);
    const w = this.worldRef;
    if (w && w.audio && typeof w.audio.radio === 'function') {
      w.audio.radio(text, { callsign: this.callsign || w.callsignFor?.(this), priority, speaker: this.ac });
    }
    if (w && typeof w.onCallout === 'function') w.onCallout(this, text, priority);
  }
}

// ---------------------------------------------------------------------------
// AirGroup — a formation of 2-4 aircraft sharing orders.
// ---------------------------------------------------------------------------
export class AirGroup {
  constructor(aircraft, opts = {}) {
    this.aircraft = aircraft;
    this.rng = new RNG(opts.seed || 5150);
    this.role = opts.role || 'fighter';
    this.faction = opts.faction || 'red';
    this.difficulty = opts.difficulty || 'veteran';
    this.patrolPoint = new THREE.Vector3(opts.patrolX || 0, opts.patrolY || 1500, opts.patrolZ || 0);
    this.homeBase = opts.homeBase || { x: opts.patrolX || 0, y: 800, z: opts.patrolZ || 0 };
    this.engaged = false;
    this.state = 'patrol';
    this.calloutTimer = 3;
    this.pilots = [];
    const offsets = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(120, -25, -160),
      new THREE.Vector3(-120, -25, -160),
      new THREE.Vector3(0, 55, -320)
    ];
    aircraft.forEach((ac, i) => {
      const pilot = new AIPilot(ac, {
        difficulty: this.difficulty,
        seed: this.rng.int(1, 999999),
        formationRole: i === 0 ? 'leader' : 'wingman',
        leader: i === 0 ? null : aircraft[0],
        formationOffset: offsets[i % offsets.length],
        patrolX: this.patrolPoint.x, patrolZ: this.patrolPoint.z,
        homeBase: this.homeBase,
        role: this.role
      });
      pilot.worldRef = opts.world;
      pilot.patrolPoint.copy(this.patrolPoint).add(new THREE.Vector3(this.rng.float(-800, 800), this.rng.float(-100, 100), this.rng.float(-800, 800)));
      this.pilots.push(pilot);
      ac.ai = pilot;
    });
  }

  get alive() { return this.aircraft.some((a) => a.fm.alive); }

  update(dt, world) {
    if (!this.alive) return;
    for (const p of this.pilots) p.update(dt, world);
    // group-level state + chatter
    const engaged = this.pilots.some((p) => p.state === 'engage' || p.state === 'evade');
    if (engaged && !this.engaged) {
      this.engaged = true;
      this._radio(world, 'ALL FLIGHTS, WEAPONS FREE. ENGAGE!');
    }
    this.calloutTimer -= dt;
    if (this.calloutTimer <= 0) {
      this.calloutTimer = this.rng.float(14, 30);
      if (engaged) {
        const lines = ['TALLY BANDIT!', 'I\'M ON HIM', 'WATCH YOUR SIX!', 'BREAK RIGHT, HE\'S ON YOU',
          'HE\'S MINE', 'STAY SHARP, HE\'S FAST', 'MISSILE AWAY', 'GOOD KILL'];
        this._radio(world, this.rng.pick(lines), 1.05);
      } else {
        this._radio(world, this.rng.pick(['ALL STATIONS, RADIO CHECK', 'NO CONTACTS, CONTINUING PATROL', 'FUEL STATE NOMINAL']), 0.95);
      }
    }
  }

  _radio(world, text, pitch = 1.0) {
    if (!world.audio) return;
    const lead = this.aircraft[0];
    world.audio.radio(text, { pitch, speaker: lead ? lead.callsign : 'BANDIT', kind: 'enemy' });
  }
}
