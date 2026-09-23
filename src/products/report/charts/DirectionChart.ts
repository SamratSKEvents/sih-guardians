import type { EnvironmentRecord } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawArrowHead, drawLegend, drawMarker, drawVectorArrow, type LegendItem } from '../components/Drafting';
import { u } from '../utils/units';
import { bearingOf, bearingVec, type XY } from '../utils/geo';

/** Surface drift (m/s vector, x east / y north) = current + windage·wind(towards). */
export function driftVector(r: EnvironmentRecord, windagePct: number): XY {
  const c = bearingVec(r.currentToDeg), w = bearingVec(r.windFromDeg + 180);
  const k = windagePct / 100;
  return { x: c.x * r.currentMs + w.x * r.windMs * k, y: c.y * r.currentMs + w.y * r.windMs * k };
}

/**
 * Polar time-direction plot. Angle = direction TOWARDS (true), radius = time (T−24 h centre → T0 rim).
 * Shows wind, current and resulting drift direction veering over the hindcast window.
 */
export function drawDirectionTimeRose(ctx: ReportContext, box: Box, records: EnvironmentRecord[], windagePct: number, markOffsets: number[]) {
  const legend: LegendItem[] = [
    { label: 'Wind (towards)', kind: 'line', style: { lw: LW.heavy }, marker: 'square' },
    { label: 'Current (towards)', kind: 'line', style: { lw: LW.heavy, dash: DASH.dashed }, marker: 'circle', markerFill: false },
    { label: 'Modelled drift', kind: 'line', style: { lw: LW.heavy, color: C.model, dash: DASH.dashDot }, marker: 'diamond' },
  ];
  drawLegend(ctx, box.x, box.y, box.w, legend, { cols: 2, rowH: 11 });
  const top = box.y + 30;
  const R = Math.min(box.w, box.h - 30) / 2 - 18;
  const cx = box.x + box.w / 2, cy = top + (box.h - 30) / 2;
  const t0 = records[0].offsetH, t1 = records[records.length - 1].offsetH;
  const r0 = R * 0.18;
  const rad = (h: number) => r0 + ((h - t0) / (t1 - t0)) * (R - r0);
  const pt = (bearing: number, rr: number) => ({ x: cx + Math.sin((bearing * Math.PI) / 180) * rr, y: cy - Math.cos((bearing * Math.PI) / 180) * rr });

  // rings = time
  for (const h of [-24, -18, -12, -6, 0]) {
    ctx.pen(h === 0 ? LW.medium : LW.hair, h === 0 ? C.ink : C.grid);
    ctx.doc.circle(cx, cy, rad(h)).stroke();
  }
  // spokes
  for (let b = 0; b < 360; b += 30) {
    const a = pt(b, r0), z = pt(b, R + (b % 90 ? 3 : 6));
    ctx.line(a.x, a.y, z.x, z.y, b % 90 ? LW.hair : LW.fine, b % 90 ? C.grid : C.ink3);
    const lp = pt(b, R + 12);
    const s = b % 90 ? u.bearing(b) : ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[b];
    ctx.font(b % 90 ? 'mono' : 'condBold', b % 90 ? T.micro : T.small, C.ink);
    ctx.textMid(s, lp.x - ctx.width(s) / 2, lp.y);
  }
  for (let b = 0; b < 360; b += 10) {
    const a = pt(b, R), z = pt(b, R + 2);
    ctx.line(a.x, a.y, z.x, z.y, LW.hair, C.ink3);
  }
  // ring labels along 200° spoke
  ctx.font('mono', T.micro, C.ink2);
  for (const h of [-24, -12, 0]) {
    const p = pt(200, rad(h));
    const s = u.rel(h);
    ctx.fillRect({ x: p.x - ctx.width(s) / 2 - 1, y: p.y - 3.5, w: ctx.width(s) + 2, h: 7 }, C.paper);
    ctx.font('mono', T.micro, C.ink2);
    ctx.textMid(s, p.x - ctx.width(s) / 2, p.y);
  }

  const traces: { dir: (r: EnvironmentRecord) => number; dash: number[] | null; color: string; marker: 'square' | 'circle' | 'diamond'; fill: boolean }[] = [
    { dir: (r) => r.windFromDeg + 180, dash: null, color: C.ink, marker: 'square', fill: true },
    { dir: (r) => r.currentToDeg, dash: DASH.dashed, color: C.ink, marker: 'circle', fill: false },
    { dir: (r) => bearingOf(driftVector(r, windagePct)), dash: DASH.dashDot, color: C.model, marker: 'diamond', fill: true },
  ];
  for (const tr of traces) {
    const pts = records.map((r) => pt(tr.dir(r), rad(r.offsetH)));
    ctx.pen(LW.heavy, tr.color, tr.dash);
    ctx.doc.lineJoin('round');
    ctx.polyline(pts.map((p) => [p.x, p.y])).stroke();
    ctx.doc.undash();
    records.forEach((r, i) => {
      if (markOffsets.includes(r.offsetH)) drawMarker(ctx, tr.marker, pts[i].x, pts[i].y, 2.2, tr.color, tr.fill);
    });
  }
  // T0 labels
  const last = records[records.length - 1];
  const labels: [number, string][] = [
    [last.windFromDeg + 180, `W ${u.bearing(last.windFromDeg + 180)}`],
    [last.currentToDeg, `C ${u.bearing(last.currentToDeg)}`],
    [bearingOf(driftVector(last, windagePct)), `D ${u.bearing(bearingOf(driftVector(last, windagePct)))}`],
  ];
  labels.forEach(([b, s], i) => {
    const p = pt(b, R);
    const q = { x: cx + R * 0.95 + 16, y: cy - R * 0.92 + i * 10 };
    ctx.line(p.x, p.y, q.x - 2, q.y, LW.hair, C.ink3);
    ctx.font('monoMedium', T.micro, i === 2 ? C.model : C.ink);
    ctx.textMid(s, q.x, q.y);
  });
}

/** Vector triangle: current + windage = drift, drawn to scale (m/s). */
export function drawDriftComposition(ctx: ReportContext, box: Box, r: EnvironmentRecord, windagePct: number) {
  const k = windagePct / 100;
  const c = bearingVec(r.currentToDeg), w = bearingVec(r.windFromDeg + 180);
  const cv = { x: c.x * r.currentMs, y: c.y * r.currentMs };
  const wv = { x: w.x * r.windMs * k, y: w.y * r.windMs * k };
  const dv = { x: cv.x + wv.x, y: cv.y + wv.y };
  const dMs = Math.hypot(dv.x, dv.y);

  const scale = (box.w * 0.62) / Math.max(dv.x, 0.01); // pt per m/s
  const origin = { x: box.x + 30, y: box.y + box.h * 0.72 };
  const P = (v: XY) => ({ x: origin.x + v.x * scale, y: origin.y - v.y * scale });

  // light construction grid in m/s
  const step = 0.1;
  ctx.font('mono', T.micro, C.ink3);
  for (let i = 0; i * step <= dv.x + 0.06; i++) {
    const x = origin.x + i * step * scale;
    ctx.line(x, box.y + 18, x, origin.y + 8, LW.hair, C.faint);
    const s = (i * step).toFixed(1);
    ctx.textMid(s, x - ctx.width(s) / 2, origin.y + 14);
  }
  for (let j = 0; origin.y - j * step * scale > box.y + 18; j++) {
    const y = origin.y - j * step * scale;
    ctx.line(origin.x - 8, y, origin.x + dv.x * scale + 18, y, LW.hair, C.faint);
  }
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('EAST COMPONENT  m/s', origin.x, origin.y + 24, { cs: 0.3 });
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('VECTOR COMPOSITION AT T0 (TO SCALE)', box.x, box.y + 6, { cs: 0.4 });

  // north reference at origin
  ctx.line(origin.x, origin.y, origin.x, box.y + 22, LW.fine, C.ink3, DASH.construction);
  ctx.font('condBold', T.micro, C.ink3);
  ctx.textMid('N', origin.x - 2, box.y + 18);

  const pc = P(cv), pd = P(dv);
  drawVectorArrow(ctx, origin, pc, { lw: LW.heavy, dash: DASH.dashed, head: 6 });
  drawVectorArrow(ctx, pc, pd, { lw: LW.heavy, head: 6 });
  drawVectorArrow(ctx, origin, pd, { lw: 1.5, color: C.model, head: 7 });

  // bearing arcs from north for drift
  const arc = (b: number, rr: number, color: string) => {
    ctx.pen(LW.fine, color);
    const steps = 24;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (b * i) / steps;
      pts.push([origin.x + Math.sin((a * Math.PI) / 180) * rr, origin.y - Math.cos((a * Math.PI) / 180) * rr]);
    }
    ctx.polyline(pts).stroke();
    const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
    drawArrowHead(ctx, { x: ex, y: ey }, Math.atan2(ey - py, ex - px), 4, color);
  };
  arc(bearingOf(dv), 34, C.model);

  const lab = (pp: XY, lines: string[], color: string, dx: number, dy: number) => {
    lines.forEach((l, i) => {
      ctx.font(i ? 'mono' : 'condSemi', T.micro, i ? C.ink2 : color);
      ctx.textMid(l, pp.x + dx, pp.y + dy + i * 8);
    });
  };
  const mid = (a: XY, b: XY) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  lab(mid(origin, pc), ['CURRENT', `${u.ms(r.currentMs)} → ${u.bearing(r.currentToDeg)}`], C.ink, -86, -26);
  lab(mid(pc, pd), [`WINDAGE  ${windagePct.toFixed(1)} % × WIND`, `${u.ms(r.windMs * k)} → ${u.bearing(r.windFromDeg + 180)}`], C.ink, 4, -24);
  lab(mid(origin, pd), ['DRIFT (MODELLED)', `${u.ms(dMs)} → ${u.bearing(bearingOf(dv))}`], C.model, 6, 14);
}
