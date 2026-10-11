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
  projectiles: { list: [], stats: {}, update(){}, reset(){} },
  env: { windDir:{x:1,y:0}, windSpeed:0, airDensity: () => 1.0, tempAt: ()=>-20, turbulence: 0 }, time: 0,
  listenerPos: new THREE.Vector3(), csmUniforms: {}, camera: new THREE.PerspectiveCamera() };
const scenario = process.argv[2] || 'behind';
const START = scenario==='climb'? {x:0,y:1500,z:0} : scenario==='descend' ? {x:0,y:7000,z:0} : {x:0,y:4000,z:0};
const point = scenario === 'behind' ? new THREE.Vector3(0, 4000, -2000) : scenario === 'climb' ? new THREE.Vector3(0, 6000, 2500) : new THREE.Vector3(0, 2200, 3000);
const ac = new Aircraft({ spec: 'viper', faction: 'blue', world, seed: 3 });
ac.reset({ x: START.x, y: START.y, z: START.z, speed: 280, throttle: 0.9, gearDown: false });
world.aircraft.push(ac);
const pilot = new AIPilot(ac, { difficulty: 'veteran', seed: 11, world });
pilot.worldRef = world;
const cmd = { pitch: 0, roll: 0, yaw: 0 };
const dt = 1/60;
const body = new THREE.Vector3();
for (let i = 0; i < 60 * 90; i++) {
  world.time = i/60;
  pilot._flyTo(cmd, point, 1.6, dt);
  pilot._avoidTerrain(dt, world, cmd);
  if (i % 300 === 0) {
    const fm = ac.fm;
    body.copy(point).sub(fm.pos).normalize().applyQuaternion(fm.quat.clone().invert());
    console.log(`t=${(i/60).toFixed(1)} vy=${fm.vel.y.toFixed(0)} agl=${(fm.pos.y-field.heightAt(fm.pos.x,fm.pos.z)).toFixed(0)} need=${(fm.speed*fm.speed/(2*4.2*9.8)+140+Math.max(0,-fm.vel.y)*2).toFixed(0)} aoa=${fm.aoa.toFixed(2)} stall=${fm.stallSeverity?fm.stallSeverity.toFixed(2):'-'} pos=(${fm.pos.x.toFixed(0)},${fm.pos.z.toFixed(0)}) d=${fm.pos.distanceTo(point).toFixed(0)} alt=${fm.pos.y.toFixed(0)} spd=${fm.speed.toFixed(0)} G=${fm.gLoad.toFixed(1)} bank=${fm.bodyRoll().toFixed(2)} aoa=${fm.aoa.toFixed(3)} hdg=${fm.heading().toFixed(0)} cmdP=${cmd.pitch.toFixed(2)} err=${(pilot._dbg?.err??0).toFixed(2)} aPerp=${(pilot._dbg?.aPerp??0).toFixed(0)} nDes=${(pilot._dbg?.nDes??0).toFixed(2)} nCap=${(pilot._dbg?.nCap??0).toFixed(2)} wB=${(pilot._dbg?.wantBank??0).toFixed(2)} avT=${pilot.avoidTimer.toFixed(2)} cmdR=${cmd.roll.toFixed(2)} tb=(${body.x.toFixed(2)},${body.y.toFixed(2)},${body.z.toFixed(2)})`);
  }
  ac.update(dt, cmd, world);
}
