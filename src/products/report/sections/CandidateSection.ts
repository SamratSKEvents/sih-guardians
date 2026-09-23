import { C, DASH, LW } from '../ReportTheme';
import type { ReportContext } from '../layout/ReportContext';
import { drawCandidatePlate } from '../diagrams/VesselEvidenceDiagram';
import { u } from '../utils/units';

export function candidateSection(ctx: ReportContext) {
  const cand = ctx.data.aisCandidates.candidates[0];
  const box = ctx.addPage({
    orientation: 'landscape',
    kind: 'plate',
    sectionNo: '09',
    sectionTitle: `Candidate detail — ${cand.vesselName}`,
    plate: {
      drawingNo: `CD-${cand.candidateId.replace('V-', '')} / ${ctx.data.metadata.incidentId.split('-').pop()}`,
      title: `Candidate detail — ${cand.vesselName}`,
      subtitle: `${cand.type} · MMSI ${cand.mmsi} (dummy) · support ${cand.score}/100 · ${cand.state.replace('_', ' ')}`,
      scale: 'AS SHOWN',
      legend: [
        { label: `${cand.candidateId} AIS track`, kind: 'line', style: { lw: 1.6 }, marker: 'square' },
        { label: 'AIS gap (no positions)', kind: 'line', style: { lw: 1.1, dash: DASH.dotted } },
        { label: 'Other candidate (context)', kind: 'line', style: { lw: LW.fine, dash: DASH.dashed, color: C.ink3 } },
        { label: 'Source corridor (modelled)', kind: 'hatch', style: { lw: 0.8, color: C.model, dash: DASH.dashed } },
        { label: 'Hindcast centre track', kind: 'line', style: { lw: 1, color: C.model, dash: DASH.dashDot } },
        { label: 'Zone at CPA time', kind: 'line', style: { lw: 0.9, color: C.model, dash: [3, 2] } },
        { label: 'Interval-bounding zones', kind: 'line', style: { lw: 0.8, color: C.model, dash: [1.5, 2.5] } },
        { label: 'Observed slick (T0)', kind: 'area', fill: C.ink },
      ],
      notes: [
        'ANALYTICAL SUPPORT SCORE — NOT DETERMINATION OF RESPONSIBILITY.',
        `AIS quality ${cand.aisQuality}; max. gap ${u.minutes(cand.maxAisGapMin)}.`,
        'Spatio-temporal proximity does not establish discharge.',
        'Vessel identity anonymised; identifiers are non-valid dummies.',
      ],
    },
  });
  drawCandidatePlate(ctx, box, cand);
}
