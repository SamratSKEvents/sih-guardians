import type { ReleaseAssessment } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawLegend, drawMarker } from '../components/Drafting';
import { u } from '../utils/units';

/**
 * Release-time reconstruction: support curve (top), interval bars (middle), evidence markers (bottom),
 * all on one shared relative-time axis ending at the observation.
 */
export function drawReleaseTimeline(ctx: ReportContext, box: Box, ra: ReleaseAssessment) {
  const L = 92, R = 30;
  const x0 = box.x + L, x1 = box.x + box.w - R;
  const sx = (h: number) => x0 + ((h - ra.windowStartH) / (0 - ra.windowStartH)) * (x1 - x0);

  drawLegend(
    ctx,
    x0,
    box.y,
    x1 - x0,
    [
      { label: 'Strongest supported interval', kind: 'area', fill: C.ink2 },
      { label: 'Alternate interval', kind: 'hatch', style: { lw: LW.fine } },
      { label: 'Uncertainty band', kind: 'area', fill: C.paper, style: { dash: [2, 1.5], lw: LW.fine } },
      { label: 'Relative release support', kind: 'line', style: { lw: LW.heavy } },
    ],
    { cols: 2, rowH: 11 },
  );

  // lanes
  const curveTop = box.y + 34, curveH = box.h * 0.25;
  const lanesTop = curveTop + curveH + 14;
  const laneH = 16;
  const evTop = lanesTop + 3 * laneH + 16;
  const axisY = box.y + box.h - 18;

  // time grid spanning everything
  for (let h = ra.windowStartH; h <= 0; h += 1) {
    const major = h % 6 === 0;
    ctx.line(sx(h), curveTop, sx(h), axisY, LW.hair, major ? C.grid : '#ebebeb');
  }

  // lane labels
  const laneLabel = (s: string, y: number) => {
    ctx.font('condSemi', T.micro, C.ink2);
    ctx.text(s.toUpperCase(), box.x, y - 3.4, { w: L - 8, cs: 0.3 });
  };

  // support curve
  laneLabel('Relative support', curveTop + 6);
  ctx.font('mono', T.micro, C.ink3);
  [0, 0.5, 1].forEach((v) => {
    const y = curveTop + curveH - v * curveH;
    ctx.line(x0 - 3, y, x0, y, LW.fine);
    ctx.textMid(v.toFixed(1), x0 - 18, y);
  });
  ctx.line(x0, curveTop, x0, curveTop + curveH, LW.fine);
  ctx.line(x0, curveTop + curveH, x1, curveTop + curveH, LW.fine);
  const pts = ra.supportCurve.map((p) => [sx(p.offsetH), curveTop + curveH - p.support * curveH] as [number, number]);
  ctx.doc.save();
  ctx.polyline([[pts[0][0], curveTop + curveH], ...pts, [pts[pts.length - 1][0], curveTop + curveH]], true).clip();
  ctx.hatch({ x: x0, y: curveTop, w: x1 - x0, h: curveH }, 2.4, LW.hair, C.grid);
  ctx.doc.restore();
  ctx.pen(LW.heavy, C.ink);
  ctx.doc.lineJoin('round');
  ctx.polyline(pts).stroke();
  const peak = ra.supportCurve.reduce((a, b) => (b.support > a.support ? b : a));
  drawMarker(ctx, 'diamond', sx(peak.offsetH), curveTop + curveH - peak.support * curveH, 2.6);
  ctx.font('monoMedium', T.micro, C.ink);
  ctx.textMid(`peak ${peak.support.toFixed(2)} @ ${u.rel(peak.offsetH)}`, sx(peak.offsetH) + 6, curveTop + curveH - peak.support * curveH - 4);

  // interval lanes
  const lane = (i: number) => lanesTop + i * laneH;
  laneLabel('Uncertainty band', lane(0) + laneH / 2);
  const ub = { x: sx(ra.uncertaintyBand.fromH), y: lane(0) + 3, w: sx(ra.uncertaintyBand.toH) - sx(ra.uncertaintyBand.fromH), h: laneH - 6 };
  ctx.rect(ub, LW.fine, C.ink, undefined, [2, 1.5]);
  laneLabel('Strongest interval', lane(1) + laneH / 2);
  const sb = { x: sx(ra.strongest.fromH), y: lane(1) + 2, w: sx(ra.strongest.toH) - sx(ra.strongest.fromH), h: laneH - 4 };
  ctx.rect(sb, LW.fine, C.ink, C.ink2);
  ctx.font('condSemi', T.micro, C.paper);
  ctx.textMid(`${u.rel(ra.strongest.fromH)} … ${u.rel(ra.strongest.toH)}   S = ${ra.strongest.support.toFixed(2)}`, sb.x, sb.y + sb.h / 2, { w: sb.w, align: 'center' });
  laneLabel('Alternate interval', lane(2) + laneH / 2);
  const ab = { x: sx(ra.alternate.fromH), y: lane(2) + 2, w: sx(ra.alternate.toH) - sx(ra.alternate.fromH), h: laneH - 4 };
  ctx.hatch(ab, 2.2, LW.hair, C.ink);
  ctx.rect(ab, LW.fine);
  ctx.font('monoMedium', T.micro, C.ink);
  ctx.textMid(`S = ${ra.alternate.support.toFixed(2)}`, ab.x + ab.w + 4, ab.y + ab.h / 2);

  // dimension-style extents for strongest interval
  const dy = lane(0) - 2;
  ctx.line(sb.x, dy - 3, sb.x, sb.y, LW.hair, C.ink3, DASH.dotted);
  ctx.line(sb.x + sb.w, dy - 3, sb.x + sb.w, sb.y, LW.hair, C.ink3, DASH.dotted);

  // evidence
  laneLabel('Evidence markers', evTop + 4);
  const kinds = { supporting: { m: 'triangle', f: true }, contradicting: { m: 'triangle', f: false }, neutral: { m: 'circle', f: false } } as const;
  // greedy row assignment so labels never overlap
  const rowsEnd: number[] = [];
  [...ra.evidence].sort((a, b) => a.offsetH - b.offsetH).forEach((e) => {
    const x = sx(e.offsetH);
    ctx.font('cond', T.label, C.ink);
    const s = `${u.rel(e.offsetH)}  ${e.label}`;
    const w = ctx.width(s);
    const leftward = x + 6 + w > x1 + R;
    const x0 = leftward ? x - 6 - w : x - 4;
    const xEnd = leftward ? x + 4 : x + 6 + w;
    let row = rowsEnd.findIndex((end) => end + 8 < x0);
    if (row < 0) row = rowsEnd.push(-Infinity) - 1;
    rowsEnd[row] = xEnd;
    const ty = evTop + 6 + row * 14;
    ctx.line(x, lanesTop - 2, x, ty, LW.hair, C.ink, DASH.dotted);
    const k = kinds[e.kind];
    drawMarker(ctx, k.m, x, ty, 2.6, C.ink, k.f);
    ctx.font('cond', T.label, C.ink);
    ctx.textMid(s, leftward ? x - 6 - w : x + 6, ty);
  });
  drawLegend(
    ctx,
    box.x,
    evTop + 30,
    L - 6,
    [
      { label: 'Supporting', kind: 'marker', marker: 'triangle' },
      { label: 'Contradicting', kind: 'marker', marker: 'triangle', markerFill: false },
      { label: 'Neutral', kind: 'marker', marker: 'circle', markerFill: false },
    ],
    { rowH: 9 },
  );

  // axis
  ctx.line(x0, axisY, x1, axisY, LW.medium);
  for (let h = ra.windowStartH; h <= 0; h += 1) {
    const major = h % 6 === 0;
    ctx.line(sx(h), axisY, sx(h), axisY + (major ? 4 : 2), major ? LW.fine : LW.hair);
    if (major) {
      ctx.font('monoMedium', T.micro, C.ink);
      const s = h === 0 ? 'T0 OBS' : u.rel(h);
      ctx.textMid(s, sx(h) - ctx.width(s) / 2, axisY + 9);
    }
  }
  // observation marker
  ctx.line(sx(0), curveTop - 4, sx(0), axisY, LW.heavy);
  ctx.font('condBold', T.micro, C.ink);
  ctx.textMid('SAR OBSERVATION', sx(0) - ctx.width('SAR OBSERVATION') - 3, curveTop - 1);
}
