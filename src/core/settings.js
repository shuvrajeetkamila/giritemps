// Persistent settings: graphics, audio, display, controls and key bindings.
const KEY = 'giritemps.settings.v1';

export const QUALITY_PRESETS = {
  low:    { shadows: 0, cloudDetail: 1, postFx: 0, particles: 0.35, terrainDetail: 0, drawDistance: 0.6, aa: 0, vsync: false, resScale: 0.75 },
  medium: { shadows: 1, cloudDetail: 2, postFx: 1, particles: 0.6, terrainDetail: 1, drawDistance: 0.8, aa: 0, vsync: false, resScale: 1 },
  high:   { shadows: 2, cloudDetail: 3, postFx: 2, particles: 0.85, terrainDetail: 2, drawDistance: 1, aa: 4, vsync: true, resScale: 1 },
  ultra:  { shadows: 3, cloudDetail: 4, postFx: 3, particles: 1, terrainDetail: 3, drawDistance: 1.2, aa: 4, vsync: true, resScale: 1 },
};

export const DEFAULT_BINDINGS = {
  pitchDown: 'KeyW', pitchUp: 'KeyS', rollLeft: 'KeyA', rollRight: 'KeyD',
  yawLeft: 'KeyQ', yawRight: 'KeyE',
  throttleUp: 'ShiftLeft', throttleDown: 'ControlLeft', afterburner: 'KeyZ',
  fireGun: 'Mouse0', fireMissile: 'KeyF', fireRocket: 'KeyR', dropBomb: 'KeyB',
  flare: 'KeyH', chaff: 'KeyJ', cycleTarget: 'KeyT', cycleWeapon: 'KeyG',
  cameraView: 'KeyC', gear: 'KeyL', flaps: 'KeyK', brake: 'Space',
  nightVision: 'KeyN', pause: 'Escape', freeLook: 'Mouse2',
};

export const BINDING_LABELS = {
  pitchDown: 'Pitch down', pitchUp: 'Pitch up', rollLeft: 'Roll left', rollRight: 'Roll right',
  yawLeft: 'Yaw left', yawRight: 'Yaw right', throttleUp: 'Throttle up', throttleDown: 'Throttle down',
  afterburner: 'Afterburner', fireGun: 'Gun', fireMissile: 'Missile', fireRocket: 'Rockets',
  dropBomb: 'Bomb', flare: 'Flares', chaff: 'Chaff', cycleTarget: 'Cycle target',
  cycleWeapon: 'Cycle weapon', cameraView: 'Camera view', gear: 'Landing gear', flaps: 'Flaps',
  brake: 'Speed brake', nightVision: 'Night vision', pause: 'Pause', freeLook: 'Free look (hold)',
};

export const DEFAULT_SETTINGS = {
  quality: 'high',
  customQuality: null,
  dynamicRes: true,
  resolution: 1080,
  displayMode: 'windowed',
  brightness: 1,
  fov: 70,
  filmGrain: true,
  vignette: true,
  motionBlur: true,
  godRays: true,
  shake: 1,
  masterVol: 0.8, musicVol: 0.5, sfxVol: 0.8, voiceVol: 0.9, ambientVol: 0.6,
  mouseSens: 1, stickSens: 1, deadzone: 0.08, invertY: false, mouseMode: 'stick',
  frameCap: 0,
  showFps: false,
  bindings: { ...DEFAULT_BINDINGS },
  gamepadBindings: {
    fireGun: 'RT', fireMissile: 'A', fireRocket: 'B', flare: 'LB', chaff: 'RB', cycleTarget: 'Y',
    cycleWeapon: 'X', cameraView: 'Back', gear: 'Start', dropBomb: 'LT2',
  },
};

let current = null;

function deepMerge(base, extra) {
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) out[k] = deepMerge(base[k] || {}, extra[k]);
    else out[k] = extra[k];
  }
  return out;
}

export function loadSettings() {
  if (current) return current;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  current = deepMerge(DEFAULT_SETTINGS, saved);
  return current;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (e) { /* storage full or disabled */ }
}

export function getQuality() {
  const s = loadSettings();
  return s.quality === 'custom' && s.customQuality ? s.customQuality : QUALITY_PRESETS[s.quality] || QUALITY_PRESETS.high;
}

export function resetBindings() {
  loadSettings().bindings = { ...DEFAULT_BINDINGS };
  saveSettings();
}
