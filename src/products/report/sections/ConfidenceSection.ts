import { C, DASH, LW, T } from '../ReportTheme';
import type { ReportContext, Box } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawLevelGauge, drawStateBadge } from '../components/Drafting';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { confidenceMatrixHeight, drawConfidenceMatrix } from '../charts/ConfidenceMatrix';
import { drawConfidencePropagation } from '../diagrams/ConfidencePropagation';
import { u } from '../utils/units';

/** Hourly AIS coverage columns with threshold line; low hours are hatched, not just coloured. */
function drawCoverageColumns(ctx: ReportContext, b: Box, data: { offsetH: number; coveragePct: number }[], threshold: number) {
  const L = 40;
  const p = { x: b.x + L, y: b.y + 8, w: b.w - L - 70, h: b.h - 34 };
  const colW = p.w / data.length;
  const sy = (v: number) => p.y + p.h - (v / 100) * p.h;
  [0, 25, 50, 75, 100].forEach((v) => {
    ctx.line(p.x, sy(v), p.x + p.w, sy(v), LW.hair, C.faint);
    ctx.font('mono', T.micro, C.ink2);
    ctx.textMid(`${v}`, p.x - 5 - ctx.width(`${v}`), sy(v));
  });
  data.forEach((dp, i) => {
    const x = p.x + i * colW + 1.5;
    const bb = { x, y: sy(dp.coveragePct), w: colW - 3, h: p.y + p.h - sy(dp.coveragePct) };
    if (dp.coveragePct < threshold) {
      ctx.fillRect(bb, C.paper);
      ctx.hatch(bb, 2, LW.hair, C.ink);
      ctx.rect(bb, LW.fine);
      ctx.font('monoMedium', T.zone, C.ink);
      ctx.textMid(String(dp.coveragePct), x + (colW - 3) / 2 - ctx.width(String(dp.coveragePct)) / 2, bb.y - 5);
    } else {
      ctx.rect(bb, LW.hair, C.ink, '#7a7a7a');
    }
    if (dp.offsetH % 3 === 0) {
      ctx.font('mono', T.micro, C.ink2);
      const s = u.rel(dp.offsetH);
      ctx.textMid(s, x + (colW - 3) / 2 - ctx.width(s) / 2, p.y + p.h + 8);
    }
  });
  ctx.line(p.x, sy(threshold), p.x + p.w, sy(threshold), LW.fine, C.ink, DASH.dashed);
  ctx.font('cond', T.micro, C.ink);
  ctx.font('cond', T.micro, C.ink);
  ctx.text(`${threshold} % adequacy
threshold`, p.x + p.w + 6, sy(threshold) - 7, { w: 60, lineGap: -0.5 });
  ctx.line(p.x, p.y, p.x, p.y + p.h, LW.medium);
  ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, LW.medium);
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('HOUR RELATIVE TO OBSERVATION', p.x, p.y + p.h + 20, { w: p.w, align: 'center', cs: 0.4 });
  ctx.doc.save();
  ctx.doc.translate(b.x + 7, p.y + p.h / 2).rotate(-90);
  ctx.textMid('AIS COVERAGE (%)', -p.h / 2, 0, { w: p.h, align: 'center', cs: 0.4 });
  ctx.doc.restore();
}

/** Log-scale age bars; continuous streams marked separately. */
function drawAgeChart(ctx: ReportContext, b: Box, rows: { dataset: string; ageHours: number | null; age: string }[]) {
  const L = 120, lo = 0.1, hi = 20000;
  const p = { x: b.x + L, y: b.y + 4, w: b.w - L - 60, h: b.h - 30 };
  const sx = (h: number) => p.x + ((Math.log10(h) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * p.w;
  const ticks: [number, string][] = [[0.1, '6 min'], [1, '1 h'], [6, '6 h'], [24, '1 d'], [168, '1 wk'], [720, '1 mo'], [8760, '1 yr']];
  ticks.forEach(([h, l]) => {
    ctx.line(sx(h), p.y, sx(h), p.y + p.h, LW.hair, C.faint);
    ctx.line(sx(h), p.y + p.h, sx(h), p.y + p.h + 3, LW.fine);
    ctx.font('mono', T.micro, C.ink2);
    ctx.textMid(l, sx(h) - ctx.width(l) / 2, p.y + p.h + 8.5);
  });
  ctx.fillRect({ x: p.x, y: p.y, w: sx(6) - p.x, h: p.h }, C.tint2);
  ctx.line(sx(6), p.y - 2, sx(6), p.y + p.h, LW.fine, C.ink, DASH.dashed);
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('≤ 6 h: CURRENT FOR DRIFT MODELLING', p.x + 3, p.y + 5);
  ctx.line(p.x, p.y, p.x, p.y + p.h, LW.medium);
  ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, LW.medium);
  const rowH = (p.h - 10) / rows.length;
  rows.forEach((r, i) => {
    const yc = p.y + 10 + rowH * (i + 0.5);
    ctx.font('condMedium', T.label, C.ink);
    ctx.textMid(r.dataset, b.x, yc);
    if (r.ageHours === null) {
      ctx.line(p.x, yc, p.x + p.w, yc, LW.fine, C.ink, DASH.dotted);
      ctx.font('cond', T.micro, C.ink2);
      ctx.fillRect({ x: p.x + p.w / 2 - 40, y: yc - 4, w: 80, h: 8 }, C.paper);
      ctx.font('cond', T.micro, C.ink2);
      ctx.textMid('continuous stream', p.x + p.w / 2 - 36, yc);
      return;
    }
    const x = sx(Math.max(lo, r.ageHours));
    ctx.rect({ x: p.x, y: yc - 3, w: x - p.x, h: 6 }, LW.fine, C.ink, r.ageHours <= 6 ? C.ink2 : C.paper);
    if (r.ageHours > 6) ctx.hatch({ x: p.x, y: yc - 3, w: x - p.x, h: 6 }, 2.2, LW.hair, C.ink);
    ctx.font('mono', T.micro, C.ink);
    ctx.textMid(r.age, x + 4, yc);
  });
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('AGE AT T0 (LOG SCALE)', p.x, p.y + p.h + 20, { w: p.w, align: 'center', cs: 0.4 });
}

export function confidenceSection(ctx: ReportContext) {
  const cd = ctx.data.confidence;
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '12', sectionTitle: 'Uncertainty and confidence' });
  f.sectionHeader('Confidence is decomposed by analytical component and rated against five criteria. No single aggregate confidence value is reported, because the components fail for different reasons and must be corroborated independently.');

  f.figure(confidenceMatrixHeight(cd), 'Confidence matrix — components × criteria, with component score and assessment state', (b) => drawConfidenceMatrix(ctx, b, cd), { note: 'ILLUSTRATIVE' });

  f.heading('Limiting factors by component', 120);
  drawEngineeringTable(f, {
    rows: cd.components,
    rowPad: 2.8,
    columns: [
      { header: 'ID', w: 0.3, font: 'mono', value: (r) => r.id },
      { header: 'Component', w: 1.2, font: 'condMedium', value: (r) => r.name },
      { header: 'Level', w: 0.95, drawH: 6, draw: (c, r, b) => { const gw = drawLevelGauge(c, r.level, b.x + 4, b.y + b.h / 2, 5, 5); c.font('cond', T.label); c.textMid(r.level, b.x + 8 + gw, b.y + b.h / 2); } },
      { header: 'Principal limiting factor', w: 2, value: (r) => r.limitingFactor },
      { header: 'State', w: 0.95, drawH: 10, draw: (c, r, b) => drawStateBadge(c, r.state, b.x + 4, b.y + b.h / 2, b.w - 8, 10) },
    ],
  });

  if (cd.components.some((c) => c.dependsOn?.length)) {
    f.heading('Confidence propagation', 230);
    f.para('Arrows show which components inherit uncertainty from which inputs. Line style follows the upstream state (solid = supported, dashed = ambiguous / insufficiently constrained, dotted = not assessable). A derived conclusion cannot be more certain than its weakest input.', { size: T.small + 0.2, color: C.ink2 });
    f.figure(Math.min(210, f.room - 24), 'Dependency of analytical conclusions on component confidence', (b) => drawConfidencePropagation(ctx, b, cd.components), { note: 'ILLUSTRATIVE' });
  }

  // Data quality (section 13) shares the confidence theme but gets its own register entry.
  const g = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '13', sectionTitle: 'Data quality matrix' });
  g.sectionHeader('Resolution, age, coverage and quality of every dataset used. Age is measured at T0. Coverage is the fraction of the analysis domain and window for which valid data exist.');
  drawEngineeringTable(g, {
    caption: 'Dataset quality register (illustrative values)',
    rows: cd.dataQuality,
    columns: [
      { header: 'Dataset', w: 1, font: 'condSemi', value: (r) => r.dataset },
      { header: 'Source', w: 1.3, font: 'cond', value: (r) => r.source },
      { header: 'Resolution', w: 0.62, font: 'mono', value: (r) => r.resolution },
      { header: 'Age at T0', w: 0.55, font: 'mono', value: (r) => r.age },
      { header: 'Coverage', w: 1.05, drawH: 7, draw: (c, r, b) => {
        const bw = b.w - 34, yc = b.y + b.h / 2;
        c.rect({ x: b.x + 4, y: yc - 3.5, w: bw, h: 7 }, LW.hair, C.rule, C.paper);
        c.fillRect({ x: b.x + 4, y: yc - 3.5, w: (bw * r.coveragePct) / 100, h: 7 }, r.coveragePct < 80 ? '#b0b0b0' : C.ink2);
        if (r.coveragePct < 80) c.hatch({ x: b.x + 4, y: yc - 3.5, w: (bw * r.coveragePct) / 100, h: 7 }, 2, LW.hair, C.ink);
        c.font('mono', T.label, C.ink);
        c.textMid(`${r.coveragePct}%`, b.x + bw + 7, yc);
      } },
      { header: 'Quality', w: 0.95, drawH: 6, draw: (c, r, b) => { const gw = drawLevelGauge(c, r.quality, b.x + 4, b.y + b.h / 2, 5, 5); c.font('cond', T.label); c.textMid(r.quality, b.x + 8 + gw, b.y + b.h / 2); } },
      { header: 'Note', w: 1.1, font: 'cond', value: (r) => r.note },
    ],
  });
  g.heading('AIS temporal coverage', 200);
  const mean = cd.aisCoverageByHour.reduce((s, x) => s + x.coveragePct, 0) / cd.aisCoverageByHour.length;
  g.para(`Hourly AIS coverage over the analysis window (mean ${mean.toFixed(0)} %). Hatched columns fall below the adequacy threshold and coincide with the strongest release interval, which directly limits attribution support.`, { color: C.ink2 });
  g.figure(170, 'Hourly AIS position coverage within the screening radius', (b) => drawCoverageColumns(ctx, b, cd.aisCoverageByHour, 80), { note: 'ILLUSTRATIVE' });

  g.heading('Dataset age at observation', 160);
  g.figure(Math.max(130, Math.min(170, g.room - 20)), 'Age of each dataset at T0 (logarithmic scale)', (b) => drawAgeChart(ctx, b, cd.dataQuality), { note: 'ILLUSTRATIVE' });
}
