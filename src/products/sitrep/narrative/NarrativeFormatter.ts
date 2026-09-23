/**
 * Narrative formatter. Reads ONLY computed facts (never the raw input) and writes sentences with the shared
 * formatter, so it cannot alter a value. A later local-model rewording pass must keep these facts verbatim.
 */
import type { SitrepFacts, SitrepNarrative, SitrepSnapshot } from '../SitrepTypes';
import { article, compass, fmt, joinAnd } from '../utils/format';
import { levelLabel } from '../analysis/ConfidenceFormatter';

export const FORECAST_LABEL = 'MODELLED / PREDICTED — NOT OBSERVED';
export const VESSEL_DISCLAIMER = 'Analytical support scores are investigative prioritization aids and do not determine responsibility.';
export const DEMO_NOTICE = 'DEMONSTRATION / ILLUSTRATIVE DATA — all incident values, vessels, resources and datasets in this SITREP are fictional and are not operational truth.';

export function buildNarrative(f: SitrepFacts, prev: SitrepSnapshot | null, cur: SitrepSnapshot): SitrepNarrative {
  return {
    executiveSituation: executiveSituation(f, prev, cur),
    hindcast: hindcastText(f),
    vesselDisclaimer: VESSEL_DISCLAIMER,
    forecastLabel: FORECAST_LABEL,
    demonstrationNotice: f.demonstration ? DEMO_NOTICE : null,
  };
}

function executiveSituation(f: SitrepFacts, prev: SitrepSnapshot | null, cur: SitrepSnapshot): string {
  const s: string[] = [];
  const cls = cur.classification.toLowerCase();
  const initial = f.changes.initial;
  const area = cur.slick.areaKm2;
  const ref = f.currentSituation.find((r) => r.label === 'Location')?.value;

  if (area === null && /insufficient/i.test(cls)) {
    s.push(`A reported sea-surface anomaly${ref && ref !== 'NOT AVAILABLE' ? ` ${ref}` : ''} could not be assessed: available evidence is insufficient to classify the feature or determine its extent.`);
  } else {
    const noun = cls.includes('slick') ? cls.replace('oil slick', 'marine oil slick') : cls;
    const verb = initial ? 'has been detected' : f.header.assessmentState ? `remains ${f.header.assessmentState.toLowerCase()}` : 'remains under observation';
    s.push(`${cap(`${article(noun)} ${noun}`)} ${verb}${ref && ref !== 'NOT AVAILABLE' ? ` approximately ${ref}` : ''}.`);
  }

  if (area !== null) {
    const trend = prev?.slick.areaKm2 != null && Math.abs(area - prev.slick.areaKm2) >= 0.05 ? ` (${fmt.km2(prev.slick.areaKm2)} in ${fmt.sitrepNo(prev.sitrepNumber)})` : '';
    s.push(`The observed slick covers an estimated ${fmt.km2(area)}${trend}.`);
  }

  const fc = f.forecast;
  if (fc.available && fc.horizons.length) {
    const first = fc.horizons[0], last = fc.horizons[fc.horizons.length - 1];
    const dirs = [...new Set(fc.horizons.map((h) => compass(h.directionDeg)))];
    const dir = dirs.length === 1 ? dirs[0] : `${compass(first.directionDeg)} to ${compass(last.directionDeg)}`;
    const top = f.impacts.resources.filter((r) => r.exposure !== 'POSSIBLE' || r.sensitivity === 'CRITICAL').slice(0, 2);
    const short = (n: string) => n.replace(/\s*\(.*\)$/, '').toLowerCase();
    const groups = (['CONFIRMED', 'LIKELY', 'POSSIBLE'] as const)
      .map((e) => [e, top.filter((r) => r.exposure === e).map((r) => short(r.name))] as const)
      .filter(([, names]) => names.length)
      .map(([e, names]) => `${e === 'CONFIRMED' ? 'confirmed' : e.toLowerCase()} exposure of ${e === 'POSSIBLE' && names.length === 1 ? 'the ' : ''}${joinAnd(names)}`);
    const exposure = groups.length ? `, with ${joinAnd(groups)}` : f.impacts.resources.length ? ', with possible exposure of coastal resources' : '';
    s.push(`Forecast modelling indicates ${dir} movement during the next ${first.horizonH}–${last.horizonH} hours${exposure}.`);
  } else {
    s.push('No drift forecast is available for this reporting period; potential movement is unknown.');
  }

  const v = f.vessels;
  if (!v.aisAvailable) s.push('Vessel association cannot be assessed without AIS data.');
  else if (v.attributionState === 'SUPPORTED') s.push(`Analytical support concentrates on ${v.candidates[0]?.id ?? 'one candidate track'}; responsibility is not determined.`);
  else if (v.attributionState === 'AMBIGUOUS') s.push(`Attribution remains inconclusive.`);
  else s.push(`Attribution is ${levelLabel(v.attributionState).toLowerCase()}.`);

  if (f.impacts.shorelineImpactObserved === true) s.push('Shoreline impact has been observed.');
  else if (f.impacts.shorelineImpactObserved === false && fc.available) s.push('No shoreline impact has been confirmed.');
  return s.join(' ');
}

function hindcastText(f: SitrepFacts): string {
  const h = f.hindcast;
  if (!h.available) return 'No backward reconstruction is available; the likely source region is unknown.';
  const parts: string[] = [];
  if (h.corridor) parts.push(`Backward reconstruction supports a source corridor extending approximately ${fmt.num(h.corridor.minKm, 0)}–${fmt.num(h.corridor.maxKm, 0)} km ${compass(h.corridor.bearingDeg)} of the observed slick.`);
  else parts.push('Backward reconstruction did not constrain a source corridor.');
  if (h.releaseWindowH) parts.push(`Release timing ${f.changes.initial ? 'is' : 'remains'} most consistent with an interval ${h.releaseWindowH[0]}–${h.releaseWindowH[1]} hours before observation.`);
  else parts.push('Release timing is not constrained.');
  return `${parts.join(' ')} Assessment: ${levelLabel(h.state)}.`;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
