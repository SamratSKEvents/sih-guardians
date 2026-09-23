import { C, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawLegend, type LegendItem } from '../components/Drafting';

export interface BarItem {
  label: string;
  sublabel?: string;
  value: number;
  /** Weighted contributions that sum to `value` (stacked mode). */
  components?: number[];
  emphasis?: boolean;
}

export interface SegmentStyle {
  label: string;
  fill: string;
  hatch?: boolean;
}

/** Greyscale-distinguishable stack fills. */
export const STACK_STYLES: Omit<SegmentStyle, 'label'>[] = [
  { fill: C.ink },
  { fill: '#6e6e6e' },
  { fill: C.paper, hatch: true },
  { fill: '#b9b9b9' },
  { fill: C.paper },
];

export interface BarChartSpec {
  items: BarItem[];
  max: number;
  ticks: number[];
  axisTitle: string;
  labelW?: number;
  valueFormat?: (v: number) => string;
  segments?: SegmentStyle[];
  thresholds?: { value: number; label: string }[];
  barH?: number;
}

export function drawBarChart(ctx: ReportContext, box: Box, spec: BarChartSpec) {
  const labelW = spec.labelW ?? 120;
  const legendH = spec.segments ? Math.ceil(spec.segments.length / 3) * 11 + 6 : 0;
  const valueW = 28;
  const p = { x: box.x + labelW, y: box.y + legendH + 8, w: box.w - labelW - valueW, h: box.h - legendH - 8 - 24 };
  const rowH = p.h / spec.items.length;
  const barH = Math.min(spec.barH ?? 10, rowH * 0.62);
  const sx = (v: number) => p.x + (v / spec.max) * p.w;

  if (spec.segments) {
    const items: LegendItem[] = spec.segments.map((s) => ({ label: s.label, kind: s.hatch ? 'hatch' : 'area', fill: s.fill, style: { color: C.ink, lw: LW.fine } }));
    drawLegend(ctx, box.x, box.y, box.w, items, { cols: Math.min(3, items.length), rowH: 11 });
  }

  // grid + axis
  spec.ticks.forEach((t) => {
    ctx.line(sx(t), p.y, sx(t), p.y + p.h, LW.hair, C.faint);
    ctx.line(sx(t), p.y + p.h, sx(t), p.y + p.h + 3, LW.fine);
    ctx.font('mono', T.micro, C.ink2);
    const s = String(t);
    ctx.textMid(s, sx(t) - ctx.width(s) / 2, p.y + p.h + 8.5);
  });
  ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, LW.medium);
  ctx.line(p.x, p.y, p.x, p.y + p.h, LW.medium);
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid(spec.axisTitle.toUpperCase(), p.x, p.y + p.h + 20, { w: p.w, align: 'center', cs: 0.4 });

  spec.thresholds?.forEach((th) => {
    ctx.line(sx(th.value), p.y - 4, sx(th.value), p.y + p.h, LW.fine, C.ink2, [3, 2]);
    ctx.font('cond', T.micro, C.ink2);
    ctx.textMid(th.label, sx(th.value) + 3, p.y - 2);
  });

  spec.items.forEach((it, i) => {
    const yc = p.y + rowH * (i + 0.5);
    ctx.font(it.emphasis ? 'condBold' : 'condMedium', T.small, C.ink);
    ctx.textMid(it.label, box.x, it.sublabel ? yc - 3.8 : yc);
    if (it.sublabel) {
      ctx.font('cond', T.micro, C.ink3);
      ctx.textMid(it.sublabel, box.x, yc + 4.4);
    }
    ctx.line(p.x - 3, yc, p.x, yc, LW.fine);
    const y = yc - barH / 2;
    if (it.components && spec.segments) {
      let acc = 0;
      it.components.forEach((c, ci) => {
        const st = spec.segments![ci];
        const b = { x: sx(acc), y, w: sx(acc + c) - sx(acc), h: barH };
        ctx.fillRect(b, st.fill);
        if (st.hatch) ctx.hatch(b, 2.2, LW.hair, C.ink);
        ctx.rect(b, LW.hair, C.ink);
        acc += c;
      });
      ctx.rect({ x: p.x, y, w: sx(it.value) - p.x, h: barH }, LW.fine, C.ink);
    } else {
      const b = { x: p.x, y, w: sx(it.value) - p.x, h: barH };
      ctx.rect(b, LW.fine, C.ink, it.emphasis ? C.ink : '#8a8a8a');
    }
    ctx.font(it.emphasis ? 'monoMedium' : 'mono', T.small, C.ink);
    const vs = (spec.valueFormat ?? String)(it.value);
    ctx.textMid(vs, sx(it.value) + 4, yc);
  });
  return { plot: p, sx };
}
