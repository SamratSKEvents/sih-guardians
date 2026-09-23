/**
 * The IAP, SITREP and technical report, generated for the open slick.
 *
 * The three generators are the standalone modules from `SIH_WORK/sih`
 * (iap, sitrep, report), copied in unchanged apart from import paths. Each
 * is driven by its own demonstration incident. This file moves that
 * incident onto the open slick: every timestamp shifts so the demo's
 * observation falls at this slick's T0, every position shifts so its
 * centroid falls on this slick, the names change to this slick's, and the
 * values this app actually knows (area, length, wind, current, waves, drift)
 * replace the demo's. The rest stays the modules' demonstration content, and
 * every output keeps their DEMONSTRATION marking.
 *
 * ponytail: retarget-and-patch, not a full mapper. A mapper from the plan
 * (assets, zones, alerts) into IapIncidentState is the upgrade when the
 * response plan becomes real data.
 */

import { loadReportFonts } from './report/browserFonts';
import { generateIap, renderPdf as iapPdf } from './iap';
import { mockIap001 } from './iap/data/mockIapIncident';
import { generateSitrep, renderPdf as sitrepPdf } from './sitrep';
import { mockSitrep002 } from './sitrep/data/mockSitrepIncident';
import { buildReportData } from './report/data/mockIncidentReportData';
import { generateTechnicalReport } from './report/ReportGenerator';

export interface ProductContext {
  slickId: string;
  /** Nearest coastal town, and the sea area, for the documents' labels. */
  town: string;
  region: string;
  t0: number;
  centre: { lat: number; lon: number };
  areaKm2: number;
  lengthKm: number;
  driftTowardDeg: number;
  windSpeedMs: number;
  windFromDeg: number;
  currentSpeedMs: number;
  currentTowardDeg: number;
  waveHsM: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;

/** Deep copy with times shifted, positions shifted and labels replaced. */
function retarget<T>(value: T, dtMs: number, dLat: number, dLon: number, labels: [string, string][]): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ISO.test(v)) return new Date(Date.parse(v) + dtMs).toISOString();
      return labels.reduce((s, [a, b]) => s.split(a).join(b), v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.lat === 'number' && typeof o.lon === 'number' && Object.keys(o).length <= 3) return { ...o, lat: o.lat + dLat, lon: o.lon + dLon };
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

const labelsFor = (c: ProductContext): [string, string][] => [
  ['SIH-DEMO-2026-014', `GRD-${c.slickId.replace(/^[a-z]+:/, '').toUpperCase()}`],
  ['Mumbai Offshore / Arabian Sea', c.region],
  ['Arabian Sea — Mumbai Offshore Region', c.region],
  ['Mumbai Offshore', c.region],
  ['the Mumbai coastline', `the ${c.town} coastline`],
  ['Mumbai', c.town],
];

function open(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export async function openIap(c: ProductContext) {
  const base = mockIap001;
  const from = Date.parse(base.slick!.observedAt);
  const s = retarget(base, c.t0 - from, c.centre.lat - base.slick!.centroid!.lat, c.centre.lon - base.slick!.centroid!.lon, labelsFor(c));
  s.slick = { ...s.slick!, centroid: c.centre, areaKm2: +c.areaKm2.toFixed(2), lengthKm: +c.lengthKm.toFixed(1), locationText: `near ${c.town}` };
  s.environment = { ...s.environment!, windSpeedMs: +c.windSpeedMs.toFixed(1), windFromDeg: Math.round(c.windFromDeg), currentSpeedMs: +c.currentSpeedMs.toFixed(2), currentTowardDeg: Math.round(c.currentTowardDeg), waveHsM: +c.waveHsM.toFixed(1),
    outlook: s.environment!.outlook.map((w) => ({ ...w, windSpeedMs: +c.windSpeedMs.toFixed(1), windFromDeg: Math.round(c.windFromDeg), waveHsM: +c.waveHsM.toFixed(1) })) };
  s.forecast = { ...s.forecast!, movementTowardDeg: Math.round(c.driftTowardDeg) };
  const doc = generateIap(s, { variant: 'FULL' });
  open(await iapPdf(doc, await loadReportFonts()));
}

export async function openSitrep(c: ProductContext) {
  const base = mockSitrep002;
  const from = Date.parse(base.observation.observedAt);
  const s = retarget(base, c.t0 - from, c.centre.lat - base.slick.centroid!.lat, c.centre.lon - base.slick.centroid!.lon, labelsFor(c));
  s.slick = { ...s.slick, centroid: c.centre, areaKm2: +c.areaKm2.toFixed(2), lengthKm: +c.lengthKm.toFixed(1), orientationDeg: Math.round(c.driftTowardDeg % 180) };
  s.environment = { ...s.environment, windSpeedMs: +c.windSpeedMs.toFixed(1), windFromDeg: Math.round(c.windFromDeg), currentSpeedMs: +c.currentSpeedMs.toFixed(2), currentTowardDeg: Math.round(c.currentTowardDeg), waveHsM: +c.waveHsM.toFixed(1) };
  s.forecast = { ...s.forecast, horizons: s.forecast.horizons.map((h) => ({ ...h, directionDeg: Math.round(c.driftTowardDeg) })) };
  const doc = generateSitrep(s, { variant: 'FULL' });
  open(await sitrepPdf(doc, await loadReportFonts()));
}

export async function openReport(c: ProductContext) {
  const data = buildReportData({ origin: c.centre, t0: c.t0, headBearing: c.driftTowardDeg, areaKm2: Math.max(0.2, c.areaKm2), lengthKm: Math.max(0.8, c.lengthKm) });
  const labels = labelsFor(c);
  const r = retarget(data, 0, 0, 0, [...labels, ['main body 18.7 km², 11.4 km long', `main body ${c.areaKm2.toFixed(2)} km², ${c.lengthKm.toFixed(1)} km long`]]);
  const day = new Date(c.t0).toISOString().slice(0, 10);
  r.metadata = {
    ...r.metadata, generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), area: c.region, subArea: `near ${c.town}`,
    documentRef: `OSIRS-TIA-${c.slickId.replace(/^[a-z]+:/, '').toUpperCase()}`,
    revisionHistory: r.metadata.revisionHistory.map((h) => ({ ...h, date: day })),
  };
  open(await generateTechnicalReport(r, await loadReportFonts(), { variant: 'full' }));
}
