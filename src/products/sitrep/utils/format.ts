/**
 * Units, timestamps, compass words. Every value printed in any output (JSON rows, Markdown, PDF) goes through here,
 * so a fact is formatted identically everywhere.
 */
import type { LatLon } from '../SitrepTypes';

export const NA = 'NOT AVAILABLE';

const fixed = (v: number, dp: number) => {
  const s = Math.abs(v).toFixed(dp);
  return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
};

/** Returns NOT AVAILABLE for null/undefined, otherwise the formatted value. */
const orNA = <T>(v: T | null | undefined, f: (x: T) => string) => (v === null || v === undefined ? NA : f(v));

export const fmt = {
  num: (v: number, dp = 1) => fixed(v, dp),
  km: (v: number | null, dp = 1) => orNA(v, (x) => `${fixed(x, dp)} km`),
  km2: (v: number | null) => orNA(v, (x) => `${fixed(x, 1)} km²`),
  ms: (v: number | null, dp = 1) => orNA(v, (x) => `${fixed(x, dp)} m/s`),
  m: (v: number | null) => orNA(v, (x) => `${fixed(x, 1)} m`),
  pct: (v: number | null) => orNA(v, (x) => `${Math.round(x)}%`),
  prob: (v: number | null) => orNA(v, (x) => `${Math.round(x * 100)}%`),
  bearing: (v: number | null) => orNA(v, (x) => `${String(Math.round(((x % 360) + 360) % 360)).padStart(3, '0')}°`),
  hours: (v: number) => `${fixed(v, Number.isInteger(v) ? 0 : 1)} h`,
  hourRange: (r: [number, number] | null) => orNA(r, ([a, b]) => `${Math.round(a)}–${Math.round(b)} h`),
  latLon: (p: LatLon | null) => orNA(p, (x) => `${dm(x.lat, 2)}${x.lat >= 0 ? 'N' : 'S'} ${dm(x.lon, 3)}${x.lon >= 0 ? 'E' : 'W'}`),
  sitrepNo: (n: number) => `SITREP ${String(n).padStart(3, '0')}`,
};

function dm(v: number, degPad: number) {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Number(((a - d) * 60).toFixed(2));
  if (m >= 60) (d += 1), (m = 0);
  return `${String(d).padStart(degPad, '0')}°${m.toFixed(2).padStart(5, '0')}′`;
}

/* ------------------------------------------------------------------ time */

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** 2026-09-17 05:42 UTC */
export function utc(iso: string | null): string {
  if (!iso) return NA;
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** 05:42 UTC */
export const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
};

/** 07:14–08:03 UTC */
export const timeRange = (fromIso: string, toIso: string) => `${hhmm(fromIso).replace(' UTC', '')}–${hhmm(toIso)}`;

/** 17 SEP 2026 / 0600–1200 UTC  (spans days: 17 SEP 2026 2200 – 18 SEP 2026 0400 UTC) */
export function reportingPeriod(startIso: string, endIso: string): string {
  const a = new Date(startIso), b = new Date(endIso);
  const day = (d: Date) => `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const t = (d: Date) => `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
  return day(a) === day(b) ? `${day(a)} / ${t(a)}–${t(b)} UTC` : `${day(a)} ${t(a)} – ${day(b)} ${t(b)} UTC`;
}

export const hoursBetween = (fromIso: string, toIso: string) => (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
export const addHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

/* ------------------------------------------------------------------ compass */

const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];

/** 16-point compass word for a bearing. */
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/* ------------------------------------------------------------------ geo (local tangent plane, < ~200 km) */

export const KM_PER_DEG_LAT = 110.574;
export const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

export function toXY(origin: LatLon, p: LatLon) {
  return { x: (p.lon - origin.lon) * kmPerDegLon(origin.lat), y: (p.lat - origin.lat) * KM_PER_DEG_LAT };
}
export function toLatLon(origin: LatLon, p: { x: number; y: number }): LatLon {
  return { lat: origin.lat + p.y / KM_PER_DEG_LAT, lon: origin.lon + p.x / kmPerDegLon(origin.lat) };
}
/** Distance (km) and bearing (deg true) from a to b. */
export function displacement(a: LatLon, b: LatLon) {
  const v = toXY(a, b);
  return { km: Math.hypot(v.x, v.y), bearingDeg: (((Math.atan2(v.x, v.y) * 180) / Math.PI) + 360) % 360 };
}

/** "an" / "a" for a following word. */
export const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');
export const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
export const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
