import { C, LW, T } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawStatusStamp } from '../components/Drafting';
import { drawEngineeringTable } from '../components/EngineeringTable';

export function limitationsSection(ctx: ReportContext) {
  const lim = ctx.data.limitations;
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '16', sectionTitle: 'Model assumptions and limitations' });
  f.sectionHeader('Assumptions adopted by the processing chain and the limitations that bound every conclusion in this document. These apply to all sections and must accompany any extract.');

  f.heading('Modelling assumptions', 80);
  f.list(lim.assumptions, { numbered: true, prefix: 'AS-', size: T.small + 0.4, gap: 4 });

  f.heading('Limitations', 120);
  drawEngineeringTable(f, {
    rows: lim.limitations,
    rowPad: 4,
    columns: [
      { header: 'Ref.', w: 0.35, font: 'monoMedium', value: (_r, i) => `L-${String(i + 1).padStart(2, '0')}` },
      { header: 'Limitation', w: 1.45, font: 'condSemi', value: (r) => r.title },
      { header: 'Effect on this assessment', w: 3.2, value: (r) => r.text },
    ],
  });

  if (lim.corroboration.length) {
    f.heading('Corroboration required before operational use', 120);
    drawEngineeringTable(f, {
      rows: lim.corroboration,
      rowPad: 3,
      columns: [
        { header: '', w: 0.2, drawH: 8, draw: (c, r, b) => {
          const s = 7, x = b.x + b.w / 2 - s / 2, y = b.y + b.h / 2 - s / 2;
          c.rect({ x, y, w: s, h: s }, LW.fine);
          if (r.status === 'CLOSED') c.line(x + 1.5, y + 3.5, x + 3, y + 5.5, 1) , c.line(x + 3, y + 5.5, x + 6, y + 1.5, 1);
          if (r.status === 'IN PROGRESS') c.fillRect({ x, y, w: s / 2, h: s }, C.ink2);
        } },
        { header: 'Action', w: 2.1, value: (r) => r.item },
        { header: 'Addresses', w: 2.1, font: 'cond', value: (r) => r.addresses },
        { header: 'Priority', w: 0.6, font: 'condSemi', value: (r) => r.priority.toUpperCase() },
        { header: 'Status', w: 0.7, font: 'mono', value: (r) => r.status },
      ],
    });
  }

  f.heading('Use restrictions', 90);
  f.ensure(60);
  drawStatusStamp(ctx, { x: f.x, y: f.y, w: f.w, h: 38 }, ['NOT FOR OPERATIONAL, LEGAL OR ENFORCEMENT USE WITHOUT EXPERT REVIEW', lim.reviewStatement.toUpperCase()], 'critical');
  f.y += 46;
  if (ctx.demo) {
    ctx.fillRect({ x: f.x, y: f.y, w: f.w, h: 18 }, C.ink);
    ctx.font('condBold', T.small, C.paper);
    ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA — NOT AN OPERATIONAL ASSESSMENT', f.x, f.y + 9, { w: f.w, align: 'center', cs: 0.8 });
    f.y += 26;
  }
  ctx.line(f.x, f.y, f.x + f.w, f.y, LW.hair, C.grid);
  f.y += 4;
}
