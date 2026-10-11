// ---------------------------------------------------------------------------
// CascadedShadows — hand-rolled 3-cascade shadow maps (RGBA-packed depth).
//  * layer 1 : standard-material casters (rendered with an override depth mat)
//  * layer 2 : vertex-displaced casters (terrain tiles, own depth material)
// Gives crisp near shadows plus world-scale terrain self-shadowing.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const SHADOW_LAYER_OBJECTS = 1;
export const SHADOW_LAYER_TERRAIN = 2;

export class CascadedShadows {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.splits = [170, 1100, 9000];
    this.strength = 0.92;
    this.mapSize = [2048, 2048, 2048];
    this.targets = [];
    this.cameras = [];
    this.matrices = [];

    this.packMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.packMaterial.side = THREE.FrontSide;

    this.uniforms = {
      csm0: { value: null },
      csm1: { value: null },
      csm2: { value: null },
      csmMat0: { value: new THREE.Matrix4() },
      csmMat1: { value: new THREE.Matrix4() },
      csmMat2: { value: new THREE.Matrix4() },
      csmParams0: { value: new THREE.Vector4(1 / 2048, 0, 0.0006, 0) },
      csmParams1: { value: new THREE.Vector4(1 / 2048, 0, 0.0010, 0) },
      csmParams2: { value: new THREE.Vector4(1 / 2048, 0, 0.0022, 0) },
      csmSplits: { value: new THREE.Vector4(this.splits[0], this.splits[1], this.splits[2], this.strength) }
    };

    for (let i = 0; i < 3; i++) this._createCascade(i, this.mapSize[i]);
  }

  _createCascade(i, size) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false
    });
    rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    cam.layers.set(SHADOW_LAYER_OBJECTS);   // layer switched per pass
    this.targets[i] = rt;
    this.cameras[i] = cam;
    this.matrices[i] = new THREE.Matrix4();
    this.uniforms['csm' + i].value = rt.texture;
  }

  setQuality(level) {
    if (level <= 0) { this.enabled = false; this.uniforms.csmSplits.value.w = 0; return; }
    this.enabled = true;
    this.uniforms.csmSplits.value.w = this.strength;
    const sizes = level === 1 ? [1024, 1024, 512] : level === 2 ? [2048, 2048, 1024] : [4096, 4096, 2048];
    const far = level === 1 ? 3500 : level === 2 ? 9000 : 14000;
    this.setMapSize(sizes);
    this.setSplits(1.5, far);
  }

  setMapSize(sizes) {
    for (let i = 0; i < 3; i++) {
      if (this.targets[i].width === sizes[i]) continue;
      this.targets[i].setSize(sizes[i], sizes[i]);
      this.uniforms['csm' + i].value = this.targets[i].texture;
    }
    this.mapSize = sizes.slice();
    for (let i = 0; i < 3; i++) this.uniforms['csmParams' + i].value.x = 1 / sizes[i];
  }

  setSplits(near, far, lambda = 0.62) {
    const n = Math.max(0.8, near);
    const splits = [];
    for (let i = 1; i <= 3; i++) {
      const p = i / 3;
      const logSplit = n * Math.pow(far / n, p);
      const uni = n + (far - n) * p;
      splits.push(lambda * logSplit + (1 - lambda) * uni);
    }
    this.splits = splits;
    this.uniforms.csmSplits.value.set(splits[0], splits[1], splits[2], this.strength);
  }

  /** Build cascades + render the packed-depth shadow maps. */
  update(scene, camera, sunDir) {
    if (!this.enabled) return;
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevClear = new THREE.Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();

    camera.getWorldPosition(_center);
    camera.getWorldDirection(_forward);

    const sd = _sd.copy(sunDir).normalize();
    if (sd.y < 0.05) { sd.y = 0.05; sd.normalize(); }
    const up = Math.abs(sd.y) > 0.96 ? _upOther.set(1, 0, 0) : _upY.set(0, 1, 0);

    for (let i = 0; i < 3; i++) {
      const far = this.splits[i];
      const cam = this.cameras[i];
      const radius = far * (i === 0 ? 0.5 : i === 1 ? 0.66 : 0.8);
      const ahead = i === 0 ? 8 : far * 0.16;
      _c.copy(_forward).multiplyScalar(ahead).add(_center);

      const texelWorld = (radius * 2) / this.mapSize[i];
      _c.x = Math.round(_c.x / texelWorld) * texelWorld;
      _c.z = Math.round(_c.z / texelWorld) * texelWorld;
      _c.y = Math.max(_c.y, 40);

      const dist = radius + 5200;
      cam.position.copy(_c).addScaledVector(sd, dist);
      cam.up.copy(up);
      cam.lookAt(_c);
      cam.left = -radius; cam.right = radius;
      cam.top = radius; cam.bottom = -radius;
      cam.near = 1;
      cam.far = dist + 11000 + radius;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      this.matrices[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

      renderer.setRenderTarget(this.targets[i]);
      renderer.setClearColor(0xffffff, 1);

      // pass A — objects with packed depth override
      cam.layers.set(SHADOW_LAYER_OBJECTS);
      scene.overrideMaterial = this.packMaterial;
      renderer.render(scene, cam);

      // pass B — terrain tiles (custom displacement depth material)
      cam.layers.set(SHADOW_LAYER_TERRAIN);
      scene.overrideMaterial = null;
      renderer.render(scene, cam);
    }

    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    renderer.setClearColor(prevClear, prevAlpha);
    this.cameras[0].layers.set(SHADOW_LAYER_OBJECTS);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.packMaterial.dispose();
  }
}

const _center = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _c = new THREE.Vector3();
const _sd = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
const _upOther = new THREE.Vector3(1, 0, 0);
