import type { LatLon } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawArrowHead, drawCentroidMark, drawDimensionLine, drawLeaderCallout, drawNorthArrow, drawScaleBar } from '../components/Drafting';
import { drawCompactTable } from '../components/EngineeringTable';
import { MapView, extentOf } from './MapView';
import { bearingOf, bearingVec, polygonArea, polygonCentroid, toXY, type XY } from '../utils/geo';
import { lat, lon, u } from '../utils/units';

const PT_MM = 25.4 / 72;

/** View label beneath a drawing view: "VIEW A — TITLE  ·  SCALE 1:n". */
export function drawViewLabel(ctx: ReportContext, x: number, y: number, letter: string, title: string, scale?: string) {
  ctx.doc.circle(x + 6, y, 6).lineWidth(LW.medium).strokeColor(C.ink).stroke();
  ctx.font('condBold', T.label, C.ink);
  ctx.textMid(letter, x, y, { w: 12, align: 'center' });
  ctx.font('condSemi', T.small, C.ink);
  const t = title.toUpperCase();
  ctx.textMid(t, x + 17, y, { cs: 0.5 });
  const tw = ctx.width(t, 0.5);
  ctx.line(x + 17, y + 5.5, x + 17 + tw, y + 5.5, LW.medium);
  if (scale) {
    ctx.font('mono', T.micro, C.ink2);
    ctx.textMid(scale, x + 17, y + 11);
  }
}

export const scaleRatio = (ptPerKm: number) => `SCALE 1:${(Math.round(1e6 / (ptPerKm * PT_MM) / 1000) * 1000).toLocaleString('en-GB').replace(/,/g, ' ')} (A4)`;

export function drawSlickGeometryPlate(ctx: ReportContext, box: Box) {
  const s = ctx.data.slick;
  const origin = s.centroid;
  const toK = (p: LatLon) => toXY(origin, p);
  const outline = s.outline.map(toK);
  const frags = s.fragments.map((f) => f.map(toK));

  const U = bearingVec(s.orientationDeg - 180); // towards head
  const V = bearingVec(s.orientationDeg - 90); // towards right of head (page)
  const uv = (p: XY) => ({ u: p.x * U.x + p.y * U.y, v: p.x * V.x + p.y * V.y });
  const fromUV = (a: number, b: number): XY => ({ x: U.x * a + V.x * b, y: U.y * a + V.y * b });
  const us = outline.map((p) => uv(p).u), vs = outline.map((p) => uv(p).v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);

  const colW = 180;
  const gap = 16;
  const mainW = box.w - colW - gap;
  const mainRect = { x: box.x + 18, y: box.y + 10, w: mainW - 22, h: box.h * 0.64 };
  const want = extentOf(origin, [...s.outline, ...s.fragments.flat()], 2.3);
  want.x1 += 2.2;
  want.x0 -= 0.6;
  const mv = new MapView(ctx, mainRect, origin, want);
  const P = (p: XY) => mv.xy(p);

  mv.drawNeatline({ minorMin: 0.5, gridMin: 2, gridLines: false });

  mv.clip(() => {
    // km construction grid about the centroid
    for (let k = Math.ceil(mv.ext.x0); k <= mv.ext.x1; k++) {
      const a = P({ x: k, y: mv.ext.y0 }), b = P({ x: k, y: mv.ext.y1 });
      ctx.line(a.x, a.y, b.x, b.y, LW.hair, k === 0 ? C.grid : C.faint, k === 0 ? DASH.dashDot : DASH.dotted);
    }
    for (let k = Math.ceil(mv.ext.y0); k <= mv.ext.y1; k++) {
      const a = P({ x: mv.ext.x0, y: k }), b = P({ x: mv.ext.x1, y: k });
      ctx.line(a.x, a.y, b.x, b.y, LW.hair, k === 0 ? C.grid : C.faint, k === 0 ? DASH.dashDot : DASH.dotted);
    }
    // oriented bounding rectangle (construction)
    const bb = [fromUV(u0, v0), fromUV(u1, v0), fromUV(u1, v1), fromUV(u0, v1)];
    ctx.pen(LW.fine, C.ink3, DASH.dashed);
    mv.pathXY(bb, true).stroke();
    ctx.doc.undash();
    // section hatch inside slick + fragments
    [outline, ...frags].forEach((poly) => {
      ctx.doc.save();
      mv.pathXY(poly, true).clip();
      ctx.fillRect(mainRect, C.paper);
      ctx.hatch(mainRect, 2.6, LW.hair, C.ink2, 45);
      ctx.doc.restore();
      ctx.pen(1.3, C.ink);
      ctx.doc.lineJoin('round');
      mv.pathXY(poly, true).stroke();
    });
    // axes: chain lines extending past bbox
    const ax = (a: XY, b: XY) => {
      const pa = P(a), pb = P(b);
      ctx.line(pa.x, pa.y, pb.x, pb.y, LW.fine, C.ink, DASH.dashDot);
    };
    ax(fromUV(u0 - 1.4, 0), fromUV(u1 + 1.4, 0));
    ax(fromUV(0, v0 - 1.2), fromUV(0, v1 + 1.2));
  });

  // km grid labels (inside top + left edge)
  ctx.font('mono', T.zone, C.ink3);
  for (let k = Math.ceil(mv.ext.x0); k <= mv.ext.x1; k += 2) {
    const p = P({ x: k, y: mv.ext.y1 });
    if (p.x < mainRect.x + 40 || p.x > mainRect.x + mainRect.w - 10) continue;
    const t = `${k > 0 ? '+' : ''}${k}`;
    ctx.textMid(t, p.x + 2, p.y + 6);
  }
  for (let k = Math.ceil(mv.ext.y0); k <= mv.ext.y1; k += 2) {
    const p = P({ x: mv.ext.x0, y: k });
    if (p.y < mainRect.y + 50 || p.y > mainRect.y + mainRect.h - 40) continue;
    const t = `${k > 0 ? '+' : ''}${k}`;
    ctx.textMid(t, p.x + 3, p.y - 4);
  }

  // vertices every 8th, numbered
  const step = Math.max(1, Math.round(outline.length / 12));
  const vertexRows: string[][] = [];
  outline.forEach((p, i) => {
    if (i % step) return;
    const n = vertexRows.length + 1;
    const q = P(p);
    const out = uv(p).v >= 0 ? 1 : -1;
    const nrm = fromUV(0, out);
    const tp = P({ x: p.x + nrm.x * 0.55, y: p.y + nrm.y * 0.55 });
    ctx.pen(LW.fine, C.ink);
    ctx.doc.circle(q.x, q.y, 1.8).fillAndStroke(C.paper, C.ink);
    ctx.font('mono', T.zone, C.ink2);
    const lbl = `V${String(n).padStart(2, '0')}`;
    ctx.textMid(lbl, tp.x - ctx.width(lbl) / 2, tp.y);
    vertexRows.push([lbl, lat(s.outline[i].lat, 3), lon(s.outline[i].lon, 3)]);
  });

  // centroid
  const c = P({ x: 0, y: 0 });
  ctx.doc.circle(c.x, c.y, 7).fill(C.paper);
  drawCentroidMark(ctx, c.x, c.y, 4.5);

  // orientation: north reference + arc to trailing axis
  const R = 46;
  ctx.line(c.x, c.y - 8, c.x, c.y - R - 14, LW.fine, C.ink, DASH.dashDot);
  ctx.font('condBold', T.micro, C.ink);
  ctx.textMid('N', c.x - 2, c.y - R - 19);
  const arcPts: [number, number][] = [];
  for (let a = 0; a <= s.orientationDeg; a += 3) arcPts.push([c.x + Math.sin((a * Math.PI) / 180) * R, c.y - Math.cos((a * Math.PI) / 180) * R]);
  ctx.pen(2.2, C.paper);
  ctx.polyline(arcPts).stroke();
  ctx.pen(LW.fine, C.ink);
  ctx.polyline(arcPts).stroke();
  const [ex, ey] = [c.x + Math.sin((s.orientationDeg * Math.PI) / 180) * R, c.y - Math.cos((s.orientationDeg * Math.PI) / 180) * R];
  drawArrowHead(ctx, { x: ex, y: ey }, Math.atan2(ey - arcPts[arcPts.length - 2][1], ex - arcPts[arcPts.length - 2][0]), 5);
  const lblA = (150 * Math.PI) / 180;
  const lp = { x: c.x + Math.sin(lblA) * (R + 4), y: c.y - Math.cos(lblA) * (R + 4) };
  ctx.font('sansSemi', T.label, C.ink);
  const tt = `θ = ${u.bearing(s.orientationDeg)}`;
  ctx.fillRect({ x: lp.x - 1, y: lp.y - 1, w: ctx.width(tt) + 4, h: 9 }, C.paper);
  ctx.font('sansSemi', T.label, C.ink);
  ctx.textMid(tt, lp.x + 1, lp.y + 3.5);

  // dimensions
  drawDimensionLine(ctx, P(fromUV(u0, v0)), P(fromUV(u1, v0)), -30, `L = ${u.km(s.lengthKm)}`);
  drawDimensionLine(ctx, P(fromUV(u1, v0)), P(fromUV(u1, v1)), -26, `W = ${u.km(s.maxWidthKm)}`);
  // tail fragment distance
  const f0c = polygonCentroid(frags[1]);
  const tailPt = fromUV(u0, 0);
  drawDimensionLine(ctx, P(tailPt), P(f0c), 14, u.km(Math.hypot(f0c.x - tailPt.x, f0c.y - tailPt.y), 2), { ext: false });

  // callouts
  const head = P(fromUV(u1, 0)), tail = P(fromUV(u0, 0));
  drawLeaderCallout(ctx, head, { x: head.x + 34, y: head.y + 34 }, ['HEAD', `down-drift end, ${u.bearing(s.orientationDeg - 180)}`], { boxed: true });
  drawLeaderCallout(ctx, { x: tail.x + 2, y: tail.y + 1 }, { x: tail.x - 30, y: tail.y - 22 }, ['TAIL', `trailing end, ${u.bearing(s.orientationDeg)}`], { side: 'left', boxed: true });
  drawLeaderCallout(ctx, { x: c.x + 3, y: c.y + 3 }, { x: c.x + 18, y: c.y + 78 }, ['CENTROID C', `${lat(origin.lat)} ${lon(origin.lon)}`], { boxed: true, dot: false });
  const fOff: [number, number, 'left' | 'right'][] = [[40, 30, 'right'], [18, 58, 'right'], [44, 20, 'right']];
  frags.forEach((fr, i) => {
    const fc = P(polygonCentroid(fr));
    drawLeaderCallout(ctx, fc, { x: fc.x + fOff[i][0], y: fc.y + fOff[i][1] }, [`F${i + 1}`, u.km2(polygonArea(fr), 2)], { side: fOff[i][2], boxed: true });
  });

  drawNorthArrow(ctx, mainRect.x + 22, mainRect.y + 34, 26);
  ctx.fillRect({ x: mainRect.x + 8, y: mainRect.y + mainRect.h - 32, w: 128, h: 28 }, C.paper);
  drawScaleBar(ctx, mainRect.x + 12, mainRect.y + mainRect.h - 18, mv.scale, 4, 4);
  drawViewLabel(ctx, mainRect.x, mainRect.y + mainRect.h + 20, 'A', `Plan — slick ${s.observationId}, true north up`, `${scaleRatio(mv.scale)}  ·  GRID 1 km ABOUT CENTROID  ·  NEATLINE 0.5′`);

  // VIEW B — developed width profile along the major axis
  const pb = { x: mainRect.x + 26, y: mainRect.y + mainRect.h + 48, w: mainRect.w - 36, h: box.y + box.h - (mainRect.y + mainRect.h + 48) - 34 };
  const stations: { s: number; lo: number; hi: number }[] = [];
  const n = 240;
  for (let i = 0; i <= n; i++) {
    const su = u0 + ((u1 - u0) * i) / n;
    const hits: number[] = [];
    outline.forEach((p, k) => {
      const a = uv(p), b = uv(outline[(k + 1) % outline.length]);
      if ((a.u - su) * (b.u - su) <= 0 && a.u !== b.u) hits.push(a.v + ((su - a.u) / (b.u - a.u)) * (b.v - a.v));
    });
    stations.push({ s: su - u0, lo: hits.length ? Math.min(...hits) : 0, hi: hits.length ? Math.max(...hits) : 0 });
  }
  const L = u1 - u0;
  const maxHalf = Math.max(...stations.map((st) => Math.max(Math.abs(st.lo), Math.abs(st.hi))));
  const sxp = (d: number) => pb.x + (d / L) * pb.w;
  const syp = (v: number) => pb.y + pb.h / 2 - (v / (maxHalf * 1.25)) * (pb.h / 2);
  // axes / grid
  ctx.rect(pb, LW.fine);
  for (let k = 0; k <= Math.floor(L); k++) {
    ctx.line(sxp(k), pb.y, sxp(k), pb.y + pb.h, LW.hair, C.faint, DASH.dotted);
    ctx.line(sxp(k), pb.y + pb.h, sxp(k), pb.y + pb.h + 3, LW.fine);
    if (k % 2 === 0) {
      ctx.font('mono', T.zone, C.ink2);
      ctx.textMid(String(k), sxp(k) - ctx.width(String(k)) / 2, pb.y + pb.h + 8);
    }
  }
  ctx.line(pb.x, syp(0), pb.x + pb.w, syp(0), LW.fine, C.ink, DASH.dashDot);
  const prof: [number, number][] = [...stations.map((st) => [sxp(st.s), syp(st.hi)] as [number, number]), ...[...stations].reverse().map((st) => [sxp(st.s), syp(st.lo)] as [number, number])];
  ctx.doc.save();
  ctx.polyline(prof, true).clip();
  ctx.hatch(pb, 2.6, LW.hair, C.ink2);
  ctx.doc.restore();
  ctx.pen(1.1, C.ink);
  ctx.polyline(prof, true).stroke();
  // widest station dimension
  const widest = stations.reduce((a, b) => (b.hi - b.lo > a.hi - a.lo ? b : a));
  drawDimensionLine(ctx, { x: sxp(widest.s), y: syp(widest.hi) }, { x: sxp(widest.s), y: syp(widest.lo) }, -(sxp(L) - sxp(widest.s)) - 14, u.km(widest.hi - widest.lo));
  // mean width band
  const mw = s.meanWidthKm / 2;
  ctx.line(pb.x, syp(mw), pb.x + pb.w, syp(mw), LW.fine, C.ink2, DASH.dashed);
  ctx.line(pb.x, syp(-mw), pb.x + pb.w, syp(-mw), LW.fine, C.ink2, DASH.dashed);
  ctx.font('cond', T.zone, C.ink2);
  ctx.fillRect({ x: pb.x + 3, y: syp(mw) - 9, w: 70, h: 7 }, C.paper);
  ctx.font('cond', T.zone, C.ink2);
  ctx.textMid(`± W avg / 2 (${u.km(s.meanWidthKm)})`, pb.x + 4, syp(mw) - 5.5);
  ctx.font('condSemi', T.zone, C.ink2);
  ctx.textMid('TAIL', pb.x + 3, pb.y + 6);
  ctx.textMid('HEAD', pb.x + pb.w - 20, pb.y + 6);
  drawViewLabel(ctx, mainRect.x, box.y + box.h - 16, 'B', 'Developed width profile along major axis', 'DISTANCE FROM TAIL (km) · WIDEST SECTION DIMENSIONED · VERTICAL EXAGGERATION ×' + ((pb.h / (maxHalf * 2.5)) / (pb.w / L)).toFixed(1));

  // right column: schedules
  const cx = box.x + box.w - colW;
  let cy = box.y + 10;
  cy += drawCompactTable(ctx, cx, cy, colW, 'Geometry schedule — SG-01', [{ header: 'Quantity', w: 1.5, font: 'cond' }, { header: 'Sym.', w: 0.5, font: 'sans' }, { header: 'Value', w: 1.1, align: 'right' }], [
    ['Area, main body', 'A', u.km2(s.mainBodyAreaKm2)],
    ['Area, total', 'A tot', u.km2(s.areaKm2)],
    ['Perimeter', 'P', u.km(s.perimeterKm, 1)],
    ['Length (major)', 'L', u.km(s.lengthKm)],
    ['Width, mean', 'W avg', u.km(s.meanWidthKm)],
    ['Width, max. (minor)', 'W', u.km(s.maxWidthKm)],
    ['Orientation', 'θ', u.bearing(s.orientationDeg)],
    ['Elongation L/W avg', 'e', u.num(s.elongationRatio, 1)],
    ['Compactness 4πA/P²', 'κ', u.num(s.compactnessIndex, 2)],
    ['Bounding box', 'L×W', `${s.boundingBox.lengthKm.toFixed(2)}×${s.boundingBox.widthKm.toFixed(2)} km`],
    ['Regions', 'n', String(s.fragmentCount)],
  ], 11.5);
  cy += 12;
  cy += drawCompactTable(ctx, cx, cy, colW, 'Fragment schedule', [{ header: 'ID', w: 0.4 }, { header: 'Area', w: 0.9, align: 'right' }, { header: 'Dist. C', w: 0.9, align: 'right' }, { header: 'Brg. C', w: 0.7, align: 'right' }], frags.map((fr, i) => {
    const fc = polygonCentroid(fr);
    return [`F${i + 1}`, u.km2(polygonArea(fr), 2), u.km(Math.hypot(fc.x, fc.y), 1), u.bearing(bearingOf(fc))];
  }), 11);
  cy += 12;
  cy += drawCompactTable(ctx, cx, cy, colW, 'Boundary vertex extract (WGS-84)', [{ header: 'Pt', w: 0.45 }, { header: 'Latitude', w: 1.1 }, { header: 'Longitude', w: 1.2 }], vertexRows, 10.2);
  cy += 12;
  drawCompactTable(ctx, cx, cy, colW, 'Reference system', [{ header: 'Item', w: 0.9, font: 'cond' }, { header: 'Definition', w: 1.9, font: 'cond' }], [
    ['Datum', 'WGS-84 geographic'],
    ['Plan projection', 'Local tangent plane, true scale'],
    ['Grid origin', 'Centroid C (0, 0 km)'],
    ['Bearings', 'Degrees true, clockwise'],
    ['Source', `Detection mask ${s.observationId} (vector)`],
    ['Vertices', `${s.outline.length} (main body); every ${step}th shown`],
  ], 10.5);
}
