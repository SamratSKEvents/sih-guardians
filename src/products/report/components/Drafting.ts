/**
 * Drafting primitives: arrows, dimension lines, leader callouts, north arrow, scale bar,
 * markers, legends, stamps and assessment-state badges.
 */
import type { AssessmentState, QualityLevel } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';

type Pt = { x: number; y: number };

export type MarkerKind = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus' | 'dot' | 'ring';

export interface LineStyle {
  lw?: number;
  color?: string;
  dash?: number[] | null;
}

export interface LegendItem {
  label: string;
  kind: 'line' | 'area' | 'marker' | 'arrow' | 'hatch';
  style?: LineStyle;
  fill?: string;
  marker?: MarkerKind;
  markerFill?: boolean;
}

/* ------------------------------------------------------------------ arrows */

export function drawArrowHead(ctx: ReportContext, tip: Pt, angle: number, size = 5, color: string = C.ink, open = false) {
  const d = ctx.doc;
  const a1 = angle + Math.PI - 0.32, a2 = angle + Math.PI + 0.32;
  const p1 = { x: tip.x + Math.cos(a1) * size, y: tip.y + Math.sin(a1) * size };
  const p2 = { x: tip.x + Math.cos(a2) * size, y: tip.y + Math.sin(a2) * size };
  d.save();
  d.undash();
  if (open) {
    ctx.pen(LW.fine, color);
    d.moveTo(p1.x, p1.y).lineTo(tip.x, tip.y).lineTo(p2.x, p2.y).stroke();
  } else {
    d.moveTo(p1.x, p1.y).lineTo(tip.x, tip.y).lineTo(p2.x, p2.y).closePath().fill(color);
  }
  d.restore();
}

export function drawVectorArrow(ctx: ReportContext, from: Pt, to: Pt, o: LineStyle & { head?: number; open?: boolean } = {}) {
  const color = o.color ?? C.ink;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const head = o.head ?? 5;
  const shaftEnd = o.open ? to : { x: to.x - Math.cos(ang) * head * 0.8, y: to.y - Math.sin(ang) * head * 0.8 };
  ctx.line(from.x, from.y, shaftEnd.x, shaftEnd.y, o.lw ?? LW.medium, color, o.dash ?? null);
  drawArrowHead(ctx, to, ang, head, color, o.open);
}

/* ------------------------------------------------------------------ dimension line */

/**
 * Engineering dimension between p1 and p2, offset perpendicular by `offset` pt
 * (positive = left of p1→p2 direction in page coordinates). Label is centred, knocked out.
 */
export function drawDimensionLine(ctx: ReportContext, p1: Pt, p2: Pt, offset: number, label: string, o: { color?: string; ext?: boolean; halo?: boolean } = {}) {
  const color = o.color ?? C.ink;
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  const a = { x: p1.x + nx * offset, y: p1.y + ny * offset };
  const b = { x: p2.x + nx * offset, y: p2.y + ny * offset };
  const sgn = Math.sign(offset) || 1;
  if (o.halo) {
    ctx.pen(2.6, C.paper);
    ctx.doc.lineCap('round');
    ctx.doc.moveTo(a.x, a.y).lineTo(b.x, b.y).moveTo(p1.x + nx * 2 * sgn, p1.y + ny * 2 * sgn).lineTo(a.x + nx * 3 * sgn, a.y + ny * 3 * sgn).moveTo(p2.x + nx * 2 * sgn, p2.y + ny * 2 * sgn).lineTo(b.x + nx * 3 * sgn, b.y + ny * 3 * sgn).stroke();
  }
  if (o.ext !== false) {
    // extension lines: small gap at the feature, overshoot 3 pt beyond the dimension line
    ctx.line(p1.x + nx * 2 * sgn, p1.y + ny * 2 * sgn, a.x + nx * 3 * sgn, a.y + ny * 3 * sgn, LW.hair, color);
    ctx.line(p2.x + nx * 2 * sgn, p2.y + ny * 2 * sgn, b.x + nx * 3 * sgn, b.y + ny * 3 * sgn, LW.hair, color);
  }
  ctx.line(a.x, a.y, b.x, b.y, LW.fine, color);
  drawArrowHead(ctx, a, ang + Math.PI, 5, color);
  drawArrowHead(ctx, b, ang, 5, color);
  // label, kept upright
  let ta = ang;
  if (ta > Math.PI / 2) ta -= Math.PI;
  if (ta < -Math.PI / 2) ta += Math.PI;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const d = ctx.doc;
  ctx.font('monoMedium', T.label, color);
  const tw = ctx.width(label) + 5;
  d.save();
  d.translate(mx, my).rotate((ta * 180) / Math.PI);
  d.rect(-tw / 2, -4.5, tw, 9).fill(C.paper);
  ctx.font('monoMedium', T.label, color);
  ctx.textMid(label, -tw / 2 + 2.5, 0);
  d.restore();
}

/* ------------------------------------------------------------------ leader callout */

/**
 * Leader from `anchor` to a landing shelf at `at`; text lines sit on the shelf.
 * side: which way the shelf extends from `at`.
 */
export function drawLeaderCallout(
  ctx: ReportContext,
  anchor: Pt,
  at: Pt,
  lines: string[],
  o: { side?: 'left' | 'right'; color?: string; mono?: boolean; dot?: boolean; boxed?: boolean } = {},
) {
  const side = o.side ?? (at.x >= anchor.x ? 'right' : 'left');
  const color = o.color ?? C.ink;
  const main = o.mono ? 'monoMedium' : 'condSemi';
  const sub = o.mono ? 'mono' : 'cond';
  ctx.font(main, T.label);
  const w = Math.max(...lines.map((l, i) => (ctx.font(i ? sub : main, T.label), ctx.width(l)))) + 4;
  const lh = 8.2;
  const shelfX2 = side === 'right' ? at.x + w : at.x - w;
  if (o.dot !== false) ctx.doc.circle(anchor.x, anchor.y, 1.3).fill(color);
  ctx.pen(LW.fine, color);
  ctx.doc.moveTo(anchor.x, anchor.y).lineTo(at.x, at.y).lineTo(shelfX2, at.y).stroke();
  const tx = Math.min(at.x, shelfX2) + 2;
  const top = at.y - lines.length * lh - 1;
  if (o.boxed) {
    ctx.doc.rect(Math.min(at.x, shelfX2), top - 1, w, lines.length * lh + 1).fill(C.paper);
  }
  lines.forEach((l, i) => {
    ctx.font(i ? sub : main, T.label, i ? C.ink2 : color);
    ctx.textMid(l, tx, top + lh * i + lh / 2 + 0.5);
  });
}

/* ------------------------------------------------------------------ markers */

export function drawMarker(ctx: ReportContext, kind: MarkerKind, x: number, y: number, size = 3, color: string = C.ink, filled = true) {
  const d = ctx.doc;
  const r = size;
  d.save();
  d.undash();
  ctx.pen(LW.fine, color);
  const finish = () => (filled ? d.fillAndStroke(color, color) : d.fillAndStroke(C.paper, color));
  switch (kind) {
    case 'circle':
      d.circle(x, y, r);
      finish();
      break;
    case 'ring':
      d.circle(x, y, r).stroke();
      break;
    case 'dot':
      d.circle(x, y, r * 0.6).fill(color);
      break;
    case 'square':
      d.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      finish();
      break;
    case 'triangle':
      d.polygon([x, y - r * 1.1], [x + r, y + r * 0.75], [x - r, y + r * 0.75]);
      finish();
      break;
    case 'diamond':
      d.polygon([x, y - r * 1.15], [x + r, y], [x, y + r * 1.15], [x - r, y]);
      finish();
      break;
    case 'cross':
      ctx.pen(LW.medium, color);
      d.moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r).stroke();
      break;
    case 'plus':
      ctx.pen(LW.medium, color);
      d.moveTo(x - r, y).lineTo(x + r, y).moveTo(x, y - r).lineTo(x, y + r).stroke();
      break;
  }
  d.restore();
}

/** Centroid symbol: circle with crosshair (drafting convention). */
export function drawCentroidMark(ctx: ReportContext, x: number, y: number, r = 4, color: string = C.ink) {
  ctx.pen(LW.fine, color);
  ctx.doc.circle(x, y, r).stroke();
  ctx.line(x - r * 1.8, y, x + r * 1.8, y, LW.fine, color);
  ctx.line(x, y - r * 1.8, x, y + r * 1.8, LW.fine, color);
  // filled quadrants (1st & 3rd) — classic centre-of-mass symbol
  const d = ctx.doc;
  d.save();
  d.moveTo(x, y).lineTo(x + r, y).bezierCurveTo(x + r, y - r * 0.552, x + r * 0.552, y - r, x, y - r).closePath().fill(color);
  d.moveTo(x, y).lineTo(x - r, y).bezierCurveTo(x - r, y + r * 0.552, x - r * 0.552, y + r, x, y + r).closePath().fill(color);
  d.restore();
}

/* ------------------------------------------------------------------ north arrow & scale bar */

export function drawNorthArrow(ctx: ReportContext, x: number, y: number, size = 26) {
  const d = ctx.doc;
  const h = size, w = size * 0.32;
  // half-filled arrow
  d.save();
  ctx.pen(LW.fine, C.ink);
  d.polygon([x, y - h / 2], [x + w, y + h / 2], [x, y + h * 0.28], [x - w, y + h / 2]).stroke();
  d.polygon([x, y - h / 2], [x, y + h * 0.28], [x - w, y + h / 2]).fill(C.ink);
  d.restore();
  ctx.font('condBold', T.small, C.ink);
  ctx.textMid('N', x - ctx.width('N') / 2, y - h / 2 - 6);
}

/** Alternating black/white scale bar. Returns width in pt. */
export function drawScaleBar(ctx: ReportContext, x: number, y: number, ptPerKm: number, totalKm: number, segments = 4, unitLabel = 'km') {
  const segKm = totalKm / segments;
  const segW = segKm * ptPerKm;
  const h = 3.2;
  for (let i = 0; i < segments; i++) {
    ctx.rect({ x: x + i * segW, y, w: segW, h }, LW.fine, C.ink, i % 2 ? C.paper : C.ink);
  }
  ctx.font('mono', T.micro, C.ink);
  for (let i = 0; i <= segments; i++) {
    const v = segKm * i;
    const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
    ctx.textMid(s, x + i * segW - ctx.width(s) / 2, y + h + 5.5);
  }
  ctx.font('cond', T.micro, C.ink2);
  ctx.textMid(unitLabel, x + segments * segW + 4, y + h / 2);
  // nautical mile companion scale
  const nmKm = 1.852;
  const nmStep = totalKm / nmKm > 10 ? 5 : 1;
  const nmTotal = Math.floor(totalKm / nmKm / nmStep) * nmStep;
  if (nmTotal >= 2) {
    const yy = y - 6;
    const px = (nm: number) => x + nm * nmKm * ptPerKm;
    ctx.line(x, yy, px(nmTotal), yy, LW.fine);
    for (let i = 0; i <= nmTotal; i += nmStep) ctx.line(px(i), yy - 2.5, px(i), yy, LW.fine);
    ctx.font('cond', T.micro, C.ink2);
    ctx.textMid(`${nmTotal} NM`, px(nmTotal) + 4, yy - 1);
  }
  return segments * segW;
}

/* ------------------------------------------------------------------ legend */

export function legendSwatch(ctx: ReportContext, it: LegendItem, x: number, yc: number, w = 18) {
  const s = it.style ?? {};
  const color = s.color ?? C.ink;
  switch (it.kind) {
    case 'line':
      ctx.line(x, yc, x + w, yc, s.lw ?? LW.medium, color, s.dash ?? null);
      if (it.marker) drawMarker(ctx, it.marker, x + w / 2, yc, 2.4, color, it.markerFill !== false);
      break;
    case 'arrow':
      drawVectorArrow(ctx, { x, y: yc }, { x: x + w, y: yc }, { lw: s.lw ?? LW.medium, color, dash: s.dash ?? null, head: 4.5 });
      break;
    case 'marker':
      drawMarker(ctx, it.marker ?? 'circle', x + w / 2, yc, 2.6, color, it.markerFill !== false);
      break;
    case 'area':
      ctx.rect({ x, y: yc - 4, w, h: 8 }, s.lw ?? LW.fine, color, it.fill ?? C.tint, s.dash ?? null);
      break;
    case 'hatch':
      ctx.fillRect({ x, y: yc - 4, w, h: 8 }, it.fill ?? C.paper);
      ctx.hatch({ x, y: yc - 4, w, h: 8 }, 2.2, LW.hair, color);
      ctx.rect({ x, y: yc - 4, w, h: 8 }, s.lw ?? LW.fine, color, undefined, s.dash ?? null);
      break;
  }
}

/** Vertical or multi-column legend. Returns height used. */
export function drawLegend(ctx: ReportContext, x: number, y: number, w: number, items: LegendItem[], o: { cols?: number; rowH?: number; title?: string } = {}) {
  const cols = o.cols ?? 1;
  const rowH = o.rowH ?? 11;
  let top = y;
  if (o.title) {
    ctx.font('condSemi', T.micro, C.ink3);
    ctx.textMid(o.title.toUpperCase(), x, y + 4, { cs: 0.4 });
    top += 10;
  }
  const colW = w / cols;
  items.forEach((it, i) => {
    const cx = x + (i % cols) * colW;
    const cy = top + Math.floor(i / cols) * rowH + rowH / 2;
    legendSwatch(ctx, it, cx, cy);
    ctx.font('cond', T.label, C.ink);
    ctx.textMid(it.label, cx + 23, cy);
  });
  return top - y + Math.ceil(items.length / cols) * rowH;
}

/* ------------------------------------------------------------------ stamps & badges */

/** Double-ruled status stamp. tone 'critical' uses the single critical accent. */
export function drawStatusStamp(ctx: ReportContext, b: Box, lines: string[], tone: 'ink' | 'critical' = 'ink') {
  const color = tone === 'critical' ? C.critical : C.ink;
  ctx.rect(b, LW.heavy, color);
  ctx.rect({ x: b.x + 2.2, y: b.y + 2.2, w: b.w - 4.4, h: b.h - 4.4 }, LW.hair, color);
  const lh = 11;
  const top = b.y + b.h / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => {
    ctx.font(i === 0 ? 'condBold' : 'condMedium', i === 0 ? 9 : T.label, color);
    ctx.textMid(l, b.x, top + i * lh, { w: b.w, align: 'center', cs: i === 0 ? 0.8 : 0.3 });
  });
}

const STATE_LABEL: Record<AssessmentState, string> = {
  SUPPORTED: 'SUPPORTED',
  AMBIGUOUS: 'AMBIGUOUS',
  INSUFFICIENTLY_CONSTRAINED: 'INSUFF. CONSTRAINED',
  NOT_ASSESSABLE: 'NOT ASSESSABLE',
};

/**
 * Assessment-state badge — distinguishable without colour:
 * SUPPORTED = solid fill; AMBIGUOUS = half-hatched; INSUFFICIENTLY_CONSTRAINED = dashed outline; NOT_ASSESSABLE = dotted outline, grey text.
 */
export function drawStateBadge(ctx: ReportContext, state: AssessmentState, x: number, yc: number, w = 74, h = 10) {
  const b = { x, y: yc - h / 2, w, h };
  ctx.font('condSemi', T.micro);
  const label = STATE_LABEL[state];
  switch (state) {
    case 'SUPPORTED':
      ctx.rect(b, LW.fine, C.ink, C.ink);
      ctx.font('condSemi', T.micro, C.paper);
      break;
    case 'AMBIGUOUS':
      ctx.hatch({ x: b.x, y: b.y, w: 9, h }, 2, LW.hair, C.ink);
      ctx.rect(b, LW.fine, C.ink);
      ctx.line(b.x + 9, b.y, b.x + 9, b.y + h, LW.fine);
      ctx.font('condSemi', T.micro, C.ink);
      ctx.textMid(label, b.x + 9, yc, { w: w - 9, align: 'center', cs: 0.3 });
      return;
    case 'INSUFFICIENTLY_CONSTRAINED':
      ctx.rect(b, LW.fine, C.ink, undefined, DASH.short);
      ctx.font('condSemi', T.micro, C.ink);
      break;
    case 'NOT_ASSESSABLE':
      ctx.rect(b, LW.medium, C.rule, undefined, DASH.dotted);
      ctx.font('condSemi', T.micro, C.ink3);
      break;
  }
  const cs = ctx.width(label, 0.3) > w - 4 ? 0 : 0.3;
  if (ctx.width(label, cs) > w - 4) ctx.font('condSemi', T.zone, state === 'NOT_ASSESSABLE' ? C.ink3 : state === 'SUPPORTED' ? C.paper : C.ink);
  ctx.textMid(label, b.x, yc, { w, align: 'center', cs });
}

const LEVEL_ORDER: QualityLevel[] = ['Unavailable', 'Low', 'Low-Medium', 'Medium', 'Medium-High', 'High'];
export const levelIndex = (l: QualityLevel) => LEVEL_ORDER.indexOf(l);
export const levelAbbr = (l: QualityLevel) =>
  ({ High: 'H', 'Medium-High': 'M-H', Medium: 'M', 'Low-Medium': 'L-M', Low: 'L', Unavailable: 'N/A' })[l];

/** Five-segment level gauge: filled cells = level. Readable in greyscale. */
export function drawLevelGauge(ctx: ReportContext, level: QualityLevel, x: number, yc: number, cellW = 6, h = 5.5) {
  const n = levelIndex(level);
  for (let i = 0; i < 5; i++) {
    const b = { x: x + i * (cellW + 1), y: yc - h / 2, w: cellW, h };
    ctx.rect(b, LW.hair, n === 0 ? C.grid : C.ink, i < n ? C.ink2 : C.paper);
  }
  return 5 * (cellW + 1) - 1;
}
