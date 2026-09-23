// Polygon → per-cell share of a release, for the sparse master, without a dense frame or a polygon test per sample.
//
// It reproduces shapes.rasterise: 2 × 2 sub-samples per cell at the same (accumulated) coordinates, the same even-odd
// inside rule and the same weights (uniform 1, or dome min(1, distance to the edge / half the smaller bbox side)),
// accumulated in the same order, so a uniform release gives identical shares. What changes is how:
//   • inside: per sample row, the edge crossings are computed with pointInPolygon's arithmetic and sorted; a sample is
//     inside where an odd number of crossings lie strictly to its right, so whole spans are filled at once.
//   • dome distance: exact brute force (every edge per sample) when that is cheap; otherwise each cell carries the
//     nearest edge found by two-pass 8-neighbour propagation from the cells the edges cross, and every sample takes
//     the exact distance to the best of the edges labelled on its 3 × 3 cell neighbourhood (the brute-force edge unless
//     a Voronoi region of the edges is thinner than a cell; tests bound the difference).
//   • output: shares go straight into B × B block arrays, so memory follows the covered area, not the bounding box.
// Several rings are combined with the even-odd rule (holes). A generator yields between row batches so a worker can
// stay responsive and cancel.
import type { Polygon, SlickProfile } from './shapes';

export interface BlockShares {
  B: number;
  dx: number;
  /** Share of the release per cell (sums to 1), per block key (see blockKey), in first-cell row-major order. */
  blocks: Map<number, Float64Array>;
}

export const blockKey = (bi: number, bj: number) => (bi + 32768) * 65536 + (bj + 32768);

/** Brute-force dome distances when samples × edges stays below this. */
export const BRUTE_DOME_WORK = 4e7;

export function* rasteriseBlocks(rings: Polygon[], profile: SlickProfile, dx: number, B: number, rowsPerYield = 256, bruteWork = BRUTE_DOME_WORK): Generator<number, BlockShares> {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, E = 0;
  for (const p of rings) { minX = Math.min(minX, p.minX); maxX = Math.max(maxX, p.maxX); minY = Math.min(minY, p.minY); maxY = Math.max(maxY, p.maxY); E += p.x.length; }
  // edges as in pointInPolygon: from vertex j (previous) to vertex i
  const xi = new Float64Array(E), yi = new Float64Array(E), xj = new Float64Array(E), yj = new Float64Array(E);
  let e = 0;
  for (const p of rings) for (let i = 0, j = p.x.length - 1; i < p.x.length; j = i++, e++) { xi[e] = p.x[i]; yi[e] = p.y[i]; xj[e] = p.x[j]; yj[e] = p.y[j]; }
  // the same frame SparseMaster.addOil builds, so cell indices come out of the same arithmetic
  const I0 = Math.floor(minX / dx) - 1, J0 = Math.floor(minY / dx) - 1;
  const nx = Math.floor(maxX / dx) + 2 - I0, ny = Math.floor(maxY / dx) + 2 - J0;
  const x0 = (I0 + nx / 2) * dx - (nx * dx) / 2, y0 = (J0 + ny / 2) * dx - (ny * dx) / 2; // as rasterise derives them from the frame
  const half = dx / 2;
  const xs: number[] = [];
  for (let sx = minX + dx / 4; sx <= maxX; sx += half) xs.push(sx);
  const ci = Int32Array.from(xs, (sx) => Math.floor((sx - x0) / dx));
  let rows = 0;
  for (let sy = minY + dx / 4; sy <= maxY; sy += half) rows++;

  const dome = profile === 'dome';
  const maxD = dome ? Math.max(1, 0.5 * Math.min(maxX - minX, maxY - minY)) : 1;
  // distance from (px, py) to edge k, as shapes.edgeDistance
  const seg = (k: number, px: number, py: number) => {
    const ax = xj[k], ay = yj[k], bx = xi[k] - ax, by = yi[k] - ay, L = bx * bx + by * by;
    const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / L)) : 0;
    return Math.hypot(px - ax - t * bx, py - ay - t * by);
  };
  const brute = !dome || rows * xs.length * E <= bruteWork;
  let label: Int32Array | null = null;
  if (dome && !brute) label = nearestEdgeLabels(nx, ny, dx, x0, y0, E, xi, yi, xj, yj, seg);
  const distance = (px: number, py: number, cell: number): number => {
    let d = Infinity;
    if (!label) { for (let k = 0; k < E; k++) d = Math.min(d, seg(k, px, py)); return d; }
    const i = cell % nx, j = (cell - i) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      if (j + dj < 0 || j + dj >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        if (i + di < 0 || i + di >= nx) continue;
        const k = label[(j + dj) * nx + i + di];
        if (k >= 0) d = Math.min(d, seg(k, px, py));
      }
    }
    return d;
  };

  // shares per block; a block's first cell in row-major order decides its position (as SparseMaster.addOil creates them)
  const acc = new Map<number, Float64Array>(), first = new Map<number, number>();
  const cross = new Float64Array(E);
  let kept = 0, row = 0;
  for (let sy = minY + dx / 4; sy <= maxY; sy += half) {
    let n = 0;
    for (let k = 0; k < E; k++) if ((yi[k] > sy) !== (yj[k] > sy)) cross[n++] = ((xj[k] - xi[k]) * (sy - yi[k])) / (yj[k] - yi[k]) + xi[k];
    const c = cross.subarray(0, n).sort();
    const J = Math.floor((sy - y0) / dx), bj = Math.floor((J0 + J) / B), rowInBlock = (J0 + J) - bj * B;
    // spans [c[k−1], c[k]) with n − k odd; the first span starts at −∞ when n is odd
    for (let k = n % 2 === 1 ? 0 : 1; k <= n; k += 2) {
      const lo = k === 0 ? -Infinity : c[k - 1], hi = k === n ? Infinity : c[k];
      for (let m = lowerBound(xs, lo); m < xs.length && xs[m] < hi; m++) {
        const cell = J * nx + ci[m], w = dome ? Math.min(1, distance(xs[m], sy, cell) / maxD) : 1;
        kept += w;
        const I = I0 + ci[m], bi = Math.floor(I / B), key = blockKey(bi, bj);
        let a = acc.get(key);
        if (!a) { a = new Float64Array(B * B); acc.set(key, a); }
        a[rowInBlock * B + (I - bi * B)] += w;
        const order = (J0 + J) * 4294967296 + I; // row-major position of the block's first cell
        if (!(first.get(key)! <= order)) first.set(key, order);
      }
    }
    if (++row % rowsPerYield === 0) yield row / rows;
  }
  const blocks = new Map<number, Float64Array>();
  for (const [key, a] of [...acc].sort((p, q) => first.get(p[0])! - first.get(q[0])!)) {
    for (let k = 0; k < a.length; k++) a[k] /= kept;
    blocks.set(key, a);
  }
  return { B, dx, blocks };
}

/** Run a generator to completion. */
export function finish<R>(g: Generator<number, R>): R {
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

function lowerBound(a: number[], v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Nearest edge per cell centre: seeded where edges pass, then two forward/backward 8-neighbour sweeps. */
function nearestEdgeLabels(nx: number, ny: number, dx: number, x0: number, y0: number, E: number,
  xi: Float64Array, yi: Float64Array, xj: Float64Array, yj: Float64Array, seg: (k: number, px: number, py: number) => number): Int32Array {
  const label = new Int32Array(nx * ny).fill(-1), dist = new Float64Array(nx * ny).fill(Infinity);
  const cx = (i: number) => x0 + (i + 0.5) * dx, cy = (j: number) => y0 + (j + 0.5) * dx;
  const offer = (c: number, k: number) => { const i = c % nx, d = seg(k, cx(i), cy((c - i) / nx)); if (d < dist[c]) { dist[c] = d; label[c] = k; } };
  for (let k = 0; k < E; k++) {
    const L = Math.hypot(xi[k] - xj[k], yi[k] - yj[k]), n = Math.max(1, Math.ceil(L / (dx / 4)));
    for (let s = 0; s <= n; s++) {
      const px = xj[k] + ((xi[k] - xj[k]) * s) / n, py = yj[k] + ((yi[k] - yj[k]) * s) / n;
      const i = Math.floor((px - x0) / dx), j = Math.floor((py - y0) / dx);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (i + di >= 0 && i + di < nx && j + dj >= 0 && j + dj < ny) offer((j + dj) * nx + i + di, k);
    }
  }
  const pass = (forward: boolean) => {
    const nb = forward ? [[-1, 0], [-1, -1], [0, -1], [1, -1]] : [[1, 0], [1, 1], [0, 1], [-1, 1]];
    for (let jj = 0; jj < ny; jj++) {
      const j = forward ? jj : ny - 1 - jj;
      for (let ii = 0; ii < nx; ii++) {
        const i = forward ? ii : nx - 1 - ii, c = j * nx + i;
        for (const [di, dj] of nb) {
          const a = i + di, b = j + dj;
          if (a < 0 || a >= nx || b < 0 || b >= ny) continue;
          const k = label[b * nx + a];
          if (k >= 0 && k !== label[c]) offer(c, k);
        }
      }
    }
  };
  for (let r = 0; r < 2; r++) { pass(true); pass(false); }
  return label;
}
