/**
 * Three vector visuals for the FULL IAP, all drawn from the structured plan:
 *   1. planning-sector overview (demonstration schematic geometry, not to scale)
 *   2. threat / asset timeline over the operational period (exposure windows, decision times, assignment bars)
 *   3. objective → assignment dependency diagram
 * A visual never introduces a value that is not already stated in the plan.
 */
import type { IapDocument, IapPlan, PlanningSector } from '../../IapTypes';
import { hhmm, ms } from '../../utils/format';
import { C, DASH, LW, T, drawArrowHead, drawMarker, drawNorthArrow, type Box, type ReportContext } from './reportDesign';

const label = (ctx: ReportContext, s: string, x: number, y: number, color: string = C.ink, font: 'condSemi' | 'cond' | 'monoMedium' = 'condSemi', size: number = T.micro) => {
  ctx.font(font, size, color);
  const w = ctx.width(s) + 3;
  ctx.fillRect({ x: x - 1.5, y: y - 4, w, h: 8 }, C.paper);
  ctx.font(font, size, color);
  ctx.textMid(s, x, y);
};

/* ================================================================== 1. sector overview */

export function drawSectorOverview(ctx: ReportContext, b: Box, plan: IapPlan) {
  const sec = plan.sectors;
  if (!sec.length) return;
  const mapW = b.w * 0.58, legendX = b.x + mapW + 10;
  const xs = sec.flatMap((s) => [s.schematic.x, s.schematic.x + s.schematic.w]);
  const ys = sec.flatMap((s) => [s.schematic.y, s.schematic.y + s.schematic.h]);
  const pad = 2;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const k = Math.min((mapW - 24) / (x1 - x0), (b.h - 18) / (y1 - y0));
  const ox = b.x + 8, oy = b.y + b.h - 8;
  const px = (v: number) => ox + (v - x0) * k;
  const py = (v: number) => oy - (v - y0) * k;
  const box = (s: PlanningSector): Box => ({ x: px(s.schematic.x), y: py(s.schematic.y + s.schematic.h), w: s.schematic.w * k, h: s.schematic.h * k });

  ctx.rect(b, LW.fine, C.grid);
  ctx.line(legendX - 5, b.y + 2, legendX - 5, b.y + b.h - 2, LW.hair, C.grid);

  // land side of the schematic coast
  const coastX = Math.min(...sec.filter((s) => s.type === 'SHORELINE' || s.type === 'BASE').map((s) => s.schematic.x));
  if (Number.isFinite(coastX)) {
    const cx = px(coastX);
    ctx.hatch({ x: cx, y: b.y + 2, w: Math.max(2, px(x1) - cx), h: b.h - 4 }, 4.5, LW.hair, C.faint, 70);
    ctx.line(cx, b.y + 2, cx, b.y + b.h - 2, LW.medium, C.ink2);
  }

  const resBySector = new Map(plan.protectionPriorities.filter((p) => p.priority !== 'MONITOR').map((p) => [p.sectorId, p]));
  const tasks = new Map<string, string[]>();
  for (const a of plan.assignments) if (a.sectorId && a.startTime) tasks.set(a.sectorId, [...(tasks.get(a.sectorId) ?? []), a.assignmentId]);

  for (const s of sec) {
    const r = box(s);
    const isSlick = plan.geometry.slickSectorId === s.sectorId;
    const isLead = plan.geometry.leadingEdgeSectorId === s.sectorId;
    const isIntercept = plan.geometry.interceptionSectorIds.includes(s.sectorId);
    ctx.rect(r, isSlick || isLead ? LW.medium : LW.fine, C.ink, undefined, isIntercept && !isSlick && !isLead ? DASH.dashed : s.type === 'BASE' ? DASH.dotted : null);
    ctx.font('monoMedium', T.label, C.ink);
    ctx.textMid(s.sectorId, r.x + 3, r.y + 7);
    if (isSlick) drawMarker(ctx, 'circle', r.x + r.w / 2, r.y + r.h / 2 + 3, 3.6, C.ink, true);
    const p = resBySector.get(s.sectorId);
    if (p) {
      drawMarker(ctx, p.type === 'CRITICAL INFRASTRUCTURE' ? 'square' : p.type === 'ECOLOGICAL' ? 'triangle' : 'diamond', r.x + r.w - 8, r.y + r.h - 8, 3.2, C.ink, true);
      ctx.font('condBold', T.zone, C.ink);
      ctx.textMid(p.priority, r.x + r.w - 20, r.y + r.h - 8);
    }
  }
  // forecast movement: slick sector → leading-edge sector
  const from = sec.find((s) => s.sectorId === plan.geometry.slickSectorId), to = sec.find((s) => s.sectorId === plan.geometry.leadingEdgeSectorId);
  if (from && to && from !== to) {
    const a = box(from), z = box(to);
    const p1 = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, p2 = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
    ctx.pen(LW.medium, C.model, DASH.dashed);
    ctx.doc.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke();
    ctx.doc.undash();
    drawArrowHead(ctx, p2, Math.atan2(p2.y - p1.y, p2.x - p1.x), 5, C.model);
  }
  drawNorthArrow(ctx, b.x + 16, b.y + 22, 14);

  // legend: one line per sector, with the resource and the tasks assigned there
  let ly = b.y + 10;
  const lw = b.x + b.w - legendX - 4;
  ctx.font('condSemi', T.micro, C.ink2);
  ctx.textMid('SECTOR  ·  RESOURCE AT RISK  ·  TASKED', legendX, ly, { cs: 0.3 });
  ly += 8;
  for (const s of sec) {
    const p = resBySector.get(s.sectorId), t = tasks.get(s.sectorId);
    const marks = [
      plan.geometry.slickSectorId === s.sectorId ? 'slick (last observed)' : '',
      plan.geometry.leadingEdgeSectorId === s.sectorId ? 'forecast leading edge' : '',
      plan.geometry.interceptionSectorIds.includes(s.sectorId) ? 'interception (planning basis)' : '',
      p ? `${p.priority} ${p.resourceId} ${p.name}` : '',
      t ? t.join(', ') : '',
    ].filter(Boolean).join(' · ');
    ctx.font('monoMedium', T.micro, C.ink);
    ctx.textMid(s.sectorId, legendX, ly);
    ctx.font('cond', T.micro, C.ink2);
    const text = `${s.name}${marks ? ` — ${marks}` : ''}`;
    const hgt = ctx.text(text, legendX + 22, ly - 3.5, { w: lw - 22, lineGap: -0.4 });
    ly += Math.max(8, hgt + 1.5);
  }
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid('Markers: square = infrastructure, triangle = ecological, diamond = socio-economic, circle = slick  ·  dashed outline = interception sector', b.x + 8, b.y + b.h - 3);
}

/* ================================================================== 2. timeline */

export const timelineHeight = (doc: IapDocument) => {
  const threats = doc.plan.protectionPriorities.filter((p) => p.priority !== 'MONITOR' && p.exposureWindow).length;
  const assets = doc.plan.resourceAllocation.filter((r) => r.assignments.some((x) => x.from)).length;
  return 42 + (doc.plan.weatherOutlook.length ? 12 : 0) + threats * 11 + 6 + assets * 11;
};

export function drawTimeline(ctx: ReportContext, b: Box, doc: IapDocument) {
  const { plan, header } = doc;
  const t0 = ms(header.periodStart), t1 = ms(header.periodEnd);
  const labelW = 74;
  const x0 = b.x + labelW, x1 = b.x + b.w - 4;
  const px = (t: number) => x0 + ((Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0)) * (x1 - x0);
  let y = b.y + 12;

  // hour grid
  const hours = Math.round((t1 - t0) / 3_600_000);
  const step = hours > 8 ? 2 : 1;
  ctx.font('mono', T.zone, C.ink3);
  for (let h = 0; h <= hours; h += step) {
    const t = t0 + h * 3_600_000, x = px(t);
    ctx.line(x, y, x, b.y + b.h - 2, LW.hair, h % (step * 2) === 0 ? C.grid : C.faint);
    ctx.font('mono', T.zone, C.ink3);
    ctx.textMid(hhmm(new Date(t).toISOString(), header.periodStart), x - 6, y - 5);
  }
  ctx.line(x0, y, x1, y, LW.medium);
  ctx.font('condSemi', T.micro, C.ink);
  ctx.textMid('UTC', b.x, y - 5, { cs: 0.3 });

  // weather windows that exceed a tasked asset's limit
  if (plan.weatherOutlook.length) {
    const hazardWindows = new Set(plan.safety.items.filter((h) => h.type === 'WEATHER').flatMap((h) => h.derivedFrom.filter((d) => d.startsWith('environment.outlook'))));
    ctx.font('cond', T.micro, C.ink2);
    ctx.textMid('WEATHER', b.x, y + 6);
    plan.weatherOutlook.forEach((w, i) => {
      const bad = hazardWindows.has(`environment.outlook[${i}]`);
      const r = { x: px(ms(w.from)), y: y + 2, w: Math.max(1, px(ms(w.to)) - px(ms(w.from))), h: 8 };
      if (bad) ctx.hatch(r, 2.4, LW.hair, C.critical, 45);
      ctx.rect(r, LW.hair, bad ? C.critical : C.grid);
      if (bad) label(ctx, 'EXCEEDS LIMIT', r.x + 3, r.y + 4, C.critical, 'condSemi', T.zone);
    });
    y += 12;
  }

  // threat rows: exposure windows and decision times
  const threats = plan.protectionPriorities.filter((p) => p.priority !== 'MONITOR' && p.exposureWindow);
  for (const p of threats) {
    ctx.font('condSemi', T.micro, C.ink);
    ctx.textMid(`${p.priority} ${p.resourceId}`, b.x, y + 6);
    const w = p.exposureWindow!;
    if (ms(w.end) > t0 && ms(w.start) < t1) {
      const r = { x: px(ms(w.start)), y: y + 2, w: Math.max(2, px(ms(w.end)) - px(ms(w.start))), h: 8 };
      ctx.hatch(r, 2.6, LW.hair, C.ink2, 45);
      ctx.rect(r, LW.fine, C.ink2);
      label(ctx, 'EXPOSURE WINDOW (MODELLED)', r.x + 3, y + 6, C.ink2, 'cond', T.zone);
    } else {
      ctx.font('cond', T.zone, C.ink3);
      ctx.textMid(`exposure window ${hhmm(w.start, header.periodStart)} UTC — after this period`, x1 - 150, y + 6);
      ctx.line(x1 - 158, y + 6, x1 - 152, y + 6, LW.fine, C.ink3, DASH.short);
    }
    if (p.decideBy && ms(p.decideBy) >= t0 && ms(p.decideBy) <= t1) {
      const x = px(ms(p.decideBy));
      drawMarker(ctx, 'diamond', x, y + 6, 3.4, C.critical, true);
      label(ctx, `DECIDE BY ${hhmm(p.decideBy, header.periodStart)}`, x + 6, y + 6, C.critical);
    }
    y += 11;
  }
  if (threats.length) { ctx.line(b.x, y + 1, x1, y + 1, LW.hair, C.grid); y += 6; }

  // asset rows
  for (const r of plan.resourceAllocation.filter((x) => x.assignments.some((a) => a.from))) {
    ctx.font('monoMedium', T.micro, C.ink);
    ctx.textMid(r.assetId, b.x, y + 6);
    for (const a of r.assignments.filter((x) => x.from)) {
      const bar = { x: px(ms(a.from!)), y: y + 2, w: Math.max(2.5, px(ms(a.to!)) - px(ms(a.from!))), h: 8 };
      if (a.hold) {
        ctx.hatch(bar, 2.2, LW.hair, C.ink2, 135);
        ctx.rect(bar, LW.fine, C.ink);
        label(ctx, `${a.assignmentId} (held)`, bar.x + 3, y + 6, C.ink, 'monoMedium', T.zone);
      } else {
        ctx.rect(bar, LW.fine, C.ink, C.ink2);
        if (bar.w > 30) { ctx.font('monoMedium', T.zone, C.paper); ctx.textMid(a.assignmentId, bar.x + 2, y + 6); }
        else label(ctx, a.assignmentId, bar.x + bar.w + 2, y + 6, C.ink, 'monoMedium', T.zone);
      }
    }
    y += 11;
  }
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid('Solid = task on scene · hatched = asset held in readiness to period end · ◆ = command decision time', b.x, b.y + b.h - 3);
}

/* ================================================================== 3. dependency diagram */

export const dependencyHeight = (plan: IapPlan) => 14 + Math.max(plan.objectives.length, plan.assignments.length) * 13;

export function drawDependencyDiagram(ctx: ReportContext, b: Box, plan: IapPlan) {
  const objW = 120, asgW = 86, rowH = 13;
  const ox = b.x, ax = b.x + objW + 52;
  const objY = new Map<string, number>();
  const asgY = new Map<string, number>();
  let y = b.y + 8;
  for (const o of plan.objectives) {
    const r = { x: ox, y, w: objW, h: rowH - 3 };
    ctx.rect(r, o.priority === 'P1' ? LW.medium : LW.fine, C.ink);
    ctx.font('monoMedium', T.zone, C.ink);
    ctx.textMid(o.priority, r.x + 3, y + 5);
    ctx.font('condSemi', T.micro, C.ink);
    ctx.textMid(o.objectiveId.replace('OBJ-', ''), r.x + 17, y + 5);
    objY.set(o.objectiveId, y + 5);
    y += rowH;
  }
  y = b.y + 8;
  for (const a of plan.assignments) {
    const r = { x: ax, y, w: asgW, h: rowH - 3 };
    ctx.rect(r, LW.fine, a.startTime ? C.ink : C.rule, undefined, a.startTime ? null : DASH.dotted);
    ctx.font('monoMedium', T.micro, a.startTime ? C.ink : C.ink3);
    ctx.textMid(a.assignmentId, r.x + 3, y + 5);
    if (!a.startTime) label(ctx, a.status, r.x + asgW + 4, y + 5, C.ink3, 'cond', T.zone);
    asgY.set(a.assignmentId, y + 5);
    y += rowH;
  }
  for (const a of plan.assignments) {
    const y1 = objY.get(a.objectiveId), y2 = asgY.get(a.assignmentId);
    if (y1 === undefined || y2 === undefined) continue;
    ctx.pen(LW.hair, C.ink2);
    const mid = ox + objW + 26;
    ctx.doc.moveTo(ox + objW, y1).lineTo(mid, y1).lineTo(mid, y2).lineTo(ax, y2).stroke();
    drawArrowHead(ctx, { x: ax, y: y2 }, 0, 3.2, C.ink2);
  }
  // assignment → assignment dependencies (right-hand arcs)
  const right = ax + asgW + 34;
  for (const a of plan.assignments) {
    for (const d of a.dependencies.filter((x) => x.type === 'ASSIGNMENT')) {
      const y1 = asgY.get(d.ref!), y2 = asgY.get(a.assignmentId);
      if (y1 === undefined || y2 === undefined) continue;
      ctx.pen(LW.hair, C.ink3, DASH.short);
      ctx.doc.moveTo(ax + asgW, y1).lineTo(right, y1).lineTo(right, y2).lineTo(ax + asgW, y2).stroke();
      ctx.doc.undash();
      drawArrowHead(ctx, { x: ax + asgW, y: y2 }, Math.PI, 3, C.ink3);
    }
  }
  ctx.font('cond', T.zone, C.ink3);
  ctx.textMid('Solid = objective achieved by assignment · dashed = assignment prerequisite · dotted box = not resourced', b.x, b.y + b.h - 1);
}
