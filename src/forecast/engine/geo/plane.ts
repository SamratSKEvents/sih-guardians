// A flat plane about a geographic anchor, for a spill area of the global master (metres east/north ↔ lon/lat).
//   'equirect'  toLocal/fromLocal: fixed cos(lat0) for the whole plane. East–west scale is off by ≈ tan(lat0)·Δlat, so
//               about 1.4 % at 60° N only 50 km north of the anchor. The original plane, kept as the reference.
//   'stereo'    oblique stereographic on the sphere: conformal, scale k = 2 / (1 + cos c) at angular distance c from the
//               anchor, i.e. off by only (d / 2R)² — 0.1 % at 400 km, independent of latitude, and valid at the poles.
import { DEG, EARTH_RADIUS_M, dLon, fromLocal, safeCos, toLocal } from './geodesy';

export type PlaneKind = 'equirect' | 'stereo';

export class Plane {
  private readonly sin0: number;
  private readonly cos0: number;
  private readonly cosE: number;

  constructor(readonly lat0: number, readonly lon0: number, readonly kind: PlaneKind) {
    this.sin0 = Math.sin(lat0 * DEG); this.cos0 = Math.cos(lat0 * DEG); this.cosE = safeCos(lat0);
  }

  toPlane(lat: number, lon: number): [number, number] {
    if (this.kind === 'equirect') return toLocal(this.lat0, this.lon0, lat, lon, this.cosE);
    const f = lat * DEG, l = dLon(this.lon0, lon) * DEG, sf = Math.sin(f), cf = Math.cos(f), cl = Math.cos(l);
    const k = (2 * EARTH_RADIUS_M) / (1 + this.sin0 * sf + this.cos0 * cf * cl);
    return [k * cf * Math.sin(l), k * (this.cos0 * sf - this.sin0 * cf * cl)];
  }

  /** [lon, lat], longitude continuous about the anchor (may pass ±180°). */
  toLonLat(x: number, y: number): [number, number] {
    if (this.kind === 'equirect') { const [la, lo] = fromLocal(this.lat0, this.lon0, x, y, this.cosE); return [this.lon0 + dLon(this.lon0, lo), la]; }
    const rho = Math.hypot(x, y);
    if (rho === 0) return [this.lon0, this.lat0];
    const c = 2 * Math.atan(rho / (2 * EARTH_RADIUS_M)), sc = Math.sin(c), cc = Math.cos(c);
    const lat = Math.asin(Math.max(-1, Math.min(1, cc * this.sin0 + (y * sc * this.cos0) / rho))) / DEG;
    const lon = this.lon0 + Math.atan2(x * sc, rho * this.cos0 * cc - y * this.sin0 * sc) / DEG;
    return [lon, lat];
  }

  /** Relative length error of plane metres against ground metres at plane point (x, y). */
  scaleError(x: number, y: number): number {
    if (this.kind === 'stereo') return (x * x + y * y) / (4 * EARTH_RADIUS_M * EARTH_RADIUS_M);
    const lat = this.lat0 + y / EARTH_RADIUS_M / DEG;
    return Math.abs(safeCos(lat) / this.cosE - 1);
  }
}

/** Great-circle distance, metres. */
export function greatCircleM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin((dLon(lon1, lon2) * DEG) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
