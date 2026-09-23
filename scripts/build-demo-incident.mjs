// Builds the demo investigation for edge:oil_04471 (Gulf of Kutch), in the same
// bundle shape used by the prototype, plus its 20-record static slick catalog.
//
// Real inputs: the TerraMind scene (SAR, mask, probability, outlines), moved to
// the demo location. Everything else is a scenario, computed once here from a
// single set of wind/current fields so every number agrees with every other.
//
//   node scripts/build-demo-incident.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const ID = 'gulf-of-kutch-04471';
const SLICK_ID = 'edge:oil_04471';
const SCENE = 'S1A_IW_GRDH_1SDV_20260314T061208_053012';
const T0 = Date.parse('2026-03-14T06:12:00Z');
const H = 3600e3;
const OUT = `public/data/incidents/${ID}`;
const SRC = 'public/data/incidents/terramind-oil-00000';
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const D = Math.PI / 180;
const KM = 111.32;
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ rng
let seed = 4471;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
const uuid = () => `${hex(9)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;

// ------------------------------------------------------------------ geo
const kmBetween = (a, b) => Math.hypot((a[0] - b[0]) * KM * Math.cos(((a[1] + b[1]) / 2) * D), (a[1] - b[1]) * KM);
const move = ([lon, lat], eKm, nKm) => [lon + eKm / (KM * Math.cos(lat * D)), lat + nKm / KM];
const along = (p, deg, km) => move(p, km * Math.sin(deg * D), km * Math.cos(deg * D));
const bearing = (a, b) => ((Math.atan2((b[0] - a[0]) * Math.cos(a[1] * D), b[1] - a[1]) / D) + 360) % 360;
const r5 = (x) => Math.round(x * 1e5) / 1e5;

// Land, from the same Natural Earth file the forecast engine strands oil on.
const topo = JSON.parse(readFileSync('public/data/land-50m.json', 'utf8'));
const arcs = topo.arcs.map((a) => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * topo.transform.scale[0] + topo.transform.translate[0], y * topo.transform.scale[1] + topo.transform.translate[1]]; }); });
const rings = [];
const ring = (refs) => refs.flatMap((r, i) => { const s = r >= 0 ? arcs[r] : [...arcs[~r]].reverse(); return i ? s.slice(1) : s; });
const walk = (o) => o.type === 'GeometryCollection' ? o.geometries.forEach(walk) : o.type === 'Polygon' ? o.arcs.forEach((r) => rings.push(ring(r))) : o.arcs.forEach((p) => p.forEach((r) => rings.push(ring(r))));
Object.values(topo.objects).forEach(walk);
const near = rings.filter((r) => r.some(([x, y]) => x > 66 && x < 73 && y > 20 && y < 25));
const onLand = ([x, y]) => near.reduce((inside, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return inside !== c; }, false);

// ------------------------------------------------------------------ places
const SLICK = [69.585, 22.565];
const PIROTAN = [69.955, 22.6];
const PLACES = [
  { name: 'Pirotan Island', kind: 'Marine national park', at: PIROTAN, status: 'critical', label: 'Critical' },
  { name: 'Sikka intake', kind: 'Desalination intake', at: [69.83, 22.45], status: 'critical', label: 'Critical' },
  { name: 'Positra mangrove', kind: 'Mangrove', at: [69.2, 22.4], status: 'warning', label: 'Watch' },
  { name: 'Okha harbour', kind: 'Fishing harbour', at: [69.07, 22.47], status: 'inactive', label: 'Low' },
];

// ------------------------------------------------------------------ forcing
// Wind blowing TOWARDS ~080 (a westerly sea breeze up the gulf), a strong M2
// tide along the gulf axis, and a weak flood-residual current.
const windAt = (t, [lon, lat]) => {
  const to = 80 + 10 * Math.sin((2 * Math.PI * t) / 26) + 6 * (lat - 22.5);
  const s = 6.4 + 1.3 * Math.sin((2 * Math.PI * t) / 18 + 0.7) + 0.4 * (lon - 69.5);
  return [s * Math.sin(to * D), s * Math.cos(to * D)];
};
const currentAt = (t, [lon, lat]) => {
  const tide = 0.42 * Math.sin((2 * Math.PI * (t + 1.2)) / 12.42) * (1 + 0.2 * (lon - 69.5));
  const res = 0.14;
  return [tide * Math.sin(72 * D) + res * Math.sin(84 * D) + 0.02 * (lat - 22.5), tide * Math.cos(72 * D) + res * Math.cos(84 * D)];
};
const drift = (t, p, windage) => { const w = windAt(t, p), c = currentAt(t, p); return [c[0] + windage * w[0], c[1] + windage * w[1]]; };

// ------------------------------------------------------------------ detection: the real scene, moved
const det0 = JSON.parse(readFileSync(`${SRC}/detection.json`, 'utf8'));
const [w0, s0, e0, n0] = det0.rasterBounds;
const K = 3; // linear scale: area x9
const main0 = det0.slicks[0].centroid;
const u0 = (main0.lon - w0) / (e0 - w0), v0 = (n0 - main0.lat) / (n0 - s0);
const latSpan = (n0 - s0) * K, lonSpan = ((e0 - w0) * K * Math.cos(55.24 * D)) / Math.cos(SLICK[1] * D);
const W = SLICK[0] - u0 * lonSpan, N = SLICK[1] + v0 * latSpan;
const BOUNDS = [W, N - latSpan, W + lonSpan, N].map(r5);
const tx = ([lon, lat]) => [r5(W + ((lon - w0) / (e0 - w0)) * lonSpan), r5(N - ((n0 - lat) / (n0 - s0)) * latSpan)];
// The scene's two specks in its far corner are 20 km off once scaled, and would
// land on the coast; the investigation is about the slick and its two tails.
const nearMain = (sl) => Math.hypot((sl.centroid.lon - main0.lon) * Math.cos(55.24 * D), sl.centroid.lat - main0.lat) * KM < 1.5;
const slicks = det0.slicks.filter(nearMain).map((sl, i) => ({
  ...sl,
  id: `oil_04471-slick-${i + 1}`,
  polygon: { type: 'Polygon', coordinates: sl.polygon.coordinates.map((r) => r.map(tx)) },
  areaM2: sl.areaM2 * K * K, areaKm2: sl.areaKm2 * K * K, perimeterM: sl.perimeterM * K, lengthM: sl.lengthM * K, widthM: sl.widthM * K,
  centroid: Object.fromEntries(Object.entries({ lon: tx([sl.centroid.lon, sl.centroid.lat])[0], lat: tx([sl.centroid.lon, sl.centroid.lat])[1] })),
}));
const areaKm2 = slicks.reduce((a, s) => a + s.areaKm2, 0);
const main = slicks[0];
// principal axis of the main outline, in km
const mainRing = main.polygon.coordinates[0];
const cx = mainRing.reduce((a, p) => a + p[0], 0) / mainRing.length, cy = mainRing.reduce((a, p) => a + p[1], 0) / mainRing.length;
let sxx = 0, syy = 0, sxy = 0;
for (const [x, y] of mainRing) { const ex = (x - cx) * KM * Math.cos(cy * D), ny = (y - cy) * KM; sxx += ex * ex; syy += ny * ny; sxy += ex * ny; }
const AXIS = ((90 - (0.5 * Math.atan2(2 * sxy, sxx - syy)) / D) + 360) % 180; // bearing of long axis, 0-180

for (const f of ['sar.png', 'mask.png', 'probability.png']) await sharp(`${SRC}/${f}`).resize(1400).png({ compressionLevel: 9 }).toFile(`${OUT}/${f}`);

const detection = {
  ...det0,
  incidentId: ID, sceneId: SCENE, acquisitionTime: iso(T0),
  acquisitionTimeState: { status: 'AVAILABLE' },
  sensor: 'Sentinel-1A', sensorState: { status: 'AVAILABLE' },
  rasterBounds: BOUNDS, metricCrs: 'EPSG:32642', generatedAt: iso(T0 + 14 * 60e3),
  slicks, slickCount: slicks.length, totalAreaKm2: areaKm2,
  sarImagery: { ...det0.sarImagery, url: `/data/incidents/${ID}/sar.png`, bounds: BOUNDS },
  probabilityRaster: { ...det0.probabilityRaster, url: `/data/incidents/${ID}/probability.png`, bounds: BOUNDS },
  maskRaster: { ...det0.maskRaster, url: `/data/incidents/${ID}/mask.png`, bounds: BOUNDS },
  groundTruth: { status: 'UNAVAILABLE', reason: 'NO_GROUND_TRUTH', detail: 'No aerial or vessel confirmation yet. The Dornier sortie requested in the action plan is the first opportunity.' },
  attributionStatus: 'SUPPORTED',
};
delete detection.acquisitionTimeState.reason;

// ------------------------------------------------------------------ environment grid
const lats = Array.from({ length: 9 }, (_, i) => 23.5 - i * 0.25);
const lons = Array.from({ length: 13 }, (_, i) => 68.5 + i * 0.25);
const times = Array.from({ length: 85 }, (_, i) => T0 - 36 * H + i * H);
const field = (fn) => times.map((ms) => lats.flatMap((la) => lons.flatMap((lo) => fn((ms - T0) / H, [lo, la]).map((x) => Math.round(x * 1000) / 1000))));
const windFrames = field(windAt);
const curFrames = field(currentAt);
const speedRange = (frames) => { const s = frames.flatMap((f) => f.filter((_, i) => i % 2 === 0).map((u, i) => Math.hypot(u, f[i * 2 + 1]))); return [Math.min(...s), Math.max(...s)].map((x) => Math.round(x * 1000) / 1000); };
const environment = {
  status: 'AVAILABLE',
  metadata: {
    era5_dataset_id: 'reanalysis-era5-single-levels', incois_product_id: 'HOOFS-GoK 2 km surface currents',
    variables: { era5: ['10m_u_component_of_wind', '10m_v_component_of_wind'], currents: ['uo', 'vo'] },
    temporal_resolution: 'hourly', geographic_bounds: { west: 68.5, east: 71.5, south: 21.5, north: 23.5 },
    requested_time_interval: { start: iso(times[0]), end: iso(times.at(-1)) },
    units: { era5_wind: 'm s-1', currents: 'm s-1', directions: 'degrees' }, source_type: 'analysis + forecast',
  },
  wind: { lats, lons, times: times.map(iso), frames: windFrames, gridShape: [lats.length, lons.length], missingPercent: 0, speedRange: speedRange(windFrames), units: 'm s-1', dataset: 'reanalysis-era5-single-levels', variable: '10 m wind (u10, v10)', sourceType: 'reanalysis', provider: 'ECMWF ERA5' },
  currents: { lats, lons, times: times.map(iso), frames: curFrames, gridShape: [lats.length, lons.length], missingPercent: 0, speedRange: speedRange(curFrames), units: 'm s-1', dataset: 'hoofs_gok_2km_surface_uv', product: 'INCOIS HOOFS Gulf of Kutch', variable: 'surface currents (uo, vo)', sourceType: 'model analysis', provider: 'INCOIS', coverageNote: 'Tidal currents reach 0.5 m/s along the gulf axis; the drift is dominated by the M2 tide, with the wind adding a steady eastward push.' },
  pointTimeseries: {
    note: 'Nearest grid point to the detection; no interpolation.', lat: SLICK[1], lon: SLICK[0],
    rows: times.map((ms) => { const t = (ms - T0) / H, [wu, wv] = windAt(t, SLICK), [cu, cv] = currentAt(t, SLICK); return { t: iso(ms), windSpeed: +Math.hypot(wu, wv).toFixed(2), windDir: +(((Math.atan2(wu, wv) / D) + 180 + 360) % 360).toFixed(0), currentSpeed: +Math.hypot(cu, cv).toFixed(3), currentBearing: +(((Math.atan2(cu, cv) / D) + 360) % 360).toFixed(0) }; }),
  },
};

// ------------------------------------------------------------------ backtrack
const SCEN = [0, 0.01, 0.02, 0.03];
const AGES = [3, 6, 9, 12, 18, 24];
const hypotheses = [];
const hypAt = {}; // scenario -> hourly centre/radius (for scoring)
for (const wd of SCEN) {
  const name = `windage_${wd * 100}%`;
  let ps = Array.from({ length: 256 }, () => along(along(SLICK, AXIS, gauss() * 1.6), AXIS + 90, gauss() * 0.5));
  const alive = ps.map(() => true);
  hypAt[name] = [];
  for (let h = 0; h <= 24; h++) {
    const act = ps.filter((_, i) => alive[i]);
    const c = [act.reduce((a, p) => a + p[0], 0) / act.length, act.reduce((a, p) => a + p[1], 0) / act.length];
    const r = Math.sqrt(act.reduce((a, p) => a + kmBetween(p, c) ** 2, 0) / act.length);
    hypAt[name][h] = { centre: c, r: Math.max(1.5, r), n: act.length };
    if (AGES.includes(h)) hypotheses.push({ scenario: name, ageHours: h, time: iso(T0 - h * H), centre: { lon: r5(c[0]), lat: r5(c[1]) }, spreadRadiusKm: +r.toFixed(3), particleCount: act.length, interpretation: 'ensemble source-support hypothesis; not a calibrated probability or confirmed release location' });
    for (let s = 0; s < 4; s++) {
      const t = -(h + s / 4);
      ps = ps.map((p, i) => {
        if (!alive[i]) return p;
        const [u, v] = drift(t, p, wd);
        const q = move(p, (-u * 900) / 1000 + gauss() * 0.24, (-v * 900) / 1000 + gauss() * 0.24);
        if (onLand(q)) { alive[i] = false; return p; }
        return q;
      });
    }
  }
}
const sourceHypotheses = {
  status: 'AVAILABLE', kind: 'ENSEMBLE_POINTS', scenarios: SCEN.map((w) => `windage_${w * 100}%`), ageHours: AGES, hypotheses,
  rasterSurface: { status: 'UNAVAILABLE', reason: 'NO_SOURCE_SUPPORT_RASTER', detail: 'Vector support points only. The source region is drawn from ensemble spread radii and is not a calibrated probability density.' },
  warnings: ['Sensitivity scenarios are not calibrated probabilities.', 'Tidal currents dominate: a one-hour error in release time moves the source region by up to 1.5 km along the gulf axis.', 'Particles that reached the shoreline were marked inactive.'],
};

// ------------------------------------------------------------------ forward track
const track = [];
let p = SLICK, contact = null;
for (let h = 0; h <= 48; h++) {
  track.push({ lon: r5(p[0]), lat: r5(p[1]), hours: h, time: iso(T0 + h * H) });
  if (contact === null && kmBetween(p, PIROTAN) < 2.5) contact = h;
  if (contact !== null) continue;
  for (let s = 0; s < 4; s++) { const [u, v] = drift(h + s / 4, p, 0.03); const q = move(p, (u * 900) / 1000, (v * 900) / 1000); if (!onLand(q)) p = q; }
}
if (contact === null) throw new Error(`no contact; ends ${kmBetween(p, PIROTAN).toFixed(1)} km from Pirotan`);
const ETA = { 'Pirotan Island': contact, 'Sikka intake': contact + 13, 'Positra mangrove': contact + 31, 'Okha harbour': contact + 57 };
const forecast = {
  status: 'AVAILABLE', kind: 'ENSEMBLE_CENTROID_ADVECTION', validHorizonsHours: [1, 3, 6, 12, 24, 48],
  horizons: [1, 3, 6, 12, 24].map((hours) => ({ hours, status: 'AVAILABLE' })).concat([{ hours: 48, status: 'PARTIAL', detail: 'Beyond +36 h the wind field is itself a forecast, so error compounds. The tail indicates direction, not arrival time.' }]),
  track, method: 'Hourly centroid advection: surface current plus 3% wind drag, stopped at the shoreline.',
  interpretation: 'Where the centre of the floating oil goes. The live run on the chart shows how the slick itself spreads.',
  forcingCoverage: { first: iso(times[0]), last: iso(times.at(-1)), tolerance_minutes: 30 },
  footprintPolygon: { status: 'UNAVAILABLE', reason: 'LIVE_RUN_ONLY', detail: 'The footprint is computed live on the chart rather than frozen here.' },
  consequence: { status: 'AVAILABLE', detail: `Shoreline contact predicted at Pirotan Island (Marine National Park) at +${contact} h, ${new Date(T0 + contact * H).toUTCString().slice(5, 22)} UTC. The Sikka desalination intake is next, at +${contact + 13} h.` },
  warnings: ['Arrival times carry about ±4 h at +24 h and grow after that.'],
};

// ------------------------------------------------------------------ AIS
const PORT = { mouth: [68.8, 22.63], vadinar: [69.71, 22.53], sikka: [69.84, 22.49], mundra: [69.7, 22.71], kandla: [70.2, 22.93], navlakhi: [70.43, 22.93] };
const tStart = T0 - 30 * H, tEnd = T0 + 3 * H;
const routeAt = (wps, t0, kn) => (t) => {
  let d = ((t - t0) / H) * kn * 1.852;
  if (d < 0) return null;
  for (let i = 1; i < wps.length; i++) { const seg = kmBetween(wps[i - 1], wps[i]); if (d <= seg) return along(wps[i - 1], bearing(wps[i - 1], wps[i]), d); d -= seg; }
  return null;
};
const ais = [];
const addVessel = (v) => {
  const points = [];
  for (let t = tStart; t <= tEnd; t += 10 * 60e3) {
    if (v.gap && t > v.gap[0] && t < v.gap[1]) continue;
    const q = v.pos(t);
    if (q && !onLand(q)) points.push({ t: iso(t), lon: r5(q[0] + gauss() * 0.0004), lat: r5(q[1] + gauss() * 0.0004) });
  }
  if (points.length < 6) return;
  ais.push({ ...v, points });
};
const hyp3 = hypAt['windage_3%'];
const C = (h) => hyp3[h].centre;
// The tanker: inbound to Vadinar SPM, through the T-10 h region, along the slick axis.
const HEADING_IN = AXIS < 90 || AXIS > 270 ? AXIS : (AXIS + 180) % 360;
const tankerHead = bearing(PORT.mouth, PORT.vadinar);
const via = along(C(10), bearing(PORT.mouth, PORT.vadinar) + 90, 1.5);
addVessel({ name: 'SAMUDRA PRABHA', type: 'Crude oil tanker', gearType: null, flag: 'IND', mmsi: '419006731', imo: '9412208', callsign: 'AVRQ', pos: routeAt([along(via, tankerHead + 180, 60), via, PORT.vadinar], T0 - 10 * H - (60 / (12.4 * 1.852)) * H, 12.4), gap: [T0 - 9.2 * H, T0 - 7.0 * H] });
addVessel({ name: 'KEPPEL VANTAGE', type: 'Product tanker', gearType: null, flag: 'SGP', mmsi: '563114908', imo: '9508745', callsign: '9V7741', pos: routeAt([PORT.sikka, along(C(6), 170, 3.2), PORT.mouth], T0 - 6 * H - (kmBetween(PORT.sikka, C(6)) / (11 * 1.852)) * H, 11) });
addVessel({ name: 'HAI FENG 27', type: 'Bulk carrier', gearType: null, flag: 'HKG', mmsi: '477884210', imo: '9633214', callsign: 'VRKQ7', pos: routeAt([PORT.mouth, along(C(9), 0, 1), PORT.mundra], T0 - 19 * H - (kmBetween(PORT.mouth, C(9)) / (10.5 * 1.852)) * H, 10.5) });
addVessel({ name: 'TARINI EXPRESS', type: 'Container ship', gearType: null, flag: 'IND', mmsi: '419118264', imo: '9702311', callsign: 'AVTX', pos: routeAt([PORT.mundra, along(C(12), 330, 6), PORT.mouth], T0 - 12 * H - (kmBetween(PORT.mundra, C(12)) / (14 * 1.852)) * H, 14) });
const NAMES = ['JAG PRAKASH', 'DESH SHAKTI', 'SEA LOTUS', 'MAHARSHI BHARDWAJ', 'GULF PEARL', 'KANDLA SPIRIT', 'ORIENT HARMONY', 'AL MARWAH', 'SWARNA KAMAL', 'OCEAN GRACE', 'KACHCHH PRIDE', 'NAVKAR 3', 'BLUE MARLIN', 'SAGAR SAMRAT', 'MSC ROHINI', 'ASIAN ENDEAVOUR', 'PACIFIC ONYX', 'STAR DELTA', 'VIRAT', 'GOLDEN KESTREL', 'ADANI 7', 'ESSAR SAGAR'];
const TYPES = [['Crude oil tanker', 'IND', '419'], ['Product tanker', 'LBR', '636'], ['Bulk carrier', 'PAN', '355'], ['Container ship', 'SGP', '563'], ['LPG carrier', 'MHL', '538'], ['General cargo', 'IND', '419'], ['Tug', 'IND', '419']];
const ports = Object.keys(PORT).filter((k) => k !== 'mouth');
NAMES.forEach((name) => {
  const [type, flag, mid] = TYPES[Math.floor(rnd() * TYPES.length)];
  const port = PORT[ports[Math.floor(rnd() * ports.length)]];
  const inbound = rnd() < 0.5, kn = 8 + rnd() * 7;
  const lane = along(PORT.mouth, 180 + rnd() * 20 - 10, rnd() * 8);
  const wps = inbound ? [along(lane, 250, 30), lane, port] : [port, lane, along(lane, 250, 30)];
  addVessel({ name, type, gearType: null, flag, mmsi: `${mid}${String(Math.floor(rnd() * 1e6)).padStart(6, '0')}`, imo: String(9300000 + Math.floor(rnd() * 400000)), callsign: `A${hex(4).toUpperCase()}`, pos: routeAt(wps, tStart + rnd() * 26 * H, kn) });
});
for (let i = 0; i < 8; i++) {
  const home = along(SLICK, rnd() * 360, 8 + rnd() * 30);
  if (onLand(home)) continue;
  const ph = rnd() * 10, rad = 0.4 + rnd() * 0.6, set = rnd() * 360;
  // A slow trawl: a small ellipse that walks with the tide.
  addVessel({ name: `IND-GJ-${String(100 + i * 37)}-MM`, type: 'Fishing', gearType: rnd() < 0.5 ? 'Gillnet' : 'Trawl', flag: 'IND', mmsi: `41907${String(Math.floor(rnd() * 1e4)).padStart(4, '0')}`, imo: null, callsign: null, pos: (t) => { const h = (t - T0) / H; return along(along(home, set, 0.25 * h), h * 25 + ph * 36, rad); } });
}

// ------------------------------------------------------------------ ranking (blind: identity never enters)
// Backscatter contrast and the unbroken outline put the oil at under ~14 h old,
// so only source regions inside that window are scored.
const WINDOW = 14;
const posAt = (v, ms) => { let best = null, bd = 1e18; for (const q of v.points) { const d = Math.abs(Date.parse(q.t) - ms); if (d < bd) { bd = d; best = q; } } return bd <= 20 * 60e3 ? [best.lon, best.lat] : null; };
const headingAtV = (v, ms) => { const a = posAt(v, ms - 20 * 60e3), b = posAt(v, ms + 20 * 60e3); return a && b ? bearing(a, b) : null; };
const scored = ais.map((v) => {
  let prox = 0, temp = 0, bestH = 0, bestD = 1e9, minD = 1e9;
  for (const name of Object.keys(hypAt)) for (let h = 1; h <= WINDOW; h++) {
    const { centre, r } = hypAt[name][h];
    let dWin = 1e9;
    for (let dt = -2; dt <= 2; dt += 0.25) { const q = posAt(v, T0 - (h + dt) * H); if (q) dWin = Math.min(dWin, kmBetween(q, centre)); }
    const q = posAt(v, T0 - h * H), dAt = q ? kmBetween(q, centre) : 1e9;
    minD = Math.min(minD, dWin);
    prox = Math.max(prox, Math.exp(-0.5 * (dWin / r) ** 2));
    const tz = Math.exp(-0.5 * (dAt / r) ** 2);
    if (tz > temp) { temp = tz; bestH = h; bestD = dAt; }
  }
  const hd = headingAtV(v, T0 - bestH * H);
  const par = hd === null ? 0 : Math.abs(Math.cos((hd - AXIS) * D));
  const score = 0.6 * prox + 0.25 * temp + 0.15 * par;
  return { v, prox, temp, par, bestH, bestD, minD, hd, score };
}).sort((a, b) => b.score - a.score);

const vid = Object.fromEntries(ais.map((v) => [v.name, uuid()]));
const rounded = (x) => Math.round(x * 1e6) / 1e6;
const candidatesList = scored.map((s, i) => ({
  candidateId: `candidate-${hex(12)}`, vesselId: vid[s.v.name], rank: i + 1, collationScore: rounded(s.score),
  components: {
    proximity: { value: rounded(s.prox), weight: 0.6, contribution: rounded(0.6 * s.prox), origin: 'artifact', raw: { minSourceRegionDistanceKm: +s.minD.toFixed(2) } },
    temporality: { value: rounded(s.temp), weight: 0.25, contribution: rounded(0.25 * s.temp), origin: 'artifact', raw: { bestMatchingHindcastAgeHours: s.bestH, bestMatchingTimeUtc: iso(T0 - s.bestH * H), distanceAtThatTimeKm: +s.bestD.toFixed(2) } },
    parity: { value: rounded(s.par), weight: 0.15, contribution: rounded(0.15 * s.par), origin: 'audit', raw: { vesselHeadingDeg: s.hd === null ? 'n/a' : Math.round(s.hd), slickAxisDeg: Math.round(AXIS) } },
  },
  identity: { vesselId: vid[s.v.name], mmsi: s.v.mmsi, imo: s.v.imo, name: s.v.name, type: s.v.type, gearType: s.v.gearType, flag: s.v.flag, callsign: s.v.callsign },
  observationCount: s.v.points.length,
  audit: { bestMatchingHindcastTimeUtc: iso(T0 - s.bestH * H), scoreGapToRank1: rounded(scored[0].score - s.score) },
  evidenceLimitations: s.v.gap
    ? `AIS silent for ${((s.v.gap[1] - s.v.gap[0]) / H).toFixed(1)} h, starting ${Math.round((s.v.gap[0] - (T0 - 10 * H)) / 60e3)} min after the track crossed the T−10 h source region. A gap is a question for the operator, not evidence of discharge. Only a sample from the vessel can link it to the slick.`
    : 'Position reports place the vessel near the reconstructed region; they cannot show that it discharged anything. Only a sample from the vessel can link it to the slick.',
}));
const candidates = {
  status: 'AVAILABLE', rankingMode: 'blind_baseline_v1',
  scoringFormula: { expression: '0.60 x proximity + 0.25 x temporality + 0.15 x parity', weights: { spatial: 0.6, temporal: 0.25, direction: 0.15 }, note: 'Baseline V1 formula. No weights were tuned, and vessel identity was never a ranking feature. Only source regions from T−1 h to T−14 h are scored: the contrast and unbroken outline of the slick put it at under about 14 hours old.', vocabulary: 'Component names follow the Cerulean convention: proximity (distance to the reconstructed source region), temporality (release-time agreement), parity (agreement between vessel track direction and reconstructed slick orientation).' },
  candidates: candidatesList,
  scoreDistribution: { min: rounded(scored.at(-1).score), max: rounded(scored[0].score), spread: rounded(scored[0].score - scored.at(-1).score) },
  analystNotice: 'A ranking of vessels whose tracks fit the reconstructed source region. It points an inspection at a ship; it does not establish that the ship discharged oil. Sampling decides that.',
  dataQualityWarnings: ['Coastal AIS near the gulf mouth drops out below 3 nm from Okha; two fishing tracks are partial.', 'Sensitivity scenarios are not calibrated probabilities.'],
};
const aisOut = {
  status: 'AVAILABLE', kind: 'AIS_POSITION_REPORTS',
  resolutionNote: 'Terrestrial and satellite AIS, native timestamps, resampled to 10-minute positions for display.',
  times: [iso(tStart), iso(tEnd)], vesselCount: ais.length,
  tracks: scored.map(({ v }) => ({ vesselId: vid[v.name], mmsi: v.mmsi, imo: v.imo, name: v.name, type: v.type, flag: v.flag, callsign: v.callsign, points: v.points, gaps: v.gap ? [{ start: iso(v.gap[0]), end: iso(v.gap[1]) }] : [], reportCount: v.points.length, firstReport: v.points[0].t, lastReport: v.points.at(-1).t })),
  sogCogState: { status: 'AVAILABLE' },
};

// ------------------------------------------------------------------ events
const top = scored[0];
const events = {
  status: 'AVAILABLE',
  events: [
    ...AGES.slice().reverse().map((h) => ({ time: iso(T0 - h * H), kind: 'SOURCE_HYPOTHESIS', label: `Source hypothesis, T-${h} h`, detail: `Ensemble spread ${(hypotheses.filter((x) => x.ageHours === h).reduce((a, x) => a + x.spreadRadiusKm, 0) / 4).toFixed(1)} km, averaged across 4 windage scenarios.`, epistemic: 'reconstructed', ageHours: h })),
    { time: iso(tStart), kind: 'AIS_COVERAGE_START', label: 'AIS coverage begins', detail: `${ais.length} vessels reporting in the search area.`, epistemic: 'observed' },
    { time: iso(T0 - top.bestH * H), kind: 'CANDIDATE_BEST_MATCH', label: `Rank 1 best temporal match — ${top.v.name}`, detail: 'Closest agreement between this vessel\'s reported position and a reconstructed source hypothesis.', epistemic: 'reconstructed' },
    { time: iso(T0), kind: 'DETECTION', label: 'Possible slick detected', detail: `Sentinel-1A, ${slicks.length} parts, ${areaKm2.toFixed(2)} km². Second model agrees.`, epistemic: 'observed' },
    { time: iso(T0 + contact * H), kind: 'SHORELINE_CONTACT', label: 'Shoreline contact, Pirotan Island', detail: 'First predicted arrival of floating oil at a protected shoreline.', epistemic: 'predicted' },
  ].sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
};

// ------------------------------------------------------------------ incident index
const incident = {
  id: ID, kind: 'INVESTIGATION', name: SLICK_ID, subtitle: 'Gulf of Kutch, off Vadinar',
  acquisitionTime: iso(T0), sensor: 'Sentinel-1A', centre: { lon: SLICK[0], lat: SLICK[1] }, bbox: [68.5, 21.5, 71.5, 23.5],
  timeDomain: { start: iso(T0 - 24 * H), end: iso(T0 + 48 * H) },
  attributionStatus: 'SUPPORTED',
  attributionRationale: 'One tanker track crosses the reconstructed source region at the time the region was active and along the slick\'s axis. That supports an inspection, not a finding.',
  candidateCount: ais.length,
  detectionSummary: { slickCount: slicks.length, totalAreaKm2: areaKm2, largestAreaKm2: main.areaKm2, largestLengthM: main.lengthM, meanProbability: main.meanProbability, threshold: det0.threshold, model: det0.modelVersion },
  capabilities: { detection: 'POLYGON', segmentation: true, probabilityRaster: true, sarImagery: true, groundTruth: false, ais: true, backtrack: true, sourceHypotheses: true, forecast: true, environment: true, attribution: true },
  coverage: [
    ['satellite', 'Satellite scene', 'AVAILABLE'], ['detection', 'Detection geometry', 'AVAILABLE'], ['probability', 'Probability raster', 'AVAILABLE'],
    ['ais', 'AIS', 'AVAILABLE'], ['wind', 'Wind', 'AVAILABLE'], ['currents', 'Currents', 'AVAILABLE'], ['backtrack', 'Backtrack', 'AVAILABLE'],
    ['sourceRegion', 'Source hypotheses', 'AVAILABLE'], ['forecast', 'Forward forecast', 'AVAILABLE'], ['consequence', 'Shoreline exposure', 'AVAILABLE'], ['attribution', 'Attribution', 'SUPPORTED'],
  ].map(([key, label, state]) => ({ key, label, state, reason: null, detail: null })),
  files: Object.fromEntries(['detection', 'sourceHypotheses', 'forecast', 'candidates', 'ais', 'environment', 'events', 'provenance'].map((k) => [k, `/data/incidents/${ID}/${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}.json`])),
};

// ------------------------------------------------------------------ planners (the Response stage)
const eta = (h) => new Date(T0 + h * H).toISOString().slice(11, 16) + ' UTC ' + new Date(T0 + h * H).toISOString().slice(8, 10) + ' Mar';
const actions = [
  { id: 'A1', title: 'Aerial confirmation sortie', detail: 'ICG Dornier from Porbandar: confirm the slick, estimate thickness, photograph.', due: eta(3), owner: 'ICG District HQ-1 (Gujarat)' },
  { id: 'A2', title: 'Boom Pirotan Island north shore', detail: '1,200 m shore boom across the reef flat, ahead of the leading edge.', due: eta(contact - 8), owner: 'Gujarat Maritime Board, Sikka' },
  { id: 'A3', title: 'Protect Sikka desalination intake', detail: 'Intake boom and standby shutdown plan with the plant operator.', due: eta(ETA['Sikka intake'] - 6), owner: 'Plant operator, Sikka' },
  { id: 'A4', title: 'Offshore recovery on the leading edge', detail: 'Pollution control vessel with skimmer, 12 km W of Pirotan.', due: eta(10), owner: 'ICG Pollution Response Team, Vadinar' },
  { id: 'A5', title: `Sample ${top.v.name}`, detail: 'Oil samples at Vadinar SPM berth for fingerprint comparison with the slick.', due: eta(12), owner: 'DG Shipping / MMD Jamnagar' },
];
const analysis = {
  schema: 'guardians-analysis/1', incidentId: ID, generatedAt: iso(T0 + 40 * 60e3),
  incident: { timeAnchor: iso(T0), layers: Object.fromEntries(['BATHYMETRY', 'SENSITIVITY', 'ASSETS', 'WIND', 'CURRENTS', 'SHORELINE'].map((k) => [k, { state: 'AVAILABLE', reason: null }])) },
  execution: {
    containment: { status: 'SUCCESS', reasons: ['Leading edge reachable before shoreline contact; interception point 12 km W of Pirotan.'], counts: { items: 3, actionable: 2, rejected: 1 } },
    assetPrepositioning: { status: 'SUCCESS', reasons: ['Two boom teams and one pollution control vessel can be in position before the ETA.'], counts: { items: 4, actionable: 3, rejected: 1 } },
    surveillance: { status: 'SUCCESS', reasons: ['One aerial sortie and the next Sentinel-1 pass (15 Mar 00:48 UTC) cover the drift window.'], counts: { items: 2, actionable: 2, rejected: 0 } },
    cleanup: { status: 'PARTIAL', reasons: ['Shoreline cleanup ranked for Pirotan and Sikka; Positra mangrove needs a site survey before any method is chosen.'], counts: { items: 3, actionable: 2, rejected: 0 } },
    sampling: { status: 'SUCCESS', reasons: [`Slick sample and a vessel sample from ${top.v.name} requested for fingerprinting.`], counts: { items: 2, actionable: 2, rejected: 0 } },
    alerts: { status: 'SUCCESS', reasons: ['Two alerts raised, one watch.'], counts: { items: 3, actionable: 3, rejected: 0 } },
    protection: { status: 'SUCCESS', reasons: ['Pirotan Island first (marine national park, earliest ETA), then the Sikka intake.'], counts: { items: 4, actionable: 2, rejected: 0 } },
    iap: { status: 'SUCCESS', reasons: ['Draft action plan assembled from the planners above.'] },
  },
  alerts: { alerts: [
    { alertId: 'AL-1', severity: 'CRITICAL', title: `Oil predicted at Pirotan Island in ${contact} h`, explanation: 'Marine national park: coral reef and mangrove. Earliest shoreline contact of this run.', lifecycle: 'ACTIVE' },
    { alertId: 'AL-2', severity: 'WARNING', title: `Sikka desalination intake exposed at +${ETA['Sikka intake']} h`, explanation: 'Intake shutdown decision needed before the leading edge passes Vadinar.', lifecycle: 'ACTIVE' },
    { alertId: 'AL-3', severity: 'NOTICE', title: 'Fishing activity inside the drift path', explanation: 'Eight small craft reporting within 30 km. Advise through the fisheries department.', lifecycle: 'ACTIVE' },
  ] },
  conflicts: [],
  iap: { document: { validation: { result: 'VALID_WITH_WARNINGS' } }, mapped: actions, unmapped: [{ id: 'U1' }] },
  sitrep: { feed: { warnings: [], actions }, document: { title: 'SITREP 001' } },
  limitations: ['Arrival times carry about ±4 h at +24 h.', 'No aerial confirmation yet.'],
};

// ------------------------------------------------------------------ provenance
const write = (name, obj) => { const text = JSON.stringify(obj); writeFileSync(`${OUT}/${name}`, text); return { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }; };
const files = {
  'detection.json': write('detection.json', detection), 'environment.json': write('environment.json', environment),
  'source-hypotheses.json': write('source-hypotheses.json', sourceHypotheses), 'forecast.json': write('forecast.json', forecast),
  'candidates.json': write('candidates.json', candidates), 'ais.json': write('ais.json', aisOut), 'events.json': write('events.json', events),
  'analysis.json': write('analysis.json', analysis),
};
const provenance = {
  status: 'AVAILABLE', release: 'GUARDIANS pipeline v1', frozenAt: iso(T0 + 40 * 60e3), schemaVersion: '1.1',
  pipeline: [
    { stage: 'Satellite acquisition', producer: 'Sentinel-1A IW GRDH', output: SCENE, note: 'VV + VH, 10 m.' },
    { stage: 'Segmentation', producer: 'TerraMind-L v2', output: `${slicks.length} polygons, p ≥ ${det0.threshold}, mean ${main.meanProbability.toFixed(3)}` },
    { stage: 'Second opinion', producer: 'Cerulean look-alike classifier', output: 'Agrees, 0.91', note: 'Wind 6.4 m/s at acquisition, inside the detectable window.' },
    { stage: 'Environmental reconstruction', producer: 'ECMWF ERA5 + INCOIS HOOFS', output: `Hourly wind and currents, ${lats.length}×${lons.length} grid, ${times.length} frames` },
    { stage: 'Backward drift', producer: 'Lagrangian ensemble', output: `1024 particles, 4 windage scenarios, ${hypotheses.length} source hypotheses`, note: '15-minute step, 0.24 km random walk.' },
    { stage: 'AIS correlation', producer: 'Coastal + satellite AIS', output: `${ais.length} vessels in the search area` },
    { stage: 'Candidate ranking', producer: 'Blind baseline V1', output: `${ais.length} ranked, 0.60 proximity / 0.25 temporality / 0.15 parity`, note: 'Identity attached after ranking.' },
    { stage: 'Forward drift', producer: 'Centroid advection + GlobeMaster live run', output: `48 h track, shoreline contact at +${contact} h` },
    { stage: 'Response planning', producer: 'GUARDIANS planners', output: `${actions.length} actions, 3 alerts, draft IAP` },
  ],
  sources: Object.entries(files).map(([name, f]) => ({ role: `bundle:${name.replace('.json', '')}`, path: `data/incidents/${ID}/${name}`, bytes: f.bytes, sha256: f.sha256, readOnly: true, exists: true })),
  capabilityStatements: {
    WHAT: { status: 'SUPPORTED', detail: 'Possible oil slick; two models agree and look-alike checks pass. Not yet confirmed by aerial or sample.' },
    WHEN: { status: 'SUPPORTED', detail: iso(T0) },
    WHERE: { status: 'SUPPORTED', detail: `Segmented outline, ${slicks.length} parts, ${areaKm2.toFixed(2)} km².` },
    WHO: { status: 'SUPPORTED', detail: `Blind ranking puts ${top.v.name} first; an inspection lead, not a finding.` },
    FUTURE: { status: 'SUPPORTED', detail: `Shoreline contact at Pirotan Island predicted at +${contact} h.` },
  },
};

// ------------------------------------------------------------------ documents (Download menu)
const utc = (h) => new Date(T0 + h * H).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const page = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title} · ${SLICK_ID}</title>
<style>
body{margin:0;background:#eef0ec;font:14px/1.55 system-ui,'Segoe UI',sans-serif;color:#1d2422}
main{max-width:820px;margin:32px auto;background:#fff;padding:48px 56px;border-radius:6px;box-shadow:0 10px 40px rgb(0 0 0/.12);position:relative}
.kicker{font-size:11px;letter-spacing:.14em;color:#5e5e5e;font-weight:600}
h1{font-size:24px;margin:4px 0 6px}h2{font-size:14px;margin:22px 0 6px;display:flex;gap:10px;align-items:center}
.meta{font-size:12px;color:#6f6d69;border-bottom:2px solid #1d2422;padding-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0}th{text-align:left;color:#5e5e5e;font-size:11.5px;border-bottom:1px solid #d8d2c8;padding:6px 8px}td{border-bottom:1px solid #eee;padding:7px 8px;vertical-align:top}
.claim{font-size:11px;font-weight:600;padding:1px 7px;border-radius:5px;border:1px solid}.o{color:#1e6fa8}.r{color:#7a4bc9}.p{color:#1b8a8c}
.stamp{position:absolute;top:40px;right:48px;transform:rotate(-7deg);border:3px solid #c62f36;color:#c62f36;padding:4px 12px;border-radius:8px;font-weight:700;letter-spacing:.12em;text-align:center;line-height:1.1}
.stamp small{display:block;font-size:9px;letter-spacing:.06em}
@media print{body{background:#fff}main{box-shadow:none;margin:0}}
</style><main><div class="stamp">DRAFT<small>NOT APPROVED</small></div>
<div class="kicker">GUARDIANS · ${SLICK_ID}</div><h1>${title}</h1>
<div class="meta">Prepared ${utc(0.67)} · Operational period ${utc(1)} → ${utc(13)} · Watch supervisor, Gujarat sector</div>${body}</main></html>`;
const expo = PLACES.map((pl) => `<tr><td>${pl.name}</td><td>${pl.kind}</td><td>+${ETA[pl.name]} h · ${utc(ETA[pl.name])}</td><td>${pl.label}</td></tr>`).join('');
writeFileSync(`${OUT}/sitrep.html`, page('Situation Report 001', `
<h2>1 · Situation <span class="claim o">Observed</span></h2>
<p>At ${utc(0)} Sentinel-1A imaged a <b>possible oil slick</b> in the Gulf of Kutch off Vadinar, 22.57 N 69.59 E: ${areaKm2.toFixed(2)} km² in ${slicks.length} parts, main part ${(main.lengthM / 1000).toFixed(1)} km long. The segmenter (${main.meanProbability.toFixed(3)}) and an independent second model agree. Wind 6.4 m/s, inside the window where oil is visible and calm-sea look-alikes are unlikely.</p>
<h2>2 · Forecast <span class="claim p">Predicted</span></h2>
<p>Tide-dominated drift up the gulf with a steady westerly push. The leading edge is predicted to reach <b>Pirotan Island (Marine National Park) at +${contact} h</b>.</p>
<table><tr><th>Site</th><th>Type</th><th>Predicted arrival</th><th>Priority</th></tr>${expo}</table>
<h2>3 · Possible source <span class="claim r">Reconstructed</span></h2>
<p>Backtracking places the source region 6–15 km WSW of the slick between T−3 h and T−14 h. The blind ranking puts <b>${top.v.name}</b> (${top.v.type.toLowerCase()}, ${top.v.flag}) first at ${top.score.toFixed(2)}; its AIS went silent for 2.2 h shortly after crossing the T−10 h region. This is a lead for sampling, not a finding.</p>
<h2>4 · Actions requested</h2><table><tr><th>Action</th><th>Owner</th><th>By</th></tr>${actions.map((a) => `<tr><td><b>${a.title}</b><br>${a.detail}</td><td>${a.owner}</td><td>${a.due}</td></tr>`).join('')}</table>
<h2>5 · Still unknown</h2><ul><li>Oil type and thickness: no sample, no aerial confirmation yet.</li><li>Release time: consistent with T−3 h to T−14 h; no basis for a single moment.</li><li>Arrival times carry about ±4 h at +24 h.</li></ul>`));
writeFileSync(`${OUT}/iap.html`, page('Incident Action Plan · Period 1', `
<h2>Objectives · ICS 202</h2><ol><li>Confirm the slick and estimate thickness by ${utc(3)}.</li><li>Protect Pirotan Island and the Sikka intake before first arrival (+${contact} h).</li><li>Recover floating oil offshore while it is more than 10 km from the reef.</li><li>Obtain slick and vessel samples for fingerprinting.</li></ol>
<h2>Assignments · ICS 204</h2><table><tr><th>#</th><th>Task</th><th>Assigned to</th><th>Complete by</th></tr>${actions.map((a) => `<tr><td>${a.id}</td><td><b>${a.title}</b><br>${a.detail}</td><td>${a.owner}</td><td>${a.due}</td></tr>`).join('')}</table>
<h2>Safety · ICS 208</h2><ul><li>VOC monitoring for crews within 5 km of fresh oil for the first 12 h.</li><li>Tidal currents to 0.5 m/s: small craft work slack water near the reef.</li></ul>
<h2>Approval</h2><p>Incident commander: ______________________ &nbsp; Date/time: ______________</p>`));
incident.files.sitrep = `/data/incidents/${ID}/sitrep.html`;
incident.files.iap = `/data/incidents/${ID}/iap.html`;

write('provenance.json', provenance);
write('incident.json', incident);

// ------------------------------------------------------------------ catalog rows
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * KM * Math.cos(r[j][1] * D)) * (r[i][1] * KM) - (r[i][0] * KM * Math.cos(r[i][1] * D)) * (r[j][1] * KM); return Math.abs(a / 2) * 1e6; };
const tile = ([lon, lat]) => `${lon < 0 ? 'w' : 'e'}${String(Math.floor(Math.abs(lon) / 10) * 10).padStart(3, '0')}_${lat < 0 ? 's' : 'n'}${String(Math.floor(Math.abs(lat) / 10) * 10).padStart(2, '0')}`;
const bbox = (polys) => { const pts = polys.flat(2); return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]; };
const caps = (bundle) => ({ sourceImage: bundle, probability: bundle, mask: bundle, timestamp: true, georeference: true, wind: bundle, currents: bundle, waves: false, backtrack: bundle, forecast: bundle, ais: bundle, attribution: bundle, sourceCatalog: true, provenance: true });
const row = ({ id, centroid, polys, observedAt, props, kind = 'EDGE', source = 'EDGE_CAMPAIGN_V1', length }) => {
  const geometry = { type: 'MultiPolygon', coordinates: polys };
  return { id, source, kind, epistemic: 'OBSERVED', observed_at: iso(observedAt), time_source: 'OBSERVED', centroid: centroid.map(r5), bbox: bbox(polys).map(r5), area_m2: polys.reduce((a, p) => a + ringArea(p[0]), 0), length_m: length, components: polys.length, tile: tile(centroid), duplicate_of: null, properties: { classification: 'AI_DERIVED', sensor: 'SAR', geometryKind: 'POLYGON', mergedSources: 1, lookalikeWarning: false, ...props }, geometries: { lod3: geometry } };
};
const blob = (c, lenKm, widKm, deg, n = 18) => { const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * 2 * Math.PI, rr = 1 + 0.25 * Math.sin(3 * a + deg) * rnd(); return along(along(c, deg, Math.cos(a) * lenKm * rr / 2), deg + 90, Math.sin(a) * widKm * rr / 2).map(r5); }); pts.push(pts[0]); return [pts]; };

const catalog = [row({ id: SLICK_ID, centroid: SLICK, polys: slicks.map((s) => s.polygon.coordinates), observedAt: T0, length: main.lengthM, props: { scene: SCENE, sensor: 'Sentinel-1A', probability: main.meanProbability, probabilityP95: main.p95Probability, verifier: 'MULTI_MODEL_SUPPORTED', capabilities: caps(true) } })];
// The other three dashboard records, where the dashboard says they are.
catalog.push(row({ id: 'cerulean:slick_9102', kind: 'CERULEAN', source: 'CERULEAN_SKYTRUTH_SLICK_PLUS', centroid: [70.83, 20.11], polys: [blob([70.83, 20.11], 12.8, 0.7, 40)], observedAt: Date.parse('2026-03-14T05:58:00Z'), length: 12800, props: { scene: 'S1A_IW_GRDH_1SDV_20260314T055811', probability: 0.44, verifier: 'LOOKALIKE_WARNING', lookalikeWarning: true, capabilities: caps(false) } }));
catalog.push(row({ id: 'edge:oil_11208', centroid: [72.04, 18.62], polys: [blob([72.04, 18.62], 2.1, 0.3, 120)], observedAt: Date.parse('2026-02-11T22:41:00Z'), length: 2100, props: { scene: 'EOS04_SAR_20260211T2241', probability: 0.38, verifier: 'SECOND_OPINION_UNAVAILABLE', capabilities: caps(false) } }));
catalog.push(row({ id: 'edge:oil_04502', centroid: [68.77, 21.94], polys: [blob([68.77, 21.94], 4.2, 0.9, 150), blob([68.8, 21.93], 1.5, 0.4, 150)], observedAt: Date.parse('2026-03-13T04:10:00Z'), length: 4200, props: { scene: 'S1C_IW_GRDH_1SDV_20260313T041002', probability: 0.87, verifier: 'MULTI_MODEL_SUPPORTED', capabilities: caps(false) } }));
// A month of detections around the Indian coast, along the shipping lanes.
const ANCH = [[69.3, 22.6, 250], [68.6, 21.2, 240], [71.3, 19.3, 250], [72.4, 17.1, 250], [73.3, 15.3, 250], [74.2, 12.8, 250], [75.7, 9.8, 250], [67.2, 17.2, 250], [80.5, 5.8, 180], [79.2, 8.6, 150], [80.7, 13.1, 90], [83.8, 17.4, 120], [87.2, 20.0, 130], [88.1, 21.0, 180], [92.6, 11.3, 90]];
const VER = ['MULTI_MODEL_SUPPORTED', 'MULTI_MODEL_SUPPORTED', 'SECOND_OPINION_UNAVAILABLE', 'LOOKALIKE_WARNING'];
for (let i = 0; i < 64; i++) {
  const [lo, la, sea] = ANCH[Math.floor(rnd() * ANCH.length)];
  let c; do c = along([lo, la], sea + (rnd() - 0.5) * 110, 10 + rnd() * 120); while (onLand(c));
  const len = 0.6 + Math.exp(gauss() * 0.8) * 1.6, ver = VER[Math.floor(rnd() * VER.length)];
  catalog.push(row({ id: `edge:oil_${String(4600 + i * 97).padStart(5, '0')}`, centroid: c, polys: [blob(c, len, len * (0.12 + rnd() * 0.3), rnd() * 180)], observedAt: T0 - Math.floor(rnd() * 60 * 24) * H + 3 * H * rnd(), length: len * 1000, props: { scene: `S1A_IW_GRDH_1SDV_2026${hex(6)}`, probability: 0.55 + rnd() * 0.4, verifier: ver, lookalikeWarning: ver === 'LOOKALIKE_WARNING', capabilities: caps(false) } }));
}
const STATIC_ROWS = [0, 1, 2, 3, 7, 10, 13, 15, 18, 20, 24, 27, 33, 36, 40, 44, 48, 53, 58, 66];
const staticFeatures = STATIC_ROWS.map((index) => {
  const item = catalog[index];
  return {
    type: 'Feature',
    id: item.id,
    geometry: item.geometries.lod3,
    properties: {
      source: item.source,
      kind: item.kind,
      epistemic: item.epistemic,
      observedAt: item.observed_at,
      timeSource: item.time_source,
      centroid: item.centroid,
      bbox: item.bbox,
      areaM2: item.area_m2,
      lengthM: item.length_m,
      components: item.components,
      duplicateOf: item.duplicate_of,
      ...item.properties,
    },
  };
});
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/slicks.json', `${JSON.stringify(staticFeatures)}\n`);

// ------------------------------------------------------------------ what the dashboard should say
console.log(JSON.stringify({
  axis: Math.round(AXIS), areaKm2: +areaKm2.toFixed(2), lengthKm: +(main.lengthM / 1000).toFixed(1), parts: slicks.length, p: +main.meanProbability.toFixed(3),
  contact, headingToPirotan: Math.round(bearing(SLICK, PIROTAN)), ETA,
  hyp: [3,6,10,14].map(h=>[h, hypAt['windage_3%'][h].centre.map(r5), +hypAt['windage_3%'][h].r.toFixed(1)]), top: scored.slice(0, 8).map((s) => [s.v.name, +s.score.toFixed(2), s.bestH, +s.prox.toFixed(2), +s.temp.toFixed(2), +s.par.toFixed(2)]),
  vessels: ais.length, catalog: staticFeatures.length, slickOnLand: onLand(SLICK), pirotanOnLand: onLand(PIROTAN),
}, null, 1));
