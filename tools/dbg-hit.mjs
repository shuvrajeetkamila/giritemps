import { installDomStubs, noopProxy } from './dom-stub.mjs';
installDomStubs();
import * as THREE from 'three';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { ProjectileSystem } from '../src/sim/Weapons.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { buildParticleAtlas } from '../src/render/Shading.js';
import { TerrainField } from '../src/world/Terrain.js';

const field = new TerrainField(1337);
const proj = new ProjectileSystem({ maxProjectiles: 400 });
const particles = new ParticleSystem(buildParticleAtlas(128), { cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 1e-4 } });
const world = {
  projectiles: proj, audio: noopProxy('audio'), particles, groundHeight: (x, z) => field.heightAt(x, z),
  aircraft: [], targets: [], listenerPos: new THREE.Vector3(), time: 0, camera: new THREE.PerspectiveCamera(),
  env: { windDir: { x: 0, y: 0 }, windSpeed: 0, airDensity: () => 1.2, tempAt: () => 15, turbulence: 0 },
  csmUniforms: {}
};
const mk = (spec, faction, seed) => {
  const ac = new Aircraft({ spec, faction, world, seed });
  world.aircraft.push(ac);
  return ac;
};
const shooter = mk('viper', 'blue', 1);
const target = mk('viper', 'red', 2);

console.log('--- gun');
shooter.reset({ x: 0, y: 5000, z: 0, speed: 250, throttle: 0.8 });
target.reset({ x: 0, y: 5000, z: 700, speed: 250, throttle: 0.8 });
shooter.weapons.gun.ammo = 500;
shooter.setGunFiring(true);
for (let i = 0; i < 180; i++) {
  shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
  target.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
  proj.update(1/60, world);
}
shooter.setGunFiring(false);
console.log('gun: hp', target.health.toFixed(1), '/', target.maxHealth.toFixed(1), 'hits', proj.stats.hits, 'fired', proj.stats.fired);

console.log('--- heat seeker  (tail chase, target evading)');
const cases = [[1200, 0], [2600, 0], [4000, 0.7], [6000, 0]];
for (const [range, evade] of cases) {
  proj.reset();
  target.reset({ x: 0, y: 5000, z: range, speed: 250, throttle: 0.8 });
  target.fm.alive = true; target.health = target.maxHealth; target.dead = false;
  shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
  const m = shooter.fireMissile(world, 'aim9', target);
  let t = 0, dmin = 1e9, hit = false;
  for (let i = 0; i < 60 * 40; i++) {
    t += 1/60;
    shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    target.update(1/60, evade ? { pitch: Math.sin(t*0.8)*0.4, roll: 0.6, yaw: 0 } : { pitch: 0, roll: 0, yaw: 0 }, world);
    proj.update(1/60, world);
    dmin = Math.min(dmin, m.pos.distanceTo(target.fm.pos));
    if (target.health < target.maxHealth - 0.5) { hit = true; break; }
    if (m.dead) break;
  }
  console.log(`range=${range} evade=${evade}: hit=${hit} hp=${target.health.toFixed(0)} minDist=${dmin.toFixed(1)} t=${t.toFixed(1)}s speed=${m.vel.length().toFixed(0)} seeker=${m.seeker} state=${m.seekState}`);
}
const m = (() => { proj.reset(); target.reset({ x: 0, y: 5000, z: 0, speed: 250, throttle: 0.8 }); shooter.reset({ x: 0, y: 5000, z: 4000, speed: 250, throttle: 0.8 }); return shooter.fireMissile(world, 'aim120', target); })();
console.log('radar missile vs target 4km ahead:', m.missileType, 'speed', m.vel.length().toFixed(0));

console.log('--- aim point diagnostics');
shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
target.reset({ x: 0, y: 5000, z: 1500, speed: 250, throttle: 0.8 });
target.fm.alive = true; target.health = target.maxHealth; target.dead = false;
proj.reset();
world.aimPoint = new THREE.Vector3(0, 5000, 4000);
const aim = new THREE.Vector3();
shooter.radarLockTarget = target;
shooter.gunAimPoint(world, aim);
console.log('target pos', target.fm.pos.toArray().map(v=>v.toFixed(0)).join(','), 'aim', aim.toArray().map(v=>v.toFixed(0)).join(','));
console.log('no-target aim', shooter.gunAimPoint(world, new THREE.Vector3()).toArray().map(v=>v.toFixed(0)).join(','));
shooter.weapons.gun.ammo = 800;
shooter.setGunFiring(true);
for (let i = 0; i < 240; i++) {
  shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
  target.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
  proj.update(1/60, world);
}
shooter.setGunFiring(false);
console.log('gun solution hits', proj.stats.hits, 'fired', proj.stats.fired, 'hp', target.health.toFixed(0), '/', target.maxHealth.toFixed(0));

console.log('--- single round trace');
shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
target.reset({ x: 0, y: 5000, z: 1500, speed: 250, throttle: 0.8 });
proj.reset();
shooter.radarLockTarget = target;
const aim2 = shooter.gunAimPoint(world, new THREE.Vector3());
console.log('aim', aim2.toArray().map(v=>v.toFixed(1)).join(','), 'target', target.fm.pos.toArray().map(v=>v.toFixed(1)).join(','));
shooter.weapons.gun.ammo = 5;
shooter.fireRound(world);
const b = proj.list[proj.list.length-1];
console.log('bullet from', b.pos.toArray().map(v=>v.toFixed(1)).join(','), 'dir', b.vel.clone().normalize().toArray().map(v=>v.toFixed(4)).join(','), 'speed', b.vel.length().toFixed(0));
let t=0, dmin=1e9, dminT=0;
for (let i=0;i<200;i++){
  t+=1/60;
  target.update(1/60, {pitch:0,roll:0,yaw:0}, world);
  proj.update(1/60, world);
  if (!proj.list.includes(b)) { console.log('round ended at t=', t.toFixed(2)); break; }
  const d = b.pos.distanceTo(target.fm.pos);
  if (d<dmin){dmin=d;dminT=t;}
}
console.log('min dist', dmin.toFixed(1), 'at t', dminT.toFixed(2), 'target', target.fm.pos.toArray().map(v=>v.toFixed(1)).join(','));

console.log('--- dispersion statistics at 600 m and 1500 m');
for (const range of [600, 1500]) {
  shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
  target.reset({ x: 0, y: 5000, z: range, speed: 250, throttle: 0.8 });
  proj.reset();
  shooter.radarLockTarget = target;
  const dists = [];
  shooter.weapons.gun.ammo = 400;
  const origFire = shooter.fireRound.bind(shooter);
  let mine = null;
  shooter.fireRound = (w) => { origFire(w); mine = proj.list[proj.list.length - 1]; if (mine) { dists.push({ d: 1e9, b: mine }); } };
  shooter.setGunFiring(true);
  // step the shooter+target in lockstep with the world so relative geometry is stable
  for (let i = 0; i < 120; i++) {
    shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    target.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    proj.update(1/60, world);
    for (const s of dists) { const d = s.b.pos.distanceTo(target.fm.pos); if (d < s.d) s.d = d; }
  }
  shooter.setFiringGun = null;
  shooter.setGunFiring(false);
  shooter.fireRound = origFire;
  const alive = dists.filter(s => s.b.life > 0).map(s => s.d).sort((a,b)=>a-b);
  const hits = dists.filter(s => s.d < target.hitRadius).length;
  const avg = alive.reduce((a,b)=>a+b,0)/Math.max(1,alive.length);
  console.log(`range ${range}: rounds=${dists.length} hits=${hits} (${(hits/dists.length*100).toFixed(0)}%) medianMinDist=${alive[Math.floor(alive.length/2)]?.toFixed(1)} avgMin=${avg.toFixed(1)} hitRadius=${target.hitRadius.toFixed(1)}`);
}

console.log('--- clean single-round trace at 1500 m (new solution)');
shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
target.reset({ x: 0, y: 5000, z: 1500, speed: 250, throttle: 0.8 });
proj.reset(); shooter.gunHeat = 0; shooter.gunJammed = false;
shooter.radarLockTarget = target;
const aim3 = shooter.gunAimPoint(world, new THREE.Vector3());
console.log('aim', aim3.toArray().map(v=>v.toFixed(1)).join(','));
shooter.weapons.gun.ammo = 3;
shooter.fireRound(world);
const b2 = proj.list[proj.list.length-1];
let dmin2 = 1e9, t2 = 0;
for (let i=0;i<200;i++){
  t2+=1/60;
  target.update(1/60, {pitch:0,roll:0,yaw:0}, world);
  proj.update(1/60, world);
  const d = b2.pos.distanceTo(target.fm.pos);
  if (d<dmin2) dmin2=d;
  if (!proj.list.includes(b2)) { console.log('round ended t=',t2.toFixed(2), 'minDist', dmin2.toFixed(1)); break; }
}

console.log('--- error decomposition at 1500 m');
shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
target.reset({ x: 0, y: 5000, z: 1500, speed: 250, throttle: 0.8 });
proj.reset(); shooter.gunHeat = 0; shooter.gunJammed = false; shooter.radarLockTarget = target;
shooter.weapons.gun.ammo = 3;
target.update(0, {pitch:0,roll:0,yaw:0}, world);
shooter.update(0, {pitch:0,roll:0,yaw:0}, world);
shooter.fireRound(world);
const b3 = proj.list[proj.list.length-1];
const t0 = target.fm.pos.clone(), s0 = shooter.fm.pos.clone();
console.log('muzzle', b3.pos.toArray().map(v=>v.toFixed(2)).join(','), 'vel', b3.vel.toArray().map(v=>v.toFixed(2)).join(','), 'speed', b3.vel.length().toFixed(1));
let best = { d: 1e9 };
let tt = 0;
for (let i=0;i<200;i++){
  tt += 1/60;
  target.update(1/60, {pitch:0,roll:0,yaw:0}, world);
  proj.update(1/60, world);
  const d = b3.pos.distanceTo(target.fm.pos);
  if (d < best.d) best = { d, bp: b3.pos.clone(), tp: target.fm.pos.clone(), t: tt };
  if (!proj.list.includes(b3)) break;
}
console.log('minDist', best.d.toFixed(2), 'at t', best.t.toFixed(3));
console.log('  bullet', best.bp.toArray().map(v=>v.toFixed(1)).join(','));
console.log('  target', best.tp.toArray().map(v=>v.toFixed(1)).join(','));
console.log('  delta ', best.bp.clone().sub(best.tp).toArray().map(v=>v.toFixed(1)).join(','));

console.log('--- statistical hit test (40 rounds, target 1500 m, no shooter/aim changes)');
{
  proj.reset(); shooter.gunHeat = 0; shooter.gunJammed = false;
  shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
  target.reset({ x: 0, y: 5000, z: 1500, speed: 250, throttle: 0.8 });
  shooter.radarLockTarget = target;
  shooter.weapons.gun.ammo = 60;
  const track = new Map();
  shooter.setGunFiring(true);
  for (let i = 0; i < 90; i++) {
    shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    if (i === 1) shooter.setGunFiring(false);           // single short burst
    target.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    for (const p of proj.list) {
      if (p.type !== 'bullet') continue;
      if (!track.has(p)) track.set(p, { d: 1e9, hit: false });
      const s = track.get(p);
      const d = p.pos.distanceTo(target.fm.pos);
      if (d < s.d) s.d = d;
    }
    proj.update(1/60, world);
    // hit bookkeeping: bullets die on impact, so watch the target's health too
  }
  const arr = [...track.values()];
  const hits = arr.filter((s) => s.d < target.hitRadius).length;
  const dead = arr.filter((s) => !proj.list.includes(s) && s.d < 30).length;
  const ds = arr.map((s) => s.d).sort((a, b) => a - b);
  console.log(`rounds=${arr.length} withinHitRadius=${hits} (${(hits / Math.max(1, arr.length) * 100).toFixed(0)}%) medianMinDist=${ds[Math.floor(ds.length / 2)].toFixed(1)} p25=${ds[Math.floor(ds.length*0.25)].toFixed(1)} p75=${ds[Math.floor(ds.length*0.75)].toFixed(1)} targetHp=${target.health.toFixed(0)}/${target.maxHealth.toFixed(0)}`);
}

console.log('--- hit rate by range (via ProjectileSystem.stats)');
for (const range of [400, 700, 1000, 1500, 2200]) {
  proj.reset(); proj.stats.hits = 0; proj.stats.fired = 0;
  shooter.gunHeat = 0; shooter.gunJammed = false;
  shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
  target.reset({ x: 0, y: 5000, z: range, speed: 250, throttle: 0.8 });
  target.fm.alive = true; target.health = target.maxHealth; target.dead = false;
  shooter.radarLockTarget = target;
  shooter.weapons.gun.ammo = 200;
  shooter.setGunFiring(true);
  for (let i = 0; i < 120; i++) {
    shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    if (i === 30) shooter.setGunFiring(false);
    target.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    proj.update(1/60, world);
  }
  shooter.setGunFiring(false);
  const rate = proj.stats.hits / Math.max(1, proj.stats.fired);
  console.log(`  ${range} m: ${proj.stats.fired} rounds, ${proj.stats.hits} hits = ${(rate * 100).toFixed(0)}%  (target hp ${target.health.toFixed(0)})`);
}

console.log('--- debug zero-hit case');
{
  proj.reset(); proj.stats.hits = 0; proj.stats.fired = 0;
  shooter.gunHeat = 0; shooter.gunJammed = false;
  shooter.reset({ x: 0, y: 5000, z: 0, speed: 300, throttle: 0.9 });
  target.reset({ x: 0, y: 5000, z: 600, speed: 250, throttle: 0.8 });
  shooter.radarLockTarget = target;
  shooter.weapons.gun.ammo = 50;
  shooter.setGunFiring(true);
  for (let i = 0; i < 150; i++) {
    shooter.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    if (i === 30) shooter.setGunFiring(false);
    target.update(1/60, { pitch: 0, roll: 0, yaw: 0 }, world);
    proj.update(1/60, world);
    if (i === 3) {
      console.log('  bullets in flight:', proj.list.filter(p => p.type === 'bullet').length);
      const b = proj.list.find(p => p.type === 'bullet');
      if (b) console.log('   first bullet pos', b.pos.toArray().map(v=>v.toFixed(0)).join(','), 'owner is shooter?', b.owner === shooter, 'faction', b.faction, 'target alive', target.fm.alive, 'targetFaction', target.faction, 'hitRadius', target.hitRadius.toFixed(1));
    }
  }
  shooter.setGunFiring(false);
  console.log('  after: hits', proj.stats.hits, 'fired', proj.stats.fired, 'hp', target.health.toFixed(0));
  console.log('  shooter pos', shooter.fm.pos.toArray().map(v=>v.toFixed(0)).join(','), 'target pos', target.fm.pos.toArray().map(v=>v.toFixed(0)).join(','));
  console.log('  world.aircraft', world.aircraft.length, world.aircraft.map(a=>a.faction).join(','));
}
