import type { ConfidenceData, QualityLevel } from '../ReportTypes';
import { C, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawStateBadge, levelAbbr, levelIndex } from '../components/Drafting';

/** Greyscale ramp keyed by level; text always printed, so colour is never the only cue. */
const LEVEL_FILL: Record<QualityLevel, string> = {
  High: '#2b2b2b',
  'Medium-High': '#5e5e5e',
  Medium: '#9a9a9a',
  'Low-Medium': '#cdcdcd',
  Low: '#ececec',
  Unavailable: '#ffffff',
};

export const MATRIX_ROW_H = 21;
export const MATRIX_HEAD_H = 30;

export function confidenceMatrixHeight(d: ConfidenceData) {
  return MATRIX_HEAD_H + d.components.length * MATRIX_ROW_H + 22;
}

export function drawConfidenceMatrix(ctx: ReportContext, box: Box, d: ConfidenceData) {
  const nameW = 110, stateW = 80, scoreW = 76;
  const critW = (box.w - nameW - stateW - scoreW) / d.criteria.length;
  const y0 = box.y;

  // header
  ctx.fillRect({ x: box.x, y: y0, w: box.w, h: MATRIX_HEAD_H }, C.tint);
  ctx.line(box.x, y0, box.x + box.w, y0, LW.heavy);
  ctx.line(box.x, y0 + MATRIX_HEAD_H, box.x + box.w, y0 + MATRIX_HEAD_H, LW.medium);
  const head = (s: string, x: number, w: number) => {
    ctx.font('condSemi', T.zone, C.ink);
    const h = ctx.height(s.toUpperCase(), { w: w - 2 });
    ctx.text(s.toUpperCase(), x + 1, y0 + MATRIX_HEAD_H / 2 - h / 2, { w: w - 2, align: 'center' });
  };
  head('Assessment component', box.x, nameW);
  d.criteria.forEach((c, i) => head(c, box.x + nameW + i * critW, critW));
  head('Score', box.x + nameW + d.criteria.length * critW, scoreW);
  head('Assessment state', box.x + box.w - stateW, stateW);

  d.components.forEach((comp, r) => {
    const y = y0 + MATRIX_HEAD_H + r * MATRIX_ROW_H;
    const yc = y + MATRIX_ROW_H / 2;
    ctx.font('mono', T.micro, C.ink3);
    ctx.textMid(comp.id, box.x + 3, yc);
    ctx.font('condMedium', T.small, C.ink);
    ctx.textMid(comp.name, box.x + 18, yc);
    comp.criteria.forEach((lvl, i) => {
      const b = { x: box.x + nameW + i * critW + 2, y: y + 2, w: critW - 4, h: MATRIX_ROW_H - 4 };
      ctx.rect(b, LW.hair, C.rule, LEVEL_FILL[lvl]);
      if (lvl === 'Unavailable') ctx.line(b.x, b.y + b.h, b.x + b.w, b.y, LW.hair, C.grid);
      ctx.font('condSemi', T.label, levelIndex(lvl) >= 4 ? C.paper : C.ink);
      const s = levelAbbr(lvl);
      if (lvl === 'Unavailable') {
        ctx.fillRect({ x: b.x + b.w / 2 - 8, y: yc - 4, w: 16, h: 8 }, C.paper);
        ctx.font('condSemi', T.label, C.ink3);
      }
      ctx.textMid(s, b.x, yc, { w: b.w, align: 'center' });
    });
    // score bar with numeric value
    const sx = box.x + nameW + d.criteria.length * critW + 6;
    const bw = scoreW - 34;
    ctx.rect({ x: sx, y: yc - 3.5, w: bw, h: 7 }, LW.hair, C.rule, C.paper);
    if (comp.score > 0) ctx.fillRect({ x: sx, y: yc - 3.5, w: bw * comp.score, h: 7 }, C.ink2);
    [0.25, 0.5, 0.75].forEach((t) => ctx.line(sx + bw * t, yc - 3.5, sx + bw * t, yc + 3.5, LW.hair, comp.score > t ? C.paper : C.grid));
    ctx.font('monoMedium', T.label, C.ink);
    ctx.textMid(comp.score > 0 ? comp.score.toFixed(2) : '—', sx + bw + 5, yc);
    drawStateBadge(ctx, comp.state, box.x + box.w - stateW + 4, yc, stateW - 8, 11);
    ctx.line(box.x, y + MATRIX_ROW_H, box.x + box.w, y + MATRIX_ROW_H, r === d.components.length - 1 ? LW.medium : LW.hair, r === d.components.length - 1 ? C.ink : C.grid);
  });

  // level key
  const ky = y0 + MATRIX_HEAD_H + d.components.length * MATRIX_ROW_H + 8;
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('LEVEL KEY', box.x, ky + 4, { cs: 0.4 });
  let kx = box.x + 46;
  (['High', 'Medium-High', 'Medium', 'Low-Medium', 'Low', 'Unavailable'] as QualityLevel[]).forEach((l) => {
    ctx.rect({ x: kx, y: ky, w: 16, h: 8 }, LW.hair, C.rule, LEVEL_FILL[l]);
    ctx.font('condSemi', T.micro, levelIndex(l) >= 4 ? C.paper : C.ink);
    ctx.textMid(levelAbbr(l), kx, ky + 4, { w: 16, align: 'center' });
    ctx.font('cond', T.micro, C.ink2);
    ctx.textMid(l, kx + 19, ky + 4);
    kx += 22 + ctx.width(l) + 12;
  });
}
