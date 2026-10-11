// Regression: the ground war.  SAMS that launch and trigger the "MISSILE
// INCOMING" warning, AAA that shoots tracers, and fuel depots that chain
// explode into the tanks around them.
//
// Run: node tools/test-ground.mjs
import { bootApp } from './harness.mjs';

const results = [];
const check = (ok, label) => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const { app, step, errors } = await bootApp();
const pump = async (frames) => { for (let i = 0; i < frames; i++) await step(16.7); };

// ---------------------------------------------------------------------------
console.log('— SAM battery: locks, launches, warns the player');
app.startMission('m04');
await pump(30);
const sam = app.game.targets.find((t) => t.type === 'sam');
check(!!sam, 'm04 has a SAM battery');
check(sam.def.range > 8000, `SAM range is long (${sam.def.range} m)`);
check(sam.ammo === sam.def.missiles, `SAM is loaded (${sam.ammo} missiles)`);

// hover the player inside the envelope, parked in front of the site
const pl = app.game.player;
pl.fm.pos.set(sam.pos.x + 2200, sam.pos.y + 1500, sam.pos.z + 2200);
pl.fm.vel.set(0, 0, 0);
const missiles0 = app.world.projectiles.stats.missilesFired;
let warned = false;
for (let i = 0; i < 60 * 14; i++) {
  await step();
  if (pl.incomingMissile(app.world)) warned = true;
}
const launched = app.world.projectiles.stats.missilesFired - missiles0;
check(launched > 0, `SAM launched ${launched} missile(s)`);
check(sam.ammo < sam.def.missiles, `SAM ammo counted down (${sam.ammo}/${sam.def.missiles})`);
check(warned, 'player got the MISSILE INCOMING warning');
check(errors.length === 0, `no errors during the SAM engagement (${errors.length})`);

// ---------------------------------------------------------------------------
console.log('— AAA: shoots tracer at a low-flying target');
const aaa = app.game.targets.find((t) => t.type === 'aaa');
check(!!aaa, 'm04 has an AAA gun');
const bullets0 = app.world.projectiles.stats.fired;
pl.fm.pos.set(aaa.pos.x + 900, aaa.pos.y + 500, aaa.pos.z + 900);
pl.fm.vel.set(0, -20, 0);
for (let i = 0; i < 60 * 6; i++) await step();
const bullets = app.world.projectiles.stats.fired - bullets0;
check(bullets > 0, `AAA fired ${bullets} round(s)`);
check(errors.length === 0, `no errors during the AAA engagement (${errors.length})`);

// ---------------------------------------------------------------------------
console.log('— fuel depot: chain explosion');
app.startMission('m03');            // m03 is the fuel-depot strike
await pump(30);
const depot = app.game.targets.find((t) => t.type === 'depot');
check(!!depot, 'm03 has a fuel depot');
const tanks = app.game.targets.filter((t) => t.type === 'fuelTank' && !t.dead);
const near = tanks.filter((t) => t.pos.distanceTo(depot.pos) < 260);
check(near.length > 0, `fuel tanks sit around the depot (${near.length} within 260 m)`);
const kills0 = app.game.stats.groundKills;
const hpBefore = near.map((t) => t.health);
depot.damage(depot.health * 4, app.world, depot.pos.clone());
await pump(60 * 2);
const hurt = near.filter((t, i) => t.health < hpBefore[i] || t.dead).length;
check(depot.dead, 'the depot was destroyed');
const chainKills = app.game.targets.filter((t) => t.dead && t.type === 'fuelTank').length;
console.log(`      (chain killed ${chainKills} tank(s) outright)`);
check(hurt > 0, `the blast damaged ${hurt} neighbouring tank(s)`);
check(app.game.stats.groundKills > kills0, `ground kills counted (+${app.game.stats.groundKills - kills0})`);
check(app.game.score > 0, `score moved with the kill (${Math.round(app.game.score)})`);
check(errors.length === 0, `no errors during the chain explosion (${errors.length})`);

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nGROUND WAR OK');
process.exit(bad ? 1 : 0);
