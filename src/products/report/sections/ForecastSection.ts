import { C, DASH, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { drawLineChart } from '../charts/LineChart';
import { drawForecastPlate, horizonDash } from '../diagrams/ForecastDiagram';
import { toXY, bearingOf } from '../utils/geo';
import { latLon, u, utc } from '../utils/units';

export function forecastSection(ctx: ReportContext) {
  const d = ctx.data, fc = d.forecast;
  const box = ctx.addPage({
    orientation: 'landscape',
    kind: 'plate',
    sectionNo: '10',
    sectionTitle: 'Forward drift forecast',
    plate: {
      drawingNo: `FC-01 / ${d.metadata.incidentId.split('-').pop()}`,
      title: 'Forward drift forecast',
      subtitle: `${fc.model}. Issued ${utc(fc.issuedAt)}.`,
      scale: 'AS SHOWN',
      legend: [
        { label: 'OBSERVED slick (T0)', kind: 'area', fill: C.ink },
        ...fc.horizons.map((h) => ({ label: `PREDICTED envelope +${h.horizonH} h`, kind: 'line' as const, style: { lw: 1.1, color: C.model, dash: horizonDash(h.horizonH) } })),
        { label: 'Predicted centre', kind: 'marker', marker: 'plus', style: { color: C.model } },
        { label: 'Shoreline contact zone (+24 h)', kind: 'line', style: { lw: 3, color: C.critical } },
        { label: 'Land (schematic)', kind: 'hatch', style: { lw: 1 } },
        { label: 'Resource, priority ≥ 85', kind: 'area', fill: C.ink },
        { label: 'Resource, priority < 85', kind: 'area', fill: C.paper },
      ],
      notes: fc.notes,
    },
  });
  drawForecastPlate(ctx, box);

  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '10', sectionTitle: 'Forward drift forecast', continued: true });
  f.heading('Forecast uncertainty growth', 340);
  f.para('Positional uncertainty is the radius enclosing the ensemble spread about the mean centre. It grows with horizon as forcing errors accumulate; beyond +12 h it exceeds the width of the observed slick and shoreline interaction dominates.', { color: C.ink2 });
  const g = fc.uncertaintyGrowth;
  f.figure(330, 'Forecast horizon vs positional uncertainty radius', (b) =>
    drawLineChart(ctx, b, {
      x: { min: 0, max: 24, ticks: [0, 3, 6, 12, 18, 24], format: (v) => `+${v}`, title: 'Forecast horizon (h after T0)' },
      y: { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], format: (v) => v.toFixed(0), title: 'Uncertainty radius (km)' },
      vbands: [{ from: 12, to: 24, label: 'SHORELINE INTERACTION LIKELY', hatch: true }],
      hlines: [{ y: d.slick.lengthKm / 2, label: `Observed slick half-length ${u.km(d.slick.lengthKm / 2, 1)}` }],
      series: [{
        label: 'Uncertainty radius (modelled)',
        points: g.map((p) => [p.horizonH, p.radiusKm]),
        band: { upper: g.map((p) => [p.horizonH, p.radiusKm]), lower: g.map((p) => [p.horizonH, 0]), label: 'Envelope of possible centre positions' },
        style: { lw: 1.3, color: C.model, dash: DASH.dashed },
        marker: 'diamond',
        valueLabels: (v) => u.km(v, 1),
      }],
      legendCols: 2,
    }), { note: 'ILLUSTRATIVE' });

  f.heading('Forecast horizons', 120);
  drawEngineeringTable(f, {
    caption: 'Predicted centre, spread and shoreline contact (illustrative)',
    rows: fc.horizons,
    columns: [
      { header: 'Horizon', w: 0.55, font: 'monoMedium', value: (r) => `+${r.horizonH} h` },
      { header: 'Valid time', unit: 'UTC', w: 1.05, font: 'mono', value: (r) => utc(new Date(Date.parse(d.metadata.observationTime) + r.horizonH * 3600_000).toISOString()) },
      { header: 'Predicted centre', unit: 'WGS-84', w: 1.5, font: 'mono', value: (r) => latLon(r.centre, 2) },
      { header: 'Displacement', unit: 'km @ ° true', w: 0.9, font: 'mono', align: 'right', value: (r) => { const c = toXY(d.slick.centroid, r.centre); return `${Math.hypot(c.x, c.y).toFixed(1)} @ ${u.bearing(bearingOf(c))}`; } },
      { header: 'Radius', unit: 'km', w: 0.5, font: 'mono', align: 'right', value: (r) => r.uncertaintyRadiusKm.toFixed(1) },
      { header: 'P(shore contact)', w: 0.9, drawH: 7, draw: (c, r, b) => {
        const bw = b.w - 34, yc = b.y + b.h / 2;
        c.rect({ x: b.x + 4, y: yc - 3.5, w: bw, h: 7 }, LW.hair, C.rule, C.paper);
        c.fillRect({ x: b.x + 4, y: yc - 3.5, w: bw * r.shorelineContactProbability, h: 7 }, C.ink2);
        c.font('mono', T.table, C.ink);
        c.textMid(u.frac(r.shorelineContactProbability), b.x + bw + 7, yc);
      } },
    ],
  });
  f.heading('Observed versus modelled', 60);
  f.list([
    'OBSERVED geometry (slick SG-01) is drawn solid black and is measured from SAR at T0.',
    'MODELLED / PREDICTED geometry is drawn in dashed model-blue line styles that differ per horizon (+6 h dashed, +12 h chain, +24 h dotted), so horizons remain distinguishable in greyscale.',
    ...fc.notes,
  ], { size: T.small + 0.2, gap: 3 });
}
