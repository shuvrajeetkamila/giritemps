import { installDomStubs, noopProxy } from './dom-stub.mjs';
installDomStubs();
import * as THREE from 'three';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { TerrainField } from '../src/world/Terrain.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { buildParticleAtlas } from '../src/render/Shading.js';
const field = new TerrainField(1337);
const particles = new ParticleSystem(buildParticleAtlas(64), { cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 0 } });
const world = { particles, audio: noopProxy('audio'), aircraft: [], targets: [], groundHeight: (x,z)=>field.heightAt(x,z),
  projectiles: { list: [], stats: {}, update(){}, reset(){} },
  env: { windDir:{x:1,y:0}, windSpeed:0, airDensity: () => 1.0, tempAt: ()=>-20, turbulence: 0 }, time: 0,
  listenerPos: new THREE.Vector3(), csmUniforms: {}, camera: new THREE.PerspectiveCamera() };
for (const spec of ['viper','raptor']) {
  const ac = new Aircraft({ spec, faction: 'blue', world, seed: 3 });
  ac.reset({ x: 0, y: 6000, z: 0, speed: 400, throttle: 0.9, gearDown: false });
  const fm = ac.fm;
  const out = [];
  for (let i = 0; i < 240; i++) { ac.update(1/60, {pitch:0,roll:1,yaw:0}, world); if (i%30===29) out.push(`t=${((i+1)/60).toFixed(1)} bank=${fm.bodyRoll().toFixed(2)} wz=${fm.angular.z.toFixed(2)}`); }
  console.log(spec, out.join(' | '));
  const ac2 = new Aircraft({ spec, faction: 'blue', world, seed: 3 });
  ac2.reset({ x: 0, y: 6000, z: 0, speed: 400, throttle: 0.9, gearDown: false });
  const o2 = [];
  for (let i = 0; i < 180; i++) { ac2.update(1/60, {pitch:1,roll:0,yaw:0}, world); if (i%60===59) o2.push(`t=${((i+1)/60).toFixed(0)} pitch=${ac2.fm.bodyPitch().toFixed(2)} wx=${ac2.fm.angular.x.toFixed(2)} G=${ac2.fm.gLoad.toFixed(1)}`); }
  console.log('  pitch:', o2.join(' | '));
}
