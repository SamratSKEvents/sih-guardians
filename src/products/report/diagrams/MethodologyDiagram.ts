import type { MethodStep } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawArrowHead, drawVectorArrow } from '../components/Drafting';

/** Stage brackets: [label, first step index, last step index]. Derived from step count so any pipeline length works. */
function stages(n: number): [string, number, number][] {
  const a = Math.round(n * 0.3), b = Math.round(n * 0.7), c = n - 1;
  return [
    ['OBSERVE', 0, a - 1],
    ['RECONSTRUCT & CORRELATE', a, b - 1],
    ['PROJECT & ASSESS', b, c - 1],
    ['REPORT', c, c],
  ];
}

/** IDEF0-like vertical process: inputs enter from the left, outputs leave to the right. */
export function drawMethodologyDiagram(ctx: ReportContext, box: Box, steps: MethodStep[]) {
  const n = steps.length;
  const stageW = 26;
  const inW = 118, outW = 118;
  const boxW = box.w - stageW - inW - outW - 60;
  const bx = box.x + stageW + inW + 30;
  const gap = 12;
  const bh = (box.h - gap * (n - 1)) / n;
  const yOf = (i: number) => box.y + i * (bh + gap);

  // stage brackets
  stages(n).forEach(([label, s, e], k) => {
    const y0 = yOf(s), y1 = yOf(e) + bh;
    const x = box.x + 8;
    ctx.line(x + 6, y0 + 2, x, y0 + 2, LW.medium);
    ctx.line(x, y0 + 2, x, y1 - 2, LW.medium);
    ctx.line(x, y1 - 2, x + 6, y1 - 2, LW.medium);
    ctx.doc.save();
    ctx.doc.translate(x - 5, (y0 + y1) / 2).rotate(-90);
    ctx.font('condBold', T.micro, C.ink2);
    ctx.textMid(label, -(y1 - y0) / 2, 0, { w: y1 - y0, align: 'center', cs: 0.6 });
    ctx.doc.restore();
    if (k) ctx.line(box.x + stageW, y0 - gap / 2, box.x + box.w, y0 - gap / 2, LW.hair, C.grid, DASH.construction);
  });

  steps.forEach((s, i) => {
    const y = yOf(i);
    const b = { x: bx, y, w: boxW, h: bh };
    const last = i === n - 1;
    ctx.rect(b, last ? LW.heavy : LW.medium, C.ink, last ? C.tint : C.paper);
    // id tab
    ctx.fillRect({ x: bx, y, w: 30, h: bh }, C.ink);
    ctx.font('monoMedium', T.small, C.paper);
    ctx.textMid(s.id, bx, y + bh / 2, { w: 30, align: 'center' });
    ctx.font('condSemi', T.small + 0.6, C.ink);
    ctx.textMid(s.title.toUpperCase(), bx + 38, y + bh / 2 - 5, { cs: 0.5 });
    ctx.font('cond', T.label, C.ink2);
    ctx.textMid(s.detail, bx + 38, y + bh / 2 + 6);

    // input (left)
    const ix = bx - 30;
    ctx.font('cond', T.label, C.ink);
    const iw = ctx.width(s.inputs);
    ctx.textMid(s.inputs, ix - 6 - Math.min(iw, inW), y + bh / 2 - 5);
    ctx.font('condSemi', T.zone, C.ink3);
    ctx.textMid('INPUT', ix - 6 - ctx.width('INPUT'), y + bh / 2 + 5);
    drawVectorArrow(ctx, { x: ix - 4, y: y + bh / 2 }, { x: bx - 1, y: y + bh / 2 }, { lw: LW.fine, head: 4, dash: DASH.short });

    // output (right)
    const ox = bx + boxW;
    drawVectorArrow(ctx, { x: ox + 1, y: y + bh / 2 }, { x: ox + 26, y: y + bh / 2 }, { lw: LW.fine, head: 4 });
    ctx.font('condMedium', T.label, C.ink);
    ctx.textMid(s.output, ox + 30, y + bh / 2 - 5);
    ctx.font('condSemi', T.zone, C.ink3);
    ctx.textMid('OUTPUT', ox + 30, y + bh / 2 + 5);

    // flow to next step
    if (!last) {
      const cx = bx + boxW / 2;
      ctx.line(cx, y + bh, cx, y + bh + gap - 1, LW.medium);
      drawArrowHead(ctx, { x: cx, y: y + bh + gap }, Math.PI / 2, 5);
    }
  });

  // feedback loop: forecast/impact → response intelligence informs next observation tasking
  const fx = bx + boxW + outW + 22;
  const yTop = yOf(0) + bh * 0.22 + 8, yBot = yOf(n - 1) + bh * 0.78 - 8;
  ctx.pen(LW.fine, C.ink3, DASH.dashed);
  ctx.doc.moveTo(bx + boxW + 1, yBot + 8).lineTo(fx, yBot + 8).lineTo(fx, yTop - 8).lineTo(bx + boxW + 12, yTop - 8).stroke();
  ctx.doc.undash();
  drawArrowHead(ctx, { x: bx + boxW + 2, y: yTop - 8 }, Math.PI, 4.5, C.ink3);
  ctx.doc.save();
  ctx.doc.translate(fx + 7, (yTop + yBot) / 2).rotate(90);
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('RE-TASKING: FOLLOW-UP OBSERVATION REQUEST', -120, 0, { w: 240, align: 'center', cs: 0.4 });
  ctx.doc.restore();
}
