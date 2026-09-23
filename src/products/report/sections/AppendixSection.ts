import { C, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawCompactTable, drawEngineeringTable } from '../components/EngineeringTable';
import { lat, lon, u, utcShort } from '../utils/units';

export function appendixSection(ctx: ReportContext) {
  const d = ctx.data;
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: 'APP', sectionTitle: 'Technical appendices' });
  const appendix = (letter: string, title: string, keep: number) => {
    f.gap(8);
    f.ensure(40 + keep);
    ctx.registerToc(letter, `Appendix ${letter} — ${title}`);
    ctx.rect({ x: f.x, y: f.y, w: 22, h: 18 }, 0.9, C.ink, C.ink);
    ctx.font('monoMedium', 10, C.paper);
    ctx.textMid(letter, f.x, f.y + 9, { w: 22, align: 'center' });
    ctx.font('condSemi', 11, C.ink);
    ctx.textMid(`APPENDIX ${letter} — ${title.toUpperCase()}`, f.x + 30, f.y + 9.5, { cs: 0.6 });
    ctx.line(f.x + 22, f.y + 18, f.x + f.w, f.y + 18, 0.9);
    f.y += 26;
  };

  // A — slick geometry
  const s = d.slick;
  appendix('A', 'Detailed slick geometry', 360);
  f.para(`Boundary vertices of detection mask ${s.observationId} (main body, ${s.outline.length} vertices, WGS-84). Fragments: ${s.fragments.map((fr, i) => `F${i + 1} ${fr.length} vertices`).join(', ')}.`, { size: T.small, color: C.ink2 });
  const per = Math.ceil(s.outline.length / 3);
  const colW = (f.w - 16) / 3;
  const rows = s.outline.map((p, i) => [String(i + 1).padStart(3, '0'), lat(p.lat, 3), lon(p.lon, 3)]);
  const rh = 9.6;
  f.ensure(per * rh + 26);
  const top = f.y;
  let hMax = 0;
  for (let k = 0; k < 3; k++) {
    hMax = Math.max(hMax, drawCompactTable(ctx, f.x + k * (colW + 8), top, colW, `Vertices ${k * per + 1}–${Math.min(s.outline.length, (k + 1) * per)}`, [{ header: 'No.', w: 0.45 }, { header: 'Latitude', w: 1.1 }, { header: 'Longitude', w: 1.2 }], rows.slice(k * per, (k + 1) * per), rh));
  }
  f.y = top + hMax + 8;

  // B — environmental forcing
  appendix('B', 'Environmental forcing records', 120);
  drawEngineeringTable(f, {
    rows: d.environment.records,
    rowPad: 1.9,
    fontSize: T.label + 0.2,
    columns: [
      { header: 'Hour', w: 0.55, font: 'monoMedium', value: (r) => u.rel(r.offsetH) },
      { header: 'Time', unit: 'UTC', w: 0.9, font: 'mono', value: (r) => utcShort(r.time) },
      { header: 'Wind', unit: 'm/s', w: 0.5, font: 'mono', align: 'right', value: (r) => r.windMs.toFixed(1) },
      { header: 'Wind from', unit: '°', w: 0.55, font: 'mono', align: 'right', value: (r) => u.bearing(r.windFromDeg) },
      { header: 'Current', unit: 'm/s', w: 0.55, font: 'mono', align: 'right', value: (r) => r.currentMs.toFixed(2) },
      { header: 'Current to', unit: '°', w: 0.55, font: 'mono', align: 'right', value: (r) => u.bearing(r.currentToDeg) },
      { header: 'Hs', unit: 'm', w: 0.45, font: 'mono', align: 'right', value: (r) => r.waveHsM.toFixed(2) },
      { header: 'SST', unit: '°C', w: 0.45, font: 'mono', align: 'right', value: (r) => r.seaTempC.toFixed(1) },
    ],
  });
  f.para(`${d.environment.conventions} Wind: ${d.environment.windSource}. Current: ${d.environment.currentSource}.`, { size: T.label, color: C.ink3 });

  // C — AIS candidates
  appendix('C', 'AIS candidate table', 120);
  drawEngineeringTable(f, {
    rows: d.aisCandidates.candidates,
    rowPad: 2.2,
    fontSize: T.label + 0.2,
    columns: [
      { header: 'Cand.', w: 0.45, font: 'monoMedium', value: (r) => r.candidateId },
      { header: 'MMSI (dummy)', w: 0.8, font: 'mono', value: (r) => r.mmsi },
      { header: 'Type', w: 1, font: 'cond', value: (r) => r.type },
      { header: 'LOA', unit: 'm', w: 0.38, font: 'mono', align: 'right', value: (r) => (r.lengthM ? String(r.lengthM) : '—') },
      { header: 'Sp', w: 0.3, font: 'mono', align: 'right', value: (r) => String(r.components.spatial) },
      { header: 'Te', w: 0.3, font: 'mono', align: 'right', value: (r) => String(r.components.temporal) },
      { header: 'Di', w: 0.3, font: 'mono', align: 'right', value: (r) => String(r.components.direction) },
      { header: 'Tr', w: 0.3, font: 'mono', align: 'right', value: (r) => String(r.components.trajectory) },
      { header: 'Ev', w: 0.3, font: 'mono', align: 'right', value: (r) => String(r.components.evidence) },
      { header: 'Score', w: 0.42, font: 'monoMedium', align: 'right', value: (r) => String(r.score) },
      { header: 'CPA', unit: 'km', w: 0.4, font: 'mono', align: 'right', value: (r) => r.closestApproachKm.toFixed(1) },
      { header: 'Gap', unit: 'min', w: 0.38, font: 'mono', align: 'right', value: (r) => String(r.maxAisGapMin) },
      { header: 'Posns.', w: 0.45, font: 'mono', align: 'right', value: (r) => (r.track ? String(r.track.length) : 'n/a') },
      { header: 'State', w: 1.05, font: 'cond', value: (r) => r.state.replace('_', ' ') },
    ],
  });
  f.para('Sp spatial · Te temporal · Di direction · Tr trajectory · Ev evidence quality (component scores 0–100).', { size: T.label, color: C.ink3 });

  // D — model parameters
  appendix('D', 'Trajectory model parameters', 100);
  drawEngineeringTable(f, {
    rows: d.hindcast.parameters,
    rowPad: 2.4,
    columns: [
      { header: 'Parameter', w: 1.2, font: 'condSemi', value: (r) => r.name },
      { header: 'Value', w: 1.2, font: 'mono', value: (r) => r.value },
      { header: 'Note', w: 2, value: (r) => r.note },
    ],
  });
  f.para(`Hindcast: ${d.hindcast.model}. Forecast: ${d.forecast.model}.`, { size: T.label, color: C.ink3 });

  // E — checksums
  appendix('E', 'Data provenance checksums', 100);
  f.para(d.provenance.note, { size: T.small, font: 'condSemi' });
  drawEngineeringTable(f, {
    rows: d.provenance.records,
    rowPad: 2.4,
    fontSize: 6.4,
    columns: [
      { header: 'Dataset ID', w: 1.1, font: 'mono', value: (r) => r.datasetId },
      { header: 'SHA-256', w: 3.1, font: 'mono', value: (r) => r.sha256 },
      { header: 'Config', w: 0.7, font: 'mono', value: (r) => r.configVersion },
    ],
  });

  // F — glossary
  appendix('F', 'Glossary', 100);
  drawEngineeringTable(f, {
    rows: [...d.glossary].sort((a, b) => a.term.localeCompare(b.term)),
    rowPad: 2.4,
    columns: [
      { header: 'Term', w: 1, font: 'condSemi', value: (r) => r.term },
      { header: 'Definition', w: 4, value: (r) => r.definition },
    ],
  });
  f.gap(10);
  f.ensure(12);
  ctx.font('condSemi', T.label, C.ink3);
  ctx.textMid(`END OF DOCUMENT  ·  ${d.metadata.documentRef}  REV ${d.metadata.revision}`, f.x, f.y + 4, { w: f.w, align: 'center', cs: 1.2 });
  f.y += 10;
}
