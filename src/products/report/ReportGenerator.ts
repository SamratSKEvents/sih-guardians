/**
 * Browser-first PDF generator. Depends only on the TechnicalIncidentReport contract + font bytes.
 * Uses PDFKit's native vector/text primitives; output collected with pdfkit/output (no streams, no server).
 */
import PDFDocument from 'pdfkit';
import { toBytes } from 'pdfkit/output';
import type { ImageSource, TechnicalIncidentReport } from './ReportTypes';
import type { FontBytes } from './ReportTheme';
import { ReportContext } from './layout/ReportContext';
import { finalizeFrames } from './layout/Frame';
import { coverSection } from './sections/CoverSection';
import { contentsSection } from './sections/ContentsSection';
import { executiveSummarySection } from './sections/ExecutiveSummarySection';
import { observationSection } from './sections/ObservationSection';
import { slickGeometrySection } from './sections/SlickGeometrySection';
import { environmentSection } from './sections/EnvironmentSection';
import { hindcastSection } from './sections/HindcastSection';
import { releaseTimeSection } from './sections/ReleaseTimeSection';
import { aisSection } from './sections/AISSection';
import { candidateSection } from './sections/CandidateSection';
import { forecastSection } from './sections/ForecastSection';
import { impactSection } from './sections/ImpactSection';
import { confidenceSection } from './sections/ConfidenceSection';
import { provenanceSection } from './sections/ProvenanceSection';
import { methodologySection } from './sections/MethodologySection';
import { limitationsSection } from './sections/LimitationsSection';
import { appendixSection } from './sections/AppendixSection';

export type ReportVariant = 'full' | 'short';

type Section = (ctx: ReportContext) => void;

const FULL: Section[] = [
  coverSection,
  contentsSection,
  executiveSummarySection,
  observationSection,
  slickGeometrySection,
  environmentSection,
  hindcastSection,
  releaseTimeSection,
  aisSection,
  candidateSection,
  forecastSection,
  impactSection,
  confidenceSection,
  provenanceSection,
  methodologySection,
  limitationsSection,
  appendixSection,
];

const SHORT: Section[] = [
  coverSection,
  executiveSummarySection,
  slickGeometrySection,
  candidateSection,
  forecastSection,
  confidenceSection,
  limitationsSection,
];

async function toImageData(src: ImageSource): Promise<Uint8Array | string> {
  if (typeof src === 'string') {
    if (src.startsWith('data:')) return src;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Image fetch failed: ${src} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  return new Uint8Array(await src.arrayBuffer());
}

export async function generateTechnicalReport(
  data: TechnicalIncidentReport,
  fonts: FontBytes,
  opts: { variant?: ReportVariant } = {},
): Promise<Uint8Array> {
  const md = data.metadata;
  const variant = opts.variant ?? 'full';
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: false,
    bufferPages: true,
    font: fonts.sans as any,
    pdfVersion: '1.7',
    lang: 'en-IN',
    displayTitle: true,
    info: {
      Title: `${md.reportTitle} — ${md.incidentId}${variant === 'short' ? ' (short)' : ''}`,
      Author: md.systemName,
      Subject: `${md.statusBanner}. ${md.area}.${md.isDemonstrationData ? ' DEMONSTRATION / ILLUSTRATIVE DATA — NOT AN OPERATIONAL ASSESSMENT.' : ''}`,
      Keywords: md.keywords.join(', '),
      Creator: `${md.systemShortName} report generator (${md.modelVersion})`,
      Producer: 'PDFKit',
      CreationDate: new Date(md.generatedAt),
    },
  } as any);
  const output = toBytes(doc);

  const ctx = new ReportContext(doc, data, fonts);
  const images: [string, ImageSource | undefined][] = [
    ['sar', data.observation.image],
    ['logo', md.logo],
  ];
  for (const [key, src] of images) {
    if (!src) continue;
    try {
      ctx.images.set(key, await toImageData(src));
    } catch (e) {
      console.warn(`[report] image "${key}" unavailable, vector placeholder used`, e);
    }
  }

  (variant === 'short' ? SHORT : FULL).forEach((s) => s(ctx));
  ctx.runFinalizers();
  finalizeFrames(ctx);
  doc.end();
  return output;
}
