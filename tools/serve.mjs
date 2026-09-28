// Production server for dist/: pre-compressed brotli/gzip (tools/compress.mjs),
// hashed assets cached for a year, everything else revalidated hourly.
// Run: npm run build && npm run serve   → http://localhost:4173 (PORT to change)
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.pdf': 'application/pdf',
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(DIST, url));
  if (!file.startsWith(normalize(DIST))) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // hash routes: one page
  const accept = String(req.headers['accept-encoding'] ?? '');
  const enc = accept.includes('br') && existsSync(`${file}.br`) ? 'br' : accept.includes('gzip') && existsSync(`${file}.gz`) ? 'gzip' : undefined;
  const body = enc ? `${file}.${enc === 'br' ? 'br' : 'gz'}` : file;
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(body).size,
    'Cache-Control': url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    Vary: 'Accept-Encoding',
    ...(enc && { 'Content-Encoding': enc }),
  });
  createReadStream(body).pipe(res);
}).listen(PORT, () => console.log(`GUARDIANS on http://localhost:${PORT}`));
