// ---------------------------------------------------------------------------
// FlightModel — semi-realistic aerodynamics: lift / drag / thrust / side force
// with stall, G-limits, energy bleed, inertia and ground contact.
//
// Body frame: +Z nose, +Y up, +X PORT wing (screen-left when chased).
// With nose +Z and up +Y the starboard wing is -X (right-handed frame), so:
//   nose up   => angular.x < 0
//   nose right=> angular.y < 0
//   bank right=> angular.z > 0
// Positive inputs: pitch = nose up, roll = roll right, yaw = nose right.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { G0, clamp, clamp01, lerp, damp, airDensity, speedOfSound } from '../core/Utils.js';

const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _b3 = new THREE.Vector3();
const _b4 = new THREE.Vector3(), _b5 = new THREE.Vector3(), _b6 = new THREE.Vector3();
const _b7 = new THREE.Vector3(), _b8 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const ZERO = new THREE.Vector3(0, 0, 0);

export class FlightModel {
  constructor(spec) {
    this.spec = spec;
    this.reset();
  }

  reset(opts = {}) {
    const s = this.spec;
    this.pos = new THREE.Vector3(opts.x || 0, opts.y || 1500, opts.z || 0);
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.pitch || 0, opts.yaw || 0, opts.roll || 0, 'YXZ'));
    const speed = opts.speed !== undefined ? opts.speed : 240;
    this.vel = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat).multiplyScalar(speed);
    this.throttle = opts.throttle !== undefined ? opts.throttle : 0.75;
    this.afterburner = false;
    this.aoa = 0; this.beta = 0; this.speed = speed; this.mach = 0;
    this.gLoad = 1; this.gLong = 0; this.gStress = 0;
    this.stalled = false; this.stallSeverity = 0;
    this.angular = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.onGround = false;
    this.gearDown = opts.gearDown !== false;
    this.flaps = 0; this.airbrake = 0;
    this.fuel = s.fuel; this.fuelPercent = 1;
    this.alive = true; this.crashed = false; this.crashCause = '';
    this.gLoc = 0; this.blackout = 0; this.redout = 0;
    this.brake = 0;
    this.rpm = 0; this.thrustN = 0;
    this.engineDamage = [0, 0];
    this.controlDamage = { pitch: 0, roll: 0, yaw: 0 };
    this.turbulencePhase = Math.random() * 100;
    this.angularPerturb = 0;
    this.contrail = 0;
    this.sonicBoom = false;
    this.lastGroundImpact = 0;
    this.gLimitExceeded = 0;
    return this;
  }

  update(dt, input, world) {
    if (!this.alive) {
      this.vel.y -= G0 * dt;
      this.pos.addScaledVector(this.vel, dt);
      // tumble
      this.angular.x = lerp(this.angular.x, 1.2, dt);
      this.angular.y = lerp(this.angular.y, 0.4, dt);
      this._integrateQuat(dt);
      if (world && world.groundHeight) {
        const gh = Math.max(0, world.groundHeight(this.pos.x, this.pos.z));
        if (this.pos.y < gh + 1) { this.pos.y = gh + 1; this.vel.multiplyScalar(-0.12); this.touchdownDone = true; }
      }
      return;
    }
    const steps = dt > 0.034 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h, input || { pitch: 0, roll: 0, yaw: 0 }, world);
  }

  _step(dt, input, world) {
    const s = this.spec;
    const alt = this.pos.y;
    const rho = airDensity(Math.max(0, alt));
    const a = speedOfSound(Math.max(0, alt));

    // ---- airflow in the body frame
    _q.copy(this.quat).invert();
    const vBody = _b1.copy(this.vel).applyQuaternion(_q);
    const speed = this.vel.length();
    this.speed = speed;
    this.mach = speed / Math.max(1, a);
    const vSafe = Math.max(0.5, speed);
    this.aoa = Math.atan2(-vBody.y, Math.max(0.5, vBody.z));
    this.beta = Math.asin(clamp(vBody.x / vSafe, -1, 1));

    const qDyn = 0.5 * rho * speed * speed;
    const S = s.wingArea;

    // ---- lift coefficient with stall break
    const AR = (s.span * s.span) / Math.max(1, S);
    const clAlpha = (2 * Math.PI * AR) / (AR + 2.4);
    const alpha = this.aoa;
    const alphaStall = s.stallAoa;
    let CL = clAlpha * alpha + this.flaps * 0.45 + 0.08;
    let stalled = false, stallSeverity = 0;
    const over = Math.abs(alpha) - alphaStall;
    if (over > 0) {
      stalled = true;
      stallSeverity = clamp01(over / 0.30);
      const capped = Math.sign(CL || 1) * Math.min(Math.abs(CL), s.clMax);
      CL = capped * (1 - 0.55 * stallSeverity);
    } else {
      CL = clamp(CL, -s.clMax * 1.05, s.clMax);
    }
    this.stalled = stalled;
    this.stallSeverity = stallSeverity;

    // ---- drag
    let cd0 = s.cd0;
    if (this.gearDown) cd0 += 0.019;
    cd0 += this.flaps * 0.030;
    cd0 += this.airbrake * 0.072;
    cd0 += this.engineDamage[0] * 0.006 + this.engineDamage[1] * 0.006;
    cd0 += this.stallSeverity * 0.055;
    if (this.mach > 0.86) cd0 += 0.010 * Math.pow((this.mach - 0.86) / 0.5, 2) * 6;
    const CD = cd0 + (CL * CL) * s.inducedK * (1 + this.flaps * 0.5);
    // fuselage side force: pushes the velocity vector toward the nose (this is
    // what makes rudder input actually turn the aircraft and damps sideslip)
    const CY = clamp(1.8 * this.beta, -1.2, 1.2);

    // ---- direction vectors
    const fwd = _b2.set(0, 0, 1).applyQuaternion(this.quat);
    const up = _b3.set(0, 1, 0).applyQuaternion(this.quat);
    const vhat = _b4.copy(this.vel).multiplyScalar(1 / vSafe);
    const liftDir = _b5.copy(up).addScaledVector(vhat, -up.dot(vhat));
    const ll = liftDir.length();
    if (ll < 1e-4) liftDir.copy(up); else liftDir.multiplyScalar(1 / ll);
    const sideDir = _b6.copy(vhat).cross(liftDir).normalize();   // points to the left
    if (speed < 2) { liftDir.copy(up); sideDir.copy(_b7.set(1, 0, 0).applyQuaternion(this.quat)); }

    // ---- forces (N)
    const L = qDyn * S * CL;
    const D = qDyn * S * CD;
    const Y = qDyn * S * CY;
    const thrustMax = s.thrust * (1 + (this.afterburner ? s.afterburnerBoost - 1 : 0)) * this._engineFactor(alt);
    const fuelOk = this.fuel > 0.1 ? 1 : 0;
    const thrust = thrustMax * clamp01(this.throttle) * fuelOk;
    this.thrustN = thrust;

    const mass = s.mass;
    const fx = fwd.x * thrust + liftDir.x * L - vhat.x * D + sideDir.x * Y;
    const fy = fwd.y * thrust + liftDir.y * L - vhat.y * D + sideDir.y * Y - G0 * mass;
    const fz = fwd.z * thrust + liftDir.z * L - vhat.z * D + sideDir.z * Y;
    this.accel.set(fx / mass, fy / mass, fz / mass);

    // ---- turbulence (storm cells)
    this.angularPerturb = 0;
    if (world && world.turbulence > 0.01) {
      this.turbulencePhase += dt * 3.0;
      const t = world.turbulence * clamp(speed / 120, 0.2, 1.5);
      const ph = this.turbulencePhase;
      this.accel.x += (Math.sin(ph * 1.7) * 0.6 + Math.sin(ph * 3.1 + 1.2) * 0.4) * t * 8.0;
      this.accel.y += (Math.sin(ph * 2.3 + 0.7) * 0.6 + Math.sin(ph * 4.3 + 2.1) * 0.4) * t * 12.0;
      this.accel.z += Math.sin(ph * 1.3 + 3.3) * t * 6.0;
      this.angularPerturb = t;
    }

    // ---- integrate (semi-implicit Euler)
    this.vel.addScaledVector(this.accel, dt);
    this.pos.addScaledVector(this.vel, dt);
    this._integrateRotation(dt, input, world);

    // ---- G load
    const aUp = this.accel.dot(up);
    const nz = 1 + aUp / G0;
    this.gLoad = lerp(this.gLoad, nz, 1 - Math.exp(-dt * 7));
    this.gLong = lerp(this.gLong, this.accel.dot(fwd) / G0, 1 - Math.exp(-dt * 7));

    // ---- pilot G effects
    if (this.gLoad > 4.6) this.gLoc = clamp01(this.gLoc + dt * (this.gLoad - 4.6) * 0.30);
    else this.gLoc = clamp01(this.gLoc - dt * 0.45);
    if (this.gLoad < -1.4) this.redout = clamp01(this.redout + dt * (-this.gLoad - 1.3) * 0.55);
    else this.redout = clamp01(this.redout - dt * 0.55);
    this.blackout = this.gLoc;
    this.gStress = clamp01((Math.abs(this.gLoad) - 7.5) / 3.0);
    this.gLimitExceeded = Math.abs(this.gLoad) > s.gLimit ? this.gLimitExceeded + dt : Math.max(0, this.gLimitExceeded - dt * 0.5);

    // ---- fuel
    const burn = s.fuelBurn * (this.throttle * (this.afterburner ? 4.6 : 1.0)) * 0.055;
    this.fuel = Math.max(0, this.fuel - burn * dt * (1 - 0.3 * this.engineDamage[0]));
    this.fuelPercent = this.fuel / s.fuel;

    // ---- engine visuals / sound driver
    const targetRpm = s.prop ? (0.2 + this.throttle * 0.8) : (0.32 + this.throttle * 0.68 + (this.afterburner ? 0.08 : 0));
    this.rpm = lerp(this.rpm, targetRpm * (1 - 0.5 * this.engineDamage[0]), 1 - Math.exp(-dt * 2.2));

    if (world && world.groundHeight) this._groundContact(dt, world);
  }

  _engineFactor(alt) {
    const d = airDensity(Math.max(0, alt)) / 1.225;
    return clamp(Math.pow(d, 0.72), 0.10, 1.2);
  }

  _integrateRotation(dt, input, world) {
    const s = this.spec;
    const rho = airDensity(Math.max(0, this.pos.y));
    const qDyn = 0.5 * rho * this.speed * this.speed;
    const qRef = 0.5 * 1.225 * Math.pow(220, 2);
    let authority = clamp(Math.sqrt(Math.max(qDyn, 1) / (qRef * 0.30)), 0.14, 1.12);
    if (this.stalled) authority *= lerp(1, 0.4, this.stallSeverity);
    if (this.gLoc > 0.7) authority *= lerp(1, 0.3, clamp01((this.gLoc - 0.7) / 0.3));
    if (this.onGround && this.speed < 25) authority *= 0.25;

    const iRoll = clamp(input.roll || 0, -1, 1);
    const iPitch = clamp(input.pitch || 0, -1, 1);
    const iYaw = clamp(input.yaw || 0, -1, 1);

    let rateRoll = iRoll * s.rollRate * authority * (1 - this.controlDamage.roll * 0.7);
    let ratePitch = iPitch * s.pitchRate * authority * (1 - this.controlDamage.pitch * 0.75);
    let rateYaw = iYaw * s.yawRate * authority * (1 - this.controlDamage.yaw * 0.75);

    // ---- stability / auto-trim: with the stick neutral the airframe holds
    // 1G level flight at the current speed (like a trimmed fighter).
    if (Math.abs(iPitch) < 0.05) {
      const AR = (s.span * s.span) / Math.max(1, s.wingArea);
      const clA = (2 * Math.PI * AR) / (AR + 2.4);
      const q = 0.5 * airDensity(Math.max(0, this.pos.y)) * Math.max(4, this.speed * this.speed);
      const clNeed = (s.mass * G0) / Math.max(1, q * s.wingArea);
      const trimAoa = clamp(clNeed / clA, -0.30, 0.40);
      ratePitch += clamp((trimAoa - this.aoa) * 1.35, -0.75, 0.75) * clamp01(authority) * 0.85;
    }
    if (this.stalled) {
      ratePitch -= this.stallSeverity * 0.85;                      // nose drops
      this.angular.z += (Math.random() - 0.5) * this.stallSeverity * 0.25;  // buffet
    }
    if (Math.abs(iPitch) < 0.05) {
      const gamma = Math.asin(clamp(this.vel.y / Math.max(1, this.speed), -1, 1));
      const bank = Math.abs(this.bodyRoll());
      if (bank < 0.7 && Math.abs(gamma) < 0.45) {
        ratePitch += clamp(-gamma * 0.75, -0.35, 0.35) * clamp01(authority) * 0.45;
      }
    }
    rateYaw -= clamp(this.beta * 1.5, -0.7, 0.7);                  // weathercock into the slip
    rateYaw -= iRoll * 0.10;                                        // adverse yaw
    rateRoll += clamp(this.beta * 0.32, -0.35, 0.35);               // dihedral roll

    // ---- G-limit: stop pulling beyond the structural limit
    const overG = Math.abs(this.gLoad) > s.gLimit;
    if (overG && Math.sign(ratePitch) === Math.sign(this.gLoad) && Math.abs(this.gLoad) > 1) {
      ratePitch *= 0.15;
    }

    // ---- convert to body rates (ωx = -pitch up, ωy = yaw right, ωz = -roll right)
    const smooth = this.speed > 60 ? 6.0 : 3.8;
    this.angular.x = damp(this.angular.x, -ratePitch, smooth, dt);
    this.angular.y = damp(this.angular.y, -rateYaw, smooth * 0.85, dt);
    this.angular.z = damp(this.angular.z, rateRoll, smooth, dt);

    if (this.angularPerturb) {
      const t = this.angularPerturb;
      this.angular.x += (Math.random() - 0.5) * t * 1.4;
      this.angular.y += (Math.random() - 0.5) * t * 0.9;
      this.angular.z += (Math.random() - 0.5) * t * 1.4;
    }
    this._integrateQuat(dt);
  }

  _integrateQuat(dt) {
    // dq = 0.5 * q ⊗ (ωx, ωy, ωz, 0) * dt   (omega expressed in the body frame)
    _q.set(this.angular.x * 0.5 * dt, this.angular.y * 0.5 * dt, this.angular.z * 0.5 * dt, 0);
    _q.premultiply(this.quat);
    this.quat.set(
      this.quat.x + _q.x, this.quat.y + _q.y, this.quat.z + _q.z, this.quat.w + _q.w
    ).normalize();
  }

  _groundContact(dt, world) {
    const gh = world.groundHeight(this.pos.x, this.pos.z);
    const clearance = this.spec.groundClearance * (this.gearDown ? 1.0 : 0.5);
    const groundY = Math.max(gh, 0.2) + clearance;
    if (this.pos.y > groundY) { this.onGround = false; return; }

    const sinkRate = -this.vel.y;
    const roll = Math.abs(this.bodyRoll());
    const pitch = this.bodyPitch();
    const onWater = gh < 0.05;

    if (onWater) {
      this.alive = false; this.crashed = true; this.crashCause = 'water';
      this.vel.multiplyScalar(0.15); this.vel.y = 0; this.pos.y = 0.4;
      return;
    }
    const hard = sinkRate > 6.0 || roll > 0.45 || Math.abs(pitch) > 0.6;
    const veryHard = sinkRate > 13 || roll > 0.8;
    if (veryHard || (!this.gearDown && this.speed > 35)) {
      this.alive = false; this.crashed = true;
      this.crashCause = veryHard ? 'impact' : 'belly';
      this.pos.y = groundY;
      this.vel.multiplyScalar(0.1);
      return;
    }
    this.pos.y = groundY;
    this.lastGroundImpact = sinkRate;
    if (this.vel.y < 0) this.vel.y = hard ? 0 : -this.vel.y * 0.1;
    if (hard) this.onGround = true;

    // ---- rolling friction / brakes
    const speed = this.vel.length();
    const decel = (0.022 + this.brake * 0.22) * G0;
    if (speed > 0.2) {
      const ns = Math.max(0, speed - decel * dt);
      this.vel.multiplyScalar(ns / speed);
    } else {
      this.vel.multiplyScalar(0.85);
    }
    this.onGround = true;
    this.gLoad = lerp(this.gLoad, 1, 1 - Math.exp(-dt * 8));
    if (roll > 0.32 && speed > 30) {
      this.alive = false; this.crashed = true; this.crashCause = 'wingtip';
    }
    // settle onto the ground plane
    _e.setFromQuaternion(this.quat, 'YXZ');
    _e.z = lerp(_e.z, 0, 1 - Math.exp(-dt * 7));
    this.quat.setFromEuler(_e);
  }

  bodyPitch() {
    const f = _b7.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.asin(clamp(f.y, -1, 1));
  }
  /** Bank angle in radians; positive = banked right (starboard wing down). */
  bodyRoll() {
    const port = _b7.set(1, 0, 0).applyQuaternion(this.quat);
    const up = _b8.set(0, 1, 0).applyQuaternion(this.quat);
    return Math.atan2(port.y, up.y);
  }

  getForward(t) { return t.set(0, 0, 1).applyQuaternion(this.quat); }
  getUp(t) { return t.set(0, 1, 0).applyQuaternion(this.quat); }
  getRight(t) { return t.set(1, 0, 0).applyQuaternion(this.quat); }

  heading() {
    const f = _b7.set(0, 0, 1).applyQuaternion(this.quat);
    let h = Math.atan2(f.x, -f.z) * 180 / Math.PI;
    return (h + 360) % 360;
  }

  /** Predicted position after t seconds (for the target lead indicator). */
  predict(t, out) {
    out.copy(this.pos).addScaledVector(this.vel, t).addScaledVector(this.accel, t * t * 0.5);
    return out;
  }
}

export function gVision(fm) {
  const g = fm.gLoad;
  const positive = clamp01((g - 3.0) / 6.5);
  const negative = clamp01((-g - 0.6) / 3.0);
  return {
    tunnel: clamp01(positive * 1.05 + fm.blackout * 0.95),
    red: clamp01(negative + fm.redout * 0.95),
    blackout: fm.blackout,
    chromatic: clamp01((Math.abs(g) - 2.5) / 7)
  };
}
