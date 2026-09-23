// Interpolating provider over gridded 6-hourly data.
// Space: bilinear between the 4 surrounding nodes. Time: cubic Hermite with Catmull-Rom tangents,
// limited (Fritsch–Carlson style) so the curve never overshoots the bracketing slices; linear optional.
import { DEG, EARTH_RADIUS_M, dLon, safeCos } from '../geo/geodesy';
import type { EnvironmentProvider, EnvironmentSample } from './types';
import { emptySample } from './types';
import {
  F_CUR_DIV_U, F_CUR_DIV_V, F_CUR_ROT_U, F_CUR_ROT_V, F_SST, F_STOKES_U, F_STOKES_V,
  F_WAVE_H, F_WIND_U, F_WIND_V, NF, type GriddedData,
} from './synthetic';

export type TimeInterp = 'hermite' | 'linear';

/** Catmull-Rom tangent limited so the Hermite segment stays monotone between p1 and p2. */
function limitedTangent(dPrev: number, dNext: number): number {
  if (dPrev * dNext <= 0) return 0;
  const m = (dPrev + dNext) / 2;
  const cap = 3 * Math.min(Math.abs(dPrev), Math.abs(dNext));
  return Math.abs(m) > cap ? Math.sign(m) * cap : m;
}

export class GriddedEnvironment implements EnvironmentProvider {
  private _divergenceWeight: number;
  private _timeInterp: TimeInterp;
  // Cache of blended time frames. Transparent to callers: sample() stays a pure function of (lat, lon, t).
  private cache: { t: number; buf: Float64Array }[] = [];

  constructor(readonly data: GriddedData, divergenceWeight = 0.3, timeInterp: TimeInterp = 'hermite') {
    this._divergenceWeight = divergenceWeight;
    this._timeInterp = timeInterp;
  }

  get divergenceWeight() { return this._divergenceWeight; }
  set divergenceWeight(w: number) { this._divergenceWeight = w; }
  get timeInterp() { return this._timeInterp; }
  set timeInterp(m: TimeInterp) {
    if (m !== this._timeInterp) { this._timeInterp = m; this.cache = []; }
  }

  get timeRange(): [number, number] {
    return [0, (this.data.nSlices - 1) * this.data.sliceSeconds];
  }

  private frame(t: number): Float64Array {
    for (const c of this.cache) if (c.t === t) return c.buf;
    const d = this.data;
    const nS = d.nSlices;
    const len = d.nx * d.ny * NF;
    const buf = this.cache.length >= 6 ? this.cache.shift()!.buf : new Float64Array(len);
    let ts = t / d.sliceSeconds;
    ts = ts < 0 ? 0 : ts > nS - 1 ? nS - 1 : ts;
    const i1 = nS === 1 ? 0 : Math.min(Math.floor(ts), nS - 2);
    const i2 = Math.min(i1 + 1, nS - 1);
    const u = ts - i1;
    const s1 = d.slices[i1], s2 = d.slices[i2];
    if (this._timeInterp === 'linear') {
      for (let k = 0; k < len; k++) buf[k] = s1[k] + u * (s2[k] - s1[k]);
    } else {
      const s0 = d.slices[Math.max(i1 - 1, 0)], s3 = d.slices[Math.min(i2 + 1, nS - 1)];
      const u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      for (let k = 0; k < len; k++) {
        const p0 = s0[k], p1 = s1[k], p2 = s2[k], p3 = s3[k];
        const d0 = p1 - p0, d1 = p2 - p1, d2 = p3 - p2;
        buf[k] = h00 * p1 + h10 * limitedTangent(d0, d1) + h01 * p2 + h11 * limitedTangent(d1, d2);
      }
    }
    this.cache.push({ t, buf });
    return buf;
  }

  sample(lat: number, lon: number, timeSeconds: number, out: EnvironmentSample = emptySample()): EnvironmentSample {
    const d = this.data;
    const sp = d.spec;
    let fi = dLon(sp.lonMin, lon) / sp.spacing;
    if (fi < -1e-9 && fi + 360 / sp.spacing <= d.nx - 1) fi += 360 / sp.spacing; // domain crossing ±180°
    let fj = (lat - sp.latMin) / sp.spacing;
    const tMax = (d.nSlices - 1) * d.sliceSeconds;
    let oob = timeSeconds < 0 || timeSeconds > tMax || !(fi >= 0 && fi <= d.nx - 1 && fj >= 0 && fj <= d.ny - 1);
    if (!(fi >= 0)) fi = 0; else if (fi > d.nx - 1) fi = d.nx - 1;
    if (!(fj >= 0)) fj = 0; else if (fj > d.ny - 1) fj = d.ny - 1;
    const t = timeSeconds < 0 ? 0 : timeSeconds > tMax ? tMax : timeSeconds;

    const buf = this.frame(t);
    const i0 = Math.min(Math.floor(fi), d.nx - 2);
    const j0 = Math.min(Math.floor(fj), d.ny - 2);
    const ax = fi - i0, ay = fj - j0;
    const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
    const o00 = (j0 * d.nx + i0) * NF, o10 = o00 + NF, o01 = o00 + d.nx * NF, o11 = o01 + NF;
    const bl = (f: number) => w00 * buf[o00 + f] + w10 * buf[o10 + f] + w01 * buf[o01 + f] + w11 * buf[o11 + f];

    const dw = this._divergenceWeight;
    out.currentU = bl(F_CUR_ROT_U) + dw * bl(F_CUR_DIV_U);
    out.currentV = bl(F_CUR_ROT_V) + dw * bl(F_CUR_DIV_V);
    out.windU = bl(F_WIND_U);
    out.windV = bl(F_WIND_V);
    out.stokesU = bl(F_STOKES_U);
    out.stokesV = bl(F_STOKES_V);
    out.waveHeight = bl(F_WAVE_H);
    out.sst = bl(F_SST);
    const m = d.landMask, n00 = j0 * d.nx + i0;
    out.landMask = w00 * m[n00] + w10 * m[n00 + 1] + w01 * m[n00 + d.nx] + w11 * m[n00 + d.nx + 1];
    out.outOfDomain = oob;
    return out;
  }

  private s1 = emptySample();
  private s2 = emptySample();

  sampleDivergence(lat: number, lon: number, t: number): number {
    const h = this.data.spec.spacing / 2; // deg
    const dx = 2 * h * DEG * EARTH_RADIUS_M * safeCos(lat);
    const dy = 2 * h * DEG * EARTH_RADIUS_M;
    const uE = this.sample(lat, lon + h, t, this.s1).currentU;
    const uW = this.sample(lat, lon - h, t, this.s2).currentU;
    const vN = this.sample(lat + h, lon, t, this.s1).currentV;
    const vS = this.sample(lat - h, lon, t, this.s2).currentV;
    return (uE - uW) / dx + (vN - vS) / dy;
  }
}
