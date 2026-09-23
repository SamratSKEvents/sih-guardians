/**
 * Ranked resources, recommended actions and information gaps.
 * Every derived action carries `basis`: the input fields it follows from. Nothing is added without a basis.
 */
import type { ActionPriority, RankedResource, RecommendedAction, SitrepIncidentState } from '../SitrepTypes';
import { SITREP_CONFIG } from '../SitrepConfig';
import { exposureRank, levelRank, sensitivityRank } from './ConfidenceFormatter';
import { compass, hhmm, hoursBetween, joinAnd, timeRange } from '../utils/format';

/** Priority = exposure × sensitivity, ties broken by earliest exposure onset. UNLIKELY exposures are excluded. */
export function rankResources(s: SitrepIncidentState): RankedResource[] {
  const now = s.incident.generatedAt;
  return s.impacts.resources
    .filter((r) => r.exposure !== 'UNLIKELY')
    .map((r) => ({ r, score: exposureRank(r.exposure) * sensitivityRank(r.sensitivity), start: r.exposureWindow ? Date.parse(r.exposureWindow.start) : Infinity }))
    .sort((a, b) => b.score - a.score || a.start - b.start || a.r.id.localeCompare(b.r.id))
    .map(({ r }, i) => ({
      ...r,
      priority: i + 1,
      windowFromReportH: r.exposureWindow ? [hoursBetween(now, r.exposureWindow.start), hoursBetween(now, r.exposureWindow.end)] : null,
    }));
}

const PRIORITY_ORDER: ActionPriority[] = ['IMMEDIATE', 'HIGH', 'ROUTINE'];

export function deriveActions(s: SitrepIncidentState, resources: RankedResource[]): RecommendedAction[] {
  const out: RecommendedAction[] = [];
  const add = (id: string, priority: ActionPriority, text: string, basis: string[]) => out.push({ id, priority, text, basis });
  const obs = s.observation, va = s.vesselAssessment, fc = s.forecast, env = s.environment;
  const within = SITREP_CONFIG.alerts.approachWithinH;

  if (s.slick.areaKm2 === null && levelRank(obs.detectionConfidence) <= levelRank('LOW')) {
    add('ACT-REOBSERVE', 'IMMEDIATE', 'Task a new observation of the reported area; current evidence does not support an assessment.', ['observation.detectionConfidence', 'slick.areaKm2']);
  } else if (!obs.classification.startsWith('CONFIRMED') && !obs.independentObservation) {
    add('ACT-VERIFY', levelRank(obs.detectionConfidence) <= levelRank('MEDIUM') ? 'IMMEDIATE' : 'HIGH', 'Verify slick classification using additional observation evidence (optical, aerial or repeat SAR).', ['observation.classification', 'observation.independentObservation']);
  }

  const envMissing = [env.windSpeedMs === null ? 'wind' : null, env.currentSpeedMs === null ? 'surface-current' : null].filter((x): x is string => !!x);
  if (envMissing.length) {
    add('ACT-FORCING', envMissing.length === 2 ? 'IMMEDIATE' : 'HIGH', `Obtain replacement ${joinAnd(envMissing)} forcing before the next forecast cycle.`, envMissing.map((m) => (m === 'wind' ? 'environment.windSpeedMs' : 'environment.currentSpeedMs')));
  }

  for (const r of resources) {
    if (!r.windowFromReportH || r.windowFromReportH[0] > within) continue;
    const [a, b] = r.windowFromReportH;
    const win = `${Math.max(0, Math.round(a))}–${Math.round(b)} h (from ${hhmm(r.exposureWindow!.start)})`;
    if (r.sensitivity === 'CRITICAL' && exposureRank(r.exposure) >= exposureRank('POSSIBLE')) {
      add(`ACT-NOTIFY-${r.id}`, 'IMMEDIATE', `Notify operators of ${r.name} of the potential exposure window ${win}.`, [`impacts.resources[${r.id}].exposureWindow`, `impacts.resources[${r.id}].sensitivity`]);
    }
  }

  if (fc.available && fc.horizons.length) {
    const last = fc.horizons[fc.horizons.length - 1];
    add('ACT-SURVEIL', 'HIGH', `Maintain surveillance of the forecast ${compass(last.directionDeg)} drift corridor to +${last.horizonH} h.`, ['forecast.horizons']);
  } else if (s.slick.areaKm2 !== null) {
    add('ACT-FORECAST', 'HIGH', 'Run a forward drift forecast as soon as forcing data are available.', ['forecast.available']);
  }

  const relevant = va.candidates.filter((c) => c.supportScore >= SITREP_CONFIG.vessels.minSupportScore).slice(0, SITREP_CONFIG.vessels.maxCandidates);
  const win = s.releaseAssessment.strongestWindowH;
  if (va.aisAvailable && relevant.length && s.hindcast.available && win) {
    add('ACT-AIS-REVIEW', 'HIGH', `Review AIS tracks of ${joinAnd(relevant.map((c) => c.id))} intersecting the ${win[0]}–${win[1]} h source-support corridor.`, ['vesselAssessment.candidates', 'releaseAssessment.strongestWindowH', 'hindcast.corridor']);
  }
  for (const c of relevant.filter((c) => c.aisGaps.length)) {
    const g = c.aisGaps[0];
    add(`ACT-AIS-GAP-${c.id}`, 'ROUTINE', `Request supplementary position data (satellite AIS, VTS radar) for ${c.id} covering the ${timeRange(g.from, g.to)} AIS gap.`, [`vesselAssessment.candidates[${c.id}].aisGaps`]);
  }

  const shore = resources.filter((r) => sensitivityRank(r.sensitivity) >= sensitivityRank('VERY HIGH') && exposureRank(r.exposure) >= exposureRank('LIKELY'));
  if (shore.length && s.impacts.shorelineImpactObserved !== true) {
    add('ACT-SHORE-VERIFY', 'HIGH', `Prepare shoreline verification for ${joinAnd(shore.map((r) => r.name))}.`, shore.map((r) => `impacts.resources[${r.id}].exposure`));
  }
  if (!va.aisAvailable) add('ACT-AIS-OBTAIN', 'HIGH', 'Obtain AIS data for the hindcast window to enable vessel association.', ['vesselAssessment.aisAvailable']);

  // Upstream (planner) actions: kept only if traceable.
  const ids = new Set(out.map((a) => a.id));
  for (const a of s.actions) if (a.basis.length && !ids.has(a.id)) out.push(a);

  return out.map((a, i) => ({ a, i })).sort((x, y) => PRIORITY_ORDER.indexOf(x.a.priority) - PRIORITY_ORDER.indexOf(y.a.priority) || x.i - y.i).map((x) => x.a);
}

/** What is NOT known. Derived from nulls, flags and stated limitations — never from free text guesses. */
export function deriveGaps(s: SitrepIncidentState): string[] {
  const g: string[] = [];
  const obs = s.observation, sl = s.slick, env = s.environment, va = s.vesselAssessment;
  // Ordered by operational consequence: what blocks assessment first, refinements last.
  if (sl.areaKm2 === null) g.push('Slick geometry (area, extent) not determined.');
  if (!obs.classification.startsWith('CONFIRMED')) g.push('Presence of oil not confirmed by independent evidence.');
  if (!s.forecast.available) g.push('No drift forecast; potential movement and exposure unknown.');
  if (env.windSpeedMs === null || env.windFromDeg === null) g.push('Wind data not available.');
  if (env.currentSpeedMs === null || env.currentTowardDeg === null) g.push('Surface-current data not available.');
  if (s.impacts.shorelineImpactObserved === null) g.push('No shoreline survey has been conducted.');
  if (!va.aisAvailable) g.push('No AIS data for the analysis window.');
  if (!s.hindcast.available) g.push('No hindcast reconstruction; likely source region unknown.');
  if (obs.oilComposition === null) g.push('Oil composition not confirmed.');
  if (!sl.thicknessAvailable) g.push('Slick thickness unavailable; volume cannot be estimated.');
  if (!obs.independentObservation) g.push('No independent optical, aerial or in-situ observation.');
  for (const c of va.candidates.filter((c) => c.supportScore >= SITREP_CONFIG.vessels.minSupportScore)) {
    for (const gap of c.aisGaps) g.push(`AIS gap ${timeRange(gap.from, gap.to)} for ${c.id}.`);
  }
  if (env.waveHsM === null) g.push('Wave height not available.');
  g.push(...env.limitations, ...s.hindcast.limitations);
  return [...new Set(g)];
}
