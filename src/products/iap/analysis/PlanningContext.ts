/**
 * Shared planning state: lookups, the ledger of DERIVED gaps / constraints / assumptions, and the time predicates
 * (availability, operating limits, daylight, transit). The scheduler and the validator use the SAME predicates, so
 * the validator re-checks the plan independently of how it was built.
 */
import type {
  Assignment, AssumptionRow, ConstraintRow, GapRow, IapIncidentState, PlanningSector, ResponseAsset, ThreatenedResource,
} from '../IapTypes';
import { addMin, fmt, ms, overlaps, utc } from '../utils/format';

export type TransitMode = 'vessel' | 'air' | 'road';

export const modeOf = (a: ResponseAsset): TransitMode | null =>
  a.kind === 'RESPONSE VESSEL' || a.kind === 'PATROL VESSEL' ? 'vessel' : a.kind === 'AIRCRAFT' ? 'air' : a.kind === 'COMMAND' || a.kind === 'BOOM' || a.kind === 'SKIMMER' ? null : 'road';

/** Interval for which an assignment commits `assetId` (held assets until commitUntil), or null when not scheduled. */
export function intervalFor(a: Pick<Assignment, 'startTime' | 'targetCompletion' | 'commitUntil' | 'heldAssetIds'>, assetId: string): [string, string] | null {
  if (!a.startTime || !a.targetCompletion) return null;
  return [a.startTime, a.commitUntil && a.heldAssetIds.includes(assetId) ? a.commitUntil : a.targetCompletion];
}

export class PlanningContext {
  readonly start: string;
  readonly end: string;
  readonly assets = new Map<string, ResponseAsset>();
  readonly sectors = new Map<string, PlanningSector>();
  readonly gaps: GapRow[] = [];
  readonly constraints: ConstraintRow[] = [];
  readonly assumptions: AssumptionRow[] = [];
  private assetIdx = new Map<string, number>();

  constructor(readonly s: IapIncidentState) {
    this.start = s.operationalPeriod.periodStart;
    this.end = s.operationalPeriod.periodEnd;
    s.availableAssets.forEach((a, i) => (this.assets.set(a.assetId, a), this.assetIdx.set(a.assetId, i)));
    s.planningSectors.forEach((x) => this.sectors.set(x.sectorId, x));
  }

  /* ---------------------------------------------------------------- traceability paths */

  assetPath(id: string, field = '') {
    const i = this.assetIdx.get(id);
    return i === undefined ? `availableAssets[${id}]` : `availableAssets[${i}]${field ? `.${field}` : ''}`;
  }
  resourcePath(r: ThreatenedResource, field = '') {
    const i = this.s.impactAssessment?.resources.indexOf(r) ?? -1;
    return `impactAssessment.resources[${i}]${field ? `.${field}` : ''}`;
  }
  sectorName(id: string | null) {
    if (!id) return 'SECTOR NOT AVAILABLE';
    const x = this.sectors.get(id);
    return x ? `${x.sectorId} ${x.name}` : id;
  }

  /* ---------------------------------------------------------------- ledger (dedupe by id, merge traceability) */

  addGap(g: Omit<GapRow, 'source'>) {
    merge(this.gaps, { ...g, source: 'DERIVED' }, 'gapId');
  }
  addConstraint(c: Omit<ConstraintRow, 'source' | 'affectsAssignments' | 'appliesTo'> & { affectsAssignments?: string[]; appliesTo?: ConstraintRow['appliesTo'] }) {
    merge(this.constraints, { affectsAssignments: [], appliesTo: [], ...c, source: 'DERIVED' }, 'constraintId');
  }
  addAssumption(a: Omit<AssumptionRow, 'source'>) {
    merge(this.assumptions, { ...a, source: 'DERIVED' }, 'assumptionId');
  }

  /* ---------------------------------------------------------------- predicates */

  /** Earliest time the asset can start work (availability + declared readiness), or null if unknown. */
  readyAt(a: ResponseAsset): string | null {
    if (a.availability.status === 'UNAVAILABLE' || a.availability.from === null) return null;
    return addMin(a.availability.from, a.readinessMin ?? 0);
  }

  /** Why the asset cannot be committed over [from, to]; null when it can. */
  availabilityProblem(a: ResponseAsset, from: string, to: string): string | null {
    const av = a.availability;
    if (av.status === 'UNAVAILABLE') return `${a.assetId} is UNAVAILABLE${av.note ? ` (${av.note})` : ''}`;
    if (av.from === null || av.status === 'UNKNOWN') return `${a.assetId} availability is NOT AVAILABLE`;
    const ready = this.readyAt(a)!;
    if (ms(from) < ms(ready)) return `${a.assetId} tasked from ${utc(from)} but not ready before ${utc(ready)}`;
    if (av.until && ms(to) > ms(av.until)) return `${a.assetId} committed until ${utc(to)} but available only until ${utc(av.until)}`;
    return null;
  }

  /** Operating-limit breach over the on-scene interval, from the weather outlook. Unknown values never block. */
  weatherProblem(a: ResponseAsset, from: string, to: string): string | null {
    const lim = a.limits;
    if (!lim || !this.s.environment) return null;
    for (const w of this.s.environment.outlook) {
      if (!overlaps(from, to, w.from, w.to)) continue;
      if (lim.maxWindMs !== null && w.windSpeedMs !== null && w.windSpeedMs > lim.maxWindMs)
        return `${a.assetId}: forecast wind ${fmt.ms(w.windSpeedMs)} exceeds operating limit ${fmt.ms(lim.maxWindMs)} (${utc(w.from)}–${utc(w.to).slice(11)})`;
      if (lim.maxWaveHsM !== null && w.waveHsM !== null && w.waveHsM > lim.maxWaveHsM)
        return `${a.assetId}: forecast Hs ${fmt.m(w.waveHsM)} exceeds operating limit ${fmt.m(lim.maxWaveHsM)} (${utc(w.from)}–${utc(w.to).slice(11)})`;
      if (lim.minVisibilityKm !== null && w.visibilityKm !== null && w.visibilityKm < lim.minVisibilityKm)
        return `${a.assetId}: forecast visibility ${fmt.km(w.visibilityKm)} below operating minimum ${fmt.km(lim.minVisibilityKm)} (${utc(w.from)}–${utc(w.to).slice(11)})`;
    }
    return null;
  }

  /** Daylight-only asset working outside the supplied daylight intervals. Unknown daylight never blocks. */
  daylightProblem(a: ResponseAsset, from: string, to: string): string | null {
    if (!a.limits?.daylightOnly || !this.s.currentSituation.daylight) return null;
    const inside = this.s.currentSituation.daylight.some((d) => ms(from) >= ms(d.sunrise) && ms(to) <= ms(d.sunset));
    return inside ? null : `${a.assetId} is daylight-only; ${utc(from)}–${utc(to).slice(11)} is outside daylight`;
  }

  transitMin(sectorId: string | null, mode: TransitMode | null): number | null {
    if (mode === null) return 0;
    if (!sectorId) return null;
    return this.sectors.get(sectorId)?.transitMin[mode] ?? null;
  }
}

function merge<T extends { derivedFrom: string[] }>(list: T[], item: T, key: keyof T) {
  const existing = list.find((x) => x[key] === item[key]);
  if (!existing) return void list.push(item);
  for (const d of item.derivedFrom) if (!existing.derivedFrom.includes(d)) existing.derivedFrom.push(d);
  const ea = existing as any, ia = item as any;
  if (Array.isArray(ea.usedBy)) for (const u of ia.usedBy ?? []) if (!ea.usedBy.includes(u)) ea.usedBy.push(u);
  if (Array.isArray(ea.affectsAssignments)) for (const u of ia.affectsAssignments ?? []) if (!ea.affectsAssignments.includes(u)) ea.affectsAssignments.push(u);
}
