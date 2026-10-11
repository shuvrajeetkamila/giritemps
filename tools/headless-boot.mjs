// Boot the entire app against a fake WebGL2 context and run frames.
import { bootApp } from './harness.mjs';

const FRAMES = Number(process.argv[2] || 60);
const { app, step, errors } = await bootApp();
console.log(`booted: scene children = ${app.scene.children.length}, frameCount = ${app.frameCount}`);

const script = [
  [20, () => { app.game.startQuick('freeflight'); console.log('  free flight'); }],
  [45, () => { app.game.startMission('m02'); console.log('  mission m02'); }],
  [70, () => { app.game.startQuick('instant'); console.log('  instant action'); }],
  [100, () => { app.env.setWeather('storm', true); app.env.configure({ timeOfDay: 21.5 }); console.log('  night+storm'); }],
  [130, () => { app.env.configure({ timeOfDay: 6.1 }); app.env.setWeather('snow', true); console.log('  dawn+snow'); }],
  [160, () => { app.game.pause(true); console.log('  paused'); }],
  [175, () => { app.game.pause(false); console.log('  resumed'); }],
  [200, () => { app.game.quitToMenu(); console.log('  quit to menu'); }],
  [220, () => { app.ui.showSettings('controls'); console.log('  settings screen'); }],
  [235, () => { app.ui.showMain(); console.log('  main menu'); }],
];
let si = 0;
for (let i = 0; i < FRAMES; i++) {
  while (si < script.length && script[si][0] === i) { try { script[si][1](); } catch (e) { errors.push(e); } si++; }
  await step();
}
console.log(`ran ${FRAMES} frames; scene children = ${app.scene.children.length}`);
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors.slice(0, 12)) {
    console.log(' ✗', (e && e.message) || e);
    if (e && e.stack) console.log(e.stack.split('\n').slice(1, 5).map((l) => '    ' + l.trim()).join('\n'));
  }
  process.exit(1);
}
console.log('\nBOOT + FRAMES OK');
process.exit(0);
