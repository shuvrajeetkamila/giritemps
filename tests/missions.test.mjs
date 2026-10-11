// Data integrity for campaign missions, plus profile rank and unlock rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSIONS, TIME_HOURS } from '../src/game/missions.js';
import { SITES } from '../src/world/layout.js';
import { AIRCRAFT } from '../src/physics/aircraft-data.js';
import { rankFor, isAircraftUnlocked } from '../src/game/profile.js';

const WEATHER = ['clear', 'overcast', 'rain', 'storm', 'snow'];
const OBJ_TYPES = ['takeoff', 'waypoints', 'killTag', 'land', 'destroy', 'survive', 'shipsAlive'];
const KINDS = ['fighter', 'drone', 'bomber', 'boss'];
const SKILLS = ['rookie', 'wingman', 'leader', 'ace'];

test('ten campaign missions with unique ids', () => {
  assert.equal(MISSIONS.length, 10);
  assert.equal(new Set(MISSIONS.map((m) => m.id)).size, 10);
});

for (const m of MISSIONS) {
  test(`${m.id} is well formed`, () => {
    assert.ok(AIRCRAFT[m.aircraft], `aircraft ${m.aircraft}`);
    assert.ok(WEATHER.includes(m.weather), `weather ${m.weather}`);
    assert.ok(TIME_HOURS[m.time] !== undefined, `time ${m.time}`);
    assert.ok(m.par > 0);
    const tags = new Set();
    for (const w of m.waves) for (const g of w.spawns) {
      assert.ok(KINDS.includes(g.kind), `kind ${g.kind}`);
      assert.ok(SKILLS.includes(g.skill), `skill ${g.skill}`);
      assert.ok(g.count > 0 && g.center.length === 3);
      tags.add(g.tag);
    }
    if (m.transports) tags.add('transport');
    const targetIds = new Set((m.targets || []).map((t) => t.id));
    for (const t of m.targets || []) {
      if (t.type !== 'ship') assert.ok(SITES[t.site], `site ${t.site} for ${t.id}`);
    }
    for (const o of m.objectives) {
      assert.ok(OBJ_TYPES.includes(o.type), `objective type ${o.type}`);
      if (o.type === 'killTag') assert.ok(tags.has(o.tag), `no wave spawns tag ${o.tag} (${m.id})`);
      if (o.type === 'destroy') assert.ok(targetIds.has(o.target), `missing target ${o.target} (${m.id})`);
      if (o.type === 'waypoints') assert.ok(o.points.length > 0 && o.radius > 0);
    }
    if (m.fleet) assert.ok((m.targets || []).some((t) => t.type === 'ship'));
    assert.ok(m.objectives.length > 0);
  });
}

test('rank thresholds', () => {
  assert.equal(rankFor(0).name, 'Cadet');
  assert.equal(rankFor(500).name, 'Aviator');
  assert.equal(rankFor(4999).name, 'Flying Officer');
  assert.equal(rankFor(40000).name, 'Air Marshal');
  assert.equal(rankFor(40000).next, null);
});

test('aircraft unlocks: gripen and F-16 from the start, F-22 needs missions', () => {
  assert.equal(isAircraftUnlocked('gripen'), true);
  assert.equal(isAircraftUnlocked('f16'), true);
  assert.equal(isAircraftUnlocked('f22'), false);
  assert.equal(isAircraftUnlocked('nope'), false);
});
