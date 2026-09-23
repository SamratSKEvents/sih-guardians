import type { LatLon } from '../ReportTypes';

/** Local tangent-plane (equirectangular) projection, adequate for extents of < ~200 km. */
export const KM_PER_DEG_LAT = 110.574;
export const kmPerDegLon = (latDeg: number) => 111.32 * Math.cos((latDeg * Math.PI) / 180);

export interface XY {
  x: number; // km east
  y: number; // km north
}

export function toXY(origin: LatLon, p: LatLon): XY {
  return { x: (p.lon - origin.lon) * kmPerDegLon(origin.lat), y: (p.lat - origin.lat) * KM_PER_DEG_LAT };
}

export function toLatLon(origin: LatLon, p: XY): LatLon {
  return { lat: origin.lat + p.y / KM_PER_DEG_LAT, lon: origin.lon + p.x / kmPerDegLon(origin.lat) };
}

export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Unit vector (x east, y north) for a bearing in degrees true. */
export const bearingVec = (b: number): XY => ({ x: Math.sin(rad(b)), y: Math.cos(rad(b)) });
export const bearingOf = (v: XY) => norm360(deg(Math.atan2(v.x, v.y)));
export const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

export function polygonArea(pts: XY[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function polygonPerimeter(pts: XY[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
  return s;
}

export function polygonCentroid(pts: XY[]): XY {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Principal axis bearing (0–180) from vertex second moments + extents along both axes. */
export function principalAxes(pts: XY[]) {
  const c = polygonCentroid(pts);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // math angle from +x
  const major: XY = { x: Math.cos(theta), y: Math.sin(theta) };
  const minor: XY = { x: -major.y, y: major.x };
  const proj = (axis: XY) => pts.map((p) => (p.x - c.x) * axis.x + (p.y - c.y) * axis.y);
  const pm = proj(major), pn = proj(minor);
  return {
    centroid: c,
    bearing: norm360(bearingOf(major)) % 180,
    major,
    minor,
    majorExtent: [Math.min(...pm), Math.max(...pm)] as [number, number],
    minorExtent: [Math.min(...pn), Math.max(...pn)] as [number, number],
  };
}

/** Deterministic PRNG (mulberry32) — used only to build repeatable demonstration data. */
export function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
