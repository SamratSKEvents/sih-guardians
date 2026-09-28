// Slim per-slick metadata the map needs at boot, from the full catalogue index.
// id -> [observedAt | null, areaKm2 | null, lon, lat]
// Run: node tools/catalog-meta.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../public/data/catalog/', import.meta.url);
const { slicks } = JSON.parse(readFileSync(new URL('index.json', dir)));
const meta = {};
for (const s of slicks) {
  if (!s.c) continue;
  meta[s.id] = [s.t, s.area == null ? null : +(s.area / 1e6).toFixed(4), s.c[0], s.c[1]];
}
writeFileSync(new URL('meta.json', dir), JSON.stringify(meta));
console.log(Object.keys(meta).length, 'slicks');
