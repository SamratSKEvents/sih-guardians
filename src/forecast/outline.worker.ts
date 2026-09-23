/**
 * The run's shape over time, cheaply: the same solver on a 100 m grid, straight
 * to the horizon, forwards and (with the forcing reversed) backwards. It keeps
 * no fields, only what the page draws and counts: an outline, a centre and a
 * budget each hour, and the hour oil first comes within reach of each stretch
 * of coast. The live 50 m run is what the operator watches; this is what lets
 * the page show +6, +12 and +24 h before the live run gets there.
 */

import { GlobeMaster } from './engine';
import type { LonLat } from './engine';
import { applyForcing, DISPLAY_SHEEN_M, release, solverFor } from './live';
import { loadLandRings } from './land';
import type { Forcing } from './forcing';

export interface OutlineRequest { rings: LonLat[][]; volumeM3: number; forcing: Forcing; forwardH: number; backwardH: number }
export interface OutlineStep { hour: number; hull: LonLat[]; centre: LonLat; areaKm2: number; afloat: number; evaporated: number; dispersed: number; stranded: number; released: number }
export interface CoastPoint { at: LonLat; hour: number | null }
export type OutlineMessage =
  | { kind: 'step'; dir: 'forward' | 'backward'; step: OutlineStep }
  | { kind: 'coast'; points: CoastPoint[] }
  | { kind: 'done'; dir: 'forward' | 'backward' }
  | { kind: 'failed'; detail: string };

const post = (m: OutlineMessage) => (self as unknown as Worker).postMessage(m);
const halo = new Float32Array(66 * 66);
const CELL = 0.004; // ≈ 400 m buckets for the coast test

function hull(points: LonLat[]): LonLat[] {
  // ponytail: convex hull; a concave outline (alpha shape) would hug windrows better.
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: LonLat, a: LonLat, b: LonLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LonLat[] = [], upper: LonLat[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Cell centres with visible oil, and the buckets they fall in. */
function cells(g: GlobeMaster) {
  const { blocks, B } = g.view(true, null, false);
  const pts: LonLat[] = [];
  const buckets = new Set<string>();
  let sx = 0, sy = 0, sw = 0;
  const row = B + 2;
  for (const b of blocks) {
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const [lon, lat] of b.corners) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
    g.blockThickness(b, halo);
    for (let j = 0; j < B; j += 2) for (let i = 0; i < B; i += 2) {
      const h = halo[(j + 1) * row + i + 1];
      if (!(h >= DISPLAY_SHEEN_M * 20)) continue;
      const at: LonLat = [w + ((i + 0.5) / B) * (e - w), s + ((j + 0.5) / B) * (n - s)];
      pts.push(at);
      buckets.add(`${Math.floor(at[0] / CELL)},${Math.floor(at[1] / CELL)}`);
      sx += at[0] * h; sy += at[1] * h; sw += h;
    }
  }
  return { pts, buckets, centre: (sw ? [sx / sw, sy / sw] : undefined) as LonLat | undefined };
}

async function run(req: OutlineRequest, dir: 'forward' | 'backward', land: LonLat[][], coast: CoastPoint[] | undefined) {
  const g = new GlobeMaster(solverFor(100));
  applyForcing(g, req.forcing, dir === 'backward');
  g.setLand(land);
  const problem = release(g, req.rings, req.volumeM3);
  if (problem) { post({ kind: 'failed', detail: problem }); return; }
  const hours = dir === 'forward' ? req.forwardH : req.backwardH;
  let last: LonLat = req.rings[0][0];
  for (let h = 0; h <= hours; h++) {
    while (g.t < h * 3600 && !g.halted) g.step(Math.min(60, h * 3600 - g.t));
    const c = cells(g);
    const m = g.measure(DISPLAY_SHEEN_M);
    const b = g.budget();
    if (c.centre) last = c.centre;
    post({ kind: 'step', dir, step: { hour: dir === 'forward' ? h : -h, hull: hull(c.pts), centre: last, areaKm2: m.areaM2 / 1e6, afloat: m.volume, evaporated: b.evaporated, dispersed: b.dispersed, stranded: b.stranded, released: b.released } });
    if (coast) for (const q of coast) {
      if (q.hour !== null) continue;
      const bx = Math.floor(q.at[0] / CELL), by = Math.floor(q.at[1] / CELL);
      for (let dx = -1; dx <= 1 && q.hour === null; dx++) for (let dy = -1; dy <= 1; dy++) if (c.buckets.has(`${bx + dx},${by + dy}`)) { q.hour = h; break; }
    }
    await new Promise((r) => setTimeout(r));
  }
  post({ kind: 'done', dir });
}

self.onmessage = async (event: MessageEvent<OutlineRequest>) => {
  const req = event.data;
  const land = await loadLandRings().catch(() => [] as LonLat[][]);
  const [cx, cy] = req.rings[0][0];
  // The coast within ~1.2° of the slick, densified to about a kilometre.
  const coast: CoastPoint[] = [];
  for (const ring of land) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if (Math.abs(a[0] - cx) > 1.2 || Math.abs(a[1] - cy) > 1.2) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
    for (let k = 0; k < n; k++) coast.push({ at: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], hour: null });
  }
  try {
    await run(req, 'forward', land, coast);
    post({ kind: 'coast', points: coast });
    await run(req, 'backward', land, undefined);
  } catch (error) {
    post({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) });
  }
};
