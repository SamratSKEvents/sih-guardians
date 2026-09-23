// The master slick on an unbounded, sparsely stored grid. Same physics and numerics as MasterModel's oil: the
// two-layer model's oil-layer momentum (OilLayer: reduced-gravity spreading, drag towards the surface drift, SSP-RK2)
// followed by the thin film's rupture, K_h and shear-dispersion fluxes (FilmFlux), then weathering. What changes is the
// storage: thickness and momentum live in B × B cell blocks that exist only where there is oil (plus a margin), on an
// endless plane of dx cells. Open ocean: no water layer, no coast, so nothing strands and nothing leaves.
//
// One coupled solver, not one model per block. Each operator sweep gathers every block with a G-cell halo from its eight
// neighbours (all reading the same old state), runs the unchanged 2-D kernel on that padded (B + 2G)² array and keeps
// the interior (kernels.ts). G = 4 covers everything the interior reads: the second SSP-RK2 stage needs stage-1 values
// two cells outside, which depend on cells four out, and the film positivity limiter needs donor ratios one cell out,
// which read three out. A face two blocks share therefore sees identical inputs from both sides and carries the same
// flux, so the field equals the monolithic grid's (tests/film.test.ts runs it against MasterModel). Because every block
// reads only old state, a sweep may also run on several threads (pool.ts) with bit-identical results.
//
// Cell (I, J) has its centre at ((I + ½)·dx, (J + ½)·dx) metres from the origin, the same coordinates MasterModel's
// 256² grid uses about its centre, so both sample identical synthetic flow.
import { subSeed } from '../rng/prng';
import { monotonicNow as now } from '../runtime';
import { DEFAULT_WEATHERING } from '../particles/weathering';
import { Budget, G as GRAVITY, RHO_WATER, type Frame } from './grid';
import { SurfaceFlow, type FlowParams } from './flow';
import { oilDrift, type FilmFluxParams } from './thinfilm';
import { entrainmentAt, type MASTER_DEFAULTS } from './master';
import { rasterise, type Polygon, type SlickProfile } from './shapes';
import { finish, rasteriseBlocks, type BlockShares } from './raster';
import { BlockKernels, G, RES, driftArgs, type BlockData } from './kernels';
import { SweepPool, type RunTask, type SharedBlock } from './pool';

export type SparseParams = typeof MASTER_DEFAULTS & Record<string, number>;

/** Float64 arrays of B² cells per block (h, qx, qy, their next state, hb, 5 flow caches): the memory estimate. */
export const BLOCK_ARRAYS = 12;

/** A block within this many cells of oil is allocated before the next sweep; one sweep moves oil at most 4 cells. */
const BAND = 8;

export interface Block extends BlockData {
  // cells holding oil above the allocation threshold, inclusive; i1 < 0 when none
  i0: number; i1: number; j0: number; j1: number;
}

/** Wall time (ms) spent in each stage: per sweep or per block, never per cell. */
export type SparseProfile = Record<'flow' | 'oil' | 'film' | 'commit' | 'scan' | 'rasterise' | 'release', number>;

const key = (bi: number, bj: number) => (bi + 32768) * 65536 + (bj + 32768);

export class SparseMaster {
  readonly blocks = new Map<number, Block>();
  readonly flow: SurfaceFlow;
  budget = new Budget(0);
  t = 0;
  lastDt = 0; substeps = 0; filmSubsteps = 0;
  prof: SparseProfile = { flow: 0, oil: 0, film: 0, commit: 0, scan: 0, rasterise: 0, release: 0 };
  private anomT = -Infinity;
  private anomVersion = -1;
  private readonly kernels: BlockKernels;
  private readonly lookup = (bi: number, bj: number) => this.blocks.get(key(bi, bj));
  private readonly pool: SweepPool | null;
  private readonly spill: number;
  private readonly flowSeed: number;
  private readonly flowParams: FlowParams;
  private poolFlowVersion = -1;

  /**
   * B: block size, cells. hAlloc: thickness (m) that keeps a block and its neighbours allocated; oil thinner than this
   * that drifts into unallocated space is dropped and booked as `trimmed`; 0 keeps every non-zero value (exact).
   * dtScale < 1 shrinks every step limit (60 s cap and oil CFL) by that factor: for convergence studies only.
   * filmDtScale controls film-only subcycling and defaults to dtScale.
   * pool: sweep threads (used only when its B and dx match). flowEvery: seconds between flow samplings (the Master: 600).
   */
  constructor(readonly params: SparseParams, readonly B = 64, readonly dx = 50, readonly hAlloc = 1e-10, readonly dtScale = 1, pool: SweepPool | null = null, readonly flowEvery = 600, readonly filmDtScale = dtScale) {
    this.flowSeed = subSeed(params.seed, 1);
    this.flowParams = { ...params };
    this.flow = new SurfaceFlow(params, this.flowSeed);
    this.kernels = new BlockKernels(B, dx);
    this.pool = pool && pool.B === B && pool.dx === dx ? pool : null;
    this.spill = this.pool ? this.pool.newSpill() : -1;
  }

  get threads() { return this.pool?.threads ?? 1; }

  /** Return shared slots when a run is replaced; dropping the JS map alone leaks the pool's backing slabs. */
  dispose() {
    for (const b of this.blocks.values()) this.pool?.release(b as unknown as SharedBlock);
    this.blocks.clear();
  }

  gPrime() { return (GRAVITY * (RHO_WATER - this.params.oilDensity)) / RHO_WATER; }
  dispersionRate() { return this.params.permanentShare * entrainmentAt(this.params.windSpeed); }

  filmParams(): FilmFluxParams {
    const p = this.params;
    return { gPrime: this.gPrime(), spreadC: p.spreadC, Kh: p.Kh, hTerminal: p.hTerminalUm * 1e-6, lensD: p.lensD, lensWavelengthM: p.lensWavelengthM, ...oilDrift(this.flow), lag: 0 };
  }

  block(bi: number, bj: number): Block {
    let b = this.blocks.get(key(bi, bj));
    if (b) return b;
    const extent = { i0: 0, i1: -1, j0: 0, j1: -1 };
    if (this.pool) b = Object.assign(this.pool.alloc(this.spill, bi, bj), extent);
    else {
      const N = this.B * this.B, f = () => new Float64Array(N);
      b = { bi, bj, h: f(), qx: f(), qy: f(), nh: f(), nqx: f(), nqy: f(), hb: f(), aU: f(), aV: f(), cW: f(), cU: f(), cV: f(), res: new Float64Array(RES), ...extent };
    }
    this.blocks.set(key(bi, bj), b);
    if (Number.isFinite(this.anomT)) this.kernels.flowBlock(b, this.flow, this.anomT);
    return b;
  }

  // ponytail: flow refreshed every flowEvery (600 s, as MasterModel) for every block; eddies evolve over days
  private refreshFlow() {
    if (Math.abs(this.t - this.anomT) < this.flowEvery && this.anomVersion === this.flow.version) return;
    const t0 = now();
    this.anomT = this.t;
    this.anomVersion = this.flow.version;
    this.each({ task: 'flow', spill: this.spill, time: this.anomT, params: { ...this.params } }, (b) => this.kernels.flowBlock(b, this.flow, this.anomT));
    this.prof.flow += now() - t0;
  }

  /** Run a per-block task over every block, on the pool or here (the same kernel either way); returns the blocks in order. */
  private each(task: RunTask, here: (b: Block) => void): Block[] {
    const list = [...this.blocks.values()];
    if (!this.onThreads(list, task)) for (const b of list) here(b);
    return list;
  }

  /** The block's extent from the task results. */
  private static extentFromRes(b: Block) { b.i0 = b.res[2]; b.i1 = b.res[3]; b.j0 = b.res[4]; b.j1 = b.res[5]; }

  /** Run a sweep task on the pool when there is one and enough blocks; false means run it here. */
  private onThreads(list: Block[], task: RunTask): boolean {
    const pool = this.pool;
    if (!pool || list.length < pool.minBlocks) return false;
    if (this.poolFlowVersion !== this.flow.version) { pool.flow(this.spill, this.flowSeed, this.flowParams, this.flow.regions); this.poolFlowVersion = this.flow.version; }
    return pool.run(list as unknown as SharedBlock[], task);
  }

  /** Thickness of b with a g-cell halo, (B + 2g)², into out. */
  gather(b: Block, g: number, field: 'h' | 'qx' | 'qy', out: Float64Array | Float32Array) {
    this.kernels.gather(b, this.lookup, g, field, out);
  }

  /**
   * Swap next ↔ current for the blocks a sweep computed (each reported Σh, Σnh and its new extent); volume the sweep
   * lost at unallocated edges (or gained by clamping) is booked as trimmed.
   */
  private commit(list: Block[], momentum: boolean) {
    const t0 = now();
    let before = 0, after = 0;
    for (const b of list) {
      before += b.res[0]; after += b.res[1];
      [b.h, b.nh] = [b.nh, b.h];
      if (momentum) { [b.qx, b.nqx] = [b.nqx, b.qx]; [b.qy, b.nqy] = [b.nqy, b.qy]; }
      if (this.pool) SweepPool.swap(b as unknown as SharedBlock, momentum);
      SparseMaster.extentFromRes(b);
    }
    this.budget.trimmed += (before - after) * this.dx * this.dx;
    this.grow();
    this.prof.commit += now() - t0;
  }

  /** One oil-layer step (SSP-RK2 fluxes, drag, no coast) over every block. */
  private oilSweep(dt: number) {
    const t0 = now(), gp = this.gPrime(), Ci = this.params.spreadC, drift = driftArgs(this.flow), { hAlloc, kernels } = this;
    const list = this.each({ task: 'oil', spill: this.spill, dt, gp, Ci, drift, hAlloc }, (b) => { kernels.oilBlock(b, this.lookup, dt, gp, Ci, drift); kernels.commitStats(b, hAlloc); });
    this.prof.oil += now() - t0;
    this.commit(list, true);
  }

  /** One explicit film step over every block. */
  private filmSweep(dt: number, fp: FilmFluxParams) {
    const t0 = now(), { hAlloc, kernels } = this;
    const list = this.each({ task: 'film', spill: this.spill, dt, fp, hAlloc }, (b) => { kernels.filmBlock(b, this.lookup, dt, fp); kernels.commitStats(b, hAlloc); });
    this.prof.film += now() - t0;
    this.commit(list, false);
  }

  /** Allocate every block within BAND cells of oil; with `retire`, drop blocks no oil is near (booking what they held). */
  private grow(retire = false) {
    const { B } = this, want = new Set<number>();
    for (const b of this.blocks.values()) {
      if (b.i1 < 0) continue;
      const w = b.i0 < BAND ? -1 : 0, e = b.i1 >= B - BAND ? 1 : 0, s = b.j0 < BAND ? -1 : 0, n = b.j1 >= B - BAND ? 1 : 0;
      for (let dj = s; dj <= n; dj++) for (let di = w; di <= e; di++) want.add(key(b.bi + di, b.bj + dj));
    }
    for (const k of want) if (!this.blocks.has(k)) this.block(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
    if (!retire) return;
    for (const [k, b] of this.blocks) {
      if (want.has(k)) continue;
      let v = 0;
      for (const x of b.h) v += x;
      this.budget.trimmed += v * this.dx * this.dx;
      this.blocks.delete(k);
      this.pool?.release(b as unknown as SharedBlock);
    }
  }

  /**
   * How a drawn slick becomes cells: 'blocks' (raster.ts: scanline spans straight into blocks) or 'dense' (the original
   * shapes.rasterise over a frame covering the shape, kept as the reference). Uniform releases come out identical.
   */
  raster: 'blocks' | 'dense' = 'blocks';

  /** Place a drawn slick (plane metres); new oil starts at the surface drift. Returns the volume placed. */
  addOil(poly: Polygon, volumeM3: number, profile: SlickProfile): number {
    return finish(this.addOilSteps([poly], volumeM3, profile));
  }

  /** addOil in row batches (yields progress 0–1), so a worker can answer messages or cancel meanwhile; rings are even-odd. */
  *addOilSteps(rings: Polygon[], volumeM3: number, profile: SlickProfile): Generator<number, number> {
    const t0 = now();
    const shares = this.raster === 'blocks' || rings.length > 1 ? yield* rasteriseBlocks(rings, profile, this.dx, this.B) : this.denseShares(rings[0], profile);
    this.prof.rasterise += now() - t0;
    this.addShares(shares, volumeM3);
    return volumeM3;
  }

  /** The original path: shapes.rasterise on a frame aligned to the global cells that covers the shape. */
  denseShares(poly: Polygon, profile: SlickProfile): BlockShares {
    const { B, dx } = this;
    const I0 = Math.floor(poly.minX / dx) - 1, J0 = Math.floor(poly.minY / dx) - 1;
    const nx = Math.floor(poly.maxX / dx) + 2 - I0, ny = Math.floor(poly.maxY / dx) + 2 - J0;
    const f: Frame = { nx, ny, dx, lat0: 0, lon0: 0, ox: (I0 + nx / 2) * dx, oy: (J0 + ny / 2) * dx };
    const { share } = rasterise(f, poly, profile, null);
    const blocks = new Map<number, Float64Array>();
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = share[j * nx + i];
        if (!(v > 0)) continue;
        const I = I0 + i, J = J0 + j, bi = Math.floor(I / B), bj = Math.floor(J / B), k = key(bi, bj);
        let a = blocks.get(k);
        if (!a) { a = new Float64Array(B * B); blocks.set(k, a); }
        a[(J - bj * B) * B + (I - bi * B)] = v;
      }
    return { B, dx, blocks };
  }

  /** Add a rasterised release of volumeM3; new oil starts at the surface drift. */
  addShares(s: BlockShares, volumeM3: number) {
    const t0 = now(), { B, dx } = this, cells: [Block, Float64Array][] = [];
    for (const [k, a] of s.blocks) if (a.some((v) => (v * volumeM3) / (dx * dx) > 0)) cells.push([this.block(Math.floor(k / 65536) - 32768, (k % 65536) - 32768), a]);
    this.refreshFlow();
    const { tu, tv, P } = this.kernels, drift = driftArgs(this.flow);
    for (const [b, a] of cells) {
      for (let k = 0; k < a.length; k++) {
        const dh = (a[k] * volumeM3) / (dx * dx);
        if (dh <= 0) continue;
        this.kernels.drift(b, drift, tu, tv, G, k);
        const pk = (Math.floor(k / B) + G) * P + (k % B) + G;
        b.h[k] += dh; b.qx[k] += dh * tu[pk]; b.qy[k] += dh * tv[pk];
      }
      this.extent(b);
    }
    this.grow();
    this.budget.add(volumeM3);
    this.prof.release += now() - t0;
  }

  private extent(b: Block) {
    this.kernels.extent(b.h, this.hAlloc, b.res);
    SparseMaster.extentFromRes(b);
  }

  volume(): number {
    let s = 0;
    for (const b of this.blocks.values()) for (const v of b.h) s += v;
    return s * this.dx * this.dx;
  }

  /** Advance by dt seconds: CoastalCore.advance + MasterModel's film step, over the blocks. */
  step(dt: number) {
    const p = this.params, { dx, hAlloc, kernels, spill } = this, gp = this.gPrime();
    let done = 0;
    this.substeps = 0; this.filmSubsteps = 0;
    while (done < dt - 1e-9) {
      this.refreshFlow();
      let ts = now(), smax = 0;
      for (const b of this.each({ task: 'speed', spill, gp }, (b) => kernels.speed(b, gp))) smax = Math.max(smax, b.res[6]);
      const sub = Math.min(dt - done, 60 * this.dtScale, (0.3 * this.dtScale * dx) / Math.max(smax, 1e-6));
      this.prof.scan += now() - ts;
      let vol = 0;
      if (this.blocks.size) {
        this.oilSweep(sub);
        vol = this.filmStep(sub);
      }
      ts = now();
      this.t += sub;
      const factor = this.budget.weather(vol * dx * dx, this.t, sub, p.sst, this.dispersionRate(), { ...DEFAULT_WEATHERING, evapMax: p.evapMax });
      if (factor !== 1) for (const b of this.each({ task: 'scale', spill, factor, hAlloc }, (b) => kernels.scale(b, factor, hAlloc))) SparseMaster.extentFromRes(b);
      this.grow(true);
      this.prof.scan += now() - ts;
      done += sub;
      this.lastDt = sub;
      this.substeps++;
    }
  }

  /** Rupture + K_h as mass fluxes after the momentum step; velocity is kept, so momentum follows the moved mass. Returns Σh. */
  private filmStep(sub: number): number {
    const fp = this.filmParams(), { kernels, spill } = this;
    let ts = now(), hMax = 0;
    for (const b of this.each({ task: 'filmPre', spill }, (b) => kernels.filmPre(b))) hMax = Math.max(hMax, b.res[6]);
    const n = Math.max(1, Math.ceil(sub / (this.filmDtScale * kernels.film.dtLimit(hMax, this.dx, fp, false))));
    this.prof.scan += now() - ts;
    for (let s = 0; s < n; s++) this.filmSweep(sub / n, fp);
    this.filmSubsteps += n;
    ts = now();
    let vol = 0;
    // blocks allocated during the film sub-steps start from zero: their hb is zero, so their momentum stays zero
    for (const b of this.each({ task: 'filmPost', spill }, (b) => kernels.filmPost(b))) vol += b.res[0];
    this.prof.scan += now() - ts;
    return vol;
  }

  /** Surface drift at plane point (x, y) over open water (for arrows). */
  vectorsAt(x: number, y: number): { wind: [number, number]; current: [number, number]; drift: [number, number] } {
    this.refreshFlow();
    const o = { u: 0, v: 0 }, c = { w: 0, u: 0, v: 0 };
    this.flow.anomaly(x, y, this.anomT, o);
    this.flow.currentOverride(x, y, c);
    const [wx, wy] = this.flow.wind(), [localWx, localWy] = this.flow.localWind(x, y), [mu, mv] = this.flow.mean();
    const [lax, lay, lW] = this.flow.alongWind(), lag = this.flow.p.sheenLagFrac * lW;
    // anomaly includes windage's local-wind delta; remove that part from the current arrows so each layer is honest.
    const current: [number, number] = [c.u + (1 - c.w) * this.params.driftU + o.u - this.params.windage * (localWx - wx), c.v + (1 - c.w) * this.params.driftV + o.v - this.params.windage * (localWy - wy)];
    const drift: [number, number] = [current[0] + this.params.windage * localWx - lag * lax, current[1] + this.params.windage * localWy - lag * lay];
    return { wind: [localWx, localWy], current, drift };
  }

  /** Surface drift at plane point (x, y) over open water (for arrows). */
  driftAt(x: number, y: number): [number, number] {
    return this.vectorsAt(x, y).drift;
  }
}
