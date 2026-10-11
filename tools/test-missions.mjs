// Regression: every campaign mission boots, spawns its content, runs frames and
// keeps the player state finite.  This is the test that catches "mission N hangs
// or throws" bugs (it found a DOM-stub bug that made UI.showToast spin forever).
//
// Run: node tools/test-missions.mjs
import { bootApp } from './harness.mjs';

const results = [];
const check = (ok, label) => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const { app, step, errors } = await bootApp();
const { MISSIONS } = await import('../src/game/Missions.js');

check(MISSIONS.length === 10, `campaign has 10 missions (${MISSIONS.length})`);

const seen = new Set();
for (const m of MISSIONS) {
  const t0 = Date.now();
  app.startMission(m.id);
  const started = Date.now() - t0;
  const ac = app.game.player;
  check(!!ac && ac.fm.alive, `${m.id} ${m.name}: player spawned`);
  check(app.game.mode === 'flying', `${m.id}: flying`);
  check(app.game.objectives.length > 0, `${m.id}: has objectives (${app.game.objectives.length})`);
  check(started < 1500, `${m.id}: spawns promptly (${started} ms)`);
  const before = app.frameCount;
  const tf = Date.now();
  for (let i = 0; i < 20; i++) await step();
  const frameMs = (Date.now() - tf) / 20;
  check(app.frameCount > before, `${m.id}: frames advanced`);
  const fm = app.game.player.fm;
  check(Number.isFinite(fm.pos.x) && Number.isFinite(fm.pos.y) && Number.isFinite(fm.pos.z)
    && Number.isFinite(fm.speed), `${m.id}: player state finite`);
  check(frameMs < 120, `${m.id}: frames are not pathological (${frameMs.toFixed(0)} ms/frame)`);
  const kinds = {};
  for (const t of app.game.targets) kinds[t.type] = (kinds[t.type] || 0) + 1;
  console.log(`      ${m.id.padEnd(4)} ${String(m.name).padEnd(24)} red=${app.game.aircraft.filter((a) => a.faction === 'red').length} ground=${app.game.targets.length} ${JSON.stringify(kinds)}`);
  seen.add(m.id);
}

// content sanity: the missions that are *supposed* to have a given feature do
console.log('— mission content');
app.startMission('m03');
await step();
check(app.game.targets.some((t) => t.type === 'depot'), 'm03 has fuel depots');
check(app.game.targets.some((t) => t.type === 'fuelTank'), 'm03 has fuel tanks');
app.startMission('m01');
await step();
check(app.game.gates.length > 0, `m01 has training gates (${app.game.gates.length})`);
app.startMission('m04');
await step();
check(app.game.targets.some((t) => t.type === 'sam'), 'm04 has SAM batteries');
app.startMission('m08');
await step();
check(app.game.targets.filter((t) => t.type === 'ship').length >= 2, 'm08 has a friendly fleet');
check(app.game.aircraft.some((a) => a.role === 'strike'), 'm08 has strike aircraft');

check(errors.length === 0, `no errors across the campaign (${errors.length})`);
if (errors.length) console.log(errors.slice(0, 5));

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nALL MISSIONS OK');
process.exit(bad ? 1 : 0);
