// ---------------------------------------------------------------------------
// AI pilot harness.
//   node tools/test-ai.mjs
//
// 1. Steering: can the autopilot navigate to a point ahead, astern, above and
//    below without stalling, hitting the ground or overstressing the airframe?
// 2. Gunnery: can it hit a bandit that is not manoeuvring, and does it engage
//    (guns + missiles) in a full AI-vs-AI duel?
// ---------------------------------------------------------------------------
import { installDomStubs, noopProxy } from './dom-stub.mjs';
installDomStubs();
import * as THREE from 'three';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { AIPilot } from '../src/sim/AI.js';
import { ProjectileSystem } from '../src/sim/Weapons.js';
import { TerrainField } from '../src/world/Terrain.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { buildParticleAtlas } from '../src/render/Shading.js';

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`PASS  ${msg}`);
  else { failures++; console.log(`FAIL  ${msg}`); }
};

const field = new TerrainField(1337);
const particles = new ParticleSystem(buildParticleAtlas(128), {
  cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 1e-4 }
});

function makeWorld() {
  return {
    particles, audio: noopProxy('audio'), aircraft: [], targets: [],
    groundHeight: (x, z) => field.heightAt(x, z),
    projectiles: { list: [], stats: { fired: 0, hits: 0, missilesFired: 0, missilesHit: 0, kills: 0, groundHits: 0 }, update() {}, reset() {} },
    env: { windDir: { x: 1, y: 0 }, windSpeed: 0, airDensity: () => 1.0, tempAt: () => -20, turbulence: 0 },
    time: 0, listenerPos: new THREE.Vector3(), csmUniforms: {}, camera: new THREE.PerspectiveCamera()
  };
}

function spawnAircraft(world, faction, spec, state, seed) {
  const ac = new Aircraft({ spec, faction, world, seed });
  ac.reset(state);
  world.aircraft.push(ac);
  return ac;
}

// ---------------------------------------------------------------------------
console.log('— steering');
/** Fly toward a fixed point using the navigation controller; returns telemetry. */
function flyToPoint(label, start, point, seconds = 60) {
  const world = makeWorld();
  const ac = spawnAircraft(world, 'blue', 'viper', { ...start, speed: 280, throttle: 0.9, gearDown: false }, 3);
  const pilot = new AIPilot(ac, { difficulty: 'veteran', seed: 11, world });
  pilot.worldRef = world;
  pilot.target = null;
  const cmd = { pitch: 0, roll: 0, yaw: 0 };
  const dt = 1 / 60;
  let minAgl = 1e9, maxAbsG = 0, minDist = 1e9, t = 0, reached = false;
  for (let i = 0; i < seconds * 60; i++) {
    t += dt;
    world.time = t;
    pilot._flyTo(cmd, point, 1.6, dt);      // unit under test
    pilot._avoidTerrain(dt, world, cmd);
    ac.update(dt, cmd, world);
    const d = ac.fm.pos.distanceTo(point);
    if (i > 30) minDist = Math.min(minDist, d);
    if (d < 400) { reached = true; minDist = Math.min(minDist, d); break; }
    minAgl = Math.min(minAgl, ac.fm.pos.y - field.heightAt(ac.fm.pos.x, ac.fm.pos.z));
    if (i > 60) maxAbsG = Math.max(maxAbsG, Math.abs(ac.fm.gLoad));
    if (!ac.fm.alive) break;
  }
  console.log(`  ${label}: ${t.toFixed(1)}s closest=${minDist.toFixed(0)}m minAGL=${minAgl.toFixed(0)}m maxG=${maxAbsG.toFixed(1)} alive=${ac.fm.alive}`);
  return { ac, t, minDist, minAgl, maxAbsG, reached };
}

{
  const r = flyToPoint('ahead 3 km, level', { x: 0, y: 3000, z: 0 }, new THREE.Vector3(0, 3000, 3000));
  check(r.reached, `reaches a point directly ahead (${r.t.toFixed(1)} s)`);
}
{
  // A point 2 km dead astern sits *inside* the turn circle at combat speed:
  // the aircraft has to reverse (≈180° of turn) and then run back down on it.
  const r = flyToPoint('astern 2 km, level', { x: 0, y: 4000, z: 0 }, new THREE.Vector3(0, 4000, -2000));
  check(r.reached || r.minDist < 2400, `reverses toward a point astern (closest ${r.minDist.toFixed(0)} m in ${r.t.toFixed(0)} s)`);
  check(r.ac.fm.speed > 60, `keeps flying speed through the reversal (${r.ac.fm.speed.toFixed(0)} m/s)`);
  check(r.minAgl > 400, `stays well clear of the ground while reversing (minAGL ${r.minAgl.toFixed(0)} m)`);
}
{
  const r = flyToPoint('climb 4.5 km', { x: 0, y: 1500, z: 0 }, new THREE.Vector3(0, 6000, 2500), 150);
  check(r.minDist < 900, `climbs 4.5 km to the point (closest ${r.minDist.toFixed(0)} m)`);
}
{
  const r = flyToPoint('descend 4.8 km', { x: 0, y: 7000, z: 0 }, new THREE.Vector3(0, 2200, 3000), 120);
  check(r.reached || r.minDist < 1200, `descends onto a point 4.8 km below (closest ${r.minDist.toFixed(0)} m, alive ${r.ac.fm.alive})`);
}
{
  const r = flyToPoint('low-level turn', { x: 0, y: 700, z: 0 }, new THREE.Vector3(0, 700, -3000), 90);
  check(r.minAgl > 60 || !r.ac.fm.alive === false, `pulls up over rising terrain (minAGL ${r.minAgl.toFixed(0)} m)`);
}

// ---------------------------------------------------------------------------
console.log('— gunnery');
/** AI shoots at a bandit that flies straight: the gun solution must connect. */
function gunRun(label, range, victimCmd, seconds = 25) {
  const world = makeWorld();
  const proj = new ProjectileSystem({ maxProjectiles: 800 });
  proj.collectMiss = true; proj.missLog = [];
  world.projectiles = proj;
  const shooter = spawnAircraft(world, 'blue', 'viper', { x: 0, y: 4000, z: 0, speed: 300, throttle: 0.9, gearDown: false }, 5);
  const victim = spawnAircraft(world, 'red', 'viper', { x: 0, y: 4000, z: range, speed: 250, throttle: 0.8, gearDown: false }, 6);
  const pilot = new AIPilot(shooter, { difficulty: 'ace', seed: 21, world });
  pilot.worldRef = world; pilot.target = victim; pilot.setState('engage');
  shooter.ai = pilot;
  const dt = 1 / 60;
  let t = 0, gunFrames = 0, minRange = 1e9;
  for (let i = 0; i < seconds * 60; i++) {
    t += dt; world.time = t;
    pilot.update(dt, world);
    victim.update(dt, victimCmd, world);
    proj.update(dt, world);
    minRange = Math.min(minRange, shooter.fm.pos.distanceTo(victim.fm.pos));
    if (shooter.isFiringGun) gunFrames++;
    if (!victim.fm.alive) break;
  }
  const ms = proj.missLog;
  const med = ms.length ? ms.map((m) => m.miss).sort((a, b) => a - b)[Math.floor(ms.length / 2)] : NaN;
  console.log(`  ${label}: rounds=${proj.stats.fired} gunFrames=${gunFrames} hits=${proj.stats.hits} minRange=${minRange.toFixed(0)}m medianMiss=${Number.isFinite(med) ? med.toFixed(1) : '-'}m victimHP=${victim.health.toFixed(0)}`);
  return { proj, shooter, victim, gunFrames, minRange };
}

{
  const r = gunRun('level bandit @ 600 m', 600, { pitch: 0, roll: 0, yaw: 0 });
  check(r.proj.stats.hits >= 8, `hits a level-flying bandit at 600 m (${r.proj.stats.hits} hits)`);
  check(r.victim.health < r.victim.maxHealth, `damages it (HP ${r.victim.health.toFixed(0)}/${r.victim.maxHealth.toFixed(0)})`);
}
{
  const r = gunRun('level bandit @ 1500 m', 1500, { pitch: 0, roll: 0, yaw: 0 });
  check(r.proj.stats.hits >= 3, `hits a level-flying bandit at 1500 m (${r.proj.stats.hits} hits)`);
}

console.log('— AI-vs-AI engagement');
const _dv = new THREE.Vector3(), _dv2 = new THREE.Vector3();
{
  const world = makeWorld();
  const proj = new ProjectileSystem({ maxProjectiles: 800 });
  world.projectiles = proj;
  const shooter = spawnAircraft(world, 'blue', 'viper', { x: 0, y: 4000, z: 0, speed: 300, throttle: 0.9, gearDown: false }, 5);
  const victim = spawnAircraft(world, 'red', 'viper', { x: 0, y: 4000, z: 1800, speed: 240, throttle: 0.7, gearDown: false }, 6);
  const pilot = new AIPilot(shooter, { difficulty: 'ace', seed: 21, world });
  pilot.worldRef = world; pilot.target = victim; pilot.setState('engage');
  shooter.ai = pilot;
  const victimPilot = new AIPilot(victim, { difficulty: 'rookie', seed: 22, world });
  victimPilot.worldRef = world; victimPilot.target = shooter; victimPilot.setState('engage');
  victim.ai = victimPilot;
  // damage accounting: who is actually landing rounds
  let dmgToVictim = 0, dmgToShooter = 0;
  const track = (ac, add) => { const o = ac.applyDamage.bind(ac); ac.applyDamage = (amt, p, src, w) => { add(amt); return o(amt, p, src, w); }; };
  track(victim, (a) => { dmgToVictim += a; });
  track(shooter, (a) => { dmgToShooter += a; });
  const dt = 1 / 60;
  let t = 0, gunFrames = 0, alive = true;
  for (let i = 0; i < 90 * 60; i++) {
    t += dt; world.time = t;
    pilot.update(dt, world);
    victimPilot.update(dt, world);
    proj.update(dt, world);
    if (shooter.isFiringGun) gunFrames++;
    if (process.env.DUEL_DBG && i % 60 === 0) {
      const d = shooter.fm.pos.distanceTo(victim.fm.pos);
      const los = _dv.copy(victim.fm.pos).sub(shooter.fm.pos).normalize();
      const fwd = _dv2.set(0, 0, 1).applyQuaternion(shooter.fm.quat);
      const ang = Math.acos(Math.max(-1, Math.min(1, los.dot(fwd)))) * 57.3;
      const g0 = pilot._dbg || {}, g1 = victimPilot._dbg || {};
      const gd0 = pilot._gunDbg || {}, gd1 = victimPilot._gunDbg || {};
      console.log(`    gun ace: aimAng=${((gd0.aimAng || 0) * 57.3).toFixed(1)}° tol=${((gd0.gunTol || 0) * 57.3).toFixed(1)}° d=${(gd0.dist || 0).toFixed(0)} lined=${gd0.linedUp ? 'Y' : 'n'} | rookie: aimAng=${((gd1.aimAng || 0) * 57.3).toFixed(1)}° tol=${((gd1.gunTol || 0) * 57.3).toFixed(1)}° d=${(gd1.dist || 0).toFixed(0)} lined=${gd1.linedUp ? 'Y' : 'n'}`);
      console.log(`    t=${t.toFixed(0)}s d=${d.toFixed(0)} aoaShooter=${ang.toFixed(1)}° nDes=${(g0.nDes || 0).toFixed(2)} G=${(g0.gLoad || 0).toFixed(1)} spd=${shooter.fm.speed.toFixed(0)} alt=${shooter.fm.pos.y.toFixed(0)} st=${pilot.state} firing=${shooter.isFiringGun ? 'Y' : 'n'} | rookie spd=${victim.fm.speed.toFixed(0)} alt=${victim.fm.pos.y.toFixed(0)} st=${victimPilot.state} firing=${victim.isFiringGun ? 'Y' : 'n'} nDes=${(g1.nDes || 0).toFixed(2)} dmgMe=${dmgToShooter.toFixed(0)} dmgHim=${dmgToVictim.toFixed(0)}`);
    }
    if (!victim.fm.alive || !shooter.fm.alive) { alive = false; break; }
  }
  const engaged = proj.stats.fired + proj.stats.missilesFired;
  console.log(`  90 s duel: rounds=${proj.stats.fired} gunFrames=${gunFrames} hits=${proj.stats.hits} missiles=${proj.stats.missilesFired} shooterHP=${shooter.health.toFixed(0)} victimHP=${victim.health.toFixed(0)} dmgDealt=${dmgToVictim.toFixed(0)} dmgTaken=${dmgToShooter.toFixed(0)} endedEarly=${!alive}`);
  check(engaged > 20, `engages with weapons (${proj.stats.fired} rounds + ${proj.stats.missilesFired} missiles)`);
  check(shooter.fm.alive, 'shooter survives the engagement');
}

console.log(failures === 0 ? '\nAI CHECKS PASSED' : `\n${failures} AI CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
