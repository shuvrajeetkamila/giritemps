// Game controller: owns the world, aircraft, AI, ground targets, sessions (campaign, arcade, free
// flight), objectives, cameras, HUD state and the render loop.
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { GameRenderer } from '../render/renderer.js';
import { Sky } from '../world/sky.js';
import { Terrain } from '../world/terrain.js';
import { Weather } from '../world/weather.js';
import { Ocean } from '../world/ocean.js';
import { buildProps } from '../world/props.js';
import { SITES, AIRFIELD, FLEET, PLAYER_SPAWN_AIR } from '../world/layout.js';
import { Effects } from '../fx/effects.js';
import { Combat, WEAPON_STATS, angleTo } from '../combat/weapons.js';
import { Unit, enemySpec } from '../entities/unit.js';
import { createGroundTarget, Searchlight } from '../entities/ground-targets.js';
import { Cockpit } from '../entities/cockpit.js';
import { AIPilot, formationSlots } from '../ai/ai.js';
import { AIRCRAFT } from '../physics/aircraft-data.js';
import { stallWarning } from '../physics/flight.js';
import { HUD } from '../ui/hud.js';
import { isDown, wasPressed, pollInput, endInputFrame } from '../core/input.js';
import { loadSettings, getQuality } from '../core/settings.js';
import { MISSIONS, TIME_HOURS, missionById } from './missions.js';
import { loadProfile, saveProfile, addXp, recordMission, recordArcade, isAircraftUnlocked } from './profile.js';

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const EYE = new THREE.Vector3(0, 0.9, -2.5);     // pilot eye point in aircraft axes (nose is -Z)
const WX = ['clear', 'overcast', 'rain'];
const ARCADE_TIMES = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'];
const TARGET_NAMES = { depot: 'Fuel depot', hangar: 'Hangar', sam: 'SAM site', aaa: 'AA gun', radar: 'Radar site', ship: 'Frigate', bunker: 'Bunker', tower: 'Radio tower' };
const WEAPON_NAMES = ['IR MISSILE', 'RADAR MISSILE'];
const MISSILE_KINDS = ['ir', 'radar'];
const clamp = THREE.MathUtils.clamp;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _qYaw = new THREE.Quaternion(), _qPitch = new THREE.Quaternion();

export class Game {
  constructor({ canvas, hudCanvas, audio, emit }) {
    this.canvas = canvas;
    this.audio = audio;
    this.emit = emit || (() => {});
    this.settings = loadSettings();
    this.quality = getQuality();
    this.renderer = new GameRenderer(canvas);
    this.renderer.targetHeight = this.settings.resolution;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87a9d4);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 16 / 9, 0.5, 60000);
    this.camera.layers.enable(1);            // cockpit layer

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3328, 0.6);
    this.scene.add(this.hemi);
    this.sky = new Sky(this.scene, this.camera);
    const mapSize = [512, 1024, 2048, 4096][clamp(this.quality.shadows, 0, 3)] || 1024;
    this.csm = new CSM({
      fade: true, maxFar: 2600, cascades: 3, mode: 'practical', parent: this.scene,
      shadowMapSize: mapSize, lightDirection: new THREE.Vector3(-0.4, -1, -0.5).normalize(),
      camera: this.camera, lightIntensity: 3, lightNear: 1, lightFar: 9000, margin: 100,
    });
    this.terrain = new Terrain(this.scene, this.csm, { detail: this.quality.terrainDetail, drawDistance: this.quality.drawDistance });
    this.ocean = new Ocean(this.scene);
    buildProps(this.scene, this.terrain);
    this.weather = new Weather(this.scene, this.terrain);
    this.fx = new Effects(this.scene, { particleScale: this.quality.particles });
    this.fx.setGroundFn((x, z) => this.terrain.heightAt(x, z));
    this.world = {
      targets: () => this.targetList,
      groundAt: (x, z) => this.terrain.heightAt(x, z),
      damage: (t, amount, source, info) => this.damage(t, amount, source, info),
    };
    this.combat = new Combat(this.scene, this.fx, this.world, this.audio);
    this.cockpit = new Cockpit(this.scene, this.renderer.renderer);
    this.hud = new HUD(hudCanvas);
    this.units = [];
    this.targetList = [];
    this.groundTargets = [];
    this.searchlights = [];
    this.pilots = new Map();
    this.ringMeshes = [];
    this.player = null;
    this.session = null;
    this.mode = 'menu';
    this.paused = false;
    this.view = 'chase';
    this.wIdx = 0;
    this.lockTarget = null;
    this.lockT = 0;
    this.lockState = 'none';
    this.lockProgress = 0;
    this.flapsCmd = 0;
    this.freeLook = false;
    this.freeYaw = 0; this.freePitch = 0;
    this.mdx = 0; this.mdy = 0;
    this.msX = 0; this.msY = 0;
    this.playerInp = { pitch: 0, roll: 0, yaw: 0 };
    this.nvg = false;
    this.time = 0;
    this.uid = 1;
    this.centerText = ''; this.centerT = 0; this.centerColor = '#7dffa1';
    this.hitMarkerT = 0; this.flashRed = 0; this.deathFade = 0;
    this.fogColor = new THREE.Color(0.62, 0.74, 0.9);
    this.camPos = new THREE.Vector3(AIRFIELD.x, 300, AIRFIELD.z);
    this.mirrorTick = 0;
    this.lastMusic = '';
    this.sumQ = 0; this.sumP = 0;
    this.camRoll = 0;

    this.setTime('afternoon');
    this.weather.setType('clear');

    window.addEventListener('mousemove', (e) => {
      if (this.mode === 'flight' && (document.pointerLockElement === this.canvas || this.freeLook)) {
        this.mdx += e.movementX || 0; this.mdy += e.movementY || 0;
      }
    });
    this.applySettings();
  }

  // ---- Setup ----------------------------------------------------------------

  applySettings() {
    this.settings = loadSettings();
    this.quality = getQuality();
    this.renderer.targetHeight = this.settings.resolution;
    this.renderer.configure(this.quality, this.scene, this.camera);
    this.renderer.renderer.shadowMap.enabled = this.quality.shadows > 0;
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.renderer.width || 1280, this.renderer.height || 720);
    this.fx.particleScale = this.quality.particles;
    this.hemi.intensity = 0.6;
    this.showFps = !!this.settings.showFps;
    this.postUniforms = true;
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  setTime(name) {
    const hours = TIME_HOURS[name] ?? 12;
    this.fogColor.copy(this.sky.setTimeOfDay(hours));
    this.timeName = name;
  }

  // Build terrain near a point before showing gameplay (chunks are built incrementally).
  warmup(pos) {
    for (let i = 0; i < 24; i++) this.terrain.update(pos, 80);
  }

  // ---- Session lifecycle ----------------------------------------------------

  resetWorld() {
    for (const u of this.units) { this.audio.removeEngine(u.uid); u.dispose(this.scene); }
    this.units = [];
    for (const t of this.groundTargets) this.scene.remove(t.group);
    this.groundTargets = [];
    for (const l of this.searchlights) this.scene.remove(l.group);
    this.searchlights = [];
    for (const r of this.ringMeshes) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    this.ringMeshes = [];
    this.pilots.clear();
    this.combat.clear();
    this.player = null;
    this.lockTarget = null; this.lockState = 'none'; this.lockProgress = 0;
    this.audio.setLock(0, false);
    this.targetList = [];
  }

  groundAt(x, z) { return this.terrain.heightAt(x, z); }

  // Spawn a unit with its AI pilot.
  spawnUnit({ spec, team, name, tag, pos, heading, speed, colors, isPlayer = false, loadout = {}, pilot = null }) {
    const u = new Unit({
      spec, team, name, pos, heading, speed, colors, renderer: this.renderer.renderer,
      scene: this.scene, isPlayer, layer: 0, loadout,
    });
    u.uid = this.uid++;
    u.tag = tag || team;
    this.units.push(u);
    if (pilot) this.pilots.set(u, new AIPilot(u, pilot));
    return u;
  }

  spawnPlayer(aircraftId, livery, mission) {
    const spec = AIRCRAFT[aircraftId] || AIRCRAFT.f16;
    const colors = this.liveryColors(spec, livery);
    const sp = this.session.spawn;
    const g = this.groundAt(sp.pos.x, sp.pos.z);
    const pos = sp.pos.clone();
    pos.y = sp.grounded ? g + 1.0 : Math.max(pos.y, g + 150);
    this.player = this.spawnUnit({
      spec, team: 'player', name: 'Player', tag: 'player', pos, heading: sp.heading,
      speed: sp.grounded ? 0 : sp.speed, colors, isPlayer: true,
      loadout: {},
    });
    this.player.fm.gear = 1;
    this.player.fm.throttle = sp.grounded ? 0.0 : 0.75;
    this.player.fm.fuel = spec.fuel;
    this.player.lightsOn = true;
    this.player.spec = spec;
    this.player.afterburner = false;
    this.cockpit.setActive(false);
    this.view = this.view === 'cockpit' ? 'cockpit' : 'chase';
    void mission;
  }

  liveryColors(spec, liveryId) {
    const list = spec.liveries || [];
    const lv = list.find((l) => l.id === liveryId) || list[0] || { body: 0x6e7a83, accent: 0xffffff };
    return { body: lv.body, accent: lv.accent };
  }

  // Start a session: 'campaign' (with missionId), 'arcade', or 'free'.
  start(cfg) {
    this.resetWorld();
    const mode = cfg.mode;
    const mission = mode === 'campaign' ? missionById(cfg.missionId) : null;
    const aircraft = cfg.aircraft || (mission && mission.aircraft) || 'f16';
    const livery = cfg.livery;
    let weather = (mission && mission.weather) || cfg.weather || 'clear';
    let time = (mission && mission.time) || cfg.time || 'afternoon';
    if (mode === 'arcade' && !cfg.weather) weather = WX[Math.floor(Math.random() * WX.length)];
    if (mode === 'arcade' && !cfg.time) time = ARCADE_TIMES[Math.floor(Math.random() * ARCADE_TIMES.length)];
    this.setTime(time);
    this.weather.setType(weather);
    this.weatherName = weather;

    // Spawn point: campaign missions decide grounded/airborne.
    const grounded = mode !== 'arcade' && mode !== 'free' && mission && !mission.spawnAir;
    const sx = grounded ? AIRFIELD.spawn.x : (mission && mission.startPos ? mission.startPos[0] : PLAYER_SPAWN_AIR.x);
    const sz = grounded ? AIRFIELD.spawn.z : (mission && mission.startPos ? mission.startPos[2] : PLAYER_SPAWN_AIR.z);
    let sy = grounded ? 0 : (mission && mission.startPos ? mission.startPos[1] : (mode === 'free' ? 500 : PLAYER_SPAWN_AIR.y));
    const heading = grounded ? AIRFIELD.spawn.heading : (mission && mission.startHeading !== undefined ? mission.startHeading : 0);
    const spec = AIRCRAFT[aircraft] || AIRCRAFT.f16;
    this.session = {
      mode, mission, missionId: mission ? mission.id : null, aircraft, livery,
      elapsed: 0, sinceWave: 0, nextWave: 0, objIdx: 0, objT: 0, wpIdx: 0, ringIdx: 0,
      kills: { air: 0, ground: 0 }, killsByTag: {}, score: 0, distance: 0,
      arcadeWave: 0, arcadeBreak: 0, arcadeWaveAt: 0,
      over: false, endT: -1, failReason: '', success: false, objectivesDone: 0,
      spawn: { pos: new THREE.Vector3(sx, sy, sz), heading, grounded, speed: spec.stallV ? spec.stallV * 1.6 : 180 },
      ringsPassed: 0, loops: 0, rolls: 0, waveCount: 0, transportsSpawned: 0,
      weather, time, nextObjective: null,
    };
    if (mission && mission.spawnAir === false) this.session.spawn.grounded = true;
    this.spawnPlayer(aircraft, livery, mission);
    this.cockpit.setActive(this.view === 'cockpit');
    this.warmup(this.player.pos);

    if (mission) this.setupCampaign(mission);
    else if (mode === 'arcade') this.arcadeNextWave(true);
    else if (mode === 'free') this.setupFree();

    this.mode = 'flight';
    this.paused = false;
    this.session.objectiveText = '';
    this.lastMusic = '';
    this.say(mission ? mission.name : mode === 'arcade' ? 'ARCADE' : 'FREE FLIGHT', '#ffcf5a', 3);
    this.emit('started', { mode, mission: mission ? mission.id : null });
  }

  // Leave flight mode and return to the menu background.
  abort() {
    this.resetWorld();
    this.session = null;
    this.mode = 'menu';
    this.paused = false;
    this.cockpit.setActive(false);
  }

  resume() { this.paused = false; }
  pause() { if (this.mode === 'flight' && this.session && !this.session.over) { this.paused = true; this.emit('pause'); } }

  setupCampaign(mission) {
    const s = this.session;
    // Ground targets.
    for (const cfg of mission.targets || []) {
      if (cfg.type === 'ship') continue;
      const site = SITES[cfg.site];
      const x = site ? site.x : (cfg.x || 0), z = site ? site.z : (cfg.z || 0);
      const t = createGroundTarget(this.scene, {
        id: cfg.id, type: cfg.type, name: TARGET_NAMES[cfg.type] || cfg.type, x, z,
        y: this.groundAt(x, z), isObjective: !!cfg.objective, hp: cfg.hp || 300, team: 'enemy',
      });
      t.tag = cfg.id;
      this.groundTargets.push(t);
    }
    // Ships in the fleet, orbiting the fleet centre.
    if (mission.fleet) {
      const c = new THREE.Vector3(FLEET.x, 0, FLEET.z);
      for (const cfg of mission.targets || []) {
        if (cfg.type !== 'ship') continue;
        const a = cfg.orbitA || 0, r = cfg.orbitR || 300;
        const t = createGroundTarget(this.scene, {
          id: cfg.id, type: 'ship', name: 'Frigate', x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, y: 0,
          hp: cfg.hp || 800, team: 'ally', center: c, orbitR: r, orbitA: a,
        });
        t.tag = cfg.id;
        this.groundTargets.push(t);
      }
    }
    for (const [x, z] of mission.searchlights || []) this.searchlights.push(new Searchlight(this.scene, x, z, this.groundAt(x, z)));
    // Transports.
    if (mission.transports) {
      const route = mission.transports.route.map((p) => new THREE.Vector3(p[0], Math.max(p[1], this.groundAt(p[0], p[2]) + 120), p[2]));
      route[0] = route[0].clone();
      for (let i = 0; i < mission.transports.count; i++) {
        const p = route[0].clone().add(new THREE.Vector3(-i * 80, 0, i * 60));
        p.y = Math.max(mission.transports.alt, this.groundAt(p.x, p.z) + 120);
        const hd = Math.atan2(route[1].x - p.x, -(route[1].z - p.z));
        this.spawnUnit({
          spec: enemySpec('bomber'), team: 'ally', name: 'Transport', tag: 'transport', pos: p, heading: hd,
          speed: mission.transports.cruise, colors: { body: 0xb9c3c9, accent: 0x3b7bd0 }, loadout: { ir: 0, radar: 0, ammo: 0, flares: 0, chaff: 0, rockets: 0, bombs: 0 },
          pilot: { skill: 'rookie', role: 'transport', state: 'ferry', waypoints: route.map((v) => v.clone()), alt: mission.transports.alt, cruise: mission.transports.cruise },
        });
      }
      s.transportsSpawned = mission.transports.count;
    }
    // Objective waypoints as rings.
    this.objectivePoints = [];
    for (const obj of mission.objectives) {
      if (obj.type === 'waypoints') {
        obj.resolved = obj.points.map((p) => new THREE.Vector3(p[0], Math.max(p[1], this.groundAt(p[0], p[2]) + 120), p[2]));
        obj.resolved.forEach((v) => this.addRing(v, 120, 0xffcf5a));
      }
    }
    // Wave 0 spawns on the first mission update; later waves are driven by updateMission.
    void s;
  }

  setupFree() {
    // Practice rings in a chain around the airfield.
    const s = this.session;
    s.freeRings = [];
    let p = this.player.pos.clone();
    let heading = 0;
    for (let i = 0; i < 12; i++) {
      heading += (Math.random() - 0.5) * 1.6;
      const d = 1400 + Math.random() * 1000;
      p = p.clone().add(new THREE.Vector3(Math.sin(heading) * d, 0, -Math.cos(heading) * d));
      p.y = clamp(this.groundAt(p.x, p.z) + 250 + Math.random() * 900, 150, 4000);
      s.freeRings.push(p);
      this.addRing(p, 70, 0x7fe8ff);
    }
    s.ringT = 0;
    s.ringLapStart = 0;
    s.bestLap = Infinity;
  }

  addRing(pos, radius, color) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 4, 8, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false })
    );
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(new THREE.Vector3(0, 0, 1)));
    this.scene.add(mesh);
    const r = { mesh, pos: pos.clone(), radius, passed: false, color };
    this.ringMeshes.push(r);
    return r;
  }

  // ---- Spawning ---------------------------------------------------------------

  // Enemies / allies for a wave definition.
  spawnWaves(index) {
    const w = this.session.mission.waves.find((x) => x.wave === index);
    if (!w) return;
    for (const g of w.spawns) this.spawnGroup(g);
    this.session.waveCount++;
  }

  spawnGroup(g) {
    const s = this.session;
    const center = new THREE.Vector3(...g.center);
    const kindSpec = { fighter: 'mig', drone: 'drone', bomber: 'bomber', boss: 'boss' }[g.kind] || 'mig';
    const names = { fighter: 'Bandit', drone: 'Drone', bomber: 'Bomber', boss: 'VORON' };
    let leader = null;
    const n = g.count;
    const attack = g.target === 'fleet' ? new THREE.Vector3(FLEET.x, 0, FLEET.z) : null;
    const ref = this.player ? this.player.pos : new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(n, 1)) * Math.PI * 2 + Math.random() * 0.6;
      const rr = (g.radius || 300) * (0.4 + Math.random() * 0.6);
      const pos = center.clone();
      if (g.formation && i > 0 && leader) {
        const slot = formationSlots(n - 1)[i - 1];
        pos.copy(leader.pos).add(slot.clone().applyAxisAngle(UP, leader.fm.heading() * Math.PI / 180));
      } else {
        pos.x += Math.cos(ang) * rr; pos.z += Math.sin(ang) * rr;
      }
      pos.y = Math.max(g.alt || center.y, this.groundAt(pos.x, pos.z) + 150);
      const hd = Math.atan2(ref.x - pos.x, -(ref.z - pos.z));
      const spec = enemySpec(kindSpec);
      const isLeader = i === 0 || !g.formation;
      const role = g.kind === 'fighter' ? (isLeader ? 'fighter' : 'wingman') : g.kind;
      const pilot = {
        skill: g.skill || 'rookie', role, state: 'patrol', home: center.clone(), alt: g.alt || 1500,
        leader: g.formation && !isLeader ? leader : null,
        slot: g.formation && !isLeader ? formationSlots(n - 1)[i - 1] : null,
        attackPoint: attack ? attack.clone() : null,
      };
      if (g.kind === 'bomber' && attack) {
        const ship = this.groundTargets.find((t) => t.kind === 'ship' && t.alive);
        if (ship) pilot.attackPoint = ship.pos.clone();
      }
      const u = this.spawnUnit({
        spec, team: 'enemy', name: names[g.kind] || 'Bandit', tag: g.tag, pos, heading: hd,
        speed: spec.cruise || 200, colors: { body: spec.color ?? 0x5a5f66, accent: 0xffffff }, pilot,
      });
      u.skill = g.skill;
      if (g.formation && isLeader) leader = u;
      if (g.kind === 'drone') u.name = 'Drone';
      s.killsByTag[g.tag] = s.killsByTag[g.tag] || 0;
    }
  }

  // Arcade: spawn the next wave ahead of the player.
  arcadeNextWave(first = false) {
    const s = this.session;
    s.arcadeWave++;
    const n = s.arcadeWave;
    const p = this.player.pos;
    const ahead = new THREE.Vector3(Math.sin(this.player.fm.heading() * Math.PI / 180 + (Math.random() - 0.5) * 1.2), 0, -Math.cos(this.player.fm.heading() * Math.PI / 180 + (Math.random() - 0.5) * 1.2));
    const center = p.clone().addScaledVector(ahead, 7000);
    center.y = clamp(p.y + (Math.random() - 0.5) * 800, 600, 6000);
    const tag = `arc${n}`;
    const fighters = Math.min(10, 2 + Math.floor(n * 0.8));
    const skill = n < 3 ? 'rookie' : n < 6 ? 'wingman' : n < 10 ? 'leader' : 'ace';
    this.spawnGroup({ tag, kind: 'fighter', count: fighters, center: center.toArray(), radius: 900, skill, alt: center.y, formation: true });
    if (n % 4 === 3) this.spawnGroup({ tag, kind: 'bomber', count: 1, center: center.toArray(), radius: 300, skill: 'rookie', alt: center.y, target: 'fleet' });
    s.arcadeTag = tag;
    if (!first) this.say(`WAVE ${n}`, '#ffcf5a', 2.5);
    void 0;
  }

  // ---- Damage, kills and destruction -----------------------------------------

  damage(t, amount, source, info = {}) {
    if (!t || !t.alive) return;
    const was = t.alive;
    t.takeDamage(amount, source, info);
    if (t.isPlayer && t.alive) { this.flashRed = 0.45; this.audio.hitPing(clamp(amount / 40, 0.2, 1)); }
    if (source && source.isPlayer && t !== this.player) this.hitMarkerT = 0.25;
    if (was && !t.alive) this.onDestroyed(t, source);
  }

  onDestroyed(t, source) {
    const s = this.session;
    if (t.kind === 'air') {
      t.fireT = 9;
      t.dyingT = 0;
      this.fx.explosion(t.pos.clone(), 1.0);
      this.audio.explosion(t.pos.clone(), 0.9);
    } else {
      const big = t.kind === 'ship' ? 3 : 2.2;
      this.fx.explosion(t.pos.clone().add(new THREE.Vector3(0, 6, 0)), big, { count: 40, debris: 20 });
      this.audio.explosion(t.pos.clone(), 1.6);
    }
    if (source && source.isPlayer && t !== this.player && s) {
      const ground = t.kind !== 'air';
      if (ground) { s.kills.ground++; s.score += 150; } else { s.kills.air++; s.score += 100 + 15 * (s.arcadeWave || 0); }
      s.killsByTag[t.tag] = (s.killsByTag[t.tag] || 0) + 1;
      this.audio.chime('kill');
      this.say(`${ground ? 'DESTROYED' : 'KILL'} ${t.name}`, '#7dffa1', 2);
      this.hud.popup(ground ? `${t.name.toUpperCase()} DESTROYED` : `KILL — ${t.name.toUpperCase()}`, '#7dffa1');
      if (this.player && this.player.stats) this.player.stats.kills++;
    } else if (t.team === 'ally' && t.kind === 'air' && s) {
      this.say('TRANSPORT LOST', '#ff7070', 2.5);
    } else if (t.kind === 'ship' && s) {
      this.say('FRIGATE LOST', '#ff7070', 3);
    }
    if (t.isPlayer && s && !s.over) {
      this.say('AIRCRAFT DESTROYED', '#ff5050', 4);
      s.failReason = 'Your aircraft was destroyed.';
      s.endT = 3.0;
    }
  }

  // ---- Environment helpers --------------------------------------------------

  envFor() {
    return {
      wind: this.windVec || (this.windVec = new THREE.Vector3()),
      turbulence: this.weather.turbulenceAt(),
      groundHeight: (x, z) => this.terrain.heightAt(x, z),
      waterLevel: 0,
    };
  }

  aiCtx(u, dt) {
    const alive = this.units.filter((x) => x.alive && !x.removed && x !== u);
    const hostiles = u.team === 'enemy'
      ? alive.filter((x) => x.team === 'ally' || x.team === 'player')
      : alive.filter((x) => x.team === 'enemy');
    return {
      hostiles,
      allies: alive.filter((x) => x.team === u.team),
      incoming: this.combat.missiles.filter((m) => m.target === u),
      terrain: (x, z) => this.terrain.heightAt(x, z),
      combat: this.combat, fx: this.fx, audio: this.audio,
      dt, time: this.time, player: this.player,
    };
  }

  // ---- Per-frame simulation -------------------------------------------------

  simulate(dt) {
    const s = this.session;
    if (!s || s.over) return;
    s.elapsed += dt;
    this.handlePlayerInput(dt);

    for (const u of this.units) {
      if (u.removed) continue;
      const pilot = this.pilots.get(u);
      if (u.alive) {
        if (pilot) pilot.update(dt, this.aiCtx(u, dt));
        const inp = u.isPlayer ? this.playerInp : (pilot && pilot.inputs) || { pitch: 0, roll: 0, yaw: 0 };
        u.controls = { pitch: inp.pitch, roll: inp.roll, yaw: inp.yaw };
        u.fm.afterburner = !!u.afterburner;
        const before = u.fm.pos.clone();
        u.fm.step(dt, inp, this.envFor());
        if (u.isPlayer) s.distance += u.fm.pos.distanceTo(before);
        if (u.fm.crashed && u.alive) this.damage(u, 9999, null, { kind: 'crash' });
      } else {
        // Wreck: keep ballistic, tumbling until it hits the ground.
        u.dyingT = (u.dyingT || 0) + dt;
        u.fm.throttle = 0;
        u.fm.step(dt, { pitch: -0.3, roll: 0.8, yaw: 0.2 }, this.envFor());
        if (Math.random() < dt * 6) this.fx.smokePuff(u.pos.clone(), new THREE.Vector3(0, 3, 0), 1.1, true, 8);
        if (u.fm.onGround || u.fm.crashed || u.dyingT > 9) {
          this.fx.explosion(u.pos.clone(), 1.6, { count: 30, debris: 16 });
          this.audio.explosion(u.pos.clone(), 1.2);
          u.removed = true;
          this.audio.removeEngine(u.uid);
          u.dispose(this.scene);
          continue;
        }
      }
      u.syncVisual(dt, this.time, 1 - 0.75 * this.sky.night);
      if (u.alive) {
        this.audio.updateEngine(u.uid, {
          pos: u.pos, vel: u.vel, throttle: u.fm.throttle, afterburner: !!u.afterburner,
          abAmount: u.afterburnerAmount, isPlayer: u.isPlayer, alive: u.alive,
        });
      }
    }
    this.units = this.units.filter((u) => !u.removed);
    this.targetList = [...this.units.filter((u) => !u.removed), ...this.groundTargets];
    if (this.player) this.player.controls = this.player.controls || { pitch: 0, roll: 0, yaw: 0 };

    // Ground targets.
    const shipHostiles = this.units.filter((u) => u.alive && u.team === 'enemy');
    const playerSide = this.units.filter((u) => u.alive && (u.team === 'player' || u.team === 'ally'));
    for (const t of this.groundTargets) {
      t.update(dt, {
        player: this.player, combat: this.combat, fx: this.fx, audio: this.audio,
        hostiles: t.team === 'ally' ? shipHostiles : playerSide, onDepotBlast: () => {},
      });
    }
    for (const l of this.searchlights) l.update && l.update(dt);
    this.combat.update(dt);
    this.updateLock(dt);
    this.updateMission(dt);
    this.updateCampaignExtras(dt);
    if (this.mode === 'flight' && this.player && this.session.mode === 'free') this.updateFreeFlight(dt);
    this.musicT = (this.musicT || 0) - dt;
    if (this.musicT <= 0 && this.player) {
      this.musicT = 1;
      const near = this.units.some((u) => u.alive && u.team === 'enemy' && u.pos.distanceTo(this.player.pos) < 6000);
      const st = near ? 'action' : 'calm';
      if (st !== this.lastMusic) { this.lastMusic = st; this.audio.setMusicState(st); }
    }
  }

  handlePlayerInput(dt) {
    const p = this.player;
    if (!p || !p.alive) { this.playerInp = { pitch: 0, roll: 0, yaw: 0 }; return; }
    const st = this.settings;
    const dz = (v) => (Math.abs(v) < st.deadzone ? 0 : (v - Math.sign(v) * st.deadzone) / (1 - st.deadzone));
    let pitch = (isDown('pitchUp') ? 1 : 0) - (isDown('pitchDown') ? 1 : 0);
    let roll = (isDown('rollRight') ? 1 : 0) - (isDown('rollLeft') ? 1 : 0);
    let yaw = (isDown('yawRight') ? 1 : 0) - (isDown('yawLeft') ? 1 : 0);

    // Mouse: deflection accumulates while moving and springs back to centre.
    const locked = document.pointerLockElement === this.canvas;
    const inv = st.invertY ? -1 : 1;
    const sens = 0.0022 * st.mouseSens;
    if (locked) {
      this.msX = clamp(this.msX + this.mdx * sens, -1, 1);
      this.msY = clamp(this.msY - this.mdy * sens * inv, -1, 1);
    }
    const dxAll = this.mdx, dyAll = this.mdy;
    this.mdx = 0; this.mdy = 0;
    const decay = Math.exp(-dt * 2.2);
    this.msX *= decay;
    this.msY *= decay;
    if (st.mouseMode === 'aim') { yaw += this.msX; } else { roll += this.msX; }
    pitch += this.msY;

    // Gamepad sticks.
    const gp = navigator.getGamepads ? Array.from(navigator.getGamepads()).find((g) => g && g.connected) : null;
    if (gp) {
      const a = gp.axes;
      pitch += -dz(a[1] || 0) * st.stickSens;
      roll += dz(a[0] || 0) * st.stickSens;
      yaw += dz(a[2] || 0) * st.stickSens;
      const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (lt > 0.05) p.fm.throttle = clamp(lt, 0, 1);
    }
    pitch = clamp(pitch, -1, 1); roll = clamp(roll, -1, 1); yaw = clamp(yaw, -1, 1);
    this.playerInp = { pitch, roll, yaw };

    // Throttle, afterburner, brake, gear, flaps.
    if (isDown('throttleUp')) p.fm.throttle = clamp(p.fm.throttle + dt * 0.6, 0, 1);
    if (isDown('throttleDown')) p.fm.throttle = clamp(p.fm.throttle - dt * 0.6, 0, 1);
    if (wasPressed('afterburner')) p.afterburner = !p.afterburner;
    if (p.fm.throttle < 0.9) p.afterburner = false;
    p.fm.brake = isDown('brake') ? 1 : 0;
    if (wasPressed('gear')) {
      p.fm.gear = p.fm.gear > 0.5 ? 0 : 1;
      this.audio.gearWhine(p.fm.gear > 0.5);
      this.say(p.fm.gear > 0.5 ? 'GEAR DOWN' : 'GEAR UP', '#ffcf5a', 1.5);
    }
    if (wasPressed('flaps')) this.flapsCmd = this.flapsCmd > 0.5 ? 0 : 1;
    p.fm.flaps += (this.flapsCmd - p.fm.flaps) * Math.min(1, dt * 1.5);

    // Guns.
    p.gunTrigger = isDown('fireGun');
    if (p.gunTrigger && p.ammo > 0) this.combat.fireGun(p, dt);
    this.audio.gunBuzz(p.gunTrigger && p.ammo > 0);

    // Missiles, rockets, bombs, countermeasures.
    if (wasPressed('cycleWeapon')) { this.wIdx = (this.wIdx + 1) % 2; this.say(WEAPON_NAMES[this.wIdx], '#ffcf5a', 1.5); }
    if (wasPressed('fireMissile')) {
      const kind = MISSILE_KINDS[this.wIdx];
      const t = this.lockTarget;
      if (p.missiles[kind] <= 0) this.say('NO MISSILES', '#ff7070', 1.2);
      else if (this.lockState === 'locked' && t && t.alive) {
        p.radarLockTarget = t;
        const m = this.combat.fireMissile(p, t, kind);
        if (m) this.say(kind === 'ir' ? 'FOX 2' : 'FOX 3', '#ffcf5a', 1.2);
        this.session.missilesFired = (this.session.missilesFired || 0) + 1;
      } else this.say('NO LOCK', '#ff7070', 1.0);
    }
    if (wasPressed('fireRocket')) {
      if (p.rockets > 0) { this.combat.fireRocketSalvo(p, 6); this.say('ROCKETS', '#ffcf5a', 1); } else this.say('NO ROCKETS', '#ff7070', 1);
    }
    if (wasPressed('dropBomb')) {
      if (p.bombs > 0) { this.combat.dropBomb(p); this.say('BOMB AWAY', '#ffcf5a', 1); } else this.say('NO BOMBS', '#ff7070', 1);
    }
    if (wasPressed('flare')) { if (p.flares > 0) this.combat.deployFlares(p, 4); }
    if (wasPressed('chaff')) { if (p.chaff > 0) this.combat.deployChaff(p); }

    // Target cycling, camera, night vision, free look.
    if (wasPressed('cycleTarget')) this.cycleTarget();
    if (wasPressed('cameraView')) {
      const order = ['chase', 'cockpit', 'flyby'];
      this.view = order[(order.indexOf(this.view) + 1) % order.length];
      this.cockpit.setActive(this.view === 'cockpit');
      this.say(this.view.toUpperCase() + ' VIEW', '#ffcf5a', 1.2);
    }
    if (wasPressed('nightVision')) this.nvg = !this.nvg;
    this.freeLook = isDown('freeLook');
    if (this.freeLook) {
      this.freeYaw = clamp(this.freeYaw - dxAll * 0.004, -2.6, 2.6);
      this.freePitch = clamp(this.freePitch - dyAll * 0.004, -0.6, 0.6);
    } else {
      this.freeYaw *= Math.exp(-dt * 6); this.freePitch *= Math.exp(-dt * 6);
    }
  }

  // Candidate targets for locking and selection: enemy aircraft and enemy ground targets.
  candidates() {
    const list = [];
    for (const u of this.units) if (u.alive && !u.removed && u.team === 'enemy') list.push(u);
    for (const t of this.groundTargets) if (t.alive && t.team === 'enemy') list.push(t);
    return list;
  }

  cycleTarget() {
    const p = this.player;
    const list = this.candidates().map((t) => ({ t, a: angleTo(p, t.pos) })).sort((a, b) => a.a - b.a);
    if (!list.length) { this.lockTarget = null; this.say('NO TARGETS', '#ff7070', 1); return; }
    const idx = list.findIndex((x) => x.t === this.lockTarget);
    this.lockTarget = list[(idx + 1) % list.length].t;
    this.lockT = 0;
  }

  updateLock(dt) {
    const p = this.player;
    if (!p || !p.alive) { this.lockState = 'none'; this.audio.setLock(0, false); return; }
    if (!this.lockTarget || !this.lockTarget.alive) this.lockTarget = null;
    const kind = MISSILE_KINDS[this.wIdx];
    const cone = kind === 'ir' ? WEAPON_STATS.irCone : WEAPON_STATS.radarCone;
    const range = kind === 'ir' ? WEAPON_STATS.irRange : WEAPON_STATS.radarRange;
    const need = kind === 'ir' ? WEAPON_STATS.irLockTime : WEAPON_STATS.radarLockTime;
    const t = this.lockTarget;
    if (t && t.kind === 'air') {
      const inside = angleTo(p, t.pos) < cone && t.pos.distanceTo(p.pos) < range && p.missiles[kind] > 0;
      const ch = this.combat.chaffCover ? this.combat.chaffCover(t) : false;
      this.lockT = clamp(this.lockT + (inside && !ch ? dt : -dt * 2), 0, need);
    } else this.lockT = Math.max(0, this.lockT - dt * 2);
    this.lockProgress = this.lockT / need;
    this.lockState = this.lockT >= need ? 'locked' : this.lockT > 0.02 ? 'tracking' : 'none';
    this.audio.setLock(this.lockProgress, this.lockState !== 'none');
    // Auto-acquire: when nothing is selected, take the target nearest the boresight.
    if (!this.lockTarget && Math.random() < dt * 2) {
      let best = null, ba = 0.25;
      for (const c of this.candidates()) {
        if (c.kind !== 'air') continue;
        const a = angleTo(p, c.pos);
        if (a < ba) { ba = a; best = c; }
      }
      this.lockTarget = best;
    }
  }

  // Campaign mission progression: waves and objectives.
  updateMission(dt) {
    const s = this.session;
    if (s.mode !== 'campaign' || s.over) { if (s.mode === 'arcade' && !s.over) this.updateArcade(dt); return; }
    const m = s.mission;
    // Waves.
    if (s.nextWave < m.waves.length) {
      s.sinceWave += dt;
      const w = m.waves[s.nextWave];
      let ready = s.nextWave === 0;
      if (!ready) {
        if (w.delay !== undefined) ready = s.sinceWave >= w.delay;
        else {
          const prevTags = m.waves[s.nextWave - 1].spawns.map((g) => g.tag);
          ready = !this.units.some((u) => u.alive && prevTags.includes(u.tag));
        }
      }
      if (ready) { this.spawnWaves(w.wave); s.nextWave++; s.sinceWave = 0; }
    }
    // Objectives.
    if (s.objIdx < m.objectives.length) {
      const obj = m.objectives[s.objIdx];
      s.objT += dt;
      if (this.objectiveDone(obj, dt)) this.completeObjective(obj);
    }
    // Failure conditions.
    if (m.transports && s.transportsSpawned && !this.units.some((u) => u.team === 'ally' && u.tag === 'transport' && u.alive) && s.objIdx < m.objectives.length) {
      return this.finish(false, 'All transports were lost.');
    }
    if (m.fleet && !this.groundTargets.some((t) => t.kind === 'ship' && t.alive)) {
      return this.finish(false, 'The fleet was lost.');
    }
    if (s.objIdx >= m.objectives.length && s.endT < 0) s.endT = 3.5, s.success = true;
  }

  objectiveDone(obj, dt) {
    const p = this.player, s = this.session;
    switch (obj.type) {
      case 'takeoff': return p.fm.pos.y - this.groundAt(p.pos.x, p.pos.z) > 60 && !p.fm.onGround;
      case 'waypoints': {
        const pts = obj.resolved;
        const pt = pts[s.wpIdx];
        if (!pt) return true;
        const ring = this.ringMeshes[s.wpIdx];
        if (p.pos.distanceTo(pt) < obj.radius) {
          if (ring) { ring.mesh.material.color.setHex(0x7dffa1); }
          this.hud.popup('RING ' + (s.wpIdx + 1), '#7dffa1', 1.2);
          s.wpIdx++;
          if (s.wpIdx >= pts.length) return true;
        }
        return false;
      }
      case 'killTag': return (s.killsByTag[obj.tag] || 0) >= obj.count;
      case 'land': return p.fm.onGround && p.fm.airspeed < 25 && p.pos.distanceTo(new THREE.Vector3(AIRFIELD.x, p.pos.y, AIRFIELD.z)) < 1400 && s.objT > 2;
      case 'destroy': {
        const t = this.groundTargets.find((g) => g.id === obj.target);
        return !t || !t.alive;
      }
      case 'survive': {
        const alive = this.units.some((u) => u.team === 'ally' && u.tag === 'transport' && u.alive);
        return alive && s.objT >= obj.seconds;
      }
      case 'shipsAlive': {
        const ships = this.groundTargets.filter((t) => t.kind === 'ship' && t.alive).length;
        const wavesDone = s.nextWave >= s.mission.waves.length;
        const enemies = this.units.some((u) => u.team === 'enemy' && u.alive);
        return ships >= obj.min && wavesDone && !enemies;
      }
      default: return false;
    }
  }

  completeObjective(obj) {
    const s = this.session;
    s.objIdx++;
    s.objT = 0; s.wpIdx = 0;
    s.objectivesDone++;
    this.audio.chime('objective');
    this.say('OBJECTIVE COMPLETE', '#7dffa1', 3);
    this.hud.popup('OBJECTIVE COMPLETE', '#7dffa1', 2.5);
    void obj;
  }

  // Arcade: waves until death. Points for every kill and for staying alive.
  updateArcade(dt) {
    const s = this.session;
    s.score += dt * 2;
    if (s.arcadeBreak > 0) { s.arcadeBreak -= dt; if (s.arcadeBreak <= 0) this.arcadeNextWave(false); return; }
    const remaining = this.units.some((u) => u.alive && u.team === 'enemy' && u.tag === s.arcadeTag);
    if (!remaining) { s.arcadeBreak = 4; this.say(`WAVE ${s.arcadeWave} CLEARED`, '#7dffa1', 3); }
  }

  // Free flight: ring chain, loops and rolls.
  updateFreeFlight(dt) {
    const s = this.session, p = this.player;
    s.ringT += dt;
    const rings = s.freeRings;
    const target = rings[s.ringIdx % rings.length];
    if (target && p.pos.distanceTo(target) < 80) {
      s.ringIdx++;
      s.ringsPassed++;
      const ringMesh = this.ringMeshes[s.ringIdx - 1];
      if (ringMesh) ringMesh.mesh.material.color.setHex(0x7dffa1);
      this.hud.popup(`RING ${s.ringsPassed}  ${s.ringT.toFixed(1)}s`, '#7fe8ff', 1.4);
      s.score += 50;
    }
    this.sumQ += p.fm.Q * dt; this.sumP += p.fm.P * dt;
    if (Math.abs(this.sumQ) > Math.PI * 1.9) { this.sumQ = 0; s.loops++; s.score += 300; this.hud.popup('LOOP +300', '#ffcf5a', 1.8); }
    if (Math.abs(this.sumP) > Math.PI * 1.9) { this.sumP = 0; s.rolls++; s.score += 200; this.hud.popup('BARREL ROLL +200', '#ffcf5a', 1.8); }
    this.sumQ *= Math.exp(-dt * 0.05); this.sumP *= Math.exp(-dt * 0.05);
  }

  updateCampaignExtras(dt) {
    void dt;
    // Night vision aids: searchlights already in scene. Nothing else.
  }

  // Mission end.
  finish(success, reason) {
    const s = this.session;
    if (!s || s.over) return;
    s.over = true;
    s.success = !!success;
    if (reason) s.failReason = reason;
    const p = this.player;
    const hpFrac = p && p.stats ? clamp(p.hp / p.hpMax, 0, 1) : 0;
    const acc = p && p.stats && p.stats.shots > 0 ? p.stats.hits / p.stats.shots : 0;
    const par = s.mission ? s.mission.par : 420;
    const timeScore = clamp(par / Math.max(s.elapsed, 1), 0, 1);
    const rating = hpFrac * 40 + timeScore * 30 + (p && p.stats && p.stats.shots > 0 ? acc : 0.5) * 30;
    let grade = 'D';
    if (rating >= 90) grade = 'S'; else if (rating >= 78) grade = 'A'; else if (rating >= 65) grade = 'B'; else if (rating >= 50) grade = 'C';
    if (!success) grade = 'F';
    const result = {
      mode: s.mode, title: s.mission ? s.mission.name : s.mode === 'arcade' ? 'Arcade' : 'Free flight',
      missionId: s.missionId, success: !!success, grade, reason: s.failReason,
      time: s.elapsed, kills: { ...s.kills }, score: Math.round(s.score), accuracy: Math.round(acc * 100),
      hpLeft: Math.round(hpFrac * 100), missilesFired: s.missilesFired || 0, rating: Math.round(rating),
      wave: s.arcadeWave, loops: s.loops, rolls: s.rolls, rings: s.ringsPassed,
    };
    // Profile and XP.
    const prof = loadProfile();
    prof.flightTime += s.elapsed;
    prof.distance += s.distance;
    prof.kills.air += s.kills.air; prof.kills.ground += s.kills.ground;
    if (p && p.stats) { prof.shots += p.stats.shots; prof.hits += p.stats.hits; }
    saveProfile();
    let xp = 0;
    if (s.mode === 'campaign' && success) {
      recordMission(s.missionId, grade, result.score);
      xp = 300 + ({ S: 200, A: 120, B: 60 }[grade] || 0) + s.kills.air * 100 + s.kills.ground * 60;
      result.unlockedAircraft = ['f22', 'su34', 'p51'].filter((id) => isAircraftUnlocked(id));
    } else if (s.mode === 'campaign') {
      xp = Math.round(s.kills.air * 60 + s.kills.ground * 40);
    } else if (s.mode === 'arcade') {
      recordArcade({ score: result.score, kills: s.kills.air + s.kills.ground, wave: s.arcadeWave, time: Math.round(s.elapsed), acc: result.accuracy, date: new Date().toISOString().slice(0, 10), aircraft: s.aircraft });
      xp = Math.round(result.score / 10);
    } else {
      xp = s.ringsPassed * 20 + s.loops * 40 + s.rolls * 30;
    }
    result.xp = xp;
    result.rank = addXp(xp);
    this.session.result = result;
    this.mode = 'results';
    this.cockpit.setActive(false);
    if (this.player) this.player.root.visible = true;
    this.emit('results', result);
  }

  // ---- Camera ---------------------------------------------------------------

  updateCamera(dt) {
    const p = this.player;
    const cam = this.camera;
    const shake = (this.fx.shake || 0) * (this.settings.shake ?? 1) * 0.25;
    if (this.mode !== 'flight' || !p) {
      // Menu background: slow orbit over the airfield.
      const t = this.time * 0.04;
      const cx = AIRFIELD.x, cz = AIRFIELD.z;
      const g = this.groundAt(cx, cz);
      this.camPos.set(cx + Math.cos(t) * 1100, g + 320, cz + Math.sin(t) * 1100);
      cam.position.copy(this.camPos);
      cam.lookAt(cx, g + 40, cz);
      cam.fov = this.settings.fov; cam.updateProjectionMatrix();
      return;
    }
    const q = p.quat;
    const fwd = p.fm.forward(_v).clone();
    const speed = p.fm.airspeed;
    const fovT = this.settings.fov + clamp((speed - 150) / 200, 0, 1) * 8;
    if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov += (fovT - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }

    if (this.view === 'cockpit') {
      _q.copy(q);
      _qYaw.setFromAxisAngle(UP, this.freeYaw);
      _q.multiply(_qYaw);
      const eye = _w.copy(EYE).applyQuaternion(q).add(p.pos);
      this.camPos.copy(eye);
      cam.position.copy(eye);
      cam.quaternion.copy(_q);
      this.cockpit.place(eye, q, ZERO);
      this.cockpit.setControls(this.playerInp, p.fm.throttle);
    } else if (this.view === 'flyby') {
      const a = this.time * 0.2;
      const pos = p.pos.clone().add(new THREE.Vector3(Math.cos(a) * 48, 9, Math.sin(a) * 48));
      this.camPos.lerp(pos, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.camPos);
      cam.lookAt(p.pos.clone().addScaledVector(fwd, 15));
    } else {
      // Chase camera behind and above; lags slightly with speed.
      _qYaw.setFromAxisAngle(UP, this.freeYaw);
      _qPitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.freePitch * 0);
      _q.copy(q).multiply(_qYaw);
      const off = _w.set(0, 3.2 + this.freePitch * 2, 15 + clamp(speed / 60, 0, 6)).applyQuaternion(_q);
      const desired = p.pos.clone().add(off);
      this.camPos.lerp(desired, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.camPos);
      cam.lookAt(p.pos.clone().addScaledVector(fwd, 40));
    }
    if (shake > 0) cam.position.add(_v.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(shake));
  }

  // ---- HUD ------------------------------------------------------------------

  project(v) {
    _v.copy(v).project(this.camera);
    const w = this.hud.w, h = this.hud.h;
    const x = (_v.x + 1) / 2 * w, y = (1 - _v.y) / 2 * h;
    const vis = _v.z < 1 && x > -40 && x < w + 40 && y > -40 && y < h + 40;
    return { x, y, visible: vis };
  }

  buildHudState() {
    const p = this.player;
    const s = this.session;
    const st = { hudVisible: this.mode === 'flight' && this.view !== 'flyby' };
    st.cockpit = this.view === 'cockpit';
    if (!p || !s) return st;
    const fm = p.fm;
    const ground = this.groundAt(p.pos.x, p.pos.z);
    const h = this.hud.h;
    Object.assign(st, {
      airspeedKts: fm.airspeed * 1.944, altFt: p.pos.y * 3.281, radarAlt: p.pos.y - ground,
      headingDeg: fm.heading(), pitchDeg: fm.pitchDeg(), rollDeg: fm.rollDeg(), mach: fm.mach, gLoad: fm.load,
      throttle: fm.throttle, afterburner: p.afterburner, fuelPct: fm.fuel, gearDown: fm.gear > 0.5,
      flaps: fm.flaps, brake: fm.brake, weaponName: WEAPON_NAMES[this.wIdx],
      ammo: p.ammo, missiles: p.missiles[MISSILE_KINDS[this.wIdx]], rockets: p.rockets, bombs: p.bombs, flares: p.flares, chaff: p.chaff,
      lockState: this.lockState, lockProgress: this.lockProgress, damage: p.damage, nightVision: this.nvg,
      showFps: this.showFps, fps: this.fps || 0, rain: this.weather.cur ? this.weather.cur.rain : 0,
      frost: this.view === 'cockpit' ? clamp((p.pos.y - 8000) / 6000, 0, 0.6) : 0,
      radarRange: 15000, stallWarn: stallWarning(fm), lowFuel: fm.fuel < 15,
      pullUp: !fm.onGround && p.pos.y - ground < 120 && fm.vel.y < -25,
      gRedout: fm.load > 7.5,
    });
    // Velocity marker and gun lead indicator.
    if (fm.airspeed > 10) {
      const vm = this.project(_w.copy(p.pos).addScaledVector(p.vel.clone().normalize(), 1500));
      st.velMarker = vm;
    }
    // Target.
    const t = this.lockTarget;
    if (t && t.alive) {
      const dist = t.pos.distanceTo(p.pos);
      const tgt = { name: t.name, dist, kind: t.kind === 'air' ? 'air' : 'ground', screen: this.project(t.pos) };
      if (t.hpMax) tgt.hpFrac = t.hp / t.hpMax;
      st.target = tgt;
      const tt = dist / WEAPON_STATS.gunSpeed;
      const lp = _v.copy(t.pos).addScaledVector(t.vel || _w.set(0, 0, 0), tt);
      st.lead = this.project(lp);
    }
    st.lockState = this.lockState;
    // Radar contacts relative to the aircraft, heading-up.
    const hd = fm.heading() * Math.PI / 180;
    const rx = Math.cos(hd), rz = Math.sin(hd), fx2 = Math.sin(hd), fz2 = -Math.cos(hd);
    st.contacts = [];
    for (const u of this.targetList) {
      if (!u.alive || u === p) continue;
      const dx = u.pos.x - p.pos.x, dz = u.pos.z - p.pos.z;
      const right = dx * rx + dz * rz, fwd = dx * fx2 + dz * fz2;
      st.contacts.push({ x: right, z: -fwd, team: u.team, kind: u.kind, locked: u === this.lockTarget });
    }
    // Missile warning.
    let warn = null, best = 5000;
    for (const m of this.combat.missiles) {
      if (!m.alive || m.target !== p || !m.hostile) continue;
      const d = m.pos.distanceTo(p.pos);
      if (d < best) { best = d; warn = m; }
    }
    if (warn) {
      _v.copy(warn.pos).sub(p.pos);
      const right = _v.dot(fm.right(_w));
      const fwd = _v.dot(fm.forward(_w));
      st.missileWarn = { bearing: Math.atan2(right, fwd), dist: best };
      if (!this.missileWarnActive) { this.audio.missileWarning(); }
    }
    this.missileWarnActive = !!warn;
    st.missileWarnFlag = !!warn;
    // Objective text.
    this.fillObjectiveHud(st);
    st.centerText = this.centerT > 0 ? this.centerText : '';
    st.centerTextT = this.centerT;
    st.centerColor = this.centerColor;
    st.velMarkerVis = true;
    st.hitMarker = this.hitMarkerT > 0;
    void h;
    return st;
  }

  fillObjectiveHud(st) {
    const s = this.session, p = this.player;
    if (s.mode === 'campaign' && s.mission) {
      const obj = s.mission.objectives[s.objIdx];
      if (!obj) { st.objective = 'MISSION COMPLETE'; return; }
      st.objective = `${s.mission.name.split(':')[0]} — ${obj.text}`;
      let sub = '';
      if (obj.type === 'killTag') sub = `${Math.min(s.killsByTag[obj.tag] || 0, obj.count)} / ${obj.count}`;
      if (obj.type === 'survive') sub = `${Math.max(0, Math.ceil(obj.seconds - s.objT))} s remaining`;
      if (obj.type === 'waypoints' && obj.resolved && obj.resolved[s.wpIdx]) {
        const d = obj.resolved[s.wpIdx].distanceTo(p.pos);
        sub = `Ring ${s.wpIdx + 1}/${obj.resolved.length} · ${Math.round(d)} m`;
        st.nav = this.project(obj.resolved[s.wpIdx]);
      }
      if (obj.type === 'destroy') {
        const t = this.groundTargets.find((g) => g.id === obj.target);
        if (t) { st.nav = this.project(t.pos); sub = `${Math.round(t.pos.distanceTo(p.pos))} m`; }
      }
      if (obj.type === 'land') { st.nav = this.project(new THREE.Vector3(AIRFIELD.x, this.groundAt(AIRFIELD.x, AIRFIELD.z) + 2, AIRFIELD.z)); }
      st.objectiveSub = sub;
    } else if (s.mode === 'arcade') {
      const left = this.units.filter((u) => u.alive && u.team === 'enemy').length;
      st.objective = `ARCADE — WAVE ${s.arcadeWave}`;
      st.objectiveSub = `${left} hostile · score ${Math.round(s.score)}`;
    } else if (s.mode === 'free') {
      st.objective = `FREE FLIGHT — ring ${s.ringsPassed} · ${s.ringT.toFixed(1)} s`;
      st.objectiveSub = `loops ${s.loops} · rolls ${s.rolls}`;
      const target = s.freeRings[s.ringIdx % s.freeRings.length];
      if (target) st.nav = this.project(target);
    }
  }

  // Sets the centre-screen message.
  say(text, color = '#7dffa1', t = 2.5) {
    this.centerText = text; this.centerColor = color; this.centerT = t;
  }

  // ---- Environment update ----------------------------------------------------

  updateEnvironment(dt) {
    const cam = this.camera;
    this.sky.update(dt, cam.position, this.quality, this.weather);
    const camVel = this.player ? this.player.vel : ZERO;
    this.weather.update(dt, cam.position, camVel, this.time);
    this.ocean.update(dt, cam.position, this.sky.sunDir, this.sky.sunColor, this.fogColor, 0.00004 + 0.00022 * (this.weather.cur ? this.weather.cur.fog : 0), this.fogColor);
    this.terrain.update(cam.position, 3);
    this.csm.lightDirection.copy(this.sky.sunDir).negate();
    this.csm.update();
    const cover = this.weather.cur ? this.weather.cur.cover : 0;
    for (const l of this.csm.lights) {
      l.color.copy(this.sky.sunColor);
      l.intensity = 3 * this.sky.sunIntensity * (1 - 0.45 * cover) + 0.05;
    }
    this.hemi.intensity = 0.22 + 0.55 * (1 - this.sky.night) * (1 - 0.3 * cover);
    this.hemi.color.setRGB(0.75 + 0.2 * (1 - this.sky.night), 0.85, 1.0);
    this.hemi.groundColor.setRGB(0.22 + 0.1 * (1 - this.sky.night), 0.19, 0.15);
    this.audio.setListener(cam.position, camVel);
    this.audio.setWind(this.weather.cur ? this.weather.cur.wind * 60 : 4);
    this.audio.setRain(this.weather.cur ? this.weather.cur.rain : 0);
    if (this.windVec) this.windVec.set(3 * (this.weather.cur ? this.weather.cur.wind : 0.2), 0, 1.5 * (this.weather.cur ? this.weather.cur.wind : 0.2));
    this.fx.update(dt, cam, this.hud.h || 720);
  }

  updatePostFx(dt) {
    const u = this.renderer.final && this.renderer.final.uniforms;
    if (!u) return;
    const set = (k, v) => { if (u[k]) u[k].value = v; };
    const p = this.player;
    const load = p && this.mode === 'flight' ? p.fm.load : 1;
    const speedN = p ? clamp(p.fm.airspeed / 320, 0, 1) : 0;
    const turn = p ? Math.min(1, Math.abs(p.fm.Q) + Math.abs(p.fm.P)) : 0;
    const dead = p && !p.alive ? 1 : 0;
    this.deathFade += (dead - this.deathFade) * Math.min(1, dt * 1.2);
    this.flashRed = Math.max(0, this.flashRed - dt * 1.5);
    set('uTime', this.time);
    set('uVignette', this.settings.vignette ? 1 : 0);
    set('uGrain', this.settings.filmGrain ? 0.6 : 0);
    set('uCA', 0.0015 + 0.002 * speedN + (this.deathFade * 0.004));
    set('uGray', this.deathFade);
    set('uRed', clamp((load - 5.5) / 3, 0, 1) + this.flashRed * 0.4);
    set('uBlack', clamp((load - 8.5) / 2, 0, 1));
    set('uSpeed', speedN);
    set('uMotion', this.settings.motionBlur ? clamp(turn * 0.6 + speedN * 0.25, 0, 1) : 0);
    set('uRays', this.settings.godRays ? this.sky.sunIntensity * (1 - 0.5 * (this.weather.cur ? this.weather.cur.cover : 0)) : 0);
    const sun = this.sky.sunScreenPosition ? this.sky.sunScreenPosition(this.camera) : null;
    if (sun) set('uSunUV', new THREE.Vector2(sun.x, sun.y));
    set('uStorm', this.weather.cur ? this.weather.cur.storm : 0);
    set('uNight', this.nvg ? 1 : this.sky.night);
    set('uCloud', this.weather.cur ? this.weather.cur.cover : 0);
    set('uBright', this.settings.brightness);
    if (u.uTint) u.uTint.value.setRGB(this.nvg ? 0.45 : 1, this.nvg ? 1 : 1, this.nvg ? 0.5 : 1);
  }

  // ---- Frame ----------------------------------------------------------------

  frame(dtRaw, time) {
    const dt = Math.min(dtRaw, 0.05);
    this.time = time ?? this.time + dt;
    this.fps = dtRaw > 0 ? 0.9 * (this.fps || 60) + 0.1 * (1 / dtRaw) : 60;
    pollInput();
    if (this.mode === 'flight' && !this.paused && this.session && !this.session.over) {
      this.simulate(dt);
      if (this.session.endT > 0) {
        this.session.endT -= dt;
        if (this.session.endT <= 0) this.finish(this.session.success, this.session.failReason || '');
      }
    }
    if (this.mode === 'flight' && this.session && !this.session.over && wasPressed('pause') && !this.paused) this.pause();
    if (this.centerT > 0) this.centerT -= dt;
    this.hitMarkerT -= dt;
    this.updateCamera(dt);
    this.updateEnvironment(dt);
    this.updatePostFx(dt);
    const hs = this.mode === 'flight' && this.player ? this.buildHudState() : { hudVisible: false };
    this.hud.draw(hs, dt);
    if (this.mode === 'flight' && this.view === 'cockpit' && this.player) {
      const p = this.player;
      this.cockpit.drawInstruments({
        airspeed: p.fm.airspeed * 1.944, altitude: p.pos.y * 3.281, heading: p.fm.heading(),
        pitch: p.fm.pitchDeg(), roll: p.fm.rollDeg(), throttle: p.fm.throttle,
        fuel: p.fm.fuel, range: 15000, warn: hs.stallWarn ? 'STALL' : hs.pullUp ? 'PULL UP' : '',
        contacts: hs.contacts || [],
      });
    }
    if (this.mode === 'flight' && this.view === 'cockpit' && this.player) {
      this.mirrorTick++;
      if (this.mirrorTick % 2 === 0) {
        const rc = this.cockpit.rearCam;
        rc.position.copy(this.camera.position);
        rc.quaternion.copy(this.camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
        this.player.root.visible = false;
        this.renderer.renderer.setRenderTarget(this.cockpit.mirrorRT);
        this.renderer.renderer.render(this.scene, rc);
        this.renderer.renderer.setRenderTarget(null);
      }
    }
    if (this.player && this.mode === 'flight' && this.view === 'cockpit') this.player.root.visible = false;
    this.renderer.adaptResolution(dtRaw * 1000, this.settings.dynamicRes);
    this.renderer.render(dt, this.time);
    endInputFrame();
  }
}
