/**
 * TechnicalIncidentReport — the ONLY input contract of the renderer.
 *
 * The SIH application will later map its own data into this structure.
 * Conventions used throughout:
 *   - Times: ISO-8601 UTC strings. Relative times: hours from observation (T0), negative = before.
 *   - Positions: WGS-84 decimal degrees.
 *   - Distances km, areas km², speeds m/s, bearings degrees true (0–360).
 *   - Wind direction = direction FROM (meteorological). Current direction = direction TOWARDS (oceanographic).
 *   - Scores / confidences: 0–1 unless the field name says otherwise (0–100 for ranking scores).
 */

/** Raster input. string = data URL or fetchable URL. */
export type ImageSource = Blob | ArrayBuffer | Uint8Array | string;

export interface LatLon {
  lat: number;
  lon: number;
}

export type QualityLevel = 'High' | 'Medium-High' | 'Medium' | 'Low-Medium' | 'Low' | 'Unavailable';

export type AssessmentState = 'SUPPORTED' | 'AMBIGUOUS' | 'INSUFFICIENTLY_CONSTRAINED' | 'NOT_ASSESSABLE';

export interface RevisionEntry {
  rev: string;
  date: string;
  description: string;
  author: string;
  approved: string;
}

export interface ReportMetadata {
  reportTitle: string;
  reportSubtitle: string;
  documentRef: string;
  incidentId: string;
  revision: string;
  revisionHistory: RevisionEntry[];
  generatedAt: string;
  observationTime: string;
  area: string;
  subArea: string;
  classification: string;
  assessmentStatus: string;
  /** One-line status banner, e.g. "POSSIBLE OIL SLICK — REQUIRES CORROBORATING EVIDENCE". */
  statusBanner: string;
  systemName: string;
  systemShortName: string;
  modelVersion: string;
  preparedBy: string;
  checkedBy: string;
  approvedBy: string;
  distribution: string[];
  keywords: string[];
  /** When true every page carries the demonstration-data marking. */
  isDemonstrationData: boolean;
  logo?: ImageSource;
}

export interface ObservationData {
  platform: string;
  sensor: string;
  mode: string;
  polarisation: string;
  productId: string;
  acquisitionTime: string;
  processingTime: string;
  orbitDirection: string;
  relativeOrbit: number;
  pixelSpacingM: number;
  incidenceAngleDeg: [number, number];
  estimatedWindMs: number;
  observationQuality: QualityLevel;
  qualityNotes: string;
  image?: ImageSource;
  /** Geographic extent of `image`. */
  imageBounds: { north: number; south: number; east: number; west: number };
  detection: {
    classification: string;
    confidence: QualityLevel;
    confidenceScore: number;
    method: string;
    meanDampingDb: number;
    lookAlikeChecks: { check: string; result: string; state: AssessmentState }[];
  };
}

export interface SlickGeometry {
  observationId: string;
  centroid: LatLon;
  outline: LatLon[];
  fragments: LatLon[][];
  areaKm2: number;
  mainBodyAreaKm2: number;
  perimeterKm: number;
  lengthKm: number;
  meanWidthKm: number;
  maxWidthKm: number;
  majorAxisKm: number;
  minorAxisKm: number;
  /** Bearing of the major axis, degrees true (trailing direction). */
  orientationDeg: number;
  fragmentCount: number;
  boundingBox: { lengthKm: number; widthKm: number };
  elongationRatio: number;
  compactnessIndex: number;
}

export interface EnvironmentRecord {
  offsetH: number;
  time: string;
  windMs: number;
  windFromDeg: number;
  currentMs: number;
  currentToDeg: number;
  waveHsM: number;
  seaTempC: number;
}

export interface EnvironmentData {
  windSource: string;
  currentSource: string;
  windageFactorPct: number;
  conventions: string;
  records: EnvironmentRecord[];
  /** Hours (offsets) shown in the summary table. */
  summaryOffsetsH: number[];
}

export interface HindcastStep {
  horizonH: number;
  centre: LatLon;
  spreadRadiusKm: number;
  supportAreaKm2: number;
  confidence: QualityLevel;
  confidenceScore: number;
}

export interface HindcastData {
  model: string;
  particleCount: number;
  windagePct: number;
  horizontalDiffusivityM2s: number;
  timeStepMin: number;
  steps: HindcastStep[];
  /** Hourly positions, index 0 = T0, index n = T−n h. */
  centreTrack: LatLon[];
  particleTracks: LatLon[][];
  parameters: { name: string; value: string; note: string }[];
}

export interface ReleaseAssessment {
  windowStartH: number;
  strongest: { fromH: number; toH: number; support: number };
  alternate: { fromH: number; toH: number; support: number };
  uncertaintyBand: { fromH: number; toH: number };
  supportCurve: { offsetH: number; support: number }[];
  evidence: { offsetH: number; label: string; kind: 'supporting' | 'contradicting' | 'neutral' }[];
  statement: string;
  notes: string[];
}

export interface ScoreComponents {
  spatial: number;
  temporal: number;
  direction: number;
  trajectory: number;
  evidence: number;
}

export interface AisPosition {
  time: string;
  offsetH: number;
  position: LatLon;
  sogKn: number;
  cogDeg: number;
}

export interface AisCandidate {
  candidateId: string;
  vesselName: string;
  mmsi: string;
  type: string;
  lengthM: number;
  closestApproachKm: number;
  closestApproachOffsetH: number;
  timeDifferenceH: number;
  trajectoryCompatibility: number;
  directionCompatibility: number;
  aisQuality: QualityLevel;
  maxAisGapMin: number;
  components: ScoreComponents;
  score: number;
  state: AssessmentState;
  track?: AisPosition[];
  evidence?: { supporting: string[]; contradicting: string[]; missing: string[] };
}

export interface AisAnalysis {
  analysisWindowH: number;
  searchRadiusKm: number;
  totalVesselsAnalysed: number;
  weights: ScoreComponents;
  candidates: AisCandidate[];
}

export interface ForecastHorizon {
  horizonH: number;
  centre: LatLon;
  envelope: LatLon[];
  uncertaintyRadiusKm: number;
  shorelineContactProbability: number;
}

export interface ForecastData {
  model: string;
  issuedAt: string;
  horizons: ForecastHorizon[];
  uncertaintyGrowth: { horizonH: number; radiusKm: number }[];
  /** Placeholder coastline polyline (land lies east of the line). */
  coastline: LatLon[];
  notes: string[];
}

export interface ThreatenedResource {
  id: string;
  name: string;
  type: string;
  location: LatLon;
  estimatedArrivalH: number | null;
  arrivalWindowH: [number, number] | null;
  exposure: QualityLevel;
  sensitivity: number; // 1–5
  confidence: QualityLevel;
  priorityScore: number; // 0–100
  action: string;
}

export interface ConfidenceComponent {
  id: string;
  name: string;
  score: number;
  level: QualityLevel;
  state: AssessmentState;
  /** Per-criterion rating, keys = ConfidenceData.criteria. */
  criteria: QualityLevel[];
  limitingFactor: string;
  /** IDs of components this one inherits uncertainty from (drawn as a propagation graph). */
  dependsOn?: string[];
}

export interface DataQualityRow {
  dataset: string;
  source: string;
  resolution: string;
  age: string;
  coverage: string;
  coveragePct: number;
  quality: QualityLevel;
  note: string;
  /** Numeric age at T0 in hours (null = continuous stream). */
  ageHours: number | null;
}

export interface ConfidenceData {
  criteria: string[];
  components: ConfidenceComponent[];
  dataQuality: DataQualityRow[];
  aisCoverageByHour: { offsetH: number; coveragePct: number }[];
}

export interface ProvenanceRecord {
  input: string;
  source: string;
  datasetId: string;
  acquisitionTime: string;
  processingTime: string;
  sha256: string;
  configVersion: string;
  transformation: string;
  status: string;
}

export interface MethodStep {
  id: string;
  title: string;
  detail: string;
  inputs: string;
  output: string;
}

export interface TechnicalIncidentReport {
  metadata: ReportMetadata;
  observation: ObservationData;
  slick: SlickGeometry;
  environment: EnvironmentData;
  hindcast: HindcastData;
  releaseAssessment: ReleaseAssessment;
  aisCandidates: AisAnalysis;
  forecast: ForecastData;
  impacts: { resources: ThreatenedResource[]; notes: string[] };
  confidence: ConfidenceData;
  provenance: { records: ProvenanceRecord[]; note: string };
  limitations: {
    assumptions: string[];
    limitations: { title: string; text: string }[];
    reviewStatement: string;
    corroboration: { item: string; addresses: string; priority: 'Immediate' | 'High' | 'Routine'; status: 'OPEN' | 'IN PROGRESS' | 'CLOSED' }[];
  };
  methodology: MethodStep[];
  keyFindings: string[];
  recommendedActions: string[];
  glossary: { term: string; definition: string }[];
}
