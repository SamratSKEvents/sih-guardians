/**
 * The Slick Drift Lab's live run, as a class the Forecast page drives.
 *
 * Ported from oil-imp's `main.ts`: the same GlobeMaster settings, the same
 * resolution rule, the same continuous Bonn ramp composited block by block
 * into one canvas, stepped on the main thread inside a per-frame budget.
 * What it adds is memory: a copy of the field every half hour of model time,
 * so the clock can scrub back through what has already been computed.
 *
 * Backward runs are the same solver with the forcing reversed (wind turned
 * 180°, current negated). That is an approximation of an inverse run — the
 * spreading still goes forwards — and the page says so.
 */

import { GlobeMaster, OPTIMISED_SOLVER } from './engine';
import type { GlobeBlock, GlobeRelease, GlobeSolver, LonLat } from './engine';
import type { Forcing } from './forcing';

const H_ALLOC = 5e-8;
const MEMORY_MB = 384;
export const DISPLAY_SHEEN_M = 5e-8;

// oil-imp's ramp: translucent sub-sheen, silvery, rainbow, metallic, true colour.
const BONN_STOPS: readonly [number, [number, number, number, number]][] = [
  [Math.log10(0.04e-6), [205, 212, 222, 0]],
  [Math.log10(0.1e-6), [205, 212, 222, 55]],
  [Math.log10(0.3e-6), [214, 220, 230, 95]],
  [Math.log10(0.6e-6), [120, 190, 230, 135]],
  [Math.log10(1.2e-6), [200, 120, 220, 140]],
  [Math.log10(2.4e-6), [240, 200, 90, 145]],
  [Math.log10(5e-6), [150, 200, 160, 160]],
  [Math.log10(12e-6), [150, 158, 172, 200]],
  [Math.log10(50e-6), [120, 118, 118, 215]],
  [Math.log10(90e-6), [112, 72, 38, 230]],
  [Math.log10(200e-6), [70, 44, 24, 240]],
  [Math.log10(1e-3), [28, 18, 12, 250]],
];
export const RAMP_CSS = 'linear-gradient(90deg, rgb(205 212 222 / .3), rgb(120 190 230), rgb(200 120 220), rgb(240 200 90), rgb(150 200 160), rgb(150 158 172), rgb(112 72 38), rgb(28 18 12))';

function colour(h: number): [number, number, number, number] {
  if (!(h >= DISPLAY_SHEEN_M)) return [0, 0, 0, 0];
  const x = Math.log10(h);
  let i = 1;
  while (i < BONN_STOPS.length - 1 && BONN_STOPS[i][0] < x) i++;
  const [x0, c0] = BONN_STOPS[i - 1];
  const [x1, c1] = BONN_STOPS[i];
  const t = Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
  return [0, 1, 2, 3].map((k) => Math.round(c0[k] + t * (c1[k] - c0[k]))) as [number, number, number, number];
}

export const solverFor = (dx: number): GlobeSolver => ({ ...OPTIMISED_SOLVER, dx, mode: 'reduced', hAlloc: H_ALLOC, filmDtScale: dx <= 10 ? 4 : 1, memoryMB: MEMORY_MB });

/** The run's forcing for a direction: backward reverses both wind and current. */
export function applyForcing(g: GlobeMaster, f: Forcing, backward: boolean) {
  g.params.windSpeed = f.windSpeed;
  g.params.windDirDeg = (f.windDirDeg + (backward ? 180 : 0)) % 360;
  g.params.driftU = backward ? -f.driftU : f.driftU;
  g.params.driftV = backward ? -f.driftV : f.driftV;
}

/** Releases every part with its share of the volume, largest first. Returns the engine's complaint, if any. */
export function release(g: GlobeMaster, rings: LonLat[][], volumeM3: number): string | null {
  const parts = rings.map((ring) => ({ ring, area: ringArea(ring) })).sort((a, b) => b.area - a.area);
  const total = parts.reduce((a, b) => a + b.area, 0) || 1;
  const first = g.addOil({ ring: parts[0].ring, volumeM3: (volumeM3 * parts[0].area) / total, profile: 'dome' } satisfies GlobeRelease, true);
  if (first) return first;
  // A fragment over the memory budget is left out, not shrunk.
  for (const part of parts.slice(1)) g.addOil({ ring: part.ring, volumeM3: (volumeM3 * part.area) / total, profile: 'dome' }, false);
  return null;
}

export function ringArea(ring: LonLat[]) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const k = (Math.PI / 180) * 6_371_000;
  const c = Math.cos((lat0 * Math.PI) / 180);
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twice += ring[j][0] * k * c * ring[i][1] * k - ring[i][0] * k * c * ring[j][1] * k;
  return Math.abs(twice) / 2;
}

export interface Snapshot { hour: number; canvas: HTMLCanvasElement; bounds: [number, number, number, number] }
export interface LiveStats { hour: number; areaKm2: number; released: number; afloat: number; evaporated: number; dispersed: number; stranded: number; blocks: number }

export class LiveDrift {
  readonly canvas = document.createElement('canvas');
  bounds: [number, number, number, number] | undefined;
  readonly snapshots: Snapshot[] = [];
  private readonly ctx: CanvasRenderingContext2D;
  private globe: GlobeMaster;
  private field = new Float32Array(0);
  problem: string | null = null;

  constructor(rings: LonLat[][], volumeM3: number, forcing: Forcing, readonly backward: boolean, land: LonLat[][], readonly dx = 50) {
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    this.globe = new GlobeMaster(solverFor(dx));
    applyForcing(this.globe, forcing, backward);
    this.globe.setLand(land);
    this.problem = release(this.globe, rings, volumeM3);
    this.render();
    this.keep();
  }

  get hour() { return this.globe.t / 3600; }

  setLand(land: LonLat[][]) { this.globe.setLand(land); }

  vectors(lon: number, lat: number) { return this.globe.vectorsAt(lon, lat); }

  /** Advances by up to `seconds` of model time within `budgetMs` of wall time. */
  step(seconds: number, budgetMs = 10) {
    const deadline = performance.now() + budgetMs;
    const slice = this.dx <= 25 ? 4 : 12;
    let left = seconds;
    while (left > 1e-6 && performance.now() < deadline) {
      const before = this.globe.t;
      this.globe.step(Math.min(slice, left));
      const moved = this.globe.t - before;
      if (moved <= 0) break;
      left -= moved;
      if (Math.floor(this.globe.t / 1800) !== Math.floor(before / 1800)) { this.render(); this.keep(); }
    }
    this.render();
  }

  stats(): LiveStats {
    const b = this.globe.budget();
    const m = this.globe.measure(DISPLAY_SHEEN_M);
    return { hour: this.hour, areaKm2: m.areaM2 / 1e6, released: b.released, afloat: m.volume, evaporated: b.evaporated, dispersed: b.dispersed, stranded: b.stranded, blocks: this.globe.blockCount };
  }

  private keep() {
    if (!this.bounds) return;
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.snapshots.push({ hour: this.hour, canvas: copy, bounds: [...this.bounds] as Snapshot['bounds'] });
  }

  /** oil-imp's compositeBlocks: every block's thickness, lightly smoothed, into one image. */
  private render() {
    const view = this.globe.view(true, null, false);
    const blocks: GlobeBlock[] = view.blocks;
    if (!blocks.length) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.bounds = undefined; return; }
    const B = view.B;
    const minBi = Math.min(...blocks.map((b) => b.bi)), maxBi = Math.max(...blocks.map((b) => b.bi));
    const minBj = Math.min(...blocks.map((b) => b.bj)), maxBj = Math.max(...blocks.map((b) => b.bj));
    const width = (maxBi - minBi + 1) * B, height = (maxBj - minBj + 1) * B;
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const pixels = this.ctx.createImageData(width, height);
    const row = B + 2;
    if (this.field.length !== row * row) this.field = new Float32Array(row * row);
    const f = this.field;
    const blend = this.dx >= 50 ? 0.22 : 0.14;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const block of blocks) {
      for (const [lon, lat] of block.corners) { west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat); }
      this.globe.blockThickness(block, f);
      for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
        const c = f[(j + 1) * row + i + 1];
        const n = f[j * row + i] + f[j * row + i + 1] + f[j * row + i + 2] + f[(j + 1) * row + i] + f[(j + 1) * row + i + 2] + f[(j + 2) * row + i] + f[(j + 2) * row + i + 1] + f[(j + 2) * row + i + 2];
        const [r, g, b, a] = colour(this.dx <= 10 ? c : c * (1 - blend) + (n / 8) * blend);
        // Solver rows run north; image rows run south.
        const o = ((maxBj - block.bj) * B + (B - 1 - j)) * width * 4 + ((block.bi - minBi) * B + i) * 4;
        pixels.data[o] = r; pixels.data[o + 1] = g; pixels.data[o + 2] = b; pixels.data[o + 3] = a;
      }
    }
    this.ctx.putImageData(pixels, 0, 0);
    this.bounds = [west, south, east, north];
  }
}
