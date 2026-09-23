/**
 * Coordination products derived from the scheduled assignments: safety plan (input + derived hazards mapped to the
 * assignments they affect), communications participants, reporting requirements, resource allocation and constraints.
 */
import type {
  Activity, Assignment, AssetKind, CommsRow, ConstraintRow, HazardType, ReportingRequirement, ResourceAllocationRow, SafetyItem,
} from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { addMin, fmt, hhmm, ms, overlaps, utc } from '../utils/format';
import { intervalFor, type PlanningContext } from './PlanningContext';

const VESSELS: AssetKind[] = ['RESPONSE VESSEL', 'PATROL VESSEL'];
const onWater = (ctx: PlanningContext, a: Assignment) => a.assetIds.some((id) => VESSELS.includes(ctx.assets.get(id)?.kind as AssetKind));
const span = (a: Assignment): [string, string] | null => (a.startTime && a.targetCompletion ? [a.startTime, a.targetCompletion] : null);

export function buildSafety(ctx: PlanningContext, assignments: Assignment[]): SafetyItem[] {
  const s = ctx.s;
  const items: SafetyItem[] = [];
  const affected = (acts: Activity[], from: string | null, to: string | null, extra: (a: Assignment) => boolean = () => true) =>
    assignments.filter((a) => acts.includes(a.activity) && extra(a) && (!from || !to || !span(a) || overlaps(span(a)![0], span(a)![1], from, to))).map((a) => a.assignmentId);

  (s.safetyHazards ?? []).forEach((h, i) => {
    if (!h.mitigation) ctx.addGap({ gapId: `G-MITIGATION-${h.hazardId}`, description: `${h.hazardId} ${h.type}: mitigation NOT SUPPLIED.`, operationalImpact: 'Affected field tasks lack a defined mitigation.', actionToResolve: 'Safety Officer to specify mitigation before deployment.', owner: 'Safety Officer', priority: h.severity === 'HIGH' ? 'P1' : 'P2', derivedFrom: [`safetyHazards[${i}].mitigation (null)`] });
    items.push({
      hazardId: h.hazardId, type: h.type, hazard: h.description, severity: h.severity,
      affectedAssignments: affected(h.appliesTo, h.from, h.to),
      mitigation: h.mitigation ?? 'MITIGATION NOT SUPPLIED — Safety Officer to specify before deployment',
      stopWorkCriteria: h.stopWorkCriteria ?? 'STOP-WORK CRITERIA NOT SUPPLIED — Safety Officer to specify',
      source: 'INPUT', derivedFrom: [`safetyHazards[${i}]`],
    });
  });
  const has = (t: HazardType) => items.some((x) => x.type === t);

  // Weather windows that exceed the supplied limits of tasked assets.
  const env = s.environment;
  if (env) {
    env.outlook.forEach((w, i) => {
      const hit = [...new Set(assignments.flatMap((a) => a.assetIds))].map((id) => ctx.assets.get(id)!).filter((a) => a && ctx.weatherProblem(a, w.from, w.to));
      if (!hit.length) return;
      const ids = hit.map((a) => a.assetId);
      items.push({
        hazardId: `HZ-WX-${String(i + 1).padStart(2, '0')}`, type: 'WEATHER', severity: 'HIGH',
        hazard: `Forecast ${w.windSpeedMs !== null ? `wind ${fmt.ms(w.windSpeedMs)}` : ''}${w.windSpeedMs !== null && w.waveHsM !== null ? ', ' : ''}${w.waveHsM !== null ? `Hs ${fmt.m(w.waveHsM)}` : ''} ${hhmm(w.from, ctx.start)}–${hhmm(w.to, ctx.start)} UTC exceeds operating limits of ${ids.join(', ')}.`,
        affectedAssignments: assignments.filter((a) => a.assetIds.some((x) => ids.includes(x))).map((a) => a.assignmentId),
        mitigation: 'Planner schedules affected tasks outside the forecast window; on-scene supervisors monitor conditions and recover before the window opens.',
        stopWorkCriteria: 'Observed conditions exceed the operating limit supplied for the asset.',
        source: 'DERIVED', derivedFrom: [`environment.outlook[${i}]`, ...ids.map((id) => ctx.assetPath(id, 'limits'))],
      });
    });
  }

  // Darkness during the period for field work.
  const dl = s.currentSituation.daylight;
  if (dl && !has('NIGHT OPERATIONS')) {
    const dark = assignments.filter((a) => IAP_CONFIG.fieldActivities.includes(a.activity) && span(a) && !dl.some((d) => ms(span(a)![0]) >= ms(d.sunrise) && ms(span(a)![1]) <= ms(d.sunset)));
    if (dark.length)
      items.push({
        hazardId: 'HZ-NIGHT', type: 'NIGHT OPERATIONS', severity: 'HIGH', hazard: 'Field tasks scheduled wholly or partly in darkness.',
        affectedAssignments: dark.map((a) => a.assignmentId),
        mitigation: 'Vessel night-operations procedures of the asset operator; no small-boat or shoreline work beyond task scope; buddy system and position reports at each status interval.',
        stopWorkCriteria: 'Loss of visual contact with a crew member, navigation or communications failure.',
        source: 'DERIVED', derivedFrom: ['currentSituation.daylight', 'rule:SAFETY-NIGHT'],
      });
  }

  // Unidentified product.
  if (s.currentSituation.oilType === null && !has('HYDROCARBON EXPOSURE')) {
    const acts: Activity[] = ['SAMPLING', 'PROTECTION', 'CONTAINMENT', 'SHORELINE'];
    const aff = affected(acts, null, null);
    if (aff.length)
      items.push({
        hazardId: 'HZ-PRODUCT', type: 'HYDROCARBON EXPOSURE', severity: 'HIGH', hazard: 'Oil type not identified — potential vapour inhalation and skin contact during close work.',
        affectedAssignments: aff,
        mitigation: 'Precautionary PPE as specified by the Safety Officer until the product is identified; approach from upwind. No exposure limits are stated in this plan.',
        stopWorkCriteria: 'Strong odour, symptoms reported by any crew member, or Safety Officer instruction.',
        source: 'DERIVED', derivedFrom: ['currentSituation.oilType (null)', 'rule:SAFETY-PRODUCT'],
      });
  }

  // Aircraft and drones overlapping in time.
  if (!has('AIRSPACE SEPARATION')) {
    const air = assignments.filter((a) => a.activity === 'SURVEILLANCE_AIR' && span(a));
    const drn = assignments.filter((a) => a.activity === 'SURVEILLANCE_DRONE' && span(a));
    const pairs = drn.filter((d) => air.some((a) => overlaps(span(a)![0], span(a)![1], span(d)![0], span(d)![1])));
    if (pairs.length)
      items.push({
        hazardId: 'HZ-AIRSPACE', type: 'AIRSPACE SEPARATION', severity: 'HIGH', hazard: 'Surveillance aircraft and drone flights overlap in time.',
        affectedAssignments: [...air.map((a) => a.assignmentId), ...pairs.map((a) => a.assignmentId)],
        mitigation: 'Air Operations deconflicts by time and altitude block; drones hold on the ground while the aircraft works the same sector.',
        stopWorkCriteria: 'Loss of deconfliction contact with Air Operations.',
        source: 'DERIVED', derivedFrom: ['rule:SAFETY-AIRSPACE'],
      });
  }

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity] || a.hazardId.localeCompare(b.hazardId));
  for (const it of items) for (const id of it.affectedAssignments) {
    const a = assignments.find((x) => x.assignmentId === id)!;
    a.safetyNotes.push(`${it.hazardId} ${it.type} (${it.severity})`);
  }
  return items;
}

export function buildComms(ctx: PlanningContext, assignments: Assignment[]): CommsRow[] {
  const R = IAP_CONFIG.reporting;
  return (ctx.s.communications ?? []).map((c, i) => {
    const used = [...new Set(assignments.filter((a) => a.startTime).flatMap((a) => a.assetIds))].map((id) => ctx.assets.get(id)!).filter((a) => a && c.users.includes(a.kind));
    const intervals = [
      ...(c.users.some((k) => VESSELS.includes(k)) && used.some((a) => VESSELS.includes(a.kind)) ? [`vessels ${R.vesselStatusMin} min`] : []),
      ...(c.users.includes('AIRCRAFT') && used.some((a) => a.kind === 'AIRCRAFT') ? [`aircraft ${R.aircraftStatusMin} min`] : []),
      ...(used.some((a) => ['DRONE TEAM', 'SAMPLING TEAM', 'SHORE TEAM'].includes(a.kind)) ? [`field teams ${R.fieldTeamStatusMin} min`] : []),
    ];
    return {
      channelId: c.channelId, label: c.label, purpose: c.purpose,
      participants: [...(c.users.includes('COMMAND') ? ['Incident command post'] : []), ...used.filter((a) => a.kind !== 'COMMAND').map((a) => a.assetId)],
      primary: c.primary, backup: c.backup ?? 'NOT SUPPLIED', reportingInterval: intervals.length ? intervals.join('; ') : 'On event',
      derivedFrom: [`communications[${i}]`, 'rule:COMMS-PARTICIPANTS'],
    };
  });
}

export function buildReporting(ctx: PlanningContext, assignments: Assignment[], triggerIds: string[]): ReportingRequirement[] {
  const R = IAP_CONFIG.reporting;
  const chan = (kind: AssetKind) => ctx.s.communications?.find((c) => c.users.includes(kind))?.channelId ?? null;
  const out: ReportingRequirement[] = [];
  const sched = assignments.filter((a) => a.startTime);

  for (const a of sched.filter((x) => x.activity.startsWith('SURVEILLANCE')))
    out.push({ reqId: `RR-${a.assignmentId}`, reportingUnit: a.assignedUnit, content: 'Slick boundary / leading-edge update with time-stamped imagery', dueKind: 'BY TIME', dueAt: addMin(a.targetCompletion!, R.boundaryReportAfterMin), intervalMin: null, event: null, recipient: 'Situation Unit', channelId: chan(ctx.assets.get(a.assetIds[0])!.kind), assignmentId: a.assignmentId, derivedFrom: [`assignment:${a.assignmentId}.targetCompletion`, 'config:reporting.boundaryReportAfterMin'] });
  for (const a of sched.filter((x) => x.activity === 'SAMPLING'))
    out.push({ reqId: `RR-${a.assignmentId}`, reportingUnit: a.assignedUnit, content: 'Sample collection status immediately after each sample; custody handover confirmation', dueKind: 'ON EVENT', dueAt: null, intervalMin: null, event: 'Each sample collected / handed over', recipient: 'Environmental Unit', channelId: chan('SAMPLING TEAM'), assignmentId: a.assignmentId, derivedFrom: [`assignment:${a.assignmentId}`, 'rule:REPORT-SAMPLING'] });
  for (const a of sched.filter((x) => x.activity === 'NOTIFICATION'))
    out.push({ reqId: `RR-${a.assignmentId}`, reportingUnit: a.assignedUnit, content: 'Stakeholder acknowledgement and agreed contact point', dueKind: 'BY TIME', dueAt: a.targetCompletion, intervalMin: null, event: null, recipient: 'Incident command', channelId: chan('COMMAND'), assignmentId: a.assignmentId, derivedFrom: [`assignment:${a.assignmentId}.targetCompletion`] });

  const used = [...new Set(sched.flatMap((a) => a.assetIds))].map((id) => ctx.assets.get(id)!).filter((a) => a && !['COMMAND', 'BOOM', 'SKIMMER', 'SENSOR'].includes(a.kind)).sort((a, b) => a.assetId.localeCompare(b.assetId));
  const classes: [string, (k: AssetKind) => boolean, number, AssetKind][] = [
    ['VESSELS', (k) => VESSELS.includes(k), R.vesselStatusMin, 'RESPONSE VESSEL'],
    ['AIR', (k) => k === 'AIRCRAFT' || k === 'DRONE TEAM', R.aircraftStatusMin, 'AIRCRAFT'],
    ['TEAMS', (k) => k === 'SAMPLING TEAM' || k === 'SHORE TEAM', R.fieldTeamStatusMin, 'SHORE TEAM'],
  ];
  for (const [name, match, interval, chanKind] of classes) {
    const group = used.filter((a) => match(a.kind));
    if (!group.length) continue;
    out.push({ reqId: `RR-STATUS-${name}`, reportingUnit: group.map((a) => a.assetId).join(', '), content: 'Position, task status and on-scene conditions', dueKind: 'INTERVAL', dueAt: null, intervalMin: interval, event: null, recipient: 'Operations Section', channelId: chan(chanKind), assignmentId: null, derivedFrom: [...group.map((a) => ctx.assetPath(a.assetId)), `config:reporting.${name === 'VESSELS' ? 'vessel' : name === 'AIR' ? 'aircraft' : 'fieldTeam'}StatusMin`] });
  }
  out.push(
    { reqId: 'RR-TRIGGER', reportingUnit: 'All field units', content: `Any observation meeting a decision-trigger condition (${triggerIds.join(', ')})`, dueKind: 'ON EVENT', dueAt: null, intervalMin: null, event: 'Trigger condition observed', recipient: 'Incident command', channelId: chan('COMMAND'), assignmentId: null, derivedFrom: ['decisionTriggers', 'rule:REPORT-TRIGGER'] },
    { reqId: 'RR-STOPWORK', reportingUnit: 'All field units', content: 'Stop-work event, injury or near miss', dueKind: 'ON EVENT', dueAt: null, intervalMin: null, event: 'Stop-work criterion met', recipient: 'Safety Officer', channelId: chan('COMMAND'), assignmentId: null, derivedFrom: ['safety', 'rule:REPORT-STOPWORK'] },
    { reqId: 'RR-SITREP-EVENT', reportingUnit: 'Situation Unit', content: 'SITREP on material change (trigger activation, shoreline contact, loss of a tasked asset)', dueKind: 'ON EVENT', dueAt: null, intervalMin: null, event: 'Material change', recipient: 'Distribution list', channelId: ctx.s.communications?.find((c) => /DATA|SITREP/i.test(c.label))?.channelId ?? null, assignmentId: null, derivedFrom: ['rule:REPORT-SITREP-EVENT'] },
    { reqId: 'RR-SITREP-END', reportingUnit: 'Situation Unit', content: 'End-of-period SITREP', dueKind: 'BY TIME', dueAt: ctx.end, intervalMin: null, event: null, recipient: 'Distribution list', channelId: ctx.s.communications?.find((c) => /DATA|SITREP/i.test(c.label))?.channelId ?? null, assignmentId: null, derivedFrom: ['operationalPeriod.periodEnd'] },
    { reqId: 'RR-NEXT-IAP', reportingUnit: 'Planning Section', content: 'Draft IAP for next operational period, incorporating progress reports', dueKind: 'BY TIME', dueAt: addMin(ctx.end, -R.nextIapLeadMin), intervalMin: null, event: null, recipient: 'Incident command', channelId: chan('COMMAND'), assignmentId: null, derivedFrom: ['operationalPeriod.periodEnd', 'config:reporting.nextIapLeadMin'] },
  );
  return out;
}

export function buildAllocation(ctx: PlanningContext, assignments: Assignment[]): ResourceAllocationRow[] {
  return ctx.s.availableAssets.map((a) => {
    const av = a.availability;
    const mine = assignments.filter((x) => x.assetIds.includes(a.assetId));
    const availability = av.status === 'UNAVAILABLE' ? `UNAVAILABLE${av.note ? ` — ${av.note}` : ''}`
      : av.from === null ? 'NOT AVAILABLE'
      : `${av.status} from ${hhmm(av.from, ctx.start)}${av.until ? ` to ${hhmm(av.until, ctx.start)}` : ''}${a.readinessMin ? ` (+${a.readinessMin} min readiness)` : ''}`;
    return {
      assetId: a.assetId, name: a.name, kind: a.kind, availability,
      status: av.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : av.from === null ? 'AVAILABILITY UNKNOWN' : mine.some((x) => x.startTime) ? 'ASSIGNED' : 'UNTASKED',
      assignments: mine.map((x) => {
        const iv = intervalFor(x, a.assetId);
        return { assignmentId: x.assignmentId, sectorId: x.sectorId, from: iv?.[0] ?? null, to: iv?.[1] ?? null, hold: !!x.commitUntil && x.heldAssetIds.includes(a.assetId) };
      }),
      limitations: [...a.limitations, ...(a.limits?.daylightOnly ? ['Daylight only'] : [])],
    };
  });
}

export function buildConstraints(ctx: PlanningContext, assignments: Assignment[]): ConstraintRow[] {
  const s = ctx.s;
  const link = (acts: Activity[], from: string | null, to: string | null) =>
    assignments.filter((a) => (!acts.length || acts.includes(a.activity)) && (!from || !to || !span(a) || overlaps(span(a)![0], span(a)![1], from, to))).map((a) => a.assignmentId);

  const air = s.availableAssets.filter((a) => a.capabilities.includes('SURVEILLANCE_AIR'));
  if (air.length === 1) ctx.addConstraint({ constraintId: 'C-AIR-SINGLE', type: 'RESOURCE', description: `Only one surveillance aircraft (${air[0].assetId}) — no aerial redundancy.`, from: null, to: null, appliesTo: ['SURVEILLANCE_AIR'], derivedFrom: [ctx.assetPath(air[0].assetId, 'capabilities')] });
  const smp = s.availableAssets.filter((a) => a.capabilities.includes('SAMPLING') && a.availability.status !== 'UNAVAILABLE');
  if (smp.length === 1) ctx.addConstraint({ constraintId: 'C-SAMPLING-SINGLE', type: 'RESOURCE', description: `Single sampling team (${smp[0].assetId}) — offshore and nearshore sampling run sequentially.`, from: null, to: null, appliesTo: ['SAMPLING'], derivedFrom: [ctx.assetPath(smp[0].assetId, 'capabilities')] });
  for (const a of s.availableAssets.filter((x) => x.availability.status === 'UNAVAILABLE'))
    ctx.addConstraint({ constraintId: `C-UNAVAILABLE-${a.assetId}`, type: 'RESOURCE', description: `${a.name} UNAVAILABLE${a.availability.note ? ` (${a.availability.note})` : ''}.`, from: null, to: null, appliesTo: [], derivedFrom: [ctx.assetPath(a.assetId, 'availability')] });
  for (const a of s.availableAssets.filter((x) => x.availability.status === 'DELAYED' && x.availability.from && ms(x.availability.from) > ms(ctx.start)))
    ctx.addConstraint({ constraintId: `C-DELAYED-${a.assetId}`, type: 'RESOURCE', description: `${a.name} not available before ${utc(a.availability.from)}${a.availability.note ? ` (${a.availability.note})` : ''}.`, from: ctx.start, to: a.availability.from, appliesTo: [], derivedFrom: [ctx.assetPath(a.assetId, 'availability')] });
  const dl = s.currentSituation.daylight;
  if (dl && s.availableAssets.some((a) => a.limits?.daylightOnly)) {
    const inPeriod = dl.filter((d) => overlaps(d.sunrise, d.sunset, ctx.start, ctx.end));
    ctx.addConstraint({ constraintId: 'C-DAYLIGHT', type: 'DAYLIGHT', description: `Aircraft and drone operations restricted to daylight${inPeriod.length ? ` (${inPeriod.map((d) => `${hhmm(d.sunrise, ctx.start)}–${hhmm(d.sunset, ctx.start)}`).join(', ')} UTC)` : ' — no daylight within this operational period'}.`, from: null, to: null, appliesTo: ['SURVEILLANCE_AIR', 'SURVEILLANCE_DRONE'], derivedFrom: ['currentSituation.daylight', 'availableAssets[*].limits.daylightOnly'] });
  }
  if (s.environment) s.environment.outlook.forEach((w, i) => {
    const hit = s.availableAssets.filter((a) => ctx.weatherProblem(a, w.from, w.to));
    if (hit.length) ctx.addConstraint({ constraintId: `C-WX-${String(i + 1).padStart(2, '0')}`, type: 'WEATHER', description: `Forecast conditions ${hhmm(w.from, ctx.start)}–${hhmm(w.to, ctx.start)} UTC exceed operating limits of ${hit.map((a) => a.assetId).join(', ')} — tasks scheduled outside this window.`, from: w.from, to: w.to, appliesTo: [], derivedFrom: [`environment.outlook[${i}]`, ...hit.map((a) => ctx.assetPath(a.assetId, 'limits'))] });
  });
  if (s.currentSituation.shorelineContact !== 'CONFIRMED' && assignments.some((a) => a.activity === 'SHORELINE'))
    ctx.addConstraint({ constraintId: 'C-SHORE-PREP', type: 'REGULATORY', description: 'No confirmed shoreline contact — shoreline work limited to preparation and assessment.', from: null, to: null, appliesTo: ['SHORELINE'], derivedFrom: ['currentSituation.shorelineContact'] });

  const derived = ctx.constraints.map((c) => ({ ...c, affectsAssignments: [...new Set([...c.affectsAssignments, ...(c.appliesTo.length || (c.from && c.to) ? link(c.appliesTo, c.from, c.to) : [])])] }));
  const input: ConstraintRow[] = s.constraints.map((c, i) => ({ ...c, source: 'INPUT', affectsAssignments: c.appliesTo.length || (c.from && c.to) ? link(c.appliesTo, c.from, c.to) : [], derivedFrom: [`constraints[${i}]`] }));
  return [...input, ...derived];
}

export { onWater };
