// Entry point: builds the game, the UI and the audio engine, then runs the frame loop.
import * as THREE from 'three';
import { initInput, requestMouseLock } from './core/input.js';
import { loadSettings } from './core/settings.js';
import { AudioEngine } from './audio/audio.js';
import { Game } from './game/game.js';
import { UI } from './ui/ui.js';
import { AIRFIELD } from './world/layout.js';

const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const uiRoot = document.getElementById('ui');

initInput(canvas);
const audio = new AudioEngine();
let ui = null;
const game = new Game({ canvas, hudCanvas, audio, emit: (ev, data) => ui && ui.onGameEvent(ev, data) });
ui = new UI({ root: uiRoot, game, audio });

const resize = () => game.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', resize);
resize();

// Browsers only allow audio after a user gesture: start the audio context on the first press.
window.addEventListener('pointerdown', () => audio.init(loadSettings()), { once: true });

// Capture the mouse on click during flight; losing the capture pauses the sortie.
canvas.addEventListener('click', () => {
  if (game.mode === 'flight' && !game.paused) requestMouseLock(canvas);
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && game.mode === 'flight' && !game.paused && game.session && !game.session.over) game.pause();
});

// Build the terrain around the airfield before showing the title screen.
ui.loading('Generating world… (procedural terrain, sky and props)');
setTimeout(() => {
  game.warmup(new THREE.Vector3(AIRFIELD.x, 300, AIRFIELD.z));
  ui.title();
  audio.setMusicState && audio.ready && audio.setMusicState('menu');
}, 60);

// Frame loop with optional frame cap.
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const s = loadSettings();
  const dtMs = t - last;
  if (s.frameCap > 0 && dtMs < 1000 / s.frameCap - 1) return;
  last = t;
  game.frame(Math.max(dtMs / 1000, 0.0001), t / 1000);
}
requestAnimationFrame(loop);

window.__giritemps = { game, audio, ui };
