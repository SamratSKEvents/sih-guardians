/**
 * Plan validation. Re-checks the assembled plan independently of how it was built (generated and directed assignments
 * alike): resource conflicts, availability, operating limits, staffing, boom sufficiency, dependency DAG, traceability,
 * required fields, safety coverage and approval / demonstration rules.
 *
 *   any ERROR   → INVALID  (rendered "DRAFT — NOT VALIDATED")
 *   any WARNING → VALID_WITH_WARNINGS
 *   otherwise   → VALID
 */
import type { Assignment, IapPlan, Priority, ValidationIssue, ValidationResult } from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { hhmm, ms, overlaps, utc } from '../utils/format';
import { intervalFor, type PlanningContext } from './PlanningContext';

const PRIORITIES: Priority[] = ['P1', 'P2', 'P3'];

/** Same asset / team committed to overlapping assignments. */
export function detectResourceConflicts(assignments: Assignment[], start: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const ids = [...new Set(assignments.flatMap((a) => a.assetIds))].sort();
  for (const id of ids) {
    const uses = assignments.map((a) => ({ a, iv: intervalFor(a, id) })).filter((x) => x.a.assetIds.includes(id) && x.iv);
    for (let i = 0; i < uses.length; i++)
      for (let j = i + 1; j < uses.length; j++) {
        const [x, y] = [uses[i], uses[j]];
        if (overlaps(x.iv![0], x.iv![1], y.iv![0], y.iv![1]))
          out.push({ code: 'RESOURCE_CONFLICT', severity: 'ERROR', refs: [id, x.a.assignmentId, y.a.assignmentId],
            message: `${id} assigned to ${x.a.assignmentId} ${hhmm(x.iv![0], start)}–${hhmm(x.iv![1], start)} and ${y.a.assignmentId} ${hhmm(y.iv![0], start)}–${hhmm(y.iv![1], start)}` });
      }
  }
  return out;
}

/** Unknown references, cycles (DEPENDENCY_CYCLE) and prerequisites finishing after the dependent starts. */
export function validateDependencies(assignments: Assignment[]): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const byId = new Map(assignments.map((a) => [a.assignmentId, a]));
  const edges = new Map<string, string[]>();
  for (const a of assignments) {
    const refs = a.dependencies.filter((d) => d.type === 'ASSIGNMENT').map((d) => d.ref ?? '');
    edges.set(a.assignmentId, refs.filter((r) => byId.has(r)));
    for (const r of refs) {
      const p = byId.get(r);
      if (!p) { out.push({ code: 'DEPENDENCY_UNKNOWN', severity: 'ERROR', refs: [a.assignmentId, r], message: `${a.assignmentId} depends on unknown assignment ${r || '(empty)'}` }); continue; }
      if (a.startTime && p.targetCompletion && ms(a.startTime) < ms(p.targetCompletion))
        out.push({ code: 'DEPENDENCY_ORDER', severity: 'ERROR', refs: [a.assignmentId, r], message: `${a.assignmentId} starts ${utc(a.startTime)} before prerequisite ${r} completes ${utc(p.targetCompletion)}` });
      if (a.startTime && !p.startTime)
        out.push({ code: 'DEPENDENCY_ORDER', severity: 'ERROR', refs: [a.assignmentId, r], message: `${a.assignmentId} is scheduled but prerequisite ${r} is not scheduled` });
    }
  }
  // cycle detection (iterative colouring DFS, deterministic order)
  const colour = new Map<string, 0 | 1 | 2>();
  const reported = new Set<string>();
  const visit = (id: string, path: string[]) => {
    colour.set(id, 1);
    for (const n of edges.get(id) ?? []) {
      if (colour.get(n) === 1) {
        const cycle = [...path.slice(path.indexOf(n)), n];
        const key = [...cycle.slice(0, -1)].sort().join('>');
        if (!reported.has(key)) { reported.add(key); out.push({ code: 'DEPENDENCY_CYCLE', severity: 'ERROR', refs: cycle.slice(0, -1), message: `Dependency cycle: ${cycle.join(' → ')}` }); }
      } else if (!colour.get(n)) visit(n, [...path, n]);
    }
    colour.set(id, 2);
  };
  for (const id of [...edges.keys()].sort()) if (!colour.get(id)) visit(id, [id]);
  return out;
}

export function validatePlan(ctx: PlanningContext, plan: IapPlan): ValidationResult {
  const s = ctx.s, op = s.operationalPeriod;
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue['code'], severity: ValidationIssue['severity'], message: string, refs: string[] = []) => issues.push({ code, severity, message, refs });
  const A = plan.assignments;
  const objIds = new Set(plan.objectives.map((o) => o.objectiveId));

  if (!plan.objectives.length) add('NO_OBJECTIVES', 'ERROR', 'Plan has no objectives');
  for (const o of plan.objectives.filter((x) => !A.some((a) => a.objectiveId === x.objectiveId)))
    add('OBJECTIVE_WITHOUT_ASSIGNMENT', 'INFO', `${o.objectiveId} has no assignment this period (monitoring through other tasks)`, [o.objectiveId]);

  for (const a of A) {
    const id = a.assignmentId;
    if (!objIds.has(a.objectiveId)) add('OBJECTIVE_NOT_FOUND', 'ERROR', `${id} references unknown objective ${a.objectiveId}`, [id]);
    if (!PRIORITIES.includes(a.priority)) add('INVALID_PRIORITY', 'ERROR', `${id} has invalid priority ${a.priority}`, [id]);
    for (const [f, v] of [['task', a.task], ['assignedUnit', a.assignedUnit], ['fallbackAction', a.fallbackAction]] as const) if (!v?.trim()) add('MISSING_FIELD', 'ERROR', `${id}: ${f} is required`, [id]);
    if (!a.successCriteria?.length) add('MISSING_FIELD', 'ERROR', `${id}: successCriteria are required`, [id]);
    if (a.startTime && (!a.targetCompletion || ms(a.targetCompletion) <= ms(a.startTime))) add('MISSING_FIELD', 'ERROR', `${id}: targetCompletion must follow startTime`, [id]);

    if (!a.startTime) {
      if (a.status === 'COMPLETED' || a.status === 'CANCELLED') continue;
      if (a.status === 'UNRESOURCED' || (a.status !== 'DEFERRED' && a.priority === 'P1')) add('UNRESOURCED_ASSIGNMENT', 'WARNING', `${id} (${a.priority}) not resourced: ${a.statusReason ?? 'no assets / time'}`, [id]);
      else add('DEFERRED_ASSIGNMENT', 'INFO', `${id} (${a.priority}) deferred: ${a.statusReason ?? 'no assets / time'}`, [id]);
      continue;
    }
    const end = a.commitUntil && ms(a.commitUntil) > ms(a.targetCompletion!) ? a.commitUntil : a.targetCompletion!;
    if (ms(a.startTime) < ms(op.periodStart) || ms(end) > ms(op.periodEnd)) add('OUTSIDE_PERIOD', 'ERROR', `${id} (${utc(a.startTime)}–${utc(end)}) lies outside the operational period`, [id]);
    if (a.onSceneTime === null && a.sectorId && a.source === 'GENERATED' && a.activity !== 'COMMAND' && a.activity !== 'INFORMATION' && a.activity !== 'NOTIFICATION' && a.activity !== 'CONTAINMENT' && !a.assignmentId.startsWith('A-READY'))
      add('TRANSIT_TIME_UNKNOWN', 'WARNING', `${id}: transit time to ${a.sectorId} NOT AVAILABLE — completion excludes transit`, [id]);
    if (!a.assetIds.length) add('MISSING_FIELD', 'ERROR', `${id} is scheduled without assets`, [id]);

    for (const assetId of a.assetIds) {
      const asset = ctx.assets.get(assetId);
      if (!asset) { add('ASSET_NOT_FOUND', 'ERROR', `${id} assigns unknown asset ${assetId}`, [id, assetId]); continue; }
      const iv = intervalFor(a, assetId)!;
      const prob = ctx.availabilityProblem(asset, iv[0], iv[1]);
      if (prob) {
        if (asset.availability.status === 'UNAVAILABLE') add('ASSET_UNAVAILABLE', 'ERROR', `${id}: ${prob}`, [id, assetId]);
        else if (asset.availability.from === null || asset.availability.status === 'UNKNOWN') add('ASSET_AVAILABILITY_UNKNOWN', 'WARNING', `${id}: ${prob}`, [id, assetId]);
        else if (/not ready before/.test(prob)) add('SCHEDULED_BEFORE_AVAILABLE', 'ERROR', `${id}: ${prob}`, [id, assetId]);
        else add('ASSET_UNAVAILABLE', 'ERROR', `${id}: ${prob}`, [id, assetId]);
      }
      const os = a.onSceneTime ?? a.startTime;
      const wx = ctx.weatherProblem(asset, os, a.targetCompletion!);
      if (wx) add('WEATHER_LIMIT_EXCEEDED', 'ERROR', `${id}: ${wx}`, [id, assetId]);
      const dl = ctx.daylightProblem(asset, os, a.targetCompletion!);
      if (dl) add('DAYLIGHT_RESTRICTION', 'ERROR', `${id}: ${dl}`, [id, assetId]);
    }

    if (a.boomRequiredM) {
      const got = a.assetIds.map((x) => ctx.assets.get(x)).filter((x) => x?.capabilities.includes('BOOM')).reduce((n, x) => n + (x!.boomLengthM ?? 0), 0);
      if (got < a.boomRequiredM) add('INSUFFICIENT_BOOM', 'WARNING', `${id}: boom allocated ${got} m of ${a.boomRequiredM} m required`, [id]);
    }
    if (IAP_CONFIG.fieldActivities.includes(a.activity) && !a.safetyNotes.length)
      add('SAFETY_COVERAGE_MISSING', 'WARNING', `${id} (${a.activity}) has no hazard assessment or safety notes`, [id]);
  }
  for (const a of A.filter((x) => x.boomRequiredM && !x.startTime)) add('INSUFFICIENT_BOOM', 'WARNING', `${a.assignmentId}: no boom allocated (${a.boomRequiredM} m required)`, [a.assignmentId]);

  issues.push(...detectResourceConflicts(A, op.periodStart));

  // staffing: concurrent draw on each personnel pool
  for (const pool of s.personnel.filter((p) => p.available !== null)) {
    const uses = A.flatMap((a) => a.assetIds.map((id) => ({ a, asset: ctx.assets.get(id), iv: intervalFor(a, id) }))).filter((u) => u.asset?.personnel?.poolId === pool.poolId && u.iv);
    const points = [...new Set(uses.map((u) => u.iv![0]))].sort();
    const flagged = new Set<string>();
    for (const t of points) {
      const active = uses.filter((u) => ms(u.iv![0]) <= ms(t) && ms(t) < ms(u.iv![1]));
      const load = active.reduce((n, u) => n + u.asset!.personnel!.count, 0);
      const key = active.map((u) => u.a.assignmentId).sort().join(',');
      if (load > pool.available! && !flagged.has(key)) {
        flagged.add(key);
        add('INSUFFICIENT_PERSONNEL', 'ERROR', `${pool.role}: ${load} required at ${utc(t)} (${[...new Set(active.map((u) => u.a.assignmentId))].join(', ')}) but ${pool.available} available`, [pool.poolId, ...active.map((u) => u.a.assignmentId)]);
      }
    }
  }

  issues.push(...validateDependencies(A));

  // readiness after decision time
  for (const p of plan.protectionPriorities.filter((x) => x.decideBy)) {
    const a = A.find((x) => x.assignmentId === `A-STAGE-${p.resourceId.replace('-', '')}` && x.targetCompletion);
    if (a && ms(a.targetCompletion!) > ms(p.decideBy!) && ms(p.decideBy!) >= ms(op.periodStart))
      add('READINESS_AFTER_DECISION_TIME', 'WARNING', `${a.assignmentId} ready ${utc(a.targetCompletion)} after decision time ${utc(p.decideBy)} for ${p.name}`, [a.assignmentId]);
  }

  const contain = plan.objectives.find((o) => o.category === 'CONTAIN');
  if (contain && !A.some((a) => a.objectiveId === contain.objectiveId && a.startTime))
    add('NO_CONTAINMENT_CAPABILITY', 'WARNING', 'No containment / recovery capability could be resourced for this period', [contain.objectiveId]);
  if (!s.communications) add('COMMS_PLAN_MISSING', 'WARNING', 'Communications plan NOT SUPPLIED', []);

  // traceability — every generated item must carry derivedFrom
  const trace: [string, { derivedFrom: string[] }[], (x: any) => string][] = [
    ['objective', plan.objectives, (x) => x.objectiveId], ['assignment', A, (x) => x.assignmentId], ['trigger', plan.decisionTriggers, (x) => x.triggerId],
    ['contingency', plan.contingencies, (x) => x.contingencyId], ['alert', plan.alerts, (x) => x.alertId], ['gap', plan.informationGaps, (x) => x.gapId],
    ['constraint', plan.constraints, (x) => x.constraintId], ['assumption', plan.assumptions, (x) => x.assumptionId], ['protection', plan.protectionPriorities, (x) => x.resourceId],
    ['safety', plan.safety.items, (x) => x.hazardId], ['reporting', plan.reporting, (x) => x.reqId], ['sample', plan.sampling, (x) => x.sampleId],
  ];
  for (const [kind, items, key] of trace) for (const it of items) if (!it.derivedFrom?.filter((d) => d?.trim()).length) add('MISSING_TRACEABILITY', 'ERROR', `${kind} ${key(it)} has no derivedFrom traceability — rejected`, [key(it)]);

  // approval / demonstration rules
  if (s.incident.isDemonstrationData && (op.approvedBy || op.approvedAt || op.status === 'APPROVED' || op.status === 'FINAL'))
    add('DEMONSTRATION_FLAG', 'ERROR', 'Demonstration plans must remain unapproved (status and approval fields)', []);
  if (!s.incident.isDemonstrationData && (op.status === 'APPROVED' || op.status === 'FINAL') && (!op.approvedBy || !op.approvedAt))
    add('APPROVAL_INCOMPLETE', 'ERROR', `Status ${op.status} requires approvedBy and approvedAt`, []);

  const rank = { ERROR: 0, WARNING: 1, INFO: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { result: issues.some((i) => i.severity === 'ERROR') ? 'INVALID' : issues.some((i) => i.severity === 'WARNING') ? 'VALID_WITH_WARNINGS' : 'VALID', issues };
}
