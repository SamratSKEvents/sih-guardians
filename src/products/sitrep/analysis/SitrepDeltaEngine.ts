/**
 * "What changed since the last SITREP?"
 *
 * Pure, deterministic comparison of two snapshots. No language model is involved: every number in a delta
 * is computed here and formatted with the shared formatter.
 *
 *   NEW        something appeared (resource entered envelope, alert raised, candidate added)
 *   CHANGED    a value moved beyond its reporting threshold (or improved)
 *   UNCHANGED  a key operational fact held (only a short whitelist is reported)
 *   RESOLVED   something cleared (alert cleared, missing data restored, resource left envelope)
 *   DEGRADED   information quality got worse (confidence fell, data lost, dataset stale)
 */
import type { ConfidenceSummary, DeltaKind, SitrepDelta, SitrepIncidentState, SitrepSnapshot, PreviousSitrepSummary } from '../SitrepTypes';
import { SITREP_CONFIG } from '../SitrepConfig';
import { CONFIDENCE_LABELS, confidenceRank, exposureRank, levelLabel, levelRank } from './ConfidenceFormatter';
import { extractAlerts } from './AlertExtractor';
import { compass, displacement, fmt, hhmm, hoursBetween, sentenceCase } from '../utils/format';

/* ------------------------------------------------------------------ snapshot */

export function toSnapshot(s: SitrepIncidentState): SitrepSnapshot {
  const env = s.environment;
  const ranked = [...s.vesselAssessment.candidates].sort((a, b) => b.supportScore - a.supportScore || a.id.localeCompare(b.id));
  return {
    sitrepNumber: s.incident.sitrepNumber,
    generatedAt: s.incident.generatedAt,
    operationalStatus: s.incident.operationalStatus,
    assessmentState: s.incident.assessmentState,
    classification: s.observation.classification,
    observedAt: s.observation.observedAt,
    slick: { areaKm2: s.slick.areaKm2, centroid: s.slick.centroid, fragmentCount: s.slick.fragmentCount },
    environment: {
      wind: env.windSpeedMs !== null && env.windFromDeg !== null,
      current: env.currentSpeedMs !== null && env.currentTowardDeg !== null,
      waves: env.waveHsM !== null,
      stokes: env.stokesDriftMs !== null,
    },
    forecast: { available: s.forecast.available, horizons: s.forecast.horizons.map((h) => ({ horizonH: h.horizonH, centre: h.centre, uncertaintyKm: h.uncertaintyKm })) },
    releaseWindowH: s.releaseAssessment.strongestWindowH,
    attributionState: s.vesselAssessment.attributionState,
    aisCoveragePct: s.vesselAssessment.aisAvailable ? s.vesselAssessment.aisCoveragePct : null,
    candidates: ranked.map((c, i) => ({ id: c.id, supportScore: c.supportScore, rank: i + 1 })),
    confidence: { ...s.confidence },
    resources: s.impacts.resources.filter((r) => r.exposure !== 'UNLIKELY').map((r) => ({ id: r.id, name: r.name, exposure: r.exposure, sensitivity: r.sensitivity, exposureStart: r.exposureWindow?.start ?? null })),
    alerts: extractAlerts(s),
    datasets: s.provenance.datasets.map((d) => ({ id: d.id, label: d.label, available: d.source !== null, ageHours: d.ageHours, quality: d.quality })),
    shorelineImpactObserved: s.impacts.shorelineImpactObserved,
  };
}

export function toPreviousSitrep(s: SitrepIncidentState): PreviousSitrepSummary {
  return { sitrepNumber: s.incident.sitrepNumber, revision: s.incident.revision, generatedAt: s.incident.generatedAt, snapshot: toSnapshot(s) };
}

/* ------------------------------------------------------------------ compare */

export const KIND_ORDER: DeltaKind[] = ['NEW', 'CHANGED', 'DEGRADED', 'RESOLVED', 'UNCHANGED'];
const SIG_ORDER = ['HIGH', 'MEDIUM', 'LOW'];

export function compareSitrepStates(prev: SitrepSnapshot, cur: SitrepSnapshot): SitrepDelta[] {
  const d: SitrepDelta[] = [];
  const push = (x: SitrepDelta) => d.push(x);
  const cfg = SITREP_CONFIG.change;
  const prevNo = fmt.sitrepNo(prev.sitrepNumber);

  /* status */
  if (prev.operationalStatus !== cur.operationalStatus) {
    push({ kind: 'CHANGED', category: 'STATUS', key: 'incident.operationalStatus', from: prev.operationalStatus, to: cur.operationalStatus, significance: 'HIGH', text: `Operational status changed from ${prev.operationalStatus} to ${cur.operationalStatus}.` });
  }
  if (prev.classification !== cur.classification) {
    push({ kind: 'CHANGED', category: 'STATUS', key: 'observation.classification', from: prev.classification, to: cur.classification, significance: 'HIGH', text: `Assessment changed from ${prev.classification} to ${cur.classification}.` });
  }

  /* slick */
  const pa = prev.slick.areaKm2, ca = cur.slick.areaKm2;
  if (pa !== null && ca !== null) {
    const diff = ca - pa, pct = pa > 0 ? (diff / pa) * 100 : Infinity;
    if (Math.abs(diff) >= cfg.areaKm2 && Math.abs(pct) >= cfg.areaPct) {
      push({ kind: 'CHANGED', category: 'SLICK', key: 'slick.areaKm2', from: pa, to: ca, change: round(diff, 1), significance: Math.abs(pct) >= 20 ? 'HIGH' : 'MEDIUM', text: `Slick area ${diff > 0 ? 'increased' : 'decreased'} from ${fmt.km2(pa)} to ${fmt.km2(ca)} (${diff > 0 ? '+' : '−'}${Math.abs(Math.round(pct))}%).` });
    }
  } else if (pa === null && ca !== null) {
    push({ kind: 'RESOLVED', category: 'SLICK', key: 'slick.areaKm2', from: null, to: ca, significance: 'MEDIUM', text: `Slick area now determined: ${fmt.km2(ca)}.` });
  } else if (pa !== null && ca === null) {
    push({ kind: 'DEGRADED', category: 'SLICK', key: 'slick.areaKm2', from: pa, to: null, significance: 'HIGH', text: `Slick area could not be determined in this period (previously ${fmt.km2(pa)}).` });
  }
  if (prev.slick.centroid && cur.slick.centroid) {
    const m = displacement(prev.slick.centroid, cur.slick.centroid);
    if (m.km >= cfg.centroidKm) {
      push({ kind: 'CHANGED', category: 'SLICK', key: 'slick.centroid', from: fmt.latLon(prev.slick.centroid), to: fmt.latLon(cur.slick.centroid), change: round(m.km, 1), significance: 'MEDIUM', text: `Observed slick centroid moved ${fmt.km(m.km)} ${compass(m.bearingDeg)}.` });
    }
  }
  if (prev.slick.fragmentCount !== null && cur.slick.fragmentCount !== null && prev.slick.fragmentCount !== cur.slick.fragmentCount) {
    push({ kind: 'CHANGED', category: 'SLICK', key: 'slick.fragmentCount', from: prev.slick.fragmentCount, to: cur.slick.fragmentCount, change: cur.slick.fragmentCount - prev.slick.fragmentCount, significance: 'LOW', text: `Fragmentation changed: ${prev.slick.fragmentCount} → ${cur.slick.fragmentCount} slick regions.` });
  }

  /* environment availability */
  const envNames: [keyof SitrepSnapshot['environment'], string][] = [['wind', 'wind'], ['current', 'surface-current'], ['waves', 'wave'], ['stokes', 'Stokes-drift']];
  for (const [k, name] of envNames) {
    if (prev.environment[k] === cur.environment[k]) continue;
    const restored = cur.environment[k];
    push({ kind: restored ? 'RESOLVED' : 'DEGRADED', category: 'ENVIRONMENT', key: `environment.${k}`, from: prev.environment[k], to: cur.environment[k], significance: k === 'wind' || k === 'current' ? 'HIGH' : 'LOW', text: restored ? `Missing ${name} data restored.` : `${sentenceCase(name)} data no longer available.` });
  }

  /* forecast */
  if (prev.forecast.available !== cur.forecast.available) {
    push({ kind: cur.forecast.available ? 'RESOLVED' : 'DEGRADED', category: 'FORECAST', key: 'forecast.available', from: prev.forecast.available, to: cur.forecast.available, significance: 'HIGH', text: cur.forecast.available ? 'Drift forecast available again.' : 'Drift forecast no longer available.' });
  } else if (cur.forecast.available) {
    const common = cur.forecast.horizons.filter((h) => prev.forecast.horizons.some((p) => p.horizonH === h.horizonH)).map((h) => h.horizonH);
    const H = common.length ? Math.max(...common) : null;
    if (H !== null) {
      const p = prev.forecast.horizons.find((h) => h.horizonH === H)!, c = cur.forecast.horizons.find((h) => h.horizonH === H)!;
      const m = displacement(p.centre, c.centre);
      if (m.km >= cfg.forecastCentreKm) {
        push({ kind: 'CHANGED', category: 'FORECAST', key: `forecast.+${H}h.centre`, from: fmt.latLon(p.centre), to: fmt.latLon(c.centre), change: round(m.km, 1), significance: m.km >= 5 ? 'HIGH' : 'MEDIUM', text: `Forecast +${H} h centroid shifted ${fmt.km(m.km)} ${compass(m.bearingDeg)} relative to the ${prevNo} projection.` });
      }
    }
  }
  if (prev.releaseWindowH && cur.releaseWindowH && (prev.releaseWindowH[0] !== cur.releaseWindowH[0] || prev.releaseWindowH[1] !== cur.releaseWindowH[1])) {
    push({ kind: 'CHANGED', category: 'ATTRIBUTION', key: 'releaseAssessment.strongestWindowH', from: fmt.hourRange(prev.releaseWindowH), to: fmt.hourRange(cur.releaseWindowH), significance: 'MEDIUM', text: `Most-supported release interval revised from ${fmt.hourRange(prev.releaseWindowH)} to ${fmt.hourRange(cur.releaseWindowH)} before observation.` });
  }

  /* attribution */
  const pTop = prev.candidates[0], cTop = cur.candidates[0];
  if (cTop && pTop && cTop.id !== pTop.id) {
    push({ kind: 'CHANGED', category: 'ATTRIBUTION', key: 'candidates.top', from: pTop.id, to: cTop.id, significance: 'HIGH', text: `${cTop.id} replaced ${pTop.id} as highest analytical-support candidate.` });
  } else if (cTop && pTop) {
    push({ kind: 'UNCHANGED', category: 'ATTRIBUTION', key: 'candidates.top', from: pTop.id, to: cTop.id, significance: 'LOW', text: `${cTop.id} remains highest analytical-support candidate.` });
  }
  for (const c of cur.candidates) {
    const p = prev.candidates.find((x) => x.id === c.id);
    if (!p) {
      if (c.supportScore >= SITREP_CONFIG.vessels.minSupportScore) push({ kind: 'NEW', category: 'ATTRIBUTION', key: `candidate.${c.id}`, from: null, to: c.supportScore, significance: 'MEDIUM', text: `${c.id} added to candidate list (analytical support ${c.supportScore}).` });
      continue;
    }
    const diff = c.supportScore - p.supportScore;
    if (Math.abs(diff) >= cfg.supportPoints && Math.max(c.supportScore, p.supportScore) >= SITREP_CONFIG.vessels.minSupportScore) {
      push({ kind: 'CHANGED', category: 'ATTRIBUTION', key: `candidate.${c.id}.supportScore`, from: p.supportScore, to: c.supportScore, change: diff, significance: 'MEDIUM', text: `Candidate ${c.id} analytical support: ${p.supportScore} → ${c.supportScore}.` });
    }
  }
  for (const p of prev.candidates) {
    if (!cur.candidates.some((c) => c.id === p.id) && p.supportScore >= SITREP_CONFIG.vessels.minSupportScore) {
      push({ kind: 'RESOLVED', category: 'ATTRIBUTION', key: `candidate.${p.id}`, from: p.supportScore, to: null, significance: 'LOW', text: `${p.id} no longer a relevant candidate.` });
    }
  }
  if (prev.attributionState === cur.attributionState) {
    push({ kind: 'UNCHANGED', category: 'ATTRIBUTION', key: 'attributionState', from: prev.attributionState, to: cur.attributionState, significance: 'LOW', text: `Attribution remains ${levelLabel(cur.attributionState)}.` });
  }
  const pc = prev.aisCoveragePct, cc = cur.aisCoveragePct;
  if (pc !== null && cc !== null && Math.abs(cc - pc) >= cfg.aisCoveragePts) {
    push({ kind: cc > pc ? 'CHANGED' : 'DEGRADED', category: 'DATA', key: 'aisCoveragePct', from: pc, to: cc, change: round(cc - pc, 0), significance: 'MEDIUM', text: `AIS coverage ${cc > pc ? 'improved' : 'fell'} from ${fmt.pct(pc)} to ${fmt.pct(cc)}.` });
  } else if (pc === null && cc !== null) {
    push({ kind: 'RESOLVED', category: 'DATA', key: 'aisCoveragePct', from: null, to: cc, significance: 'HIGH', text: `AIS data restored (coverage ${fmt.pct(cc)}).` });
  } else if (pc !== null && cc === null) {
    push({ kind: 'DEGRADED', category: 'DATA', key: 'aisCoveragePct', from: pc, to: null, significance: 'HIGH', text: 'AIS data no longer available.' });
  }

  /* confidence (attribution state handled via rank on its own scale) */
  for (const k of Object.keys(CONFIDENCE_LABELS) as (keyof ConfidenceSummary)[]) {
    const a = prev.confidence[k], b = cur.confidence[k];
    if (a === b) continue;
    const down = confidenceRank(b) < confidenceRank(a);
    push({ kind: down ? 'DEGRADED' : 'CHANGED', category: 'CONFIDENCE', key: `confidence.${k}`, from: a, to: b, significance: down ? 'MEDIUM' : 'LOW', text: `${CONFIDENCE_LABELS[k]} ${k === 'attribution' ? 'state' : 'confidence'}: ${levelLabel(a)} → ${levelLabel(b)}.` });
  }

  /* impacts */
  for (const r of cur.resources) {
    const p = prev.resources.find((x) => x.id === r.id);
    const onset = r.exposureStart ? ` (${r.exposure}, onset ${hhmm(r.exposureStart)})` : ` (${r.exposure})`;
    if (!p) {
      push({ kind: 'NEW', category: 'IMPACT', key: `resource.${r.id}`, from: null, to: r.exposure, significance: r.sensitivity === 'CRITICAL' || r.sensitivity === 'VERY HIGH' ? 'HIGH' : 'MEDIUM', text: `${r.name} entered forecast impact envelope${onset}.` });
      continue;
    }
    if (p.exposure !== r.exposure) {
      const up = exposureRank(r.exposure) > exposureRank(p.exposure);
      push({ kind: 'CHANGED', category: 'IMPACT', key: `resource.${r.id}.exposure`, from: p.exposure, to: r.exposure, significance: up ? 'HIGH' : 'MEDIUM', text: `${r.name} exposure changed from ${p.exposure} to ${r.exposure}.` });
    }
    if (p.exposureStart && r.exposureStart) {
      const shift = hoursBetween(p.exposureStart, r.exposureStart);
      if (Math.abs(shift) >= cfg.exposureOnsetH) {
        push({ kind: 'CHANGED', category: 'IMPACT', key: `resource.${r.id}.exposureStart`, from: p.exposureStart, to: r.exposureStart, change: round(shift, 1), significance: shift < 0 ? 'HIGH' : 'MEDIUM', text: `Estimated exposure onset for ${r.name} moved ${shift < 0 ? 'earlier' : 'later'} by ${fmt.hours(round(Math.abs(shift), 1))} (now ${hhmm(r.exposureStart)}).` });
      }
    }
  }
  for (const p of prev.resources) {
    if (!cur.resources.some((r) => r.id === p.id)) push({ kind: 'RESOLVED', category: 'IMPACT', key: `resource.${p.id}`, from: p.exposure, to: null, significance: 'MEDIUM', text: `${p.name} no longer within forecast impact envelope.` });
  }
  if (prev.shorelineImpactObserved !== true && cur.shorelineImpactObserved === true) {
    push({ kind: 'NEW', category: 'IMPACT', key: 'shorelineImpactObserved', from: prev.shorelineImpactObserved, to: true, significance: 'HIGH', text: 'Shoreline impact observed.' });
  } else if (cur.shorelineImpactObserved === false && prev.shorelineImpactObserved === false) {
    push({ kind: 'UNCHANGED', category: 'IMPACT', key: 'shorelineImpactObserved', from: false, to: false, significance: 'LOW', text: 'No confirmed shoreline impact has been observed.' });
  }

  /* alerts (shoreline and data-availability alerts are already covered by the deltas above) */
  for (const a of cur.alerts) {
    const p = prev.alerts.find((x) => x.id === a.id);
    if (COVERED.has(a.id)) continue;
    if (!p) {
      if (a.severity !== 'NOTICE') push({ kind: 'NEW', category: 'ALERT', key: `alert.${a.id}`, from: null, to: a.severity, significance: a.severity === 'CRITICAL' ? 'HIGH' : 'MEDIUM', text: `New ${a.severity} alert: ${a.text}` });
    } else if (p.severity !== a.severity) {
      push({ kind: 'CHANGED', category: 'ALERT', key: `alert.${a.id}`, from: p.severity, to: a.severity, significance: 'HIGH', text: `Alert escalated/de-escalated ${p.severity} → ${a.severity}: ${a.text}`.replace('escalated/de-escalated', severityRank(a.severity) < severityRank(p.severity) ? 'escalated' : 'de-escalated') });
    }
  }
  for (const p of prev.alerts) {
    if (!cur.alerts.some((a) => a.id === p.id) && p.severity !== 'NOTICE' && !COVERED.has(p.id)) push({ kind: 'RESOLVED', category: 'ALERT', key: `alert.${p.id}`, from: p.severity, to: null, significance: 'MEDIUM', text: `${p.severity} alert cleared: ${p.text}` });
  }

  /* datasets: quality and staleness */
  for (const c of cur.datasets) {
    const p = prev.datasets.find((x) => x.id === c.id);
    if (!p) continue;
    if (levelRank(c.quality) < levelRank(p.quality)) {
      push({ kind: 'DEGRADED', category: 'DATA', key: `dataset.${c.id}.quality`, from: p.quality, to: c.quality, significance: 'MEDIUM', text: `${c.label} data quality: ${levelLabel(p.quality)} → ${levelLabel(c.quality)}.` });
    } else if (levelRank(c.quality) > levelRank(p.quality) && p.quality !== 'UNAVAILABLE') {
      push({ kind: 'CHANGED', category: 'DATA', key: `dataset.${c.id}.quality`, from: p.quality, to: c.quality, significance: 'LOW', text: `${c.label} data quality improved: ${levelLabel(p.quality)} → ${levelLabel(c.quality)}.` });
    }
    const limit = cfg.staleAgeH[c.id];
    if (limit !== undefined && c.ageHours !== null && c.ageHours > limit && (p.ageHours === null || p.ageHours <= limit)) {
      push({ kind: 'DEGRADED', category: 'DATA', key: `dataset.${c.id}.age`, from: p.ageHours, to: c.ageHours, significance: 'MEDIUM', text: `${c.label} dataset age ${fmt.hours(c.ageHours)} exceeds the ${fmt.hours(limit)} freshness threshold.` });
    }
  }

  return d
    .map((x, i) => ({ x, i }))
    .sort((a, b) => KIND_ORDER.indexOf(a.x.kind) - KIND_ORDER.indexOf(b.x.kind) || SIG_ORDER.indexOf(a.x.significance) - SIG_ORDER.indexOf(b.x.significance) || a.i - b.i)
    .map((a) => a.x);
}

const COVERED = new Set(['ENV-MISSING', 'FORECAST-UNAVAILABLE', 'AIS-UNAVAILABLE', 'SHORE-NONE', 'SHORE-IMPACT']);
const round = (v: number, dp: number) => Number(v.toFixed(dp));
const severityRank = (s: string) => ['CRITICAL', 'WARNING', 'NOTICE'].indexOf(s);
