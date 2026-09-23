/**
 * Incident state → contract checks → objectives → assignments → coordination → triggers / contingencies → validation
 * → IapDocument. Renderers (JSON / Markdown / PDF) only format an IapDocument; they never read the incident state.
 */
import type {
  FactRow, GapRow, IapDocument, IapIncidentState, IapPlan, IapSnapshot, IapVariant, Objective, PlanGraph, PreviousIapSnapshot, ProtectionPriorityRow,
} from './IapTypes';
import { IAP_CONFIG } from './IapConfig';
import { PlanningContext } from './analysis/PlanningContext';
import { deriveObjectives, rankProtection } from './analysis/ObjectiveEngine';
import { planAssignments } from './analysis/AssignmentEngine';
import { buildAllocation, buildComms, buildConstraints, buildReporting, buildSafety } from './analysis/CoordinationEngine';
import { buildAlerts, buildContingencies, buildTriggers } from './analysis/DecisionEngine';
import { validatePlan } from './analysis/IapValidator';
import { compareIapStates } from './analysis/IapDeltaEngine';
import { compass, fmt, joinAnd, levelLabel, periodLabel, utc } from './utils/format';

export class IapInputError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid IAP input:\n - ${problems.join('\n - ')}`);
  }
}

/** Trust-boundary checks on the integration contract (malformed input throws; plan problems go to validation). */
export function validateIapState(s: IapIncidentState): void {
  const p: string[] = [];
  const isoOk = (v: string | null | undefined, name: string) => v != null && Number.isNaN(Date.parse(v)) && p.push(`${name} is not an ISO timestamp`);
  const op = s.operationalPeriod;
  if (!s.incident?.incidentId) p.push('incident.incidentId is required');
  if (!op) p.push('operationalPeriod is required');
  else {
    if (!Number.isInteger(op.iapNumber) || op.iapNumber < 1) p.push('operationalPeriod.iapNumber must be an integer ≥ 1');
    if (!Number.isInteger(op.revision) || op.revision < 0) p.push('operationalPeriod.revision must be an integer ≥ 0');
    for (const k of ['createdAt', 'periodStart', 'periodEnd'] as const) { if (!op[k]) p.push(`operationalPeriod.${k} is required`); isoOk(op[k], `operationalPeriod.${k}`); }
    if (op.periodStart && op.periodEnd && Date.parse(op.periodEnd) <= Date.parse(op.periodStart)) p.push('operational period must end after it starts');
    if (s.previousIap && s.previousIap.iapNumber >= op.iapNumber) p.push('previousIap.iapNumber must be lower than operationalPeriod.iapNumber');
  }
  const ids = new Set<string>();
  for (const a of s.availableAssets ?? []) {
    if (ids.has(a.assetId)) p.push(`duplicate assetId ${a.assetId}`);
    ids.add(a.assetId);
    isoOk(a.availability.from, `asset ${a.assetId} availability.from`);
    isoOk(a.availability.until, `asset ${a.assetId} availability.until`);
    if (a.readinessMin !== null && a.readinessMin < 0) p.push(`asset ${a.assetId}: readinessMin must be ≥ 0`);
    if (a.capabilities.includes('BOOM') && (a.boomLengthM ?? null) !== null && a.boomLengthM! <= 0) p.push(`asset ${a.assetId}: boomLengthM must be > 0`);
  }
  const sectors = new Set((s.planningSectors ?? []).map((x) => x.sectorId));
  for (const r of s.impactAssessment?.resources ?? []) {
    if (r.exposureWindow && Date.parse(r.exposureWindow.end) < Date.parse(r.exposureWindow.start)) p.push(`resource ${r.resourceId}: exposure window ends before it starts`);
    if (!sectors.has(r.sectorId)) p.push(`resource ${r.resourceId}: unknown sector ${r.sectorId}`);
  }
  for (const w of s.environment?.outlook ?? []) if (Date.parse(w.to) <= Date.parse(w.from)) p.push('environment.outlook window ends before it starts');
  for (const g of s.informationGaps ?? []) if (!['P1', 'P2', 'P3'].includes(g.priority)) p.push(`information gap ${g.gapId}: invalid priority`);
  if (p.length) throw new IapInputError(p);
}

export function generateIap(s: IapIncidentState, opts: { variant?: IapVariant } = {}): IapDocument {
  validateIapState(s);
  const variant = opts.variant ?? 'FULL';
  const ctx = new PlanningContext(s);
  const op = s.operationalPeriod, inc = s.incident;

  const protection = rankProtection(ctx);
  const objectives = deriveObjectives(ctx, protection);
  const ap = planAssignments(ctx, objectives, protection);
  for (const p of protection) p.assignmentIds = ap.assignments.filter((a) => a.objectiveId === p.objectiveId).map((a) => a.assignmentId);

  const safetyItems = buildSafety(ctx, ap.assignments);
  const constraints = buildConstraints(ctx, ap.assignments);
  const allocation = buildAllocation(ctx, ap.assignments);
  const triggers = buildTriggers(ctx, protection, ap);
  const contingencies = buildContingencies(ctx, protection, ap, allocation);
  const alerts = buildAlerts(ctx, protection, ap.assignments, contingencies);
  const gaps: GapRow[] = [
    ...s.informationGaps.map((g, i) => ({ ...g, source: 'INPUT' as const, derivedFrom: [`informationGaps[${i}]`] })),
    ...ctx.gaps.filter((g) => !s.informationGaps.some((x) => x.gapId === g.gapId)),
  ].sort((a, b) => a.priority.localeCompare(b.priority) || a.gapId.localeCompare(b.gapId));
  const assumptions = [...s.assumptions.map((a, i) => ({ ...a, source: 'INPUT' as const, usedBy: [], derivedFrom: [`assumptions[${i}]`] })), ...ctx.assumptions];

  const plan: IapPlan = {
    situation: situationRows(s, protection, constraints.map((c) => c.description)),
    commandEmphasis: commandEmphasis(objectives, protection),
    alerts, objectives, protectionPriorities: protection, assignments: ap.assignments, resourceAllocation: allocation,
    surveillance: ap.surveillance, containment: ap.containment, sampling: ap.sampling,
    shoreline: { contact: s.currentSituation.shorelineContact, tasks: ap.shoreline },
    safety: { assessmentAvailable: s.safetyHazards !== null, items: safetyItems },
    communications: { available: s.communications !== null, rows: buildComms(ctx, ap.assignments) },
    reporting: buildReporting(ctx, ap.assignments, triggers.map((t) => t.triggerId)),
    decisionTriggers: triggers, contingencies, informationGaps: gaps, assumptions, constraints,
    graph: planGraph(objectives, ap.assignments, protection, triggers, contingencies, s),
    sectors: s.planningSectors, weatherOutlook: s.environment?.outlook ?? [],
    geometry: { slickSectorId: s.slick?.sectorId ?? null, leadingEdgeSectorId: s.forecast?.leadingEdgeSectorId ?? null, interceptionSectorIds: s.forecast?.interceptionSectorIds ?? [] },
  };
  const validation = validatePlan(ctx, plan);
  const snapshot = toSnapshot(s, plan);
  const prev = s.previousIap?.snapshot ?? null;
  const deltas = prev ? compareIapStates(prev, snapshot, s.progress) : [];
  const iapNo = fmt.iapNo(op.iapNumber);

  return {
    schema: 'guardians-iap/1',
    variant,
    header: {
      title: `${IAP_CONFIG.systemTitle} ${IAP_CONFIG.documentTitle}`,
      documentRef: `${inc.incidentId}-IAP${iapNo}`,
      iapNo, incidentId: inc.incidentId, incidentName: inc.incidentName, revision: op.revision, status: op.status,
      createdAt: op.createdAt, periodStart: op.periodStart, periodEnd: op.periodEnd, operationalPeriod: periodLabel(op.periodStart, op.periodEnd),
      region: inc.subArea ? `${inc.region} — ${inc.subArea}` : inc.region,
      preparedBy: op.preparedBy, reviewedBy: op.reviewedBy ?? 'NOT REVIEWED', approvedBy: op.approvedBy ?? 'NOT APPROVED', approvedAt: op.approvedAt ? utc(op.approvedAt) : 'NOT APPROVED',
      commandAuthority: inc.commandAuthority, classification: inc.classification, distribution: inc.distribution, sitrepRef: op.sitrepRef ?? 'NOT AVAILABLE',
      systemName: inc.systemName, modelVersion: inc.modelVersion,
    },
    demonstration: inc.isDemonstrationData,
    authorityNotice: IAP_CONFIG.authorityNotice,
    validation,
    changes: { initial: !prev, previousIapNo: s.previousIap ? fmt.iapNo(s.previousIap.iapNumber) : null, deltas },
    plan,
    snapshot,
  };
}

/** Comparable snapshot of a generated plan (stored in iap.json, fed to the next IAP as previousIap). */
export function toSnapshot(s: IapIncidentState, plan: IapPlan): IapSnapshot {
  return {
    iapNumber: s.operationalPeriod.iapNumber, revision: s.operationalPeriod.revision, periodStart: s.operationalPeriod.periodStart, periodEnd: s.operationalPeriod.periodEnd,
    objectives: plan.objectives.map((o) => ({ id: o.objectiveId, priority: o.priority, statement: o.statement })),
    assignments: plan.assignments.map((a) => ({ id: a.assignmentId, objectiveId: a.objectiveId, priority: a.priority, assetIds: a.assetIds, start: a.startTime, status: a.status, task: a.task })),
    assets: s.availableAssets.map((a) => ({ id: a.assetId, name: a.name, status: a.availability.status, availableFrom: a.availability.from })),
    resources: plan.protectionPriorities.map((r) => ({ id: r.resourceId, name: r.name, exposure: r.exposure, windowStart: r.exposureWindow?.start ?? null, priority: r.priority })),
    hazards: plan.safety.items.map((h) => ({ id: h.hazardId, severity: h.severity, hazard: h.hazard })),
    gaps: plan.informationGaps.map((g) => ({ id: g.gapId, description: g.description })),
    contingencies: plan.contingencies.map((c) => ({ id: c.contingencyId, scenario: c.scenario, activation: c.activation })),
    samples: plan.sampling.map((x) => ({ id: x.sampleId, location: x.location, priority: x.priority })),
    forecast: { available: !!s.forecast, leadingEdgeSectorId: s.forecast?.leadingEdgeSectorId ?? null, confidence: s.forecast?.confidence ?? 'UNAVAILABLE' },
    environment: { available: !!s.environment, wind: s.environment?.windSpeedMs != null, waves: s.environment?.waveHsM != null },
    shorelineContact: s.currentSituation.shorelineContact,
  };
}

export const toPreviousIap = (s: IapIncidentState): PreviousIapSnapshot => ({
  iapNumber: s.operationalPeriod.iapNumber, revision: s.operationalPeriod.revision, createdAt: s.operationalPeriod.createdAt, snapshot: generateIap(s).snapshot,
});

/* ================================================================== helpers */

function situationRows(s: IapIncidentState, protection: ProtectionPriorityRow[], constraints: string[]): FactRow[] {
  const sl = s.slick, fc = s.forecast, sit = s.currentSituation, env = s.environment;
  const row = (label: string, value: string, basis: FactRow['basis']): FactRow => ({ label, value, basis: value === 'NOT AVAILABLE' ? 'NOT AVAILABLE' : basis });
  const top = protection.filter((p) => p.priority !== 'MONITOR').slice(0, 3);
  return [
    row('Slick status', `${sit.slickStatus} — ${sit.verification === 'SATELLITE_ONLY' ? 'satellite detection only, not field-verified' : 'field-verified'}`, sit.verification === 'FIELD_VERIFIED' ? 'OBSERVED' : 'INFERRED'),
    row('Last observed', sl ? `${utc(sl.observedAt)} — ${sl.source}` : 'NOT AVAILABLE', 'OBSERVED'),
    row('Location / sector', sl ? [sl.locationText, sl.sectorId].filter(Boolean).join(' — ') || 'NOT AVAILABLE' : 'NOT AVAILABLE', 'OBSERVED'),
    row('Area / fragments', sl && (sl.areaKm2 !== null || sl.fragmentCount !== null) ? `${fmt.km2(sl.areaKm2)} / ${sl.fragmentCount === null ? 'NOT AVAILABLE' : `${sl.fragmentCount} fragment(s)`}${sl.trend ? ` — trend ${sl.trend}` : ''}` : 'NOT AVAILABLE', 'OBSERVED'),
    row('Forecast movement', fc ? (fc.movementTowardDeg === null ? 'NOT AVAILABLE' : `Toward ${compass(fc.movementTowardDeg)} (${fmt.bearing(fc.movementTowardDeg)}); leading edge ${fc.leadingEdgeSectorId ?? 'NOT AVAILABLE'}; confidence ${levelLabel(fc.confidence)}`) : 'NOT AVAILABLE', 'MODELLED'),
    row('On-scene conditions', env ? `Wind ${env.windSpeedMs === null ? 'NOT AVAILABLE' : `${fmt.ms(env.windSpeedMs)} from ${fmt.bearing(env.windFromDeg)}`}; Hs ${fmt.m(env.waveHsM)}; visibility ${fmt.km(env.visibilityKm, 0)}` : 'NOT AVAILABLE', 'OBSERVED'),
    row('Highest-priority threats', top.length ? top.map((p) => `${p.name} (${p.priority}, ${p.exposure}${p.exposureWindow ? ` from ${utc(p.exposureWindow.start).slice(5, 16)}` : ''})`).join('; ') : 'NONE IN PLANNING HORIZON', 'MODELLED'),
    row('Shoreline contact', sit.shorelineContact, sit.shorelineContact === 'NOT SURVEYED' ? 'INFERRED' : 'OBSERVED'),
    row('Main constraints', constraints.slice(0, 3).join(' · ') || 'None recorded', 'PLANNING'),
    row('Key uncertainty', joinAnd([
      ...(sit.oilType === null ? ['oil type not identified'] : []),
      ...(sit.verification === 'SATELLITE_ONLY' ? ['extent not field-verified'] : []),
      ...(!fc ? ['no drift forecast'] : fc.confidence.startsWith('LOW') ? [`forecast confidence ${levelLabel(fc.confidence)}`] : []),
      ...(!env ? ['no environmental data'] : env.windSpeedMs === null ? ['wind not observed'] : []),
    ]) || 'No major uncertainty flagged', 'INFERRED'),
  ];
}

function commandEmphasis(objectives: Objective[], protection: ProtectionPriorityRow[]): string {
  const p1 = objectives.filter((o) => o.priority === 'P1' && o.category !== 'SAFETY');
  const prot = protection.filter((p) => p.priority === 'P1').map((p) => p.name);
  const parts = ['Responder safety takes precedence over every assignment.'];
  if (prot.length) parts.push(`Protection readiness for ${joinAnd(prot)} is the first operational priority; deployment remains a command decision on the listed triggers.`);
  else if (p1.length) parts.push(`First operational priority: ${p1[0].statement.charAt(0).toLowerCase()}${p1[0].statement.slice(1)}`);
  if (objectives.some((o) => o.category === 'DELINEATE')) parts.push('Field verification of the slick precedes any deployment decision.');
  if (objectives.some((o) => o.category === 'INFORMATION')) parts.push('Missing planning inputs are to be restored early in the period.');
  parts.push('This emphasis is generated from the ranked objectives for command review.');
  return parts.join(' ');
}

function planGraph(objectives: Objective[], assignments: IapPlan['assignments'], protection: ProtectionPriorityRow[], triggers: IapPlan['decisionTriggers'], contingencies: IapPlan['contingencies'], s: IapIncidentState): PlanGraph {
  const g: PlanGraph = { nodes: [], edges: [] };
  const seen = new Set<string>();
  const node = (n: PlanGraph['nodes'][number]) => { if (!seen.has(n.id)) { seen.add(n.id); g.nodes.push(n); } };
  for (const o of objectives) node({ id: o.objectiveId, type: 'OBJECTIVE', priority: o.priority, label: o.statement, successCriteria: o.successCriteria });
  for (const p of protection.filter((x) => x.objectiveId)) {
    node({ id: p.resourceId, type: 'RESOURCE', label: p.name, exposure: p.exposure });
    g.edges.push({ from: p.objectiveId!, to: p.resourceId, type: 'PROTECTS' });
  }
  for (const a of assignments) {
    node({ id: a.assignmentId, type: 'ASSIGNMENT', priority: a.priority, label: a.task, start: a.startTime, end: a.targetCompletion, commitUntil: a.commitUntil, status: a.status, successCriteria: a.successCriteria });
    g.edges.push({ from: a.objectiveId, to: a.assignmentId, type: 'ACHIEVED_BY' });
    for (const id of a.assetIds) {
      const asset = s.availableAssets.find((x) => x.assetId === id);
      node({ id, type: 'ASSET', label: asset?.name ?? id, kind: asset?.kind ?? 'COMMAND' });
      g.edges.push({ from: a.assignmentId, to: id, type: 'USES' });
    }
    for (const d of a.dependencies) {
      const to = d.type === 'ASSIGNMENT' ? d.ref! : `EXT:${d.type}${d.ref ? `:${d.ref}` : ''}`;
      if (d.type !== 'ASSIGNMENT') node({ id: to, type: 'EXTERNAL_DEPENDENCY', label: d.note });
      g.edges.push({ from: a.assignmentId, to, type: 'DEPENDS_ON' });
    }
  }
  for (const t of triggers) {
    node({ id: t.triggerId, type: 'TRIGGER', label: `IF ${t.condition} THEN ${t.action}` });
    for (const a of t.affectedAssignments) g.edges.push({ from: t.triggerId, to: a, type: 'ESCALATES' });
  }
  for (const c of contingencies) {
    node({ id: c.contingencyId, type: 'CONTINGENCY', label: c.scenario });
    for (const id of c.alternateAssets) {
      const asset = s.availableAssets.find((x) => x.assetId === id);
      node({ id, type: 'ASSET', label: asset?.name ?? id, kind: asset?.kind ?? 'COMMAND' });
      g.edges.push({ from: c.contingencyId, to: id, type: 'ALTERNATE_FOR' });
    }
  }
  return g;
}

