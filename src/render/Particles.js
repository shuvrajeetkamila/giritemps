// ---------------------------------------------------------------------------
// Particles — GPU-instanced billboard pool (fire / smoke / sparks / debris /
// tracers / flares / shockwaves) with two blend groups: additive + alpha.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { SPR } from './Shading.js';
import { RNG, clamp01, lerp } from '../core/Utils.js';
import { GLSL_COMMON_HEAD } from '../core/glsl.js';

const PART_VS = /* glsl */`
precision highp float;
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec4 iParams;   // x: size, y: rot, z: sprite index, w: stretch
attribute vec3 iVel;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uVelDir;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vAtlasO;
varying vec3 vWorld;
void main() {
  vec2 c = position.xy;
  float s = sin(iParams.y), co = cos(iParams.y);
  vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
  // stretch along the velocity direction for tracers / rain
  vec3 across = normalize(cross(uVelDir, uCamUp) + vec3(1e-5));
  vec3 upv = normalize(cross(across, uVelDir));
  float stretch = iParams.w;
  vec3 world = iPos
    + uCamRight * r.x * iParams.x * (1.0 - stretch * 0.65)
    + uCamUp * r.y * iParams.x
    + upv * r.y * iParams.x * stretch * 1.6;
  vUv = uv;
  vCol = iCol;
  float idx = floor(iParams.z + 0.5);
  vAtlasO = vec3(mod(idx, 4.0) * 0.25, floor(idx / 4.0) * 0.25, 1.0);
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const PART_FS = /* glsl */`
precision highp float;
${GLSL_COMMON_HEAD}
uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uSoft;
varying vec2 vUv;
varying vec4 vCol;
varying vec3 vAtlasO;
varying vec3 vWorld;
void main() {
  vec2 uv = vAtlasO.xy + vUv * 0.25;
  vec4 t = texture2D(uAtlas, uv);
  float a = t.a * vCol.a;
  if (a < 0.003) discard;
  vec3 col = vCol.rgb * t.rgb;
  // distance fade into the aerial fog
  float dist = length(vWorld - uCamPos);
  float f = 1.0 - exp(-dist * uFogDensity);
  col = mix(col, uFogColor * (1.0 - a * 0.4), f * 0.85);
  a *= 1.0 - f * 0.35;
  gl_FragColor = vec4(col, a);
}
`;

class ParticlePool {
  constructor(capacity, atlas, blending, uniforms) {
    this.capacity = capacity;
    this.count = 0;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.r0 = new Float32Array(capacity);
    this.g0 = new Float32Array(capacity);
    this.b0 = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.sprite = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.rotVel = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.stretch = new Float32Array(capacity);
    this.fade = new Float32Array(capacity);

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.aPos, this.aCol, this.aParams, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iParams', this.aParams);
    geo.setAttribute('iVel', this.aVel);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.geo = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: PART_VS,
      fragmentShader: PART_FS,
      uniforms: {
        uAtlas: { value: atlas },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uVelDir: { value: new THREE.Vector3(0, 1, 0) },
        uCamPos: uniforms.cameraPos,
        uFogColor: uniforms.fogColor,
        uFogDensity: uniforms.fogDensity,
        uSoft: { value: 1 }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 7 : 6;
  }

  alloc() {
    // reuse the oldest / dead slot, otherwise grow the count
    for (let i = 0; i < this.count; i++) if (this.life[i] <= 0) return i;
    if (this.count < this.capacity) return this.count++;
    // recycle the particle with the least remaining life
    let best = 0, bl = Infinity;
    for (let i = 0; i < this.count; i++) if (this.life[i] < bl) { bl = this.life[i]; best = i; }
    return best;
  }

  spawn(p) {
    const i = this.alloc();
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx || 0; this.vy[i] = p.vy || 0; this.vz[i] = p.vz || 0;
    this.life[i] = p.life; this.maxLife[i] = p.life;
    this.size0[i] = p.size; this.size[i] = p.size;
    this.grow[i] = p.grow !== undefined ? p.grow : 0;
    this.r0[i] = p.r; this.g0[i] = p.g; this.b0[i] = p.b;
    this.r[i] = p.r; this.g[i] = p.g; this.b[i] = p.b;
    this.a0[i] = p.a !== undefined ? p.a : 1;
    this.alpha[i] = this.a0[i];
    this.sprite[i] = p.sprite || 0;
    this.rot[i] = p.rot || Math.random() * 6.28;
    this.rotVel[i] = p.rotVel !== undefined ? p.rotVel : (Math.random() - 0.5) * 1.5;
    this.drag[i] = p.drag !== undefined ? p.drag : 0.4;
    this.gravity[i] = p.gravity !== undefined ? p.gravity : 0;
    this.stretch[i] = p.stretch || 0;
    this.fade[i] = p.fadePow !== undefined ? p.fadePow : 1;
    return i;
  }

  update(dt, env) {
    const n = this.count;
    const aPos = this.aPos.array, aCol = this.aCol.array, aPar = this.aParams.array, aVel = this.aVel.array;
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const t = 1 - this.life[i] / this.maxLife[i];      // 0..1 age
      // physics
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      this.vy[i] -= this.gravity[i] * dt;
      if (env && env.windSpeed) {
        this.vx[i] += env.windDir.x * env.windSpeed * dt * 0.06;
        this.vz[i] += env.windDir.y * env.windSpeed * dt * 0.06;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotVel[i] * dt;
      // appearance
      const sz = this.size0[i] + this.grow[i] * t;
      const age = Math.pow(t, this.fade[i]);
      let col = i;
      const alpha = this.a0[i] * (1 - age);
      if (alpha <= 0.004) { this.life[i] = 0; continue; }
      const j = live++;
      aPos[j * 3] = this.px[i]; aPos[j * 3 + 1] = this.py[i]; aPos[j * 3 + 2] = this.pz[i];
      aVel[j * 3] = this.vx[i]; aVel[j * 3 + 1] = this.vy[i]; aVel[j * 3 + 2] = this.vz[i];
      aCol[j * 4] = this.r[i]; aCol[j * 4 + 1] = this.g[i]; aCol[j * 4 + 2] = this.b[i];
      aCol[j * 4 + 3] = alpha;
      aPar[j * 4] = sz; aPar[j * 4 + 1] = this.rot[i];
      aPar[j * 4 + 2] = this.sprite[i]; aPar[j * 4 + 3] = this.stretch[i];
    }
    this.live = live;
    this.geo.instanceCount = live;
    if (live > 0) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aParams.needsUpdate = true;
      this.aVel.needsUpdate = true;
    }
  }

}

export class ParticleSystem {
  constructor(atlas, uniforms) {
    this.atlas = atlas;
    this.additive = new ParticlePool(5000, atlas, THREE.AdditiveBlending, uniforms);
    this.alpha = new ParticlePool(3500, atlas, THREE.NormalBlending, uniforms);
    this.rng = new RNG(777);
    this.group = new THREE.Group();
    this.group.add(this.additive.mesh);
    this.group.add(this.alpha.mesh);
    this.group.name = 'particles';
    this.quality = 1;
  }

  setQuality(level) {
    this.quality = [0.45, 0.7, 1.0, 1.35][Math.max(0, Math.min(3, level | 0))];
  }

  get scale() { return this.quality; }

  update(dt, env, camera) {
    this.additive.update(dt, env);
    this.alpha.update(dt, env);
    if (camera) {
      const m = camera.matrixWorld.elements;
      this.additive.material.uniforms.uCamRight.value.set(m[0], m[1], m[2]);
      this.additive.material.uniforms.uCamUp.value.set(m[4], m[5], m[6]);
      this.alpha.material.uniforms.uCamRight.value.set(m[0], m[1], m[2]);
      this.alpha.material.uniforms.uCamUp.value.set(m[4], m[5], m[6]);
    }
  }

  // -----------------------------------------------------------------------
  // Effect recipes
  // -----------------------------------------------------------------------
  explosion(pos, scale = 1, opts = {}) {
    const rng = this.rng;
    const n = Math.round((14 + scale * 10) * this.quality);
    // core fireball
    this.additive.spawn({
      x: pos.x, y: pos.y, z: pos.z, size: scale * 9, grow: scale * 24,
      r: 1.0, g: 0.92, b: 0.72, a: 1.0, life: 0.38 + scale * 0.1, sprite: SPR.FIRE,
      rotVel: rng.float(-1.6, 1.6), drag: 1.4, fadePow: 1.6
    });
    for (let i = 0; i < n; i++) {
      const dir = randomDir(rng);
      const sp = rng.float(12, 60) * (0.6 + scale * 0.5);
      this.additive.spawn({
        x: pos.x + dir.x * scale * 3, y: pos.y + dir.y * scale * 3, z: pos.z + dir.z * scale * 3,
        vx: dir.x * sp, vy: dir.y * sp + rng.float(0, 12), vz: dir.z * sp,
        size: scale * rng.float(4, 12), grow: scale * rng.float(6, 18),
        r: 1.0, g: rng.float(0.4, 0.85), b: rng.float(0.05, 0.25), a: 0.95,
        life: rng.float(0.5, 1.5) * (0.7 + scale * 0.3), sprite: rng.bool(0.55) ? SPR.FIRE : SPR.SPARK,
        drag: 1.1, gravity: 3, fadePow: 1.4, rotVel: rng.float(-3, 3)
      });
    }
    // smoke column
    const smoke = Math.round((10 + scale * 12) * this.quality);
    for (let i = 0; i < smoke; i++) {
      const dir = randomDir(rng);
      const sp = rng.float(3, 16) * (0.5 + scale * 0.4);
      this.alpha.spawn({
        x: pos.x + dir.x * scale * 5, y: pos.y + Math.abs(dir.y) * scale * 6 + 2, z: pos.z + dir.z * scale * 5,
        vx: dir.x * sp, vy: rng.float(6, 22) + scale * 3, vz: dir.z * sp,
        size: scale * rng.float(8, 18), grow: scale * rng.float(18, 44),
        r: 0.26, g: 0.25, b: 0.25, a: rng.float(0.4, 0.75),
        life: rng.float(3.5, 8) * (0.7 + scale * 0.6), sprite: SPR.SMOKE,
        drag: 0.7, gravity: -1.2, fadePow: 1.2, rotVel: rng.float(-0.6, 0.6)
      });
    }
    // sparks
    const sparks = Math.round((12 + scale * 16) * this.quality);
    for (let i = 0; i < sparks; i++) {
      const dir = randomDir(rng);
      const sp = rng.float(40, 160) * (0.5 + scale * 0.6);
      this.additive.spawn({
        x: pos.x, y: pos.y, z: pos.z, vx: dir.x * sp, vy: dir.y * sp + 20, vz: dir.z * sp,
        size: scale * rng.float(0.5, 1.6), grow: -0.4,
        r: 1.0, g: 0.85, b: 0.5, a: 1.0, life: rng.float(0.4, 1.4), sprite: SPR.SPARK,
        drag: 0.22, gravity: 26, fadePow: 1.0, stretch: 0.9
      });
    }
    // debris chunks
    if (scale > 0.5) {
      const debris = Math.round(6 * this.quality * scale);
      for (let i = 0; i < debris; i++) {
        const dir = randomDir(rng);
        const sp = rng.float(18, 70);
        this.alpha.spawn({
          x: pos.x, y: pos.y, z: pos.z, vx: dir.x * sp, vy: dir.y * sp + 26, vz: dir.z * sp,
          size: scale * rng.float(1.2, 3.6), grow: 0,
          r: 0.5, g: 0.5, b: 0.52, a: 1.0, life: rng.float(2.2, 5.0), sprite: SPR.DEBRIS,
          drag: 0.08, gravity: 14, fadePow: 2.4, rotVel: rng.float(-4, 4)
        });
      }
    }
    // shockwave ring
    if (opts.shockwave !== false && scale > 0.7) {
      this.additive.spawn({
        x: pos.x, y: Math.max(pos.y, 0.5), z: pos.z, size: scale * 6, grow: scale * 90,
        r: 1.0, g: 0.95, b: 0.85, a: 0.7, life: 0.55, sprite: SPR.RING,
        drag: 2.0, fadePow: 1.8, rot: 0, rotVel: 0
      });
    }
    // ground dust
    if (opts.dust) {
      for (let i = 0; i < Math.round(14 * this.quality); i++) {
        const dir = randomDir(rng);
        this.alpha.spawn({
          x: pos.x + dir.x * 12, y: pos.y + 2, z: pos.z + dir.z * 12,
          vx: dir.x * rng.float(20, 60), vy: rng.float(4, 18), vz: dir.z * rng.float(20, 60),
          size: scale * rng.float(8, 22), grow: scale * 30,
          r: 0.72, g: 0.66, b: 0.55, a: 0.6, life: rng.float(2, 5), sprite: SPR.DUST,
          drag: 1.1, gravity: -0.5, fadePow: 1.3, rotVel: rng.float(-0.5, 0.5)
        });
      }
    }
  }

  smokeTrail(pos, scale = 1, color = 0.24, life = 3.0, vel = null) {
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: vel ? vel.x * 0.06 + this.rng.float(-1, 1) : this.rng.float(-1, 1),
      vy: vel ? vel.y * 0.06 + this.rng.float(0, 2) : this.rng.float(0, 2),
      vz: vel ? vel.z * 0.06 + this.rng.float(-1, 1) : this.rng.float(-1, 1),
      size: 1.4 * scale, grow: 8 * scale,
      r: color, g: color, b: color * 1.03, a: 0.55 * clamp01(scale),
      life: life * this.rng.float(0.75, 1.25), sprite: SPR.SMOKE,
      drag: 0.9, gravity: -0.8, fadePow: 1.1, rotVel: this.rng.float(-0.8, 0.8)
    });
  }

  contrail(pos, scale = 1) {
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      size: 1.6 * scale, grow: 6 * scale,
      r: 0.95, g: 0.96, b: 1.0, a: 0.34,
      life: this.rng.float(3.5, 6.5), sprite: SPR.PUFF,
      drag: 1.2, gravity: -0.4, fadePow: 1.15, rotVel: this.rng.float(-0.3, 0.3)
    });
  }

  vaporPuff(pos, strength = 1, vel = null) {
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: vel ? vel.x * 0.02 : 0, vy: vel ? vel.y * 0.02 : 0, vz: vel ? vel.z * 0.02 : 0,
      size: 0.9 * strength, grow: 5 * strength,
      r: 1.0, g: 1.0, b: 1.0, a: 0.5 * clamp01(strength),
      life: this.rng.float(1.1, 2.4), sprite: SPR.STREAK,
      drag: 2.2, gravity: 0, fadePow: 1.3, rotVel: this.rng.float(-0.2, 0.2)
    });
  }

  muzzleFlash(pos, dir, scale = 1) {
    this.additive.spawn({
      x: pos.x, y: pos.y, z: pos.z, size: 1.5 * scale, grow: 4 * scale,
      r: 1.0, g: 0.88, b: 0.6, a: 0.95, life: 0.055, sprite: SPR.MUZZLE,
      drag: 4, fadePow: 0.8, rot: Math.random() * 6.28, rotVel: 0
    });
    this.additive.spawn({
      x: pos.x + dir.x * 2, y: pos.y + dir.y * 2, z: pos.z + dir.z * 2, size: 0.8 * scale, grow: 2,
      r: 1.0, g: 0.8, b: 0.45, a: 0.8, life: 0.07, sprite: SPR.GLOW, drag: 4, fadePow: 1.0
    });
  }

  tracer(start, end, color = 0xffcc66) {
    const c = new THREE.Color(color);
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.additive.spawn({
      x: start.x, y: start.y, z: start.z,
      vx: dx / len * 900, vy: dy / len * 900, vz: dz / len * 900,
      size: 1.1, grow: 0, r: c.r, g: c.g, b: c.b, a: 1.0, life: 0.09,
      sprite: SPR.TRACER, drag: 0.0, fadePow: 0.7, stretch: 1.2,
      rot: Math.atan2(dy, Math.hypot(dx, dz))
    });
  }

  impact(pos, normal, scale = 1, metal = true) {
    const rng = this.rng;
    const dir = normal || { x: 0, y: 1, z: 0 };
    for (let i = 0; i < Math.round(8 * this.quality); i++) {
      const d = randomDir(rng);
      this.additive.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: (d.x + dir.x) * rng.float(8, 45), vy: (d.y + dir.y) * rng.float(8, 45), vz: (d.z + dir.z) * rng.float(8, 45),
        size: rng.float(0.3, 1.0), grow: -0.2,
        r: metal ? 1.0 : 1.0, g: metal ? 0.9 : 0.7, b: metal ? 0.7 : 0.4, a: 1.0,
        life: rng.float(0.2, 0.7), sprite: SPR.SPARK, drag: 0.3, gravity: 22, stretch: 0.8
      });
    }
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z, size: 1.6 * scale, grow: 6 * scale,
      r: 0.42, g: 0.4, b: 0.38, a: 0.55, life: rng.float(0.7, 1.4), sprite: SPR.SMOKE,
      drag: 1.5, gravity: -1, fadePow: 1.2
    });
  }

  flare(pos, vel, life = 4.5) {
    this.additive.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z,
      size: 3.2, grow: 0.5, r: 1.0, g: 0.85, b: 0.55, a: 1.0, life, sprite: SPR.FLARE,
      drag: 0.32, gravity: 4, fadePow: 0.35, rotVel: 0
    });
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z, size: 1.5, grow: 10,
      r: 0.7, g: 0.68, b: 0.66, a: 0.35, life: life * 0.7, sprite: SPR.SMOKE,
      drag: 1.0, gravity: -0.5, fadePow: 1.0, rotVel: 0
    });
  }

  chaffCloud(pos, vel) {
    const rng = this.rng;
    for (let i = 0; i < 10; i++) {
      const d = randomDir(rng);
      this.additive.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: vel.x * 0.4 + d.x * 8, vy: vel.y * 0.4 + d.y * 8, vz: vel.z * 0.4 + d.z * 8,
        size: 0.6, grow: 3, r: 0.9, g: 0.92, b: 0.95, a: 0.5,
        life: rng.float(1.2, 2.6), sprite: SPR.GLOW, drag: 1.4, gravity: -0.6, fadePow: 1.2
      });
    }
  }

  missileMotor(pos, vel) {
    this.additive.spawn({
      x: pos.x, y: pos.y, z: pos.z, size: 2.0, grow: 2.5,
      r: 1.0, g: 0.75, b: 0.4, a: 0.9, life: 0.14, sprite: SPR.FIRE, drag: 2.5, fadePow: 1.0
    });
    this.smokeTrail(pos, 0.55, 0.62, 4.0, vel);
  }

  debrisTrail(pos, vel, scale = 1) {
    this.alpha.spawn({
      x: pos.x, y: pos.y, z: pos.z,
      vx: vel.x * 0.1, vy: vel.y * 0.1, vz: vel.z * 0.1,
      size: scale * 0.8, grow: scale * 3, r: 0.3, g: 0.29, b: 0.3, a: 0.5,
      life: this.rng.float(1.0, 2.8), sprite: SPR.DEBRIS, drag: 0.4, gravity: 12,
      fadePow: 1.6, rotVel: this.rng.float(-4, 4)
    });
  }

  dispose() {
    this.additive.geo.dispose(); this.additive.material.dispose();
    this.alpha.geo.dispose(); this.alpha.material.dispose();
  }
}

function randomDir(rng) {
  const u = rng.float(-1, 1), th = rng.float(0, Math.PI * 2);
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return { x: r * Math.cos(th), y: u, z: r * Math.sin(th) };
}
