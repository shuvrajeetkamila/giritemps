// Flyable aircraft and enemy airframe constants (SI units: kg, m, N, W, rad/s).
// Values are tuned for an arcade-leaning but aerodynamically consistent model.

export const GRAVITY = 9.81;

export const AIRCRAFT = {
  f22: {
    id: 'f22', name: 'F-22 Raptor-class', short: 'F-22', role: 'Multirole stealth air superiority',
    model: 'f22', unlock: { missions: 5 },
    mass: 22000, wingArea: 78, clAlpha: 5.0, clMax: 1.45, alphaStall: 0.29, cd0: 0.018, k: 0.055,
    dryThrust: 160000, abThrust: 190000, propPower: 0, maxSpeed: 700,
    pitchRate: 1.1, rollRate: 3.3, yawRate: 0.6, rateLag: 0.18, hp: 120, gMax: 9,
    fuel: 100, ammo: 480, flares: 60, chaff: 30, missiles: { ir: 4, radar: 4 }, rockets: 0, bombs: 0,
    liveries: [
      { id: 'gray', name: 'Stealth Gray', body: 0x3b4149, accent: 0x9ec9ff, unlockKills: 0 },
      { id: 'tiger', name: 'Tiger Meet', body: 0x2a3a2d, accent: 0xff7b1c, unlockKills: 40 },
      { id: 'black', name: 'Black Ops', body: 0x101216, accent: 0x6fe3ff, unlockKills: 120 },
    ],
  },
  f16: {
    id: 'f16', name: 'F-16 Fighting Falcon-class', short: 'F-16', role: 'Dogfighter & strike',
    model: 'f16', unlock: null,
    mass: 12000, wingArea: 27.9, clAlpha: 5.1, clMax: 1.4, alphaStall: 0.28, cd0: 0.02, k: 0.06,
    dryThrust: 76000, abThrust: 130000, propPower: 0, maxSpeed: 600,
    pitchRate: 1.2, rollRate: 3.6, yawRate: 0.5, rateLag: 0.16, hp: 100, gMax: 9,
    fuel: 100, ammo: 511, flares: 60, chaff: 30, missiles: { ir: 6, radar: 2 }, rockets: 18, bombs: 2,
    liveries: [
      { id: 'air', name: 'Air Force Gray', body: 0x6e7a83, accent: 0xffffff, unlockKills: 0 },
      { id: 'desert', name: 'Desert Storm', body: 0xb9a57a, accent: 0x5b4a2e, unlockKills: 25 },
      { id: 'aggressor', name: 'Aggressor', body: 0x2a2a2a, accent: 0xe03b3b, unlockKills: 90 },
    ],
  },
  su34: {
    id: 'su34', name: 'Su-34 Fullback-class', short: 'SU-34', role: 'Heavy strike bomber',
    model: 'su34', unlock: { missions: 3 },
    mass: 36000, wingArea: 60, clAlpha: 4.6, clMax: 1.25, alphaStall: 0.27, cd0: 0.028, k: 0.07,
    dryThrust: 150000, abThrust: 250000, propPower: 0, maxSpeed: 520,
    pitchRate: 0.7, rollRate: 2.0, yawRate: 0.4, rateLag: 0.35, hp: 180, gMax: 6,
    fuel: 100, ammo: 300, flares: 60, chaff: 40, missiles: { ir: 2, radar: 0 }, rockets: 24, bombs: 6,
    liveries: [
      { id: 'green', name: 'Russian Green', body: 0x4d5a3a, accent: 0xd8d8d8, unlockKills: 0 },
      { id: 'sand', name: 'Sand Desert', body: 0xc8b48a, accent: 0x6b5a3d, unlockKills: 30 },
      { id: 'snow', name: 'Arctic White', body: 0xe6ebef, accent: 0x2d6fb0, unlockKills: 80 },
    ],
  },
  gripen: {
    id: 'gripen', name: 'Gripen-class', short: 'GRIPEN', role: 'Light agile interceptor (canard delta)',
    model: 'gripen', unlock: null,
    mass: 9000, wingArea: 30, clAlpha: 5.3, clMax: 1.5, alphaStall: 0.30, cd0: 0.017, k: 0.05,
    dryThrust: 54000, abThrust: 80000, propPower: 0, maxSpeed: 560,
    pitchRate: 1.4, rollRate: 3.9, yawRate: 0.6, rateLag: 0.14, hp: 90, gMax: 9,
    fuel: 100, ammo: 120, flares: 60, chaff: 30, missiles: { ir: 4, radar: 2 }, rockets: 0, bombs: 2,
    liveries: [
      { id: 'swe', name: 'Swedish Grey', body: 0x7b8790, accent: 0x2a5ca8, unlockKills: 0 },
      { id: 'hungary', name: 'Red & White', body: 0xdedede, accent: 0xc62828, unlockKills: 20 },
      { id: 'lightning', name: 'Storm Blue', body: 0x2c3e5c, accent: 0xf2c94c, unlockKills: 70 },
    ],
  },
  p51: {
    id: 'p51', name: 'P-51 Warbird-class', short: 'P-51', role: 'Classic piston warbird (bonus mode)',
    model: 'p51', unlock: { grades: 'S', count: 2 },
    mass: 4900, wingArea: 21.6, clAlpha: 4.9, clMax: 1.3, alphaStall: 0.26, cd0: 0.03, k: 0.05,
    dryThrust: 9000, abThrust: 9000, propPower: 1100000, maxSpeed: 200,
    pitchRate: 0.9, rollRate: 2.2, yawRate: 0.5, rateLag: 0.3, hp: 80, gMax: 6,
    fuel: 100, ammo: 1200, flares: 0, chaff: 0, missiles: { ir: 0, radar: 0 }, rockets: 0, bombs: 0,
    liveries: [
      { id: 'nmf', name: 'Pearl Harbor Racer', body: 0x6f8f5a, accent: 0xd1393d, unlockKills: 0 },
      { id: 'bare', name: 'Bare Metal', body: 0xc8c8c4, accent: 0x2f5ea8, unlockKills: 15 },
      { id: 'checker', name: 'Checkerboard', body: 0x3b5a8a, accent: 0xf1f1f1, unlockKills: 60 },
    ],
  },
};

export const ENEMY_TYPES = {
  // Enemy fighter used by all AI pilots; the airframe type affects appearance.
  mig: {
    id: 'mig', name: 'Mig-class fighter', model: 'mig', color: 0x5a5f66,
    mass: 15000, wingArea: 40, clAlpha: 5.0, clMax: 1.35, alphaStall: 0.28, cd0: 0.02, k: 0.06,
    dryThrust: 110000, abThrust: 170000, propPower: 0, pitchRate: 1.2, rollRate: 3.2, yawRate: 0.5,
    rateLag: 0.16, hp: 100, gMax: 9, cruise: 230,
  },
  drone: {
    id: 'drone', name: 'Target drone', model: 'drone', color: 0xbbbbbb,
    mass: 2000, wingArea: 8, clAlpha: 4.5, clMax: 1.2, alphaStall: 0.27, cd0: 0.03, k: 0.06,
    dryThrust: 12000, abThrust: 12000, propPower: 0, pitchRate: 0.8, rollRate: 1.6, yawRate: 0.4,
    rateLag: 0.3, hp: 30, gMax: 5, cruise: 170,
  },
  bomber: {
    id: 'bomber', name: 'Bomber', model: 'bomber', color: 0x4a4f45,
    mass: 40000, wingArea: 120, clAlpha: 4.4, clMax: 1.2, alphaStall: 0.27, cd0: 0.03, k: 0.07,
    dryThrust: 180000, abThrust: 180000, propPower: 0, pitchRate: 0.4, rollRate: 0.9, yawRate: 0.3,
    rateLag: 0.5, hp: 220, gMax: 3, cruise: 210,
  },
  boss: {
    id: 'boss', name: 'Experimental super-aircraft "Voron"', model: 'boss', color: 0x1f1f2a,
    mass: 26000, wingArea: 90, clAlpha: 5.4, clMax: 1.5, alphaStall: 0.3, cd0: 0.016, k: 0.05,
    dryThrust: 260000, abThrust: 380000, propPower: 0, pitchRate: 1.5, rollRate: 4.0, yawRate: 0.9,
    rateLag: 0.12, hp: 1400, gMax: 9, cruise: 300,
  },
};

// Compute speed (m/s) at which the wing reaches CLmax at sea level in level flight.
export function stallSpeed(spec, weight = spec.mass, rho = 1.225) {
  return Math.sqrt((2 * weight * GRAVITY) / (rho * spec.wingArea * spec.clMax));
}
