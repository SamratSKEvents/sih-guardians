import { C, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawLegend, drawMarker, type LegendItem, type LineStyle, type MarkerKind } from '../components/Drafting';

export interface Axis {
  min: number;
  max: number;
  ticks: number[];
  format: (v: number) => string;
  title: string;
}

export interface Series {
  label: string;
  points: [number, number][];
  style: LineStyle;
  marker?: MarkerKind;
  markerFill?: boolean;
  /** Uncertainty band drawn under the line. */
  band?: { upper: [number, number][]; lower: [number, number][]; label?: string };
  /** Print value next to each marker. */
  valueLabels?: (v: number) => string;
}

export interface LineChartSpec {
  x: Axis;
  y: Axis;
  series: Series[];
  vbands?: { from: number; to: number; label?: string; hatch?: boolean }[];
  hlines?: { y: number; label: string; dash?: number[] }[];
  legend?: boolean;
  legendCols?: number;
  notes?: { x: number; y: number; text: string; dx?: number; dy?: number }[];
}

export function drawLineChart(ctx: ReportContext, box: Box, spec: LineChartSpec) {
  const legendItems: LegendItem[] = [];
  spec.series.forEach((s) => {
    if (s.band) legendItems.push({ label: s.band.label ?? `${s.label} band`, kind: 'hatch', style: { color: C.rule, lw: LW.hair } });
    legendItems.push({ label: s.label, kind: 'line', style: s.style, marker: s.marker, markerFill: s.markerFill });
  });
  const legendH = spec.legend === false ? 0 : Math.ceil(legendItems.length / (spec.legendCols ?? 3)) * 11 + 4;

  const L = 40, R = 10, B = 26, Tp = 6 + legendH;
  const p = { x: box.x + L, y: box.y + Tp, w: box.w - L - R, h: box.h - Tp - B };
  const sx = (v: number) => p.x + ((v - spec.x.min) / (spec.x.max - spec.x.min)) * p.w;
  const sy = (v: number) => p.y + p.h - ((v - spec.y.min) / (spec.y.max - spec.y.min)) * p.h;

  if (legendH) drawLegend(ctx, p.x, box.y, p.w, legendItems, { cols: spec.legendCols ?? 3, rowH: 11 });

  // vertical bands
  spec.vbands?.forEach((vb) => {
    const b = { x: sx(vb.from), y: p.y, w: sx(vb.to) - sx(vb.from), h: p.h };
    if (vb.hatch) ctx.hatch(b, 3, LW.hair, C.grid);
    else ctx.fillRect(b, C.tint);
    if (vb.label) {
      ctx.font('condSemi', T.micro, C.ink3);
      ctx.textMid(vb.label, b.x + 3, p.y + 6);
    }
  });

  // grid
  spec.y.ticks.forEach((t) => ctx.line(p.x, sy(t), p.x + p.w, sy(t), LW.hair, C.faint));
  spec.x.ticks.forEach((t) => ctx.line(sx(t), p.y, sx(t), p.y + p.h, LW.hair, C.faint));

  // bands
  spec.series.forEach((s) => {
    if (!s.band) return;
    const pts = [...s.band.upper.map(([x, y]) => [sx(x), sy(y)]), ...[...s.band.lower].reverse().map(([x, y]) => [sx(x), sy(y)])] as [number, number][];
    ctx.doc.save();
    ctx.polyline(pts, true).clip();
    ctx.fillRect(p, C.tint2);
    ctx.hatch(p, 2.6, LW.hair, C.grid, 45);
    ctx.doc.restore();
    ctx.pen(LW.hair, C.rule);
    ctx.polyline(s.band.upper.map(([x, y]) => [sx(x), sy(y)])).stroke();
    ctx.polyline(s.band.lower.map(([x, y]) => [sx(x), sy(y)])).stroke();
  });

  spec.hlines?.forEach((hl) => {
    ctx.line(p.x, sy(hl.y), p.x + p.w, sy(hl.y), LW.fine, C.ink2, hl.dash ?? [3, 2]);
    ctx.font('cond', T.micro, C.ink2);
    ctx.fillRect({ x: p.x + 3, y: sy(hl.y) - 9, w: ctx.width(hl.label) + 4, h: 7 }, C.paper);
    ctx.font('cond', T.micro, C.ink2);
    ctx.textMid(hl.label, p.x + 5, sy(hl.y) - 5);
  });

  // axes
  ctx.line(p.x, p.y, p.x, p.y + p.h, LW.medium);
  ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, LW.medium);
  ctx.font('mono', T.micro, C.ink2);
  spec.y.ticks.forEach((t) => {
    ctx.line(p.x - 3, sy(t), p.x, sy(t), LW.fine);
    const s = spec.y.format(t);
    ctx.textMid(s, p.x - 5 - ctx.width(s), sy(t));
  });
  spec.x.ticks.forEach((t) => {
    ctx.line(sx(t), p.y + p.h, sx(t), p.y + p.h + 3, LW.fine);
    const s = spec.x.format(t);
    ctx.textMid(s, sx(t) - ctx.width(s) / 2, p.y + p.h + 8.5);
  });
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid(spec.x.title.toUpperCase(), p.x, p.y + p.h + 20, { w: p.w, align: 'center', cs: 0.4 });
  ctx.doc.save();
  ctx.doc.translate(box.x + 7, p.y + p.h / 2).rotate(-90);
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid(spec.y.title.toUpperCase(), -p.h / 2, 0, { w: p.h, align: 'center', cs: 0.4 });
  ctx.doc.restore();

  // series
  spec.series.forEach((s) => {
    const pts = s.points.map(([x, y]) => [sx(x), sy(y)] as [number, number]);
    ctx.pen(s.style.lw ?? LW.heavy, s.style.color ?? C.ink, s.style.dash ?? null);
    ctx.doc.lineJoin('round');
    ctx.polyline(pts).stroke();
    ctx.doc.undash();
    if (s.marker) pts.forEach(([x, y]) => drawMarker(ctx, s.marker!, x, y, 2.3, s.style.color ?? C.ink, s.markerFill !== false));
    if (s.valueLabels) {
      ctx.font('mono', T.micro, C.ink);
      s.points.forEach(([vx, vy]) => {
        const str = s.valueLabels!(vy);
        const x = sx(vx), y = sy(vy);
        ctx.fillRect({ x: x - ctx.width(str) / 2 - 1, y: y - 12, w: ctx.width(str) + 2, h: 7 }, C.paper);
        ctx.font('mono', T.micro, C.ink);
        ctx.textMid(str, x - ctx.width(str) / 2, y - 8.5);
      });
    }
  });

  spec.notes?.forEach((n) => {
    const x = sx(n.x), y = sy(n.y);
    const tx = x + (n.dx ?? 10), ty = y + (n.dy ?? -14);
    ctx.line(x, y, tx, ty, LW.hair, C.ink);
    ctx.font('cond', T.micro, C.ink);
    const w = ctx.width(n.text);
    ctx.fillRect({ x: tx - (n.dx! < 0 ? w + 2 : 0), y: ty - 4, w: w + 2, h: 8 }, C.paper);
    ctx.font('cond', T.micro, C.ink);
    ctx.textMid(n.text, n.dx! < 0 ? tx - w - 1 : tx + 1, ty);
  });

  return { plot: p, sx, sy };
}
