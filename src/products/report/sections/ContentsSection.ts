import { C, DASH, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawLevelGauge, drawStateBadge, legendSwatch, type LegendItem } from '../components/Drafting';
import type { AssessmentState } from '../ReportTypes';

export function contentsSection(ctx: ReportContext) {
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '01', sectionTitle: 'Contents and conventions' });
  f.sectionHeader('Sheet register for this document, followed by the graphical and numerical conventions used on every sheet. Reviewers should read the conventions before interpreting any figure.');

  // Sheet register is filled in the finalize pass, once page numbers are known.
  f.heading('Sheet register', 300);
  const top = f.y, x = f.x, w = f.w;
  const rowH = 12;
  const reserve = 22 * rowH + 16;
  const pageIndex = ctx.pages.length - 1;
  ctx.onFinalize(() => {
    const range = ctx.doc.bufferedPageRange();
    ctx.doc.switchToPage(range.start + pageIndex);
    let y = top;
    ctx.fillRect({ x, y, w, h: 13 }, C.tint);
    ctx.line(x, y, x + w, y, LW.heavy);
    ctx.font('condSemi', T.label, C.ink);
    ctx.textMid('SEC.', x + 3, y + 6.5);
    ctx.textMid('TITLE', x + 40, y + 6.5);
    ctx.textMid('SHEET TYPE', x + w - 150, y + 6.5);
    ctx.textMid('SHEET', x + w - 38, y + 6.5);
    y += 13;
    ctx.line(x, y, x + w, y, LW.medium);
    ctx.toc
      .filter((t) => t.no !== '00' && t.no !== 'APP')
      .forEach((t) => {
        const meta = ctx.pages[t.page - 1];
        const sheets = ctx.pages.filter((p) => p.sectionNo === t.no).length;
        const type = `${meta.kind === 'plate' ? 'DRAWING PLATE' : 'TEXT / TABLES'} · ${meta.orientation === 'landscape' ? 'A4 L' : 'A4 P'}${sheets > 1 ? ` · ${sheets} sh.` : ''}`;
        const appendix = /^[A-Z]$/.test(t.no);
        ctx.font('monoMedium', T.small, C.ink);
        ctx.textMid(appendix ? `APP ${t.no}` : t.no, x + 3, y + rowH / 2);
        ctx.font(appendix ? 'sans' : 'sansMedium', T.small, C.ink);
        const title = t.title;
        ctx.textMid(title, x + 40, y + rowH / 2);
        const tw = ctx.width(title);
        ctx.line(x + 44 + tw, y + rowH / 2 + 2, x + w - 156, y + rowH / 2 + 2, LW.hair, C.rule, DASH.dotted);
        ctx.font('cond', T.label, C.ink2);
        ctx.textMid(type, x + w - 150, y + rowH / 2);
        ctx.font('monoMedium', T.small, C.ink);
        const pg = String(t.page).padStart(2, '0');
        ctx.textMid(pg, x + w - 6 - ctx.width(pg), y + rowH / 2);
        y += rowH;
        ctx.line(x, y, x + w, y, LW.hair, C.faint);
      });
    ctx.line(x, y, x + w, y, LW.medium);
  });
  f.y = top + reserve;

  f.heading('Line and symbol conventions', 150);
  const conv: [LegendItem, string][] = [
    [{ label: '', kind: 'line', style: { lw: 1.2 } }, 'OBSERVED — geometry measured from the SAR observation (solid, heavy).'],
    [{ label: '', kind: 'line', style: { lw: 1, color: C.model, dash: DASH.dashed } }, 'MODELLED / PREDICTED — model output (dashed, model blue). Never used for observations.'],
    [{ label: '', kind: 'line', style: { lw: 0.8, dash: DASH.dotted } }, 'UNCERTAIN / INFERRED — gaps, extrapolation, low-confidence geometry (dotted).'],
    [{ label: '', kind: 'line', style: { lw: 0.5, dash: DASH.dashDot, color: C.ink2 } }, 'CONSTRUCTION / CENTRE LINE — axes, references, bounding geometry (chain line).'],
    [{ label: '', kind: 'hatch', style: { lw: 0.35 } }, 'SUPPORT / UNCERTAINTY AREA — hatched region; hatch density does not encode probability.'],
    [{ label: '', kind: 'area', fill: C.ink2 }, 'SELECTED INTERVAL / HIGHEST SUPPORT — solid dark fill.'],
  ];
  const cw = w / 2 - 8;
  const startY = f.y;
  conv.forEach(([it, text], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const cx = x + col * (cw + 16), cy = startY + row * 24;
    legendSwatch(ctx, it, cx, cy + 8, 26);
    ctx.font('sans', T.small, C.ink);
    ctx.text(text, cx + 34, cy + 2, { w: cw - 36, lineGap: 0.8 });
  });
  f.y = startY + Math.ceil(conv.length / 2) * 24 + 2;

  f.heading('Assessment states and confidence levels', 90);
  const states: [AssessmentState, string][] = [
    ['SUPPORTED', 'Available evidence is consistent and sufficient for the stated analytical conclusion.'],
    ['AMBIGUOUS', 'Evidence is compatible with more than one explanation; no preference can be justified.'],
    ['INSUFFICIENTLY_CONSTRAINED', 'Data exist but are too sparse, coarse or uncertain to constrain the result.'],
    ['NOT_ASSESSABLE', 'Required inputs are absent; no assessment is made.'],
  ];
  const sy = f.y;
  states.forEach(([s, text], i) => {
    const yy = sy + i * 17;
    drawStateBadge(ctx, s, x, yy + 6, 96, 11);
    ctx.font('sans', T.small, C.ink);
    ctx.textMid(text, x + 106, yy + 6);
  });
  f.y = sy + states.length * 17 + 4;
  const gy = f.y;
  ctx.font('cond', T.small, C.ink2);
  ctx.textMid('Level gauge (qualitative):', x, gy + 5);
  let gx = x + 110;
  (['High', 'Medium', 'Low', 'Unavailable'] as const).forEach((l) => {
    const gw = drawLevelGauge(ctx, l, gx, gy + 5);
    ctx.font('cond', T.small, C.ink);
    ctx.textMid(l, gx + gw + 5, gy + 5);
    gx += gw + 70;
  });
  f.y = gy + 18;

  f.heading('Units, reference systems and time', 60);
  f.keyValues([
    ['Time', 'UTC throughout. T0 = SAR acquisition time; T−n h / T+n h = hours before / after T0.'],
    ['Position', 'WGS-84 geographic, degrees and decimal minutes (DD°MM.mmm′). Maps: local tangent-plane projection, true scale.'],
    ['Direction', 'Degrees true, three digits. Wind: direction FROM. Current and drift: direction TOWARDS.'],
    ['Distance / area / speed', 'km (NM in brackets where navigational), km², m/s (vessel speed kn).'],
    ['Scores', '0–100 analytical support scores and 0–1 confidence values are relative indices, not probabilities of responsibility.'],
  ], { labelW: 120 });
}
