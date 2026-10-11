# GIRITEMPS — procedural sky combat

A 3D aircraft combat and flight game built with Three.js and Vite. Every texture, mesh, sound and piece of music is generated at runtime, so there are no binary assets in the repository.

## Run

```
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm test          # flight model, mission data and profile tests
npm run size      # checks dist/ + source against the 2 GB package limit
```

## Contents

- **World**: 8 × 8 km procedural terrain with biomes (snow, mountain, desert, forest, tropical, valley), chunked LOD, ocean, sky with clouds, stars, day/night and sun, weather presets (clear, overcast, rain, storm, snow), villages, roads and trees.
- **Aircraft**: F-22, F-16, Su-34, Gripen and P-51 (each with liveries) and enemy airframes (Mig, drone, bomber, boss). The flight model covers stall, G-force, inertia and damage.
- **Combat**: guns, IR and radar missiles with lock-on, rockets, bombs, flares and chaff. AI pilots patrol, engage, evade, retreat and fly scripted maneuvers. Ground targets include SAM, AA guns, fuel depots, hangars, radar, bunkers and frigates.
- **Modes**: 10 campaign missions (sequentially unlocked, graded S–F), arcade waves with high scores, and free flight with rings, loops and barrel rolls.
- **Presentation**: HUD, first-person cockpit with a rear-view mirror, chase and flyby cameras, procedural audio with a synthesized music sequencer, and browser text-to-speech radio.
- **Controls**: keyboard, mouse (stick or aim mode) and gamepad, all remappable from the settings screen.
- **Profile**: stored in localStorage. It covers XP and ranks, aircraft and livery unlocks, mission grades and arcade high scores.

## Controls (defaults)

| Action | Key |
| --- | --- |
| Pitch / roll / yaw | W S / A D / Q E (or mouse) |
| Throttle | Shift / Ctrl |
| Afterburner | Z |
| Guns | Left mouse |
| Missile / cycle missile type | F / G |
| Rockets / bomb | R / B |
| Flares / chaff | H / J |
| Cycle target | T |
| Camera view | C |
| Gear / flaps / speed brake | L / K / Space |
| Night vision | N |
| Free look (hold) | Right mouse |
| Pause | Esc |

## Scope notes

- Rivers, cloud shadows on terrain and depth of field are not included.
- The cockpit is simplified (canopy frame, instrument panel, radar scope, stick and throttle).
- Music and radio voice are synthesized, and speech uses the browser's built-in text-to-speech.
