/**
 * Assignments. Each objective category has one explicit rule that emits assignment requests; a deterministic scheduler
 * then allocates assets and times:
 *
 *   for t = earliest start (period start, prerequisite completion) in fixed steps until the period ends:
 *     for each required capability pick the first asset (previous-IAP asset preferred, then id order) that is
 *       available and ready, not already committed, within operating limits and daylight on scene, and staffed;
 *     boom is allocated greedily (longest package first) and a shortfall is recorded, never hidden.
 *
 * A request that cannot be placed becomes UNRESOURCED (P1) or DEFERRED (P2/P3) with the diagnostic reason. Primary
 * surveillance platforms are optional: if none can fly, the alternate-surveillance rule tasks vessel observation and a
 * satellite revisit request instead (contingency CT-SURV-ALT is then ACTIVATED).
 */
import type {
  Activity, Assignment, Capability, ContainmentAction, Dependency, Objective, Priority, ProtectionPriorityRow,
  ResponseAsset, SamplingLocation, ShorelineTask, SurveillanceTask,
} from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { addMin, hhmm, iso, ms, overlaps, utc } from '../utils/format';
import { intervalFor, type PlanningContext, type TransitMode } from './PlanningContext';

const D = IAP_CONFIG.durationsMin;

interface Request {
  id: string;
  objective: Objective;
  activity: Activity;
  task: string;
  needs: Capability[];
  boomM?: number | null;
  mode: TransitMode | null;
  sectorId: string | null;
  location: string;
  durationMin: number;
  /** Which assets stay committed until period end. */
  hold?: 'ALL' | Capability[];
  deps: Dependency[];
  requiredInformation: string[];
  successCriteria: string[];
  fallbackAction: string;
  derivedFrom: string[];
  optional?: boolean;
}

export interface AssignmentPlan {
  assignments: Assignment[];
  surveillance: SurveillanceTask[];
  containment: ContainmentAction[];
  sampling: SamplingLocation[];
  shoreline: ShorelineTask[];
  /** Set when primary surveillance could not be tasked and the alternate rule was applied. */
  alternateSurveillance: { reason: string; derivedFrom: string[] } | null;
}

export function planAssignments(ctx: PlanningContext, objectives: Objective[], protection: ProtectionPriorityRow[]): AssignmentPlan {
  const s = ctx.s, fc = s.forecast, sl = s.slick;
  const out: Assignment[] = [];
  const plan: AssignmentPlan = { assignments: out, surveillance: [], containment: [], sampling: [], shoreline: [], alternateSurveillance: null };
  const prevAssets = new Map(s.previousIap?.snapshot.assignments.map((a) => [a.id, a.assetIds]) ?? []);
  const done = (id: string) => s.progress.some((p) => p.refId === id && p.status === 'COMPLETED');
  const byCat = (c: Objective['category']) => objectives.find((o) => o.category === c);
  const resource = (id: string) => s.impactAssessment!.resources.find((r) => r.resourceId === id)!;
  const scheduled = (id: string) => out.find((a) => a.assignmentId === id && a.startTime);
  let briefId: string | null = null;
  const briefDep = (): Dependency[] => (briefId ? [{ type: 'ASSIGNMENT', ref: briefId, note: 'Safety briefing completed' }] : []);

  /* ---------------------------------------------------------------- scheduler */

  const fits = (a: ResponseAsset, from: string, to: string, osFrom: string, osTo: string) =>
    !ctx.availabilityProblem(a, from, to) &&
    !out.some((x) => x.assetIds.includes(a.assetId) && (() => { const iv = intervalFor(x, a.assetId); return iv && overlaps(from, to, iv[0], iv[1]); })()) &&
    !ctx.weatherProblem(a, osFrom, osTo) &&
    !ctx.daylightProblem(a, osFrom, osTo) &&
    staffed(a, from, to);

  const staffed = (a: ResponseAsset, from: string, to: string) => {
    if (!a.personnel) return true;
    const pool = s.personnel.find((p) => p.poolId === a.personnel!.poolId);
    if (!pool || pool.available === null) return true;
    const load = out.filter((x) => x.startTime).reduce((sum, x) => sum + x.assetIds
      .map((id) => ctx.assets.get(id)!)
      .filter((b) => b.personnel?.poolId === pool.poolId && (() => { const iv = intervalFor(x, b.assetId)!; return overlaps(from, to, iv[0], iv[1]); })())
      .reduce((n, b) => n + b.personnel!.count, 0), 0);
    return load + a.personnel.count <= pool.available;
  };

  const category = (problem: string): string =>
    /is UNAVAILABLE/.test(problem) ? 'UNAVAILABLE'
    : /daylight-only/.test(problem) ? 'DAYLIGHT'
    : /operating limit|operating minimum/.test(problem) ? 'WEATHER'
    : /not ready before/.test(problem) ? 'NOT READY'
    : /available only until/.test(problem) ? 'AVAILABILITY ENDS'
    : /committed/.test(problem) ? 'COMMITTED'
    : 'STAFFING';

  /** Short, specific reason why a request could not be placed: the dominant blocking cause over the whole period. */
  const diagnose = (r: Request): string => {
    for (const cap of r.needs) {
      const cands = s.availableAssets.filter((a) => a.capabilities.includes(cap));
      if (!cands.length) return `No asset with ${cap} capability in inventory`;
      if (cands.every((a) => a.availability.status === 'UNAVAILABLE')) return `All ${cap} assets UNAVAILABLE (${cands.map((a) => a.assetId).join(', ')})`;
    }
    if (r.boomM && !s.availableAssets.some((a) => a.capabilities.includes('BOOM') && a.availability.status !== 'UNAVAILABLE' && !out.some((x) => x.assetIds.includes(a.assetId))))
      return 'No uncommitted boom remains in inventory';
    const tr = ctx.transitMin(r.sectorId, r.mode) ?? 0;
    const tally = new Map<string, { assets: Set<string>; hours: number }>();
    for (const cap of r.needs) {
      for (const a of s.availableAssets.filter((x) => x.capabilities.includes(cap))) {
        for (let t = ctx.start; ms(addMin(t, tr + r.durationMin)) <= ms(ctx.end); t = addMin(t, 60)) {
          const on = addMin(t, tr), end = addMin(on, r.durationMin);
          const problem = ctx.availabilityProblem(a, t, end) ?? ctx.daylightProblem(a, on, end) ?? ctx.weatherProblem(a, on, end)
            ?? (out.some((x) => { const iv = intervalFor(x, a.assetId); return x.assetIds.includes(a.assetId) && iv && overlaps(t, end, iv[0], iv[1]); }) ? `${a.assetId} committed` : null)
            ?? (!staffed(a, t, end) ? `${a.assetId} staffing` : null);
          if (!problem) continue;
          const key = category(problem);
          const e = tally.get(key) ?? { assets: new Set<string>(), hours: 0 };
          e.assets.add(a.assetId);
          e.hours += 1;
          tally.set(key, e);
        }
      }
    }
    const best = [...tally.entries()].sort((x, y) => y[1].hours - x[1].hours || y[1].assets.size - x[1].assets.size || x[0].localeCompare(y[0]))[0];
    if (!best) return 'No window in the operational period is long enough for the task duration';
    const who = [...best[1].assets].sort().join(', ');
    const reason: Record<string, string> = {
      DAYLIGHT: `no daylight window in this operational period for ${who} (daylight-only)`,
      WEATHER: `forecast conditions exceed the operating limits of ${who} in every available window`,
      'NOT READY': `${who} not ready in time within this operational period`,
      'AVAILABILITY ENDS': `availability of ${who} ends before the task can be completed`,
      COMMITTED: `${who} committed to higher-priority assignments`,
      UNAVAILABLE: `${who} UNAVAILABLE`,
      STAFFING: `staffing for ${who} already committed`,
    };
    return `NOT TASKED — ${reason[best[0]] ?? `no feasible window for ${who}`}`;
  };

  const place = (r: Request): Assignment | null => {
    const depEnds = r.deps.filter((d) => d.type === 'ASSIGNMENT').map((d) => out.find((x) => x.assignmentId === d.ref)?.targetCompletion).filter((x): x is string => !!x);
    const earliest = iso(Math.max(ms(ctx.start), ...depEnds.map(ms)));
    const prefer = prevAssets.get(r.id) ?? [];
    const order = (xs: ResponseAsset[]) => [...xs].sort((a, b) => Number(!prefer.includes(a.assetId)) - Number(!prefer.includes(b.assetId)) || a.assetId.localeCompare(b.assetId));
    const transit = ctx.transitMin(r.sectorId, r.mode);
    const holdAll = r.hold === 'ALL';

    for (let t = earliest; ; t = addMin(t, IAP_CONFIG.scheduling.stepMin)) {
      const onScene = addMin(t, transit ?? 0), end = addMin(onScene, r.durationMin);
      if (ms(end) > ms(ctx.end)) break;
      const commit = r.hold ? ctx.end : end;
      const holdOf = (cap: Capability) => holdAll || (Array.isArray(r.hold) && r.hold.includes(cap));
      const chosen: ResponseAsset[] = [];
      let ok = true;
      for (const cap of r.needs) {
        const a = order(s.availableAssets.filter((x) => x.capabilities.includes(cap) && !chosen.includes(x))).find((x) => fits(x, t, holdOf(cap) ? commit : end, onScene, end));
        if (!a) { ok = false; break; }
        chosen.push(a);
      }
      if (!ok) continue;
      let boom: ResponseAsset[] = [];
      if (r.boomM) {
        let sum = 0;
        const pool = s.availableAssets.filter((x) => x.capabilities.includes('BOOM') && fits(x, t, commit, onScene, end))
          .sort((a, b) => Number(!prefer.includes(a.assetId)) - Number(!prefer.includes(b.assetId)) || (b.boomLengthM ?? 0) - (a.boomLengthM ?? 0) || a.assetId.localeCompare(b.assetId));
        for (const b of pool) { if (sum >= r.boomM) break; boom.push(b); sum += b.boomLengthM ?? 0; }
        if (!boom.length) continue;
      }
      const assets = [...chosen, ...boom];
      const held = r.hold ? assets.filter((a, i) => (i >= chosen.length ? true : holdOf(r.needs[i]))).map((a) => a.assetId) : [];
      const allocated = boom.reduce((n, b) => n + (b.boomLengthM ?? 0), 0);
      const partial = r.boomM ? allocated < r.boomM : false;
      return emit(r, {
        assetIds: assets.map((a) => a.assetId), startTime: t, onSceneTime: transit === null ? null : onScene, targetCompletion: end,
        commitUntil: r.hold ? ctx.end : null, heldAssetIds: held,
        status: partial ? 'PARTIALLY RESOURCED' : 'PLANNED', statusReason: partial ? `Boom allocated ${allocated} m of ${r.boomM} m required` : null,
      });
    }
    if (r.optional) return null;
    return emit(r, { assetIds: [], startTime: null, onSceneTime: null, targetCompletion: null, commitUntil: null, heldAssetIds: [], status: r.objective.priority === 'P1' ? 'UNRESOURCED' : 'DEFERRED', statusReason: diagnose(r) });
  };

  const emit = (r: Request, x: Pick<Assignment, 'assetIds' | 'startTime' | 'onSceneTime' | 'targetCompletion' | 'commitUntil' | 'heldAssetIds' | 'status' | 'statusReason'>): Assignment => {
    const assets = x.assetIds.map((id) => ctx.assets.get(id)!);
    const deps = [...r.deps];
    for (const a of assets) {
      const fac = s.facilities.find((f) => f.facilityId === a.baseFacilityId);
      if (fac?.clearanceRequired && r.mode === 'vessel' && ctx.transitMin(r.sectorId, 'vessel') !== 0 && !deps.some((d) => d.ref === fac.facilityId))
        deps.push({ type: 'HARBOUR CLEARANCE', ref: fac.facilityId, note: `Departure clearance from ${fac.name}` });
    }
    const a: Assignment = {
      assignmentId: r.id, objectiveId: r.objective.objectiveId, priority: r.objective.priority, activity: r.activity, task: r.task,
      assignedUnit: assets.length ? assets.map((z) => z.name).join(' + ') : 'NOT ASSIGNED',
      ...x, sectorId: r.sectorId, location: r.location, dependencies: deps, requiredInformation: r.requiredInformation, safetyNotes: [],
      successCriteria: r.successCriteria, fallbackAction: r.fallbackAction, assumptionIds: [], source: 'GENERATED',
      boomRequiredM: r.boomM ?? null, derivedFrom: [...r.derivedFrom, ...assets.map((z) => ctx.assetPath(z.assetId, 'availability'))],
    };
    // assumptions the timing relies on
    if (a.startTime) {
      ctx.addAssumption({ assumptionId: 'ASM-DURATION', statement: 'Task durations are planning values (IAP configuration), not measured field times.', basis: 'IapConfig.durationsMin', usedBy: [a.assignmentId], derivedFrom: ['config:durationsMin'] });
      a.assumptionIds.push('ASM-DURATION');
      if (r.mode && a.onSceneTime) {
        ctx.addAssumption({ assumptionId: 'ASM-TRANSIT', statement: 'Transit times from the response base are planning values supplied with the sector data.', basis: 'planningSectors[*].transitMin', usedBy: [a.assignmentId], derivedFrom: ['planningSectors[*].transitMin'] });
        a.assumptionIds.push('ASM-TRANSIT');
      }
      for (const z of assets) {
        if (z.readinessMin !== null && z.readinessMin > 0) {
          const id = `ASM-READY-${z.assetId}`;
          ctx.addAssumption({ assumptionId: id, statement: `${z.name} can mobilise within ${z.readinessMin} min of availability.`, basis: 'Declared by asset owner', usedBy: [a.assignmentId], derivedFrom: [ctx.assetPath(z.assetId, 'readinessMin')] });
          a.assumptionIds.push(id);
        }
        if (z.availability.status === 'DELAYED' && z.availability.from) {
          const id = `ASM-DELAYED-${z.assetId}`;
          ctx.addAssumption({ assumptionId: id, statement: `${z.name} available from ${utc(z.availability.from)} as reported${z.availability.note ? ` (${z.availability.note})` : ''}.`, basis: 'Asset status report', usedBy: [a.assignmentId], derivedFrom: [ctx.assetPath(z.assetId, 'availability')] });
          a.assumptionIds.push(id);
        }
      }
    }
    if (r.mode && ctx.transitMin(r.sectorId, r.mode) === null && r.sectorId)
      ctx.addGap({ gapId: `G-TRANSIT-${r.sectorId}`, description: `Transit time to ${ctx.sectorName(r.sectorId)} NOT AVAILABLE (${r.mode}).`, operationalImpact: 'On-scene times cannot be computed; completion times exclude transit.', actionToResolve: 'Operations to supply transit estimate.', owner: 'Operations Section', priority: 'P2', derivedFrom: [`planningSectors[${r.sectorId}].transitMin.${r.mode} (null)`] });
    out.push(a);
    r.objective.assignmentIds.push(a.assignmentId);
    return a;
  };

  const base = (a: ResponseAsset | undefined) => s.facilities.find((f) => f.facilityId === a?.baseFacilityId)?.name ?? 'response base';

  /* ---------------------------------------------------------------- rules, in objective rank order */

  const surveillanceDone = { value: false };
  for (const o of objectives) {
    switch (o.category) {
      case 'SAFETY': {
        const a = place({
          id: 'A-SAFE-BRIEF', objective: o, activity: 'COMMAND', needs: ['SAFETY_OFFICER'], mode: null, sectorId: null, location: 'Incident command post — field unit leaders in person or by radio', durationMin: D.SAFETY_BRIEF,
          task: s.safetyHazards ? 'Deliver operational-period safety briefing: hazards, mitigations, stop-work criteria and communications check for all field units.' : 'Complete site-safety hazard assessment and brief all field units before deployment (no safety assessment supplied).',
          deps: [], requiredInformation: ['Weather outlook for the operational period', 'Hazard list (Site Safety Plan)'],
          successCriteria: ['All field unit leaders briefed before first deployment; attendance recorded'],
          fallbackAction: 'If the Safety Officer is unavailable, Operations lead delivers the briefing from the written Site Safety Plan.',
          derivedFrom: [...o.derivedFrom, 'rule:SAFETY-BRIEF'],
        });
        if (a?.startTime) briefId = a.assignmentId;
        break;
      }

      case 'PROTECT': {
        const p = protection.find((x) => x.objectiveId === o.objectiveId)!;
        const r = resource(p.resourceId);
        const rid = r.resourceId.replace('-', '');
        const windowText = r.exposureWindow ? `${utc(r.exposureWindow.start)} – ${utc(r.exposureWindow.end)}` : 'window NOT AVAILABLE';
        if (r.stakeholder && !done(`A-NOTIFY-${rid}`)) {
          place({
            id: `A-NOTIFY-${rid}`, objective: o, activity: 'NOTIFICATION', needs: ['LIAISON'], mode: null, sectorId: null, location: r.stakeholder, durationMin: D.NOTIFICATION,
            task: `Advise ${r.stakeholder} of the modelled exposure window for ${r.name} (${windowText}) and record their protective arrangements. No impact has been confirmed.`,
            deps: [], requiredInformation: ['Current exposure window estimate', 'Stakeholder contact point'],
            successCriteria: [r.type === 'CRITICAL INFRASTRUCTURE' ? `${r.stakeholder} acknowledges advisory; intake shutdown readiness and contact point recorded` : `${r.stakeholder} acknowledges advisory; contact point recorded`],
            fallbackAction: 'If contact cannot be established, escalate to the incident command authority for an alternate notification route.',
            derivedFrom: [ctx.resourcePath(r, 'stakeholder'), ctx.resourcePath(r, 'exposureWindow'), `rule:NOTIFY-${r.type}`],
          });
        }
        if (r.protection && r.exposure !== 'CONFIRMED') {
          const staged = done(`A-STAGE-${rid}`);
          const id = staged ? `A-READY-${rid}` : `A-STAGE-${rid}`;
          if (staged) prevAssets.set(id, prevAssets.get(`A-STAGE-${rid}`) ?? prevAssets.get(id) ?? []);
          place({
            id, objective: o, activity: 'PROTECTION', needs: ['BOOM_DEPLOY'], boomM: r.protection.boomRequiredM, mode: staged ? null : 'vessel', sectorId: r.sectorId,
            location: ctx.sectorName(r.sectorId), durationMin: staged ? D.CONTAINMENT_READINESS : D.PROTECTION_STAGING, hold: 'ALL',
            task: staged
              ? `Maintain the staged ${r.protection.method} package at ${ctx.sectorName(r.sectorId)} in deployment readiness; deploy only on trigger DP-PROTECT-${r.resourceId} with command authorization.`
              : `Stage ${r.protection.method} package for ${r.name} at ${ctx.sectorName(r.sectorId)} and hold deployment-ready pending surveillance confirmation and command authorization.`,
            deps: [...briefDep(), ...(fc && fc.confidence.startsWith('LOW') ? [{ type: 'FORECAST UPDATE' as const, ref: null, note: 'Updated drift forecast before relocating staged package' }] : [])],
            requiredInformation: ['Latest leading-edge position (surveillance)', `Updated exposure window for ${r.name}`],
            successCriteria: [
              p.decideBy && ms(p.decideBy) > ms(ctx.start) ? `Package deployment-ready before decision time ${utc(p.decideBy)}` : 'Package deployment-ready as early as possible in this period (decision time reached)',
              `Deployment held pending trigger DP-PROTECT-${r.resourceId} and command authorization`,
            ],
            fallbackAction: 'If the vessel becomes unavailable, hold the package at base and apply contingency CT-VESSEL; if boom is insufficient, protect the highest-priority frontage first (CT-BOOM).',
            derivedFrom: [ctx.resourcePath(r, 'protection'), ctx.resourcePath(r, 'exposureWindow'), ...(staged ? [`progress:A-STAGE-${rid}`] : []), 'rule:PROTECT-STAGE'],
          });
        }
        if (r.type === 'CRITICAL INFRASTRUCTURE' && !done(`A-SENSOR-${rid}`) && s.availableAssets.some((a) => a.capabilities.includes('SENSOR'))) {
          place({
            id: `A-SENSOR-${rid}`, objective: o, activity: 'MONITORING', needs: ['SENSOR', 'SHORELINE_ASSESSMENT'], mode: 'road', sectorId: r.sectorId, location: `${r.name} — intake approach`, durationMin: D.SENSOR_INSTALL, hold: ['SENSOR'],
            task: `Install portable hydrocarbon sensor at ${r.name} as an early-warning indicator for trigger DP-PROTECT-${r.resourceId}.`,
            deps: [...briefDep()], requiredInformation: ['Site access permission from operator'],
            successCriteria: ['Sensor installed, reporting and alarm route to Situation Unit tested'],
            fallbackAction: 'If sensor installation is not possible, request operator visual checks at each vessel status interval.',
            derivedFrom: [ctx.resourcePath(r, 'type'), 'availableAssets[*].capabilities:SENSOR', 'rule:PROTECT-SENSOR'],
          });
        }
        break;
      }

      case 'DELINEATE':
      case 'SURVEIL': {
        if (surveillanceDone.value) break;
        surveillanceDone.value = true;
        const del = byCat('DELINEATE'), sur = byCat('SURVEIL')!;
        const lead = fc?.leadingEdgeSectorId ?? null;
        const slickSector = sl?.sectorId ?? null;
        const airObj = del ?? sur;
        const airArea = [slickSector, lead].filter((x, i, xs) => x && xs.indexOf(x) === i) as string[];
        const failed: { id: string; platform: string; area: string; reason: string; derivedFrom: string[]; priority: Priority }[] = [];

        const airReq: Request = {
          id: 'A-SURV-AIR', objective: airObj, activity: 'SURVEILLANCE_AIR', needs: ['SURVEILLANCE_AIR'], mode: 'air', sectorId: slickSector ?? lead,
          location: airArea.length ? airArea.map((x) => ctx.sectorName(x)).join(' / ') : 'Last reported slick position (sector NOT AVAILABLE)', durationMin: D.SURVEILLANCE_AIR, optional: true,
          task: del
            ? `Aerial reconnaissance of ${airArea.map((x) => ctx.sectorName(x)).join(' and ') || 'the last reported slick position'}: delineate slick boundary, leading edge and fragmentation.`
            : `Aerial surveillance of ${airArea.map((x) => ctx.sectorName(x)).join(' and ')}: update leading-edge position and any change in fragmentation.`,
          deps: [], requiredInformation: ['Latest satellite detection outline', 'Airspace coordination with drone teams'],
          successCriteria: ['Boundary and leading-edge position reported within 30 min of sortie completion', 'Time-stamped imagery archived with position metadata'],
          fallbackAction: 'If the aircraft cannot fly, apply contingency CT-SURV-ALT (vessel observation and satellite revisit request).',
          derivedFrom: [...airObj.derivedFrom, 'rule:SURVEILLANCE-AIR'],
        };
        const air = place(airReq);
        if (!air) failed.push({ id: 'A-SURV-AIR', platform: 'Surveillance aircraft', area: airReq.location, reason: diagnose(airReq), derivedFrom: airReq.derivedFrom, priority: airObj.priority });
        else plan.surveillance.push(survRow(air, del ? 'Delineate slick boundary, leading edge and fragmentation' : 'Update leading-edge position along the forecast corridor', ['Slick boundary / outline', 'Leading-edge position and time', 'Fragmentation and sheen extent', 'Vessels observed near the slick (positions only)']));

        const droneTargets = protection.filter((p) => p.priority === 'P1' || p.priority === 'P2');
        let drones = 0;
        for (const p of droneTargets) {
          const r = resource(p.resourceId), rid = r.resourceId.replace('-', '');
          const req: Request = {
            id: `A-SURV-DRN-${rid}`, objective: sur, activity: 'SURVEILLANCE_DRONE', needs: ['SURVEILLANCE_DRONE'], mode: 'road', sectorId: r.sectorId, location: ctx.sectorName(r.sectorId), durationMin: D.SURVEILLANCE_DRONE, optional: true,
            task: `Drone survey of the ${ctx.sectorName(r.sectorId)} approaches to ${r.name}: detect sheen or oil approaching the resource.`,
            deps: [...briefDep()], requiredInformation: ['Airspace deconfliction with surveillance aircraft', 'Latest leading-edge position'],
            successCriteria: [p.decideBy && ms(p.decideBy) > ms(ctx.start) && ms(p.decideBy) <= ms(ctx.end) ? `Observation of approach sector reported before decision time ${utc(p.decideBy)}` : 'Observation of approach sector reported within 30 min of flight completion'],
            fallbackAction: 'If flight is suspended, request shore-based visual observation by the shore team and apply CT-SURV-ALT.',
            derivedFrom: [ctx.resourcePath(r, 'sectorId'), ctx.resourcePath(r, 'exposure'), 'rule:SURVEILLANCE-DRONE'],
          };
          const a = place(req);
          if (a) { drones++; plan.surveillance.push(survRow(a, `Verify whether oil approaches ${r.name}`, ['Sheen or oil within approach sector', 'Direction of movement relative to the resource'])); }
          else failed.push({ id: req.id, platform: 'Drone team', area: req.location, reason: diagnose(req), derivedFrom: req.derivedFrom, priority: sur.priority });
        }

        if (!air && (slickSector || lead || !sl)) {
          const reasons = failed.map((f) => `${f.id}: ${f.reason}`);
          plan.alternateSurveillance = { reason: `Primary aerial surveillance could not be tasked${drones ? '' : ' and no drone flight is possible'} — ${reasons[0] ?? 'no platform'}`, derivedFrom: failed.flatMap((f) => f.derivedFrom).filter((x) => x.startsWith('availableAssets') || x.startsWith('rule')).concat(['availableAssets[*].capabilities:SURVEILLANCE_AIR', 'currentSituation.daylight']) };
          const vsl = place({
            id: 'A-SURV-VSL', objective: airObj, activity: 'SURVEILLANCE_VESSEL', needs: ['SURVEILLANCE_VESSEL'], mode: 'vessel', sectorId: lead ?? slickSector, location: ctx.sectorName(lead ?? slickSector), durationMin: D.SURVEILLANCE_VESSEL,
            task: `Vessel observation of the leading edge in ${ctx.sectorName(lead ?? slickSector)} (alternate surveillance CT-SURV-ALT): report position of oil and any change in fragmentation.`,
            deps: [...briefDep()], requiredInformation: ['Latest satellite detection outline', 'Last reported leading-edge position'],
            successCriteria: ['Leading-edge position reported at each vessel status interval'],
            fallbackAction: 'If no vessel can observe, rely on satellite revisit and request additional platforms from command.',
            derivedFrom: ['rule:CT-SURV-ALT', ...(lead ? ['forecast.leadingEdgeSectorId'] : ['slick.sectorId'])],
          });
          if (vsl?.startTime) plan.surveillance.push(survRow(vsl, 'Maintain leading-edge position without aerial platforms', ['Oil / sheen at leading edge', 'Visible fragmentation']));
          const sar = place({
            id: 'A-SURV-SAR', objective: airObj, activity: 'INFORMATION', needs: ['SITUATION_UNIT'], mode: null, sectorId: slickSector ?? lead, location: 'Situation Unit', durationMin: D.INFORMATION_REQUEST,
            task: `Request satellite SAR revisit over ${airArea.map((x) => ctx.sectorName(x)).join(' and ') || 'the incident area'} (request placeholder — acquisition not confirmed).`,
            deps: [], requiredInformation: ['Satellite tasking contact (placeholder)'],
            successCriteria: ['Revisit request submitted and expected acquisition time reported to command'],
            fallbackAction: 'If no acquisition is possible in this period, record the gap and continue vessel observation.',
            derivedFrom: ['rule:CT-SURV-ALT', 'slick.source'],
          });
          if (sar?.startTime) plan.surveillance.push({ ...survRow(sar, 'Obtain independent wide-area detection', ['Slick outline', 'New detections outside the forecast corridor']), platform: 'Satellite SAR (request placeholder)', window: null });
        }
        for (const f of failed) {
          plan.surveillance.push({ taskId: f.id, assignmentId: null, objective: 'Primary platform — not tasked', area: f.area, priority: f.priority, window: null, platform: f.platform, reportingRequirement: '—', evidenceSought: [], status: f.reason.startsWith('NOT TASKED') ? f.reason : `NOT TASKED — ${f.reason}`, derivedFrom: f.derivedFrom });
        }
        break;
      }

      case 'CONTAIN': {
        const sector = fc?.interceptionSectorIds[0] ?? null;
        const cap = s.availableAssets.filter((a) => a.capabilities.includes('CONTAINMENT'));
        const a = place({
          id: 'A-CONT-READY', objective: o, activity: 'CONTAINMENT', needs: ['CONTAINMENT', 'RECOVERY'], mode: null, sectorId: sector, location: sector ? `${base(cap[0])} (readiness for ${ctx.sectorName(sector)})` : base(cap[0]), durationMin: D.CONTAINMENT_READINESS, hold: 'ALL',
          task: sector
            ? `Hold containment and recovery package in readiness for interception sector ${ctx.sectorName(sector)}; pre-position only on command decision and deploy only on trigger DP-CONTAIN.`
            : 'Hold containment and recovery package in readiness at base; interception placement cannot be prioritized from forecast guidance.',
          deps: [...briefDep()], requiredInformation: ['Verified leading-edge position', 'Sea state in interception sector'],
          successCriteria: ['Package crewed, fuelled and ready to sail within declared readiness time throughout the period'],
          fallbackAction: 'If the containment vessel becomes unavailable, apply CT-VESSEL and request external containment support.',
          derivedFrom: [...o.derivedFrom, 'rule:CONTAIN-READINESS'],
        })!;
        if (!cap.length) {
          ctx.addConstraint({ constraintId: 'C-CONTAIN', type: 'RESOURCE', description: 'No containment-capable asset in inventory.', from: null, to: null, derivedFrom: ['availableAssets[*].capabilities:CONTAINMENT (none)'], affectsAssignments: [a.assignmentId] });
          ctx.addGap({ gapId: 'G-CONTAIN', description: 'Availability of additional containment equipment unconfirmed.', operationalImpact: 'No interception capability can be planned.', actionToResolve: 'Request external / mutual-aid containment capability.', owner: 'Logistics Section', priority: 'P1', derivedFrom: ['availableAssets[*].capabilities:CONTAINMENT (none)'] });
        }
        const transit = ctx.transitMin(sector, 'vessel');
        plan.containment.push({
          actionId: 'CA-01', sectorId: sector,
          planningStatus: !a.startTime ? 'UNRESOURCED' : !sector ? 'NOT PLANNABLE — HOLD AT BASE' : fc && (fc.confidence.startsWith('LOW') || s.currentSituation.verification === 'SATELLITE_ONLY') ? 'PENDING FIELD VERIFICATION' : 'PROPOSED — PLANNING BASIS',
          purpose: sector ? `Interception of the leading edge before it reaches nearshore priority sectors (planning basis: forecast ${fc!.confidence})` : 'Maintain containment capability without a supported interception sector',
          triggerCondition: 'DP-CONTAIN — surveillance confirms oil in or entering the interception sector and sea state is within vessel limits',
          assignmentId: a.assignmentId, assetIds: a.assetIds,
          deploymentReadiness: a.startTime ? `Ready at base from ${utc(a.targetCompletion)}; transit to sector ${transit === null ? 'NOT AVAILABLE' : `${transit} min`}` : `NOT READY — ${a.statusReason}`,
          constraints: [...(sector ? [] : ['Containment placement cannot be prioritized from forecast guidance']), 'Effectiveness depends on sea state, slick fragmentation and verified position — no containment outcome is assured'],
          confidence: fc?.confidence ?? 'UNAVAILABLE',
          derivedFrom: [fc ? 'forecast.interceptionSectorIds' : 'forecast (null)', 'forecast.confidence', 'currentSituation.verification', 'rule:CONTAIN-READINESS'],
        });
        break;
      }

      case 'CHARACTERISE': {
        const collected = done('A-SMP-OFFSHORE');
        if (collected) {
          place({
            id: 'A-LAB-TRACK', objective: o, activity: 'INFORMATION', needs: ['SITUATION_UNIT'], mode: null, sectorId: null, location: 'Situation Unit / laboratory liaison', durationMin: D.INFORMATION_REQUEST,
            task: 'Track laboratory analysis of slick samples S-01 to S-03 and report the expected result time to command.', deps: [], requiredInformation: ['Laboratory reference numbers of submitted samples'],
            successCriteria: ['Laboratory status and expected result time reported to command'], fallbackAction: 'If no result time is available, maintain precautionary PPE and tactics (CT-OIL-ID).',
            derivedFrom: ['currentSituation.oilType (null)', 'progress:A-SMP-OFFSHORE', 'rule:CHARACTERISE-LAB'],
          });
          break;
        }
        const lead = fc?.leadingEdgeSectorId ?? sl!.sectorId;
        const a = place({
          id: 'A-SMP-OFFSHORE', objective: o, activity: 'SAMPLING', needs: ['SAMPLING', 'TRANSPORT'], mode: 'vessel', sectorId: sl!.sectorId, location: [sl!.sectorId, lead].filter((x, i, xs) => x && xs.indexOf(x) === i).map((x) => ctx.sectorName(x)).join(' / '), durationMin: D.SAMPLING_OFFSHORE,
          task: `Collect samples S-01 (slick centre), S-02 (leading edge) and S-03 (outside-slick background) under chain of custody.`,
          deps: [...briefDep()], requiredInformation: ['Latest slick outline for sample positioning', 'Sample kit and custody forms (placeholder)'],
          successCriteria: ['Three samples collected with position, time and custody record', 'Samples handed to laboratory liaison with custody unbroken'],
          fallbackAction: 'If sea state prevents sampling, collect S-03 background only and defer S-01 / S-02 to the next suitable window.',
          derivedFrom: ['currentSituation.oilType (null)', 'slick.sectorId', 'rule:CHARACTERISE-SAMPLING'],
        })!;
        const when = timeRange(a);
        plan.sampling.push(
          sample('S-01', `Suspected slick centre — ${ctx.sectorName(sl!.sectorId)}`, 'Confirm presence and obtain material for oil identification', o.priority, a, when, ['slick.sectorId']),
          sample('S-02', `Leading edge — ${ctx.sectorName(lead)}`, 'Characterise leading-edge material approaching nearshore sectors', o.priority, a, when, [fc ? 'forecast.leadingEdgeSectorId' : 'slick.sectorId']),
          sample('S-03', `Outside-slick reference / background — ${ctx.sectorName(sl!.sectorId)}`, 'Background reference for comparison', o.priority, a, when, ['rule:SAMPLING-BACKGROUND']),
        );
        break;
      }

      case 'SAMPLE': {
        // reference points: the highest-ranked planned resource, plus the highest-ranked shoreline resource
        const planned = protection.filter((p) => p.priority !== 'MONITOR');
        const shore = planned.find((p) => resource(p.resourceId).shoreline);
        const res = [planned[0], ...(shore && shore !== planned[0] ? [shore] : [])].filter(Boolean).map((p) => ({ p, r: resource(p.resourceId) }));
        const a = place({
          id: 'A-SMP-NEARSHORE', objective: o, activity: 'SAMPLING', needs: ['SAMPLING'], mode: 'road', sectorId: res[0].r.sectorId, location: res.map(({ r }) => ctx.sectorName(r.sectorId)).join(' / '), durationMin: D.SAMPLING_NEARSHORE,
          task: `Collect pre-exposure reference samples at ${res.map(({ r }, i) => `S-0${i + 4} (${r.name})`).join(' and ')} under chain of custody.`,
          deps: [...briefDep()], requiredInformation: ['Site access permissions', 'Sample kit and custody forms (placeholder)'],
          successCriteria: ['Reference samples collected at each listed resource with custody records'],
          fallbackAction: 'If access is refused, record the refusal and sample the nearest accessible point with position noted.',
          derivedFrom: [...o.derivedFrom, 'rule:SAMPLING-REFERENCE'],
        })!;
        res.forEach(({ p, r }, i) => plan.sampling.push(sample(`S-0${i + 4}`, `Near ${r.name} — ${ctx.sectorName(r.sectorId)}`, r.shoreline ? 'Pre-exposure reference at potential shoreline exposure area' : 'Pre-exposure reference near threatened infrastructure', p.priority as Priority, a, timeRange(a), [ctx.resourcePath(r, 'exposure'), ctx.resourcePath(r, 'sectorId')])));
        break;
      }

      case 'SHORELINE': {
        const confirmed = s.currentSituation.shorelineContact === 'CONFIRMED';
        const res = protection.filter((p) => (p.priority === 'P1' || p.priority === 'P2') && resource(p.resourceId).shoreline).map((p) => resource(p.resourceId));
        for (const r of res) {
          const rid = r.resourceId.replace('-', '');
          if (!confirmed && done(`A-SHORE-${rid}`)) {
            plan.shoreline.push({ taskId: `SH-${rid}`, mode: 'PREPARATION', resourceId: r.resourceId, sectorId: r.sectorId, action: 'Baseline pre-assessment completed in previous period; hold shoreline team for escalation.', assignmentId: null, escalationTrigger: 'DP-SHORE', derivedFrom: [`progress:A-SHORE-${rid}`] });
            continue;
          }
          const a = place({
            id: `A-SHORE-${rid}`, objective: o, activity: 'SHORELINE', needs: ['SHORELINE_ASSESSMENT'], mode: 'road', sectorId: r.sectorId, location: ctx.sectorName(r.sectorId), durationMin: D.SHORELINE_PREASSESSMENT,
            task: confirmed
              ? `Assess reported shoreline contact at ${r.name}: delineate affected segments and prepare authorised shoreline response options.`
              : `Pre-impact shoreline assessment of ${r.name}: record baseline condition, access points and potential staging areas. PREPARATION ONLY — no shoreline contact confirmed.`,
            deps: [...briefDep()], requiredInformation: ['Access permissions / tide times (placeholder)'],
            successCriteria: [confirmed ? 'Affected segments delineated and reported to Operations' : 'Baseline photographs, access points and staging options reported to Operations'],
            fallbackAction: 'If access is not possible, record from the nearest vantage point and request drone imagery.',
            derivedFrom: ['currentSituation.shorelineContact', ctx.resourcePath(r, 'shoreline'), ctx.resourcePath(r, 'exposure'), 'rule:SHORELINE'],
          })!;
          plan.shoreline.push({ taskId: `SH-${rid}`, mode: confirmed ? 'ACTIVE RESPONSE' : 'PREPARATION', resourceId: r.resourceId, sectorId: r.sectorId, action: a.task, assignmentId: a.assignmentId, escalationTrigger: confirmed ? null : 'DP-SHORE', derivedFrom: a.derivedFrom });
        }
        break;
      }

      case 'INFORMATION': {
        const env = s.environment;
        const items: [string, string, string, string][] = [];
        if (!fc) items.push(['A-INFO-FCST', 'Request updated drift forecast for the incident area and priority resources.', 'Updated forecast received by Situation Unit', 'forecast (null)']);
        if (!env) items.push(['A-INFO-ENV', 'Obtain marine weather observations and outlook for the operational period.', 'Weather outlook received by Situation Unit', 'environment (null)']);
        else {
          if (env.windSpeedMs === null) items.push(['A-INFO-WIND', 'Restore wind observations (met service / on-scene vessel reports).', 'Wind observations available to Situation Unit', 'environment.windSpeedMs (null)']);
          if (env.waveHsM === null) items.push(['A-INFO-WAVE', 'Restore wave observations (met service / on-scene vessel reports).', 'Wave observations available to Situation Unit', 'environment.waveHsM (null)']);
        }
        for (const [id, task, crit, from] of items)
          place({ id, objective: o, activity: 'INFORMATION', needs: ['SITUATION_UNIT'], mode: null, sectorId: null, location: 'Situation Unit', durationMin: D.INFORMATION_REQUEST, task, deps: [], requiredInformation: [], successCriteria: [crit], fallbackAction: 'If not available, record the gap in the next SITREP and apply precautionary limits.', derivedFrom: [from, 'rule:INFORMATION-RESTORE'] });
        break;
      }

      case 'EVIDENCE': {
        const src = scheduled('A-SURV-AIR') ?? scheduled('A-SURV-VSL');
        place({
          id: 'A-EVID', objective: o, activity: 'INFORMATION', needs: ['SITUATION_UNIT'], mode: null, sectorId: null, location: 'Situation Unit', durationMin: D.EVIDENCE_RECORD,
          task: 'Compile time-stamped surveillance imagery and positions of vessels observed near the slick for the separate source investigation. Candidate analytical support only — no attribution is implied.',
          deps: src ? [{ type: 'ASSIGNMENT', ref: src.assignmentId, note: 'Surveillance imagery available' }] : [], requiredInformation: ['Surveillance imagery with time and position metadata'],
          successCriteria: ['Observation record archived with time and position metadata'], fallbackAction: 'If no imagery is obtained, archive satellite detection metadata only.',
          derivedFrom: ['vesselAssessment.candidates', 'rule:EVIDENCE-PRESERVE'],
        });
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- directed assignments (Operations / Planning staff) */
  for (const d of s.directedAssignments) {
    out.push({ ...d, source: 'DIRECTED' });
    objectives.find((o) => o.objectiveId === d.objectiveId)?.assignmentIds.push(d.assignmentId);
  }

  /* ---------------------------------------------------------------- objective status */
  for (const o of objectives) {
    const as = out.filter((a) => a.objectiveId === o.objectiveId);
    if (!as.length) continue;
    if (as.every((a) => !a.startTime)) o.status = 'UNRESOURCED';
    else if (as.some((a) => !a.startTime || a.status === 'PARTIALLY RESOURCED')) o.status = 'PARTIALLY RESOURCED';
  }
  // boom shortfall surfaces as a constraint on every affected objective
  const short = out.filter((a) => a.boomRequiredM && (a.status === 'PARTIALLY RESOURCED' || !a.startTime));
  if (short.length) {
    const inv = s.availableAssets.filter((a) => a.capabilities.includes('BOOM') && a.availability.status !== 'UNAVAILABLE').reduce((n, a) => n + (a.boomLengthM ?? 0), 0);
    const req = out.reduce((n, a) => n + (a.boomRequiredM ?? 0), 0);
    ctx.addConstraint({ constraintId: 'C-BOOM', type: 'RESOURCE', description: `Boom inventory ${inv} m against ${req} m required for planned protection — highest-priority resources are protected first.`, from: null, to: null, derivedFrom: ['availableAssets[*].boomLengthM', 'impactAssessment.resources[*].protection.boomRequiredM'], affectsAssignments: short.map((a) => a.assignmentId) });
    ctx.addGap({ gapId: 'G-BOOM', description: 'Availability of additional boom unconfirmed.', operationalImpact: `Protection of ${short.map((a) => a.assignmentId).join(', ')} is incomplete.`, actionToResolve: 'Logistics to confirm external / mutual-aid boom availability and arrival time.', owner: 'Logistics Section', priority: short.some((a) => a.priority === 'P1') ? 'P1' : 'P2', derivedFrom: ['availableAssets[*].boomLengthM', 'rule:BOOM-SHORTFALL'] });
    for (const a of short) objectives.find((o) => o.objectiveId === a.objectiveId)?.constraints.push(a.statusReason ?? 'Boom shortfall');
  }
  return plan;

  /* ---------------------------------------------------------------- row helpers */

  function timeRange(a: Assignment) {
    return a.startTime ? `${hhmm(a.onSceneTime ?? a.startTime, ctx.start)}–${hhmm(a.targetCompletion, ctx.start)} UTC` : `NOT SCHEDULED — ${a.status}`;
  }
  function survRow(a: Assignment, objective: string, evidence: string[]): SurveillanceTask {
    return {
      taskId: a.assignmentId, assignmentId: a.assignmentId, objective, area: a.location, priority: a.priority,
      window: a.startTime ? { from: a.onSceneTime ?? a.startTime, to: a.targetCompletion! } : null,
      platform: a.assignedUnit,
      reportingRequirement: a.targetCompletion ? `Report to Situation Unit by ${hhmm(addMin(a.targetCompletion, IAP_CONFIG.reporting.boundaryReportAfterMin), ctx.start)} UTC` : '—',
      evidenceSought: evidence, status: a.status, derivedFrom: a.derivedFrom,
    };
  }
  function sample(id: string, location: string, purpose: string, priority: Priority, a: Assignment, timing: string, derivedFrom: string[]): SamplingLocation {
    return {
      sampleId: id, location, purpose, priority, sampleType: 'Surface water / oil sample — type and container per laboratory protocol (placeholder)', timing,
      assignmentId: a.assignmentId, assignedTeam: a.assignedUnit, chainOfCustody: 'Required — custody form from collection to laboratory receipt',
      requiredMetadata: ['Sample ID', 'Position (lat/lon)', 'Time (UTC)', 'Collector', 'Weather / sea state', 'Photograph reference'],
      derivedFrom: [...derivedFrom, 'rule:SAMPLING-PLAN'],
    };
  }
}

