// Drag-dominated reduced master: one conservative thickness field driven by the surface drift.
// The full SparseMaster remains available as the momentum-resolving reference solver.
import { subSeed } from '../rng/prng';
import { monotonicNow as now } from '../runtime';
import { DEFAULT_WEATHERING } from '../particles/weathering';
import { Budget, G as GRAVITY, RHO_WATER } from './grid';
import { SurfaceFlow, type FlowParams } from './flow';
import { FilmFlux, oilDrift, type FilmFluxParams } from './thinfilm';
import { entrainmentAt, type MASTER_DEFAULTS } from './master';
import { pointInPolygon } from '../curve/curve';
import { rasterise, type Polygon, type SlickProfile } from './shapes';
import { finish, rasteriseBlocks, type BlockShares } from './raster';
import { G, RES } from './kernels';
import type { SparseParams, SparseProfile } from './sparse';

const BAND = 8;
const GROW_TRIGGER = 4;

export interface ReducedBlock {
  readonly bi: number;
  readonly bj: number;
  h: Float64Array;
  nh: Float64Array;
  uFace: Float64Array;
  vFace: Float64Array;
  landPad: Uint8Array | null;
  res: Float64Array;
  /** Last `activeBlocks` pass that listed this block. */
  stamp: number;
}

type ReducedField = 'h';
type ReducedLookup = (bi: number, bj: number) => ReducedBlock | undefined;
type LandSampler = (x: number, y: number) => boolean;
const key = (bi: number, bj: number) => (bi + 32768) * 65536 + (bj + 32768);
const LAND_BUCKET_M = 20_000;
const BROAD_BUCKET_M = 100;
const landBucketKey = (i: number, j: number) => `${i}:${j}`;

class ReducedKernels {
  readonly P: number;
  readonly film: FilmFlux;
  readonly pad: Float64Array;
  readonly cellU: Float64Array;
  readonly cellV: Float64Array;
  readonly ufx: Float64Array;
  readonly vfy: Float64Array;

  constructor(readonly B: number, readonly dx: number) {
    this.P = B + 2 * G;
    this.film = new FilmFlux(this.P, this.P);
    this.pad = new Float64Array(this.P * this.P);
    this.cellU = new Float64Array(this.P * this.P);
    this.cellV = new Float64Array(this.P * this.P);
    this.ufx = new Float64Array((this.P + 1) * this.P);
    this.vfy = new Float64Array(this.P * (this.P + 1));
  }

  gather(b: ReducedBlock, lookup: ReducedLookup, g: number, field: ReducedField, out: Float64Array | Float32Array) {
    const B = this.B, P = B + 2 * g;
    out.fill(0);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
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

  private surfaceFaces(b: ReducedBlock) {
    const { P } = this;
    let maxSpeed = 0;
    for (let j = 0; j < P; j++) {
      const row = j * P, face = j * (P + 1);
      for (let i = 0; i <= P; i++) { const u = i === 0 ? this.cellU[row] : i === P ? this.cellU[row + P - 1] : 0.5 * (this.cellU[row + i - 1] + this.cellU[row + i]); this.ufx[face + i] = u; maxSpeed = Math.max(maxSpeed, Math.abs(u)); }
    }
    for (let j = 0; j <= P; j++) {
      const face = j * P;
      for (let i = 0; i < P; i++) { const v = j === 0 ? this.cellV[i] : j === P ? this.cellV[(P - 1) * P + i] : 0.5 * (this.cellV[(j - 1) * P + i] + this.cellV[j * P + i]); this.vfy[face + i] = v; maxSpeed = Math.max(maxSpeed, Math.abs(v)); }
    }
    b.uFace.set(this.ufx); b.vFace.set(this.vfy);
    b.res[7] = maxSpeed;
  }

  transportBlock(b: ReducedBlock, lookup: ReducedLookup, dt: number, fp: FilmFluxParams, hAlloc: number) {
    this.gather(b, lookup, G, 'h', this.pad);
    this.film.apply(this.pad, this.dx, dt, fp, true, b.landPad, b.uFace, b.vFace);
    this.interior(this.pad, b.nh);
    this.commitStats(b, hAlloc);
  }

  commitStats(b: ReducedBlock, hAlloc: number) {
    let s0 = 0, s1 = 0, max = 0;
    for (let k = 0; k < b.h.length; k++) { s0 += b.h[k]; s1 += b.nh[k]; max = Math.max(max, b.nh[k]); }
    b.res[0] = s0; b.res[1] = s1;
    b.res[6] = max;
    this.extent(b.nh, hAlloc, b.res);
  }

  currentStats(b: ReducedBlock, hAlloc: number) {
    let sum = 0, max = 0;
    for (const h of b.h) { sum += h; max = Math.max(max, h); }
    b.res[0] = sum; b.res[6] = max;
    this.extent(b.h, hAlloc, b.res);
    return sum;
  }

  extent(h: Float64Array, hAlloc: number, res: Float64Array) {
    const B = this.B;
    let i0 = B, i1 = -1, j0 = B, j1 = -1;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) if (h[j * B + i] > hAlloc) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; j1 = j; }
    res[2] = i0; res[3] = i1; res[4] = j0; res[5] = j1;
  }

  scale(b: ReducedBlock, factor: number, hAlloc: number) {
    for (let k = 0; k < b.h.length; k++) b.h[k] *= factor;
    this.currentStats(b, hAlloc);
  }

  flowBlock(b: ReducedBlock, flow: SurfaceFlow, t: number) {
    const { B, P, dx } = this, o = { u: 0, v: 0 }, c = { w: 0, u: 0, v: 0 }, [mu, mv] = flow.mean(), baseU = flow.p.driftU, baseV = flow.p.driftV;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const x = (b.bi * B + i - G + 0.5) * dx, y = (b.bj * B + j - G + 0.5) * dx, k = j * P + i;
      o.u = 0; o.v = 0; flow.anomaly(x, y, t, o); flow.currentOverride(x, y, c);
      this.cellU[k] = c.u + (1 - c.w) * baseU + (mu - baseU) + o.u;
      this.cellV[k] = c.v + (1 - c.w) * baseV + (mv - baseV) + o.v;
    }
    this.surfaceFaces(b);
  }
}

export class SparseReducedMaster {
  readonly blocks = new Map<number, ReducedBlock>();
  readonly flow: SurfaceFlow;
  budget = new Budget(0);
  t = 0;
  lastDt = 0;
  substeps = 0;
  filmSubsteps = 0;
  prof: SparseProfile = { flow: 0, oil: 0, film: 0, commit: 0, scan: 0, rasterise: 0, release: 0 };
  private anomT = -Infinity;
  private anomVersion = -1;
  private readonly kernels: ReducedKernels;
  private readonly lookup: ReducedLookup = (bi, bj) => this.blocks.get(key(bi, bj));
  private landPolygons: Polygon[] = [];
  private landBuckets = new Map<string, Polygon[]>();
  private broadLand: Polygon[] = [];
  private broadCache = new Map<string, boolean>();
  private landSampler: LandSampler | null = null;
  private totalThickness = 0;
  private maxSpeed = 0;
  private readonly flowSeed: number;
  private readonly flowParams: FlowParams;

  constructor(readonly params: SparseParams, readonly B = 64, readonly dx = 50, readonly hAlloc = 1e-10, readonly dtScale = 1, readonly filmDtScale = dtScale, readonly flowEvery = 600) {
    this.flowSeed = subSeed(params.seed, 1);
    this.flowParams = { ...params };
    this.flow = new SurfaceFlow(params, this.flowSeed);
    this.kernels = new ReducedKernels(B, dx);
  }

  get threads() { return 1; }

  dispose() { this.blocks.clear(); this.totalThickness = 0; this.maxSpeed = 0; }

  setLand(polygons: Polygon[]) {
    this.landPolygons = polygons;
    this.landBuckets = new Map(); this.broadLand = []; this.broadCache = new Map();
    for (const p of polygons) {
      const i0 = Math.floor(p.minX / LAND_BUCKET_M), i1 = Math.floor(p.maxX / LAND_BUCKET_M);
      const j0 = Math.floor(p.minY / LAND_BUCKET_M), j1 = Math.floor(p.maxY / LAND_BUCKET_M);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 65_536) { this.broadLand.push(p); continue; }
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = landBucketKey(i, j), bucket = this.landBuckets.get(k);
        if (bucket) bucket.push(p); else this.landBuckets.set(k, [p]);
      }
    }
    this.landSampler = polygons.length ? (x, y) => this.containsLand(x, y) : null;
    let stranded = 0;
    for (const b of this.blocks.values()) {
      b.landPad = this.landSampler ? this.landMask(b.bi, b.bj) : null;
      if (b.landPad) {
        const P = this.B + 2 * G;
        for (let j = 0; j < this.B; j++) for (let i = 0; i < this.B; i++) {
          const k = j * this.B + i;
          if (!b.landPad[(j + G) * P + i + G]) continue;
          stranded += b.h[k] * this.dx * this.dx;
          b.h[k] = 0; b.nh[k] = 0;
        }
      }
      this.kernels.currentStats(b, this.hAlloc);
    }
    // Land replacement can remove oil from any existing block; rebuild the scalar cache once.
    if (this.blocks.size) {
      this.totalThickness = 0;
      for (const b of this.blocks.values()) this.totalThickness += b.res[0];
    }
    this.budget.stranded += stranded;
  }

  private containsLand(x: number, y: number) {
    const candidates = this.landBuckets.get(landBucketKey(Math.floor(x / LAND_BUCKET_M), Math.floor(y / LAND_BUCKET_M))) ?? [];
    let inside = false;
    const ci = Math.floor(x / BROAD_BUCKET_M), cj = Math.floor(y / BROAD_BUCKET_M);
    for (let n = 0; n < this.broadLand.length; n++) {
      const p = this.broadLand[n], k = `${n}:${ci}:${cj}`;
      let hit = this.broadCache.get(k);
      if (hit === undefined) {
        const sx = (ci + 0.5) * BROAD_BUCKET_M, sy = (cj + 0.5) * BROAD_BUCKET_M;
        hit = sx >= p.minX && sx <= p.maxX && sy >= p.minY && sy <= p.maxY && pointInPolygon(sx, sy, p.x, p.y);
        this.broadCache.set(k, hit);
      }
      if (hit) inside = !inside;
    }
    for (const p of candidates) if (x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY && pointInPolygon(x, y, p.x, p.y)) inside = !inside;
    return inside;
  }

  private landMask(bi: number, bj: number) {
    if (!this.landSampler) return null;
    const P = this.B + 2 * G;
    const land = new Uint8Array(P * P);
    let touchesLand = false;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const hit = this.landSampler((bi * this.B + i - G + 0.5) * this.dx, (bj * this.B + j - G + 0.5) * this.dx);
      land[j * P + i] = hit ? 1 : 0;
      touchesLand ||= hit;
    }
    return touchesLand ? land : null;
  }

  gPrime() { return (GRAVITY * (RHO_WATER - this.params.oilDensity)) / RHO_WATER; }
  dispersionRate() { return this.params.permanentShare * entrainmentAt(this.params.windSpeed); }
  filmParams(): FilmFluxParams { return { gPrime: this.gPrime(), spreadC: this.params.spreadC, Kh: this.params.Kh, hTerminal: this.params.hTerminalUm * 1e-6, lensD: this.params.lensD, lensWavelengthM: this.params.lensWavelengthM, ...oilDrift(this.flow), lag: 0 }; }

  block(bi: number, bj: number): ReducedBlock {
    let b = this.blocks.get(key(bi, bj));
    if (b) return b;
    const N = this.B * this.B, f = () => new Float64Array(N), faceX = new Float64Array((this.B + 2 * G + 1) * (this.B + 2 * G)), faceY = new Float64Array((this.B + 2 * G) * (this.B + 2 * G + 1));
    b = { bi, bj, h: f(), nh: f(), uFace: faceX, vFace: faceY, landPad: this.landMask(bi, bj), res: new Float64Array(RES), stamp: 0 };
    this.blocks.set(key(bi, bj), b);
    this.kernels.currentStats(b, this.hAlloc);
    if (Number.isFinite(this.anomT)) this.kernels.flowBlock(b, this.flow, this.anomT);
    this.maxSpeed = Math.max(this.maxSpeed, b.res[7]);
    return b;
  }

  private each(fn: (b: ReducedBlock) => void) { const list = [...this.blocks.values()]; for (const b of list) fn(b); return list; }

  private refreshFlow() {
    if (Math.abs(this.t - this.anomT) < this.flowEvery && this.anomVersion === this.flow.version) return;
    const t0 = now(); this.anomT = this.t; this.anomVersion = this.flow.version;
    this.maxSpeed = 0;
    this.each((b) => { this.kernels.flowBlock(b, this.flow, this.anomT); this.maxSpeed = Math.max(this.maxSpeed, b.res[7]); });
    this.prof.flow += now() - t0;
  }

  private commit(list: ReducedBlock[]) {
    const t0 = now(); let before = 0, after = 0;
    let nearEdge = false;
    for (const b of list) {
      before += b.res[0]; after += b.res[1]; [b.h, b.nh] = [b.nh, b.h];
      if (!nearEdge && b.res[3] >= 0) nearEdge = this.missingNeighbour(b);
    }
    this.totalThickness += after - before;
    this.budget.trimmed += (before - after) * this.dx * this.dx;
    // Normally the eight-cell margin is untouched. Extend it only when a front reaches the inner safety band.
    if (nearEdge) this.grow();
    this.prof.commit += now() - t0;
  }

  // Oil within the trigger band of an edge whose neighbour is not allocated yet.
  // Once a slick spans several blocks most of them sit near an internal edge, so
  // testing the edge alone would call grow() on nearly every substep.
  private missingNeighbour(b: ReducedBlock) {
    const w = b.res[2] < GROW_TRIGGER ? -1 : 0, e = b.res[3] >= this.B - GROW_TRIGGER ? 1 : 0;
    const s = b.res[4] < GROW_TRIGGER ? -1 : 0, n = b.res[5] >= this.B - GROW_TRIGGER ? 1 : 0;
    for (let dj = s; dj <= n; dj++) for (let di = w; di <= e; di++) {
      if ((di || dj) && !this.blocks.has(key(b.bi + di, b.bj + dj))) return true;
    }
    return false;
  }

  // Reused across substeps: at 10 m this runs hundreds of times a simulated minute.
  private readonly active: ReducedBlock[] = [];
  private generation = 0;

  private activeBlocks() {
    const active = this.active, gen = ++this.generation;
    active.length = 0;
    const mark = (b: ReducedBlock | undefined) => { if (b && b.stamp !== gen) { b.stamp = gen; active.push(b); } };
    for (const b of this.blocks.values()) {
      if (b.res[3] < 0) continue;
      mark(b);
      const w = b.res[2] < G, e = b.res[3] >= this.B - G, s = b.res[4] < G, n = b.res[5] >= this.B - G;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if ((di < 0 && !w) || (di > 0 && !e) || (dj < 0 && !s) || (dj > 0 && !n)) continue;
        mark(this.blocks.get(key(b.bi + di, b.bj + dj)));
      }
    }
    return active;
  }

  private grow(retire = false) {
    const want = new Set<number>();
    for (const b of this.blocks.values()) {
      if (b.res[3] < 0) continue;
      const w = b.res[2] < BAND ? -1 : 0, e = b.res[3] >= this.B - BAND ? 1 : 0, s = b.res[4] < BAND ? -1 : 0, n = b.res[5] >= this.B - BAND ? 1 : 0;
      for (let dj = s; dj <= n; dj++) for (let di = w; di <= e; di++) want.add(key(b.bi + di, b.bj + dj));
    }
    for (const k of want) if (!this.blocks.has(k)) this.block(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
    if (!retire) return;
    for (const [k, b] of this.blocks) {
      if (want.has(k)) continue;
      let v = 0; for (const x of b.h) v += x;
      this.totalThickness -= v;
      this.budget.trimmed += v * this.dx * this.dx;
      this.blocks.delete(k);
    }
  }

  addOil(poly: Polygon, volumeM3: number, profile: SlickProfile) { return finish(this.addOilSteps([poly], volumeM3, profile)); }

  *addOilSteps(rings: Polygon[], volumeM3: number, profile: SlickProfile): Generator<number, number> {
    const t0 = now();
    const shares = yield* rasteriseBlocks(rings, profile, this.dx, this.B);
    this.prof.rasterise += now() - t0;
    this.addShares(shares, volumeM3);
    return volumeM3;
  }

  denseShares(poly: Polygon): BlockShares {
    const { B, dx } = this, I0 = Math.floor(poly.minX / dx) - 1, J0 = Math.floor(poly.minY / dx) - 1;
    const nx = Math.floor(poly.maxX / dx) + 2 - I0, ny = Math.floor(poly.maxY / dx) + 2 - J0;
    const { share } = rasterise({ nx, ny, dx, lat0: 0, lon0: 0, ox: (I0 + nx / 2) * dx, oy: (J0 + ny / 2) * dx }, poly, 'uniform', null);
    const blocks = new Map<number, Float64Array>();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = share[j * nx + i]; if (!(v > 0)) continue; const I = I0 + i, J = J0 + j, bi = Math.floor(I / B), bj = Math.floor(J / B), k = key(bi, bj); let a = blocks.get(k); if (!a) { a = new Float64Array(B * B); blocks.set(k, a); } a[(J - bj * B) * B + (I - bi * B)] = v; }
    return { B, dx, blocks };
  }

  addShares(s: BlockShares, volumeM3: number) {
    const t0 = now(); let stranded = 0, added = 0;
    const P = this.B + 2 * G;
    for (const [k, a] of s.blocks) {
      const b = this.block(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
      for (let i = 0; i < a.length; i++) {
        const dh = (a[i] * volumeM3) / (this.dx * this.dx);
        const cellI = i % this.B, cellJ = Math.floor(i / this.B);
        if (b.landPad?.[(cellJ + G) * P + cellI + G]) stranded += dh * this.dx * this.dx;
        else { b.h[i] += dh; added += dh; }
      }
      this.kernels.currentStats(b, this.hAlloc);
    }
    this.totalThickness += added;
    this.refreshFlow(); this.grow(); this.budget.add(volumeM3); this.budget.stranded += stranded; this.prof.release += now() - t0;
  }

  private filmStep(sub: number) {
    const fp = this.filmParams(), t0 = now();
    let hMax = 0;
    for (const b of this.blocks.values()) hMax = Math.max(hMax, b.res[6]);
    const diffusionLimit = this.filmDtScale * this.kernels.film.dtLimit(hMax, this.dx, fp, true);
    const advectionLimit = this.maxSpeed > 0 ? 0.45 * this.dx / this.maxSpeed : Infinity;
    const stableDt = Math.min(diffusionLimit, advectionLimit);
    const steps = Math.max(1, Math.ceil(sub / stableDt));
    for (let s = 0; s < steps; s++) {
      const dt = sub / steps;
      const list = this.activeBlocks();
      if (!list.length) break;
      for (const b of list) this.kernels.transportBlock(b, this.lookup, dt, fp, this.hAlloc);
      this.commit(list);
    }
    this.filmSubsteps += steps; this.prof.film += now() - t0;
    return this.volume();
  }

  step(dt: number) {
    let done = 0; this.substeps = 0; this.filmSubsteps = 0;
    while (done < dt - 1e-9) {
      this.refreshFlow();
      const sub = Math.min(dt - done, 60 * this.dtScale);
      const vol = this.filmStep(sub);
      this.t += sub;
      const factor = this.budget.weather(vol, this.t, sub, this.params.sst, this.dispersionRate(), { ...DEFAULT_WEATHERING, evapMax: this.params.evapMax });
      if (factor !== 1) {
        for (const b of this.blocks.values()) this.kernels.scale(b, factor, this.hAlloc);
        this.totalThickness *= factor;
      }
      this.grow(true); done += sub; this.lastDt = sub; this.substeps++;
    }
  }

  volume() { return this.totalThickness * this.dx * this.dx; }

  gather(b: ReducedBlock, g: number, field: 'h', out: Float64Array | Float32Array) { this.kernels.gather(b, this.lookup, g, field, out); }

  vectorsAt(x: number, y: number) {
    this.refreshFlow();
    const o = { u: 0, v: 0 }, c = { w: 0, u: 0, v: 0 };
    this.flow.anomaly(x, y, this.anomT, o); this.flow.currentOverride(x, y, c);
    const [wx, wy] = this.flow.wind(), [localWx, localWy] = this.flow.localWind(x, y), [mu, mv] = this.flow.mean();
    const current: [number, number] = [c.u + (1 - c.w) * this.params.driftU + o.u - this.params.windage * (localWx - wx), c.v + (1 - c.w) * this.params.driftV + o.v - this.params.windage * (localWy - wy)];
    return { wind: [localWx, localWy] as [number, number], current, drift: [current[0] + this.params.windage * localWx, current[1] + this.params.windage * localWy] as [number, number] };
  }

  driftAt(x: number, y: number): [number, number] { return this.vectorsAt(x, y).drift; }
}
