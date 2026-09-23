/**
 * Up to three compact visuals for the FULL SITREP. Drawn from `facts.geometry` (schematic demonstration geometry)
 * and computed facts. Visuals never introduce a value that is not stated in the text.
 */
import type { LatLon, RankedResource, SitrepFacts } from '../../SitrepTypes';
import { C, DASH, LW, T, MapView, drawArrowHead, drawMarker, drawNorthArrow, drawScaleBar, extentOf, type Box, type Extent, type ReportContext } from './reportDesign';
import { hoursBetween, toXY } from '../../utils/format';

const HORIZON_DASH: Record<number, number[]> = { 6: DASH.dashed, 12: DASH.dashDot, 24: DASH.dotted };
const niceKm = (spanKm: number) => [2, 4, 5, 10, 20, 40].find((v) => v >= spanKm / 4) ?? 50;

function tag(ctx: ReportContext, b: Box, text: string, color: string = C.ink) {
  ctx.font('condBold', T.micro, color);
  const w = ctx.width(text, 0.3) + 8;
  const r = { x: b.x + b.w - w - 3, y: b.y + 3, w, h: 10 };
  ctx.rect(r, LW.fine, color, C.paper);
  ctx.font('condBold', T.micro, color);
  ctx.textMid(text, r.x, r.y + 5, { w, align: 'center', cs: 0.3 });
}

function label(ctx: ReportContext, s: string, x: number, y: number, color: string = C.ink) {
  ctx.font('condSemi', T.micro, color);
  const w = ctx.width(s) + 3;
  ctx.fillRect({ x: x - 1.5, y: y - 4, w, h: 8 }, C.paper);
  ctx.font('condSemi', T.micro, color);
  ctx.textMid(s, x, y);
}

function mapFurniture(ctx: ReportContext, mv: MapView, b: Box) {
  drawNorthArrow(ctx, b.x + 12, b.y + 22, 16);
  const km = niceKm(mv.ext.x1 - mv.ext.x0);
  ctx.fillRect({ x: b.x + 2, y: b.y + b.h - 22, w: km * mv.scale + 40, h: 20 }, C.paper);
  drawScaleBar(ctx, b.x + 8, b.y + b.h - 13, mv.scale, km, 2);
}

/** A — observed slick with forecast centres, uncertainty circles and priority resources. */
export function drawForecastSchematic(ctx: ReportContext, b: Box, f: SitrepFacts) {
  const g = f.geometry, origin = g.slickCentroid!;
  const hz = f.forecast.horizons;
  const circles: Extent[] = hz.map((h) => {
    const c = toXY(origin, h.centre);
    return { x0: c.x - h.uncertaintyKm, x1: c.x + h.uncertaintyKm, y0: c.y - h.uncertaintyKm, y1: c.y + h.uncertaintyKm };
  });
  const locs = f.impacts.resources.filter((r) => r.location).map((r) => r.location!);
  const ext = extentOf(origin, [origin, ...(g.slickOutline ?? []), ...locs], 3, circles);
  const mv = new MapView(ctx, b, origin, ext);
  mv.drawNeatline({ minorMin: 1, gridMin: 5, labels: false });
  if (g.coastline) mv.drawLand(g.coastline);
  mv.clip(() => {
    hz.forEach((h) => {
      const c = mv.ll(h.centre);
      ctx.pen(0.9, C.model, HORIZON_DASH[h.horizonH] ?? DASH.dashed);
      ctx.doc.circle(c.x, c.y, h.uncertaintyKm * mv.scale).stroke();
      ctx.doc.undash();
    });
    ctx.pen(LW.medium, C.model, DASH.short);
    mv.pathLL([origin, ...hz.map((h) => h.centre)]).stroke();
    ctx.doc.undash();
    if (g.slickOutline) mv.pathLL(g.slickOutline, true).fill(C.ink);
    else drawMarker(ctx, 'circle', mv.ll(origin).x, mv.ll(origin).y, 3);
    f.impacts.resources.forEach((r) => {
      if (!r.location) return;
      const p = mv.ll(r.location);
      drawMarker(ctx, 'square', p.x, p.y, 3, r.sensitivity === 'CRITICAL' ? C.critical : C.ink, r.priority <= 2);
    });
  });
  if (hz.length) {
    const a = hz.length > 1 ? mv.ll(hz[hz.length - 2].centre) : mv.ll(origin), z = mv.ll(hz[hz.length - 1].centre);
    drawArrowHead(ctx, z, Math.atan2(z.y - a.y, z.x - a.x), 5, C.model);
  }
  hz.forEach((h) => {
    const c = mv.ll(h.centre);
    ctx.doc.circle(c.x, c.y, 1.4).fill(C.model);
    label(ctx, `+${h.horizonH} h`, c.x - 8, c.y - h.uncertaintyKm * mv.scale - 5, C.model);
  });
  f.impacts.resources.forEach((r) => {
    if (!r.location) return;
    const p = mv.ll(r.location);
    label(ctx, r.id, p.x - 22, p.y);
  });
  mapFurniture(ctx, mv, b);
  tag(ctx, b, 'MODELLED / PREDICTED', C.model);
}

/** B — inferred source-support corridor with relevant candidate tracks. */
export function drawCorridorMap(ctx: ReportContext, b: Box, f: SitrepFacts) {
  const g = f.geometry, origin = g.slickCentroid!;
  const ext = extentOf(origin, [origin, ...(g.slickOutline ?? []), ...(g.corridorPolygon ?? [])], 6);
  const mv = new MapView(ctx, b, origin, ext);
  mv.drawNeatline({ minorMin: 1, gridMin: 5, labels: false });
  if (g.coastline) mv.drawLand(g.coastline);
  const styles = [null, DASH.dashed, DASH.dotted];
  mv.clip(() => {
    if (g.corridorPolygon) {
      ctx.doc.save();
      mv.pathLL(g.corridorPolygon, true).clip();
      ctx.hatch(b, 3, LW.hair, C.ink3, 45);
      ctx.doc.restore();
      ctx.pen(LW.fine, C.ink, DASH.short);
      mv.pathLL(g.corridorPolygon, true).stroke();
      ctx.doc.undash();
    }
    g.tracks.forEach((t, i) => {
      ctx.pen(i === 0 ? LW.heavy : LW.medium, C.ink, styles[i] ?? DASH.dashDot);
      mv.pathLL(t.points).stroke();
      ctx.doc.undash();
    });
    if (g.slickOutline) mv.pathLL(g.slickOutline, true).fill(C.ink);
  });
  g.tracks.forEach((t, i) => {
    const inside = t.points.map((p) => mv.ll(p)).filter((p) => p.x > b.x + 30 && p.x < b.x + b.w - 50 && p.y > b.y + 18 && p.y < b.y + b.h - 26);
    const p = inside[inside.length - 1] ?? mv.ll(t.points[1] ?? t.points[0]);
    label(ctx, t.id, p.x + 3, p.y - 6 - i * 0.5);
  });
  if (g.corridorPolygon) {
    const c = g.corridorPolygon.reduce((a, p) => ({ lat: a.lat + p.lat / g.corridorPolygon!.length, lon: a.lon + p.lon / g.corridorPolygon!.length }), { lat: 0, lon: 0 } as LatLon);
    const q = mv.ll(c);
    label(ctx, 'SOURCE-SUPPORT CORRIDOR', q.x - 40, q.y + 16);
  }
  mapFurniture(ctx, mv, b);
  tag(ctx, b, 'INFERRED — NOT ATTRIBUTION');
}

/** C — exposure windows of priority resources on an hours-from-report axis. */
export function resourceTimelineHeight(n: number) {
  return 32 + n * 15;
}
export function drawResourceTimeline(ctx: ReportContext, b: Box, f: SitrepFacts) {
  const res: RankedResource[] = f.impacts.resources.filter((r) => r.windowFromReportH);
  const L = 150, R = 96;
  const ends = res.map((r) => r.windowFromReportH![1]);
  const lastH = f.forecast.horizons.length && f.forecast.issuedAt ? hoursBetween(f.header.generatedAt, f.forecast.horizons[f.forecast.horizons.length - 1].validAt) : null;
  const max = Math.ceil(Math.max(24, ...ends, lastH ?? 0) / 6) * 6;
  const p = { x: b.x + L, y: b.y + 4, w: b.w - L - R, h: b.h - 30 };
  const sx = (h: number) => p.x + (Math.max(0, Math.min(max, h)) / max) * p.w;
  const rowH = p.h / Math.max(1, res.length);

  for (let h = 0; h <= max; h += 6) {
    ctx.line(sx(h), p.y, sx(h), p.y + p.h, LW.hair, C.faint);
    ctx.line(sx(h), p.y + p.h, sx(h), p.y + p.h + 3, LW.fine);
    ctx.font('mono', T.micro, C.ink2);
    const s = h === 0 ? 'NOW' : `+${h}`;
    ctx.textMid(s, sx(h) - ctx.width(s) / 2, p.y + p.h + 8);
  }
  if (lastH !== null && lastH < max) {
    ctx.fillRect({ x: sx(lastH), y: p.y, w: sx(max) - sx(lastH), h: p.h }, C.tint2);
    ctx.line(sx(lastH), p.y, sx(lastH), p.y + p.h, LW.fine, C.model, DASH.dashed);
    ctx.font('condSemi', T.zone, C.model);
    ctx.textMid('FORECAST LIMIT', sx(lastH) - ctx.width('FORECAST LIMIT') - 3, p.y + p.h - 5);
  }
  ctx.line(p.x, p.y, p.x, p.y + p.h, LW.medium);
  ctx.line(p.x, p.y + p.h, p.x + p.w, p.y + p.h, LW.medium);
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('HOURS FROM REPORT TIME', p.x, p.y + p.h + 19, { w: p.w, align: 'center', cs: 0.4 });

  res.forEach((r, i) => {
    const yc = p.y + rowH * (i + 0.5);
    ctx.font('monoMedium', T.label, C.ink);
    ctx.textMid(`P${r.priority}`, b.x, yc);
    ctx.font('condMedium', T.small, C.ink);
    ctx.textMid(r.name, b.x + 18, yc);
    const [a, z] = r.windowFromReportH!;
    const bar = { x: sx(a), y: yc - 4, w: Math.max(2, sx(z) - sx(a)), h: 8 };
    const strong = r.exposure === 'LIKELY' || r.exposure === 'CONFIRMED';
    ctx.rect(bar, r.sensitivity === 'CRITICAL' ? LW.heavy : LW.fine, r.sensitivity === 'CRITICAL' ? C.critical : C.ink, strong ? '#8a8a8a' : C.paper);
    if (!strong) ctx.hatch(bar, 2.2, LW.hair, C.ink);
    ctx.font('cond', T.micro, C.ink);
    ctx.textMid(`${r.exposure} · ${r.sensitivity}`, p.x + p.w + 6, yc);
  });
}
