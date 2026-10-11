// On-screen touch controls for phones and tablets: a virtual stick (pitch/roll), a throttle lever
// and action buttons. Created only on touch devices. Exposes the same action names as the keyboard
// bindings, so the game reads touch and keys through the same functions (see input.js).
const state = { axis: { pitch: 0, roll: 0 }, throttle: null, down: new Set(), pressed: new Set() };
let root = null;
let visible = false;

export function touchDown(action) { return state.down.has(action); }
export function touchPressed(action) { return state.pressed.has(action); }
export function touchAxis() { return state.axis; }
export function touchThrottle() { return state.throttle; }
export function endTouchFrame() { state.pressed.clear(); }
export function isTouchDevice() {
  return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

export function setTouchVisible(on) {
  if (!root || on === visible) return;
  visible = on;
  root.style.display = on ? 'block' : 'none';
}

// Action buttons: [action, label, css position, mode] where mode is 'hold' or 'tap'.
const BUTTONS = [
  ['fireGun', 'GUN', 'right:20px;bottom:20px;width:96px;height:96px', 'hold'],
  ['fireMissile', 'MSL', 'right:130px;bottom:30px;width:72px;height:72px', 'tap'],
  ['fireRocket', 'RKT', 'right:20px;bottom:130px;width:64px;height:64px', 'tap'],
  ['dropBomb', 'BMB', 'right:100px;bottom:120px;width:64px;height:64px', 'tap'],
  ['flare', 'FLR', 'right:210px;bottom:120px;width:56px;height:56px', 'tap'],
  ['chaff', 'CHF', 'right:200px;bottom:20px;width:56px;height:56px', 'tap'],
  ['afterburner', 'AB', 'right:270px;bottom:30px;width:60px;height:60px', 'tap'],
  ['cycleTarget', 'TGT', 'right:270px;top:120px;width:58px;height:58px', 'tap'],
  ['cycleWeapon', 'WPN', 'right:270px;top:190px;width:58px;height:58px', 'tap'],
  ['cameraView', 'VIEW', 'right:270px;top:260px;width:58px;height:58px', 'tap'],
  ['gear', 'GEAR', 'left:20px;top:120px;width:58px;height:58px', 'tap'],
  ['pause', 'II', 'right:12px;top:12px;width:44px;height:44px', 'tap'],
];

function style(el, pos) {
  el.style.cssText += `;position:absolute;${pos};border-radius:50%;border:2px solid rgba(125,255,161,.7);background:rgba(10,30,18,.45);color:#7dffa1;font:bold 13px monospace;display:flex;align-items:center;justify-content:center;user-select:none;touch-action:none;`;
}

export function initTouch() {
  if (root || !isTouchDevice()) return;
  root = document.createElement('div');
  root.id = 'touch';
  root.style.cssText = 'position:fixed;inset:0;z-index:5;display:none;pointer-events:none;touch-action:none;';
  document.body.appendChild(root);

  // Virtual stick: drag anywhere on the lower-left area.
  const stick = document.createElement('div');
  stick.style.cssText = 'position:absolute;left:0;bottom:0;width:45%;height:60%;pointer-events:auto;touch-action:none;';
  const knob = document.createElement('div');
  knob.style.cssText = 'position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(125,255,161,.35);border:2px solid #7dffa1;display:none;pointer-events:none;';
  stick.appendChild(knob);
  root.appendChild(stick);
  let sid = null, cx = 0, cy = 0;
  const R = 70;
  const moveStick = (x, y) => {
    const dx = Math.max(-R, Math.min(R, x - cx)), dy = Math.max(-R, Math.min(R, y - cy));
    state.axis.roll = dx / R;
    state.axis.pitch = -dy / R;
    knob.style.left = cx + dx - stick.getBoundingClientRect().left + 'px';
    knob.style.top = cy + dy - stick.getBoundingClientRect().top + 'px';
  };
  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId; stick.setPointerCapture(sid);
    cx = e.clientX; cy = e.clientY;
    knob.style.display = 'block';
    knob.style.left = (e.clientX - stick.getBoundingClientRect().left) + 'px';
    knob.style.top = (e.clientY - stick.getBoundingClientRect().top) + 'px';
    moveStick(e.clientX, e.clientY);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e.clientX, e.clientY); });
  const endStick = (e) => {
    if (e.pointerId !== sid) return;
    sid = null; state.axis.pitch = 0; state.axis.roll = 0; knob.style.display = 'none';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // Throttle lever on the left edge: drag up for more power. Holds its last value.
  const thr = document.createElement('div');
  thr.style.cssText = 'position:absolute;left:14px;top:18%;width:44px;height:60%;border:2px solid rgba(125,255,161,.6);border-radius:10px;background:rgba(10,30,18,.4);pointer-events:auto;touch-action:none;';
  const fill = document.createElement('div');
  fill.style.cssText = 'position:absolute;left:6px;right:6px;bottom:6px;height:50%;background:rgba(125,255,161,.5);border-radius:6px;';
  thr.appendChild(fill);
  const label = document.createElement('div');
  label.style.cssText = 'position:absolute;left:0;right:0;top:-22px;text-align:center;color:#7dffa1;font:bold 12px monospace;';
  label.textContent = 'THR';
  thr.appendChild(label);
  root.appendChild(thr);
  let tid = null;
  const setThr = (y) => {
    const r = thr.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, 1 - (y - r.top) / r.height));
    state.throttle = v;
    fill.style.height = `calc(${(v * 100).toFixed(0)}% - 12px)`;
  };
  thr.addEventListener('pointerdown', (e) => { tid = e.pointerId; thr.setPointerCapture(tid); setThr(e.clientY); e.preventDefault(); });
  thr.addEventListener('pointermove', (e) => { if (e.pointerId === tid) setThr(e.clientY); });
  const endThr = (e) => { if (e.pointerId === tid) tid = null; };
  thr.addEventListener('pointerup', endThr);
  thr.addEventListener('pointercancel', endThr);

  // Action buttons.
  for (const [action, text, pos, mode] of BUTTONS) {
    const b = document.createElement('div');
    b.textContent = text;
    style(b, pos);
    b.style.pointerEvents = 'auto';
    const press = (e) => {
      e.preventDefault();
      if (mode === 'hold') state.down.add(action);
      else state.pressed.add(action);
      b.style.background = 'rgba(125,255,161,.35)';
      b.setPointerCapture && b.setPointerCapture(e.pointerId);
    };
    const release = () => {
      if (mode === 'hold') state.down.delete(action);
      b.style.background = 'rgba(10,30,18,.45)';
    };
    b.addEventListener('pointerdown', press);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('pointerleave', release);
    root.appendChild(b);
  }
}
