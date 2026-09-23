import { C, DASH, LW, T } from '../ReportTheme';
import type { ThreatenedResource } from '../ReportTypes';
import type { Box, ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawLevelGauge, drawMarker, drawStatusStamp } from '../components/Drafting';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { drawBarChart } from '../charts/BarChart';

/** Arrival-window chart: range bars per resource with ETA marker against the forecast horizon. */
function drawArrivalWindows(ctx: ReportContext, b: Box, res: ThreatenedResource[], horizonH: number) {
  const L = 150, max = 40;
  const p = { x: b.x + L, y: b.y + 16, w: b.w - L - 12, h: b.h - 42 };
  const sx = (h: number) => p.x + (h / max) * p.w;
  const rowH = p.h / res.length;
  ctx.fillRect({ x: sx(horizonH), y: p.y, w: sx(max) - sx(horizonH), h: p.h }, C.tint2);
  ctx.hatch({ x: sx(horizonH), y: p.y, w: sx(max) - sx(horizonH), h: p.h }, 4, LW.hair, C.faint);
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('BEYOND FORECAST HORIZON — INDICATIVE', sx(horizonH) + 4, p.y + 6);
  for (let h = 0; h <= max; h += 6) {
    ctx.line(sx(h), p.y, sx(h), p.y + p.h, LW.hair, C.faint);
    ctx.line(sx(h), p.y + p.h, sx(h), p.y + p.h + 3, LW.fine);
    ctx.font('mono', T.micro, C.ink2);
    ctx.textMid(`+${h}`, sx(h) - ctx.width(`+${h}`) / 2, p.y + p.h + 8.5);
  }
  ctx.line(sx(horizonH), p.y - 4, sx(horizonH), p.y + p.h, LW.medium, C.ink, DASH.dashed);
  ctx.font('condSemi', T.micro, C.ink);
  ctx.textMid(`FORECAST HORIZON +${horizonH} h`, sx(horizonH) - ctx.width(`FORECAST HORIZON +${horizonH} h`) / 2, p.y - 8);
  ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, LW.medium);
  ctx.line(p.x, p.y, p.x, p.y + p.h, LW.medium);
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('HOURS AFTER OBSERVATION (T0)', p.x, p.y + p.h + 20, { w: p.w, align: 'center', cs: 0.4 });
  res.forEach((r, i) => {
    const yc = p.y + rowH * (i + 0.5);
    ctx.font('condMedium', T.small, C.ink);
    ctx.textMid(`${r.id}  ${r.name}`, b.x, yc);
    if (!r.arrivalWindowH || r.estimatedArrivalH === null) {
      ctx.font('cond', T.label, C.ink3);
      ctx.textMid('no arrival expected within modelled period', p.x + 6, yc);
      return;
    }
    const [a, z] = r.arrivalWindowH;
    const beyond = r.estimatedArrivalH > horizonH;
    ctx.rect({ x: sx(a), y: yc - 4, w: sx(z) - sx(a), h: 8 }, LW.fine, C.ink, beyond ? C.paper : '#9a9a9a', beyond ? DASH.short : null);
    drawMarker(ctx, 'diamond', sx(r.estimatedArrivalH), yc, 3.2, C.ink, !beyond);
    ctx.font('mono', T.micro, C.ink);
    ctx.textMid(`+${r.estimatedArrivalH} h`, sx(z) + 5, yc);
  });
}

export function impactSection(ctx: ReportContext) {
  const d = ctx.data, res = d.impacts.resources;
  const horizon = Math.max(...d.forecast.horizons.map((h) => h.horizonH));
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '11', sectionTitle: 'Impact and protection priority' });
  f.sectionHeader('Resources intersected by the forecast envelopes, ranked for protection planning. Priority combines exposure, sensitivity, arrival time and confidence. Scores are illustrative planning values, not damage estimates.');

  drawEngineeringTable(f, {
    caption: 'Threatened resources ranked by protection priority (illustrative)',
    rows: res,
    highlight: (r) => r.priorityScore >= 85,
    columns: [
      { header: 'ID', w: 0.4, font: 'monoMedium', value: (r) => r.id },
      { header: 'Resource', w: 1.3, font: 'condMedium', value: (r) => r.name },
      { header: 'Type', w: 0.72, font: 'cond', value: (r) => r.type },
      { header: 'ETA', unit: 'h after T0', w: 0.64, font: 'mono', value: (r) => (r.estimatedArrivalH === null ? '—' : `+${r.estimatedArrivalH}${r.estimatedArrivalH > horizon ? '*' : ''}`) },
      { header: 'Exposure', w: 1.05, drawH: 6, draw: (c, r, b) => { const gw = drawLevelGauge(c, r.exposure, b.x + 4, b.y + b.h / 2, 5, 5); c.font('cond', T.label); c.textMid(r.exposure, b.x + 8 + gw, b.y + b.h / 2); } },
      { header: 'Sensitivity', unit: '1–5', w: 0.75, drawH: 6, draw: (c, r, b) => { for (let k = 0; k < 5; k++) { c.pen(LW.fine); c.doc.circle(b.x + 8 + k * 8, b.y + b.h / 2, 2.6); if (k < r.sensitivity) c.doc.fillAndStroke(C.ink, C.ink); else c.doc.stroke(); } } },
      { header: 'Confidence', w: 0.72, font: 'cond', value: (r) => r.confidence },
      { header: 'Priority', unit: '0–100', w: 0.8, drawH: 7, draw: (c, r, b) => {
        const bw = b.w - 26, yc = b.y + b.h / 2;
        c.rect({ x: b.x + 4, y: yc - 3.5, w: bw, h: 7 }, LW.hair, C.rule, C.paper);
        c.fillRect({ x: b.x + 4, y: yc - 3.5, w: (bw * r.priorityScore) / 100, h: 7 }, r.priorityScore >= 85 ? C.ink : '#8a8a8a');
        c.font('monoMedium', T.table, C.ink);
        c.textMid(String(r.priorityScore), b.x + bw + 7, yc);
      } },
      { header: 'Recommended action', w: 1.4, value: (r) => r.action },
    ],
  });
  f.para(`* Beyond the +${horizon} h forecast horizon: indicative extrapolation only. ${d.impacts.notes[0]}`, { size: T.label, color: C.ink3 });

  f.heading('Threatened-resource priority', 190);
  drawStatusStamp(ctx, { x: f.x, y: f.y, w: f.w, h: 22 }, ['ILLUSTRATIVE PLANNING SCORES — NOT DAMAGE OR LIABILITY ESTIMATES']);
  f.y += 30;
  const sorted = [...res].sort((a, b) => b.priorityScore - a.priorityScore);
  f.figure(158, 'Protection priority by resource', (b) =>
    drawBarChart(ctx, b, {
      items: sorted.map((r) => ({ label: `${r.id}  ${r.name}`, sublabel: `${r.type} · sensitivity ${r.sensitivity}/5 · exposure ${r.exposure}`, value: r.priorityScore, emphasis: r.priorityScore >= 85 })),
      max: 100,
      ticks: [0, 20, 40, 60, 80, 100],
      axisTitle: 'Protection priority score (0–100, illustrative)',
      labelW: 170,
      thresholds: [{ value: 85, label: '85 — immediate pre-positioning' }],
      barH: 10,
    }), { note: 'ILLUSTRATIVE' });

  f.heading('Estimated arrival windows', 150);
  f.figure(146, 'Estimated arrival window and most likely arrival per resource', (b) => drawArrivalWindows(ctx, b, res, horizon), { note: 'MODELLED' });
}
