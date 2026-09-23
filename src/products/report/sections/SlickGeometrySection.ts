import { C, DASH, LW } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { drawSlickGeometryPlate } from '../diagrams/SlickGeometryDiagram';

export function slickGeometrySection(ctx: ReportContext) {
  const s = ctx.data.slick;
  const box = ctx.addPage({
    orientation: 'landscape',
    kind: 'plate',
    sectionNo: '04',
    sectionTitle: 'Slick geometry plate',
    plate: {
      drawingNo: `SG-01 / ${ctx.data.metadata.incidentId.split('-').pop()}`,
      title: `Slick geometry — observation ${s.observationId}`,
      subtitle: 'Plan, width profile and schedules measured on the vectorised detection mask.',
      scale: 'AS SHOWN',
      legend: [
        { label: 'Observed boundary', kind: 'line', style: { lw: 1.3 } },
        { label: 'Slick interior (section hatch)', kind: 'hatch', style: { lw: LW.fine, color: C.ink } },
        { label: 'Centre line / axis', kind: 'line', style: { lw: LW.fine, dash: DASH.dashDot } },
        { label: 'Oriented bounding box', kind: 'line', style: { lw: LW.fine, dash: DASH.dashed, color: C.ink3 } },
        { label: 'Dimension', kind: 'arrow', style: { lw: LW.fine } },
        { label: 'Boundary vertex (see App. A)', kind: 'marker', marker: 'circle', markerFill: false },
        { label: 'Mean width envelope', kind: 'line', style: { lw: LW.fine, dash: DASH.dashed, color: C.ink2 } },
      ],
      notes: [
        'Dimensions measured on vector geometry, not on raster pixels.',
        'Axes from second moments of boundary vertices; L and W are extents along those axes.',
        'θ measured clockwise from true north to the trailing (tail) end.',
        'Fragments F1–F3 are detached regions included in total area only.',
        'Demonstration geometry — not an operational measurement.',
      ],
    },
  });
  drawSlickGeometryPlate(ctx, box);
}
