import { C, DASH, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { drawCell, drawRevisionBlock } from '../layout/Frame';
import { drawLeaderCallout, drawNorthArrow, drawScaleBar, drawStatusStamp } from '../components/Drafting';
import { MapView } from '../diagrams/MapView';
import { latLon, u, utc } from '../utils/units';

export function coverSection(ctx: ReportContext) {
  const d = ctx.data, md = d.metadata;
  const b = ctx.addPage({ orientation: 'portrait', kind: 'cover', sectionNo: '00', sectionTitle: 'Cover and document control' });
  const x = b.x, w = b.w;
  let y = b.y;

  // top line
  ctx.font('condSemi', T.label, C.ink2);
  ctx.textMid('TECHNICAL INCIDENT ASSESSMENT  ·  MARITIME OIL-SPILL INTELLIGENCE', x, y + 4, { cs: 0.8 });
  ctx.font('mono', T.label, C.ink2);
  const ref = `${md.documentRef}  REV ${md.revision}`;
  ctx.textMid(ref, x + w - ctx.width(ref), y + 4);
  y += 11;
  ctx.line(x, y, x + w, y, LW.heavy);
  y += 22;

  // title
  ctx.font('sansSemi', 26, C.ink);
  ctx.text(md.reportTitle, x, y, { w: w * 0.8, lineGap: -2 });
  y += ctx.height(md.reportTitle, { w: w * 0.8, lineGap: -2 }) + 4;
  ctx.font('cond', 10, C.ink2);
  ctx.text(md.reportSubtitle.toUpperCase(), x, y, { w, cs: 0.6 });
  y += 24;

  // incident strip
  const sh = 44;
  const cells: [string, string, number, any][] = [
    ['Incident ID', md.incidentId, 0.34, { font: 'monoMedium', size: 13.5 }],
    ['Area', md.area, 0.36, { font: 'condSemi', size: 10 }],
    ['Observation time (T0)', utc(md.observationTime), 0.3, { font: 'monoMedium', size: 9.5 }],
  ];
  let cx = x;
  cells.forEach(([l, v, f, o]) => {
    drawCell(ctx, { x: cx, y, w: w * f, h: sh }, l, v, o);
    cx += w * f;
  });
  ctx.rect({ x, y, w, h: sh }, LW.heavy);
  y += sh;
  if (ctx.demo) {
    ctx.fillRect({ x, y, w, h: 18 }, C.ink);
    ctx.font('condBold', 8.2, C.paper);
    ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA — NOT AN OPERATIONAL ASSESSMENT', x, y + 9, { w, align: 'center', cs: 1 });
    y += 18;
  }
  y += 14;

  // status stamp + status cells
  drawStatusStamp(ctx, { x, y, w: w * 0.58, h: 46 }, [md.statusBanner, `ASSESSMENT STATUS: ${md.assessmentStatus}`], 'critical');
  const sx = x + w * 0.58 + 10, sw = w * 0.42 - 10;
  drawCell(ctx, { x: sx, y, w: sw / 2, h: 23 }, 'Classification', md.classification, { font: 'condSemi' });
  drawCell(ctx, { x: sx + sw / 2, y, w: sw / 2, h: 23 }, 'Revision', `${md.revision} — ${md.revisionHistory[md.revisionHistory.length - 1].date}`, { font: 'mono' });
  drawCell(ctx, { x: sx, y: y + 23, w: sw / 2, h: 23 }, 'Generated', utc(md.generatedAt), {});
  drawCell(ctx, { x: sx + sw / 2, y: y + 23, w: sw / 2, h: 23 }, 'Document ref.', md.documentRef, {});
  y += 62;

  // particulars (left) + locator (right)
  const colW = w * 0.48;
  const mapW = w - colW - 14;
  const startY = y;
  ctx.font('condSemi', T.h2, C.ink);
  ctx.textMid('INCIDENT PARTICULARS', x, y + 4, { cs: 0.6 });
  ctx.line(x, y + 11, x + colW, y + 11, LW.medium);
  y += 16;
  const rows: [string, string][] = [
    ['Sub-area', md.subArea],
    ['Slick centroid (SG-01)', latLon(d.slick.centroid)],
    ['Sensor / mode', `${d.observation.sensor}, ${d.observation.mode.split(' ')[0]} ${d.observation.polarisation}`],
    ['Product', d.observation.productId],
    ['Feature classification', `${d.observation.detection.classification} (${d.observation.detection.confidence})`],
    ['Main-body area / length', `${u.km2(d.slick.mainBodyAreaKm2)} / ${u.km(d.slick.lengthKm)}`],
    ['Hindcast / forecast window', `${u.rel(d.environment.records[0].offsetH)} … ${u.rel(d.forecast.horizons[d.forecast.horizons.length - 1].horizonH)}`],
    ['Vessels analysed', `${d.aisCandidates.totalVesselsAnalysed} (AIS, ${d.aisCandidates.analysisWindowH} h window)`],
    ['Model chain', md.modelVersion],
    ['Prepared by', md.preparedBy],
  ];
  // bottom blocks are anchored to the frame; particulars + locator take the remaining height
  const disclaimer = `${ctx.demo ? 'This document was generated from fictional demonstration data to illustrate report structure and analytical method. All vessels, identifiers, measurements, checksums and locations are invented. ' : ''}${d.limitations.reviewStatement} Analytical support scores do not constitute a determination of responsibility.`;
  ctx.font('sans', T.label);
  const discH = ctx.height(disclaimer, { w, lineGap: 1.2 });
  const bottomH = 16 + 46 + Math.max(12 + md.distribution.length * 11, 11 * (2 + md.revisionHistory.length)) + 10 + 6 + discH;
  const sectionBottom = b.y + b.h - bottomH - 10;
  const valueW = colW * 0.6;
  const heights = rows.map(([, v]) => {
    ctx.font('sans', T.table);
    return ctx.height(v, { w: valueW }) + 8;
  });
  const spare = Math.max(0, (sectionBottom - y - heights.reduce((a, h) => a + h, 0)) / rows.length);
  rows.forEach(([k, v], i) => {
    const rh = heights[i] + spare;
    ctx.font('cond', T.table, C.ink2);
    ctx.textMid(k, x, y + rh / 2);
    ctx.font(/^[A-Z0-9_°.\s′/…T+−-]+$/.test(v) || /^\d/.test(v) ? 'mono' : 'sans', T.table, C.ink);
    ctx.text(v, x + colW * 0.4, y + rh / 2 - (heights[i] - 8) / 2 - 1, { w: valueW });
    y += rh;
    ctx.line(x, y, x + colW, y, LW.hair, C.grid);
  });
  y = sectionBottom;

  // locator
  const mx = x + colW + 14;
  ctx.font('condSemi', T.h2, C.ink);
  ctx.textMid('LOCATION — SCHEMATIC', mx, startY + 4, { cs: 0.6 });
  ctx.line(mx, startY + 11, mx + mapW, startY + 11, LW.medium);
  const mapBox = { x: mx + 12, y: startY + 22, w: mapW - 16, h: sectionBottom - startY - 36 };
  const mv = new MapView(ctx, mapBox, d.slick.centroid, { x0: -58, x1: 48, y0: -42, y1: 44 });
  mv.drawNeatline({ minorMin: 5, gridMin: 10 });
  mv.drawLand(d.forecast.coastline);
  mv.clip(() => {
    const ib = d.observation.imageBounds;
    ctx.pen(LW.fine, C.ink, DASH.dashed);
    mv.pathLL([{ lat: ib.north, lon: ib.west }, { lat: ib.north, lon: ib.east }, { lat: ib.south, lon: ib.east }, { lat: ib.south, lon: ib.west }], true).stroke();
    ctx.doc.undash();
    mv.pathLL(d.slick.outline, true).fill(C.ink);
  });
  const c = mv.ll(d.slick.centroid);
  drawLeaderCallout(ctx, c, { x: c.x - 34, y: c.y - 48 }, ['SG-01', u.km2(d.slick.mainBodyAreaKm2, 1)], { side: 'left', boxed: true });
  const nw = mv.ll({ lat: ctx.data.observation.imageBounds.north, lon: ctx.data.observation.imageBounds.west });
  ctx.font('condSemi', T.micro, C.ink);
  ctx.textMid('SAR FRAME', nw.x + 2, nw.y - 5);
  const coastLbl = mv.xy({ x: 40, y: -30 });
  ctx.fillRect({ x: coastLbl.x - 2, y: coastLbl.y - 5, w: 46, h: 10 }, C.paper);
  ctx.font('condSemi', T.micro, C.ink);
  ctx.textMid('LAND (SCH.)', coastLbl.x, coastLbl.y);
  drawNorthArrow(ctx, mapBox.x + 16, mapBox.y + 26, 22);
  ctx.fillRect({ x: mapBox.x + 4, y: mapBox.y + mapBox.h - 30, w: 130, h: 26 }, C.paper);
  drawScaleBar(ctx, mapBox.x + 10, mapBox.y + mapBox.h - 16, mv.scale, 40, 4);

  y += 10;
  // sign-off
  ctx.font('condSemi', T.h2, C.ink);
  ctx.textMid('DOCUMENT CONTROL', x, y + 4, { cs: 0.6 });
  ctx.line(x, y + 11, x + w, y + 11, LW.medium);
  y += 16;
  const sign: [string, string][] = [
    ['Prepared', md.preparedBy],
    ['Checked', md.checkedBy],
    ['Approved', md.approvedBy],
  ];
  const sw3 = w / 3;
  sign.forEach(([l, v], i) => {
    const bx = { x: x + i * sw3, y, w: sw3, h: 38 };
    drawCell(ctx, bx, l, v, { font: 'condSemi', size: 8 });
    ctx.line(bx.x + 6, y + 31, bx.x + sw3 * 0.62, y + 31, LW.hair, C.rule, DASH.dotted);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid('SIGNATURE', bx.x + 6, y + 35);
    ctx.line(bx.x + sw3 * 0.68, y + 31, bx.x + sw3 - 6, y + 31, LW.hair, C.rule, DASH.dotted);
    ctx.textMid('DATE', bx.x + sw3 * 0.68, y + 35);
  });
  y += 46;

  // distribution + revisions
  const half = w / 2 - 6;
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('DISTRIBUTION', x, y + 4, { cs: 0.4 });
  let dy = y + 12;
  md.distribution.forEach((s, i) => {
    ctx.font('mono', T.micro, C.ink2);
    ctx.textMid(String(i + 1).padStart(2, '0'), x, dy + 4);
    ctx.font('cond', T.small, C.ink);
    ctx.textMid(s, x + 14, dy + 4);
    dy += 11;
  });
  drawRevisionBlock(ctx, x + w - half, y, half, 11);
  y = Math.max(dy, y + 11 * (2 + md.revisionHistory.length)) + 10;

  ctx.line(x, y, x + w, y, LW.hair, C.rule);
  ctx.font('sans', T.label, C.ink2);
  ctx.text(disclaimer, x, y + 6, { w, lineGap: 1.2 });
}
