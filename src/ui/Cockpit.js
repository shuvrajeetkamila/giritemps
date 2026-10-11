// ---------------------------------------------------------------------------
// Cockpit — full 3D cockpit interior: instrument panel with live gauges and
// needles, HUD combiner glass (the HUD canvas is projected on it), MFDs,
// throttle, stick, gloved hands, seat, canopy frame and rain on the glass.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, TAU, RNG } from '../core/Utils.js';
import { makeCanvas, canvasTexture } from '../render/Shading.js';
import { WORLD_LIGHT_UNIFORMS, injectWorldShading } from '../render/Shading.js';

const _v = new THREE.Vector3();

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + h - r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function gaugeFace(size, opts) {
  const c = makeCanvas(size, size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const s = size;
  ctx.clearRect(0, 0, s, s);
  // dial face
  const g = ctx.createRadialGradient(s * 0.5, s * 0.42, s * 0.05, s * 0.5, s * 0.5, s * 0.52);
  g.addColorStop(0, '#20242a');
  g.addColorStop(1, '#0b0d10');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.5, s * 0.48, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#3a4048';
  ctx.lineWidth = s * 0.02;
  ctx.stroke();
  // ticks
  const a0 = opts.startAngle, a1 = opts.endAngle;
  const ticks = opts.ticks || 10;
  for (let i = 0; i <= ticks; i++) {
    const t = i / ticks;
    const a = lerp(a0, a1, t);
    const major = i % (opts.majorEvery || 2) === 0;
    const r0 = s * 0.44, r1 = s * (major ? 0.33 : 0.375);
    ctx.strokeStyle = major ? '#dfe7ef' : '#8f9aa6';
    ctx.lineWidth = major ? s * 0.016 : s * 0.008;
    ctx.beginPath();
    ctx.moveTo(s * 0.5 + Math.sin(a) * r0, s * 0.5 - Math.cos(a) * r0);
    ctx.lineTo(s * 0.5 + Math.sin(a) * r1, s * 0.5 - Math.cos(a) * r1);
    ctx.stroke();
    if (major && opts.labels) {
      const lbl = opts.labels(i);
      if (lbl !== null) {
        ctx.fillStyle = '#cfd8e3';
        ctx.font = `600 ${Math.round(s * 0.085)}px Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lbl, s * 0.5 + Math.sin(a) * s * 0.245, s * 0.5 - Math.cos(a) * s * 0.245);
      }
    }
  }
  if (opts.title) {
    ctx.fillStyle = '#9fb0c0';
    ctx.font = `700 ${Math.round(s * 0.072)}px Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(opts.title, s * 0.5, s * 0.78);
  }
  if (opts.color) {
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = s * 0.02;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.44, a0 + (a1 - a0) * (opts.colorFrom || 0.75), a1);
    ctx.stroke();
  }
  return c;
}

function dialTexture(canvas) {
  const t = canvasTexture(canvas, { aniso: 4 });
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCockpit(spec, opts = {}) {
  const R = spec.shape;
  const group = new THREE.Group();
  group.name = 'cockpit';
  const panelColor = 0x1b1e23;
  const panelMat = new THREE.MeshStandardMaterial({ color: panelColor, roughness: 0.85, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.9, metalness: 0.1 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6d747c, roughness: 0.4, metalness: 0.8 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.2 });
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x3d4a3a, roughness: 0.9, metalness: 0.02 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x2d3329, roughness: 0.85, metalness: 0.03 });
  const glassHudMat = new THREE.MeshBasicMaterial({
    color: 0x9effc0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide
  });

  // ---- eye point
  const eye = new THREE.Vector3(0, R.canopy.y + 0.36, R.canopy.z - 0.28);
  const eyeObj = new THREE.Object3D();
  eyeObj.position.copy(eye);
  group.add(eyeObj);

  // ---- instrument panel
  const panelZ = R.canopy.z + 1.02;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 0.34), panelMat);
  panel.position.set(0, eye.y - 0.42, panelZ);
  panel.rotation.x = -0.16;
  group.add(panel);
  // glare shield
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.06, 0.46), darkMat);
  shield.position.set(0, eye.y - 0.11, panelZ + 0.02);
  shield.rotation.x = -0.12;
  group.add(shield);

  // ---- gauges
  const gauges = [];
  const faceDefs = [
    {
      id: 'airspeed', x: -0.52, y: 0.10, r: 0.115, max: 1,
      face: gaugeFace(256, {
        title: 'KTS', startAngle: -2.2, endAngle: 2.2, ticks: 10, majorEvery: 2,
        labels: (i) => String(i * 100)
      })
    },
    {
      id: 'attitude', x: -0.26, y: 0.10, r: 0.145, max: 1, dynamic: true
    },
    {
      id: 'altitude', x: 0.02, y: 0.10, r: 0.115, max: 1,
      face: gaugeFace(256, {
        title: 'FT x100', startAngle: -2.4, endAngle: 2.4, ticks: 10, majorEvery: 2,
        labels: (i) => String(i * 10)
      })
    },
    {
      id: 'vsi', x: 0.28, y: 0.10, r: 0.10, max: 1,
      face: gaugeFace(256, {
        title: 'VSI', startAngle: -2.0, endAngle: 2.0, ticks: 8, majorEvery: 2,
        labels: (i) => String((i - 4) * 1)
      })
    },
    {
      id: 'rpm', x: 0.53, y: 0.10, r: 0.10, max: 1,
      face: gaugeFace(256, { title: 'RPM %', startAngle: -2.3, endAngle: 2.3, ticks: 10, majorEvery: 2, labels: (i) => String(i * 10) })
    },
    {
      id: 'gload', x: -0.42, y: -0.20, r: 0.095, max: 1,
      face: gaugeFace(256, { title: 'G', startAngle: -1.6, endAngle: 1.6, ticks: 8, majorEvery: 1, labels: (i) => String(i - 4), color: '#ff5a4d', colorFrom: 0.75 })
    },
    {
      id: 'fuel', x: -0.16, y: -0.20, r: 0.095, max: 1,
      face: gaugeFace(256, { title: 'FUEL', startAngle: -2.2, endAngle: 2.2, ticks: 10, majorEvery: 2, labels: (i) => String(i * 10), color: '#ffc247', colorFrom: 0.85 })
    },
    {
      id: 'aoa', x: 0.10, y: -0.20, r: 0.095, max: 1,
      face: gaugeFace(256, { title: 'AOA', startAngle: -1.9, endAngle: 1.9, ticks: 8, majorEvery: 2, labels: (i) => String(i * 5) })
    },
    {
      id: 'clock', x: 0.36, y: -0.20, r: 0.09, max: 1,
      face: gaugeFace(256, { title: 'OAT', startAngle: -2.4, endAngle: 2.4, ticks: 8, majorEvery: 2, labels: (i) => String((i - 4) * 20) })
    }
  ];
  const gaugeGeo = new THREE.CircleGeometry(1, 24);
  for (const def of faceDefs) {
    let tex;
    let dynamicCanvas = null;
    if (def.dynamic) {
      dynamicCanvas = makeCanvas(256, 256);
      tex = canvasTexture(dynamicCanvas, { aniso: 2 });
      tex.colorSpace = THREE.SRGBColorSpace;
    } else {
      tex = dialTexture(def.face);
    }
    const face = new THREE.Mesh(gaugeGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    face.scale.setScalar(def.r);
    face.position.set(def.x, eye.y - 0.42 + def.y + 0.16, panelZ + 0.19);
    face.rotation.x = -0.16;
    group.add(face);
    // bezel
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(def.r, def.r * 0.11, 4, 20), darkMat);
    bezel.position.copy(face.position);
    bezel.rotation.copy(face.rotation);
    group.add(bezel);
    // needle
    const needle = new THREE.Mesh(new THREE.BoxGeometry(def.r * 0.05, def.r * 0.86, def.r * 0.05), new THREE.MeshStandardMaterial({
      color: 0xf2f5f8, roughness: 0.4, metalness: 0.2, emissive: 0x111111
    }));
    needle.geometry.translate(0, def.r * 0.36, 0);
    needle.position.copy(face.position);
    needle.position.z += 0.02;
    needle.rotation.copy(face.rotation);
    needle.userData.gauge = def.id;
    group.add(needle);
    gauges.push({ def, needle, dynamicCanvas, tex, value: 0 });
  }

  // ---- caution light panel
  const cautionCanvas = makeCanvas(512, 128);
  const cautionTex = canvasTexture(cautionCanvas, { aniso: 2 });
  cautionTex.colorSpace = THREE.SRGBColorSpace;
  const caution = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.16), new THREE.MeshBasicMaterial({ map: cautionTex, transparent: true, depthWrite: false }));
  caution.position.set(0, eye.y - 0.145, panelZ + 0.2);
  caution.rotation.x = -0.16;
  group.add(caution);

  // ---- MFDs
  const mfds = [];
  const mfdDefs = [
    { id: 'radar', x: -0.30, y: -0.09, w: 0.28, h: 0.20 },
    { id: 'stores', x: 0.02, y: -0.09, w: 0.20, h: 0.20 },
    { id: 'systems', x: 0.30, y: -0.09, w: 0.20, h: 0.20 }
  ];
  for (const d of mfdDefs) {
    const c = makeCanvas(256, 192);
    const tex = canvasTexture(c, { aniso: 2 });
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.position.set(d.x, eye.y - 0.40 + 0.02, panelZ + 0.2);
    mesh.rotation.x = -0.16;
    group.add(mesh);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(d.w + 0.03, d.h + 0.03, 0.02), darkMat);
    bez.position.copy(mesh.position);
    bez.position.z -= 0.012;
    bez.rotation.copy(mesh.rotation);
    group.add(bez);
    mfds.push({ def: d, canvas: c, ctx: c.getContext('2d'), tex, value: 0, timer: 0 });
  }

  // ---- HUD combiner glass
  const hudCanvas = makeCanvas(1024, 1024);
  const hudTex = canvasTexture(hudCanvas, { aniso: 2 });
  hudTex.colorSpace = THREE.SRGBColorSpace;
  const hudGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), glassHudMat.clone());
  hudGlass.material.map = hudTex;
  hudGlass.material.color.setHex(0x8cffb4);
  hudGlass.position.set(0, eye.y + 0.11, panelZ - 0.14);
  hudGlass.rotation.x = -0.06;
  hudGlass.renderOrder = 20;
  group.add(hudGlass);
  const hudFrameMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.8, metalness: 0.2, transparent: true, opacity: 0.9 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.42, 0.03), hudFrameMat);
    post.position.set(sx * 0.245, eye.y + 0.10, panelZ - 0.14);
    post.rotation.x = -0.06;
    group.add(post);
  }

  // ---- side consoles
  for (const sx of [-1, 1]) {
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.34, 0.86), panelMat);
    console_.position.set(sx * 0.58, eye.y - 0.52, R.canopy.z - 0.1);
    group.add(console_);
    const knobs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 6), metalMat, 12);
    let i = 0;
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 3; b++) {
        const m = new THREE.Matrix4();
        m.makeTranslation(sx * 0.5, eye.y - 0.36, R.canopy.z - 0.42 + a * 0.22 + b * 0.06);
        knobs.setMatrixAt(i++, m);
      }
    }
    knobs.instanceMatrix.needsUpdate = true;
    group.add(knobs);
  }

  // ---- seat, harness, pedals
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), darkMat);
  seat.position.set(0, eye.y - 0.62, R.canopy.z - 0.72);
  group.add(seat);
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.09), darkMat);
  backrest.position.set(0, eye.y - 0.34, R.canopy.z - 0.98);
  backrest.rotation.x = 0.16;
  group.add(backrest);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.16), darkMat);
  headrest.position.set(0, eye.y + 0.06, R.canopy.z - 1.02);
  group.add(headrest);
  // pilot body (visible lap/legs)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 4, 10), suitMat);
  torso.position.set(0, eye.y - 0.46, R.canopy.z - 0.72);
  group.add(torso);
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.42, 4, 8), suitMat);
    thigh.position.set(sx * 0.16, eye.y - 0.60, R.canopy.z - 0.34);
    thigh.rotation.x = 1.5;
    group.add(thigh);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.22), metalMat);
    pedal.position.set(sx * 0.2, eye.y - 0.74, R.canopy.z + 0.34);
    group.add(pedal);
  }

  // ---- control stick
  const stickPivot = new THREE.Object3D();
  stickPivot.position.set(0, eye.y - 0.62, R.canopy.z - 0.16);
  group.add(stickPivot);
  const stickShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.34, 8), metalMat);
  stickShaft.position.y = 0.17;
  stickPivot.add(stickShaft);
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.13, 4, 10), gripMat);
  grip.position.y = 0.4;
  stickPivot.add(grip);
  const gripTop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.6 }));
  gripTop.position.y = 0.45;
  gripTop.userData.GUN = true;
  stickPivot.add(gripTop);
  // right hand on the stick
  const handR = makeHand(gloveMat, 1);
  handR.position.set(0.01, 0.4, 0.0);
  handR.rotation.z = 0.5;
  stickPivot.add(handR);

  // ---- throttle
  const throttlePivot = new THREE.Object3D();
  throttlePivot.position.set(clamp(R.stations ? 0.44 : 0.42, 0.3, 0.6) * 1.05, eye.y - 0.56, R.canopy.z - 0.42);
  group.add(throttlePivot);
  const throttleRail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.4), metalMat);
  throttleRail.position.set(0, -0.02, 0.06);
  throttlePivot.add(throttleRail);
  const throttleGrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.1, 4, 8), gripMat);
  throttleGrip.rotation.x = Math.PI / 2 - 0.3;
  throttleGrip.position.set(0, 0.02, 0.02);
  throttlePivot.add(throttleGrip);
  const handL = makeHand(gloveMat, -1);
  handL.position.set(-0.03, 0.03, 0.02);
  handL.rotation.set(0.7, -0.4, 0.9);
  throttlePivot.add(handL);

  // ---- canopy glass reflections + rain droplets
  const rainGroup = new THREE.Group();
  const dropTex = makeDropletTexture();
  const dropGeo = new THREE.PlaneGeometry(1, 1);
  const drops = [];
  const rng = new RNG(99);
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(dropGeo, new THREE.MeshBasicMaterial({
      map: dropTex, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    const s = rng.float(0.012, 0.05);
    m.scale.set(s, s * rng.float(1.1, 2.1), 1);
    m.position.set(rng.float(-0.42, 0.42), rng.float(-0.2, 0.42), 0);
    m.userData.speed = rng.float(0.05, 0.35);
    m.userData.baseY = m.position.y;
    m.userData.baseX = m.position.x;
    m.userData.seed = rng.float(0, 10);
    rainGroup.add(m);
    drops.push(m);
  }
  rainGroup.position.set(0, eye.y + 0.06, R.canopy.z + 0.42);
  rainGroup.rotation.x = -0.42;
  rainGroup.visible = false;
  group.add(rainGroup);

  // ---- lighting inside the cockpit is handled by the world sun + ambient

  const api = {
    group,
    eye,
    gauges,
    mfds,
    hudGlass,
    hudTex,
    hudCanvas,
    hudCtx: hudCanvas ? hudCanvas.getContext('2d') : null,
    caution, cautionCtx: cautionCanvas.getContext('2d'),
    stickPivot, throttlePivot, handR, handL, rainGroup, drops,
    eyeObj,
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m && m.map) m.map.dispose(); if (m && m.dispose) m.dispose(); }
        }
      });
    }
  };
  // shading injection for the interior
  const uniforms = Object.assign({}, opts.csmUniforms || {}, WORLD_LIGHT_UNIFORMS);
  group.traverse((o) => {
    if (o.isMesh && o.material && (o.material.isMeshStandardMaterial || o.material.isMeshPhysicalMaterial)) {
      injectWorldShading(o.material, uniforms);
    }
  });
  return api;
}

function makeHand(mat, side) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.045), mat);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 3, 6), mat);
    f.position.set((i - 1.5) * 0.017, 0.062, 0.0);
    f.rotation.x = -0.5;
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 3, 6), mat);
  thumb.position.set(side * 0.04, 0.02, 0.01);
  thumb.rotation.z = side * 0.8;
  g.add(thumb);
  return g;
}

function makeDropletTexture() {
  const c = makeCanvas(64, 64);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(200,230,255,0.35)');
  g.addColorStop(1, 'rgba(180,215,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(32, 32, 26, 30, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(32, 32, 22, 26, 0, 0, TAU);
  ctx.stroke();
  return canvasTexture(c, { aniso: 1 });
}

// ---------------------------------------------------------------------------
// Live gauge + MFD updates
// ---------------------------------------------------------------------------
export function updateCockpit(cockpit, dt, s, spec, world) {
  if (!cockpit) return;
  const g = cockpit.gauges;
  const setNeedle = (id, frac, maxAngle) => {
    const gauge = g.find((x) => x.def.id === id);
    if (!gauge) return;
    const clamped = clamp01(frac);
    const a0 = gauge.def.id === 'gload' ? -1.6 : -2.2;
    const a1 = gauge.def.id === 'gload' ? 1.6 : 2.2;
    gauge.needle.rotation.z = -lerp(a0, a1, clamped);
  };
  setNeedle('airspeed', (s.speedKts || 0) / 1000);
  setNeedle('altitude', ((s.altitudeFt || 0) / 1000) / 100);
  setNeedle('vsi', clamp01(0.5 + (s.verticalSpeed || 0) / 120));
  setNeedle('rpm', (s.throttle || 0) * 0.85 + (s.ab ? 0.15 : 0));
  setNeedle('gload', ((s.gLoad || 1) + 4) / 12);
  setNeedle('fuel', s.fuel || 0);
  setNeedle('aoa', clamp01((s.aoa || 0) / 40));
  setNeedle('clock', clamp01(0.5 + (world && world.env ? (world.env.tempAt(s.altitude || 0) + 30) / 80 : 0.5)));

  // artificial horizon
  const att = g.find((x) => x.def.id === 'attitude');
  if (att && att.dynamicCanvas) {
    const ctx = att.dynamicCanvas.getContext('2d');
    const S = 256;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.47, 0, TAU); ctx.clip();
    const pitchPx = (s.pitch || 0) * 2.2;
    const roll = -(s.bank || 0) * 57.3;
    ctx.translate(S / 2, S / 2 + pitchPx);
    ctx.rotate(roll * Math.PI / 180);
    const sky = ctx.createLinearGradient(0, -S, 0, 0);
    sky.addColorStop(0, '#1d4a86'); sky.addColorStop(1, '#5b9bd5');
    ctx.fillStyle = sky;
    ctx.fillRect(-S, -S, S * 2, S);
    const grd = ctx.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, '#7a5a34'); grd.addColorStop(1, '#3b2c1a');
    ctx.fillStyle = grd;
    ctx.fillRect(-S, 0, S * 2, S);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-S, 0); ctx.lineTo(S, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.6;
    ctx.font = '600 11px Menlo, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    for (let d = -30; d <= 30; d += 10) {
      if (d === 0) continue;
      const y = -d * 2.6;
      ctx.beginPath();
      ctx.moveTo(-22, y); ctx.lineTo(22, y);
      ctx.stroke();
      ctx.fillText(String(Math.abs(d)), -32, y + 4);
    }
    ctx.restore();
    // roll pointer + aircraft symbol
    ctx.save();
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - 40, S * 0.5);
    ctx.lineTo(S * 0.5 - 12, S * 0.5);
    ctx.moveTo(S * 0.5 + 12, S * 0.5);
    ctx.lineTo(S * 0.5 + 40, S * 0.5);
    ctx.moveTo(S * 0.5, S * 0.5 - 6);
    ctx.lineTo(S * 0.5, S * 0.5 + 8);
    ctx.stroke();
    ctx.fillStyle = '#ffcc44';
    ctx.beginPath();
    ctx.arc(S * 0.5, S * 0.5 - 34, 3.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.47, 0, TAU);
    ctx.stroke();
    ctx.restore();
    att.tex.needsUpdate = true;
  }

  // caution panel
  const warnIds = new Set((s.warnings || []).map((w) => w.id));
  const lamps = [
    ['MASTER', s.damaged > 0.25], ['ENGINE', (s.damaged || 0) > 0.4], ['FUEL', (s.fuel || 1) < 0.2],
    ['HYD', (s.damaged || 0) > 0.6], ['STALL', warnIds.has('stall')], ['PULL UP', warnIds.has('pullup')],
    ['MISSILE', warnIds.has('missile')], ['GUN', warnIds.has('gunjam')], ['AMMO', warnIds.has('noammo')],
    ['GEAR', !s.gear && warnIds.has('gear')], ['FIRE', (s.damaged || 0) > 0.75], ['OXY', false]
  ];
  const cc = cockpit.cautionCtx;
  if (cc) {
    cc.clearRect(0, 0, 512, 128);
    cc.fillStyle = 'rgba(8,10,12,0.92)';
    roundRect(cc, 0, 0, 512, 128, 10);
    cc.fill();
    cc.strokeStyle = '#2b3138';
    cc.lineWidth = 3;
    cc.stroke();
    lamps.forEach(([label, on], i) => {
      const col = i % 6, row = Math.floor(i / 6);
      const x = 12 + col * 82, y = 12 + row * 54;
      const isMaster = i === 0;
      const active = on || (isMaster && lamps.some(([, v], j) => j > 0 && v));
      cc.fillStyle = active ? (isMaster ? '#ff3b30' : '#ffb020') : '#1b1f24';
      roundRect(cc, x, y, 76, 44, 5);
      cc.fill();
      cc.strokeStyle = active ? 'rgba(255,255,255,0.7)' : '#333a42';
      cc.lineWidth = 2;
      cc.stroke();
      cc.fillStyle = active ? '#140c02' : '#4d555e';
      cc.font = '700 15px Menlo, Consolas, monospace';
      cc.textAlign = 'center';
      cc.textBaseline = 'middle';
      cc.fillText(label, x + 38, y + 23);
    });
    cockpit.caution.material.map.needsUpdate = true;
  }

  // MFDs
  for (const mfd of cockpit.mfds) {
    mfd.timer -= dt;
    if (mfd.timer > 0) continue;
    mfd.timer = mfd.def.id === 'systems' ? 0.5 : 0.1;
    const ctx = mfd.ctx;
    const W = mfd.canvas.width, H = mfd.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#04120a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1f6b3a';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    if (mfd.def.id === 'radar') {
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.44;
      ctx.strokeStyle = '#2f8f52';
      ctx.lineWidth = 1.4;
      for (const f of [0.33, 0.66]) { ctx.beginPath(); ctx.arc(cx, cy, r * f, 0, TAU); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      for (const c of (s.radarContacts || [])) {
        const px = cx + c.x * r, py = cy + c.y * r;
        if (Math.hypot(px - cx, py - cy) > r) continue;
        ctx.fillStyle = c.ground ? '#ffc247' : (c.hostile ? '#ff4d40' : '#4fd2ff');
        if (c.ground) ctx.fillRect(px - 2, py - 2, 5, 5);
        else { ctx.beginPath(); ctx.arc(px, py, c.hostile ? 3.4 : 2.6, 0, TAU); ctx.fill(); }
        if (c.locked) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.strokeRect(px - 7, py - 7, 14, 14); }
      }
      ctx.fillStyle = '#7dff9b';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 5, cy + 6); ctx.lineTo(cx - 5, cy + 6);
      ctx.closePath(); ctx.fill();
      ctx.font = '600 13px Menlo, monospace';
      ctx.fillStyle = '#4fd2ff';
      ctx.textAlign = 'left';
      ctx.fillText(`RDR ${(s.lockRange ? (s.lockRange / 1000).toFixed(1) + 'KM' : 'SEARCH')}`, 8, 18);
    } else if (mfd.def.id === 'stores') {
      ctx.font = '600 15px Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#7dff9b';
      ctx.fillText('STORES', 8, 20);
      let y = 44;
      for (const w of (s.weapons || [])) {
        ctx.fillStyle = w.count > 0 || w.ammo > 0 ? '#bfffd2' : '#5a6a60';
        ctx.font = '600 14px Menlo, monospace';
        ctx.fillText(w.name.slice(0, 12), 8, y);
        ctx.textAlign = 'right';
        ctx.fillText(w.key === 'gun' ? String(w.ammo) : String(w.count), W - 8, y);
        ctx.textAlign = 'left';
        y += 20;
      }
      ctx.fillStyle = '#7dff9b';
      ctx.font = '600 13px Menlo, monospace';
      ctx.fillText(`FLR ${s.flares || 0}  CHF ${s.chaff || 0}`, 8, H - 10);
    } else {
      ctx.font = '600 15px Menlo, monospace';
      ctx.fillStyle = '#7dff9b';
      ctx.textAlign = 'left';
      ctx.fillText('SYSTEMS', 8, 20);
      const rows = [
        ['ENG L', 1 - (s.damaged || 0) * 0.6], ['ENG R', 1 - (s.damaged || 0) * 0.6],
        ['HYD', 1 - (s.damaged || 0) * 0.8], ['FUEL', s.fuel || 0],
        ['RDR', 0.9], ['WING', 1 - (s.damaged || 0) * 0.5]
      ];
      let y = 44;
      for (const [label, v] of rows) {
        ctx.fillStyle = '#9fe8b8';
        ctx.font = '600 13px Menlo, monospace';
        ctx.fillText(label, 8, y);
        ctx.fillStyle = v > 0.6 ? '#4fd2ff' : (v > 0.3 ? '#ffc247' : '#ff4d40');
        ctx.fillRect(60, y - 10, Math.max(2, (v) * (W - 74)), 10);
        y += 22;
      }
    }
    mfd.tex.needsUpdate = true;
  }

  // stick + throttle + hands animation
  if (cockpit.stickPivot) {
    cockpit.stickPivot.rotation.x = damp(cockpit.stickPivot.rotation.x, clamp(s.pitchInput || 0, -1, 1) * 0.22, 8, dt);
    cockpit.stickPivot.rotation.z = damp(cockpit.stickPivot.rotation.z, clamp(s.rollInput || 0, -1, 1) * 0.3, 8, dt);
    cockpit.handR.rotation.x = cockpit.stickPivot.rotation.x;
  }
  if (cockpit.throttlePivot) {
    cockpit.throttlePivot.rotation.x = damp(cockpit.throttlePivot.rotation.x, -(0.12 + (s.throttle || 0) * 0.55), 5, dt);
  }
  // rain on the canopy
  const wet = clamp01(s.canopyRain || 0);
  if (cockpit.rainGroup) {
    cockpit.rainGroup.visible = wet > 0.05;
    if (wet > 0.05) {
      for (const d of cockpit.drops) {
        d.material.opacity = clamp01(wet * (0.55 + Math.sin(world.time * 2 + d.userData.seed) * 0.2));
        d.userData.speed = d.userData.speed || 0.2;
        d.position.y -= dt * d.userData.speed * (0.35 + wet * 0.65);
        if (d.position.y < -0.3) {
          d.position.y = d.userData.baseY * 0.9 + 0.2;
          d.position.x = d.userData.baseX;
        }
      }
    }
  }
  // subtle cockpit shake
  if (world && world.cockpitShake) {
    cockpit.group.position.x = world.cockpitShake.x;
    cockpit.group.position.y = world.cockpitShake.y;
    cockpit.group.position.z = world.cockpitShake.z;
  }
}
