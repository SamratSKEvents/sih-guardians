/**
 * Decision points (IF / THEN triggers), contingencies and plan alerts. Thresholds are quoted only from asset data;
 * where a threshold is not supplied the trigger says so instead of inventing a number.
 */
import type { Assignment, AssetKind, Contingency, DecisionTrigger, PlanAlert, ProtectionPriorityRow, ResourceAllocationRow } from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { addMin, fmt, ms, utc } from '../utils/format';
import type { PlanningContext } from './PlanningContext';
import type { AssignmentPlan } from './AssignmentEngine';

const AUTH = (ctx: PlanningContext) => ctx.s.incident.commandAuthority;
const VESSELS: AssetKind[] = ['RESPONSE VESSEL', 'PATROL VESSEL'];

export function buildTriggers(ctx: PlanningContext, protection: ProtectionPriorityRow[], ap: AssignmentPlan): DecisionTrigger[] {
  const s = ctx.s, fc = s.forecast, A = ap.assignments;
  const ids = (pred: (a: Assignment) => boolean) => A.filter(pred).map((a) => a.assignmentId);
  const out: DecisionTrigger[] = [];

  for (const p of protection.filter((x) => x.objectiveId)) {
    const r = s.impactAssessment!.resources.find((x) => x.resourceId === p.resourceId)!;
    const rid = r.resourceId.replace('-', '');
    const prot = A.find((a) => a.assignmentId === `A-STAGE-${rid}` || a.assignmentId === `A-READY-${rid}`);
    if (!prot) continue;
    const verify = ids((a) => a.assignmentId === `A-SURV-DRN-${rid}` || a.assignmentId === `A-SENSOR-${rid}` || (a.activity.startsWith('SURVEILLANCE') && a.sectorId === r.sectorId));
    const passed = p.decideBy && ms(p.decideBy) < ms(ctx.start);
    out.push({
      triggerId: `DP-PROTECT-${r.resourceId}`,
      condition: r.exposure === 'POSSIBLE'
        ? `Forecast exposure of ${r.name} becomes LIKELY, or surveillance / sensor reports oil within ${ctx.sectorName(r.sectorId)}`
        : `Surveillance or sensor reports oil within or entering ${ctx.sectorName(r.sectorId)}`,
      thresholdSource: null,
      action: `Escalate protection of ${r.name} from staged readiness to deployment of ${r.protection!.method}`,
      requires: [verify.length ? `Field verification (${verify.join(', ')})` : 'Field verification', 'Incident command authorization'],
      decisionAuthority: AUTH(ctx), decideBy: p.decideBy, affectedAssignments: [prot.assignmentId, ...verify],
      status: passed ? 'DECISION TIME PASSED' : 'ARMED',
      derivedFrom: [ctx.resourcePath(r, 'exposure'), ctx.resourcePath(r, 'exposureWindow'), ctx.resourcePath(r, 'protection.leadTimeH'), 'rule:DP-PROTECT'],
    });
  }

  const limitTrigger = (id: string, acts: Assignment['activity'][], kinds: AssetKind[], field: 'maxWindMs' | 'maxWaveHsM', label: string, unit: (v: number) => string, action: string) => {
    const tasks = A.filter((a) => a.startTime && acts.includes(a.activity));
    const assets = [...new Set(tasks.flatMap((a) => a.assetIds))].map((x) => ctx.assets.get(x)!).filter((a) => a && kinds.includes(a.kind)).sort((a, b) => a.assetId.localeCompare(b.assetId));
    if (!assets.length) return;
    const known = assets.filter((a) => a.limits?.[field] != null), unknown = assets.filter((a) => a.limits?.[field] == null);
    out.push({
      triggerId: id,
      condition: known.length
        ? `Observed or forecast ${label} exceeds the supplied operating limit (${known.map((a) => `${a.assetId} ${unit(a.limits![field]!)}`).join('; ')})${unknown.length ? `; limit NOT SUPPLIED for ${unknown.map((a) => a.assetId).join(', ')}` : ''}`
        : `${label[0].toUpperCase()}${label.slice(1)} operating limit NOT SUPPLIED for ${unknown.map((a) => a.assetId).join(', ')} — suspension at the discretion of the on-scene supervisor`,
      thresholdSource: known.length ? known.map((a) => ctx.assetPath(a.assetId, `limits.${field}`)).join(', ') : null,
      action, requires: ['On-scene supervisor decision (immediate)', 'Report to Operations Section'], decisionAuthority: 'On-scene supervisor; reported to incident command',
      decideBy: null, affectedAssignments: tasks.filter((t) => t.assetIds.some((x) => assets.some((a) => a.assetId === x))).map((t) => t.assignmentId),
      status: known.length ? 'ARMED' : 'THRESHOLD NOT SUPPLIED',
      derivedFrom: [...assets.map((a) => ctx.assetPath(a.assetId, `limits.${field}`)), 'rule:DP-LIMITS'],
    });
  };
  limitTrigger('DP-AIR-WIND', ['SURVEILLANCE_AIR', 'SURVEILLANCE_DRONE'], ['AIRCRAFT', 'DRONE TEAM'], 'maxWindMs', 'wind', (v) => fmt.ms(v), 'Suspend affected flights and apply CT-SURV-ALT');
  limitTrigger('DP-SEA-STATE', ['PROTECTION', 'CONTAINMENT', 'SAMPLING', 'SURVEILLANCE_VESSEL'], VESSELS, 'maxWaveHsM', 'significant wave height', (v) => fmt.m(v), 'Suspend on-water work, secure staged boom and recover crews (CT-WEATHER)');

  const cont = A.find((a) => a.assignmentId === 'A-CONT-READY' && a.startTime);
  if (cont) {
    const surv = ids((a) => !!a.startTime && a.activity.startsWith('SURVEILLANCE'));
    out.push({
      triggerId: 'DP-CONTAIN', condition: `Surveillance confirms oil in or entering ${cont.sectorId ? ctx.sectorName(cont.sectorId) : 'a supportable interception sector'} and sea state is within containment vessel limits`,
      thresholdSource: null, action: 'Request authorization to transit and deploy the containment / recovery package',
      requires: [surv.length ? `Field verification (${surv.join(', ')})` : 'Field verification', 'Sea state within asset limits', 'Incident command authorization'],
      decisionAuthority: AUTH(ctx), decideBy: null, affectedAssignments: ['A-CONT-READY', ...surv], status: 'ARMED',
      derivedFrom: [fc ? 'forecast.interceptionSectorIds' : 'forecast (null)', 'rule:DP-CONTAIN'],
    });
  }

  if (s.currentSituation.shorelineContact !== 'CONFIRMED' && (ap.shoreline.length || protection.some((p) => p.objectiveId && s.impactAssessment!.resources.find((r) => r.resourceId === p.resourceId)!.shoreline)))
    out.push({
      triggerId: 'DP-SHORE', condition: 'Shoreline contact reported at any threatened shoreline', thresholdSource: null,
      action: 'Convert shoreline preparation to active shoreline assessment, advise stakeholders and issue SITREP',
      requires: ['Field verification by shore team', 'Incident command authorization'], decisionAuthority: AUTH(ctx), decideBy: null,
      affectedAssignments: ids((a) => a.activity === 'SHORELINE'), status: 'ARMED', derivedFrom: ['currentSituation.shorelineContact', 'rule:DP-SHORE'],
    });

  out.push(fc
    ? { triggerId: 'DP-FORECAST', condition: `Updated forecast moves the leading edge out of ${ctx.sectorName(fc.leadingEdgeSectorId)} or brings an exposure window earlier than a staged protection can meet`, thresholdSource: null, action: 'Reassess protection ranking and staged package locations (CT-FORECAST-SHIFT); issue IAP revision if priorities change', requires: ['Situation Unit assessment', 'Incident command authorization'], decisionAuthority: AUTH(ctx), decideBy: null, affectedAssignments: ids((a) => a.activity === 'PROTECTION' || a.activity === 'CONTAINMENT'), status: 'ARMED', derivedFrom: ['forecast.leadingEdgeSectorId', 'rule:DP-FORECAST'] }
    : { triggerId: 'DP-FORECAST', condition: 'Updated drift forecast received', thresholdSource: null, action: 'Re-plan containment placement and protection ranking; issue IAP revision', requires: ['Situation Unit assessment', 'Incident command authorization'], decisionAuthority: AUTH(ctx), decideBy: null, affectedAssignments: ids((a) => a.activity === 'CONTAINMENT' || a.activity === 'PROTECTION'), status: 'ARMED', derivedFrom: ['forecast (null)', 'rule:DP-FORECAST'] });

  if (ctx.constraints.some((c) => c.constraintId === 'C-BOOM')) {
    const at = addMin(ctx.start, IAP_CONFIG.boomEscalationAfterMin);
    out.push({
      triggerId: 'DP-BOOM', condition: `Additional boom not confirmed by ${utc(at)}`, thresholdSource: 'config:boomEscalationAfterMin',
      action: 'Request external / mutual-aid boom and confirm partial-protection plan for the lower-ranked resource (CT-BOOM)',
      requires: ['Logistics Section status', 'Incident command authorization'], decisionAuthority: AUTH(ctx), decideBy: at,
      affectedAssignments: ctx.constraints.find((c) => c.constraintId === 'C-BOOM')!.affectsAssignments, status: 'ARMED',
      derivedFrom: ['availableAssets[*].boomLengthM', 'rule:DP-BOOM'],
    });
  }
  if (s.currentSituation.oilType === null)
    out.push({ triggerId: 'DP-OIL-ID', condition: 'Laboratory identification of the product is received', thresholdSource: null, action: 'Safety Officer reviews PPE; Operations reviews recovery and protection tactics', requires: ['Laboratory report'], decisionAuthority: AUTH(ctx), decideBy: null, affectedAssignments: ids((a) => ['SAMPLING', 'PROTECTION', 'CONTAINMENT', 'SHORELINE'].includes(a.activity)), status: 'ARMED', derivedFrom: ['currentSituation.oilType (null)', 'rule:DP-OIL-ID'] });

  return out;
}

export function buildContingencies(ctx: PlanningContext, protection: ProtectionPriorityRow[], ap: AssignmentPlan, allocation: ResourceAllocationRow[]): Contingency[] {
  const s = ctx.s, A = ap.assignments, out: Contingency[] = [];
  const avail = (cap: string) => s.availableAssets.filter((a) => a.capabilities.includes(cap as any) && a.availability.status !== 'UNAVAILABLE').map((a) => a.assetId);

  if (ap.surveillance.length || ap.alternateSurveillance)
    out.push({
      contingencyId: 'CT-SURV-ALT', scenario: 'Surveillance cannot verify the slick (aircraft / drones unavailable, weather or darkness)', indicator: 'Primary sortie cancelled, or no leading-edge report by the planned time',
      actions: ['Task vessel observation of the leading edge', 'Request satellite SAR revisit (placeholder)', 'Request shore-based visual observation at priority resources'],
      alternateAssets: avail('SURVEILLANCE_VESSEL'),
      activation: ap.alternateSurveillance ? 'ACTIVATED' : 'STANDBY', activationReason: ap.alternateSurveillance?.reason ?? null,
      derivedFrom: ap.alternateSurveillance ? ap.alternateSurveillance.derivedFrom : ['availableAssets[*].capabilities:SURVEILLANCE_*', 'rule:CT-SURV-ALT'],
    });

  // Vessel loss: ACTIVATED for vessels tasked in the previous IAP that are now unavailable; otherwise STANDBY for the primary vessel.
  const prevUsed = new Set(s.previousIap?.snapshot.assignments.flatMap((a) => a.assetIds) ?? []);
  const lost = s.availableAssets.filter((a) => VESSELS.includes(a.kind) && a.availability.status === 'UNAVAILABLE' && prevUsed.has(a.assetId));
  const primary = A.filter((a) => a.startTime).sort((a, b) => a.priority.localeCompare(b.priority)).flatMap((a) => a.assetIds).map((id) => ctx.assets.get(id)!).find((a) => a && VESSELS.includes(a.kind));
  for (const v of lost.length ? lost : primary ? [primary] : []) {
    const subs = s.availableAssets.filter((a) => a !== v && VESSELS.includes(a.kind) && a.availability.status !== 'UNAVAILABLE' && a.capabilities.some((c) => v.capabilities.includes(c) && c !== 'TRANSPORT'));
    const activated = lost.includes(v);
    const missingCaps = v.capabilities.filter((c) => !subs.some((x) => x.capabilities.includes(c)));
    out.push({
      contingencyId: `CT-VESSEL-${v.assetId}`, scenario: `${v.name} becomes unavailable`, indicator: `${v.assetId} reports defect, delay or recall`,
      actions: [
        subs.length ? `Re-task ${subs.map((x) => x.assetId).join(' / ')} to the highest-priority task of ${v.assetId} (capability: ${v.capabilities.filter((c) => subs.some((x) => x.capabilities.includes(c))).join(', ')})` : `No substitute vessel with ${v.capabilities.join(' / ')} capability in inventory`,
        ...(missingCaps.length ? [`Request external support for ${missingCaps.join(', ')} capability`] : []),
        'Issue IAP revision if P1 assignments are affected',
      ],
      alternateAssets: subs.map((x) => x.assetId),
      activation: activated ? 'ACTIVATED' : 'STANDBY', activationReason: activated ? `${v.assetId} UNAVAILABLE${v.availability.note ? ` (${v.availability.note})` : ''}` : null,
      derivedFrom: [ctx.assetPath(v.assetId, 'availability'), ...(activated ? ['previousIap.snapshot.assignments'] : []), 'rule:CT-VESSEL'],
    });
  }

  if (s.availableAssets.some((a) => a.limits) && allocation.some((r) => r.status === 'ASSIGNED'))
    out.push({ contingencyId: 'CT-WEATHER', scenario: 'Weather deteriorates beyond asset operating limits', indicator: 'DP-AIR-WIND or DP-SEA-STATE condition met', actions: ['Suspend affected tasks per trigger', 'Secure staged boom and recover crews to base', 'Maintain shore-based observation of priority resources', 'Re-sequence suspended tasks into the next suitable window'], alternateAssets: [], activation: 'STANDBY', activationReason: null, derivedFrom: [s.environment ? 'environment.outlook' : 'environment (null)', 'availableAssets[*].limits', 'rule:CT-WEATHER'] });

  if (s.currentSituation.shorelineContact !== 'CONFIRMED' && ap.shoreline.length)
    out.push({ contingencyId: 'CT-SHORE-CONTACT', scenario: 'Shoreline contact is confirmed', indicator: 'Shore team, drone or public report verified by field observation', actions: ['Shore team converts pre-assessment to active assessment of the affected segment', 'Liaison advises stakeholders', 'Issue SITREP and IAP revision', 'Request additional shoreline teams'], alternateAssets: avail('SHORELINE_ASSESSMENT'), activation: 'STANDBY', activationReason: null, derivedFrom: ['currentSituation.shorelineContact', 'rule:CT-SHORE'] });

  if (s.currentSituation.oilType === null)
    out.push({ contingencyId: 'CT-OIL-ID', scenario: 'Oil identification remains uncertain', indicator: 'No laboratory result by end of period', actions: ['Maintain precautionary PPE specified by the Safety Officer', 'Plan on the basis that the product may be persistent (planning basis, not a finding)', 'Expedite laboratory analysis of slick-centre sample S-01'], alternateAssets: [], activation: 'STANDBY', activationReason: null, derivedFrom: ['currentSituation.oilType (null)', 'rule:CT-OIL-ID'] });

  const planned = protection.filter((p) => p.objectiveId);
  if (s.forecast && planned.length >= 2) {
    const second = planned[1];
    const r = s.impactAssessment!.resources.find((x) => x.resourceId === second.resourceId)!;
    out.push({ contingencyId: 'CT-FORECAST-SHIFT', scenario: `Forecast shifts toward ${second.name}`, indicator: 'DP-FORECAST condition met', actions: [`Re-task drone surveillance to ${ctx.sectorName(r.sectorId)}`, 'Re-rank protection priorities; relocate staged package only on command decision', 'Request forecast update and issue SITREP'], alternateAssets: avail('SURVEILLANCE_DRONE'), activation: 'STANDBY', activationReason: null, derivedFrom: ['forecast.leadingEdgeSectorId', ctx.resourcePath(r, 'exposure'), 'rule:CT-FORECAST-SHIFT'] });
  }

  if (ctx.constraints.some((c) => c.constraintId === 'C-BOOM'))
    out.push({ contingencyId: 'CT-BOOM', scenario: 'Boom insufficient for all priority resources', indicator: 'C-BOOM active; DP-BOOM decision time reached', actions: ['Protect the highest-ranked resource frontage first', 'Request external / mutual-aid boom', 'Advise lower-ranked resource stakeholders of partial protection'], alternateAssets: [], activation: 'ACTIVATED', activationReason: ctx.constraints.find((c) => c.constraintId === 'C-BOOM')!.description, derivedFrom: ['availableAssets[*].boomLengthM', 'rule:CT-BOOM'] });

  return out;
}

export function buildAlerts(ctx: PlanningContext, protection: ProtectionPriorityRow[], assignments: Assignment[], contingencies: Contingency[]): PlanAlert[] {
  const out: PlanAlert[] = ctx.s.currentAlerts.map((a, i) => ({ ...a, source: 'INPUT', derivedFrom: [`currentAlerts[${i}]`] }));
  for (const a of assignments.filter((x) => x.priority === 'P1' && x.status === 'UNRESOURCED'))
    out.push({ alertId: `ALR-UNRESOURCED-${a.assignmentId}`, severity: 'CRITICAL', text: `${a.assignmentId} UNRESOURCED: ${a.statusReason}.`, source: 'DERIVED', derivedFrom: [`assignment:${a.assignmentId}.status`] });
  for (const p of protection.filter((x) => x.priority === 'P1' && x.decideBy)) {
    if (ms(p.decideBy!) < ms(ctx.start)) out.push({ alertId: `ALR-DECISION-${p.resourceId}`, severity: 'CRITICAL', text: `Deployment decision time for ${p.name} (${utc(p.decideBy)}) has passed — command decision required at period start.`, source: 'DERIVED', derivedFrom: p.derivedFrom });
    else if (ms(p.decideBy!) <= ms(ctx.end)) out.push({ alertId: `ALR-DECISION-${p.resourceId}`, severity: 'WARNING', text: `Deployment decision for ${p.name} required by ${utc(p.decideBy)}.`, source: 'DERIVED', derivedFrom: p.derivedFrom });
  }
  const boom = ctx.constraints.find((c) => c.constraintId === 'C-BOOM');
  if (boom) out.push({ alertId: 'ALR-BOOM', severity: 'WARNING', text: `Boom shortfall — ${boom.description}`, source: 'DERIVED', derivedFrom: boom.derivedFrom });
  for (const c of contingencies.filter((x) => x.activation === 'ACTIVATED' && x.contingencyId !== 'CT-BOOM'))
    out.push({ alertId: `ALR-${c.contingencyId}`, severity: 'WARNING', text: `Contingency ${c.contingencyId} ACTIVATED — ${c.activationReason}.`, source: 'DERIVED', derivedFrom: c.derivedFrom });
  const order = { CRITICAL: 0, WARNING: 1, NOTICE: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
