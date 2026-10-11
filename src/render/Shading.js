// ---------------------------------------------------------------------------
// Shading — shared uniform blocks, procedural texture factories and helpers to
// inject sky lighting / cascaded shadows into three's standard materials.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { GLSL_SHADOWS } from '../core/glsl.js';
import { RNG, clamp01, clamp } from '../core/Utils.js';

// ---------------------------------------------------------------------------
// Shared uniform blocks (referenced by reference from every material)
// ---------------------------------------------------------------------------
export const skyUniforms = {
  sunDirection: { value: new THREE.Vector3(0.3, 0.6, 0.2).normalize() },
  sunColor: { value: new THREE.Color(1, 0.96, 0.9) },
  sunIntensity: { value: 3.0 },
  moonDirection: { value: new THREE.Vector3(0, 1, 0) },
  skyZenith: { value: new THREE.Color(0.18, 0.42, 0.85) },
  skyHorizon: { value: new THREE.Color(0.55, 0.72, 0.95) },
  skyGround: { value: new THREE.Color(0.28, 0.26, 0.24) },
  ambientUp: { value: new THREE.Color(0.35, 0.5, 0.75) },
  ambientDown: { value: new THREE.Color(0.18, 0.16, 0.14) },
  ambientIntensity: { value: 0.55 },
  fogColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
  fogDensity: { value: 0.000075 },
  fogHeightFalloff: { value: 0.00042 },
  sunElev: { value: 0.5 },
  timeOfDay: { value: 12 },
  exposure: { value: 1.0 },
  nightFactor: { value: 0 },
  stormFactor: { value: 0 },
  wetness: { value: 0 },
  cloudCoverage: { value: 0.45 },
  cloudShadowStrength: { value: 0.4 },
  windDir: { value: new THREE.Vector2(1, 0.3) },
  windSpeed: { value: 8 },
  cameraPos: { value: new THREE.Vector3() },
  fogAerial: { value: new THREE.Vector4(0.000075, 0.00042, 1, 0) }
};

// Uniform objects shared with every custom material
export function fogUniforms() {
  return {
    sunDirection: skyUniforms.sunDirection,
    sunColor: skyUniforms.sunColor,
    cameraPos: skyUniforms.cameraPos,
    fogColorHorizon: skyUniforms.skyHorizon,
    fogColorZenith: skyUniforms.skyZenith,
    sunTint: skyUniforms.sunColor,
    fogParams: skyUniforms.fogAerial,
    stormFactor: skyUniforms.stormFactor,
    nightFactor: skyUniforms.nightFactor,
    timeOfDay: skyUniforms.timeOfDay
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
export function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(canvas, opts = {}) {
  if (!canvas) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = opts.wrap || THREE.RepeatWrapping;
  t.wrapT = opts.wrap || THREE.RepeatWrapping;
  t.anisotropy = opts.aniso || 4;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Terrain detail: 4-layer texture ARRAY (grass / rock / sand / snow).
// Height (for bump) is stored in the alpha channel of each layer.
// ---------------------------------------------------------------------------
export function buildTerrainTextureArray(size = 256, seed = 7) {
  if (typeof document === 'undefined') return null;
  const layers = 4;
  const data = new Uint8Array(size * size * layers * 4);
  for (let l = 0; l < layers; l++) {
    const img = renderTile(size, seed + l * 977, l);
    data.set(img, l * size * size * 4);
  }
  const tex = new THREE.DataArrayTexture(data, size, size, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function renderTile(S, seed, layer) {
  const rng = new RNG(seed);
  const out = new Uint8Array(S * S * 4);
  const gx = 6, gy = 6;
  const blobs = new Float32Array(gx * gy);
  for (let i = 0; i < blobs.length; i++) blobs[i] = rng.float(0, 1);
  const sampleBlob = (u, v) => {
    const x = u * gx, y = v * gy;
    const x0 = Math.floor(x) % gx, y0 = Math.floor(y) % gy;
    const x1 = (x0 + 1) % gx, y1 = (y0 + 1) % gy;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = blobs[y0 * gx + x0], b = blobs[y0 * gx + x1];
    const c = blobs[y1 * gx + x0], d = blobs[y1 * gx + x1];
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
  const PAL = [
    [[34, 62, 28], [104, 136, 66]],     // 0 grass
    [[70, 68, 64], [144, 140, 130]],    // 1 rock
    [[164, 142, 100], [226, 208, 164]], // 2 sand
    [[198, 208, 226], [253, 255, 255]]  // 3 snow
  ];
  const [dark, light] = PAL[layer];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let n = sampleBlob(u, v) * 0.6 + sampleBlob(u * 2.7 + 0.13, v * 2.7 + 0.31) * 0.4;
      let det;
      if (layer === 0) det = Math.sin((x * 1.7 + y * 0.6) * 0.5 + n * 12) * 0.18 + rng.float(0, 0.16);
      else if (layer === 1) {
        const w = Math.abs(Math.sin((x + y * 0.4) * 0.22 + n * 6));
        det = (1 - w) * 0.35 + rng.float(0, 0.12);
      } else if (layer === 2) det = Math.sin(x * 0.9 + n * 8) * 0.12 + rng.float(0, 0.1);
      else det = rng.float(0, 0.08) + Math.pow(sampleBlob(u * 3.1, v * 3.1), 3) * 0.25;
      const t = clamp01(n * 0.75 + det);
      const i = (y * S + x) * 4;
      out[i] = clamp(dark[0] + (light[0] - dark[0]) * t, 0, 255);
      out[i + 1] = clamp(dark[1] + (light[1] - dark[1]) * t, 0, 255);
      out[i + 2] = clamp(dark[2] + (light[2] - dark[2]) * t, 0, 255);
      out[i + 3] = clamp(Math.round(128 + (t - 0.5) * 200), 0, 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Particle sprite atlas — 4x4 grid of 256px sprites (no image files shipped)
// ---------------------------------------------------------------------------
export const SPR = {
  SOFT: 0, FIRE: 1, SMOKE: 2, SPARK: 3, RAIN: 4, SNOW: 5,
  RING: 6, DEBRIS: 7, FLARE: 8, TRACER: 9, MUZZLE: 10, PUFF: 11,
  GLOW: 12, STREAK: 13, LEAF: 14, DUST: 15
};

export function buildParticleAtlas(size = 1024) {
  const cell = size / 4;
  const c = makeCanvas(size, size);
  if (!c) return null;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const at = (id) => [(id % 4) * cell, Math.floor(id / 4) * cell, cell];
  const radial = (id, stops, inner = 0, outer = 1) => {
    const [x, y, s] = at(id);
    const cx = x + s / 2, cy = y + s / 2;
    const grad = g.createRadialGradient(cx, cy, Math.max(0.01, s * 0.5 * inner), cx, cy, s * 0.5 * outer);
    for (const [p, col] of stops) grad.addColorStop(p, col);
    g.save(); g.beginPath(); g.arc(cx, cy, s * 0.5, 0, Math.PI * 2); g.clip();
    g.fillStyle = grad; g.fillRect(x, y, s, s); g.restore();
  };
  radial(SPR.SOFT, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
  radial(SPR.FIRE, [[0, 'rgba(255,255,240,1)'], [0.18, 'rgba(255,232,150,1)'], [0.42, 'rgba(255,140,30,0.85)'], [0.75, 'rgba(190,50,10,0.35)'], [1, 'rgba(60,10,0,0)']]);
  radial(SPR.SMOKE, [[0, 'rgba(130,130,132,0.85)'], [0.45, 'rgba(95,95,100,0.5)'], [0.8, 'rgba(70,70,75,0.18)'], [1, 'rgba(60,60,65,0)']]);
  radial(SPR.SPARK, [[0, 'rgba(255,255,220,1)'], [0.3, 'rgba(255,200,90,0.9)'], [0.7, 'rgba(255,120,20,0.4)'], [1, 'rgba(255,80,0,0)']]);
  (() => { // rain streak
    const [x, y, s] = at(SPR.RAIN);
    const grad = g.createLinearGradient(x + s / 2, y, x + s / 2, y + s);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(225,238,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.beginPath(); g.ellipse(x + s / 2, y + s / 2, s * 0.06, s * 0.5, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = grad; g.fillRect(x, y, s, s); g.restore();
  })();
  radial(SPR.SNOW, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(235,245,255,0.75)'], [1, 'rgba(220,235,255,0)']]);
  (() => { // shockwave ring
    const [x, y, s] = at(SPR.RING);
    const cx = x + s / 2, cy = y + s / 2;
    const grad = g.createRadialGradient(cx, cy, s * 0.30, cx, cy, s * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.6, 'rgba(255,240,210,0.75)');
    grad.addColorStop(0.85, 'rgba(255,220,170,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(x, y, s, s);
  })();
  (() => { // debris chunk
    const [x, y, s] = at(SPR.DEBRIS);
    const rng = new RNG(31337);
    g.save(); g.translate(x + s / 2, y + s / 2);
    g.fillStyle = 'rgba(120,120,125,1)';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = s * (0.16 + rng.float(0, 0.14));
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(60,60,64,1)'; g.lineWidth = s * 0.02; g.stroke();
    g.restore();
  })();
  radial(SPR.FLARE, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,245,190,1)'], [0.3, 'rgba(255,170,60,0.8)'], [1, 'rgba(255,90,0,0)']]);
  (() => { // tracer
    const [x, y, s] = at(SPR.TRACER);
    const grad = g.createLinearGradient(x, y + s / 2, x + s, y + s / 2);
    grad.addColorStop(0, 'rgba(255,200,80,0)');
    grad.addColorStop(0.55, 'rgba(255,225,150,0.95)');
    grad.addColorStop(0.8, 'rgba(255,255,235,1)');
    grad.addColorStop(1, 'rgba(255,255,220,0)');
    g.fillStyle = grad;
    g.save(); g.beginPath(); g.ellipse(x + s / 2, y + s / 2, s * 0.5, s * 0.055, 0, 0, Math.PI * 2); g.clip();
    g.fillRect(x, y, s, s); g.restore();
  })();
  radial(SPR.MUZZLE, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,235,170,1)'], [0.45, 'rgba(255,160,50,0.7)'], [1, 'rgba(255,120,0,0)']], 0, 0.9);
  radial(SPR.PUFF, [[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(245,248,255,0.45)'], [1, 'rgba(235,240,255,0)']]);
  radial(SPR.GLOW, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 0, 0.5);
  (() => { // streak (vapor)
    const [x, y, s] = at(SPR.STREAK);
    const grad = g.createLinearGradient(x, y, x + s, y);
    grad.addColorStop(0, 'rgba(255,255,255,0.05)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = grad;
    g.save(); g.beginPath(); g.ellipse(x + s / 2, y + s / 2, s * 0.5, s * 0.5 * 0.35, 0, 0, Math.PI * 2); g.clip();
    g.fillRect(x, y, s, s); g.restore();
  })();
  radial(SPR.LEAF, [[0, 'rgba(90,140,60,0.9)'], [1, 'rgba(60,100,40,0)']]);
  radial(SPR.DUST, [[0, 'rgba(200,180,150,0.75)'], [0.6, 'rgba(180,160,130,0.3)'], [1, 'rgba(160,140,110,0)']]);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Aircraft PBR texture set (procedural)
// ---------------------------------------------------------------------------
export function makeAircraftMaps(livery, size = 1024) {
  const c = makeCanvas(size, size);
  if (!c) return null;
  const rng = new RNG(livery.seed || 12345);
  const g = c.getContext('2d');
  const N = size / 4;
  g.fillStyle = livery.base;
  g.fillRect(0, 0, size, size);

  if (livery.camo && livery.camo.length) {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = livery.camo[i % livery.camo.length];
      g.globalAlpha = 0.85;
      g.beginPath();
      const cx = rng.float(0, size), cy = rng.float(0, size);
      const r = rng.float(size * 0.04, size * 0.14);
      const pts = 8 + rng.int(0, 5);
      for (let p = 0; p < pts; p++) {
        const a = (p / pts) * Math.PI * 2;
        const rr = r * rng.float(0.6, 1.4);
        p ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6);
      }
      g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  }
  if (livery.stripe) {
    g.strokeStyle = livery.stripe;
    g.lineWidth = size * 0.035;
    g.beginPath(); g.moveTo(0, size * 0.62); g.lineTo(size, size * 0.62); g.stroke();
    g.lineWidth = size * 0.012;
    g.beginPath(); g.moveTo(0, size * 0.70); g.lineTo(size, size * 0.70); g.stroke();
  }
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = Math.max(1, size / 700);
  for (let i = 0; i <= N; i++) {
    const p = (i / N) * size;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < 900; i++) {
    g.fillRect(rng.float(0, size), rng.float(0, size), Math.max(1, size / 512), Math.max(1, size / 512));
  }
  for (let i = 0; i < 26; i++) {
    const x = rng.float(0, size), y = rng.float(0, size);
    const grd = g.createRadialGradient(x, y, 0, x, y, rng.float(size * 0.05, size * 0.2));
    grd.addColorStop(0, `rgba(20,20,22,${rng.float(0.05, 0.2)})`);
    grd.addColorStop(1, 'rgba(20,20,22,0)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
  }
  // insignia
  const insR = size * 0.075;
  g.save();
  g.translate(size * 0.22, size * 0.28);
  if (livery.insignia === 'star') {
    g.fillStyle = livery.insigniaColor || '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? insR * 0.42 : insR;
      i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  } else {
    g.strokeStyle = livery.insigniaColor || '#e8e8ee'; g.lineWidth = insR * 0.3;
    g.beginPath(); g.arc(0, 0, insR * 0.75, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, insR * 0.35, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
  g.fillStyle = 'rgba(230,60,40,0.75)';
  g.font = `bold ${Math.floor(size * 0.022)}px monospace`;
  g.fillText('RESCUE', size * 0.05, size * 0.93);
  g.fillText('NO STEP', size * 0.7, size * 0.08);

  const map = canvasTexture(c, { aniso: 8, srgb: true });

  const rc = makeCanvas(size, size);
  const rg = rc.getContext('2d');
  const rough = livery.rough != null ? livery.rough : 0.55;
  rg.fillStyle = `rgb(${Math.round(rough * 255)},${Math.round(rough * 255)},${Math.round(rough * 255)})`;
  rg.fillRect(0, 0, size, size);
  rg.globalAlpha = 0.5;
  for (let i = 0; i < 40; i++) {
    const x = rng.float(0, size), y = rng.float(0, size);
    const grd = rg.createRadialGradient(x, y, 0, x, y, rng.float(size * 0.03, size * 0.16));
    grd.addColorStop(0, rng.bool(0.5) ? 'rgba(40,40,40,0.6)' : 'rgba(220,220,220,0.5)');
    grd.addColorStop(1, 'rgba(128,128,128,0)');
    rg.fillStyle = grd; rg.fillRect(0, 0, size, size);
  }
  rg.globalAlpha = 1;
  rg.strokeStyle = 'rgba(180,180,180,0.55)';
  for (let i = 0; i <= N; i++) {
    const p = (i / N) * size;
    rg.beginPath(); rg.moveTo(p, 0); rg.lineTo(p, size); rg.stroke();
    rg.beginPath(); rg.moveTo(0, p); rg.lineTo(size, p); rg.stroke();
  }
  const roughnessMap = canvasTexture(rc, { aniso: 4, srgb: false });

  const nc = makeCanvas(size, size);
  const ng = nc.getContext('2d');
  ng.fillStyle = '#8080ff'; ng.fillRect(0, 0, size, size);
  ng.lineWidth = Math.max(1, size / 600);
  for (let i = 0; i <= N; i++) {
    const p = (i / N) * size;
    ng.strokeStyle = 'rgba(150,110,255,0.7)';
    ng.beginPath(); ng.moveTo(p, 0); ng.lineTo(p, size); ng.stroke();
    ng.strokeStyle = 'rgba(110,150,255,0.7)';
    ng.beginPath(); ng.moveTo(p + 1, 0); ng.lineTo(p + 1, size); ng.stroke();
    ng.strokeStyle = 'rgba(150,110,255,0.7)';
    ng.beginPath(); ng.moveTo(0, p); ng.lineTo(size, p); ng.stroke();
  }
  ng.globalAlpha = 0.35;
  for (let i = 0; i < 60; i++) {
    ng.fillStyle = rng.bool() ? '#9a7aff' : '#6677ff';
    ng.beginPath(); ng.arc(rng.float(0, size), rng.float(0, size), rng.float(1, 3), 0, Math.PI * 2); ng.fill();
  }
  ng.globalAlpha = 1;
  const normalMap = canvasTexture(nc, { aniso: 4, srgb: false });

  return { map, roughnessMap, normalMap, metalness: livery.metalness != null ? livery.metalness : 0.55 };
}

// ---------------------------------------------------------------------------
// Ground object textures
// ---------------------------------------------------------------------------
export function makeConcreteTexture(size = 256) {
  const c = makeCanvas(size, size); if (!c) return null;
  const g = c.getContext('2d'); const rng = new RNG(555);
  g.fillStyle = '#6b6b6d'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = rng.int(70, 130);
    g.fillStyle = `rgba(${v},${v},${v + 3},0.6)`;
    g.fillRect(rng.float(0, size), rng.float(0, size), rng.float(1, 4), rng.float(1, 4));
  }
  for (let i = 0; i < 8; i++) {
    g.strokeStyle = 'rgba(40,40,42,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(rng.float(0, size), rng.float(0, size));
    g.lineTo(rng.float(0, size), rng.float(0, size)); g.stroke();
  }
  return canvasTexture(c, { aniso: 4 });
}

export function makeMetalTexture(size = 256) {
  const c = makeCanvas(size, size); if (!c) return null;
  const g = c.getContext('2d'); const rng = new RNG(777);
  g.fillStyle = '#8a8f94'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    g.strokeStyle = `rgba(${rng.int(60, 160)},${rng.int(60, 160)},${rng.int(60, 160)},0.35)`;
    g.lineWidth = rng.float(0.5, 2);
    g.beginPath(); g.moveTo(0, rng.float(0, size)); g.lineTo(size, rng.float(0, size)); g.stroke();
  }
  return canvasTexture(c, { aniso: 4 });
}

// ---------------------------------------------------------------------------
// Inject cascaded shadows into a MeshStandardMaterial
// ---------------------------------------------------------------------------
export const CSM_VARYINGS = /* glsl */`
varying vec3 vWorldPosCSM;
varying vec3 vWorldNormalCSM;
`;

// Uniform block shared by every standard material that receives CSM shadows.
export const WORLD_LIGHT_UNIFORMS = {
  sunDirWorld: { value: new THREE.Vector3(0, 1, 0) }
};

export function injectWorldShading(material, uniforms, opts = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPosCSM;\nvarying vec3 vWorldNormalCSM;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        {
          vec3 nrm = objectNormal;
          #ifdef USE_INSTANCING
            nrm = mat3(instanceMatrix) * nrm;
          #endif
          vWorldNormalCSM = normalize(mat3(modelMatrix) * nrm);
        }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          vWorldPosCSM = wp.xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CSM_INJECT_DECL}\n${GLSL_SHADOWS}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 ndc = normalize(vWorldNormalCSM);
          vec3 toSun = normalize(sunDirWorld);
          float s = getCsmShadow(vWorldPosCSM, ndc, max(dot(ndc, toSun), 0.0));
          reflectedLight.directDiffuse *= mix(1.0, s, 0.9);
          reflectedLight.directSpecular *= mix(1.0, s, 0.95);
        }`);
  };
  material.customProgramCacheKey = () => 'worldShadingCSM';
  return material;
}

const CSM_INJECT_DECL = /* glsl */`
varying vec3 vWorldPosCSM;
varying vec3 vWorldNormalCSM;
`;
