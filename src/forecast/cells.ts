/**
 * Outline of a set of grid cells: the boundary of their union, traced as rings.
 *
 * A convex hull bridges straight across land between two lobes of oil; the
 * boundary of the occupied cells follows the oil, and so the coast. Each
 * occupied cell contributes its edges that face an empty cell, directed
 * anticlockwise; chaining them gives outer rings (anticlockwise, positive
 * area) and holes (clockwise), and only the outer rings are kept.
 */

export type LonLat = [number, number];

export function cellRings(cells: Set<string>, size: number): LonLat[][] {
  const next = new Map<string, string[]>();
  const add = (a: string, b: string) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
  const has = (i: number, j: number) => cells.has(`${i},${j}`);
  for (const k of cells) {
    const [i, j] = k.split(',').map(Number);
    // Corner (i, j) is the cell's south-west; walk the cell anticlockwise.
    if (!has(i, j - 1)) add(`${i},${j}`, `${i + 1},${j}`);
    if (!has(i + 1, j)) add(`${i + 1},${j}`, `${i + 1},${j + 1}`);
    if (!has(i, j + 1)) add(`${i + 1},${j + 1}`, `${i},${j + 1}`);
    if (!has(i - 1, j)) add(`${i},${j + 1}`, `${i},${j}`);
  }
  const rings: LonLat[][] = [];
  while (next.size) {
    const start = next.keys().next().value as string;
    const ring: string[] = [];
    let at = start;
    for (let guard = 0; guard < 1e6; guard++) {
      ring.push(at);
      const outs = next.get(at);
      if (!outs?.length) break;
      const to = outs.pop()!;
      if (!outs.length) next.delete(at);
      at = to;
      if (at === start) break;
    }
    if (ring.length < 4) continue;
    const pts = ring.map((k) => k.split(',').map((n) => Number(n) * size) as LonLat);
    let twice = 0;
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) twice += (pts[b][0] - pts[a][0]) * (pts[b][1] + pts[a][1]);
    if (twice > 0) rings.push(simplify(pts)); // anticlockwise: an outer boundary
  }
  return rings.sort((a, b) => b.length - a.length);
}

/** Drop the collinear corners a staircase of cells leaves. */
function simplify(p: LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}
