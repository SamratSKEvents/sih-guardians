// Synthetic scenario flow nested into a base provider: a slick-scale strain feature added to the current.
// Every quantity except the current comes from the base provider. With (x, y) in metres east/north of the
// feature centre c(t):
//   separatrix:  u' = U·tanh(x/L),  v' = −U·tanh(y/L)·sech²(x/L)   (dividing line along x = 0, inflow along it)
//   four-way:    u' = U·tanh(x/L),  v' =  U·tanh(y/L)              (divergent split into four lobes)
//   bifurcation: u' = U·tanh(x/L),  v' = −0.85·U                   (reference sketch: splits left/right while moving south)
//   current = current_base + exp(−r²/R²)·(u', v')
// The centre starts at the release point and, once follow() has been called, is carried by the base drift
// (current + windage + Stokes at the centre), so the feature sits in the drifting surface layer the oil is in.
// Strain rate at the centre is U/L. All parameters are tunable assumptions, not observations.
import { DEG, EARTH_RADIUS_M, displace, safeCos, toLocal } from '../geo/geodesy';
import { emptySample, type EnvironmentProvider, type EnvironmentSample } from './types';

export type ScenarioKind = 'none' | 'separatrix' | 'fourway' | 'bifurcation';

const PATH_DT = 600; // s

export class ScenarioEnvironment implements EnvironmentProvider {
  kind: ScenarioKind = 'none';
  speedMS = 0.1; // U, m/s
  lengthM = 1000; // L, m  → strain U/L = 1e-4 s⁻¹
  envelopeM = 15000; // R, e-folding radius of the feature, m (Infinity = everywhere)
  baseCurrent = true; // false: the grid current is dropped and only the scenario flow remains (reference mode)
  private path: Float64Array | null = null; // [lat, lon] every PATH_DT from t = 0

  constructor(readonly base: EnvironmentProvider, public centerLat: number, public centerLon: number) {}

  /** Carry the centre along a drift velocity (m/s east/north) from t = 0 to tEnd with RK2 steps; null = fixed. */
  follow(drift: ((lat: number, lon: number, t: number) => [number, number]) | null, tEnd = 0): void {
    if (!drift) { this.path = null; return; }
    const n = Math.ceil(tEnd / PATH_DT) + 1, path = new Float64Array(2 * n), pos = { lat: 0, lon: 0 };
    path[0] = this.centerLat; path[1] = this.centerLon;
    for (let k = 1; k < n; k++) {
      const la = path[2 * k - 2], lo = path[2 * k - 1], t = (k - 1) * PATH_DT;
      const [u1, v1] = drift(la, lo, t);
      displace(la, lo, (u1 * PATH_DT) / 2, (v1 * PATH_DT) / 2, pos);
      const [u2, v2] = drift(pos.lat, pos.lon, t + PATH_DT / 2);
      displace(la, lo, u2 * PATH_DT, v2 * PATH_DT, pos);
      path[2 * k] = pos.lat; path[2 * k + 1] = pos.lon;
    }
    this.path = path;
  }

  centerAt(t: number): [number, number] {
    const p = this.path;
    if (!p) return [this.centerLat, this.centerLon];
    const f = Math.min(Math.max(t / PATH_DT, 0), p.length / 2 - 1), k = Math.min(Math.floor(f), p.length / 2 - 2), a = f - k;
    if (k < 0) return [p[0], p[1]];
    return [p[2 * k] + a * (p[2 * k + 2] - p[2 * k]), p[2 * k + 1] + a * (p[2 * k + 3] - p[2 * k + 1])];
  }

  sample(lat: number, lon: number, t: number, out: EnvironmentSample = emptySample()): EnvironmentSample {
    this.base.sample(lat, lon, t, out);
    if (!this.baseCurrent) { out.currentU = 0; out.currentV = 0; }
    if (this.kind === 'none') return out;
    const [cLat, cLon] = this.centerAt(t);
    const [x, y] = toLocal(cLat, cLon, lat, lon);
    const e = Math.exp(-(x * x + y * y) / (this.envelopeM * this.envelopeM));
    const U = this.speedMS, tx = Math.tanh(x / this.lengthM), ty = Math.tanh(y / this.lengthM);
    out.currentU += e * U * tx;
    out.currentV += e * (this.kind === 'separatrix' ? -U * ty * (1 - tx * tx) : this.kind === 'fourway' ? U * ty : -0.85 * U);
    return out;
  }

  private s1 = emptySample();
  private s2 = emptySample();

  sampleDivergence(lat: number, lon: number, t: number): number {
    if (this.kind === 'none') return this.base.sampleDivergence(lat, lon, t);
    const hM = this.lengthM / 10, h = hM / (DEG * EARTH_RADIUS_M), hLon = h / safeCos(lat);
    const du = this.sample(lat, lon + hLon, t, this.s1).currentU - this.sample(lat, lon - hLon, t, this.s2).currentU;
    const dv = this.sample(lat + h, lon, t, this.s1).currentV - this.sample(lat - h, lon, t, this.s2).currentV;
    return (du + dv) / (2 * hM);
  }
}
