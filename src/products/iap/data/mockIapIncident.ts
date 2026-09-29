/**
 * DEMONSTRATION / ILLUSTRATIVE DATA — NOT FOR OPERATIONAL USE.
 * Fictional continuation of incident SIH-DEMO-2026-014 (Mumbai Offshore / Arabian Sea) on 18–19 SEP 2026, planned in
 * three operational periods. Assets are fictional placeholders, not Indian government or industry assets. Resource
 * names follow the SITREP demonstration (R-01 mangrove M-2, R-02 water intake WI-1, R-03 landing centre FLC-3); times
 * are not synchronised with the SITREP sample chain.
 *
 * Operational daylight = civil twilight for Mumbai in mid-September (~00:35–13:30 UTC, i.e. 06:05–19:00 IST).
 *
 *   IAP 001  18 SEP 0600–1200 UTC  initial plan; wind data missing; RV-02 delayed; slick not field-verified
 *   IAP 002  18 SEP 1200–1800 UTC  intake P2 → P1; RV-02 available; new mangrove threat; wind restored; delineation complete
 *   IAP 003  18 SEP 1800 – 19 SEP 0600 UTC  night period; RV-01 unavailable; aircraft on crew rest → alternate surveillance;
 *                                  mangrove LIKELY (P1); FLC-3 protection cancelled; mutual-aid boom arrives
 */
import type {
  CommsChannel, IapIncidentState, PlanningSector, ResponseAsset, ResponseFacility, SafetyHazard, ThreatenedResource,
} from '../IapTypes';

const T = (day: number, hhmm: string) => `2026-09-${day}T${hhmm}:00.000Z`;
const DAYLIGHT = [{ sunrise: T(18, '00:35'), sunset: T(18, '13:30') }, { sunrise: T(19, '00:35'), sunset: T(19, '13:30') }];

const INCIDENT = {
  incidentId: 'SIH-DEMO-2026-014',
  incidentName: 'Mumbai Offshore suspected oil slick (demonstration)',
  region: 'Mumbai Offshore / Arabian Sea',
  subArea: 'Fictional sector AS-W3',
  commandAuthority: 'Designated incident command authority (placeholder)',
  systemName: 'GUARDIANS maritime oil-spill intelligence (SIH prototype)',
  modelVersion: 'guardians-iap 0.1 / transport-v1 (demo)',
  classification: 'RESTRICTED — PLACEHOLDER',
  distribution: ['Incident command (placeholder)', 'Operations Section (placeholder)', 'Planning / Situation Unit (placeholder)', 'Safety Officer (placeholder)'],
  isDemonstrationData: true,
};

const SECTORS: PlanningSector[] = [
  { sectorId: 'O-1', name: 'Offshore slick area', type: 'OFFSHORE', transitMin: { vessel: 120, air: 20, road: null }, schematic: { x: 0, y: -6, w: 14, h: 14 } },
  { sectorId: 'O-2', name: 'Eastern forecast corridor', type: 'OFFSHORE', transitMin: { vessel: 85, air: 15, road: null }, schematic: { x: 14, y: -4, w: 14, h: 12 } },
  { sectorId: 'C-1', name: 'Nearshore interception', type: 'NEARSHORE', transitMin: { vessel: 55, air: 10, road: null }, schematic: { x: 28, y: -2, w: 8, h: 12 } },
  { sectorId: 'C-2', name: 'WI-1 intake approach', type: 'NEARSHORE', transitMin: { vessel: 35, air: 10, road: 30 }, schematic: { x: 36, y: 3, w: 4, h: 6 } },
  { sectorId: 'M-2', name: 'Mangrove creek frontage', type: 'SHORELINE', transitMin: { vessel: 50, air: 12, road: 55 }, schematic: { x: 37, y: 11, w: 6, h: 6 } },
  { sectorId: 'F-3', name: 'Landing centre frontage', type: 'SHORELINE', transitMin: { vessel: 30, air: 10, road: 25 }, schematic: { x: 37, y: -7, w: 6, h: 5 } },
  { sectorId: 'H-1', name: 'Harbour base', type: 'BASE', transitMin: { vessel: 0, air: 0, road: 0 }, schematic: { x: 39, y: -15, w: 5, h: 4 } },
];

const FACILITIES: ResponseFacility[] = [
  { facilityId: 'H-1', name: 'Harbour base H-1', type: 'HARBOUR', clearanceRequired: true, notes: ['Departure clearance requested per sailing (placeholder)'] },
  { facilityId: 'AF-1', name: 'Airfield AF-1', type: 'AIRFIELD', clearanceRequired: false, notes: [] },
  { facilityId: 'SA-1', name: 'Shore staging area SA-1', type: 'STAGING AREA', clearanceRequired: false, notes: [] },
  { facilityId: 'CP-1', name: 'Incident command post CP-1', type: 'COMMAND POST', clearanceRequired: false, notes: [] },
];

const avail = (status: ResponseAsset['availability']['status'], from: string | null, until: string | null = null, note: string | null = null) => ({ status, from, until, note });
const vesselLimits = (maxWaveHsM: number) => ({ maxWindMs: null, maxWaveHsM, minVisibilityKm: null, daylightOnly: false });
const teamLimits = { maxWindMs: null, maxWaveHsM: null, minVisibilityKm: null, daylightOnly: true };

function assets(day: 'P1' | 'P2' | 'P3'): ResponseAsset[] {
  const start = { P1: T(18, '06:00'), P2: T(18, '12:00'), P3: T(18, '18:00') }[day];
  const list: ResponseAsset[] = [
    { assetId: 'RV-01', name: 'Response Vessel RV-01', kind: 'RESPONSE VESSEL', capabilities: ['CONTAINMENT', 'SURVEILLANCE_VESSEL', 'TRANSPORT'], baseFacilityId: 'H-1', availability: day === 'P3' ? avail('UNAVAILABLE', null, null, 'main engine defect reported 17:10 UTC') : avail('AVAILABLE', start), readinessMin: 30, personnel: null, limits: vesselLimits(2.5), limitations: ['Sweep system suited to low-current conditions (placeholder)'] },
    { assetId: 'RV-02', name: 'Response Vessel RV-02', kind: 'RESPONSE VESSEL', capabilities: ['BOOM_DEPLOY', 'TRANSPORT'], baseFacilityId: 'H-1', availability: day === 'P1' ? avail('DELAYED', T(18, '08:00'), null, 'crew change') : avail('AVAILABLE', start), readinessMin: 45, personnel: null, limits: vesselLimits(2.0), limitations: ['Boom deployment limited to one site at a time'] },
    { assetId: 'PV-01', name: 'Patrol Vessel PV-01', kind: 'PATROL VESSEL', capabilities: ['SURVEILLANCE_VESSEL', 'TRANSPORT'], baseFacilityId: 'H-1', availability: avail('AVAILABLE', start), readinessMin: 20, personnel: null, limits: vesselLimits(3.0), limitations: ['No oil-recovery capability'] },
    { assetId: 'AC-01', name: 'Surveillance Aircraft AC-01', kind: 'AIRCRAFT', capabilities: ['SURVEILLANCE_AIR'], baseFacilityId: 'AF-1', availability: day === 'P1' ? avail('AVAILABLE', T(18, '06:00')) : day === 'P2' ? avail('AVAILABLE', T(18, '11:30')) : avail('DELAYED', T(19, '07:00'), null, 'aircrew rest period'), readinessMin: 30, personnel: null, limits: { maxWindMs: 15, maxWaveHsM: null, minVisibilityKm: 5, daylightOnly: true }, limitations: ['Single airframe — no aerial redundancy'] },
    { assetId: 'D-01', name: 'Drone Team D-01', kind: 'DRONE TEAM', capabilities: ['SURVEILLANCE_DRONE'], baseFacilityId: 'SA-1', availability: avail('AVAILABLE', start), readinessMin: 20, personnel: { poolId: 'DRONE', count: 2 }, limits: { maxWindMs: 10, maxWaveHsM: null, minVisibilityKm: null, daylightOnly: true }, limitations: ['Launch from shore only'] },
    { assetId: 'D-02', name: 'Drone Team D-02', kind: 'DRONE TEAM', capabilities: ['SURVEILLANCE_DRONE'], baseFacilityId: 'SA-1', availability: avail('AVAILABLE', start), readinessMin: 20, personnel: { poolId: 'DRONE', count: 2 }, limits: { maxWindMs: 10, maxWaveHsM: null, minVisibilityKm: null, daylightOnly: true }, limitations: ['Launch from shore only'] },
    { assetId: 'SAM-01', name: 'Sampling Team SAM-01', kind: 'SAMPLING TEAM', capabilities: ['SAMPLING'], baseFacilityId: 'SA-1', availability: avail('AVAILABLE', start), readinessMin: 30, personnel: { poolId: 'SAMPLING', count: 2 }, limits: teamLimits, limitations: ['Requires vessel transport offshore'] },
    { assetId: 'ST-01', name: 'Shore Team ST-01', kind: 'SHORE TEAM', capabilities: ['SHORELINE_ASSESSMENT'], baseFacilityId: 'SA-1', availability: avail('AVAILABLE', start), readinessMin: 30, personnel: { poolId: 'SHORE', count: 4 }, limits: teamLimits, limitations: [] },
    { assetId: 'BP-01', name: 'Boom Package BP-01 (300 m)', kind: 'BOOM', capabilities: ['BOOM'], baseFacilityId: 'H-1', availability: avail('AVAILABLE', start), readinessMin: 0, boomLengthM: 300, personnel: null, limits: null, limitations: [] },
    { assetId: 'BP-02', name: 'Boom Package BP-02 (200 m)', kind: 'BOOM', capabilities: ['BOOM'], baseFacilityId: 'H-1', availability: avail('AVAILABLE', start), readinessMin: 0, boomLengthM: 200, personnel: null, limits: null, limitations: [] },
    { assetId: 'SK-01', name: 'Skimmer SK-01', kind: 'SKIMMER', capabilities: ['RECOVERY'], baseFacilityId: 'H-1', availability: avail('AVAILABLE', start), readinessMin: 0, personnel: null, limits: null, limitations: ['Requires a vessel platform'] },
    { assetId: 'PS-01', name: 'Portable Sensor PS-01', kind: 'SENSOR', capabilities: ['SENSOR'], baseFacilityId: 'SA-1', availability: avail('AVAILABLE', start), readinessMin: 0, personnel: null, limits: null, limitations: ['Early-warning indication only — not a confirmation method'] },
    { assetId: 'SOF-01', name: 'Safety Officer SOF-01', kind: 'COMMAND', capabilities: ['SAFETY_OFFICER'], baseFacilityId: 'CP-1', availability: avail('AVAILABLE', start), readinessMin: 0, personnel: null, limits: null, limitations: [] },
    { assetId: 'LNO-01', name: 'Liaison Officer LNO-01', kind: 'COMMAND', capabilities: ['LIAISON'], baseFacilityId: 'CP-1', availability: avail('AVAILABLE', start), readinessMin: 0, personnel: null, limits: null, limitations: [] },
    { assetId: 'SITL-01', name: 'Situation Unit SITL-01', kind: 'COMMAND', capabilities: ['SITUATION_UNIT'], baseFacilityId: 'CP-1', availability: avail('AVAILABLE', start), readinessMin: 0, personnel: null, limits: null, limitations: [] },
  ];
  if (day === 'P3') {
    list.push(
      { assetId: 'MA-WB1', name: 'Mutual-aid Workboat MA-WB1', kind: 'RESPONSE VESSEL', capabilities: ['BOOM_DEPLOY', 'TRANSPORT'], baseFacilityId: 'H-1', availability: avail('DELAYED', T(19, '01:00'), null, 'in transit from neighbouring port'), readinessMin: 30, personnel: null, limits: vesselLimits(2.0), limitations: ['Shallow draft; limited deck space'] },
      { assetId: 'BP-03', name: 'Boom Package BP-03 (350 m, mutual aid)', kind: 'BOOM', capabilities: ['BOOM'], baseFacilityId: 'H-1', availability: avail('DELAYED', T(19, '01:00'), null, 'arrives with MA-WB1'), readinessMin: 0, boomLengthM: 350, personnel: null, limits: null, limitations: [] },
    );
  }
  return list;
}

const COMMS: CommsChannel[] = [
  { channelId: 'CH-CMD', label: 'COMMAND CHANNEL', purpose: 'Command decisions, trigger and stop-work reports', users: ['COMMAND'], primary: 'Command net (placeholder)', backup: 'Satellite phone (placeholder)' },
  { channelId: 'CH-MAR', label: 'MARITIME OPS CHANNEL A', purpose: 'Vessel tasking and status', users: ['RESPONSE VESSEL', 'PATROL VESSEL', 'BOOM', 'SKIMMER'], primary: 'Marine working channel A (placeholder — no frequency assigned)', backup: 'Mobile group call (placeholder)' },
  { channelId: 'CH-AIR', label: 'AIR OPS CHANNEL B', purpose: 'Aircraft / drone deconfliction and observations', users: ['AIRCRAFT', 'DRONE TEAM'], primary: 'Air-ground channel B (placeholder)', backup: 'Mobile group call (placeholder)' },
  { channelId: 'CH-FLD', label: 'SHORE / FIELD CHANNEL C', purpose: 'Sampling, shoreline and sensor teams', users: ['SAMPLING TEAM', 'SHORE TEAM', 'SENSOR'], primary: 'Field channel C (placeholder)', backup: 'Mobile group call (placeholder)' },
  { channelId: 'CH-DATA', label: 'DATA / SITREP CHANNEL', purpose: 'Imagery, sample records, SITREP distribution', users: ['COMMAND'], primary: 'Secure data share (placeholder)', backup: 'E-mail distribution (placeholder)' },
];

const ON_WATER = ['PROTECTION', 'CONTAINMENT', 'SURVEILLANCE_VESSEL', 'SAMPLING'] as SafetyHazard['appliesTo'];
const HZ_SEA: SafetyHazard = { hazardId: 'HZ-01', type: 'SEA STATE', description: 'Moderate swell during small-craft boom and sampling work.', severity: 'MEDIUM', appliesTo: ON_WATER, from: null, to: null, mitigation: 'Transfers only within vessel operator limits; lifejackets worn on deck; two-person rule for over-side work.', stopWorkCriteria: 'Conditions exceed the operating limit supplied for the vessel, or skipper judges transfer unsafe.' };
const HZ_HEAT: SafetyHazard = { hazardId: 'HZ-02', type: 'HEAT', description: 'Afternoon heat stress for shore, sensor and sampling teams.', severity: 'MEDIUM', appliesTo: ['SHORELINE', 'MONITORING', 'SAMPLING', 'SURVEILLANCE_DRONE'], from: T(18, '06:00'), to: T(18, '11:00'), mitigation: 'Work–rest cycles and hydration as directed by the Safety Officer.', stopWorkCriteria: 'Any heat-illness symptom.' };
const HZ_AIR: SafetyHazard = { hazardId: 'HZ-04', type: 'VISIBILITY', description: 'Haze reducing visibility for low-level aerial and drone observation over water.', severity: 'MEDIUM', appliesTo: ['SURVEILLANCE_AIR', 'SURVEILLANCE_DRONE'], from: null, to: null, mitigation: 'Aircraft operator visibility minima; drones kept within visual line of sight; Air Operations deconfliction.', stopWorkCriteria: 'Visibility below the operator minimum supplied for the platform, or loss of visual line of sight.' };

const R02 = (exposure: ThreatenedResource['exposure'], start: string, end: string): ThreatenedResource => ({ resourceId: 'R-02', name: 'Coastal water intake (WI-1)', type: 'CRITICAL INFRASTRUCTURE', sensitivity: 'CRITICAL', exposure, exposureWindow: { start, end }, confidence: 'MEDIUM', sectorId: 'C-2', shoreline: false, stakeholder: 'Intake operator (placeholder)', protection: { method: 'deflection boom', boomRequiredM: 400, leadTimeH: 6 } });
const R01 = (exposure: ThreatenedResource['exposure'], start: string, end: string, confidence: ThreatenedResource['confidence']): ThreatenedResource => ({ resourceId: 'R-01', name: 'Mangrove habitat (sector M-2)', type: 'ECOLOGICAL', sensitivity: 'VERY HIGH', exposure, exposureWindow: { start, end }, confidence, sectorId: 'M-2', shoreline: true, stakeholder: null, protection: { method: 'creek-mouth exclusion boom', boomRequiredM: 600, leadTimeH: 4 } });
const R03 = (exposure: ThreatenedResource['exposure'], start: string, end: string): ThreatenedResource => ({ resourceId: 'R-03', name: 'Fish landing centre (FLC-3)', type: 'SOCIO-ECONOMIC', sensitivity: 'MODERATE', exposure, exposureWindow: { start, end }, confidence: 'LOW-MEDIUM', sectorId: 'F-3', shoreline: true, stakeholder: 'Fisheries cooperative (placeholder)', protection: null });

export const mockIap001: IapIncidentState = {
  incident: INCIDENT,
  operationalPeriod: { iapNumber: 1, revision: 0, status: 'DRAFT', createdAt: T(18, '05:30'), periodStart: T(18, '06:00'), periodEnd: T(18, '12:00'), preparedBy: 'GUARDIANS IAP generator (Planning Section draft)', reviewedBy: null, approvedBy: null, approvedAt: null, sitrepRef: 'SIH-DEMO-2026-014-SR004 (demo)' },
  currentSituation: { assessedAt: T(18, '05:15'), slickStatus: 'PROBABLE', verification: 'SATELLITE_ONLY', oilType: null, shorelineContact: 'NOT OBSERVED', daylight: DAYLIGHT },
  slick: { observedAt: T(18, '04:50'), source: 'C-band SAR (demo)', sectorId: 'O-1', locationText: '≈34 km west of the Mumbai coastline', centroid: { lat: 18.93, lon: 72.49 }, areaKm2: 21.4, lengthKm: 13.0, fragmentCount: 4, detectionConfidence: 'MEDIUM-HIGH', trend: 'STABLE' },
  environment: {
    validAt: T(18, '05:00'), source: 'Operational met-ocean products (demo)', windSpeedMs: null, windFromDeg: null, currentSpeedMs: 0.4, currentTowardDeg: 70, waveHsM: 1.4, visibilityKm: 10, dataQuality: 'LOW-MEDIUM',
    outlook: [
      { from: T(18, '06:00'), to: T(18, '09:00'), windSpeedMs: null, windFromDeg: null, waveHsM: 1.4, visibilityKm: 10 },
      { from: T(18, '09:00'), to: T(18, '12:00'), windSpeedMs: null, windFromDeg: null, waveHsM: 1.6, visibilityKm: 8 },
    ],
  },
  forecast: { issuedAt: T(18, '05:15'), model: 'guardians-transport-v1 ensemble (demo)', movementTowardDeg: 70, leadingEdgeSectorId: 'O-2', interceptionSectorIds: ['C-1'], confidence: 'MEDIUM', horizons: [{ horizonH: 6, sectorId: 'O-2', uncertaintyKm: 3.0, confidence: 'MEDIUM' }, { horizonH: 12, sectorId: 'C-1', uncertaintyKm: 5.5, confidence: 'MEDIUM' }, { horizonH: 24, sectorId: 'C-2', uncertaintyKm: 9.0, confidence: 'LOW-MEDIUM' }] },
  impactAssessment: { assessedAt: T(18, '05:20'), source: 'GUARDIANS impact screening (demo)', resources: [R02('POSSIBLE', T(18, '22:00'), T(19, '06:00')), R03('POSSIBLE', T(19, '02:00'), T(19, '10:00'))] },
  protectionPriorities: null,
  vesselAssessment: { aisAvailable: true, candidates: [{ id: 'Vessel-17', supportScore: 84 }, { id: 'Vessel-04', supportScore: 64 }] },
  planningSectors: SECTORS,
  availableAssets: assets('P1'),
  facilities: FACILITIES,
  personnel: [{ poolId: 'DRONE', role: 'Drone pilots', available: 4 }, { poolId: 'SAMPLING', role: 'Sampling specialists', available: 2 }, { poolId: 'SHORE', role: 'Shoreline assessment staff', available: 4 }],
  communications: COMMS,
  constraints: [
    { constraintId: 'IC-01', type: 'LOGISTICS', description: 'Harbour departures from H-1 require port clearance per sailing (placeholder).', from: null, to: null, appliesTo: ['PROTECTION', 'SAMPLING', 'SURVEILLANCE_VESSEL'] },
    { constraintId: 'IC-02', type: 'ACCESS', description: 'Mangrove creek access by shallow-draft craft only near higher water (placeholder).', from: null, to: null, appliesTo: ['SHORELINE'] },
  ],
  safetyHazards: [HZ_SEA, HZ_HEAT, HZ_AIR],
  informationGaps: [{ gapId: 'G-IN-01', description: 'No optical or aerial corroboration of the SAR detection.', operationalImpact: 'Extent and leading edge are unverified; protection timing relies on remote detection.', actionToResolve: 'Aerial reconnaissance of O-1 / O-2 (A-SURV-AIR).', owner: 'Air Operations', priority: 'P1' }],
  currentAlerts: [],
  assumptions: [{ assumptionId: 'ASM-IN-01', statement: 'Intake operator can reduce intake flow at short notice if advised.', basis: 'Liaison — not yet confirmed with operator' }],
  progress: [],
  directedAssignments: [],
};

export const mockIap002: IapIncidentState = {
  ...mockIap001,
  operationalPeriod: { ...mockIap001.operationalPeriod, iapNumber: 2, createdAt: T(18, '11:30'), periodStart: T(18, '12:00'), periodEnd: T(18, '18:00'), sitrepRef: 'SIH-DEMO-2026-014-SR005 (demo)' },
  currentSituation: { ...mockIap001.currentSituation, assessedAt: T(18, '11:15'), slickStatus: 'CONFIRMED', verification: 'FIELD_VERIFIED' },
  slick: { ...mockIap001.slick!, observedAt: T(18, '07:40'), source: 'Aerial reconnaissance AC-01 (demo)', sectorId: 'O-2', locationText: '≈29 km west of the Mumbai coastline', areaKm2: 23.0, fragmentCount: 5, detectionConfidence: 'HIGH', trend: 'GROWING' },
  environment: {
    validAt: T(18, '11:00'), source: 'Operational met-ocean products (demo)', windSpeedMs: 7.2, windFromDeg: 250, currentSpeedMs: 0.4, currentTowardDeg: 72, waveHsM: 1.7, visibilityKm: 8, dataQuality: 'MEDIUM',
    outlook: [
      { from: T(18, '12:00'), to: T(18, '15:00'), windSpeedMs: 8, windFromDeg: 250, waveHsM: 1.7, visibilityKm: 8 },
      { from: T(18, '15:00'), to: T(18, '18:00'), windSpeedMs: 11, windFromDeg: 255, waveHsM: 2.2, visibilityKm: 6 },
    ],
  },
  forecast: { ...mockIap001.forecast!, issuedAt: T(18, '11:20'), leadingEdgeSectorId: 'C-1', horizons: [{ horizonH: 6, sectorId: 'C-1', uncertaintyKm: 3.2, confidence: 'MEDIUM' }, { horizonH: 12, sectorId: 'C-2', uncertaintyKm: 5.8, confidence: 'MEDIUM' }, { horizonH: 24, sectorId: 'M-2', uncertaintyKm: 9.5, confidence: 'LOW-MEDIUM' }] },
  impactAssessment: { assessedAt: T(18, '11:20'), source: 'GUARDIANS impact screening (demo)', resources: [R02('POSSIBLE', T(18, '19:00'), T(19, '03:00')), R01('POSSIBLE', T(19, '04:00'), T(19, '10:00'), 'LOW-MEDIUM'), R03('POSSIBLE', T(19, '01:00'), T(19, '09:00'))] },
  availableAssets: assets('P2'),
  safetyHazards: [HZ_SEA, HZ_HEAT, HZ_AIR],
  informationGaps: [],
  currentAlerts: [{ alertId: 'ALR-IN-INTAKE', severity: 'NOTICE', text: 'Intake operator has increased seawater-intake monitoring (placeholder report).' }],
  progress: [
    { refId: 'OBJ-DELINEATE', kind: 'OBJECTIVE', status: 'COMPLETED', reportedAt: T(18, '07:55'), note: 'aerial reconnaissance delineated boundary and leading edge' },
    { refId: 'OBJ-INFORMATION', kind: 'OBJECTIVE', status: 'COMPLETED', reportedAt: T(18, '09:10'), note: 'wind observations restored' },
    { refId: 'A-SAFE-BRIEF', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '06:30'), note: 'all field units briefed' },
    { refId: 'A-SURV-AIR', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '07:55'), note: 'boundary and leading edge reported' },
    { refId: 'A-SURV-DRN-R02', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '08:30'), note: 'no oil observed in C-2' },
    { refId: 'A-STAGE-R02', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '10:50'), note: 'deflection boom staged at C-2, deployment-ready' },
    { refId: 'A-SENSOR-R02', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '07:45'), note: 'sensor PS-01 installed and reporting' },
    { refId: 'A-NOTIFY-R02', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '06:30'), note: 'operator acknowledged advisory' },
    { refId: 'A-NOTIFY-R03', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '07:00'), note: 'cooperative acknowledged advisory' },
    { refId: 'A-SMP-OFFSHORE', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '11:05'), note: 'S-01 to S-03 collected; custody to laboratory liaison' },
    { refId: 'A-INFO-WIND', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '09:10'), note: 'met service feed restored' },
    { refId: 'A-EVID', kind: 'ASSIGNMENT', status: 'COMPLETED', reportedAt: T(18, '09:00'), note: 'imagery archived' },
  ],
};
