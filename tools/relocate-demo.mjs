// Moves any of the 20 demo slicks that touch land to the nearest open water:
// the smallest shift that leaves every outline vertex, with ~1 km clearance, off land.
// Rewrites src/data/slicks.json in place; prints what moved. Idempotent.
// Run: node tools/relocate-demo.mjs
import { writeFileSync } from 'node:fs';
import { onLand, read } from './land.mjs';

const CLEAR = 0.01; // degrees, ≈1.1 km
const STEP = 0.01;
const MAX = 1.5;

const slicks = read('src/data/slicks.json');
const points = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2);
const wet = (x, y) =>
  !onLand(x, y) && !onLand(x + CLEAR, y) && !onLand(x - CLEAR, y) && !onLand(x, y + CLEAR) && !onLand(x, y - CLEAR);
const clear = (pts, dx, dy) => pts.every(([x, y]) => wet(x + dx, y + dy));

function shift(dx, dy) {
  // offsets ordered by distance, so the first clear one is the nearest water
  const out = [];
  for (let i = -MAX; i <= MAX + 1e-9; i += STEP)
    for (let j = -MAX; j <= MAX + 1e-9; j += STEP) out.push([i, j]);
  return out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
}
const OFFSETS = shift();

const r5 = (v) => Math.round(v * 1e5) / 1e5;
for (const s of slicks) {
  const pts = [...points(s.geometry), s.properties.centroid];
  if (clear(pts, 0, 0)) continue;
  const hit = OFFSETS.find(([dx, dy]) => clear(pts, dx, dy));
  if (!hit) { console.log(s.id, 'NO WATER within', MAX, 'deg'); continue; }
  const [dx, dy] = hit;
  const move = (p) => { p[0] = r5(p[0] + dx); p[1] = r5(p[1] + dy); };
  points(s.geometry).forEach(move);
  const p = s.properties;
  move(p.centroid);
  p.bbox = [r5(p.bbox[0] + dx), r5(p.bbox[1] + dy), r5(p.bbox[2] + dx), r5(p.bbox[3] + dy)];
  p.relocatedDeg = [r5((p.relocatedDeg?.[0] ?? 0) + dx), r5((p.relocatedDeg?.[1] ?? 0) + dy)];
  console.log(s.id, 'moved', dx.toFixed(2), dy.toFixed(2), `(${(Math.hypot(dx, dy) * 111).toFixed(1)} km)`);
}
writeFileSync(new URL('../src/data/slicks.json', import.meta.url), JSON.stringify(slicks));
