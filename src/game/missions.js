// Campaign mission data. Each mission is data: environment, spawn waves, ground targets and an
// ordered list of objectives. Objective evaluation lives in game.js.
export const MISSIONS = [
  {
    id: 'm1', name: 'Mission 1: Training', time: 'day', weather: 'clear', par: 420, aircraft: 'f16',
    brief: 'Welcome to flight school. Taxi to the runway, take off, fly the practice rings to learn turns and rolls, then engage three target drones. Land back at base.',
    spawnAir: false,
    objectives: [
      { id: 'takeoff', type: 'takeoff', text: 'Take off from the runway' },
      { id: 'rings', type: 'waypoints', text: 'Fly through the practice rings', points: [[-1100, 1300, -2400], [-600, 1200, -3400], [-1400, 1100, -3700]], radius: 150 },
      { id: 'drones', type: 'killTag', tag: 'drone', count: 3, text: 'Destroy the three target drones' },
      { id: 'land', type: 'land', text: 'Land on the runway' },
    ],
    waves: [
      { wave: 0, delay: 40, spawns: [{ tag: 'drone', kind: 'drone', count: 3, center: [-1100, 1000, -3800], radius: 1200, skill: 'rookie', alt: 1000 }] },
    ],
    targets: [],
    briefingAudio: 'Training sortie. Follow the instructor\'s rings, then destroy the drones and bring it home.',
  },
  {
    id: 'm2', name: 'Mission 2: First Sortie', time: 'day', weather: 'overcast', par: 300, aircraft: 'gripen',
    brief: 'Bandit flight of four is heading for friendly territory. Scramble, intercept and destroy all four.',
    spawnAir: true, startAlt: 1800, startPos: [-1100, 1800, 600], startHeading: 0,
    objectives: [{ id: 'sortie', type: 'killTag', tag: 'sortie', count: 4, text: 'Destroy the four enemy fighters' }],
    waves: [
      { wave: 0, spawns: [{ tag: 'sortie', kind: 'fighter', count: 4, center: [-1100, 1800, -7500], radius: 800, skill: 'rookie', alt: 1800, formation: true }] },
    ],
    targets: [],
  },
  {
    id: 'm3', name: 'Mission 3: Ground Strike', time: 'morning', weather: 'clear', par: 360, aircraft: 'f16',
    brief: 'Fly low through the valley to avoid radar. Destroy the enemy fuel depot. It is defended by two AA gun positions.',
    spawnAir: true, startAlt: 500, startPos: [-2200, 500, 1700], startHeading: -0.5,
    objectives: [{ id: 'depot', type: 'destroy', target: 'depot', text: 'Destroy the fuel depot' }],
    waves: [{ wave: 0, spawns: [{ tag: 'sortie', kind: 'fighter', count: 1, center: [-2800, 600, 500], radius: 500, skill: 'rookie', alt: 1000 }] }],
    targets: [
      { id: 'depot', type: 'depot', site: 'depot', objective: true, hp: 320 },
      { id: 'aa1', type: 'aaa', site: 'depotAA1', hp: 110 },
      { id: 'aa2', type: 'aaa', site: 'depotAA2', hp: 110 },
      { id: 'sam1', type: 'sam', site: 'sam2', hp: 200 },
    ],
  },
  {
    id: 'm4', name: 'Mission 4: Escort', time: 'day', weather: 'clear', par: 480, aircraft: 'gripen',
    brief: 'Protect three allied transports on their slow route east to Lamar. Waves of enemy interceptors will attack. Lose all transports and the mission is failed.',
    spawnAir: true, startAlt: 1200, startPos: [-1100, 1200, 400], startHeading: 1.3,
    objectives: [
      { id: 'escort', type: 'survive', seconds: 240, text: 'Keep the transports alive for four minutes' },
      { id: 'interceptors', type: 'killTag', tag: 'interceptor', count: 8, text: 'Destroy eight enemy interceptors' },
    ],
    waves: [
      { wave: 0, spawns: [{ tag: 'interceptor', kind: 'fighter', count: 2, center: [1500, 1300, -1200], radius: 600, skill: 'rookie', alt: 1400 }], allies: true },
      { wave: 1, delay: 45, spawns: [{ tag: 'interceptor', kind: 'fighter', count: 2, center: [2000, 1300, -800], radius: 600, skill: 'rookie', alt: 1400 }] },
      { wave: 2, delay: 90, spawns: [{ tag: 'interceptor', kind: 'fighter', count: 2, center: [2500, 1400, 0], radius: 700, skill: 'wingman', alt: 1600 }] },
      { wave: 3, delay: 130, spawns: [{ tag: 'interceptor', kind: 'fighter', count: 2, center: [2600, 1500, 400], radius: 700, skill: 'wingman', alt: 1600 }] },
    ],
    transports: { count: 3, route: [[-1000, 1100, 300], [0, 1100, 0], [1000, 1150, -400], [2300, 1100, -400]], alt: 1100, cruise: 110 },
    targets: [],
  },
  {
    id: 'm5', name: 'Mission 5: Dogfight Gauntlet', time: 'afternoon', weather: 'overcast', par: 420, aircraft: 'f22',
    brief: 'Escalating air battle. First one ace, then two, then four. Survive the gauntlet.',
    spawnAir: true, startAlt: 2600, startPos: [-600, 2600, 800], startHeading: 0,
    objectives: [
      { id: 'w1', type: 'killTag', tag: 'w1', count: 1, text: 'Wave 1: destroy the ace' },
      { id: 'w2', type: 'killTag', tag: 'w2', count: 2, text: 'Wave 2: destroy both aces' },
      { id: 'w3', type: 'killTag', tag: 'w3', count: 4, text: 'Wave 3: destroy the four-ship' },
    ],
    waves: [
      { wave: 0, spawns: [{ tag: 'w1', kind: 'fighter', count: 1, center: [-600, 2600, -9000], radius: 800, skill: 'ace', alt: 2600 }] },
      { wave: 1, spawns: [{ tag: 'w2', kind: 'fighter', count: 2, center: [-600, 2600, -9000], radius: 800, skill: 'ace', alt: 2600 }] },
      { wave: 2, spawns: [{ tag: 'w3', kind: 'fighter', count: 4, center: [-600, 2600, -9000], radius: 1000, skill: 'leader', alt: 2600, formation: true }] },
    ],
    targets: [],
  },
  {
    id: 'm6', name: 'Mission 6: Night Raid', time: 'night', weather: 'clear', par: 420, aircraft: 'su34',
    brief: 'Destroy three hangars at the enemy airfield at night. Searchlights and flak will sweep the sky. Use night vision (N) to find targets.',
    spawnAir: true, startAlt: 1500, startPos: [-1100, 1500, 3000], startHeading: 0,
    objectives: [
      { id: 'h1', type: 'destroy', target: 'hangar1', text: 'Destroy hangar one' },
      { id: 'h2', type: 'destroy', target: 'hangar2', text: 'Destroy hangar two' },
      { id: 'h3', type: 'destroy', target: 'hangar3', text: 'Destroy hangar three' },
    ],
    waves: [{ wave: 0, spawns: [{ tag: 'night', kind: 'fighter', count: 2, center: [-1100, 1500, -6000], radius: 900, skill: 'rookie', alt: 1700 }] }],
    targets: [
      { id: 'hangar1', type: 'hangar', site: 'hangar1', objective: true, hp: 420 },
      { id: 'hangar2', type: 'hangar', site: 'hangar2', objective: true, hp: 420 },
      { id: 'hangar3', type: 'hangar', site: 'hangar3', objective: true, hp: 420 },
      { id: 'aa1', type: 'aaa', site: 'airAA1', hp: 110 },
      { id: 'aa2', type: 'aaa', site: 'airAA2', hp: 110 },
    ],
    searchlights: [[-1000, -300], [-1250, -1100], [-1500, -700], [-900, -1000]],
  },
  {
    id: 'm7', name: 'Mission 7: Canyon Run', time: 'afternoon', weather: 'clear', par: 480, aircraft: 'gripen',
    brief: 'Run the desert canyon at high speed, following the rings through the tight turns. Then drop a bomb on the hidden radar base at the end.',
    spawnAir: true, startAlt: 350, startPos: [-3300, 350, 2950], startHeading: -0.7,
    objectives: [
      { id: 'canyon', type: 'waypoints', text: 'Follow the canyon rings to the base', points: [[-2300, 260, 1980], [-1500, 260, 1000], [-900, 260, 1300], [-200, 260, 800]], radius: 140 },
      { id: 'bomb', type: 'destroy', target: 'base', text: 'Bomb the hidden radar base' },
    ],
    waves: [{ wave: 0, spawns: [{ tag: 'base', kind: 'fighter', count: 1, center: [0, 1300, 1000], radius: 400, skill: 'rookie', alt: 1100 }] }],
    targets: [
      { id: 'base', type: 'radar', site: 'base', objective: true, hp: 380 },
      { id: 'basesam', type: 'sam', site: 'baseSam', hp: 220 },
    ],
  },
  {
    id: 'm8', name: 'Mission 8: Fleet Defense', time: 'day', weather: 'clear', par: 540, aircraft: 'f22',
    brief: 'Protect the friendly fleet from enemy bombers and their escorts. The ships carry AA guns; keep them afloat.',
    spawnAir: true, startAlt: 1800, startPos: [2600, 1800, -2200], startHeading: 2.3,
    objectives: [
      { id: 'bombers', type: 'killTag', tag: 'bomber', count: 3, text: 'Destroy the three bombers' },
      { id: 'fleet', type: 'shipsAlive', min: 1, text: 'Keep at least one ship afloat' },
    ],
    waves: [
      { wave: 0, spawns: [{ tag: 'bomber', kind: 'bomber', count: 3, center: [6000, 2200, -6000], radius: 500, skill: 'rookie', alt: 2000, target: 'fleet' }] },
      { wave: 1, delay: 40, spawns: [{ tag: 'escort', kind: 'fighter', count: 3, center: [6000, 2200, -6000], radius: 900, skill: 'ace', alt: 2400, target: 'fleet' }] },
    ],
    targets: [{ id: 'ship1', type: 'ship', orbitR: 320, orbitA: 0, hp: 800 }, { id: 'ship2', type: 'ship', orbitR: 320, orbitA: 2.1, hp: 800 }, { id: 'ship3', type: 'ship', orbitR: 320, orbitA: 4.2, hp: 800 }],
    fleet: true,
  },
  {
    id: 'm9', name: 'Mission 9: Storm Assault', time: 'dusk', weather: 'storm', par: 420, aircraft: 'f16',
    brief: 'Fight through a thunderstorm. Enemies will appear and vanish in the cloud cover. Watch for turbulence in the storm cells and lightning strikes.',
    spawnAir: true, startAlt: 2400, startPos: [-600, 2400, 2000], startHeading: 0,
    objectives: [
      { id: 'storm1', type: 'killTag', tag: 'storm', count: 6, text: 'Destroy six enemy fighters in the storm' },
    ],
    waves: [
      { wave: 0, spawns: [{ tag: 'storm', kind: 'fighter', count: 3, center: [-600, 2400, -4000], radius: 900, skill: 'leader', alt: 2400, formation: true }] },
      { wave: 1, delay: 35, spawns: [{ tag: 'storm', kind: 'fighter', count: 3, center: [1400, 2600, -2000], radius: 900, skill: 'ace', alt: 2400, formation: true }] },
    ],
    targets: [],
  },
  {
    id: 'm10', name: 'Mission 10: Final Assault', time: 'afternoon', weather: 'overcast', par: 900, aircraft: 'f22',
    brief: 'The enemy has committed everything. Clear the sky of waves of fighters, destroy the air defence and bring down the experimental super-aircraft "Voron".',
    spawnAir: true, startAlt: 3000, startPos: [-600, 3000, 2600], startHeading: 0,
    objectives: [
      { id: 'w1', type: 'killTag', tag: 'w1', count: 6, text: 'Destroy the first wave (6 fighters)' },
      { id: 'sam', type: 'destroy', target: 'sam1', text: 'Destroy the SAM site at the coast' },
      { id: 'boss', type: 'killTag', tag: 'boss', count: 1, text: 'Destroy the experimental super-aircraft' },
    ],
    waves: [
      { wave: 0, spawns: [{ tag: 'w1', kind: 'fighter', count: 6, center: [-600, 3000, -8000], radius: 1500, skill: 'leader', alt: 3000, formation: true }] },
      { wave: 1, delay: 60, spawns: [{ tag: 'boss', kind: 'boss', count: 1, center: [-600, 3300, -9000], radius: 300, skill: 'ace', alt: 3300 }] },
    ],
    targets: [{ id: 'sam1', type: 'sam', site: 'sam1', objective: true, hp: 260 }, { id: 'radar1', type: 'radar', site: 'radar1', hp: 300 }, { id: 'aa2', type: 'aaa', site: 'aaa2', hp: 110 }],
  },
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id);
}

export const TIME_HOURS = { day: 12, morning: 8, afternoon: 15, dusk: 17.4, night: 23.2, dawn: 6.2, noon: 12.5 };
