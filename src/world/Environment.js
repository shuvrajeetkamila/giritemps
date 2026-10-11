// ---------------------------------------------------------------------------
// Environment — day/night cycle, atmosphere palette, weather state machine.
// Drives every sky/fog/lighting uniform in the game.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { skyUniforms } from '../render/Shading.js';
import { clamp, clamp01, lerp, smoothstep, damp, TAU, RNG, airDensity as airDensityAt, speedOfSound } from '../core/Utils.js';

const WEATHER_TYPES = ['clear', 'hazy', 'partly', 'overcast', 'rain', 'storm', 'snow', 'fog'];

const PRESETS = {
  clear: { coverage: 0.18, storm: 0, precip: 0, fog: 4.2e-5, wind: 4, wave: 1.2, cbase: 1900, cthick: 900, label: 'CLEAR' },
  hazy: { coverage: 0.28, storm: 0, precip: 0, fog: 1.05e-4, wind: 5, wave: 1.4, cbase: 2000, cthick: 1000, label: 'HAZE' },
  partly: { coverage: 0.45, storm: 0, precip: 0, fog: 6.5e-5, wind: 8, wave: 1.8, cbase: 1500, cthick: 1200, label: 'PARTLY CLOUDY' },
  overcast: { coverage: 0.82, storm: 0.15, precip: 0, fog: 1.1e-4, wind: 12, wave: 2.2, cbase: 900, cthick: 1600, label: 'OVERCAST' },
  rain: { coverage: 0.9, storm: 0.4, precip: 0.55, fog: 1.5e-4, wind: 16, wave: 2.8, cbase: 700, cthick: 1800, label: 'RAIN' },
  storm: { coverage: 0.97, storm: 0.85, precip: 1.0, fog: 2.1e-4, wind: 26, wave: 4.0, cbase: 520, cthick: 2400, label: 'THUNDERSTORM' },
  snow: { coverage: 0.85, storm: 0.25, precip: 0.75, fog: 1.3e-4, wind: 10, wave: 1.6, cbase: 800, cthick: 1400, label: 'SNOW' },
  fog: { coverage: 0.7, storm: 0.05, precip: 0.1, fog: 4.2e-4, wind: 3, wave: 0.9, cbase: 1200, cthick: 700, label: 'FOG' }
};

export class Environment {
  constructor(settings) {
    this.settings = settings;
    this.timeOfDay = 9.5;          // hours
    this.dayLength = 1500;         // real seconds per full 24h cycle
    this.autoAdvance = true;
    this.timeScale = 1;
    this.weather = 'partly';
    this.weatherBlend = 0.35;
    this.target = { ...PRESETS.partly };
    this.current = { ...PRESETS.partly };
    this.windDir = new THREE.Vector2(0.82, 0.57).normalize();
    this.windSpeed = 8;
    this.cloudOffset = new THREE.Vector2();
    this.lightning = 0;
    this.lightningPos = new THREE.Vector3();
    this.lightningTimer = 2;
    this.flash = 0;
    this.rng = new RNG(88123);

    this.sunDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
    this.moonDir = new THREE.Vector3(-0.3, 0.6, -0.2).normalize();
    this.sunColor = new THREE.Color(1, 0.96, 0.9);
    this.sunElev = 0.7;
    this.nightFactor = 0;
    this.zenith = new THREE.Color(0.13, 0.32, 0.72);
    this.horizon = new THREE.Color(0.58, 0.7, 0.9);
    this.groundColor = new THREE.Color(0.32, 0.3, 0.27);
    this.ambientUp = new THREE.Color(0.3, 0.42, 0.65);
    this.ambientDown = new THREE.Color(0.16, 0.15, 0.13);
    this.fogColor = new THREE.Color(0.6, 0.7, 0.85);
    this.exposure = 1.0;
    this.grade = {
      lift: new THREE.Vector3(0, 0, 0),
      gain: new THREE.Vector3(1, 1, 1),
      sat: 1.05, contrast: 1.03
    };
    this.cloudBase = 1500;
    this.cloudThickness = 1200;
    this.cloudCoverage = 0.45;
    this.stormCover = 0;
    this.storm = 0;
    this.precip = 0;
    this.turbulence = 0;
    this.wetness = 0;
    this.snowLine = 1500;
    this._t = 0;
    this._lastGradeKey = '';
  }

  /** Mission / mode configuration. */
  configure(cfg = {}) {
    if (cfg.timeOfDay !== undefined) { this.timeOfDay = cfg.timeOfDay; this.autoAdvance = cfg.autoTime !== false; }
    if (cfg.weather) this.setWeather(cfg.weather, true);
    if (cfg.dayLength) this.dayLength = cfg.dayLength;
    if (cfg.autoTime !== undefined) this.autoAdvance = cfg.autoTime;
  }

  setWeather(name, instant = false) {
    if (!PRESETS[name]) return;
    this.weather = name;
    this.target = { ...PRESETS[name] };
    if (instant) {
      Object.assign(this.current, this.target);
      this.weatherBlend = 1;
    } else {
      this.weatherBlend = 0;
    }
  }

  /** Random weather appropriate for a time of day / season. */
  randomWeather(rng, opts = {}) {
    const t = this.timeOfDay;
    const pool = opts.pool ? opts.pool : ['clear', 'partly', 'partly', 'hazy', 'overcast', 'rain', 'storm', 'snow', 'fog'];
    return rng.pick(pool);
  }

  update(dt, cameraPos) {
    this._t += dt;
    if (this.autoAdvance) {
      this.timeOfDay = (this.timeOfDay + (dt / this.dayLength) * 24 * this.timeScale) % 24;
    }
    // ---- weather blend
    this.weatherBlend = clamp01(this.weatherBlend + dt * 0.06);
    const c = this.current, tg = this.target;
    const k = 1 - Math.exp(-dt * 0.25);
    c.coverage = lerp(c.coverage, tg.coverage, k);
    c.storm = lerp(c.storm, tg.storm, k);
    c.precip = lerp(c.precip, tg.precip, k);
    c.fog = lerp(c.fog, tg.fog, k);
    c.wind = lerp(c.wind, tg.wind, k);
    c.wave = lerp(c.wave, tg.wave, k);
    c.cbase = lerp(c.cbase, tg.cbase, k);
    c.cthick = lerp(c.cthick, tg.cthick, k);

    // ---- sun / moon
    const t = this.timeOfDay;
    const sunAz = (90 + ((t - 6) / 12) * 180) * Math.PI / 180;
    const maxElev = 1.30;
    const sunElev = Math.sin((Math.PI * (t - 6)) / 12) * maxElev;
    this.sunElev = sunElev;
    this.sunDir.set(Math.cos(sunElev) * Math.sin(sunAz), Math.sin(sunElev), -Math.cos(sunElev) * Math.cos(sunAz)).normalize();

    const tm = (t + 12) % 24;
    const moonAz = (90 + ((tm - 6) / 12) * 180) * Math.PI / 180;
    const moonElev = Math.sin((Math.PI * (tm - 6)) / 12) * 1.05;
    this.moonDir.set(Math.cos(moonElev) * Math.sin(moonAz), Math.sin(moonElev), -Math.cos(moonElev) * Math.cos(moonAz)).normalize();

    const day = clamp01(smoothstep(-0.09, 0.16, Math.sin(sunElev)));
    const night = 1 - day;
    this.nightFactor = night;
    const golden = Math.exp(-Math.pow((sunElev) * 5.2, 2)) * (1 - night * 0.6);

    // ---- colours
    const sunWarm = new THREE.Color(1.0, 0.42, 0.16);
    const sunDay = new THREE.Color(1.0, 0.965, 0.9);
    const sc = new THREE.Color().copy(sunDay).lerp(sunWarm, clamp01(1 - smoothstep(-0.02, 0.42, sunElev)));
    this.sunColor.copy(sc);
    const stormTint = 0.55;
    if (this.stormCover > 0.01) {
      this.sunColor.multiplyScalar(lerp(1, stormTint, this.stormCover));
    }

    const zDay = new THREE.Color(0.11, 0.30, 0.72);
    const hDay = new THREE.Color(0.58, 0.72, 0.92);
    const zNight = new THREE.Color(0.010, 0.016, 0.048);
    const hNight = new THREE.Color(0.035, 0.055, 0.115);
    const zGold = new THREE.Color(0.16, 0.19, 0.46);
    const hGold = new THREE.Color(0.98, 0.46, 0.20);
    const zenith = new THREE.Color().copy(zNight).lerp(zDay, day);
    const horizon = new THREE.Color().copy(hNight).lerp(hDay, day);
    zenith.lerp(zGold, golden * 0.85);
    horizon.lerp(hGold, golden);
    // storm desaturation/darkening
    const grey = lerp(0.44, 0.1, night);
    zenith.lerp(new THREE.Color(grey * 0.55, grey * 0.57, grey * 0.62), this.stormCover * 0.8);
    horizon.lerp(new THREE.Color(grey, grey * 1.02, grey * 1.06), this.stormCover * 0.85);
    this.zenith.copy(zenith);
    this.horizon.copy(horizon);
    this.groundColor.setRGB(0.32 * day + 0.02, 0.30 * day + 0.02, 0.27 * day + 0.03);

    // ---- lighting intensities
    const sunI = lerp(0.22, 3.4, day) * lerp(1, 0.25, this.stormCover) * lerp(1, 0.5, this.current.coverage * 0.5);
    const moonI = night * 0.34 * lerp(1, 0.3, this.stormCover) * clamp01(this.moonDir.y * 3 + 0.35);
    this.sunIntensity = Math.max(sunI, moonI);
    const ambientI = lerp(0.16, 0.62, day) * lerp(1, 0.7, this.stormCover);

    // sun/moon swap: at night the "sun" light is the moon
    const useMoon = night > 0.5 && this.moonDir.y > 0.02;
    this.lightDir = (this.lightDir || new THREE.Vector3());
    if (useMoon) {
      this.lightDir.copy(this.moonDir);
      this.sunColor.setRGB(0.62, 0.72, 1.0).multiplyScalar(lerp(1, 0.4, this.stormCover));
    } else {
      this.lightDir.copy(this.sunDir);
    }

    this.ambientUp.copy(horizon).multiplyScalar(0.85).add(new THREE.Color(0.06, 0.07, 0.09));
    this.ambientDown.setRGB(0.15 * day + 0.015, 0.14 * day + 0.015, 0.12 * day + 0.02);

    // ---- weather derived
    this.cloudCoverage = c.coverage;
    this.stormCover = clamp01(c.storm);
    this.storm = clamp01(c.storm * 1.1);
    this.precip = c.precip;
    this.cloudBase = c.cbase;
    this.cloudThickness = c.cthick;
    this.windSpeed = c.wind;
    this.precipType = this.tempAt(0) < 1.5 ? 'snow' : 'rain';
    this.wetness = lerp(this.wetness, clamp01(c.precip * (this.precipType === 'snow' ? 0.25 : 1)), dt * 0.15);
    this.turbulence = this.stormCover * 0.8 + clamp01(c.wind / 30) * 0.3 + (this.inCloud || 0) * 0.4;

    // snow line drops with weather/season
    this.snowLine = lerp(2400, 900, this.stormCover * 0.5 + clamp01(this.precip) * 0.3 + night * 0.2);

    // cloud drift
    this.cloudOffset.x += this.windDir.x * this.windSpeed * dt * 0.35;
    this.cloudOffset.y += this.windDir.y * this.windSpeed * dt * 0.35;

    // ---- exposure + grading per time of day
    this.exposure = lerp(1.35, 1.0, day) * lerp(1.0, 0.88, this.stormCover);
    const sunny = 1 - this.stormCover;
    this.grade.sat = lerp(1.16, 0.92, this.stormCover) * lerp(1.0, 0.88, night);
    this.grade.contrast = lerp(1.02, 1.12, this.stormCover);
    const warm = golden * sunny;
    const cool = night;
    this.grade.gain.set(
      lerp(1, 1.06, warm) * lerp(1, 0.92, cool),
      lerp(1, 1.0, warm) * lerp(1, 0.96, cool),
      lerp(1, 0.9, warm) * lerp(1, 1.12, cool)
    );
    this.grade.lift.set(
      lerp(0.0, 0.03, warm) + cool * 0.005,
      lerp(0.0, 0.012, warm) + cool * 0.008,
      lerp(0.0, -0.005, warm) + cool * 0.03
    );

    // ---- sync shared uniforms
    skyUniforms.sunDirection.value.copy(this.lightDir);
    skyUniforms.sunColor.value.copy(this.sunColor).multiplyScalar(this.sunIntensity);
    skyUniforms.sunIntensity.value = this.sunIntensity;
    skyUniforms.moonDirection.value.copy(this.moonDir);
    skyUniforms.skyZenith.value.copy(this.zenith);
    skyUniforms.skyHorizon.value.copy(this.horizon);
    skyUniforms.skyGround.value.copy(this.groundColor);
    skyUniforms.ambientUp.value.copy(this.ambientUp);
    skyUniforms.ambientDown.value.copy(this.ambientDown);
    skyUniforms.ambientIntensity.value = ambientI;
    skyUniforms.fogColor.value.copy(this.horizon);
    skyUniforms.fogDensity.value = this.fogDensity = c.fog;
    skyUniforms.fogAerial.value.set(c.fog, 0.00042, this.stormCover, 0);
    skyUniforms.timeOfDay.value = this.timeOfDay;
    skyUniforms.exposure.value = this.exposure;
    skyUniforms.nightFactor.value = night;
    skyUniforms.stormFactor.value = this.stormCover;
    skyUniforms.wetness.value = this.wetness;
    skyUniforms.cloudCoverage.value = this.cloudCoverage;
    skyUniforms.cloudShadowStrength.value = clamp01(this.cloudCoverage * 0.8 * (1 - this.stormCover * 0.4));
    skyUniforms.cameraPos.value.copy(cameraPos);
    skyUniforms.windDir.value.copy(this.windDir);
    skyUniforms.windSpeed.value = this.windSpeed;
    skyUniforms.sunElev.value = sunElev;
    if (this.fogColor) this.fogColor.copy(this.horizon).lerp(this.zenith, 0.25);
    return this;
  }

  /** Standard-atmosphere density (kg/m^3) — used by the flight model and FX. */
  airDensity(altitude) { return airDensityAt(Math.max(0, altitude)); }
  soundSpeed(altitude) { return speedOfSound(Math.max(0, altitude)); }

  /** Ambient temperature (for rain/snow selection) — simple model. */
  tempAt(altitude) {
    const day = clamp01(smoothstep(-0.09, 0.16, Math.sin(this.sunElev)));
    return lerp(-18, 24, day) * lerp(1, 0.75, clamp01(this.stormCover)) - Math.max(0, altitude) * 0.0065;
  }

  /** Snapshot used by the sky + cloud renderers. */
  snapshot() {
    return {
      sunDir: this.lightDir,
      moonDir: this.moonDir,
      sunColor: this.sunColor,
      sunElev: this.sunElev,
      nightFactor: this.nightFactor,
      zenith: this.zenith,
      horizon: this.horizon,
      groundColor: this.groundColor,
      cloudCoverage: this.cloudCoverage,
      storm: this.storm,
      stormCover: this.stormCover,
      cloudBase: this.cloudBase,
      cloudThickness: this.cloudThickness,
      cirrusAlt: 9000,
      time: this._t,
      cloudOffset: this.cloudOffset,
      lightning: this.flash,
      lightningPos: this.lightningPos,
      windDir: this.windDir,
      windSpeed: this.windSpeed
    };
  }

  updateLightning(dt, cloudField, cameraPos) {
    this.flash = Math.max(0, this.flash - dt * 6.5);
    this.lightning = Math.max(0, this.lightning - dt * 4);
    if (this.stormCover < 0.25) return 0;
    this.lightningTimer -= dt * (0.4 + this.stormCover);
    if (this.lightningTimer > 0) return 0;
    const storm = cloudField ? cloudField.nearestStorm(cameraPos, 16000) : null;
    this.lightningTimer = this.rng.float(1.2, 6.0) / (0.4 + this.stormCover);
    this.flash = 1.0;
    if (storm) {
      this.lightningPos.set(storm.x, storm.y, storm.z);
      const dist = Math.hypot(storm.x - cameraPos.x, storm.z - cameraPos.z);
      return { distance: clamp01(dist / 12000), pos: this.lightningPos };
    }
    return { distance: 0.6, pos: null };
  }
}

export { WEATHER_TYPES, PRESETS };
