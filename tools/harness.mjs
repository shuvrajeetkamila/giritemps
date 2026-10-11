// Shared plumbing for the headless integration tests: boot the whole app
// against a fake WebGL2 context and drive real frames by hand.
import { installDomStubs } from './dom-stub.mjs';

export async function bootApp(opts = {}) {
  // src/main.js is an ES module, so it is evaluated once per process no matter
  // how many times it is imported: a second bootApp() would silently hand back
  // the *first* app (with its old mission and UI state).  Fail loudly instead,
  // and put scenarios that need a fresh app in their own process.
  if (globalThis.__AERIAL_BOOTED__) {
    throw new Error('bootApp() already ran in this process - ESM caching means a second call returns the same app. Run the scenario in a separate node process (or restart the state through the app API).');
  }
  globalThis.__AERIAL_BOOTED__ = true;
  if (!globalThis.document) {
    installDomStubs();
    globalThis.WebGL2RenderingContext = class WebGL2RenderingContext { };
  }
  let now = opts.startTime || 0;
  const state = { errors: [], seen: new Set(), now: 0 };
  const pendingRef = { cb: null };

  globalThis.performance.now = () => state.now;
  globalThis.requestAnimationFrame = (cb) => { pendingRef.cb = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { pendingRef.cb = null; };
  globalThis.window.requestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.addEventListener = () => { };

  await import('../src/main.js');
  const app = globalThis.window.__AERIAL_TEMPEST__;
  if (!app) throw new Error('main.js did not expose window.__AERIAL_TEMPEST__');

  const tick = (dtms = 16.7, before = null) => {
    state.now += dtms;
    const cb = pendingRef.cb;
    pendingRef.cb = null;
    if (!cb) return false;
    if (before) before(app);
    try {
      cb(state.now);
    } catch (e) {
      const key = String((e && e.message) || e);
      if (!state.seen.has(key) && state.errors.length < 40) {
        state.seen.add(key);
        state.errors.push(e);
      }
      try { app.loop(); } catch (e2) { /* unrecoverable */ }
    }
    return true;
  };

  const step = async (dtms = 16.7, before = null) => {
    await new Promise((r) => setTimeout(r, 0));
    if (!tick(dtms, before)) {
      await new Promise((r) => setTimeout(r, 0));
      tick(dtms, before);
    }
    return state;
  };

  // boot: pump frames until the loop has rendered
  for (let i = 0; i < 600 && !app.renderer; i++) await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 600 && !(app.frameCount > 0); i++) { await step(); }

  return { app, step, tick, state, errors: state.errors };
}
