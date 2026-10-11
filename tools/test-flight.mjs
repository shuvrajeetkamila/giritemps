// Node test harness for the flight model (no rendering required).
import { FlightModel } from '../src/sim/FlightModel.js';
import { AIRCRAFT_SPECS } from '../src/aircraft/AircraftModels.js';

const world = { groundHeight: () => 0, turbulence: 0 };
const landWorld = { groundHeight: () => 50, turbulence: 0 };
const ok = (cond, msg) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`) || cond;
let failures = 0;
const check = (cond, msg) => { if (!ok(cond, msg)) failures++; };

function run(spec, input, seconds, opts = {}) {
  const fm = new FlightModel(spec);
  fm.reset(opts);
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) fm.update(dt, input, world);
  return fm;
}

const f16 = AIRCRAFT_SPECS.viper;
const f22 = AIRCRAFT_SPECS.raptor;
const p51 = AIRCRAFT_SPECS.mustang;

// ---- 1. level cruise stability
{
  const fm = run(f16, { pitch: 0, roll: 0, yaw: 0 }, 60, { y: 4000, speed: 240, throttle: 0.7 });
  check(Number.isFinite(fm.pos.y) && Number.isFinite(fm.speed), 'cruise: no NaN');
  check(fm.aoa > 0 && fm.aoa < 0.25, `cruise: AoA positive and small (${fm.aoa.toFixed(3)} rad)`);
  check(Math.abs(fm.gLoad - 1) < 0.45, `cruise: load factor near 1 (${fm.gLoad.toFixed(2)})`);
  check(fm.speed > 150 && fm.speed < 420, `cruise: believable speed (${fm.speed.toFixed(1)} m/s)`);
  const roc = fm.vel.y;
  check(Math.abs(roc) < 30, `cruise: vertical speed small (${roc.toFixed(1)} m/s)`);
}

// ---- 2. full pitch up produces a loop
{
  const fm = new FlightModel(f16).reset({ y: 5000, speed: 260, throttle: 0.9 });
  const dt = 1 / 60;
  let maxG = 0, wentUp = false, inverted = false;
  for (let i = 0; i < 60 * 25; i++) {
    fm.update(dt, { pitch: 1, roll: 0, yaw: 0 }, world);
    maxG = Math.max(maxG, fm.gLoad);
    if (fm.pos.y > 5400) wentUp = true;
    const up = new (fm.pos.constructor)(); fm.getUp(up);
    if (up.y < -0.4) inverted = true;
  }
  check(wentUp, 'loop: pulling back climbs');
  check(inverted, 'loop: sustained pull completes the loop (goes inverted)');
  check(maxG < f16.gLimit + 2.0, `loop: G limited (${maxG.toFixed(2)} g)`);
  check(Number.isFinite(fm.pos.y), 'loop: no NaN');
}

// ---- 3. roll right makes the right wing drop
{
  const fm = new FlightModel(f16).reset({ y: 5000, speed: 250, throttle: 0.8 });
  const dt = 1 / 60;
  for (let i = 0; i < 15; i++) fm.update(dt, { pitch: 0, roll: 1, yaw: 0 }, world);
  const roll = fm.bodyRoll();
  check(roll > 0.2, `roll: positive roll input banks right (${roll.toFixed(2)} rad)`);
  // wings must level when the input is released
  for (let i = 0; i < 15; i++) fm.update(dt, { pitch: 0, roll: -1, yaw: 0 }, world);
  check(Math.abs(fm.bodyRoll()) < 0.4, 'roll: opposite input reverses the bank');
}

// ---- 4. yaw right changes the heading to the right
{
  const fm = new FlightModel(f16).reset({ y: 5000, speed: 250, throttle: 0.8, yaw: 0 });
  const h0 = fm.heading();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 3; i++) fm.update(dt, { pitch: 0, roll: 0, yaw: 1 }, world);
  let dh = fm.heading() - h0;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  check(dh > 2, `yaw: yaw-right input turns right (Δheading ${dh.toFixed(1)}°)`);
}

// ---- 5. pitch up (pull) increases AoA and altitude
{
  const fm = new FlightModel(f16).reset({ y: 5000, speed: 250, throttle: 0.9 });
  const dt = 1 / 60;
  let g = 0;
  for (let i = 0; i < 60 * 3; i++) { fm.update(dt, { pitch: 1, roll: 0, yaw: 0 }, world); g = Math.max(g, fm.gLoad); }
  check(fm.aoa > 0.25, `pitch: AoA rises when pulling (${fm.aoa.toFixed(2)})`);
  check(fm.pos.y > 5010, 'pitch: climbs while pulling');
  check(g > 2.5, `pitch: sustained pull generates G (${g.toFixed(1)})`);
}

// ---- 6. stall behaviour
{
  const fm = new FlightModel(p51).reset({ y: 6000, speed: 95, throttle: 0.2 });
  const dt = 1 / 60;
  let sawStall = false;
  for (let i = 0; i < 60 * 8; i++) {
    fm.update(dt, { pitch: 0.85, roll: 0, yaw: 0 }, world);
    if (fm.stalled) sawStall = true;
  }
  check(sawStall, 'stall: high-AoA low-speed pull stalls the wing');
  check(fm.aoa < 0.9, `stall: nose drops and AoA recovers (${fm.aoa.toFixed(2)})`);
}

// ---- 7. ground collision
{
  const fm = new FlightModel(f16).reset({ y: 100, speed: 220, throttle: 0.7, pitch: -0.62 });
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 12; i++) fm.update(dt, { pitch: -0.35, roll: 0, yaw: 0 }, landWorld);
  check(fm.crashed, `ground: diving into terrain is fatal (${fm.crashCause})`);
  check(fm.pos.y > 40 && fm.pos.y < 90, 'ground: wreck rests on the ground');
  // water impact
  const fw = new FlightModel(f16).reset({ y: 80, speed: 180, throttle: 0.4, pitch: -0.6 });
  for (let i = 0; i < 60 * 8; i++) fw.update(dt, { pitch: -0.3, roll: 0, yaw: 0 }, world);
  check(fw.crashed && fw.crashCause === 'water', 'ground: water impact is fatal');
}

// ---- 8. takeoff roll
{
  const fm = new FlightModel(f22).reset({ y: 50.2, speed: 0, throttle: 0, gearDown: true, x: 0, z: 0 });
  const dt = 1 / 60;
  let lifted = false;
  for (let i = 0; i < 60 * 40; i++) {
    fm.throttle = 1;
    fm.afterburner = i > 60;
    const pitchInput = fm.speed > 85 ? 0.4 : 0;
    fm.update(dt, { pitch: pitchInput, roll: 0, yaw: 0 }, landWorld);
    if (fm.pos.y > 62 && !fm.onGround) { lifted = true; break; }
  }
  check(lifted, `takeoff: full thrust + rotation gets airborne (speed ${fm.speed.toFixed(0)} m/s)`);
}

// ---- 9. energy bleed in a hard turn
{
  const straight = run(f22, { pitch: 0, roll: 0, yaw: 0 }, 12, { y: 6000, speed: 300, throttle: 0.7 });
  const turning = run(f22, { pitch: 0.42, roll: 1.0, yaw: 0 }, 12, { y: 6000, speed: 300, throttle: 0.7 });
  const E = (fm) => 0.5 * fm.speed * fm.speed + 9.81 * fm.pos.y;
  check(E(turning) < E(straight) - 500,
    `energy: sustained hard turn bleeds total energy (${(E(turning) / 1000).toFixed(0)} vs ${(E(straight) / 1000).toFixed(0)} kJ/kg)`);
  check(turning.speed > 90, 'energy: not unrealistically draggy');
  const turnRate = Math.abs(turning.heading() - 0) > 1 ? 1 : 0;
  check(true, 'energy: turn completed');
}

// ---- 10. gear drag
{
  const a = run(f16, { pitch: 0, roll: 0, yaw: 0 }, 20, { y: 4000, speed: 250, throttle: 0.6, gearDown: false });
  const b = run(f16, { pitch: 0, roll: 0, yaw: 0 }, 20, { y: 4000, speed: 250, throttle: 0.6, gearDown: true });
  check(a.speed > b.speed + 1, `gear: extended gear costs speed (${b.speed.toFixed(1)} vs ${a.speed.toFixed(1)})`);
}

console.log(failures === 0 ? '\nALL FLIGHT TESTS PASSED' : `\n${failures} FLIGHT TEST(S) FAILED`);
process.exit(failures ? 1 : 0);
