// Checks that the built game (dist/) and the source tree stay under the 2 GB package budget.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 2 * 1024 * 1024 * 1024;
const MEM_NOTE = 'Target runtime memory budget: 128 MB of GPU/CPU data for the streamed world.';

function size(dir, skip = new Set(['node_modules', '.git'])) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? size(p, skip) : st.size;
  }
  return total;
}

const dist = size('dist');
const src = size('.', new Set(['node_modules', '.git', 'dist']));
const fmt = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
console.log(`dist:   ${fmt(dist)}`);
console.log(`source: ${fmt(src)}`);
console.log(MEM_NOTE);
if (dist + src > LIMIT) {
  console.error(`FAIL: ${fmt(dist + src)} exceeds the 2 GB limit`);
  process.exit(1);
}
console.log('OK: within the 2 GB package limit');
