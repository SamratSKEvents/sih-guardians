/**
 * The incident bundle.
 *
 * Four slicks in the catalog carry a full investigation, computed by the
 * original GUARDIANS pipeline and frozen: the CleanSeaNet 2021 attribution
 * case, and three TerraMind benchmark scenes. Everything below describes those
 * files, not a wish-list.
 *
 * The spine is `Stated`. Every artifact in a bundle either carries its payload
 * or carries `{ status: 'UNAVAILABLE', reason, detail }` saying, in the
 * pipeline's own words, why it does not exist. That is the difference this
 * console rests on: "we have not built it yet" and "it could not be computed
 * for this detection" are different answers, and the data already knows which.
 *
 * So a field here is optional only where the pipeline genuinely emits it
 * sometimes — never because a fetch might not have happened.
 */

/** How far an answer got. `PARTIAL` carries a payload AND a caveat. */
export type State =
  | 'AVAILABLE'
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'INTERPOLATED'
  | 'AMBIGUOUS'
  | 'NOT_ASSESSABLE'
  | 'UNAVAILABLE';

/** An artifact that says what it is, and when it is missing, why. */
export interface Stated {
  status: State;
  /** Machine code, e.g. FORCING_COVERAGE_EXCEEDED. Never printed raw. */
  reason?: string | null;
  /** The pipeline's own sentence. Printed verbatim: it is better than ours. */
  detail?: string | null;
}

export interface LonLat {
  lon: number;
  lat: number;
}

/* ------------------------------------------------------------------ index */

/** One row of incident.coverage: a dataset, and how far it got. */
export interface Coverage extends Stated {
  key: string;
  label: string;
  state: State;
}

export interface Incident {
  id: string;
  kind: string;
  name: string;
  subtitle: string;
  acquisitionTime: string | null;
  sensor: string | null;
  centre: LonLat;
  bbox: [number, number, number, number];
  timeDomain?: { start: string; end: string };
  reported?: {
    lengthKm?: number;
    areaKm2?: number;
    classification?: string;
    feedback?: string;
    source?: string;
    note?: string;
  };
  attributionStatus: State;
  attributionRationale?: string;
  candidateCount?: number;
  documentedPossibleSource?: {
    note: string;
    frozenBaselineRank: number;
    naiveProximityRank: number;
    rankImprovement: number;
    percentile: number;
  };
  capabilities: Record<string, boolean | string>;
  coverage: Coverage[];
  files: Record<string, string>;
}

/* -------------------------------------------------------------- artifacts */

export interface Detection extends Stated {
  incidentId: string;
  sceneId: string;
  acquisitionTime: string | null;
  acquisitionTimeState?: Stated;
  sensor: string | null;
  sensorState?: Stated;
  modelId: string | null;
  modelVersion: string | null;
  geometryStatus: string;
  detectionPoint?: LonLat;
  rasterBounds?: [number, number, number, number];
  rasterSize?: { width: number; height: number };
  threshold?: number;
  metricCrs?: string;
  generatedAt?: string;
  reported?: Incident['reported'];
  slicks?: { id: string; polygon: { type: string; coordinates: number[][][] } }[];
  slickCount?: number;
  sarImagery?: SarImagery;
}

/**
 * The backscatter scene, rendered for display. `url` and `bounds` are present
 * only when `status` is AVAILABLE; when it is not, `detail` says why in the
 * pipeline's own words, which is what the stage prints.
 */
export interface SarImagery extends Stated {
  url?: string;
  bounds?: [number, number, number, number];
  band?: string;
  /** How float backscatter was squeezed into 8 bits. Display only. */
  stretch?: { lowDb: number; highDb: number; method: string };
  note?: string;
}

/** The reconstructed T0 footprint: its geometry, and how far it disagrees. */
export interface T0Footprint {
  classification: string;
  reasonCode?: string;
  description: string;
  geometryMethod?: string;
  centroid: [number, number];
  areaKm2: number;
  orientationDeg: number;
  majorAxisLengthKm: number;
  spreadKm: number;
  particleCount: number;
  coreGeometry?: GeoShape;
  supportGeometry?: GeoShape;
  outerEnvelope?: GeoShape;
  reportedAreaKm2?: number;
  areaDifferenceKm2?: number;
  areaDifferencePercent?: number;
  lengthDifferencePercent?: number;
  discrepancyFlag?: boolean;
  limitations?: string[];
  timestamp: string;
}

export interface GeoShape {
  type: string;
  coordinates: unknown;
}

export interface SourceHypothesis {
  scenario: string;
  ageHours: number;
  time: string;
  centre: LonLat;
  spreadRadiusKm: number;
  particleCount: number;
  interpretation: string;
}

export interface SourceHypotheses extends Stated {
  kind?: string;
  hypotheses?: SourceHypothesis[];
  scenarios?: string[];
  ageHours?: number[];
  rasterSurface?: Stated;
  warnings?: string[];
}

/** One weighted term of a candidate's score, with the numbers behind it. */
export interface ScoreComponent {
  value: number;
  weight: number;
  contribution: number;
  /** audit = recomputed here; artifact = read from the frozen run. */
  origin: string;
  raw: Record<string, unknown>;
}

export interface CandidateIdentity {
  vesselId: string;
  mmsi: string | null;
  imo: string | null;
  name: string | null;
  type: string | null;
  gearType: string | null;
  flag: string | null;
  callsign: string | null;
}

export interface Candidate {
  candidateId: string;
  vesselId: string;
  rank: number;
  collationScore: number;
  components: Record<string, ScoreComponent>;
  identity: CandidateIdentity;
  observationCount: number;
  audit?: Record<string, unknown>;
  evidenceLimitations?: string;
}

export interface Candidates extends Stated {
  rankingMode?: string;
  scoringFormula?: {
    expression: string;
    weights: Record<string, number>;
    note: string;
    vocabulary: string;
  };
  candidates?: Candidate[];
  scoreDistribution?: { min: number; max: number; spread: number };
  evaluation?: {
    candidateCount: number;
    naiveProximityRank: number;
    frozenBaselineRank: number;
    rankImprovement: number;
    percentile: number;
    assessment: string;
    blindBeforeTruth: boolean;
    note: string;
  };
  analystNotice?: string;
  dataQualityWarnings?: string[];
}

export interface AisTrack {
  vesselId: string;
  mmsi: string | null;
  imo: string | null;
  name: string | null;
  type: string | null;
  flag: string | null;
  callsign: string | null;
  points: { t: string; lon: number; lat: number }[];
  gaps: unknown[];
  reportCount: number;
  firstReport: string;
  lastReport: string;
}

export interface Ais extends Stated {
  kind?: string;
  resolutionNote?: string;
  times?: string[];
  vesselCount?: number;
  tracks?: AisTrack[];
  sogCogState?: Stated;
}

export interface ForecastHorizon extends Stated {
  hours: number;
}

export interface Forecast extends Stated {
  kind?: string;
  validHorizonsHours?: number[];
  horizons?: ForecastHorizon[];
  track?: { lon: number; lat: number; hours: number; time: string }[];
  method?: string;
  interpretation?: string;
  forcingCoverage?: { first: string; last: string; tolerance_minutes: number };
  scientificNotice?: string;
  footprintPolygon?: Stated;
  consequence?: Stated;
  warnings?: string[];
}

/** One field's grid metadata. The frames themselves stay on disk, unread. */
export interface FieldSummary {
  gridShape: [number, number];
  missingPercent: number;
  speedRange: [number, number];
  units: string;
  dataset: string;
  variable: string;
  sourceType: string;
  provider: string;
  coverageNote?: string;
  times: string[];
}

export interface EnvironmentRow {
  t: string;
  windSpeed: number;
  windDir: number;
  currentSpeed: number;
  currentBearing: number;
}

export interface Environment extends Stated {
  metadata?: Record<string, unknown>;
  wind?: FieldSummary;
  currents?: FieldSummary;
  pointTimeseries?: {
    note: string;
    lat: number;
    lon: number;
    rows: EnvironmentRow[];
  };
}

export interface IncidentEvent {
  time: string;
  kind: string;
  label: string;
  detail: string;
  epistemic: 'observed' | 'reconstructed' | 'predicted';
  ageHours?: number;
}

export interface Events extends Stated {
  events?: IncidentEvent[];
  note?: string;
}

export interface ProvenanceStage {
  stage: string;
  producer: string;
  output: string;
  note?: string;
}

export interface ProvenanceSource {
  role: string;
  path: string;
  bytes: number;
  sha256: string;
  readOnly?: boolean;
  exists?: boolean;
}

export interface Provenance extends Stated {
  release?: string;
  frozenAt?: string;
  dataMode?: string;
  isSyntheticDemo?: boolean;
  schemaVersion?: string;
  pipeline?: ProvenanceStage[];
  sources?: ProvenanceSource[];
  freezeManifestHashes?: { path: string; sha256: string; bytes: number }[];
  /** The four questions, each with its own verdict. */
  capabilityStatements?: Record<string, { status: State; detail: string }>;
}

export interface Posthoc extends Stated {
  headline?: string;
  analyses?: {
    id: string;
    name: string;
    classification: string;
    status: State;
    isBaseline: boolean;
    description: string;
    verdict: string;
    verdictDetail: string;
    preregistered: boolean;
  }[];
  guardrail?: string;
}
