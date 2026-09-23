import type { ReportContext } from '../layout/ReportContext';
import { Flow } from '../layout/Flow';
import { drawMethodologyDiagram } from '../diagrams/MethodologyDiagram';

export function methodologySection(ctx: ReportContext) {
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: '15', sectionTitle: 'Methodology' });
  f.sectionHeader('Processing chain from SAR acquisition to response intelligence. Each step consumes the named inputs and produces a versioned output recorded in the provenance register (Section 14). Dashed input arrows denote external data; solid arrows denote products.');
  f.figure(f.room - 22, 'Analytical processing chain (IDEF0-style: input left, output right, control flow downward)', (b) => drawMethodologyDiagram(ctx, b, ctx.data.methodology));
}
