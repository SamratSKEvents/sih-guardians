/**
 * The ONLY bridge to the technical report's design system (../report). The IAP reuses its visual primitives
 * (frame, flow/pagination, tables, stamps, badges, theme) but none of its data contract.
 */
export { C, DASH, LW, PAGE, T, FONT_FILES, type FontBytes, type FontKey } from '../../../report/ReportTheme';
export { ReportContext, type Box } from '../../../report/layout/ReportContext';
export { Flow } from '../../../report/layout/Flow';
export { drawTechnicalFrame, drawCell, drawLogo } from '../../../report/layout/Frame';
export { drawEngineeringTable } from '../../../report/components/EngineeringTable';
export { drawStatusStamp, drawMarker, drawNorthArrow, drawArrowHead, drawLegend } from '../../../report/components/Drafting';
export type { TechnicalIncidentReport } from '../../../report/ReportTypes';
