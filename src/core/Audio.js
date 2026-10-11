// ---------------------------------------------------------------------------
// AudioEngine — 100% procedural WebAudio synthesis.
// No audio files ship with the game: engines, weapons, explosions, radio,
// warnings and the adaptive orchestral score are all generated at runtime.
// ---------------------------------------------------------------------------
import { clamp, clamp01, lerp, RNG, TAU } from './Utils.js';

const NOTE = (semi) => 440 * Math.pow(2, semi / 12);

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ready = false;
    this.ctx = null;
    this.rng = new RNG(90210);
    this.listeners = [];
    this._queuedSpeech = [];
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // ---- master chain: bus -> compressor -> master -> out
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.get('masterVolume', 0.9);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 5;
    comp.attack.value = 0.006; comp.release.value = 0.28;
    this.limiter = comp;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.buses = {};
    for (const [name, vol] of [['music', this.settings.get('musicVolume', .55)],
    ['sfx', this.settings.get('sfxVolume', .9)],
    ['voice', this.settings.get('voiceVolume', .85)],
    ['cockpit', this.settings.get('cockpitVolume', .6)]]) {
      const g = ctx.createGain();
      g.gain.value = vol;
      g.connect(this.master);
      this.buses[name] = g;
    }

    // ---- shared noise buffer (2 s of pink-ish noise, looped everywhere)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.noiseBuffer = buf;

    // ---- convolver impulse for cockpit/radio space (procedural IR)
    this.irShort = this._makeIR(0.16, 2.2);
    this.irRadio = this._makeIR(0.34, 0.55);

    this.ready = true;
    this.music = new Music(this);
    this.engines = [];
    this._radioVoices = 0;
  }

  _makeIR(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  get time() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolume(bus, v) {
    if (!this.buses || !this.buses[bus]) return;
    this.buses[bus].gain.setTargetAtTime(v, this.time, 0.05);
  }
  setMaster(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.time, 0.05); }

  // -------------------------------------------------------------------------
  // Engine voice — layered, throttle driven.  Used for the player and for AI
  // aircraft (doppler + distance attenuation applied per-frame).
  // -------------------------------------------------------------------------
  createEngine(opts = {}) {
    if (!this.ready) return new SilentEngine();
    const e = new EngineVoice(this, opts);
    this.engines.push(e);
    return e;
  }

  // -------------------------------------------------------------------------
  // One-shot effects
  // -------------------------------------------------------------------------
  gunshot(vol = 0.5, big = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    src.playbackRate.value = big ? 0.7 : 1.3;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = big ? 420 : 1500; bp.Q.value = 1.1;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 240;
    const g = ctx.createGain();
    const dur = big ? 0.13 : 0.06;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.buses.sfx);
    src.start(t); src.stop(t + dur + 0.02);
    // Low thump body
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(big ? 130 : 220, t);
    osc.frequency.exponentialRampToValueAtTime(big ? 44 : 70, t + dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(og); og.connect(this.buses.sfx); osc.start(t); osc.stop(t + dur + 0.02);
  }

  explosion(size = 1, vol = 1, muffled = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const dur = clamp(0.55 + size * 0.9, 0.4, 3.4);
    // Sharp blast
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(muffled ? 900 : 5200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.95, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(lp); lp.connect(g); g.connect(this.buses.sfx);
    src.start(t); src.stop(t + dur + 0.05);
    // Sub rumble
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(90 + size * 20, t);
    sub.frequency.exponentialRampToValueAtTime(clamp(28 / size, 16, 40), t + dur * 0.7);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(vol * clamp(0.35 + size * 0.3, 0, 1.1), t + 0.03);
    sg.gain.exponentialRampToValueAtTime(0.0006, t + dur * 0.9);
    sub.connect(sg); sg.connect(this.buses.sfx);
    sub.start(t); sub.stop(t + dur);
    // Debris crackle tail
    if (size > 0.6) {
      for (let i = 0; i < 5 + size * 4; i++) {
        const dt2 = t + this.rng.float(0.12, dur * 0.8);
        const s2 = ctx.createBufferSource(); s2.buffer = this.noiseBuffer; s2.playbackRate.value = 2;
        const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = this.rng.float(700, 3200);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(vol * 0.12, dt2); g2.gain.exponentialRampToValueAtTime(0.0005, dt2 + 0.12);
        s2.connect(f2); f2.connect(g2); g2.connect(this.buses.sfx);
        s2.start(dt2); s2.stop(dt2 + 0.14);
      }
    }
  }

  missileLaunch(vol = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 0.8;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.7, t + 0.03);
    g.gain.setValueAtTime(vol * 0.7, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
    src.connect(bp); bp.connect(g); g.connect(this.buses.sfx);
    src.start(t); src.stop(t + 1.7);
  }

  rocketeer(vol = 0.6) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 1.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.45);
    src.connect(hp); hp.connect(g); g.connect(this.buses.sfx); src.start(t); src.stop(t + 0.5);
  }

  impact(vol = 0.5, metallic = true) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = metallic ? 2.4 : 0.9;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = metallic ? this.rng.float(1800, 4200) : 420; bp.Q.value = metallic ? 6 : 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0006, t + (metallic ? 0.16 : 0.3));
    src.connect(bp); bp.connect(g); g.connect(this.buses.sfx); src.start(t); src.stop(t + 0.35);
    if (!metallic) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
      const og = ctx.createGain(); og.gain.setValueAtTime(vol * 0.7, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(og); og.connect(this.buses.sfx); o.start(t); o.stop(t + 0.32);
    }
  }

  sonicBoom(vol = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(90, t + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.85, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 2.6);
    src.connect(lp); lp.connect(g); g.connect(this.buses.sfx); src.start(t); src.stop(t + 2.7);
  }

  thunder(distance = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time + clamp(distance, 0, 1) * 2.4;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(clamp(3000 / (0.4 + distance), 200, 4200), t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clamp(0.8 / (0.5 + distance), 0.06, 0.9), t + 0.05 + distance * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 3.2);
    src.connect(lp); lp.connect(g); g.connect(this.buses.sfx); src.start(t); src.stop(t + 3.3);
  }

  beep(freq = 880, dur = 0.09, vol = 0.3, type = 'square', bus = 'cockpit') {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(this.buses[bus] || this.buses.sfx); o.start(t); o.stop(t + dur + 0.02);
  }

  click(kind = 'switch') {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 3;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = kind === 'switch' ? 2600 : 1200; bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    src.connect(bp); bp.connect(g); g.connect(this.buses.cockpit); src.start(t); src.stop(t + 0.07);
  }

  hydraulics(dur = 1.2, up = true) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(up ? 420 : 640, t);
    bp.frequency.linearRampToValueAtTime(up ? 900 : 300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02, t); g.gain.linearRampToValueAtTime(0.25, t + 0.1);
    g.gain.setValueAtTime(0.25, t + dur - 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.buses.cockpit); src.start(t); src.stop(t + dur + 0.05);
  }

  chime(vol = 0.35) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.time;
    [0, 7, 12].forEach((semi, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = NOTE(semi + 12);
      const g = ctx.createGain();
      const st = t + i * 0.09;
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol * 0.5, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, st + 0.9);
      o.connect(g); g.connect(this.buses.voice); o.start(st); o.stop(st + 1.0);
    });
  }

  /** Radio callout: filtered speech synthesis, or beeps + subtitle fallback. */
  radio(text, opts = {}) {
    const subtitle = { text, kind: opts.kind || 'wing', time: performance.now() };
    if (this.onSubtitle) this.onSubtitle(subtitle);
    if (!this.ready || this.settings.get('voiceVolume', 1) <= 0.001) return;
    const vol = clamp(opts.volume !== undefined ? opts.volume : 0.9, 0, 1);
    // synthesised voice via SpeechSynthesis (browser native, zero bytes shipped)
    if (typeof speechSynthesis !== 'undefined' && opts.speak !== false) {
      try {
        if (this._radioVoices > 2) return;
        const u = new SpeechSynthesisUtterance(text);
        u.volume = clamp(vol * this.settings.get('voiceVolume', 0.85), 0, 1);
        u.rate = opts.rate || 1.06;
        u.pitch = opts.pitch !== undefined ? opts.pitch : (opts.kind === 'enemy' ? 0.6 : 0.95);
        if (typeof speechSynthesis.getVoices === 'function') {
          const vs = speechSynthesis.getVoices();
          if (vs && vs.length) {
            const want = opts.kind === 'enemy' ? /ru|de|fr|it|es/i : /en[-_]/i;
            const pick = vs.find((v) => want.test(v.lang)) || vs[0];
            u.voice = pick;
          }
        }
        this._radioVoices++;
        u.onend = () => { this._radioVoices = Math.max(0, this._radioVoices - 1); };
        u.onerror = () => { this._radioVoices = Math.max(0, this._radioVoices - 1); };
        speechSynthesis.speak(u);
        return;
      } catch (e) { /* fall through to beeps */ }
    }
    const n = Math.min(6, 1 + Math.floor(text.length / 14));
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.beep(420 + (i % 3) * 60, 0.06, 0.18, 'square', 'voice'), i * 95);
    }
  }

  dispose() {
    for (const e of this.engines || []) e.dispose();
    if (this.music) this.music.dispose();
    if (this.ctx) this.ctx.close();
    this.ready = false;
  }
}

class SilentEngine {
  update() { } setThrottle() { } setAfterburner() { } dispose() { } setDestroyed() { } setPosition() { }
}

// ---------------------------------------------------------------------------
// EngineVoice — layered turbine/piston engine
// ---------------------------------------------------------------------------
class EngineVoice {
  constructor(audio, opts) {
    this.a = audio;
    const ctx = audio.ctx;
    this.ctx = ctx;
    this.opts = opts;
    this.kind = opts.kind || 'jet';       // 'jet' | 'prop'
    this.throttle = 0;
    this.ab = 0;
    this.damaged = 0;
    this.destroyed = false;
    this.vol = opts.volume !== undefined ? opts.volume : 1;
    this.pos = opts.position || null;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // spatialisation
    if (opts.spatial) {
      this.panner = ctx.createPanner();
      this.panner.panningModel = 'HRTF';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 22;
      this.panner.maxDistance = 9000;
      this.panner.rolloffFactor = 1.05;
      this.out.connect(this.panner);
      if (this.pos) this.setPosition(this.pos);
      this.panner.connect(audio.buses.sfx);
    } else {
      this.out.connect(audio.buses.sfx);
    }

    const isProp = this.kind === 'prop';
    // --- layer 1: core turbine whine / piston thrum
    this.osc1 = ctx.createOscillator();
    this.osc1.type = isProp ? 'sawtooth' : 'sawtooth';
    this.osc1.frequency.value = isProp ? 42 : 58;
    this.g1 = ctx.createGain(); this.g1.gain.value = 0.5;
    const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 460; lp1.Q.value = 3;
    this.filter1 = lp1;
    this.osc1.connect(this.g1); this.g1.connect(lp1); lp1.connect(this.out);

    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.value = isProp ? 63 : 87;
    this.osc2.detune.value = 12;
    this.g2 = ctx.createGain(); this.g2.gain.value = 0.22;
    this.osc2.connect(this.g2); this.g2.connect(lp1);

    // --- layer 2: broadband roar
    this.noise = ctx.createBufferSource();
    this.noise.buffer = audio.noiseBuffer; this.noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 0.7;
    this.roarFilter = bp;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0.3;
    this.noise.connect(bp); bp.connect(this.roarGain); this.roarGain.connect(this.out);

    // --- layer 3: afterburner scream (jets) or prop blade tip (props)
    this.burnNoise = ctx.createBufferSource();
    this.burnNoise.buffer = audio.noiseBuffer; this.burnNoise.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100;
    const bpk = ctx.createBiquadFilter(); bpk.type = 'peaking'; bpk.frequency.value = 2400; bpk.gain.value = 8; bpk.Q.value = 0.9;
    this.burnFilter = hp;
    this.burnGain = ctx.createGain(); this.burnGain.gain.value = 0.0001;
    this.burnNoise.connect(hp); hp.connect(bpk); bpk.connect(this.burnGain); this.burnGain.connect(this.out);

    this.osc1.start(); this.osc2.start();
    this.noise.start(); this.burnNoise.start();
    this.crackleTimer = 0;
  }

  setPosition(p) {
    if (!this.panner) return;
    const now = this.a.time;
    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(p.x, now, 0.05);
      this.panner.positionY.setTargetAtTime(p.y, now, 0.05);
      this.panner.positionZ.setTargetAtTime(p.z, now, 0.05);
    } else if (this.panner.setPosition) this.panner.setPosition(p.x, p.y, p.z);
  }
  setListener(p, forward, up) {
    if (!this.a.ctx.listener || !this.a.ctx.listener.positionX) return;
    const l = this.a.ctx.listener, now = this.a.time;
    l.positionX.setTargetAtTime(p.x, now, 0.05); l.positionY.setTargetAtTime(p.y, now, 0.05); l.positionZ.setTargetAtTime(p.z, now, 0.05);
    l.forwardX.setTargetAtTime(forward.x, now, 0.05); l.forwardY.setTargetAtTime(forward.y, now, 0.05); l.forwardZ.setTargetAtTime(forward.z, now, 0.05);
    l.upX.setTargetAtTime(up.x, now, 0.05); l.upY.setTargetAtTime(up.y, now, 0.05); l.upZ.setTargetAtTime(up.z, now, 0.05);
  }

  setThrottle(t, ab = false, rpm = null) {
    const isProp = this.kind === 'prop';
    const th = clamp01(t);
    this.throttle = th;
    this.ab = ab ? 1 : 0;
    const now = this.a.time;
    const base = isProp ? 38 : 52;
    const f = base + th * (isProp ? 62 : 150) + (ab ? 22 : 0);
    this.osc1.frequency.setTargetAtTime(f, now, 0.12);
    this.osc2.frequency.setTargetAtTime(f * (isProp ? 1.5 : 1.5) + (ab ? 8 : 0), now, 0.12);
    this.filter1.frequency.setTargetAtTime(300 + th * (ab ? 1400 : 700), now, 0.15);
    this.roarFilter.frequency.setTargetAtTime(160 + th * 900 + (ab ? 800 : 0), now, 0.15);
    this.roarGain.gain.setTargetAtTime(0.12 + th * 0.38, now, 0.15);
    this.g1.gain.setTargetAtTime(0.25 + th * 0.4, now, 0.15);
    this.g2.gain.setTargetAtTime(0.08 + th * 0.3, now, 0.15);
    this.burnGain.gain.setTargetAtTime(ab ? 0.34 : (th > 0.92 ? 0.1 : 0.0001), now, 0.2);
    this.burnFilter.frequency.setTargetAtTime(ab ? 900 : 1800, now, 0.2);
    const targetVol = (isProp ? 0.32 : 0.4) * this.vol * (1 - this.destroyed * 1) * (0.45 + th * 0.55) * (1 + this.damaged * 0.2);
    this.out.gain.setTargetAtTime(this.destroyed ? 0.02 : targetVol, now, 0.2);
  }

  update(dt) {
    // afterburner crackle
    if (this.ab > 0.5 && this.a.rng.next() < dt * 14) {
      this.a.impact(0.05, true);
    }
    if (this.damaged > 0.35) {
      // rough-running sputter
      this.out.gain.setTargetAtTime(this.out.gain.value * (0.7 + Math.random() * 0.6), this.a.time, 0.02);
    }
  }

  setDamage(d) { this.damaged = clamp01(d); }
  setDestroyed(v) { this.destroyed = !!v; this.setThrottle(0, false); }
  dispose() {
    const now = this.a.time;
    try {
      this.out.gain.setTargetAtTime(0.0001, now, 0.1);
      setTimeout(() => { try { this.osc1.stop(); this.osc2.stop(); this.noise.stop(); this.burnNoise.stop(); } catch (e) { } }, 500);
    } catch (e) { }
    const i = this.a.engines.indexOf(this);
    if (i >= 0) this.a.engines.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Music — adaptive procedural orchestral score
//   intensity 0 = calm ambient flight, 1 = tension, 2 = combat, 3 = victory
// ---------------------------------------------------------------------------
const PROGRESSIONS = [
  // calm  : Am - F - C - G   (floating, hopeful)
  [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]],
  // tension: Dm - Bb - F - A
  [[2, 5, 9], [10, 14, 17], [5, 9, 12], [9, 13, 16]],
  // combat : Em - C - G - D
  [[4, 7, 11], [0, 4, 7], [7, 11, 14], [2, 6, 9]],
  // victory: F - G - C - C
  [[5, 9, 12], [7, 11, 14], [0, 4, 7], [0, 4, 7]]
];
const MENU_PROG = [[0, 4, 7, 12], [5, 9, 12, 16], [7, 11, 14, 17], [5, 9, 12, 16]];

export class Music {
  constructor(audio) {
    this.a = audio;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.playing = false;
    this.variant = 0;
    this.step = 0;
    this.nextTime = 0;
    this.tempo = 92;
    this.mode = 'menu';   // 'menu' | 'flight'
    this.timer = null;
    this.rng = new RNG(4242);
    this.stingers = [];
  }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    this.step = 0;
    this.variant = m === 'menu' ? 0 : this.variant;
  }

  start(kind = 'menu') {
    if (!this.a.ready || this.playing) { this.setMode(kind); return; }
    this.mode = kind;
    this.playing = true;
    this.nextTime = this.a.time + 0.15;
    const loop = () => {
      if (!this.playing) return;
      this._schedule();
      this.timer = setTimeout(loop, 60);
    };
    loop();
  }

  stop() { this.playing = false; if (this.timer) clearTimeout(this.timer); this.timer = null; }

  setIntensity(v) { this.targetIntensity = clamp01(v); }

  _schedule() {
    const a = this.a;
    if (!a.ready) return;
    const spb = 60 / this.tempo;
    while (this.nextTime < a.time + 0.35) {
      this.intensity = lerp(this.intensity, this.targetIntensity, 0.12);
      this._playStep(this.step, this.nextTime, spb);
      this.step++;
      this.nextTime += spb / 2;   // eighth notes
    }
  }

  _playStep(step, t, spb) {
    const isMenu = this.mode === 'menu';
    const prog = isMenu ? MENU_PROG : PROGRESSIONS[this.variant];
    const intensity = isMenu ? 0.75 : this.intensity;
    const bar = Math.floor(step / 8) % prog.length;
    const chord = prog[bar];
    const beat = step % 8;
    // ---- pad / strings (always)
    if (beat === 0) {
      const dur = spb * 4.1;
      const v = isMenu ? 0.16 : 0.07 + intensity * 0.07;
      for (const semi of chord) this._string(NOTE(semi + (isMenu ? 0 : -12)), t, dur, v, isMenu);
      // bass
      this._bass(NOTE(chord[0] - 24), t, dur * 0.95, isMenu ? 0.2 : 0.1 + intensity * 0.12);
    }
    // ---- tension: rising string swell
    if (!isMenu && intensity > 0.25 && intensity < 0.62 && beat % 4 === 2) {
      this._string(NOTE(chord[2] + 12), t, spb * 1.6, 0.05 * intensity, false, true);
    }
    // ---- combat: brass stabs + drums
    if (!isMenu && intensity > 0.55) {
      if (beat === 0 || beat === 3 || beat === 6) this._brass(NOTE(chord[0] - 12), t, spb * 0.5, 0.1 * intensity);
      if (beat === 4) this._brass(NOTE(chord[2] - 12), t, spb * 0.5, 0.1 * intensity);
      // drums
      if (beat === 0 || beat === 3 || beat === 6) this._kick(t, 0.5 * intensity);
      if (beat === 2 || beat === 6) this._snare(t, 0.24 * intensity);
      if (beat % 2 === 1) this._hat(t, 0.07 * intensity);
      if (beat === 7 && intensity > 0.8) { this._tomfill(t, spb, intensity); }
    }
    // ---- menu choir
    if (isMenu && beat === 0) this._choir(NOTE(chord[0]), t, spb * 4, 0.055);
  }

  _string(freq, t, dur, vol, wide = false, swell = false) {
    const a = this.a, ctx = a.ctx;
    const n = wide ? 3 : 2;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700 + vol * 4000; lp.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t);
    if (swell) {
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.7);
    } else {
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.5, dur * 0.25));
      g.gain.setValueAtTime(vol * 0.85, t + dur * 0.7);
    }
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    g.connect(lp); lp.connect(a.buses.music);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq * (1 + (i - (n - 1) / 2) * 0.004);
      const vib = ctx.createOscillator(); vib.frequency.value = 4.5 + i * 0.7;
      const vg = ctx.createGain(); vg.gain.value = freq * 0.004;
      vib.connect(vg); vg.connect(o.frequency);
      o.connect(g); o.start(t); vib.start(t);
      o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    }
  }
  _bass(freq, t, dur, vol) {
    const a = this.a, ctx = a.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(a.buses.music);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  _brass(freq, t, dur, vol) {
    const a = this.a, ctx = a.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 5;
    f.frequency.setValueAtTime(freq * 2.2, t);
    f.frequency.linearRampToValueAtTime(freq * 6, t + dur * 0.4);
    f.frequency.exponentialRampToValueAtTime(freq * 2.4, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(f); f.connect(g); g.connect(a.buses.music);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _choir(freq, t, dur, vol) {
    const a = this.a, ctx = a.ctx;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = freq * Math.pow(2, i / 12) * (i === 1 ? 1.5 : 1);
      const form = ctx.createBiquadFilter(); form.type = 'bandpass';
      form.frequency.value = [520, 1180, 2500][i]; form.Q.value = 2.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0003, t + dur);
      o.connect(form); form.connect(g); g.connect(a.buses.music);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
  _kick(t, vol) {
    const a = this.a, ctx = a.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(g); g.connect(a.buses.music); o.start(t); o.stop(t + 0.32);
  }
  _snare(t, vol) {
    const a = this.a, ctx = a.ctx;
    const s = ctx.createBufferSource(); s.buffer = a.noiseBuffer; s.playbackRate.value = 1.7;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.17);
    s.connect(f); f.connect(g); g.connect(a.buses.music); s.start(t); s.stop(t + 0.2);
  }
  _hat(t, vol) {
    const a = this.a, ctx = a.ctx;
    const s = ctx.createBufferSource(); s.buffer = a.noiseBuffer; s.playbackRate.value = 3;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.06);
    s.connect(f); f.connect(g); g.connect(a.buses.music); s.start(t); s.stop(t + 0.08);
  }
  _tomfill(t, spb, intensity) {
    for (let i = 0; i < 3; i++) {
      const a = this.a, ctx = a.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      const st = t + i * spb * 0.25;
      o.frequency.setValueAtTime(220 - i * 40, st); o.frequency.exponentialRampToValueAtTime(90 - i * 12, st + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35 * intensity, st); g.gain.exponentialRampToValueAtTime(0.0005, st + 0.22);
      o.connect(g); g.connect(a.buses.music); o.start(st); o.stop(st + 0.24);
    }
  }

  /** One-shot victory fanfare. */
  fanfare() {
    const a = this.a;
    if (!a.ready) return;
    const t = a.time + 0.05;
    const seq = [[0, 0], [4, 0.18], [7, 0.36], [12, 0.54], [12, 0.9], [16, 1.1], [19, 1.3]];
    seq.forEach(([semi, dt2], i) => {
      this._brass(NOTE(semi + 12), t + dt2, i === seq.length - 1 ? 1.6 : 0.42, 0.14);
      if (i % 2 === 0) this._kick(t + dt2, 0.4);
    });
    for (let i = 0; i < 6; i++) this._snare(t + 0.5 * i, 0.2);
    this._string(NOTE(24), t, 2.2, 0.12, true);
  }

  dispose() { this.stop(); }
}
