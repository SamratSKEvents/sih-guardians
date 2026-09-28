/**
 * Where the oil came from: a reverse-time Lagrangian ensemble.
 *
 * Particles are seeded uniformly inside the detected outline and advected
 * backwards in time by the negated drift (current + windage × wind), each
 * member with its own perturbed windage, wind and current (the forcing is the
 * uncertain part), plus a random walk for turbulent diffusion. A particle
 * whose backward path runs onto land is dropped: oil cannot have been released
 * from land, so that member is inconsistent with the observation.
 *
 * Posts, per hour back to −24 h, the same OutlineStep the page already draws
 * (centre, a hull of the central 80 % of surviving particles, its area), plus
 * a sample of particle positions for the cloud layer.
 *
 * ponytail: one forcing value in space and time, as the forward run uses; a
 * gridded, time-varying field (the Kutch bundle has one) is the upgrade.
 */

import type { LonLat } from './engine';
import type { Forcing } from './forcing';
import type { OutlineStep } from './outline.worker';
import { loadLandRings } from './land';
import { cellRings } from './cells';

export interface BacktrackRequest { rings: LonLat[][]; forcing: Forcing; hours: number; seed: number }
export type BacktrackMessage =
  | { kind: 'step'; dir: 'backward'; step: OutlineStep; cloud: LonLat[]; alive: number; beached: number }
  | { kind: 'done'; dir: 'backward' };

const post = (m: BacktrackMessage) => (self as unknown as Worker).postMessage(m);
const N = 1000;
const DT = 600; // s
const K = 10; // m²/s horizontal diffusivity
const M_PER_DEG = 111_320;

/** Seeded PRNG so the same slick always gives the same ensemble. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

function inRing([x, y]: LonLat, ring: LonLat[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Land as a raster around the slick, built once by scanline fill: every ring
 * edge is bucketed by the grid rows it spans, and each row is filled between
 * its sorted crossings (even-odd). A lookup is then one array read, instead of
 * a point-in-polygon test against coastline rings of tens of thousands of
 * vertices. 200 m cells over ±2°.
 */
function landIndex(rings: LonLat[][], near: LonLat, span = 2, cell = 0.002) {
  const x0 = near[0] - span, y0 = near[1] - span;
  const n = Math.round((2 * span) / cell);
  const grid = new Uint8Array(n * n);
  const rows: number[][] = Array.from({ length: n }, () => []);
  for (const r of rings) {
    let w = Infinity, e = -Infinity, s = Infinity, nn = -Infinity;
    for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); nn = Math.max(nn, y); }
    if (e < x0 || w > x0 + 2 * span || nn < y0 || s > y0 + 2 * span) continue;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xa, ya] = r[j], [xb, yb] = r[i];
      if (ya === yb) continue;
      // Rows whose centre line this edge crosses.
      const lo = Math.max(0, Math.ceil((Math.min(ya, yb) - y0) / cell - 0.5));
      const hi = Math.min(n - 1, Math.floor((Math.max(ya, yb) - y0) / cell - 0.5 - 1e-9));
      for (let k = lo; k <= hi; k++) {
        const y = y0 + (k + 0.5) * cell;
        if ((ya > y) === (yb > y)) continue;
        rows[k].push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
    }
  }
  for (let k = 0; k < n; k++) {
    const xs = rows[k].sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const a = Math.max(0, Math.ceil((xs[m] - x0) / cell - 0.5)), b = Math.min(n - 1, Math.floor((xs[m + 1] - x0) / cell - 0.5));
      for (let i = a; i <= b; i++) grid[k * n + i] = 1;
    }
  }
  return (p: LonLat) => {
    const i = Math.floor((p[0] - x0) / cell), k = Math.floor((p[1] - y0) / cell);
    return i >= 0 && k >= 0 && i < n && k < n && grid[k * n + i] === 1;
  };
}

function hull(points: LonLat[]): LonLat[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: LonLat, a: LonLat, b: LonLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: LonLat[] = [], up: LonLat[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

function areaKm2(ring: LonLat[]) {
  if (ring.length < 3) return 0;
  const kx = 111.32 * Math.cos((ring[0][1] * Math.PI) / 180), ky = 110.57;
  let t = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) t += ring[j][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[j][1] * ky;
  return Math.abs(t) / 2;
}

self.onmessage = async (event: MessageEvent<BacktrackRequest>) => {
  const { rings, forcing, hours, seed } = event.data;
  const R = rng(seed);
  const all = rings.flat();
  const centre: LonLat = [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length];
  const land = landIndex(await loadLandRings().catch(() => [] as LonLat[][]), centre);

  // Seed inside the outline.
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [x, y] of all) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const px: number[] = [], py: number[] = [];
  for (let tries = 0; px.length < N && tries < N * 200; tries++) {
    const p: LonLat = [w + R.u() * (e - w), s + R.u() * (n - s)];
    if (rings.some((r) => inRing(p, r))) { px.push(p[0]); py.push(p[1]); }
  }
  const count = px.length;
  // Per-member forcing: windage 2–4 %, wind ±15 % and ±15°, current ±20 % and ±20°.
  const toRad = Math.PI / 180;
  const vu: number[] = [], vv: number[] = [];
  for (let k = 0; k < count; k++) {
    const windage = 0.02 + 0.02 * R.u();
    const ws = forcing.windSpeed * Math.max(0.3, 1 + 0.15 * R.n());
    const wd = (forcing.windDirDeg + 15 * R.n()) * toRad;
    const cs = Math.hypot(forcing.driftU, forcing.driftV) * Math.max(0, 1 + 0.2 * R.n());
    const cd = Math.atan2(forcing.driftU, forcing.driftV) + 20 * R.n() * toRad;
    vu.push(windage * ws * Math.sin(wd) + cs * Math.sin(cd));
    vv.push(windage * ws * Math.cos(wd) + cs * Math.cos(cd));
  }
  const alive = new Uint8Array(count).fill(1);
  const sigma = Math.sqrt(2 * K * DT);
  const cosLat = Math.cos(centre[1] * toRad);

  const emit = (hour: number) => {
    const pts: LonLat[] = [];
    for (let k = 0; k < count; k++) if (alive[k]) pts.push([px[k], py[k]]);
    const c: LonLat = pts.length ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : centre;
    // Central 80 %: drop the particles furthest from the centre.
    const core = pts.map((p) => ({ p, d: Math.hypot((p[0] - c[0]) * cosLat, p[1] - c[1]) })).sort((a, b) => a.d - b.d).slice(0, Math.ceil(pts.length * 0.8)).map((x) => x.p);
    // The region the core particles occupy, on ~1 km cells widened by one: it follows the
    // water around islands and headlands instead of bridging them like a hull would.
    const cell = 0.01;
    const occ = new Set<string>();
    for (const [x, y] of core) {
      const i = Math.floor(x / cell), j = Math.floor(y / cell);
      for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (!land([(i + di + 0.5) * cell, (j + dj + 0.5) * cell])) occ.add(`${i + di},${j + dj}`);
    }
    const rs = cellRings(occ, cell);
    const h = rs[0] ?? hull(core);
    const step: OutlineStep = { hour: -hour, hull: h, rings: rs, centre: c, areaKm2: rs.length ? rs.reduce((a, r) => a + areaKm2(r), 0) : areaKm2(h), afloat: 0, evaporated: 0, dispersed: 0, stranded: 0, released: 1 };
    const cloud = pts.filter((_, i) => i % 3 === 0);
    post({ kind: 'step', dir: 'backward', step, cloud, alive: pts.length, beached: count - pts.length });
  };

  emit(0);
  const perHour = 3600 / DT;
  for (let hour = 1; hour <= hours; hour++) {
    for (let k = 0; k < perHour; k++) {
      for (let i = 0; i < count; i++) {
        if (!alive[i]) continue;
        // Backwards in time: move against the drift, plus diffusion.
        const dxm = -vu[i] * DT + sigma * R.n();
        const dym = -vv[i] * DT + sigma * R.n();
        const nx = px[i] + dxm / (M_PER_DEG * cosLat), ny = py[i] + dym / M_PER_DEG;
        if (land([nx, ny])) { alive[i] = 0; continue; }
        px[i] = nx; py[i] = ny;
      }
    }
    emit(hour);
    await new Promise((r) => setTimeout(r));
  }
  post({ kind: 'done', dir: 'backward' });
};
