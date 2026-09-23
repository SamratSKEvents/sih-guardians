import { C, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawStateBadge, drawLevelGauge } from '../components/Drafting';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { drawSarFigure } from '../diagrams/SarFigure';
import { lat, lon, u, utc } from '../utils/units';

export function observationSection(ctx: ReportContext) {
  const d = ctx.data, ob = d.observation, s = d.slick;
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '03', sectionTitle: 'Satellite observation and slick analysis' });
  f.sectionHeader(
    `Dark elongated low-backscatter feature segmented in the ${ob.polarisation} scene of ${utc(ob.acquisitionTime)}. Overlay = vectorised detection mask SG-01; all dimensions are measured on the vector geometry, not the raster.`,
  );

  const imgW = f.w - 162 - 24;
  const ib = ob.imageBounds;
  const aspect = ((ib.east - ib.west) * 111.32 * Math.cos((s.centroid.lat * Math.PI) / 180)) / ((ib.north - ib.south) * 110.574);
  f.figure(imgW / aspect + 30, `SAR observation ${ob.productId.slice(-3)} with detection overlay SG-01 and measured geometry`, (b) => drawSarFigure(ctx, b), { note: 'ILLUSTRATIVE' });

  f.heading('Acquisition and measured geometry', 170);
  const colW = f.w / 2 - 8;
  const y0 = f.y;
  f.keyValues(
    [
      ['Platform / sensor', `${ob.platform}`],
      ['Mode / polarisation', `${ob.mode} / ${ob.polarisation}`],
      ['Product ID', ob.productId],
      ['Acquisition / processed', `${utc(ob.acquisitionTime)} / ${utc(ob.processingTime)}`],
      ['Orbit', `${ob.orbitDirection}, relative orbit ${ob.relativeOrbit}`],
      ['Pixel spacing / incidence', `${u.m(ob.pixelSpacingM)} / ${ob.incidenceAngleDeg[0].toFixed(1)}–${ob.incidenceAngleDeg[1].toFixed(1)}°`],
      ['Est. wind / mean damping', `${u.ms(ob.estimatedWindMs, 1)} / ${u.db(ob.detection.meanDampingDb)}`],
      ['Detection method', ob.detection.method],
    ],
    { w: colW, labelW: colW * 0.4, rowH: 12 },
  );
  const yL = f.y;
  f.y = y0;
  f.keyValues(
    [
      ['Centroid', `${lat(s.centroid.lat)}  ${lon(s.centroid.lon)}`],
      ['Area (main body / total)', `${u.km2(s.mainBodyAreaKm2)} / ${u.km2(s.areaKm2)}`],
      ['Perimeter (main body)', u.km(s.perimeterKm, 1)],
      ['Length (major axis)', u.km(s.lengthKm)],
      ['Mean / max. width', `${u.km(s.meanWidthKm)} / ${u.km(s.maxWidthKm)}`],
      ['Orientation θ major', `${u.bearing(s.orientationDeg)} (reciprocal ${u.bearing(s.orientationDeg - 180)})`],
      ['Elongation / compactness', `${u.num(s.elongationRatio, 1)} / ${u.num(s.compactnessIndex, 2)}`],
      ['Fragmented regions', `${s.fragmentCount} (1 main body + ${s.fragments.length} fragments)`],
    ],
    { x: f.x + colW + 16, w: colW, labelW: colW * 0.42, rowH: 12, mono: true },
  );
  f.y = Math.max(yL, f.y) + 6;

  f.heading('Observation quality and look-alike screening', 110);
  const oy = f.y;
  ctx.font('cond', T.small, C.ink2);
  ctx.textMid('Observation quality', f.x, oy + 5);
  const gw = drawLevelGauge(ctx, ob.observationQuality, f.x + 90, oy + 5);
  ctx.font('condSemi', T.small, C.ink);
  ctx.textMid(ob.observationQuality, f.x + 96 + gw, oy + 5);
  ctx.font('cond', T.small, C.ink2);
  ctx.textMid('Detection confidence', f.x + 210, oy + 5);
  const gw2 = drawLevelGauge(ctx, ob.detection.confidence, f.x + 300, oy + 5);
  ctx.font('condSemi', T.small, C.ink);
  ctx.textMid(`${ob.detection.confidence} (${ob.detection.confidenceScore.toFixed(2)})`, f.x + 306 + gw2, oy + 5);
  f.y += 14;
  f.para(ob.qualityNotes, { size: T.small, color: C.ink2 });
  drawEngineeringTable(f, {
    caption: 'Look-alike screening',
    rows: ob.detection.lookAlikeChecks,
    columns: [
      { header: 'Alternative explanation', w: 1.4, font: 'condMedium', value: (r) => r.check },
      { header: 'Screening result', w: 2, value: (r) => r.result },
      { header: 'State', w: 0.9, drawH: 10, draw: (c, r, b) => drawStateBadge(c, r.state, b.x + 4, b.y + b.h / 2, b.w - 8, 10) },
    ],
  });
}
