/**
 * Units, timestamps and compass words. Every value printed in any output (JSON rows, Markdown, PDF) goes through
 * here, so a fact is formatted identically everywhere.
 */
import type { LatLon, Priority } from '../IapTypes';

export const NA = 'NOT AVAILABLE';

const fixed = (v: number, dp: number) => {
  const s = Math.abs(v).toFixed(dp);
  return (v < 0 && Number(s) !== 0 ? '−' : '') + s;
};
const orNA = <T>(v: T | null | undefined, f: (x: T) => string) => (v === null || v === undefined ? NA : f(v));

export const fmt = {
  km: (v: number | null, dp = 1) => orNA(v, (x) => `${fixed(x, dp)} km`),
  km2: (v: number | null) => orNA(v, (x) => `${fixed(x, 1)} km²`),
  ms: (v: number | null) => orNA(v, (x) => `${fixed(x, 1)} m/s`),
  m: (v: number | null) => orNA(v, (x) => `${fixed(x, 1)} m`),
  metres: (v: number | null) => orNA(v, (x) => `${Math.round(x)} m`),
  bearing: (v: number | null) => orNA(v, (x) => `${String(Math.round(((x % 360) + 360) % 360)).padStart(3, '0')}°`),
  hours: (v: number) => `${fixed(v, Number.isInteger(v) ? 0 : 1)} h`,
  latLon: (p: LatLon | null) => orNA(p, (x) => `${x.lat.toFixed(3)}°${x.lat >= 0 ? 'N' : 'S'} ${x.lon.toFixed(3)}°${x.lon >= 0 ? 'E' : 'W'}`),
  iapNo: (n: number) => String(n).padStart(3, '0'),
};

export const PRIORITY_LABEL: Record<Priority, string> = { P1: 'IMMEDIATE', P2: 'HIGH', P3: 'ROUTINE' };
export const priorityTag = (p: Priority) => `${p} ${PRIORITY_LABEL[p]}`;

/* ------------------------------------------------------------------ time */

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const p2 = (n: number) => String(n).padStart(2, '0');
const MIN = 60_000;

export const ms = (iso: string) => Date.parse(iso);
export const iso = (t: number) => new Date(t).toISOString();
export const addMin = (isoStr: string, m: number) => iso(ms(isoStr) + m * MIN);
export const minutesBetween = (a: string, b: string) => (ms(b) - ms(a)) / MIN;
export const hoursBetween = (a: string, b: string) => (ms(b) - ms(a)) / 3_600_000;
export const overlaps = (a0: string, a1: string, b0: string, b1: string) => ms(a0) < ms(b1) && ms(b0) < ms(a1);

/** 2026-09-18 06:00 UTC */
export function utc(s: string | null): string {
  if (!s) return NA;
  const d = new Date(s);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** 0930Z-style compact time used in tables: "0930". Day prefix added when it differs from `refIso`. */
export function hhmm(s: string | null, refIso?: string): string {
  if (!s) return '—';
  const d = new Date(s);
  const t = `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
  if (refIso && new Date(refIso).getUTCDate() !== d.getUTCDate()) return `${p2(d.getUTCDate())}/${t}`;
  return t;
}

/** 0700–0930 UTC (day prefixes where the range leaves the reference day). */
export const timeRange = (a: string | null, b: string | null, refIso?: string) => (a && b ? `${hhmm(a, refIso)}–${hhmm(b, refIso)} UTC` : 'NOT SCHEDULED');

/** 18 SEP 2026 / 0600–1200 UTC  (spans days: 18 SEP 2026 1800 – 19 SEP 2026 0600 UTC) */
export function periodLabel(startIso: string, endIso: string): string {
  const a = new Date(startIso), b = new Date(endIso);
  const day = (d: Date) => `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const t = (d: Date) => `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`;
  return day(a) === day(b) ? `${day(a)} / ${t(a)}–${t(b)} UTC` : `${day(a)} ${t(a)} – ${day(b)} ${t(b)} UTC`;
}

/* ------------------------------------------------------------------ words */

const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
export const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
export const levelLabel = (l: string) => l.replace('-', '–');
