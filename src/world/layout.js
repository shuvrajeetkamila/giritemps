// Fixed world layout: airfield, villages, military sites, canyon path and sea fleet location.
// Coordinates are meters in a 8 km x 8 km square centred on the origin (x east, z south).
// Sites are flattened into pads by the terrain generator so buildings and targets sit flat.

export const WORLD_HALF = 4000;

export const AIRFIELD = {
  x: -1100, z: -900, halfLen: 1000, halfWid: 40,
  // Runway runs north-south (along Z). Spawn facing north at the south end.
  spawn: { x: -1100, z: 60, heading: 0 },
  padHalfW: 180, padHalfL: 1080, h: null,
};

export const VILLAGES = [
  { name: 'Verdal', x: -2200, z: 1100 },
  { name: 'Kestrel Bay', x: 1500, z: 1700 },
  { name: 'Oren Falls', x: 400, z: -2000 },
  { name: 'Sable Creek', x: -2900, z: -1200 },
  { name: 'Lamar', x: 2300, z: -400 },
  { name: 'Halvik', x: -600, z: 2600 },
];

export const SITES = {
  radar1: { x: 700, z: -700, r: 55 },
  radar2: { x: -400, z: 1500, r: 55 },
  sam1: { x: 1250, z: 400, r: 60 },
  sam2: { x: -2050, z: -2050, r: 60 },
  aaa1: { x: -200, z: 200, r: 50 },
  aaa2: { x: 1500, z: -1800, r: 50 },
  depot: { x: -2500, z: 500, r: 70 },
  base: { x: 200, z: 1200, r: 90 },
  tower: { x: 300, z: -300, r: 40 },
  hangar1: { x: -1300, z: -600, r: 40 },
  hangar2: { x: -1300, z: -900, r: 40 },
  hangar3: { x: -1300, z: -1200, r: 40 },
  bunker: { x: 2900, z: 1500, r: 60 },
  depotAA1: { x: -2440, z: 430, r: 40 },
  depotAA2: { x: -2565, z: 600, r: 40 },
  airAA1: { x: -1000, z: -600, r: 40 },
  airAA2: { x: -1200, z: -1150, r: 40 },
  baseSam: { x: 330, z: 1080, r: 50 },
};

// Fleet location is deep water in the eastern sea.
export const FLEET = { x: 3400, z: -3300, heading: 0.9 };

// Canyon polyline carved into the terrain (Canyon Run mission).
export const CANYON = {
  depth: 170, width: 160,
  points: [[-3300, 2700], [-2300, 2000], [-1500, 1000], [-900, 1300], [-200, 800], [200, 1200]],
};

// Mountains and snow use the terrain function; these are fixed points for spawn/targets.
export const PLAYER_SPAWN_AIR = { x: -1100, y: 900, z: 500, heading: 0 };

// Pads for the terrain: rect for airfield, circle for others.
export function buildPads(terrainRawHeight) {
  const pads = [];
  const a = AIRFIELD;
  pads.push({ kind: 'rect', x: a.x, z: a.z, hx: a.padHalfW, hz: a.padHalfL, blend: 120, h: terrainRawHeight(a.x, a.z) });
  for (const k of Object.keys(SITES)) {
    const s = SITES[k];
    pads.push({ kind: 'circle', x: s.x, z: s.z, r: s.r, blend: 80, h: terrainRawHeight(s.x, s.z) });
  }
  for (const v of VILLAGES) pads.push({ kind: 'circle', x: v.x, z: v.z, r: 170, blend: 120, h: terrainRawHeight(v.x, v.z) });
  return pads;
}
