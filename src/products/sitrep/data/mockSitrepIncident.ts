/**
 * DEMONSTRATION / ILLUSTRATIVE DATA.
 * Fictional incident SIH-DEMO-2026-014 tracked across three SITREPs. Vessels, resources, datasets and positions
 * are invented. Geometry is laid out in km on a local plane and converted to WGS-84 so all visuals agree.
 *
 *   SITREP 001  06:30 UTC  initial detection, wind data missing
 *   SITREP 002  12:00 UTC  wind restored, slick grows, candidate ranking changes, mangrove exposure LIKELY
 *   SITREP 003  18:00 UTC  new critical coastal threat (water intake), stale current data, new candidate
 */
import type { CandidateVessel, ForecastHorizon, ImpactResource, LatLon, SitrepIncidentState } from '../SitrepTypes';
import { toLatLon } from '../utils/format';

const ORIGIN: LatLon = { lat: 18.905, lon: 72.47 };
const ll = (x: number, y: number) => toLatLon(ORIGIN, { x, y });
const T = (day: number, hhmm: string) => `2026-09-${day}T${hhmm}:00.000Z`;

/** Ellipse-ish outline with deterministic edge irregularity; area matches `areaKm2`. */
function outline(cx: number, cy: number, areaKm2: number, lengthKm: number, orientationDeg: number): LatLon[] {
  const a = lengthKm / 2, b = areaKm2 / (Math.PI * a), th = (orientationDeg * Math.PI) / 180;
  return Array.from({ length: 28 }, (_, i) => {
    const t = (i / 28) * 2 * Math.PI, k = 1 + 0.08 * Math.sin(3 * t) + 0.05 * Math.cos(5 * t);
    const u = a * Math.cos(t) * k, v = b * Math.sin(t) * k;
    return ll(cx + u * Math.sin(th) + v * Math.cos(th), cy + u * Math.cos(th) - v * Math.sin(th));
  });
}

/** Annular sector (source-support corridor) around a slick centroid. */
function corridor(cx: number, cy: number, minKm: number, maxKm: number, bearingDeg: number, halfWidthDeg = 13): LatLon[] {
  const arc = (r: number, from: number, to: number) =>
    Array.from({ length: 9 }, (_, i) => {
      const b = ((from + ((to - from) * i) / 8) * Math.PI) / 180;
      return ll(cx + r * Math.sin(b), cy + r * Math.cos(b));
    });
  return [...arc(minKm, bearingDeg - halfWidthDeg, bearingDeg + halfWidthDeg), ...arc(maxKm, bearingDeg + halfWidthDeg, bearingDeg - halfWidthDeg)];
}

const COAST = [[34.5, -30], [33.8, -14], [35.2, -2], [34.4, 8], [35.8, 17], [34.9, 28], [36.2, 42]].map(([x, y]) => ll(x, y));

const TRACKS: Record<string, LatLon[]> = {
  'Vessel-17': [ll(-40, -18), ll(-13, -6), ll(9, 3.5)],
  'Vessel-04': [ll(-38, -1), ll(-11, -10), ll(8, -17)],
  'Vessel-23': [ll(-19, -32), ll(-15, -8), ll(-12, 22)],
  'Vessel-31': [ll(-30, 6), ll(-9, -3), ll(12, -12)],
  'Vessel-09': [ll(-28, -26), ll(-22, -14), ll(-20, 4)],
};
const vessel = (id: string, vesselType: string, supportScore: number, keyReason: string, aisGaps: CandidateVessel['aisGaps'] = []): CandidateVessel => ({ id, vesselType, supportScore, keyReason, aisGaps, track: TRACKS[id] });
const V23_GAP = [{ from: T(16, '07:14'), to: T(16, '08:03') }];

const R01 = (exposure: ImpactResource['exposure'], start: string, end: string): ImpactResource => ({ id: 'R-01', name: 'Mangrove habitat (sector M-2)', type: 'Ecological', sensitivity: 'VERY HIGH', exposure, exposureWindow: { start, end }, location: ll(35.9, 12.5) });
const R03 = (exposure: ImpactResource['exposure'], start: string, end: string): ImpactResource => ({ id: 'R-03', name: 'Fish landing centre (FLC-3)', type: 'Socio-economic', sensitivity: 'HIGH', exposure, exposureWindow: { start, end }, location: ll(35.0, 1.5) });

const horizon = (horizonH: number, x: number, y: number, directionDeg: number, uncertaintyKm: number, p: number, primaryConcern: string, confidence: ForecastHorizon['confidence']): ForecastHorizon => ({ horizonH, centre: ll(x, y), directionDeg, uncertaintyKm, shorelineContactProbability: p, primaryConcern, confidence });

const BASE_INCIDENT = {
  incidentId: 'SIH-DEMO-2026-014',
  revision: 0,
  region: 'Mumbai Offshore',
  subArea: 'Fictional sector AS-W3',
  operationalStatus: 'ACTIVE' as const,
  assessmentState: 'UNDER ASSESSMENT',
  preparedBy: 'GUARDIANS automated SITREP chain',
  classification: 'RESTRICTED — PLACEHOLDER',
  distribution: ['Maritime response coordination centre (placeholder)', 'Coastal pollution response duty officer (placeholder)', 'Ocean forecasting service (placeholder)'],
  systemName: 'GUARDIANS maritime oil-spill intelligence (SIH prototype)',
  modelVersion: 'guardians-transport-v1 / sitrep 0.1',
  isDemonstrationData: true,
};

export const mockSitrep001: SitrepIncidentState = {
  incident: { ...BASE_INCIDENT, sitrepNumber: 1, reportType: 'INITIAL', lifecycle: 'RELEASED', generatedAt: T(17, '06:30'), reportingPeriodStart: T(17, '05:42'), reportingPeriodEnd: T(17, '06:30') },
  observation: { observationId: 'DEMO-S1-20260917-0542', platform: 'Sentinel-1-like SAR (demo)', sensor: 'C-band SAR', observedAt: T(17, '05:42'), classification: 'POSSIBLE OIL SLICK', detectionConfidence: 'MEDIUM', quality: 'HIGH', qualityNote: 'wind within detection range, no rain cells', independentObservation: null, oilComposition: null },
  slick: { centroid: ll(0, 0), outline: outline(0, 0, 16.9, 11.2, 57), reference: { place: 'the Mumbai coastline', distanceKm: 34, bearingDeg: 270 }, areaKm2: 16.9, lengthKm: 11.2, widthKm: 1.5, orientationDeg: 57, fragmentCount: 3, thicknessAvailable: false },
  environment: { validAt: T(17, '06:00'), windSpeedMs: null, windFromDeg: null, currentSpeedMs: 0.38, currentTowardDeg: 240, waveHsM: 1.5, stokesDriftMs: 0.07, stokesTowardDeg: 250, dataQuality: 'LOW-MEDIUM', limitations: ['Environmental forcing resolution limits near-shore confidence.'] },
  hindcast: { available: true, periodH: 24, corridor: { minKm: 8, maxKm: 21, bearingDeg: 248 }, corridorPolygon: corridor(0, 0, 8, 21, 248), uncertainty: 'MEDIUM', state: 'AMBIGUOUS', limitations: [] },
  releaseAssessment: { strongestWindowH: [12, 18], alternateWindowH: [6, 9], state: 'AMBIGUOUS' },
  vesselAssessment: {
    aisAvailable: true, aisCoveragePct: 79, vesselsScreened: 46, attributionState: 'AMBIGUOUS', externalConfirmation: null,
    candidates: [
      vessel('Vessel-04', 'Cargo vessel', 76, 'Spatially compatible transit; timing weaker'),
      vessel('Vessel-17', 'Product tanker', 74, 'Track intersects source corridor'),
      vessel('Vessel-23', 'Tanker', 66, 'Compatible timing; poor trajectory alignment', V23_GAP),
      vessel('Vessel-09', 'Fishing vessel', 41, 'Marginal spatial overlap'),
    ],
  },
  forecast: {
    available: true, issuedAt: T(17, '06:15'), model: 'guardians-transport-v1 ensemble (demo)', coastline: COAST,
    horizons: [
      horizon(6, 7.2, 3.0, 67, 2.1, 0, 'Offshore fisheries', 'MEDIUM'),
      horizon(12, 14.8, 6.0, 68, 3.9, 0.04, 'Nearshore fishing grounds', 'MEDIUM'),
      horizon(24, 29.0, 9.5, 76, 7.8, 0.31, 'Mangrove / shoreline', 'MEDIUM'),
    ],
  },
  impacts: { resources: [R01('POSSIBLE', T(18, '02:30'), T(18, '08:30')), R03('POSSIBLE', T(18, '04:00'), T(18, '10:00'))], shorelineImpactObserved: false },
  confidence: { observation: 'MEDIUM', environmental: 'LOW-MEDIUM', hindcast: 'MEDIUM', releaseTiming: 'LOW-MEDIUM', aisCoverage: 'MEDIUM', attribution: 'AMBIGUOUS', forecast6h: 'MEDIUM', forecast24h: 'MEDIUM' },
  warnings: [],
  actions: [],
  provenance: {
    modelConfiguration: 'guardians-transport-v1',
    datasets: [
      { id: 'SAR', label: 'SAR', source: 'DEMO-S1-20260917-0542', ageHours: 0.8, quality: 'HIGH' },
      { id: 'WIND', label: 'Wind', source: null, ageHours: null, quality: 'UNAVAILABLE' },
      { id: 'CURRENTS', label: 'Currents', source: 'Operational ocean-current dataset', ageHours: 5, quality: 'MEDIUM' },
      { id: 'WAVES', label: 'Wave / Stokes', source: 'Operational wave dataset', ageHours: 5, quality: 'MEDIUM' },
      { id: 'AIS', label: 'AIS', source: 'Historical AIS operational dataset', ageHours: 1, quality: 'MEDIUM' },
    ],
  },
};

export const mockSitrep002: SitrepIncidentState = {
  ...mockSitrep001,
  incident: { ...BASE_INCIDENT, sitrepNumber: 2, reportType: 'UPDATE', lifecycle: 'RELEASED', generatedAt: T(17, '12:00'), reportingPeriodStart: T(17, '06:30'), reportingPeriodEnd: T(17, '12:00') },
  observation: { ...mockSitrep001.observation, observationId: 'DEMO-SAR-20260917-1105', platform: 'C-band SAR constellation (demo)', observedAt: T(17, '11:05'), detectionConfidence: 'MEDIUM-HIGH' },
  slick: { centroid: ll(2.6, 1.2), outline: outline(2.6, 1.2, 18.7, 12.1, 61), reference: { place: 'the Mumbai coastline', distanceKm: 31, bearingDeg: 270 }, areaKm2: 18.7, lengthKm: 12.1, widthKm: 1.6, orientationDeg: 61, fragmentCount: 4, thicknessAvailable: false },
  environment: { validAt: T(17, '11:00'), windSpeedMs: 6.7, windFromDeg: 267, currentSpeedMs: 0.4, currentTowardDeg: 236, waveHsM: 1.6, stokesDriftMs: 0.08, stokesTowardDeg: 255, dataQuality: 'MEDIUM', limitations: ['Environmental forcing resolution limits near-shore confidence.'] },
  hindcast: { ...mockSitrep001.hindcast, corridorPolygon: corridor(2.6, 1.2, 8, 21, 248) },
  vesselAssessment: {
    ...mockSitrep001.vesselAssessment, aisCoveragePct: 87, vesselsScreened: 48,
    candidates: [
      vessel('Vessel-17', 'Product tanker', 82, 'Track intersects source corridor within release interval'),
      vessel('Vessel-04', 'Cargo vessel', 73, 'Spatially compatible but timing weaker'),
      vessel('Vessel-23', 'Tanker', 66, 'Compatible timing; poor trajectory alignment', V23_GAP),
      vessel('Vessel-09', 'Fishing vessel', 38, 'Marginal spatial overlap'),
    ],
  },
  forecast: {
    ...mockSitrep001.forecast, issuedAt: T(17, '11:30'),
    horizons: [
      horizon(6, 10.0, 4.3, 66, 2.1, 0, 'Offshore fisheries', 'MEDIUM-HIGH'),
      horizon(12, 17.8, 7.4, 68, 3.9, 0.06, 'Nearshore fishing grounds', 'MEDIUM'),
      horizon(24, 33.2, 9.6, 85, 7.8, 0.44, 'Mangrove / shoreline', 'LOW-MEDIUM'),
    ],
  },
  impacts: { resources: [R01('LIKELY', T(18, '02:00'), T(18, '08:00')), R03('POSSIBLE', T(18, '03:00'), T(18, '09:00'))], shorelineImpactObserved: false },
  confidence: { observation: 'MEDIUM-HIGH', environmental: 'MEDIUM', hindcast: 'MEDIUM', releaseTiming: 'LOW-MEDIUM', aisCoverage: 'MEDIUM', attribution: 'AMBIGUOUS', forecast6h: 'MEDIUM-HIGH', forecast24h: 'LOW-MEDIUM' },
  provenance: {
    modelConfiguration: 'guardians-transport-v1',
    datasets: [
      { id: 'SAR', label: 'SAR', source: 'DEMO-SAR-20260917-1105', ageHours: 0.9, quality: 'HIGH' },
      { id: 'WIND', label: 'Wind', source: 'Operational wind dataset', ageHours: 2, quality: 'MEDIUM' },
      { id: 'CURRENTS', label: 'Currents', source: 'Operational ocean-current dataset', ageHours: 5, quality: 'MEDIUM' },
      { id: 'WAVES', label: 'Wave / Stokes', source: 'Operational wave dataset', ageHours: 5, quality: 'MEDIUM' },
      { id: 'AIS', label: 'AIS', source: 'Historical AIS operational dataset', ageHours: 1, quality: 'MEDIUM' },
    ],
  },
};

/** Default demonstration input (an UPDATE with a previous SITREP). */
export { mockSitrep002 as mockSitrepIncident };
