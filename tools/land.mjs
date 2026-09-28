// Even-odd point-in-polygon against public/data/land-hires.json
// (OSM coast near the 20 demo slicks, Natural Earth 1:50m elsewhere).
import { readFileSync } from 'node:fs';

export const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const { rings } = read('public/data/land-hires.json');
const boxes = rings.map((r) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
});

export function onLand(x, y) {
  let inside = false;
  for (let k = 0; k < rings.length; k++) {
    const [a, b, c, d] = boxes[k];
    if (x < a || x > c || y < b || y > d) continue;
    const r = rings[k];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// self-check: open Arabian Sea is water, central India is land
if (onLand(65, 15) || !onLand(78, 22)) throw new Error('land test broken');
