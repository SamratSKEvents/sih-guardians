// The per-block work of a SparseMaster sweep, shared by the sequential solver and the sweep threads (pool.ts), so both
// run exactly the same arithmetic. Every function reads the current state of a block and its neighbours and writes
// only the block's own "next" arrays (or its flow cache), so blocks can run in any order or in parallel.
import { SurfaceFlow } from './flow';
import { FilmFlux, type FilmFluxParams } from './thinfilm';
import { OilLayer } from './twolayer';

const DRY = OilLayer.DRY;

/** Halo width, cells (see sparse.ts). */
export const G = 4;

export interface BlockData {
  readonly bi: number;
  readonly bj: number;
  h: Float64Array; qx: Float64Array; qy: Float64Array;
  nh: Float64Array; nqx: Float64Array; nqy: Float64Array; // next state of the running sweep
  hb: Float64Array; // thickness before the film sub-steps
  aU: Float64Array; aV: Float64Array; cW: Float64Array; cU: Float64Array; cV: Float64Array; // cached flow per cell
  /** Per-block results a task hands back: [Σh, Σnh or Σh after, i0, i1, j0, j1 (cells above hAlloc), max, –]. */
  res: Float64Array;
}

export const RES = 8;

export type Lookup = (bi: number, bj: number) => BlockData | undefined;

/** Surface-drift constants of one sweep (CoastalCore.targets with the water at rest). */
export interface DriftArgs { mu: number; mv: number; baseU: number; baseV: number; lax: number; lay: number; lag: number; lagRef: number }

export function driftArgs(flow: SurfaceFlow): DriftArgs {
  const [mu, mv] = flow.mean(), [lax, lay, lW] = flow.alongWind(), lagRef = flow.p.sheenLagRefUm * 1e-6;
  return { mu, mv, baseU: flow.p.driftU, baseV: flow.p.driftV, lax, lay, lag: flow.p.sheenLagFrac * lW * lagRef, lagRef };
}

export class BlockKernels {
  readonly P: number;
  readonly oil: OilLayer;
  readonly film: FilmFlux;
  readonly tu: Float64Array;
  readonly tv: Float64Array;
  readonly pad: Float64Array;

  constructor(readonly B: number, readonly dx: number) {
    const P = (this.P = B + 2 * G);
    this.oil = new OilLayer(P, P, dx, new Uint8Array(P * P));
    this.film = new FilmFlux(P, P);
    this.tu = new Float64Array(P * P);
    this.tv = new Float64Array(P * P);
    this.pad = new Float64Array(P * P);
  }

  /** Copy b and a g-cell halo of its neighbours' `field` into out, (B + 2g)² row-major; missing blocks are empty water. */
  gather(b: BlockData, lookup: Lookup, g: number, field: 'h' | 'qx' | 'qy', out: Float64Array | Float32Array) {
    const B = this.B, P = B + 2 * g;
    out.fill(0);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const n = di === 0 && dj === 0 ? b : lookup(b.bi + di, b.bj + dj);
        if (!n) continue;
        const src = n[field];
        const js = dj < 0 ? B - g : 0, jn = dj === 0 ? B : g, jd = dj < 0 ? 0 : dj === 0 ? g : g + B;
        const is = di < 0 ? B - g : 0, iN = di === 0 ? B : g, id = di < 0 ? 0 : di === 0 ? g : g + B;
        for (let j = 0; j < jn; j++) {
          const s = (js + j) * B + is;
          out.set(src.subarray(s, s + iN), (jd + j) * P + id);
        }
      }
  }

  private interior(from: Float64Array, to: Float64Array) {
    const { B, P } = this;
    for (let j = 0; j < B; j++) { const r = (j + G) * P + G; to.set(from.subarray(r, r + B), j * B); }
  }

  /** Surface drift for block b's current thickness into tu/tv (padded, halo g), or for cell k only. */
  drift(b: BlockData, d: DriftArgs, tu: Float64Array, tv: Float64Array, g: number, only = -1) {
    const { B } = this, P = B + 2 * g, { mu, mv, baseU, baseV, lax, lay, lag, lagRef } = d;
    for (let k = only < 0 ? 0 : only; k < (only < 0 ? B * B : only + 1); k++) {
      const pk = (Math.floor(k / B) + g) * P + (k % B) + g, lagK = lag / (b.h[k] + lagRef);
      // A custom current overrides the background current smoothly; windage and eddies remain additive.
      tu[pk] = b.cU[k] + (1 - b.cW[k]) * baseU + (mu - baseU) + b.aU[k] - lagK * lax;
      tv[pk] = b.cV[k] + (1 - b.cW[k]) * baseV + (mv - baseV) + b.aV[k] - lagK * lay;
    }
  }

  /** Oil-layer step (SSP-RK2 fluxes, drag, no coast) of block b into its next arrays. */
  oilBlock(b: BlockData, lookup: Lookup, dt: number, gp: number, Ci: number, d: DriftArgs) {
    const { oil, tu, tv } = this;
    this.gather(b, lookup, G, 'h', oil.h);
    if (!oil.h.some((v) => v !== 0)) { b.nh.set(b.h); b.nqx.set(b.qx); b.nqy.set(b.qy); return; } // the kernel would change nothing
    this.gather(b, lookup, G, 'qx', oil.qx); this.gather(b, lookup, G, 'qy', oil.qy);
    this.drift(b, d, tu, tv, G);
    oil.step(dt, gp, Ci, tu, tv, 0);
    this.interior(oil.h, b.nh); this.interior(oil.qx, b.nqx); this.interior(oil.qy, b.nqy);
  }

  /** One explicit film step of block b into its next thickness. */
  filmBlock(b: BlockData, lookup: Lookup, dt: number, fp: FilmFluxParams) {
    this.gather(b, lookup, G, 'h', this.pad);
    this.film.apply(this.pad, this.dx, dt, fp, false, null, null, null);
    this.interior(this.pad, b.nh);
  }

  /** After a sweep: res[0] = Σh, res[1] = Σnh, res[2..5] = extent of nh (the next current state). */
  commitStats(b: BlockData, hAlloc: number) {
    let s0 = 0, s1 = 0;
    for (let k = 0; k < b.h.length; k++) { s0 += b.h[k]; s1 += b.nh[k]; }
    b.res[0] = s0; b.res[1] = s1;
    this.extent(b.nh, hAlloc, b.res);
  }

  /** res[2..5] = inclusive cell range of values above hAlloc (i1 < 0 when none). */
  extent(h: Float64Array, hAlloc: number, res: Float64Array) {
    const B = this.B;
    let i0 = B, i1 = -1, j0 = B, j1 = -1;
    for (let j = 0; j < B; j++)
      for (let i = 0; i < B; i++)
        if (h[j * B + i] > hAlloc) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; j1 = j; }
    res[2] = i0; res[3] = i1; res[4] = j0; res[5] = j1;
  }

  /** res[6] = fastest signal speed |u| + √(g′h) over the block's oil (for the CFL limit). */
  speed(b: BlockData, gp: number) {
    let smax = 0;
    for (let k = 0; k < b.h.length; k++) {
      const h = b.h[k];
      if (h > DRY) smax = Math.max(smax, Math.hypot(b.qx[k], b.qy[k]) / h + Math.sqrt(gp * h));
    }
    b.res[6] = smax;
  }

  /** Before the film sub-steps: res[6] = max h, and keep h in hb. */
  filmPre(b: BlockData) {
    let m = 0;
    for (const v of b.h) if (v > m) m = v;
    b.res[6] = m;
    b.hb.set(b.h);
  }

  /** After the film sub-steps: momentum follows the moved mass (velocity kept); res[0] = Σh. */
  filmPost(b: BlockData) {
    let s = 0;
    for (let k = 0; k < b.h.length; k++) {
      const hb = b.hb[k];
      if (hb > DRY) { const r = b.h[k] / hb; b.qx[k] *= r; b.qy[k] *= r; } else { b.qx[k] = 0; b.qy[k] = 0; }
      s += b.h[k];
    }
    b.res[0] = s;
  }

  /** Weathering: scale thickness and momentum; res[2..5] = new extent. */
  scale(b: BlockData, factor: number, hAlloc: number) {
    for (let k = 0; k < b.h.length; k++) { b.h[k] *= factor; b.qx[k] *= factor; b.qy[k] *= factor; }
    this.extent(b.h, hAlloc, b.res);
  }

  /** Eddies, windrows and drawn currents at the block's cell centres, at flow time t (as CoastalCore.targets). */
  flowBlock(b: BlockData, flow: SurfaceFlow, t: number) {
    const { B, dx } = this, o = { u: 0, v: 0 }, c = { w: 0, u: 0, v: 0 };
    for (let j = 0; j < B; j++)
      for (let i = 0; i < B; i++) {
        const x = (b.bi * B + i + 0.5) * dx, y = (b.bj * B + j + 0.5) * dx, k = j * B + i;
        o.u = 0; o.v = 0;
        flow.anomaly(x, y, t, o);
        b.aU[k] = o.u; b.aV[k] = o.v;
        flow.currentOverride(x, y, c);
        b.cW[k] = c.w; b.cU[k] = c.u; b.cV[k] = c.v;
      }
  }
}
