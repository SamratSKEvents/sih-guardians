import { C, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';

export interface Metric {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}

/** Row of ruled data cells (title-block style, not dashboard cards). */
export function drawDataBlock(ctx: ReportContext, b: Box, metrics: Metric[]) {
  const w = b.w / metrics.length;
  ctx.rect(b, LW.heavy);
  metrics.forEach((m, i) => {
    const x = b.x + i * w;
    if (i) ctx.line(x, b.y, x, b.y + b.h, LW.fine);
    ctx.font('condSemi', T.micro, C.ink3);
    ctx.textMid(m.label.toUpperCase(), x + 6, b.y + 8, { cs: 0.4 });
    ctx.font('monoMedium', 14, C.ink);
    ctx.textMid(m.value, x + 6, b.y + b.h / 2 + 3);
    if (m.unit) {
      const vw = ctx.width(m.value);
      ctx.font('mono', T.small, C.ink2);
      ctx.textMid(m.unit, x + 6 + vw + 3, b.y + b.h / 2 + 4);
    }
    if (m.note) {
      ctx.font('cond', T.micro, C.ink3);
      ctx.textMid(m.note, x + 6, b.y + b.h - 7);
    }
  });
}
