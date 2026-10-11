import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/physics/flight.js';
import { AIRCRAFT, stallSpeed } from '../src/physics/aircraft-data.js';

const flat = { groundHeight: () => 0, waterLevel: -1000 };

function run(fm, seconds, inp, env = flat, dt = 1 / 120) {
  for (let t = 0; t < seconds; t += dt) fm.step(dt, inp, env);
}

test('stall speed is in a plausible range for an F-16-class jet', () => {
  const v = stallSpeed(AIRCRAFT.f16);
  assert.ok(v > 55 && v < 90, `stall ${v}`);
});

test('a jet at cruise speed and altitude holds level with trim throttle', () => {
  const spec = AIRCRAFT.f16;
  const fm = new FlightModel(spec, new THREE.Vector3(0, 3000, 0));
  fm.vel.set(0, 0, -220);
  fm.throttle = 0.6;
  // Pitch input to hold alpha, keep thrust constant. Measure altitude drift over 10 s.
  let h0 = fm.pos.y;
  run(fm, 3, { pitch: 0, roll: 0, yaw: 0 });
  const drop = h0 - fm.pos.y;
  assert.ok(Math.abs(drop) < 1500, `altitude drift ${drop}`);
  assert.equal(fm.crashed, false);
});

test('pulling back produces positive G and climb', () => {
  const fm = new FlightModel(AIRCRAFT.f16, new THREE.Vector3(0, 2000, 0));
  fm.vel.set(0, 0, -200);
  fm.throttle = 1;
  run(fm, 1.5, { pitch: 1, roll: 0, yaw: 0 });
  assert.ok(fm.load > 2, `load ${fm.load}`);
  assert.ok(fm.pitchDeg() > 5, `pitch ${fm.pitchDeg()}`);
});

test('high alpha at low speed triggers stall and nose drop', () => {
  const fm = new FlightModel(AIRCRAFT.gripen, new THREE.Vector3(0, 2000, 0));
  fm.vel.set(0, 0, -60);
  fm.throttle = 0.2;
  run(fm, 2.0, { pitch: 1, roll: 0, yaw: 0 });
  assert.ok(fm.stall > 0.3, `stall ${fm.stall}`);
});

test('controls respond with inertia (roll rate lags stick input)', () => {
  const fm = new FlightModel(AIRCRAFT.f16, new THREE.Vector3(0, 2000, 0));
  fm.vel.set(0, 0, -250);
  fm.step(1 / 120, { pitch: 0, roll: 1, yaw: 0 }, flat);
  const firstRate = Math.abs(fm.P);
  run(fm, 1, { pitch: 0, roll: 1, yaw: 0 });
  assert.ok(firstRate < Math.abs(fm.P) * 0.5, 'roll rate should build up over time');
});

test('hitting the ground at speed crashes the aircraft', () => {
  const fm = new FlightModel(AIRCRAFT.f16, new THREE.Vector3(0, 30, 0));
  fm.vel.set(0, -60, -150);
  run(fm, 2, { pitch: 0, roll: 0, yaw: 0 });
  assert.equal(fm.crashed, true);
});

test('gentle gear-down landing on flat ground is not a crash', () => {
  const fm = new FlightModel(AIRCRAFT.f16, new THREE.Vector3(0, 6, 0));
  // Approach at ~85 m/s, nose up to ~11 deg alpha (trim for lift), gear down, power idle.
  fm.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.18));
  fm.vel.set(0, -1.2, -85);
  fm.throttle = 0.1;
  fm.brake = 1;
  fm.gear = 1;
  run(fm, 8, { pitch: 0, roll: 0, yaw: 0 });
  assert.equal(fm.crashed, false, `impact ${fm.impactSpeed} pitch ${fm.pitchDeg()} y ${fm.pos.y}`);
});
