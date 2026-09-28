/**
 * Everything the Detection map draws around a slick.
 *
 * Vessels come from the incident's AIS and attribution files where a bundle
 * has them; otherwise a deterministic traffic picture is generated for the
 * slick, kept at sea by testing every track point against the shoreline.
 * Particulars, infrastructure, lanes, protected areas and soundings are a
 * static reference set for Indian waters.
 */

export type Pt = [number, number];
export type Kind = 'tanker' | 'gas' | 'container' | 'bulk' | 'cargo' | 'fishing' | 'tug' | 'other';

export interface TrackPoint { t: number; lon: number; lat: number }

export interface MapVessel {
  id: string;
  name: string;
  type: string;
  kind: Kind;
  flag: string;
  mmsi: string;
  imo: string;
  callsign: string;
  lengthM: number;
  dwt: number;
  built: number;
  lastPort: string;
  nextPort: string;
  etaH: number;
  draughtM: number;
  /** Hours relative to the acquisition, oldest first. */
  points: TrackPoint[];
  /** Silences longer than 40 minutes, [start, end] in hours. */
  gaps: [number, number][];
  rank?: number;
  score?: number;
  parts?: { proximity: number; temporality: number; parity: number };
  why?: string;
  limits?: string;
  /** Set by the attribution (attribution.ts): share of blame, why it was filtered out, what it did. */
  share?: number;
  excluded?: string;
  flags?: string[];
  features?: Record<'proximity' | 'timing' | 'heading' | 'behaviour' | 'type', number>;
  pass?: { h: number; km: number };
}

/* ------------------------------------------------------------ geometry */

export const kmBetween = ([x1, y1]: Pt, [x2, y2]: Pt) =>
  Math.hypot((x2 - x1) * 111.32 * Math.cos((((y1 + y2) / 2) * Math.PI) / 180), (y2 - y1) * 110.57);

export const bearingOf = ([x1, y1]: Pt, [x2, y2]: Pt) =>
  ((Math.atan2((x2 - x1) * Math.cos((((y1 + y2) / 2) * Math.PI) / 180), y2 - y1) * 180) / Math.PI + 360) % 360;

export const move = ([lon, lat]: Pt, bearingDeg: number, km: number): Pt => {
  const b = (bearingDeg * Math.PI) / 180;
  return [lon + (Math.sin(b) * km) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(b) * km) / 110.57];
};

/** Position, heading and speed at hour t; holds the first or last fix outside the track. */
export function vesselAt(v: MapVessel, t: number): { at: Pt; heading: number; knots: number } {
  const pts = v.points;
  let i = pts.findIndex((p) => p.t > t);
  if (i === -1) i = pts.length - 1;
  if (i === 0) i = 1;
  const a = pts[i - 1];
  const b = pts[i] ?? a;
  const k = b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const at: Pt = [a.lon + (b.lon - a.lon) * k, a.lat + (b.lat - a.lat) * k];
  const d = kmBetween([a.lon, a.lat], [b.lon, b.lat]);
  // Stopped (at anchor or berth): keep the heading it arrived on.
  let heading = d > 0.01 ? bearingOf([a.lon, a.lat], [b.lon, b.lat]) : 0;
  if (d <= 0.01) {
    for (let j = i - 1; j > 0; j--) {
      if (kmBetween([pts[j - 1].lon, pts[j - 1].lat], [pts[j].lon, pts[j].lat]) > 0.01) { heading = bearingOf([pts[j - 1].lon, pts[j - 1].lat], [pts[j].lon, pts[j].lat]); break; }
    }
  }
  return { at, heading, knots: b.t === a.t ? 0 : d / (b.t - a.t) / 1.852 };
}

/** Closest point of approach to a target over the whole track. */
export function closestApproach(v: MapVessel, target: Pt) {
  let best = { km: Infinity, t: 0, at: [0, 0] as Pt };
  for (let t = v.points[0].t; t <= v.points[v.points.length - 1].t; t += 1 / 12) {
    const { at } = vesselAt(v, t);
    const km = kmBetween(at, target);
    if (km < best.km) best = { km, t, at };
  }
  return best;
}

/* ---------------------------------------------------------- determinism */

function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function kindOf(type: string): Kind {
  const t = type.toLowerCase();
  if (t.includes('lpg') || t.includes('lng') || t.includes('gas')) return 'gas';
  if (t.includes('tanker')) return 'tanker';
  if (t.includes('container')) return 'container';
  if (t.includes('bulk')) return 'bulk';
  if (t.includes('fish')) return 'fishing';
  if (t.includes('tug') || t.includes('supply')) return 'tug';
  if (t.includes('cargo')) return 'cargo';
  return 'other';
}

const LENGTH: Record<Kind, [number, number]> = {
  tanker: [180, 250], gas: [200, 290], container: [220, 330], bulk: [170, 230], cargo: [95, 150], fishing: [12, 24], tug: [30, 65], other: [40, 90],
};

const PORTS: { name: string; at: Pt }[] = [
  { name: 'Kandla', at: [70.22, 23.03] }, { name: 'Mundra', at: [69.72, 22.75] }, { name: 'Vadinar', at: [69.71, 22.47] },
  { name: 'Sikka', at: [69.84, 22.44] }, { name: 'Okha', at: [69.08, 22.47] }, { name: 'Porbandar', at: [69.6, 21.63] },
  { name: 'Pipavav', at: [71.53, 20.9] }, { name: 'Hazira', at: [72.64, 21.08] }, { name: 'Mumbai', at: [72.84, 18.93] },
  { name: 'JNPA', at: [72.95, 18.95] }, { name: 'Mormugao', at: [73.8, 15.41] }, { name: 'New Mangalore', at: [74.8, 12.92] },
  { name: 'Kochi', at: [76.26, 9.96] }, { name: 'Tuticorin', at: [78.19, 8.76] }, { name: 'Chennai', at: [80.3, 13.1] },
  { name: 'Ennore', at: [80.33, 13.25] }, { name: 'Krishnapatnam', at: [80.12, 14.25] }, { name: 'Kakinada', at: [82.28, 16.97] },
  { name: 'Visakhapatnam', at: [83.3, 17.69] }, { name: 'Gangavaram', at: [83.23, 17.63] }, { name: 'Paradip', at: [86.68, 20.26] },
  { name: 'Dhamra', at: [86.96, 20.8] }, { name: 'Haldia', at: [88.1, 22.03] }, { name: 'Colombo', at: [79.84, 6.95] },
  { name: 'Fujairah', at: [56.35, 25.12] }, { name: 'Jebel Ali', at: [55.03, 25.01] }, { name: 'Singapore', at: [103.8, 1.26] },
  { name: 'Ras Tanura', at: [50.16, 26.64] }, { name: 'Salalah', at: [54.0, 16.94] },
];

const FLAGS = ['IND', 'IND', 'IND', 'PAN', 'LBR', 'MHL', 'SGP', 'MLT', 'HKG', 'BHS'];

/** Particulars from a hash of the MMSI: stable per vessel, plausible for its type. */
function particulars(mmsi: string, kind: Kind, near: Pt) {
  const r = rng(hash(mmsi));
  const [lo, hi] = LENGTH[kind];
  const lengthM = Math.round(lo + r() * (hi - lo));
  const byDistance = [...PORTS].sort((a, b) => kmBetween(a.at, near) - kmBetween(b.at, near));
  const local = byDistance.slice(0, 6);
  const far = byDistance.slice(6);
  const lastPort = kind === 'fishing' ? local[Math.floor(r() * 3)].name : (r() > 0.5 ? far : local)[Math.floor(r() * 6)].name;
  let nextPort = local[Math.floor(r() * local.length)].name;
  if (nextPort === lastPort) nextPort = far[Math.floor(r() * 6)].name;
  return {
    lengthM,
    dwt: kind === 'fishing' ? Math.round(40 + r() * 80) : Math.round((lengthM ** 2.6) * (kind === 'container' ? 0.022 : 0.03)),
    built: 1998 + Math.floor(r() * 26),
    lastPort,
    nextPort,
    etaH: Math.round((2 + r() * 70) * 10) / 10,
    draughtM: kind === 'fishing' ? Math.round((1.5 + r() * 2) * 10) / 10 : Math.round((6 + (lengthM / 330) * 9 + r() * 2) * 10) / 10,
    imo: kind === 'fishing' ? '—' : String(9_100_000 + (hash(mmsi + 'imo') % 800_000)),
    callsign: `${kind === 'fishing' ? 'IND' : 'AV'}${String.fromCharCode(65 + (hash(mmsi) % 26))}${String.fromCharCode(65 + (hash(mmsi + 'c') % 26))}${hash(mmsi) % 10}`,
  };
}

/* ---------------------------------------------------------------- land */

export interface Land { rings: Pt[][]; boxes: [number, number, number, number][] }

export function indexLand(rings: Pt[][]): Land {
  return {
    rings,
    boxes: rings.map((r) => {
      let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      return [w, s, e, n];
    }),
  };
}

export function onLand(land: Land | undefined, [x, y]: Pt) {
  if (!land) return false;
  let inside = false;
  land.rings.forEach((ring, k) => {
    const [w, s, e, n] = land.boxes[k];
    if (x < w || x > e || y < s || y > n) return;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  });
  return inside;
}

/** Kilometres to the nearest shoreline vertex within ~100 km, or undefined. */
export function coastKm(land: Land | undefined, p: Pt) {
  if (!land) return undefined;
  let best = Infinity;
  land.rings.forEach((ring, k) => {
    const [w, s, e, n] = land.boxes[k];
    if (p[0] < w - 1 || p[0] > e + 1 || p[1] < s - 1 || p[1] > n + 1) return;
    for (const q of ring) {
      if (Math.abs(q[0] - p[0]) > 1 || Math.abs(q[1] - p[1]) > 1) continue;
      best = Math.min(best, kmBetween(p, q));
    }
  });
  return Number.isFinite(best) ? best : undefined;
}

/* ------------------------------------------------------------- vessels */

interface AisFile { tracks: { vesselId: string; mmsi: string; imo?: string; name: string; type: string; flag: string; callsign?: string; points: { t: string; lon: number; lat: number }[] }[] }
interface CandidateFile {
  candidates: {
    rank: number; collationScore: number; evidenceLimitations?: string;
    identity: { mmsi: string };
    components: Record<'proximity' | 'temporality' | 'parity', { value: number; raw?: Record<string, number> }>;
  }[];
}

/** The incident's own AIS and ranking, joined on MMSI. */
export function fromBundle(ais: AisFile, candidates: CandidateFile | undefined, t0: number, near: Pt): MapVessel[] {
  const byMmsi = new Map((candidates?.candidates ?? []).map((c) => [c.identity.mmsi, c]));
  return ais.tracks.map((track) => {
    const kind = kindOf(track.type);
    const points = track.points.map((p) => ({ t: (Date.parse(p.t) - t0) / 3_600_000, lon: p.lon, lat: p.lat }));
    const gaps: [number, number][] = [];
    for (let i = 1; i < points.length; i++) if (points[i].t - points[i - 1].t > 0.67) gaps.push([points[i - 1].t, points[i].t]);
    const c = byMmsi.get(track.mmsi);
    const prox = c?.components.proximity.raw;
    const temp = c?.components.temporality.raw;
    const why = c && c.collationScore > 0
      ? `Closest pass ${prox?.minSourceRegionDistanceKm?.toFixed(1) ?? '—'} km from the reconstructed source region; best timing match ${temp?.bestMatchingHindcastAgeHours ?? '—'} h before the pass.`
      : c ? 'Track never came near the reconstructed source region in the release window.' : undefined;
    return {
      id: track.vesselId, name: track.name, type: track.type, kind, flag: track.flag, mmsi: track.mmsi,
      ...particulars(track.mmsi, kind, near),
      imo: track.imo ?? particulars(track.mmsi, kind, near).imo,
      callsign: track.callsign ?? particulars(track.mmsi, kind, near).callsign,
      points, gaps,
      rank: c?.rank, score: c?.collationScore,
      parts: c ? { proximity: c.components.proximity.value, temporality: c.components.temporality.value, parity: c.components.parity.value } : undefined,
      why, limits: c?.evidenceLimitations,
    };
  });
}

const NAMES = ['SAGAR DEEP', 'OCEAN PEARL', 'JAL VAHINI', 'MAERSK KOLKATA', 'DESH ABHIMAN', 'NORD HIMALAYA', 'SWARNA GANGA', 'ORIENT CEDAR', 'KAVERI SPIRIT', 'AEGEAN PRIDE', 'STAR KESTREL', 'GOLDEN TERN', 'BRAHMAPUTRA', 'SEA CHALLENGER'];
const BOATS = ['MAHA LAXMI', 'SAI KRUPA', 'JAGANNATH', 'MAA TARINI', 'ST. ANTONY', 'BHAGYA LAXMI', 'MATSYA 7', 'JAI HANUMAN', 'SAMUDRA RANI', 'DARYA SAGAR'];
const TYPES: [string, Kind][] = [['Crude oil tanker', 'tanker'], ['Product tanker', 'tanker'], ['Container ship', 'container'], ['Bulk carrier', 'bulk'], ['General cargo', 'cargo'], ['LPG carrier', 'gas'], ['Offshore supply', 'tug'], ['Fishing', 'fishing'], ['Fishing', 'fishing'], ['Fishing', 'fishing']];

/**
 * A traffic picture for a slick with no AIS file: a dozen vessels whose tracks
 * stay at sea, one of them passing close to the slick at the likely release
 * time with its AIS silent for part of it.
 */
export function generate(slickId: string, centre: Pt, land: Land | undefined): MapVessel[] {
  const r = rng(hash(slickId));
  const out: MapVessel[] = [];
  for (let attempt = 0; out.length < 12 && attempt < 160; attempt++) {
    const i = out.length;
    const [type, kind] = i === 0 ? TYPES[r() > 0.5 ? 0 : 1] : TYPES[Math.floor(r() * TYPES.length)];
    const anchored = kind !== 'fishing' && i > 0 && r() < 0.18;
    const passKm = i === 0 ? 0.8 + r() * 1.2 : 2 + r() * 20;
    const pass = move(centre, r() * 360, passKm);
    const tPass = i === 0 ? -(6 + r() * 4) : -12 + r() * 12;
    const along = coastBearing(land, pass);
    const heading = kind !== 'fishing' && along !== undefined ? (along + (r() < 0.5 ? 0 : 180) + (r() - 0.5) * 30 + 360) % 360 : r() * 360;
    const knots = anchored ? 0 : kind === 'fishing' ? 2.5 + r() * 3 : 9 + r() * 7;
    const points: TrackPoint[] = [];
    for (let t = -12; t <= 0.5001; t += 1 / 3) {
      let at: Pt;
      if (anchored) at = move(pass, (t * 40) % 360, 0.25);
      else if (kind === 'fishing') at = move(move(pass, heading, Math.sin((t - tPass) * 0.9) * 3), heading + 90, (t - tPass) * 0.35);
      else at = move(pass, heading, (t - tPass) * knots * 1.852);
      points.push({ t: Math.round(t * 1000) / 1000, lon: at[0], lat: at[1] });
    }
    // Keep the stretch at sea around the pass; the ship left or entered port outside it.
    const pi = points.reduce((best, q, k) => (Math.abs(q.t - tPass) < Math.abs(points[best].t - tPass) ? k : best), 0);
    if (onLand(land, [points[pi].lon, points[pi].lat])) continue;
    let lo = pi;
    let hi = pi;
    while (lo > 0 && !onLand(land, [points[lo - 1].lon, points[lo - 1].lat])) lo--;
    while (hi < points.length - 1 && !onLand(land, [points[hi + 1].lon, points[hi + 1].lat])) hi++;
    if (hi - lo < 9) continue;
    points.splice(hi + 1);
    points.splice(0, lo);
    if (out.some((o) => o.name === (kind === 'fishing' ? BOATS : NAMES)[(hash(slickId) + i * 7) % (kind === 'fishing' ? BOATS : NAMES).length])) continue;
    const mmsi = String(419_000_000 + (hash(slickId + i) % 999_999));
    let gaps: [number, number][] = [];
    let kept = points;
    if (i === 0) {
      const g: [number, number] = [tPass - 0.8, tPass + 0.9];
      kept = points.filter((p) => p.t <= g[0] || p.t >= g[1]);
      gaps = [g];
    }
    const pool = kind === 'fishing' ? BOATS : NAMES;
    const name = pool[(hash(slickId) + i * 7) % pool.length];
    out.push({ id: mmsi, name, type, kind, flag: kind === 'fishing' ? 'IND' : FLAGS[Math.floor(r() * FLAGS.length)], mmsi, ...particulars(mmsi, kind, centre), points: kept, gaps });
  }
  // A ranking by closest approach and timing, as the attribution stage would give.
  const scored = out.map((v) => {
    const cpa = closestApproach(v, centre);
    const proximity = Math.max(0, 1 - cpa.km / 20);
    const temporality = Math.max(0, 1 - Math.abs(cpa.t + 8) / 10);
    const parity = v.kind === 'fishing' ? 0.2 : 0.4 + (hash(v.mmsi) % 50) / 100;
    return { v, cpa, proximity, temporality, parity, score: 0.6 * proximity + 0.25 * temporality + 0.15 * parity };
  }).sort((a, b) => b.score - a.score);
  scored.forEach((s, k) => {
    s.v.rank = k + 1;
    s.v.score = Math.round(s.score * 1000) / 1000;
    s.v.parts = { proximity: s.proximity, temporality: s.temporality, parity: s.parity };
    s.v.why = `Closest pass ${s.cpa.km.toFixed(1)} km from the slick at T${s.cpa.t >= 0 ? '+' : '−'}${Math.abs(s.cpa.t).toFixed(1)} h${s.v.gaps.length ? `; AIS silent for ${Math.round((s.v.gaps[0][1] - s.v.gaps[0][0]) * 60)} min around it` : ''}.`;
    if (s.v.gaps.length) s.v.limits = 'A gap is a question for the operator, not evidence of discharge. Only a sample from the vessel can link it to the slick.';
  });
  return out;
}

/* ------------------------------------------------------- infrastructure */

export interface Site { name: string; kind: 'platform' | 'spm' | 'terminal'; operator: string; at: Pt }

export const SITES: Site[] = [
  { name: 'Vadinar SPM-1', kind: 'spm', operator: 'Nayara Energy', at: [69.69, 22.52] },
  { name: 'Vadinar SPM-2', kind: 'spm', operator: 'Nayara Energy', at: [69.665, 22.535] },
  { name: 'Sikka SPM', kind: 'spm', operator: 'Reliance', at: [69.79, 22.49] },
  { name: 'Sikka SPM-2', kind: 'spm', operator: 'Reliance', at: [69.82, 22.5] },
  { name: 'Mundra SPM', kind: 'spm', operator: 'HPCL-Mittal', at: [69.63, 22.72] },
  { name: 'Vadinar COT', kind: 'terminal', operator: 'IOCL', at: [69.73, 22.49] },
  { name: 'Kandla oil jetty', kind: 'terminal', operator: 'DPA Kandla', at: [70.21, 23.0] },
  { name: 'Mumbai High North', kind: 'platform', operator: 'ONGC', at: [71.33, 19.62] },
  { name: 'Mumbai High South', kind: 'platform', operator: 'ONGC', at: [71.44, 19.3] },
  { name: 'Neelam', kind: 'platform', operator: 'ONGC', at: [72.12, 19.32] },
  { name: 'Heera', kind: 'platform', operator: 'ONGC', at: [72.33, 18.93] },
  { name: 'Bassein', kind: 'platform', operator: 'ONGC', at: [72.05, 19.45] },
  { name: 'Panna', kind: 'platform', operator: 'ONGC', at: [72.3, 19.72] },
  { name: 'Pir Pau terminal', kind: 'terminal', operator: 'BPCL / HPCL', at: [72.89, 19.0] },
  { name: 'JNPA liquid berth', kind: 'terminal', operator: 'JNPA', at: [72.95, 18.96] },
  { name: 'Kochi SPM', kind: 'spm', operator: 'BPCL', at: [76.13, 9.99] },
  { name: 'Chennai SPM', kind: 'spm', operator: 'CPCL', at: [80.37, 13.2] },
  { name: 'KG-D6 platform', kind: 'platform', operator: 'Reliance', at: [82.62, 16.23] },
  { name: 'KG-D5 FPSO', kind: 'platform', operator: 'ONGC', at: [82.45, 16.37] },
  { name: 'Paradip SPM', kind: 'spm', operator: 'IOCL', at: [86.78, 20.22] },
  { name: 'Paradip oil jetty', kind: 'terminal', operator: 'PPA', at: [86.68, 20.26] },
  { name: 'Haldia oil jetty', kind: 'terminal', operator: 'SMP Kolkata', at: [88.07, 22.02] },
];

export interface Area { name: string; kind: string; at: Pt; radiusKm: number }

export const PROTECTED: Area[] = [
  { name: 'Marine National Park', kind: 'Coral reef, mangrove', at: [69.9, 22.52], radiusKm: 22 },
  { name: 'Pirotan Island', kind: 'Coral reef', at: [69.95, 22.6], radiusKm: 3 },
  { name: 'Narara reef', kind: 'Intertidal reef', at: [69.72, 22.45], radiusKm: 4 },
  { name: 'Kutch mangroves', kind: 'Mangrove', at: [70.1, 22.85], radiusKm: 12 },
  { name: 'Thane Creek flamingo sanctuary', kind: 'Mangrove, wetland', at: [72.99, 19.1], radiusKm: 7 },
  { name: 'Malvan marine sanctuary', kind: 'Coral reef', at: [73.45, 16.05], radiusKm: 6 },
  { name: 'Vembanad wetland', kind: 'Ramsar wetland', at: [76.36, 9.6], radiusKm: 12 },
  { name: 'Gulf of Mannar', kind: 'Marine biosphere reserve', at: [78.9, 9.1], radiusKm: 40 },
  { name: 'Balukhand beach', kind: 'Turtle nesting', at: [85.96, 19.84], radiusKm: 6 },
  { name: 'Gahirmatha', kind: 'Olive ridley nesting', at: [86.98, 20.6], radiusKm: 18 },
  { name: 'Bhitarkanika mangroves', kind: 'Mangrove', at: [86.9, 20.72], radiusKm: 14 },
  { name: 'Sundarbans', kind: 'Mangrove, tiger reserve', at: [88.8, 21.9], radiusKm: 45 },
];

export const ANCHORAGES: Area[] = [
  { name: 'Vadinar anchorage', kind: 'Anchorage', at: [69.6, 22.62], radiusKm: 5 },
  { name: 'Kandla outer anchorage', kind: 'Anchorage', at: [69.95, 22.85], radiusKm: 6 },
  { name: 'Mumbai outer anchorage', kind: 'Anchorage', at: [72.68, 19.0], radiusKm: 7 },
  { name: 'Kochi anchorage', kind: 'Anchorage', at: [76.1, 9.95], radiusKm: 4 },
  { name: 'Paradip anchorage', kind: 'Anchorage', at: [86.8, 20.15], radiusKm: 6 },
  { name: 'Chennai anchorage', kind: 'Anchorage', at: [80.4, 13.1], radiusKm: 5 },
];

/** Traffic separation and coastal lanes, as polylines. */
export const LANES: { name: string; line: Pt[] }[] = [
  { name: 'Gulf of Kutch approach', line: [[68.6, 22.45], [69.2, 22.56], [69.6, 22.64], [69.95, 22.8], [70.2, 22.98]] },
  { name: 'Vadinar approach', line: [[69.2, 22.56], [69.5, 22.55], [69.69, 22.52]] },
  { name: 'West coast lane', line: [[70.5, 21.5], [72.3, 19.4], [72.6, 18.4], [73.3, 16], [74.3, 13], [75.6, 10.5], [76.4, 8.4]] },
  { name: 'Mumbai approach', line: [[72.3, 18.85], [72.7, 18.92], [72.9, 18.94]] },
  { name: 'East coast lane', line: [[79.9, 10.8], [80.5, 13.3], [81.4, 15.5], [83.6, 17.4], [85.8, 19.35], [86.9, 20.1], [87.9, 21.2]] },
  { name: 'Paradip approach', line: [[86.95, 20.0], [86.8, 20.18], [86.7, 20.25]] },
  { name: 'Cape route', line: [[73, 7.5], [76.5, 7.2], [79.5, 5.7], [82, 5.9]] },
];

/** Chart soundings: depth grows with distance from the coast, with some seabed texture. */
export function soundings(land: Land | undefined, bounds: [number, number, number, number], seed: string) {
  const r = rng(hash(seed));
  const [w, s, e, n] = bounds;
  const out: { at: Pt; m: number }[] = [];
  const cols = 9;
  const rows = 7;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const at: Pt = [w + ((i + 0.3 + r() * 0.4) / cols) * (e - w), s + ((j + 0.3 + r() * 0.4) / rows) * (n - s)];
      if (onLand(land, at)) continue;
      out.push({ at, m: depthAt(land, at, r()) });
    }
  }
  return out;
}

export function depthAt(land: Land | undefined, at: Pt, jitter = 0.5) {
  const c = coastKm(land, at) ?? 60;
  return Math.round(Math.min(180, 2 + c * (c < 20 ? 1.2 : 2.1) + jitter * 6));
}

/**
 * An AIS extract that stops before the pass leaves ships frozen. Carry each
 * track on to the pass along its last course and speed, stopping short of
 * land, and cut out the silence the attribution evidence records ("AIS silent
 * for 2.2 h, starting 48 min after…").
 */
export function carryToPass(vessels: MapVessel[], land: Land | undefined): MapVessel[] {
  return vessels.map((v) => {
    const pts = v.points;
    const last = pts[pts.length - 1];
    if (pts.length < 2 || last.t >= -0.2) return v;
    const prev = pts[pts.length - 2];
    const heading = bearingOf([prev.lon, prev.lat], [last.lon, last.lat]);
    const kmh = kmBetween([prev.lon, prev.lat], [last.lon, last.lat]) / Math.max(0.05, last.t - prev.t);
    const silent = /silent for ([\d.]+) h, starting (\d+) min/.exec(v.limits ?? '');
    const gapStart = silent ? last.t + Number(silent[2]) / 60 : undefined;
    const gapEnd = silent ? gapStart! + Number(silent[1]) : undefined;
    const more: TrackPoint[] = [];
    let at: Pt = [last.lon, last.lat];
    for (let t = last.t + 1 / 6; t <= 0.0001; t += 1 / 6) {
      const next = move(at, heading, kmh / 6);
      if (onLand(land, next) || (coastKm(land, next) ?? 99) < 1.5) {
        // Arrived or at the coast: hold position (at anchor or berth).
      } else at = next;
      if (gapStart !== undefined && t > gapStart && t < gapEnd!) continue;
      more.push({ t: Math.round(t * 1000) / 1000, lon: at[0], lat: at[1] });
    }
    const points = [...pts, ...more];
    const gaps: [number, number][] = [];
    for (let i = 1; i < points.length; i++) if (points[i].t - points[i - 1].t > 0.67) gaps.push([points[i - 1].t, points[i].t]);
    return { ...v, points, gaps };
  });
}

/** Direction the nearest shoreline runs, so coastal traffic can follow it. */
function coastBearing(land: Land | undefined, p: Pt): number | undefined {
  if (!land) return undefined;
  let best: { d: number; a: Pt; b: Pt } | undefined;
  land.rings.forEach((ring, k) => {
    const [w, s, e, n] = land.boxes[k];
    if (p[0] < w - 1 || p[0] > e + 1 || p[1] < s - 1 || p[1] > n + 1) return;
    for (let i = 0; i < ring.length; i++) {
      const d = kmBetween(p, ring[i]);
      if (!best || d < best.d) best = { d, a: ring[Math.max(0, i - 3)], b: ring[Math.min(ring.length - 1, i + 3)] };
    }
  });
  return best && best.d < 80 ? bearingOf(best.a, best.b) : undefined;
}
