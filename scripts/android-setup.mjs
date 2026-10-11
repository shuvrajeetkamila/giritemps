// Patches the generated Android project: landscape-only main activity.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const manifest = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifest)) {
  console.error('android/ project not found; run "npx cap add android" first');
  process.exit(1);
}
let xml = readFileSync(manifest, 'utf8');
xml = xml.replace(/<activity([^>]*android:name="\.MainActivity"[^>]*)>/, (m, attrs) => {
  let a = attrs;
  if (!/screenOrientation/.test(a)) a += ' android:screenOrientation="sensorLandscape"';
  return `<activity${a}>`;
});
writeFileSync(manifest, xml);
console.log('Patched', manifest, '-> landscape');
