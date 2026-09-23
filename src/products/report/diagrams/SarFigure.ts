import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawCentroidMark, drawDimensionLine, drawNorthArrow, drawScaleBar } from '../components/Drafting';
import { MapView } from './MapView';
import { bearingVec, principalAxes, toXY, type XY } from '../utils/geo';
import { latLon, u } from '../utils/units';

/** SAR raster (or vector placeholder) with registered slick overlay and engineering callouts. */
export function drawSarFigure(ctx: ReportContext, box: Box) {
  const d = ctx.data, s = d.slick, ob = d.observation;
  const origin = s.centroid;
  const ib = ob.imageBounds;
  const nw = toXY(origin, { lat: ib.north, lon: ib.west }), se = toXY(origin, { lat: ib.south, lon: ib.east });
  const extent = { x0: nw.x, x1: se.x, y0: se.y, y1: nw.y };
  const aspect = (extent.x1 - extent.x0) / (extent.y1 - extent.y0);

  const gutter = 162;
  const imgW = box.w - gutter - 24;
  const imgH = imgW / aspect;
  const rect = { x: box.x + 14, y: box.y + 6, w: imgW, h: imgH };
  const mv = new MapView(ctx, rect, origin, extent);

  const img = ctx.images.get('sar');
  if (img) {
    ctx.doc.image(img as any, rect.x, rect.y, { width: rect.w, height: rect.h });
  } else {
    ctx.fillRect(rect, C.tint);
    ctx.hatch(rect, 6, LW.hair, C.grid);
    ctx.font('condSemi', T.small, C.ink3);
    ctx.textMid('SAR IMAGE NOT SUPPLIED — VECTOR OVERLAY ONLY', rect.x, rect.y + 14, { w: rect.w, align: 'center' });
  }
  mv.drawNeatline({ minorMin: 1, gridMin: 5 });

  const outline = s.outline.map((p) => toXY(origin, p));
  const ax = principalAxes(outline);
  const headDir = bearingVec(s.orientationDeg - 180);
  const minorDir = bearingVec(s.orientationDeg - 90);
  const P = (v: XY) => mv.xy(v);
  const along = (k: number): XY => ({ x: headDir.x * k, y: headDir.y * k });
  const halfL = s.lengthKm / 2;

  mv.clip(() => {
    const doc = ctx.doc;
    // outline: white halo + black dashed boundary
    [s.outline, ...s.fragments].forEach((poly) => {
      ctx.pen(2.4, C.paper);
      doc.lineJoin('round');
      mv.pathLL(poly, true).stroke();
      ctx.pen(0.9, C.ink, [3, 1.6]);
      mv.pathLL(poly, true).stroke();
      doc.undash();
    });
    // axes (chain lines with halo)
    const axis = (a: XY, b: XY) => {
      const pa = P(a), pb = P(b);
      ctx.line(pa.x, pa.y, pb.x, pb.y, 2, C.paper);
      ctx.line(pa.x, pa.y, pb.x, pb.y, LW.fine, C.ink, DASH.dashDot);
    };
    axis(along(-halfL - 1.6), along(halfL + 1.6));
    const mw = s.maxWidthKm / 2 + 1;
    axis({ x: minorDir.x * -mw, y: minorDir.y * -mw }, { x: minorDir.x * mw, y: minorDir.y * mw });
  });
  const c = P({ x: 0, y: 0 });
  ctx.doc.circle(c.x, c.y, 6.5).fill(C.paper);
  drawCentroidMark(ctx, c.x, c.y, 4);

  // length dimension parallel to major axis (on image, haloed)
  const tail = P(along(ax.majorExtent[0] * 0 - halfL)), head = P(along(halfL));
  drawDimensionLine(ctx, tail, head, -34, `L = ${u.km(s.lengthKm)}`, { halo: true });

  // callouts to the gutter
  const gx = rect.x + rect.w + 22;
  const items: { anchor: XY; lines: string[] }[] = [
    { anchor: along(halfL), lines: ['HEAD (DOWN-DRIFT END)', `bearing ${u.bearing(s.orientationDeg - 180)}`] },
    { anchor: { x: 0, y: 0 }, lines: ['CENTROID  C', latLon(s.centroid)] },
    { anchor: { x: minorDir.x * (s.maxWidthKm / 2), y: minorDir.y * (s.maxWidthKm / 2) }, lines: [`W avg = ${u.km(s.meanWidthKm)}`, `W max = ${u.km(s.maxWidthKm)} (minor axis)`] },
    { anchor: along(-halfL * 0.55), lines: [`θ major = ${u.bearing(s.orientationDeg)}`, `A = ${u.km2(s.mainBodyAreaKm2)} · P = ${u.km(s.perimeterKm, 1)}`] },
    { anchor: toXY(origin, s.fragments[0][0]), lines: [`FRAGMENTS  n = ${s.fragments.length}`, `${s.fragmentCount} regions incl. main body`] },
    { anchor: { x: 9.5, y: -6.3 }, lines: ['LOW-BACKSCATTER AREA', 'weak damping — not classified'] },
  ];
  const placed = items.map((it) => ({ ...it, p: P(it.anchor) })).sort((a, b) => a.p.y - b.p.y);
  const minGap = 24, lo = rect.y + 8, hi = rect.y + rect.h - 14;
  const ys = placed.map((it) => Math.min(hi, Math.max(lo, it.p.y)));
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + minGap);
  for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], i === ys.length - 1 ? hi : ys[i + 1] - minGap);
  placed.forEach((it, i) => {
    const ly = ys[i];
    const ex = rect.x + rect.w + 6;
    ctx.pen(1.4, C.paper);
    ctx.doc.moveTo(it.p.x, it.p.y).lineTo(rect.x + rect.w, it.p.y + ((ly - it.p.y) * (rect.x + rect.w - it.p.x)) / (ex - it.p.x)).stroke();
    ctx.doc.circle(it.p.x, it.p.y, 2).fill(C.paper);
    ctx.doc.circle(it.p.x, it.p.y, 1.2).fill(C.ink);
    ctx.pen(LW.fine, C.ink);
    ctx.doc.moveTo(it.p.x, it.p.y).lineTo(ex, ly).lineTo(box.x + box.w, ly).stroke();
    ctx.font('mono', T.micro, C.ink3);
    ctx.textMid(String(i + 1).padStart(2, '0'), ex + 2, ly - 5);
    const greek = (t: string) => /[θσπ]/.test(t);
    ctx.font(greek(it.lines[0]) ? 'sansMedium' : 'monoMedium', T.label, C.ink);
    ctx.textMid(it.lines[0], gx, ly - 5);
    ctx.font(greek(it.lines[1]) ? 'sans' : /°|km|[0-9]{2}/.test(it.lines[1]) ? 'mono' : 'cond', T.micro, C.ink2);
    ctx.textMid(it.lines[1], gx, ly + 5);
  });

  // north + scale on white tabs
  ctx.fillRect({ x: rect.x + 6, y: rect.y + 6, w: 26, h: 36 }, C.paper);
  drawNorthArrow(ctx, rect.x + 19, rect.y + 27, 18);
  ctx.fillRect({ x: rect.x + 6, y: rect.y + rect.h - 30, w: 112, h: 24 }, C.paper);
  drawScaleBar(ctx, rect.x + 10, rect.y + rect.h - 16, mv.scale, 8, 4);
  ctx.font('cond', T.micro, C.ink3);
  ctx.textMid(`${img ? 'SAR-like placeholder raster (demonstration)' : 'No raster'} · ${ob.polarisation} · pixel ${u.m(ob.pixelSpacingM)} · overlay registered to image bounds`, rect.x, rect.y + rect.h + 17);
  return rect.h + 24;
}
