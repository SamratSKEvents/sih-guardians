// Dashboard figures, from the data the app actually ships:
//   public/data/catalog/index.json + meta.json (kept = not on land), src/data/slicks.json,
//   public/data/incidents/*.
// Run after tools/land-check.mjs: node tools/dashboard-stats.mjs → public/data/catalog/stats.json
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { onLand, read } from './land.mjs';

const meta = read('public/data/catalog/meta.json');
const catalogue = read('public/data/catalog/index.json').slicks.filter((s) => meta[s.id]);
const demo = read('src/data/slicks.json');

const rows = [
  ...catalogue.map((s) => ({ ver: s.ver, warn: s.warn, t: s.t, km2: (s.area ?? 0) / 1e6, kind: s.kind })),
  ...demo.map(({ properties: p }) => ({ ver: p.verifier, warn: p.lookalikeWarning, t: p.observedAt, km2: (p.areaM2 ?? 0) / 1e6, kind: p.kind })),
];

const count = (f) => rows.filter(f).length;
const byKind = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

// Detections per calendar month, for the dated records only.
const months = {};
for (const r of rows) if (r.t) months[r.t.slice(0, 7)] = (months[r.t.slice(0, 7)] ?? 0) + 1;
const keys = Object.keys(months).sort();
const series = [];
if (keys.length) {
  let [y, m] = keys[0].split('-').map(Number);
  const [ly, lm] = keys.at(-1).split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    series.push([k, months[k] ?? 0]);
    if (++m > 12) { m = 1; y++; }
  }
}

// Hotspots: 10° cells by slick count.
const cells = {};
for (const id of Object.keys(meta)) {
  const [, , x, y] = meta[id];
  const k = `${Math.floor(x / 10) * 10},${Math.floor(y / 10) * 10}`;
  cells[k] = (cells[k] ?? 0) + 1;
}
const hotspots = Object.entries(cells).sort((a, b) => b[1] - a[1]).slice(0, 5)
  .map(([k, n]) => { const [x, y] = k.split(',').map(Number); return { centre: [x + 5, y + 5], count: n }; });

// Incident bundles: vessels on AIS, drift forecasts run.
const dir = new URL('../public/data/incidents/', import.meta.url);
let aisVessels = 0, forecasts = 0, bundles = 0;
for (const id of readdirSync(dir)) {
  const ais = read(`public/data/incidents/${id}/ais.json`);
  if (ais.tracks?.length) { bundles++; aisVessels += ais.tracks.length; }
  if (existsSync(new URL(`${id}/forecast.json`, dir)) && read(`public/data/incidents/${id}/forecast.json`).status !== 'UNAVAILABLE' && read(`public/data/incidents/${id}/forecast.json`).track) forecasts++;
}

const stats = {
  generatedAt: new Date().toISOString(),
  total: rows.length,
  investigated: demo.length,
  areaKm2: Math.round(rows.reduce((a, r) => a + r.km2, 0)),
  byKind,
  verification: {
    agrees: count((r) => r.ver === 'MULTI_MODEL_SUPPORTED'),
    lookalike: count((r) => r.warn),
    noSecondOpinion: count((r) => r.ver === 'SECOND_OPINION_UNAVAILABLE'),
    externalCatalogue: count((r) => !r.ver),
  },
  dated: series.reduce((a, [, n]) => a + n, 0),
  monthly: series,
  hotspots,
  aisVessels,
  bundles,
  forecasts,
};
writeFileSync(new URL('../public/data/catalog/stats.json', import.meta.url), JSON.stringify(stats));

// Per-slick rows for the dashboard's own filtering, columnar to stay small.
// kind: index into KINDS. ver: 0 agrees, 1 independent catalogue, 2 no second opinion, 3 look-alike.
const KINDS = ['EDGE', 'CERULEAN', 'CLEANSEANET', 'RECONSTRUCTION'];
const verOf = (ver, warn) => (warn ? 3 : ver === 'MULTI_MODEL_SUPPORTED' ? 0 : ver ? 2 : 1);
const all = [
  ...catalogue.map((s) => ({ kind: s.kind, v: verOf(s.ver, s.warn), t: s.t, km2: (s.area ?? 0) / 1e6, c: s.c, p: s.p, inv: 0 })),
  ...demo.map(({ properties: p }) => ({ kind: p.kind, v: verOf(p.verifier, p.lookalikeWarning), t: p.observedAt, km2: (p.areaM2 ?? 0) / 1e6, c: p.centroid, p: p.probability, inv: 1 })),
];
const cols = {
  kinds: KINDS,
  kind: all.map((r) => KINDS.indexOf(r.kind)),
  ver: all.map((r) => r.v),
  day: all.map((r) => (r.t ? r.t.slice(0, 10) : null)),
  km2: all.map((r) => +r.km2.toFixed(4)),
  lon: all.map((r) => +r.c[0].toFixed(2)),
  lat: all.map((r) => +r.c[1].toFixed(2)),
  p: all.map((r) => (r.p == null ? null : +r.p.toFixed(2))),
  inv: all.map((r) => r.inv),
  // 72×36 cells of 5°, row-major from 90N/180W: '1' where most of the cell is land.
  land: Array.from({ length: 36 * 72 }, (_, g) => {
    const w = (g % 72) * 5 - 180, n = 90 - Math.floor(g / 72) * 5;
    let hits = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) hits += onLand(w + 0.5 + i, n - 0.5 - j) ? 1 : 0;
    return hits >= 13 ? '1' : '0';
  }).join(''),
};
writeFileSync(new URL('../public/data/catalog/rows.json', import.meta.url), JSON.stringify(cols));
console.log(JSON.stringify({ ...stats, monthly: `${series.length} months` }, null, 1));
