/** Unit + value formatting. Every number printed in the report goes through here. */

const NBSP = ' ';
const MINUS = '−';

const fixed = (v: number, dp: number) => {
  const s = Math.abs(v).toFixed(dp);
  return (v < 0 && Number(s) !== 0 ? MINUS : '') + s;
};

export const u = {
  num: (v: number, dp = 2) => fixed(v, dp),
  km: (v: number, dp = 2) => `${fixed(v, dp)}${NBSP}km`,
  km2: (v: number, dp = 1) => `${fixed(v, dp)}${NBSP}km²`,
  m: (v: number, dp = 0) => `${fixed(v, dp)}${NBSP}m`,
  ms: (v: number, dp = 2) => `${fixed(v, dp)}${NBSP}m/s`,
  kn: (v: number, dp = 1) => `${fixed(v, dp)}${NBSP}kn`,
  nm: (km: number, dp = 2) => `${fixed(km / 1.852, dp)}${NBSP}NM`,
  degC: (v: number, dp = 1) => `${fixed(v, dp)}${NBSP}°C`,
  db: (v: number, dp = 1) => `${fixed(v, dp)}${NBSP}dB`,
  m2s: (v: number, dp = 1) => `${fixed(v, dp)}${NBSP}m²/s`,
  pct: (v: number, dp = 0) => `${fixed(v, dp)}${NBSP}%`,
  /** 0–1 fraction as percentage. */
  frac: (v: number, dp = 0) => `${fixed(v * 100, dp)}${NBSP}%`,
  /** Bearing, zero-padded to three digits. */
  bearing: (v: number) => `${String(Math.round(((v % 360) + 360) % 360)).padStart(3, '0')}°`,
  /** Relative hour label: T−12 h, T0, T+6 h. */
  rel: (h: number) => (h === 0 ? 'T0' : `T${h < 0 ? MINUS : '+'}${Math.abs(h)}${NBSP}h`),
  /** Forecast/hindcast horizon: +6 h / 6 h. */
  hours: (h: number, signed = false) => `${signed && h > 0 ? '+' : ''}${fixed(h, Number.isInteger(h) ? 0 : 1)}${NBSP}h`,
  minutes: (v: number) => `${Math.round(v)}${NBSP}min`,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-09-14 00:47 UTC */
export function utc(iso: string, seconds = false): string {
  const d = new Date(iso);
  const t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? ':' + pad(d.getUTCSeconds()) : ''}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${t}${NBSP}UTC`;
}

/** Compact time-of-day: 14 Sep 00:47Z */
export function utcShort(iso: string): string {
  const d = new Date(iso);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${pad(d.getUTCDate())}${NBSP}${mon} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/** Degrees + decimal minutes: 18°54.300′N */
export function lat(v: number, dp = 3): string {
  return dm(v, dp, 2) + (v >= 0 ? 'N' : 'S');
}
export function lon(v: number, dp = 3): string {
  return dm(v, dp, 3) + (v >= 0 ? 'E' : 'W');
}
export function latLon(p: { lat: number; lon: number }, dp = 3): string {
  return `${lat(p.lat, dp)} ${lon(p.lon, dp)}`;
}
function dm(v: number, dp: number, degPad: number): string {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Number(((a - d) * 60).toFixed(dp));
  if (m >= 60) {
    d += 1;
    m = 0;
  }
  return `${String(d).padStart(degPad, '0')}°${m.toFixed(dp).padStart(dp + 3, '0')}′`;
}
