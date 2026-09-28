// Rounds the catalogue's coarse outline tiles to the precision their
// simplification supports (lod0 ≈445 m, lod1 ≈167 m → 3 decimals ≈111 m;
// lod2 ≈56 m → 4 decimals), dropping points that round onto their neighbour.
// lod3 (close zoom) keeps full detail. Idempotent.
// Run: node tools/quantize-geom.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIGITS = { lod0: 3, lod1: 3, lod2: 4 };
const root = fileURLToPath(new URL('../public/data/catalog/geom/', import.meta.url));

const ring = (r, k) => {
  const out = [];
  for (const [x, y] of r) {
    const p = [+x.toFixed(k), +y.toFixed(k)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : r; // never collapse a ring
};
const geom = (g, k) =>
  g.type === 'Polygon'
    ? { ...g, coordinates: g.coordinates.map((r) => ring(r, k)) }
    : { ...g, coordinates: g.coordinates.map((p) => p.map((r) => ring(r, k))) };

for (const [lod, k] of Object.entries(DIGITS)) {
  let before = 0, after = 0;
  for (const name of readdirSync(root + lod)) {
    const path = `${root}${lod}/${name}`;
    const text = readFileSync(path, 'utf8');
    const tile = JSON.parse(text);
    for (const id of Object.keys(tile.slicks)) tile.slicks[id] = geom(tile.slicks[id], k);
    const out = JSON.stringify(tile);
    writeFileSync(path, out);
    before += text.length; after += out.length;
  }
  console.log(lod, (before / 1e6).toFixed(1), '→', (after / 1e6).toFixed(1), 'MB');
}
