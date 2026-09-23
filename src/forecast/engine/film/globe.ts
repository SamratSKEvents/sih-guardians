// The master slick anywhere on Earth. A spill area is a SparseMaster on a flat plane about a geographic anchor
// (geo/plane.ts), so storage and work follow the oil instead of a map rectangle: a slick can drift and spread as far as
// the plane stays accurate and the memory budget allows. Drawn slicks and wind/current strokes come in as lon/lat and
// are projected onto the plane of the spill area they belong to.
import { dLon, wrapLon, DEG, EARTH_RADIUS_M } from '../geo/geodesy';
import { monotonicNow } from '../runtime';
import { Plane, greatCircleM, type PlaneKind } from '../geo/plane';
import { Budget, fieldSlick, type Frame, type MapModel, type ModelInfo, type ParamSpec } from './grid';
import { MASTER_DEFAULTS, MASTER_SPEC, entrainmentAt } from './master';
import { SparseMaster, BLOCK_ARRAYS, type SparseParams } from './sparse';
import { SparseReducedMaster } from './reduced';
import type { SweepPool } from './pool';
import { rasteriseBlocks, finish, type BlockShares } from './raster';
import { polygon, stroke, type Polygon, type RegionKind, type SlickProfile } from './shapes';
import { BONN, filmWarnings, slickRows } from './thinfilm';
import { breakingShare, seaHeight } from './vof';
import { G, RES } from './kernels';

export type LonLat = [number, number];
export interface GlobeStroke { id: number; kind: RegionKind; path: LonLat[]; widthM: number; speed: number }
export interface GlobeRelease { ring: LonLat[]; volumeM3: number; profile: SlickProfile }

/** A block to draw: its four corners (left-bottom, left-top, right-top, right-bottom), lon/lat. */
export interface GlobeBlock { id: string; spill: number; bi: number; bj: number; corners: [LonLat, LonLat, LonLat, LonLat] }

export interface GlobeView {
  t: number;
  B: number;
  // the rest only in a full view
  blocks: GlobeBlock[]; // visible (≥ sheen) blocks inside the requested viewport
  hiddenBlocks: number; // visible oil outside the viewport, not sent
  stats: [string, string][];
  warnings: string[];
  outlines: number[][]; // flat [lat, lon, ...]
  arrows: number[]; // [lon, lat, u, v, spacing m] per arrow
  box: { lon: number; lat: number; wLon: number; sLat: number; eLon: number; nLat: number } | null; // biggest slick
}

/**
 * Numerical and resource options.
 *   B, dx, hAlloc, dtScale, filmDtScale, flowEvery  SparseMaster (dtScale < 1 for convergence studies only)
 *   mode  'reduced' uses the drag-dominated scalar thickness equation; 'full' keeps oil momentum for reference runs
 *   raster  'blocks' (raster.ts) or 'dense' (shapes.rasterise over a frame): the release shares
 *   plane   'stereo' or 'equirect' (see geo/plane.ts)
 *   limits  'workload': refuse a release whose estimated memory exceeds memoryMB, and stop stepping when the allocated
 *           blocks do; 'width': the original 40 km width and 80° latitude caps
 */
export interface GlobeSolver { B: number; dx: number; hAlloc: number; dtScale: number; filmDtScale?: number; mode?: 'full' | 'reduced'; flowEvery: number; raster: 'blocks' | 'dense'; plane: PlaneKind; limits: 'workload' | 'width'; memoryMB: number }
export const REFERENCE_SOLVER: GlobeSolver = { B: 64, dx: 50, hAlloc: 1e-10, dtScale: 1, flowEvery: 600, raster: 'dense', plane: 'equirect', limits: 'width', memoryMB: 1024 };
export const OPTIMISED_SOLVER: GlobeSolver = { ...REFERENCE_SOLVER, raster: 'blocks', plane: 'stereo', limits: 'workload' };

// ponytail: spills this far apart run on separate planes and never interact; merge planes if slicks that far apart must meet
export const JOIN_M = 300e3;
/** Stereographic plane radius where lengths are off by 0.1 %. */
export const PLANE_RADIUS_M = 400e3;
export const MAX_SLICK_M = 40e3; // 'width' limits only
const MAX_LAT = 80; // 'width' limits only
/** Display buffers (block images, scratch) the worker may hold at once, MB: part of the memory estimate. */
export const DISPLAY_MB = 96;
/** Seconds of single-thread compute per allocated block per simulated hour, measured on the benchmark host (see docs). */
export const DEFAULT_S_PER_BLOCK_HOUR = 0.25;

export const GLOBE_DEFAULTS = { ...MASTER_DEFAULTS, driftU: 0.05, driftV: 0.02 };
const COAST_ONLY = new Set(['releaseM3', 'radiusM', 'uTide', 'friction', 'shoreCapacity', 'releaseX', 'releaseY']);
export const GLOBE_SPEC: ParamSpec[] = MASTER_SPEC.filter((s) => !COAST_ONLY.has(s.key)).flatMap((s) => s.key !== 'windSpeed' ? [s] : [
  { key: 'driftU', label: 'Background current east', unit: 'm/s', min: -0.5, max: 0.5, step: 0.01, assumption: true },
  { key: 'driftV', label: 'Background current north', unit: 'm/s', min: -0.5, max: 0.5, step: 0.01, assumption: true },
  s,
]);

export const GLOBE_INFO: ModelInfo = {
  calculates: 'The master slick anywhere on the globe: a drag-dominated reduced-gravity thickness solver by default, with film rupture into patches, turbulent and along-wind shear diffusion, breaker-driven natural dispersion and evaporation. The full oil-momentum solver remains available as the reference mode. Cells are kept in 64 × 64 blocks that exist only where the oil is; one coupled solver runs across block edges, so no grid edge ever clips the slick.',
  assumptions: 'The default reduced solver uses a 1:50m global land boundary as an impermeable shoreline; it has no bathymetry, tide or coastal water layer. Current, wind, eddies and windrows are the master\'s synthetic seeded flow, the same in character everywhere. Each spill area is a flat stereographic plane about its first release (lengths within 0.1 % out to 400 km); spills more than 300 km apart run on separate planes and do not interact.',
  master: 'Left out from the 256² master: its coastal water layer, bathymetry and tide. Kept: the reduced solver\'s land-wall collision and release stranding, plus everything acting on the oil itself. The full momentum solver stays available as the reference mode.',
};

/** Mean of a ring's vertices, longitudes unwrapped about the first. */
function centre(ring: LonLat[]): LonLat {
  let lo = 0, la = 0;
  for (const [x, y] of ring) { lo += dLon(ring[0][0], x); la += y; }
  return [wrapLon(ring[0][0] + lo / ring.length), la / ring.length];
}

export const bytesPerBlock = (B: number) => BLOCK_ARRAYS * B * B * 8;
export const bytesPerReducedBlock = (B: number) => {
  const P = B + 2 * G;
  const doubles = 2 * B * B + (P + 1) * P + P * (P + 1) + RES;
  return doubles * 8 + P * P;
};
export const bytesPerSolverBlock = (solver: Pick<GlobeSolver, 'mode'>, B: number) => solver.mode === 'reduced' ? bytesPerReducedBlock(B) : bytesPerBlock(B);

export interface Workload {
  blocks: number; // allocated right after the release (intersected blocks and their margin neighbours)
  memoryMB: number; // solver arrays of all spills after the release + the release's own transient arrays + display
  budgetMB: number;
  sPerSimHour: number; // estimated compute for the whole run after the release, single thread
  problem: string | null;
}

interface Spill { plane: Plane; field: SparseMaster | SparseReducedMaster }

export class GlobeMaster {
  readonly params = { ...GLOBE_DEFAULTS } as SparseParams;
  spills: Spill[] = [];
  strokes: GlobeStroke[] = [];
  landRings: LonLat[][] = [];
  releases: GlobeRelease[] = [];
  t = 0;
  /** Why stepping stopped (resource ceiling), or ''. */
  halted = '';
  /** Measured compute, ms per allocated block per simulated second (exponential average of recent steps). */
  msPerBlockSecond = (DEFAULT_S_PER_BLOCK_HOUR * 1000) / 3600;

  /** pool: sweep threads shared by every spill area (see pool.ts), or null to run on this thread. */
  constructor(readonly solver: GlobeSolver = OPTIMISED_SOLVER, readonly pool: SweepPool | null = null) {}

  get blockCount() { return this.spills.reduce((a, s) => a + s.field.blocks.size, 0); }
  get maxBlocks() { return Math.floor(((this.solver.memoryMB - DISPLAY_MB) * 2 ** 20) / bytesPerSolverBlock(this.solver, this.solver.B)); }

  /** Restart at t = 0 with the drawn slicks placed again (flow structure and seed rebuilt). */
  reset() { finish(this.resetSteps()); }

  *resetSteps(): Generator<number, void> {
    const rs = this.releases;
    for (const s of this.spills) s.field.dispose();
    this.spills = []; this.t = 0; this.halted = '';
    for (const r of rs) {
      const { plane, spill } = this.planeFor(r)!;
      const shares = yield* this.shares(plane, r);
      this.commit(plane, spill, shares, r);
    }
  }

  clear() { this.releases = []; this.reset(); }

  addOil(r: GlobeRelease, replace: boolean): string | null { return finish(this.addOilSteps(r, replace)); }

  /**
   * Place a drawn slick in row batches (yields progress 0–1). Nothing changes until the last batch, so stopping the
   * generator early cancels the release. Returns why the release is refused, or null.
   */
  *addOilSteps(r: GlobeRelease, replace: boolean): Generator<number, string | null> {
    const problem = this.releaseProblem(r, replace);
    if (problem) return problem;
    const target = this.planeFor(r, replace);
    if (!target) return `The shape reaches more than ${PLANE_RADIUS_M / 1000} km from its centre: a flat plane there is off by more than 0.1 %.`;
    const shares = yield* this.shares(target.plane, r);
    if (replace) { for (const s of this.spills) s.field.dispose(); this.releases = []; this.spills = []; this.t = 0; this.halted = ''; }
    this.releases.push(r);
    this.commit(target.plane, replace ? null : target.spill, shares, r);
    return null;
  }

  /** The spill area a release joins (centre within JOIN_M and every vertex on the plane), or a new plane about it. */
  private planeFor(r: GlobeRelease, fresh = false): { plane: Plane; spill: Spill | null } | null {
    const [lon, lat] = centre(r.ring);
    const fits = (p: Plane) => this.solver.plane === 'equirect' || r.ring.every(([lo, la]) => Math.hypot(...p.toPlane(la, lo)) <= PLANE_RADIUS_M);
    if (!fresh) for (const s of this.spills) if (greatCircleM(s.plane.lat0, s.plane.lon0, lat, lon) < JOIN_M && fits(s.plane)) return { plane: s.plane, spill: s };
    const plane = new Plane(lat, lon, this.solver.plane);
    return fits(plane) ? { plane, spill: null } : null;
  }

  private *shares(plane: Plane, r: GlobeRelease): Generator<number, BlockShares> {
    const poly = polygon(r.ring.flatMap(([lo, la]) => plane.toPlane(la, lo)));
    const { B, dx } = this.solver;
    if (this.solver.raster === 'blocks') return yield* rasteriseBlocks([poly], r.profile, dx, B);
    return new SparseMaster(this.params, B, dx).denseShares(poly, r.profile);
  }

  private commit(plane: Plane, spill: Spill | null, shares: BlockShares, r: GlobeRelease) {
    if (!spill) {
      const { B, dx, hAlloc, dtScale, flowEvery } = this.solver;
      const field = this.solver.mode === 'reduced'
        ? new SparseReducedMaster(this.params, B, dx, hAlloc, dtScale, this.solver.filmDtScale ?? dtScale, flowEvery)
        : new SparseMaster(this.params, B, dx, hAlloc, dtScale, this.pool, flowEvery, this.solver.filmDtScale ?? dtScale);
      spill = { plane, field };
      this.spills.push(spill);
      this.project(spill);
    }
    spill.field.addShares(shares, r.volumeM3);
  }

  /** Estimated blocks, memory and compute of a release; `problem` when the release must be refused. */
  workload(r: GlobeRelease, replace = false): Workload {
    const { B, dx, memoryMB } = this.solver, [lon, lat] = centre(r.ring), plane = new Plane(lat, lon, this.solver.plane);
    const pts = r.ring.map(([lo, la]) => plane.toPlane(la, lo)), L = B * dx, set = new Set<number>();
    const mark = (x: number, y: number) => { const bi = Math.floor(x / L), bj = Math.floor(y / L); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) set.add((bi + di + 32768) * 65536 + bj + dj + 32768); };
    let y0 = Infinity, y1 = -Infinity;
    for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // inside spans at every cell row, plus every point along the edges (thin shapes between rows); each marked block
    // brings its 8 neighbours (the margin blocks the solver allocates round oil near an edge)
    for (let y = (Math.floor(y0 / dx) + 0.5) * dx; y <= y1; y += dx) {
      const c: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y)) c.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
      c.sort((a, b) => a - b);
      for (let k = 0; k + 1 < c.length; k += 2) for (let x = c[k]; x < c[k + 1] + L; x += L) mark(Math.min(x, c[k + 1]), y);
    }
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const n = Math.ceil(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) / (L / 2)) + 1;
      for (let s = 0; s <= n; s++) mark(pts[j][0] + ((pts[i][0] - pts[j][0]) * s) / n, pts[j][1] + ((pts[i][1] - pts[j][1]) * s) / n);
    }
    const blocks = set.size, others = replace ? 0 : this.blockCount;
    // peak while placing: the block shares (one array per block) next to the solver arrays
    const memory = ((others + blocks) * bytesPerSolverBlock(this.solver, B) + blocks * B * B * 8) / 2 ** 20 + DISPLAY_MB;
    const sPerSimHour = ((others + blocks) * this.msPerBlockSecond * 3600) / 1000;
    let problem: string | null = null;
    if (memory > memoryMB) problem = `This release needs about ${blocks} blocks of ${B}² × ${dx} m cells (${Math.round(memory)} MB with the oil already placed), over the ${memoryMB} MB budget. Draw a smaller slick${others ? ' or clear the oil' : ''}.`;
    return { blocks, memoryMB: memory, budgetMB: memoryMB, sPerSimHour, problem };
  }

  private releaseProblem(r: GlobeRelease, replace: boolean): string | null {
    const ring = r.ring;
    if (ring.length < 3) return 'Draw a closed shape.';
    if (this.solver.limits === 'workload') return this.workload(r, replace).problem;
    const [lon, lat] = centre(ring), plane = new Plane(lat, lon, 'equirect');
    if (Math.abs(lat) > MAX_LAT) return `The local plane of a spill area is only valid within ${MAX_LAT}° of the equator.`;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [lo, la] of ring) { const [x, y] = plane.toPlane(la, lo); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const size = Math.max(x1 - x0, y1 - y0);
    return size > MAX_SLICK_M ? `The shape is ${(size / 1000).toFixed(0)} km across; the 50 m grid takes slicks up to ${MAX_SLICK_M / 1000} km. Zoom in and draw a smaller one.` : null;
  }

  setStrokes(strokes: GlobeStroke[]) {
    this.strokes = strokes;
    for (const s of this.spills) this.projectFlow(s);
  }

  setLand(rings: LonLat[][]) {
    this.landRings = rings;
    for (const s of this.spills) this.projectLand(s);
  }

  /** Sample the same local fields used by the continuous solver, projected back to lon/lat for map overlays. */
  vectorsAt(lon: number, lat: number): { wind: [number, number]; current: [number, number]; drift: [number, number] } | null {
    const spill = this.spills[0];
    if (!spill) return null;
    const [x, y] = spill.plane.toPlane(lat, lon);
    return spill.field.vectorsAt(x, y);
  }

  private project(s: Spill) {
    this.projectFlow(s);
    this.projectLand(s);
  }

  private projectFlow(s: Spill) {
    s.field.flow.setRegions(this.strokes.map((r) => stroke(r.id, r.kind, r.path.flatMap(([lo, la]) => s.plane.toPlane(la, lo)), r.widthM, r.speed)));
  }

  private projectLand(s: Spill) {
    if (s.field instanceof SparseReducedMaster) {
      const latPad = PLANE_RADIUS_M / 110_000 + 1;
      const lonPad = latPad / Math.max(0.15, Math.abs(Math.cos(s.plane.lat0 * DEG)));
      const relevant = this.landRings.filter((ring) => ring.some(([lo, la]) => Math.abs(la - s.plane.lat0) <= latPad && Math.abs(dLon(s.plane.lon0, lo)) <= lonPad));
      const land: Polygon[] = relevant.map((ring) => polygon(ring.flatMap(([lo, la]) => s.plane.toPlane(la, lo))));
      s.field.setLand(land);
    }
  }

  /** Advance every spill area; refuses (and says why) once the allocated blocks exceed the memory budget. */
  step(dt: number) {
    if (this.solver.limits === 'workload' && this.blockCount > this.maxBlocks) {
      this.halted = `Stopped: the oil now occupies ${this.blockCount} blocks, over the ${this.maxBlocks} the ${this.solver.memoryMB} MB budget allows. Nothing was coarsened; clear some oil or raise the budget.`;
      return;
    }
    const t0 = monotonicNow(), blocks = this.blockCount;
    for (const s of this.spills) s.field.step(dt);
    this.t += dt;
    if (blocks > 0 && dt > 0) this.msPerBlockSecond += 0.2 * ((monotonicNow() - t0) / (blocks * dt) - this.msPerBlockSecond);
  }

  budget(): Budget {
    const b = new Budget(0);
    for (const { field: { budget: q } } of this.spills) {
      b.released += q.released; b.evaporated += q.evaporated; b.dispersed += q.dispersed; b.stranded += q.stranded; b.left += q.left; b.trimmed += q.trimmed;
    }
    return b;
  }

  floating() { return this.spills.reduce((a, s) => a + s.field.volume(), 0); }

  measure(thicknessM = 5e-8) {
    let volume = 0, cells = 0;
    for (const { field } of this.spills) for (const block of field.blocks.values()) for (const thickness of block.h) {
      volume += thickness * this.solver.dx * this.solver.dx;
      if (thickness >= thicknessM) cells++;
    }
    return { volume, areaM2: cells * this.solver.dx * this.solver.dx };
  }

  slickArea(thicknessM = 5e-8) {
    return this.measure(thicknessM).areaM2;
  }

  /** Thickness of a block with a one-cell halo, (B + 2)², into out. */
  blockThickness(b: GlobeBlock, out: Float32Array) {
    const f = this.spills[b.spill].field;
    const k = (b.bi + 32768) * 65536 + b.bj + 32768;
    if (f instanceof SparseReducedMaster) f.gather(f.blocks.get(k)!, 1, 'h', out);
    else f.gather(f.blocks.get(k)!, 1, 'h', out);
  }

  /**
   * One spill area's thickness on a single grid over its blocks, averaged down to at most 1024² cells: for the slick
   * statistics, the outline and framing.
   */
  private composite(s: Spill): { frame: Frame; h: Float64Array } | null {
    const f = s.field, B = f.B;
    if (!f.blocks.size) return null;
    let bi0 = Infinity, bi1 = -Infinity, bj0 = Infinity, bj1 = -Infinity;
    for (const b of f.blocks.values()) { bi0 = Math.min(bi0, b.bi); bi1 = Math.max(bi1, b.bi); bj0 = Math.min(bj0, b.bj); bj1 = Math.max(bj1, b.bj); }
    const n = Math.max(bi1 - bi0 + 1, bj1 - bj0 + 1) * B, c = Math.ceil(n / 1024);
    const nx = Math.ceil(((bi1 - bi0 + 1) * B) / c), ny = Math.ceil(((bj1 - bj0 + 1) * B) / c), h = new Float64Array(nx * ny);
    for (const b of f.blocks.values())
      for (let j = 0; j < B; j++) {
        const r = Math.floor(((b.bj - bj0) * B + j) / c) * nx;
        for (let i = 0; i < B; i++) h[r + Math.floor(((b.bi - bi0) * B + i) / c)] += b.h[j * B + i] / (c * c);
      }
    const dx = f.dx * c;
    // lat0 = lon0 = 0 with cos 1: fieldSlick's lat/lon are then plane metres / (R·DEG), mapped through the plane below
    return { frame: { nx, ny, dx, lat0: 0, lon0: 0, ox: bi0 * B * f.dx + (nx * dx) / 2, oy: bj0 * B * f.dx + (ny * dx) / 2 }, h };
  }

  /**
   * What the page draws. `viewport` [west, south, east, north] (lon/lat, west may exceed east across 180°) limits the
   * blocks listed; `stats` false skips the readout, outline and arrows (the expensive part) for a light update.
   */
  view(full: boolean, viewport: [number, number, number, number] | null = null, stats = true): GlobeView {
    const p = this.params, sheenM = p.sheenUm * 1e-6, blocks: GlobeBlock[] = [], { B, dx } = this.solver;
    const v: GlobeView = { t: this.t, B, blocks, hiddenBlocks: 0, stats: [], warnings: [], outlines: [], arrows: [], box: null };
    if (!full) return v;
    const inView = (c: LonLat[]) => {
      if (!viewport) return true;
      const [w, south, e, north] = viewport, span = e >= w ? e - w : e + 360 - w, mid = w + span / 2;
      if (span >= 359 || Math.max(...c.map((q) => q[1])) < south || Math.min(...c.map((q) => q[1])) > north) return span >= 359;
      const rel = c.map((q) => dLon(mid, q[0])); // blocks are a few km wide, so no wrap within one
      return Math.max(...rel) >= -span / 2 && Math.min(...rel) <= span / 2;
    };
    this.spills.forEach((s, n) => {
      const f = s.field, L = B * dx;
      for (const b of f.blocks.values()) {
        let max = 0;
        for (const q of b.h) if (q > max) max = q;
        if (max < BONN[0].min) continue; // nothing visible
        const x = b.bi * L, y = b.bj * L;
        const corners = [s.plane.toLonLat(x, y), s.plane.toLonLat(x, y + L), s.plane.toLonLat(x + L, y + L), s.plane.toLonLat(x + L, y)] as GlobeBlock['corners'];
        if (inView(corners)) blocks.push({ id: `${n}:${b.bi}:${b.bj}`, spill: n, bi: b.bi, bj: b.bj, corners });
        else v.hiddenBlocks++;
      }
    });
    if (!stats) return v;

    const budget = this.budget(), floating = this.floating();
    let cells = 0, biggest = -1, bigVol = 0, farthest = 0;
    v.stats.push(['elapsed', `${(this.t / 3600).toFixed(2)} h`]);
    this.spills.forEach((s, n) => {
      cells += s.field.blocks.size;
      const vol = s.field.volume();
      if (vol > bigVol) { bigVol = vol; biggest = n; }
      const c = this.composite(s);
      if (!c) return;
      const f = c.frame;
      farthest = Math.max(farthest, s.plane.scaleError(f.ox - (f.nx * f.dx) / 2, f.oy - (f.ny * f.dx) / 2), s.plane.scaleError(f.ox + (f.nx * f.dx) / 2, f.oy + (f.ny * f.dx) / 2));
      const sl = fieldSlick(c.frame, c.h, p.oilDensity, sheenM);
      const like = { frame: c.frame, thickness: () => c.h, rhoOil: p.oilDensity, sheenM, t: s.field.t } as unknown as MapModel;
      const tag = this.spills.length > 1 ? `#${n + 1} ` : '';
      v.stats.push(...slickRows(like, sl).slice(1).map(([k, t]) => [tag + k, t] as [string, string]));
      const M = EARTH_RADIUS_M * DEG;
      for (const l of sl.outlines) {
        const o: number[] = [];
        for (let q = 0; q < l.length; q += 2) { const [lo, la] = s.plane.toLonLat(l[q + 1] * M, l[q] * M); o.push(la, lo); }
        v.outlines.push(o);
      }
      if (n === biggest) v.box = this.box(s.plane, c.frame, c.h, sheenM);
      v.arrows.push(...this.arrows(s, c.frame));
    });
    const U = p.windSpeed, f0 = this.spills[0]?.field;
    v.stats.push(
      ['solver', `${this.pool ? `${this.pool.threads} sweep threads` : 'one thread'} · ${this.solver.plane} planes · memory budget ${this.solver.memoryMB} MB`],
      ['spill areas', `${this.spills.length} · ${cells} blocks of ${B}² × ${dx} m (${((cells * B * B * dx * dx) / 1e6).toFixed(0)} km², ${Math.round((cells * bytesPerSolverBlock(this.solver, B)) / 2 ** 20)} MB)`],
      ['sea state (VOF table)', `H ${seaHeight(U).toFixed(2)} m, ${(100 * breakingShare(U)).toFixed(1)}% crests breaking, entrainment ${entrainmentAt(U).toExponential(2)} s⁻¹`],
      ['natural dispersion', `${(p.permanentShare * entrainmentAt(U)).toExponential(2)} s⁻¹ (${p.permanentShare} of entrainment)`],
      ...(f0 ? [['sub-steps', `oil ${f0.substeps} (dt ${f0.lastDt.toFixed(1)} s), film ${f0.filmSubsteps} last call`] as [string, string]] : []),
      ...budget.rows(floating),
    );
    v.warnings = filmWarnings({ frame: { dx } } as MapModel, budget, floating, p.lensWavelengthM);
    if (this.halted) v.warnings.push(this.halted);
    if (budget.trimmed > 1e-3 * budget.released) v.warnings.push(`${((100 * budget.trimmed) / budget.released).toFixed(2)}% of the oil was trimmed as sub-nanometre film at the edge of the allocated blocks.`);
    if (farthest > 1e-3) v.warnings.push(`Oil has spread far from its plane's centre: lengths there are off by ${(100 * farthest).toFixed(2)} %.`);
    const hours = (cells * this.msPerBlockSecond * 3600) / 1000;
    if (hours > 60) v.warnings.push(`${cells} blocks allocated: about ${Math.round(hours)} s of compute per simulated hour on this device.`);
    return v;
  }

  /** Thickness-weighted centre and bounding box of the oil at or above the sheen, lon/lat. */
  private box(plane: Plane, f: Frame, h: Float64Array, sheenM: number): GlobeView['box'] {
    const x0 = f.ox - (f.nx * f.dx) / 2, y0 = f.oy - (f.ny * f.dx) / 2;
    let w = 0, sx = 0, sy = 0, i0 = f.nx, i1 = -1, j0 = f.ny, j1 = -1;
    for (let j = 0; j < f.ny; j++)
      for (let i = 0; i < f.nx; i++) {
        const v = h[j * f.nx + i];
        if (v < sheenM) continue;
        w += v; sx += v * i; sy += v * j;
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      }
    if (!(w > 0)) return null;
    const [lon, lat] = plane.toLonLat(x0 + (sx / w + 0.5) * f.dx, y0 + (sy / w + 0.5) * f.dx);
    const corners = [[i0, j0], [i0, j1 + 1], [i1 + 1, j0], [i1 + 1, j1 + 1]].map(([i, j]) => plane.toLonLat(x0 + i * f.dx, y0 + j * f.dx));
    const lons = corners.map((c) => c[0]), lats = corners.map((c) => c[1]);
    return { lon, lat, wLon: Math.min(...lons), sLat: Math.min(...lats), eLon: Math.max(...lons), nLat: Math.max(...lats) };
  }

  /** Surface drift over open water on a grid around the spill area (at most 16 × 16 arrows, at least 800 m apart). */
  private arrows(s: Spill, f: Frame): number[] {
    const Lx = f.nx * f.dx * 1.6, Ly = f.ny * f.dx * 1.6, sp = Math.max(800, Math.max(Lx, Ly) / 16), out: number[] = [];
    for (let y = f.oy - Ly / 2 + sp / 2; y < f.oy + Ly / 2; y += sp)
      for (let x = f.ox - Lx / 2 + sp / 2; x < f.ox + Lx / 2; x += sp) {
        const [u, w] = s.field.driftAt(x, y), [lon, lat] = s.plane.toLonLat(x, y);
        out.push(lon, lat, u, w, sp);
      }
    return out;
  }
}
