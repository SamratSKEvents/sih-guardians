import { C, DASH, LW, T } from '../ReportTheme';
import type { AisCandidate } from '../ReportTypes';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawLevelGauge, drawStateBadge, drawStatusStamp, drawVectorArrow } from '../components/Drafting';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { STACK_STYLES, drawBarChart } from '../charts/BarChart';
import { u } from '../utils/units';

const COMPONENTS = ['spatial', 'temporal', 'direction', 'trajectory', 'evidence'] as const;
const COMPONENT_LABEL = { spatial: 'Spatial', temporal: 'Temporal', direction: 'Direction', trajectory: 'Trajectory', evidence: 'Evidence quality' };

function scoreBar(ctx: ReportContext, c: AisCandidate, b: { x: number; y: number; w: number; h: number }) {
  const bw = b.w - 30, yc = b.y + b.h / 2;
  ctx.rect({ x: b.x + 4, y: yc - 3.5, w: bw, h: 7 }, LW.hair, C.rule, C.paper);
  ctx.fillRect({ x: b.x + 4, y: yc - 3.5, w: (bw * c.score) / 100, h: 7 }, c.state === 'SUPPORTED' ? C.ink : '#7a7a7a');
  ctx.font('monoMedium', T.table, C.ink);
  ctx.textMid(String(c.score), b.x + bw + 8, yc);
}

export function aisSection(ctx: ReportContext) {
  const d = ctx.data, ais = d.aisCandidates;
  const cands = ais.candidates;
  const f = new Flow(ctx, { orientation: 'landscape', kind: 'standard', sectionNo: '08', sectionTitle: 'AIS vessel analysis' });
  f.sectionHeader(
    `AIS positions within ${u.km(ais.searchRadiusKm, 0)} and ${ais.analysisWindowH} h of the observation were intersected with the hindcast support zones. Each candidate receives five component scores (0–100) combined with fixed weights. Vessel names and MMSI values are anonymised dummies.`,
  );

  // screening funnel + score definition
  const y0 = f.y;
  const stages: [string, string][] = [
    [String(ais.totalVesselsAnalysed), 'vessels in AIS extract'],
    [String(cands.length), `within ${u.km(ais.searchRadiusKm, 0)} / ${ais.analysisWindowH} h`],
    [String(cands.filter((c) => c.score >= 60).length), 'score ≥ 60'],
    [String(cands.filter((c) => c.state === 'SUPPORTED').length), 'state SUPPORTED'],
  ];
  const bw = 92, gap = 26;
  stages.forEach(([n, l], i) => {
    const x = f.x + i * (bw + gap);
    const h = 40 - i * 4;
    const b = { x, y: y0 + (40 - h) / 2, w: bw, h };
    ctx.rect(b, i === 3 ? LW.heavy : LW.fine, C.ink, i === 3 ? C.tint : undefined);
    ctx.font('monoMedium', 13, C.ink);
    ctx.textMid(n, b.x + 8, b.y + b.h / 2 - 4);
    ctx.font('cond', T.label, C.ink2);
    ctx.textMid(l, b.x + 8, b.y + b.h / 2 + 9);
    if (i < 3) drawVectorArrow(ctx, { x: x + bw + 4, y: y0 + 20 }, { x: x + bw + gap - 4, y: y0 + 20 }, { lw: LW.fine, head: 4.5 });
  });
  const fx = f.x + 4 * (bw + gap) + 4, fw = f.x + f.w - fx;
  ctx.rect({ x: fx, y: y0, w: fw, h: 40 }, LW.fine);
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('SUPPORT SCORE DEFINITION', fx + 6, y0 + 7, { cs: 0.4 });
  const wts = ais.weights;
  ctx.font('monoMedium', T.small, C.ink);
  ctx.textMid(`S = ${wts.spatial.toFixed(2)}·Sp + ${wts.temporal.toFixed(2)}·Te + ${wts.direction.toFixed(2)}·Di + ${wts.trajectory.toFixed(2)}·Tr + ${wts.evidence.toFixed(2)}·Ev`, fx + 6, y0 + 20);
  ctx.font('cond', T.label, C.ink2);
  ctx.textMid('Analytical support score — indicates compatibility only, not determination of responsibility.', fx + 6, y0 + 32);
  f.y = y0 + 50;

  drawEngineeringTable(f, {
    caption: `Candidate vessels ranked by analytical support score (${cands.length} shown) — illustrative`,
    rows: cands,
    highlight: (_r, i) => i === 0,
    rowPad: 3,
    columns: [
      { header: 'Rank', w: 0.35, font: 'monoMedium', align: 'center', value: (_r, i) => String(i + 1).padStart(2, '0') },
      { header: 'Cand.', w: 0.45, font: 'monoMedium', value: (r) => r.candidateId },
      { header: 'Vessel (anon.)', w: 0.8, font: 'condMedium', value: (r) => r.vesselName },
      { header: 'MMSI (dummy)', w: 0.8, font: 'mono', value: (r) => r.mmsi },
      { header: 'Type', w: 1.05, font: 'cond', value: (r) => r.type },
      { header: 'CPA to zone', unit: 'km', w: 0.55, font: 'mono', align: 'right', value: (r) => r.closestApproachKm.toFixed(1) },
      { header: 'CPA time', unit: 'h rel. T0', w: 0.55, font: 'mono', align: 'right', value: (r) => u.num(r.closestApproachOffsetH, 1) },
      { header: 'Δt vs interval', unit: 'h', w: 0.55, font: 'mono', align: 'right', value: (r) => `${r.timeDifferenceH > 0 ? '+' : ''}${u.num(r.timeDifferenceH, 1)}` },
      { header: 'Traj. compat.', unit: '0–1', w: 0.5, font: 'mono', align: 'right', value: (r) => r.trajectoryCompatibility.toFixed(2) },
      { header: 'Dir. compat.', unit: '0–1', w: 0.5, font: 'mono', align: 'right', value: (r) => r.directionCompatibility.toFixed(2) },
      { header: 'AIS quality', w: 0.95, drawH: 6, draw: (c, r, b) => {
        const gw = drawLevelGauge(c, r.aisQuality, b.x + 4, b.y + b.h / 2, 5, 5);
        c.font('cond', T.label, C.ink);
        c.textMid(r.aisQuality, b.x + 8 + gw, b.y + b.h / 2);
      } },
      { header: 'Max gap', unit: 'min', w: 0.45, font: 'mono', align: 'right', value: (r) => String(r.maxAisGapMin) },
      { header: 'Support score', unit: '0–100', w: 0.95, drawH: 7, draw: (c, r, b) => scoreBar(c, r, b) },
      { header: 'Assessment state', w: 0.95, drawH: 10, draw: (c, r, b) => drawStateBadge(c, r.state, b.x + 4, b.y + b.h / 2, b.w - 8, 10) },
    ],
  });
  f.para('CPA = minimum distance between the vessel position and the hindcast zone centre at the same time. Δt = CPA time relative to the centre of the strongest supported interval. MID 999 is not allocated; identifiers cannot correspond to real vessels.', { size: T.label, color: C.ink3 });

  // ranking + decomposition (portrait continuation)
  const g = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '08', sectionTitle: 'AIS vessel analysis', continued: true });
  g.heading('Candidate vessel ranking', 280);
  drawStatusStamp(ctx, { x: g.x, y: g.y, w: g.w, h: 26 }, ['ANALYTICAL SUPPORT SCORE — NOT DETERMINATION OF RESPONSIBILITY']);
  g.y += 34;
  const topN = cands.slice(0, 8);
  g.figure(206, `Ranking of the ${topN.length} highest-scoring candidates`, (b) =>
    drawBarChart(ctx, b, {
      items: topN.map((c, i) => ({ label: `${c.candidateId}  ${c.vesselName}`, sublabel: `${c.type} · ${c.state.replace('_', ' ').toLowerCase()}`, value: c.score, emphasis: i === 0 })),
      max: 100,
      ticks: [0, 20, 40, 60, 80, 100],
      axisTitle: 'Analytical support score (0–100)',
      labelW: 150,
      thresholds: [{ value: 60, label: '60 — ambiguous' }, { value: 75, label: '75 — supported' }],
      barH: 11,
    }), { note: 'ILLUSTRATIVE' });

  g.heading('Score decomposition', 200);
  const top8 = cands.slice(0, 6);
  const w = ais.weights;
  g.figure(196, 'Weighted component contributions to support score (stacked; bar length = total score)', (b) =>
    drawBarChart(ctx, b, {
      items: top8.map((c, i) => ({
        label: `${c.candidateId}  ${c.vesselName}`,
        value: c.score,
        components: COMPONENTS.map((k) => c.components[k] * w[k]).map((v, _j, arr) => (v * c.score) / arr.reduce((s, x) => s + x, 0)),
        emphasis: i === 0,
      })),
      segments: COMPONENTS.map((k, i) => ({ label: `${COMPONENT_LABEL[k]} (w ${w[k].toFixed(2)})`, ...STACK_STYLES[i] })),
      max: 100,
      ticks: [0, 20, 40, 60, 80, 100],
      axisTitle: 'Weighted contribution (score points)',
      labelW: 110,
      barH: 13,
    }), { note: 'ILLUSTRATIVE' });

  g.heading('Component matrix — top five', 100);
  drawEngineeringTable(g, {
    rows: cands.slice(0, 5),
    rowPad: 2.6,
    columns: [
      { header: 'Candidate', w: 1, font: 'monoMedium', value: (r) => `${r.candidateId} ${r.vesselName}` },
      ...COMPONENTS.map((k) => ({
        header: COMPONENT_LABEL[k],
        unit: `w ${w[k].toFixed(2)}`,
        w: 0.8,
        drawH: 7,
        draw: (c: ReportContext, r: AisCandidate, b: { x: number; y: number; w: number; h: number }) => {
          const v = r.components[k];
          const bw = b.w - 26, yc = b.y + b.h / 2;
          c.rect({ x: b.x + 4, y: yc - 3, w: bw, h: 6 }, LW.hair, C.grid, C.paper);
          c.fillRect({ x: b.x + 4, y: yc - 3, w: (bw * v) / 100, h: 6 }, C.ink2);
          c.font('mono', T.label, C.ink);
          c.textMid(String(v), b.x + bw + 7, yc);
        },
      })),
      { header: 'Score', w: 0.45, font: 'monoMedium', align: 'right', value: (r) => String(r.score) },
    ],
  });
  void DASH;
}
