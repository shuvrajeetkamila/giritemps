// ---------------------------------------------------------------------------
// Weapons — cannon rounds, heat-seeking and radar-guided missiles, rockets,
// bombs, flares and chaff, with guidance, proximity fuses and hit resolution.
//
// world interface used here:
//   world.groundHeight(x,z)     terrain height (negative = ocean floor)
//   world.env                   { windDir:Vector2(+x,+z), windSpeed, airDensity(y) }
//   world.particles             ParticleSystem
//   world.audio                 AudioEngine
//   world.aircraft              [Aircraft]      (.fm, .faction, .hitRadius, .applyDamage)
//   world.targets               [GroundTarget]  (.pos, .radius, .team, .damage)
//   world.projectiles           ProjectileSystem (flare/chaff queries)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RNG, clamp, clamp01, G0 } from '../core/Utils.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();
const _g = new THREE.Vector3();

export const MISSILE_TYPES = {
  aim9: {
    name: 'AIM-9X', kind: 'heat', speed: 340, maxSpeed: 900, motor: 3.0, accel: 160,
    drag: 0.000032, life: 26, maxG: 42, damage: 115, prox: 20, fov: 1.05,
    seekerRange: 7000, flareSusceptibility: 0.72, trail: true
  },
  aim120: {
    name: 'AIM-120D', kind: 'radar', speed: 420, maxSpeed: 1550, motor: 6.5, accel: 210,
    drag: 0.000030, life: 45, maxG: 32, damage: 155, prox: 26, fov: 0.55,
    seekerRange: 18000, flareSusceptibility: 0.03, trail: true
  },
  archer: {
    name: 'R-73', kind: 'heat', speed: 320, maxSpeed: 820, motor: 3.0, accel: 150,
    drag: 0.000036, life: 24, maxG: 40, damage: 105, prox: 18, fov: 1.15,
    seekerRange: 5500, flareSusceptibility: 0.7, trail: true
  },
  sam: {
    name: 'SA-15', kind: 'radar', speed: 380, maxSpeed: 1050, motor: 8.0, accel: 260,
    drag: 0.000025, life: 34, maxG: 26, damage: 180, prox: 30, fov: 1.4,
    seekerRange: 14000, flareSusceptibility: 0.0, trail: true
  },
  patriot: {
    name: 'MIM-104', kind: 'radar', speed: 520, maxSpeed: 1700, motor: 9.0, accel: 300,
    drag: 0.000022, life: 40, maxG: 30, damage: 200, prox: 32, fov: 1.2,
    seekerRange: 20000, flareSusceptibility: 0.0, trail: true
  }
};

// ---------------------------------------------------------------------------
export class ProjectileSystem {
  constructor(opts = {}) {
    this.list = [];
    this.pool = [];
    this.rng = new RNG(90210);
    this.maxProjectiles = opts.maxProjectiles || 1400;
    this.time = 0;
    this.stats = { fired: 0, hits: 0, kills: 0, missilesFired: 0, missilesHit: 0, groundHits: 0 };
    this.collectMiss = false;          // diagnostics: record per-round miss distance
    this.missLog = [];
  }

  reset() { this.list.length = 0; }

  get tracers() { return this.list; }

  _spawn(p) {
    if (this.list.length >= this.maxProjectiles) {
      // recycle the oldest bullet rather than dropping the new one
      const idx = this.list.findIndex((q) => q.type === 'bullet');
      if (idx < 0) return null;
      this.pool.push(this.list[idx]);
      this.list.splice(idx, 1);
    }
    const pr = this.pool.pop() || {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), prev: new THREE.Vector3()
    };
    pr.type = 'bullet'; pr.kind = 'gun'; pr.faction = 'blue'; pr.owner = null;
    pr.target = null; pr.launchTarget = null; pr.dead = false; pr.trailTimer = 0;
    pr.life = 3; pr.damage = 5; pr.radius = 0.25; pr.seeker = 'none';
    pr.motorTime = 0; pr.accel = 0; pr.maxSpeed = 9999; pr.drag = 0; pr.maxG = 0;
    pr.prox = 0; pr.mass = 1; pr.guided = false; pr.lostTimer = 0; pr.seekTimer = 0;
    pr.flareSusceptibility = 0; pr.seekerRange = 0; pr.fov = 0; pr.smoke = false;
    pr.launchPos = pr.launchPos || new THREE.Vector3();
    pr.seekState = 'none';
    Object.assign(pr, p);
    pr.prev.copy(pr.pos);
    this.list.push(pr);
    return pr;
  }

  // -----------------------------------------------------------------------
  spawnBullet(owner, origin, dir, speed, damage, faction, opts = {}) {
    this.stats.fired++;
    return this._spawn({
      type: 'bullet', kind: 'gun', owner, faction,
      pos: origin.clone(), vel: _a.copy(dir).normalize().multiplyScalar(speed).clone(),
      life: opts.life || 3.0, damage, radius: 0.3, drag: 0.000006,
      tracer: opts.tracer !== false, tracerColor: opts.color || 0xffd27a
    });
  }

  /**
   * Launch a guided missile.
   *   (owner, type, pos, dir, target, faction)   — dir is a unit vector, it is
   *   cloned here so callers may reuse their scratch vectors.
   */
  spawnMissile(owner, type, pos, dir, target, faction) {
    const def = MISSILE_TYPES[type] || MISSILE_TYPES.aim120;
    this.stats.fired++;
    this.stats.missilesFired++;
    const vel = _b.copy(dir).normalize().multiplyScalar(def.speed);
    if (owner && owner.fm && owner.fm.vel) vel.addScaledVector(owner.fm.vel, 0.55);
    const p = this._spawn({
      type: 'missile', kind: def.kind, missileType: type, owner, faction,
      pos: pos.clone(), vel: vel.clone(),
      life: def.life, damage: def.damage, radius: 0.9, maxSpeed: def.maxSpeed,
      accel: def.accel, motorTime: def.motor, drag: def.drag, maxG: def.maxG,
      prox: def.prox, seeker: def.kind, fov: def.fov, seekerRange: def.seekerRange,
      flareSusceptibility: def.flareSusceptibility, target: target || null,
      launchTarget: target || null, guided: !!target, smoke: def.trail,
      seekState: target ? 'track' : 'search', seekTimer: 0.35
    });
    if (p) {
      p.launchPos.copy(p.pos);
      p.denotationName = def.name;
    }
    return p;
  }

  spawnRocket(owner, pos, dir, faction, opts = {}) {
    this.stats.fired++;
    const vel = _b.copy(dir).normalize().multiplyScalar(opts.speed || 160);
    if (owner && owner.fm && owner.fm.vel) vel.addScaledVector(owner.fm.vel, 0.85);
    return this._spawn({
      type: 'rocket', kind: 'rocket', owner, faction,
      pos: pos.clone(), vel: vel.clone(),
      life: 7.5, damage: opts.damage || 60, radius: 0.6, maxSpeed: 900,
      accel: 260, motorTime: 1.8, drag: 0.00009, smoke: true, trail: true
    });
  }

  spawnBomb(owner, pos, vel, faction, opts = {}) {
    this.stats.fired++;
    return this._spawn({
      type: 'bomb', kind: 'bomb', owner, faction,
      pos: pos.clone(), vel: vel.clone(),
      life: 40, damage: opts.damage || 420, radius: 1.4, drag: 0.00006
    });
  }

  spawnFlare(owner, pos, vel, faction) {
    return this._spawn({
      type: 'flare', kind: 'decoy', owner,
      faction: owner ? owner.faction : (faction || 'blue'),
      pos: pos.clone(), vel: vel.clone(), life: 5.4, damage: 0, radius: 1.2,
      heat: 1.0, smoke: false
    });
  }

  spawnChaff(owner, pos, vel, faction) {
    return this._spawn({
      type: 'chaff', kind: 'decoy', owner,
      faction: owner ? owner.faction : (faction || 'blue'),
      pos: pos.clone(), vel: vel.clone(), life: 7.0, damage: 0, radius: 22, radar: 1.0
    });
  }

  // -----------------------------------------------------------------------
  update(dt, world) {
    this.time += dt;
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { this._expire(p, world); this._remove(i); continue; }
      switch (p.type) {
        case 'bullet': this._stepBullet(p, dt, world); break;
        case 'rocket': this._stepRocket(p, dt, world); break;
        case 'missile': this._stepMissile(p, dt, world); break;
        case 'bomb': this._stepBomb(p, dt, world); break;
        case 'flare': this._stepFlare(p, dt, world); break;
        case 'chaff': this._stepChaff(p, dt, world); break;
      }
      if (p.dead) this._remove(i);
    }
  }

  _remove(i) {
    const p = this.list[i];
    if (this.collectMiss && p.type === 'bullet' && !p.missLogged) {
      p.missLogged = true;
      if (p.missD !== undefined) this.missLog.push({ miss: p.missD, range: p.srcD || 0 });
    }
    this.list.splice(i, 1);
    p.missD = undefined; p.srcD = undefined; p.missLogged = false;
    if (this.pool.length < 400) this.pool.push(p);
  }

  _expire(p, world) {
    if (p.type === 'missile' || p.type === 'bomb' || p.type === 'rocket') {
      this._detonate(p, world, 0.6);
    } else if (p.type === 'flare') {
      this._removeFlareVisual(p, world);
    }
  }

  // =======================================================================
  // integration helpers
  // =======================================================================
  _integrate(p, dt, world, opts = {}) {
    const vel = p.vel;
    const speed = vel.length();
    if (!Number.isFinite(speed)) { p.dead = true; return 0; }
    // motor
    if (p.motorTime > 0) {
      p.motorTime -= dt;
      const target = p.maxSpeed;
      if (speed < target) {
        const a = Math.min(p.accel, Math.max(0, (target - speed) / dt));
        vel.addScaledVector(_a.copy(vel).normalize(), a * dt);
        if (p.smoke && world.particles) world.particles.missileMotor(p.pos, vel);
      }
    }
    // drag (quadratic, air density falls with altitude)
    const air = world.env && world.env.airDensity ? world.env.airDensity(p.pos.y) : 1.225;
    const sp = vel.length();
    const dens = air / 1.225;
    if (opts.gravity !== false) {
      vel.y -= G0 * dt * (opts.gravityScale !== undefined ? opts.gravityScale : 1);
    }
    if (opts.drag !== false && p.drag) {
      const dec = p.drag * sp * sp * dens;
      if (sp > 0.0001) vel.multiplyScalar(Math.max(0, 1 - (dec * dt) / sp));
    }
    // wind adds a little push to slow stuff
    if (world.env && world.env.windSpeed && speed < 400) {
      const w = world.env.windDir;
      vel.x += (w.x * world.env.windSpeed - vel.x * 0) * dt * 0.05;
      vel.z += (w.y * world.env.windSpeed - vel.z * 0) * dt * 0.05;
    }
    p.prev.copy(p.pos);
    p.pos.addScaledVector(vel, dt);
    return vel.length();
  }

  _hitTerrain(p, world, splashScale = 1) {
    const gh = world.groundHeight(p.pos.x, p.pos.z);
    if (p.pos.y <= gh) {
      const water = gh < 0.5;
      p.pos.y = Math.max(p.pos.y, gh);
      this._effect(p, world, water ? 'water' : 'ground');
      p.dead = true;
      return true;
    }
    if (p.pos.y <= 0 && gh < p.pos.y) {
      this._effect(p, world, 'water');
      p.dead = true;
      return true;
    }
    return false;
  }

  _effect(p, world, kind) {
    const sc = p.type === 'bullet' ? 0.4 : (p.damage > 200 ? 2.4 : 1.2);
    if (kind === 'water') {
      _a.copy(p.pos); _a.y = 0;
      world.particles.impact(_a, _b.set(0, 1, 0), 1.6 + sc, false);
      if (world.audio && world.audio.splash) world.audio.splash(_a, 0.6);
    } else if (p.type === 'bullet' || p.type === 'rocket') {
      world.particles.impact(p.pos, _b.set(0, 1, 0), sc, true);
      if (world.audio && world.audio.impact) world.audio.impact(p.pos, 0.5, false);
    } else {
      world.particles.explosion(p.pos, sc);
      if (world.audio && world.audio.explosion) world.audio.explosion(p.pos, sc * 0.8, world.player && world.player.fm ? world.player.fm.pos : world.camera.position);
    }
  }

  // =======================================================================
  _stepBullet(p, dt, world) {
    this._integrate(p, dt, world);
    if (p.dead) return;
    if (this.collectMiss) this._trackMiss(p, world);
    const speed = p.vel.length();
    // tracer visual: a short additive streak every few frames
    if (p.tracer && speed > 100) {
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = 0.025;
        _b.copy(p.vel).normalize().multiplyScalar(-Math.min(60, speed * 0.05));
        world.particles.tracer(_a.copy(p.pos).add(_b), p.pos.clone(), p.tracerColor || 0xffd27a);
      }
    }
    if (this._sweepAircraft(p, world, 1.0)) return;
    if (this._sweepTargets(p, world, 1.0)) return;
    this._hitTerrain(p, world);
  }

  /**
   * Diagnostic only (collectMiss = true): remember how close each round came to
   * an enemy aircraft and from what range it was fired, so accuracy can be
   * measured instead of guessed.
   */
  _trackMiss(p, world) {
    let md = Infinity;
    for (const ac of world.aircraft) {
      if (ac === p.owner || ac.faction === p.faction) continue;
      const d = p.pos.distanceTo(ac.fm.pos);
      if (d < md) md = d;
    }
    if (p.srcD === undefined) p.srcD = md;
    if (md < (p.missD === undefined ? Infinity : p.missD)) p.missD = md;
  }

  _stepRocket(p, dt, world) {
    this._integrate(p, dt, world);
    if (p.dead) return;
    if (world.particles && this.rng.next() < 0.55) world.particles.smokeTrail(p.pos, 0.6, 0.3, 2.2, _a.copy(p.vel).multiplyScalar(-0.08));
    if (this._sweepAircraft(p, world, 1.35)) return;
    if (this._sweepTargets(p, world, 1.25)) return;
    this._hitTerrain(p, world);
  }

  _stepBomb(p, dt, world) {
    this._integrate(p, dt, world);
    if (p.dead) return;
    if (world.particles && this.rng.next() < 0.08) world.particles.smokeTrail(p.pos, 0.25, 0.5, 1.2, null);
    if (this._sweepTargets(p, world, 2.2)) return;
    if (this._hitTerrain(p, world)) return;
    if (world.audio && world.audio.bombWhistle) world.audio.bombWhistle(p.pos, clamp01(1 - p.pos.y / 4000));
  }

  _stepFlare(p, dt, world) {
    this._integrate(p, dt, world, { gravityScale: 0.85, drag: true });
    p.drag = 0.0009;
    if (p.dead) return;
    if (world.particles) {
      world.particles.flare(p.pos, p.vel, 0.25);
      if (this.rng.next() < 0.4) world.particles.smokeTrail(p.pos, 0.22, 0.55, 2.4, _a.copy(p.vel).multiplyScalar(-0.1));
    }
    this._hitTerrain(p, world);
  }

  _stepChaff(p, dt, world) {
    p.drag = 0.02;
    this._integrate(p, dt, world, { gravityScale: 0.12 });
    if (p.dead) return;
    if (world.particles && this.rng.next() < 0.25) world.particles.chaffCloud(p.pos, _a.set(0, 0, 0));
    if (p.pos.y <= 2) { p.dead = true; }
  }

  _removeFlareVisual() { /* flare particles fade on their own */ }

  // =======================================================================
  // guided missiles
  // =======================================================================
  _stepMissile(p, dt, world) {
    // --- seeker
    p.seekTimer -= dt;
    const target = p.target;
    if (p.seekState === 'search' || (!target && p.seekTimer <= 0)) {
      p.seekTimer = 0.22;
      const found = this._acquire(p, world);
      if (found) { p.target = found; p.seekState = 'track'; p.guided = true; }
    }
    if (p.target && p.seekState === 'track') {
      // break lock if the target is gone or outside the seeker FOV
      const t = p.target;
      const tp = this._targetPos(t, _c);
      if (!tp || this._targetGone(t)) { p.target = null; p.seekState = 'search'; p.seekTimer = 0.4; }
      else {
        const dist = tp.distanceTo(p.pos);
        if (dist > p.seekerRange * 1.4) { p.target = null; p.seekState = 'search'; p.seekTimer = 0.6; }
        else {
          _b.copy(tp).sub(p.pos).normalize();
          const cosang = _b.dot(_d.copy(p.vel).normalize());
          const fovCos = Math.cos(p.fov + (dist < 400 ? 1.0 : 0.0));
          if (cosang < fovCos) {
            p.lostTimer += dt;
            if (p.lostTimer > 0.55) { p.target = null; p.seekState = 'search'; p.seekTimer = 0.5; p.lostTimer = 0; }
          } else p.lostTimer = 0;
          // decoys (flares / chaff)
          if (t && t.type !== 'flare' && t.type !== 'chaff' && this.rng.next() < p.flareSusceptibility * dt * 1.6) {
            const decoy = this._nearestDecoy(p, world);
            if (decoy) { p.target = decoy; p.seekState = 'track'; }
          }
        }
      }
    }

    // --- guidance: true proportional navigation
    //     a_cmd = N * Vc * (omega_los x r_hat), applied perpendicular to the
    //     velocity vector (skid-to-turn), limited by the airframe's G limit.
    if (p.target) {
      const tp = this._targetPos(p.target, _c);
      if (tp) {
        const dist = Math.max(1, tp.distanceTo(p.pos));
        _b.copy(tp).sub(p.pos);                                  // r
        const losDir = _d.copy(_b).normalize();                  // r_hat
        const tvel = this._targetVel(p.target, _e);
        _f.copy(p.vel).sub(tvel);                                // v_rel
        const vc = Math.max(140, -_f.dot(losDir));               // closing speed
        _a.copy(_f).cross(_b).multiplyScalar(1 / (dist * dist)); // los rate vector = (r x dr/dt)/r^2
        const lat = _g.copy(_a).cross(losDir).multiplyScalar(3.6 * vc);
        const vdir = _c.copy(p.vel).normalize();
        lat.addScaledVector(vdir, -lat.dot(vdir));
        const maxA = p.maxG * G0;
        if (lat.length() > maxA) lat.setLength(maxA);
        lat.multiplyScalar(dt);
        p.vel.add(lat);
        p.vel.setLength(Math.min(p.vel.length(), p.maxSpeed));
      }
    }

    this._integrate(p, dt, world, { gravityScale: p.motorTime > 0 ? 0.15 : 1.0 });
    if (p.dead) return;

    // --- proximity fuse
    const tgt = p.target;
    if (tgt) {
      const tp = this._targetPos(tgt, _c);
      if (tp) {
        const dist = tp.distanceTo(p.pos);
        const hit = tgt.fm ? tgt.fm.pos : (tgt.pos || tp);
        const radius = tgt.hitRadius || tgt.radius || 8;
        if (dist < radius + p.radius) { this._detonate(p, world, 1.0, tgt); return; }
        if (dist < p.prox) {
          // trigger when we are past the closest approach, or when the seeker
          // reports a solid return (i.e. the fuse sees a valid target)
          const closing = _e.copy(p.vel).sub(this._targetVel(tgt, _f)).dot(_f.copy(tp).sub(p.pos));
          if (closing < 0 || dist < p.prox * 0.86) {
            this._detonate(p, world, clamp01(1 - dist / (p.prox * 2.2)), tgt);
            return;
          }
        }
      }
    }
    if (this._hitTerrain(p, world)) return;
  }

  _targetPos(t, out) {
    if (!t) return null;
    if (t.fm && t.fm.pos) return out.copy(t.fm.pos);
    if (t.pos) return out.copy(t.pos);
    return null;
  }

  _targetVel(t, out) {
    if (!t) return out.set(0, 0, 0);
    if (t.fm && t.fm.vel) return out.copy(t.fm.vel);
    if (t.type === 'flare' || t.type === 'chaff') return out.copy(t.vel);
    if (t.vel) return out.copy(t.vel);
    return out.set(0, 0, 0);
  }

  _targetGone(t) {
    if (t.type === 'flare' || t.type === 'chaff') return t.dead || t.life <= 0;
    if (t.fm) return !t.fm.alive || t.dead;
    if (t.target) return t.target.health <= 0 || t.target.dead;
    if (typeof t.health === 'number') return t.health <= 0;
    return false;
  }

  _targetFaction(t) {
    if (t.fm) return t.faction;
    if (t.team) return t.team === 'player' || t.team === 'blue' ? 'blue' : 'red';
    return t.faction || 'red';
  }

  _nearestDecoy(p, world) {
    let best = null, bestD = 1e9;
    const wantRadar = p.seeker === 'radar';
    for (const q of world.projectiles.list) {
      if (q.type !== 'flare' && q.type !== 'chaff') continue;
      if (wantRadar && q.type !== 'chaff') continue;
      if (!wantRadar && q.type !== 'flare') continue;
      if (this._targetFaction(q) === p.faction) continue;
      const d = q.pos.distanceTo(p.pos);
      if (d < 700 && d < bestD) { bestD = d; best = q; }
    }
    return best;
  }

  _acquire(p, world) {
    let best = null, bestScore = 0;
    const velDir = _a.copy(p.vel).normalize();
    const consider = (obj, isDecoy) => {
      const tp = this._targetPos(obj, _b);
      if (!tp) return;
      const d = tp.distanceTo(p.pos);
      if (d > p.seekerRange) return;
      const cos = _c.copy(tp).sub(p.pos).normalize().dot(velDir);
      if (cos < Math.cos(p.fov)) return;
      let heat = obj.heat || 0;
      if (!isDecoy && obj.fm) {
        // rear-aspect launches are much easier for IR seekers
        const rev = _c.copy(obj.fm.vel).normalize().dot(_d.copy(p.pos).sub(tp).normalize());
        const aspect = clamp01((rev + 1) * 0.5);          // 1 = chasing from behind
        const ab = obj.afterburner ? 1.9 : 1.0;
        heat = (0.35 + 0.65 * aspect) * ab * (obj.health > 0 ? 1 : 0);
        if (obj.isPlayer && obj.fm.alive) heat *= 1.25;
      } else if (isDecoy) {
        heat *= p.flareSusceptibility;
      }
      if (heat <= 0.02) return;
      const score = heat / Math.max(60, d) * (1 + cos * 0.6);
      if (score > bestScore) { bestScore = score; best = obj; }
    };
    if (p.seeker === 'heat' || p.kind === 'heat') {
      for (const ac of world.aircraft) {
        if (this._targetGone(ac)) continue;
        if (ac.faction === p.faction) continue;
        consider(ac, false);
      }
      for (const q of world.projectiles.list) {
        if (q.type !== 'flare' || q.dead) continue;
        if (this._targetFaction(q) === p.faction) continue;
        consider(q, true);
      }
    } else {
      // radar: needs a lock (illuminated target) — use the launch target if still valid
      if (p.launchTarget && !this._targetGone(p.launchTarget)) {
        const tp = this._targetPos(p.launchTarget, _b);
        const d = tp ? tp.distanceTo(p.pos) : 1e9;
        if (d < p.seekerRange * 1.5) return p.launchTarget;
      }
      for (const t of world.targets) {
        if (t.team === 'player' || t.faction === 'blue' || t.team === 'blue') continue;
      }
      for (const ac of world.aircraft) {
        if (this._targetGone(ac) || ac.faction === p.faction) continue;
        const tp = this._targetPos(ac, _b);
        if (tp && tp.distanceTo(p.pos) < p.seekerRange) {
          if (this._radarDecoyed(p, world, ac)) continue;
          const d = tp.distanceTo(p.pos);
          const score = (ac.isPlayer ? 1.4 : 1.0) / Math.max(80, d);
          if (score > bestScore) { bestScore = score; best = ac; }
        }
      }
    }
    return best;
  }

  _radarDecoyed(p, world, ac) {
    for (const q of world.projectiles.list) {
      if (q.type !== 'chaff' || q.dead) continue;
      if (q.pos.distanceTo(ac.fm.pos) < 45 && this.rng.next() < 0.5) return true;
    }
    return false;
  }

  // =======================================================================
  // hits
  // =======================================================================
  _sweepAircraft(p, world, radiusScale) {
    for (const ac of world.aircraft) {
      if (ac === p.owner) continue;
      if (this._targetGone(ac)) continue;
      if (ac.faction === p.faction) continue;            // no friendly fire
      const r = (ac.hitRadius || 6) * radiusScale * (ac.fm.alive ? 1 : 3.2);
      const d = _segPointDist(p.prev, p.pos, ac.fm.pos, _a);
      if (d < r + p.radius) {
        const damage = p.damage * clamp01(1 - d / (r + p.radius) * 0.35) * (ac.fm.alive ? 1 : 0.35);
        this._applyAircraftHit(ac, damage, _a.clone(), p, world);
        if (p.type !== 'bullet') {
          this._detonate(p, world, 0.9, ac);
          return true;
        }
        p.dead = true;
        return true;
      }
    }
    return false;
  }

  _sweepTargets(p, world, radiusScale) {
    for (const t of world.targets) {
      if (!t || t.dead || typeof t.damage !== 'function') continue;
      if (t.team === 'player' || t.faction === p.faction) continue;
      const r = (t.radius || 8) * radiusScale;
      const d = _segPointDist(p.prev, p.pos, t.pos, _a);
      if (d < r + p.radius) {
        const amount = p.damage * clamp01(1 - d / (r + p.radius) * 0.3);
        if (p.type === 'bullet') {
          t.damage(amount, world, _a.clone());
          this.stats.hits++; this.stats.groundHits++;
          world.particles.impact(_a.clone(), _b.set(0, 1, 0), 0.5, true);
          p.dead = true;
        } else {
          this._detonate(p, world, 1.0, t);
        }
        return true;
      }
    }
    return false;
  }

  _applyAircraftHit(ac, amount, point, p, world) {
    this.stats.hits++;
    if (p && p.type !== 'bullet') this.stats.missilesHit++;
    if (typeof ac.applyDamage === 'function') ac.applyDamage(amount, point, p.owner || p, world);
    if (world.audio && world.audio.hit) {
      world.audio.hit(p ? p.type : 'bullet', point,
        world.player && world.player.fm ? world.player.fm.pos : (world.camera ? world.camera.position : point));
    }
  }

  _detonate(p, world, scale, target) {
    if (p.dead) return;
    p.dead = true;
    const s = Math.max(0.35, scale);
    const big = (p.damage || 0) > 120;
    world.particles.explosion(p.pos, s * (big ? 2.4 : 1.0));
    if (world.audio && world.audio.explosion) {
      const ear = world.player && world.player.fm ? world.player.fm.pos : (world.camera ? world.camera.position : p.pos);
      world.audio.explosion(p.pos, s * (big ? 1.4 : 0.8), ear);
    }
    // splash if it went off at sea level
    if (p.pos.y < 3 && world.groundHeight(p.pos.x, p.pos.z) < 0) {
      world.particles.impact(_a.copy(p.pos).setY(0.5), _b.set(0, 1, 0), 2.2 * s, false);
    }
    if (target) {
      const radius = target.hitRadius || target.radius || 8;
      const dist = this._targetPos(target, _b) ? _b.distanceTo(p.pos) : 0;
      const falloff = clamp01(1 - Math.max(0, dist - radius) / (p.prox * 3.2 + radius));
      const amount = (p.damage || 0) * s * (0.35 + 0.65 * falloff);
      if (amount > 0.5) {
        if (typeof target.applyDamage === 'function') {
          this._applyAircraftHit(target, amount, p.pos.clone(), p, world);
        } else if (typeof target.damage === 'function') {
          target.damage(amount, world, p.pos.clone());
          this.stats.hits++; this.stats.groundHits++;
        }
      }
    } else {
      // splash damage to anything close
      for (const ac of world.aircraft) {
        if (this._targetGone(ac)) continue;
        if (ac.faction === p.faction) continue;
        const d = ac.fm.pos.distanceTo(p.pos);
        if (d < p.prox * 4) {
          this._applyAircraftHit(ac, (p.damage || 40) * s * 0.25 * clamp01(1 - d / (p.prox * 4)), p.pos.clone(), p, world);
        }
      }
      for (const t of world.targets) {
        if (!t || t.dead || typeof t.damage !== 'function') continue;
        if (t.faction === p.faction) continue;
        const d = t.pos.distanceTo(p.pos);
        const rad = 60 + (p.damage || 40) * 0.35;
        if (d < rad) t.damage((p.damage || 40) * s * clamp01(1 - d / rad) * 0.7, world, p.pos.clone());
      }
    }
  }

  // -----------------------------------------------------------------------
  flaresNearAircraft(ac, maxDist = 40) {
    let n = 0;
    for (const q of this.list) {
      if (q.type === 'flare' && q.pos.distanceTo(ac.fm.pos) < maxDist) n++;
    }
    return n;
  }

  /** Nearest incoming missile locked on the given aircraft, or null. */
  incomingMissile(ac, maxDist = 9000) {
    let best = null, bestD = maxDist;
    for (const p of this.list) {
      if (p.type !== 'missile') continue;
      if (p.faction === ac.faction) continue;
      if (p.target !== ac && p.launchTarget !== ac) continue;
      const d = p.pos.distanceTo(ac.fm.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
const _seg1 = new THREE.Vector3(), _seg2 = new THREE.Vector3(), _seg3 = new THREE.Vector3();

/** Distance from point `pt` to the segment a→b; closest point written to `out`. */
export function _segPointDist(a, b, pt, out) {
  _seg1.copy(b).sub(a);
  const len2 = _seg1.lengthSq();
  let t = 0;
  if (len2 > 1e-9) {
    _seg2.copy(pt).sub(a);
    t = clamp01(_seg2.dot(_seg1) / len2);
  }
  _seg3.copy(a).addScaledVector(_seg1, t);
  const d = _seg3.distanceTo(pt);
  if (out) out.copy(_seg3);
  return d;
}

export { clamp, clamp01 };
