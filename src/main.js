// ---------------------------------------------------------------------------
// AERIAL TEMPEST — bootstrap: renderer, world, cameras, game loop, UI glue.
// Everything you see is generated at runtime; there are no art assets.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

import { Settings } from './core/Settings.js';
import { Input } from './core/Input.js';
import { AudioEngine, Music } from './core/Audio.js';
import { clamp, clamp01, lerp, damp, RNG, TAU } from './core/Utils.js';

import { skyUniforms, fogUniforms, WORLD_LIGHT_UNIFORMS, buildTerrainTextureArray, buildParticleAtlas, injectWorldShading } from './render/Shading.js';
import { CascadedShadows } from './render/CascadedShadows.js';
import { PostFX } from './render/PostFX.js';
import { ParticleSystem } from './render/Particles.js';

import { TerrainField, TerrainRenderer } from './world/Terrain.js';
import { Sky } from './world/Sky.js';
import { CloudField } from './world/Clouds.js';
import { Ocean } from './world/Water.js';
import { Environment } from './world/Environment.js';
import { WeatherSystem } from './world/Weather.js';
import { Scenery } from './world/Scenery.js';

import { ProjectileSystem } from './sim/Weapons.js';
import { Game } from './game/Game.js';
import { HUD } from './ui/HUD.js';
import { UI } from './ui/UI.js';
import { buildCockpit, updateCockpit } from './ui/Cockpit.js';

const loadingScreen = document.getElementById('loading-screen');
const loadFill = document.getElementById('load-fill');
const loadStatus = document.getElementById('load-status');
const gameCanvas = document.getElementById('game-canvas');
const hudCanvas = document.getElementById('hud-canvas');
const vfxOverlay = document.getElementById('vfx-overlay');
const uiRoot = document.getElementById('ui-root');
const toastLayer = document.getElementById('toast-layer');

let progress = 0;
function setProgress(p, text) {
  progress = p;
  if (loadFill) loadFill.style.width = `${Math.round(p * 100)}%`;
  if (loadStatus && text) loadStatus.textContent = text;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function fatal(err) {
  console.error(err);
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
    loadingScreen.innerHTML = `<div class="load-inner">
      <div class="load-title" style="color:#ff5a4d">ERROR</div>
      <div class="load-status" style="color:#ffc247;white-space:pre-wrap;max-height:50vh;overflow:auto">${String(err && err.message || err)}</div>
      <div class="load-hint">This game needs a WebGL2-capable browser.</div>
    </div>`;
  }
}

// ===========================================================================
class App {
  constructor() {
    this.settings = new Settings();
    // frame timing: THREE.Clock is deprecated in three 0.186 (and it only wraps
    // performance.now anyway), so keep the two numbers ourselves
    this._timePrev = 0;
    this.cameraMode = 'chase';
    this.cameraIndex = 1;
    this.nightVision = false;
    this.showHelp = false;
    this.fps = 60;
    this.fpsSamples = [];
    this.renderScaleMul = 1;
    this.paused = false;
    this.frameCount = 0;
    this.orbitAngle = 0;
    this.cinematic = true;
    this.cinematicTimer = 0;
    this.camPos = new THREE.Vector3(0, 2000, -400);
    this.camQuat = new THREE.Quaternion();
    this.chasePos = new THREE.Vector3();
    this.chaseTarget = new THREE.Vector3();
    this.shakeSeed = new RNG(9);
    this.shake = new THREE.Vector3();
    this.timeScale = 1;
    this.pendingMission = null;
  }

  async boot() {
    setProgress(0.02, 'CREATING RENDERER');
    await nextFrame();

    // ---- renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: gameCanvas, antialias: false, alpha: false,
      powerPreference: 'high-performance', stencil: false, depth: true
    });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 is required');
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;      // PostFX does the tonemapping
    renderer.shadowMap.enabled = false;              // we run our own CSM
    renderer.autoClear = true;
    renderer.info.autoReset = true;
    this.renderer = renderer;

    // ---- scene + camera
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(this.settings.get('fov', 72), window.innerWidth / window.innerHeight, 0.1, 45000);
    this.scene.add(this.camera);

    // ---- shared resources
    setProgress(0.08, 'GENERATING TERRAIN TEXTURES');
    await nextFrame();
    this.terrainTex = buildTerrainTextureArray(256, 7);
    setProgress(0.14, 'GENERATING PARTICLE ATLAS');
    await nextFrame();
    this.atlas = buildParticleAtlas(512);

    // ---- lighting (the single sun light provides direct light for standard materials)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sunLight.castShadow = false;
    this.scene.add(this.sunLight);
    this.sunLight.position.set(0.3, 1, 0.2).normalize().multiplyScalar(5000);
    this.hemi = new THREE.HemisphereLight(0x88aaff, 0x33291f, 0.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0x9db4cc, 0.000075);

    // ---- shadows
    setProgress(0.2, 'BUILDING SHADOW CASCADES');
    this.shadows = new CascadedShadows(renderer);
    this.csmUniforms = this.shadows.uniforms;

    // ---- terrain
    setProgress(0.28, 'RAISING LAND');
    await nextFrame();
    this.field = new TerrainField(1337);
    this.noiseOk = this.field.verifyNoiseTable();
    this.terrain = new TerrainRenderer(renderer, this.field, {
      textureArray: this.terrainTex,
      csmUniforms: this.csmUniforms,
      createBudget: 3
    });
    this.scene.add(this.terrain.group);

    // ---- sky / clouds / water
    setProgress(0.4, 'PAINTING THE SKY');
    await nextFrame();
    this.sky = new Sky();
    this.clouds = new CloudField({ atlas: this.atlas, seed: 4242, cellSize: 900, gridRadius: 13, maxPuffs: 6500 });
    this.scene.add(this.clouds.mesh);
    this.ocean = new Ocean({ segments: 160 });
    this.scene.add(this.ocean.mesh);
    this.env = new Environment(this.settings);
    this.weather = new WeatherSystem(this.atlas);
    this.scene.add(this.weather.rainMesh);
    this.scene.add(this.weather.snowMesh);

    // ---- scenery
    setProgress(0.52, 'PLANTING FORESTS');
    await nextFrame();
    this.scenery = new Scenery(this.field, { quality: this.settings.get('quality', 2), seed: 5150 });
    this.scene.add(this.scenery.group);
    this.scenery.injectShading(this.csmUniforms);

    // ---- particles + postfx
    setProgress(0.62, 'WARMING UP THE EXPLOSIONS');
    await nextFrame();
    const fogU = fogUniforms();
    this.particles = new ParticleSystem(this.atlas, {
      cameraPos: skyUniforms.cameraPos,
      fogColor: skyUniforms.fogColor,
      fogDensity: skyUniforms.fogDensity
    });
    this.scene.add(this.particles.group);
    this.postfx = new PostFX(renderer);

    // ---- audio
    setProgress(0.7, 'TUNING THE ORCHESTRA');
    await nextFrame();
    this.audio = new AudioEngine(this.settings);
    this.audio.init();
    this.audio.music = new Music(this.audio);
    this.audio.onSubtitle = (msg) => { if (msg && msg.text) this.subtitle = { text: msg.text, t: performance.now() / 1000 }; };

    // ---- game layer
    setProgress(0.78, 'LOADING ORDNANCE');
    await nextFrame();
    this.projectiles = new ProjectileSystem({ maxProjectiles: 1200 });
    this.listenerPos = new THREE.Vector3();
    this.world = {
      scene: this.scene,
      camera: this.camera,
      env: this.env,
      particles: this.particles,
      projectiles: this.projectiles,
      audio: this.audio,
      terrain: this.terrain,
      field: this.field,
      groundHeight: (x, z) => this.field.heightAt(x, z),
      aircraft: [],
      targets: [],
      time: 0,
      listenerPos: this.listenerPos,
      csmUniforms: this.csmUniforms,
      canopyRain: 0,
      cockpitShake: new THREE.Vector3(),
      activeCamera: this.camera,
      frozen: false,
      tempAt: (a) => this.env.tempAt(a)
    };
    // Weather/AI read these off env
    this.envView = {};

    this.hud = new HUD(hudCanvas, { units: this.settings.get('units', 'imperial') });
    this.input = new Input(this.settings, gameCanvas);

    setProgress(0.86, 'BRIEFING THE SQUADRON');
    await nextFrame();
    this.game = new Game({
      world: this.world, scene: this.scene, camera: this.camera,
      settings: this.settings, audio: this.audio, input: this.input,
      hud: this.hud, ui: null, terrain: this.field, env: this.env
    });
    this.ui = new UI({
      root: uiRoot, toast: toastLayer, settings: this.settings, audio: this.audio,
      game: this.game,
      api: {
        startMission: (id) => this.startMission(id),
        startQuick: (id) => this.startQuick(id),
        resume: () => this.resume(),
        restartMission: () => this.restart(),
        quitToMenu: () => this.quitToMenu(),
        applySettings: (key) => this.applySettings(key),
        inFlight: () => this.game.mode === 'flying',
        currentMissionId: () => (this.game.mission ? this.game.mission.id : 'm01')
      }
    });
    this.game.ui = this.ui;

    // mirror toasts into the in-cockpit message stack
    const origToast = this.ui.showToast.bind(this.ui);
    this.ui.showToast = (text, kind, ttl) => {
      origToast(text, kind, ttl);
      this.hud.pushMessage(text, kind === 'good' ? 'good' : kind, ttl || 3.2);
    };

    // ---- settings / quality
    setProgress(0.92, 'APPLYING SETTINGS');
    await nextFrame();
    this.applySettings('all', true);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    gameCanvas.addEventListener('click', () => {
      if (this.game.mode === 'flying' && !this.ui.open) this.input.requestLock();
    });

    setProgress(1.0, 'READY');
    await nextFrame();
    this.audio.music.setMode('menu');
    this.ui.showMain();
    loadingScreen.classList.add('hidden');
    setTimeout(() => loadingScreen.classList.add('hidden'), 400);
    this._timePrev = performance.now() / 1000;
    this.loop();
  }

  // -----------------------------------------------------------------------
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const preset = this.settings.preset;
    const scale = clamp((this.settings.data.renderScale || preset.renderScale) * this.renderScaleMul, 0.4, 1.5);
    const q = this.settings.data.quality;
    const samples = (this.settings.r('antiAliasing') || 0) >= 3 ? 4 : 0;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.postfx.setSize(w * dpr, h * dpr, scale, q >= 2 ? 0.5 : 0.35, samples, q >= 2 ? 4 : 3);
    this.hud.resize(w, h, Math.min(dpr, 2));
    if (this.cockpit) {
      const aspect = this.hud.w / this.hud.h;
      this.cockpit.hudGlass.geometry.dispose();
      this.cockpit.hudGlass.geometry = new THREE.PlaneGeometry(0.46, 0.46 / aspect);
    }
  }

  applySettings(key, initial = false) {
    const s = this.settings;
    const q = s.data.quality;
    const preset = s.preset;
    if (initial || key === 'quality' || key === 'all' || key === 'shadows') {
      this.shadows.setQuality(s.r('shadows') !== undefined && s.data.shadows !== null ? s.data.shadows : preset.shadows);
      this.terrain.setQuality(q, s.data.viewDistance || undefined);
      this.clouds.setQuality(q);
      this.weather.setQuality(q);
      if (this.scenery.setQuality) this.scenery.setQuality(q);
      this.particles.setQuality(q);
      this.postfx.setQuality(q, {});
    }
    if (initial || key === 'all' || key === 'fov') {
      this.camera.fov = s.get('fov', 72);
      this.camera.updateProjectionMatrix();
    }
    if (initial || key === 'all' || key === 'masterVolume') this.audio.setMaster(s.get('masterVolume', 0.9));
    if (initial || key === 'all' || key.endsWith('Volume') || key === 'subtitles') {
      this.audio.setVolume('music', s.get('musicVolume', 0.55));
      this.audio.setVolume('sfx', s.get('sfxVolume', 0.9));
      this.audio.setVolume('voice', s.get('voiceVolume', 0.85));
      this.audio.setVolume('cockpit', s.get('cockpitVolume', 0.6));
    }
    if (initial || key === 'all' || key === 'bindings') this.input.setBindings(s.data.bindings || {});
    if (initial || key === 'all' || key === 'units') this.hud.units = s.get('units', 'imperial');
    if (initial || key === 'all' || key === 'renderScale' || key === 'antiAliasing') this.resize();
  }

  // -----------------------------------------------------------------------
  startMission(id) {
    this.cinematic = false;
    this.ui.clear();
    this.input.requestLock();
    this.game.startMission(id);
    this.setupPlayerCockpit();
    this.cameraMode = 'cockpit';
  }

  startQuick(id) {
    this.cinematic = false;
    this.ui.clear();
    this.input.requestLock();
    this.game.startQuick(id);
    this.setupPlayerCockpit();
    this.cameraMode = id === 'freeflight' ? 'chase' : 'cockpit';
  }

  restart() {
    this.ui.clear();
    const mid = this.game.mission ? this.game.mission.id : null;
    const qid = this.game.quick ? this.game.quick.id : null;
    if (mid) this.startMission(mid);
    else if (qid) this.startQuick(qid);
    else this.quitToMenu();
  }

  resume() {
    this.ui.clear();
    this.input.requestLock();
  }

  quitToMenu() {
    this.game.quitToMenu();
    this.teardownPlayerCockpit();
    this.input.exitLock();
    this.audio.music.setMode('menu');
    this.ui.showMain();
    this.cinematic = true;
  }

  setupPlayerCockpit() {
    this.teardownPlayerCockpit();
    const ac = this.game.player;
    if (!ac) return;
    const cockpit = buildCockpit(ac.def, { csmUniforms: this.csmUniforms, hudCanvas: this.hud.canvas });
    ac.group.add(cockpit.group);
    ac.cockpit = cockpit;
    this.cockpit = cockpit;
    // the exterior canopy glass would be double-drawn from inside; keep it, but
    // make it slightly more transparent so the pilot can see out
    ac.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial) {
        o.material.opacity = Math.min(o.material.opacity, 0.34);
      }
    });
    this.resize();
    // hide the pilot's helmet so it does not block the camera
    if (ac.parts && ac.parts.pilot) ac.parts.pilot.visible = false;
  }

  teardownPlayerCockpit() {
    const ac = this.game ? this.game.player : null;
    if (ac && ac.cockpit) {
      ac.group.remove(ac.cockpit.group);
      ac.cockpit.dispose();
      ac.cockpit = null;
    }
    this.cockpit = null;
  }

  // -----------------------------------------------------------------------
  onKey(e) {
    if (e.code === 'Escape') {
      if (this.ui.open && this.ui.screen !== 'pause') this.ui.showPause();
      else if (this.ui.open && this.ui.screen === 'pause') this.ui.clear();
      else if (this.game.mode === 'flying') { this.ui.showPause(); this.input.exitLock(); }
      return;
    }
    if (e.code === 'F1') {
      this.showHelp = !this.showHelp;
      this.hud.showHelp = this.showHelp;
      if (this.showHelp) { this.ui.showControls(); this.game.paused = true; }
      else { this.ui.clear(); this.game.paused = false; }
      return;
    }
    if (this.game.mode !== 'flying' || this.ui.open) return;
    if (e.code === 'Digit1') this.setCamera('cockpit');
    if (e.code === 'Digit2') this.setCamera('chase');
    if (e.code === 'Digit3') this.setCamera('orbit');
    if (e.code === 'Digit4') this.setCamera('flyby');
    if (e.code === 'KeyH') this.cameraMode = this.cameraMode === 'rear' ? 'chase' : 'rear';
    if (e.code === 'KeyN') {
      this.nightVision = !this.nightVision;
      gameCanvas.style.filter = this.nightVision ? 'saturate(0.3) brightness(1.75) hue-rotate(65deg) contrast(1.15)' : '';
      vfxOverlay.style.opacity = this.nightVision ? '0.25' : '1';
      this.ui.showToast(this.nightVision ? 'NIGHT VISION ON' : 'NIGHT VISION OFF', 'info', 1.6);
    }
  }

  setCamera(mode) {
    this.cameraMode = mode;
    if (this.cockpit) this.cockpit.group.visible = mode === 'cockpit';
    if (mode !== 'cockpit' && this.game.player) {
      // keep the interior hidden from outside
    }
  }

  /** Does this context support rendering into half-float targets?  (Needed by
   *  PMREMGenerator; RGBA16F render targets are otherwise unusable.) */
  _probeFloatTargets() {
    const gl = this.renderer && this.renderer.getContext ? this.renderer.getContext() : null;
    const has = !!(gl && (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')));
    this.hdrRenderTargets = has;
    return has;
  }

  // -----------------------------------------------------------------------
  updateCamera(dt) {
    const ac = this.game.player;
    const cam = this.camera;
    const fm = ac ? ac.fm : null;
    if (this.cinematic) {
      // slow orbit around the menu world
      this.orbitAngle += dt * 0.05;
      const r = 4200;
      const cx = Math.cos(this.orbitAngle) * r;
      const cz = Math.sin(this.orbitAngle) * r;
      const groundY = this.field.heightAt(cx, cz);
      const y = Math.max(groundY + 260, 1600 + Math.sin(this.orbitAngle * 0.7) * 300);
      cam.position.lerp(new THREE.Vector3(cx, y, cz), 1 - Math.exp(-dt * 1.4));
      const look = new THREE.Vector3(cx * 0.3, y - 180, cz * 0.3);
      cam.lookAt(look);
      cam.near = 1;
      cam.updateProjectionMatrix();
      this.world.activeCamera = cam;
      this.updateEnvMap(dt);
      return;
    }
    if (!ac || !fm) return;
    const mode = this.cameraMode;
    // freeze the sim when paused
    if (this.game.paused) { this.world.activeCamera = cam; return; }

    const fwd = _v1.set(0, 0, 1).applyQuaternion(fm.quat);
    const up = _v2.set(0, 1, 0).applyQuaternion(fm.quat);
    const speed = Math.max(40, fm.speed);
    const shake = this.computeShake(dt, fm);

    if (mode === 'cockpit') {
      cam.near = 0.12;
      cam.far = 45000;
      if (this.cockpit) {
        this.cockpit.group.visible = true;
        this.cockpit.group.position.set(0, 0, 0);
        const eye = this.cockpit.eye;
        const local = _v3.copy(fm.pos);
        const off = _v4.copy(eye).applyQuaternion(fm.quat);
        cam.position.copy(local).add(off).add(shake);
        // the camera looks down its local -Z while the airframe (and the whole
        // cockpit) is authored nose = +Z, so yaw the camera 180 deg to look
        // forward out of the canopy
        cam.quaternion.copy(fm.quat);
        cam.rotateY(Math.PI);
        // small head bob / turbulence wobble
        const wob = fm.turbulencePhase || 0;
        cam.rotateZ(Math.sin(wob * 1.7) * 0.004 + (this.world.cockpitShake.x || 0) * 0.02);
        // look into turns slightly
        cam.rotateY(0);
      } else {
        cam.position.copy(fm.pos).addScaledVector(fwd, 2.2).add(shake);
        cam.quaternion.copy(fm.quat);
        cam.rotateY(Math.PI);
      }
    } else if (mode === 'chase' || mode === 'rear') {
      cam.near = 0.6;
      const back = mode === 'rear' ? -1 : 1;
      const dist = 16 + speed * 0.045;
      const high = 4.2 + speed * 0.006;
      const desired = _v3.copy(fm.pos)
        .addScaledVector(fwd, -dist * back)
        .addScaledVector(up, high);
      const k = mode === 'rear' ? 20 : 6.5;
      this.chasePos.lerp(desired, 1 - Math.exp(-dt * k));
      const minY = this.field.heightAt(this.chasePos.x, this.chasePos.z) + 4;
      if (this.chasePos.y < minY) this.chasePos.y = minY;
      cam.position.copy(this.chasePos).add(shake);
      this.chaseTarget.lerp(_v4.copy(fm.pos).addScaledVector(fwd, 90), 1 - Math.exp(-dt * 8));
      cam.up.copy(up);
      cam.lookAt(this.chaseTarget);
    } else if (mode === 'orbit') {
      cam.near = 0.6;
      this.orbitAngle += dt * 0.35;
      const r = 44;
      const desired = _v3.copy(fm.pos)
        .addScaledVector(_v4.set(Math.cos(this.orbitAngle), 0.32, Math.sin(this.orbitAngle)).applyQuaternion(fm.quat), r);
      cam.position.copy(desired);
      cam.up.set(0, 1, 0);
      cam.lookAt(fm.pos);
    } else if (mode === 'flyby') {
      cam.near = 0.6;
      // a fixed camera the aircraft flies past
      if (!this.flybyPos || this.flybyTimer <= 0) {
        this.flybyTimer = 6.5;
        this.flybyPos = _v3.copy(fm.pos).addScaledVector(fm.vel, 1.6).add(_v4.set(0, 40, 0)).clone();
      }
      this.flybyTimer -= dt;
      cam.position.copy(this.flybyPos).add(shake);
      cam.up.set(0, 1, 0);
      cam.lookAt(fm.pos);
    }
    cam.updateProjectionMatrix();
    this.world.activeCamera = cam;
    // canopy rain factor
    const wet = this.env.wetness;
    const inCloud = this.clouds.inCloudFog || 0;
    this.world.canopyRain = mode === 'cockpit' ? clamp01(wet * 1.1 + inCloud * 0.8) : 0;
  }

  computeShake(dt, fm) {
    const s = this.settings.get('cockpitShake', true);
    this.shake.set(0, 0, 0);
    if (!s) return this.shake;
    let amp = 0;
    amp += clamp01((Math.abs(fm.gLoad) - 3.5) / 5) * 0.25;
    amp += clamp01((fm.mach - 0.9) / 0.4) * 0.2;
    amp += fm.stallSeverity * 0.5;
    amp += (this.env.turbulence || 0) * 0.12;
    amp += fm.onGround ? clamp01(fm.speed / 120) * 0.25 : 0;
    if (fm.afterburner) amp += 0.04;
    this.shakeT = (this.shakeT || 0) + dt * (12 + amp * 60);
    const a = amp * 0.35;
    this.shake.set(
      Math.sin(this.shakeT * 1.7) * a + (Math.random() - 0.5) * a,
      Math.sin(this.shakeT * 2.3 + 1.1) * a + (Math.random() - 0.5) * a,
      Math.sin(this.shakeT * 3.1 + 2.2) * a * 0.6 + (Math.random() - 0.5) * a
    );
    return this.shake;
  }

  // -----------------------------------------------------------------------
  updateEnvMap(dt) {
    this.envMapTimer = (this.envMapTimer || 0) - dt;
    if (this.envMapTimer > 0 && this.scene.environment) return;
    this.envMapTimer = 3.5;
    const env = this.env;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    const z = env.zenith, h = env.horizon, g = env.groundColor;
    grad.addColorStop(0, `rgb(${(z.r * 255) | 0},${(z.g * 255) | 0},${(z.b * 255) | 0})`);
    grad.addColorStop(0.5, `rgb(${(h.r * 255) | 0},${(h.g * 255) | 0},${(h.b * 255) | 0})`);
    grad.addColorStop(0.55, `rgb(${(g.r * 200) | 0},${(g.g * 200) | 0},${(g.b * 200) | 0})`);
    grad.addColorStop(1, `rgb(${(g.r * 120) | 0},${(g.g * 120) | 0},${(g.b * 120) | 0})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 64);
    // sun blob
    const sunX = ((Math.atan2(env.sunDir.x, -env.sunDir.z) / TAU) + 0.5) * 128;
    const sunY = (0.5 - Math.asin(clamp(env.sunDir.y, -1, 1)) / Math.PI) * 64;
    const sg = ctx.createRadialGradient(sunX, sunY, 1, sunX, sunY, 22);
    sg.addColorStop(0, `rgba(255,250,235,${clamp01(env.sunIntensity / 3)})`);
    sg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, 128, 64);
    // moon
    if (env.nightFactor > 0.2) {
      const mx = ((Math.atan2(env.moonDir.x, -env.moonDir.z) / TAU) + 0.5) * 128;
      const my = (0.5 - Math.asin(clamp(env.moonDir.y, -1, 1)) / Math.PI) * 64;
      const mg = ctx.createRadialGradient(mx, my, 1, mx, my, 12);
      mg.addColorStop(0, `rgba(200,220,255,${env.nightFactor * 0.8})`);
      mg.addColorStop(1, 'rgba(180,200,255,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, 0, 128, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    // PMREM prefilters into an RGBA16F target, which WebGL2 only allows with
    // EXT_color_buffer_float (near-universal, but not guaranteed).  Without it
    // the prefilter output is undefined, so use the plain equirect texture as
    // the environment instead - the IBL is blurrier but nothing breaks.
    if (this.hdrRenderTargets === undefined) this._probeFloatTargets();
    if (this.hdrRenderTargets) {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
      try {
        const rt = this.pmrem.fromEquirectangular(tex);
        if (this.envRT) this.envRT.dispose();
        this.envRT = rt;
        this.scene.environment = rt.texture;
      } catch (e) { /* ignore env map failures */ }
    } else {
      // No float targets: *any* scene.environment texture makes the renderer
      // prefilter it into PMREM internally (which is exactly what cannot work
      // here), so drop the environment map and let the hemisphere/ambient
      // lights carry the sky bounce instead.
      if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
      this.scene.environment = null;
      return;
    }
    tex.dispose();
  }

  // -----------------------------------------------------------------------
  update(dt) {
    const fpsInst = 1 / Math.max(1e-4, dt);
    this.fpsSamples.push(fpsInst);
    if (this.fpsSamples.length > 45) this.fpsSamples.shift();
    this.fps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    // dynamic resolution
    if (this.settings.get('dynamicResolution', true) && this.frameCount % 40 === 0 && !this.cinematic) {
      const target = 58;
      if (this.fps < 46 && this.renderScaleMul > 0.62) { this.renderScaleMul = Math.max(0.62, this.renderScaleMul - 0.06); this.resize(); }
      else if (this.fps > target && this.renderScaleMul < 1) { this.renderScaleMul = Math.min(1, this.renderScaleMul + 0.04); this.resize(); }
    }
    this.frameCount++;

    this.input.update(dt);
    const flying = this.game.mode === 'flying';
    const paused = this.game.paused || this.ui.open;

    // ---- simulation
    if (flying && !paused) {
      this.game.update(dt);
      this.projectiles.update(dt, this.world);
    } else if (this.game.mode === 'debrief') {
      this.projectiles.update(dt, this.world);
    }

    // ---- player engine audio
    if (flying && this.game.player) {
      const fm = this.game.player.fm;
      if (!this.engineVoice) this.engineVoice = this.audio.createEngine({ type: this.game.player.def.prop ? 'prop' : 'jet' });
      if (this.engineVoice) {
        this.engineVoice.setThrottle(fm.throttle, fm.afterburner, fm.rpm);
        this.engineVoice.setDamage(1 - this.game.player.health / this.game.player.maxHealth);
        this.engineVoice.setPosition(this.camera.position);
        this.engineVoice.setListener(this.camera.position, _v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion), _v2.set(0, 1, 0).applyQuaternion(this.camera.quaternion));
        this.engineVoice.update(dt);
      }
    } else if (this.engineVoice) {
      this.engineVoice.setThrottle(0, false, 0);
      this.engineVoice.update(dt);
    }

    // ---- environment
    this.updateCamera(dt);
    const camPos = this.camera.position;
    this.listenerPos.copy(camPos);
    if (!paused || this.cinematic) this.env.update(dt, camPos);
    const envSnap = Object.assign(this.env.snapshot(), {
      precip: this.env.precip, tempAt: (a) => this.env.tempAt(a),
      windSpeed: this.env.windSpeed, inCloud: 0
    });
    this.envView = envSnap;

    this.clouds.update(this.camera, envSnap, paused ? 0 : dt);
    envSnap.inCloud = this.clouds.inCloudFog;
    if (!paused) {
      this.weather.update(this.camera, envSnap, dt, this.clouds);
      const storm = this.env.updateLightning(dt, this.clouds, camPos);
      if (storm && storm.pos) {
        const dist = camPos.distanceTo(storm.pos);
        this.audio.thunder(clamp01(dist / 9000));
        this.lightningFlash = 1;
        if (dist < 1200) this.ui.showToast('LIGHTNING STRIKE!', 'warn', 1.4);
      }
    }
    this.lightningFlash = Math.max(0, (this.lightningFlash || 0) - dt * 2.4);
    if (!paused) this.updateEnvMap(dt);
    this.ocean.update(this.camera, envSnap, dt);
    this.sky.update(this.camera, envSnap);
    this.scenery.update(camPos);
    this.terrain.update(this.camera, this.game.time);

    // ---- lighting follows the sun
    const ld = this.env.lightDir;
    this.sunLight.position.copy(camPos).addScaledVector(ld, 4000);
    this.sunLight.target.position.copy(camPos);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.color.copy(this.env.sunColor);
    this.sunLight.intensity = this.env.sunIntensity;
    this.hemi.color.copy(this.env.ambientUp);
    this.hemi.groundColor.copy(this.env.ambientDown);
    this.hemi.intensity = this.env.ambientIntensity;
    // three's own fog for standard materials matches the terrain fog density
    this.scene.fog.color.copy(this.env.horizon);
    this.scene.fog.density = clamp((this.env.fogDensity || 7e-5) * (1 + (this.env.stormCover || 0) * 0.9), 0, 0.004);

    // ---- particles + shadows
    if (!paused) this.particles.update(dt, { windSpeed: this.env.windSpeed, windDir: this.env.windDir }, this.camera);
    if (this.frameCount % 2 === 0 || !this._shadowWarm) {
      this.shadows.update(this.scene, this.camera, ld);
      this._shadowWarm = true;
    }

    // ---- cockpit + HUD
    if (this.cockpit && flying && this.game.player) {
      const s = this.game.hudState;
      s.pitchInput = this.input.axes.pitch;
      s.rollInput = this.input.axes.roll;
      updateCockpit(this.cockpit, paused ? 0 : dt, s, this.game.player.def, this.world);
      if (this.cockpit.hudTex) this.cockpit.hudTex.needsUpdate = true;
    }
    this.hud.update(dt);
    this.hud.showHelp = this.showHelp;
    if (this.game.mode !== 'menu') {
      const s = this.game.hudState;
      const camFwd = _v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.world.aimPoint = _v2.copy(this.camera.position).addScaledVector(camFwd, 1600);
      s.player = this.game.player;
      this.hud.draw(s, { glass: false, scale: 1 });
      if (this.cockpit && this.cockpit.visible !== false) {
        // repaint the very same HUD drawing onto the combiner glass texture
        const c = this.cockpit;
        const ctx = c.hudCtx;
        if (ctx) {
          const saveCtx = this.hud.ctx, saveW = this.hud.w, saveH = this.hud.h, saveScale = this.hud.scale;
          this.hud.ctx = ctx; this.hud.w = c.hudCanvas.width; this.hud.h = c.hudCanvas.height;
          this.hud.scale = Math.min(this.hud.w / 1280, this.hud.h / 720) * 0.92;
          ctx.clearRect(0, 0, this.hud.w, this.hud.h);
          this.hud.draw(s, { glass: true, scale: 1 });
          this.hud.ctx = saveCtx; this.hud.w = saveW; this.hud.h = saveH; this.hud.scale = saveScale;
          c.hudTex.needsUpdate = true;
        }
      }
    } else {
      this.hud.ctx.clearRect(0, 0, this.hud.w, this.hud.h);
    }

    // ---- freeze the world while menus are open
    this.world.frozen = paused;
  }

  // -----------------------------------------------------------------------
  render() {
    const r = this.renderer;
    const pf = this.postfx;
    const env = this.env;
    const ac = this.game.player;
    const s = this.game.hudState;

    // sky into its own half-res target, then blit under the scene
    this.sky.render(r, pf.rtSky);
    pf.beginScene(r);
    pf.endScene(r, this.scene, this.camera);

    const sunScreen = this.sky.sunScreen(this.camera);
    const gv = ac ? gVisionOf(ac) : { tunnel: 0, red: 0, chromatic: 0 };
    const speedBlur = ac ? clamp01((ac.fm.mach - 0.85) / 0.6) * 0.55 + gv.tunnel * 0.2 : 0;
    const cfg = this.settings;
    pf.present(r, this.camera, {
      bloom: cfg.get('bloom', true) && cfg.get('postFX', true),
      bloomThreshold: 1.02,
      godRays: cfg.get('godRays', true) && cfg.get('postFX', true),
      sunScreen,
      godExposure: 0.5,
      lensIntensity: 0.85,
      exposure: env.exposure * (this.nightVision ? 1.35 : 1),
      time: this.game.time,
      lift: env.grade.lift,
      gain: env.grade.gain,
      saturation: env.grade.sat,
      contrast: env.grade.contrast,
      chromatic: cfg.get('chromatic', true) ? 0.2 + gv.chromatic * 0.9 : 0.05,
      vignette: cfg.get('vignette', true) ? 0.45 + s.blackout * 0.4 : 0.1,
      grain: cfg.get('filmGrain', true) ? 0.28 : 0.0,
      speedBlur: cfg.get('motionBlur', true) ? speedBlur : 0,
      speedDir: { x: 0, y: 0 },
      flash: clamp01((this.lightningFlash || 0) * 0.55 + (this.game.hudState.damaged || 0) * 0.04),
      flashColor: env.flashColor || { r: 0.8, g: 0.85, b: 1.0 },
      dof: cfg.get('depthOfField', true) ? (this.cameraMode === 'cockpit' ? 0.15 : 0.3) : 0,
      fxaa: (cfg.r('antiAliasing') || 0) >= 1
    });
  }

  loop() {
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      let dt = now - this._timePrev;
      this._timePrev = now;
      if (!(dt > 0)) dt = 1 / 60;                 // first frame / clock went backwards
      if (dt > 0.1) dt = 0.1;                     // never take a huge sim step
      try {
        this.update(dt);
        this.render();
      } catch (err) {
        cancelAnimationFrame(this.raf);
        fatal(err);
        throw err;
      }
      this.input.endFrame();
    };
    this.raf = requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------------------
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();

function gVisionOf(ac) {
  const g = ac.fm.gLoad;
  const positive = clamp01((g - 3.0) / 6.5);
  const negative = clamp01((-g - 0.6) / 3.0);
  return {
    tunnel: clamp01(positive * 1.05 + ac.fm.blackout * 0.95),
    red: clamp01(negative + ac.fm.redout * 0.95),
    chromatic: clamp01((Math.abs(g) - 2.5) / 7)
  };
}

// ===========================================================================
const app = new App();
window.__AERIAL_TEMPEST__ = app;
app.boot().catch((err) => fatal(err));
