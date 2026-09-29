// Re-cuts lod3 (full detail, ~34 MB) from 10° cells into 1° cells, keyed by
// each slick's centroid from index.json, so a close zoom or a click fetches
// kilobytes instead of a 4 MB cell. Idempotent. Run: node tools/split-lod3.mjs
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/data/catalog/', import.meta.url));
const dir = `${root}geom/lod3/`;
const at = Object.fromEntries(JSON.parse(readFileSync(`${root}index.json`, 'utf8')).slicks.map((r) => [r.id, r.c]));
const name = (lon, lat) => {
  const x = Math.floor(lon), y = Math.floor(lat);
  return `${x >= 0 ? 'e' : 'w'}${String(Math.abs(x)).padStart(3, '0')}_${y >= 0 ? 'n' : 's'}${String(Math.abs(y)).padStart(2, '0')}`;
};
const cells = {};
for (const f of readdirSync(dir))
  for (const [id, g] of Object.entries(JSON.parse(readFileSync(dir + f, 'utf8')).slicks)) {
    const m = at[id];
    if (!m) throw new Error(`no centroid for ${id}`);
    (cells[name(m[0], m[1])] ??= {})[id] = g;
  }
rmSync(dir, { recursive: true });
mkdirSync(dir);
for (const [c, slicks] of Object.entries(cells)) writeFileSync(`${dir}${c}.json`, JSON.stringify({ tile: c, lod: 'lod3', slicks }));
console.log(Object.keys(cells).length, 'cells');
