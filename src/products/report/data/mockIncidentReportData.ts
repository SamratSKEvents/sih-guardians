/**
 * DEMONSTRATION DATA — NOT AN OPERATIONAL ASSESSMENT
 *
 * Fictional incident SIH-DEMO-2026-014 (Arabian Sea, offshore Mumbai region).
 * Every vessel, identifier, measurement, checksum and location label below is invented.
 * Geometry-derived values (areas, axes, trajectories, CPAs) are COMPUTED from the invented
 * primitives so the report stays internally consistent.
 */
import type {
  AisCandidate,
  AisPosition,
  AssessmentState,
  EnvironmentRecord,
  LatLon,
  QualityLevel,
  ScoreComponents,
  TechnicalIncidentReport,
} from '../ReportTypes';
import {
  bearingVec,
  dist,
  polygonArea,
  polygonPerimeter,
  principalAxes,
  prng,
  toLatLon,
  toXY,
  type XY,
} from '../utils/geo';

/** What the demonstration geometry is built from; the rest is computed so the report stays consistent. */
export interface ReportParams { origin: LatLon; t0: number; headBearing: number; areaKm2: number; lengthKm: number }

export function buildReportData(P: ReportParams): TechnicalIncidentReport {
const ORIGIN: LatLon = P.origin;
const T0 = P.t0;
const at = (h: number) => new Date(T0 + h * 3600_000).toISOString().replace('.000', '');
const ll = (p: XY) => toLatLon(ORIGIN, p);
const add = (a: XY, b: XY, k = 1): XY => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const round = (v: number, dp: number) => Number(v.toFixed(dp));

/* ------------------------------------------------------------------ slick geometry */

const HEAD_BEARING = P.headBearing; // downwind end of the slick
const U = bearingVec(HEAD_BEARING);
const V = bearingVec(HEAD_BEARING + 90);
const uv = (u: number, v: number): XY => add(add({ x: 0, y: 0 }, U, u), V, v);

function slickOutline(a: number, b0: number): XY[] {
  const pts: XY[] = [];
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    const n = 1 + 0.06 * Math.sin(5 * t + 0.7) + 0.035 * Math.sin(11 * t + 2.1);
    const b = b0 * (1 + 0.32 * Math.cos(t)) * (1 + 0.12 * Math.sin(3 * t));
    pts.push(uv(a * Math.cos(t) * n, b * Math.sin(t) * n));
  }
  return pts;
}

// Fit: main-body length 11.40 km, main-body area 18.70 km²
let a = P.lengthKm / 2, b0 = P.areaKm2 / (Math.PI * P.lengthKm / 2), outlineXY = slickOutline(a, b0);
for (let k = 0; k < 8; k++) {
  const ax = principalAxes(outlineXY);
  a *= P.lengthKm / (ax.majorExtent[1] - ax.majorExtent[0]);
  outlineXY = slickOutline(a, b0);
  b0 *= P.areaKm2 / polygonArea(outlineXY);
  outlineXY = slickOutline(a, b0);
}
const axes = principalAxes(outlineXY);
// Re-centre on centroid so ORIGIN is the true centroid.
outlineXY = outlineXY.map((p) => ({ x: p.x - axes.centroid.x, y: p.y - axes.centroid.y }));

const ellipse = (cu: number, cv: number, ea: number, eb: number, rot = 0): XY[] =>
  Array.from({ length: 28 }, (_, i) => {
    const t = (i / 28) * Math.PI * 2;
    const x = ea * Math.cos(t), y = eb * Math.sin(t);
    return uv(cu + x * Math.cos(rot) - y * Math.sin(rot), cv + x * Math.sin(rot) + y * Math.cos(rot));
  });
const fragmentsXY = [ellipse(-6.55, 0.55, 0.55, 0.2, 0.2), ellipse(-7.35, -0.55, 0.45, 0.18, -0.3), ellipse(1.9, 2.05, 0.4, 0.16, 0.5)];

const mainArea = polygonArea(outlineXY);
const fragArea = fragmentsXY.reduce((s, f) => s + polygonArea(f), 0);
const ax2 = principalAxes(outlineXY);
const lengthKm = ax2.majorExtent[1] - ax2.majorExtent[0];
const maxWidthKm = ax2.minorExtent[1] - ax2.minorExtent[0];
const perimeter = polygonPerimeter(outlineXY);

/* ------------------------------------------------------------------ environment */

const anchors = [
  { h: -24, w: 5.2, wd: 248, c: 0.31, cd: 41 },
  { h: -18, w: 5.8, wd: 253, c: 0.34, cd: 46 },
  { h: -12, w: 6.4, wd: 259, c: 0.39, cd: 49 },
  { h: -6, w: 7.1, wd: 264, c: 0.42, cd: 53 },
  { h: 0, w: 6.7, wd: 267, c: 0.4, cd: 56 },
];
const records: EnvironmentRecord[] = [];
for (let h = -24; h <= 0; h++) {
  const i = Math.min(3, Math.floor((h + 24) / 6));
  const A = anchors[i], B = anchors[i + 1];
  const f = (h - A.h) / 6;
  const bump = Math.sin(Math.PI * f); // zero at anchors
  records.push({
    offsetH: h,
    time: at(h),
    windMs: round(A.w + (B.w - A.w) * f + 0.28 * bump * Math.sin(h * 1.3), 1),
    windFromDeg: Math.round(A.wd + (B.wd - A.wd) * f + 3 * bump * Math.sin(h * 0.9)),
    currentMs: round(A.c + (B.c - A.c) * f + 0.018 * bump * Math.cos(h * 1.1), 2),
    currentToDeg: Math.round(A.cd + (B.cd - A.cd) * f + 2 * bump * Math.cos(h * 0.7)),
    waveHsM: round(0.9 + 0.012 * (h + 24) + 0.05 * Math.sin(h / 3), 2),
    seaTempC: round(28.9 - 0.02 * Math.abs(h + 12) + 0.1 * Math.sin(h / 4), 1),
  });
}
const WINDAGE = 0.03;
/** Surface drift velocity in km/h (x east, y north). */
const ZERO: XY = { x: 0, y: 0 };
const driftKmH = (r: EnvironmentRecord): XY =>
  add(add(ZERO, bearingVec(r.currentToDeg), r.currentMs * 3.6), bearingVec(r.windFromDeg + 180), WINDAGE * r.windMs * 3.6);

/* ------------------------------------------------------------------ hindcast */

const centreTrackXY: XY[] = [{ x: 0, y: 0 }];
for (let n = 0; n < 24; n++) {
  const r = records[24 - n];
  centreTrackXY.push(add(centreTrackXY[n], driftKmH(r), -1));
}
const centreAt = (h: number): XY => {
  const t = Math.min(24, Math.max(0, -h));
  const i = Math.min(23, Math.floor(t)), f = t - i;
  return add(centreTrackXY[i], { x: centreTrackXY[i + 1].x - centreTrackXY[i].x, y: centreTrackXY[i + 1].y - centreTrackXY[i].y }, f);
};
const spreadR = (t: number) => 0.55 + 0.42 * Math.pow(t, 0.95);

const rnd = prng(14);
const particleTracksXY: XY[][] = Array.from({ length: 36 }, () => {
  const su = (rnd() * 2 - 1) * 4.6, sv = (rnd() * 2 - 1) * 0.7;
  const start = uv(su, sv);
  const phi = rnd() * Math.PI * 2, rho = 0.25 + 0.75 * Math.sqrt(rnd()), swirl = (rnd() - 0.5) * 0.09;
  return centreTrackXY.map((c, n) => {
    const keep = Math.max(0, 1 - n / 14);
    const r = spreadR(n) * rho;
    const ang = phi + swirl * n;
    const along = bearingVec(237), cross = bearingVec(327);
    return add(add(add(c, start, keep), along, r * 1.2 * Math.cos(ang)), cross, r * 0.8 * Math.sin(ang));
  });
});

const hindcastConf: Record<number, [QualityLevel, number]> = {
  3: ['High', 0.86], 6: ['Medium-High', 0.79], 9: ['Medium-High', 0.71], 12: ['Medium', 0.63], 18: ['Low-Medium', 0.49], 24: ['Low', 0.36],
};

/* ------------------------------------------------------------------ AIS */

const WEIGHTS: ScoreComponents = { spatial: 0.25, temporal: 0.2, direction: 0.15, trajectory: 0.25, evidence: 0.15 };
const scoreOf = (c: ScoreComponents) =>
  Math.round(c.spatial * WEIGHTS.spatial + c.temporal * WEIGHTS.temporal + c.direction * WEIGHTS.direction + c.trajectory * WEIGHTS.trajectory + c.evidence * WEIGHTS.evidence);

function makeTrack(anchorH: number, offsetKm: number, cog: number, sogKn: number, fromH: number, toH: number, gap?: [number, number]): AisPosition[] {
  const anchor = add(centreAt(anchorH), bearingVec(cog + 90), offsetKm);
  const v = bearingVec(cog);
  const out: AisPosition[] = [];
  for (let h = fromH; h <= toH + 1e-9; h += 0.25) {
    if (gap && h > gap[0] && h < gap[1]) continue;
    const sog = sogKn + 0.3 * Math.sin(h * 2.1) - (h > anchorH + 0.2 && h < anchorH + 1.2 ? 1.2 : 0);
    out.push({ time: at(h), offsetH: round(h, 2), position: ll(add(anchor, v, (h - anchorH) * sogKn * 1.852)), sogKn: round(sog, 1), cogDeg: Math.round(cog + 2 * Math.sin(h * 1.7)) });
  }
  return out;
}
function cpa(track: AisPosition[]) {
  let best = { km: Infinity, h: 0 };
  for (const p of track) {
    const d = dist(toXY(ORIGIN, p.position), centreAt(p.offsetH));
    if (d < best.km) best = { km: d, h: p.offsetH };
  }
  return best;
}

type Seed = [id: string, type: string, lengthM: number, comps: number[], aisQ: QualityLevel, gapMin: number, cpaKm: number, cpaH: number];
const seeds: Seed[] = [
  ['17', 'Product tanker', 183, [90, 84, 78, 88, 62], 'Medium', 42, 0, 0],
  ['04', 'Bulk carrier', 229, [80, 70, 76, 74, 62], 'Medium-High', 18, 0, 0],
  ['23', 'Container ship', 294, [72, 66, 70, 64, 54], 'High', 9, 0, 0],
  ['31', 'General cargo', 142, [66, 62, 64, 58, 52], 'Medium', 27, 3.9, -16.8],
  ['12', 'Chemical tanker', 128, [60, 58, 55, 54, 50], 'Medium', 33, 4.6, -10.2],
  ['08', 'Offshore supply vessel', 78, [58, 50, 52, 48, 46], 'Medium-High', 12, 5.8, -19.5],
  ['29', 'Fishing vessel', 24, [52, 54, 40, 46, 50], 'Low-Medium', 71, 6.4, -5.1],
  ['02', 'LPG carrier', 205, [50, 44, 48, 42, 40], 'High', 6, 7.9, -22.4],
  ['36', 'Tug', 32, [44, 46, 38, 40, 44], 'Medium', 38, 8.8, -3.6],
  ['15', 'Ro-Ro cargo', 176, [40, 38, 42, 36, 30], 'High', 7, 10.2, -13.0],
  ['40', 'Dredger', 96, [36, 30, 34, 30, 40], 'Medium', 24, 12.6, -17.7],
  ['21', 'Container ship', 261, [30, 34, 28, 26, 20], 'Medium-High', 15, 14.1, -9.4],
  ['09', 'Fishing vessel', 21, [26, 22, 30, 20, 18], 'Low', 186, 17.5, -11.8],
  ['44', 'Unknown (Class B)', 0, [20, 18, 22, 16, 10], 'Low', 240, 21.3, -2.2],
];
const tracks: Record<string, AisPosition[]> = {
  '17': makeTrack(-15, 0.9, 338, 11.2, -18, -12, [-14.6, -13.9]),
  '04': makeTrack(-7.5, -1.6, 161, 9.4, -10, -5),
  '23': makeTrack(-21, 3.2, 352, 12.8, -24, -18),
};
const STRONGEST_MID = -15;
const candidates: AisCandidate[] = seeds
  .map(([id, type, lengthM, c, aisQuality, gap, cpaKm, cpaH]): AisCandidate => {
    const components = { spatial: c[0], temporal: c[1], direction: c[2], trajectory: c[3], evidence: c[4] };
    const score = scoreOf(components);
    const track = tracks[id];
    const best = track ? cpa(track) : { km: cpaKm, h: cpaH };
    const state: AssessmentState =
      aisQuality === 'Low' ? 'NOT_ASSESSABLE' : score >= 75 ? 'SUPPORTED' : score >= 60 ? 'AMBIGUOUS' : 'INSUFFICIENTLY_CONSTRAINED';
    return {
      candidateId: `V-${id}`,
      vesselName: `Vessel-${id}`,
      mmsi: `999 000 1${id}`,
      type,
      lengthM,
      closestApproachKm: round(best.km, 1),
      closestApproachOffsetH: round(best.h, 1),
      timeDifferenceH: round(best.h - STRONGEST_MID, 1),
      trajectoryCompatibility: c[3] / 100,
      directionCompatibility: c[2] / 100,
      aisQuality,
      maxAisGapMin: gap,
      components,
      score,
      state,
      track,
    };
  })
  .sort((p, q) => q.score - p.score);

const top = candidates[0];
top.evidence = {
  supporting: [
    `Transit through the 12–18 h source-support zone; CPA ${top.closestApproachKm.toFixed(1)} km to zone centre at T−${Math.abs(top.closestApproachOffsetH).toFixed(1)} h`,
    'Transit time falls inside the most strongly supported release interval (T−18 h to T−12 h)',
    'Reconstructed corridor bearing (237°) is consistent with observed slick major axis',
    'Speed reduction of approx. 1.2 kn recorded shortly after zone transit (cause unknown)',
  ],
  contradicting: [
    'Alternate interval (T−9 h to T−6 h) also receives support; Vessel-04 transit coincides with it',
    'Zone radius at T−15 h (≈6.3 km) admits multiple compatible tracks',
    'Slick head lies ≈1.8 km right of mean corridor centreline',
  ],
  missing: [
    'AIS gap of 42 min (T−14.6 h to T−13.9 h) during zone transit',
    'No second SAR acquisition to verify slick continuity along the corridor',
    'No physical sample / oil fingerprinting; vessel records not reviewed',
    'No independent aerial or vessel-based visual confirmation',
  ],
};

/* ------------------------------------------------------------------ forecast */

const drift0 = driftKmH(records[24]);
const fcCentres: Record<number, XY> = { 6: add({ x: 0, y: 0 }, drift0, 6), 12: add({ x: 0, y: 0 }, drift0, 11.4), 24: { x: 32.2, y: 15.6 } };
const growth = [
  { horizonH: 0, radiusKm: 0.8 },
  { horizonH: 3, radiusKm: 1.4 },
  { horizonH: 6, radiusKm: 2.1 },
  { horizonH: 12, radiusKm: 3.9 },
  { horizonH: 18, radiusKm: 5.6 },
  { horizonH: 24, radiusKm: 7.8 },
];
const envelope = (c: XY, r: number, bearing: number): XY[] => {
  const au = bearingVec(bearing), av = bearingVec(bearing + 90);
  return Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const k = 1 + 0.05 * Math.sin(3 * t + r);
    return add(add(c, au, (5.7 + 1.25 * r) * Math.cos(t) * k), av, (1.1 + 0.95 * r) * Math.sin(t) * k);
  });
};
const coastXY: XY[] = [
  [36.4, -16], [35.7, -10], [35.0, -4.5], [35.6, 0.5], [34.8, 4.6], [35.4, 8.8], [34.6, 12.2], [35.2, 15.8], [34.3, 18.2],
  [38.6, 18.7], [43.0, 19.1], [48.0, 19.4], [48.0, 20.8], [43.0, 20.7], [38.9, 20.5], [34.1, 21.1], [33.2, 24.1],
  [33.9, 27.2], [32.9, 30.4], [33.6, 34.2], [33.0, 40],
].map(([x, y]) => ({ x, y }));

/* ------------------------------------------------------------------ misc helpers */

const hex = (seed: number) => {
  const r = prng(seed);
  return Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
};
const aisCoverage = Array.from({ length: 24 }, (_, i) => {
  const h = i - 24;
  const dips: Record<number, number> = { [-14]: 58, [-13]: 69, [-20]: 78, [-9]: 81, [-3]: 84 };
  return { offsetH: h, coveragePct: dips[h] ?? Math.round(91 + 4 * Math.sin(h * 1.9)) };
});

/* ------------------------------------------------------------------ the report */

const mockIncidentReportData: TechnicalIncidentReport = {
  metadata: {
    reportTitle: 'Oil-Spill Technical Incident Assessment',
    reportSubtitle: 'SAR detection · source reconstruction · AIS correlation · drift forecast · impact screening',
    documentRef: 'OSIRS-TIA-2026-014',
    incidentId: 'SIH-DEMO-2026-014',
    revision: 'B',
    revisionHistory: [
      { rev: 'A', date: '2026-09-14', description: 'Automated first issue from processing chain', author: 'OSIRS', approved: '—' },
      { rev: 'B', date: '2026-09-14', description: 'Candidate scoring re-run; AIS gap flagged; forecast extended to +24 h', author: 'OSIRS', approved: 'PENDING' },
    ],
    generatedAt: '2026-09-14T03:22:40Z',
    observationTime: at(0),
    area: 'Arabian Sea — Mumbai Offshore Region',
    subArea: 'Approx. 38 km W of schematic coastline (fictional sector AS-W3)',
    classification: 'RESTRICTED — PLACEHOLDER',
    assessmentStatus: 'INVESTIGATIVE / UNVERIFIED',
    statusBanner: 'POSSIBLE OIL SLICK — REQUIRES CORROBORATING EVIDENCE',
    systemName: 'Oil-Spill Intelligence & Response System (SIH prototype)',
    systemShortName: 'OSIRS',
    modelVersion: 'OSIRS 0.9.3 / DRIFT-L 2.1 / SCORE 1.4',
    preparedBy: 'OSIRS automated chain',
    checkedBy: 'Duty analyst (placeholder)',
    approvedBy: 'Pending review',
    distribution: [
      'Maritime response coordination centre — placeholder',
      'Ocean information & forecasting service — placeholder',
      'State coastal environment authority — placeholder',
      'SIH technical review committee',
    ],
    keywords: ['oil spill', 'SAR', 'maritime intelligence', 'drift modelling', 'AIS', 'environmental impact', 'SIH'],
    isDemonstrationData: true,
  },

  observation: {
    platform: 'Sentinel-1-like C-band SAR (simulated)',
    sensor: 'C-band SAR, 5.405 GHz',
    mode: 'IW (Interferometric Wide swath)',
    polarisation: 'VV',
    productId: 'DEMO_S1X_IW_GRDH_20260914T004712_014',
    acquisitionTime: at(0),
    processingTime: at(32 / 60),
    orbitDirection: 'Descending',
    relativeOrbit: 63,
    pixelSpacingM: 10,
    incidenceAngleDeg: [33.8, 36.1],
    estimatedWindMs: 6.4,
    observationQuality: 'High',
    qualityNotes: 'Wind within detection range (3–10 m/s); no swath-edge effects; no rain cells identified.',
    imageBounds: (() => {
      const sw = ll({ x: -15.5, y: -10 }), ne = ll({ x: 15.5, y: 10 });
      return { north: ne.lat, south: sw.lat, east: ne.lon, west: sw.lon };
    })(),
    detection: {
      classification: 'Possible oil slick',
      confidence: 'Medium-High',
      confidenceScore: 0.72,
      method: 'Adaptive-threshold dark-spot segmentation + feature classifier (look-alike screening)',
      meanDampingDb: -6.8,
      lookAlikeChecks: [
        { check: 'Low-wind area (< 3 m/s)', result: 'Excluded — local wind 6.4 m/s', state: 'SUPPORTED' },
        { check: 'Biogenic film / algal surfactant', result: 'Not excluded — seasonal likelihood moderate', state: 'AMBIGUOUS' },
        { check: 'Rain cell / convective downdraft', result: 'Excluded — no cell signature', state: 'SUPPORTED' },
        { check: 'Internal wave / current shear', result: 'Unlikely — no periodic pattern', state: 'SUPPORTED' },
        { check: 'Grease ice / land shadow', result: 'Not applicable at site', state: 'NOT_ASSESSABLE' },
      ],
    },
  },

  slick: {
    observationId: 'SG-01',
    centroid: ORIGIN,
    outline: outlineXY.map(ll),
    fragments: fragmentsXY.map((f) => f.map(ll)),
    areaKm2: round(mainArea + fragArea, 1),
    mainBodyAreaKm2: round(mainArea, 1),
    perimeterKm: round(perimeter, 1),
    lengthKm: round(lengthKm, 2),
    meanWidthKm: round(mainArea / lengthKm, 2),
    maxWidthKm: round(maxWidthKm, 2),
    majorAxisKm: round(lengthKm, 2),
    minorAxisKm: round(maxWidthKm, 2),
    orientationDeg: Math.round(ax2.bearing + 180),
    fragmentCount: 1 + fragmentsXY.length,
    boundingBox: { lengthKm: round(lengthKm, 2), widthKm: round(maxWidthKm, 2) },
    elongationRatio: round(lengthKm / (mainArea / lengthKm), 1),
    compactnessIndex: round((4 * Math.PI * mainArea) / (perimeter * perimeter), 2),
  },

  environment: {
    windSource: 'Global NWP analysis/forecast, 0.25° (placeholder dataset)',
    currentSource: 'Regional ocean model surface current, 1/12° (placeholder dataset)',
    windageFactorPct: WINDAGE * 100,
    conventions: 'Wind direction = FROM (meteorological). Current direction = TOWARDS (oceanographic). Degrees true.',
    records,
    summaryOffsetsH: [-24, -18, -12, -6, 0],
  },

  hindcast: {
    model: 'DRIFT-L 2.1 — backward Lagrangian particle tracking (demonstration configuration)',
    particleCount: 5000,
    windagePct: WINDAGE * 100,
    horizontalDiffusivityM2s: 10,
    timeStepMin: 10,
    steps: [3, 6, 9, 12, 18, 24].map((h) => ({
      horizonH: h,
      centre: ll(centreTrackXY[h]),
      spreadRadiusKm: round(spreadR(h), 1),
      supportAreaKm2: round(Math.PI * spreadR(h) ** 2, 1),
      confidence: hindcastConf[h][0],
      confidenceScore: hindcastConf[h][1],
    })),
    centreTrack: centreTrackXY.map(ll),
    particleTracks: particleTracksXY.map((t) => t.map(ll)),
    parameters: [
      { name: 'Tracking scheme', value: 'Lagrangian, RK4 advection', note: 'Backward in time from T0' },
      { name: 'Particles released', value: '5 000', note: 'Seeded uniformly within slick mask' },
      { name: 'Time step', value: '10 min', note: 'Output every 60 min' },
      { name: 'Windage coefficient', value: '3.0 %', note: 'Scenario value; not oil-type specific' },
      { name: 'Horizontal diffusivity', value: '10 m²/s', note: 'Random-walk representation' },
      { name: 'Wind forcing', value: '0.25°, 1 h', note: 'Bilinear in space, linear in time' },
      { name: 'Current forcing', value: '1/12°, 1 h', note: 'Surface layer only' },
      { name: 'Stokes drift', value: 'Not applied', note: 'Wave forcing used for QC only' },
      { name: 'Weathering', value: 'Disabled', note: 'Oil type unknown' },
      { name: 'Support-zone definition', value: '68 % particle density contour', note: 'Approximated as circle of radius r' },
      { name: 'Forecast ensemble', value: '20 members', note: 'Perturbed wind ±15 %, current ±20 %' },
      { name: 'Random seed', value: '14', note: 'Reproducible demonstration run' },
    ],
  },

  releaseAssessment: {
    windowStartH: -24,
    strongest: { fromH: -18, toH: -12, support: 0.62 },
    alternate: { fromH: -9, toH: -6, support: 0.31 },
    uncertaintyBand: { fromH: -21, toH: -4 },
    supportCurve: Array.from({ length: 49 }, (_, i) => {
      const h = -24 + i * 0.5;
      const s = 0.62 * Math.exp(-(((h + 15) / 3.1) ** 2)) + 0.31 * Math.exp(-(((h + 7.5) / 1.5) ** 2)) + 0.04;
      return { offsetH: h, support: round(Math.min(1, s), 3) };
    }),
    evidence: [
      { offsetH: -20.3, label: 'Optical pass — cloud-limited, inconclusive', kind: 'neutral' },
      { offsetH: -15, label: 'Vessel-17 transit of support zone', kind: 'supporting' },
      { offsetH: -14.25, label: 'Vessel-17 AIS gap (42 min)', kind: 'neutral' },
      { offsetH: -7.5, label: 'Vessel-04 transit of support zone', kind: 'supporting' },
      { offsetH: -4, label: 'Coastal radar — no anomaly (range-limited)', kind: 'contradicting' },
    ],
    statement: 'Most strongly supported illustrative interval: 12–18 h prior to observation. No exact release time is asserted.',
    notes: [
      'Support is the normalised overlap between hindcast support zones and compatible AIS transits, weighted by hindcast confidence.',
      'Slick morphology (elongation, fragmented trailing edge) is qualitatively consistent with an age of several hours or more.',
      'The alternate interval cannot be excluded with the available evidence.',
    ],
  },

  aisCandidates: { analysisWindowH: 24, searchRadiusKm: 60, totalVesselsAnalysed: 46, weights: WEIGHTS, candidates },

  forecast: {
    model: 'DRIFT-L 2.1 — forward ensemble (20 members)',
    issuedAt: at(0.6),
    horizons: [6, 12, 24].map((h) => {
      const r = growth.find((g) => g.horizonH === h)!.radiusKm;
      return {
        horizonH: h,
        centre: ll(fcCentres[h]),
        envelope: envelope(fcCentres[h], r, 62).map(ll),
        uncertaintyRadiusKm: r,
        shorelineContactProbability: { 6: 0.02, 12: 0.18, 24: 0.71 }[h]!,
      };
    }),
    uncertaintyGrowth: growth,
    coastline: coastXY.map(ll),
    notes: [
      'Coastline is a schematic placeholder — not suitable for navigation or operational planning.',
      'Envelopes enclose the 90 % ensemble particle mass; centre = ensemble mean position.',
      '+24 h centre is shoreline-constrained; stranded fraction not modelled.',
    ],
  },

  impacts: {
    resources: [
      { id: 'R-01', name: 'Mangrove habitat (sector M-2)', type: 'Ecological', location: ll({ x: 36.1, y: 14.0 }), estimatedArrivalH: 16, arrivalWindowH: [13, 21], exposure: 'High', sensitivity: 5, confidence: 'Medium', priorityScore: 92, action: 'Pre-position containment boom at creek/fringe access' },
      { id: 'R-02', name: 'Coastal water intake (WI-1)', type: 'Infrastructure', location: ll({ x: 35.3, y: 19.6 }), estimatedArrivalH: 18, arrivalWindowH: [15, 24], exposure: 'High', sensitivity: 4, confidence: 'Medium', priorityScore: 88, action: 'Notify operator; prepare intake shutdown protocol' },
      { id: 'R-03', name: 'Fish landing centre (FLC-3)', type: 'Socio-economic', location: ll({ x: 36.0, y: 7.8 }), estimatedArrivalH: 19, arrivalWindowH: [15, 24], exposure: 'Medium', sensitivity: 4, confidence: 'Medium', priorityScore: 79, action: 'Advisory to fishing community; monitor catch' },
      { id: 'R-04', name: 'Tidal wetland / mudflat (W-1)', type: 'Ecological', location: ll({ x: 40.0, y: 22.2 }), estimatedArrivalH: 26, arrivalWindowH: [21, 32], exposure: 'Medium', sensitivity: 5, confidence: 'Low', priorityScore: 74, action: 'Shoreline survey; sorbent staging' },
      { id: 'R-05', name: 'Port berth complex (P-1)', type: 'Infrastructure', location: ll({ x: 34.6, y: 26.6 }), estimatedArrivalH: 31, arrivalWindowH: [26, 38], exposure: 'Low-Medium', sensitivity: 3, confidence: 'Low', priorityScore: 61, action: 'Port advisory; hull-contamination watch' },
      { id: 'R-06', name: 'Recreation beach (B-2)', type: 'Amenity', location: ll({ x: 36.0, y: 2.2 }), estimatedArrivalH: null, arrivalWindowH: null, exposure: 'Low', sensitivity: 2, confidence: 'Low-Medium', priorityScore: 44, action: 'Routine monitoring' },
    ],
    notes: [
      'Priority = f(exposure, sensitivity, arrival time, confidence). Illustrative planning scores only.',
      'Arrivals beyond +24 h lie outside the forecast horizon and are indicative extrapolations.',
    ],
  },

  confidence: {
    criteria: ['Data availability', 'Resolution adequacy', 'Temporal proximity', 'Model validation', 'Independent corroboration'],
    components: [
      { id: 'C1', name: 'Observation confidence', score: 0.72, level: 'Medium-High', state: 'SUPPORTED', criteria: ['High', 'High', 'High', 'Medium', 'Low'], limitingFactor: 'No optical/aerial confirmation' },
      { id: 'C2', name: 'Environmental data quality', score: 0.61, level: 'Medium', state: 'SUPPORTED', criteria: ['High', 'Medium', 'Medium', 'Medium', 'Low-Medium'], limitingFactor: 'Coarse current grid near coast' },
      { id: 'C3', name: 'Hindcast confidence', score: 0.55, level: 'Medium', state: 'AMBIGUOUS', criteria: ['High', 'Medium', 'Medium', 'Low-Medium', 'Low'], limitingFactor: 'Spread > 5 km beyond T−12 h', dependsOn: ['C1', 'C2'] },
      { id: 'C4', name: 'AIS completeness', score: 0.68, level: 'Medium', state: 'SUPPORTED', criteria: ['Medium-High', 'Medium', 'High', 'Unavailable', 'Medium'], limitingFactor: '13 % coverage gaps; 42-min gap (V-17)' },
      { id: 'C5', name: 'Attribution support', score: 0.41, level: 'Low-Medium', state: 'INSUFFICIENTLY_CONSTRAINED', criteria: ['Medium', 'Medium', 'Medium', 'Low', 'Low'], limitingFactor: 'No sample; competing interval', dependsOn: ['C3', 'C4', 'C7'] },
      { id: 'C6', name: 'Forecast confidence', score: 0.58, level: 'Medium', state: 'SUPPORTED', criteria: ['High', 'Medium', 'Medium', 'Medium', 'Low'], limitingFactor: 'Near-shore processes unresolved', dependsOn: ['C1', 'C2', 'C7'] },
      { id: 'C7', name: 'Oil type / weathering', score: 0, level: 'Unavailable', state: 'NOT_ASSESSABLE', criteria: ['Unavailable', 'Unavailable', 'Unavailable', 'Unavailable', 'Unavailable'], limitingFactor: 'SAR cannot resolve oil type' },
    ],
    dataQuality: [
      { dataset: 'SAR backscatter', source: 'C-band SAR GRD (simulated)', resolution: '10 m', age: '32 min', coverage: 'Complete', coveragePct: 100, quality: 'High', note: 'Wind in detection range', ageHours: 0.53 },
      { dataset: 'Slick detection mask', source: 'OSIRS segmentation', resolution: '20 m', age: '41 min', coverage: 'Complete', coveragePct: 100, quality: 'Medium-High', note: 'Look-alike screening applied', ageHours: 0.68 },
      { dataset: 'Wind', source: 'Global NWP (placeholder)', resolution: '0.25°', age: '2 h', coverage: 'Complete', coveragePct: 100, quality: 'Medium', note: 'Coarse for coastal gradients', ageHours: 2 },
      { dataset: 'Surface current', source: 'Regional ocean model (placeholder)', resolution: '0.083°', age: '4 h', coverage: 'Complete', coveragePct: 100, quality: 'Medium', note: 'Tidal phase partially resolved', ageHours: 4 },
      { dataset: 'Waves', source: 'Wave model (placeholder)', resolution: '0.2°', age: '3 h', coverage: 'Complete', coveragePct: 100, quality: 'Medium', note: 'QC only; not in drift', ageHours: 3 },
      { dataset: 'AIS positions', source: 'Terrestrial + satellite AIS', resolution: 'variable', age: '—', coverage: '87 % of hours', coveragePct: 87, quality: 'Medium', note: 'Gaps T−14 h, T−13 h', ageHours: null },
      { dataset: 'Optical imagery', source: 'Multispectral pass (placeholder)', resolution: '10 m', age: '20.3 h', coverage: 'Partial (cloud)', coveragePct: 30, quality: 'Low', note: 'Inconclusive', ageHours: 20.3 },
      { dataset: 'Coastline / resources', source: 'Sensitivity layer (placeholder)', resolution: '1:50 000', age: '14 mo', coverage: 'Partial', coveragePct: 78, quality: 'Low-Medium', note: 'Schematic only', ageHours: 14 * 730 },
    ],
    aisCoverageByHour: aisCoverage,
  },

  provenance: {
    note: 'DEMONSTRATION VALUES — checksums are randomly generated and do not correspond to real files.',
    records: [
      { input: 'SAR scene', source: 'C-band SAR archive (simulated)', datasetId: 'DEMO-SAR-GRDH-014', acquisitionTime: at(0), processingTime: at(0.53), sha256: hex(101), configVersion: 'ingest 1.2.0', transformation: 'Calibration σ⁰, speckle filter 5×5, terrain-flat', status: 'VERIFIED' },
      { input: 'Slick mask', source: 'OSIRS detection', datasetId: 'DEMO-MASK-SG01', acquisitionTime: at(0), processingTime: at(0.68), sha256: hex(102), configVersion: 'detect 0.9.3', transformation: 'Adaptive threshold, morphology, vectorise', status: 'VERIFIED' },
      { input: 'Wind field', source: 'NWP analysis (placeholder)', datasetId: 'DEMO-WIND-025-0914', acquisitionTime: at(-2), processingTime: at(0.7), sha256: hex(103), configVersion: 'forcing 1.1.4', transformation: 'Subset, regrid, 10 m wind', status: 'VERIFIED' },
      { input: 'Surface current', source: 'Ocean model (placeholder)', datasetId: 'DEMO-CUR-083-0914', acquisitionTime: at(-4), processingTime: at(0.72), sha256: hex(104), configVersion: 'forcing 1.1.4', transformation: 'Subset, surface layer, time interp.', status: 'VERIFIED' },
      { input: 'AIS extract', source: 'AIS aggregator (placeholder)', datasetId: 'DEMO-AIS-24H-AS-W3', acquisitionTime: at(-24), processingTime: at(0.8), sha256: hex(105), configVersion: 'ais-qc 0.7.2', transformation: 'De-duplicate, gap flag, resample 15 min', status: 'PARTIAL' },
      { input: 'Hindcast run', source: 'DRIFT-L', datasetId: 'DEMO-HC-014-B', acquisitionTime: at(0), processingTime: at(0.95), sha256: hex(106), configVersion: 'drift-l 2.1.0', transformation: 'Backward tracking 24 h, zone extraction', status: 'VERIFIED' },
      { input: 'Candidate scoring', source: 'SCORE', datasetId: 'DEMO-SCORE-014-B', acquisitionTime: at(0), processingTime: at(1.02), sha256: hex(107), configVersion: 'score 1.4.0', transformation: 'Weighted component scoring (5 comp.)', status: 'VERIFIED' },
      { input: 'Forecast run', source: 'DRIFT-L', datasetId: 'DEMO-FC-014-B', acquisitionTime: at(0), processingTime: at(1.1), sha256: hex(108), configVersion: 'drift-l 2.1.0', transformation: 'Forward ensemble +24 h, envelopes', status: 'VERIFIED' },
      { input: 'Resource layer', source: 'Sensitivity DB (placeholder)', datasetId: 'DEMO-ESI-AS-W3', acquisitionTime: '2025-07-02T00:00:00Z', processingTime: at(1.15), sha256: hex(109), configVersion: 'impact 0.5.1', transformation: 'Arrival intersection, priority scoring', status: 'UNVERIFIED' },
    ],
  },

  limitations: {
    assumptions: [
      'The dark feature is treated as a possible oil slick for modelling purposes only.',
      'Surface drift = current + 3.0 % wind (windage); Stokes drift and vertical mixing neglected.',
      'Forcing fields are representative of conditions at the slick location throughout the window.',
      'The slick is treated as a single release event (continuous discharge not modelled).',
    ],
    limitations: [
      { title: 'SAR dark regions are not automatically petroleum', text: 'Biogenic films, low-wind zones, rain cells and current fronts produce similar damping signatures. Look-alike screening reduces but does not remove this ambiguity.' },
      { title: 'Oil properties are unknown', text: 'Oil type, volume and thickness cannot be derived from single-polarisation SAR; weathering and evaporation are therefore not modelled.' },
      { title: 'Forcing is resolution-limited', text: 'Wind (0.25°) and current (1/12°) grids do not resolve coastal fronts, eddies or tidal jets smaller than approx. 10 km.' },
      { title: 'Windage is scenario-dependent', text: 'The 3 % windage coefficient is a conventional scenario value; real values vary with oil type, emulsification and sea state.' },
      { title: 'Hindcast uncertainty grows with time', text: 'Source-support zones expand from ≈1.7 km (3 h) to ≈9 km (24 h) radius; beyond 12 h multiple sources remain compatible.' },
      { title: 'AIS coverage contains gaps', text: 'Hourly coverage fell to 58 % at T−14 h. Vessels without AIS, or with switched-off transponders, are not represented.' },
      { title: 'Proximity does not prove causation', text: 'A high analytical support score indicates spatio-temporal compatibility only. It is not evidence of discharge and not a determination of responsibility.' },
      { title: 'Forward drift is probabilistic', text: 'Envelopes represent ensemble spread under perturbed forcing; they are not guaranteed bounds. Shoreline interaction is simplified.' },
      { title: 'Human expert review remains necessary', text: 'This assessment is decision-support output. Operational decisions require analyst review and independent corroboration.' },
    ],
    reviewStatement: 'Automated output. Not reviewed by a qualified analyst. Not for operational, legal or enforcement use.',
    corroboration: [
      { item: 'Follow-up SAR or aerial surveillance pass (≤ 6 h)', addresses: 'L-01 look-alike ambiguity; forecast verification', priority: 'Immediate', status: 'OPEN' },
      { item: 'Physical oil sample and fingerprint analysis', addresses: 'L-02 oil type; C5 attribution; C7 weathering', priority: 'Immediate', status: 'OPEN' },
      { item: 'Full-resolution AIS + voyage records, V-17 / V-04 / V-23', addresses: 'L-06 AIS gaps; competing interval', priority: 'High', status: 'OPEN' },
      { item: 'In-situ current / drifter comparison near slick', addresses: 'L-03 forcing resolution; hindcast skill', priority: 'High', status: 'IN PROGRESS' },
      { item: 'Validated coastline and sensitivity layer for sector', addresses: 'Impact screening; arrival estimates', priority: 'Routine', status: 'OPEN' },
      { item: 'Qualified analyst review and sign-off', addresses: 'L-09; document approval', priority: 'Immediate', status: 'OPEN' },
    ],
  },

  methodology: [
    { id: 'M1', title: 'SAR observation', detail: 'Ingest, calibrate σ⁰, speckle filter', inputs: 'SAR GRD scene', output: 'Calibrated backscatter' },
    { id: 'M2', title: 'Slick detection', detail: 'Dark-spot segmentation, look-alike screening', inputs: 'σ⁰, wind estimate', output: 'Candidate mask + confidence' },
    { id: 'M3', title: 'Geometry extraction', detail: 'Vectorise, area, axes, orientation', inputs: 'Slick mask', output: 'Slick polygon SG-01' },
    { id: 'M4', title: 'Environmental forcing', detail: 'Subset & interpolate wind, current', inputs: 'NWP, ocean model', output: 'Forcing time series' },
    { id: 'M5', title: 'Backward reconstruction', detail: 'Lagrangian hindcast, support zones', inputs: 'Polygon, forcing', output: 'Zones T−3 … T−24 h' },
    { id: 'M6', title: 'AIS correlation', detail: 'Spatio-temporal intersection, gap QC', inputs: 'AIS extract, zones', output: 'Compatible transits' },
    { id: 'M7', title: 'Candidate assessment', detail: 'Five-component support scoring', inputs: 'Transits, zones', output: 'Ranked candidates' },
    { id: 'M8', title: 'Forward drift', detail: 'Ensemble forecast +6/+12/+24 h', inputs: 'Polygon, forecast forcing', output: 'Envelopes, arrivals' },
    { id: 'M9', title: 'Impact assessment', detail: 'Resource intersection, priority', inputs: 'Envelopes, resource layer', output: 'Protection priorities' },
    { id: 'M10', title: 'Response intelligence', detail: 'Report, confidence, provenance', inputs: 'All products', output: 'This document' },
  ],

  keyFindings: [
    'A dark elongated feature consistent with a possible oil slick (main body 18.7 km², 11.4 km long) was detected at T0; look-alike screening leaves biogenic film as an unresolved alternative.',
    'Backward reconstruction places the most strongly supported release interval 12–18 h before observation, south-west of the slick; the T−9 to T−6 h interval cannot be excluded.',
    'Of 46 vessels analysed, Vessel-17 shows the highest analytical support (82/100). This indicates compatibility only and is not a determination of responsibility.',
    'Forward drift towards ENE gives a shoreline-contact probability of ≈71 % by +24 h; mangrove sector M-2 and water intake WI-1 are the highest planning priorities.',
  ],
  recommendedActions: [
    'Task a follow-up SAR or aerial surveillance pass within the next 6 h to confirm persistence and drift.',
    'Obtain a physical sample for oil fingerprinting before any attribution-related follow-up.',
    'Request full-resolution AIS and voyage records for the top three candidates (V-17, V-04, V-23).',
    'Pre-alert mangrove sector M-2 and water intake WI-1 operators; stage boom and sorbents.',
  ],

  glossary: [
    { term: 'AIS', definition: 'Automatic Identification System — vessel position/identity broadcast.' },
    { term: 'CPA', definition: 'Closest point of approach; here, minimum vessel-to-support-zone-centre distance at matching time.' },
    { term: 'COG / SOG', definition: 'Course over ground (° true) / speed over ground (kn).' },
    { term: 'Ensemble', definition: 'Set of model runs with perturbed forcing used to estimate forecast spread.' },
    { term: 'Envelope', definition: 'Contour enclosing a stated fraction of modelled particle mass.' },
    { term: 'GRD', definition: 'Ground Range Detected SAR product (multi-looked, projected to ground range).' },
    { term: 'Hindcast', definition: 'Backward-in-time drift reconstruction from an observed state.' },
    { term: 'IW', definition: 'Interferometric Wide swath acquisition mode.' },
    { term: 'Lagrangian tracking', definition: 'Advection of individual particles through a velocity field.' },
    { term: 'Look-alike', definition: 'Non-oil phenomenon that produces a SAR dark signature similar to oil.' },
    { term: 'MMSI', definition: 'Maritime Mobile Service Identity. Values in this report are non-valid dummies (MID 999).' },
    { term: 'NWP', definition: 'Numerical weather prediction.' },
    { term: 'Support score', definition: 'Weighted 0–100 compatibility index. Analytical — not evidence of responsibility.' },
    { term: 'Support zone', definition: 'Area containing the stated fraction of back-tracked particles at a hindcast horizon.' },
    { term: 'T0', definition: 'SAR observation time; T−n h / T+n h are hours before / after.' },
    { term: 'Windage', definition: 'Fraction of wind speed added to surface drift of floating material.' },
    { term: 'σ⁰ (sigma-nought)', definition: 'Normalised radar cross-section (backscatter coefficient), dB.' },
    { term: 'VV', definition: 'Vertical transmit / vertical receive polarisation.' },
  ],
};

return mockIncidentReportData;
}
