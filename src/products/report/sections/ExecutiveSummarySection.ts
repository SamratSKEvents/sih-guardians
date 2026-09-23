import { C, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawStateBadge, drawStatusStamp } from '../components/Drafting';
import { drawDataBlock } from '../components/MetricBlock';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { u, utc } from '../utils/units';

export function executiveSummarySection(ctx: ReportContext) {
  const d = ctx.data, md = d.metadata;
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '02', sectionTitle: 'Executive technical summary' });
  f.sectionHeader();

  drawStatusStamp(ctx, { x: f.x, y: f.y, w: f.w, h: 38 }, [md.statusBanner, `${md.assessmentStatus}  ·  ${md.incidentId}  ·  T0 ${utc(md.observationTime)}${ctx.demo ? '  ·  DEMONSTRATION DATA' : ''}`], 'critical');
  f.y += 46;

  const top = d.aisCandidates.candidates[0];
  const fc24 = d.forecast.horizons[d.forecast.horizons.length - 1];
  drawDataBlock(ctx, { x: f.x, y: f.y, w: f.w, h: 44 }, [
    { label: 'Main-body area', value: d.slick.mainBodyAreaKm2.toFixed(1), unit: 'km²' },
    { label: 'Max. length', value: d.slick.lengthKm.toFixed(2), unit: 'km' },
    { label: 'Orientation', value: u.bearing(d.slick.orientationDeg), note: 'major axis, true' },
    { label: 'Vessels analysed', value: String(d.aisCandidates.totalVesselsAnalysed), note: `${d.aisCandidates.analysisWindowH} h AIS window` },
    { label: 'Highest support', value: String(top.score), unit: '/100', note: `${top.vesselName} — not attribution` },
    { label: 'Shore contact', value: (fc24.shorelineContactProbability * 100).toFixed(0), unit: '%', note: `by ${u.hours(fc24.horizonH, true)} (ensemble)` },
  ]);
  f.y += 52;

  f.heading('Key incident parameters', 200);
  const params: [string, string, string][] = [
    ['Observation', `${d.observation.platform}`, `${d.observation.mode}, ${d.observation.polarisation}`],
    ['Observation time (T0)', utc(d.observation.acquisitionTime), `${d.observation.orbitDirection}, rel. orbit ${d.observation.relativeOrbit}`],
    ['Feature classification', `${d.observation.detection.classification}`, `Detection confidence ${d.observation.detection.confidence} (${d.observation.detection.confidenceScore.toFixed(2)})`],
    ['Slick area', `${u.km2(d.slick.mainBodyAreaKm2)} main body; ${u.km2(d.slick.areaKm2)} total`, `${d.slick.fragmentCount} regions incl. main body`],
    ['Maximum length / mean width', `${u.km(d.slick.lengthKm)} / ${u.km(d.slick.meanWidthKm)}`, 'Mean width = area ÷ length'],
    ['Orientation (major axis)', `${u.bearing(d.slick.orientationDeg)} / ${u.bearing(d.slick.orientationDeg - 180)}`, 'Trailing edge towards SW'],
    ['Hindcast window', `${Math.abs(d.environment.records[0].offsetH)} h`, `${d.hindcast.particleCount.toLocaleString('en-GB')} particles, windage ${d.hindcast.windagePct.toFixed(1)} %`],
    ['Most supported release interval', `${u.rel(d.releaseAssessment.strongest.fromH)} to ${u.rel(d.releaseAssessment.strongest.toH)}`, `Alternate ${u.rel(d.releaseAssessment.alternate.fromH)} to ${u.rel(d.releaseAssessment.alternate.toH)}`],
    ['Candidate vessels analysed', `${d.aisCandidates.totalVesselsAnalysed}`, `${d.aisCandidates.candidates.length} within ${u.km(d.aisCandidates.searchRadiusKm, 0)} screening radius`],
    ['Highest-supported candidate', `${top.vesselName} (${top.type})`, `Support score ${top.score}/100 — analytical, not attribution`],
    ['Forecast horizon', `+${fc24.horizonH} h`, `Uncertainty radius ${u.km(fc24.uncertaintyRadiusKm, 1)} at +${fc24.horizonH} h`],
    ['Environmental threat', `${d.impacts.resources[0].name}; ${d.impacts.resources[1].name}`, `Earliest est. arrival +${d.impacts.resources[0].estimatedArrivalH} h`],
  ];
  drawEngineeringTable(f, {
    rows: params,
    columns: [
      { header: 'Parameter', w: 1.05, font: 'condMedium', value: (r) => r[0] },
      { header: 'Value (illustrative)', w: 1.35, value: (r) => r[1] },
      { header: 'Basis / qualifier', w: 1.3, font: 'cond', value: (r) => r[2] },
    ],
    rowPad: 2.8,
  });

  // findings + component states side by side
  f.heading('Principal findings', 160);
  const colW = f.w * 0.62;
  const y0 = f.y;
  f.list(d.keyFindings, { numbered: true, w: colW, size: T.small + 0.3, gap: 5 });
  const yL = f.y;
  const rx = f.x + colW + 16, rw = f.w - colW - 16;
  let ry = y0;
  ctx.font('condSemi', T.micro, C.ink3);
  ctx.textMid('ASSESSMENT COMPONENT STATES', rx, ry + 3, { cs: 0.4 });
  ry += 10;
  d.confidence.components.forEach((c) => {
    ctx.line(rx, ry, rx + rw, ry, LW.hair, C.grid);
    ctx.font('cond', T.small, C.ink);
    ctx.textMid(c.name, rx, ry + 8);
    drawStateBadge(ctx, c.state, rx + rw - 82, ry + 8, 82, 10.5);
    ry += 16;
  });
  ctx.line(rx, ry, rx + rw, ry, LW.medium);
  f.y = Math.max(yL, ry + 6);

  f.heading('Recommended next actions', 60);
  f.list(d.recommendedActions, { numbered: true, prefix: 'A', size: T.small + 0.3, gap: 4 });
  f.para(`${d.limitations.reviewStatement} Support scores indicate spatio-temporal compatibility only and are not a determination of responsibility.`, { size: T.label, color: C.ink3, font: 'sansItalic' });
}
