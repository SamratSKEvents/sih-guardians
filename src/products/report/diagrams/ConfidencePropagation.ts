import type { ConfidenceComponent } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { drawArrowHead, drawStateBadge } from '../components/Drafting';

/** Edge style encodes the upstream state, so propagation reads in greyscale. */
const edgeDash = (c: ConfidenceComponent) =>
  c.state === 'SUPPORTED' ? null : c.state === 'NOT_ASSESSABLE' ? DASH.dotted : DASH.dashed;

/**
 * Layered dependency graph of confidence components (layer = longest dependency chain).
 * A downstream conclusion cannot be more certain than its weakest input.
 */
export function drawConfidencePropagation(ctx: ReportContext, box: Box, comps: ConfidenceComponent[]) {
  const byId = new Map(comps.map((c) => [c.id, c]));
  const layer = new Map<string, number>();
  const depth = (c: ConfidenceComponent, seen = new Set<string>()): number => {
    if (layer.has(c.id)) return layer.get(c.id)!;
    if (seen.has(c.id)) return 0;
    seen.add(c.id);
    const deps = (c.dependsOn ?? []).map((id) => byId.get(id)).filter(Boolean) as ConfidenceComponent[];
    const v = deps.length ? 1 + Math.max(...deps.map((dd) => depth(dd, seen))) : 0;
    layer.set(c.id, v);
    return v;
  };
  comps.forEach((c) => depth(c));
  const nLayers = Math.max(...layer.values()) + 1;
  const cols = Array.from({ length: nLayers }, (_, i) => comps.filter((c) => layer.get(c.id) === i));

  const nodeW = 150, nodeH = 34;
  const colGap = (box.w - nLayers * nodeW) / Math.max(1, nLayers - 1);
  const pos = new Map<string, { x: number; y: number }>();
  const headH = 14;
  cols.forEach((col, i) => {
    const x = box.x + i * (nodeW + colGap);
    ctx.font('condSemi', T.micro, C.ink3);
    ctx.textMid(i === 0 ? 'INPUT COMPONENTS' : i === nLayers - 1 ? 'DERIVED CONCLUSION' : 'INTERMEDIATE', x, box.y + 4, { cs: 0.4 });
    const gap = (box.h - headH - col.length * nodeH) / (col.length + 1);
    col.forEach((c, j) => pos.set(c.id, { x, y: box.y + headH + gap * (j + 1) + nodeH * j }));
  });

  // edges first
  comps.forEach((c) => {
    const to = pos.get(c.id)!;
    const deps = c.dependsOn ?? [];
    deps.forEach((id, k) => {
      const from = pos.get(id);
      const src = byId.get(id);
      if (!from || !src) return;
      const x1 = from.x + nodeW, y1 = from.y + nodeH / 2;
      const x2 = to.x, y2 = to.y + nodeH * ((k + 1) / (deps.length + 1));
      const mx = x1 + (x2 - x1) * (0.35 + 0.1 * k);
      ctx.pen(src.state === 'SUPPORTED' ? LW.medium : LW.fine, C.ink, edgeDash(src));
      ctx.doc.moveTo(x1, y1).lineTo(mx, y1).lineTo(mx, y2).lineTo(x2 - 4, y2).stroke();
      ctx.doc.undash();
      drawArrowHead(ctx, { x: x2, y: y2 }, 0, 4.5);
    });
  });

  comps.forEach((c) => {
    const p = pos.get(c.id)!;
    const b = { x: p.x, y: p.y, w: nodeW, h: nodeH };
    ctx.rect(b, layer.get(c.id) === nLayers - 1 ? LW.heavy : LW.medium, C.ink, C.paper);
    ctx.fillRect({ x: b.x, y: b.y, w: 22, h: nodeH }, C.ink);
    ctx.font('monoMedium', T.label, C.paper);
    ctx.textMid(c.id, b.x, b.y + nodeH / 2, { w: 22, align: 'center' });
    ctx.font('condSemi', T.small, C.ink);
    ctx.textMid(c.name, b.x + 27, b.y + 9);
    ctx.font('monoMedium', T.label, C.ink);
    ctx.textMid(c.score > 0 ? c.score.toFixed(2) : '—', b.x + 27, b.y + 24);
    drawStateBadge(ctx, c.state, b.x + nodeW - 82, b.y + 24, 78, 10);
  });
}
