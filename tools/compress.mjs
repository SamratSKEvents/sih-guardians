// After `vite build`: writes .br and .gz next to every compressible file in dist/,
// so tools/serve.mjs can send them without compressing per request.
// Run: node tools/compress.mjs   (npm run build does it)
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = /\.(js|mjs|css|html|json|geojson|svg|txt|xml|wasm|glsl|ktx2|b3dm|gltf)$/i;

let raw = 0, br = 0, files = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (!TYPES.test(name) || statSync(path).size < 1024) continue;
    const body = readFileSync(path);
    const b = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
    writeFileSync(`${path}.br`, b);
    writeFileSync(`${path}.gz`, gzipSync(body, { level: 9 }));
    raw += body.length; br += b.length; files++;
  }
}
walk(DIST);
console.log(`${files} files: ${(raw / 1e6).toFixed(1)} MB → ${(br / 1e6).toFixed(1)} MB brotli`);
