// All audio is synthesized at runtime with the Web Audio API (no sample files).
// Engine layers blend with throttle, Doppler is applied to other aircraft, weapons and explosions
// are noise/oscillator designs, cockpit alarms are tone sequences, radio uses speech synthesis,
// and music is a small generative sequencer that changes with gameplay state.

const C_SOUND = 340;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.listener = { pos: null, vel: null };
    this.engines = new Map();
    this.lockT = 0;
    this.lockState = 0;
    this.warnT = 0;
    this.warnOn = false;
    this.music = null;
    this.cannonLimiter = 0;
    this.lastSpeech = 0;
    this.gunLoop = null;
    this.stallT = 0;
    this.pullT = 0;
  }

  // Must be called from a user gesture.
  init(settings) {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.buses = {};
    for (const k of ['music', 'sfx', 'voice', 'ambient']) {
      const g = c.createGain();
      g.connect(this.master);
      this.buses[k] = g;
    }
    this.noise = this.makeNoise(2);
    this.setVolumes(settings);
    this.ready = true;
    this.startWind();
    this.music = new Music(this);
  }

  makeNoise(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.12;
      d[i] = (b0 + b1 + b2 + w * 0.18) * 0.45;   // pinkish noise
    }
    return buf;
  }

  setVolumes(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.masterVol, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.musicVol, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfxVol, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(s.voiceVol, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(s.ambientVol, t, 0.05);
  }

  setListener(pos, vel) { this.listener.pos = pos; this.listener.vel = vel; }

  // Distance attenuation with a soft floor.
  atten(pos, max = 9000) {
    if (!this.listener.pos || !pos) return 1;
    const d = pos.distanceTo(this.listener.pos);
    return Math.max(0, 1 - d / max) ** 1.6;
  }

  // Doppler factor for a moving source relative to listener.
  doppler(pos, vel) {
    if (!this.listener.pos || !pos || !vel) return 1;
    const r = this.listener.pos.clone().sub(pos);
    const d = r.length() || 1;
    r.multiplyScalar(1 / d);
    const vsr = vel.dot(r);                 // + approaching
    const vlr = this.listener.vel ? this.listener.vel.dot(r) : 0;
    const f = (C_SOUND + vlr) / Math.max(C_SOUND - vsr, 30);
    return THREE_clamp(f, 0.6, 1.8);
  }

  // Noise source helper with a filter and a gain node; returns {src, filt, gain}.
  noiseLayer(bus, type, freq, q = 1, gainVal = 0) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const gain = c.createGain(); gain.gain.value = gainVal;
    src.connect(filt).connect(gain).connect(bus);
    src.start(c.currentTime + Math.random() * 0.5);
    return { src, filt, gain };
  }

  // ---- Engines and environment -------------------------------------------
  createEngine(id, isPlayer) {
    if (!this.ready) return;
    const c = this.ctx;
    const bus = this.buses.sfx;
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 45;
    const osc2 = c.createOscillator(); osc2.type = 'triangle'; osc2.frequency.value = 90;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const og = c.createGain(); og.gain.value = 0;
    osc.connect(lp); osc2.connect(lp); lp.connect(og);
    const panner = c.createPanner(); panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse';
    panner.refDistance = 120; panner.maxDistance = 9000; panner.rolloffFactor = 1.2;
    og.connect(panner).connect(bus);
    osc.start(); osc2.start();
    const roar = this.noiseLayer(bus, 'bandpass', 800, 0.7, 0);
    roar.gain.disconnect();
    roar.gain.connect(panner);
    const crackle = this.noiseLayer(bus, 'highpass', 2500, 0.9, 0);
    crackle.gain.disconnect(); crackle.gain.connect(panner);
    const e = { osc, osc2, lp, og, roar, crackle, panner, isPlayer, lastCrackle: 0, id };
    this.engines.set(id, e);
    return e;
  }

  removeEngine(id) {
    const e = this.engines.get(id);
    if (!e) return;
    try { e.osc.stop(); e.osc2.stop(); e.roar.src.stop(); e.crackle.src.stop(); } catch (err) { /* already stopped */ }
    this.engines.delete(id);
  }

  // Update an engine's pitch/volume from throttle and position (call per frame per aircraft).
  updateEngine(id, { pos, vel, throttle, afterburner, abAmount, isPlayer, alive }) {
    if (!this.ready) return;
    let e = this.engines.get(id);
    if (!e) e = this.createEngine(id, isPlayer);
    if (!e) return;
    const c = this.ctx, t = c.currentTime;
    const th = Math.max(0, Math.min(1, throttle));
    const dop = isPlayer ? 1 : this.doppler(pos, vel);
    const base = (38 + th * 60 + abAmount * 25) * dop;
    e.osc.frequency.setTargetAtTime(base, t, 0.08);
    e.osc2.frequency.setTargetAtTime(base * 2.02, t, 0.08);
    e.lp.frequency.setTargetAtTime(350 + th * 1000 + abAmount * 2000, t, 0.1);
    const idleLevel = 0.12 + th * 0.2;
    const att = isPlayer ? 1 : this.atten(pos);
    e.og.gain.setTargetAtTime(alive ? (idleLevel + abAmount * 0.1) * att * 0.8 : 0, t, 0.1);
    e.roar.filt.frequency.setTargetAtTime((500 + th * 700 + abAmount * 1500) * dop, t, 0.1);
    e.roar.gain.gain.setTargetAtTime(alive ? (0.02 + th * 0.12 + abAmount * 0.4) * att : 0, t, 0.1);
    e.crackle.gain.gain.setTargetAtTime(alive ? abAmount * 0.07 * att : 0, t, 0.1);
    if (abAmount > 0.6 && Math.random() < 0.05 && t - e.lastCrackle > 0.1) {
      e.lastCrackle = t;
      this.blip(e.panner, 3000 + Math.random() * 3000, 0.02, 0.03);
    }
    if (pos && e.panner.positionX) {
      e.panner.positionX.setValueAtTime(pos.x, t);
      e.panner.positionY.setValueAtTime(pos.y, t);
      e.panner.positionZ.setValueAtTime(pos.z, t);
    }
    if (!isPlayer && pos) void 0;
  }

  startWind() {
    const c = this.ctx;
    this.wind = this.noiseLayer(this.buses.ambient, 'bandpass', 500, 0.5, 0);
  }

  // Wind rises with airspeed; it howls at maximum velocity.
  setWind(speed) {
    if (!this.ready || !this.wind) return;
    const t = this.ctx.currentTime;
    const k = Math.max(0, Math.min(1, (speed - 40) / 420));
    this.wind.gain.gain.setTargetAtTime(0.02 + k * 0.42, t, 0.3);
    this.wind.filt.frequency.setTargetAtTime(350 + k * 1600, t, 0.3);
    this.wind.filt.Q.setTargetAtTime(0.6 + k * 4, t, 0.3);
  }

  setRain(amount) {
    if (!this.ready) return;
    if (!this.rain) this.rain = this.noiseLayer(this.buses.ambient, 'highpass', 3000, 0.5, 0);
    this.rain.gain.gain.setTargetAtTime(amount * 0.10, this.ctx.currentTime, 0.5);
  }

  // ---- Weapons -----------------------------------------------------------
  cannonShot(isPlayer, pos, vol = 1) {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.cannonLimiter < 12) return;   // limit overlapping shots
    this.cannonLimiter = now;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain();
    const amp = (isPlayer ? 0.22 : 0.10) * vol * (isPlayer ? 1 : this.atten(pos, 4000));
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 0.8;
    src.connect(f).connect(g).connect(this.buses.sfx);
    src.start(t, Math.random() * 1.5, 0.06);
  }

  gunBuzz(on) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    if (on && !this.gunLoop) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 74;
      const g = c.createGain(); g.gain.value = 0;
      const lfo = c.createOscillator(); lfo.frequency.value = 74; const lg = c.createGain(); lg.gain.value = 0.05;
      lfo.connect(lg).connect(g.gain);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      o.connect(lp).connect(g).connect(this.buses.sfx);
      o.start(); lfo.start();
      g.gain.setTargetAtTime(0.08, t, 0.05);
      this.gunLoop = { o, g, lfo };
    } else if (!on && this.gunLoop) {
      this.gunLoop.g.gain.setTargetAtTime(0, t, 0.05);
      const gl = this.gunLoop; this.gunLoop = null;
      setTimeout(() => { try { gl.o.stop(); gl.lfo.stop(); } catch (e) { /* stopped */ } }, 400);
    }
  }

  missileLaunch(isPlayer, pos, vol = 1) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const amp = (isPlayer ? 0.7 : 0.35) * vol * (isPlayer ? 1 : this.atten(pos));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.3);
    g.gain.exponentialRampToValueAtTime(amp * 0.5, t + 2.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 4);
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2600, t + 1.2); f.Q.value = 1.2;
    src.connect(f).connect(g).connect(this.buses.sfx);
    src.start(t, Math.random(), 4);
  }

  explosion(pos, scale = 1) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const att = Math.max(0.05, this.atten(pos, 7000));
    const amp = Math.min(1, 0.6 * scale) * att;
    // Sharp blast.
    const g1 = c.createGain(); g1.gain.setValueAtTime(amp, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    const s1 = c.createBufferSource(); s1.buffer = this.noise; const f1 = c.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 1200;
    s1.connect(f1).connect(g1).connect(this.buses.sfx); s1.start(t, Math.random(), 0.8);
    // Rolling boom: sine sweep (felt as bass rumble).
    const o = c.createOscillator(); o.frequency.setValueAtTime(90, t + 0.05); o.frequency.exponentialRampToValueAtTime(28, t + 1.6);
    const g2 = c.createGain(); g2.gain.setValueAtTime(amp * 1.2, t + 0.05); g2.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
    o.connect(g2).connect(this.buses.sfx); o.start(t + 0.05); o.stop(t + 2.1);
    // Crumbling debris, delayed.
    const g3 = c.createGain(); g3.gain.setValueAtTime(0.0001, t + 0.4); g3.gain.exponentialRampToValueAtTime(amp * 0.5, t + 0.6); g3.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    const s3 = c.createBufferSource(); s3.buffer = this.noise; const f3 = c.createBiquadFilter(); f3.type = 'bandpass'; f3.frequency.value = 700; f3.Q.value = 0.6;
    s3.connect(f3).connect(g3).connect(this.buses.sfx); s3.start(t + 0.4, Math.random(), 2.2);
  }

  // Impact ping on the player's airframe.
  hitPing(strength = 1) {
    if (!this.ready) return;
    this.blip(this.buses.sfx, 2600 + Math.random() * 900, 0.14, 0.12 * strength);
    this.blip(this.buses.sfx, 120, 0.25, 0.25 * strength, 'sine');
  }

  blip(dest, freq, dur, amp, type = 'sine') {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  flareDrop() { if (this.ready) this.blip(this.buses.sfx, 1400, 0.25, 0.08, 'square'); }
  sam(pos) { if (this.ready) this.missileLaunch(false, pos, 0.8); }

  // ---- Cockpit ------------------------------------------------------------
  click(strength = 1) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const g = c.createGain(); g.gain.setValueAtTime(0.25 * strength, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    src.connect(f).connect(g).connect(this.buses.sfx); src.start(t, Math.random(), 0.03);
  }

  throttleSlide() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f).connect(g).connect(this.buses.ambient); src.start(t, Math.random(), 0.6);
  }

  gearWhine(down) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(down ? 180 : 540, t); o.frequency.linearRampToValueAtTime(down ? 540 : 180, t + 2.4);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.2); g.gain.linearRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g).connect(this.buses.ambient); o.start(t); o.stop(t + 2.7);
  }

  canopyHiss() {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f).connect(g).connect(this.buses.ambient); src.start(t, Math.random(), 1.2);
  }

  chime(kind = 'kill') {
    if (!this.ready) return;
    const seq = kind === 'kill' ? [659, 784, 988, 1319] : [523, 659, 784, 1047];
    seq.forEach((f, i) => setTimeout(() => this.blip(this.buses.sfx, f, 0.5, 0.18, 'sine'), i * 90));
  }

  // Lock tone: beeps accelerate as lock builds, then a solid tone.
  setLock(progress, active) {
    this.lockProgress = active ? progress : -1;
  }

  // Missile warning and alarms. Called from game loop.
  update(dt, flags = {}) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    // Lock tone.
    if (this.lockProgress !== undefined && this.lockProgress >= 0) {
      if (this.lockProgress >= 1) {
        if (!this.lockSolid) { this.lockSolid = true; this.blip(this.buses.sfx, 1100, 1.2, 0.12, 'square'); }
      } else {
        this.lockT -= dt;
        if (this.lockT <= 0) {
          this.lockT = 0.5 - this.lockProgress * 0.42;
          this.blip(this.buses.sfx, 1000 + this.lockProgress * 400, 0.06, 0.1, 'square');
        }
      }
    } else { this.lockSolid = false; }
    // Missile warning: shrill alternating tone.
    if (flags.missile) {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        this.warnT = 0.22;
        this.blip(this.buses.sfx, this.warnFlip ? 1400 : 950, 0.18, 0.14, 'square');
        this.warnFlip = !this.warnFlip;
      }
    }
    if (flags.stall) {
      this.stallT -= dt;
      if (this.stallT <= 0) { this.stallT = 0.8; this.blip(this.buses.sfx, 340, 0.6, 0.12, 'triangle'); }
    }
    if (flags.pullUp) {
      this.pullT -= dt;
      if (this.pullT <= 0) { this.pullT = 0.35; this.blip(this.buses.sfx, 1200, 0.12, 0.2, 'square'); }
    }
    if (this.music) this.music.update(dt, now);
  }

  // Speech synthesis for radio chatter and voice alerts (browser TTS, no files).
  speak(text, { pitch = 1, rate = 1.05, interrupt = true, priority = false } = {}) {
    if (!('speechSynthesis' in window)) return;
    const now = performance.now();
    if (!priority && now - this.lastSpeech < 1800) return;
    this.lastSpeech = now;
    if (interrupt) window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const en = voices.find((v) => /en[-_]/i.test(v.lang) && /male|david|mark|alex|daniel|guy/i.test(v.name)) || voices.find((v) => /^en/i.test(v.lang));
    if (en) u.voice = en;
    u.pitch = pitch; u.rate = rate; u.volume = 1;
    window.speechSynthesis.speak(u);
  }

  radio(text, opts) { this.speak(text, { pitch: 0.9, rate: 1.1, ...opts }); }
  intercept(text) { this.speak(text, { pitch: 0.6, rate: 0.85, priority: true }); }
  missileWarning() { this.speak('Missile! Missile!', { pitch: 1.2, rate: 1.3, priority: true }); }

  setMusicState(state) { if (this.music) this.music.setState(state); }

  stopAll() {
    for (const id of [...this.engines.keys()]) this.removeEngine(id);
    this.gunBuzz(false);
    if (this.music) this.music.setState('off');
  }
}

function THREE_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Adaptive music: small generative sequencer with layers that fade by game state.
const CHORDS = {
  menu:    [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],   // Am F C G (voiced)
  calm:    [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  tension: [[57, 60, 64], [50, 53, 57], [48, 52, 55], [52, 55, 59]],
  action:  [[57, 60, 64], [50, 53, 57], [53, 57, 60], [55, 59, 62]],
  victory: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]],
};
const TEMPO = { menu: 72, calm: 76, tension: 98, action: 124, victory: 110, off: 60 };

class Music {
  constructor(audio) {
    this.a = audio;
    this.state = 'off';
    this.nextBeat = 0;
    this.beat = 0;
    this.bar = 0;
    this.layers = {};
    const c = audio.ctx;
    this.bus = c.createGain(); this.bus.gain.value = 0.9; this.bus.connect(audio.buses.music);
    // Pad: three detuned saws through a slow filter.
    this.padGain = c.createGain(); this.padGain.gain.value = 0; this.padGain.connect(this.bus);
    this.padFilt = c.createBiquadFilter(); this.padFilt.type = 'lowpass'; this.padFilt.frequency.value = 900; this.padFilt.connect(this.padGain);
    this.padOsc = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = (i - 1) * 7;
      const g = c.createGain(); g.gain.value = 0.05;
      o.connect(g).connect(this.padFilt); o.start();
      this.padOsc.push(o);
    }
    // Choir-like formant pad for the menu theme (sine stacks with vibrato).
    this.choirGain = c.createGain(); this.choirGain.gain.value = 0; this.choirGain.connect(this.bus);
    this.choir = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator(); o.type = 'sine';
      const g = c.createGain(); g.gain.value = 0.06;
      const lfo = c.createOscillator(); lfo.frequency.value = 5 + i * 0.3; const lg = c.createGain(); lg.gain.value = 3;
      lfo.connect(lg).connect(o.detune); lfo.start();
      o.connect(g).connect(this.choirGain); o.start();
      this.choir.push(o);
    }
    this.chordIndex = 0;
    this.chordT = 0;
    this.lastNoteT = 0;
  }

  setState(s) {
    this.state = s;
    if (s === 'victory') this.victoryT = 0;
  }

  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  update(dt, now) {
    const c = this.a.ctx;
    const st = this.state;
    const wantPad = st !== 'off';
    const padLevel = st === 'off' ? 0 : st === 'menu' ? 0 : st === 'calm' ? 0.4 : st === 'tension' ? 0.55 : st === 'action' ? 0.5 : 0.6;
    this.padGain.gain.setTargetAtTime(padLevel * 0.9, now, 1.2);
    this.choirGain.gain.setTargetAtTime(st === 'menu' ? 0.9 : 0, now, 1.5);
    this.padFilt.frequency.setTargetAtTime(st === 'action' ? 1600 : st === 'tension' ? 1100 : 700, now, 1.0);
    void wantPad;
    const chords = CHORDS[st] || CHORDS.calm;
    // Chord changes once per bar.
    const bpm = TEMPO[st] || 70;
    const beatLen = 60 / bpm;
    if (st === 'off') return;
    this.chordT += dt;
    if (this.chordT > beatLen * 4) {
      this.chordT = 0;
      this.chordIndex = (this.chordIndex + 1) % chords.length;
      const ch = chords[this.chordIndex];
      this.padOsc.forEach((o, i) => { o.frequency.setTargetAtTime(this.mtof(ch[i % ch.length] - 12), now, 0.2); });
      this.choir.forEach((o, i) => { o.frequency.setTargetAtTime(this.mtof(ch[i % ch.length] + 12), now, 0.4); });
    }
    if (this.nextBeat === 0) this.nextBeat = now + 0.1;
    // Schedule percussive/arp notes ahead by up to 0.2s.
    while (this.nextBeat < now + 0.2) {
      const t = this.nextBeat;
      const step = this.beat % 4;
      const ch = chords[this.chordIndex];
      if (st === 'calm' || st === 'tension' || st === 'action' || st === 'menu') {
        if (st !== 'menu') this.arp(t, ch, beatLen * 0.5, st === 'action' ? 0.04 : 0.025);
      }
      if (st === 'action' || st === 'tension') {
        if (step === 0 || step === 2) this.kick(t, st === 'action' ? 0.45 : 0.25);
        if (step === 1 || step === 3) this.hat(t, 0.06);
        if (st === 'action' && step === 0 && this.beat % 16 === 0) this.brassStab(t, ch);
      }
      if (st === 'victory' && step === 0) this.brassStab(t, ch);
      this.beat++;
      this.nextBeat += beatLen;
      if (this.beat > 2000000) this.beat = 0;
    }
    void c;
  }

  arp(t, ch, dur, amp) {
    const c = this.a.ctx;
    const note = ch[(this.beat * 2) % ch.length] + 12 * (this.beat % 3 === 2 ? 1 : 0);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = this.mtof(note);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
  }

  kick(t, amp) {
    const c = this.a.ctx;
    const o = c.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = c.createGain(); g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.35);
  }

  hat(t, amp) {
    const c = this.a.ctx;
    const s = c.createBufferSource(); s.buffer = this.a.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f).connect(g).connect(this.bus); s.start(t, Math.random(), 0.1);
  }

  brassStab(t, ch) {
    const c = this.a.ctx;
    for (const n of ch) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(n + 12);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(2200, t + 0.15); f.frequency.exponentialRampToValueAtTime(400, t + 0.7);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(f).connect(g).connect(this.bus); o.start(t); o.stop(t + 0.85);
    }
  }
}
