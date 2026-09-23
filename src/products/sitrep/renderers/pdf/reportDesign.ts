/**
 * The ONLY bridge to the technical report's design system (../report). The SITREP reuses its visual primitives
 * (frame, flow/pagination, tables, stamps, badges, map view, theme) but none of its data contract.
 */
export { C, DASH, LW, PAGE, T, FONT_FILES, type FontBytes, type FontKey } from '../../../report/ReportTheme';
export { ReportContext, type Box } from '../../../report/layout/ReportContext';
export { Flow } from '../../../report/layout/Flow';
export { drawTechnicalFrame, drawCell, drawLogo } from '../../../report/layout/Frame';
export { drawEngineeringTable } from '../../../report/components/EngineeringTable';
export { drawStatusStamp, drawStateBadge, drawLevelGauge, drawMarker, drawNorthArrow, drawScaleBar, drawArrowHead, drawLegend } from '../../../report/components/Drafting';
export { MapView, extentOf, type Extent } from '../../../report/diagrams/MapView';
export type { TechnicalIncidentReport, QualityLevel } from '../../../report/ReportTypes';
