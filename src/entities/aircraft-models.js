// Procedural aircraft meshes. Each airframe is composed of lathed fuselage, extruded planforms,
// pivoting control surfaces, gear, canopy, engines, lights and damage pieces.
// Nose points along local -Z; +X is the right wing; +Y is up.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clamp, smoothstep } from '../core/noise.js';

let envMap = null;
export function getEnvMap(renderer) {
  if (envMap) return envMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  return envMap;
}

// Procedural panel-line normal map (a little detail without a texture file).
let panelNormal = null;
function getPanelNormal() {
  if (panelNormal) return panelNormal;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(40,40,40,0.9)';
  g.lineWidth = 2;
  for (let i = 0; i < S; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  g.fillStyle = 'rgba(160,160,160,0.25)';
  for (let i = 0; i < 180; i++) g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 1 + Math.random() * 2);
  // Convert the height image into a tangent-space normal map.
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);
  const H = (x, y) => d[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2.5;
    const dy = (H(x, y + 1) - H(x, y - 1)) * 2.5;
    const len = Math.hypot(dx, dy, 1);
    const k = (y * S + x) * 4;
    out[k] = (-dx / len * 0.5 + 0.5) * 255;
    out[k + 1] = (-dy / len * 0.5 + 0.5) * 255;
    out[k + 2] = (1 / len * 0.5 + 0.5) * 255;
    out[k + 3] = 255;
  }
  const nc = document.createElement('canvas');
  nc.width = nc.height = S;
  nc.getContext('2d').putImageData(new ImageData(out, S, S), 0, 0);
  panelNormal = new THREE.CanvasTexture(nc);
  panelNormal.wrapS = panelNormal.wrapT = THREE.RepeatWrapping;
  panelNormal.repeat.set(2, 2);
  return panelNormal;
}

// Lathe profile along length: t=0 tail, t=1 nose. Returns [radius, y] pairs for LatheGeometry.
function fuselageProfile(L, maxR, { noseBlunt = 0.12, tailR = 0.25, belly = 1 } = {}) {
  const pts = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let r;
    if (t < 0.22) r = maxR * (tailR + (1 - tailR) * Math.sqrt(t / 0.22));
    else if (t > 0.78) r = maxR * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.78) / 0.22, 2)));
    else r = maxR;
    if (t > 0.95) r *= noseBlunt / Math.max(noseBlunt, 0.05);
    pts.push(new THREE.Vector2(Math.max(r, 0.001) * (1 + (belly - 1) * (i < N / 2 ? 0 : 0)), t * L));
  }
  return pts;
}

function lathe(L, maxR, opts = {}) {
  const pts = fuselageProfile(L, maxR, opts);
  const g = new THREE.LatheGeometry(pts, opts.seg || 20);
  g.rotateX(-Math.PI / 2);   // nose to -Z
  g.translate(0, 0, L / 2);  // centred on origin (nose at -L/2)
  g.scale(opts.sx || 1, opts.sy || 1, 1);
  return g;
}

// Planform polygon [[x, z], ...] (right wing, x>0; z negative = forward). Extruded thin in Y.
function planform(pts, thickness) {
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

// Vertical fin from [[z, y], ...] outline, extruded along X.
function fin(pts, thickness) {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  return m;
}

// Afterburner flame: additive, scrolling noise, fades toward the tail.
const FLAME_MAT_CACHE = [];
function flameMaterial() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uLen: { value: 6 } },
    vertexShader: `varying float vT; varying vec2 vUv; uniform float uLen;
      void main(){ vT = clamp(position.z / uLen, 0.0, 1.0); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying float vT; varying vec2 vUv; uniform float uTime; uniform float uAmount;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float n = h(floor(vec2(vUv.x * 12.0, vUv.y * 40.0 - uTime * 30.0)));
        float core = smoothstep(0.0, 0.25, 1.0 - vT) * (0.8 + 0.2 * n);
        vec3 col = mix(vec3(1.0, 0.95, 0.7), vec3(0.3, 0.55, 1.0), vT * 0.6);
        col = mix(col, vec3(1.0, 0.45, 0.1), smoothstep(0.1, 0.8, vT));
        float a = core * (1.0 - vT) * uAmount;
        gl_FragColor = vec4(col * a * 3.0, a);
      }`,
  });
  FLAME_MAT_CACHE.push(mat);
  return mat;
}

const TYPE_DEFS = {
  f22: {
    L: 19.6, span: 13.5, maxR: 1.05, mass: 1, engines: 2, cockpitZ: -3.6, cockpitY: 1.05, cockpitL: 2.4,
    wing: [[0.9, -2.4], [6.8, -2.6], [6.9, -2.2], [6.0, 1.6], [0.9, 2.2]],
    tailPlane: [[0.8, -1.6], [2.7, -1.2], [2.7, -0.4], [1.0, 1.2]],
    fins: [[[-1.4, 0.9], [-4.3, 0.0], [-3.6, 2.6], [-1.4, 2.6]]],
    finX: [0.9], finSplay: 0.22, finTilt: 0.22,
    engineX: [0.7], engineZ: 6.5, intake: 'belly-wide', canards: false, wedgeNose: true,
    gearMain: { x: 1.6, z: -0.8, len: 1.1 }, gearNose: { z: -4.8, len: 1.0 },
    bays: true, prop: false, delta: false,
  },
  f16: {
    L: 15.0, span: 9.45, maxR: 0.95, engines: 1, cockpitZ: -3.3, cockpitY: 1.0, cockpitL: 2.2,
    wing: [[0.9, -1.2], [4.3, -2.6], [4.4, -2.3], [2.4, 1.6], [0.9, 1.9]],
    tailPlane: [[0.6, -1.5], [2.3, -1.4], [2.3, -0.3], [0.8, 0.9]],
    fins: [[[-2.4, 0.8], [-4.4, 0.0], [-3.9, 2.8], [-2.4, 2.8]]],
    finX: [0], finSplay: 0, finTilt: 0,
    engineX: [0], engineZ: 6.6, intake: 'belly-round', canards: false, wedgeNose: false,
    gearMain: { x: 1.4, z: -0.2, len: 0.95 }, gearNose: { z: -3.9, len: 0.8 },
    bays: false, prop: false, delta: false, pylons: true,
  },
  su34: {
    L: 22.0, span: 14.7, maxR: 1.55, engines: 2, cockpitZ: -6.3, cockpitY: 1.2, cockpitL: 3.0, tandem: true,
    wing: [[1.6, -2.2], [7.2, -1.6], [7.3, 0.4], [2.2, 3.4], [1.6, 3.4]],
    tailPlane: [[1.4, -2.4], [3.4, -2.2], [3.6, -0.2], [1.8, 1.6]],
    fins: [[[-2.6, 1.2], [-4.6, 0.0], [-4.2, 3.4], [-2.8, 3.4]]],
    finX: [1.2], finSplay: 0.0, finTilt: 0.15,
    engineX: [1.3], engineZ: 8.3, intake: 'nose-duck', canards: false, wedgeNose: false,
    gearMain: { x: 2.2, z: 0.2, len: 1.5 }, gearNose: { z: -6.2, len: 1.4 },
    bays: false, prop: false, delta: false, duck: true,
  },
  gripen: {
    L: 14.1, span: 8.1, maxR: 0.8, engines: 1, cockpitZ: -2.9, cockpitY: 0.95, cockpitL: 2.0,
    wing: [[0.9, -1.0], [4.0, 2.5], [4.0, 2.6], [0.9, 3.2]],
    tailPlane: [],
    fins: [[[-3.0, 0.8], [-4.8, 0.0], [-4.4, 2.5], [-3.3, 2.5]]],
    finX: [0], finSplay: 0, finTilt: 0,
    canardPts: [[0.5, -4.4], [2.0, -4.8], [2.0, -4.3], [0.6, -3.9]],
    engineX: [0], engineZ: 5.8, intake: 'belly-round', canards: true, wedgeNose: false,
    gearMain: { x: 1.2, z: 0.2, len: 0.9 }, gearNose: { z: -3.8, len: 0.8 },
    bays: false, prop: false, delta: true,
  },
  p51: {
    L: 9.8, span: 11.3, maxR: 0.55, engines: 1, cockpitZ: -1.4, cockpitY: 0.85, cockpitL: 1.4,
    wing: [[0.7, -0.9], [5.6, -0.3], [5.6, 0.0], [0.7, 0.6]],
    tailPlane: [[0.5, -1.0], [1.9, -0.9], [1.9, -0.2], [0.6, 0.6]],
    fins: [[[-1.4, 0.5], [-2.8, 0.0], [-2.7, 2.4], [-1.6, 2.4]]],
    finX: [0], finSplay: 0, finTilt: 0,
    engineX: [0], engineZ: 2.5, intake: 'radiator', canards: false, wedgeNose: false,
    gearMain: { x: 1.8, z: 0.1, len: 0.8 }, gearNose: { z: -2.4, len: 0.6 },
    bays: false, prop: true, delta: false,
  },
  mig: {
    L: 17.0, span: 11.2, maxR: 0.9, engines: 2, cockpitZ: -4.2, cockpitY: 1.0, cockpitL: 2.3,
    wing: [[0.8, -2.0], [5.4, -2.7], [5.4, -2.3], [2.5, 1.5], [0.8, 2.2]],
    tailPlane: [[0.6, -1.5], [2.3, -1.4], [2.3, -0.4], [0.8, 0.9]],
    fins: [[[-2.6, 0.8], [-4.6, 0.0], [-4.2, 2.8], [-2.6, 2.8]]],
    finX: [0.9], finSplay: 0.15, finTilt: 0.15,
    engineX: [0.6], engineZ: 7.6, intake: 'belly-wide', canards: false, wedgeNose: false,
    gearMain: { x: 1.5, z: -0.4, len: 1.0 }, gearNose: { z: -4.2, len: 0.9 },
    bays: false, prop: false, delta: false,
  },
  drone: {
    L: 7.0, span: 6.0, maxR: 0.3, engines: 1, cockpitZ: -1.0, cockpitY: 0.3, cockpitL: 0.5,
    wing: [[0.4, -0.6], [3.0, -0.8], [3.0, 0.4], [0.4, 0.8]],
    tailPlane: [],
    fins: [[[-1.8, 0.2], [-3.0, 0.0], [-2.6, 1.2], [-2.0, 1.2]]],
    finX: [0], finSplay: 0, finTilt: 0,
    engineX: [0], engineZ: 3.0, intake: 'none', canards: false, wedgeNose: false,
    gearMain: null, gearNose: null, bays: false, prop: false, delta: false,
  },
  bomber: {
    L: 36.0, span: 34.0, maxR: 2.2, engines: 4, cockpitZ: -15.0, cockpitY: 1.9, cockpitL: 3.0,
    wing: [[2.5, -3.5], [16.5, -3.0], [17.0, -1.2], [11, 4.6], [2.5, 4.6]],
    tailPlane: [[1.8, -4.5], [6.0, -2.8], [6.2, -2.0], [2.0, 3.0]],
    fins: [[[-5.0, 1.8], [-8.4, 0.0], [-8.2, 6.6], [-5.2, 6.6]]],
    finX: [0], finSplay: 0, finTilt: 0,
    engineX: [4.6, 9.8], engineZ: -1.2, intake: 'pods', canards: false, wedgeNose: false,
    gearMain: { x: 3.4, z: 0.2, len: 2.0 }, gearNose: { z: -11.5, len: 1.8 },
    bays: true, prop: false, delta: false,
  },
  boss: {
    L: 24.0, span: 17.0, maxR: 1.2, engines: 3, cockpitZ: -6.5, cockpitY: 1.1, cockpitL: 2.6,
    wing: [[1.2, -3.2], [8.2, -3.0], [8.4, -0.4], [4.0, 3.0], [1.2, 3.8]],
    tailPlane: [[1.0, -2.2], [3.4, -2.0], [3.4, -0.4], [1.2, 1.6]],
    fins: [[[-2.0, 1.1], [-4.8, 0.0], [-4.2, 4.2], [-2.4, 4.2]]],
    finX: [1.4], finSplay: 0.28, finTilt: 0.2,
    engineX: [0, 2.2], engineZ: 8.7, intake: 'belly-wide', canards: true, wedgeNose: true,
    canardPts: [[0.8, -4.2], [2.6, -4.9], [2.6, -4.4], [0.9, -3.9]],
    gearMain: { x: 2.0, z: -0.2, len: 1.2 }, gearNose: { z: -5.5, len: 1.1 },
    bays: true, prop: false, delta: false, spikes: true,
  },
};

// Build a complete airframe. `colors` = { body, accent }.
export function buildAircraft(type, colors = {}, renderer = null) {
  const def = TYPE_DEFS[type];
  if (!def) throw new Error('Unknown airframe ' + type);
  const bodyCol = colors.body ?? 0x6e7a83;
  const accentCol = colors.accent ?? 0xffffff;
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyCol, metalness: 0.55, roughness: 0.38, normalMap: getPanelNormal(), normalScale: new THREE.Vector2(0.4, 0.4),
    envMap: renderer ? getEnvMap(renderer) : null, envMapIntensity: 0.9,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.3, roughness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentCol, metalness: 0.3, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223a52, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.82, envMapIntensity: 1.6, envMap: renderer ? getEnvMap(renderer) : null });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.8, roughness: 0.4 });
  const root = new THREE.Group();
  root.name = 'airframe-' + type;
  const body = new THREE.Group();
  root.add(body);
  const L = def.L;

  // Fuselage.
  const fuse = new THREE.Mesh(lathe(L, def.maxR, { sx: type === 'su34' ? 1.05 : 1, sy: type === 'drone' ? 0.85 : 1 }), bodyMat);
  fuse.castShadow = true; fuse.receiveShadow = true;
  body.add(fuse);
  if (def.wedgeNose) {
    // Chined nose wedge for stealth-style silhouette.
    const wedge = box(def.maxR * 1.6, def.maxR * 0.8, L * 0.25, bodyMat);
    wedge.position.set(0, -def.maxR * 0.1, -L / 2 + L * 0.1);
    wedge.rotation.x = -0.05;
    body.add(wedge);
  }
  // Canopy: tandem canopies for tandem designs.
  const canopyGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  if (def.tandem) {
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Mesh(canopyGeo, glassMat);
      c.scale.set(def.cockpitL * 0.45, def.cockpitL * 0.25, def.cockpitL * 0.3);
      c.position.set(0, def.cockpitY, def.cockpitZ + i * 2.4);
      body.add(c);
    }
  } else {
    const c = new THREE.Mesh(canopyGeo, glassMat);
    c.scale.set(def.maxR * 0.78, def.maxR * 0.62, def.cockpitL * 0.5);
    c.position.set(0, def.cockpitY, def.cockpitZ);
    c.name = 'canopy';
    body.add(c);
  }
  // Canopy frame highlight in accent color.
  if (!def.tandem) {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(def.maxR * 0.55, 0.035, 6, 20, Math.PI), accentMat);
    frame.rotation.z = 0; frame.rotation.y = Math.PI / 2;
    frame.scale.set(1, 0.6, 1.9);
    frame.position.set(0, def.cockpitY + 0.02, def.cockpitZ);
    body.add(frame);
  }

  // Intakes.
  if (def.intake === 'belly-wide') {
    const i1 = box(def.maxR * 0.9, def.maxR * 0.5, 2.6, darkMat);
    i1.position.set(0, -def.maxR * 0.55, -L * 0.2);
    body.add(i1);
  } else if (def.intake === 'belly-round') {
    const i1 = new THREE.Mesh(new THREE.CylinderGeometry(def.maxR * 0.55, def.maxR * 0.55, 1.2, 14, 1, true), darkMat);
    i1.rotation.x = Math.PI / 2;
    i1.position.set(0, -def.maxR * 0.45, -L * 0.25);
    body.add(i1);
  } else if (def.intake === 'pods') {
    for (const x of [-def.engineX[0], def.engineX[0], -def.engineX[1], def.engineX[1]]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 5.5, 14), bodyMat);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(x, -0.9, def.engineZ - 0.4);
      body.add(pod);
    }
  } else if (def.intake === 'nose-duck') {
    const duck = box(def.maxR * 1.4, def.maxR * 0.5, 2.4, darkMat);
    duck.position.set(0, -def.maxR * 0.3, -L / 2 + 2.0);
    body.add(duck);
  } else if (def.intake === 'radiator') {
    const rad = box(1.0, 0.7, 2.2, darkMat);
    rad.position.set(0, -0.6, 0.6);
    body.add(rad);
  }

  // Wings with pivoting ailerons and flaps.
  const wingMat = bodyMat;
  const wingSideDefs = [1, -1];
  const ailerons = [];
  const flaps = [];
  const wingTips = { left: null, right: null };
  const wingRoot = new THREE.Group();
  body.add(wingRoot);
  for (const side of wingSideDefs) {
    const wingGroup = new THREE.Group();
    wingGroup.scale.x = side;
    wingRoot.add(wingGroup);
    const outer = new THREE.Group();
    const wingMesh = new THREE.Mesh(planform(def.wing, 0.22), wingMat);
    wingMesh.castShadow = true; wingMesh.receiveShadow = true;
    wingMesh.position.y = -0.05;
    wingGroup.add(wingMesh);
    // Aileron at the outer trailing edge.
    const te = def.wing[3], teOuter = def.wing[2];
    const ailPivot = new THREE.Group();
    const ailLen = Math.max(1.2, (teOuter[0] - te[0]) * 0.8);
    const ailGeo = new THREE.BoxGeometry(ailLen, 0.12, 0.8);
    const ail = new THREE.Mesh(ailGeo, darkMat);
    ail.position.set(-ailLen / 2, 0, 0.4);
    ailPivot.add(ail);
    ailPivot.position.set((te[0] + teOuter[0]) / 2, 0.02, (te[1] + teOuter[1]) / 2 + 0.2);
    wingGroup.add(ailPivot);
    ailerons.push({ pivot: ailPivot, side });
    // Trailing-edge flap.
    const flapPivot = new THREE.Group();
    const flapGeo = new THREE.BoxGeometry(Math.max(0.8, (def.wing[1][0] - def.wing[0][0]) * 0.6), 0.1, 0.9);
    const fl = new THREE.Mesh(flapGeo, darkMat);
    fl.position.set(0, 0, 0.4);
    flapPivot.add(fl);
    flapPivot.position.set((def.wing[0][0] + def.wing[1][0]) / 2, 0.0, (def.wing[0][1] + def.wing[1][1]) / 2 + 0.3);
    wingGroup.add(flapPivot);
    flaps.push(flapPivot);
    // Visible damage tip: outer 25% of the wing as a separate piece.
    outer.add(new THREE.Object3D());
    wingGroup.add(outer);
    wingTips[side > 0 ? 'right' : 'left'] = { group: wingGroup, tipLocal: new THREE.Vector3(def.span * 0.9, 0, -1), shard: null };
    // Wing tip light.
    const tipLight = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x33ff66 : 0xff3333 }));
    tipLight.position.set(def.span / 2 - 0.2, 0.1, def.wing[1][1] * 0.6 + 0.6);
    wingGroup.add(tipLight);
    if (side > 0) wingTips.rightLight = tipLight; else wingTips.leftLight = tipLight;
  }

  // Tailplanes (elevators) with pivoting trailing edges.
  const elevators = [];
  if (def.tailPlane && def.tailPlane.length) {
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      g.scale.x = side;
      body.add(g);
      const tp = new THREE.Mesh(planform(def.tailPlane, 0.16), bodyMat);
      tp.position.set(0, 0.2, L / 2 - 1.0);
      tp.castShadow = true;
      g.add(tp);
      const ePivot = new THREE.Group();
      const tailPts = def.tailPlane;
      ePivot.position.set((tailPts[2][0] + tailPts[3][0]) / 2, 0.25, L / 2 - 1.0 + (tailPts[2][1] + tailPts[3][1]) / 2 - 0.1);
      const e = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.6, tailPts[2][0] - tailPts[3][0] + 1.0), 0.1, 0.5), darkMat);
      e.position.set(-0.4, 0, 0.2);
      ePivot.add(e);
      g.add(ePivot);
      elevators.push(ePivot);
    }
  }

  // Canards (Gripen, boss).
  if (def.canards && def.canardPts) {
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      g.scale.x = side;
      body.add(g);
      g.add(Object.assign(new THREE.Mesh(planform(def.canardPts, 0.12), bodyMat), { castShadow: true }));
    }
  }

  // Vertical fins with rudders. Fin outlines are given in tail-relative (z, y) coordinates;
  // each fin group is shifted so its trailing edge sits just forward of the tail.
  const rudders = [];
  const finPlacement = def.finX[0] !== 0 ? [1, -1] : [0];
  const finOutline = def.fins[0];
  const maxZ = Math.max(...finOutline.map((p) => p[0]));
  for (const sx of finPlacement) {
    const finGroup = new THREE.Group();
    finGroup.position.set(sx * def.finX[0], 0, L / 2 - 0.8 - maxZ);
    body.add(finGroup);
    const finMesh = new THREE.Mesh(fin(finOutline, 0.18), bodyMat);
    finMesh.castShadow = true;
    finMesh.rotation.z = sx * (def.finTilt || 0);
    finGroup.add(finMesh);
    const rPivot = new THREE.Group();
    rPivot.position.set(0, 0.4, maxZ - 0.1);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.9), darkMat);
    r.position.set(0, 0.7, -0.4);
    rPivot.add(r);
    finGroup.add(rPivot);
    rudders.push(rPivot);
    if (def.finSplay) finGroup.rotation.z = sx * def.finSplay;
  }

  // Engines: nozzles, afterburner flames, intake fan blades.
  const flames = [];
  const fans = [];
  for (const ex of def.engineX) {
    for (const side of ex === 0 ? [0] : [1, -1]) {
      const x = side * ex;
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.0, 18, 1, true), nozzleMat);
      noz.rotation.x = Math.PI / 2;
      noz.position.set(x, 0, L / 2 - 0.4 + (def.prop ? 0 : 0));
      body.add(noz);
      // Flame cone pointing back from the nozzle.
      const fl = new THREE.Mesh(coneFromBase(2.6 + def.L * 0.08, 0.7), flameMaterial());
      fl.position.set(x, 0, L / 2 - 0.2);
      fl.visible = !def.prop;
      body.add(fl);
      flames.push(fl);
      // Fan blades visible in the intake (spin for jets).
      const fan = new THREE.Group();
      for (let b = 0; b < 4; b++) {
        const blade = box(0.08, 0.7, 0.14, darkMat);
        blade.position.set(0, 0.35, 0);
        blade.rotation.z = (b * Math.PI) / 2;
        fan.add(blade);
      }
      fan.position.set(x, -def.maxR * 0.15, -L * 0.18);
      fan.rotation.x = Math.PI / 2;
      if (!def.prop) body.add(fan);
      fans.push(fan);
    }
  }
  // Propeller for piston warbirds.
  let prop = null;
  if (def.prop) {
    prop = new THREE.Group();
    for (let b = 0; b < 4; b++) {
      const blade = box(0.25, 3.4, 0.12, darkMat);
      blade.position.set(0, 1.7, 0);
      blade.rotation.z = (b * Math.PI) / 2;
      prop.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), accentMat);
    prop.add(hub);
    prop.position.set(0, 0, -L / 2 - 0.1);
    body.add(prop);
  }

  // Landing gear: pivots with a fold angle and door plates.
  const gear = { main: [], nose: null, doors: [] };
  const mkLeg = (x, z, len) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, -def.maxR * 0.45, z);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 6), darkMat);
    leg.position.y = -len / 2;
    pivot.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.2, len * 0.2, 0.22, 10), darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.y = -len;
    pivot.add(wheel);
    body.add(pivot);
    return pivot;
  };
  if (def.gearMain) {
    for (const sx of [1, -1]) gear.main.push(mkLeg(sx * def.gearMain.x, def.gearMain.z, def.gearMain.len));
    if (def.gearNose) gear.nose = mkLeg(0, def.gearNose.z, def.gearNose.len);
    // Door plates that swing open during the cycle.
    for (const sx of [1, -1]) {
      const d = box(0.4, 0.06, 1.1, darkMat);
      const p = new THREE.Group();
      p.position.set(sx * def.gearMain.x, -def.maxR * 0.4, def.gearMain.z);
      p.add(d);
      body.add(p);
      gear.doors.push(p);
    }
  }
  if (def.bays) {
    const bay = box(def.maxR * 1.2, 0.05, 3.0, darkMat);
    bay.position.set(0, -def.maxR * 0.9, 0);
    body.add(bay);
  }
  // Pylons with hardpoints for jet attack variants.
  if (def.pylons) {
    for (const sx of [1, -1]) {
      const pyl = box(0.1, 0.25, 1.2, darkMat);
      pyl.position.set(sx * 2.6, -0.45, 0.3);
      body.add(pyl);
    }
  }

  // Boss spikes (decorative weapons pods).
  if (def.spikes) {
    for (const sx of [1, -1]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.25, 3.2, 6), accentMat);
      sp.rotation.z = sx * Math.PI / 2;
      sp.position.set(sx * 6.0, -0.5, -1.5);
      body.add(sp);
    }
  }

  // Damage: jagged wingtip shards (hidden until the wing is damaged).
  const shardMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const pts = new Float32Array([
      0, 0, 0, 0.9, 0.2, -0.6, 0.4, 0, 0.8, 1.0, -0.2, 0.2, 0.2, 0, -0.9,
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
    g.computeVertexNormals();
    const shard = new THREE.Mesh(g, shardMat);
    shard.visible = false;
    shard.position.set(side * (def.span / 2 - 1.2), 0, 0.5);
    shard.scale.set(side * 1.5, 1.5, 1.5);
    body.add(shard);
    if (side > 0) wingTips.rightShard = shard; else wingTips.leftShard = shard;
  }
  // Oil streak overlay on the fuselage flanks.
  const oilMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c, transparent: true, opacity: 0, depthWrite: false });
  const oil = new THREE.Mesh(new THREE.PlaneGeometry(0.25, L * 0.5), oilMat);
  oil.position.set(def.maxR * 0.98, 0.1, L * 0.1);
  oil.rotation.y = Math.PI / 2;
  oil.visible = false;
  body.add(oil);
  const oilL = oil.clone(); oilL.position.x *= -1; oilL.rotation.y = -Math.PI / 2; body.add(oilL);

  // Navigation lights: red left, green right, white tail, pulsing strobe.
  const navMat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), navMat(0xff2222));
  const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), navMat(0x22ff44));
  const navTail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), navMat(0xffffff));
  navRed.position.set(-def.span / 2 + 0.3, 0.05, 0.6);
  navGreen.position.set(def.span / 2 - 0.3, 0.05, 0.6);
  navTail.position.set(0, 0.5, L / 2 - 0.2);
  body.add(navRed, navGreen, navTail);
  // Landing light: a glow sprite under the nose (no extra scene lights, keeps shader cost flat).
  const landingLight = makeGlowSprite(0xfff3d6, 3);
  landingLight.position.set(0, -0.6, -L / 2 + 0.5);
  landingLight.visible = false;
  body.add(landingLight);


  return {
    root, body, def, type,
    ailerons, elevators, rudders, flaps, gear, flames, fans, prop,
    navRed, navGreen, navTail, landingLight, wingTips, oil, oilL,
    materials: { body: bodyMat, accent: accentMat, glass: glassMat },
    length: L, span: def.span,
    cockpitPos: new THREE.Vector3(0, def.cockpitY + 0.25, def.cockpitZ),
    tailPos: new THREE.Vector3(0, 0, L / 2),
    engineWorld: def.engineZ,
    flameMats: flames.map((f) => f.material),
  };
}

// Cone whose base is at origin and tip at +Z, radius at base.
function coneFromBase(length, radius) {
  const g = new THREE.ConeGeometry(radius, length, 14, 1, true);
  g.translate(0, length / 2, 0);
  g.rotateX(Math.PI / 2);
  return g;
}

// Public for other entity modules: procedural light sprites and glow.
export function makeGlowSprite(color = 0xffffff, size = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.scale.set(size, size, 1);
  return sp;
}

// Per-frame visual update for an airframe. `s` describes the state.
export function updateAircraftVisual(vis, s) {
  const dt = s.dt;
  const ctrl = s.controls;   // { pitch, roll, yaw }
  const maxDef = 0.45;
  // Ailerons: differential, roll input.
  for (const a of vis.ailerons) {
    const sign = a.side;
    a.pivot.rotation.x = clamp(-ctrl.roll * 0.45 * sign + (s.flapsDown ? 0.1 : 0), -maxDef, maxDef);
  }
  // Elevators.
  for (const e of vis.elevators) e.rotation.x = clamp(-ctrl.pitch * 0.4, -maxDef, maxDef);
  // Rudders.
  for (const r of vis.rudders) r.rotation.y = clamp(ctrl.yaw * 0.45, -maxDef, maxDef);
  // Flaps.
  for (const f of vis.flaps) f.rotation.x = -(s.flaps || 0) * 0.6;
  // Gear: fold angle and door cycles.
  const g = s.gear;   // 0 up .. 1 down
  const fold = (1 - g);
  for (const leg of vis.gear.main) leg.rotation.x = fold * 1.35;
  if (vis.gear.nose) vis.gear.nose.rotation.x = fold * 1.35;
  for (const d of vis.gear.doors) d.rotation.x = -fold * 1.2 * (g > 0.9 ? 0 : 1) + (g > 0.02 && g < 0.98 ? 0.3 : 0);
  // Engine fans and prop.
  const rpm = s.throttle * (s.prop ? 1 : 1);
  for (const f of vis.fans) f.rotation.y += dt * (10 + rpm * 60);
  if (vis.prop) vis.prop.rotation.z += dt * (8 + rpm * 60);
  // Afterburner flames.
  for (const f of vis.flames) {
    f.visible = !vis.def.prop && s.afterburnerAmount > 0.01;
    f.scale.set(0.8 + s.afterburnerAmount * 0.4, 0.8 + s.afterburnerAmount * 0.4, 0.5 + s.afterburnerAmount * 1.5 + rpm * 0.3);
  }
  for (const m of vis.flameMats) {
    m.uniforms.uTime.value = s.time;
    m.uniforms.uAmount.value = s.afterburnerAmount * (0.9 + 0.1 * Math.sin(s.time * 40));
  }
  // Navigation lights: steady red/green/white, strobe on tail when lights are on.
  const on = s.lightsOn;
  vis.navRed.visible = true; vis.navGreen.visible = true;
  vis.navTail.visible = on;
  vis.landingLight.visible = !!s.landingLight;
  // Damage visuals.
  const dmg = s.damage || {};
  const lw = dmg.wingL || 0, rw = dmg.wingR || 0;
  vis.wingTips.left.group.userData.hidden = lw > 0.7;
  vis.wingTips.right.group.userData.hidden = rw > 0.7;
  vis.wingTips.leftShard.visible = lw > 0.7;
  vis.wingTips.rightShard.visible = rw > 0.7;
  vis.oil.visible = vis.oilL.visible = (dmg.fuselage || 0) > 0.5;
  const oilOp = clamp(((dmg.fuselage || 0) - 0.5) * 2, 0, 0.85);
  vis.oil.material.opacity = oilOp; vis.oilL.material.opacity = oilOp;
  // Engine out: flames stop.
  if ((dmg.engine || 0) > 0.8) for (const f of vis.flames) f.visible = false;
  // Canopy glass slightly tinted with the sky when light is high.
  vis.materials.glass.opacity = 0.75 + 0.1 * smoothstep(0.0, 1.0, s.skyBright || 0.5);
}

// Hide tip if damaged; used by external code paths that want to check geometry.
export function wingTipHidden(vis, side) {
  const t = side > 0 ? vis.wingTips.right : vis.wingTips.left;
  return !!(t && t.group.userData.hidden);
}

export { TYPE_DEFS };
