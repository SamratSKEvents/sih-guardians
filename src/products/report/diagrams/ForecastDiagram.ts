import type { LatLon } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawDimensionLine, drawLeaderCallout, drawMarker, drawNorthArrow, drawScaleBar, drawVectorArrow } from '../components/Drafting';
import { drawCompactTable } from '../components/EngineeringTable';
import { MapView, extentOf } from './MapView';
import { drawSlickSolid } from './TrajectoryDiagram';
import { drawViewLabel, scaleRatio } from './SlickGeometryDiagram';
import { bearingOf, toXY, type XY } from '../utils/geo';
import { u } from '../utils/units';

export const HORIZON_DASH: Record<number, number[]> = { 6: [5, 2], 12: [6, 2, 1, 2], 24: [1.2, 2.2] };
export const horizonDash = (h: number) => HORIZON_DASH[h] ?? DASH.dashed;

const inside = (p: XY, poly: XY[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

export function drawForecastPlate(ctx: ReportContext, box: Box) {
  const d = ctx.data, fc = d.forecast;
  const origin = d.slick.centroid;
  const rect = { x: box.x + 18, y: box.y + 10, w: box.w - 26, h: box.h - 52 };
  const want = extentOf(origin, [...d.slick.outline, ...fc.horizons.flatMap((h) => h.envelope), ...d.impacts.resources.map((r) => r.location)], 3.5);
  const mv = new MapView(ctx, rect, origin, want);
  mv.drawNeatline({ minorMin: 1, gridMin: 5 });
  const P = (p: LatLon) => mv.ll(p);
  const last = fc.horizons[fc.horizons.length - 1];

  mv.clip(() => {
    // envelopes, largest first; faint hatch in the largest only
    [...fc.horizons].reverse().forEach((h, i) => {
      if (i === 0) {
        ctx.doc.save();
        mv.pathLL(h.envelope, true).clip();
        ctx.hatch(rect, 4, LW.hair, '#aebfd6', 45);
        ctx.doc.restore();
      }
      ctx.pen(h.horizonH === last.horizonH ? 1.3 : 1, C.model, horizonDash(h.horizonH));
      ctx.doc.lineJoin('round');
      mv.pathLL(h.envelope, true).stroke();
      ctx.doc.undash();
    });
    // land over envelopes (envelope stops at shoreline)
    mv.drawLand(fc.coastline);

    // threatened shoreline: coastline vertices within the final envelope, densified
    const env = last.envelope.map((p) => toXY(origin, p));
    const coast = fc.coastline.map((p) => toXY(origin, p));
    const dense: { p: XY; hit: boolean }[] = [];
    coast.forEach((p, i) => {
      if (i === 0) return;
      const a = coast[i - 1];
      for (let k = 0; k < 12; k++) {
        const q = { x: a.x + ((p.x - a.x) * k) / 12, y: a.y + ((p.y - a.y) * k) / 12 };
        dense.push({ p: q, hit: inside(q, env) });
      }
    });
    let run: XY[] = [];
    const flush = () => {
      if (run.length > 1) {
        ctx.pen(3.2, C.critical);
        ctx.doc.lineCap('butt');
        mv.pathXY(run).stroke();
        // seaward barbs
        for (let k = 2; k < run.length - 1; k += 4) {
          const a = mv.xy(run[k]), b = mv.xy(run[k + 1]);
          const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;
          const s = nx > 0 ? -1 : 1; // point west (seaward)
          ctx.doc.polygon([a.x, a.y], [b.x, b.y], [(a.x + b.x) / 2 + nx * 5 * s, (a.y + b.y) / 2 + ny * 5 * s]).fill(C.critical);
        }
      }
      run = [];
    };
    dense.forEach((q) => (q.hit ? run.push(q.p) : flush()));
    flush();

    // centre path
    const path = [origin, ...fc.horizons.map((h) => h.centre)];
    ctx.pen(LW.fine, C.model, DASH.dashed);
    mv.pathLL(path).stroke();
    ctx.doc.undash();
    drawSlickSolid(ctx, mv);
  });

  fc.horizons.forEach((h, i) => {
    const c = P(h.centre);
    const prev = P(i ? fc.horizons[i - 1].centre : origin);
    drawVectorArrow(ctx, { x: prev.x + (c.x - prev.x) * 0.55, y: prev.y + (c.y - prev.y) * 0.55 }, { x: prev.x + (c.x - prev.x) * 0.72, y: prev.y + (c.y - prev.y) * 0.72 }, { lw: LW.medium, color: C.model, head: 5 });
    drawMarker(ctx, 'plus', c.x, c.y, 4, C.model);
    const below = i === 0;
    const ext = h.envelope.reduce((a, b) => (below ? P(b).y > P(a).y : P(b).y < P(a).y) ? b : a);
    const tp = P(ext);
    drawLeaderCallout(ctx, tp, { x: tp.x - 30 - i * 26, y: tp.y + (below ? 30 : -20 - i * 4) }, [`+${h.horizonH} h ENVELOPE (PREDICTED)`, `r ${u.km(h.uncertaintyRadiusKm, 1)} · P(contact) ${u.frac(h.shorelineContactProbability)}`], { side: 'left', boxed: true, color: C.model });
  });
  // uncertainty radius dimension on last horizon (perpendicular to drift)
  const lc = toXY(origin, last.centre);
  const dir = bearingOf(lc);
  const perp = { x: Math.sin(((dir - 90) * Math.PI) / 180), y: Math.cos(((dir - 90) * Math.PI) / 180) };
  drawDimensionLine(ctx, mv.xy(lc), mv.xy({ x: lc.x + perp.x * last.uncertaintyRadiusKm, y: lc.y + perp.y * last.uncertaintyRadiusKm }), 0, `r = ${u.km(last.uncertaintyRadiusKm, 1)}`, { ext: false, color: C.model });

  const sc = P(origin);
  drawLeaderCallout(ctx, sc, { x: sc.x + 10, y: sc.y - 40 }, ['OBSERVED SLICK — T0', 'solid = observed'], { side: 'left', boxed: true });

  // resources
  d.impacts.resources.forEach((r, i) => {
    const q = P(r.location);
    ctx.rect({ x: q.x - 4.5, y: q.y - 4.5, w: 9, h: 9 }, LW.medium, C.ink, r.priorityScore >= 85 ? C.ink : C.paper);
    ctx.font('monoMedium', T.zone, r.priorityScore >= 85 ? C.paper : C.ink);
    ctx.textMid(String(i + 1), q.x - 1.8, q.y);
  });
  // resource schedule (balloon numbers refer to this table)
  const rw = 214;
  const rx = rect.x + rect.w - rw - 10, ry = rect.y + rect.h - 44 - 11 * (d.impacts.resources.length + 1) - 11;
  ctx.fillRect({ x: rx - 3, y: ry - 3, w: rw + 6, h: 11 * (d.impacts.resources.length + 1) + 17 }, C.paper);
  drawCompactTable(ctx, rx, ry, rw, 'Resources at risk (see Section 11)', [{ header: 'No.', w: 0.3, align: 'center' }, { header: 'Resource', w: 2.0, font: 'cond' }, { header: 'ETA', w: 0.75, align: 'right' }, { header: 'Prio.', w: 0.45, align: 'right' }], d.impacts.resources.map((r, i) => [
    String(i + 1),
    r.name,
    r.estimatedArrivalH === null ? '> +24 h' : `+${r.estimatedArrivalH} h${r.estimatedArrivalH > 24 ? '*' : ''}`,
    String(r.priorityScore),
  ]), 11);
  ctx.fillRect({ x: rx - 3, y: ry + 11 * (d.impacts.resources.length + 2) + 2, w: rw + 6, h: 10 }, C.paper);
  ctx.font('cond', T.zone, C.ink2);
  ctx.textMid('* beyond forecast horizon — indicative', rx, ry + 11 * (d.impacts.resources.length + 2) + 7);

  // inset horizon table (open water, top-left)
  const tw = 214;
  const tx = rect.x + 44, ty = rect.y + 10;
  ctx.fillRect({ x: tx - 3, y: ty - 3, w: tw + 6, h: 11 * (fc.horizons.length + 2) + 16 }, C.paper);
  drawCompactTable(ctx, tx, ty, tw, 'Forecast horizons (ensemble)', [{ header: 'Horizon', w: 0.7 }, { header: 'Centre from C', w: 1.4 }, { header: 'r', w: 0.7, align: 'right' }, { header: 'P(contact)', w: 0.8, align: 'right' }], [
    ['T0 obs.', '—', u.km(fc.uncertaintyGrowth[0].radiusKm, 1), '—'],
    ...fc.horizons.map((h) => {
      const c = toXY(origin, h.centre);
      return [`+${h.horizonH} h`, `${u.km(Math.hypot(c.x, c.y), 1)} @ ${u.bearing(bearingOf(c))}`, u.km(h.uncertaintyRadiusKm, 1), u.frac(h.shorelineContactProbability)];
    }),
  ], 11);

  ctx.fillRect({ x: rect.x + rect.w - 34, y: rect.y + 8, w: 26, h: 40 }, C.paper);
  drawNorthArrow(ctx, rect.x + rect.w - 21, rect.y + 32, 24);
  ctx.fillRect({ x: rect.x + 6, y: rect.y + rect.h - 30, w: 134, h: 26 }, C.paper);
  drawScaleBar(ctx, rect.x + 10, rect.y + rect.h - 16, mv.scale, 10, 5);
  drawViewLabel(ctx, rect.x, rect.y + rect.h + 22, 'A', 'Forward drift forecast +6 / +12 / +24 h', `${scaleRatio(mv.scale)}  ·  ENVELOPES = 90 % ENSEMBLE MASS  ·  COASTLINE SCHEMATIC — NOT FOR NAVIGATION`);
}
