/**
 * sitrep.pdf — same GUARDIANS/technical-report visual family (frame, title strips, drafting stamps, engineering
 * tables), laid out as a short operational briefing. Renders a SitrepDocument only; depends on font bytes, not files.
 */
import PDFDocument from 'pdfkit';
import { toBytes } from 'pdfkit/output';
import type { AssessmentState, DeltaKind, EvidenceClass, Level, SitrepDocument, Severity } from '../SitrepTypes';
import { KIND_ORDER } from '../analysis/SitrepDeltaEngine';
import { isState, levelLabel } from '../analysis/ConfidenceFormatter';
import { compass, fmt, utc } from '../utils/format';
import { shoreLine } from './MarkdownRenderer';
import {
  C, DASH, Flow, LW, PAGE, ReportContext, T,
  drawCell, drawEngineeringTable, drawLevelGauge, drawLogo, drawStateBadge, drawStatusStamp, drawTechnicalFrame,
  type Box, type FontBytes, type QualityLevel, type TechnicalIncidentReport,
} from './pdf/reportDesign';
import { drawCorridorMap, drawForecastSchematic, drawResourceTimeline, resourceTimelineHeight } from './pdf/SitrepVisuals';

/** ReportContext reads only `data.metadata.isDemonstrationData`; everything SITREP-specific lives on `sitrep`. */
class SitrepPdfContext extends ReportContext {
  readonly sitrep: SitrepDocument;
  constructor(doc: PDFKit.PDFDocument, sitrep: SitrepDocument, fonts: FontBytes) {
    super(doc, { metadata: { isDemonstrationData: sitrep.facts.demonstration } } as unknown as TechnicalIncidentReport, fonts);
    this.sitrep = sitrep;
  }
}

const FLASH_SITUATION = new Set(['Latest observation', 'Assessment', 'Location', 'Slick area', 'Length / width', 'Fragmentation']);
const QL: Record<Level, QualityLevel> = { HIGH: 'High', 'MEDIUM-HIGH': 'Medium-High', MEDIUM: 'Medium', 'LOW-MEDIUM': 'Low-Medium', LOW: 'Low', UNAVAILABLE: 'Unavailable' };
const p2 = (n: number) => String(n).padStart(2, '0');

export async function renderPdf(sitrep: SitrepDocument, fonts: FontBytes): Promise<Uint8Array> {
  const h = sitrep.facts.header;
  const doc = new PDFDocument({
    size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, font: fonts.sans as any, pdfVersion: '1.7', lang: 'en-IN', displayTitle: true,
    info: {
      Title: `${fmt.sitrepNo(Number(h.sitrepNo))} (${sitrep.variant}) — ${h.incidentId}`,
      Author: h.preparedBy,
      Subject: `${h.title}. ${h.reportingPeriod}.${sitrep.facts.demonstration ? ' DEMONSTRATION / ILLUSTRATIVE DATA.' : ''}`,
      Keywords: `SITREP, ${h.incidentId}, ${h.reportType}, ${h.lifecycle}`,
      Creator: h.modelVersion,
      Producer: 'PDFKit',
      CreationDate: new Date(h.generatedAt),
    },
  } as any);
  const output = toBytes(doc);
  const ctx = new SitrepPdfContext(doc, sitrep, fonts);
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: 'SR', sectionTitle: `${sitrep.variant} SITREP ${h.sitrepNo}` });
  body(ctx, f);
  finalize(ctx);
  doc.end();
  return output;
}

/* ================================================================== body */

function body(ctx: SitrepPdfContext, f: Flow) {
  const { facts: d, narrative: n, variant } = ctx.sitrep;
  const full = variant === 'FULL';
  let no = 0;
  const H = (title: string, keep = 60, note?: string) => heading(f, ++no, title, keep, note, full ? 7 : 4);

  titleBlock(ctx, f, !full);
  alertsBlock(ctx, f, full);

  H('Executive situation', 40);
  f.para(n.executiveSituation, { size: full ? 9 : 8.4, lineGap: full ? 2.2 : 1.6, gapAfter: 2 });

  H(d.changes.initial ? 'Changes' : `Changes since SITREP ${d.changes.previousSitrepNo}`, 40, d.changes.initial ? undefined : 'DETERMINISTIC COMPARISON');
  changesBlock(ctx, f);

  H('Current situation', 110);
  if (full) {
    drawEngineeringTable(f, {
      rows: d.currentSituation, rowPad: 1.5,
      columns: [
        { header: 'Item', w: 1, font: 'condMedium', value: (r) => r.label },
        { header: 'Value', w: 3, value: (r) => r.value },
        { header: 'Basis', w: 0.75, drawH: 9, draw: (c, r, b) => evidenceTag(c, r.evidence, b.x + 4, b.y + b.h / 2, b.w - 8) },
      ],
    });
  } else twoColumnFacts(ctx, f, d.currentSituation.filter((r) => FLASH_SITUATION.has(r.label)).map((r) => [r.label, r.value]));

  if (full) {
    H('Environmental conditions', 90, `ASSESSMENT: ${d.environment.assessment}`);
    twoColumnFacts(ctx, f, d.environment.rows.map((r) => [r.label, r.value]));

    H('Hindcast / likely source region', 90, 'INFERRED');
    f.para(n.hindcast, { size: T.body, gapAfter: 4 });
    if (d.hindcast.rows.length) twoColumnFacts(ctx, f, d.hindcast.rows.map((r) => [r.label, r.value]));
    if (d.hindcast.limitations.length) f.para(`Limitations: ${d.hindcast.limitations.join(' ')}`, { size: T.label, color: C.ink3 });

    const v = d.vessels;
    H('Vessel / source association', 80, v.aisAvailable ? `AIS COVERAGE ${fmt.pct(v.aisCoveragePct)} · ${v.vesselsScreened} SCREENED` : 'AIS NOT AVAILABLE');
    if (!v.aisAvailable) f.para('No AIS data are available for the analysis window. Vessel association has not been assessed.', { size: T.body });
    else if (!v.candidates.length) f.para('No candidate track reaches the relevance threshold.', { size: T.body });
    else {
      drawEngineeringTable(f, {
        rows: v.candidates, rowPad: 2.6, highlight: (_, i) => i === 0,
        columns: [
          { header: 'Candidate', w: 0.8, font: 'monoMedium', value: (r) => r.id },
          { header: 'Vessel type', w: 0.95, font: 'cond', value: (r) => r.vesselType },
          { header: 'Analytical support', unit: '0–100', w: 1, drawH: 7, draw: (c, r, b) => supportBar(c, r.supportScore, b) },
          { header: 'Key reason', w: 2.3, value: (r) => r.keyReason },
        ],
      });
    }
    f.ensure(20);
    ctx.rect({ x: f.x, y: f.y, w: f.w, h: 15 }, LW.medium);
    ctx.font('condSemi', T.small + 0.4, C.ink);
    ctx.textMid(n.vesselDisclaimer, f.x, f.y + 7.5, { w: f.w, align: 'center', cs: 0.2 });
    f.y += 19;
    if (v.aisAvailable) {
      ctx.font('cond', T.small, C.ink2);
      ctx.textMid('ATTRIBUTION STATE', f.x, f.y + 5);
      drawStateBadge(ctx, v.attributionState, f.x + 80, f.y + 5, 110, 10.5);
      if (v.omittedCount) {
        ctx.font('cond', T.label, C.ink3);
        ctx.textMid(`${v.omittedCount} lower-support track(s) not shown`, f.x + 200, f.y + 5);
      }
      f.y += 14;
    }

    H('Forward forecast', 100, 'MODELLED / PREDICTED — NOT OBSERVED');
    if (!d.forecast.available) f.para('Forecast: NOT AVAILABLE. Potential movement and exposure are unknown.', { size: T.body });
    else {
      drawEngineeringTable(f, {
        rows: d.forecast.horizons, rowPad: 2.6,
        columns: [
          { header: 'Horizon', w: 0.5, font: 'monoMedium', value: (r) => `+${r.horizonH} h` },
          { header: 'Valid', unit: 'UTC', w: 0.9, font: 'mono', value: (r) => utc(r.validAt).replace(' UTC', '') },
          { header: 'Forecast movement', w: 1.05, value: (r) => `${compass(r.directionDeg)} (${fmt.bearing(r.directionDeg)})` },
          { header: 'Uncertainty', w: 0.6, font: 'mono', align: 'right', value: (r) => `±${fmt.km(r.uncertaintyKm)}` },
          { header: 'P(shore)', w: 0.5, font: 'mono', align: 'right', value: (r) => fmt.prob(r.shorelineContactProbability) },
          { header: 'Primary concern', w: 1.2, value: (r) => r.primaryConcern },
          { header: 'Confidence', w: 0.85, drawH: 6, draw: (c, r, b) => gauge(c, r.confidence, b) },
        ],
      });
      f.para(`Issued ${utc(d.forecast.issuedAt)} · ${d.forecast.model}. ${n.forecastLabel}.`, { size: T.label, color: C.model, font: 'condMedium' });
    }

    const canMap = !!d.geometry.slickCentroid;
    const mapA = canMap && d.forecast.available && d.forecast.horizons.length > 0;
    const mapB = canMap && !!d.geometry.corridorPolygon;
    if (mapA || mapB) {
      f.gap(4);
      const caption = [mapA ? 'A — Observed slick and forecast drift' : '', mapB ? `${mapA ? 'B' : 'A'} — Source-support corridor and candidate tracks` : ''].filter(Boolean).join('  ·  ');
      f.figure(176, caption, (b) => {
        const gap = 14, w = mapA && mapB ? (b.w - gap) / 2 : b.w;
        const inset = (x: number): Box => ({ x: x + 5, y: b.y + 5, w: w - 10, h: b.h - 10 });
        if (mapA) drawForecastSchematic(ctx, inset(b.x), d);
        if (mapB) drawCorridorMap(ctx, inset(mapA ? b.x + w + gap : b.x), d);
      }, { note: 'SCHEMATIC — DEMONSTRATION GEOMETRY' });
    }
  }

  const res = d.impacts.resources;
  H(full ? 'Impact summary' : 'Priority resources', 60, 'POTENTIAL — NOT OBSERVED');
  if (!res.length) f.para('No resources within the forecast impact envelope.', { size: T.body });
  else {
    drawEngineeringTable(f, {
      rows: res, rowPad: 2.4, highlight: (r) => r.priority === 1,
      columns: [
        { header: 'Priority', w: 0.45, font: 'monoMedium', value: (r) => `P${r.priority}` },
        { header: 'Resource', w: 1.5, font: 'condMedium', value: (r) => r.name },
        { header: 'Est. exposure window', unit: 'from report time', w: 1.35, font: 'mono', value: (r) => (r.windowFromReportH ? `${fmt.hourRange([Math.max(0, r.windowFromReportH[0]), r.windowFromReportH[1]])} (${utc(r.exposureWindow!.start).slice(11, 16)}–${utc(r.exposureWindow!.end).slice(11)})` : 'NOT AVAILABLE') },
        { header: 'Sensitivity', w: 0.7, font: 'condSemi', value: (r) => r.sensitivity },
        { header: 'Assessment', w: 0.7, font: 'condSemi', value: (r) => r.exposure },
      ],
    });
    if (full && res.some((r) => r.windowFromReportH)) {
      const hgt = resourceTimelineHeight(res.filter((r) => r.windowFromReportH).length);
      f.figure(hgt, 'Estimated exposure windows of priority resources', (b) => drawResourceTimeline(ctx, b, d), { note: 'MODELLED' });
    }
  }
  f.para(shoreLine(d.impacts.shorelineImpactObserved).replace(/\*\*/g, ''), { size: T.small, font: 'condMedium', gapAfter: 0 });

  H(full ? 'Immediate priorities' : 'Immediate priorities', 50);
  actionsBlock(ctx, f, full);

  H(full ? 'Current information gaps' : 'Key information gaps', 40, 'WHAT IS NOT KNOWN');
  bulletColumns(ctx, f, d.gaps, full ? 2 : 2);

  H('Confidence / uncertainty', full ? 60 : 28, 'NO AGGREGATE SCORE');
  confidenceGrid(ctx, f, full ? 2 : 4);

  if (full) {
    H('Evidence basis', 70);
    evidenceBasis(ctx, f);
    H('Data provenance', 40, 'SUMMARY — DETAIL IN TECHNICAL REPORT');
    twoColumnFacts(ctx, f, d.provenance.map((p) => [p.label, p.value]));
  }

  if (full && n.demonstrationNotice) {
    f.gap(6);
    f.para(n.demonstrationNotice, { size: T.label, color: C.ink3, font: 'sansItalic', gapAfter: 0 });
  }
}

/* ================================================================== blocks */

function heading(f: Flow, no: number, title: string, keep: number, note: string | undefined, gap: number) {
  const { ctx } = f;
  f.gap(gap);
  f.ensure(17 + keep);
  ctx.font('monoMedium', 8, C.ink);
  ctx.textMid(p2(no), f.x, f.y + 6);
  ctx.font('condSemi', 9.2, C.ink);
  ctx.textMid(title.toUpperCase(), f.x + 20, f.y + 6, { cs: 0.55 });
  if (note) {
    ctx.font('condSemi', T.micro, C.ink3);
    ctx.textMid(note, f.x + f.w - ctx.width(note, 0.3), f.y + 6, { cs: 0.3 });
  }
  ctx.line(f.x, f.y + 13, f.x + f.w, f.y + 13, LW.hair, C.rule);
  ctx.line(f.x, f.y + 13, f.x + 14, f.y + 13, LW.heavy);
  f.y += 18;
}

function titleBlock(ctx: SitrepPdfContext, f: Flow, compact: boolean) {
  const { facts: d, variant } = ctx.sitrep;
  const h = d.header;
  const x = f.x, w = f.w;
  let y = f.y;
  ctx.font('condSemi', T.label, C.ink2);
  ctx.textMid('GUARDIANS  ·  MARITIME POLLUTION SITUATION REPORT', x, y + 4, { cs: 0.8 });
  ctx.font('mono', T.label, C.ink2);
  const ref = `${h.documentRef}  REV ${h.revision}`;
  ctx.textMid(ref, x + w - ctx.width(ref), y + 4);
  y += 11;
  ctx.line(x, y, x + w, y, LW.heavy);
  y += compact ? 8 : 12;

  ctx.font('sansSemi', compact ? 19 : 23, C.ink);
  const title = `SITREP ${h.sitrepNo}`;
  ctx.text(title, x, y);
  const tw = ctx.width(title);
  ctx.font('condSemi', compact ? 9 : 10, C.ink);
  ctx.textMid(`${variant} SITREP  ·  ${h.reportType}`, x + tw + 14, y + (compact ? 8 : 10), { cs: 0.6 });
  ctx.font('cond', T.small, C.ink2);
  ctx.textMid(h.region, x + tw + 14, y + (compact ? 19 : 22));
  const sw = 150, sh = compact ? 28 : 32;
  drawStatusStamp(ctx, { x: x + w - sw, y: y - 1, w: sw, h: sh }, [h.lifecycle, 'REPORT LIFECYCLE'], h.lifecycle === 'DRAFT' ? 'critical' : 'ink');
  y += sh + 6;

  const row = (cells: [string, string, number, any?][], rh: number) => {
    let cx = x;
    cells.forEach(([l, v, fr, o]) => {
      drawCell(ctx, { x: cx, y, w: w * fr, h: rh }, l, v, { size: 8, ...o });
      cx += w * fr;
    });
    y += rh;
  };
  const top = y;
  const rh = compact ? 22 : 25;
  row([
    ['SITREP No', `${h.sitrepNo} / REV ${h.revision}`, 0.14, { font: 'monoMedium', size: 9.5 }],
    ['Incident', h.incidentId, 0.22, { font: 'monoMedium', size: 9 }],
    ['Reporting period', h.reportingPeriod, 0.36, { font: 'monoMedium' }],
    ['Generated', utc(h.generatedAt), 0.28, {}],
  ], rh);
  row([
    ['Status', h.operationalStatus, 0.36, { font: 'condBold', size: 9 }],
    ['Prepared by', h.preparedBy, 0.28, { font: 'cond' }],
    ['Reviewed by', h.reviewedBy, 0.18, { font: 'cond' }],
    ['Classification', d.demonstration ? 'DEMONSTRATION DATA' : h.classification, 0.18, { font: 'condBold' }],
  ], rh);
  ctx.rect({ x, y: top, w, h: y - top }, LW.heavy);
  if (!compact) {
    drawCell(ctx, { x, y, w, h: 18 }, 'Distribution', h.distribution.join('  ·  '), { font: 'cond', size: 7.4 });
    y += 18;
  }
  if (d.demonstration) {
    ctx.fillRect({ x, y, w, h: 15 }, C.ink);
    ctx.font('condBold', 8, C.paper);
    ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA — NOT AN OPERATIONAL ASSESSMENT', x, y + 7.5, { w, align: 'center', cs: 1 });
    y += 15;
  }
  f.y = y + 6;
}

const SEVERITY_STYLE: Record<Severity, { fill: string; text: string; lw: number; dash: number[] | null }> = {
  CRITICAL: { fill: C.critical, text: C.paper, lw: LW.heavy, dash: null },
  WARNING: { fill: C.ink, text: C.paper, lw: LW.medium, dash: null },
  NOTICE: { fill: C.paper, text: C.ink2, lw: LW.fine, dash: DASH.short },
};

function alertsBlock(ctx: SitrepPdfContext, f: Flow, full: boolean) {
  // FLASH: notices are restated in the body, so only CRITICAL / WARNING get the alert block.
  const alerts = ctx.sitrep.facts.alerts.filter((a) => full || a.severity !== 'NOTICE');
  if (!alerts.length) return;
  const tagW = 62, pad = 4;
  const heights = alerts.map((a) => {
    ctx.font('sansMedium', T.small + 0.4);
    return Math.max(full ? 15 : 13.5, ctx.height(a.text, { w: f.w - tagW - 14 }) + 2 * pad);
  });
  f.ensure(heights.reduce((s, x) => s + x, 0) + 4);
  const top = f.y;
  const critical = alerts.some((a) => a.severity === 'CRITICAL');
  alerts.forEach((a, i) => {
    const s = SEVERITY_STYLE[a.severity], hgt = heights[i];
    const tagBox = { x: f.x + 3, y: f.y + 3, w: tagW, h: hgt - 6 };
    ctx.rect(tagBox, s.lw, a.severity === 'NOTICE' ? C.ink2 : s.fill, s.fill, s.dash);
    ctx.font('condBold', T.small, s.text);
    ctx.textMid(a.severity, tagBox.x, tagBox.y + tagBox.h / 2, { w: tagW, align: 'center', cs: 0.8 });
    ctx.font(a.severity === 'NOTICE' ? 'sans' : 'sansMedium', T.small + 0.4, a.severity === 'CRITICAL' ? C.critical : C.ink);
    const th = ctx.height(a.text, { w: f.w - tagW - 14 });
    ctx.text(a.text, f.x + tagW + 10, f.y + (hgt - th) / 2 + 0.5, { w: f.w - tagW - 14 });
    f.y += hgt;
    if (i < alerts.length - 1) ctx.line(f.x, f.y, f.x + f.w, f.y, LW.hair, C.grid);
  });
  ctx.rect({ x: f.x, y: top, w: f.w, h: f.y - top }, critical ? LW.heavy : LW.medium, critical ? C.critical : C.ink);
  f.y += 2;
}

function deltaTag(ctx: ReportContext, kind: DeltaKind, x: number, yc: number, w = 62, h = 11) {
  const b = { x, y: yc - h / 2, w, h };
  let color: string = C.ink;
  switch (kind) {
    case 'NEW': ctx.rect(b, LW.fine, C.ink, C.ink); color = C.paper; break;
    case 'CHANGED': ctx.rect(b, LW.medium, C.ink); break;
    case 'DEGRADED': ctx.hatch({ x: b.x, y: b.y, w: 10, h }, 2, LW.hair, C.ink); ctx.rect(b, LW.medium, C.ink); ctx.line(b.x + 10, b.y, b.x + 10, b.y + h, LW.fine); break;
    case 'RESOLVED': ctx.rect(b, LW.fine, C.ink, undefined, DASH.short); break;
    case 'UNCHANGED': ctx.rect(b, LW.medium, C.rule, undefined, DASH.dotted); color = C.ink3; break;
  }
  ctx.font('condBold', T.label, color);
  ctx.textMid(kind, b.x + (kind === 'DEGRADED' ? 10 : 0), yc, { w: w - (kind === 'DEGRADED' ? 10 : 0), align: 'center', cs: 0.5 });
}

function changesBlock(ctx: SitrepPdfContext, f: Flow) {
  const c = ctx.sitrep.facts.changes;
  if (c.initial) {
    f.ensure(22);
    drawStatusStamp(ctx, { x: f.x, y: f.y, w: f.w, h: 20 }, ['INITIAL SITREP — NO PRIOR REPORT AVAILABLE']);
    f.y += 24;
    return;
  }
  if (!c.deltas.length) {
    f.para('No reportable changes above threshold since the previous SITREP.', { size: T.body });
    return;
  }
  const ind = 72, size = T.small + 0.4;
  for (const kind of KIND_ORDER) {
    const items = c.deltas.filter((d) => d.kind === kind);
    if (!items.length) continue;
    ctx.font('sans', size);
    const first = ctx.height(items[0].text, { w: f.w - ind - 8, lineGap: 1.4 });
    f.ensure(first + 6);
    f.gap(2);
    deltaTag(ctx, kind, f.x, f.y + 5.5);
    items.forEach((d, i) => {
      ctx.font(d.significance === 'HIGH' ? 'sansMedium' : 'sans', size);
      const hgt = ctx.height(d.text, { w: f.w - ind - 8, lineGap: 1.4 });
      if (i) f.ensure(hgt + 2);
      ctx.doc.rect(f.x + ind, f.y + 3.6, 2.6, 2.6).fill(kind === 'UNCHANGED' ? C.ink3 : C.ink);
      ctx.font(d.significance === 'HIGH' ? 'sansMedium' : 'sans', size, kind === 'UNCHANGED' ? C.ink2 : C.ink);
      ctx.text(d.text, f.x + ind + 8, f.y, { w: f.w - ind - 8, lineGap: 1.4 });
      f.y += hgt + 2.4;
    });
    ctx.line(f.x + ind, f.y, f.x + f.w, f.y, LW.hair, C.faint);
  }
  f.y += 2;
}

function twoColumnFacts(ctx: ReportContext, f: Flow, rows: [string, string][]) {
  const half = Math.ceil(rows.length / 2), gap = 14, w = (f.w - gap) / 2;
  const y0 = f.y;
  const left = rows.slice(0, half), right = rows.slice(half);
  ctx.font('sans', T.table);
  const est = Math.max(...[left, right].map((col) => col.reduce((s, [, v]) => s + Math.max(13, ctx.height(v, { w: w * 0.58 - 8 }) + 5), 0)));
  f.ensure(est);
  const startY = f.y;
  f.keyValues(left, { w, labelW: w * 0.42 });
  const yL = f.y;
  f.y = startY;
  f.keyValues(right, { x: f.x + w + gap, w, labelW: w * 0.42 });
  f.y = Math.max(yL, f.y) + 4;
  void y0;
}

function evidenceTag(ctx: ReportContext, cls: EvidenceClass, x: number, yc: number, w: number, h = 9.5) {
  const b = { x, y: yc - h / 2, w, h };
  let color: string = C.ink;
  switch (cls) {
    case 'OBSERVED': ctx.rect(b, LW.fine, C.ink, C.ink); color = C.paper; break;
    case 'MODELLED': ctx.rect(b, LW.medium, C.model); color = C.model; break;
    case 'INFERRED': ctx.hatch({ x: b.x, y: b.y, w: 8, h }, 2, LW.hair, C.ink); ctx.rect(b, LW.fine, C.ink); ctx.line(b.x + 8, b.y, b.x + 8, b.y + h, LW.fine); break;
    case 'UNCONFIRMED': ctx.rect(b, LW.medium, C.rule, undefined, DASH.dotted); color = C.ink3; break;
  }
  ctx.font('condSemi', T.micro, color);
  const off = cls === 'INFERRED' ? 8 : 0;
  ctx.textMid(cls, b.x + off, yc, { w: w - off, align: 'center', cs: 0.3 });
}

function supportBar(ctx: ReportContext, score: number, b: Box) {
  const bw = b.w - 30, yc = b.y + b.h / 2;
  ctx.rect({ x: b.x + 4, y: yc - 3.5, w: bw, h: 7 }, LW.hair, C.rule, C.paper);
  ctx.fillRect({ x: b.x + 4, y: yc - 3.5, w: (bw * score) / 100, h: 7 }, C.ink2);
  ctx.font('monoMedium', T.table, C.ink);
  ctx.textMid(String(score), b.x + bw + 9, yc);
}

function gauge(ctx: ReportContext, level: Level, b: Box) {
  const gw = drawLevelGauge(ctx, QL[level], b.x + 4, b.y + b.h / 2, 4.5, 5);
  ctx.font('cond', T.label, C.ink);
  ctx.textMid(levelLabel(level), b.x + 8 + gw, b.y + b.h / 2);
}

function actionsBlock(ctx: SitrepPdfContext, f: Flow, full: boolean) {
  const actions = ctx.sitrep.facts.actions;
  const tagW = 50, ind = 18 + tagW + 8, size = T.small + 0.5;
  actions.forEach((a, i) => {
    ctx.font('sansMedium', size);
    const th = ctx.height(a.text, { w: f.w - ind, lineGap: 1.2 });
    const basis = `Basis: ${a.basis.join(', ')}`;
    ctx.font('mono', T.zone);
    const bh = full ? ctx.height(basis, { w: f.w - ind }) + 1.5 : 0;
    f.ensure(th + bh + 4);
    ctx.font('monoMedium', 8, C.ink);
    ctx.text(String(i + 1), f.x + 2, f.y + 0.5);
    const tb = { x: f.x + 18, y: f.y + 0.5, w: tagW, h: 9.5 };
    if (a.priority === 'IMMEDIATE') ctx.rect(tb, LW.fine, C.ink, C.ink);
    else ctx.rect(tb, LW.fine, a.priority === 'HIGH' ? C.ink : C.rule, undefined, a.priority === 'ROUTINE' ? DASH.dotted : null);
    ctx.font('condBold', T.micro, a.priority === 'IMMEDIATE' ? C.paper : C.ink);
    ctx.textMid(a.priority, tb.x, tb.y + tb.h / 2, { w: tagW, align: 'center', cs: 0.4 });
    ctx.font('sansMedium', size, C.ink);
    ctx.text(a.text, f.x + ind, f.y, { w: f.w - ind, lineGap: 1.2 });
    f.y += th + 1;
    if (full) {
      ctx.font('mono', T.zone, C.ink3);
      ctx.text(basis, f.x + ind, f.y, { w: f.w - ind });
      f.y += bh;
    }
    f.y += full ? 2 : 3;
  });
}

function bulletColumns(ctx: ReportContext, f: Flow, items: string[], cols: number) {
  const gap = 16, w = (f.w - gap * (cols - 1)) / cols, size = T.small + 0.3;
  const per = Math.ceil(items.length / cols);
  const colItems = Array.from({ length: cols }, (_, c) => items.slice(c * per, (c + 1) * per));
  ctx.font('sans', size);
  const heightOf = (xs: string[]) => xs.reduce((s, t) => s + ctx.height(t, { w: w - 10, lineGap: 1.2 }) + 3, 0);
  f.ensure(Math.max(...colItems.map(heightOf)));
  const y0 = f.y;
  let maxY = y0;
  colItems.forEach((xs, c) => {
    let y = y0;
    const x = f.x + c * (w + gap);
    xs.forEach((t) => {
      ctx.doc.rect(x + 1, y + 3.4, 2.6, 2.6).fill(C.ink);
      ctx.font('sans', size, C.ink);
      const hgt = ctx.text(t, x + 9, y, { w: w - 10, lineGap: 1.2 });
      y += hgt + 3;
    });
    maxY = Math.max(maxY, y);
  });
  f.y = maxY + 2;
}

function confidenceGrid(ctx: SitrepPdfContext, f: Flow, cols: number) {
  const rows = ctx.sitrep.facts.confidence;
  const gap = cols > 2 ? 8 : 16, w = (f.w - gap * (cols - 1)) / cols, rh = cols > 2 ? 13 : 15;
  const lw = cols > 2 ? 0.42 : 0.45;
  const per = Math.ceil(rows.length / cols);
  f.ensure(per * rh + 2);
  const y0 = f.y;
  rows.forEach((r, i) => {
    const c = Math.floor(i / per), k = i % per;
    const x = f.x + c * (w + gap), y = y0 + k * rh;
    ctx.line(x, y, x + w, y, k ? LW.hair : LW.medium, k ? C.grid : C.ink);
    ctx.font('condMedium', T.small, C.ink);
    ctx.textMid(r.label, x + 2, y + rh / 2);
    if (isState(r.value)) drawStateBadge(ctx, r.value as AssessmentState, x + w * lw, y + rh / 2, w * (1 - lw) - 4, 10);
    else gauge(ctx, r.value as Level, { x: x + w * lw - (cols > 2 ? 4 : 0), y, w: w * (1 - lw), h: rh });
    if (k === per - 1 || i === rows.length - 1) ctx.line(x, y + rh, x + w, y + rh, LW.medium);
  });
  f.y = y0 + per * rh + 4;
}

function evidenceBasis(ctx: SitrepPdfContext, f: Flow) {
  const eb = ctx.sitrep.facts.evidenceBasis;
  const tagW = 70, size = T.small + 0.3;
  (['OBSERVED', 'MODELLED', 'INFERRED', 'UNCONFIRMED'] as const).forEach((k) => {
    const text = eb[k].length ? eb[k].join('  ·  ') : '—';
    ctx.font('sans', size);
    const hgt = Math.max(13, ctx.height(text, { w: f.w - tagW - 10 }) + 4);
    f.ensure(hgt);
    evidenceTag(ctx, k, f.x, f.y + 6.5, tagW, 10);
    ctx.font('sans', size, k === 'UNCONFIRMED' ? C.ink2 : C.ink);
    ctx.text(text, f.x + tagW + 10, f.y + 2, { w: f.w - tagW - 10 });
    f.y += hgt;
    ctx.line(f.x, f.y, f.x + f.w, f.y, LW.hair, C.faint);
  });
  f.y += 3;
}

/* ================================================================== frame */

function finalize(ctx: SitrepPdfContext) {
  const { facts: d, variant } = ctx.sitrep;
  const h = d.header;
  const total = ctx.pages.length;
  const range = ctx.doc.bufferedPageRange();
  const W = PAGE.a4.w, Hh = PAGE.a4.h, fr = PAGE.frame;
  for (let i = 0; i < total; i++) {
    ctx.doc.switchToPage(range.start + i);
    drawTechnicalFrame(ctx, W, Hh);

    // header strip
    const hh = PAGE.headerH, x0 = fr, x1 = W - fr, y = fr;
    ctx.line(x0, y + hh, x1, y + hh, LW.medium);
    ctx.font('monoMedium', 8.5);
    ctx.textMid(h.sitrepNo, x0, y + hh / 2, { w: 34, align: 'center' });
    ctx.line(x0 + 34, y, x0 + 34, y + hh, LW.fine);
    ctx.font('condSemi', 7.6, C.ink);
    ctx.textMid(`GUARDIANS ${variant} SITREP  ·  ${h.reportType}${i ? '  (CONT.)' : ''}`, x0 + 42, y + hh / 2, { cs: 0.6 });
    const tagW = 150, refW = 150;
    ctx.line(x1 - tagW - refW, y, x1 - tagW - refW, y + hh, LW.fine);
    ctx.font('mono', T.label, C.ink2);
    ctx.textMid(`${h.documentRef} · REV ${h.revision}`, x1 - tagW - refW, y + hh / 2, { w: refW, align: 'center' });
    const tag = { x: x1 - tagW, y, w: tagW, h: hh };
    if (d.demonstration) {
      ctx.fillRect(tag, C.ink);
      ctx.font('condBold', 6.8, C.paper);
      ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA', tag.x, y + hh / 2, { w: tagW, align: 'center', cs: 0.35 });
    } else {
      ctx.line(tag.x, y, tag.x, y + hh, LW.fine);
      ctx.font('condBold', 6.8, C.ink);
      ctx.textMid(h.classification, tag.x, y + hh / 2, { w: tagW, align: 'center', cs: 0.35 });
    }

    // footer title strip
    const fh = PAGE.footerH, fy = Hh - fr - fh, inner = W - 2 * fr, logoW = 128, sheetW = 56, mid = inner - logoW - sheetW, rh = fh / 2;
    ctx.rect({ x: x0, y: fy, w: logoW, h: fh }, LW.fine);
    drawLogo(ctx, { x: x0 + 5, y: fy + 6, w: 24, h: 24 });
    ctx.font('condBold', 9, C.ink);
    ctx.textMid('GUARDIANS', x0 + 35, fy + 11, { cs: 1 });
    ctx.font('cond', T.zone, C.ink2);
    ctx.text(h.systemName, x0 + 35, fy + 17, { w: logoW - 39, lineGap: -0.5 });
    const row = (cells: [string, string, number, any?][], yy: number) => {
      let xx = x0 + logoW;
      for (const [l, v, fracW, o] of cells) {
        drawCell(ctx, { x: xx, y: yy, w: mid * fracW, h: rh }, l, v, o);
        xx += mid * fracW;
      }
    };
    row([
      ['Document ref.', h.documentRef, 0.3],
      ['Incident ID', h.incidentId, 0.26],
      ['Rev', String(h.revision), 0.08, { font: 'monoMedium', align: 'center' }],
      ['Classification', d.demonstration ? 'DEMONSTRATION DATA' : h.classification, 0.36, { font: 'condBold' }],
    ], fy);
    row([
      ['Generated', utc(h.generatedAt), 0.3],
      ['Reporting period', h.reportingPeriod, 0.46],
      ['Lifecycle', h.lifecycle, 0.24, { font: 'condSemi' }],
    ], fy + rh);
    const sb = { x: x0 + inner - sheetW, y: fy, w: sheetW, h: fh };
    ctx.rect(sb, LW.fine);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid('SHEET', sb.x + 3, fy + 5.2, { cs: 0.35 });
    ctx.font('monoMedium', 12, C.ink);
    ctx.textMid(p2(i + 1), sb.x, fy + 17, { w: sheetW, align: 'center' });
    ctx.font('mono', T.label, C.ink2);
    ctx.textMid(`OF ${p2(total)}`, sb.x, fy + 29, { w: sheetW, align: 'center' });
    ctx.rect({ x: x0, y: fy, w: inner, h: fh }, LW.heavy);
  }
}
