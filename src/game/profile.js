// Pilot profile: stats, XP and rank, unlocks, high scores. Stored in localStorage.
import { AIRCRAFT } from '../physics/aircraft-data.js';

const KEY = 'giritemps.profile.v1';

export const RANKS = [
  [0, 'Cadet'], [500, 'Aviator'], [1500, 'Pilot Officer'], [3000, 'Flying Officer'], [5000, 'Flight Lieutenant'],
  [8000, 'Squadron Leader'], [12000, 'Wing Commander'], [18000, 'Group Captain'], [26000, 'Air Commodore'], [36000, 'Air Marshal'],
];

const DEFAULT = {
  flightTime: 0, distance: 0, shots: 0, hits: 0,
  kills: { air: 0, ground: 0 },
  missionsCompleted: 0,
  grades: {},           // missionId -> best grade letter
  sRanks: 0,
  arcadeHigh: [],       // [{score, kills, time, acc, date, aircraft}]
  xp: 0,
  liveries: {},         // aircraftId -> selected livery id
  unlockedWeapons: [],
};

let cache = null;

export function loadProfile() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
  cache = { ...DEFAULT, ...saved, kills: { ...DEFAULT.kills, ...(saved.kills || {}) } };
  return cache;
}

export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
}

export function rankFor(xp) {
  let name = RANKS[0][1], idx = 0;
  RANKS.forEach(([min, n], i) => { if (xp >= min) { name = n; idx = i; } });
  const next = RANKS[idx + 1];
  return { name, index: idx, next: next ? next[0] : null, floor: RANKS[idx][0] };
}

export function addXp(amount) {
  const p = loadProfile();
  const before = rankFor(p.xp).name;
  p.xp += amount;
  saveProfile();
  const after = rankFor(p.xp).name;
  return { gained: amount, rankUp: before !== after ? after : null };
}

// Aircraft unlock check.
export function isAircraftUnlocked(id) {
  const spec = AIRCRAFT[id];
  if (!spec) return false;
  if (!spec.unlock) return true;
  const p = loadProfile();
  if (spec.unlock.missions) return p.missionsCompleted >= spec.unlock.missions;
  if (spec.unlock.grades) return p.sRanks >= spec.unlock.count;
  return false;
}

export function unlockHint(id) {
  const spec = AIRCRAFT[id];
  if (!spec || !spec.unlock) return '';
  if (spec.unlock.missions) return `Complete ${spec.unlock.missions} campaign missions`;
  if (spec.unlock.grades) return `Earn ${spec.unlock.count} S-ranks`;
  return '';
}

// Livery availability: unlocked by total kills.
export function liveryUnlocked(spec, livery) {
  return loadProfile().kills.air + loadProfile().kills.ground >= (livery.unlockKills || 0);
}

export function recordMission(missionId, grade, score) {
  const p = loadProfile();
  const prev = p.grades[missionId];
  const order = 'DCBAS';
  if (!prev || order.indexOf(grade) > order.indexOf(prev)) p.grades[missionId] = grade;
  if (grade === 'S' && (!prev || prev !== 'S')) p.sRanks++;
  p.missionsCompleted = Math.max(p.missionsCompleted, Object.keys(p.grades).length);
  saveProfile();
}

export function recordArcade(entry) {
  const p = loadProfile();
  p.arcadeHigh.push(entry);
  p.arcadeHigh.sort((a, b) => b.score - a.score);
  p.arcadeHigh = p.arcadeHigh.slice(0, 10);
  saveProfile();
}

export function accuracyPct(p = loadProfile()) {
  return p.shots > 0 ? Math.round((p.hits / p.shots) * 100) : 0;
}
