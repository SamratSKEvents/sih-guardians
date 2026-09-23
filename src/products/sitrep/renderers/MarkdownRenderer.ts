import type { DeltaKind, FactRow, SitrepDocument } from '../SitrepTypes';
import { KIND_ORDER } from '../analysis/SitrepDeltaEngine';
import { levelLabel } from '../analysis/ConfidenceFormatter';
import { compass, fmt, utc } from '../utils/format';

const esc = (s: string) => s.replace(/\|/g, '\\|');
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const factTable = (rows: FactRow[]) => table(['Item', 'Value', 'Basis'], rows.map((r) => [r.label, r.value, r.evidence]));

export function renderMarkdown(doc: SitrepDocument): string {
  const { facts: f, narrative: n, variant } = doc;
  const h = f.header;
  const out: string[] = [];
  const sec = (title: string, body: string) => out.push(`## ${title}\n\n${body}\n`);

  if (n.demonstrationNotice) out.push(`> **${n.demonstrationNotice}**\n`);
  out.push(`# ${h.title}\n`);
  out.push(`**${variant} SITREP** · ${h.reportType} · ${h.lifecycle}\n`);
  out.push(
    table(['Field', 'Value'], [
      ['SITREP No', `${h.sitrepNo} (rev ${h.revision})`],
      ['Incident', h.incidentId],
      ['Region', h.region],
      ['Reporting period', h.reportingPeriod],
      ['Generated', utc(h.generatedAt)],
      ['Status', h.operationalStatus],
      ['Prepared by', h.preparedBy],
      ['Reviewed by', h.reviewedBy],
      ['Classification', h.classification],
      ['Distribution', h.distribution.join('; ')],
    ]) + '\n',
  );

  if (f.alerts.length) sec('Alerts', f.alerts.map((a) => `- **${a.severity}** — ${a.text}`).join('\n'));
  sec('1. Executive situation', n.executiveSituation);

  sec(
    f.changes.initial ? '2. Changes' : `2. Changes since SITREP ${f.changes.previousSitrepNo}`,
    f.changes.initial
      ? '**INITIAL SITREP — NO PRIOR REPORT AVAILABLE**'
      : f.changes.deltas.length
        ? KIND_ORDER.map((k) => groupMd(k, f.changes.deltas.filter((d) => d.kind === k).map((d) => d.text))).filter(Boolean).join('\n\n')
        : 'No reportable changes above threshold.',
  );

  sec('3. Current situation', factTable(f.currentSituation));

  if (variant === 'FULL') {
    sec('4. Environmental conditions', `Environmental assessment: **${f.environment.assessment}**\n\n${factTable(f.environment.rows)}`);
    sec('5. Hindcast / likely source region', `${n.hindcast}\n\n${f.hindcast.rows.length ? factTable(f.hindcast.rows) : ''}${f.hindcast.limitations.length ? `\n\nLimitations: ${f.hindcast.limitations.join(' ')}` : ''}`);
    const v = f.vessels;
    sec(
      '6. Vessel / source association',
      !v.aisAvailable
        ? `AIS: **NOT AVAILABLE** — vessel association not assessed.\n\n_${n.vesselDisclaimer}_`
        : `AIS coverage ${fmt.pct(v.aisCoveragePct)} · ${v.vesselsScreened} vessels screened · Attribution **${levelLabel(v.attributionState)}**\n\n` +
          (v.candidates.length ? table(['Candidate', 'Vessel type', 'Analytical support', 'Key reason'], v.candidates.map((c) => [c.id, c.vesselType, String(c.supportScore), c.keyReason])) : 'No candidate reaches the relevance threshold.') +
          `${v.omittedCount ? `\n\n${v.omittedCount} lower-support track(s) not shown.` : ''}\n\n_${n.vesselDisclaimer}_`,
    );
    sec(
      '7. Forward forecast',
      f.forecast.available
        ? `**${n.forecastLabel}** · issued ${utc(f.forecast.issuedAt)} · ${f.forecast.model}\n\n` +
          table(['Horizon', 'Valid', 'Movement', 'Uncertainty', 'P(shore contact)', 'Primary concern', 'Confidence'], f.forecast.horizons.map((x) => [`+${x.horizonH} h`, utc(x.validAt), `${compass(x.directionDeg)} (${fmt.bearing(x.directionDeg)})`, `±${fmt.km(x.uncertaintyKm)}`, fmt.prob(x.shorelineContactProbability), x.primaryConcern, levelLabel(x.confidence)]))
        : 'Forecast: **NOT AVAILABLE**.',
    );
  }

  const res = f.impacts.resources;
  sec(
    variant === 'FULL' ? '8. Impact summary' : '4. Priority resources',
    (res.length
      ? res.map((r) => `**Priority ${r.priority} — ${r.name}**  \nEstimated exposure window: ${r.windowFromReportH ? `${fmt.hourRange([Math.max(0, r.windowFromReportH[0]), r.windowFromReportH[1]])} (${utc(r.exposureWindow!.start)} – ${utc(r.exposureWindow!.end)})` : 'NOT AVAILABLE'}  \nSensitivity: ${r.sensitivity} · Assessment: ${r.exposure}`).join('\n\n')
      : 'No resources within the forecast impact envelope.') + `\n\n${shoreLine(f.impacts.shorelineImpactObserved)}`,
  );

  sec(variant === 'FULL' ? '9. Immediate priorities' : '5. Immediate priorities', f.actions.map((a, i) => `${i + 1}. **[${a.priority}]** ${a.text}  \n   _Basis: ${a.basis.join(', ')}_`).join('\n'));
  sec(variant === 'FULL' ? '10. Current information gaps' : '6. Key information gaps', f.gaps.map((g) => `- ${g}`).join('\n'));
  sec(variant === 'FULL' ? '11. Confidence' : '7. Confidence', table(['Component', 'State'], f.confidence.map((c) => [c.label, levelLabel(c.value)])));

  if (variant === 'FULL') {
    sec('12. Evidence basis', (['OBSERVED', 'MODELLED', 'INFERRED', 'UNCONFIRMED'] as const).map((k) => `**${k}:** ${f.evidenceBasis[k].length ? f.evidenceBasis[k].join('; ') : '—'}`).join('  \n'));
    sec('13. Data provenance', table(['Input', 'Source'], f.provenance.map((p) => [p.label, p.value])));
  }
  out.push(`---\n${h.documentRef} · rev ${h.revision} · ${h.systemName} · ${h.modelVersion}${n.demonstrationNotice ? `\n\n**${n.demonstrationNotice}**` : ''}\n`);
  return out.join('\n');
}

function groupMd(kind: DeltaKind, items: string[]) {
  return items.length ? `**${kind}**\n${items.map((t) => `- ${t}`).join('\n')}` : '';
}

export const shoreLine = (v: boolean | null) => (v === true ? 'Shoreline impact: **OBSERVED**.' : v === false ? 'No confirmed shoreline impact as of report time.' : 'Shoreline impact: NOT SURVEYED.');
