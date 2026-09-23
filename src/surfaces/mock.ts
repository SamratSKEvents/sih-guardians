/**
 * Mock data for the gallery.
 *
 * Nothing here is a real observation. The values are invented; the vocabulary
 * is the project's own, so the specimens show what the components do under
 * real strings rather than under "Item 1".
 *
 * Deliberately awkward cases are included, because those are the only ones
 * worth designing against: a look-alike, a detection with no second opinion,
 * a five-day-stale dataset, a forecast whose forcing degrades halfway, and a
 * failed request.
 */

import type { Claim, MethodStep, Status } from '../design/components';

export interface MockSlick {
  id: string;
  source: string;
  claim: Claim;
  status: Status;
  statusLabel: string;
  observedAt: string;
  assignedDate: boolean;
  areaKm2: number;
  lengthKm: number;
  parts: number;
  confidence: number;
  verifier: string;
  /** Where the label is pinned on the dashboard map, [lon, lat], and how far it sits off that point in px. */
  at: [number, number];
  offset?: [number, number];
  method: { steps: MethodStep[]; refuses?: string };
}

export const SLICKS: MockSlick[] = [
  {
    id: 'edge:oil_04471',
    source: 'Edge segmenter v1',
    claim: 'observed',
    status: 'critical',
    statusLabel: 'Critical',
    observedAt: '14 Mar 2026, 06:12 UTC',
    assignedDate: false,
    areaKm2: 6.03,
    lengthKm: 4.1,
    parts: 3,
    confidence: 0.98,
    verifier: 'Second model agrees',
    at: [69.585, 22.565],
    offset: [-30, 30],
    method: {
      steps: [
        { label: 'Scene', value: 'S1A_IW_GRDH 20260314T061208' },
        { label: 'Polarisation', value: 'VV + VH' },
        { label: 'Segmenter', value: 'TerraMind-L v2, 0.98' },
        { label: 'Second opinion', value: 'Cerulean, agrees' },
        { label: 'Wind at acquisition', value: '6.4 m/s' },
      ],
      refuses:
        'Radar cannot distinguish oil from some biogenic films. This is a dark feature consistent with oil, not a confirmed spill.',
    },
  },
  {
    id: 'cerulean:slick_9102',
    source: 'Cerulean (SkyTruth)',
    claim: 'observed',
    status: 'warning',
    statusLabel: 'Look-alike',
    observedAt: '14 Mar 2026, 05:58 UTC',
    assignedDate: false,
    areaKm2: 6.03,
    lengthKm: 12.8,
    parts: 1,
    confidence: 0.44,
    verifier: 'Possible look-alike',
    at: [70.83, 20.11],
    method: {
      steps: [
        { label: 'Scene', value: 'S1A_IW_GRDH 20260314T0558' },
        { label: 'Segmenter', value: 'Cerulean, 0.44' },
        { label: 'Second opinion', value: 'Edge, disagrees' },
        { label: 'Wind at acquisition', value: '1.8 m/s' },
      ],
      refuses:
        'Wind below 3 m/s flattens the sea surface and produces dark patches indistinguishable from oil. Treat as unverified.',
    },
  },
  {
    id: 'edge:oil_11208',
    source: 'Edge segmenter v1',
    claim: 'observed',
    status: 'inactive',
    statusLabel: 'Unverified',
    observedAt: '11 Feb 2026, 22:41 UTC',
    assignedDate: true,
    areaKm2: 0.412,
    lengthKm: 2.1,
    parts: 1,
    confidence: 0.38,
    verifier: 'No second opinion',
    at: [72.04, 18.62],
    method: {
      steps: [
        { label: 'Segmenter', value: 'Edge v1, 0.38' },
        { label: 'Second opinion', value: 'Not available' },
      ],
      refuses: 'No second model covered this scene. A single low-confidence detection is a lead, not evidence.',
    },
  },
  {
    id: 'guardians:backtrack_04471',
    source: 'Particle ensemble',
    claim: 'reconstructed',
    status: 'watch',
    statusLabel: 'Source region',
    observedAt: '13 Mar 2026, 18:00 UTC',
    assignedDate: false,
    areaKm2: 21.2,
    lengthKm: 0,
    parts: 1,
    confidence: 0.62,
    verifier: 'Region, not an attribution',
    at: [69.508, 22.556],
    offset: [-95, -26],
    method: {
      steps: [
        { label: 'Method', value: '1024-particle backtrack' },
        { label: 'Window', value: '24 h' },
        { label: 'Wind forcing', value: 'ERA5 6-hourly' },
        { label: 'Current forcing', value: 'INCOIS HOOFS hourly' },
        { label: 'AIS tracks crossing', value: '5' },
      ],
      refuses:
        'This is the region the oil plausibly came from. A vessel whose track crosses it is a candidate for investigation and nothing more. No vessel is accused.',
    },
  },
  {
    id: 'guardians:forecast_04471_t48',
    source: 'Drift forecast +48 h',
    claim: 'predicted',
    status: 'critical',
    statusLabel: 'Coast at +28 h',
    observedAt: '16 Mar 2026, 06:12 UTC',
    assignedDate: false,
    areaKm2: 52.9,
    lengthKm: 68.4,
    parts: 5,
    confidence: 0.49,
    verifier: 'Forcing degrades after +36 h',
    at: [69.955, 22.6],
    offset: [95, -26],
    method: {
      steps: [
        { label: 'Method', value: '4096-particle forward run' },
        { label: 'Horizon', value: '+48 h' },
        { label: 'Weathering', value: 'Evaporation, dispersion' },
        { label: 'Forcing beyond +36 h', value: 'Forecast, not analysis' },
        { label: 'Shorelines exposed', value: '4' },
      ],
      refuses:
        'Beyond +36 h the wind field is itself a forecast, so error compounds. The tail of this run indicates direction, not arrival time.',
    },
  },
];

/* ---------------------------------------------------------------- vessels */

export interface MockVessel {
  mmsi: string;
  name: string;
  type: string;
  correlation: number;
  crossedAt: string;
}

/* Invented names and MMSIs with plausible Indian Ocean flag prefixes. No real
 * vessel is intended, and none is being accused of anything. */
export const CANDIDATES: MockVessel[] = [
  { mmsi: '419006731', name: 'SAMUDRA PRABHA', type: 'Crude oil tanker', correlation: 0.89, crossedAt: '13 Mar, 20:12' },
  { mmsi: '563114908', name: 'KEPPEL VANTAGE', type: 'Product tanker', correlation: 0.55, crossedAt: '14 Mar, 00:12' },
  { mmsi: '477884210', name: 'HAI FENG 27', type: 'Bulk carrier', correlation: 0.12, crossedAt: '13 Mar, 11:12' },
  { mmsi: '419118264', name: 'TARINI EXPRESS', type: 'Container', correlation: 0.22, crossedAt: '13 Mar, 18:12' },
];

/* --------------------------------------------------------------- coastline */

export interface MockExposure {
  place: string;
  kind: string;
  etaHours: number;
  confidence: number;
  status: Status;
  label: string;
}

export const EXPOSURES: MockExposure[] = [
  { place: 'Pirotan Island', kind: 'Marine national park', etaHours: 28, confidence: 0.58, status: 'critical', label: 'Critical' },
  { place: 'Sikka intake', kind: 'Desalination intake', etaHours: 41, confidence: 0.51, status: 'critical', label: 'Critical' },
  { place: 'Positra mangrove', kind: 'Mangrove', etaHours: 59, confidence: 0.33, status: 'warning', label: 'Watch' },
  { place: 'Okha harbour', kind: 'Fishing harbour', etaHours: 85, confidence: 0.21, status: 'inactive', label: 'Low' },
];

/* ---------------------------------------------------------------- datasets */

export const DATASETS = [
  { name: 'ERA5 surface wind', updated: '14 Mar 2026, 06:00', status: 'clear' as Status, label: 'Current' },
  { name: 'CMEMS global currents', updated: '14 Mar 2026, 00:00', status: 'clear' as Status, label: 'Current' },
  {
    name: 'OSI SAF sea ice',
    updated: '09 Mar 2026, 12:00',
    status: 'warning' as Status,
    label: 'Stale',
    note: 'Five days old. Not used north of 60N in this run.',
  },
  { name: 'ADIOS oil properties', updated: '02 Jan 2026, 00:00', status: 'clear' as Status, label: 'Static' },
];

/* ------------------------------------------------------------- layer state */

/**
 * `value` is the one figure worth knowing about a layer without turning it on,
 * and it is not the same quantity for every one: a detection layer is a count,
 * a reconstruction is a confidence, a forecast is a horizon. The description
 * carries the unit, so the column is never ambiguous.
 */
export const LAYERS = [
  { id: 'slicks', label: 'Oil slicks', value: '1,284', description: '1,284 detections in view', swatch: 'slick' },
  { id: 'backtrack', label: 'Source region', value: '0.62', description: 'Reconstructed, 0.62 confidence', swatch: 'reconstructed' },
  { id: 'forecast', label: 'Drift forecast', value: '+48 h', description: 'Predicted out to +48 hours', swatch: 'predicted' },
  { id: 'ais', label: 'Vessel traffic', value: '312', description: '312 AIS position reports in view', swatch: 'ais' },
  { id: 'wind', label: 'Wind field', value: '6 h', description: 'ERA5 surface vectors, 6-hourly', swatch: 'wind' },
] as const;

export const BASEMAPS = [
  { value: 'natural-earth', label: 'Natural Earth II (offline)' },
  { value: 's2cloudless', label: 'Sentinel-2 cloudless 2024' },
  { value: 'blue-marble', label: 'NASA Blue Marble' },
  { value: 'esri-dark', label: 'Esri dark gray' },
];

/* The catalog's demo time bounds. The window is widened to the end of
 * September so the timeline
 * has somewhere to run past the newest record.
 *
 * Note 31 Sep does not exist, so the max is the 30th. */
export const CATALOG_MIN = Date.UTC(2025, 0, 1);
export const CATALOG_MAX = Date.UTC(2026, 8, 30, 23, 59, 59);



/* ========================================================== Operations route */

export const OPS_NAV: { id: string; label: string; count?: number }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'detections', label: 'Detections', count: 543 },
  { id: 'vessels', label: 'Vessels', count: 38 },
  { id: 'forecasts', label: 'Forecasts', count: 12 },
  { id: 'reports', label: 'Reports' },
  { id: 'analytics', label: 'Analytics' },
];

/** Detections per day over the last seven months. Shaped, not random. */
export const SPARK = [
  12, 18, 15, 22, 31, 28, 24, 30, 42, 38, 35, 44, 51, 47, 43, 52, 61, 58, 54,
  49, 57, 66, 71, 64, 59, 68, 74, 81, 77, 72, 79, 88, 84, 91, 86, 94, 89, 97, 103, 96,
];

/**
 * How today's detections split by verification. Sums to 543.
 *
 * Keyed to STATUS tokens, not to positions in the series ramp. A chart keyed
 * to `series-2` silently changes meaning the day the ramp is reordered, which
 * is exactly what happened: "second model agrees" went yellow and "awaiting
 * review" went green. Keyed to `clear` and `warning` it cannot.
 */
export const MIX = [
  { label: 'Second model agrees', value: 287, token: 'clear' },
  { label: 'Awaiting review', value: 141, token: 'warning' },
  { label: 'Look-alike', value: 63, token: 'watch' },
  { label: 'No second opinion', value: 34, token: 'series-4' },
  { label: 'Disagrees', value: 18, token: 'critical' },
];

export const DETECTIONS = [
  {
    id: 'edge:oil_04471',
    status: 'critical' as Status,
    statusLabel: 'Critical',
    from: 'First seen 22.57 N 69.59 E',
    to: 'Heading 084° toward Pirotan Island',
    eta: '+28 h',
    area: '6.03 km²',
  },
  {
    id: 'cerulean:slick_9102',
    status: 'warning' as Status,
    statusLabel: 'Look-alike',
    from: 'First seen 20.11 N 70.83 E',
    to: 'Wind 1.8 m/s, surface flat',
    eta: 'none',
    area: '6.03 km²',
  },
  {
    id: 'edge:oil_11208',
    status: 'inactive' as Status,
    statusLabel: 'Unverified',
    from: 'First seen 18.62 N 72.04 E',
    to: 'No second opinion available',
    eta: 'none',
    area: '0.41 km²',
  },
  {
    id: 'edge:oil_04502',
    status: 'clear' as Status,
    statusLabel: 'Verified',
    from: 'First seen 21.94 N 68.77 E',
    to: 'Dispersed, last seen 04:10 UTC',
    eta: 'cleared',
    area: '2.18 km²',
  },
];

/* ================================================== chain health (shared) */

/** Every input the answers depend on. `detail` names the consequence. */
export const HEALTH = [
  { id: 'sar', label: 'SAR', state: 'ok' as const },
  { id: 'ais', label: 'AIS', state: 'ok' as const },
  { id: 'wind', label: 'Wind', state: 'ok' as const },
  { id: 'current', label: 'Currents', state: 'ok' as const },
  {
    id: 'ice',
    label: 'Sea ice',
    state: 'degraded' as const,
    detail: 'OSI SAF is five days stale. Excluded north of 60N in this run.',
  },
  { id: 'verify', label: 'Verify', state: 'ok' as const },
];
