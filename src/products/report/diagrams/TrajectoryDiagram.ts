import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawLeaderCallout, drawMarker, drawNorthArrow, drawScaleBar, drawVectorArrow } from '../components/Drafting';
import { drawCompactTable } from '../components/EngineeringTable';
import { MapView, extentOf } from './MapView';
import { drawViewLabel, scaleRatio } from './SlickGeometryDiagram';
import { bearingOf, toXY } from '../utils/geo';
import { u } from '../utils/units';

/** Dash pattern loosens as confidence falls — uncertainty is legible without colour. */
export const zoneDash = (h: number) => (h <= 3 ? [5, 1.5] : h <= 6 ? [4, 2] : h <= 9 ? [3, 2.5] : h <= 12 ? [2.5, 3] : h <= 18 ? [1.5, 3] : [0.8, 3]);

export function drawSlickSolid(ctx: ReportContext, mv: MapView) {
  const s = ctx.data.slick;
  mv.pathLL(s.outline, true).fill(C.ink);
  s.fragments.forEach((f) => mv.pathLL(f, true).fill(C.ink));
}

export function drawHindcastPlate(ctx: ReportContext, box: Box) {
  const d = ctx.data, hc = d.hindcast;
  const origin = d.slick.centroid;
  const rect = { x: box.x + 18, y: box.y + 10, w: box.w - 26, h: box.h - 52 };
  const want = extentOf(origin, [...hc.centreTrack, ...d.slick.outline], 10.5);
  const mv = new MapView(ctx, rect, origin, want);
  mv.drawNeatline({ minorMin: 1, gridMin: 5 });

  mv.clip(() => {
    // particle tracks
    ctx.pen(LW.hair, '#a8a8a8');
    ctx.doc.lineJoin('round');
    hc.particleTracks.forEach((t) => mv.pathLL(t).stroke());
    // end points at T−24 h
    hc.particleTracks.forEach((t) => {
      const p = mv.ll(t[t.length - 1]);
      ctx.doc.circle(p.x, p.y, 0.9).fill(C.ink3);
    });
    // support zones (largest first)
    [...hc.steps].reverse().forEach((st) => {
      const c = mv.ll(st.centre);
      const r = st.spreadRadiusKm * mv.scale;
      ctx.doc.save();
      ctx.doc.circle(c.x, c.y, r).clip();
      ctx.fillRect({ x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }, C.paper);
      ctx.hatch({ x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r }, 2 + st.horizonH * 0.12, LW.hair, '#9fb2cc', 45);
      ctx.doc.restore();
      ctx.pen(0.9, C.model, zoneDash(st.horizonH));
      ctx.doc.circle(c.x, c.y, r).stroke();
      ctx.doc.undash();
    });
    // centre track with hourly ticks
    ctx.pen(1.2, C.model, DASH.dashDot);
    mv.pathLL(hc.centreTrack).stroke();
    ctx.doc.undash();
    hc.centreTrack.forEach((p, i) => {
      const q = mv.ll(p);
      if (i % 3 === 0) drawMarker(ctx, 'diamond', q.x, q.y, 2.2, C.model, true);
      else ctx.doc.circle(q.x, q.y, 0.9).fill(C.model);
    });
    drawSlickSolid(ctx, mv);
  });

  // zone labels
  // labels alternate either side of the track, perpendicular to it
  const t0 = mv.ll(hc.centreTrack[0]), tN = mv.ll(hc.centreTrack[hc.centreTrack.length - 1]);
  const tl = Math.hypot(tN.x - t0.x, tN.y - t0.y);
  const perp = { x: (tN.y - t0.y) / tl, y: -(tN.x - t0.x) / tl }; // left of backward direction (page)
  hc.steps.forEach((st, i) => {
    const c = mv.ll(st.centre);
    const r = st.spreadRadiusKm * mv.scale;
    const sgn = i % 2 ? -1 : 1;
    const anchor = { x: c.x + perp.x * r * sgn, y: c.y + perp.y * r * sgn };
    const out = 22 + i * 4;
    const at = { x: Math.max(rect.x + 80, anchor.x + perp.x * out * sgn), y: anchor.y + perp.y * out * sgn };
    drawLeaderCallout(ctx, anchor, at, [`${u.rel(-st.horizonH)} ZONE`, `r ${u.km(st.spreadRadiusKm, 1)} · ${st.confidence}`], { side: perp.x * sgn < 0 ? 'left' : 'right', boxed: true });
  });

  // slick label + backtrack arrow
  const sc = mv.ll(origin);
  drawLeaderCallout(ctx, sc, { x: sc.x + 26, y: sc.y - 34 }, ['OBSERVED SLICK SG-01', `T0 · ${u.km2(d.slick.mainBodyAreaKm2)}`], { boxed: true });
  const c6 = mv.ll(hc.centreTrack[5]), c10 = mv.ll(hc.centreTrack[10]);
  const nx = -(c10.y - c6.y), ny = c10.x - c6.x, nl = Math.hypot(nx, ny);
  const off = -(hc.steps[2].spreadRadiusKm * mv.scale + 16);
  drawVectorArrow(ctx, { x: c6.x + (nx / nl) * off, y: c6.y + (ny / nl) * off }, { x: c10.x + (nx / nl) * off, y: c10.y + (ny / nl) * off }, { lw: LW.medium, color: C.model, head: 6 });
  ctx.font('condSemi', T.micro, C.model);
  const mid = { x: (c6.x + c10.x) / 2 + (nx / nl) * (off + 9), y: (c6.y + c10.y) / 2 + (ny / nl) * (off + 9) };
  ctx.doc.save();
  const a = Math.atan2(c10.y - c6.y, c10.x - c6.x) + Math.PI;
  ctx.doc.translate(mid.x, mid.y).rotate((a * 180) / Math.PI);
  ctx.textMid('BACKWARD IN TIME', -38, 0, { cs: 0.5 });
  ctx.doc.restore();

  // inset schedule (top-left, water)
  const tw = 196;
  const tx = rect.x + 44, ty = rect.y + 10;
  ctx.fillRect({ x: tx - 3, y: ty - 3, w: tw + 6, h: 11 * (hc.steps.length + 1) + 17 }, C.paper);
  drawCompactTable(ctx, tx, ty, tw, 'Support-zone schedule', [{ header: 'Horizon', w: 0.8 }, { header: 'r', w: 0.7, align: 'right' }, { header: 'Area', w: 1, align: 'right' }, { header: 'Brg. from C', w: 0.9, align: 'right' }, { header: 'Conf.', w: 0.6, align: 'right' }], hc.steps.map((st) => [
    u.rel(-st.horizonH),
    u.km(st.spreadRadiusKm, 1),
    u.km2(st.supportAreaKm2, 1),
    u.bearing(bearingOf(toXY(origin, st.centre))),
    st.confidenceScore.toFixed(2),
  ]), 11);

  drawNorthArrow(ctx, rect.x + rect.w - 22, rect.y + 30, 26);
  ctx.fillRect({ x: rect.x + rect.w - 132, y: rect.y + rect.h - 32, w: 126, h: 28 }, C.paper);
  drawScaleBar(ctx, rect.x + rect.w - 126, rect.y + rect.h - 18, mv.scale, 10, 5);
  drawViewLabel(ctx, rect.x, rect.y + rect.h + 22, 'A', 'Backward trajectory reconstruction — 24 h before observation', `${scaleRatio(mv.scale)}  ·  ${hc.particleCount.toLocaleString('en-GB')} PARTICLES, ${hc.particleTracks.length} SAMPLE TRACKS SHOWN  ·  ZONE OUTLINE DASH LOOSENS WITH DECREASING CONFIDENCE`);
}
