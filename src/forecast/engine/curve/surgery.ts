// Contour surgery: split a closed curve where it crosses itself, or where two non-adjacent parts come
// closer than a set distance (a narrow neck), into separate closed curves.
import { fromLocal, safeCos } from '../geo/geodesy';
import { computeMetrics, projectCurve, type Curve } from './curve';

interface Hit {
  i: number;
  j: number;
  x: number;
  y: number;
}

/** Proper segment intersection of P1P2 with P3P4; returns parameter-based point or null. */
function segIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): [number, number] | null {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return null;
  const s = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const t = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (s <= 0 || s >= 1 || t <= 0 || t >= 1) return null;
  return [x1 + s * (x2 - x1), y1 + s * (y2 - y1)];
}

/** First self-intersection found via a uniform spatial hash of segments (deterministic order). */
export function findSelfIntersection(x: Float64Array, y: Float64Array): Hit | null {
  const n = x.length;
  if (n < 4) return null;
  let per = 0, minX = Infinity, minY = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    per += Math.hypot(x[j] - x[i], y[j] - y[i]);
    if (x[i] < minX) minX = x[i];
    if (y[i] < minY) minY = y[i];
  }
  const cell = Math.max((2 * per) / n, 1e-3);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cx0 = Math.floor((Math.min(x[i], x[j]) - minX) / cell), cx1 = Math.floor((Math.max(x[i], x[j]) - minX) / cell);
    const cy0 = Math.floor((Math.min(y[i], y[j]) - minY) / cell), cy1 = Math.floor((Math.max(y[i], y[j]) - minY) / cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cx * 4194304 + cy;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        for (const k of list) {
          const a = Math.min(i, k), b = Math.max(i, k);
          if (b - a <= 1 || (a === 0 && b === n - 1)) continue; // adjacent segments share a vertex
          const a2 = (a + 1) % n, b2 = (b + 1) % n;
          const p = segIntersect(x[a], y[a], x[a2], y[a2], x[b], y[b], x[b2], y[b2]);
          if (p) return { i: a, j: b, x: p[0], y: p[1] };
        }
        list.push(i);
      }
    }
  }
  return null;
}

/** Tunable assumption: two boundary parts count as "non-adjacent" only if the shorter arc between them is ≥ this × the neck distance. */
export const NECK_ARC_FACTOR = 5;

/**
 * Narrowest neck: vertex i and segment k closer than d (m) whose shorter along-curve arc is ≥ NECK_ARC_FACTOR·d.
 * Returns the vertex pair (i < j) to cut between, j being the nearer end of segment k. Spatial hash, O(n) typical.
 */
export function findNarrowNeck(x: Float64Array, y: Float64Array, d: number): { i: number; j: number; dist: number } | null {
  const n = x.length;
  if (n < 6 || !(d > 0)) return null;
  const s = new Float64Array(n + 1); // cumulative arc length
  let minX = Infinity, minY = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s[i + 1] = s[i] + Math.hypot(x[j] - x[i], y[j] - y[i]);
    if (x[i] < minX) minX = x[i];
    if (y[i] < minY) minY = y[i];
  }
  const per = s[n], minArc = NECK_ARC_FACTOR * d;
  if (per < 2 * minArc) return null;
  const cell = d, key = (cx: number, cy: number) => cx * 4194304 + cy;
  const grid = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const cx0 = Math.floor((Math.min(x[k], x[k2]) - d - minX) / cell), cx1 = Math.floor((Math.max(x[k], x[k2]) + d - minX) / cell);
    const cy0 = Math.floor((Math.min(y[k], y[k2]) - d - minY) / cell), cy1 = Math.floor((Math.max(y[k], y[k2]) + d - minY) / cell);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        let list = grid.get(key(cx, cy));
        if (!list) grid.set(key(cx, cy), (list = []));
        list.push(k);
      }
  }
  let best: { i: number; j: number; dist: number } | null = null;
  for (let i = 0; i < n; i++) {
    const list = grid.get(key(Math.floor((x[i] - minX) / cell), Math.floor((y[i] - minY) / cell)));
    if (!list) continue;
    for (const k of list) {
      const k2 = (k + 1) % n;
      const ex = x[k2] - x[k], ey = y[k2] - y[k], L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x[i] - x[k]) * ex + (y[i] - y[k]) * ey) / L2)) : 0;
      const dist = Math.hypot(x[k] + t * ex - x[i], y[k] + t * ey - y[i]);
      if (dist >= d || (best && dist >= best.dist)) continue;
      const a = Math.abs(s[k] + t * (s[k + 1] - s[k]) - s[i]);
      if (Math.min(a, per - a) < minArc) continue;
      const j = t < 0.5 ? k : k2;
      if (j === i) continue;
      best = { i: Math.min(i, j), j: Math.max(i, j), dist };
    }
  }
  return best;
}

export interface SurgeryResult {
  curves: Curve[];
  splits: number;
  dropped: number;
}

/**
 * Repeatedly split a curve at self-intersections and, if neckDistM > 0, across necks narrower than neckDistM.
 * Pieces with |area| < minAreaM2 or < 3 vertices are dropped. A neck cut across water (a narrow inlet) yields a
 * piece wound opposite to the parent: that piece is water and is dropped, so the two lobes merge.
 * The piece with the largest |area| keeps the parent id; others get ids from nextId().
 */
export function surgery(curve: Curve, minAreaM2: number, nextId: () => number, neckDistM = 0, maxSplits = 256): SurgeryResult {
  const out: Curve[] = [];
  const parentSign = Math.sign(computeMetrics(curve.lat, curve.lon).areaM2);
  const stack: { lat: number[]; lon: number[]; neck: boolean }[] = [{ lat: curve.lat, lon: curve.lon, neck: false }];
  let splits = 0, dropped = 0;
  const pieces: { lat: number[]; lon: number[] }[] = [];
  while (stack.length) {
    const c = stack.pop()!;
    if (c.lat.length < 3) { dropped++; continue; }
    const m = computeMetrics(c.lat, c.lon);
    if (c.neck && Math.sign(m.areaM2) !== parentSign) { dropped++; continue; }
    if (splits < maxSplits) {
      const { x, y } = projectCurve(c.lat, c.lon, m.centroidLat, m.centroidLon);
      const hit = findSelfIntersection(x, y);
      if (hit) {
        splits++;
        const [xl, xo] = fromLocal(m.centroidLat, m.centroidLon, hit.x, hit.y, safeCos(m.centroidLat));
        const aLat = [xl, ...c.lat.slice(hit.i + 1, hit.j + 1)];
        const aLon = [xo, ...c.lon.slice(hit.i + 1, hit.j + 1)];
        const bLat = [xl, ...c.lat.slice(hit.j + 1), ...c.lat.slice(0, hit.i + 1)];
        const bLon = [xo, ...c.lon.slice(hit.j + 1), ...c.lon.slice(0, hit.i + 1)];
        stack.push({ lat: aLat, lon: aLon, neck: false }, { lat: bLat, lon: bLon, neck: false }); // figure-eight loops wind oppositely: no sign test
        continue;
      }
      const neck = findNarrowNeck(x, y, neckDistM);
      if (neck) {
        splits++;
        const { i, j } = neck;
        stack.push(
          { lat: c.lat.slice(i, j + 1), lon: c.lon.slice(i, j + 1), neck: true },
          { lat: [...c.lat.slice(j), ...c.lat.slice(0, i + 1)], lon: [...c.lon.slice(j), ...c.lon.slice(0, i + 1)], neck: true },
        );
        continue;
      }
    }
    if (Math.abs(m.areaM2) < minAreaM2) { dropped++; continue; }
    pieces.push(c);
  }
  if (splits === 0) {
    if (pieces.length) { curve.metrics = computeMetrics(curve.lat, curve.lon); out.push(curve); }
    return { curves: out, splits, dropped };
  }
  const withM = pieces.map((p) => ({ p, m: computeMetrics(p.lat, p.lon) }));
  let big = 0;
  for (let k = 1; k < withM.length; k++) if (Math.abs(withM[k].m.areaM2) > Math.abs(withM[big].m.areaM2)) big = k;
  withM.forEach(({ p, m }, k) => out.push({ id: k === big ? curve.id : nextId(), lat: p.lat, lon: p.lon, metrics: m }));
  return { curves: out, splits, dropped };
}
