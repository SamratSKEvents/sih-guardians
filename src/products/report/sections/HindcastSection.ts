import { C, DASH, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { drawLevelGauge } from '../components/Drafting';
import { drawLineChart } from '../charts/LineChart';
import { drawHindcastPlate, zoneDash } from '../diagrams/TrajectoryDiagram';
import { latLon, u } from '../utils/units';

export function hindcastSection(ctx: ReportContext) {
  const d = ctx.data, hc = d.hindcast;
  const box = ctx.addPage({
    orientation: 'landscape',
    kind: 'plate',
    sectionNo: '06',
    sectionTitle: 'Hindcast / source reconstruction',
    plate: {
      drawingNo: `HC-01 / ${d.metadata.incidentId.split('-').pop()}`,
      title: 'Hindcast source reconstruction',
      subtitle: `Backward drift ${hc.steps[hc.steps.length - 1].horizonH} h from observation SG-01.`,
      scale: 'AS SHOWN',
      legend: [
        { label: 'Observed slick (T0)', kind: 'area', fill: C.ink },
        { label: 'Hindcast centre track', kind: 'line', style: { lw: 1.2, color: C.model, dash: DASH.dashDot }, marker: 'diamond' },
        { label: 'Particle track (sample)', kind: 'line', style: { lw: LW.hair, color: '#a8a8a8' } },
        { label: 'Support zone, T−3 h', kind: 'line', style: { lw: 0.9, color: C.model, dash: zoneDash(3) } },
        { label: 'Support zone, T−12 h', kind: 'line', style: { lw: 0.9, color: C.model, dash: zoneDash(12) } },
        { label: 'Support zone, T−24 h', kind: 'line', style: { lw: 0.9, color: C.model, dash: zoneDash(24) } },
        { label: 'Zone interior (modelled)', kind: 'hatch', style: { lw: LW.fine, color: C.model } },
      ],
      notes: [
        'All geometry except the observed slick is MODELLED.',
        `Zones = ${hc.parameters.find((p) => p.name.startsWith('Support'))?.value ?? 'particle density contour'}.`,
        'Hatch spacing widens and outline dash loosens as confidence decreases.',
        'Centre diamonds every 3 h; dots hourly.',
        'A zone indicates where a release is compatible with drift, not where it occurred.',
      ],
    },
  });
  drawHindcastPlate(ctx, box);

  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '06', sectionTitle: 'Hindcast / source reconstruction', continued: true });
  f.heading('Source-support zones by horizon', 160);
  f.para(
    `Backward Lagrangian tracking of ${hc.particleCount.toLocaleString('en-GB')} particles seeded in the slick mask, forced by the records in Section 05. Each horizon yields a source-support zone whose radius grows with integration time; confidence decreases accordingly.`,
    { color: C.ink2 },
  );
  drawEngineeringTable(f, {
    caption: 'Source-support zones by hindcast horizon (illustrative)',
    rows: hc.steps,
    columns: [
      { header: 'Hindcast', w: 0.6, font: 'monoMedium', value: (r) => `${r.horizonH} h` },
      { header: 'Zone centre', unit: 'WGS-84', w: 1.6, font: 'mono', value: (r) => latLon(r.centre, 2) },
      { header: 'Source support area', unit: 'km²', w: 0.9, font: 'mono', align: 'right', value: (r) => r.supportAreaKm2.toFixed(1) },
      { header: 'Spread radius', unit: 'km', w: 0.75, font: 'mono', align: 'right', value: (r) => r.spreadRadiusKm.toFixed(1) },
      { header: 'Confidence', w: 1.25, drawH: 8, draw: (c, r, b) => {
        const gw = drawLevelGauge(c, r.confidence, b.x + 5, b.y + b.h / 2);
        c.font('cond', T.table, C.ink);
        c.textMid(r.confidence, b.x + 10 + gw, b.y + b.h / 2);
      } },
      { header: 'Score', unit: '0–1', w: 0.5, font: 'mono', align: 'right', value: (r) => r.confidenceScore.toFixed(2) },
    ],
  });

  f.heading('Hindcast uncertainty growth', 220);
  const half = (f.w - 16) / 2;
  const y0 = f.y;
  const xAx = { min: 0, max: 24, ticks: [0, 3, 6, 9, 12, 18, 24], format: (v: number) => `${v}`, title: 'Hindcast horizon (h before T0)' };
  f.figure(236, 'Spread radius vs hindcast horizon', (b) =>
    drawLineChart(ctx, b, {
      x: xAx,
      y: { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], format: (v) => v.toFixed(0), title: 'Spread radius (km)' },
      series: [{
        label: 'Spread radius r (modelled)',
        points: hc.steps.map((s) => [s.horizonH, s.spreadRadiusKm]),
        style: { lw: 1.1, color: C.model, dash: DASH.dashed },
        marker: 'diamond',
        valueLabels: (v) => v.toFixed(1),
      }],
      vbands: [{ from: 12, to: 24, label: 'r > 5 km', hatch: true }],
      legendCols: 1,
    }), { w: half });
  const yA = f.y;
  f.y = y0;
  f.figure(236, 'Hindcast confidence vs horizon', (b) =>
    drawLineChart(ctx, b, {
      x: xAx,
      y: { min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], format: (v) => v.toFixed(1), title: 'Confidence score' },
      hlines: [{ y: 0.5, label: 'Decision threshold 0.5' }],
      series: [{ label: 'Hindcast confidence', points: hc.steps.map((s) => [s.horizonH, s.confidenceScore]), style: { lw: 1.1 }, marker: 'square', valueLabels: (v) => v.toFixed(2) }],
      legendCols: 1,
    }), { w: half, x: f.x + half + 16 });
  f.y = Math.max(yA, f.y);

  f.heading('Model configuration (extract — full list in Appendix D)', 100);
  f.keyValues(hc.parameters.slice(0, 8).map((p) => [p.name, `${p.value}   —   ${p.note}`]), { labelW: 150 });
  f.para(
    `Interpretation: zones up to ${u.hours(9)} remain compact (r ≤ ${u.km(hc.steps[2].spreadRadiusKm, 1)}) and discriminate between vessel transits; beyond ${u.hours(12)} the zone radius exceeds ${u.km(5, 0)} and multiple sources remain compatible.`,
    { size: T.small + 0.3, color: C.ink2 },
  );
  void LW;
}
