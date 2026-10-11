import { installDomStubs, noopProxy } from './dom-stub.mjs';
installDomStubs();
import * as THREE from 'three';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { AIPilot } from '../src/sim/AI.js';
import { ProjectileSystem } from '../src/sim/Weapons.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { buildParticleAtlas } from '../src/render/Shading.js';
import { TerrainField } from '../src/world/Terrain.js';

const field = new TerrainField(1337);
const proj = new ProjectileSystem({ maxProjectiles: 800 });
const audio = noopProxy('audio');
const particles = new ParticleSystem(buildParticleAtlas(256), { cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 1e-4 } });
const world = {
  projectiles: proj, audio, particles, groundHeight: (x, z) => field.heightAt(x, z),
  aircraft: [], targets: [], listenerPos: new THREE.Vector3(), time: 0, camera: new THREE.PerspectiveCamera(),
  env: { windDir: { x: 0, y: 0 }, windSpeed: 0, airDensity: () => 1.2, tempAt: () => 15, turbulence: 0 },
  csmUniforms: {}
};
const mk = (spec, faction, x, z, y, skill) => {
  const ac = new Aircraft({ spec, faction, world, seed: Math.random() * 9999 });
  ac.reset({ x, y: y || 4000, z, speed: 300, throttle: 0.85, gearDown: false });
  ac.maxHealth *= 1.6; ac.health = ac.maxHealth;
  ac.ai = new AIPilot(ac, { difficulty: skill, seed: Math.random() * 9999, world });
  ac.ai.patrolPoint.set(x, y || 4000, z);
  ac.ai.homeBase = { x: x * 3, y: 2000, z: z * 3 };
  world.aircraft.push(ac);
  return ac;
};
const blue = [mk('viper', 'blue', 0, -1500, 4200, 'ace'), mk('viper', 'blue', 300, -2000, 4200, 'veteran')];
const red = [mk('viper', 'red', 0, 1500, 4200, 'ace'), mk('viper', 'red', -300, 2000, 4200, 'veteran')];
let t = 0, blueDown = 0, redDown = 0;
const dt = 1/60;
for (let i = 0; i < 60 * 120; i++) {
  t += dt; world.time = t;
  for (const a of world.aircraft) if (a.ai) a.ai.update(dt, world);
  proj.update(dt, world);
  particles.update(dt, {}, world.camera);
  const bd = blue.filter(a => !a.fm.alive).length;
  const rd = red.filter(a => !a.fm.alive).length;
  if (bd !== blueDown) { console.log(`t=${t.toFixed(1)}s BLUE loss (${bd}/2)`); blueDown = bd; }
  if (rd !== redDown) { console.log(`t=${t.toFixed(1)}s RED loss (${rd}/2)`); redDown = rd; }
  if (i % 600 === 0) {
    const a0 = blue[0], b0 = red[0];
    const g0 = a0.ai._dbg || {};
    console.log(`  t=${t.toFixed(0)}s d=${a0.fm.pos.distanceTo(b0.fm.pos).toFixed(0)} blueAlt=${a0.fm.pos.y.toFixed(0)} spd=${a0.fm.speed.toFixed(0)} st=${a0.ai.state} tgt=${a0.ai.target ? 'yes' : 'no'} fc=${a0.ai.fightCeiling} nDes=${(g0.nDes||0).toFixed(2)} aVert=${(g0.aVert||0).toFixed(1)} G=${(g0.gLoad||0).toFixed(1)} cmdP=${(g0.cmdP||0).toFixed(2)} vy=${a0.fm.vel.y.toFixed(0)} pitch=${(Math.asin(Math.max(-1,Math.min(1,new THREE.Vector3(0,0,1).applyQuaternion(a0.fm.quat).y)))*57.3).toFixed(0)} | redAlt=${b0.fm.pos.y.toFixed(0)} spd=${b0.fm.speed.toFixed(0)} st=${b0.ai.state} tgt=${b0.ai.target ? 'yes' : 'no'} hp=${blue[0].health.toFixed(0)}/${red[0].health.toFixed(0)}`);
  }
  if (t > 40 && bd === 0 && rd === 0 && i % 1800 === 0) {
    const d = blue[0].fm.pos.distanceTo(red[0].fm.pos);
    console.log(`  t=${t.toFixed(0)}s hp blue=${blue.map(a=>a.health.toFixed(0)).join('/')} red=${red.map(a=>a.health.toFixed(0)).join('/')} dist=${d.toFixed(0)} states=${blue.map(a=>a.ai.state).join(',')}/${red.map(a=>a.ai.state).join(',')} missilesFired=${proj.stats.missilesFired} hits=${proj.stats.hits}`);
  }
}
console.log(`END t=${t.toFixed(0)}s blueDown=${blueDown} redDown=${redDown} missiles=${proj.stats.missilesFired} hits=${proj.stats.hits} bullets=${proj.stats.fired}`);
console.log('blue hp', blue.map(a=>a.health.toFixed(0)).join('/'), 'red hp', red.map(a=>a.health.toFixed(0)).join('/'));
console.log('blue states', blue.map(a=>a.ai.state).join(','), 'red states', red.map(a=>a.ai.state).join(','));
