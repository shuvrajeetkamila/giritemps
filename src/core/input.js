// Keyboard, mouse and gamepad input with remappable bindings and deadzones.
import { loadSettings } from './settings.js';

const keys = new Set();
const pressed = new Set();     // edge-triggered this frame
const mouse = { dx: 0, dy: 0, buttons: new Set(), locked: false };
const pad = { axes: [0, 0, 0, 0], buttons: [], prev: [] };
let lastPadIndex = -1;

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.buttons.clear(); });
  canvas.addEventListener('mousedown', (e) => {
    mouse.buttons.add('Mouse' + e.button);
    pressed.add('Mouse' + e.button);
  });
  window.addEventListener('mouseup', (e) => mouse.buttons.delete('Mouse' + e.button));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mousemove', (e) => {
    if (mouse.locked) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
  });
  document.addEventListener('pointerlockchange', () => { mouse.locked = document.pointerLockElement === canvas; });
  window.addEventListener('gamepadconnected', (e) => { lastPadIndex = e.gamepad.index; });
  window.addEventListener('gamepaddisconnected', () => { lastPadIndex = -1; });
}

export function requestMouseLock(canvas) {
  if (canvas.requestPointerLock) canvas.requestPointerLock();
}

export function isDown(action) {
  const s = loadSettings();
  const code = s.bindings[action];
  if (!code) return false;
  if (code.startsWith('Mouse')) return mouse.buttons.has(code);
  if (keys.has(code)) return true;
  return padButtonDown(s.gamepadBindings[action]);
}

export function wasPressed(action) {
  const s = loadSettings();
  const code = s.bindings[action];
  if (code && pressed.has(code)) return true;
  const pb = s.gamepadBindings[action];
  if (pb) return padButtonPressed(pb);
  return false;
}

// Gamepad mapping: standard layout indices.
const PAD_INDEX = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, Back: 8, Start: 9, LT2: 6 };
function padButtonDown(name) {
  if (!name || lastPadIndex < 0) return false;
  const i = PAD_INDEX[name];
  return i !== undefined && !!pad.buttons[i];
}
function padButtonPressed(name) {
  if (!name || lastPadIndex < 0) return false;
  const i = PAD_INDEX[name];
  return i !== undefined && !!pad.buttons[i] && !pad.prev[i];
}

function dz(v, d) {
  const a = Math.abs(v);
  if (a < d) return 0;
  return Math.sign(v) * (a - d) / (1 - d);
}

// Call once per frame, before reading axes.
export function pollInput() {
  const s = loadSettings();
  if (typeof navigator !== 'undefined' && navigator.getGamepads) {
    const list = navigator.getGamepads();
    const gp = lastPadIndex >= 0 ? list[lastPadIndex] : [...list].find((g) => g);
    if (gp) {
      pad.prev = pad.buttons.slice();
      pad.axes = gp.axes.slice();
      pad.buttons = gp.buttons.map((b) => (typeof b === 'object' ? b.value > 0.5 : !!b));
      // Analog triggers exposed as axes in some drivers.
      if (gp.buttons[6]) pad.triggerLT = gp.buttons[6].value;
      if (gp.buttons[7]) pad.triggerRT = gp.buttons[7].value;
    }
  }
  const dzv = s.deadzone;
  const stick = {
    x: dz(pad.axes[0] || 0, dzv),        // left stick X -> roll
    y: dz(pad.axes[1] || 0, dzv),        // left stick Y -> pitch (up is -1)
    rx: dz(pad.axes[2] || 0, dzv),       // right stick X -> yaw
    ry: dz(pad.axes[3] || 0, dzv),
  };
  const out = {
    mouseDx: mouse.dx * s.mouseSens * 0.0025,
    mouseDy: mouse.dy * s.mouseSens * 0.0025 * (s.invertY ? -1 : 1),
    padPitch: -stick.y * s.stickSens,
    padRoll: stick.x * s.stickSens,
    padYaw: stick.rx * s.stickSens,
    padThrottle: pad.triggerLT || 0,
    padFire: pad.triggerRT || 0,
  };
  mouse.dx = 0; mouse.dy = 0;
  return out;
}

// Call at end of frame to clear edge-triggered presses.
export function endInputFrame() {
  pressed.clear();
}

export function keyDown(code) { return keys.has(code); }
export function anyKeyPressedRaw(code) { return pressed.has(code); }
export function setPressedRaw(code) { pressed.add(code); }
export function isMouseLocked() { return mouse.locked; }
export function displayBindingName(code) {
  if (!code) return '-';
  if (code.startsWith('Mouse')) return ['Left Mouse', 'Middle Mouse', 'Right Mouse'][+code.slice(5)] || code;
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'L-Shift').replace('ControlLeft', 'L-Ctrl').replace('Space', 'Space');
}
