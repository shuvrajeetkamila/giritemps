// ---------------------------------------------------------------------------
// Headless integration test: boots the whole game logic (terrain field, aircraft
// models, AI, weapons, missions, HUD drawing, particles) with DOM stubs and
// steps the simulation.  Catches runtime errors and NaN explosions without a GPU.
//
//   node tools/headless.mjs            # all scenarios
//   node tools/headless.mjs m05 60     # one mission, N seconds
// ---------------------------------------------------------------------------
import { installDomStubs } from './dom-stub.mjs';
installDomStubs();

import * as THREE from 'three';
import { TerrainField } from '../src/world/Terrain.js';
import { Environment } from '../src/world/Environment.js';
import { ParticleSystem } from '../src/render/Particles.js';
import { ProjectileSystem } from '../src/sim/Weapons.js';
import { buildParticleAtlas } from '../src/render/Shading.js';
import { Settings } from '../src/core/Settings.js';
import { Game } from '../src/game/Game.js';
import { HUD } from '../src/ui/HUD.js';
import { UI } from '../src/ui/UI.js';
import { AIPilot } from '../src/sim/AI.js';
import { buildAircraftModel, AIRCRAFT_SPECS, FLEET_ORDER } from '../src/aircraft/AircraftModels.js';
import { Aircraft } from '../src/aircraft/Aircraft.js';
import { MISSIONS } from '../src/game/Missions.js';
import { noopProxy } from './dom-stub.mjs';

let failures = 0;
const check = (cond, msg) => {
  if (!cond) { failures++; console.log(`FAIL  ${msg}`); }
  else console.log(`PASS  ${msg}`);
};

const argMission = process.argv[2];
const argSeconds = parseFloat(process.argv[3] || '0');

// ---------------------------------------------------------------------------
console.log('— building world —');
const field = new TerrainField(1337);
check(field.verifyNoiseTable(), 'terrain noise table matches the GPU permutation');

// sample the height field for sanity
let minH = Infinity, maxH = -Infinity, sum = 0, n = 0;
for (let i = 0; i < 3000; i++) {
  const x = (i * 977) % 40000 - 20000;
  const z = (i * 1583) % 40000 - 20000;
  const h = field.heightAt(x, z);
  if (!Number.isFinite(h)) { check(false, 'heightAt returned NaN'); break; }
  minH = Math.min(minH, h); maxH = Math.max(maxH, h); sum += h; n++;
}
check(minH < -20, `terrain has ocean basins (min ${minH.toFixed(0)} m)`);
check(maxH > 900, `terrain has mountains (max ${maxH.toFixed(0)} m)`);
check(Number.isFinite(sum / n), 'terrain mean height is finite');

const biomes = new Set();
for (let i = 0; i < 600; i++) {
  const x = (i * 2311) % 60000 - 30000;
  const z = (i * 3701) % 60000 - 30000;
  biomes.add(field.biomeAt(x, z));
}
check(biomes.size >= 3, `biome variety present (${[...biomes].join(', ')})`);

const atlas = buildParticleAtlas(512);
check(!!atlas, 'particle atlas generated');

// ---------------------------------------------------------------------------
console.log('— aircraft models —');
for (const id of FLEET_ORDER) {
  const spec = AIRCRAFT_SPECS[id];
  let built = null;
  try { built = buildAircraftModel(spec, { liveryIndex: 0, textureSize: 256 }); }
  catch (e) { check(false, `${id} model build threw: ${e.message}`); continue; }
  let meshes = 0, tris = 0;
  built.group.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      if (g && g.index) tris += g.index.count / 3;
      else if (g && g.attributes.position) tris += g.attributes.position.count / 3;
    }
  });
  const parts = built;
  const surfaces = (parts.ailerons || []).length + (parts.elevators || []).length + (parts.rudders || []).length
    + (parts.flaps || []).length + (parts.gears || []).length + (parts.nozzles || []).length;
  check(meshes > 12 && tris > 800, `${id}: ${meshes} meshes / ${Math.round(tris)} tris`);
  check(surfaces > 4, `${id}: animated surfaces present (${surfaces})`);
}

// ---------------------------------------------------------------------------
function makeWorld() {
  const settings = new Settings();
  const env = new Environment(settings);
  const particles = new ParticleSystem(atlas, {
    cameraPos: new THREE.Vector3(), fogColor: new THREE.Color(), fogDensity: { value: 0.0001 }
  });
  const projectiles = new ProjectileSystem({ maxProjectiles: 600 });
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 40000);
  const audio = noopProxy('audio');
  audio.music = noopProxy('music');
  const world = {
    scene: new THREE.Scene(),
    camera,
    env,
    particles,
    projectiles,
    audio,
    listenerPos: new THREE.Vector3(),
    groundHeight: (x, z) => field.heightAt(x, z),
    aircraft: [],
    targets: [],
    time: 0,
    csmUniforms: {},
    tempAt: (a) => env.tempAt(a),
    canopyRain: 0,
    cockpitShake: new THREE.Vector3(),
    activeCamera: camera
  };
  return { world, env, settings, camera };
}

function runScenario(label, setup, seconds, opts = {}) {
  const { world, env, settings, camera } = makeWorld();
  const hud = makeHud();
  const game = new Game({
    world, scene: world.scene, camera, settings, audio: world.audio,
    input: null, hud, ui: noopProxy('ui'), terrain: field, env
  });
  game.ui = noopProxy('ui');
  setup(game, world);

  // scripted "pilot" input so the player path (weapons, gear, damage) is exercised
  const input = makeStubInput();
  game.input = input;
  const dt = 1 / 60;
  const steps = Math.round(seconds * 60);
  let maxAbs = 0;
  try {
    for (let i = 0; i < steps; i++) {
      input.tick(dt);
      if (game.player && !game.player.fm.alive &&
          world.projectiles.list.filter((p) => p.faction === 'blue').length === 0) {
        // keep the sim running after a player death (arcade behaviour)
      }
      game.update(dt);
      world.projectiles.update(dt, world);
      world.particles.update(dt, { windSpeed: env.windSpeed, windDir: env.windDir }, camera);
      const p = game.player.fm.pos;
      maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
      if (!Number.isFinite(p.x + p.y + p.z)) throw new Error('player position became NaN');
    }
  } catch (e) {
    check(false, `${label}: threw after ${(game.elapsed || 0).toFixed(1)}s — ${e.message}`);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    return null;
  }
  const st = game.stats;
  const air = game.aircraft.filter((a) => a.faction === 'red' && !a.fm.alive).length;
  console.log(`      ${label}: t=${game.elapsed.toFixed(0)}s score=${Math.round(game.score)} ` +
    `airKills=${st.airKills} ground=${st.groundKills} fired=${st.fired} ` +
    `missiles=${world.projectiles.stats.missilesFired} hits=${world.projectiles.stats.hits} ` +
    `redDown=${air} particles=${world.particles.additive.live + world.particles.alpha.live}`);
  check(maxAbs < 400000, `${label}: positions stayed in range`);
  if (opts.expect) opts.expect(game, world);
  return { game, world };
}

function makeHudCtxCanvas() {
  const ctx = makeCtxStub();
  const canvas = { width: 1600, height: 900, getContext: () => ctx };
  return { canvas, ctx };
}

function makeHud() {
  const { canvas, ctx } = makeHudCtxCanvas();
  const hud = new HUD(canvas, { units: 'imperial' });
  hud.w = 1600; hud.h = 900; hud.scale = 1; hud.ctx = ctx;
  hud.canvas = canvas;
  return hud;
}

function makeStubInput() {
  const axes = { pitch: 0, roll: 0, yaw: 0 };
  let t = 0;
  let fireWindow = 0;
  const pending = new Set();
  const api = {
    axes, throttleDelta: 0, throttleHard: 0, mouse: { left: false, right: false }, locked: false,
    tick(dt) {
      t += dt;
      axes.pitch = Math.sin(t * 0.21) * 0.45;
      axes.roll = Math.sin(t * 0.13) * 0.7;
      axes.yaw = Math.sin(t * 0.05) * 0.3;
      fireWindow -= dt;
      if (fireWindow <= 0) {
        fireWindow = 5.5;
        pending.add('fireMissile1');
        if (Math.sin(t * 0.31) > 0.4) pending.add('fireMissile2');
        if (Math.cos(t * 0.23) > 0.25) pending.add('fireRocket');
        if (Math.cos(t * 0.19) > 0.6) pending.add('dropBomb');
        if (Math.sin(t * 0.41) > 0.5) pending.add('flares');
        if (Math.cos(t * 0.37) > 0.5) pending.add('chaff');
        api.gunWindow = 1.6;
      }
      if (api.gunWindow > 0) api.gunWindow -= dt;
    },
    down(action) { return action === 'fireGun' && api.gunWindow > 0; },
    pressed(action) { if (pending.has(action)) { pending.delete(action); return true; } return false; },
    endFrame() {},
    requestLock() {}, exitLock() {}, update() {},
    gunWindow: 0
  };
  return api;
}

function makeCtxStub() {
  const grad = { addColorStop() {} };
  const measure = (t) => ({ width: String(t).length * 7 });
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => grad;
      if (k === 'measureText') return measure;
      if (k === 'canvas') return { width: 1600, height: 900 };
      if (k === 'font' || k === 'fillStyle' || k === 'strokeStyle' || k === 'textAlign' || k === 'textBaseline' || k === 'globalAlpha' || k === 'lineWidth' || k === 'filter') return 0;
      return () => {};
    },
    set() { return true; }
  });
}

// ---------------------------------------------------------------------------
console.log('— scenarios —');
const scenarios = argMission ? [argMission] : MISSIONS.map((m) => m.id).concat(['freeflight', 'instant', 'aerobatic']);
const seconds = argSeconds || 25;

for (const id of scenarios) {
  const mission = MISSIONS.find((m) => m.id === id);
  const label = mission ? `${id} ${mission.short}` : id;
  runScenario(label, (game) => {
    if (mission) game.startMission(id);
    else game.startQuick(id);
  }, seconds, {
    expect: (game) => {
      check(game.aircraft.length > 0, `${label}: aircraft spawned (${game.aircraft.length})`);
      const bad = game.aircraft.filter((a) => !Number.isFinite(a.fm.pos.x + a.fm.pos.y + a.fm.pos.z) || !Number.isFinite(a.fm.quat.x));
      check(bad.length === 0, `${label}: all aircraft states finite`);
      const objOk = game.objectives.every((o) => o.text && typeof o.done === 'boolean');
      check(objOk, `${label}: objectives well formed (${game.objectives.length})`);
    }
  });
}

// ---------------------------------------------------------------------------
console.log('— weapon/ai unit checks —');
{
  const { world, env, settings, camera } = makeWorld();
  const game = new Game({
    world, scene: world.scene, camera, settings, audio: world.audio,
    input: null, hud: makeHud(), ui: noopProxy('ui'), terrain: field, env
  });
  game.ui = noopProxy('ui');
  game.startQuick('instant');
  const ac = game.player;
  // fire every weapon type
  const before = world.projectiles.list.length;
  ac.weapons.gun.ammo = 200;
  ac.setGunFiring(true);
  for (let i = 0; i < 30; i++) { ac.update(1 / 60, { pitch: 0, roll: 0, yaw: 0 }, world); }
  ac.setGunFiring(false);
  check(world.projectiles.list.length > before, 'cannon produces projectiles');
  const m1 = ac.fireMissile(world, 'aim9', null);
  const m2 = ac.fireMissile(world, 'aim120', null);
  check(!!m1 && !!m2, 'heat seeker + radar missile launch');
  ac.weapons.rocket.count = 4;
  ac.weapons.bomb.count = 2;
  check(!!ac.fireRocket(world), 'rocket launch');
  check(!!ac.dropBomb(world), 'bomb release');
  check(ac.dropFlares(world, 2) && ac.flares < 30, 'flares dispense');
  check(ac.dropChaff(world, 3), 'chaff dispense');
  // step missiles for a while to exercise guidance
  for (let i = 0; i < 200; i++) world.projectiles.update(1 / 60, world);
  check(world.projectiles.list.every((p) => Number.isFinite(p.pos.x + p.pos.y + p.pos.z)), 'projectile states remain finite');
  // damage + destruction
  ac.applyDamage(ac.maxHealth * 0.5, ac.fm.pos, null, world);
  check(ac.health < ac.maxHealth, 'damage applied');
  ac.applyDamage(ac.maxHealth, ac.fm.pos, null, world);
  check(!ac.fm.alive, 'aircraft destroyed when health reaches zero');
}

// ---------------------------------------------------------------------------
console.log('— UI screens —');
{
  const { world, env, settings, camera } = makeWorld();
  const game = new Game({
    world, scene: world.scene, camera, settings, audio: world.audio,
    input: null, hud: new HUD({ width: 10, height: 10, getContext: () => makeCtxStub() }, {}), ui: noopProxy('ui'), terrain: field, env
  });
  game.ui = noopProxy('ui');
  const root = { innerHTML: '', appendChild() {} };
  const toast = { appendChild() {}, children: [], firstChild: null };
  const ui = new UI({ root, toast, settings, audio: world.audio, game, api: {
    startMission() {}, startQuick() {}, resume() {}, restartMission() {}, quitToMenu() {},
    applySettings() {}, inFlight: () => false, currentMissionId: () => 'm01'
  } });
  try {
    ui.showMain(); ui.showAircraft(); ui.showMissions(); ui.showBriefing(MISSIONS[0]);
    ui.showSettings('video'); ui.showSettings('audio'); ui.showSettings('controls'); ui.showSettings('gameplay');
    ui.showStats(); ui.showPause(); ui.showControls(); ui.showLoadout();
    ui.showDebrief({ success: true, grade: 'S', score: 4210, xpGain: 400, reason: null, scores: { air: 1, ground: 2, gates: 3, bonus: 4, time: 5, penalty: -6 }, stats: { fired: 100, hits: 20, missilesFired: 3, groundKills: 1, airKills: 2, damageTaken: 10 }, time: 61, objectives: [{ text: 'X', done: true, optional: false }], unlocked: [], rank: { name: 'CPT' } });
    check(true, 'all menu screens render without throwing');
  } catch (e) {
    check(false, `UI screen threw: ${e.message}`);
  }
}

console.log(failures === 0 ? '\nALL HEADLESS CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
