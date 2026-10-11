import { installDomStubs, noopProxy } from './dom-stub.mjs';
installDomStubs();
import * as THREE from 'three';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { AIPilot } from '../src/sim/AI.js';
import { TerrainField } from '../src/world/Terrain.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { buildParticleAtlas } from '../src/render/Shading.js';
const field = new TerrainField(1337);
const particles = new ParticleSystem(buildParticleAtlas(64), { cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 0 } });
const world = { particles, audio: noopProxy('audio'), aircraft: [], targets: [], groundHeight: (x,z)=>field.heightAt(x,z),
  projectiles: { list: [], stats: { fired:0, hits:0, missilesFired:0, missilesHit:0, kills:0, groundHits:0 }, update(){}, reset(){} },
  env: { windDir:{x:1,y:0}, windSpeed:0, airDensity: () => 1.0, tempAt: ()=>-20, turbulence: 0 }, time: 0,
  listenerPos: new THREE.Vector3(), csmUniforms: {}, camera: new THREE.PerspectiveCamera() };
const ac = new Aircraft({ spec: 'viper', faction: 'blue', world, seed: 3 });
ac.reset({ x: 0, y: 3000, z: 0, speed: 280, throttle: 0.9, gearDown: false });
world.aircraft.push(ac);
const pilot = new AIPilot(ac, { difficulty: 'veteran', seed: 11, world });
pilot.worldRef = world;
pilot.target = null;
pilot.patrolPoint.set(0, 3000, 3000);
pilot.setState('patrol');
const point = new THREE.Vector3(0, 3000, 3000);
const dt = 1/60;
const body = new THREE.Vector3();
for (let i = 0; i < 60 * 40; i++) {
  pilot.update(dt, world);
  if (i % 30 === 0) {
    const fm = ac.fm;
    body.copy(point).sub(fm.pos).normalize().applyQuaternion(fm.quat.clone().invert());
    console.log(`t=${(i/60).toFixed(1)} d=${fm.pos.distanceTo(point).toFixed(0)} agl=${(fm.pos.y - field.heightAt(fm.pos.x, fm.pos.z)).toFixed(0)} spd=${fm.speed.toFixed(0)} G=${fm.gLoad.toFixed(1)} bank=${fm.bodyRoll().toFixed(2)} pitch=${fm.aoa.toFixed(3)} cmdP=${(pilot._lastPitch ?? 0).toFixed(2)} cmdR=${(pilot._lastRoll ?? 0).toFixed(2)} tb=(${body.x.toFixed(2)},${body.y.toFixed(2)},${body.z.toFixed(2)}) st=${pilot.state} alt=${fm.pos.y.toFixed(0)}`);
  }
}
