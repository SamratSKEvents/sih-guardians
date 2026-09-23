import type { AisCandidate, AisPosition, LatLon } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawLeaderCallout, drawMarker, drawNorthArrow, drawScaleBar, drawVectorArrow } from '../components/Drafting';
import { MapView, extentOf } from './MapView';
import { drawSlickSolid } from './TrajectoryDiagram';
import { drawViewLabel, scaleRatio } from './SlickGeometryDiagram';
import { toLatLon, toXY, type XY } from '../utils/geo';
import { u } from '../utils/units';

/** Hindcast centre and radius at fractional hour offset h (≤ 0), interpolated from the contract. */
export function hindcastAt(ctx: ReportContext, h: number): { centre: LatLon; r: number } {
  const hc = ctx.data.hindcast;
  const origin = ctx.data.slick.centroid;
  const t = Math.min(hc.centreTrack.length - 1, Math.max(0, -h));
  const i = Math.min(hc.centreTrack.length - 2, Math.floor(t)), fr = t - i;
  const a = toXY(origin, hc.centreTrack[i]), b = toXY(origin, hc.centreTrack[i + 1]);
  const centre = toLatLon(origin, { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr });
  const pts = [{ horizonH: 0, spreadRadiusKm: 0.55 }, ...hc.steps];
  let r = pts[pts.length - 1].spreadRadiusKm;
  for (let k = 0; k < pts.length - 1; k++) {
    if (t >= pts[k].horizonH && t <= pts[k + 1].horizonH) {
      const q = (t - pts[k].horizonH) / (pts[k + 1].horizonH - pts[k].horizonH);
      r = pts[k].spreadRadiusKm + q * (pts[k + 1].spreadRadiusKm - pts[k].spreadRadiusKm);
    }
  }
  return { centre, r };
}

export function drawCandidatePlate(ctx: ReportContext, box: Box, cand: AisCandidate) {
  const d = ctx.data;
  const origin = d.slick.centroid;
  const track = cand.track ?? [];
  const cpaH = cand.closestApproachOffsetH;
  const win = track.filter((p) => Math.abs(p.offsetH - cpaH) <= 0.6);

  const mapH = box.h * 0.66;
  const rect = { x: box.x + 18, y: box.y + 10, w: box.w - 26, h: mapH };
  const corridorH = Array.from({ length: 21 }, (_, i) => -i);
  const want = extentOf(origin, [...d.slick.outline, ...win.map((p) => p.position), ...corridorH.filter((h) => h <= -8 && h >= -19).map((h) => hindcastAt(ctx, h).centre)], 7);
  const mv = new MapView(ctx, rect, origin, want);
  mv.drawNeatline({ minorMin: 1, gridMin: 5 });
  const P = (p: LatLon) => mv.ll(p);

  // corridor polygon: centre track offset by r(t) on both sides
  const left: XY[] = [], right: XY[] = [];
  corridorH.forEach((h) => {
    const a = hindcastAt(ctx, h), b = hindcastAt(ctx, h - 0.5);
    const pa = toXY(origin, a.centre), pb = toXY(origin, b.centre);
    const L = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const n = { x: -(pb.y - pa.y) / L, y: (pb.x - pa.x) / L };
    left.push({ x: pa.x + n.x * a.r, y: pa.y + n.y * a.r });
    right.push({ x: pa.x - n.x * a.r, y: pa.y - n.y * a.r });
  });
  const corridor = [...left, ...right.reverse()];

  mv.clip(() => {
    ctx.doc.save();
    mv.pathXY(corridor, true).clip();
    ctx.hatch(rect, 3.4, LW.hair, '#9fb2cc', 45);
    ctx.doc.restore();
    ctx.pen(0.8, C.model, DASH.dashed);
    mv.pathXY(corridor, true).stroke();
    ctx.doc.undash();
    // centre track
    ctx.pen(1, C.model, DASH.dashDot);
    mv.pathLL(corridorH.map((h) => hindcastAt(ctx, h).centre)).stroke();
    ctx.doc.undash();
    // zones bounding the strongest interval
    const ra = d.releaseAssessment.strongest;
    [ra.fromH, ra.toH].forEach((h) => {
      const z = hindcastAt(ctx, h);
      const c = P(z.centre);
      ctx.pen(0.8, C.model, [1.5, 2.5]);
      ctx.doc.circle(c.x, c.y, z.r * mv.scale).stroke();
      ctx.doc.undash();
    });
    // context vessels
    d.aisCandidates.candidates.filter((c) => c !== cand && c.track).forEach((c) => {
      ctx.pen(LW.fine, C.ink3, DASH.dashed);
      mv.pathLL(c.track!.map((p) => p.position)).stroke();
      ctx.doc.undash();
    });
    drawSlickSolid(ctx, mv);

    // candidate track split at AIS gaps (> 20 min)
    const segs: AisPosition[][] = [[]];
    track.forEach((p, i) => {
      if (i && p.offsetH - track[i - 1].offsetH > 0.34) segs.push([]);
      segs[segs.length - 1].push(p);
    });
    segs.forEach((sg, i) => {
      ctx.pen(1.6, C.ink);
      ctx.doc.lineJoin('round');
      mv.pathLL(sg.map((p) => p.position)).stroke();
      if (i < segs.length - 1) {
        const a = P(sg[sg.length - 1].position), b = P(segs[i + 1][0].position);
        ctx.line(a.x, a.y, b.x, b.y, 1.1, C.ink, DASH.dotted);
      }
    });
    track.forEach((p) => {
      const q = P(p.position);
      const hourly = Math.abs(p.offsetH - Math.round(p.offsetH)) < 1e-6;
      drawMarker(ctx, hourly ? 'square' : 'circle', q.x, q.y, hourly ? 3 : 1.9, C.ink, hourly);
    });
  });

  // direction arrows along track
  for (let i = 2; i < track.length - 1; i += 6) {
    const a = P(track[i].position), b = P(track[i + 1].position);
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    if (a.y < rect.y + 10 || a.y > rect.y + rect.h - 10 || a.x < rect.x || a.x > rect.x + rect.w) continue;
    drawVectorArrow(ctx, { x: a.x + nx * 9, y: a.y + ny * 9 }, { x: a.x + nx * 9 + (b.x - a.x) / L * 18, y: a.y + ny * 9 + (b.y - a.y) / L * 18 }, { lw: LW.fine, head: 4 });
  }

  // timestamps on hourly positions within view
  track.filter((p) => Math.abs(p.offsetH - Math.round(p.offsetH)) < 1e-6).forEach((p, i) => {
    const q = P(p.position);
    if (q.y < rect.y + 20 || q.y > rect.y + rect.h - 20 || q.x < rect.x + 10 || q.x > rect.x + rect.w - 80) return;
    drawLeaderCallout(ctx, q, { x: q.x - 40 - (i % 2) * 6, y: q.y + 4 }, [u.rel(p.offsetH), `${u.kn(p.sogKn)} · ${u.bearing(p.cogDeg)}`], { side: 'left', boxed: true, mono: true, dot: false });
  });

  // AIS gap callout
  const gapStart = track.find((p, i) => i < track.length - 1 && track[i + 1].offsetH - p.offsetH > 0.34);
  if (gapStart) {
    const gi = track.indexOf(gapStart);
    const a = P(gapStart.position), b = P(track[gi + 1].position);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    drawLeaderCallout(ctx, m, { x: m.x + 34, y: m.y + 6 }, [`AIS GAP ${u.minutes(cand.maxAisGapMin)}`, `${u.rel(Number(gapStart.offsetH.toFixed(1)))} → ${u.rel(Number(track[gi + 1].offsetH.toFixed(1)))}`], { boxed: true });
  }

  // CPA dimension
  const cpaPos = track.reduce((best, p) => (Math.abs(p.offsetH - cpaH) < Math.abs(best.offsetH - cpaH) ? p : best), track[0]);
  const z = hindcastAt(ctx, cpaPos.offsetH);
  const zc = P(z.centre), vp = P(cpaPos.position);
  ctx.pen(0.9, C.model, [3, 2]);
  ctx.doc.circle(zc.x, zc.y, z.r * mv.scale).stroke();
  ctx.doc.undash();
  drawMarker(ctx, 'plus', zc.x, zc.y, 4, C.model);
  ctx.line(zc.x, zc.y, vp.x, vp.y, LW.medium, C.model);
  drawLeaderCallout(ctx, zc, { x: zc.x + 30, y: zc.y + 48 }, [`CPA ${u.rel(cpaH)}`, `zone r ${u.km(z.r, 1)} · centre-to-track ${u.km(cand.closestApproachKm, 1)}`], { boxed: true });

  // labels for context vessels and slick
  d.aisCandidates.candidates.filter((c) => c !== cand && c.track).forEach((c) => {
    const vis = c.track!.map((p) => P(p.position)).filter((q) => q.x > rect.x + 30 && q.x < rect.x + rect.w - 90 && q.y > rect.y + 30 && q.y < rect.y + rect.h - 30);
    if (!vis.length) return;
    const q = vis[Math.floor(vis.length / 2)];
    drawLeaderCallout(ctx, q, { x: q.x + 18, y: q.y - 16 }, [`${c.candidateId} (context)`, `score ${c.score}`], { boxed: true, color: C.ink3 });
  });
  const sc = P(origin);
  drawLeaderCallout(ctx, sc, { x: sc.x + 30, y: sc.y + 36 }, ['OBSERVED SLICK', 'SG-01 at T0'], { boxed: true });
  const vis = track.map((p) => P(p.position)).filter((q) => q.y > rect.y + rect.h - 90 && q.y < rect.y + rect.h - 50 && q.x > rect.x + 20);
  if (vis[0]) drawLeaderCallout(ctx, vis[0], { x: vis[0].x + 30, y: vis[0].y + 10 }, [`${cand.candidateId} ${cand.vesselName}`, `${cand.type} · AIS track, COG ≈ ${u.bearing(track[0].cogDeg)}`], { boxed: true });

  drawNorthArrow(ctx, rect.x + rect.w - 22, rect.y + 30, 24);
  ctx.fillRect({ x: rect.x + 6, y: rect.y + rect.h - 30, w: 134, h: 26 }, C.paper);
  drawScaleBar(ctx, rect.x + 10, rect.y + rect.h - 16, mv.scale, 10, 5);
  drawViewLabel(ctx, rect.x, rect.y + rect.h + 20, 'A', `${cand.vesselName} track vs reconstructed source corridor`, `${scaleRatio(mv.scale)}  ·  AIS 15-min positions, hourly squares  ·  CORRIDOR = HINDCAST CENTRE ± r(t)`);

  // evidence panels
  const ev = cand.evidence ?? { supporting: [], contradicting: [], missing: [] };
  const py = rect.y + rect.h + 40;
  const ph = box.y + box.h - py;
  const cols: [string, string[], 'triangle' | 'circle', boolean][] = [
    ['SUPPORTING EVIDENCE', ev.supporting, 'triangle', true],
    ['CONTRADICTING / COMPETING', ev.contradicting, 'triangle', false],
    ['MISSING EVIDENCE', ev.missing, 'circle', false],
  ];
  const cw = (box.w - 16) / 3;
  cols.forEach(([title, items, mk, fill], i) => {
    const x = box.x + i * (cw + 8);
    ctx.rect({ x, y: py, w: cw, h: ph }, LW.fine);
    ctx.fillRect({ x, y: py, w: cw, h: 13 }, i === 0 ? C.ink : C.tint);
    ctx.line(x, py + 13, x + cw, py + 13, LW.fine);
    drawMarker(ctx, mk, x + 9, py + 6.5, 2.6, i === 0 ? C.paper : C.ink, fill);
    ctx.font('condBold', T.label, i === 0 ? C.paper : C.ink);
    ctx.textMid(title, x + 18, py + 6.5, { cs: 0.4 });
    let yy = py + 18;
    items.forEach((t, k) => {
      ctx.font('mono', T.micro, C.ink3);
      ctx.text(String(k + 1).padStart(2, '0'), x + 5, yy + 0.5);
      ctx.font('sans', T.label, C.ink);
      const h = ctx.text(t, x + 19, yy, { w: cw - 25, lineGap: 0.6 });
      yy += h + 3;
    });
  });
}
