/**
 * How long ago the slick was released, from how far it has spread.
 *
 * Two published spreading laws, each solved for time given the area SAR
 * measured:
 *
 *   Fay (1971), surface-tension regime: r = k3 (σ² t³ / (ρw² ν))^(1/4).
 *     Independent of volume, which SAR cannot measure. Valid once the slick is
 *     thin (the late regime); it ignores wind, so it tends to overestimate age.
 *
 *   Lehr et al. (1984), wind-assisted: A = 2270 (Δ)^(2/3) V^(2/3) t^(1/2)
 *     + 40 (Δ)^(1/3) V^(1/3) W^(4/3) t, with A in m², V in barrels, t in
 *     minutes, W in knots and Δ = (ρw − ρo)/ρo. Needs a volume, taken as the
 *     area times a mean thickness of 10–100 µm.
 *
 * Each gives a range over its uncertain inputs; the estimate is where the two
 * ranges overlap (or, if they do not, the span between them, flagged).
 * Elongated slicks spread faster along the wind, so both laws are applied to
 * the area-equivalent circle, which is the convention in the literature.
 */

const RHO_W = 1025;
const NU = 1.0e-6; // m²/s, seawater kinematic viscosity
const BARREL_M3 = 0.158987;

export interface AgeInput {
  /** Measured slick area, m². */
  areaM2: number;
  /** Wind at the pass, m/s. */
  windMs: number;
  /** Oil density, kg/m³ (light crude ≈ 850, heavy fuel oil ≈ 980). */
  oilDensity?: number;
}

export interface AgeEstimate {
  /** Hours since release: the combined band. */
  lowH: number;
  highH: number;
  bestH: number;
  fay: [number, number];
  lehr: [number, number];
  /** Whether the two methods' ranges overlap. */
  agree: boolean;
}

/** Fay surface-tension regime: t from area, over k3 ∈ [2.0, 2.3] and σ ∈ [0.02, 0.04] N/m. */
export function fayHours(areaM2: number): [number, number] {
  const r = Math.sqrt(areaM2 / Math.PI);
  const t = (k3: number, sigma: number) => Math.cbrt((Math.pow(r / k3, 4) * RHO_W * RHO_W * NU) / (sigma * sigma)) / 3600;
  const ts = [t(2.0, 0.02), t(2.0, 0.04), t(2.3, 0.02), t(2.3, 0.04)];
  return [Math.min(...ts), Math.max(...ts)];
}

/** Lehr: area after t hours for a volume (m³), wind (m/s) and density. */
export function lehrArea(tH: number, volumeM3: number, windMs: number, oilDensity = 900) {
  const d = (RHO_W - oilDensity) / oilDensity;
  const v = volumeM3 / BARREL_M3;
  const tm = tH * 60;
  const wk = windMs * 1.94384;
  return 2270 * Math.pow(d, 2 / 3) * Math.pow(v, 2 / 3) * Math.sqrt(tm) + 40 * Math.pow(d, 1 / 3) * Math.pow(v, 1 / 3) * Math.pow(wk, 4 / 3) * tm;
}

/** Lehr solved for t by bisection (area grows monotonically with t). */
export function lehrHours(areaM2: number, volumeM3: number, windMs: number, oilDensity = 900): number {
  let lo = 0, hi = 240;
  if (lehrArea(hi, volumeM3, windMs, oilDensity) < areaM2) return hi;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (lehrArea(mid, volumeM3, windMs, oilDensity) < areaM2) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function estimateAge({ areaM2, windMs, oilDensity = 900 }: AgeInput): AgeEstimate {
  const fay = fayHours(areaM2);
  // Thicker oil = more volume = spreads to this area faster (younger).
  const lehr: [number, number] = [lehrHours(areaM2, areaM2 * 100e-6, windMs, oilDensity), lehrHours(areaM2, areaM2 * 10e-6, windMs, oilDensity)];
  const lo = Math.max(fay[0], lehr[0]), hi = Math.min(fay[1], lehr[1]);
  const agree = lo <= hi;
  const lowH = agree ? lo : Math.min(fay[1], lehr[1]);
  const highH = agree ? hi : Math.max(fay[0], lehr[0]);
  return { lowH, highH, bestH: Math.sqrt(Math.max(lowH, 0.1) * highH), fay, lehr, agree };
}
