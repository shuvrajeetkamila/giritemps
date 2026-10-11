// Weapons and projectiles: rotary gun with tracers, heat-seeking and radar-guided missiles,
// unguided rockets, ballistic bombs, flares and chaff. Hit tests use swept segments and spheres.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _seg = new THREE.Vector3();
const GRAVITY = new THREE.Vector3(0, -9.81, 0);

export const WEAPON_STATS = {
  gunRps: 75,           // rounds per second
  gunSpeed: 1050,       // m/s muzzle velocity
  gunRange: 1800,
  gunDamage: 3.2,
  missileSpeed: 620,
  missileMax: 1150,
  missileBurn: 6.5,
  missileLife: 25,
  irLockTime: 2.0,
  irRange: 6500,
  irCone: 0.35,         // rad (~20 deg)
  radarLockTime: 2.2,
  radarRange: 28000,
  radarCone: 0.6,       // rad (~35 deg)
  rocketSpeed: 280,
  bombRadius: 38,
  bombDamage: 520,
  rocketRadius: 12,
  rocketDamage: 90,
};

// Angle between owner's nose and a point.
export function angleTo(owner, point) {
  const f = owner.fm ? owner.fm.forward(_v) : _v.set(0, 0, -1);
  _d.copy(point).sub(owner.pos).normalize();
  return Math.acos(THREE.MathUtils.clamp(f.dot(_d), -1, 1));
}

// Distance from point P to segment A-B.
function segSphere(a, b, c, r) {
  _seg.copy(b).sub(a);
  const len2 = _seg.lengthSq();
  let t = len2 > 0 ? c.clone().sub(a).dot(_seg) / len2 : 0;
  t = THREE.MathUtils.clamp(t, 0, 1);
  _d.copy(a).addScaledVector(_seg, t).sub(c);
  return _d.length() <= r ? t : -1;
}

export class Combat {
  // world: { targets(): Entity[], groundAt(x,z), damage(target, amount, source, info), kill?... }
  constructor(scene, fx, world, audio) {
    this.scene = scene;
    this.fx = fx;
    this.world = world;
    this.audio = audio;
    this.bullets = [];
    this.missiles = [];
    this.rockets = [];
    this.bombs = [];
    this.flares = [];
    this.chaffClouds = [];
    this.sparkTimer = 0;
  }

  // ---- Guns ---------------------------------------------------------------
  fireGun(owner, dt) {
    if (!owner.gunTrigger) return;
    owner.gunSpin = Math.min(1, (owner.gunSpin || 0) + dt / (owner.spinUp || 0.25));
    if (owner.gunSpin < 0.99) return;
    owner.gunCooldown = (owner.gunCooldown || 0) - dt;
    const rate = 1 / WEAPON_STATS.gunRps;
    while (owner.gunCooldown <= 0 && owner.ammo > 0) {
      owner.gunCooldown += rate;
      owner.ammo--;
      const f = owner.fm.forward(_v).clone();
      const muzzle = owner.pos.clone().addScaledVector(f, 6).addScaledVector(owner.fm.up(_d), -0.4);
      // Small dispersion per round.
      f.x += (Math.random() - 0.5) * 0.004; f.y += (Math.random() - 0.5) * 0.004;
      f.normalize();
      const vel = f.multiplyScalar(WEAPON_STATS.gunSpeed).add(owner.vel);
      this.bullets.push({ pos: muzzle.clone(), prev: muzzle.clone(), vel, life: WEAPON_STATS.gunRange / WEAPON_STATS.gunSpeed, owner, color: owner.team === 'player' ? [1, 0.82, 0.35] : [1, 0.25, 0.1] });
      if (owner.stats) owner.stats.shots++;
      if (Math.random() < 0.5) this.fx.muzzle(muzzle, f);
      if (this.audio) this.audio.cannonShot(owner.isPlayer, owner.pos);
    }
    if (owner.ammo <= 0 && owner.gunTrigger) owner.gunTrigger = false;
  }

  // ---- Missiles -----------------------------------------------------------
  // kind: 'ir' or 'radar'. Returns the missile or null.
  fireMissile(owner, target, kind) {
    const st = owner.missiles;
    if (!st || st[kind] <= 0) return null;
    st[kind]--;
    const f = owner.fm.forward(_v).clone();
    const start = owner.pos.clone().addScaledVector(f, 5).addScaledVector(owner.fm.up(_d), -0.6);
    const vel = f.multiplyScalar(260).add(owner.vel);
    const m = {
      kind, owner, target, pos: start, prev: start.clone(), vel, age: 0, burn: WEAPON_STATS.missileBurn,
      alive: true, seekPos: target ? target.pos.clone() : null, flareTarget: null, boost: owner.missileBoost || 1,
      smoke: 0, hostile: owner.team !== 'player', lostLock: false,
      maxTurn: kind === 'ir' ? 2.8 : 2.0,
    };
    this.missiles.push(m);
    if (owner.stats) owner.stats.missilesFired++;
    if (this.audio) this.audio.missileLaunch(owner.isPlayer, m.pos);
    this.fx.sparks(start, 6, [1, 0.9, 0.6]);
    return m;
  }

  fireRocketSalvo(owner, count = 6) {
    if (owner.rockets <= 0) return 0;
    const n = Math.min(count, owner.rockets);
    owner.rockets -= n;
    const f0 = owner.fm.forward(_v).clone();
    const up = owner.fm.up(_d).clone();
    const rt = owner.fm.right(new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.05;
      const dir = f0.clone().addScaledVector(rt, Math.sin(a) * 0.5).addScaledVector(up, -0.02 * i).normalize();
      const pos = owner.pos.clone().addScaledVector(dir, 4);
      this.rockets.push({ pos, prev: pos.clone(), vel: dir.multiplyScalar(WEAPON_STATS.rocketSpeed).add(owner.vel), life: 9, owner, alive: true, hostile: owner.team !== 'player' });
    }
    if (this.audio) this.audio.missileLaunch(owner.isPlayer, owner.pos, 0.5);
    return n;
  }

  dropBomb(owner) {
    if (owner.bombs <= 0) return false;
    owner.bombs--;
    const pos = owner.pos.clone().add(new THREE.Vector3(0, -2, 0));
    this.bombs.push({ pos, prev: pos.clone(), vel: owner.vel.clone(), life: 40, owner, alive: true });
    return true;
  }

  deployFlares(owner, count = 4) {
    if (!owner.flares || owner.flares <= 0) return false;
    const n = Math.min(count, owner.flares);
    owner.flares -= n;
    const back = owner.fm.forward(_v).clone().multiplyScalar(-1);
    const up = owner.fm.up(_d).clone();
    for (let i = 0; i < n; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 8);
      const vel = back.clone().multiplyScalar(18).add(spread).addScaledVector(up, -4).add(owner.vel.clone().multiplyScalar(0.3));
      this.flares.push({ pos: owner.pos.clone().addScaledVector(back, 6), vel, life: 4.2, owner });
    }
    if (this.audio) this.audio.flareDrop(owner.isPlayer);
    return true;
  }

  deployChaff(owner) {
    if (!owner.chaff || owner.chaff <= 0) return false;
    owner.chaff--;
    this.chaffClouds.push({ pos: owner.pos.clone(), life: 7, owner });
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 12).add(owner.vel.clone().multiplyScalar(0.5));
      this.fx.glow.emit(owner.pos, v, { life: 2.5, s0: 2, s1: 9, c0: [0.85, 0.87, 0.9], c1: [0.7, 0.72, 0.75], a0: 0.6, a1: 0, drag: 1.2 });
    }
    return true;
  }

  // Anti-aircraft tracer round from a ground gun or ship mount.
  fireAA(src, dir, ship = false) {
    const speed = ship ? 900 : 1000;
    const pos = src.pos.clone().addScaledVector(dir, 6);
    const vel = dir.clone().multiplyScalar(speed);
    this.bullets.push({ pos: pos.clone(), prev: pos.clone(), vel, life: 2.2, owner: { team: 'enemy', pos: src.pos, vel: new THREE.Vector3(), isAA: true, id: src.id ?? 'aa', stats: null }, color: [1, 0.35, 0.1], aa: true });
    if (this.audio) this.audio.cannonShot(false, src.pos, 0.6);
  }

  // Splash damage to all targets in radius.
  splash(pos, radius, dmg, source) {
    for (const t of this.world.targets()) {
      if (!t.alive) continue;
      const d = t.pos.distanceTo(pos) - (t.radius || 0) * 0.5;
      if (d < radius) {
        const k = 1 - Math.max(0, d) / radius;
        this.world.damage(t, dmg * k, source, { kind: 'splash' });
      }
    }
  }

  // ---- Update -------------------------------------------------------------
  update(dt) {
    const targets = this.world.targets();
    // Bullets.
    for (const b of this.bullets) {
      b.prev.copy(b.pos);
      b.vel.y -= 0.8 * dt;   // slight drop for long shots
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let hit = false;
      for (const t of targets) {
        if (!t.alive || t === b.owner) continue;
        if (b.owner.team === t.team) continue;
        if (b.owner.pos.distanceTo(t.pos) > 6000) continue;
        const r = (t.radius || 6) * 1.1;
        const s = segSphere(b.prev, b.pos, t.pos, r);
        if (s >= 0) {
          const hp = b.prev.clone().lerp(b.pos, s);
          this.world.damage(t, WEAPON_STATS.gunDamage * (t.kind === 'ground' ? 1.2 : 1), b.owner, { kind: 'gun', at: hp });
          if (b.owner.stats) b.owner.stats.hits++;
          this.fx.impact(hp, t.kind === 'ground');
          hit = true;
          break;
        }
      }
      if (!hit) {
        const g = this.world.groundAt(b.pos.x, b.pos.z);
        if (b.pos.y < g) { hit = true; this.fx.impact(b.pos.clone(), true); }
      }
      if (hit) b.life = -1;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    // Missiles.
    for (const m of this.missiles) this.updateMissile(m, dt, targets);
    this.missiles = this.missiles.filter((m) => m.alive);

    // Rockets.
    for (const r of this.rockets) {
      r.prev.copy(r.pos);
      r.vel.addScaledVector(GRAVITY, dt);
      r.pos.addScaledVector(r.vel, dt);
      r.life -= dt;
      this.fx.smokePuff(r.pos, _v.set(0, 0.5, 0), 0.25, false, 1.2);
      let boom = r.life <= 0;
      for (const t of targets) {
        if (!t.alive || t === r.owner) continue;
        if (t.team === r.owner.team) continue;
        if (segSphere(r.prev, r.pos, t.pos, (t.radius || 6)) >= 0) { boom = true; break; }
      }
      if (r.pos.y < this.world.groundAt(r.pos.x, r.pos.z)) boom = true;
      if (boom) {
        r.alive = false;
        this.explode(r.pos, WEAPON_STATS.rocketRadius, WEAPON_STATS.rocketDamage, r.owner, 0.7);
      }
    }
    this.rockets = this.rockets.filter((r) => r.alive);

    // Bombs: ballistic, detonate on contact with ground or after timeout.
    for (const b of this.bombs) {
      b.prev.copy(b.pos);
      b.vel.addScaledVector(GRAVITY, dt);
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      this.fx.smokePuff(b.pos, _v.set(0, 1, 0), 0.4, true, 1);
      const g = this.world.groundAt(b.pos.x, b.pos.z);
      if (b.pos.y <= g || b.life <= 0) {
        b.alive = false;
        this.explode(b.pos.clone(), WEAPON_STATS.bombRadius, WEAPON_STATS.bombDamage, b.owner, 2.2);
      }
    }
    this.bombs = this.bombs.filter((b) => b.alive);

    // Flares: bright points that decay and fall.
    for (const f of this.flares) {
      f.life -= dt;
      f.vel.multiplyScalar(Math.exp(-0.8 * dt));
      f.vel.addScaledVector(GRAVITY, dt * 0.4);
      f.pos.addScaledVector(f.vel, dt);
      if (Math.random() < 0.9) this.fx.glow.emit(f.pos, _v.set(0, 0, 0), { life: 0.25, s0: 9, s1: 4, c0: [1, 0.6, 0.2], c1: [1, 0.2, 0.05], a0: 1, a1: 0, drag: 0.1 });
    }
    this.flares = this.flares.filter((f) => f.life > 0);
    for (const c of this.chaffClouds) c.life -= dt;
    this.chaffClouds = this.chaffClouds.filter((c) => c.life > 0);
  }

  explode(pos, radius, dmg, owner, scale) {
    this.fx.explosion(pos, scale);
    if (this.audio) this.audio.explosion(pos, scale);
    this.splash(pos, radius, dmg, owner);
  }

  updateMissile(m, dt, targets) {
    m.age += dt;
    m.prev.copy(m.pos);
    const tgt = m.target;
    let aliveTarget = tgt && tgt.alive;

    // Radar missiles break lock when the launcher loses its radar lock or chaff confuses the seeker.
    if (m.kind === 'radar' && aliveTarget) {
      if (!m.owner.alive || (m.owner.radarLockTarget !== tgt && m.age > 0.6)) m.lostLock = true;
      for (const c of this.chaffClouds) {
        if (c.pos.distanceTo(tgt.pos) < 350 && Math.random() < dt * 0.9) { m.lostLock = true; break; }
      }
    }

    // IR seekers can be decoyed by flares closer to the missile than the target.
    if (m.kind === 'ir' && aliveTarget && this.flares.length) {
      let best = null, bd = Infinity;
      for (const f of this.flares) {
        const d = f.pos.distanceTo(m.pos);
        if (d < bd && d < 1200) { best = f; bd = d; }
      }
      if (best && bd < m.pos.distanceTo(tgt.pos) * 1.1 && Math.random() < dt * 1.2) {
        m.flareTarget = best;
      }
      if (m.flareTarget && m.flareTarget.life <= 0) m.flareTarget = null;
    }

    let desired;
    if (m.lostLock || !aliveTarget) {
      // Ballistic: continue with current velocity, slight gravity.
      desired = null;
      m.vel.addScaledVector(GRAVITY, dt * 0.5);
    } else {
      const seek = m.flareTarget ? m.flareTarget.pos : tgt.pos;
      const dist = m.pos.distanceTo(seek);
      const lead = tgt.vel ? tgt.vel.clone().multiplyScalar(Math.min(dist / Math.max(m.vel.length(), 1), 3)) : _v.set(0, 0, 0);
      desired = (m.flareTarget ? seek.clone() : seek.clone().add(lead)).sub(m.pos).normalize();
      // Engagement envelope: IR seekers lose lock beyond ~70 deg off-boresight.
      const cur = m.vel.clone().normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(cur.dot(desired), -1, 1));
      const turn = Math.min(ang, m.maxTurn * (m.age > 4 ? 0.5 : 1) * dt * 1.2);
      if (ang > 1e-4) {
        const axis = new THREE.Vector3().crossVectors(cur, desired).normalize();
        if (isFinite(axis.x)) cur.applyAxisAngle(axis, turn);
      }
      const speed = m.vel.length();
      const burning = m.burn > 0;
      m.burn -= dt;
      const targetSpeed = burning ? WEAPON_STATS.missileMax * m.boost : 700;
      const newSpeed = speed + (targetSpeed - speed) * Math.min(1, dt * (burning ? 0.7 : 0.25));
      m.vel.copy(cur).multiplyScalar(newSpeed);
      m.vel.y -= 1.5 * dt;
    }
    m.pos.addScaledVector(m.vel, dt);
    m.smoke += dt;
    if (m.smoke > 0.03) {
      m.smoke = 0;
      this.fx.smokePuff(m.pos, _v.set(0, 2, 0), 0.5, false, 3.5 + Math.random() * 2);
      if (m.burn > 0) this.fx.glow.emit(m.pos, _v.set(0, 0, 0), { life: 0.1, s0: 4, s1: 6, c0: [1, 0.7, 0.4], c1: [1, 0.4, 0.1], a0: 1, a1: 0, drag: 0 });
    }

    // Hit tests.
    if (aliveTarget) {
      const hitR = (tgt.radius || 6) + 4;
      if (segSphere(m.prev, m.pos, tgt.pos, hitR) >= 0) {
        this.world.damage(tgt, m.kind === 'ir' ? 60 : 85, m.owner, { kind: 'missile' });
        if (m.owner.stats) m.owner.stats.hits++;
        this.explode(m.pos, 14, 0, m.owner, 1.0);
        m.alive = false;
        return;
      }
    }
    // Proximity burst near other hostile aircraft.
    for (const t of targets) {
      if (!t.alive || t === m.owner || t.team === m.owner.team) continue;
      if (t === tgt) continue;
      if (t.pos.distanceTo(m.pos) < (t.radius || 6) + 3 && t.kind === 'air') {
        this.world.damage(t, 40, m.owner, { kind: 'missile' });
        this.explode(m.pos, 12, 0, m.owner, 0.9);
        m.alive = false;
        return;
      }
    }
    const g = this.world.groundAt(m.pos.x, m.pos.z);
    if (m.pos.y < g || m.age > WEAPON_STATS.missileLife || m.pos.length() > 60000) {
      if (m.pos.y < g) this.explode(m.pos, 16, 30, m.owner, 1.1);
      m.alive = false;
    }
  }

  // Release all projectiles (scene reset / game end).
  clear() {
    this.bullets = []; this.missiles = []; this.rockets = []; this.bombs = []; this.flares = []; this.chaffClouds = [];
  }
}

export { segSphere };
