/**
 * Sheet furniture drawn in the finalize pass (when total sheet count is known):
 * trim + drawing frame with zone references, header strip, footer title strip,
 * landscape plate title column, revision block, title block.
 */
import { C, LW, PAGE, T } from '../ReportTheme';
import { utc } from '../utils/units';
import { drawLegend } from '../components/Drafting';
import type { Box, PageMeta, ReportContext } from './ReportContext';

const pad2 = (n: number) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ frame */

export function drawTechnicalFrame(ctx: ReportContext, W: number, H: number) {
  const t = PAGE.trim, f = PAGE.frame;
  ctx.rect({ x: t, y: t, w: W - 2 * t, h: H - 2 * t }, LW.hair, C.ink3);
  ctx.rect({ x: f, y: f, w: W - 2 * f, h: H - 2 * f }, LW.frame, C.ink);

  // zone references: numbers across, letters down
  const cols = W > H ? 8 : 6, rows = W > H ? 6 : 8;
  const zw = (W - 2 * f) / cols, zh = (H - 2 * f) / rows;
  ctx.font('cond', T.zone, C.ink3);
  for (let i = 0; i < cols; i++) {
    const cx = f + zw * (i + 0.5);
    if (i > 0) {
      ctx.line(f + zw * i, t, f + zw * i, f, LW.hair, C.ink3);
      ctx.line(f + zw * i, H - f, f + zw * i, H - t, LW.hair, C.ink3);
    }
    const s = String(i + 1);
    ctx.textMid(s, cx - ctx.width(s) / 2, (t + f) / 2);
    ctx.textMid(s, cx - ctx.width(s) / 2, H - (t + f) / 2);
  }
  for (let j = 0; j < rows; j++) {
    const cy = f + zh * (j + 0.5);
    if (j > 0) {
      ctx.line(t, f + zh * j, f, f + zh * j, LW.hair, C.ink3);
      ctx.line(W - f, f + zh * j, W - t, f + zh * j, LW.hair, C.ink3);
    }
    const s = String.fromCharCode(65 + j);
    ctx.textMid(s, (t + f) / 2 - ctx.width(s) / 2, cy);
    ctx.textMid(s, W - (t + f) / 2 - ctx.width(s) / 2, cy);
  }
  // centring marks
  ctx.line(W / 2, t - 5, W / 2, f, LW.medium);
  ctx.line(W / 2, H - f, W / 2, H - t + 5, LW.medium);
  ctx.line(t - 5, H / 2, f, H / 2, LW.medium);
  ctx.line(W - f, H / 2, W - t + 5, H / 2, LW.medium);
}

/* ------------------------------------------------------------------ cells */

/** Title-block cell: tiny caps label top-left, value below. */
export function drawCell(
  ctx: ReportContext,
  b: Box,
  label: string,
  value: string,
  o: { font?: 'mono' | 'monoMedium' | 'cond' | 'condSemi' | 'condBold' | 'sansSemi'; size?: number; color?: string; align?: 'left' | 'center' } = {},
) {
  ctx.rect(b, LW.fine, C.ink);
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid(label.toUpperCase(), b.x + 3, b.y + 5.2, { cs: 0.35 });
  ctx.font(o.font ?? 'mono', o.size ?? T.label, o.color ?? C.ink);
  const size = o.size ?? T.label;
  const yc = b.y + 5 + (b.h - 5) / 2 + 0.5;
  let v = value;
  while (ctx.width(v) > b.w - 6 && v.length > 4) v = v.slice(0, -2) + '…';
  if (o.align === 'center') ctx.textMid(v, b.x, yc, { w: b.w, align: 'center' });
  else ctx.textMid(v, b.x + 3, yc);
  void size;
}

export function drawLogo(ctx: ReportContext, b: Box) {
  const logo = ctx.images.get('logo');
  if (logo) {
    ctx.doc.image(logo as any, b.x, b.y, { fit: [b.w, b.h], align: 'center', valign: 'center' });
    return;
  }
  // Placeholder mark: target ring + water line — clearly a placeholder, no branding.
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.min(b.w, b.h) / 2 - 1;
  ctx.pen(LW.medium, C.ink);
  ctx.doc.circle(cx, cy, r).stroke();
  ctx.doc.circle(cx, cy, r * 0.55).stroke();
  ctx.line(cx - r - 2, cy, cx + r + 2, cy, LW.fine);
  ctx.line(cx, cy - r - 2, cx, cy + r + 2, LW.fine);
  ctx.doc.save();
  ctx.doc.circle(cx, cy, r * 0.55).clip();
  ctx.doc.rect(cx - r, cy, 2 * r, r).fill(C.ink);
  ctx.doc.restore();
}

/* ------------------------------------------------------------------ header / footer */

export function drawHeaderStrip(ctx: ReportContext, meta: PageMeta, W: number) {
  const f = PAGE.frame, h = PAGE.headerH;
  const md = ctx.data.metadata;
  const y = f;
  const x0 = f, x1 = W - f;
  ctx.line(x0, y + h, x1, y + h, LW.medium);
  // section number
  ctx.font('monoMedium', 8.5);
  ctx.textMid(meta.sectionNo, x0, y + h / 2, { w: 30, align: 'center' });
  ctx.line(x0 + 30, y, x0 + 30, y + h, LW.fine);
  ctx.font('condSemi', 7.6, C.ink);
  const title = meta.sectionTitle.toUpperCase() + (meta.continued ? '  (CONT.)' : '');
  ctx.textMid(title, x0 + 38, y + h / 2, { cs: 0.6 });

  const tagW = 150;
  const refW = 132;
  ctx.line(x1 - tagW - refW, y, x1 - tagW - refW, y + h, LW.fine);
  ctx.font('mono', T.label, C.ink2);
  ctx.textMid(`${md.documentRef} · REV ${md.revision}`, x1 - tagW - refW, y + h / 2, { w: refW, align: 'center' });
  const tag = { x: x1 - tagW, y, w: tagW, h };
  if (ctx.demo) {
    ctx.fillRect(tag, C.ink);
    ctx.font('condBold', 6.8, C.paper);
    ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA', tag.x, y + h / 2, { w: tagW, align: 'center', cs: 0.35 });
  } else {
    ctx.line(tag.x, y, tag.x, y + h, LW.fine);
    ctx.font('condBold', 6.8, C.ink);
    ctx.textMid(md.classification, tag.x, y + h / 2, { w: tagW, align: 'center', cs: 0.35 });
  }
}

export function drawFooterStrip(ctx: ReportContext, meta: PageMeta, W: number, H: number, pageNo: number, total: number) {
  const f = PAGE.frame, h = PAGE.footerH;
  const md = ctx.data.metadata;
  const y = H - f - h;
  const x0 = f, inner = W - 2 * f;
  const logoW = inner > 600 ? 170 : 128;
  const sheetW = 56;
  const mid = inner - logoW - sheetW;
  const rh = h / 2;

  // system block
  const sys = { x: x0, y, w: logoW, h };
  ctx.rect(sys, LW.fine);
  drawLogo(ctx, { x: sys.x + 5, y: sys.y + 6, w: 24, h: 24 });
  ctx.font('condBold', 9, C.ink);
  ctx.textMid(md.systemShortName, sys.x + 35, y + 11, { cs: 1 });
  ctx.font('cond', T.zone, C.ink2);
  ctx.text(md.systemName, sys.x + 35, y + 17, { w: logoW - 39, lineGap: -0.5 });

  const row = (cells: [string, string, number, any?][], yy: number) => {
    let xx = x0 + logoW;
    for (const [label, value, frac, o] of cells) {
      const w = mid * frac;
      drawCell(ctx, { x: xx, y: yy, w, h: rh }, label, value, o);
      xx += w;
    }
  };
  row(
    [
      ['Document ref.', md.documentRef, 0.29],
      ['Incident ID', md.incidentId, 0.27],
      ['Rev', md.revision, 0.08, { font: 'monoMedium', align: 'center' }],
      ['Classification', ctx.demo ? 'DEMONSTRATION DATA' : md.classification, 0.36, { font: 'condBold' }],
    ],
    y,
  );
  row(
    [
      ['Generated', utc(md.generatedAt), 0.29],
      ['Model / version', md.modelVersion, 0.43],
      ['Status', md.assessmentStatus, 0.28, { font: 'condSemi' }],
    ],
    y + rh,
  );
  // sheet
  const sb = { x: x0 + inner - sheetW, y, w: sheetW, h };
  ctx.rect(sb, LW.fine);
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid('SHEET', sb.x + 3, y + 5.2, { cs: 0.35 });
  ctx.font('monoMedium', 12, C.ink);
  ctx.textMid(pad2(pageNo), sb.x, y + 17, { w: sheetW, align: 'center' });
  ctx.font('mono', T.label, C.ink2);
  ctx.textMid(`OF ${pad2(total)}`, sb.x, y + 29, { w: sheetW, align: 'center' });
  ctx.rect({ x: x0, y, w: inner, h }, LW.heavy);
  void meta;
}

/* ------------------------------------------------------------------ revision + title blocks */

export function drawRevisionBlock(ctx: ReportContext, x: number, y: number, w: number, rowH = 11) {
  const revs = ctx.data.metadata.revisionHistory;
  const cols = [0.12, 0.26, 0.62];
  ctx.font('condSemi', T.zone, C.ink);
  const header = { x, y, w, h: rowH };
  ctx.rect(header, LW.fine, C.ink, C.tint);
  ctx.font('condSemi', T.zone, C.ink);
  ctx.textMid('REVISION HISTORY', x, y + rowH / 2, { w, align: 'center', cs: 0.6 });
  const heads = ['REV', 'DATE', 'DESCRIPTION'];
  let yy = y + rowH;
  const drawRow = (vals: string[], bold: boolean) => {
    let xx = x;
    vals.forEach((v, i) => {
      const cw = w * cols[i];
      ctx.rect({ x: xx, y: yy, w: cw, h: rowH }, LW.hair);
      ctx.font(bold ? 'condSemi' : i < 2 ? 'mono' : 'cond', bold ? T.zone : T.micro, C.ink);
      let s = v;
      while (ctx.width(s) > cw - 5 && s.length > 4) s = s.slice(0, -2) + '…';
      ctx.textMid(s, xx + 2.5, yy + rowH / 2, i === 0 ? { w: cw - 5, align: 'center' } : {});
      xx += cw;
    });
    yy += rowH;
  };
  drawRow(heads, true);
  revs.forEach((r) => drawRow([r.rev, r.date, r.description], false));
  ctx.rect({ x, y, w, h: yy - y }, LW.medium);
  return yy - y;
}

/* ------------------------------------------------------------------ plate title column */

export function drawPlateColumn(ctx: ReportContext, meta: PageMeta, W: number, H: number, pageNo: number, total: number) {
  const f = PAGE.frame;
  const cw = PAGE.plateColumnW;
  const x = W - f - cw;
  const md = ctx.data.metadata;
  const plate = meta.plate!;
  ctx.line(x, f, x, H - f, LW.heavy);

  // system block
  let y = f;
  drawLogo(ctx, { x: x + 6, y: y + 7, w: 26, h: 26 });
  ctx.font('condBold', 10, C.ink);
  ctx.textMid(md.systemShortName, x + 39, y + 13, { cs: 1.2 });
  ctx.font('cond', T.zone, C.ink2);
  ctx.text(md.systemName, x + 39, y + 19, { w: cw - 44, lineGap: -0.5 });
  y += 40;
  ctx.line(x, y, W - f, y, LW.fine);
  if (ctx.demo) {
    ctx.fillRect({ x, y, w: cw, h: 16 }, C.ink);
    ctx.font('condBold', 6.6, C.paper);
    ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA', x, y + 8, { w: cw, align: 'center', cs: 0.3 });
    y += 16;
  }

  // legend
  if (plate.legend?.length) {
    y += 8;
    y += drawLegend(ctx, x + 8, y, cw - 16, plate.legend, { title: 'Legend', rowH: 11.5 }) + 6;
    ctx.line(x, y, W - f, y, LW.hair, C.grid);
  }
  // notes
  if (plate.notes?.length) {
    y += 8;
    ctx.font('condSemi', T.micro, C.ink3);
    ctx.textMid('NOTES', x + 8, y + 4, { cs: 0.4 });
    y += 10;
    plate.notes.forEach((n, i) => {
      ctx.font('mono', T.micro, C.ink2);
      ctx.text(String(i + 1).padStart(2, '0'), x + 8, y);
      ctx.font('cond', T.micro + 0.3, C.ink);
      const hgt = ctx.text(n, x + 22, y - 0.5, { w: cw - 30, lineGap: 0.2 });
      y += hgt + 3;
    });
  }

  // bottom stack (bottom-up)
  let by = H - f;
  const cell2 = (l1: string, v1: string, l2: string, v2: string, h = 20, split = 0.55, o1: any = {}, o2: any = {}) => {
    by -= h;
    drawCell(ctx, { x, y: by, w: cw * split, h }, l1, v1, o1);
    drawCell(ctx, { x: x + cw * split, y: by, w: cw * (1 - split), h }, l2, v2, o2);
  };
  // sheet row
  by -= 26;
  const sheet = { x, y: by, w: cw * 0.55, h: 26 };
  ctx.rect(sheet, LW.fine);
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid('SHEET', sheet.x + 3, by + 5.2, { cs: 0.35 });
  ctx.font('monoMedium', 12, C.ink);
  ctx.textMid(`${pad2(pageNo)}`, sheet.x + 6, by + 16.5);
  ctx.font('mono', T.label, C.ink2);
  ctx.textMid(`OF ${pad2(total)}`, sheet.x + 30, by + 17);
  drawCell(ctx, { x: x + cw * 0.55, y: by, w: cw * 0.45, h: 26 }, 'Section', `§ ${meta.sectionNo}`, { font: 'monoMedium', size: 9 });
  cell2('Generated', utc(md.generatedAt), 'Rev', md.revision, 20, 0.75, {}, { font: 'monoMedium', align: 'center' });
  cell2('Drawing no.', plate.drawingNo, 'Scale', plate.scale ?? 'AS SHOWN', 20, 0.55, { font: 'monoMedium' });
  cell2('Incident ID', md.incidentId, 'Status', 'UNVERIFIED', 20, 0.6, {}, { font: 'condSemi' });
  by -= 20;
  drawCell(ctx, { x, y: by, w: cw, h: 20 }, 'Document ref.', md.documentRef);

  // drawing title
  ctx.font('condBold', 10.5, C.ink);
  const titleH = ctx.height(plate.title.toUpperCase(), { w: cw - 12, cs: 0.4 });
  ctx.font('cond', T.label, C.ink2);
  const subH = plate.subtitle ? ctx.height(plate.subtitle, { w: cw - 12 }) : 0;
  const th = 12 + titleH + subH + 8;
  by -= th;
  ctx.rect({ x, y: by, w: cw, h: th }, LW.fine);
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid('DRAWING TITLE', x + 3, by + 5.2, { cs: 0.35 });
  ctx.font('condBold', 10.5, C.ink);
  ctx.text(plate.title.toUpperCase(), x + 6, by + 11, { w: cw - 12, cs: 0.4 });
  if (plate.subtitle) {
    ctx.font('cond', T.label, C.ink2);
    ctx.text(plate.subtitle, x + 6, by + 11 + titleH + 1, { w: cw - 12 });
  }
  // revision block
  const revH = 11 * (2 + md.revisionHistory.length);
  by -= revH;
  drawRevisionBlock(ctx, x, by, cw);
  ctx.line(x, by, W - f, by, LW.heavy);
}

/* ------------------------------------------------------------------ finalize */

export function finalizeFrames(ctx: ReportContext) {
  const total = ctx.pages.length;
  const range = ctx.doc.bufferedPageRange();
  for (let i = 0; i < total; i++) {
    ctx.doc.switchToPage(range.start + i);
    const meta = ctx.pages[i];
    const W = meta.orientation === 'landscape' ? PAGE.a4.h : PAGE.a4.w;
    const H = meta.orientation === 'landscape' ? PAGE.a4.w : PAGE.a4.h;
    drawTechnicalFrame(ctx, W, H);
    if (meta.kind === 'plate') {
      drawPlateColumn(ctx, meta, W, H, i + 1, total);
    } else {
      if (meta.kind !== 'cover') drawHeaderStrip(ctx, meta, W);
      drawFooterStrip(ctx, meta, W, H, i + 1, total);
    }
  }
}
