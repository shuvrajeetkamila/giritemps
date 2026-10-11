// Animated ocean: vertex-displaced multi-wave surface, Fresnel sky reflection, foam on crests.
import * as THREE from 'three';

const VERT = /* glsl */`
  uniform float uTime;
  uniform vec2 uOffset;
  varying vec3 vWorld;
  varying float vCrest;
  varying vec3 vN;
  vec3 wave(vec2 p, float t, out vec3 dN){
    // Sum of directional sines; returns displacement and accumulates a normal.
    float h = 0.0; dN = vec3(0.0);
    for(int i=0;i<4;i++){
      float fi = float(i);
      vec2 dir = normalize(vec2(1.0 + fi*0.45, 0.6 - fi*0.3));
      float k = 6.2832 / (95.0 * (1.0 + fi*0.6));
      float a = 1.8 / (1.0 + fi*1.1);
      float ph = dot(dir, p) * k + t * (1.4 + fi*0.35);
      h += a * sin(ph);
      vec2 g = dir * a * k * cos(ph);
      dN.xz -= g;
    }
    return vec3(0.0, h, 0.0);
  }
  void main(){
    vec3 p = position;
    vec2 wp = p.xz + uOffset;
    vec3 dN;
    vec3 disp = wave(wp, uTime, dN);
    p.y += disp.y;
    vCrest = smoothstep(1.4, 3.2, disp.y);
    vN = normalize(vec3(dN.x, 1.0, dN.z));
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSkyColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uTime;
  varying vec3 vWorld;
  varying float vCrest;
  varying vec3 vN;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 9137.7); }
  void main(){
    vec3 V = normalize(uCamPos - vWorld);
    vec3 N = normalize(vN);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 deep = vec3(0.01, 0.12, 0.2);
    vec3 shallow = vec3(0.05, 0.45, 0.5);
    vec3 base = mix(deep, shallow, 0.25 + 0.2*vCrest);
    vec3 refl = mix(uSkyColor, uSunColor, 0.1) ;
    vec3 col = mix(base, refl, 0.25 + fres * 0.75);
    vec3 H = normalize(V + uSunDir);
    col += uSunColor * pow(max(dot(N, H), 0.0), 220.0) * 2.0;
    // Foam where crests are steep and noisy.
    float n = h2(floor(vWorld.xz * 0.25 + uTime * 0.1));
    float foam = vCrest * smoothstep(0.55, 0.85, n);
    col = mix(col, vec3(0.92, 0.96, 1.0), foam * 0.8);
    // Atmospheric fog.
    float dist = length(vWorld - uCamPos);
    float f = 1.0 - exp(-dist * uFogDensity);
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Ocean {
  constructor(scene) {
    this.size = 16000;
    const geo = new THREE.PlaneGeometry(this.size, this.size, 320, 320);
    geo.rotateX(-Math.PI / 2);
    this.uniforms = {
      uTime: { value: 0 }, uOffset: { value: new THREE.Vector2() },
      uSkyColor: { value: new THREE.Color(0.6, 0.75, 0.9) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uCamPos: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color(0.6, 0.75, 0.9) }, uFogDensity: { value: 0.00012 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt, camPos, sunDir, sunColor, fogColor, fogDensity, skyColor) {
    this.uniforms.uTime.value += dt;
    // Snap the grid to the camera so the sea seems infinite.
    const snap = 40;
    this.mesh.position.x = Math.round(camPos.x / snap) * snap;
    this.mesh.position.z = Math.round(camPos.z / snap) * snap;
    this.uniforms.uOffset.value.set(this.mesh.position.x, this.mesh.position.z);
    this.uniforms.uCamPos.value.copy(camPos);
    this.uniforms.uSunDir.value.copy(sunDir);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uFogColor.value.copy(fogColor);
    this.uniforms.uFogDensity.value = fogDensity;
    this.uniforms.uSkyColor.value.copy(skyColor);
  }
}
