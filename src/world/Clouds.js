// ---------------------------------------------------------------------------
// CloudField — instanced billboard cumulus / storm cells you can fly through.
// Clouds are recycled on a grid around the player; a CPU density query feeds
// the "inside cloud" fog, turbulence and lightning systems.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { RNG, clamp, clamp01, lerp, smoothstep, Noise } from '../core/Utils.js';
import { skyUniforms, SPR } from '../render/Shading.js';
import { GLSL_COMMON_HEAD } from '../core/glsl.js';

const PUFF_VS = /* glsl */`
precision highp float;
attribute vec3 iPos;
attribute vec3 iScale;
attribute float iRot;
attribute vec4 iCol;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vWorld;
void main() {
  vec2 c = position.xy;
  float s = sin(iRot), co = cos(iRot);
  vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
  vec3 world = iPos + uCamRight * r.x * iScale.x + uCamUp * r.y * iScale.y;
  vUv = uv;
  vCol = iCol;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const PUFF_FS = /* glsl */`
precision highp float;
${GLSL_COMMON_HEAD}
uniform sampler2D uAtlas;
uniform vec2 uAtlasOffset;
uniform vec2 uAtlasScale;
uniform vec3 uCamPos;
uniform float uNight;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vWorld;
void main() {
  vec2 uv = uAtlasOffset + vUv * uAtlasScale;
  vec4 t = texture2D(uAtlas, uv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  vec3 col = vCol.rgb * t.rgb;
  // distance fade to avoid hard edges at the far clip
  float d = length(vWorld - uCamPos);
  a *= 1.0 - smoothstep(22000.0, 34000.0, d);
  col *= mix(1.0, 0.45, uNight);
  gl_FragColor = vec4(col, a);
}
`;

export class CloudField {
  constructor(opts = {}) {
    this.rng = new RNG(opts.seed || 4242);
    this.noise = new Noise(opts.seed || 4242);
    this.cellSize = opts.cellSize || 900;
    this.gridRadius = opts.gridRadius || 13;     // cells around the player
    this.maxPuffs = opts.maxPuffs || 6500;
    this.qualityScale = 1;
    this.clouds = [];
    this.puffs = [];           // {pos, size, rot, color, alpha, cloud}
    this.sorted = [];
    this.atlas = opts.atlas || null;
    this.enabled = opts.enabled !== false;
    this.windOffset = new THREE.Vector2();
    this._lastCell = { x: 1e9, z: 1e9 };
    this._buildGeometry();
    this.inCloudFog = 0;
    this.nearStorm = 0;
  }

  _buildGeometry() {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.attributes.position = base.attributes.position;
    this.geometry.attributes.uv = base.attributes.uv;
    this.instPos = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 3), 3);
    this.instScale = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 2), 2);
    this.instRot = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs), 1);
    this.instCol = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 4), 4);
    this.instPos.setUsage(THREE.DynamicDrawUsage);
    this.instScale.setUsage(THREE.DynamicDrawUsage);
    this.instRot.setUsage(THREE.DynamicDrawUsage);
    this.instCol.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPos', this.instPos);
    this.geometry.setAttribute('iScale', this.instScale);
    this.geometry.setAttribute('iRot', this.instRot);
    this.geometry.setAttribute('iCol', this.instCol);
    this.geometry.instanceCount = 0;
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const atlas = this.atlas;
    this.material = new THREE.ShaderMaterial({
      vertexShader: PUFF_VS,
      fragmentShader: PUFF_FS,
      uniforms: {
        uAtlas: { value: atlas },
        uAtlasOffset: { value: new THREE.Vector2((SPR.PUFF % 4) * 0.25, Math.floor(SPR.PUFF / 4) * 0.25) },
        uAtlasScale: { value: new THREE.Vector2(0.25, 0.25) },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uCamPos: skyUniforms.cameraPos,
        uNight: skyUniforms.nightFactor
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setQuality(level) {
    this.qualityScale = [0.35, 0.65, 1.0, 1.4][clamp(level | 0, 0, 3)];
    this.gridRadius = Math.max(6, Math.round(13 * Math.min(1.2, this.qualityScale + 0.25)));
  }

  /** Regenerate clouds on the grid around the camera. */
  rebuild(cameraPos, env) {
    const rng = this.rng;
    const cell = this.cellSize;
    const R = this.gridRadius;
    const cx = Math.floor(cameraPos.x / cell);
    const cz = Math.floor(cameraPos.z / cell);
    this.clouds.length = 0;
    this.puffs.length = 0;
    const coverage = clamp01(env.cloudCoverage + env.stormCover * 0.5);
    const base = env.cloudBase;
    const thick = env.cloudThickness;

    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const gx = cx + dx, gz = cz + dz;
        // deterministic coverage per cell + turbulence from low-freq noise
        const wx = (gx * cell) * 0.00008, wz = (gz * cell) * 0.00008;
        const n = this.noise.fbm2(wx, wz, 3) * 0.5 + 0.5;
        const cluster = smoothstep(0.35, 0.85, n);
        const roll = this.noise.fbm2(gx * 0.37, gz * 0.41, 2) * 0.5 + 0.5;
        if (roll > coverage * 0.95 * cluster + 0.06) continue;
        const storm = env.stormCover > 0.35 && this.noise.fbm2(wx * 3.1 + 40, wz * 3.1, 2) > 0.15;
        const jx = (this.noise.fbm2(gx * 1.7 + 3, gz * 1.7, 2)) * cell * 0.34;
        const jz = (this.noise.fbm2(gx * 1.7, gz * 1.7 + 7, 2)) * cell * 0.34;
        const px = (gx + 0.5) * cell + jx;
        const pz = (gz + 0.5) * cell + jz;
        const dist = Math.hypot(px - cameraPos.x, pz - cameraPos.z);
        if (dist > R * cell * 1.35) continue;
        const sizeScale = (0.6 + this.noise.fbm2(gx * 0.83, gz * 0.83 + 12, 2) * 0.8);
        const cloud = {
          x: px, z: pz,
          y: base + thick * (0.35 + this.noise.fbm2(gx * 0.2 + 9, gz * 0.2, 2) * 0.3),
          r: (storm ? 900 : 520) * sizeScale * (0.75 + rng.float(0, 0.55)),
          h: (storm ? 1400 : 620) * sizeScale,
          storm,
          dist
        };
        this.clouds.push(cloud);
        const count = Math.round((storm ? 16 : 9) * (0.7 + rng.float(0, 0.6)) * Math.min(1.4, this.qualityScale + 0.35));
        for (let i = 0; i < count; i++) {
          const t = i / count;
          const ang = rng.float(0, Math.PI * 2);
          const rad = Math.pow(rng.float(0.25, 1.0), 0.65);
          const py = cloud.y + rng.gauss(0, cloud.h * 0.30);
          const spread = cloud.r * (1.0 - Math.abs(py - cloud.y) / (cloud.h * 0.8 + 1)) * rad;
          const size = cloud.r * rng.float(0.55, 1.15);
          this.puffs.push({
            x: cloud.x + Math.cos(ang) * Math.abs(spread) * 0.6,
            y: py,
            z: cloud.z + Math.sin(ang) * Math.abs(spread) * 0.6,
            sx: size * 1.25,
            sy: size * (storm ? 0.85 : 0.75),
            rot: rng.float(0, Math.PI * 2),
            shade: rng.float(0.82, 1.15),
            cloud,
            dist
          });
          if (this.puffs.length >= this.maxPuffs) break;
        }
        if (this.puffs.length >= this.maxPuffs) break;
      }
      if (this.puffs.length >= this.maxPuffs) break;
    }
    this._sortAndUpload(env);
  }

  _sortAndUpload(env) {
    const puffs = this.puffs;
    // sort back-to-front (approximate: by cloud distance then puff y)
    puffs.sort((a, b) => (b.dist - a.dist) || (a.y - b.y));
    const pos = this.instPos.array, sc = this.instScale.array, rot = this.instRot.array, col = this.instCol.array;
    const sun = env.sunDir;
    const sunCol = env.sunColor;
    const night = env.nightFactor;
    const amb = 0.30 + 0.35 * (1 - night);
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      sc[i * 2] = p.sx; sc[i * 2 + 1] = p.sy;
      rot[i] = p.rot;
      // fake lighting: brighter on the sun side, darker at the base
      const heightT = clamp01((p.y - (p.cloud.y - p.cloud.h)) / (p.cloud.h * 1.6 + 1));
      const lit = clamp01(0.35 + 0.75 * heightT) * p.shade;
      const baseCol = p.cloud.storm
        ? [0.30 * lit, 0.31 * lit, 0.35 * lit]
        : [0.92 * lit, 0.94 * lit, 0.99 * lit];
      col[i * 4] = (baseCol[0] * (0.55 + sunCol.r * 0.5) + amb * 0.25);
      col[i * 4 + 1] = (baseCol[1] * (0.55 + sunCol.g * 0.5) + amb * 0.25);
      col[i * 4 + 2] = (baseCol[2] * (0.55 + sunCol.b * 0.5) + amb * 0.3);
      const fade = 1.0 - smoothstep(0.75, 1.0, p.dist / (this.gridRadius * this.cellSize * 1.2));
      col[i * 4 + 3] = clamp01((p.cloud.storm ? 0.5 : 0.62) * fade * (0.75 + 0.35 * (1 - night)));
    }
    const n = puffs.length;
    this.instPos.needsUpdate = true;
    this.instScale.needsUpdate = true;
    this.instRot.needsUpdate = true;
    this.instCol.needsUpdate = true;
    this.geometry.instanceCount = n;
    const draw = Math.max(1, Math.floor(n * this.drawFraction()));
    this.geometry.instanceCount = draw;
    this.puffCount = draw;
    this._lastCell.x = Math.floor(0); // caller tracks position
  }

  drawFraction() { return 1; }

  /** Per-frame update: recentre the cloud field and update the camera basis. */
  update(camera, env, dt) {
    if (!this.enabled) { this.geometry.instanceCount = 0; return; }
    const cell = this.cellSize;
    const cx = Math.floor(camera.position.x / cell);
    const cz = Math.floor(camera.position.z / cell);
    const moved = Math.abs(cx - this._lastCell.x) > 2 || Math.abs(cz - this._lastCell.z) > 2 ||
      !this.puffCount || Math.abs(env.cloudCoverage - (this._cover || 0)) > 0.05 ||
      Math.abs(env.stormCover - (this._storm || 0)) > 0.08;
    if (moved) {
      this._lastCell.x = cx; this._lastCell.z = cz;
      this._cover = env.cloudCoverage; this._storm = env.stormCover;
      this.rebuild(camera.position, env);
    }
    const right = new THREE.Vector3(), up = new THREE.Vector3();
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    this.material.uniforms.uCamRight.value.copy(right);
    this.material.uniforms.uCamUp.value.copy(up);
    // how deep inside a cloud the camera is (drives the in-cloud white-out fog)
    const target = this.densityAt(camera.position);
    this.inCloudFog = this.inCloudFog || 0;
    this.inCloudFog = this.inCloudFog + (target - this.inCloudFog) * (1 - Math.exp(-dt * 3.2));
    this.nearStorm = this.densityAt(camera.position) > 0.35 ? 1 : this.nearStorm * 0.98;
  }

  /** Approximate cloud density at a world position (0 = clear air). */
  densityAt(pos) {
    let d = 0;
    const clouds = this.clouds;
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const dx = pos.x - c.x, dz = pos.z - c.z, dy = pos.y - c.y;
      const rr = c.r * c.r;
      const horizontal = (dx * dx + dz * dz) / rr;
      const vertical = (dy * dy) / ((c.h * 0.75) * (c.h * 0.75));
      const q = 1.0 - (horizontal + vertical);
      if (q > 0) d += q * (c.storm ? 1.5 : 1.0);
    }
    return clamp01(d * 0.8);
  }

  /** Nearest storm cloud for lightning; returns null when none near. */
  nearestStorm(pos, maxDist = 12000) {
    let best = null, bd = maxDist;
    for (const c of this.clouds) {
      if (!c.storm) continue;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
