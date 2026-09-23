// Explicit integrators for dX/dt = V(X, t) on (lat, lon), with V in m/s east/north.
import { clampLat, latRate, lonRate, wrapLon } from '../geo/geodesy';
import type { EnvironmentProvider } from '../env/types';
import { emptySample } from '../env/types';

export type IntegratorKind = 'euler' | 'rk2' | 'rk4';

export interface ForcingParams {
  alpha: number; // windage coefficient, dimensionless
  currentOn: boolean;
  windOn: boolean;
  stokesOn: boolean;
}

export interface VelResult {
  u: number;
  v: number;
  oob: boolean;
  land: number;
}

/**  V_oil = V_current + α · V_wind + V_stokes  (each term switchable). */
export class VelocityField {
  private s = emptySample();
  constructor(public env: EnvironmentProvider, public p: ForcingParams) {}

  at(lat: number, lon: number, t: number, out: VelResult): VelResult {
    const s = this.env.sample(lat, lon, t, this.s);
    const p = this.p;
    let u = 0, v = 0;
    if (p.currentOn) { u += s.currentU; v += s.currentV; }
    if (p.windOn) { u += p.alpha * s.windU; v += p.alpha * s.windV; }
    if (p.stokesOn) { u += s.stokesU; v += s.stokesV; }
    out.u = u;
    out.v = v;
    out.oob = out.oob || s.outOfDomain;
    out.land = s.landMask;
    return out;
  }
}

export interface Pos {
  lat: number;
  lon: number;
}

const k = { u: 0, v: 0, oob: false, land: 0 };

/**
 * Advance one position by dt seconds (dt may be negative for backward integration).
 * Returns true if any stage sampled outside the environment domain.
 */
export function integrate(field: VelocityField, method: IntegratorKind, lat: number, lon: number, t: number, dt: number, out: Pos): boolean {
  k.oob = false;
  field.at(lat, lon, t, k);
  const a1 = latRate(k.v), b1 = lonRate(k.u, lat);
  if (method === 'euler') {
    out.lat = clampLat(lat + dt * a1);
    out.lon = wrapLon(lon + dt * b1);
    return k.oob;
  }
  if (method === 'rk2') {
    // midpoint method
    const lm = lat + 0.5 * dt * a1;
    field.at(lm, lon + 0.5 * dt * b1, t + 0.5 * dt, k);
    out.lat = clampLat(lat + dt * latRate(k.v));
    out.lon = wrapLon(lon + dt * lonRate(k.u, lm));
    return k.oob;
  }
  const h = dt / 2;
  const l2 = lat + h * a1;
  field.at(l2, lon + h * b1, t + h, k);
  const a2 = latRate(k.v), b2 = lonRate(k.u, l2);
  const l3 = lat + h * a2;
  field.at(l3, lon + h * b2, t + h, k);
  const a3 = latRate(k.v), b3 = lonRate(k.u, l3);
  const l4 = lat + dt * a3;
  field.at(l4, lon + dt * b3, t + dt, k);
  const a4 = latRate(k.v), b4 = lonRate(k.u, l4);
  out.lat = clampLat(lat + (dt / 6) * (a1 + 2 * a2 + 2 * a3 + a4));
  out.lon = wrapLon(lon + (dt / 6) * (b1 + 2 * b2 + 2 * b3 + b4));
  return k.oob;
}
