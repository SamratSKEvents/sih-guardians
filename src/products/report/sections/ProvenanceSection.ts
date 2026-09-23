import { C, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawEngineeringTable } from '../components/EngineeringTable';
import { utcShort } from '../utils/units';

/** Status tag readable without colour: VERIFIED solid, PARTIAL half, UNVERIFIED outline. */
function statusTag(ctx: ReportContext, status: string, x: number, yc: number, w: number) {
  const b = { x, y: yc - 5, w, h: 10 };
  if (status === 'VERIFIED') ctx.rect(b, LW.fine, C.ink, C.ink);
  else if (status === 'PARTIAL') {
    ctx.rect(b, LW.fine);
    ctx.hatch({ x, y: b.y, w: w / 2, h: 10 }, 2, LW.hair, C.ink);
  } else ctx.rect(b, LW.fine, C.ink, undefined, [2, 1.5]);
  ctx.font('condSemi', T.micro, status === 'VERIFIED' ? C.paper : C.ink);
  if (status === 'PARTIAL') {
    ctx.fillRect({ x: x + w / 2 - ctx.width(status) / 2 - 2, y: yc - 3.5, w: ctx.width(status) + 4, h: 7 }, C.paper);
    ctx.font('condSemi', T.micro, C.ink);
  }
  ctx.textMid(status, x, yc, { w, align: 'center' });
}

export function provenanceSection(ctx: ReportContext) {
  const pv = ctx.data.provenance;
  const f = new Flow(ctx, { orientation: 'landscape', kind: 'standard', sectionNo: '14', sectionTitle: 'Evidence and provenance' });
  f.sectionHeader('Chain of custody for every major input and derived product: origin, acquisition and processing time, content checksum, configuration version and the transformation applied. Any product whose checksum cannot be re-derived must be treated as unverified.');

  ctx.rect({ x: f.x, y: f.y, w: f.w, h: 18 }, LW.heavy, C.ink, C.tint);
  ctx.font('condBold', T.small, C.ink);
  ctx.textMid(pv.note.toUpperCase(), f.x, f.y + 9, { w: f.w, align: 'center', cs: 0.4 });
  f.y += 26;

  drawEngineeringTable(f, {
    caption: 'Provenance register',
    rows: pv.records,
    rowPad: 3.4,
    columns: [
      { header: 'Input / product', w: 0.8, font: 'condSemi', value: (r) => r.input },
      { header: 'Source', w: 1.05, font: 'cond', value: (r) => r.source },
      { header: 'Dataset ID', w: 1.05, font: 'mono', value: (r) => r.datasetId },
      { header: 'Acquired', unit: 'UTC', w: 0.72, font: 'mono', value: (r) => utcShort(r.acquisitionTime) },
      { header: 'Processed', unit: 'UTC', w: 0.72, font: 'mono', value: (r) => utcShort(r.processingTime) },
      { header: 'SHA-256 (demonstration value)', w: 2.05, drawH: 16, draw: (c, r, b) => {
        c.font('mono', T.micro, C.ink);
        c.text(r.sha256.slice(0, 32), b.x + 3, b.y + 3.4);
        c.text(r.sha256.slice(32), b.x + 3, b.y + 11.2);
      } },
      { header: 'Config', w: 0.72, font: 'mono', value: (r) => r.configVersion },
      { header: 'Transformation', w: 1.35, font: 'cond', value: (r) => r.transformation },
      { header: 'Status', w: 0.6, drawH: 10, draw: (c, r, b) => statusTag(c, r.status, b.x + 4, b.y + b.h / 2, b.w - 8) },
    ],
  });

  f.heading('Integrity notes', 60);
  const counts = ['VERIFIED', 'PARTIAL', 'UNVERIFIED'].map((s) => `${pv.records.filter((r) => r.status === s).length} ${s.toLowerCase()}`).join(' · ');
  f.list([
    `Register status: ${counts}. Partial = checksum verified but content incomplete (e.g. AIS gaps); unverified = source layer not re-derivable at report time.`,
    'Checksums are computed on the exact bytes consumed by each processing step; configuration versions pin model code and parameters so that every figure in this report can be regenerated.',
    'Full 64-character digests are repeated in Appendix E for transcription-free verification.',
  ], { size: T.small + 0.2, gap: 3 });
}
