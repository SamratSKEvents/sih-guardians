/**
 * Paginated engineering table: repeating header, no orphan header, measured row heights,
 * optional per-cell vector renderers (gauges, badges, bars).
 */
import { C, LW, T, type FontKey } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import type { Flow } from '../layout/Flow';

export interface Column<R> {
  header: string;
  /** Unit / sub-header line, e.g. "km" or "m/s". */
  unit?: string;
  /** Relative width weight. */
  w: number;
  align?: 'left' | 'right' | 'center';
  font?: FontKey;
  value?: (r: R, i: number) => string;
  draw?: (ctx: ReportContext, r: R, b: Box, i: number) => void;
  /** Fixed content height for draw-only columns. */
  drawH?: number;
}

export interface TableSpec<R> {
  columns: Column<R>[];
  rows: R[];
  caption?: string;
  fontSize?: number;
  rowPad?: number;
  /** Emphasise rows (e.g. top candidate). */
  highlight?: (r: R, i: number) => boolean;
  x?: number;
  w?: number;
  minRowsWithHeader?: number;
}

export function drawEngineeringTable<R>(flow: Flow, spec: TableSpec<R>) {
  const { ctx } = flow;
  const size = spec.fontSize ?? T.table;
  const pad = spec.rowPad ?? 3.2;
  const x = spec.x ?? flow.x;
  const W = spec.w ?? flow.w;
  const total = spec.columns.reduce((s, c) => s + c.w, 0);
  const widths = spec.columns.map((c) => (c.w / total) * W);
  const tag = spec.caption ? ctx.nextTable(flow.meta.sectionNo) : '';

  const headerH = Math.max(
    ...spec.columns.map((c, i) => {
      ctx.font('condSemi', T.label);
      const h = ctx.height(c.header.toUpperCase(), { w: widths[i] - 6, cs: 0.25 });
      return h + (c.unit ? 8 : 0);
    }),
  ) + 8;

  const cellText = (c: Column<R>, r: R, i: number) => (c.value ? c.value(r, i) : '');
  const rowHeight = (r: R, i: number) =>
    Math.max(
      12,
      ...spec.columns.map((c, ci) => {
        if (c.draw && !c.value) return (c.drawH ?? 8) + 2 * pad;
        ctx.font(c.font ?? 'sans', size);
        return ctx.height(cellText(c, r, i), { w: widths[ci] - 6 }) + 2 * pad;
      }),
    );

  const drawCaption = (cont: boolean) => {
    if (!spec.caption) return;
    ctx.font('condBold', T.label, C.ink);
    const t = cont ? `${tag} (CONT.)` : tag;
    const tw = ctx.width(t) + 8;
    ctx.rect({ x, y: flow.y, w: tw, h: 10 }, LW.fine);
    ctx.textMid(t, x, flow.y + 5, { w: tw, align: 'center' });
    ctx.font('cond', T.small, C.ink);
    ctx.textMid(spec.caption, x + tw + 6, flow.y + 5);
    flow.y += 15;
  };

  const drawHeader = () => {
    const y = flow.y;
    ctx.fillRect({ x, y, w: W, h: headerH }, C.tint);
    ctx.line(x, y, x + W, y, LW.heavy);
    let xx = x;
    spec.columns.forEach((c, i) => {
      ctx.font('condSemi', T.label, C.ink);
      const tw = widths[i] - 6;
      ctx.text(c.header.toUpperCase(), xx + 3, y + 4, { w: tw, align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', cs: 0.25 });
      if (c.unit) {
        ctx.font('mono', T.micro, C.ink3);
        ctx.textMid(c.unit, xx + 3, y + headerH - 6, { w: tw, align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' });
      }
      if (i > 0) ctx.line(xx, y, xx, y + headerH, LW.hair, C.rule);
      xx += widths[i];
    });
    ctx.line(x, y + headerH, x + W, y + headerH, LW.medium);
    flow.y += headerH;
  };

  const heights = spec.rows.map(rowHeight);
  const minRows = Math.min(spec.rows.length, spec.minRowsWithHeader ?? 3);
  const firstBlock = (spec.caption ? 15 : 0) + headerH + heights.slice(0, minRows).reduce((s, h) => s + h, 0);
  flow.ensure(firstBlock);
  drawCaption(false);
  drawHeader();

  let segTop = flow.y;
  const closeSegment = () => {
    let xx = x;
    widths.forEach((w, i) => {
      if (i > 0) ctx.line(xx, segTop, xx, flow.y, LW.hair, C.grid);
      xx += w;
    });
    ctx.line(x, flow.y, x + W, flow.y, LW.medium);
  };

  spec.rows.forEach((r, i) => {
    const h = heights[i];
    if (flow.y + h > flow.bottom) {
      closeSegment();
      flow.newPage();
      drawCaption(true);
      drawHeader();
      segTop = flow.y;
    }
    const y = flow.y;
    if (spec.highlight?.(r, i)) {
      ctx.fillRect({ x, y, w: W, h }, C.tint2);
      ctx.line(x, y, x, y + h, 2, C.ink);
    }
    let xx = x;
    spec.columns.forEach((c, ci) => {
      const b = { x: xx, y, w: widths[ci], h };
      if (c.value) {
        ctx.font(c.font ?? 'sans', size, C.ink);
        const s = cellText(c, r, i);
        const th = ctx.height(s, { w: widths[ci] - 6 });
        ctx.text(s, xx + 3, y + (h - th) / 2 + 0.3, { w: widths[ci] - 6, align: c.align ?? 'left' });
      }
      if (c.draw) c.draw(ctx, r, b, i);
      xx += widths[ci];
    });
    flow.y += h;
    if (i < spec.rows.length - 1) ctx.line(x, flow.y, x + W, flow.y, LW.hair, C.grid);
  });
  closeSegment();
  flow.y += 8;
}

/** Non-paginating compact table for plates and side panels. Returns height used. */
export function drawCompactTable(
  ctx: ReportContext,
  x: number,
  y: number,
  w: number,
  title: string,
  cols: { header: string; w: number; align?: 'left' | 'right' | 'center'; font?: FontKey }[],
  rows: string[][],
  rowH = 10.5,
) {
  const total = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => (c.w / total) * w);
  let yy = y;
  ctx.font('condSemi', T.micro, C.ink);
  ctx.fillRect({ x, y: yy, w, h: 11 }, C.ink);
  ctx.font('condBold', T.micro, C.paper);
  ctx.textMid(title.toUpperCase(), x + 4, yy + 5.5, { cs: 0.5 });
  yy += 11;
  const cellRow = (vals: string[], head: boolean) => {
    let xx = x;
    vals.forEach((v, i) => {
      const c = cols[i];
      ctx.font(head ? 'condSemi' : (c.font ?? 'mono'), head ? T.zone : T.micro, head ? C.ink2 : C.ink);
      let s = v;
      while (ctx.width(s) > widths[i] - 5 && s.length > 3) s = s.slice(0, -2) + '…';
      const tw = ctx.width(s);
      const tx = c.align === 'right' ? xx + widths[i] - 3 - tw : c.align === 'center' ? xx + (widths[i] - tw) / 2 : xx + 3;
      ctx.textMid(s, tx, yy + rowH / 2);
      if (i) ctx.line(xx, yy, xx, yy + rowH, LW.hair, C.grid);
      xx += widths[i];
    });
    yy += rowH;
    ctx.line(x, yy, x + w, yy, head ? LW.fine : LW.hair, head ? C.ink : C.faint);
  };
  cellRow(cols.map((c) => c.header.toUpperCase()), true);
  rows.forEach((r) => cellRow(r, false));
  ctx.rect({ x, y, w, h: yy - y }, LW.medium);
  return yy - y;
}
