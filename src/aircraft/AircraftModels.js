// ---------------------------------------------------------------------------
// AircraftModels — procedural airframes for the whole fleet.
// Convention: nose +Z, up +Y, right +X.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { loft, wingSurface, controlSurface, nozzleGeometry, wheelGeometry } from './ModelKit.js';
import { makeAircraftMaps, makeCanvas } from '../render/Shading.js';
import { RNG, DEG } from '../core/Utils.js';

const P = (v) => v * DEG;

// ---------------------------------------------------------------------------
// Fleet specification
// ---------------------------------------------------------------------------
export const AIRCRAFT_SPECS = {
  raptor: {
    id: 'raptor', name: 'SF-22 RAPTOR', short: 'RAPTOR', role: 'AIR SUPERIORITY',
    blurb: 'Twin-engine stealth multirole fighter. Superb energy retention, internal weapons bays.',
    unlock: 'default', tier: 1,
    mass: 19700, emptyMass: 15000, wingArea: 78, thrust: 156000 * 2, engineCount: 2,
    clMax: 1.85, cd0: 0.0185, inducedK: 0.075, maxG: 9.5, gLimit: 9, stallAoa: P(26),
    rollRate: 3.6, pitchRate: 1.15, yawRate: 0.55, maxMach: 2.1, ceiling: 19800,
    fuel: 8200, fuelBurn: 0.42, afterburnerBoost: 1.45, liftAuthority: 1.0,
    gearTrack: 4.2, groundClearance: 1.9, length: 18.9, span: 13.6, height: 5.1,
    gun: { name: 'M61A2 VULCAN', rpm: 6000, rounds: 1200, cal: 20, damage: 9, spread: 0.0022, speed: 1050 },
    loadout: { aim9: 2, aim120: 4, rocketPods: 0, bombs: 0, flares: 30, chaff: 30 },
    liveries: [
      { name: 'LANGLEY GREY', base: '#5a6066', camo: ['#4a5056', '#63696f'], insignia: 'star', insigniaColor: '#c8ccd2', metalness: 0.6, rough: 0.42, seed: 11 },
      { name: 'TIGER MEET', base: '#c8a54a', camo: ['#1b1b1b', '#e0c060'], stripe: '#111111', insignia: 'star', insigniaColor: '#111111', metalness: 0.5, rough: 0.4, seed: 12 },
      { name: 'NIGHT RAPTOR', base: '#20242c', camo: ['#171a20', '#2a2f38'], insignia: 'star', insigniaColor: '#6a7180', metalness: 0.7, rough: 0.35, seed: 13 },
      { name: 'DESERT STORM', base: '#b09a72', camo: ['#8c7a58', '#cbbb96'], insignia: 'star', insigniaColor: '#f0e8d8', metalness: 0.45, rough: 0.5, seed: 14 }
    ],
    shape: {
      stations: [
        { z: -9.45, w: 0.55, h: 0.5, cy: 0.05, p: 0.7 },
        { z: -8.2, w: 1.15, h: 0.85, cy: 0.0, p: 0.66 },
        { z: -6.6, w: 1.55, h: 1.0, cy: 0.0, p: 0.62 },
        { z: -4.4, w: 1.85, h: 1.05, cy: 0.0, p: 0.6 },
        { z: -2.0, w: 2.1, h: 1.02, cy: 0.0, p: 0.58 },
        { z: 0.6, w: 2.0, h: 0.95, cy: 0.05, p: 0.6 },
        { z: 3.0, w: 1.7, h: 0.85, cy: 0.02, p: 0.62 },
        { z: 5.2, w: 1.25, h: 0.7, cy: -0.02, p: 0.66 },
        { z: 7.0, w: 0.85, h: 0.52, cy: -0.06, p: 0.7 },
        { z: 8.3, w: 0.42, h: 0.34, cy: -0.08, p: 0.75 },
        { z: 9.05, w: 0.12, h: 0.12, cy: -0.08, p: 0.9 }
      ],
      radial: 18,
      wing: { rootX: 1.5, rootZ: -1.2, rootChord: 6.3, tipX: 6.8, tipZ: -4.3, tipChord: 1.5, thickness: 0.34, dihedral: 0.12, segments: 8 },
      ctrl: { aileronSpan: 2.2, aileronChord: 0.9, flapSpan: 2.6, flapChord: 1.1 },
      tail: 'twinCanted', tailCant: P(26), finRoot: { z: -5.0, h: 2.1, chord: 3.4 }, finTip: { z: -8.4, h: 1.5, chord: 1.5 },
      stab: { rootX: 1.2, rootZ: -6.2, rootChord: 2.9, tipX: 4.2, tipZ: -7.2, tipChord: 1.3, thickness: 0.2 },
      intakes: [{ x: 1.5, y: -0.35, z: 0.4, w: 0.75, h: 0.6, len: 3.4 }],
      nozzles: [{ x: 0.85, y: 0.0, z: -8.0, r1: 0.52, r2: 0.62, len: 1.6 }],
      canopy: { z: 1.4, len: 3.0, w: 0.78, h: 0.62, y: 0.72, bubble: true, frame: true },
      gear: { nose: { z: 5.4, y: -1.0 }, main: [{ x: 1.85, z: -1.4, y: -1.05 }], strut: 1.85, wheel: 0.44 },
      navLights: { wingTip: 6.5, tail: -8.6 },
      weapons: { bayInternal: true, pylons: [] },
      abCones: [{ x: 0.85, z: -9.2, r: 0.5, len: 4.5 }],
      prop: null
    }
  },
  viper: {
    id: 'viper', name: 'F-16C VIPER', short: 'VIPER', role: 'MULTIROLE',
    blurb: 'Single-engine bubble-canopy dogfighter. Excellent turn rate and pitch authority.',
    unlock: 'default', tier: 1,
    mass: 12000, emptyMass: 8600, wingArea: 27.9, thrust: 131000, engineCount: 1,
    clMax: 1.95, cd0: 0.0205, inducedK: 0.082, maxG: 9.0, gLimit: 9, stallAoa: P(25),
    rollRate: 3.7, pitchRate: 1.2, yawRate: 0.5, maxMach: 2.0, ceiling: 15200,
    fuel: 3200, fuelBurn: 0.45, afterburnerBoost: 1.5, liftAuthority: 1.0,
    gearTrack: 2.4, groundClearance: 1.4, length: 15.0, span: 9.96, height: 4.9,
    gun: { name: 'M61A1 VULCAN', rpm: 6000, rounds: 1278, cal: 20, damage: 8, spread: 0.0025, speed: 1030 },
    loadout: { aim9: 2, aim120: 2, rocketPods: 2, bombs: 2, flares: 30, chaff: 30 },
    liveries: [
      { name: 'FALCON GREY', base: '#6a7078', camo: ['#5c626a', '#787e86'], insignia: 'star', insigniaColor: '#d8dce4', metalness: 0.6, rough: 0.42, seed: 21 },
      { name: 'THUNDERBIRDS', base: '#d8dde4', camo: ['#1b3a8c', '#ffffff'], stripe: '#1b3a8c', insignia: 'star', insigniaColor: '#1b3a8c', metalness: 0.65, rough: 0.3, seed: 22 },
      { name: 'AGGRESSOR', base: '#3b4a3a', camo: ['#2b3a2a', '#6a7a52', '#8a8a72'], insignia: 'star', insigniaColor: '#dcdcd0', metalness: 0.5, rough: 0.5, seed: 23 }
    ],
    shape: {
      stations: [
        { z: -7.5, w: 0.42, h: 0.4, cy: 0.02, p: 0.75 },
        { z: -6.4, w: 0.95, h: 0.72, cy: 0.0, p: 0.68 },
        { z: -5.0, w: 1.25, h: 0.86, cy: 0.0, p: 0.62 },
        { z: -3.2, w: 1.4, h: 0.92, cy: 0.0, p: 0.6 },
        { z: -1.0, w: 1.5, h: 0.95, cy: 0.06, p: 0.58 },
        { z: 1.6, w: 1.42, h: 0.9, cy: 0.1, p: 0.6 },
        { z: 3.6, w: 1.05, h: 0.72, cy: 0.0, p: 0.64 },
        { z: 5.4, w: 0.72, h: 0.5, cy: -0.05, p: 0.7 },
        { z: 6.6, w: 0.3, h: 0.28, cy: -0.08, p: 0.8 },
        { z: 7.2, w: 0.08, h: 0.1, cy: -0.08, p: 0.9 }
      ],
      radial: 18,
      wing: { rootX: 1.2, rootZ: 0.4, rootChord: 4.5, tipX: 4.95, tipZ: -1.9, tipChord: 1.35, thickness: 0.3, dihedral: 0.1, segments: 7 },
      ctrl: { aileronSpan: 1.6, aileronChord: 0.62, flapSpan: 2.0, flapChord: 0.78 },
      tail: 'single', finRoot: { z: -5.2, h: 2.4, chord: 3.0 }, finTip: { z: -7.6, h: 1.2, chord: 1.2 },
      stab: { rootX: 0.9, rootZ: -5.2, rootChord: 2.2, tipX: 3.0, tipZ: -6.0, tipChord: 0.95, thickness: 0.18 },
      intakes: [{ x: 0, y: -0.72, z: 0.2, w: 0.66, h: 0.5, len: 3.0, ventral: true }],
      nozzles: [{ x: 0, y: 0, z: -6.3, r1: 0.48, r2: 0.55, len: 1.5 }],
      canopy: { z: 3.0, len: 3.4, w: 0.68, h: 0.62, y: 0.76, bubble: true, frame: true },
      gear: { nose: { z: 4.6, y: -0.85 }, main: [{ x: 1.2, z: -0.9, y: -0.8 }], strut: 1.5, wheel: 0.38 },
      navLights: { wingTip: 4.7, tail: -7.8 },
      weapons: { bayInternal: false, pylons: [{ x: 2.4, z: -0.4 }, { x: 3.4, z: -1.0 }] },
      abCones: [{ x: 0, z: -7.4, r: 0.45, len: 4.0 }],
      prop: null
    }
  },
  fullback: {
    id: 'fullback', name: 'SU-34 FULLBACK', short: 'FULLBACK', role: 'STRIKE / BOMBER',
    blurb: 'Heavy tandem-seat strike aircraft with massive payload and armoured cockpit.',
    unlock: 'mission3', tier: 3,
    mass: 26500, emptyMass: 22000, wingArea: 62, thrust: 127000 * 2, engineCount: 2,
    clMax: 1.7, cd0: 0.024, inducedK: 0.09, maxG: 7.0, gLimit: 7, stallAoa: P(24),
    rollRate: 2.3, pitchRate: 0.85, yawRate: 0.42, maxMach: 1.8, ceiling: 14000,
    fuel: 12000, fuelBurn: 0.55, afterburnerBoost: 1.4, liftAuthority: 0.92,
    gearTrack: 4.5, groundClearance: 2.0, length: 23.3, span: 14.7, height: 6.1,
    gun: { name: 'GSh-30-1', rpm: 1800, rounds: 450, cal: 30, damage: 22, spread: 0.0035, speed: 860 },
    loadout: { aim9: 2, aim120: 2, rocketPods: 2, bombs: 6, flares: 40, chaff: 40 },
    liveries: [
      { name: 'NAVY BLUE', base: '#3c5a72', camo: ['#2e4a60', '#547a92'], insignia: 'star', insigniaColor: '#e0e8f0', metalness: 0.5, rough: 0.5, seed: 31 },
      { name: 'DESERT SAND', base: '#a89a78', camo: ['#8a7c5c', '#c4b896'], insignia: 'star', insigniaColor: '#f4ecd8', metalness: 0.4, rough: 0.55, seed: 32 },
      { name: 'WINTER CAMO', base: '#d8dde0', camo: ['#b8c0c8', '#8a949c'], insignia: 'star', insigniaColor: '#2b3a4a', metalness: 0.45, rough: 0.5, seed: 33 }
    ],
    shape: {
      stations: [
        { z: -11.6, w: 0.6, h: 0.55, cy: 0.05, p: 0.72 },
        { z: -10.0, w: 1.3, h: 0.95, cy: 0.0, p: 0.66 },
        { z: -8.0, w: 1.9, h: 1.25, cy: 0.0, p: 0.6 },
        { z: -5.4, w: 2.3, h: 1.35, cy: 0.0, p: 0.56 },
        { z: -2.4, w: 2.4, h: 1.32, cy: 0.05, p: 0.54 },
        { z: 0.8, w: 2.25, h: 1.3, cy: 0.1, p: 0.56 },
        { z: 3.6, w: 1.9, h: 1.15, cy: 0.05, p: 0.58 },
        { z: 6.2, w: 1.4, h: 0.9, cy: 0.0, p: 0.62 },
        { z: 8.4, w: 0.95, h: 0.62, cy: -0.05, p: 0.68 },
        { z: 10.2, w: 0.45, h: 0.34, cy: -0.1, p: 0.78 },
        { z: 11.1, w: 0.12, h: 0.14, cy: -0.1, p: 0.9 }
      ],
      radial: 18,
      wing: { rootX: 1.8, rootZ: -1.0, rootChord: 7.4, tipX: 7.3, tipZ: -4.6, tipChord: 2.2, thickness: 0.4, dihedral: 0.06, segments: 8 },
      ctrl: { aileronSpan: 2.4, aileronChord: 1.0, flapSpan: 3.0, flapChord: 1.3 },
      tail: 'single', finRoot: { z: -8.0, h: 2.6, chord: 3.6 }, finTip: { z: -11.0, h: 1.4, chord: 1.6 },
      stab: { rootX: 1.4, rootZ: -8.0, rootChord: 3.4, tipX: 5.0, tipZ: -9.0, tipChord: 1.5, thickness: 0.22 },
      canards: { rootX: 1.2, rootZ: 5.6, rootChord: 2.6, tipX: 3.4, tipZ: 5.0, tipChord: 1.0, thickness: 0.16 },
      intakes: [{ x: 1.7, y: -0.5, z: 0.2, w: 0.85, h: 0.7, len: 3.6 }],
      nozzles: [{ x: 0.9, y: 0, z: -10.0, r1: 0.6, r2: 0.7, len: 1.8 }],
      canopy: { z: 3.4, len: 4.2, w: 0.82, h: 0.6, y: 1.0, bubble: false, frame: true, tandem: true },
      gear: { nose: { z: 7.6, y: -1.2 }, main: [{ x: 2.0, z: -1.8, y: -1.2 }], strut: 2.5, wheel: 0.55 },
      navLights: { wingTip: 7.0, tail: -11.4 },
      weapons: { bayInternal: false, pylons: [{ x: 3.0, z: -0.5 }, { x: 4.4, z: -1.4 }, { x: 5.8, z: -2.2 }] },
      abCones: [{ x: 0.9, z: -11.4, r: 0.55, len: 5.0 }],
      prop: null
    }
  },
  gryphon: {
    id: 'gryphon', name: 'JAS-39 GRYPHON', short: 'GRYPHON', role: 'INTERCEPTOR',
    blurb: 'Lightweight delta-canard interceptor. Instant turn rate, superb low-speed handling.',
    unlock: 'mission5', tier: 2,
    mass: 9500, emptyMass: 6800, wingArea: 30, thrust: 82000, engineCount: 1,
    clMax: 2.05, cd0: 0.0195, inducedK: 0.078, maxG: 9.0, gLimit: 9, stallAoa: P(28),
    rollRate: 4.1, pitchRate: 1.3, yawRate: 0.5, maxMach: 1.9, ceiling: 15200,
    fuel: 2400, fuelBurn: 0.40, afterburnerBoost: 1.5, liftAuthority: 1.05,
    gearTrack: 2.2, groundClearance: 1.2, length: 14.1, span: 8.4, height: 4.5,
    gun: { name: 'Mauser BK-27', rpm: 1700, rounds: 300, cal: 27, damage: 17, spread: 0.0028, speed: 1000 },
    loadout: { aim9: 2, aim120: 4, rocketPods: 1, bombs: 2, flares: 25, chaff: 25 },
    liveries: [
      { name: 'GRIPEN GREY', base: '#5c6468', camo: ['#4c545a', '#6e767c'], insignia: 'roundel', insigniaColor: '#e8d8a0', metalness: 0.55, rough: 0.42, seed: 41 },
      { name: 'SPLINTER', base: '#404a3c', camo: ['#2c3428', '#5a6650', '#1e241c'], insignia: 'roundel', insigniaColor: '#e8d8a0', metalness: 0.5, rough: 0.5, seed: 42 },
      { name: 'ARCTIC', base: '#c8d0d4', camo: ['#a8b4bc', '#8c98a0'], insignia: 'roundel', insigniaColor: '#2a4a6a', metalness: 0.5, rough: 0.45, seed: 43 }
    ],
    shape: {
      stations: [
        { z: -7.0, w: 0.4, h: 0.36, cy: 0.04, p: 0.75 },
        { z: -5.8, w: 0.9, h: 0.66, cy: 0.0, p: 0.68 },
        { z: -4.4, w: 1.2, h: 0.8, cy: 0.0, p: 0.62 },
        { z: -2.6, w: 1.32, h: 0.86, cy: 0.04, p: 0.6 },
        { z: -0.4, w: 1.4, h: 0.9, cy: 0.08, p: 0.58 },
        { z: 2.0, w: 1.3, h: 0.84, cy: 0.06, p: 0.6 },
        { z: 3.8, w: 0.98, h: 0.66, cy: -0.02, p: 0.64 },
        { z: 5.4, w: 0.65, h: 0.46, cy: -0.06, p: 0.7 },
        { z: 6.4, w: 0.26, h: 0.24, cy: -0.1, p: 0.8 },
        { z: 6.9, w: 0.07, h: 0.09, cy: -0.1, p: 0.9 }
      ],
      radial: 18,
      wing: { rootX: 1.1, rootZ: 1.2, rootChord: 5.6, tipX: 4.2, tipZ: -3.4, tipChord: 1.1, thickness: 0.26, dihedral: 0.05, segments: 7 },
      ctrl: { aileronSpan: 1.5, aileronChord: 0.62, flapSpan: 2.1, flapChord: 0.85 },
      tail: 'single', finRoot: { z: -4.6, h: 2.1, chord: 2.8 }, finTip: { z: -6.8, h: 1.1, chord: 1.1 },
      stab: { rootX: 0.8, rootZ: -4.8, rootChord: 2.0, tipX: 2.6, tipZ: -5.6, tipChord: 0.85, thickness: 0.16 },
      canards: { rootX: 0.9, rootZ: 3.4, rootChord: 2.2, tipX: 2.6, tipZ: 2.4, tipChord: 0.8, thickness: 0.14 },
      intakes: [{ x: 0.9, y: -0.42, z: -0.4, w: 0.6, h: 0.5, len: 3.0 }],
      nozzles: [{ x: 0, y: 0, z: -5.9, r1: 0.42, r2: 0.5, len: 1.4 }],
      canopy: { z: 2.6, len: 3.2, w: 0.64, h: 0.58, y: 0.68, bubble: true, frame: true },
      gear: { nose: { z: 4.2, y: -0.8 }, main: [{ x: 1.15, z: -0.6, y: -0.72 }], strut: 1.4, wheel: 0.34 },
      navLights: { wingTip: 4.0, tail: -7.0 },
      weapons: { bayInternal: false, pylons: [{ x: 2.0, z: 0.0 }, { x: 3.0, z: -0.8 }] },
      abCones: [{ x: 0, z: -6.9, r: 0.4, len: 3.6 }],
      prop: null
    }
  },
  mustang: {
    id: 'mustang', name: 'P-51D MUSTANG', short: 'MUSTANG', role: 'CLASSIC WARBIRD',
    blurb: 'Legendary propeller-driven escort fighter. Cinematic, energy-fighting classic mode.',
    unlock: 'kills50', tier: 1,
    mass: 4800, emptyMass: 3460, wingArea: 21.8, thrust: 21000, engineCount: 1,
    clMax: 1.62, cd0: 0.026, inducedK: 0.072, maxG: 8.0, gLimit: 8, stallAoa: P(22),
    rollRate: 2.9, pitchRate: 0.95, yawRate: 0.6, maxMach: 0.78, ceiling: 12700,
    fuel: 1040, fuelBurn: 0.62, afterburnerBoost: 1.08, liftAuthority: 0.88,
    gearTrack: 3.6, groundClearance: 1.1, length: 9.83, span: 11.28, height: 4.16,
    gun: { name: 'M2 BROWNING x6', rpm: 4500, rounds: 4700, cal: 12.7, damage: 6, spread: 0.003, speed: 890 },
    loadout: { aim9: 0, aim120: 0, rocketPods: 2, bombs: 2, flares: 10, chaff: 10 },
    liveries: [
      { name: 'OLIVE DRAB', base: '#5c6448', camo: ['#4a5238', '#6e7658'], insignia: 'star', insigniaColor: '#dcdcd0', metalness: 0.35, rough: 0.6, seed: 51 },
      { name: 'BARE METAL', base: '#c0c4c8', camo: ['#a8acb2', '#d8dce0'], stripe: '#c02020', insignia: 'star', insigniaColor: '#202020', metalness: 0.85, rough: 0.25, seed: 52 },
      { name: 'RED TAILS', base: '#b8bcc0', camo: ['#a0a4a8'], stripe: '#c02020', insignia: 'star', insigniaColor: '#202020', metalness: 0.8, rough: 0.3, seed: 53 },
      { name: 'RAF CAMO', base: '#4a5a44', camo: ['#3a4a36', '#6a6a58'], insignia: 'roundel', insigniaColor: '#e0e0e0', metalness: 0.35, rough: 0.6, seed: 54 }
    ],
    shape: {
      stations: [
        { z: -4.9, w: 0.3, h: 0.3, cy: 0.1, p: 0.8 },
        { z: -4.0, w: 0.62, h: 0.52, cy: 0.05, p: 0.72 },
        { z: -2.8, w: 0.78, h: 0.62, cy: 0.0, p: 0.66 },
        { z: -1.2, w: 0.82, h: 0.66, cy: 0.0, p: 0.64 },
        { z: 0.6, w: 0.78, h: 0.62, cy: 0.05, p: 0.66 },
        { z: 2.2, w: 0.66, h: 0.55, cy: 0.02, p: 0.7 },
        { z: 3.4, w: 0.55, h: 0.5, cy: 0.0, p: 0.72 },
        { z: 4.4, w: 0.42, h: 0.42, cy: 0.0, p: 0.78 },
        { z: 4.9, w: 0.1, h: 0.12, cy: 0.0, p: 0.9 }
      ],
      radial: 16,
      wing: { rootX: 0.7, rootZ: 0.2, rootChord: 3.4, tipX: 5.64, tipZ: -0.85, tipChord: 1.1, thickness: 0.26, dihedral: 0.08, segments: 8 },
      ctrl: { aileronSpan: 1.6, aileronChord: 0.5, flapSpan: 1.9, flapChord: 0.62 },
      tail: 'single', finRoot: { z: -3.6, h: 2.0, chord: 2.2 }, finTip: { z: -4.9, h: 0.9, chord: 1.0 },
      stab: { rootX: 0.5, rootZ: -4.0, rootChord: 1.7, tipX: 2.6, tipZ: -4.5, tipChord: 0.75, thickness: 0.14 },
      intakes: [],
      nozzles: [],
      radiator: { z: -1.0, y: -0.62, w: 0.7, h: 0.45, len: 1.6 },
      canopy: { z: 1.6, len: 2.6, w: 0.6, h: 0.62, y: 0.66, bubble: true, frame: true },
      gear: { nose: { z: 3.4, y: -0.75 }, main: [{ x: 0.95, z: 0.4, y: -0.72 }], strut: 1.35, wheel: 0.36 },
      navLights: { wingTip: 5.4, tail: -5.0 },
      weapons: { bayInternal: false, pylons: [{ x: 2.2, z: 0.0 }, { x: 3.4, z: -0.3 }] },
      abCones: [],
      prop: { z: 5.15, blades: 4, radius: 1.72, color: 0x222226 }
    }
  }
};

export const FLEET_ORDER = ['viper', 'raptor', 'gryphon', 'fullback', 'mustang'];

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------
const NAV_RED = 0xff2020, NAV_GREEN = 0x20ff40, NAV_WHITE = 0xffffff;

export function buildAircraftModel(spec, opts = {}) {
  const S = spec.shape;
  const group = new THREE.Group();
  group.name = spec.id;
  const parts = {
    ailerons: [], elevators: [], rudders: [], flaps: [], canards: [],
    gears: [], gearDoors: [], nozzles: [], abCones: [], navLights: [], fans: [],
    props: [], damageParts: []
  };
  const maps = opts.maps !== undefined ? opts.maps : makeAircraftMaps(opts.livery || spec.liveries[0], opts.textureSize || 512);
  const airframeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: opts.livery && opts.livery.rough !== undefined ? opts.livery.rough : 0.45,
    metalness: opts.livery && opts.livery.metalness !== undefined ? opts.livery.metalness : 0.55,
    map: maps ? maps.map : null,
    roughnessMap: maps ? maps.roughnessMap : null,
    normalMap: maps ? maps.normalMap : null,
    envMapIntensity: 1.1
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.65, metalness: 0.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x89a6c0, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.42,
    transmission: 0.9, thickness: 0.4, ior: 1.46, side: THREE.DoubleSide, envMapIntensity: 1.6
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, metalness: 0.0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.9 });
  const emissiveMat = (color, intensity = 2) => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.1
  });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x50555c, roughness: 0.45, metalness: 0.95, side: THREE.DoubleSide });

  // ---- fuselage
  const fus = loft(S.stations, S.radial || 16, {});
  const fusMesh = new THREE.Mesh(fus, airframeMat);
  fusMesh.name = 'fuselage';
  group.add(fusMesh);

  // ---- canopy + cockpit opening
  const can = S.canopy;
  const bubble = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI, 0, Math.PI / 2);
  bubble.scale(can.w, can.h, can.len * 0.62);
  bubble.rotateX(-Math.PI / 2);
  bubble.rotateY(Math.PI / 2);
  bubble.scale(1, 1, 1);
  const canMesh = new THREE.Mesh(bubble, glassMat);
  canMesh.position.set(0, can.y - 0.06, can.z);
  canMesh.scale.set(1, 1.0, 1.0);
  canMesh.name = 'canopy';
  group.add(canMesh);
  if (can.frame) {
    const frameGeo = new THREE.TorusGeometry(can.w * 0.98, 0.045, 4, 14, Math.PI);
    const frame = new THREE.Mesh(frameGeo, darkMat);
    frame.rotation.y = Math.PI / 2;
    frame.rotation.z = Math.PI / 2;
    frame.position.set(0, can.y - 0.06, can.z + can.len * 0.28);
    group.add(frame);
    const frame2 = frame.clone();
    frame2.position.z = can.z - can.len * 0.28;
    frame2.scale.set(0.9, 0.9, 0.9);
    group.add(frame2);
  }
  if (can.tandem) {
    const c2 = canMesh.clone();
    c2.scale.multiplyScalar(0.92);
    c2.position.z -= 1.6;
    c2.position.y -= 0.08;
    group.add(c2);
  }

  // ---- wings
  const w = S.wing;
  const wingGeo = wingSurface({
    rootX: w.rootX, rootZ: w.rootZ, rootChord: w.rootChord,
    tipX: w.tipX, tipZ: w.tipZ, tipChord: w.tipChord,
    thickness: w.thickness, dihedral: w.dihedral, segments: w.segments, camber: 0.02
  });
  const wingR = new THREE.Mesh(wingGeo, airframeMat);
  wingR.name = 'wingR';
  group.add(wingR);
  const wingL = new THREE.Mesh(wingGeo.clone(), airframeMat);
  wingL.scale.x = -1;
  wingL.name = 'wingL';
  group.add(wingL);

  // ---- control surfaces (ailerons + flaps) on the trailing edge
  const ctrl = S.ctrl;
  const mkSurface = (len, chord, thick, taper) => new THREE.Mesh(controlSurface(len, chord, thick, taper), airframeMat);
  for (const side of [1, -1]) {
    const ail = mkSurface(ctrl.aileronSpan, ctrl.aileronChord, w.thickness * 0.5, 0.8);
    const ax = (w.rootX + w.tipX) / 2 + (ctrl.aileronSpan * 0.5) * side * 0;
    // place aileron outboard on the trailing edge
    const tA = 0.72;
    const spanPos = w.rootX + (w.tipX - w.rootX) * tA;
    const chordPos = w.rootZ + (w.tipZ - w.rootZ) * tA + (w.rootChord + (w.tipChord - w.rootChord) * tA) * 0.62;
    ail.position.set(spanPos, 0.02 + w.dihedral * tA, chordPos);
    ail.rotation.y = side > 0 ? 0 : Math.PI;
    ail.rotation.z = 0;
    ail.userData.hinge = new THREE.Vector3(chordPos, 0, 0);
    parts.ailerons.push(ail);
    group.add(ail);

    const flap = mkSurface(ctrl.flapSpan, ctrl.flapChord, w.thickness * 0.55, 0.85);
    const tF = 0.34;
    const fSpan = w.rootX + (w.tipX - w.rootX) * tF;
    const fChord = w.rootZ + (w.tipZ - w.rootZ) * tF + (w.rootChord + (w.tipChord - w.rootChord) * tF) * 0.6;
    flap.position.set(fSpan, 0.0 + w.dihedral * tF, fChord);
    flap.rotation.y = side > 0 ? 0 : Math.PI;
    parts.flaps.push(flap);
    group.add(flap);
  }

  // ---- horizontal stabilisers + elevators
  if (S.stab) {
    const st = S.stab;
    const stabGeo = wingSurface({
      rootX: st.rootX, rootZ: st.rootZ, rootChord: st.rootChord,
      tipX: st.tipX, tipZ: st.tipZ, tipChord: st.tipChord,
      thickness: st.thickness, dihedral: 0, segments: 4
    });
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(stabGeo, airframeMat);
      m.scale.x = side;
      group.add(m);
      const el = new THREE.Mesh(controlSurface((st.tipX - st.rootX) * 0.85, st.rootChord * 0.28, st.thickness * 0.6, 0.8), airframeMat);
      el.position.set(st.rootX + (st.tipX - st.rootX) * 0.1, 0, st.rootZ + st.rootChord * 0.66);
      el.rotation.y = side > 0 ? 0 : Math.PI;
      parts.elevators.push(el);
      group.add(el);
    }
  }

  // ---- canards
  if (S.canards) {
    const cn = S.canards;
    const cGeo = wingSurface({
      rootX: cn.rootX, rootZ: cn.rootZ, rootChord: cn.rootChord,
      tipX: cn.tipX, tipZ: cn.tipZ, tipChord: cn.tipChord,
      thickness: cn.thickness, dihedral: 0.05, segments: 4
    });
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(cGeo, airframeMat);
      m.scale.x = side;
      group.add(m);
      parts.canards.push(m);
    }
  }

  // ---- vertical stabiliser(s) + rudder(s)
  const finR = S.finRoot, finT = S.finTip;
  const finGeo = (() => {
    const g = new THREE.BufferGeometry();
    const pos = [];
    const push = (x, y, z) => pos.push(x, y, z);
    // flat plate profile in the YZ plane with thickness in X
    const th = 0.08;
    const pts = [
      [finR.z, 0.0], [finR.z - finR.chord * 0.8, finR.h * 0.55],
      [finT.z, finT.h + finR.h], [finT.z + finT.chord * 0.6, finR.h * 0.5], [finR.z + finR.chord * 0.2, 0]
    ];
    const idx = [];
    let vi = 0;
    for (const x of [th, -th]) {
      for (const [z, y] of pts) { push(x, y, z); }
    }
    const n = pts.length;
    for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);
    for (let i = 1; i < n - 1; i++) idx.push(n, n + i + 1, n + i);
    for (let i = 0; i < n; i++) {
      const a = i, b = (i + 1) % n;
      idx.push(a, n + a, b, b, n + a, n + b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  })();

  const finInstances = [];
  if (S.tail === 'twinCanted') {
    for (const side of [1, -1]) {
      const fin = new THREE.Mesh(finGeo, airframeMat);
      fin.position.set(side * 0.62, 0.55, 0);
      fin.rotation.z = -side * S.tailCant;
      fin.scale.x = side;
      group.add(fin);
      finInstances.push({ mesh: fin, side });
    }
  } else {
    const fin = new THREE.Mesh(finGeo, airframeMat);
    fin.position.set(0, 0.5, 0);
    group.add(fin);
    finInstances.push({ mesh: fin, side: 1 });
    const fin2 = fin.clone();
    fin2.position.y = -0.05;
    fin2.scale.x = -1;
    group.add(fin2);
  }
  // rudders
  for (const { mesh, side } of finInstances) {
    const rud = new THREE.Mesh(controlSurface(finR.h * 0.9, finT.chord * 0.9, 0.09, 0.8), airframeMat);
    rud.rotation.set(-Math.PI / 2, 0, 0);
    rud.position.set(0.02 * side, 0, finR.z - 0.05);
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.55, 0.6, finR.z - finR.chord * 0.25);
    pivot.rotation.z = -side * (S.tailCant || 0);
    rud.position.set(0, 0, 0);
    rud.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
    pivot.add(rud);
    parts.rudders.push(pivot);
    group.add(pivot);
  }

  // ---- intakes (+ spinning turbine faces)
  for (const intake of S.intakes || []) {
    const w2 = intake.w, h2 = intake.h, len = intake.len;
    const tube = new THREE.BoxGeometry(w2 * 1.15, h2 * 1.2, len);
    const tm = new THREE.Mesh(tube, darkMat);
    tm.position.set(intake.x, intake.y, intake.z);
    group.add(tm);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w2 * 1.35, h2 * 1.4, 0.18), metalMat);
    lip.position.set(intake.x, intake.y, intake.z + len * 0.5);
    group.add(lip);
    // fan disc
    const fan = new THREE.Mesh(new THREE.CircleGeometry(Math.min(w2, h2) * 0.85, 12), new THREE.MeshStandardMaterial({
      color: 0x6a7078, roughness: 0.4, metalness: 0.9, side: THREE.DoubleSide
    }));
    fan.position.set(intake.x, intake.y, intake.z + len * 0.42);
    fan.rotation.y = 0;
    group.add(fan);
    parts.fans.push(fan);
  }

  // ---- nozzles + afterburner cones
  for (const nz of S.nozzles || []) {
    const g = nozzleGeometry(nz.r1, nz.r2, nz.len, 14);
    const m = new THREE.Mesh(g, nozzleMat);
    m.position.set(nz.x, nz.y, nz.z);
    group.add(m);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(nz.r1 * 0.9, nz.r1 * 0.95, nz.len * 0.8, 12, 1, true), new THREE.MeshStandardMaterial({
      color: 0x120c08, emissive: 0x2a0d00, emissiveIntensity: 1.0, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide
    }));
    inner.rotation.x = Math.PI / 2;
    inner.position.set(nz.x, nz.y, nz.z - 0.3);
    group.add(inner);
    parts.nozzles.push(m);
  }
  for (const ab of S.abCones || []) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(ab.r, ab.len, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(ab.x, ab.y, ab.z - ab.len * 0.5);
    cone.renderOrder = 4;
    group.add(cone);
    parts.abCones.push(cone);
    const core = new THREE.Mesh(
      new THREE.ConeGeometry(ab.r * 0.45, ab.len * 0.7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    core.rotation.x = -Math.PI / 2;
    core.position.set(ab.x, ab.y, ab.z - ab.len * 0.35);
    core.renderOrder = 4;
    group.add(core);
    parts.abCones.push(core);
  }

  // ---- propeller (warbird)
  if (S.prop) {
    const propGroup = new THREE.Group();
    propGroup.position.set(0, S.stations[S.stations.length - 2].cy || 0, S.prop.z);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 10), metalMat);
    hub.rotation.x = Math.PI / 2;
    propGroup.add(hub);
    for (let i = 0; i < S.prop.blades; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, S.prop.radius * 2, 0.05), new THREE.MeshStandardMaterial({
        color: S.prop.color, roughness: 0.5, metalness: 0.6
      }));
      blade.rotation.z = (i / S.prop.blades) * Math.PI * 2;
      blade.rotation.y = 0.35;
      propGroup.add(blade);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(S.prop.radius, 24), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    propGroup.add(disc);
    parts.propDisc = disc;
    group.add(propGroup);
    parts.props.push(propGroup);
  }

  // ---- radar/radiator scoops
  if (S.radiator) {
    const r = S.radiator;
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.len), airframeMat);
    scoop.position.set(0, r.y, r.z);
    group.add(scoop);
    const grid = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.9, r.h * 0.7, 0.06), darkMat);
    grid.position.set(0, r.y, r.z + r.len * 0.5);
    group.add(grid);
  }

  // ---- pylons + stores (visible when armed)
  const pylons = [];
  for (const py of (S.weapons.pylons || [])) {
    for (const side of [1, -1]) {
      const pm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.36, 1.1), airframeMat);
      pm.position.set(py.x * side, -0.34, py.z);
      group.add(pm);
      pylons.push(pm);
    }
  }
  parts.pylons = pylons;

  // ---- landing gear
  const gear = S.gear;
  const buildGear = (x, z, y, isNose) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, gear.strut, 7), metalMat);
    strut.position.y = -gear.strut / 2;
    g.add(strut);
    const wheel = new THREE.Mesh(wheelGeometry(gear.wheel, 0.24), tireMat);
    wheel.position.y = -gear.strut + 0.02;
    if (isNose) wheel.position.z = 0;
    g.add(wheel);
    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(gear.wheel * 0.45, gear.wheel * 0.45, 0.3, 8), metalMat);
    hubCap.rotation.z = Math.PI / 2;
    hubCap.position.y = -gear.strut + 0.02;
    g.add(hubCap);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, gear.strut * 0.9, 0.06), airframeMat);
    door.position.set(0.32, -gear.strut * 0.5, 0);
    g.add(door);
    door.rotation.z = 0.1;
    parts.gearDoors.push(door);
    return g;
  };
  const ng = buildGear(0, gear.nose.z, gear.nose.y, true);
  group.add(ng);
  parts.gears.push(ng);
  for (const m of gear.main) {
    for (const side of [1, -1]) {
      const mg = buildGear(m.x * side, m.z, m.y, false);
      group.add(mg);
      parts.gears.push(mg);
    }
  }

  // ---- navigation + formation lights
  const mkLight = (x, y, z, color, size = 0.12, intensity = 3) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), emissiveMat(color, intensity));
    m.position.set(x, y, z);
    m.userData.blink = color === NAV_WHITE;
    group.add(m);
    parts.navLights.push(m);
    return m;
  };
  const nl = S.navLights;
  // port (+X) is red, starboard (-X) is green
  mkLight(nl.wingTip, 0.05, S.wing.tipZ, NAV_RED, 0.11);
  mkLight(-nl.wingTip, 0.05, S.wing.tipZ, NAV_GREEN, 0.11);
  mkLight(0, 0.6, nl.tail - 0.4, NAV_WHITE, 0.1, 2);
  mkLight(0, 0.55, nl.tail + 0.1, NAV_WHITE, 0.1, 2);
  // formation strip lights along the fuselage sides
  for (const side of [1, -1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.6), emissiveMat(0x66ffcc, 1.2));
    strip.position.set(side * 1.0, 0.15, -1.5);
    strip.visible = false;
    strip.userData.formation = true;
    group.add(strip);
    parts.navLights.push(strip);
  }

  // ---- landing light (chin)
  const landLight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.1), emissiveMat(0xfff3d0, 0.2));
  landLight.position.set(0, -0.5, gear.nose.z + 0.5);
  group.add(landLight);
  parts.landingLight = landLight;

  // ---- store the materials for damage tinting
  parts.materials = { airframeMat, darkMat, glassMat, metalMat, tireMat, nozzleMat };
  // ---- polygon count
  let tris = 0;
  group.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.index) tris += o.geometry.index.count / 3;
    else if (o.isMesh && o.geometry) tris += o.geometry.attributes.position.count / 3;
  });
  parts.triangles = Math.round(tris);
  parts.group = group;
  parts.maps = maps;
  return parts;
}

/** Simple low-poly pilot figure (used in the cockpit view). */
export function buildPilot() {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.85, metalness: 0.05 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a882, roughness: 0.7, metalness: 0.0 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.4, metalness: 0.3 });
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), helmetMat);
  helmet.position.set(0, 0.42, 0.02);
  helmet.scale.set(1, 1.05, 1.1);
  g.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8, -0.6, 1.2, 0.4, 0.9), new THREE.MeshStandardMaterial({
    color: 0x101418, roughness: 0.1, metalness: 0.6, emissive: 0x1a3a20, emissiveIntensity: 0.6
  }));
  visor.position.copy(helmet.position);
  visor.scale.set(1.01, 1.06, 1.11);
  g.add(visor);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), suit);
  torso.position.set(0, 0.02, -0.06);
  g.add(torso);
  for (const side of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.34, 3, 6), suit);
    arm.position.set(side * 0.24, 0.06, 0.12);
    arm.rotation.set(-0.9, 0, side * 0.25);
    g.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), skin);
    hand.position.set(side * 0.3, -0.1, 0.34);
    g.add(hand);
  }
  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.32, 3, 6), suit);
    leg.position.set(side * 0.12, -0.32, 0.16);
    leg.rotation.x = 1.2;
    g.add(leg);
  }
  return { group: g, suit, skin, helmetMat };
}

export function specLoadoutSummary(spec) {
  const l = spec.loadout;
  return [
    `${spec.gun.name} ×${spec.gun.rounds}`,
    l.aim9 ? `AIM-9 ×${l.aim9}` : null,
    l.aim120 ? `AIM-120 ×${l.aim120}` : null,
    l.rocketPods ? `ROCKETS ×${l.rocketPods * 7}` : null,
    l.bombs ? `BOMBS ×${l.bombs}` : null,
    `FLARES ×${l.flares}`
  ].filter(Boolean);
}
