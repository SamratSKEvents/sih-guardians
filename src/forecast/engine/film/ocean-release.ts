import { DEG, dLon, EARTH_RADIUS_M as R } from '../geo/geodesy';
import { polygon, signedDistance } from './shapes';
import type { GlobeRelease, LonLat } from './globe';
import type { SphereTransport, SphereDomain } from './sphere';

/** Unwrap each edge by the shortest longitude difference; densify latitude edges for equal-area integration. */
export function oceanRing(ring: LonLat[]): LonLat[] {
  const result: LonLat[] = [];
  let lon = ring[0]?.[0] ?? 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], delta = dLon(a[0], b[0]);
    const n = Math.max(1, Math.ceil(Math.abs(b[1] - a[1]) / 0.25));
    for (let k = 0; k < n; k++) result.push([(lon + delta * k / n) * DEG, Math.sin((a[1] + (b[1] - a[1]) * k / n) * DEG)]);
    lon += delta;
  }
  return result;
}

/** Area of the drawn, longitude/latitude-linear polygon on the sphere, including antimeridian crossings. */
export function oceanArea(ring: LonLat[]): number {
  const p = oceanRing(ring);
  let area = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) area += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(area) * R * R / 2;
}

export function oceanReleaseProblem(r: GlobeRelease): string | null {
  if (r.ring.length < 3 || r.ring.some(p => p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[1]) > 90)) return 'Draw a finite polygon with at least three points on Earth.';
  if (!Number.isFinite(r.volumeM3) || r.volumeM3 <= 0) return 'Oil volume must be finite and greater than zero.';
  if (r.profile !== 'dome' && r.profile !== 'uniform') return 'Unknown oil thickness profile.';
  let winding = 0;
  for (let i = 0; i < r.ring.length; i++) winding += dLon(r.ring[i][0], r.ring[(i + 1) % r.ring.length][0]);
  if (Math.abs(winding) > 1e-6) return 'Split a pole-enclosing polygon into regions that do not encircle a pole.';
  const pts = oceanRing(r.ring), xs = pts.map(p => p[0]);
  if (Math.max(...xs) - Math.min(...xs) >= 2 * Math.PI - 1e-8) return 'Use polygons spanning less than 360° of longitude; split a pole-enclosing release into separate regions.';
  if (!(oceanArea(r.ring) > 0)) return 'The drawn shape has zero area.';
  return null;
}

/** Keep the same bounded array size but spend it on the release region, with a large drift margin. */
export function oceanDomain(r: GlobeRelease): SphereDomain | undefined {
  const pts = oceanRing(r.ring);
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, Math.asin(y)); n = Math.max(n, Math.asin(y)); }
  const width = Math.max(e - w, (n - s) / Math.max(0.05, Math.cos((n + s) / 2)));
  const height = Math.max(n - s, (e - w) * Math.cos((n + s) / 2) / 2);
  if (width * 2.5 > 300 * DEG || height * 2.5 > 140 * DEG) return undefined;
  return { west: (w + e) / 2 - width * 1.25, east: (w + e) / 2 + width * 1.25,
    south: Math.max(-Math.PI / 2, (s + n) / 2 - height * 1.25), north: Math.min(Math.PI / 2, (s + n) / 2 + height * 1.25) };
}

/**
 * Scanline quadrature in (longitude, sin(latitude)): the area measure is exactly R² dx dy.
 * Four strips per cell row; longitude intersections are integrated exactly, avoiding missed narrow spans.
 * The output holds volume, sums to the specified release, and is never committed until placement succeeds.
 */
export function* oceanShares(g: SphereTransport, r: GlobeRelease): Generator<number, Float64Array> {
  const pts = oceanRing(r.ring);
  const shift = Math.round((g.west + g.nx * g.angle / 2 - pts[0][0]) / (2 * Math.PI)) * 2 * Math.PI;
  for (const point of pts) point[0] += shift;
  const poly = polygon(pts.flat()), out = new Float64Array(g.mass.length);
  const da = g.angle, depth = Math.max(1e-12, Math.min(poly.maxX - poly.minX, poly.maxY - poly.minY) / 2);
  let total = 0;
  for (let j = 0; j < g.ny; j++) {
    const south = Math.sin(g.south + j * g.latitudeAngle), north = Math.sin(g.south + (j + 1) * g.latitudeAngle);
    if (north >= poly.minY && south <= poly.maxY) for (let s = 0; s < 4; s++) {
      const y = south + (north - south) * (s + 0.5) / 4, xs: number[] = [];
      for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
        const a = pts[k], b = pts[i];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const start = Math.floor((xs[q] - g.west) / da), end = Math.ceil((xs[q + 1] - g.west) / da);
        for (let i = start; i < end; i++) {
          if (!g.periodic && (i < 0 || i >= g.nx)) continue;
          const a = Math.max(xs[q], g.west + i * da), b = Math.min(xs[q + 1], g.west + (i + 1) * da);
          const shape = r.profile === 'uniform' ? 1 : Math.max(0, signedDistance(poly, (a + b) / 2, y)) / depth;
          const share = (b - a) * (north - south) / 4 * shape;
          out[j * g.nx + ((i % g.nx) + g.nx) % g.nx] += share; total += share;
        }
      }
    }
    if (j % 8 === 0) yield j / g.ny;
  }
  if (!(total > 0)) throw new Error('The slick is narrower than the spherical release grid. Use the local Master solver.');
  for (let k = 0; k < out.length; k++) out[k] = out[k] / total * r.volumeM3;
  return out;
}
