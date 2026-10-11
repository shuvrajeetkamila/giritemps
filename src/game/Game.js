// ---------------------------------------------------------------------------
// Game — mode/scenario orchestration: campaign, instant action, free flight,
// objectives, scoring, grades, kill feed, warnings and progression.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Aircraft } from '../aircraft/Aircraft.js';
import { AIPilot, AirGroup, DIFFICULTY } from '../sim/AI.js';
import { GroundTarget, initGroundMaterials } from '../sim/GroundTargets.js';
import { MISSIONS, QUICK_ACTIONS, missionById, gradeFor, rankFor, UNLOCKS, RANKS } from './Missions.js';
import { AIRCRAFT_SPECS } from '../aircraft/AircraftModels.js';
import { RNG, clamp, clamp01, lerp, smoothstep, TAU } from '../core/Utils.js';

const SAVE_KEY = 'aerial-tempest-save-v1';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export const SCORE = {
  airKill: 600,
  groundKill: 1.0,      // × target value
  gate: 180,
  ring: 120,
  survival: 12,         // per second alive in combat
  accuracyBonus: 900,
  damagePenalty: -1.6,
  timeBonus: 8
};

export class Game {
  constructor(ctx) {
    this.world = ctx.world;
    this.scene = ctx.scene;
    this.settings = ctx.settings;
    this.audio = ctx.audio;
    this.input = ctx.input;
    this.hud = ctx.hud;
    this.ui = ctx.ui;
    this.terrain = ctx.terrain;
    this.env = ctx.env;
    this.camera = ctx.camera;
    this.time = 0;
    this.mode = 'menu';
    this.aircraft = [];
    this.groups = [];
    this.targets = [];
    this.gates = [];
    this.rings = [];
    this.mission = null;
    this.quick = null;
    this.player = null;
    this.objectives = [];
    this.score = 0;
    this.scores = { air: 0, ground: 0, gates: 0, time: 0, bonus: 0, penalty: 0 };
    this.stats = { fired: 0, hits: 0, missilesFired: 0, missilesHit: 0, groundKills: 0, airKills: 0, damageTaken: 0, deaths: 0 };
    this.killFeed = [];
    this.radioLog = [];
    this.warnings = [];
    this.elapsed = 0;
    this.paused = false;
    this.debrief = null;
    this.waveIndex = 0;
    this.waveTimer = 0;
    this.endTimer = -1;
    this.grade = null;
    this.respawnTimer = 0;
    this.instantWave = 1;
    this.unlockedToast = [];
    this.lastRadio = { text: '', time: -10 };
    this.bossRef = null;
    this.freeflightRings = [];
    this.ringScore = 0;
    this.ringIndex = 0;
    this.achievements = [];
    // persistent progression
    this.save = this.loadSave();
    this.hudState = this._makeHudState();
    initGroundMaterials(this.world.csmUniforms);
  }

  // -----------------------------------------------------------------------
  loadSave() {
    const base = {
      xp: 0, kills: 0, deaths: 0, groundKills: 0, missions: {}, unlocked: ['viper', 'raptor'],
      loadouts: {}, selectedAircraft: 'viper', liveries: {}, stats: { flights: 0, time: 0, missiles: 0, guns: 0 },
      settings: {}
    };
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(base, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    return base;
  }

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* ignore */ }
  }

  get xp() { return this.save.xp; }
  get rank() { return rankFor(this.save.xp); }

  isUnlocked(id) { return this.save.unlocked.includes(id); }

  checkUnlockRules() {
    const out = [];
    for (const u of UNLOCKS) {
      if (u.type !== 'aircraft') continue;
      if (this.save.unlocked.includes(u.id)) continue;
      if (u.kills !== undefined && this.save.kills >= u.kills) { this.save.unlocked.push(u.id); out.push(u); }
    }
    if (out.length) this.persist();
    return out;
  }

  // -----------------------------------------------------------------------
  _makeHudState() {
    return {
      speed: 0, speedKts: 0, mach: 0, altitude: 0, altitudeFt: 0, agl: 0, verticalSpeed: 0,
      heading: 0, throttle: 0, ab: false, gLoad: 1, aoa: 0, fuel: 1, fuelLbs: 0,
      weapon: null, weapons: [], flares: 0, chaff: 0, gear: false, flaps: 0, airbrake: 0,
      targetLock: 0, lockRange: 0, lockName: '', lockScreen: null, lockVisible: false,
      bandits: [], damaged: 0, blackout: 0, redout: 0, warnings: [],
      missionName: '', objectives: [], score: 0, kills: 0, time: 0, gunHeat: 0,
      stall: 0, pullUp: 0, missileWarn: null, cards: [], flashes: [], chevrons: [],
      radarContacts: [], cannonRounds: 0, gunName: '', speedVector: 0, canopyRain: 0,
      lead: null, bombSight: null, bank: 0, pitch: 0, vspeed: 0, machText: '', playerAlive: true
    };
  }

  // -----------------------------------------------------------------------
  startMission(id, opts = {}) {
    const m = typeof id === 'string' ? missionById(id) : id;
    this.mission = m;
    this.quick = null;
    this._reset();
    if (m.gates) this._makeGates(m);
    this.env.configure({
      weather: m.weather, timeOfDay: m.time, dayLength: m.dayLength || 2400, autoTime: true
    });
    this._spawnPlayer(m.player, opts);
    if (m.ground) this._spawnGroundTargets(m.ground);
    if (m.ships) this._spawnFleet(m.ships);
    this._spawnMissionAircraft(m);
    this._makeObjectives(m);
    this.mode = 'flying';
    this.audio.music.setMode('flight');
    this.missionTitle = m.name;
    this.ui.showToast(`${m.index ? 'MISSION ' + m.index : ''} — ${m.name}`, 'mission');
    this._radio(`[${m.location}] ${m.short} — GOOD HUNTING`);
    return m;
  }

  startQuick(id, opts = {}) {
    const q = QUICK_ACTIONS.find((x) => x.id === id) || QUICK_ACTIONS[0];
    this.quick = q;
    this.mission = null;
    this._reset();
    this.env.configure({ weather: q.weather, timeOfDay: q.time, dayLength: 2400, autoTime: true });
    this._spawnPlayer({ x: 0, y: 1200, z: 0, speed: 240, altitude: 1200 }, opts);
    if (q.id === 'freeflight') {
      this.mode = 'flying';
      this.objectives = [];
      this._makeRings(10, 1400);
      this.audio.music.setMode('flight');
      this.ui.showToast('FREE FLIGHT — NO THREATS', 'mission');
    } else if (q.id === 'aerobatic') {
      this.mode = 'flying';
      this._makeRings(14, 1150);
      this.objectives = [{ id: 'rings', text: `FLY THE COURSE — ${this.rings.length} RINGS`, done: false, progress: 0, count: this.rings.length, required: false }];
      this.audio.music.setMode('flight');
      this.ui.showToast('AEROBATIC COURSE — FLY THROUGH THE RINGS', 'mission');
    } else {
      this.mode = 'flying';
      this.instantWave = 1;
      this.waveTimer = 6;
      this.objectives = [{ id: 'survive', text: 'SURVIVE THE WAVES', done: false, progress: 0, count: 0, required: false }];
      this.audio.music.setMode('flight');
      this.ui.showToast('INSTANT ACTION — BANDITS INBOUND', 'warn');
    }
    return q;
  }

  _reset() {
    for (const a of this.aircraft) {
      if (a.group && a.group.parent) a.group.parent.remove(a.group);
      a.dispose();
    }
    this.aircraft.length = 0;
    this.groups.length = 0;
    for (const t of this.targets) {
      if (t.group && t.group.parent) t.group.parent.remove(t.group);
      if (t.dispose) t.dispose();
    }
    this.targets.length = 0;
    for (const g of [...this.gates, ...this.rings]) {
      if (g.mesh && g.mesh.parent) g.mesh.parent.remove(g.mesh);
      if (g.mesh) { g.mesh.geometry.dispose(); g.mesh.material.dispose(); }
    }
    this.gates.length = 0;
    this.rings.length = 0;
    this.freeflightRings.length = 0;
    this.world.projectiles.reset();
    this.score = 0;
    for (const k of Object.keys(this.scores)) this.scores[k] = 0;
    for (const k of Object.keys(this.stats)) this.stats[k] = 0;
    this.killFeed.length = 0;
    this.radioLog.length = 0;
    this.warnings.length = 0;
    this.elapsed = 0;
    this.endTimer = -1;
    this.grade = null;
    this.debrief = null;
    this.bossRef = null;
    this.ringScore = 0;
    this.ringIndex = 0;
    this.deaths = 0;
    this.respawnTimer = 0;
    this.objectives.length = 0;
    this.world.aircraft = this.aircraft;
    this.world.targets = this.targets;
    this.world.game = this;
  }

  // -----------------------------------------------------------------------
  _spawnPlayer(spawn, opts = {}) {
    const id = opts.aircraftId || this.save.selectedAircraft || 'viper';
    const spec = AIRCRAFT_SPECS[id] || AIRCRAFT_SPECS.viper;
    const liveryIndex = opts.liveryIndex !== undefined ? opts.liveryIndex
      : (this.save.liveries[id] !== undefined ? this.save.liveries[id] : 0);
    const ac = new Aircraft({
      spec: id, livery: spec.liveries[liveryIndex % spec.liveries.length], liveryIndex,
      faction: 'blue', isPlayer: true, world: this.world,
      csmUniforms: this.world.csmUniforms, callsign: 'VIPER 1', seed: 1
    });
    const gy = this.terrain.heightAt(spawn.x, spawn.z);
    ac.fm.reset({
      x: spawn.x, y: Math.max(spawn.y, gy + 120), z: spawn.z,
      speed: spawn.speed || 240, throttle: 0.75, gearDown: false
    });
    ac.reset({
      x: spawn.x, y: Math.max(spawn.y, gy + 120), z: spawn.z,
      speed: spawn.speed || 240, throttle: 0.75, gearDown: false
    });
    this._addAircraft(ac);
    this.player = ac;
    this.world.player = ac;
    this._applyLoadoutPods(ac);
    this.save.stats.flights = (this.save.stats.flights || 0) + 1;
    this.persist();
    return ac;
  }

  _applyLoadoutPods(ac) {
    // special-weapon unlocks add stores
    if (this.save.unlocked.includes('aim9x_plus')) ac.weapons.aim9.count += 2;
    if (this.save.unlocked.includes('decoy_pod')) { ac.flares += 20; ac.chaff += 20; }
    if (this.save.unlocked.includes('bombs_heavy')) ac.weapons.bomb.count += 2;
  }

  _addAircraft(ac) {
    this.aircraft.push(ac);
    this.scene.add(ac.group);
    this.world.aircraft = this.aircraft;
    return ac;
  }

  _spawnGroundTargets(def) {
    const rng = new RNG(9182 + (def.center.x | 0));
    /** find a flat spot near (cx, cz); returns null when the ground is too rough */
    const flatSpot = (cx, cz, radius) => {
      for (let tries = 0; tries < 60; tries++) {
        const a = rng.float(0, TAU), r = Math.sqrt(rng.float(0.04, 1)) * radius;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h > 12 && h < 900 && this.terrain.isFlatGround(x, z, 0.16, 8, 900)) return { x, z };
      }
      return null;
    };
    const spawnAt = (type, x, z, team = 'red') => {
      const g = new GroundTarget({
        type, team, world: this.world, seed: rng.int(1, 99999),
        pos: new THREE.Vector3(x, Math.max(2, this.terrain.heightAt(x, z)), z)
      });
      this.scene.add(g.group);
      this.targets.push(g);
      return g;
    };
    const place = (type, count, radius, team = 'red') => {
      const made = [];
      for (let i = 0; i < count; i++) {
        const spot = flatSpot(def.center.x, def.center.z, radius);
        const x = spot ? spot.x : def.center.x + rng.float(-radius, radius);
        const z = spot ? spot.z : def.center.z + rng.float(-radius, radius);
        made.push(spawnAt(type, x, z, team));
      }
      return made;
    };
    if (def.radar) place('radar', def.radar, def.spread * 0.9);
    if (def.sam) place('sam', def.sam, def.spread * 0.7);
    if (def.aaa) place('aaa', def.aaa, def.spread * 0.8);
    if (def.hangar) place('hangar', def.hangar, def.spread * 0.6);
    const depots = def.depot ? place('depot', def.depot, def.spread * 0.5) : [];
    if (def.fuelTank) {
      // Fuel tanks belong to a depot: park them inside the chain-reaction radius
      // (120 m) so a hit on the depot actually takes the tank farm with it.
      // Without a depot in the mission they just scatter like any other site.
      if (depots.length) {
        for (let i = 0; i < def.fuelTank; i++) {
          const dep = depots[i % depots.length];
          const spot = flatSpot(dep.pos.x, dep.pos.z, 108);
          const x = spot ? spot.x : dep.pos.x + rng.float(-100, 100);
          const z = spot ? spot.z : dep.pos.z + rng.float(-100, 100);
          spawnAt('fuelTank', x, z);
        }
      } else {
        place('fuelTank', def.fuelTank, def.spread * 0.45);
      }
    }
    if (def.command) place('command', def.command, def.spread * 0.3);
    if (def.bridge) place('bridge', def.bridge, def.spread);
    this.world.targets = this.targets;
  }

  _spawnFleet(def) {
    const rng = new RNG(4711);
    for (let i = 0; i < def.count; i++) {
      let x = def.center.x + rng.float(-def.radius, def.radius);
      let z = def.center.z + rng.float(-def.radius, def.radius);
      let tries = 0;
      while (this.terrain.heightAt(x, z) > -40 && tries++ < 40) {
        x = def.center.x + rng.float(-def.radius * 2, def.radius * 2);
        z = def.center.z + rng.float(-def.radius * 2, def.radius * 2);
      }
      const ship = new GroundTarget({
        type: 'ship', team: def.team || 'blue', world: this.world, seed: rng.int(1, 9999),
        pos: new THREE.Vector3(x, 0.5, z)
      });
      ship.fleet = true;
      this.scene.add(ship.group);
      this.targets.push(ship);
    }
    this.fleetTargets = this.targets.filter((t) => t.fleet);
  }

  _spawnMissionAircraft(m) {
    const spawnGroup = (s, delay = 0) => {
      const list = [];
      for (let i = 0; i < s.count; i++) {
        const specId = s.aircraft || 'viper';
        const spec = AIRCRAFT_SPECS[specId];
        const ac = new Aircraft({
          spec: specId, liveryIndex: s.faction === 'red' ? 2 % spec.liveries.length : 0,
          faction: s.faction, world: this.world, csmUniforms: this.world.csmUniforms,
          callsign: (s.faction === 'red' ? 'BANDIT' : 'FALCON') + ' ' + (i + 1),
          seed: 100 + i * 7, skill: s.skill || 0.6
        });
        const a = (i / Math.max(1, s.count)) * TAU;
        const px = (s.patrol ? s.patrol.x : 0) + Math.cos(a) * 300;
        const pz = (s.patrol ? s.patrol.z : 0) + Math.sin(a) * 300;
        const py = (s.patrol && s.patrol.y ? s.patrol.y : 3000) + i * 60;
        const startY = Math.max(py, this.terrain.heightAt(px, pz) + 500);
        ac.reset({ x: px, y: startY, z: pz, speed: s.speed || 260, throttle: 0.8, gearDown: false });
        ac._spawn = { px, pz, startY };
        ac.role = s.role;
        ac.isBoss = s.role === 'boss';
        if (ac.isBoss && m.boss) {
          ac.maxHealth *= m.boss.hp;
          ac.health = ac.maxHealth;
          ac.callsign = m.boss.name;
          this.bossRef = ac;
        }
        if (s.role === 'drone') { ac.maxHealth = 60; ac.health = 60; ac.hitRadius = 4; }
        if (s.role === 'transport') { ac.maxHealth *= 2.2; ac.health = ac.maxHealth; ac.hitRadius = 9; }
        this._addAircraft(ac);
        list.push(ac);
      }
      const group = new AirGroup(list, {
        role: s.role, faction: s.faction, difficulty: s.difficulty || (s.faction === 'red' ? 'rookie' : 'veteran'),
        patrolX: s.patrol ? s.patrol.x : 0, patrolY: s.patrol ? s.patrol.y : 3000, patrolZ: s.patrol ? s.patrol.z : 0,
        homeBase: { x: s.patrol ? s.patrol.x : 0, y: 1200, z: s.patrol ? s.patrol.z : 0 },
        world: this.world, seed: 700 + this.groups.length * 31
      });
      for (const p of group.pilots) {
        if (s.role === 'transport' || s.role === 'drone') { p.role = 'transport'; p.difficulty = DIFFICULTY.rookie; }
        p.homeBase = { x: 12000 * (s.faction === 'red' ? 1 : -1), y: 1500, z: 12000 * (s.faction === 'red' ? 1 : -1) };
      }
      for (const ac of list) {
        if (ac.ai && ac._spawn) ac.ai.patrolPoint.set(ac._spawn.px, ac._spawn.startY, ac._spawn.pz);
      }
      this.groups.push(group);
      return group;
    };
    for (const s of (m.spawns || [])) spawnGroup(s);
    this.missionWaves = (m.waves || []).map((w) => ({ ...w, done: false }));
    // strike aircraft get ground attack orders
    for (const g of this.groups) {
      if (g.role === 'strike') for (const p of g.pilots) p.role = 'strike';
    }
  }

  _makeObjectives(m) {
    const list = [];
    for (const o of m.objectives) {
      list.push({
        id: o.type + '_' + (o.targetType || o.count || list.length),
        text: o.text, type: o.type, targetType: o.targetType, count: o.count || 0,
        progress: 0, done: false, optional: !!o.optional, time: o.time || 0, timer: 0,
        failed: false
      });
    }
    this.objectives = list;
  }

  _makeGates(m) {
    const g = m.gates;
    const rng = new RNG(515);
    const terrain = this.terrain;
    let x = m.player.x, z = m.player.z, y = m.player.y;
    const dir = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < g.count; i++) {
      const a = rng.float(-0.7, 0.7);
      dir.set(Math.sin(a), 0, Math.cos(a)).normalize();
      x += dir.x * g.spacing;
      z += dir.z * g.spacing;
      const ground = terrain.heightAt(x, z);
      if (g.canyon) {
        // hug the terrain: fly down the valley
        y = Math.max(140, ground + 120);
      } else {
        y = Math.max(ground + 220, g.alt || 900);
      }
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(g.radius, g.radius * 0.055, 6, 26),
        new THREE.MeshBasicMaterial({
          color: 0x39d3ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      ring.position.set(x, y, z);
      ring.lookAt(x + dir.x * 100, y, z + dir.z * 100);
      ring.renderOrder = 5;
      this.scene.add(ring);
      const gate = { mesh: ring, pos: new THREE.Vector3(x, y, z), radius: g.radius, passed: false, index: i, dir: dir.clone() };
      ring.userData.gate = gate;
      this.gates.push(gate);
    }
    this.gateBoxes = this.gates;
  }

  _makeRings(count, spacing) {
    const rng = new RNG(818);
    const center = new THREE.Vector3(this.player.fm.pos.x, this.player.fm.pos.y, this.player.fm.pos.z + 900);
    for (let i = 0; i < count; i++) {
      const a = rng.float(-1.1, 1.1);
      const p = new THREE.Vector3(
        center.x + Math.sin(a) * spacing * (i * 0.35 + 1),
        Math.max(this.terrain.heightAt(center.x, center.z) + 250, center.y + rng.float(-260, 380)),
        center.z + spacing * (i + 1) * 0.85
      );
      const radius = 90 + rng.float(0, 40);
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 4.2, 6, 30),
        new THREE.MeshBasicMaterial({
          color: 0xffc247, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      mesh.position.copy(p);
      mesh.rotation.y = rng.float(-0.5, 0.5);
      mesh.renderOrder = 5;
      this.scene.add(mesh);
      this.rings.push({ mesh, pos: p, radius, passed: false, index: i });
    }
  }

  // -----------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.world.time = this.time;
    if (this.paused) return;
    const world = this.world;
    world.listenerPos.copy(this.activeCamera().position);

    // ---- player input
    if (this.player && this.mode === 'flying') this._updatePlayer(dt);

    // ---- AI
    for (const g of this.groups) g.update(dt, world);

    // ---- ground targets
    for (const t of this.targets) t.update(dt, world);

    // ---- gates / rings
    this._updateGates(dt);
    this._updateRings(dt);

    // ---- waves
    if (this.mission && this.missionWaves) this._updateWaves(dt);
    if (this.quick && this.quick.id === 'instant') this._updateInstant(dt);

    // ---- objectives
    this._updateObjectives(dt);

    // ---- scoring / survival
    if (this.mode === 'flying' && this.player && this.player.fm.alive) {
      this.elapsed += dt;
      if (this.inCombat()) this.score += SCORE.survival * dt;
    }

    // ---- warnings + hud state
    this._updateWarnings(dt);
    this._fillHudState(dt);
    if (world.projectiles) {
      this.stats.hits = world.projectiles.stats.hits;
      this.stats.missilesFired = world.projectiles.stats.missilesFired;
    }

    // ---- audio intensity
    if (this.audio && this.audio.music) {
      const enemies = this.aircraft.filter((a) => a.faction === 'red' && a.fm.alive).length;
      const threats = this._incomingMissiles().length;
      const intensity = clamp01(enemies * 0.18 + threats * 0.45 + (this.player && this.player.fm.alive ? 0.1 : 0));
      this.audio.music.setIntensity(intensity);
    }

    // ---- end conditions
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this._finish();
    }
    // resume after death in arcade / free flight
    if (this.quick && this.player && !this.player.fm.alive && this.mode === 'flying') {
      this.respawnTimer += dt;
      if (this.respawnTimer > 4) this._respawnPlayer();
    }
  }

  activeCamera() { return this.world.activeCamera || this.camera; }

  inCombat() {
    for (const a of this.aircraft) {
      if (a.faction === 'red' && a.fm.alive && a.fm.pos.distanceTo(this.player.fm.pos) < 9000) return true;
    }
    return false;
  }

  _updatePlayer(dt) {
    const input = this.input;
    const ac = this.player;
    const cmd = { pitch: input.axes.pitch, roll: input.axes.roll, yaw: input.axes.yaw };

    // throttle
    let thr = ac.fm.throttle;
    thr += input.throttleDelta * dt * 0.55;
    if (input.throttleHard > 0) thr = 1;
    else if (input.throttleHard < 0) thr = 0;
    ac.fm.throttle = clamp(thr, 0, 1);
    ac.fm.afterburner = ac.fm.throttle > 0.92 && input.down('afterburner');

    // weapons
    ac.setGunFiring(input.down('fireGun'));
    if (input.pressed('fireMissile1')) this._playerFireMissile(ac, 'heat');
    if (input.pressed('fireMissile2')) this._playerFireMissile(ac, 'radar');
    if (input.pressed('fireRocket')) { if (ac.fireRocket(this.world)) this.stats.fired++; }
    if (input.pressed('dropBomb')) { if (ac.dropBomb(this.world)) this.stats.fired++; }
    if (input.pressed('flares')) ac.dropFlares(this.world, 2);
    if (input.pressed('chaff')) ac.dropChaff(this.world, 3);
    if (input.pressed('cycleWeapon')) ac.cycleWeapon(1);
    if (input.pressed('gear')) {
      ac.fm.gearDown = !ac.fm.gearDown;
      if (this.audio) this.audio.hydraulics(1.4, ac.fm.gearDown);
    }
    if (input.pressed('flaps')) ac.fm.flaps = ac.fm.flaps > 0.5 ? 0 : 1;
    if (input.pressed('airbrake')) ac.fm.airbrake = ac.fm.airbrake > 0.5 ? 0 : 1;
    if (input.pressed('targetNext')) this._cycleTarget(1);
    if (input.pressed('targetPrev')) this._cycleTarget(-1);
    if (input.pressed('pause')) this.paused = !this.paused;

    const ammoBefore = ac.weapons.gun.ammo;
    ac.update(dt, cmd, this.world);
    const fired = ammoBefore - ac.weapons.gun.ammo;
    if (fired > 0) this.stats.fired += fired;
    this._updateLock(dt);
  }

  _playerFireMissile(ac, kind) {
    const tgt = ac.radarLockTarget || this.selectedTarget;
    if (kind === 'heat') {
      const key = ac.weapons.aim9.count > 0 ? 'aim9' : 'archer';
      if (ac.weapons[key].count > 0) ac.fireMissile(this.world, key, tgt);
      else this.ui.showToast('NO HEAT SEEKERS REMAINING', 'warn');
    } else {
      if (ac.weapons.aim120.count > 0) {
        if (!tgt) this.ui.showToast('NO RADAR LOCK', 'warn');
        else ac.fireMissile(this.world, 'aim120', tgt);
      } else this.ui.showToast('NO RADAR MISSILES REMAINING', 'warn');
    }
  }

  _cycleTarget(dir) {
    const ac = this.player;
    const list = this.aircraft.filter((a) => a.fm.alive && a.faction !== ac.faction);
    if (!list.length) { this.selectedTarget = null; return; }
    list.sort((a, b) => a.fm.pos.distanceTo(ac.fm.pos) - b.fm.pos.distanceTo(ac.fm.pos));
    let idx = list.indexOf(this.selectedTarget);
    idx = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
    this.selectedTarget = list[idx];
    this.audio.beep(1400, 0.05, 0.2, 'sine', 'cockpit');
  }

  /** Radar lock: the selected target must be held in the HUD cone for 2 seconds. */
  _updateLock(dt) {
    const ac = this.player;
    if (!ac || !ac.fm.alive) return;
    if (!this.selectedTarget || !this.selectedTarget.fm.alive) {
      // auto-pick the nearest bandit ahead
      let best = null, bestScore = -1;
      const fwd = _v.set(0, 0, 1).applyQuaternion(ac.fm.quat);
      for (const a of this.aircraft) {
        if (!a.fm.alive || a.faction === ac.faction) continue;
        const to = _v2.copy(a.fm.pos).sub(ac.fm.pos);
        const d = to.length();
        if (d > 16000) continue;
        to.multiplyScalar(1 / d);
        const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
        if (ang > 0.9) continue;
        const score = (1 - ang) * 2 + (1 - d / 16000);
        if (score > bestScore) { bestScore = score; best = a; }
      }
      this.selectedTarget = best;
      ac.lockProgress = 0;
      ac.radarLockTarget = null;
    }
    const tgt = this.selectedTarget;
    if (!tgt) { ac.lockProgress = 0; ac.radarLockTarget = null; return; }
    const to = _v.copy(tgt.fm.pos).sub(ac.fm.pos);
    const dist = to.length();
    to.multiplyScalar(1 / Math.max(1e-3, dist));
    const fwd = _v2.set(0, 0, 1).applyQuaternion(ac.fm.quat);
    const ang = Math.acos(clamp(to.dot(fwd), -1, 1));
    const inCone = ang < 0.42 && dist < 18000;
    const lockRate = inCone ? (1 / 2.0) * (1 - clamp01(ang / 0.9) * 0.35) : -0.6;
    ac.lockProgress = clamp01(ac.lockProgress + lockRate * dt);
    if (ac.lockProgress > 0.33 && !ac.lockTone) { ac.lockTone = true; this.audio.beep(900, 0.05, 0.16, 'square', 'cockpit'); }
    if (ac.lockProgress > 1 && !ac.lockSolid) { ac.lockSolid = true; this.audio.beep(1500, 0.25, 0.3, 'sine', 'cockpit'); this._radio('RIFLE — LOCKED'); }
    if (ac.lockProgress < 0.99 && ac.lockProgress < 0.33) { ac.lockTone = false; ac.lockSolid = false; }
    ac.radarLockTarget = ac.lockProgress >= 1 ? tgt : null;
    ac.lockRange = dist;
    ac.lockTargetName = tgt.callsign || 'BANDIT';
  }

  // -----------------------------------------------------------------------
  _updateGates(dt) {
    if (!this.player) return;
    const ac = this.player.fm;
    for (const g of this.gates) {
      g.mesh.rotation.z += dt * 0.4;
      const d = ac.pos.distanceTo(g.pos);
      const mat = g.mesh.material;
      if (g.passed) { mat.opacity = 0.14; mat.color.setHex(0x2f8f5f); continue; }
      mat.opacity = d < 1200 ? 0.95 : 0.5;
      mat.color.setHex(this.isNextGate(g) ? 0x39d3ff : 0x2f6f9f);
      if (d < g.radius * 1.15) {
        if (this.isNextGate(g)) {
          g.passed = true;
          this.ringScore++;
          this.score += SCORE.gate;
          this.scores.gates += SCORE.gate;
          this.audio.chime(0.3);
          this._radio(`GATE ${this.gatesPassed()}/${this.gates.length} — GOOD`);
          const obj = this.objectives.find((o) => o.type === 'gate');
          if (obj) { obj.progress = this.gatesPassed(); obj.done = obj.progress >= obj.count; }
        } else {
          this.ui.showToast('WRONG GATE — FOLLOW THE MARKED ORDER', 'warn');
        }
      }
    }
  }

  isNextGate(g) { return g.index === this.gatesPassed(); }
  gatesPassed() { return this.gates.filter((x) => x.passed).length; }

  _updateRings(dt) {
    if (!this.player) return;
    const ac = this.player.fm;
    const rings = this.rings;
    for (const r of rings) {
      r.mesh.rotation.z += dt * 0.5;
      const d = ac.pos.distanceTo(r.pos);
      r.mesh.material.opacity = d < 900 ? 0.95 : 0.45;
      if (!r.passed && d < r.radius * 1.1) {
        r.passed = true;
        r.mesh.material.color.setHex(0x4dff9d);
        this.score += SCORE.ring;
        this.scores.gates += SCORE.ring;
        this.ringScore++;
        this.audio.chime(0.25);
        if (r.index === this.ringIndex) this.ringIndex++;
        this.ui.showToast(`RING ${r.index + 1} — ${r.index === this.ringIndex - 1 ? 'CLEAN' : 'OK'}`, 'good');
      }
    }
  }

  _updateWaves(dt) {
    for (const w of this.missionWaves) {
      if (w.done) continue;
      w.timer = (w.timer || 0) + dt;
      const trigger = w.when === 'objective0'
        ? this.objectives[0] && this.objectives[0].done
        : w.when === 'half'
          ? this._airKillFraction() > 0.5
          : w.timer > (w.delay || 0);
      if (trigger) {
        w.done = true;
        this._spawnWave(w.spawns);
        this._radio('NEW CONTACTS — INBOUND NOW');
      }
    }
  }

  _airKillFraction() {
    const total = this.aircraft.filter((a) => a.faction === 'red').length;
    const dead = this.aircraft.filter((a) => a.faction === 'red' && !a.fm.alive).length;
    return total === 0 ? 1 : dead / total;
  }

  _spawnWave(spawns) {
    for (const s of spawns) {
      const spec = AIRCRAFT_SPECS[s.aircraft || 'viper'];
      const list = [];
      const rng = new RNG(1000 + this.aircraft.length * 13);
      for (let i = 0; i < s.count; i++) {
        const ac = new Aircraft({
          spec: s.aircraft || 'viper', liveryIndex: 2 % spec.liveries.length, faction: s.faction || 'red',
          world: this.world, csmUniforms: this.world.csmUniforms,
          callsign: (s.faction === 'blue' ? 'FALCON ' : 'BANDIT ') + (this.aircraft.length + i),
          seed: rng.int(1, 99999)
        });
        const ang = rng.float(0, TAU);
        const px = this.player.fm.pos.x + Math.cos(ang) * 8000;
        const pz = this.player.fm.pos.z + Math.sin(ang) * 8000;
        const py = Math.max(2200, this.terrain.heightAt(px, pz) + 1500);
        ac.reset({ x: px, y: py, z: pz, speed: 300, throttle: 0.85, gearDown: false });
        ac.role = s.role;
        this._addAircraft(ac);
        list.push(ac);
      }
      const g = new AirGroup(list, {
        role: s.role, faction: s.faction || 'red', difficulty: s.difficulty || 'veteran',
        patrolX: this.player.fm.pos.x, patrolY: 3000, patrolZ: this.player.fm.pos.z,
        homeBase: { x: this.player.fm.pos.x + 20000, y: 2000, z: this.player.fm.pos.z + 20000 },
        world: this.world, seed: 4000 + this.groups.length * 17
      });
      if (s.role === 'strike') for (const p of g.pilots) { p.role = 'strike'; p.targetFleet = !!s.targetFleet; }
      this.groups.push(g);
    }
  }

  _updateInstant(dt) {
    const hostiles = this.aircraft.filter((a) => a.faction === 'red' && a.fm.alive);
    const strike = this.aircraft.filter((a) => a.faction === 'red' && a.role === 'strike');
    if (hostiles.length <= (strike.length ? 1 : 0)) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.instantWave++;
        this.waveTimer = 8;
        const wave = this.instantWave;
        const diff = wave < 3 ? 'rookie' : wave < 6 ? 'veteran' : wave < 10 ? 'ace' : 'leader';
        const count = clamp(2 + Math.floor(wave / 2), 2, 6);
        const spawns = [{ role: 'fighter', count, faction: 'red', aircraft: wave > 6 ? 'gryphon' : 'viper', difficulty: diff }];
        if (wave % 3 === 0) spawns.push({ role: 'strike', count: 1, faction: 'red', aircraft: 'fullback', difficulty: diff });
        this._spawnWave(spawns);
        this.ui.showToast(`WAVE ${wave} — ${count} BANDITS`, 'warn');
        this._radio(`WAVE ${wave} INBOUND — STAY SHARP`);
        if (this.audio) this.audio.music.setIntensity(clamp01(0.4 + wave * 0.06));
      }
    } else {
      this.waveTimer = Math.max(this.waveTimer, 4);
    }
  }

  _updateObjectives(dt) {
    if (this.mode !== 'flying' || !this.player) return;
    for (const o of this.objectives) {
      switch (o.type) {
        case 'destroy': {
          const n = this.aircraft.filter((a) => !a.fm.alive && a.faction === 'red' && (a.role === o.targetType || (o.targetType === 'fighter' && ['fighter', 'escort', 'interceptor'].includes(a.role)))).length;
          o.progress = clamp(n, 0, o.count);
          o.done = o.progress >= o.count;
          break;
        }
        case 'destroyGround': {
          const n = this.targets.filter((t) => t.dead && (t.type === o.targetType || (o.targetType === 'depot' && t.type === 'fuelTank'))).length;
          o.progress = clamp(n, 0, o.count);
          o.done = o.progress >= o.count;
          break;
        }
        case 'survive': {
          o.timer += dt;
          o.progress = Math.min(o.timer, o.time);
          o.done = o.timer >= o.time;
          break;
        }
        case 'protect': {
          const fleet = this.fleetTargets || this.targets.filter((t) => t.fleet);
          const alive = fleet.filter((t) => !t.dead).length;
          o.progress = alive;
          if (alive === 0) { o.done = false; o.failed = true; this._fail('THE TASK FORCE WAS SUNK'); }
          else o.done = true;
          break;
        }
        case 'land': {
          const fm = this.player.fm;
          if (fm.alive && fm.onGround && fm.speed < 12) { o.done = true; o.progress = 1; }
          break;
        }
        case 'gate': break; // updated in _updateGates
      }
    }
    if (this.mode !== 'flying') return;
    const required = this.objectives.filter((o) => !o.optional);
    const allDone = required.length > 0 && required.every((o) => o.done);
    if (allDone && this.endTimer < 0) {
      const delay = this.missionsCompleting ? 4 : 4;
      this.endTimer = delay;
      this._radio('ALL OBJECTIVES COMPLETE — GOOD WORK. RTB.');
      this.audio.music.fanfare();
    }
    // optional objectives can also end the mission once required ones are done
  }

  _fail(reason) {
    if (this.endTimer > 0) return;
    this.endTimer = 3;
    this.failed = true;
    this.failReason = reason;
    this._radio(reason);
  }

  _updateWarnings(dt) {
    const w = [];
    const ac = this.player;
    if (!ac) { this.warnings = w; return; }
    const fm = ac.fm;
    if (!fm.alive) {
      w.push({ id: 'dead', text: fm.crashCause === 'water' ? 'SPLASH' : 'EJECTION COMPLETE', level: 2 });
    } else {
      if (fm.stalled) w.push({ id: 'stall', text: 'STALL', level: 2 });
      const agl = fm.pos.y - this.terrain.heightAt(fm.pos.x, fm.pos.z);
      const fwd = _v.set(0, 0, 1).applyQuaternion(fm.quat);
      if (agl < 400 && fm.vel.y < -8 && fwd.y < 0.05) w.push({ id: 'pullup', text: 'PULL UP', level: 2 });
      const inc = ac.incomingMissile(this.world);
      if (inc) {
        const dir = _v.copy(inc.missile.pos).sub(fm.pos).normalize();
        const right = _v2.set(1, 0, 0).applyQuaternion(fm.quat);
        const up = _v3.set(0, 1, 0).applyQuaternion(fm.quat);
        const bearing = Math.atan2(dir.dot(right), dir.dot(up)) * 180 / Math.PI;
        w.push({ id: 'missile', text: `MISSILE INCOMING — ${Math.round(inc.distance)} m`, level: 3, bearing, distance: inc.distance });
      }
      if (fm.fuelPercent < 0.15) w.push({ id: 'fuel', text: `LOW FUEL — ${Math.round(fm.fuelPercent * 100)}%`, level: 1 });
      if (fm.fuelPercent <= 0.001) w.push({ id: 'flameout', text: 'FLAMEOUT', level: 3 });
      if (ac.gunJammed) w.push({ id: 'gunjam', text: 'GUN OVERHEAT', level: 1 });
      if (!fm.gearDown && fm.pos.y - this.terrain.heightAt(fm.pos.x, fm.pos.z) < 200) w.push({ id: 'gear', text: 'GEAR UP', level: 1 });
      if (ac.weapons.gun.ammo === 0) w.push({ id: 'noammo', text: 'GUN EMPTY', level: 1 });
      if (ac.smokeLevel > 0.5) w.push({ id: 'dmg', text: 'AIRCRAFT DAMAGED', level: 1 });
      if (fm.mach > 1.9) w.push({ id: 'over', text: 'OVERSPEED', level: 1 });
    }
    this.warnings = w;
  }

  _incomingMissiles() {
    if (!this.player) return [];
    const out = [];
    for (const p of this.world.projectiles.list) {
      if (p.type !== 'missile' || p.faction === 'blue') continue;
      if (p.target !== this.player) continue;
      out.push(p);
    }
    return out;
  }

  _fillHudState(dt) {
    const s = this.hudState;
    const ac = this.player;
    if (!ac) return;
    const fm = ac.fm;
    s.speed = fm.speed;
    s.speedKts = fm.speed * 1.94384;
    s.mach = fm.mach;
    s.altitude = fm.pos.y;
    s.altitudeFt = fm.pos.y * 3.28084;
    s.agl = fm.pos.y - this.terrain.heightAt(fm.pos.x, fm.pos.z);
    s.verticalSpeed = fm.vel.y;
    s.heading = fm.heading();
    s.throttle = fm.throttle;
    s.ab = fm.afterburner;
    s.gLoad = fm.gLoad;
    s.aoa = fm.aoa * 180 / Math.PI;
    s.fuel = fm.fuelPercent;
    s.fuelLbs = fm.fuel;
    s.gear = fm.gearDown;
    s.flaps = fm.flaps;
    s.airbrake = fm.airbrake;
    s.playerAlive = fm.alive;
    s.damaged = 1 - ac.health / ac.maxHealth;
    s.gunHeat = ac.gunHeat;
    s.bank = fm.bodyRoll();
    s.pitch = fm.bodyPitch();
    s.weapon = ac.weapon;
    s.weapons = ac.weaponOrder.map((k) => ({ key: k, ...ac.weapons[k] }));
    s.flares = ac.flares;
    s.chaff = ac.chaff;
    s.cannonRounds = ac.weapons.gun.ammo;
    s.gunName = ac.def.gun.name;
    s.score = Math.round(this.score);
    s.kills = this.stats.airKills;
    s.time = this.elapsed;
    s.missionName = this.mission ? `${this.mission.index}. ${this.mission.name}` : (this.quick ? this.quick.name : '');
    s.objectives = this.objectives;
    s.warnings = this.warnings;
    s.aiAircraft = ac.aiAircraft;
    // lock info
    const lt = ac.radarLockTarget;
    s.targetLock = ac.lockProgress || 0;
    s.lockRange = ac.lockRange || 0;
    s.lockName = ac.lockTargetName || '';
    s.lockVisible = !!(this.selectedTarget && this.selectedTarget.fm.alive);
    s.lockTarget = this.selectedTarget || null;
    // g effects
    const g = fm.gLoad;
    s.blackout = clamp01((g - 4.6) / 6);
    s.redout = clamp01((-g - 1.4) / 3);
    s.stall = fm.stalled ? fm.stallSeverity : 0;
    // screen positions
    this._projectHudTargets(s);
    this._fillRadar(s);
    // ---- extra presentation state
    s.cameraRef = this.activeCamera();
    s.killFeed = this.killFeed.map((k) => ({ ...k, age: this.time - k.t }));
    const subs = this.radioLog.filter((r) => this.time - r.time < 4.2).map((r) => r.text);
    s.radioMsgs = this.subtitleText ? [this.subtitleText] : subs;
    s.speedLines = clamp01((fm.mach - 0.82) / 0.5) * 0.9 + clamp01((Math.abs(fm.gLoad) - 5) / 4) * 0.4;
    s.canopyRain = this.world.canopyRain || 0;
    s.hudOpacity = this.settings.get('hudOpacity', 1);
    if (this.player.cockpit) s.canopyRain = Math.max(s.canopyRain, this.world.canopyRain || 0);
    // relative altitude for the target boxes
    for (const b of s.bandits) {
      const t = this.aircraft.find((a) => a.callsign === b.name);
      b.relAlt = t ? t.fm.pos.y - fm.pos.y : 0;
    }
    // waypoint bearing
    const wp = this.gates.find((g) => !g.passed);
    if (wp) {
      const dx = wp.pos.x - fm.pos.x, dz = wp.pos.z - fm.pos.z;
      s.waypointBearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    } else {
      const bandit = this.selectedTarget;
      if (bandit) {
        const dx = bandit.fm.pos.x - fm.pos.x, dz = bandit.fm.pos.z - fm.pos.z;
        s.waypointBearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      } else s.waypointBearing = null;
    }
  }

  _projectHudTargets(s) {
    const cam = this.activeCamera();
    const ac = this.player;
    s.bandits.length = 0;
    const list = this.aircraft;
    for (const a of list) {
      if (!a.fm.alive || a === ac) continue;
      const p = _v.copy(a.fm.pos);
      const dist = p.distanceTo(ac.fm.pos);
      if (dist > 20000) continue;
      if (a.faction === ac.faction && !this.showFriendlies) continue;
      _v2.copy(p).project(cam);
      if (_v2.z > 1 || _v2.z < -1) continue;
      const onScreen = Math.abs(_v2.x) < 1.15 && Math.abs(_v2.y) < 1.15;
      s.bandits.push({
        x: _v2.x, y: _v2.y, onScreen, dist,
        hostile: a.faction !== ac.faction,
        locked: a === this.selectedTarget,
        name: a.callsign,
        role: a.role,
        hp: a.health / a.maxHealth,
        lead: a.faction !== ac.faction && dist < 2400 && this.selectedTarget === a ? a.fm.vel : null
      });
    }
    // ground targets of interest
    s.groundBoxes = s.groundBoxes || [];
    s.groundBoxes.length = 0;
    for (const t of this.targets) {
      if (t.dead) continue;
      const dist = t.pos.distanceTo(ac.fm.pos);
      if (dist > 16000) continue;
      _v2.copy(t.pos).project(cam);
      if (_v2.z > 1 || _v2.z < -1) continue;
      s.groundBoxes.push({ x: _v2.x, y: _v2.y, dist, type: t.type, hp: t.healthFrac, label: t.def.name, hostile: t.team !== 'blue' });
    }
  }

  _fillRadar(s) {
    const ac = this.player;
    const range = 20000;
    s.radarContacts.length = 0;
    const headingRad = (ac.fm.heading()) * Math.PI / 180;
    const cos = Math.cos(-headingRad), sin = Math.sin(-headingRad);
    for (const a of this.aircraft) {
      if (!a.fm.alive || a === ac) continue;
      const dx = a.fm.pos.x - ac.fm.pos.x;
      const dz = a.fm.pos.z - ac.fm.pos.z;
      // rotate into nose-up radar space
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      const dist = Math.hypot(rx, rz);
      if (dist > range) continue;
      s.radarContacts.push({
        x: rx / range, y: rz / range, dist, hostile: a.faction !== ac.faction,
        alt: a.fm.pos.y - ac.fm.pos.y, locked: a === ac.radarLockTarget, selected: a === this.selectedTarget
      });
    }
    for (const t of this.targets) {
      if (t.dead) continue;
      const dx = t.pos.x - ac.fm.pos.x, dz = t.pos.z - ac.fm.pos.z;
      const rx = dx * cos - dz * sin, rz = dx * sin + dz * cos;
      const dist = Math.hypot(rx, rz);
      if (dist > range) continue;
      s.radarContacts.push({ x: rx / range, y: rz / range, dist, ground: true, hostile: t.team !== 'blue', alt: t.pos.y - ac.fm.pos.y, size: t.radius });
    }
  }

  // -----------------------------------------------------------------------
  // events from the simulation
  // -----------------------------------------------------------------------
  onAircraftDestroyed(ac, source) {
    const byPlayer = source === this.player || (source && source.owner === this.player);
    if (ac === this.player) {
      this.stats.deaths++;
      this.save.deaths = (this.save.deaths || 0) + 1;
      this.persist();
      this.score += -400;
      this.scores.penalty -= 400;
      this.addKill(null, `${ac.callsign} DOWN`, 'bad');
      if (this.mission) this._fail('AIRCRAFT LOST — MISSION FAILED');
      return;
    }
    this.addKill(ac.callsign, byPlayer ? 'DESTROYED BY VIPER 1' : 'DESTROYED', byPlayer ? 'good' : 'neutral');
    if (byPlayer) {
      this.stats.airKills++;
      this.save.kills = (this.save.kills || 0) + 1;
      const pts = SCORE.airKill * (ac.isBoss ? 6 : (ac.role === 'transport' ? 2 : 1));
      this.score += pts;
      this.scores.air += pts;
      this.ui.showToast(`KILL — ${ac.callsign} (${pts})`, 'good');
      this._radio('SPLASH ONE! GOOD KILL', 1.05);
      const unlocked = this.checkUnlockRules();
      for (const u of unlocked) this.ui.showToast(`UNLOCKED: ${u.name}`, 'unlock');
      if (ac.isBoss) { this.score += 5000; this.scores.bonus += 5000; this._radio('TEMPEST IS DOWN. REPEAT, TEMPEST IS DOWN!'); this.endTimer = 6; }
    }
  }

  onGroundTargetDestroyed(t) {
    const pts = Math.round(t.value * SCORE.groundKill * (t.fleet ? 0 : 1));
    if (t.fleet) {
      // losing a friendly ship is bad
      this.score -= 1200;
      this.scores.penalty -= 1200;
      this.addKill(null, `${t.def.name} LOST`, 'bad');
      this._radio('WE LOST A SHIP! THEY ARE THROUGH!');
      return;
    }
    this.stats.groundKills++;
    this.save.groundKills = (this.save.groundKills || 0) + 1;
    this.score += pts;
    this.scores.ground += pts;
    this.addKill(t.def.name, `${t.label || 'TARGET'} DESTROYED`, 'good');
    this.ui.showToast(`TARGET DESTROYED — ${t.def.name} (${pts})`, 'good');
  }

  onPlayerHit(ac, amount, hpFrac) {
    this.stats.damageTaken += amount;
    this.score += SCORE.damagePenalty * amount;
    this.scores.penalty += SCORE.damagePenalty * amount;
    if (hpFrac < 0.5 && Math.random() < 0.3) this.ui.showToast('HIT — CHECK DAMAGE', 'warn');
  }

  onSamLaunch(sam, target) {
    if (target === this.player) {
      this._radio('SAM LAUNCH! BREAK!');
      this.audio.beep(1800, 0.2, 0.3, 'square', 'cockpit');
    }
  }

  onWeaponFired(ac, type) {
    if (ac === this.player) this.stats.missilesFired++;
  }

  addKill(who, what, kind) {
    this.killFeed.unshift({ who, what, kind, t: this.time });
    if (this.killFeed.length > 6) this.killFeed.pop();
  }

  _radio(text, pitch = 1) {
    if (!text) return;
    if (this.time - this.lastRadio.time < 1.2 && text === this.lastRadio.text) return;
    this.lastRadio = { text, time: this.time };
    this.radioLog.unshift({ text, time: this.time });
    if (this.radioLog.length > 5) this.radioLog.pop();
    if (this.audio) this.audio.radio(text, { pitch, speaker: 'VIPER 1' });
  }

  _respawnPlayer() {
    const ac = this.player;
    const pos = ac.fm.pos.clone();
    pos.y = Math.max(pos.y + 800, this.terrain.heightAt(pos.x, pos.z) + 900);
    ac.reset({ x: pos.x, y: pos.y, z: pos.z, speed: 280, throttle: 0.8, gearDown: false });
    ac.fm.alive = true;
    ac.dead = false;
    this.respawnTimer = 0;
    this.ui.showToast('RESPAWNING — GOOD LUCK', 'mission');
  }

  // -----------------------------------------------------------------------
  endNow(success) {
    if (this.endTimer > 0) return;
    this.endTimer = 0.1;
    this.failed = !success;
  }

  _finish() {
    this.mode = 'debrief';
    const required = this.objectives.filter((o) => !o.optional);
    const success = !this.failed && (required.length === 0 || required.every((o) => o.done));
    // ---- score adjustments
    const acc = this.stats.fired > 0 ? clamp01(this.stats.hits / Math.max(1, this.stats.fired)) : 0.2;
    if (success) {
      this.score += Math.round(acc * SCORE.accuracyBonus);
      this.scores.bonus += Math.round(acc * SCORE.accuracyBonus);
      if (this.mission) {
        const t = Math.max(0, 300 - this.elapsed);
        this.score += Math.round(t * SCORE.timeBonus);
        this.scores.time += Math.round(t * SCORE.timeBonus);
      }
    }
    this.score = Math.max(0, Math.round(this.score));
    const grade = success ? gradeFor(this.score) : 'D';
    this.grade = grade;
    const xpGain = Math.round((this.mission ? this.mission.reward.xp : 500) * (success ? { S: 1.5, A: 1.3, B: 1.15, C: 1.0, D: 0.8 }[grade] : 0.25));
    this.save.xp += xpGain;
    this.save.stats.time = (this.save.stats.time || 0) + this.elapsed;
    let unlocked = [];
    if (success && this.mission) {
      const prev = this.save.missions[this.mission.id];
      this.save.missions[this.mission.id] = {
        grade: !prev || this.gradeValue(grade) > this.gradeValue(prev.grade) ? grade : prev.grade,
        score: Math.max(prev ? prev.score : 0, this.score),
        attempts: (prev ? prev.attempts : 0) + 1
      };
      const u = UNLOCKS.find((x) => x.after === this.mission.id);
      if (u && !this.save.unlocked.includes(u.id)) { this.save.unlocked.push(u.id); unlocked.push(u); }
    }
    unlocked = unlocked.concat(this.checkUnlockRules());
    this.persist();
    this.debrief = {
      success, grade, score: this.score, xpGain, unlocked,
      scores: { ...this.scores }, stats: { ...this.stats },
      time: this.elapsed, objectives: this.objectives.map((o) => ({ text: o.text, done: o.done, optional: o.optional })),
      reason: this.failReason || null,
      rank: this.rank, nextRank: RANKS.find((r) => r.xp > this.save.xp) || null
    };
    this.audio.music.setMode('menu');
    if (success) this.audio.music.fanfare();
    if (this.ui) this.ui.showDebrief(this.debrief);
  }

  gradeValue(g) { return { S: 4, A: 3, B: 2, C: 1, D: 0 }[g] || 0; }

  pause(on) {
    this.paused = on === undefined ? !this.paused : on;
    if (this.audio) { if (this.paused) this.audio.suspend?.(); }
    return this.paused;
  }

  quitToMenu() {
    this.mode = 'menu';
    this._reset();
    this.audio.music.setMode('menu');
  }

  dispose() {
    this._reset();
  }
}
