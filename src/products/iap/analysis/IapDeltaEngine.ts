/**
 * What changed since the previous IAP. Deterministic comparison of two IapSnapshots, with progress reports deciding
 * whether a disappeared objective / assignment was COMPLETED or CANCELLED.
 *
 *   NEW        added objective, assignment, threat, hazard, gap, asset on a continuing assignment
 *   CHANGED    priority, exposure, assets, forecast sector, contingency activation, sample priority
 *   DEGRADED   asset lost or delayed, forecast / weather data lost, confidence lowered
 *   RESOLVED   asset restored, data restored, gap closed, hazard cleared, threat left the envelope
 *   COMPLETED  objective / assignment reported complete
 *   CANCELLED  objective / assignment withdrawn (reported cancelled, or not carried forward)
 *   UNCHANGED  key continuing facts: P1 objectives, shoreline contact status
 */
import type { DeltaKind, IapDelta, IapSnapshot, Level, ProgressReport } from '../IapTypes';
import { hhmm, minutesBetween, ms } from '../utils/format';

export const KIND_ORDER: DeltaKind[] = ['NEW', 'CHANGED', 'DEGRADED', 'RESOLVED', 'COMPLETED', 'CANCELLED', 'UNCHANGED'];
const LEVELS: Level[] = ['UNAVAILABLE', 'LOW', 'LOW-MEDIUM', 'MEDIUM', 'MEDIUM-HIGH', 'HIGH'];
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function compareIapStates(prev: IapSnapshot, cur: IapSnapshot, progress: ProgressReport[] = []): IapDelta[] {
  const out: IapDelta[] = [];
  const d = (kind: DeltaKind, category: IapDelta['category'], key: string, from: string | null, to: string | null, significance: IapDelta['significance'], text: string) =>
    out.push({ kind, category, key, from, to, significance, text });
  const report = (id: string) => progress.find((p) => p.refId === id);
  const assetName = (id: string) => cur.assets.find((a) => a.id === id)?.name ?? prev.assets.find((a) => a.id === id)?.name ?? id;

  /* objectives */
  for (const o of cur.objectives) {
    const p = prev.objectives.find((x) => x.id === o.id);
    if (!p) d('NEW', 'OBJECTIVE', `objective.${o.id}`, null, o.priority, o.priority === 'P1' ? 'HIGH' : 'MEDIUM', `Objective ${o.id} (${o.priority}) added: ${short(o.statement)}`);
    else if (p.priority !== o.priority) d('CHANGED', 'OBJECTIVE', `objective.${o.id}.priority`, p.priority, o.priority, 'HIGH', `Objective ${o.id} priority ${p.priority} → ${o.priority}: ${short(o.statement, 90)}`);
    else if (o.priority === 'P1' && o.id !== 'OBJ-SAFETY') d('UNCHANGED', 'OBJECTIVE', `objective.${o.id}`, o.priority, o.priority, 'MEDIUM', `Objective ${o.id} continues at P1.`);
  }
  for (const p of prev.objectives.filter((x) => !cur.objectives.some((o) => o.id === x.id))) {
    const r = report(p.id);
    if (r?.status === 'COMPLETED') d('COMPLETED', 'OBJECTIVE', `objective.${p.id}`, p.priority, 'COMPLETED', 'HIGH', `Objective ${p.id} completed (${hhmm(r.reportedAt)} UTC): ${r.note}`);
    else d('CANCELLED', 'OBJECTIVE', `objective.${p.id}`, p.priority, 'CANCELLED', 'MEDIUM', `Objective ${p.id} ${r?.status === 'CANCELLED' ? `cancelled: ${r.note}` : 'not carried forward — its generating condition no longer applies'}.`);
  }

  /* assignments */
  for (const a of cur.assignments) {
    const p = prev.assignments.find((x) => x.id === a.id);
    if (!p) { d('NEW', 'ASSIGNMENT', `assignment.${a.id}`, null, a.status, a.priority === 'P1' ? 'HIGH' : 'MEDIUM', `Assignment ${a.id} added (${a.start ? a.assetIds.join(', ') : `${a.status} — not resourced this period`}): ${short(a.task, 110)}`); continue; }
    const wasPlaced = !!p.start, isPlaced = !!a.start;
    if (wasPlaced && isPlaced) {
      for (const id of a.assetIds.filter((x) => !p.assetIds.includes(x))) d('NEW', 'ASSIGNMENT', `assignment.${a.id}.asset.${id}`, null, id, 'MEDIUM', `${assetName(id)} added to ${a.id}.`);
      for (const id of p.assetIds.filter((x) => !a.assetIds.includes(x))) d('CHANGED', 'ASSIGNMENT', `assignment.${a.id}.asset.${id}`, id, null, 'MEDIUM', `${assetName(id)} released from ${a.id}.`);
    }
    if (p.priority !== a.priority) d('CHANGED', 'ASSIGNMENT', `assignment.${a.id}.priority`, p.priority, a.priority, 'MEDIUM', `Assignment ${a.id} priority ${p.priority} → ${a.priority}.`);
    if (wasPlaced && !isPlaced) d('DEGRADED', 'ASSIGNMENT', `assignment.${a.id}.status`, p.status, a.status, 'HIGH', `Assignment ${a.id} could not be resourced this period (${a.status}; previously ${p.assetIds.join(', ')}).`);
    if (!wasPlaced && isPlaced) d('RESOLVED', 'ASSIGNMENT', `assignment.${a.id}.status`, p.status, a.status, 'MEDIUM', `Assignment ${a.id} now resourced with ${a.assetIds.join(', ')} (was ${p.status}).`);
  }
  for (const p of prev.assignments.filter((x) => !cur.assignments.some((a) => a.id === x.id))) {
    const r = report(p.id);
    if (r?.status === 'COMPLETED') d('COMPLETED', 'ASSIGNMENT', `assignment.${p.id}`, p.status, 'COMPLETED', p.priority === 'P1' ? 'HIGH' : 'MEDIUM', `Assignment ${p.id} completed (${hhmm(r.reportedAt)} UTC): ${r.note}`);
    else d('CANCELLED', 'ASSIGNMENT', `assignment.${p.id}`, p.status, 'CANCELLED', 'MEDIUM', `Assignment ${p.id} ${r?.status === 'CANCELLED' ? `cancelled: ${r.note}` : 'not carried forward.'}`);
  }

  /* assets */
  for (const a of cur.assets) {
    const p = prev.assets.find((x) => x.id === a.id);
    if (!p) { d('NEW', 'ASSET', `asset.${a.id}`, null, a.status, 'MEDIUM', `${a.name} added to available resources (${a.status}${a.availableFrom ? ` from ${hhmm(a.availableFrom)} UTC` : ''}).`); continue; }
    if (p.status !== a.status) {
      const worse = a.status === 'UNAVAILABLE' || (a.status === 'DELAYED' && p.status === 'AVAILABLE') || a.status === 'UNKNOWN';
      d(worse ? 'DEGRADED' : 'RESOLVED', 'ASSET', `asset.${a.id}.status`, p.status, a.status, 'HIGH', `${a.name} now ${a.status} (was ${p.status}).`);
    } else if (p.availableFrom && a.availableFrom && ms(a.availableFrom) > ms(p.availableFrom) && a.status === 'DELAYED') {
      d('DEGRADED', 'ASSET', `asset.${a.id}.availableFrom`, p.availableFrom, a.availableFrom, 'MEDIUM', `${a.name} delayed by ${Math.round(minutesBetween(p.availableFrom, a.availableFrom))} minutes.`);
    }
  }

  /* threats */
  for (const r of cur.resources) {
    const p = prev.resources.find((x) => x.id === r.id);
    if (!p) { d('NEW', 'THREAT', `resource.${r.id}`, null, r.exposure, r.priority === 'P1' ? 'HIGH' : 'MEDIUM', `New threatened resource: ${r.name} (exposure ${r.exposure}, ${r.priority}).`); continue; }
    if (p.exposure !== r.exposure) d('CHANGED', 'THREAT', `resource.${r.id}.exposure`, p.exposure, r.exposure, 'HIGH', `${r.name} exposure ${p.exposure} → ${r.exposure}.`);
    if (p.windowStart && r.windowStart && r.exposure !== 'UNLIKELY' && Math.abs(minutesBetween(p.windowStart, r.windowStart)) >= 60)
      d('CHANGED', 'THREAT', `resource.${r.id}.windowStart`, p.windowStart, r.windowStart, 'MEDIUM', `${r.name} estimated exposure window now opens ${Math.abs(Math.round(minutesBetween(p.windowStart, r.windowStart) / 60))} h ${ms(r.windowStart) < ms(p.windowStart) ? 'earlier' : 'later'}.`);
  }
  for (const p of prev.resources.filter((x) => !cur.resources.some((r) => r.id === x.id))) d('RESOLVED', 'THREAT', `resource.${p.id}`, p.exposure, null, 'MEDIUM', `${p.name} no longer within the impact assessment.`);

  /* forecast / environment */
  const pf = prev.forecast, cf = cur.forecast;
  if (pf.available && !cf.available) d('DEGRADED', 'FORECAST', 'forecast.available', 'AVAILABLE', 'NOT AVAILABLE', 'HIGH', 'Drift forecast no longer available.');
  if (!pf.available && cf.available) d('RESOLVED', 'FORECAST', 'forecast.available', 'NOT AVAILABLE', 'AVAILABLE', 'HIGH', 'Drift forecast restored.');
  if (pf.available && cf.available) {
    if (pf.leadingEdgeSectorId !== cf.leadingEdgeSectorId) d('CHANGED', 'FORECAST', 'forecast.leadingEdgeSectorId', pf.leadingEdgeSectorId, cf.leadingEdgeSectorId, 'HIGH', `Forecast leading-edge sector ${pf.leadingEdgeSectorId ?? 'NOT AVAILABLE'} → ${cf.leadingEdgeSectorId ?? 'NOT AVAILABLE'}.`);
    if (pf.confidence !== cf.confidence) d(LEVELS.indexOf(cf.confidence) < LEVELS.indexOf(pf.confidence) ? 'DEGRADED' : 'RESOLVED', 'FORECAST', 'forecast.confidence', pf.confidence, cf.confidence, 'MEDIUM', `Forecast confidence ${pf.confidence} → ${cf.confidence}.`);
  }
  const pe = prev.environment, ce = cur.environment;
  for (const [k, label] of [['available', 'Environmental data'], ['wind', 'Wind observations'], ['waves', 'Wave observations']] as const) {
    if (k !== 'available' && (!pe.available || !ce.available)) continue;
    if (pe[k] && !ce[k]) d('DEGRADED', 'ENVIRONMENT', `environment.${k}`, 'AVAILABLE', 'NOT AVAILABLE', 'HIGH', `${label} no longer available.`);
    if (!pe[k] && ce[k]) d('RESOLVED', 'ENVIRONMENT', `environment.${k}`, 'NOT AVAILABLE', 'AVAILABLE', 'MEDIUM', `${label} restored.`);
  }

  /* safety */
  const sev = ['LOW', 'MEDIUM', 'HIGH'];
  for (const h of cur.hazards) {
    const p = prev.hazards.find((x) => x.id === h.id);
    if (!p) d('NEW', 'SAFETY', `hazard.${h.id}`, null, h.severity, h.severity === 'HIGH' ? 'HIGH' : 'MEDIUM', `Safety hazard added: ${h.id} ${short(h.hazard, 80)} (${h.severity}).`);
    else if (p.severity !== h.severity) d(sev.indexOf(h.severity) > sev.indexOf(p.severity) ? 'CHANGED' : 'RESOLVED', 'SAFETY', `hazard.${h.id}.severity`, p.severity, h.severity, 'MEDIUM', `Hazard ${h.id} severity ${p.severity} → ${h.severity}.`);
  }
  for (const p of prev.hazards.filter((x) => !cur.hazards.some((h) => h.id === x.id))) d('RESOLVED', 'SAFETY', `hazard.${p.id}`, p.severity, null, 'LOW', `Hazard ${p.id} no longer applies: ${short(p.hazard, 80)}`);

  /* gaps */
  for (const g of cur.gaps.filter((x) => !prev.gaps.some((p) => p.id === x.id))) d('NEW', 'GAP', `gap.${g.id}`, null, 'OPEN', 'LOW', `Information gap: ${g.description}`);
  for (const p of prev.gaps.filter((x) => !cur.gaps.some((g) => g.id === x.id))) d('RESOLVED', 'GAP', `gap.${p.id}`, 'OPEN', 'RESOLVED', 'MEDIUM', `Information gap resolved: ${p.description}`);

  /* contingencies */
  for (const c of cur.contingencies) {
    const p = prev.contingencies.find((x) => x.id === c.id);
    if (c.activation === 'ACTIVATED' && p?.activation !== 'ACTIVATED') d('CHANGED', 'CONTINGENCY', `contingency.${c.id}`, p?.activation ?? null, 'ACTIVATED', 'HIGH', `Contingency ${c.id} activated: ${c.scenario}.`);
    if (c.activation === 'STANDBY' && p?.activation === 'ACTIVATED') d('RESOLVED', 'CONTINGENCY', `contingency.${c.id}`, 'ACTIVATED', 'STANDBY', 'MEDIUM', `Contingency ${c.id} returned to standby.`);
  }

  /* sampling priorities */
  for (const x of cur.samples) {
    const p = prev.samples.find((y) => y.id === x.id);
    if (p && p.priority !== x.priority) d('CHANGED', 'SAMPLING', `sample.${x.id}.priority`, p.priority, x.priority, 'MEDIUM', `Sample ${x.id} (${short(x.location, 50)}) priority ${p.priority} → ${x.priority}.`);
  }

  /* shoreline */
  if (prev.shorelineContact !== cur.shorelineContact) d('CHANGED', 'SHORELINE', 'shorelineContact', prev.shorelineContact, cur.shorelineContact, 'HIGH', `Shoreline contact ${prev.shorelineContact} → ${cur.shorelineContact}.`);
  else d('UNCHANGED', 'SHORELINE', 'shorelineContact', prev.shorelineContact, cur.shorelineContact, 'MEDIUM', cur.shorelineContact === 'CONFIRMED' ? 'Shoreline contact remains confirmed.' : 'Shoreline contact remains unconfirmed.');

  const sig = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || sig[a.significance] - sig[b.significance] || a.key.localeCompare(b.key));
}
