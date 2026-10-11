// ---------------------------------------------------------------------------
// Input — keyboard + mouse (pointer lock) + gamepad/joystick, with remapping
// ---------------------------------------------------------------------------
import { clamp, damp } from './Utils.js';
import { DEFAULT_BINDINGS } from './Settings.js';

export const GAMEPAD_DEFAULT = {
  // standard mapping indices
  pitchAxis: 3, rollAxis: 2, yawAxis: 0, throttleUp: 7, throttleDown: 6,
  fire: 0, missile: 1, flares: 2, cycleWeapon: 3, camera: 4, bombs: 5, gear: 8, pause: 9
};

export class Input {
  constructor(settings, canvas) {
    this.settings = settings;
    this.canvas = canvas;
    this.keys = new Set();
    this.keysPressed = new Set();     // one-frame edge triggers
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, left: false, right: false, middle: false, wheel: 0 };
    this.locked = false;
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.smoothed = { pitch: 0, roll: 0, yaw: 0 };
    this.throttleDelta = 0;
    this.throttleHard = 0;
    this.gamepad = null;
    this.gpPrev = {};
    this.enabled = false;
    this.bindings = settings.data.bindings || JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    this.rawMouse = { x: 0, y: 0 };
    this._bind();
  }

  setBindings(b) { this.bindings = b; }

  _bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { return; }
      // Never swallow keys while typing in an input field
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (['Tab', 'Space', 'F1', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    c.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      if (e.button === 1) this.mouse.middle = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (this.onLockChange) this.onLockChange(this.locked);
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
    });
    window.addEventListener('gamepadconnected', (e) => { this.gamepad = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad = null; });
  }

  requestLock() {
    if (this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { });
    }
  }
  exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  down(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }
  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keysPressed.has(c)) return true;
    return false;
  }

  _pad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
  padDown(btn) {
    const p = this._pad();
    if (!p || !p.buttons[btn]) return false;
    return p.buttons[btn].pressed;
  }
  padPressed(btn) {
    const p = this._pad();
    if (!p || !p.buttons[btn]) return false;
    const id = p.index + ':' + btn;
    const now = p.buttons[btn].pressed;
    const prev = this.gpPrev[id] || false;
    this.gpPrev[id] = now;
    return now && !prev;
  }

  /** Sample per-frame: fills axes/throttle and clears edge state. */
  update(dt) {
    const s = this.settings;
    const invert = s.get('invertPitch', false);
    // ---- keyboard digital axes
    let kp = 0, kr = 0, ky = 0;
    if (this.down('pitchUp')) kp += 1;
    if (this.down('pitchDown')) kp -= 1;
    if (this.down('rollLeft')) kr -= 1;
    if (this.down('rollRight')) kr += 1;
    if (this.down('yawLeft')) ky -= 1;
    if (this.down('yawRight')) ky += 1;

    // ---- mouse flight axis (relative mode): centred virtual stick
    const sens = s.get('mouseSensitivity', 1);
    let mp = 0, mr = 0;
    if (this.locked && this.mouse.left) { // RMB-less flight: stick follows mouse offset from centre
      mp = 0; mr = 0;
    }
    // Mouse-based pitch/yaw when holding left button OR in "mouse flight" mode:
    if (this.locked && this.mouseMode) {
      this.rawMouse.x = clamp(this.rawMouse.x + this.mouse.dx * 0.004 * sens, -1, 1);
      this.rawMouse.y = clamp(this.rawMouse.y + this.mouse.dy * 0.004 * sens, -1, 1);
      // auto-recentre slowly when not moving
      this.rawMouse.x = damp(this.rawMouse.x, 0, 0.6, dt);
      this.rawMouse.y = damp(this.rawMouse.y, 0, 0.6, dt);
    }
    if (this.mouse.left && this.locked) {
      // Absolute-ish virtual joystick: pull toward cursor position relative to centre
      const nx = clamp((this.mouse.x / window.innerWidth) * 2 - 1, -1, 1);
      const ny = clamp((this.mouse.y / window.innerHeight) * 2 - 1, -1, 1);
      mr += nx * 0; // mouse absolute roll disabled (keyboard handles roll)
      mp += -ny * (this.mouseFlightAbsolute ? 1 : 0);
    }
    this.mouse.dx = 0; this.mouse.dy = 0;

    // ---- gamepad
    let gp = 0, gr = 0, gy = 0, gpThrottle = 0;
    const p = this._pad();
    if (p) {
      const dz = s.get('deadzone', 0.12);
      const curve = (v) => {
        const a = Math.abs(v) < dz ? 0 : (Math.abs(v) - dz) / (1 - dz);
        return Math.sign(v) * a * a * (3 + -2 * a) / 3 * 3 * 0.5 + Math.sign(v) * (a * a * (3 - 2 * a)) * 0.5;
      };
      const gsens = s.get('gamepadSensitivity', 1);
      const ax = (i) => (p.axes[i] !== undefined ? p.axes[i] : 0);
      gp += -curve(ax(GAMEPAD_DEFAULT.pitchAxis)) * gsens;
      gr += curve(ax(GAMEPAD_DEFAULT.rollAxis)) * gsens;
      gy += curve(ax(GAMEPAD_DEFAULT.yawAxis)) * gsens;
      if (p.buttons[GAMEPAD_DEFAULT.throttleUp] && p.buttons[GAMEPAD_DEFAULT.throttleUp].pressed) gpThrottle += 1;
      if (p.buttons[GAMEPAD_DEFAULT.throttleDown] && p.buttons[GAMEPAD_DEFAULT.throttleDown].pressed) gpThrottle -= 1;
      // left/right trigger on some pads = analogue throttle (axes 4/5)
      if (Math.abs(ax(4)) > 0.02 || Math.abs(ax(5)) > 0.02) gpThrottle += (ax(5) > 0.02 ? -ax(5) : 0) + (ax(4) > 0.02 ? ax(4) : 0);
    }

    const target = {
      pitch: clamp((kp + mp + gp) * (invert ? -1 : 1), -1, 1),
      roll: clamp(kr + mr + gr, -1, 1),
      yaw: clamp((ky + gy) * (s.get('invertYaw', false) ? -1 : 1), -1, 1)
    };
    // rate-limit keyboard input so it feels analogue
    const rate = 6.5;
    this.smoothed.pitch = damp(this.smoothed.pitch, target.pitch, rate, dt);
    this.smoothed.roll = damp(this.smoothed.roll, target.roll, rate, dt);
    this.smoothed.yaw = damp(this.smoothed.yaw, target.yaw, rate, dt);

    this.axes.pitch = this.smoothed.pitch;
    this.axes.roll = this.smoothed.roll;
    this.axes.yaw = this.smoothed.yaw;

    let t = 0;
    if (this.down('throttleUp')) t += 1;
    if (this.down('throttleDown')) t -= 1;
    t += gpThrottle;
    if (this.pressed('throttleMax')) this.throttleHard = 1;
    else if (this.pressed('throttleIdle')) this.throttleHard = -1;
    else this.throttleHard = 0;
    this.throttleDelta = clamp(t, -1, 1);
  }

  endFrame() {
    this.keysPressed.clear();
    this.mouse.wheel = 0;
  }

  /** Used by the rebinding UI: wait for the next key press. */
  static captureNextKey() {
    return new Promise((resolve) => {
      const handler = (e) => {
        e.preventDefault();
        window.removeEventListener('keydown', handler, true);
        resolve(e.code);
      };
      window.addEventListener('keydown', handler, true);
    });
  }
}
