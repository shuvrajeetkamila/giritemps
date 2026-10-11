// ---------------------------------------------------------------------------
// Aircraft — runtime entity: procedural model + flight model + weapons +
// lights, afterburner, control surfaces, gear, damage states and FX.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { FlightModel } from '../sim/FlightModel.js';
import { buildAircraftModel, AIRCRAFT_SPECS } from './AircraftModels.js';
import { WORLD_LIGHT_UNIFORMS, injectWorldShading } from '../render/Shading.js';
import { SHADOW_LAYER_OBJECTS } from '../render/CascadedShadows.js';
import { clamp, clamp01, lerp, damp, RNG, TAU, G0 } from '../core/Utils.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const MAX_WEAPONS = 6;

export class Aircraft {
  constructor(opts) {
    this.spec = opts.spec;
    this.def = AIRCRAFT_SPECS[opts.spec] || opts.spec;
    if (typeof opts.spec === 'string') this.spec = this.def;
    this.faction = opts.faction || 'blue';
    this.isPlayer = !!opts.isPlayer;
    this.callsign = opts.callsign || 'VIPER 1';
    this.world = opts.world;
    this.rng = new RNG(opts.seed || 4242);
    this.skill = opts.skill !== undefined ? opts.skill : 0.6;   // 0..1
    this.role = opts.role || 'fighter';
    this.hitRadius = Math.max(this.def.span, this.def.length) * 0.42;

    // ---- flight
    this.fm = new FlightModel(this.def);
    this.fm.reset({ y: opts.y || 2000, speed: opts.speed || 240, throttle: opts.throttle !== undefined ? opts.throttle : 0.7 });

    // ---- health / systems
    this.maxHealth = 100 + this.def.mass / 260;
    this.health = this.maxHealth;
    this.engineHealth = [1, 1];
    this.controlHealth = { pitch: 1, roll: 1, yaw: 1 };
    this.radarHealth = 1;
    this.fuelLeak = 0;
    this.fireTimer = 0;
    this.smokeLevel = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.ejectTimer = 0;
    this.crashedOnGround = false;
    this.gunHeat = 0;
    this.gunJammed = false;
    this.gunTimer = 0;
    this._muzzleSide = 1;

    // ---- weapons
    const lo = this.def.loadout;
    this.weapons = {
      gun: { name: this.def.gun.name, ammo: this.def.gun.rounds, max: this.def.gun.rounds, kind: 'gun' },
      aim9: { name: 'AIM-9X', count: lo.aim9 || 0, max: lo.aim9 || 0, kind: 'heat' },
      aim120: { name: 'AIM-120D', count: lo.aim120 || 0, max: lo.aim120 || 0, kind: 'radar' },
      archer: { name: 'R-73', count: lo.archer || 0, max: lo.archer || 0, kind: 'heat' },
      rocket: { name: 'S-8 ROCKETS', count: (lo.rocketPods || 0) * 7, max: (lo.rocketPods || 0) * 7, kind: 'rocket' },
      bomb: { name: 'FAB-250', count: lo.bombs || 0, max: lo.bombs || 0, kind: 'bomb' }
    };
    this.flares = lo.flares !== undefined ? lo.flares : 30;
    this.chaff = lo.chaff !== undefined ? lo.chaff : 30;
    this.weaponOrder = ['gun', 'aim9', 'aim120', 'rocket', 'bomb'].filter((k) => this.weapons[k].max > 0);
    this.weaponIndex = 0;
    this.radarLockTarget = null;
    this.lockProgress = 0;
    this.lockTarget = null;
    this.flareTimer = 0;

    // ---- lights / fx
    this.lightsOn = true;
    this.strobeTimer = 0;
    this.strobeOn = false;
    this.contrailTimer = 0;
    this.vaporTimer = 0;
    this.damageFxTimer = 0;
    this.heatSignature = 1;

    // ---- model
    const livery = opts.livery || this.def.liveries[opts.liveryIndex || 0];
    this.model = buildAircraftModel(this.def, { livery, liveryIndex: opts.liveryIndex });
    this.parts = this.model;
    this.group = this.model.group;
    this.group.position.copy(this.fm.pos);
    this.group.quaternion.copy(this.fm.quat);
    this.applyMaterials(opts.csmUniforms);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.layers.enable(SHADOW_LAYER_OBJECTS);
        o.userData.aircraft = this;
      }
    });
    this.gearAnim = this.fm.gearDown ? 1 : 0;
    this.aileron = 0; this.elevator = 0; this.rudder = 0; this.flap = 0;
    this.propAngle = 0; this.fanAngle = 0;
    this.abLevel = 0;
    this.afterburnerLight = null;
    this._setupLights();
  }

  applyMaterials(csmUniforms) {
    const uniforms = Object.assign({}, csmUniforms || {}, WORLD_LIGHT_UNIFORMS);
    const seen = new Set();
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);
        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
          m.envMapIntensity = m.envMapIntensity || 1.0;
          injectWorldShading(m, uniforms);
        }
      }
    });
    this.uniformRefs = uniforms;
  }

  _setupLights() {
    this.navLights = this.parts.navLights || [];
    for (const l of this.navLights) {
      if (!l.material) continue;
      l.material = l.material.clone();
      l.material.emissiveIntensity = 0;
    }
  }

  // -----------------------------------------------------------------------
  get speed() { return this.fm.speed; }
  get alive() { return this.fm.alive && this.health > 0; }

  reset(opts = {}) {
    this.fm.reset(opts);
    this.health = this.maxHealth;
    this.engineHealth = [1, 1];
    this.controlHealth = { pitch: 1, roll: 1, yaw: 1 };
    this.radarHealth = 1;
    this.fuelLeak = 0; this.fireTimer = 0; this.smokeLevel = 0;
    this.dead = false; this.deathTimer = 0; this.ejectTimer = 0; this.crashedOnGround = false;
    const lo = this.def.loadout;
    this.weapons.gun.ammo = this.def.gun.rounds;
    this.weapons.aim9.count = lo.aim9 || 0;
    this.weapons.aim120.count = lo.aim120 || 0;
    this.weapons.archer.count = lo.archer || 0;
    this.weapons.rocket.count = (lo.rocketPods || 0) * 7;
    this.weapons.bomb.count = lo.bombs || 0;
    this.flares = lo.flares !== undefined ? lo.flares : 30;
    this.chaff = lo.chaff !== undefined ? lo.chaff : 30;
    this.radarLockTarget = null; this.lockProgress = 0; this.lockTarget = null;
    this.gearAnim = 1;
    this.group.visible = true;
    if (this.destroyedFx) this.destroyedFx.visible = false;
  }

  /** Current selected weapon object. */
  get weapon() { return this.weapons[this.weaponOrder[this.weaponIndex]]; }

  cycleWeapon(dir = 1) {
    this.weaponIndex = (this.weaponIndex + dir + this.weaponOrder.length) % this.weaponOrder.length;
    return this.weapon;
  }

  selectWeapon(key) {
    const i = this.weaponOrder.indexOf(key);
    if (i >= 0) this.weaponIndex = i;
  }

  // -----------------------------------------------------------------------
  update(dt, input, world, opts = {}) {
    const fm = this.fm;
    // ---- control damage feedback
    this.aileron = damp(this.aileron, clamp(input.roll || 0, -1, 1), 9, dt);
    this.elevator = damp(this.elevator, clamp(input.pitch || 0, -1, 1), 9, dt);
    this.rudder = damp(this.rudder, clamp(input.yaw || 0, -1, 1), 9, dt);
    this.flap = damp(this.flap, fm.flaps, 2.4, dt);

    if (fm.gearDown || fm.speed < 60) fm.gearDown = this.gearAnim > 0.02 || fm.speed < 60;
    const gearTarget = fm.gearDown ? 1 : 0;
    this.gearAnim = damp(this.gearAnim, gearTarget, 1.6, dt);

    // ---- damage propagation
    this.engineHealth[0] = 1 - fm.engineDamage[0];
    this.engineHealth[1] = 1 - fm.engineDamage[1];
    fm.controlDamage.pitch = 1 - this.controlHealth.pitch;
    fm.controlDamage.roll = 1 - this.controlHealth.roll;
    fm.controlDamage.yaw = 1 - this.controlHealth.yaw;

    const hpFrac = clamp01(this.health / this.maxHealth);
    this.smokeLevel = clamp01((1 - hpFrac) * 1.2 + (1 - (this.engineHealth[0] + this.engineHealth[1]) * 0.5));
    if (hpFrac < 0.3 || this.engineHealth[0] < 0.5 || this.engineHealth[1] < 0.5) {
      this.fireTimer += dt;
    } else {
      this.fireTimer = Math.max(0, this.fireTimer - dt * 2);
    }

    if (this.fuelLeak > 0) {
      fm.fuel = Math.max(0, fm.fuel - dt * this.fuelLeak * 90);
      fm.fuelPercent = fm.fuel / fm.spec.fuel;
    }
    this.heatSignature = 1 + (fm.afterburner ? 1.4 : 0) + this.smokeLevel * 0.3;
    if (!fm.alive && !this.dead) this._onCrash(world);

    // ---- weapons
    this._updateGun(dt, input, world);
    this.flareTimer = Math.max(0, this.flareTimer - dt);
    this.gunHeat = Math.max(0, this.gunHeat - dt * 0.42);
    if (this.gunHeat < 0.9) this.gunJammed = false;

    // ---- fly
    if (!this.dead) {
      fm.update(dt, input, world);
    } else {
      this.deathTimer += dt;
      fm.update(dt, input, world);
    }
    this.syncModel(dt, world, opts);
    return fm;
  }

  syncModel(dt, world, opts = {}) {
    const fm = this.fm;
    this.group.position.copy(fm.pos);
    this.group.quaternion.copy(fm.quat);

    // control surfaces
    const p = this.parts;
    const ail = (p.ailerons && p.ailerons.length) ? p.ailerons : [];
    for (let i = 0; i < ail.length; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      ail[i].rotation.z = -this.aileron * 0.42 * side;
    }
    for (const e of (p.elevators || [])) e.rotation.z = -this.elevator * 0.36;
    for (const r of (p.rudders || [])) r.rotation.y = this.rudder * 0.5;
    for (const f of (p.flaps || [])) f.rotation.z = this.flap * 0.55;
    for (const c of (p.canards || [])) c.rotation.z = -this.elevator * 0.3;

    // gear
    const g = this.gearAnim;
    for (const gear of (p.gears || [])) {
      const target = gear.userData.stowRot || 1.5;
      gear.rotation.x = (1 - g) * target * (gear.userData.dir || 1);
      gear.visible = g > 0.02;
    }
    for (const door of (p.gearDoors || [])) door.rotation.x = g * 1.4;

    // afterburner
    const ab = fm.afterburner && fm.alive && this.engineHealth[0] > 0.15 ? 1 : 0;
    this.abLevel = damp(this.abLevel, ab, 12, dt);
    const nozzleGlow = fm.throttle * (0.4 + this.abLevel * 0.9) * this.engineHealth[0];
    for (const cone of (p.abCones || [])) {
      cone.visible = this.abLevel > 0.05;
      const s = 0.35 + this.abLevel * (0.9 + Math.sin(performance.now() * 0.05) * 0.06);
      cone.scale.set(0.8 + s * 0.25, 0.8 + s * 0.25, s * 1.5);
      if (cone.material) {
        if (!cone.material.userData.orig) cone.material.userData.orig = cone.material.clone();
        cone.material.opacity = lerp(0.35, 0.95, this.abLevel);
        cone.material.color.setRGB(1.0, lerp(0.55, 0.82, this.abLevel), lerp(0.2, 0.6, this.abLevel));
      }
    }
    for (const n of (p.nozzles || [])) {
      if (n.material && n.material.emissive) n.material.emissiveIntensity = 0;
    }
    // engine glow rings
    if (p.nozzles) {
      for (const nz of p.nozzles) {
        let glow = nz.userData.glow;
        if (!glow) {
          glow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), new THREE.MeshBasicMaterial({
            color: 0xff8844, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
          }));
          glow.rotation.x = Math.PI / 2;
          glow.position.set(0, 0, -0.4);
          nz.add(glow);
          nz.userData.glow = glow;
        }
        glow.material.opacity = clamp01(nozzleGlow * 0.9);
        glow.visible = this.abLevel > 0.4;
      }
    }

    // propeller / fan spin
    this.propAngle += dt * (12 + fm.rpm * 70);
    for (const prop of (p.props || [])) prop.rotation.z = this.propAngle;
    this.fanAngle += dt * (6 + fm.rpm * 40);
    for (const fan of (p.fans || [])) fan.rotation.z = this.fanAngle;

    // nav lights + strobes
    this.strobeTimer -= dt;
    if (this.strobeTimer <= 0) { this.strobeTimer = 1.15; this.strobeOn = !this.strobeOn; }
    const navOn = this.lightsOn ? 1 : 0;
    for (const l of this.navLights) {
      if (!l.material) continue;
      const isStrobe = l.userData.strobe;
      const strobe = isStrobe ? (this.strobeOn ? 2.5 : 0.05) : 1.0;
      const blink = this.dead ? 0 : 1;
      l.material.emissiveIntensity = navOn * strobe * 1.6 * blink;
    }

    // ---- FX: contrails, vapor, damage smoke and fire
    if (world && world.particles) {
      const dens = world.env ? world.env.airDensity(fm.pos.y) : 1;
      const alt = fm.pos.y;
      const needContrail = this.engineHealth[0] > 0.2 && (alt > 7500 || world.env && world.env.tempAt(alt) < -35) && fm.speed > 120;
      this.contrailTimer -= dt;
      if (needContrail && this.contrailTimer <= 0) {
        this.contrailTimer = 0.035;
        for (const noz of (p.nozzles || [])) {
          noz.getWorldPosition(_v);
          world.particles.contrail(_v, 1.0 + this.engineHealth[0] * 0.5);
        }
      }
      // vapour over the wings at high G / transonic
      const vaporAmt = clamp01((Math.abs(fm.gLoad) - 3.4) / 3.5) + clamp01((fm.mach - 0.94) / 0.12) * 0.8;
      this.vaporTimer -= dt;
      if (vaporAmt > 0.05 && this.vaporTimer <= 0) {
        this.vaporTimer = 0.02;
        const srcs = p.vaporPoints || null;
        if (srcs && srcs.length) {
          for (const s of srcs) { s.getWorldPosition(_v); world.particles.vaporPuff(_v, vaporAmt, fm.vel); }
        } else {
          for (const w of [1, -1]) {
            _v.set(w * this.def.span * 0.34, 0, -0.4).applyQuaternion(fm.quat).add(fm.pos);
            world.particles.vaporPuff(_v, vaporAmt, fm.vel);
          }
        }
      }
      // damage smoke
      this.damageFxTimer -= dt;
      const smoking = this.smokeLevel > 0.25 && this.deathTimer < 22;
      if (smoking && this.damageFxTimer <= 0) {
        this.damageFxTimer = this.smokeLevel > 0.7 ? 0.02 : 0.055;
        const dark = this.smokeLevel > 0.75 ? 0.12 : 0.3;
        for (const noz of (p.nozzles || [])) {
          noz.getWorldPosition(_v);
          world.particles.smokeTrail(_v, 1.2 + this.smokeLevel * 2.2, dark, 3.4, fm.vel);
        }
        if (this.fireTimer > 0.6) {
          _v.copy(fm.pos).add(_v2.set(0, 1.2, -1).applyQuaternion(fm.quat));
          world.particles.alpha.spawn({
            x: _v.x, y: _v.y, z: _v.z, size: 2.0, grow: 5, r: 1.0, g: 0.6, b: 0.2, a: 0.8,
            life: 0.22, sprite: 1, drag: 3, fadePow: 1.0
          });
        }
      }
    }
    // sonic boom
    if (!this.boomed && fm.mach > 1.02 && fm.alive) {
      this.boomed = true;
      if (world && world.audio) world.audio.sonicBoom(this.isPlayer ? 0.5 : clamp01(1 - fm.pos.distanceTo(world.camera.position) / 2000) * 0.8);
    } else if (fm.mach < 0.95) this.boomed = false;
  }

  _updateGun(dt, input, world) {
    const gun = this.weapons.gun;
    if (!this.isFiringGun) { this.gunTimer = 0; return; }
    if (gun.ammo <= 0 || !this.alive) return;
    if (this.gunHeat > 1.75) { this.gunJammed = true; return; }   // barrel overheat
    const rate = this.def.gun.rpm / 60;
    this.gunTimer -= dt;
    const interval = 1 / rate;
    while (this.gunTimer <= 0 && gun.ammo > 0) {
      this.gunTimer += interval;
      gun.ammo--;
      this.fireRound(world);
    }
  }

  fireRound(world) {
    const fm = this.fm;
    const gun = this.def.gun;
    // the gun port sits just above the nose; rounds alternate left/right
    this._muzzleSide = -(this._muzzleSide || 1);
    _v.copy(fm.pos)
      .add(_v2.set(this._muzzleSide * this.def.span * 0.06, -0.05, this.def.length * 0.46).applyQuaternion(fm.quat));
    // computed gun solution: lead the target and compensate for bullet drop,
    // so the pipper and the tracer stream agree.
    const aim = this.gunAimPoint(world, _v4);
    if (aim) _v3.copy(aim).sub(_v).normalize();
    else _v3.set(0, 0, 1).applyQuaternion(fm.quat);
    const spread = gun.spread * (1 + Math.abs(fm.gLoad) * 0.25 + Math.abs(fm.aoa) * 1.6)
      * (this.isPlayer ? 0.85 : 1.0) * (1 + fm.controlDamage.pitch * 1.5);
    // gaussian-ish dispersion around the computed solution
    _v3.x += (this.rng.float(-1, 1) + this.rng.float(-1, 1)) * 0.7 * spread;
    _v3.y += (this.rng.float(-1, 1) + this.rng.float(-1, 1)) * 0.7 * spread;
    _v3.z += this.rng.float(-1, 1) * spread * 0.4;
    _v3.normalize();
    world.projectiles.spawnBullet(this, _v, _v3, gun.speed, gun.damage, this.faction, { life: 2.2 });
    if (world.particles) world.particles.muzzleFlash(_v, _v3, 1.0);
    this.gunHeat = Math.min(2.2, this.gunHeat + 0.0075);
  }

  /**
   * Ballistic aim point for the cannon: predicted intercept of the current
   * gun target plus gravity-drop compensation.  Returns the scratch vector
   * passed in, or null when the nose is the only reference.
   */
  gunAimPoint(world, out, speedOverride) {
    const fm = this.fm, gun = this.def.gun;
    // speedOverride lets the unguided rockets use the same solver: they leave
    // the pod at ~160 m/s + airspeed and accelerate under power, so a round
    // launched along the bore would drop tens of metres short.
    const speed = speedOverride || gun.speed;
    let tgt = this.radarLockTarget || null;
    if (!tgt && this.ai && this.ai.target && this.ai.target.fm && this.ai.target.fm.alive) tgt = this.ai.target;
    // the gun target may be a ground installation (no flight model) as well as
    // an aircraft, so accept either shape here - otherwise the locked ground
    // target is silently dropped and the pipper falls back to the boresight
    if (!tgt && this.gunTarget
      && ((this.gunTarget.fm && this.gunTarget.fm.alive) || (!this.gunTarget.fm && !this.gunTarget.dead))) {
      tgt = this.gunTarget;
    }
    // ground targets are static: no lead, only the ballistic drop matters
    if (tgt && !tgt.fm && tgt.pos && !tgt.dead) {
      const r = _v5.copy(tgt.pos).sub(fm.pos);
      const dist = r.length();
      if (dist > 30) {
        const t = dist / Math.max(1, speed);
        out.copy(tgt.pos);
        out.y += 0.5 * G0 * t * t;
        return out;
      }
    }
    if (tgt && tgt.fm && tgt.fm.alive && tgt.fm.pos.distanceTo(fm.pos) < 4000) {
      // rounds are fired at muzzle velocity in world space (they do not inherit
      // the launch platform's velocity), so only the target's motion is led.
      // Bullet drag is folded in by iterating with a decayed average speed.
      const r = _v5.copy(tgt.fm.pos).sub(fm.pos);
      const vrel = _v6.copy(tgt.fm.vel);
      const vv = vrel.lengthSq();
      const decel = speedOverride ? 0 : 6e-6 * speed * speed;   // matches ProjectileSystem
      let t = 0;
      let sEff = speed;
      for (let k = 0; k < 3; k++) {
        const a = sEff * sEff - vv;
        const b = -2 * r.dot(vrel);
        const c = -r.lengthSq();
        let tk = 0;
        if (Math.abs(a) > 1e-4) {
          const disc = b * b - 4 * a * c;
          if (disc > 0) {
            const sq = Math.sqrt(disc);
            const cands = [(-b + sq) / (2 * a), (-b - sq) / (2 * a)].filter((x) => x > 0.02 && x < 9);
            tk = cands.length ? Math.min(...cands) : 0;
          }
        } else if (Math.abs(b) > 1e-4) {
          tk = -c / b;
        }
        if (!(tk > 0)) { t = 0; break; }
        t = tk;
        sEff = speed - 0.5 * decel * t;
      }
      if (t > 0) {
        // Second-order prediction: a bandit pulling 6 g moves ~100 m sideways
        // during a 1.5 s bullet flight, so a straight-line lead always trails
        // him.  The target's own acceleration is folded in, limited to a
        // realistic dwell (nobody holds full deflection for the whole flight).
        out.copy(tgt.fm.pos).addScaledVector(tgt.fm.vel, t);
        if (tgt.fm.accel) out.addScaledVector(tgt.fm.accel, 0.5 * t * Math.min(t, 1.2));
        out.y += 0.5 * G0 * t * t;
        return out;
      }
    }
    // fallback: straight ahead, still drop-compensated.  world.aimPoint comes
    // from the camera, so reject it when it is not actually out in front of the
    // aircraft (a stale/reversed camera must never fire the gun backwards).
    const nose = _v3.set(0, 0, 1).applyQuaternion(fm.quat);
    if (this.isPlayer && world && world.aimPoint
      && _v5.copy(world.aimPoint).sub(fm.pos).normalize().dot(nose) > 0.766) {
      out.copy(world.aimPoint);
    } else {
      out.copy(fm.pos).addScaledVector(nose, this.isPlayer ? 1200 : 900);
    }
    const tt = out.distanceTo(fm.pos) / Math.max(1, speed);
    out.y += 0.5 * G0 * tt * tt;
    return out;
  }

  setGunFiring(on) { this.isFiringGun = !!on; }

  fireMissile(world, type, target) {
    const w = this.weapons[type];
    if (!w || w.count <= 0) return false;
    if (this.flareTimer > 0 && type !== 'bomb') { /* still allow */ }
    w.count--;
    _v.set(this.rng.float(-1, 1) > 0 ? 1 : -1, -0.6, 0).applyQuaternion(this.fm.quat).multiplyScalar(this.def.span * 0.42).add(this.fm.pos);
    _v2.copy(this.fm.vel).multiplyScalar(0.6);
    const dir = _v3.set(0, 0, 1).applyQuaternion(this.fm.quat);
    const pr = world.projectiles.spawnMissile(this, type === 'aim120' ? 'aim120' : (w.kind === 'radar' ? 'patriot' : (this.faction === 'red' ? 'archer' : 'aim9')), _v, dir, target, this.faction);
    if (world.audio) world.audio.missileLaunch(0.8);
    if (world.particles) world.particles.smokeTrail(_v, 1.2, 0.7, 1.2, _v2);
    if (world.game) world.game.onWeaponFired(this, type);
    return pr;
  }

  fireRocket(world) {
    const w = this.weapons.rocket;
    if (!w || w.count <= 0) return false;
    w.count--;
    const side = w.count % 2 === 0 ? 1 : -1;
    _v.set(side * this.def.span * 0.25, -0.7, 0).applyQuaternion(this.fm.quat).add(this.fm.pos);
    _v3.set(0, 0, 1).applyQuaternion(this.fm.quat);
    // unguided rockets are fired on a computed sight, not down the bore
    const aim = this.gunAimPoint(world, _v4, 520);
    if (aim) {
      _v5.copy(aim).sub(_v).normalize();
      if (_v5.dot(_v3) > 0.9) _v3.copy(_v5);
    }
    world.projectiles.spawnRocket(this, _v, _v3, this.faction);
    if (world.audio) world.audio.rocketeer(0.5);
    return true;
  }

  dropBomb(world) {
    const w = this.weapons.bomb;
    if (!w || w.count <= 0) return false;
    w.count--;
    _v.set(0, -1.4, 0).applyQuaternion(this.fm.quat).add(this.fm.pos);
    world.projectiles.spawnBomb(this, _v, this.fm.vel, this.faction);
    if (world.audio) world.audio.hydraulics(0.4, false);
    return true;
  }

  dropFlares(world, count = 2) {
    if (this.flares <= 0) return false;
    this.flares -= count;
    for (let i = 0; i < count; i++) {
      _v.copy(this.fm.pos).add(_v2.set((i % 2 ? 1 : -1) * 2.2, -0.6, -1.0).applyQuaternion(this.fm.quat));
      _v2.copy(this.fm.vel).multiplyScalar(0.75);
      _v2.y -= 6 + i * 2;
      world.projectiles.spawnFlare(this, _v, _v2, this.faction);
      world.particles.flare(_v, _v2);
    }
    if (world.audio) world.audio.beep(700, 0.06, 0.15, 'sine', 'cockpit');
    return true;
  }

  dropChaff(world, count = 3) {
    if (this.chaff <= 0) return false;
    this.chaff -= count;
    for (let i = 0; i < count; i++) {
      _v.copy(this.fm.pos).add(_v2.set(this.rng.float(-2, 2), -0.8, -2).applyQuaternion(this.fm.quat));
      _v2.copy(this.fm.vel).multiplyScalar(0.8);
      world.projectiles.spawnChaff(this, _v, _v2, this.faction);
      world.particles.chaffCloud(_v, _v2);
    }
    return true;
  }

  /**
   * Incoming missile warning: returns the closest guided missile targeting us.
   */
  incomingMissile(world) {
    let best = null, bestD = Infinity;
    for (const p of world.projectiles.list) {
      if (p.type !== 'missile') continue;
      if (p.faction === this.faction) continue;
      if (p.target !== this) continue;
      const d = p.pos.distanceTo(this.fm.pos);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { missile: best, distance: bestD } : null;
  }

  // -----------------------------------------------------------------------
  applyDamage(amount, point, source, world) {
    if (!this.fm.alive) return;
    this.health -= amount;
    const hpFrac = clamp01(this.health / this.maxHealth);
    // pick a system to hurt
    const roll = this.rng.float(0, 1);
    const local = _v.copy(point || this.fm.pos).sub(this.fm.pos).applyQuaternion(_q.copy(this.fm.quat).invert());
    if (Math.abs(local.x) > 0.35 && Math.abs(local.z) < this.def.length * 0.25 && roll < 0.35) {
      // wing hit
      this.controlHealth.roll = Math.max(0, this.controlHealth.roll - amount / 160);
    } else if (local.z < -this.def.length * 0.18 && roll < 0.6) {
      const eng = this.engineHealth[0] > this.engineHealth[1] ? 0 : 1;
      this.engineHealth[eng] = Math.max(0, this.engineHealth[eng] - amount / 130);
      this.fm.engineDamage[eng] = 1 - this.engineHealth[eng];
      if (this.engineHealth[eng] < 0.4) this.fuelLeak = Math.max(this.fuelLeak, 0.4);
    } else if (local.z > this.def.length * 0.15 && roll < 0.3) {
      this.controlHealth.pitch = Math.max(0.1, this.controlHealth.pitch - amount / 200);
    } else if (roll > 0.75) {
      this.radarHealth = Math.max(0, this.radarHealth - amount / 180);
    }
    if (roll > 0.5) this.fuelLeak = Math.max(this.fuelLeak, 0.25);
    if (this.isPlayer && world && world.game) world.game.onPlayerHit(this, amount, hpFrac);
    if (this.health <= 0) {
      this.health = 0;
      this._destroy(world, source);
    }
  }

  _destroy(world, source) {
    this.dead = true;
    this.deathTimer = 0;
    this.fm.alive = false;
    this.fm.crashed = true;
    this.fm.crashCause = 'shot down';
    this.smokeLevel = 1;
    this.fireTimer = 2;
    if (world) {
      world.particles.explosion(this.fm.pos, 1.8, { shockwave: true });
      world.audio.explosion(this.fm.pos, 2.0, world.listenerPos);
      if (world.game) world.game.onAircraftDestroyed(this, source);
    }
  }

  _onCrash(world) {
    if (this.dead) return;
    this.crashedOnGround = true;
    this.dead = true;
    this.deathTimer = 0;
    if (world) {
      world.particles.explosion(this.fm.pos, 3.0, { shockwave: true, dust: true });
      world.audio.explosion(this.fm.pos, 3.0, world.listenerPos);
      if (world.game) world.game.onAircraftDestroyed(this, null);
    }
  }

  cleanupFx() { this.smokeLevel = 0; }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { if (m && m.dispose) m.dispose(); }
      }
    });
  }
}
