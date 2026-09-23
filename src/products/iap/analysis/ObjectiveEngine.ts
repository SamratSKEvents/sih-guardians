/**
 * Objectives and protection priorities. Every objective comes from an explicit rule over the input state; its
 * priority comes from named drivers (never a hidden score). Missing inputs produce information gaps and constraints.
 *
 * Priority rules for threatened resources (P1 IMMEDIATE · P2 HIGH · P3 ROUTINE):
 *   P1  exposure CONFIRMED
 *   P1  exposure LIKELY and sensitivity CRITICAL / VERY HIGH
 *   P1  sensitivity CRITICAL and the protection lead time must start within this operational period
 *   P2  sensitivity CRITICAL / VERY HIGH / HIGH and window opens within the planning look-ahead (or window unknown)
 *   P3  any other POSSIBLE / LIKELY exposure within the look-ahead
 *   MONITOR  exposure UNLIKELY, or window beyond the look-ahead (no objective generated)
 */
import type { Objective, ObjectiveCategory, Priority, ProtectionPriorityRow, Sensitivity } from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { addMin, compass, hoursBetween, joinAnd, ms, utc } from '../utils/format';
import type { PlanningContext } from './PlanningContext';

const SENS_ORDER: Sensitivity[] = ['CRITICAL', 'VERY HIGH', 'HIGH', 'MODERATE', 'LOW'];
const P_ORDER = { P1: 0, P2: 1, P3: 2, MONITOR: 3 } as const;
const CATEGORY_ORDER: ObjectiveCategory[] = ['SAFETY', 'PROTECT', 'DELINEATE', 'SURVEIL', 'CONTAIN', 'CHARACTERISE', 'SAMPLE', 'SHORELINE', 'INFORMATION', 'EVIDENCE'];
export const highest = (ps: Priority[]): Priority => (ps.includes('P1') ? 'P1' : ps.includes('P2') ? 'P2' : 'P3');

export function rankProtection(ctx: PlanningContext): ProtectionPriorityRow[] {
  const s = ctx.s, ia = s.impactAssessment;
  if (!ia) return [];
  const periodH = hoursBetween(ctx.start, ctx.end);
  const rows = ia.resources.map((r) => {
    const hoursTo = r.exposureWindow ? hoursBetween(ctx.start, r.exposureWindow.start) : null;
    const lead = r.protection?.leadTimeH ?? null;
    const slack = hoursTo !== null && lead !== null ? hoursTo - lead : null;
    const drivers: string[] = [];
    const high3 = r.sensitivity === 'CRITICAL' || r.sensitivity === 'VERY HIGH' || r.sensitivity === 'HIGH';
    const inHorizon = hoursTo === null || hoursTo <= IAP_CONFIG.priority.lookaheadH;
    let priority: ProtectionPriorityRow['priority'];

    drivers.push(`${r.sensitivity} sensitivity${r.type === 'CRITICAL INFRASTRUCTURE' ? ' — critical infrastructure' : ''}`);
    drivers.push(`Exposure ${r.exposure} (${r.confidence} confidence)`);
    if (hoursTo === null) drivers.push('Exposure window NOT AVAILABLE — held within planning horizon');
    else drivers.push(hoursTo <= 0 ? 'Exposure window already open' : `Window opens +${Math.round(hoursTo)} h after period start`);
    if (slack !== null && lead !== null) drivers.push(`Protection lead time ${lead} h${slack <= periodH ? ' — preparation must start this operational period' : ''}`);

    if (r.exposure === 'UNLIKELY') priority = 'MONITOR';
    else if (r.exposure === 'CONFIRMED') priority = 'P1';
    else if (r.exposure === 'LIKELY' && (r.sensitivity === 'CRITICAL' || r.sensitivity === 'VERY HIGH')) priority = 'P1';
    else if (r.sensitivity === 'CRITICAL' && slack !== null && slack <= periodH) priority = 'P1';
    else if (high3 && inHorizon) priority = 'P2';
    else if (inHorizon) priority = 'P3';
    else priority = 'MONITOR';
    if (priority === 'MONITOR' && r.exposure !== 'UNLIKELY') drivers.push(`Window beyond ${IAP_CONFIG.priority.lookaheadH} h planning look-ahead`);

    const decideBy = r.exposureWindow && lead !== null ? addMin(r.exposureWindow.start, -lead * 60) : null;
    const limitations: string[] = [];
    if (!r.protection) limitations.push('No protection method defined');
    else {
      if (r.protection.boomRequiredM === null) limitations.push('Boom requirement NOT AVAILABLE');
      if (lead === null) limitations.push('Protection lead time NOT AVAILABLE — decision time cannot be computed');
    }
    if (!r.exposureWindow) limitations.push('Exposure window NOT AVAILABLE');
    if (decideBy && ms(decideBy) < ms(ctx.start)) limitations.push('Decision time preceded this operational period');

    const pp = s.protectionPriorities?.find((p) => p.resourceId === r.resourceId);
    const derivedFrom = [ctx.resourcePath(r, 'sensitivity'), ctx.resourcePath(r, 'exposure'), ctx.resourcePath(r, 'exposureWindow'), ctx.resourcePath(r, 'protection')];
    if (pp) derivedFrom.push(`protectionPriorities[${s.protectionPriorities!.indexOf(pp)}]`);
    else derivedFrom.push('rule:PROTECTION-PRIORITY');

    return {
      r, slack, hoursTo, externalRank: pp?.rank ?? null,
      row: {
        rank: 0, resourceId: r.resourceId, name: r.name, sectorId: r.sectorId, type: r.type, sensitivity: r.sensitivity, exposure: r.exposure, exposureWindow: r.exposureWindow,
        hoursToExposure: hoursTo, confidence: r.confidence, priority, drivers,
        protectionObjective: '', objectiveId: priority === 'MONITOR' ? null : `OBJ-PROTECT-${r.resourceId.replace('-', '')}`,
        assignmentIds: [], decideBy, limitations, derivedFrom,
      } satisfies ProtectionPriorityRow,
    };
  });

  rows.sort((a, b) =>
    P_ORDER[a.row.priority] - P_ORDER[b.row.priority] ||
    (a.externalRank ?? 1e9) - (b.externalRank ?? 1e9) ||
    (a.slack ?? 1e9) - (b.slack ?? 1e9) ||
    (a.hoursTo ?? 1e9) - (b.hoursTo ?? 1e9) ||
    SENS_ORDER.indexOf(a.r.sensitivity) - SENS_ORDER.indexOf(b.r.sensitivity) ||
    a.r.resourceId.localeCompare(b.r.resourceId),
  );
  return rows.map(({ row }, i) => ({ ...row, rank: i + 1 }));
}

export function deriveObjectives(ctx: PlanningContext, protection: ProtectionPriorityRow[]): Objective[] {
  const s = ctx.s, sit = s.currentSituation, fc = s.forecast, env = s.environment, sl = s.slick;
  const prev = new Set(s.previousIap?.snapshot.objectives.map((o) => o.id) ?? []);
  const out: Omit<Objective, 'rank' | 'status' | 'assignmentIds'>[] = [];
  const planned = protection.filter((p) => p.priority !== 'MONITOR');
  const anyP1 = planned.some((p) => p.priority === 'P1');
  const resource = (id: string) => s.impactAssessment!.resources.find((r) => r.resourceId === id)!;

  /* ---- derived information gaps / constraints from missing inputs */
  if (!s.impactAssessment) {
    ctx.addGap({ gapId: 'G-IMPACT', description: 'Impact assessment NOT AVAILABLE.', operationalImpact: 'Protection priorities cannot be derived; no protection objectives are generated.', actionToResolve: 'Obtain resources-at-risk assessment for the forecast envelope.', owner: 'Situation Unit', priority: 'P1', derivedFrom: ['impactAssessment (null)'] });
    ctx.addConstraint({ constraintId: 'C-IMPACT', type: 'DATA', description: 'No impact assessment — protection planning cannot be prioritized.', from: null, to: null, derivedFrom: ['impactAssessment (null)'] });
  }
  if (!fc) {
    ctx.addGap({ gapId: 'G-FORECAST', description: 'Drift forecast NOT AVAILABLE.', operationalImpact: 'Containment placement cannot be prioritized from forecast guidance; exposure windows cannot be updated.', actionToResolve: 'Request updated drift forecast from the forecasting service.', owner: 'Situation Unit', priority: 'P1', derivedFrom: ['forecast (null)'] });
    ctx.addConstraint({ constraintId: 'C-FORECAST', type: 'DATA', description: 'Forecast NOT AVAILABLE — containment placement cannot be prioritized from forecast guidance.', from: null, to: null, derivedFrom: ['forecast (null)'] });
  } else if (fc.horizons.some((h) => h.confidence === 'LOW' || h.confidence === 'LOW-MEDIUM')) {
    const hz = fc.horizons.filter((h) => h.confidence === 'LOW' || h.confidence === 'LOW-MEDIUM').map((h) => `+${h.horizonH} h`);
    ctx.addGap({ gapId: 'G-FC-UNCERTAINTY', description: `Forecast uncertainty high at ${joinAnd(hz)}.`, operationalImpact: 'Exposure windows beyond the operational period may move; staged protection may need relocation.', actionToResolve: 'Verify leading-edge position by surveillance and request forecast update.', owner: 'Situation Unit', priority: 'P2', derivedFrom: fc.horizons.map((h, i) => `forecast.horizons[${i}].confidence`).filter((_, i) => fc.horizons[i].confidence.startsWith('LOW')) });
  }
  if (!env) {
    ctx.addGap({ gapId: 'G-ENVIRONMENT', description: 'Environmental conditions and weather outlook NOT AVAILABLE.', operationalImpact: 'Asset operating limits cannot be checked against forecast weather.', actionToResolve: 'Obtain marine weather outlook for the operational period.', owner: 'Situation Unit', priority: 'P1', derivedFrom: ['environment (null)'] });
  } else {
    if (env.windSpeedMs === null) ctx.addGap({ gapId: 'G-WIND', description: 'Wind observations NOT AVAILABLE.', operationalImpact: 'Drone and small-craft wind limits cannot be confirmed on scene; drift forecast confidence reduced.', actionToResolve: 'Restore wind observations (met service / vessel reports).', owner: 'Situation Unit', priority: 'P2', derivedFrom: ['environment.windSpeedMs (null)'] });
    if (env.waveHsM === null) ctx.addGap({ gapId: 'G-WAVES', description: 'Wave observations NOT AVAILABLE.', operationalImpact: 'Small-craft sea-state limits cannot be confirmed.', actionToResolve: 'Restore wave observations.', owner: 'Situation Unit', priority: 'P2', derivedFrom: ['environment.waveHsM (null)'] });
  }
  if (!sit.daylight) ctx.addGap({ gapId: 'G-DAYLIGHT', description: 'Daylight times NOT AVAILABLE.', operationalImpact: 'Daylight-only restrictions of aircraft and drones cannot be verified.', actionToResolve: 'Obtain sunrise / sunset for the operating area.', owner: 'Situation Unit', priority: 'P3', derivedFrom: ['currentSituation.daylight (null)'] });
  if (!s.communications) ctx.addGap({ gapId: 'G-COMMS', description: 'Communications plan NOT SUPPLIED.', operationalImpact: 'Channel assignments and reporting routes are undefined.', actionToResolve: 'Communications Unit to issue channel plan before deployment.', owner: 'Communications Unit (placeholder)', priority: 'P1', derivedFrom: ['communications (null)'] });
  if (sl && sl.areaKm2 === null) ctx.addGap({ gapId: 'G-EXTENT', description: 'Slick extent NOT AVAILABLE.', operationalImpact: 'Boom and recovery requirements cannot be sized.', actionToResolve: 'Delineate slick by aerial surveillance.', owner: 'Air Operations', priority: 'P1', derivedFrom: ['slick.areaKm2 (null)'] });
  if (sl) ctx.addGap({ gapId: 'G-THICKNESS', description: 'Slick thickness / volume NOT AVAILABLE.', operationalImpact: 'Recovery capacity requirement cannot be estimated.', actionToResolve: 'Record appearance codes during aerial surveillance (volume estimation requires specialist review).', owner: 'Air Operations', priority: 'P3', derivedFrom: ['slick (no thickness field supplied)'] });
  for (const p of s.personnel) if (p.available === null) ctx.addGap({ gapId: `G-PERS-${p.poolId}`, description: `${p.role} availability NOT AVAILABLE.`, operationalImpact: 'Concurrent team tasking cannot be checked against staffing.', actionToResolve: 'Confirm staffing with the Resources Unit.', owner: 'Resources Unit', priority: 'P2', derivedFrom: [`personnel[${s.personnel.indexOf(p)}].available (null)`] });
  for (const a of s.availableAssets) if (a.availability.status !== 'UNAVAILABLE' && a.availability.from === null) ctx.addGap({ gapId: `G-AVAIL-${a.assetId}`, description: `${a.name}: availability NOT AVAILABLE.`, operationalImpact: 'Asset is not scheduled until availability is confirmed.', actionToResolve: 'Confirm availability with asset owner.', owner: 'Resources Unit', priority: 'P2', derivedFrom: [ctx.assetPath(a.assetId, 'availability.from')] });

  /* ---- SAFETY */
  const hz = s.safetyHazards;
  if (!hz) {
    ctx.addGap({ gapId: 'G-SAFETY', description: 'Site safety assessment NOT AVAILABLE.', operationalImpact: 'Field activities cannot be matched to hazards, mitigations or stop-work criteria.', actionToResolve: 'Safety Officer to complete hazard assessment before deployment.', owner: 'Safety Officer', priority: 'P1', derivedFrom: ['safetyHazards (null)'] });
  }
  out.push({
    objectiveId: 'OBJ-SAFETY', priority: 'P1', category: 'SAFETY',
    statement: 'Maintain the safety of response personnel and the public throughout the operational period.',
    reason: hz ? `${hz.length} hazard(s) identified (${hz.filter((h) => h.severity === 'HIGH').length} HIGH) affecting planned field activities.` : 'No site-safety assessment has been supplied; hazards must be assessed before field deployment.',
    priorityDrivers: ['Human safety — always P1'],
    sourceEvidence: hz ? hz.map((h) => `${h.hazardId}: ${h.type} (${h.severity})`) : ['Safety hazards: NOT AVAILABLE'],
    successCriteria: ['All field units briefed on hazards and stop-work criteria before deployment', 'No field activity continued beyond a stop-work criterion', 'All units accounted for at each scheduled status report'],
    constraints: [],
    derivedFrom: [hz ? 'safetyHazards' : 'safetyHazards (null)', 'rule:SAFETY-ALWAYS'],
  });

  /* ---- PROTECT */
  for (const p of planned) {
    const r = resource(p.resourceId);
    const statement =
      r.exposure === 'CONFIRMED' ? `Reduce ongoing exposure of ${r.name} and prepare authorised protective response.`
      : !r.protection ? `Monitor ${r.name} and prepare protective measures (no protection method defined).`
      : `Prepare protection of ${r.name} before the earliest estimated exposure window${r.exposureWindow ? ` (${utc(r.exposureWindow.start)})` : ' (window NOT AVAILABLE)'}.`;
    p.protectionObjective = statement;
    if (!r.exposureWindow) ctx.addGap({ gapId: `G-WINDOW-${r.resourceId}`, description: `${r.name}: exposure window NOT AVAILABLE.`, operationalImpact: 'Protection timing and decision time cannot be computed.', actionToResolve: 'Request exposure-window estimate from impact assessment.', owner: 'Situation Unit', priority: p.priority as Priority, derivedFrom: [ctx.resourcePath(r, 'exposureWindow (null)')] });
    if (!r.protection) ctx.addGap({ gapId: `G-METHOD-${r.resourceId}`, description: `${r.name}: no protection method defined.`, operationalImpact: 'No protection staging can be planned.', actionToResolve: 'Environmental Unit to specify protection strategy.', owner: 'Environmental Unit', priority: p.priority as Priority, derivedFrom: [ctx.resourcePath(r, 'protection (null)')] });
    else if (r.protection.boomRequiredM === null) ctx.addGap({ gapId: `G-BOOMREQ-${r.resourceId}`, description: `${r.name}: boom requirement NOT AVAILABLE.`, operationalImpact: 'Boom allocation cannot be checked for sufficiency.', actionToResolve: 'Environmental Unit to size protection boom.', owner: 'Environmental Unit', priority: p.priority as Priority, derivedFrom: [ctx.resourcePath(r, 'protection.boomRequiredM (null)')] });
    out.push({
      objectiveId: p.objectiveId!, priority: p.priority as Priority, category: 'PROTECT', statement,
      reason: `${r.sensitivity} sensitivity ${r.type.toLowerCase()}; exposure ${r.exposure} (${r.confidence} confidence)${p.decideBy ? `; deployment decision time ${utc(p.decideBy)}` : ''}.`,
      priorityDrivers: p.drivers,
      sourceEvidence: [
        `Impact assessment ${utc(s.impactAssessment!.assessedAt)}: exposure ${r.exposure}`,
        `Estimated exposure window: ${r.exposureWindow ? `${utc(r.exposureWindow.start)} – ${utc(r.exposureWindow.end)}` : 'NOT AVAILABLE'} (MODELLED)`,
        ...(r.protection ? [`Protection method (planning basis): ${r.protection.method}`] : []),
      ],
      successCriteria: [
        ...(r.protection ? [p.decideBy ? `Protection package deployment-ready before decision time ${utc(p.decideBy)}` : 'Protection package deployment-ready during this operational period'] : ['Protection strategy defined by Environmental Unit']),
        ...(r.stakeholder ? [`${r.stakeholder} advised of the modelled exposure window`] : []),
        `Escalation decision taken on trigger DP-PROTECT-${r.resourceId}`,
      ],
      constraints: [...p.limitations],
      derivedFrom: p.derivedFrom,
    });
  }

  /* ---- DELINEATE */
  if (!sl) {
    ctx.addGap({ gapId: 'G-SLICK', description: 'No current slick observation is available.', operationalImpact: 'Surveillance search area is based on the last reported position only.', actionToResolve: 'Relocate slick by aerial / vessel surveillance and request satellite revisit.', owner: 'Air Operations', priority: 'P1', derivedFrom: ['slick (null)'] });
    out.push({ objectiveId: 'OBJ-DELINEATE', priority: 'P1', category: 'DELINEATE', statement: 'Relocate the slick: no current slick observation is available.', reason: 'Slick summary NOT AVAILABLE.', priorityDrivers: ['Operational dependency — all protection timing depends on slick position'], sourceEvidence: ['Slick: NOT AVAILABLE'], successCriteria: ['Slick position re-established and reported to Situation Unit'], constraints: [], derivedFrom: ['slick (null)'] });
  } else if (sit.verification === 'SATELLITE_ONLY') {
    out.push({
      objectiveId: 'OBJ-DELINEATE', priority: anyP1 ? 'P1' : 'P2', category: 'DELINEATE',
      statement: 'Verify the position, extent and leading edge of the suspected slick by aerial or field observation.',
      reason: `Slick detected by ${sl.source} only (${utc(sl.observedAt)}); extent not verified in the field.`,
      priorityDrivers: [anyP1 ? 'Operational dependency — P1 protection decisions require verified leading-edge position' : 'Operational dependency — protection and containment planning rely on unverified remote detection'],
      sourceEvidence: [`${sl.source} ${utc(sl.observedAt)} — ${sit.slickStatus} (detection confidence ${sl.detectionConfidence})`],
      successCriteria: ['Slick boundary and leading-edge position reported to Situation Unit', 'Fragmentation and sheen extent recorded with time-stamped imagery'],
      constraints: [],
      derivedFrom: ['currentSituation.verification', 'slick.source', 'slick.observedAt', 'slick.detectionConfidence'],
    });
  }

  /* ---- SURVEIL */
  out.push({
    objectiveId: 'OBJ-SURVEIL', priority: anyP1 || sl?.trend === 'GROWING' ? 'P1' : 'P2', category: 'SURVEIL',
    statement: fc?.leadingEdgeSectorId && fc.movementTowardDeg !== null
      ? `Maintain surveillance of the ${compass(fc.movementTowardDeg)} forecast corridor (${ctx.sectorName(fc.leadingEdgeSectorId)}) and the approaches to priority resources.`
      : fc ? 'Maintain surveillance of the slick and the approaches to priority resources (forecast leading-edge sector NOT AVAILABLE).'
      : 'Maintain surveillance around the last observed slick position; forecast guidance is NOT AVAILABLE.',
    reason: fc ? `Forecast issued ${utc(fc.issuedAt)} (${fc.confidence} confidence); ${planned.length} resource(s) within planning horizon.` : 'Without forecast guidance, movement must be established by observation.',
    priorityDrivers: [anyP1 ? 'Supports P1 protection decisions' : sl?.trend === 'GROWING' ? 'Slick trend GROWING' : 'Situational awareness for HIGH-priority planning'],
    sourceEvidence: [fc ? `Forecast movement toward ${fc.movementTowardDeg === null ? 'NOT AVAILABLE' : compass(fc.movementTowardDeg)} — MODELLED` : 'Forecast: NOT AVAILABLE', ...(sl?.trend ? [`Slick trend ${sl.trend}`] : [])],
    successCriteria: ['Leading-edge position updated after each surveillance sortie', 'Approach sectors of P1 resources observed before their decision times'],
    constraints: [],
    derivedFrom: fc ? ['forecast.leadingEdgeSectorId', 'forecast.movementTowardDeg', ...(sl ? ['slick.trend'] : [])] : ['forecast (null)', ...(sl ? ['slick.sectorId'] : ['slick (null)'])],
  });

  /* ---- CONTAIN */
  if (sl) {
    const sector = fc?.interceptionSectorIds[0] ?? null;
    out.push({
      objectiveId: 'OBJ-CONTAIN', priority: 'P2', category: 'CONTAIN',
      statement: sector
        ? `Prepare containment and recovery capability for interception sector ${ctx.sectorName(sector)} (planning basis — pending field verification).`
        : 'Hold containment and recovery capability in readiness at base; interception placement cannot be prioritized from forecast guidance.',
      reason: sector ? `Forecast supports interception in ${sector} (${fc!.confidence} confidence, MODELLED).` : fc ? 'Forecast does not identify an interception sector.' : 'Forecast NOT AVAILABLE.',
      priorityDrivers: ['Readiness objective — deployment only on decision trigger'],
      sourceEvidence: sector ? [`Forecast interception sectors: ${fc!.interceptionSectorIds.join(', ')}`] : ['Interception sector: NOT AVAILABLE'],
      successCriteria: ['Containment / recovery package ready to deploy within declared readiness time', 'Deployment only on trigger DP-CONTAIN and command authorization'],
      constraints: sector ? [] : ['Containment placement cannot be prioritized from forecast guidance'],
      derivedFrom: [fc ? 'forecast.interceptionSectorIds' : 'forecast (null)', 'slick.sectorId', 'availableAssets[*].capabilities:CONTAINMENT'],
    });
  }

  /* ---- CHARACTERISE */
  if (sl && sit.oilType === null) {
    const collected = s.progress.some((x) => x.refId === 'A-SMP-OFFSHORE' && x.status === 'COMPLETED');
    ctx.addGap({ gapId: 'G-OIL', description: 'Petroleum composition / oil type not confirmed.', operationalImpact: 'PPE level, persistence and response tactics are planned on a precautionary basis.', actionToResolve: collected ? 'Track laboratory identification of collected samples.' : 'Collect slick samples under chain of custody for laboratory identification.', owner: 'Environmental Unit', priority: 'P2', derivedFrom: ['currentSituation.oilType (null)'] });
    out.push({
      objectiveId: 'OBJ-CHARACTERISE', priority: 'P2', category: 'CHARACTERISE',
      statement: collected ? 'Obtain laboratory identification of the samples already collected from the slick.' : 'Collect samples from the suspected slick to support oil identification (laboratory identification pending).',
      reason: 'Oil type NOT AVAILABLE; identification affects PPE, persistence and tactics.',
      priorityDrivers: ['Operational dependency — PPE and tactic selection'],
      sourceEvidence: ['Oil type: NOT AVAILABLE', ...(collected ? ['Offshore samples reported collected (progress report)'] : [])],
      successCriteria: collected ? ['Laboratory result or expected result time reported to command'] : ['Slick-centre, leading-edge and background samples collected with complete chain-of-custody records'],
      constraints: [],
      derivedFrom: ['currentSituation.oilType (null)', ...(collected ? ['progress:A-SMP-OFFSHORE'] : ['slick.sectorId'])],
    });
  }

  /* ---- SAMPLE (at threatened resources) */
  const sampleRes = planned.filter((p) => p.priority !== 'P3');
  if (sl && sampleRes.length) {
    out.push({
      objectiveId: 'OBJ-SAMPLE', priority: 'P2', category: 'SAMPLE',
      statement: `Establish reference sampling at threatened resources (${joinAnd(sampleRes.map((p) => p.name))}) before any possible exposure.`,
      reason: 'Pre-exposure reference samples support later impact verification.',
      priorityDrivers: ['Supporting objective — capped at P2; individual sample priority follows the resource'],
      sourceEvidence: sampleRes.map((p) => `${p.name}: exposure ${p.exposure}`),
      successCriteria: ['Reference samples collected at each listed resource with chain-of-custody records'],
      constraints: [],
      derivedFrom: sampleRes.map((p) => ctx.resourcePath(resource(p.resourceId), 'exposure')),
    });
  }

  /* ---- SHORELINE */
  const shoreRes = planned.filter((p) => resource(p.resourceId).shoreline && p.priority !== 'P3');
  if (sit.shorelineContact === 'CONFIRMED' || shoreRes.length) {
    const confirmed = sit.shorelineContact === 'CONFIRMED';
    out.push({
      objectiveId: 'OBJ-SHORELINE', priority: confirmed ? 'P1' : highest(shoreRes.map((p) => p.priority as Priority)), category: 'SHORELINE',
      statement: confirmed ? 'Assess confirmed shoreline contact and prepare authorised shoreline response.' : `Prepare shoreline assessment for ${joinAnd(shoreRes.map((p) => p.name))}; no shoreline contact is confirmed.`,
      reason: confirmed ? 'Shoreline contact CONFIRMED.' : `Shoreline contact ${sit.shorelineContact}; shoreline resources within planning horizon.`,
      priorityDrivers: [confirmed ? 'Exposure CONFIRMED' : 'Follows shoreline resource priority'],
      sourceEvidence: [`Shoreline contact: ${sit.shorelineContact}`, ...shoreRes.map((p) => `${p.name}: exposure ${p.exposure}`)],
      successCriteria: confirmed ? ['Oiled segments delineated and reported'] : ['Pre-impact baseline condition, access points and staging areas recorded for each listed shoreline'],
      constraints: [],
      derivedFrom: ['currentSituation.shorelineContact', ...shoreRes.map((p) => ctx.resourcePath(resource(p.resourceId), 'shoreline'))],
    });
  }

  /* ---- INFORMATION */
  const missing: [string, string][] = [];
  if (!fc) missing.push(['drift forecast', 'forecast (null)']);
  if (!env) missing.push(['environmental conditions', 'environment (null)']);
  else {
    if (env.windSpeedMs === null) missing.push(['wind observations', 'environment.windSpeedMs (null)']);
    if (env.waveHsM === null) missing.push(['wave observations', 'environment.waveHsM (null)']);
  }
  if (missing.length) {
    out.push({
      objectiveId: 'OBJ-INFORMATION', priority: !fc || !env ? 'P1' : 'P2', category: 'INFORMATION',
      statement: `Restore missing planning inputs: ${joinAnd(missing.map((m) => m[0]))}.`,
      reason: 'Missing inputs limit containment placement and operating-limit checks.',
      priorityDrivers: [!fc || !env ? 'Operational dependency — forecast / weather drive placement and safety limits' : 'Reduces uncertainty of operating-limit checks'],
      sourceEvidence: missing.map((m) => `${m[0]}: NOT AVAILABLE`),
      successCriteria: missing.map((m) => `${m[0][0].toUpperCase()}${m[0].slice(1)} available to Situation Unit`),
      constraints: [],
      derivedFrom: missing.map((m) => m[1]),
    });
  }

  /* ---- EVIDENCE */
  if (s.vesselAssessment?.candidates.length) {
    out.push({
      objectiveId: 'OBJ-EVIDENCE', priority: 'P3', category: 'EVIDENCE',
      statement: 'Preserve time-stamped observations that may support the separate source investigation (candidate analytical support only; no attribution implied).',
      reason: `${s.vesselAssessment.candidates.length} candidate vessel(s) under analytical assessment.`,
      priorityDrivers: ['Does not compete with protection or safety tasking'],
      sourceEvidence: [`Candidates: ${s.vesselAssessment.candidates.map((c) => c.id).join(', ')} (analytical support)`],
      successCriteria: ['Surveillance imagery and observed vessel positions archived with time and position metadata'],
      constraints: [],
      derivedFrom: ['vesselAssessment.candidates'],
    });
  }

  /* ---- rank */
  const protRank = new Map(protection.map((p) => [p.objectiveId, p.rank]));
  out.sort((a, b) =>
    P_ORDER[a.priority] - P_ORDER[b.priority] ||
    CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
    (protRank.get(a.objectiveId) ?? 0) - (protRank.get(b.objectiveId) ?? 0),
  );
  return out.map((o, i) => ({ ...o, rank: i + 1, status: prev.has(o.objectiveId) ? 'CONTINUING' : 'ACTIVE', assignmentIds: [] }));
}

