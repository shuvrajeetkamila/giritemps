// Sky dome with analytic atmosphere, stars, sun and moon, and procedural cloud layers.
// The sky, sun and moon are one shader; clouds are ray-plane intersections with fbm noise.
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // at far plane
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  varying vec3 vWorld;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform float uNight;          // 0 day .. 1 night
  uniform float uTime;
  uniform vec3 uCamPos;
  uniform float uCover;          // low cloud coverage 0..1
  uniform float uCirrus;         // high cloud amount 0..1
  uniform float uStorm;          // 0..1 darkening and thickening
  uniform float uFlash;          // lightning flash intensity
  uniform vec2 uWind;
  uniform float uCloudDetail;    // number of fbm octaves for low clouds
  uniform float uHaze;           // fog/haze density (affects sky brightness)
  uniform vec3 uFogColor;

  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float vn(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y);
  }
  float fbm(vec2 p, int oct){
    float s=0.0, a=0.5;
    for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; }
    return s;
  }

  // Analytic gradient sky (Rayleigh-like zenith, Mie-like sun halo, sunset reddening).
  vec3 skyBase(vec3 d){
    float sunH = uSunDir.y;
    float dayF = smoothstep(-0.12, 0.25, sunH);
    vec3 zenithDay = vec3(0.16, 0.36, 0.86);
    vec3 horizDay  = vec3(0.62, 0.78, 0.95);
    vec3 zenithNight = vec3(0.004, 0.006, 0.02);
    vec3 horizNight  = vec3(0.012, 0.018, 0.04);
    vec3 zen = mix(zenithNight, zenithDay, dayF);
    vec3 hor = mix(horizNight, horizDay, dayF);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(hor, zen, pow(up, 0.45));
    // Sunset / sunrise band.
    float low = 1.0 - smoothstep(0.0, 0.35, abs(sunH));
    float sunDot = max(dot(d, uSunDir), 0.0);
    vec3 warm = vec3(1.0, 0.45, 0.18);
    col = mix(col, warm * (0.6 + 0.4*sunDot), low * pow(sunDot, 2.0) * 0.55);
    col = mix(col, hor * 1.1, low * (1.0 - up) * 0.4);
    // Rayleigh-ish forward scatter and Mie halo.
    float mu = dot(d, uSunDir);
    col += vec3(0.25,0.35,0.6) * 0.05 * (1.0 + mu*mu) * dayF;
    col += uSunColor * pow(max(mu,0.0), 12.0) * 0.35 * dayF;
    col += uSunColor * pow(max(mu,0.0), 180.0) * 1.2;
    return col;
  }

  vec3 stars(vec3 d){
    float night = uNight;
    if (night < 0.01) return vec3(0.0);
    vec3 g = d * 220.0;
    vec3 cell = floor(g);
    float r = h21(cell.xy + cell.z*7.13);
    float star = step(0.9965, r) * pow(fract(r*91.7), 3.0) * 1.6;
    float tw = 0.75 + 0.25*sin(uTime*2.0 + r*60.0);
    return vec3(star * tw) * night * smoothstep(-0.02, 0.1, d.y);
  }

  // Cloud layer: ray against plane at height H.
  // Returns vec2(density, lit) for the layer.
  vec2 cloudLayer(vec3 d, float H, float scale, float cover, float softness, out float far){
    far = 0.0;
    if (abs(d.y) < 1e-3) return vec2(0.0);
    float t = (H - uCamPos.y) / d.y;
    if (t <= 0.0) return vec2(0.0);
    far = t;
    vec2 p = uCamPos.xz + d.xz * t;
    vec2 q = p * scale + uWind * uTime * 0.02;
    float base = fbm(q, 4);
    float detail = fbm(q * 3.7 + 11.0, int(uCloudDetail)) * 0.35;
    float dens = smoothstep(cover - softness, cover + softness, base * 0.8 + detail * 0.4);
    // Self-shadow: sample toward sun.
    vec2 sq = q + uSunDir.xz * 0.35;
    float shadowSample = smoothstep(cover - softness, cover + softness, fbm(sq, 3) * 0.8 + detail * 0.3);
    float lit = clamp(1.0 - shadowSample * 0.7, 0.2, 1.0);
    return vec2(dens, lit);
  }

  void main(){
    vec3 d = normalize(vDir);
    vec3 col = skyBase(d);
    col += stars(d);

    // Moon with glow and phase-free disc.
    float mm = dot(d, uMoonDir);
    float moonDisc = smoothstep(0.99985, 0.99995, mm);
    float moonGlow = pow(max(mm, 0.0), 300.0) * 0.5 + pow(max(mm, 0.0), 20.0) * 0.04;
    col += (vec3(0.85, 0.9, 1.0) * moonDisc * 1.1 + vec3(0.5,0.6,0.8) * moonGlow) * uNight * smoothstep(-0.05, 0.05, d.y);

    // Sun disc.
    float sm = dot(d, uSunDir);
    col += uSunColor * (smoothstep(0.99955, 0.9998, sm) * 6.0 + pow(max(sm,0.0), 1500.0)*4.0) * uSunIntensity * 0.2;

    // Clouds: low cumulus at 1600 m, storm/cumulus scale, high cirrus at 7500 m.
    float far1, far2;
    float cover = mix(0.56, 0.36, uCover) - uStorm * 0.12;
    vec2 low = cloudLayer(d, 1600.0, 0.00075, cover, 0.12, far1);
    float lowA = low.x * smoothstep(0.0, 0.25, d.y) * (1.0 - smoothstep(20000.0, 65000.0, far1));
    vec3 sunLit = uSunColor * uSunIntensity * 0.35 + vec3(0.12, 0.13, 0.16);
    vec3 stormDark = vec3(0.22, 0.23, 0.26);
    vec3 cloudCol = mix(sunLit * low.y, stormDark * (0.6 + 0.4*low.y), uStorm);
    cloudCol += uFlash * vec3(0.7,0.8,1.0) * (0.5 + low.y);
    cloudCol = mix(cloudCol, cloudCol * (0.25 + 0.75*uNight), uNight);
    col = mix(col, cloudCol, lowA * 0.92);

    // Cirrus: stretched, thin wisps.
    vec2 hp = uCamPos.xz + d.xz * ((7500.0 - uCamPos.y) / max(d.y, 1e-3));
    float cir = 0.0;
    if (d.y > 0.02 && uCirrus > 0.0) {
      float t2 = (7500.0 - uCamPos.y) / d.y;
      vec2 q2 = hp * vec2(0.00025, 0.0009) + uWind * uTime * 0.01;
      cir = smoothstep(0.55 - uCirrus*0.2, 0.9, fbm(q2, 4)) * uCirrus * (1.0 - smoothstep(30000.0, 90000.0, t2));
    }
    col = mix(col, mix(vec3(0.95,0.96,1.0), uSunColor, 0.1) * (0.4 + 0.6*uSunIntensity*0.5 + 0.1), cir * 0.55 * (1.0 - uStorm*0.5));

    // Atmospheric haze toward the horizon.
    float hz = exp(-max(d.y, 0.0) * 5.0) * uHaze;
    col = mix(col, uFogColor, clamp(hz, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunColor = new THREE.Color(1, 1, 1);
    this.sunIntensity = 1;
    this.night = 0;
    this.time = 0;
    this.uniforms = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uSunColor: { value: this.sunColor }, uSunIntensity: { value: 1 }, uNight: { value: 0 },
      uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uCover: { value: 0 },
      uCirrus: { value: 0.5 }, uStorm: { value: 0 }, uFlash: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0.3) }, uCloudDetail: { value: 4 }, uHaze: { value: 0.35 },
      uFogColor: { value: new THREE.Color(0.6, 0.75, 0.9) },
    };
    const geo = new THREE.SphereGeometry(60000, 48, 24);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms,
      depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Sun lens flare: textures are painted on canvases at runtime.
    this.flare = new Lensflare();
    const glow = makeGlowTexture();
    const ring = makeGlowTexture(0.25);
    this.flare.addElement(new LensflareElement(glow, 900, 0, new THREE.Color(1, 0.95, 0.8)));
    this.flare.addElement(new LensflareElement(ring, 120, 0.35, new THREE.Color(0.6, 0.8, 1)));
    this.flare.addElement(new LensflareElement(ring, 60, 0.6, new THREE.Color(1, 0.7, 0.4)));
    this.flare.addElement(new LensflareElement(ring, 200, 0.85, new THREE.Color(0.5, 1, 0.7)));
    this.flareMesh = new THREE.Object3D();
    this.flareMesh.add(this.flare);
    scene.add(this.flareMesh);
    this.flareMesh.visible = true;
  }

  // timeOfDay in hours [0,24). Sun rises at 6, sets at 18.
  setTimeOfDay(hours) {
    const t = ((hours % 24) + 24) % 24;
    const elev = ((t - 6) / 12) * Math.PI;   // 0 at sunrise, PI/2 at noon, PI at sunset
    const az = 2.3;
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1).add(new THREE.Vector3(0.1, 0, 0.05)).normalize();
    const e = this.sunDir.y;
    const dayF = THREE.MathUtils.smoothstep(e, -0.12, 0.25);
    this.night = 1 - dayF;
    this.uniforms.uNight.value = this.night;
    // Warm light at dawn/dusk, white at noon.
    const warm = 1 - THREE.MathUtils.smoothstep(e, 0.05, 0.6);
    this.sunColor.setRGB(1.0, 0.92 - 0.35 * warm, 0.82 - 0.6 * warm);
    this.sunIntensity = Math.max(0, Math.min(1, THREE.MathUtils.smoothstep(e, -0.05, 0.12)));
    this.uniforms.uSunIntensity.value = this.sunIntensity;
    const fog = new THREE.Color(0.62, 0.74, 0.9).lerp(new THREE.Color(0.55, 0.3, 0.2), warm * 0.6).lerp(new THREE.Color(0.02, 0.03, 0.07), this.night);
    this.uniforms.uFogColor.value.copy(fog);
    return fog;
  }

  update(dt, camPos, quality, weather) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCamPos.value.copy(camPos);
    this.uniforms.uCover.value = weather.cover;
    this.uniforms.uStorm.value = weather.storm;
    this.uniforms.uFlash.value = weather.flash;
    this.uniforms.uHaze.value = 0.35 + weather.fog * 1.5;
    this.uniforms.uCirrus.value = weather.cirrus;
    this.uniforms.uCloudDetail.value = Math.max(2, Math.min(6, quality.cloudDetail + 2));
    this.mesh.position.copy(camPos);
    // Lens flare sits far away along the sun direction.
    this.flareMesh.position.copy(camPos).addScaledVector(this.sunDir, 50000);
    this.flareMesh.visible = this.sunDir.y > -0.02;
  }

  sunScreenPosition(camera) {
    const p = this.sunDir.clone().multiplyScalar(50000).add(camera.position).project(camera);
    return { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5, behind: p.z > 1 };
  }
}

function makeGlowTexture(ringWidth = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (ringWidth === 0) {
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.2, 'rgba(255,240,210,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0)');
    grd.addColorStop(0.75, 'rgba(255,255,255,0.6)');
    grd.addColorStop(0.9, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
