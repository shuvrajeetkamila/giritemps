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
for (const [label, input] of [['pitch +1', {pitch:1,roll:0,yaw:0}], ['pitch -1', {pitch:-1,roll:0,yaw:0}], ['roll +1', {pitch:0,roll:1,yaw:0}], ['roll -1', {pitch:0,roll:-1,yaw:0}], ['yaw +1', {pitch:0,roll:0,yaw:1}]]) {
  const ac = new Aircraft({ spec: 'viper', faction: 'blue', world, seed: 3 });
  ac.reset({ x: 0, y: 4000, z: 0, speed: 300, throttle: 0.9, gearDown: false });
  const fm = ac.fm;
  for (let i = 0; i < 120; i++) ac.update(1/60, input, world);
  const fwd = new THREE.Vector3(0,0,1).applyQuaternion(fm.quat);
  console.log(`${label}: dAlt=${(fm.pos.y-4000).toFixed(0)}m G=${fm.gLoad.toFixed(2)} aoa=${fm.aoa.toFixed(3)} bodyRoll=${fm.bodyRoll().toFixed(2)} heading=${fm.heading().toFixed(0)} fwd.y=${fwd.y.toFixed(3)} fwd.x=${fwd.x.toFixed(3)}`);
}
