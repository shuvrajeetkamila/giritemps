// ---------------------------------------------------------------------------
// Settings — graphics/audio/control configuration with localStorage persistence
// ---------------------------------------------------------------------------
import { clamp } from './Utils.js';

export const QUALITY_PRESETS = {
  0: { // Low
    name: 'LOW',
    renderScale: 0.72, shadows: 0, shadowMapSize: 1024, shadowDistance: 900,
    cloudSteps: 14, cloudResolution: 0.45, cumulusPuffs: 260, cloudDistance: 14000,
    terrainDetail: 0.6, terrainDrawDistance: 9000, viewDistance: 12000,
    particles: 0.45, postFX: 1, bloom: 1, anisotropy: 2, trees: 0.3, aa: 0
  },
  1: { // Medium
    name: 'MEDIUM',
    renderScale: 0.85, shadows: 1, shadowMapSize: 2048, shadowDistance: 1500,
    cloudSteps: 24, cloudResolution: 0.6, cumulusPuffs: 520, cloudDistance: 20000,
    terrainDetail: 0.85, terrainDrawDistance: 14000, viewDistance: 18000,
    particles: 0.75, postFX: 1, bloom: 1, anisotropy: 4, trees: 0.6, aa: 1
  },
  2: { // High
    name: 'HIGH',
    renderScale: 1.0, shadows: 3, shadowMapSize: 2048, shadowDistance: 2200,
    cloudSteps: 36, cloudResolution: 0.8, cumulusPuffs: 900, cloudDistance: 28000,
    terrainDetail: 1.0, terrainDrawDistance: 20000, viewDistance: 24000,
    particles: 1.0, postFX: 1, bloom: 1, anisotropy: 8, trees: 1.0, aa: 2
  },
  3: { // Ultra
    name: 'ULTRA',
    renderScale: 1.0, shadows: 3, shadowMapSize: 4096, shadowDistance: 3000,
    cloudSteps: 56, cloudResolution: 1.0, cumulusPuffs: 1400, cloudDistance: 36000,
    terrainDetail: 1.3, terrainDrawDistance: 26000, viewDistance: 32000,
    particles: 1.4, postFX: 1, bloom: 1, anisotropy: 16, trees: 1.5, aa: 3
  }
};

export const DEFAULT_BINDINGS = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight', 'Equal'],
  throttleDown: ['ControlLeft', 'ControlRight', 'Minus'],
  throttleMax: ['KeyX'],
  throttleIdle: ['KeyZ'],
  afterburner: ['Tab'],
  fireGun: ['Space'],
  fireMissile1: ['KeyF'],
  fireMissile2: ['KeyR'],
  fireRocket: ['KeyG'],
  dropBomb: ['KeyB'],
  flares: ['KeyC'],
  chaff: ['KeyV'],
  cycleWeapon: ['KeyT'],
  gear: ['KeyK'],
  flaps: ['KeyL'],
  airbrake: ['KeyJ'],
  camera: ['KeyO'],
  targetNext: ['KeyY'],
  targetPrev: ['KeyU'],
  pause: ['Escape'],
  scoreboard: ['F1'],
  map: ['KeyM'],
  nightVision: ['KeyN'],
  rearView: ['KeyH']
};

const STORE_KEY = 'aerial-tempest-settings-v1';

export class Settings {
  constructor() {
    this.data = {
      quality: 2,
      renderScale: null,          // null = use preset
      dynamicResolution: true,
      shadows: null, cloudDetail: null, particleDensity: null, terrainDetail: null,
      postFX: true, motionBlur: true, bloom: true, chromatic: true, filmGrain: true,
      vignette: true, depthOfField: true, speedLines: true, godRays: true,
      antiAliasing: null, vsync: true, frameCap: 0, viewDistance: null,
      masterVolume: 0.9, musicVolume: 0.55, sfxVolume: 0.9, voiceVolume: 0.85, cockpitVolume: 0.6,
      fov: 72, invertPitch: false, invertYaw: false,
      mouseSensitivity: 1.0, gamepadSensitivity: 1.0, deadzone: 0.12,
      flightAssist: 0.65, autoLevel: false, showDamage: true, units: 'imperial',
      bindings: JSON.parse(JSON.stringify(DEFAULT_BINDINGS)),
      cockpitShake: true, subtitles: true, hudOpacity: 1.0, colorGrading: true
    };
    this.load();
    this.preset = QUALITY_PRESETS[this.data.quality];
  }

  get(k, d) { const v = this.data[k]; return v === undefined || v === null ? d : v; }
  set(k, v) { this.data[k] = v; this.save(); this.changed = true; }

  applyPreset(i) {
    this.data.quality = clamp(i, 0, 3);
    this.preset = QUALITY_PRESETS[this.data.quality];
    this.data.renderScale = null;
    this.data.shadows = null; this.data.cloudDetail = null;
    this.data.particleDensity = null; this.data.terrainDetail = null;
    this.data.viewDistance = null; this.data.antiAliasing = null;
    this.save();
  }

  /** Effective value with preset fallback. */
  r(key) {
    const v = this.data[key];
    if (v !== null && v !== undefined) return v;
    return this.preset[key];
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(this.data, parsed);
        if (parsed.bindings) this.data.bindings = Object.assign({}, DEFAULT_BINDINGS, parsed.bindings);
        this.sanitize();
      }
    } catch (e) { /* ignore */ }
  }
  sanitize() {
    const d = this.data;
    d.quality = clamp(d.quality | 0, 0, 3);
    d.masterVolume = clamp(d.masterVolume, 0, 1);
    d.musicVolume = clamp(d.musicVolume, 0, 1);
    d.sfxVolume = clamp(d.sfxVolume, 0, 1);
    d.voiceVolume = clamp(d.voiceVolume, 0, 1);
    d.cockpitVolume = clamp(d.cockpitVolume, 0, 1);
    d.fov = clamp(d.fov, 45, 110);
    d.mouseSensitivity = clamp(d.mouseSensitivity, 0.1, 4);
    d.gamepadSensitivity = clamp(d.gamepadSensitivity, 0.1, 3);
    d.deadzone = clamp(d.deadzone, 0, 0.4);
  }

  resetAll() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  }
}
