/**
 * SITREP contracts.
 *
 *  1. SitrepIncidentState — the ONLY input. The integrated SIH application will map real incident data into it.
 *  2. SitrepDocument      — the structured output (facts + narrative + comparison snapshot), serialised as sitrep.json.
 *
 * Conventions
 *   - Times: ISO-8601 UTC strings. Positions: WGS-84 decimal degrees.
 *   - Distances km, areas km², speeds m/s, bearings degrees true (0–360).
 *   - Wind direction = FROM (meteorological). Current / Stokes / movement direction = TOWARD (oceanographic).
 *   - `null` means NOT AVAILABLE. The generator never substitutes a value for null.
 *   - Support scores 0–100; coverage percentages 0–100.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** Ordinal confidence / quality level. */
export type Level = 'HIGH' | 'MEDIUM-HIGH' | 'MEDIUM' | 'LOW-MEDIUM' | 'LOW' | 'UNAVAILABLE';

/** Analytical assessment state (same vocabulary as the technical report). */
export type AssessmentState = 'SUPPORTED' | 'AMBIGUOUS' | 'INSUFFICIENTLY_CONSTRAINED' | 'NOT_ASSESSABLE';

export type EvidenceClass = 'OBSERVED' | 'MODELLED' | 'INFERRED' | 'UNCONFIRMED';

export type ReportType = 'INITIAL' | 'UPDATE' | 'FINAL';
export type Lifecycle = 'DRAFT' | 'REVIEWED' | 'RELEASED' | 'SUPERSEDED' | 'FINAL';
export type OperationalStatus = 'ACTIVE' | 'MONITORING' | 'CONTAINED' | 'CLOSED';
export type Sensitivity = 'CRITICAL' | 'VERY HIGH' | 'HIGH' | 'MODERATE' | 'LOW';
export type Exposure = 'CONFIRMED' | 'LIKELY' | 'POSSIBLE' | 'UNLIKELY';
export type Severity = 'CRITICAL' | 'WARNING' | 'NOTICE';
export type ActionPriority = 'IMMEDIATE' | 'HIGH' | 'ROUTINE';

/* ================================================================== input */

export interface IncidentMetadata {
  incidentId: string;
  sitrepNumber: number;
  /** 0 for the first issue of a SITREP number; incremented on correction. */
  revision: number;
  reportType: ReportType;
  lifecycle: Lifecycle;
  generatedAt: string;
  reportingPeriodStart: string;
  reportingPeriodEnd: string;
  region: string;
  subArea?: string;
  operationalStatus: OperationalStatus;
  /** e.g. "UNDER ASSESSMENT", "CONFIRMED", "NOT CONFIRMED". */
  assessmentState: string;
  preparedBy: string;
  reviewedBy?: string;
  /** Placeholder until the classification scheme is agreed. */
  classification: string;
  distribution: string[];
  systemName: string;
  modelVersion: string;
  /** When true every output carries DEMONSTRATION / ILLUSTRATIVE DATA markings. */
  isDemonstrationData: boolean;
}

export interface ObservationSummary {
  observationId: string;
  platform: string;
  sensor: string;
  observedAt: string;
  /** e.g. "POSSIBLE OIL SLICK", "PROBABLE OIL SLICK", "CONFIRMED OIL SLICK", "INSUFFICIENT EVIDENCE". */
  classification: string;
  detectionConfidence: Level;
  quality: Level;
  qualityNote?: string;
  /** Independent (optical / aerial / in-situ) corroboration, if any. */
  independentObservation: { sensor: string; observedAt: string; result: string } | null;
  oilComposition: string | null;
}

export interface SlickSummary {
  centroid: LatLon | null;
  /** Observed outline (optional, used for the schematic only). */
  outline?: LatLon[];
  /** Position relative to a named reference; bearing is FROM the reference TO the slick. */
  reference: { place: string; distanceKm: number; bearingDeg: number } | null;
  areaKm2: number | null;
  lengthKm: number | null;
  widthKm: number | null;
  /** Major-axis bearing, 0–180. */
  orientationDeg: number | null;
  fragmentCount: number | null;
  thicknessAvailable: boolean;
}

export interface EnvironmentalSummary {
  validAt: string | null;
  windSpeedMs: number | null;
  windFromDeg: number | null;
  currentSpeedMs: number | null;
  currentTowardDeg: number | null;
  waveHsM: number | null;
  stokesDriftMs: number | null;
  stokesTowardDeg: number | null;
  dataQuality: Level;
  limitations: string[];
}

export interface HindcastSummary {
  available: boolean;
  /** Hours reconstructed backwards from the observation. */
  periodH: number | null;
  /** Source-support corridor, as a distance band from the slick in a direction (FROM slick TO corridor). */
  corridor: { minKm: number; maxKm: number; bearingDeg: number } | null;
  corridorPolygon?: LatLon[];
  uncertainty: Level;
  state: AssessmentState;
  limitations: string[];
}

export interface ReleaseAssessment {
  /** Hours BEFORE observation, [nearer, farther], e.g. [12, 18]. */
  strongestWindowH: [number, number] | null;
  alternateWindowH: [number, number] | null;
  state: AssessmentState;
}

export interface CandidateVessel {
  /** Pseudonymous candidate label, e.g. "Vessel-17". */
  id: string;
  vesselType: string;
  supportScore: number;
  keyReason: string;
  aisGaps: { from: string; to: string }[];
  track?: LatLon[];
}

export interface VesselAssessment {
  aisAvailable: boolean;
  aisCoveragePct: number | null;
  vesselsScreened: number;
  candidates: CandidateVessel[];
  attributionState: AssessmentState;
  /** Only set when EXTERNAL evidence (inspection, sampling, legal finding) exists. */
  externalConfirmation: { vesselId: string; source: string } | null;
}

export interface ForecastHorizon {
  horizonH: number;
  centre: LatLon;
  /** Movement direction of the centre, degrees TOWARD. */
  directionDeg: number;
  uncertaintyKm: number;
  shorelineContactProbability: number | null;
  primaryConcern: string;
  confidence: Level;
}

export interface ForecastSummary {
  available: boolean;
  issuedAt: string | null;
  model: string | null;
  horizons: ForecastHorizon[];
  /** Schematic coastline (land east of the line). Visual only. */
  coastline?: LatLon[];
}

export interface ImpactResource {
  id: string;
  name: string;
  type: string;
  sensitivity: Sensitivity;
  exposure: Exposure;
  exposureWindow: { start: string; end: string } | null;
  location?: LatLon;
}

export interface ImpactSummary {
  resources: ImpactResource[];
  /** true = impact observed, false = surveyed / reported none, null = no shoreline survey. */
  shorelineImpactObserved: boolean | null;
}

export interface ConfidenceSummary {
  observation: Level;
  environmental: Level;
  hindcast: Level;
  releaseTiming: Level;
  aisCoverage: Level;
  attribution: AssessmentState;
  forecast6h: Level;
  forecast24h: Level;
}

export interface Warning {
  /** Stable id: the same condition must keep the same id across SITREPs. */
  id: string;
  severity: Severity;
  text: string;
}

export interface RecommendedAction {
  id: string;
  priority: ActionPriority;
  text: string;
  /** Input fields / evidence this action is traceable to. Required. */
  basis: string[];
}

export type DatasetId = 'SAR' | 'WIND' | 'CURRENTS' | 'WAVES' | 'AIS' | 'MODEL';

export interface ProvenanceSummary {
  datasets: { id: DatasetId; label: string; source: string | null; ageHours: number | null; quality: Level }[];
  modelConfiguration: string;
}

/** Comparable facts of the previous SITREP. Produced by `toPreviousSitrep()` or read from its sitrep.json. */
export interface PreviousSitrepSummary {
  sitrepNumber: number;
  revision: number;
  generatedAt: string;
  snapshot: SitrepSnapshot;
}

export interface SitrepIncidentState {
  incident: IncidentMetadata;
  observation: ObservationSummary;
  slick: SlickSummary;
  environment: EnvironmentalSummary;
  hindcast: HindcastSummary;
  releaseAssessment: ReleaseAssessment;
  vesselAssessment: VesselAssessment;
  forecast: ForecastSummary;
  impacts: ImpactSummary;
  confidence: ConfidenceSummary;
  warnings: Warning[];
  actions: RecommendedAction[];
  provenance: ProvenanceSummary;
  previousSitrep?: PreviousSitrepSummary;
}

/* ================================================================== comparison */

/** Minimal comparable state. Stored in every sitrep.json so the next SITREP can diff against it. */
export interface SitrepSnapshot {
  sitrepNumber: number;
  generatedAt: string;
  operationalStatus: OperationalStatus;
  assessmentState: string;
  classification: string;
  observedAt: string;
  slick: { areaKm2: number | null; centroid: LatLon | null; fragmentCount: number | null };
  environment: { wind: boolean; current: boolean; waves: boolean; stokes: boolean };
  forecast: { available: boolean; horizons: { horizonH: number; centre: LatLon; uncertaintyKm: number }[] };
  releaseWindowH: [number, number] | null;
  attributionState: AssessmentState;
  aisCoveragePct: number | null;
  candidates: { id: string; supportScore: number; rank: number }[];
  confidence: ConfidenceSummary;
  resources: { id: string; name: string; exposure: Exposure; sensitivity: Sensitivity; exposureStart: string | null }[];
  alerts: Warning[];
  datasets: { id: DatasetId; label: string; available: boolean; ageHours: number | null; quality: Level }[];
  shorelineImpactObserved: boolean | null;
}

export type DeltaKind = 'NEW' | 'CHANGED' | 'UNCHANGED' | 'RESOLVED' | 'DEGRADED';
export type DeltaCategory = 'STATUS' | 'SLICK' | 'ENVIRONMENT' | 'FORECAST' | 'ATTRIBUTION' | 'CONFIDENCE' | 'IMPACT' | 'ALERT' | 'DATA';

export interface SitrepDelta {
  kind: DeltaKind;
  category: DeltaCategory;
  /** Stable key, e.g. "slick.areaKm2", "candidate.Vessel-17.supportScore". */
  key: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
  /** Signed numeric change where meaningful (km², km, points, %, h). */
  change?: number;
  significance: 'HIGH' | 'MEDIUM' | 'LOW';
  text: string;
}

/* ================================================================== output */

export type SitrepVariant = 'FLASH' | 'FULL';

export interface FactRow {
  label: string;
  value: string;
  evidence: EvidenceClass;
}

export interface RankedResource extends ImpactResource {
  priority: number;
  /** Hours from report generation to exposure window start / end (negative = already open). */
  windowFromReportH: [number, number] | null;
}

export interface SitrepFacts {
  header: {
    title: string;
    documentRef: string;
    sitrepNo: string;
    incidentId: string;
    revision: number;
    reportType: ReportType;
    lifecycle: Lifecycle;
    reportingPeriod: string;
    reportingPeriodStart: string;
    reportingPeriodEnd: string;
    generatedAt: string;
    operationalStatus: string;
    assessmentState: string;
    preparedBy: string;
    reviewedBy: string;
    classification: string;
    distribution: string[];
    region: string;
    systemName: string;
    modelVersion: string;
  };
  demonstration: boolean;
  currentSituation: FactRow[];
  changes: { initial: boolean; previousSitrepNo: string | null; deltas: SitrepDelta[] };
  environment: { assessment: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'; rows: FactRow[] };
  hindcast: { available: boolean; state: AssessmentState; corridor: HindcastSummary['corridor']; releaseWindowH: [number, number] | null; rows: FactRow[]; limitations: string[] };
  vessels: { aisAvailable: boolean; aisCoveragePct: number | null; vesselsScreened: number; attributionState: AssessmentState; candidates: CandidateVessel[]; omittedCount: number };
  forecast: { available: boolean; issuedAt: string | null; model: string | null; horizons: (ForecastHorizon & { validAt: string })[] };
  impacts: { resources: RankedResource[]; shorelineImpactObserved: boolean | null };
  alerts: Warning[];
  actions: RecommendedAction[];
  gaps: string[];
  confidence: { key: keyof ConfidenceSummary; label: string; value: Level | AssessmentState }[];
  evidenceBasis: Record<EvidenceClass, string[]>;
  provenance: { label: string; value: string }[];
  /** Demonstration / schematic geometry for the optional visuals. Never used for any stated value. */
  geometry: {
    slickCentroid: LatLon | null;
    slickOutline: LatLon[] | null;
    coastline: LatLon[] | null;
    corridorPolygon: LatLon[] | null;
    tracks: { id: string; points: LatLon[] }[];
  };
}

export interface SitrepNarrative {
  executiveSituation: string;
  hindcast: string;
  vesselDisclaimer: string;
  forecastLabel: string;
  demonstrationNotice: string | null;
}

export interface SitrepDocument {
  schema: 'guardians-sitrep/1';
  variant: SitrepVariant;
  facts: SitrepFacts;
  narrative: SitrepNarrative;
  /** Feed back as `previousSitrep.snapshot` when generating the next SITREP. */
  snapshot: SitrepSnapshot;
}
