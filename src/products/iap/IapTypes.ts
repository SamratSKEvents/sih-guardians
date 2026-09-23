/**
 * Incident Action Plan contracts.
 *
 *  1. IapIncidentState — the ONLY input. The integrated GUARDIANS application will map its live incident state into it.
 *  2. IapDocument      — the structured plan (objectives → assignments → assets → times → dependencies → success
 *                        criteria, plus triggers, contingencies, validation and a comparison snapshot), serialised as iap.json.
 *
 * Conventions
 *   - Times: ISO-8601 UTC strings. Distances km, speeds m/s, wave height m, bearings degrees true.
 *   - Wind direction = FROM. Movement / current direction = TOWARD.
 *   - `null` means NOT AVAILABLE. The generator never substitutes a value for null; it reports the gap instead.
 *   - Every generated objective, assignment, trigger, contingency, alert and derived gap carries `derivedFrom[]`
 *     (input field paths or rule ids). Items without traceability are rejected by the validator.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export type Level = 'HIGH' | 'MEDIUM-HIGH' | 'MEDIUM' | 'LOW-MEDIUM' | 'LOW' | 'UNAVAILABLE';
/** P1 IMMEDIATE · P2 HIGH · P3 ROUTINE — the single priority scale used for objectives, assignments, gaps and samples. */
export type Priority = 'P1' | 'P2' | 'P3';
export type PlanStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'SUPERSEDED' | 'FINAL';
export type Sensitivity = 'CRITICAL' | 'VERY HIGH' | 'HIGH' | 'MODERATE' | 'LOW';
export type Exposure = 'CONFIRMED' | 'LIKELY' | 'POSSIBLE' | 'UNLIKELY';
export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'NOTICE';
export type HazardSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

/* ================================================================== input */

export interface IncidentMetadata {
  incidentId: string;
  incidentName: string;
  region: string;
  subArea?: string;
  /** Designated incident command authority (placeholder role, never a real person). */
  commandAuthority: string;
  systemName: string;
  modelVersion: string;
  classification: string;
  distribution: string[];
  /** When true every output carries DEMONSTRATION / ILLUSTRATIVE DATA markings and the plan must stay unapproved. */
  isDemonstrationData: boolean;
}

export interface OperationalPeriod {
  iapNumber: number;
  /** 0 for the first issue of an IAP number; a correction is a new revision, never an overwrite. */
  revision: number;
  status: PlanStatus;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  preparedBy: string;
  reviewedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** SITREP this plan was built against, e.g. "SIH-DEMO-2026-014-SR004". */
  sitrepRef: string | null;
}

export interface CurrentSituation {
  assessedAt: string;
  slickStatus: 'SUSPECTED' | 'PROBABLE' | 'CONFIRMED' | 'NOT RELOCATED';
  /** SATELLITE_ONLY = remote detection without field/aerial verification. */
  verification: 'SATELLITE_ONLY' | 'FIELD_VERIFIED';
  /** null = oil type / composition not identified. */
  oilType: string | null;
  shorelineContact: 'CONFIRMED' | 'NOT OBSERVED' | 'NOT SURVEYED';
  /** Daylight intervals covering the operational period; null = not available. */
  daylight: { sunrise: string; sunset: string }[] | null;
}

export interface SlickSummary {
  observedAt: string;
  source: string;
  sectorId: string | null;
  locationText: string | null;
  centroid: LatLon | null;
  areaKm2: number | null;
  lengthKm: number | null;
  fragmentCount: number | null;
  detectionConfidence: Level;
  trend: 'GROWING' | 'STABLE' | 'DECREASING' | null;
}

export interface WeatherWindow {
  from: string;
  to: string;
  windSpeedMs: number | null;
  windFromDeg: number | null;
  waveHsM: number | null;
  visibilityKm: number | null;
}

export interface EnvironmentalSummary {
  validAt: string;
  source: string;
  windSpeedMs: number | null;
  windFromDeg: number | null;
  currentSpeedMs: number | null;
  currentTowardDeg: number | null;
  waveHsM: number | null;
  visibilityKm: number | null;
  /** Weather outlook through the operational period (used for operating-limit checks). */
  outlook: WeatherWindow[];
  dataQuality: Level;
}

export interface ForecastHorizon {
  horizonH: number;
  sectorId: string | null;
  uncertaintyKm: number | null;
  confidence: Level;
}

export interface ForecastSummary {
  issuedAt: string;
  model: string;
  movementTowardDeg: number | null;
  /** Planning sector expected to hold the leading edge during the operational period. */
  leadingEdgeSectorId: string | null;
  /** Sectors where interception is supported by the forecast (planning basis only). */
  interceptionSectorIds: string[];
  horizons: ForecastHorizon[];
  confidence: Level;
}

export type ResourceType = 'CRITICAL INFRASTRUCTURE' | 'ECOLOGICAL' | 'SOCIO-ECONOMIC' | 'AMENITY';

export interface ThreatenedResource {
  resourceId: string;
  name: string;
  type: ResourceType;
  sensitivity: Sensitivity;
  exposure: Exposure;
  exposureWindow: { start: string; end: string } | null;
  confidence: Level;
  sectorId: string;
  /** Shoreline habitat / frontage (shoreline preparation applies). */
  shoreline: boolean;
  /** Operator / community to be advised, e.g. "Intake operator (placeholder)". */
  stakeholder: string | null;
  /** Planning protection method; null = no protection method defined. */
  protection: { method: string; boomRequiredM: number | null; leadTimeH: number | null } | null;
}

export interface ImpactAssessment {
  assessedAt: string;
  source: string;
  resources: ThreatenedResource[];
}

/** Output of the (future) Protection Priority Planner. When null the IAP ranks resources by its own rules. */
export interface ProtectionPriority {
  resourceId: string;
  rank: number;
  rationale: string[];
}

export interface VesselAssessment {
  aisAvailable: boolean;
  /** Candidate labels only — analytical support, never attribution. */
  candidates: { id: string; supportScore: number }[];
}

export type Capability =
  | 'SURVEILLANCE_AIR'
  | 'SURVEILLANCE_DRONE'
  | 'SURVEILLANCE_VESSEL'
  | 'CONTAINMENT'
  | 'RECOVERY'
  | 'BOOM_DEPLOY'
  | 'BOOM'
  | 'TRANSPORT'
  | 'SAMPLING'
  | 'SHORELINE_ASSESSMENT'
  | 'SENSOR'
  | 'SAFETY_OFFICER'
  | 'LIAISON'
  | 'SITUATION_UNIT';

export type AssetKind =
  | 'RESPONSE VESSEL'
  | 'PATROL VESSEL'
  | 'AIRCRAFT'
  | 'DRONE TEAM'
  | 'SAMPLING TEAM'
  | 'SHORE TEAM'
  | 'BOOM'
  | 'SKIMMER'
  | 'SENSOR'
  | 'COMMAND';

export type AvailabilityStatus = 'AVAILABLE' | 'DELAYED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface ResponseAsset {
  assetId: string;
  name: string;
  kind: AssetKind;
  capabilities: Capability[];
  baseFacilityId: string | null;
  availability: {
    status: AvailabilityStatus;
    /** Earliest time the asset can be tasked; null = availability not known (the asset is not scheduled). */
    from: string | null;
    until: string | null;
    note: string | null;
  };
  /** Declared mobilisation time (min). Used as a planning assumption — requires confirmation. */
  readinessMin: number | null;
  boomLengthM?: number | null;
  personnel: { poolId: string; count: number } | null;
  /** Operating limits supplied by the asset owner. null fields = limit not supplied (never invented). */
  limits: { maxWindMs: number | null; maxWaveHsM: number | null; minVisibilityKm: number | null; daylightOnly: boolean } | null;
  limitations: string[];
}

export interface ResponseFacility {
  facilityId: string;
  name: string;
  type: 'HARBOUR' | 'AIRFIELD' | 'STAGING AREA' | 'COMMAND POST' | 'LABORATORY';
  clearanceRequired: boolean;
  notes: string[];
}

export interface PlanningSector {
  sectorId: string;
  name: string;
  type: 'OFFSHORE' | 'NEARSHORE' | 'SHORELINE' | 'BASE';
  /** Transit time (min) from the response base by mode; null = not available. */
  transitMin: { vessel: number | null; air: number | null; road: number | null };
  /** Schematic layout (demonstration grid units, x east / y north). Visual only. */
  schematic: { x: number; y: number; w: number; h: number };
}

export interface PersonnelPool {
  poolId: string;
  role: string;
  available: number | null;
}

export interface CommsChannel {
  channelId: string;
  label: string;
  purpose: string;
  users: AssetKind[];
  primary: string;
  backup: string | null;
}

export type ConstraintType = 'RESOURCE' | 'WEATHER' | 'DAYLIGHT' | 'ACCESS' | 'REGULATORY' | 'DATA' | 'LOGISTICS';

export interface OperationalConstraint {
  constraintId: string;
  type: ConstraintType;
  description: string;
  from: string | null;
  to: string | null;
  /** Activities the constraint restricts (empty = general). Used to link constraints to assignments. */
  appliesTo: Activity[];
}

export type Activity =
  | 'COMMAND'
  | 'NOTIFICATION'
  | 'INFORMATION'
  | 'SURVEILLANCE_AIR'
  | 'SURVEILLANCE_DRONE'
  | 'SURVEILLANCE_VESSEL'
  | 'PROTECTION'
  | 'CONTAINMENT'
  | 'SAMPLING'
  | 'SHORELINE'
  | 'MONITORING';

export type HazardType =
  | 'SEA STATE'
  | 'VISIBILITY'
  | 'NIGHT OPERATIONS'
  | 'VESSEL TRAFFIC'
  | 'HYDROCARBON EXPOSURE'
  | 'HEAT'
  | 'WEATHER'
  | 'SHORELINE ACCESS'
  | 'AIRSPACE SEPARATION'
  | 'COMMUNICATIONS LOSS';

export interface SafetyHazard {
  hazardId: string;
  type: HazardType;
  description: string;
  severity: HazardSeverity;
  appliesTo: Activity[];
  from: string | null;
  to: string | null;
  mitigation: string | null;
  stopWorkCriteria: string | null;
}

export interface InformationGap {
  gapId: string;
  description: string;
  operationalImpact: string;
  actionToResolve: string;
  owner: string;
  priority: Priority;
}

export interface Alert {
  alertId: string;
  severity: AlertSeverity;
  text: string;
}

export interface PlanningAssumption {
  assumptionId: string;
  statement: string;
  basis: string;
}

/** Field / command reports on objectives and assignments of the previous IAP. */
export interface ProgressReport {
  refId: string;
  kind: 'OBJECTIVE' | 'ASSIGNMENT';
  status: 'COMPLETED' | 'CANCELLED' | 'IN PROGRESS';
  reportedAt: string;
  note: string;
}

export interface PreviousIapSnapshot {
  iapNumber: number;
  revision: number;
  createdAt: string;
  snapshot: IapSnapshot;
}

export interface IapIncidentState {
  incident: IncidentMetadata;
  operationalPeriod: OperationalPeriod;
  currentSituation: CurrentSituation;
  slick: SlickSummary | null;
  environment: EnvironmentalSummary | null;
  forecast: ForecastSummary | null;
  impactAssessment: ImpactAssessment | null;
  protectionPriorities: ProtectionPriority[] | null;
  vesselAssessment: VesselAssessment | null;
  planningSectors: PlanningSector[];
  availableAssets: ResponseAsset[];
  facilities: ResponseFacility[];
  personnel: PersonnelPool[];
  communications: CommsChannel[] | null;
  constraints: OperationalConstraint[];
  /** null = no site-safety assessment supplied. */
  safetyHazards: SafetyHazard[] | null;
  informationGaps: InformationGap[];
  currentAlerts: Alert[];
  assumptions: PlanningAssumption[];
  progress: ProgressReport[];
  /** Assignments entered by the Operations / Planning staff. Validated exactly like generated ones. */
  directedAssignments: Assignment[];
  previousIap?: PreviousIapSnapshot;
}

/* ================================================================== plan (output) */

export interface Traceable {
  /** Input field paths / rule ids this item was derived from. Required, non-empty. */
  derivedFrom: string[];
}

export type ObjectiveCategory = 'SAFETY' | 'PROTECT' | 'DELINEATE' | 'SURVEIL' | 'CHARACTERISE' | 'CONTAIN' | 'SAMPLE' | 'SHORELINE' | 'INFORMATION' | 'EVIDENCE';

export interface Objective extends Traceable {
  objectiveId: string;
  rank: number;
  priority: Priority;
  category: ObjectiveCategory;
  statement: string;
  reason: string;
  /** Operational drivers that set the priority (rule outcomes, not scores). */
  priorityDrivers: string[];
  sourceEvidence: string[];
  successCriteria: string[];
  constraints: string[];
  status: 'ACTIVE' | 'CONTINUING' | 'PARTIALLY RESOURCED' | 'UNRESOURCED';
  assignmentIds: string[];
}

export type DependencyType = 'ASSIGNMENT' | 'FORECAST UPDATE' | 'COMMAND AUTHORIZATION' | 'HARBOUR CLEARANCE' | 'SURVEILLANCE CONFIRMATION' | 'ASSET READINESS' | 'WEATHER STATE';

export interface Dependency {
  type: DependencyType;
  /** Assignment id (type ASSIGNMENT) or asset / facility id. */
  ref: string | null;
  note: string;
}

export type AssignmentStatus = 'PLANNED' | 'PARTIALLY RESOURCED' | 'UNRESOURCED' | 'DEFERRED' | 'IN PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Assignment extends Traceable {
  assignmentId: string;
  objectiveId: string;
  priority: Priority;
  activity: Activity;
  task: string;
  assignedUnit: string;
  assetIds: string[];
  /** Mobilisation start. null = not scheduled. */
  startTime: string | null;
  /** null when transit time is not available. */
  onSceneTime: string | null;
  targetCompletion: string | null;
  /** `heldAssetIds` stay committed until this time (e.g. staged package held in readiness); other assets are released at targetCompletion. */
  commitUntil: string | null;
  heldAssetIds: string[];
  sectorId: string | null;
  location: string;
  dependencies: Dependency[];
  requiredInformation: string[];
  safetyNotes: string[];
  successCriteria: string[];
  fallbackAction: string;
  assumptionIds: string[];
  status: AssignmentStatus;
  statusReason: string | null;
  source: 'GENERATED' | 'DIRECTED';
  boomRequiredM: number | null;
}

export interface ProtectionPriorityRow extends Traceable {
  rank: number;
  resourceId: string;
  name: string;
  sectorId: string;
  type: ResourceType;
  sensitivity: Sensitivity;
  exposure: Exposure;
  exposureWindow: { start: string; end: string } | null;
  /** Hours from period start to window start (negative = already open). */
  hoursToExposure: number | null;
  confidence: Level;
  priority: Priority | 'MONITOR';
  drivers: string[];
  protectionObjective: string;
  objectiveId: string | null;
  assignmentIds: string[];
  /** Latest time a deployment decision still leaves the declared lead time: window start − lead time. */
  decideBy: string | null;
  limitations: string[];
}

export interface SurveillanceTask extends Traceable {
  taskId: string;
  assignmentId: string | null;
  objective: string;
  area: string;
  priority: Priority;
  window: { from: string; to: string } | null;
  platform: string;
  reportingRequirement: string;
  evidenceSought: string[];
  status: string;
}

export interface ContainmentAction extends Traceable {
  actionId: string;
  sectorId: string | null;
  planningStatus: 'PROPOSED — PLANNING BASIS' | 'PENDING FIELD VERIFICATION' | 'NOT PLANNABLE — HOLD AT BASE' | 'UNRESOURCED';
  purpose: string;
  triggerCondition: string;
  assignmentId: string | null;
  assetIds: string[];
  deploymentReadiness: string;
  constraints: string[];
  confidence: Level;
}

export interface SamplingLocation extends Traceable {
  sampleId: string;
  location: string;
  purpose: string;
  priority: Priority;
  sampleType: string;
  timing: string;
  assignmentId: string | null;
  assignedTeam: string;
  chainOfCustody: string;
  requiredMetadata: string[];
}

export interface ShorelineTask extends Traceable {
  taskId: string;
  mode: 'PREPARATION' | 'ACTIVE RESPONSE';
  resourceId: string;
  sectorId: string;
  action: string;
  assignmentId: string | null;
  escalationTrigger: string | null;
}

export interface SafetyItem extends Traceable {
  hazardId: string;
  type: HazardType;
  hazard: string;
  severity: HazardSeverity;
  affectedAssignments: string[];
  mitigation: string;
  stopWorkCriteria: string;
  source: 'INPUT' | 'DERIVED';
}

export interface CommsRow extends Traceable {
  channelId: string;
  label: string;
  purpose: string;
  participants: string[];
  primary: string;
  backup: string;
  reportingInterval: string;
}

export interface ReportingRequirement extends Traceable {
  reqId: string;
  reportingUnit: string;
  content: string;
  dueKind: 'BY TIME' | 'INTERVAL' | 'ON EVENT';
  dueAt: string | null;
  intervalMin: number | null;
  event: string | null;
  recipient: string;
  channelId: string | null;
  assignmentId: string | null;
}

export interface DecisionTrigger extends Traceable {
  triggerId: string;
  condition: string;
  /** Where the threshold comes from; null when no numeric threshold applies. */
  thresholdSource: string | null;
  action: string;
  requires: string[];
  decisionAuthority: string;
  decideBy: string | null;
  affectedAssignments: string[];
  status: 'ARMED' | 'THRESHOLD NOT SUPPLIED' | 'DECISION TIME PASSED';
}

export interface Contingency extends Traceable {
  contingencyId: string;
  scenario: string;
  indicator: string;
  actions: string[];
  alternateAssets: string[];
  activation: 'STANDBY' | 'ACTIVATED';
  activationReason: string | null;
}

export interface GapRow extends InformationGap, Traceable {
  source: 'INPUT' | 'DERIVED';
}

export interface AssumptionRow extends PlanningAssumption, Traceable {
  source: 'INPUT' | 'DERIVED';
  usedBy: string[];
}

export interface ConstraintRow extends OperationalConstraint, Traceable {
  source: 'INPUT' | 'DERIVED';
  affectsAssignments: string[];
}

export interface PlanAlert extends Alert, Traceable {
  source: 'INPUT' | 'DERIVED';
}

export interface ResourceAllocationRow {
  assetId: string;
  name: string;
  kind: AssetKind;
  availability: string;
  status: 'ASSIGNED' | 'UNTASKED' | 'UNAVAILABLE' | 'AVAILABILITY UNKNOWN';
  assignments: { assignmentId: string; sectorId: string | null; from: string | null; to: string | null; hold: boolean }[];
  limitations: string[];
}

export type ValidationCode =
  | 'NO_OBJECTIVES'
  | 'OBJECTIVE_WITHOUT_ASSIGNMENT'
  | 'OBJECTIVE_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'ASSET_UNAVAILABLE'
  | 'ASSET_AVAILABILITY_UNKNOWN'
  | 'SCHEDULED_BEFORE_AVAILABLE'
  | 'RESOURCE_CONFLICT'
  | 'INSUFFICIENT_BOOM'
  | 'INSUFFICIENT_PERSONNEL'
  | 'NO_CONTAINMENT_CAPABILITY'
  | 'DEPENDENCY_UNKNOWN'
  | 'DEPENDENCY_CYCLE'
  | 'DEPENDENCY_ORDER'
  | 'MISSING_TRACEABILITY'
  | 'MISSING_FIELD'
  | 'INVALID_PRIORITY'
  | 'OUTSIDE_PERIOD'
  | 'WEATHER_LIMIT_EXCEEDED'
  | 'DAYLIGHT_RESTRICTION'
  | 'SAFETY_COVERAGE_MISSING'
  | 'UNRESOURCED_ASSIGNMENT'
  | 'DEFERRED_ASSIGNMENT'
  | 'READINESS_AFTER_DECISION_TIME'
  | 'TRANSIT_TIME_UNKNOWN'
  | 'COMMS_PLAN_MISSING'
  | 'DEMONSTRATION_FLAG'
  | 'APPROVAL_INCOMPLETE';

export interface ValidationIssue {
  code: ValidationCode;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  refs: string[];
}

export interface ValidationResult {
  result: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID';
  issues: ValidationIssue[];
}

/** The non-negotiable machine-readable plan graph: objective → assignment → asset / time / dependency / success criteria. */
export interface PlanGraph {
  nodes: (
    | { id: string; type: 'OBJECTIVE'; priority: Priority; label: string; successCriteria: string[] }
    | { id: string; type: 'ASSIGNMENT'; priority: Priority; label: string; start: string | null; end: string | null; commitUntil: string | null; status: AssignmentStatus; successCriteria: string[] }
    | { id: string; type: 'ASSET'; label: string; kind: AssetKind }
    | { id: string; type: 'RESOURCE'; label: string; exposure: Exposure }
    | { id: string; type: 'EXTERNAL_DEPENDENCY'; label: string }
    | { id: string; type: 'TRIGGER' | 'CONTINGENCY'; label: string }
  )[];
  edges: { from: string; to: string; type: 'ACHIEVED_BY' | 'USES' | 'DEPENDS_ON' | 'PROTECTS' | 'ESCALATES' | 'ALTERNATE_FOR' }[];
}

/* ================================================================== comparison */

export interface IapSnapshot {
  iapNumber: number;
  revision: number;
  periodStart: string;
  periodEnd: string;
  objectives: { id: string; priority: Priority; statement: string }[];
  assignments: { id: string; objectiveId: string; priority: Priority; assetIds: string[]; start: string | null; status: AssignmentStatus; task: string }[];
  assets: { id: string; name: string; status: AvailabilityStatus; availableFrom: string | null }[];
  resources: { id: string; name: string; exposure: Exposure; windowStart: string | null; priority: Priority | 'MONITOR' }[];
  hazards: { id: string; severity: HazardSeverity; hazard: string }[];
  gaps: { id: string; description: string }[];
  contingencies: { id: string; scenario: string; activation: Contingency['activation'] }[];
  samples: { id: string; location: string; priority: Priority }[];
  forecast: { available: boolean; leadingEdgeSectorId: string | null; confidence: Level };
  environment: { available: boolean; wind: boolean; waves: boolean };
  shorelineContact: CurrentSituation['shorelineContact'];
}

export type DeltaKind = 'NEW' | 'CHANGED' | 'DEGRADED' | 'RESOLVED' | 'CANCELLED' | 'COMPLETED' | 'UNCHANGED';
export type DeltaCategory = 'OBJECTIVE' | 'ASSIGNMENT' | 'ASSET' | 'THREAT' | 'FORECAST' | 'ENVIRONMENT' | 'SAFETY' | 'GAP' | 'CONTINGENCY' | 'SAMPLING' | 'SHORELINE';

export interface IapDelta {
  kind: DeltaKind;
  category: DeltaCategory;
  /** Stable key, e.g. "objective.OBJ-PROTECT-R02.priority". */
  key: string;
  from: string | null;
  to: string | null;
  significance: 'HIGH' | 'MEDIUM' | 'LOW';
  text: string;
}

/* ================================================================== document */

export type IapVariant = 'QUICK' | 'FULL';

export interface FactRow {
  label: string;
  value: string;
  basis: 'OBSERVED' | 'MODELLED' | 'INFERRED' | 'PLANNING' | 'NOT AVAILABLE';
}

export interface IapHeader {
  title: string;
  documentRef: string;
  iapNo: string;
  incidentId: string;
  incidentName: string;
  revision: number;
  status: PlanStatus;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  operationalPeriod: string;
  region: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  approvedAt: string;
  commandAuthority: string;
  classification: string;
  distribution: string[];
  sitrepRef: string;
  systemName: string;
  modelVersion: string;
}

export interface IapPlan {
  situation: FactRow[];
  commandEmphasis: string;
  alerts: PlanAlert[];
  objectives: Objective[];
  protectionPriorities: ProtectionPriorityRow[];
  assignments: Assignment[];
  resourceAllocation: ResourceAllocationRow[];
  surveillance: SurveillanceTask[];
  containment: ContainmentAction[];
  sampling: SamplingLocation[];
  shoreline: { contact: CurrentSituation['shorelineContact']; tasks: ShorelineTask[] };
  safety: { assessmentAvailable: boolean; items: SafetyItem[] };
  communications: { available: boolean; rows: CommsRow[] };
  reporting: ReportingRequirement[];
  decisionTriggers: DecisionTrigger[];
  contingencies: Contingency[];
  informationGaps: GapRow[];
  assumptions: AssumptionRow[];
  constraints: ConstraintRow[];
  graph: PlanGraph;
  /** Demonstration planning-sector geometry for visuals only. Never used for any stated value. */
  sectors: PlanningSector[];
  geometry: { slickSectorId: string | null; leadingEdgeSectorId: string | null; interceptionSectorIds: string[] };
  weatherOutlook: WeatherWindow[];
}

export interface IapDocument {
  schema: 'guardians-iap/1';
  variant: IapVariant;
  header: IapHeader;
  demonstration: boolean;
  authorityNotice: string;
  validation: ValidationResult;
  changes: { initial: boolean; previousIapNo: string | null; deltas: IapDelta[] };
  plan: IapPlan;
  /** Feed back as `previousIap.snapshot` when generating the next IAP. */
  snapshot: IapSnapshot;
}
