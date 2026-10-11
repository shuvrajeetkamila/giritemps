// Semi-realistic 6DOF point-mass flight model.
// Forces: lift from angle of attack, induced + parasite drag, thrust, gravity, side force.
// Rotation: body rates with first-order lag (inertia), control authority drops with
// airspeed and during stall. Coordinate frame: three.js (Y up), aircraft nose = local -Z.
import * as THREE from 'three';
import { GRAVITY, stallSpeed } from './aircraft-data.js';

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _vb = new THREE.Vector3(), _acc = new THREE.Vector3(), _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion(), _qInv = new THREE.Quaternion(), _tmp = new THREE.Vector3();
const _gravity = new THREE.Vector3(0, -GRAVITY, 0);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class FlightModel {
  constructor(spec, pos = new THREE.Vector3(), heading = 0) {
    this.spec = spec;
    this.pos = pos.clone();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, heading, 0));
    this.P = 0; this.Q = 0; this.R = 0;       // body rates: roll-right, pitch-up, yaw-right (rad/s)
    this.throttle = 0.5;
    this.afterburner = false;
    this.gear = 1;          // 1 = down
    this.flaps = 0;         // 0..1
    this.brake = 0;         // speed brake 0..1
    this.alpha = 0; this.beta = 0; this.airspeed = 0; this.mach = 0;
    this.stall = 0;         // 0..1 stall severity
    this.load = 1;          // smoothed load factor (g)
    this.loadRaw = 1;
    this.onGround = false;
    this.crashed = false;
    this.landed = false;
    this.impactSpeed = 0;
    this.turbulence = 0;    // m/s^2 random jolts
    this.stallV = stallSpeed(spec);
    this.fuel = spec.fuel;  // percent
    this.distance = 0;
    this.throttleCmd = this.throttle;
    // Damage multipliers set by the game: wing damage cuts lift, engine damage cuts thrust.
    this.liftMul = 1; this.thrustMul = 1; this.controlMul = 1;
  }

  forward(out = _f) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = _u) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out = _r) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  // Heading [0,360) with 0 = north (-Z), 90 = east (+X).
  heading() {
    const f = this.forward();
    let h = Math.atan2(f.x, -f.z) * 180 / Math.PI;
    return (h + 360) % 360;
  }
  pitchDeg() { const f = this.forward(); return Math.asin(clamp(f.y, -1, 1)) * 180 / Math.PI; }
  rollDeg() {
    const r = this.right();
    return Math.asin(clamp(r.y, -1, 1)) * 180 / Math.PI;
  }
  altitude(groundH = 0) { return this.pos.y - groundH; }

  // inp: { pitch, roll, yaw } in [-1,1]; env: { groundHeight(x,z), waterLevel, wind }
  step(dt, inp, env) {
    const s = this.spec;
    const m = s.mass;
    this.quat.normalize();
    const f = this.forward(), u = this.up(), r = this.right();

    // Air-relative velocity (wind shifts the air mass).
    const air = _tmp.copy(this.vel);
    if (env && env.wind) air.sub(env.wind);
    const V = air.length();
    this.airspeed = V;
    this.mach = V / (340 - 0.0035 * Math.max(0, this.pos.y));

    _qInv.copy(this.quat).invert();
    _vb.copy(air).applyQuaternion(_qInv);
    const vbx = _vb.x, vby = _vb.y, vbz = _vb.z;
    const alpha = Math.atan2(-vby, -vbz);
    const beta = V > 0.5 ? Math.asin(clamp(vbx / V, -1, 1)) : 0;
    this.alpha = alpha; this.beta = beta;

    const alt = Math.max(0, this.pos.y);
    const rho = 1.225 * Math.exp(-alt / 8500);
    const q = 0.5 * rho * V * V;
    const S = s.wingArea;

    // Stall: beyond critical alpha or below stall speed, lift collapses and oscillates.
    const aAbs = Math.abs(alpha);
    const alphaFactor = clamp((aAbs - s.alphaStall * 0.92) / (s.alphaStall * 0.25), 0, 1);
    const speedFactor = clamp((1.08 * this.stallV * Math.sqrt(1.225 / Math.max(rho, 0.05)) - V) / (0.25 * this.stallV), 0, 1);
    const stallTarget = Math.max(alphaFactor, speedFactor * 0.85);
    this.stall += (stallTarget - this.stall) * Math.min(1, dt * 3);

    let CL;
    if (aAbs <= s.alphaStall) CL = s.clAlpha * alpha;
    else {
      const over = aAbs - s.alphaStall;
      const magnitude = Math.max(0.35 * s.clMax, s.clMax * (1 - over * 2.2));
      CL = Math.sign(alpha) * magnitude;
    }
    // Flaps add lift; gear and brakes add drag.
    CL += this.flaps * 0.45;
    const M = this.mach;
    const waveDrag = s.maxSpeed > 0 ? clamp((M - 0.9) * 0.6, 0, 0.12) : 0;
    const CD = s.cd0 + s.k * CL * CL + this.gear * 0.012 + this.flaps * 0.04 + this.brake * 0.06 + waveDrag;

    const L = q * S * CL * this.liftMul;
    const D = q * S * CD;
    const Y = -q * S * 0.9 * beta;  // weathercock side force

    // Thrust.
    const sigma = rho / 1.225;
    let T;
    if (s.propPower > 0) {
      const eff = 0.82 * Math.pow(sigma, 0.7);
      T = Math.min(this.throttle * s.propPower * eff / Math.max(V, 35), this.throttle * s.dryThrust);
    } else {
      const ab = this.afterburner && this.throttle > 0.9 && this.fuel > 0 ? (s.abThrust - s.dryThrust) : 0;
      T = (this.throttle * s.dryThrust + ab * this.throttleABFrac()) * Math.pow(sigma, 0.7);
    }
    T *= this.thrustMul;
    if (this.fuel <= 0) T *= 0.05;
    const fuelBurn = (s.propPower > 0 ? 0.6 : 0.9) * this.throttle * (this.afterburner && this.throttle > 0.9 ? 2.6 : 1) * dt * 0.0035 * (s.mass / 12000) ** 0.5;
    this.fuel = Math.max(0, this.fuel - fuelBurn * 100 / 10);

    // Acceleration in world space (non-gravity specific force).
    _acc.set(0, 0, 0);
    _acc.addScaledVector(f, T);
    _acc.addScaledVector(u, L);
    if (V > 0.1) _acc.addScaledVector(air, -D / V);
    _acc.addScaledVector(r, Y);
    if (env && env.turbulence) {
      _acc.x += (Math.random() - 0.5) * env.turbulence * m;
      _acc.y += (Math.random() - 0.5) * env.turbulence * m;
      _acc.z += (Math.random() - 0.5) * env.turbulence * m;
    }
    _acc.multiplyScalar(1 / m);
    // Load factor = specific force (accel minus gravity) projected on body up, in g.
    this.loadRaw = _acc.dot(u) / GRAVITY;
    this.load += (this.loadRaw - this.load) * Math.min(1, dt * 12);

    this.vel.addScaledVector(_acc, dt);
    this.vel.addScaledVector(_gravity, dt);

    // Body-rate control response.
    const authority = clamp(V / (1.25 * this.stallV), 0.12, 1) * (1 - 0.6 * this.stall) * this.controlMul;
    const pDes = inp.roll * s.rollRate * authority;
    let qDes = inp.pitch * s.pitchRate * authority;
    let rDes = inp.yaw * s.yawRate * authority - beta * 0.4;
    // Stall: nose drops, sluggish response and buffet.
    if (!this.onGround) qDes -= this.stall * 0.55;
    if (this.stall > 0.25) {
      const buffet = this.stall * 0.05;
      this.P += (Math.random() - 0.5) * buffet;
      this.Q += (Math.random() - 0.5) * buffet;
    }
    const tau = s.rateLag;
    const k = 1 - Math.exp(-dt / tau);
    this.P += (pDes - this.P) * k;
    this.Q += (qDes - this.Q) * k;
    this.R += (rDes - this.R) * k;

    // Integrate orientation: body-frame rotation vector (pitch about X, yaw about Y, roll about Z).
    _axis.set(this.Q, -this.R, -this.P);
    const w = _axis.length();
    if (w > 1e-9) {
      _axis.multiplyScalar(1 / w);
      _dq.setFromAxisAngle(_axis, w * dt);
      this.quat.multiply(_dq).normalize();
    }

    // Position.
    this.pos.addScaledVector(this.vel, dt);
    this.distance += this.vel.length() * dt;

    // Ground / water interaction. Touch height ~ gear/belly clearance.
    const gh = env && env.groundHeight ? env.groundHeight(this.pos.x, this.pos.z) : 0;
    const water = env && env.waterLevel !== undefined ? env.waterLevel : -Infinity;
    const surface = Math.max(gh, water);
    const clearance = this.pos.y - surface;
    const wasOnGround = this.onGround;
    this.onGround = false;
    const TOUCH = 1.0;
    if (clearance < TOUCH) {
      const sink = -this.vel.y;
      const pitch = this.pitchDeg(), roll = this.rollDeg();
      const horiz = Math.hypot(this.vel.x, this.vel.z);
      const gearDown = this.gear > 0.5;
      // Attitude limits apply at touchdown; while rolling, wheels constrain the attitude.
      const attitudeOK = wasOnGround
        ? pitch > -10 && pitch < 16 && Math.abs(roll) < 15
        : pitch > -6 && pitch < 14 && Math.abs(roll) < 12;
      const gentle = gearDown && attitudeOK && sink < 3.5 && horiz < 110;
      const bellySkid = !gearDown && sink < 1.5 && this.airspeed < 60 && attitudeOK;
      if (clearance < -1.5 || (!gentle && !bellySkid)) {
        this.impactSpeed = Math.max(this.airspeed, sink);
        this.crashed = true;
        this.pos.y = surface + 0.5;
        return;
      }
      this.onGround = true;
      this.pos.y = surface + TOUCH;
      if (this.vel.y < 0) this.vel.y = 0;
      if (this.airspeed < 75 && gearDown) this.landed = true;
      const braking = this.brake > 0.5 ? 2.8 : 0.9;
      const fr = Math.exp(-dt * braking);
      this.vel.x *= fr; this.vel.z *= fr;
      // Wheels hold the attitude: rates are damped hard while in contact.
      const damp = Math.exp(-dt * 6);
      this.P *= damp; this.Q *= damp; this.R *= damp;
    } else if (this.pos.y > surface + 30) {
      this.landed = false;
    }
    this.throttle = clamp(this.throttle, 0, 1);
  }

  throttleABFrac() { return 1; }

  // Simple ballistic step for projectiles that share the flight model's gravity.
  static ballisticDrop(pos, vel, dt) {
    vel.addScaledVector(_gravity, dt);
    pos.addScaledVector(vel, dt);
  }
}

// Convenience: determine if the aircraft is inside a stall warning region.
export function stallWarning(fm) {
  return (!fm.onGround && fm.airspeed < 1.18 * fm.stallV) || fm.stall > 0.5;
}
