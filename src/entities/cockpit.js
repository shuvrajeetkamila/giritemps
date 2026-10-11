// First-person cockpit: canopy frame, instrument panel, radar scope, stick/throttle hands and a
// rear-view mirror fed by a second camera. Cockpit meshes live on layer 1 (only the main camera
// sees them, so the mirror camera does not show the interior).
import * as THREE from 'three';

const COCKPIT_LAYER = 1;

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext('2d'), tex };
}

export class Cockpit {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'cockpit';
    scene.add(this.group);

    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.8, metalness: 0.2 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.5, metalness: 0.5 });

    // Dashboard and glare shield.
    const dash = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 0.9), panelMat);
    dash.position.set(0, -0.95, -1.05);
    this.group.add(dash);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 1.0), frameMat);
    shield.position.set(0, -0.48, -1.15);
    this.group.add(shield);

    // Canopy bows and windscreen frame (edges only, so the view stays open).
    const bow = (x0, y0, z0, x1, y1, z1) => {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), frameMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      m.lookAt(x1, y1, z1);
      m.rotateX(Math.PI / 2);
      this.group.add(m);
    };
    bow(-1.2, -0.3, -0.7, 0, 0.9, -0.8);
    bow(1.2, -0.3, -0.7, 0, 0.9, -0.8);
    bow(-1.2, -0.3, -0.7, -0.5, -0.2, -1.8);
    bow(1.2, -0.3, -0.7, 0.5, -0.2, -1.8);
    bow(0, 0.9, -0.8, 0, -0.1, -1.9);
    bow(-0.9, -0.5, -1.9, 0.9, -0.5, -1.9);

    // Instrument panel texture (altimeter, attitude ball, RPM, fuel).
    this.instr = canvasTex(768, 384);
    const ip = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: this.instr.tex, toneMapped: false }));
    ip.position.set(0, -0.62, -1.46);
    ip.rotation.x = -0.35;
    this.group.add(ip);

    // Radar scope on the centre console.
    this.radar = canvasTex(256, 256);
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: this.radar.tex, toneMapped: false }));
    rs.position.set(0, -0.82, -1.55);
    rs.rotation.x = -0.6;
    this.group.add(rs);

    // Stick and throttle with hands.
    this.stick = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8), frameMat);
    shaft.position.y = 0.2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    grip.position.y = 0.42;
    this.stick.add(shaft, grip);
    this.stick.position.set(0.35, -0.5, -1.1);
    this.group.add(this.stick);
    this.throttle = new THREE.Group();
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.05), frameMat);
    lever.position.y = 0.12;
    this.throttle.add(lever);
    this.throttle.position.set(-0.5, -0.55, -1.1);
    this.group.add(this.throttle);
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89878, roughness: 0.8 });
    this.hands = [];
    for (const side of [-1, 1]) {
      const h = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.5), skin);
      arm.position.set(0, -0.04, 0.25);
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.16), skin);
      h.add(arm, fist);
      h.position.set(side * 0.45, -0.85, -0.7);
      this.group.add(h);
      this.hands.push(h);
    }

    // Rear-view mirror: plane at the top of the canopy showing the rear camera.
    this.mirrorRT = new THREE.WebGLRenderTarget(512, 192, { samples: 0 });
    const mirrorMat = new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture, toneMapped: false });
    this.mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), mirrorMat);
    this.mirror.position.set(0, 0.62, -1.0);
    this.group.add(this.mirror);
    this.rearCam = new THREE.PerspectiveCamera(35, 512 / 192, 1, 40000);
    this.rearCam.layers.set(0);

    this.blips = [];
    this.gaugeT = 0;
    this.visible = false;
    this.group.visible = false;
    this.lastAlt = 0;
    this.group.traverse((o) => o.layers.set(COCKPIT_LAYER));
  }

  setActive(on) {
    this.visible = on;
    this.group.visible = on;
  }

  // Place cockpit meshes relative to the aircraft. Called each frame when active.
  place(pos, quat, cockpitLocal) {
    this.group.position.copy(pos).add(cockpitLocal.clone().applyQuaternion(quat));
    this.group.quaternion.copy(quat);
  }

  // Update stick/throttle/hand positions from control state.
  setControls(ctrl, throttle) {
    this.stick.rotation.x = -ctrl.pitch * 0.3;
    this.stick.rotation.z = -ctrl.roll * 0.3;
    this.throttle.position.y = -0.55 + 0.0;
    this.throttle.rotation.x = -(throttle - 0.5) * 0.9;
    this.hands[1].position.x = 0.35 + ctrl.roll * 0.04;
    this.hands[1].position.y = -0.85 + ctrl.pitch * 0.03;
    this.hands[0].position.x = -0.45 + (throttle - 0.5) * 0.05;
  }

  // Draw the instrument panel and radar. data: { airspeed, altitude, heading, pitch, roll, throttle, fuel, rpm,
  // contacts: [{x,y,team}], range, mirror }.
  drawInstruments(d) {
    this.gaugeT -= 1;
    const g = this.instr.g, W = this.instr.c.width, H = this.instr.c.height;
    g.fillStyle = '#0a0d0c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#2e3b33'; g.lineWidth = 2;
    const drawDial = (cx, cy, r, value, max, label, color, unit) => {
      g.beginPath(); g.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI); g.stroke();
      g.fillStyle = '#7fcf8a'; g.font = `${Math.round(r * 0.22)}px monospace`; g.textAlign = 'center';
      g.fillText(label, cx, cy + r * 0.65);
      g.fillText(unit, cx, cy + r * 0.85);
      const a = 0.75 * Math.PI + (Math.min(max, Math.max(0, value)) / max) * 1.5 * Math.PI;
      g.strokeStyle = color; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85); g.stroke();
      g.strokeStyle = '#2e3b33'; g.lineWidth = 2;
    };
    // Altimeter.
    drawDial(120, 120, 100, (d.altitude % 10000) / 10000 * 10000, 10000, 'ALT', '#c8f7d0', 'ft');
    // Airspeed.
    drawDial(380, 120, 90, d.airspeed, 1200, 'KTS', '#ffd27a', 'kt');
    // RPM / throttle.
    drawDial(620, 120, 80, d.throttle * 100, 100, 'RPM', '#8fd3ff', '%');
    // Fuel.
    drawDial(660, 300, 60, d.fuel, 100, 'FUEL', d.fuel < 15 ? '#ff6666' : '#7fcf8a', '%');
    // Attitude ball (artificial horizon).
    const ax = 260, ay = 240, ar = 110;
    g.save();
    g.beginPath(); g.arc(ax, ay, ar, 0, Math.PI * 2); g.clip();
    g.translate(ax, ay);
    g.rotate(-d.roll * Math.PI / 180);
    const off = d.pitch * 3.0;
    g.fillStyle = '#2a6fb0'; g.fillRect(-ar * 2, -ar * 2 + off, ar * 4, ar * 2);
    g.fillStyle = '#8a5a2c'; g.fillRect(-ar * 2, off, ar * 4, ar * 2);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-ar * 2, off); g.lineTo(ar * 2, off); g.stroke();
    g.restore();
    g.strokeStyle = '#ffdd55'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ax - 40, ay); g.lineTo(ax - 12, ay); g.lineTo(ax, ay + 8); g.lineTo(ax + 12, ay); g.lineTo(ax + 40, ay); g.stroke();
    g.strokeStyle = '#2e3b33'; g.lineWidth = 2; g.beginPath(); g.arc(ax, ay, ar, 0, Math.PI * 2); g.stroke();
    // Heading strip.
    g.fillStyle = '#c8f7d0'; g.font = '22px monospace'; g.textAlign = 'center';
    g.fillText('HDG ' + String(Math.round(d.heading)).padStart(3, '0'), 512, 60);
    g.fillStyle = d.warn ? '#ff5050' : '#7fcf8a';
    g.fillText(d.warn || '', 512, 360);
    this.instr.tex.needsUpdate = true;

    // Radar scope: rotating sweep and blips.
    const r = this.radar, S = this.radar.c.width, cx = S / 2;
    r.g.fillStyle = 'rgba(0,20,6,0.85)'; r.g.fillRect(0, 0, S, S);
    r.g.strokeStyle = 'rgba(80,255,120,0.35)'; r.g.lineWidth = 1;
    for (const f of [0.33, 0.66, 1]) { r.g.beginPath(); r.g.arc(cx, cx, cx * f - 2, 0, Math.PI * 2); r.g.stroke(); }
    r.g.beginPath(); r.g.moveTo(cx, 0); r.g.lineTo(cx, S); r.g.moveTo(0, cx); r.g.lineTo(S, cx); r.g.stroke();
    const sweep = (performance.now() / 1500) % (Math.PI * 2);
    r.g.strokeStyle = 'rgba(80,255,120,0.9)';
    r.g.beginPath(); r.g.moveTo(cx, cx); r.g.lineTo(cx + Math.cos(sweep) * cx, cx + Math.sin(sweep) * cx); r.g.stroke();
    for (const c of d.contacts || []) {
      const k = Math.min(1, Math.hypot(c.x, c.z) / (d.range || 15000));
      const ang = Math.atan2(c.x, -c.z);
      const px = cx + Math.sin(ang) * k * (cx - 6), py = cx - Math.cos(ang) * k * (cx - 6);
      r.g.fillStyle = c.team === 'enemy' ? '#ff4c4c' : c.team === 'ally' ? '#4c9bff' : '#88ff99';
      r.g.beginPath(); r.g.arc(px, py, c.locked ? 6 : 4, 0, Math.PI * 2); r.g.fill();
    }
    r.tex.needsUpdate = true;
  }
}

export const COCKPIT_LAYER_ID = COCKPIT_LAYER;
