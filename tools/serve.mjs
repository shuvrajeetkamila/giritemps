// ---------------------------------------------------------------------------
// Tiny static file server for AERIAL TEMPEST.
//
//   node tools/serve.mjs            → serves the repo root (source, import map)
//   node tools/serve.mjs --web      → serves the production build in web/
//   PORT=8080 node tools/serve.mjs
//
// Binds 0.0.0.0 so the sandbox preview proxy can reach it.
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const args = process.argv.slice(2);
const useBuild = args.includes('--web') || args.includes('--build') || process.env.SERVE === 'web';
const PORT = Number(process.env.PORT || args.find((a) => /^\d+$/.test(a)) || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const buildDir = path.join(ROOT, 'web');
let BASE = ROOT;
if (useBuild) {
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
    console.error('web/index.html not found — run `npm run build` first, or omit --web.');
    process.exit(1);
  }
  BASE = buildDir;
}

function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const p = path.normalize(path.join(base, decoded));
  if (!p.startsWith(base)) return null;
  return p;
}

async function statFile(p) {
  try {
    const st = await fsp.stat(p);
    return st;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end('method not allowed');
    }
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    let file = safeJoin(BASE, req.url || '/');
    if (!file) {
      res.writeHead(403);
      return res.end('forbidden');
    }

    let st = await statFile(file);
    if (st && st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = await statFile(file);
    }
    // fall back to the source tree when a build-only path is missing
    if ((!st || !st.isFile()) && BASE !== ROOT) {
      const alt = safeJoin(ROOT, req.url || '/');
      const ast = alt ? await statFile(alt) : null;
      if (ast && ast.isFile()) { file = alt; st = ast; }
    }
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`404 ${req.url}`);
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': String(st.size),
      'Cache-Control': 'no-store, must-revalidate',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`500 ${err && err.message}`);
  } finally {
    if (process.env.QUIET !== '1') {
      console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - t0}ms`);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AERIAL TEMPEST serving ${BASE === buildDir ? 'build (web/)' : 'source (repo root)'}`);
  console.log(`  → http://localhost:${PORT}/`);
  console.log(`  → http://0.0.0.0:${PORT}/ (preview proxy)`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
