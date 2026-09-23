import { C, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawMarker, drawStatusStamp } from '../components/Drafting';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { drawReleaseTimeline } from '../charts/TimelineChart';
import { u, utcShort } from '../utils/units';

export function releaseTimeSection(ctx: ReportContext) {
  const d = ctx.data, ra = d.releaseAssessment;
  const t0 = Date.parse(d.metadata.observationTime);
  const at = (h: number) => utcShort(new Date(t0 + h * 3600_000).toISOString());
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '07', sectionTitle: 'Release-time assessment' });
  f.sectionHeader(
    'Relative support for candidate release times, combining hindcast zone confidence with the timing of compatible transits and independent observations. The result is an interval with stated support, never a point estimate.',
  );

  drawStatusStamp(ctx, { x: f.x, y: f.y, w: f.w, h: 34 }, [
    `MOST STRONGLY SUPPORTED INTERVAL: ${Math.abs(ra.strongest.toH)}–${Math.abs(ra.strongest.fromH)} H PRIOR TO OBSERVATION`,
    'ILLUSTRATIVE · NO EXACT RELEASE TIME IS ASSERTED · ALTERNATE INTERVAL NOT EXCLUDED',
  ]);
  f.y += 44;

  f.figure(258, 'Release-time reconstruction — support, intervals and evidence on a common time axis', (b) => drawReleaseTimeline(ctx, b, ra), { note: 'ILLUSTRATIVE' });

  f.heading('Interval summary', 100);
  const rows = [
    { name: 'Strongest supported', from: ra.strongest.fromH, to: ra.strongest.toH, s: ra.strongest.support as number | null, basis: 'Peak of support curve; coincides with Vessel-17 zone transit and Medium hindcast confidence' },
    { name: 'Alternate', from: ra.alternate.fromH, to: ra.alternate.toH, s: ra.alternate.support as number | null, basis: 'Secondary peak; coincides with Vessel-04 transit; higher hindcast confidence but weaker morphology fit' },
    { name: 'Uncertainty band', from: ra.uncertaintyBand.fromH, to: ra.uncertaintyBand.toH, s: null, basis: 'Range outside which support is below 10 % of peak' },
  ];
  drawEngineeringTable(f, {
    caption: 'Candidate release intervals',
    rows,
    columns: [
      { header: 'Interval', w: 0.9, font: 'condSemi', value: (r) => r.name },
      { header: 'Relative window', w: 0.9, font: 'mono', value: (r) => `${u.rel(r.from)} … ${u.rel(r.to)}` },
      { header: 'UTC window', w: 1.15, font: 'mono', value: (r) => `${at(r.from)} – ${at(r.to).slice(-6)}` },
      { header: 'Support', unit: '0–1', w: 0.5, font: 'mono', align: 'right', value: (r) => (r.s === null ? '—' : r.s.toFixed(2)) },
      { header: 'Basis', w: 2.2, value: (r) => r.basis },
    ],
  });

  f.heading('Evidence register', 90);
  drawEngineeringTable(f, {
    rows: ra.evidence,
    columns: [
      { header: '', w: 0.22, drawH: 6, draw: (c, r, b) => drawMarker(c, r.kind === 'neutral' ? 'circle' : 'triangle', b.x + b.w / 2, b.y + b.h / 2, 2.6, C.ink, r.kind === 'supporting') },
      { header: 'Time', w: 0.6, font: 'mono', value: (r) => u.rel(r.offsetH) },
      { header: 'Evidence', w: 2.6, value: (r) => r.label },
      { header: 'Bearing on interval', w: 0.9, font: 'condSemi', value: (r) => r.kind.toUpperCase() },
    ],
  });
  f.list(ra.notes, { size: T.small + 0.2, gap: 3 });
}
