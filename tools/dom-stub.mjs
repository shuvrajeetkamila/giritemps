// Minimal DOM stubs so the game logic can be exercised in Node without a
// browser or GPU.  Only what the sim + procedural texture generators touch.

class StubGradient {
  addColorStop() {}
}
class StubContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1;
    this.font = '10px sans-serif'; this.textAlign = 'left'; this.textBaseline = 'top';
    this.globalAlpha = 1; this.globalCompositeOperation = 'source-over';
    this.filter = 'none'; this.shadowBlur = 0; this.shadowColor = '#000';
    this.lineCap = 'butt'; this.lineJoin = 'miter'; this.miterLimit = 10;
    this.imageSmoothingEnabled = true;
    this._ops = 0;
  }
  save() {} restore() {} translate() {} rotate() {} scale() {} transform() {} setTransform() {} resetTransform() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {}
  arc() {} arcTo() {} ellipse() {} rect() {} roundRect() {} fill() {} stroke() {} clip() {}
  fillRect() {} strokeRect() {} clearRect() {}
  fillText() {} strokeText() {}
  measureText(t) { return { width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; }
  createLinearGradient() { return new StubGradient(); }
  createRadialGradient() { return new StubGradient(); }
  createConicGradient() { return new StubGradient(); }
  createPattern() { return {}; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) { return { width: Math.max(1, w | 0), height: Math.max(1, h | 0), data: new Uint8ClampedArray(Math.max(1, w | 0) * Math.max(1, h | 0) * 4) }; }
  putImageData() {}
  drawImage() {}
  setLineDash() {}
  getLineDash() { return []; }
  isPointInPath() { return false; }
  getContextAttributes() { return { alpha: true, antialias: true }; }
}

// ---------------------------------------------------------------------------
// A permissive fake WebGL2 context.  Every call succeeds and every value is a
// "universal proxy" that behaves as a truthy object, the number 1, or the
// string 'u'.  That is enough for three.js to initialise its WebGLRenderer and
// walk through the full render path, which lets the whole app boot in Node.
// ---------------------------------------------------------------------------
const ENUM_TAG = Symbol('glEnum');

const GL_PARAMS = {
  VERSION: 'WebGL 2.0 (Arena fake GL)',
  SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00 (Arena fake GL)',
  VENDOR: 'Arena', RENDERER: 'ArenaFakeGL',
  MAX_TEXTURE_SIZE: 4096, MAX_CUBE_MAP_TEXTURE_SIZE: 4096, MAX_3D_TEXTURE_SIZE: 1024,
  MAX_TEXTURE_IMAGE_UNITS: 16, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32, MAX_VERTEX_ATTRIBS: 16,
  MAX_VERTEX_UNIFORM_VECTORS: 1024, MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
  MAX_VARYING_VECTORS: 30, MAX_SAMPLES: 4, MAX_ARRAY_TEXTURE_LAYERS: 256,
  MAX_ELEMENTS_INDICES: 65536, MAX_ELEMENTS_VERTICES: 65536,
  MAX_RENDERBUFFER_SIZE: 4096, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 16,
  SAMPLES: 4, UNPACK_ALIGNMENT: 4, PACK_ALIGNMENT: 4
};

// GL enum constants must be *stable* objects: three.js compares a captured
// draw mode against gl.POINTS / gl.LINES / ... by identity, and handing out a
// fresh proxy on every property access makes every such check fail (which shows
// up as a "WebGLInfo: Unknown draw mode" console.error per draw call).
const enumCache = new Map();

function enumProxy(name) {
  const hit = enumCache.get(name);
  if (hit) return hit;
  const target = function () { };
  const t = new Proxy(target, {
    get(tt, k) {
      if (k === ENUM_TAG) return name;
      if (k === Symbol.toPrimitive) return () => 1;
      if (k === 'valueOf') return () => 1;
      if (k === 'toString') return () => name;
      return t;
    },
    apply() { return 1; },
    set() { return true; }
  });
  t[Symbol.toPrimitive] = () => 1;
  enumCache.set(name, t);
  return t;
}

function paramValue(e) {
  const name = e && e[ENUM_TAG];
  if (name === 'SCISSOR_BOX' || name === 'VIEWPORT') return new Int32Array([0, 0, 2048, 2048]);
  if (name === 'MAX_VIEWPORT_DIMS' || name === 'ALIASED_LINE_WIDTH_RANGE') return new Int32Array([4096, 4096]);
  if (name && name in GL_PARAMS) return GL_PARAMS[name];
  return 1;
}

export function makeUniversalProxy(proto) {
  const target = function () { };
  if (proto) Object.setPrototypeOf(target, proto);
  const p = new Proxy(target, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 1;
      if (k === 'valueOf') return () => 1;
      if (k === 'toString') return () => 'u';
      if (k === Symbol.iterator) return () => [][Symbol.iterator]();
      if (k === Symbol.toStringTag) return 'Universal';
      if (k === 'length') return 4;
      if (k === 'slice') return () => [0, 0, 1, 1];
      if (k === 'indexOf') return () => -1;
      if (k === 'includes' || k === 'has' || k === 'startsWith' || k === 'endsWith') return () => false;
      if (k === 'push' || k === 'pop' || k === 'shift') return () => undefined;
      if (k === 'size' || k === 'precision') return 1;
      if (k === 'name') return 'u';
      if (k === 'getParameter') return (e) => paramValue(e);
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return () => true;
      if (k === 'getShaderInfoLog' || k === 'getProgramInfoLog') return () => '';
      if (k === 'getError') return () => 0;
      if (k === 'getExtension') return () => null;
      if (k === 'getSupportedExtensions') return () => [];
      if (k === 'getContextAttributes') return () => ({ alpha: false, depth: true, stencil: false, antialias: false });
      if (k === 'getShaderPrecisionFormat') return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
      if (k === 'getUniformLocation') return () => p;
      if (k === 'getAttribLocation') return () => 0;
      if (k === 'then') return undefined;
      if (typeof k === 'string' && /^[A-Z][A-Z0-9_]*$/.test(k)) return enumProxy(k);
      return p;
    },
    apply() { return p; },
    set() { return true; },
    has() { return true; },
    getPrototypeOf() { return proto || Object.prototype; }
  });
  return p;
}

class StubCanvas {
  constructor(w = 300, h = 150) {
    this.width = w; this.height = h;
    this.style = { cssText: '', display: '' };
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    this._ctx = new StubContext2D(this);
    this.dataset = {};
  }
  getContext(kind) {
    if (kind && String(kind).startsWith('webgl')) {
      if (!this._gl) this._gl = makeUniversalProxy(globalThis.WebGL2RenderingContext && globalThis.WebGL2RenderingContext.prototype);
      return this._gl;
    }
    return this._ctx;
  }
  toDataURL() { return 'data:,'; }
  addEventListener() {} removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height }; }
  appendChild(c) { return c; }
  removeChild(c) { return c; }
  setAttribute() {} getAttribute() { return null; }
  requestPointerLock() {}
}

const _byId = new Map();

class StubElement extends StubCanvas {
  constructor(tag = 'div') {
    super(1, 1);
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.innerHTML = '';
    this.textContent = '';
    this.parentNode = null;
    this.disabled = false;
    this.value = '';
    this.checked = false;
    this.title = '';
    this.nodeType = 1;
  }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  append(c) { return this.appendChild(c); }
  prepend(c) { this.children.unshift(c); c.parentNode = this; return c; }
  removeAttribute() {} hasAttribute() { return false; }
  addEventListener() {} removeEventListener() {}
  insertBefore(c) { this.children.unshift(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  // A real node detaches itself on remove(); code that prunes a list while it
  // is still too long (UI.showToast does exactly that) would otherwise loop
  // forever against a stub whose children never shrink.
  remove() {
    const p = this.parentNode;
    if (p && p.children && p.children.includes(this)) {
      p.children.splice(p.children.indexOf(this), 1);
    }
    this.parentNode = null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {} blur() {} click() {}
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.length; }
}

export function installDomStubs() {
  const g = globalThis;
  if (g.document) return;
  const listeners = new Map();
  const doc = {
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === 'canvas') return new StubCanvas(300, 150);
      return new StubElement(t);
    },
    createElementNS(ns, tag) { return doc.createElement(tag); },
    getElementById(id) {
      if (!_byId.has(id)) {
        const el = new StubElement(id.includes('canvas') ? 'canvas' : 'div');
        el.id = id;
        _byId.set(id, el);
      }
      return _byId.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: new StubElement('body'),
    documentElement: new StubElement('html'),
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener() {},
    exitPointerLock() {},
    pointerLockElement: null,
    _listeners: listeners,
    fonts: { ready: Promise.resolve() }
  };
  g.document = doc;
  g.window = g.window || {};
  g.window.innerWidth = 1600;
  g.window.innerHeight = 900;
  g.window.devicePixelRatio = 1;
  g.window.addEventListener = doc.addEventListener;
  g.window.removeEventListener = () => {};
  g.window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
  g.window.cancelAnimationFrame = (id) => clearTimeout(id);
  g.window.location = { reload() {}, href: 'http://localhost/' };
  g.requestAnimationFrame = g.window.requestAnimationFrame;
  g.cancelAnimationFrame = g.window.cancelAnimationFrame;
  g.devicePixelRatio = 1;
  try {
    if (!g.navigator) g.navigator = {};
    if (!g.navigator.getGamepads) g.navigator.getGamepads = () => [];
  } catch (e) { /* node exposes a read-only navigator */ }
  const store = new Map();
  g.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  g.isSecureContext = true;
  // AudioContext stub: every node is a chainable no-op
  const node = () => {
    const n = {
      connect() { return n; }, disconnect() {}, start() {}, stop() {},
      gain: { value: 0, setValueAtTime() { return n.gain; }, linearRampToValueAtTime() { return n.gain; }, exponentialRampToValueAtTime() { return n.gain; }, setTargetAtTime() { return n.gain; }, cancelScheduledValues() { return n.gain; } },
      frequency: { value: 0, setValueAtTime() { return n.frequency; }, linearRampToValueAtTime() { return n.frequency; }, exponentialRampToValueAtTime() { return n.frequency; }, setTargetAtTime() { return n.frequency; } },
      Q: { value: 1 }, detune: { value: 0 }, pan: { value: 0 },
      type: 'sine', buffer: null, loop: false, playbackRate: { value: 1 },
      curve: null, oversample: 'none', threshold: { value: -24 }, knee: { value: 30 },
      ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 },
      delayTime: { value: 0 }, channelCount: 2, channelCountMode: 'max',
      createGain() { return node(); }, createOscillator() { return node(); },
      createBufferSource() { return node(); }, createBiquadFilter() { return node(); },
      createPanner() { return node(); }, createStereoPanner() { return node(); },
      createConvolver() { return node(); }, createDynamicsCompressor() { return node(); },
      createWaveShaper() { return node(); }, createDelay() { return node(); },
      createBuffer(ch, len, rate) { return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }; }
    };
    return n;
  };
  g.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = node(); }
    createGain() { return node(); } createOscillator() { return node(); }
    createBufferSource() { return node(); } createBiquadFilter() { return node(); }
    createPanner() { return node(); } createStereoPanner() { return node(); }
    createConvolver() { return node(); } createDynamicsCompressor() { return node(); }
    createWaveShaper() { return node(); } createDelay() { return node(); }
    createBuffer(ch, len, rate) { return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }; }
    resume() {} suspend() {} close() {}
  };
  g.window.AudioContext = g.AudioContext;
  g.speechSynthesis = { speak() {}, cancel() {}, getVoices: () => [], addEventListener() {} };
  g.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  g.performance = g.performance || { now: () => Date.now() };
  g.matchMedia = g.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  g.dispatchEvent = g.dispatchEvent || (() => true);
  g.CustomEvent = class CustomEvent { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  g.HTMLElement = StubElement;
  g.HTMLCanvasElement = StubCanvas;
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  return { document: doc, window: g.window };
}

/** A no-op object: any property access returns a callable no-op proxy. */
export function noopProxy(name = 'noop') {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'valueOf') return () => 0;
      return proxy;
    },
    apply() { return proxy; },
    set() { return true; }
  });
  return proxy;
}
