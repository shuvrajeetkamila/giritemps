import { installDomStubs, noopProxy } from './dom-stub.mjs';
installDomStubs();
import * as THREE from 'three';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { AIPilot } from '../src/sim/AI.js';
import { ProjectileSystem } from '../src/sim/Weapons.js';
import { TerrainField } from '../src/world/Terrain.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { buildParticleAtlas } from '../src/render/Shading.js';
const field = new TerrainField(1337);
const particles = new ParticleSystem(buildParticleAtlas(64), { cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 0 } });
const proj = new ProjectileSystem({ maxProjectiles: 800 });
proj.collectMiss = true; proj.missLog = [];
const audio = noopProxy('audio');
const world = { particles, audio, aircraft: [], targets: [], projectiles: proj, groundHeight: (x,z)=>field.heightAt(x,z),
  env: { windDir:{x:1,y:0}, windSpeed:0, airDensity: () => 1.0, tempAt: ()=>-20, turbulence: 0 }, time: 0,
  listenerPos: new THREE.Vector3(), csmUniforms: {}, camera: new THREE.PerspectiveCamera() };
const shooter = new Aircraft({ spec: 'viper', faction: 'blue', world, seed: 5 });
const victim = new Aircraft({ spec: 'viper', faction: 'red', world, seed: 6 });
world.aircraft.push(shooter, victim);
const RANGE = Number(process.argv[2] || 300);
shooter.reset({ x: 0, y: 4000, z: 0, speed: 300, throttle: 0.9, gearDown: false });
victim.reset({ x: 0, y: 4000, z: RANGE, speed: 250, throttle: 0.8, gearDown: false });
const pilot = new AIPilot(shooter, { difficulty: 'ace', seed: 21, world });
pilot.worldRef = world; pilot.target = victim; pilot.setState('engage'); shooter.ai = pilot;
const dt = 1/60;
const traces = [];
const origSpawn = proj.spawnBullet.bind(proj);
proj.spawnBullet = (owner, origin, dir, speed, damage, faction, opts) => {
  const pr = origSpawn(owner, origin, dir, speed, damage, faction, opts);
  if (traces.length < 1) {
    const aim = owner.gunAimPoint(world, new THREE.Vector3());
    const tgt = owner.ai.target;
    console.log(`  shot meta: damage=${damage} muzzleY=${origin.y.toFixed(2)} ownY=${owner.fm.pos.y.toFixed(2)} aimY=${aim.y.toFixed(2)} tgtY=${tgt.fm.pos.y.toFixed(2)} tgtVel=(${tgt.fm.vel.x.toFixed(1)},${tgt.fm.vel.y.toFixed(1)},${tgt.fm.vel.z.toFixed(1)}) dir=(${dir.x.toFixed(4)},${dir.y.toFixed(4)},${dir.z.toFixed(4)})`);
  }
  if (traces.length < 12) traces.push({ pr, minD: 1e9, at: 0, closeVec: new THREE.Vector3(), t0: world.time, aim: new THREE.Vector3(), origin: origin.clone(), dir: dir.clone(), srcDist: 0 });
  return pr;
};
for (let i = 0; i < 60 * 12; i++) {
  world.time = i * dt;
  if (i % 30 === 0) { const D = pilot._dbg || {}; console.log(`  t=${(i/60).toFixed(1)} rng=${shooter.fm.pos.distanceTo(victim.fm.pos).toFixed(0)} yaw=${(D.yawErr||0).toFixed(2)} pit=${(D.pitchErr||0).toFixed(2)} aLat=${(D.aLat||0).toFixed(0)} aVert=${(D.aVert||0).toFixed(0)} nDes=${(D.nDes||0).toFixed(1)} bank=${shooter.fm.bodyRoll().toFixed(2)} vy=${shooter.fm.vel.y.toFixed(0)} spd=${shooter.fm.speed.toFixed(0)} gun=${shooter.isFiringGun?1:0} hits=${proj.stats.hits} des=(${(pilot._aimProbe?.desired.x||0).toFixed(2)},${(pilot._aimProbe?.desired.y||0).toFixed(2)},${(pilot._aimProbe?.desired.z||0).toFixed(2)}) vel=(${shooter.fm.vel.x.toFixed(0)},${shooter.fm.vel.y.toFixed(0)},${shooter.fm.vel.z.toFixed(0)})`); }
  pilot.update(dt, world);
  // victim: gentle straight flight, slight climb
  victim.update(dt, { pitch: Number(process.argv[3] || 0.05), roll: 0, yaw: 0 }, world);
  proj.update(dt, world);
  if (process.env.DBG) for (const tr of traces) {
    if (tr.pr.dead) continue;
    const d = tr.pr.pos.distanceTo(victim.fm.pos);
    if (d < tr.minD) { tr.minD = d; tr.at = world.time - tr.t0; tr.closeVec.copy(tr.pr.pos).sub(victim.fm.pos); const p2 = victim.fm.pos.clone().sub(tr.origin); tr.srcDist = p2.length(); tr.closeRel = p2; }
  }
}
console.log(`hits ${proj.stats.hits} / fired ${proj.stats.fired}  victim hp ${victim.health.toFixed(0)}  range ${RANGE}`);
const ml = proj.missLog;
if (ml.length) {
  const srt = ml.map((m)=>m.miss).sort((a,b)=>a-b);
  console.log(`  miss n=${ml.length} min=${srt[0].toFixed(1)} med=${srt[Math.floor(srt.length/2)].toFixed(1)} max=${srt[srt.length-1].toFixed(1)}  meanRange=${(ml.reduce((a,m)=>a+m.range,0)/ml.length).toFixed(0)}`);
}
for (const tr of traces) {
  console.log(`round t=${tr.at.toFixed(2)}s minD=${tr.minD.toFixed(2)}m srcDist=${tr.srcDist.toFixed(0)} err=(${tr.closeVec.x.toFixed(2)},${tr.closeVec.y.toFixed(2)},${tr.closeVec.z.toFixed(2)}) |dir|=${tr.dir.length().toFixed(3)}`);
}
