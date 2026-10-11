// ---------------------------------------------------------------------------
// Missions — the ten-mission campaign: training through the final assault.
// Each mission defines its scenario, objectives, opposition and rewards.
// ---------------------------------------------------------------------------

const RED = 'red', BLUE = 'blue';

export const MISSIONS = [
  {
    id: 'm01',
    index: 1,
    name: 'FAMILIARISATION FLIGHT',
    short: 'TRAINING',
    location: 'VELL AIRBASE — HOME RANGE',
    time: 9.5,
    dayLength: 2400,
    weather: 'clear',
    player: { x: 0, y: 900, z: 0, speed: 200, altitude: 900 },
    briefing: `Welcome to the 44th, rookie.\n\nBefore we put you in the fight you will fly the range. Take off, climb to eight thousand feet and put the aircraft through its paces: rolls, loops, and a stall so you know what the buffet feels like.\n\nThen fly the four navigation gates in order and come home. Nothing here shoots back — today.`,
    objectives: [
      { type: 'gate', count: 4, text: 'FLY THE 4 NAVIGATION GATES' },
      { type: 'land', text: 'OPTIONAL: LAND AT VELL AIRBASE', optional: true }
    ],
    gates: { count: 4, radius: 320, spacing: 2600, alt: 900 },
    spawns: [],
    reward: { xp: 400, cash: 0 },
    unlock: null
  },
  {
    id: 'm02',
    index: 2,
    name: 'GUNS ONLY',
    short: 'INTERCEPT',
    location: 'CAPE HARRIS PATROL BOX',
    time: 15.0,
    dayLength: 2200,
    weather: 'partly',
    player: { x: 0, y: 4200, z: 0, speed: 280, altitude: 4200 },
    briefing: `Two recon drones are probing the cape. They are slow, unarmed and pretending not to see you.\n\nYour job is simple: shoot both down with the cannon. Missiles are authorised only as a last resort — the skipper wants the gun camera footage.\n\nA section of hostile fighters will scramble once the drones go down. You may leave the area at that point.`,
    objectives: [
      { type: 'destroy', targetType: 'drone', count: 2, text: 'DESTROY 2 RECON DRONES' },
      { type: 'survive', time: 40, text: 'SURVIVE THE SCAMBLE' }
    ],
    spawns: [
      { role: 'drone', count: 2, faction: RED, aircraft: 'viper', skill: 'rookie', patrol: { x: 3000, z: 8000 }, speed: 160 }
    ],
    waves: [
      { delay: 6, when: 'objective0', spawns: [{ role: 'fighter', count: 2, faction: RED, aircraft: 'viper', difficulty: 'rookie', patrol: { x: -2000, z: -6000 } }] }
    ],
    reward: { xp: 700, cash: 0 }
  },
  {
    id: 'm03',
    index: 3,
    name: 'HARBOUR STRIKE',
    short: 'STRIKE',
    location: 'SALTSPRAY HARBOUR',
    time: 7.0,
    dayLength: 2600,
    weather: 'hazy',
    player: { x: -6000, y: 3000, z: -6000, speed: 260, altitude: 3000 },
    briefing: `Intelligence says the enemy is unloading at Saltspray, a fuel depot and two AAA nests covering the approach.\n\nGo in low, kill the AAA first, then level the depots. A pair of Vipers will escort — they will keep the fighter cover busy while you work.\n\nYou have bombs and rockets. Use them.`,
    objectives: [
      { type: 'destroyGround', targetType: 'aaa', count: 2, text: 'DESTROY 2 AAA NESTS' },
      { type: 'destroyGround', targetType: 'depot', count: 2, text: 'DESTROY 2 FUEL DEPOTS' }
    ],
    isGroundAttack: true,
    ground: { aaa: 2, depot: 2, radar: 1, hangar: 2, fuelTank: 4, center: { x: 6000, z: 6000 }, spread: 1400 },
    spawns: [
      { role: 'escort', count: 2, faction: BLUE, aircraft: 'viper', skill: 'veteran', patrol: { x: -4000, z: -4000 } }
    ],
    waves: [
      { delay: 30, spawns: [{ role: 'fighter', count: 2, faction: RED, aircraft: 'viper', difficulty: 'veteran', patrol: { x: 9000, z: 9000 } }] }
    ],
    reward: { xp: 950, cash: 0 },
    unlock: 'fullback'
  },
  {
    id: 'm04',
    index: 4,
    name: 'RADAR FENCE',
    short: 'SEAD',
    location: 'TIERRA VALLEY',
    time: 11.0,
    dayLength: 2400,
    weather: 'partly',
    player: { x: 0, y: 6500, z: -9000, speed: 300, altitude: 6500 },
    briefing: `There is a chain of three early-warning radars in Tierra Valley and twice as many SAM batteries sitting on them.\n\nThey will see you the moment you cross the ridge, so go fast and go high. Every radar you kill buys the bombers an hour of life.\n\nExpect fast interceptors from the north. Do not stay in one piece of sky.`,
    objectives: [
      { type: 'destroyGround', targetType: 'radar', count: 3, text: 'DESTROY 3 EARLY WARNING RADARS' },
      { type: 'destroyGround', targetType: 'sam', count: 2, text: 'DESTROY 2 SAM BATTERIES' }
    ],
    isGroundAttack: true,
    ground: { radar: 3, sam: 3, aaa: 2, center: { x: 0, z: 0 }, spread: 4000 },
    spawns: [
      { role: 'fighter', count: 2, faction: RED, aircraft: 'viper', difficulty: 'veteran', patrol: { x: 0, z: 6000 } }
    ],
    waves: [
      { delay: 45, spawns: [{ role: 'fighter', count: 2, faction: RED, aircraft: 'raptor', difficulty: 'ace', patrol: { x: -3000, z: 9000 } }] }
    ],
    reward: { xp: 1200, cash: 0 }
  },
  {
    id: 'm05',
    index: 5,
    name: 'STORM FRONT',
    short: 'WEATHER',
    location: 'THE ANVIL — THUNDERHEADS',
    time: 16.0,
    dayLength: 2200,
    weather: 'storm',
    player: { x: 0, y: 5200, z: -4000, speed: 280, altitude: 5200 },
    briefing: `A convoy is running the Anvil under the weather, using the thunderheads as cover from radar.\n\nThe storm is a monster: expect severe turbulence, sheet rain and lightning. Get under the cloud deck, find the convoy — three transports with fighter escort — and destroy them all.\n\nWatch your fuel. Watch the terrain. That is all.`,
    objectives: [
      { type: 'destroy', targetType: 'transport', count: 3, text: 'DESTROY 3 ENEMY TRANSPORTS' },
      { type: 'destroy', targetType: 'fighter', count: 2, text: 'DESTROY 2 ESCORT FIGHTERS', optional: true }
    ],
    spawns: [
      { role: 'transport', count: 3, faction: RED, aircraft: 'fullback', skill: 'rookie', patrol: { x: 2000, z: 4000 }, speed: 190 },
      { role: 'fighter', count: 2, faction: RED, aircraft: 'viper', difficulty: 'veteran', patrol: { x: 2000, z: 4000 } }
    ],
    reward: { xp: 1450, cash: 0 },
    unlock: 'gryphon'
  },
  {
    id: 'm06',
    index: 6,
    name: 'SUPPRESSION',
    short: 'SEAD II',
    location: 'IRON PASS',
    time: 13.0,
    dayLength: 2200,
    weather: 'overcast',
    player: { x: -8000, y: 4800, z: 6000, speed: 300, altitude: 4800 },
    briefing: `Iron Pass is the only route the armour can take and the enemy has made it a killing zone: four AAA nests, two SAM batteries and a gun radar calling the shots.\n\nSuppress the pass. Kill the gun radar first so the strike package that follows has a chance.\n\nAnti-radar missiles are not available. You will have to do it the hard way.`,
    objectives: [
      { type: 'destroyGround', targetType: 'radar', count: 2, text: 'DESTROY 2 FIRE CONTROL RADARS' },
      { type: 'destroyGround', targetType: 'aaa', count: 4, text: 'DESTROY 4 AAA NESTS' },
      { type: 'destroyGround', targetType: 'sam', count: 2, text: 'DESTROY 2 SAM BATTERIES', optional: true }
    ],
    isGroundAttack: true,
    ground: { aaa: 4, sam: 2, radar: 2, hangar: 2, center: { x: 3000, z: 3000 }, spread: 2600 },
    spawns: [
      { role: 'fighter', count: 3, faction: RED, aircraft: 'viper', difficulty: 'veteran', patrol: { x: 3000, z: -3000 } }
    ],
    reward: { xp: 1600, cash: 0 }
  },
  {
    id: 'm07',
    index: 7,
    name: 'DEEP STRIKE',
    short: 'STRIKE II',
    location: 'KESTREL BOMBER BASE',
    time: 5.5,
    dayLength: 2400,
    weather: 'fog',
    player: { x: -12000, y: 2500, z: 0, speed: 320, altitude: 2500 },
    briefing: `Kestrel is where the heavy bombers stage from. Four hangars, a fuel farm and a command post.\n\nFog and dawn approach. You will have about ninety seconds before the alert fighters are airborne and the flak starts ranging you.\n\nLevel the field. Every hangar destroyed is a bomber raid that never happens.`,
    objectives: [
      { type: 'destroyGround', targetType: 'hangar', count: 4, text: 'DESTROY 4 HANGARS' },
      { type: 'destroyGround', targetType: 'fuelTank', count: 4, text: 'DESTROY THE FUEL FARM', optional: true },
      { type: 'destroyGround', targetType: 'command', count: 1, text: 'DESTROY THE COMMAND POST', optional: true }
    ],
    isGroundAttack: true,
    ground: { hangar: 4, depot: 2, fuelTank: 6, aaa: 3, radar: 1, command: 1, center: { x: 12000, z: 0 }, spread: 1800 },
    spawns: [
      { role: 'fighter', count: 2, faction: RED, aircraft: 'fullback', difficulty: 'ace', patrol: { x: 12000, z: 4000 } }
    ],
    waves: [
      { delay: 55, spawns: [{ role: 'fighter', count: 2, faction: RED, aircraft: 'gryphon', difficulty: 'ace', patrol: { x: 8000, z: -6000 } }] }
    ],
    reward: { xp: 1900, cash: 0 }
  },
  {
    id: 'm08',
    index: 8,
    name: 'FLEET DEFENCE',
    short: 'DEFENCE',
    location: 'OPEN SEA — TASK FORCE 61',
    time: 18.5,
    dayLength: 2000,
    weather: 'rain',
    player: { x: 0, y: 3500, z: 0, speed: 300, altitude: 3500 },
    briefing: `Task Force 61 is running the strait and the enemy knows it. Two strike groups are inbound: fast movers, coming in low and fast with anti-ship missiles.\n\nYou are the combat air patrol. Nothing gets through. If a strike aircraft reaches the task force it will launch before you can reach it.\n\nRadar missiles first, then guns. Watch your fuel — the recovery tanker is three zero minutes away.`,
    objectives: [
      { type: 'protect', text: 'PREVENT 3 STRIKE AIRCRAFT FROM ATTACKING THE FLEET' },
      { type: 'destroy', targetType: 'fighter', count: 5, text: 'DESTROY 5 ATTACK AIRCRAFT' }
    ],
    protectShips: true,
    ships: { count: 3, radius: 3000, center: { x: 0, z: 0 }, team: BLUE },
    spawns: [
      { role: 'strike', count: 2, faction: RED, aircraft: 'fullback', difficulty: 'veteran', patrol: { x: 9000, z: 9000 }, targetFleet: true },
      { role: 'fighter', count: 2, faction: RED, aircraft: 'viper', difficulty: 'ace', patrol: { x: -9000, z: 9000 } }
    ],
    waves: [
      { delay: 60, when: 'half', spawns: [{ role: 'strike', count: 2, faction: RED, aircraft: 'fullback', difficulty: 'ace', patrol: { x: 8000, z: -9000 }, targetFleet: true }] },
      { delay: 120, spawns: [{ role: 'fighter', count: 2, faction: RED, aircraft: 'gryphon', difficulty: 'ace', patrol: { x: -8000, z: -8000 } }] }
    ],
    reward: { xp: 2200, cash: 0 }
  },
  {
    id: 'm09',
    index: 9,
    name: 'CANYON RUN',
    short: 'LOW LEVEL',
    location: 'THE THROAT',
    time: 6.5,
    dayLength: 2400,
    weather: 'hazy',
    player: { x: -6000, y: 1400, z: -2000, speed: 330, altitude: 1400 },
    briefing: `This is the one nobody wants. The Throat is a canyon system running two hundred kilometres through enemy air defence — guns on both walls, missiles on the far end, and no room to manoeuvre.\n\nFly it at two hundred feet. If you pull up, they will see you. If you stay low, the walls will kill you.\n\nAt the far end is the command bunker. Kill it and the invasion stalls.`,
    objectives: [
      { type: 'gate', count: 6, text: 'NAVIGATE THE CANYON GATES', canyon: true },
      { type: 'destroyGround', targetType: 'command', count: 1, text: 'DESTROY THE COMMAND BUNKER' },
      { type: 'destroyGround', targetType: 'aaa', count: 4, text: 'SUPPRESS THE CANYON GUNS', optional: true }
    ],
    isGroundAttack: true,
    gates: { count: 6, radius: 190, spacing: 2400, alt: 340, canyon: true },
    ground: { aaa: 4, sam: 2, radar: 1, command: 1, center: { x: 9000, z: 1400 }, spread: 2400 },
    spawns: [
      { role: 'fighter', count: 2, faction: RED, aircraft: 'viper', difficulty: 'ace', patrol: { x: 9000, z: 1000 } }
    ],
    reward: { xp: 2600, cash: 0 }
  },
  {
    id: 'm10',
    index: 10,
    name: 'AERIAL TEMPEST',
    short: 'FINAL ASSAULT',
    location: 'THE TEMPEST — ENEMY HEARTLAND',
    time: 14.5,
    dayLength: 2400,
    weather: 'storm',
    player: { x: 0, y: 7000, z: -12000, speed: 340, altitude: 7000 },
    briefing: `This is it. The enemy's super-heavy interceptor — call it TEMPEST — is airborne over the heartland and it is coming for our strike package.\n\nIt is faster, heavier and it does not fly alone. Two squadrons of escorts will meet you over the target. Everything we have left goes in with you.\n\nKill TEMPEST and the war ends this afternoon. Come home, Captain.`,
    objectives: [
      { type: 'destroy', targetType: 'boss', count: 1, text: 'DESTROY THE TEMPEST PROTOTYPE' },
      { type: 'destroy', targetType: 'fighter', count: 4, text: 'CLEAR THE ESCORTS', optional: true }
    ],
    boss: { aircraft: 'raptor', name: 'TEMPEST', hp: 4.0, skill: 'leader' },
    spawns: [
      { role: 'fighter', count: 4, faction: RED, aircraft: 'gryphon', difficulty: 'leader', patrol: { x: 4000, z: 6000 } },
      { role: 'boss', count: 1, faction: RED, aircraft: 'raptor', difficulty: 'leader', patrol: { x: 6000, z: 8000 } }
    ],
    waves: [
      { delay: 80, spawns: [{ role: 'fighter', count: 2, faction: RED, aircraft: 'raptor', difficulty: 'leader', patrol: { x: -5000, z: 9000 } }] }
    ],
    reward: { xp: 4000, cash: 0 }
  }
];

export const QUICK_ACTIONS = [
  {
    id: 'freeflight', name: 'FREE FLIGHT', desc: 'No enemies, no timers. Explore, practise, chase the rings.',
    weather: 'partly', time: 16.0, rings: true
  },
  {
    id: 'instant', name: 'INSTANT ACTION', desc: 'Endless waves of bandits. How long can you last?',
    weather: 'clear', time: 12.0
  },
  {
    id: 'aerobatic', name: 'AEROBATIC COURSE', desc: 'Score points flying through the ring course in style.',
    weather: 'clear', time: 17.0, rings: true, scored: true
  }
];

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || MISSIONS[0];
}

export function gradeFor(score, thresholds = [4000, 2600, 1600, 800]) {
  if (score >= thresholds[0]) return 'S';
  if (score >= thresholds[1]) return 'A';
  if (score >= thresholds[2]) return 'B';
  if (score >= thresholds[3]) return 'C';
  return 'D';
}

export const RANKS = [
  { xp: 0, name: '2ND LIEUTENANT', short: '2LT' },
  { xp: 2000, name: '1ST LIEUTENANT', short: '1LT' },
  { xp: 5000, name: 'CAPTAIN', short: 'CPT' },
  { xp: 10000, name: 'MAJOR', short: 'MAJ' },
  { xp: 18000, name: 'LIEUTENANT COLONEL', short: 'LTC' },
  { xp: 30000, name: 'COLONEL', short: 'COL' },
  { xp: 48000, name: 'BRIGADIER', short: 'BG' },
  { xp: 72000, name: 'MAJOR GENERAL', short: 'MG' },
  { xp: 100000, name: 'AIR MARSHAL', short: 'AM' }
];

export function rankFor(xp) {
  let r = RANKS[0];
  for (const rank of RANKS) if (xp >= rank.xp) r = rank;
  return r;
}

export const UNLOCKS = [
  { id: 'fullback', type: 'aircraft', name: 'SU-34 FULLBACK', desc: 'Heavy strike fighter', after: 'm03' },
  { id: 'gryphon', type: 'aircraft', name: 'JAS-39 GRYPHON', desc: 'Agile multirole', after: 'm05' },
  { id: 'mustang', type: 'aircraft', name: 'P-51 MUSTANG', desc: 'Warbird — for the purists', kills: 50 },
  { id: 'aim9x_plus', type: 'weapon', name: 'AIM-9X BLOCK II', desc: '+1 heat seeker per sortie', unlocksAt: 3 },
  { id: 'bombs_heavy', type: 'weapon', name: 'MK-84 2000LB', desc: 'Heavier bombs', unlocksAt: 5 },
  { id: 'decoy_pod', type: 'weapon', name: 'DECOY POD', desc: '+20 flares, +20 chaff', unlocksAt: 7 },
  { id: 'livery_tiger', type: 'livery', name: 'TIGER MEET LIVERY', desc: 'For aces only', kills: 100 },
  { id: 'livery_chrome', type: 'livery', name: 'BARE METAL LIVERY', desc: 'Warbird classic', kills: 150 }
];
