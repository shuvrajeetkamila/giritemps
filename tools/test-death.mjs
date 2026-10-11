// Regression: what happens when the player dies?
//
//   * instant action / free flight -> the player must respawn a few seconds
//     after death, still in 'flying';
//   * campaign mission -> the mission must fail and the debrief must be shown
//     (mode 'debrief', UI screen 'debrief'), not leave the game stuck flying
//     with no UI.
//
// NOTE: everything runs against ONE app instance.  The harness imports
// src/main.js, and ESM caches modules, so a second bootApp() in the same
// process would hand back the first app - the harness now throws on that.
//
// Run: node tools/test-death.mjs
import { bootApp } from './harness.mjs';

const results = [];
const check = (ok, label) => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const { app, step, errors } = await bootApp();
const pump = async (frames) => { for (let i = 0; i < frames; i++) await step(16.7); };
const seconds = (s) => pump(Math.ceil(s * 60));

/** kill the player exactly as a missile would: through applyDamage */
async function killPlayer() {
  const pl = app.game.player;
  pl.applyDamage(pl.maxHealth * 4, pl.fm.pos.clone(), null, app.world);
  await pump(10);
  return pl;
}

// ---------------------------------------------------------------------------
console.log('— instant action: player death respawns');
app.startQuick('instant');
await pump(30);
check(app.game.mode === 'flying', `mission running (mode ${app.game.mode})`);
await killPlayer();
check(!app.game.player.fm.alive, 'player destroyed in instant action');
await seconds(6);
check(app.game.player.fm.alive, 'player respawned');
check(app.game.mode === 'flying', `still flying after respawn (mode ${app.game.mode})`);
check(errors.length === 0, `no errors during respawn (${errors.length})`);
if (errors.length) console.log(errors.slice(0, 3));

// ---------------------------------------------------------------------------
console.log('— free flight: death respawns, no mission state');
app.startQuick('freeflight');
await pump(30);
await killPlayer();
check(!app.game.player.fm.alive, 'player destroyed in free flight');
await seconds(6);
check(app.game.player.fm.alive, 'player respawned in free flight');
check(app.game.mode === 'flying', `still flying (mode ${app.game.mode})`);
check(errors.length === 0, `no errors (${errors.length})`);

// ---------------------------------------------------------------------------
console.log('— campaign mission: player death ends the mission');
app.startMission('m01');
await pump(30);
check(app.game.mode === 'flying', `mission running (mode ${app.game.mode})`);
await killPlayer();
check(!app.game.player.fm.alive, 'player aircraft is destroyed');
check(app.game.failed === true, 'mission marked failed');
// _fail arms a 3 s timer; the debrief must follow on its own
await seconds(6);
check(app.game.mode === 'debrief', `reached the debrief (mode ${app.game.mode})`);
check(app.ui.screen === 'debrief', `debrief screen is up (ui.screen ${app.ui.screen})`);
check(app.game.debrief && app.game.debrief.success === false, 'debrief reports failure');
check(app.game.debrief && !!app.game.debrief.reason, `debrief has a reason ("${app.game.debrief && app.game.debrief.reason}")`);
check(errors.length === 0, `no errors during the death sequence (${errors.length})`);
if (errors.length) console.log(errors.slice(0, 3));

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nDEATH HANDLING OK');
process.exit(bad ? 1 : 0);
