/**
 * Alerts = input warnings + conditions derived deterministically from the incident state.
 * Derived alert ids are stable, so the delta engine can tell NEW from RESOLVED across SITREPs.
 */
import type { Severity, SitrepIncidentState, Warning } from '../SitrepTypes';
import { SITREP_CONFIG } from '../SitrepConfig';
import { levelRank } from './ConfidenceFormatter';
import { hoursBetween, timeRange } from '../utils/format';

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'WARNING', 'NOTICE'];

export function extractAlerts(s: SitrepIncidentState): Warning[] {
  const out: Warning[] = [];
  const now = s.incident.generatedAt;
  const cfg = SITREP_CONFIG.alerts;

  // Approaching sensitive resources
  for (const r of s.impacts.resources) {
    if (!r.exposureWindow || r.exposure === 'UNLIKELY') continue;
    const a = hoursBetween(now, r.exposureWindow.start), b = hoursBetween(now, r.exposureWindow.end);
    if (a > cfg.approachWithinH) continue;
    const win = `${Math.max(0, Math.round(a))}–${Math.round(b)} h`;
    if (r.sensitivity === 'CRITICAL') {
      out.push({ id: `IMPACT-${r.id}`, severity: 'CRITICAL', text: `Projected approach to ${r.name} within ${win} (exposure ${r.exposure}).` });
    } else if (r.sensitivity === 'VERY HIGH' && (r.exposure === 'LIKELY' || r.exposure === 'CONFIRMED')) {
      out.push({ id: `IMPACT-${r.id}`, severity: 'WARNING', text: `${r.exposure === 'CONFIRMED' ? 'Confirmed' : 'Likely'} exposure of ${r.name} within ${win}.` });
    }
  }

  if (s.impacts.shorelineImpactObserved === true) out.push({ id: 'SHORE-IMPACT', severity: 'CRITICAL', text: 'Shoreline impact has been observed.' });
  else if (s.impacts.shorelineImpactObserved === false) out.push({ id: 'SHORE-NONE', severity: 'NOTICE', text: 'No confirmed shoreline impact as of report time.' });

  // Observation
  if (levelRank(s.observation.detectionConfidence) <= levelRank('LOW')) {
    out.push({ id: 'OBS-WEAK', severity: 'WARNING', text: `Low-confidence detection (${s.observation.sensor}); classification requires verification before response escalation.` });
  }

  // Environmental forcing
  const env = s.environment;
  const missing = [env.windSpeedMs === null || env.windFromDeg === null ? 'wind' : null, env.currentSpeedMs === null || env.currentTowardDeg === null ? 'surface current' : null].filter(Boolean);
  if (missing.length) out.push({ id: 'ENV-MISSING', severity: 'WARNING', text: `${missing.join(' and ')} data not available; drift estimates are degraded.`.replace(/^./, (c) => c.toUpperCase()) });

  // AIS
  const va = s.vesselAssessment;
  if (!va.aisAvailable) {
    out.push({ id: 'AIS-UNAVAILABLE', severity: 'WARNING', text: 'No AIS data available; vessel association cannot be assessed.' });
  } else {
    const gapped = va.candidates.filter((c) => c.aisGaps.length && c.supportScore >= SITREP_CONFIG.vessels.minSupportScore);
    const low = va.aisCoveragePct !== null && va.aisCoveragePct < cfg.aisCoverageMinPct;
    if (gapped.length || low) {
      const parts = [
        low ? `coverage ${Math.round(va.aisCoveragePct!)}% (below ${cfg.aisCoverageMinPct}%)` : null,
        gapped.length ? `gaps on ${gapped.length === 1 ? `${gapped[0].id} (${timeRange(gapped[0].aisGaps[0].from, gapped[0].aisGaps[0].to)})` : `${gapped.length} relevant candidate tracks`}` : null,
      ].filter(Boolean);
      out.push({ id: 'AIS-COVERAGE', severity: 'WARNING', text: `AIS coverage incomplete: ${parts.join('; ')}.` });
    }
  }

  if (!s.forecast.available) out.push({ id: 'FORECAST-UNAVAILABLE', severity: 'WARNING', text: 'No drift forecast available for this reporting period.' });

  // Input warnings win on id collision (upstream systems know more than the rules above).
  const byId = new Map(out.map((w) => [w.id, w]));
  for (const w of s.warnings) byId.set(w.id, w);
  return [...byId.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}
