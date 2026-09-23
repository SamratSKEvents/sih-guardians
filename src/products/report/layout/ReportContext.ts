import type { TechnicalIncidentReport } from '../ReportTypes';
import { C, FONT_FILES, PAGE, type FontBytes, type FontKey } from '../ReportTheme';
import type { LegendItem } from '../components/Drafting';

export type Doc = PDFKit.PDFDocument;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlateInfo {
  drawingNo: string;
  title: string;
  subtitle?: string;
  scale?: string;
  legend?: LegendItem[];
  notes?: string[];
}

export interface PageMeta {
  orientation: 'portrait' | 'landscape';
  kind: 'cover' | 'standard' | 'plate';
  sectionNo: string;
  sectionTitle: string;
  continued?: boolean;
  plate?: PlateInfo;
}

export interface TextOpts {
  w?: number;
  h?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  lineGap?: number;
  cs?: number;
  color?: string;
  ellipsis?: boolean;
  /** Keep on a single line (no wrapping). */
  nowrap?: boolean;
  underline?: boolean;
}

/** Cap-height centre offset for IBM Plex (fraction of font size from text top). */
const CAP_MID = 0.69;

/**
 * Shared render state: the PDFKit document, the report data, page registry,
 * numbering and a few terse drawing helpers every component uses.
 */
export class ReportContext {
  readonly pages: PageMeta[] = [];
  readonly toc: { no: string; title: string; page: number }[] = [];
  private figureNo = new Map<string, number>();
  private tableNo = new Map<string, number>();
  private finalizers: (() => void)[] = [];
  images = new Map<string, Uint8Array | string>();

  constructor(
    readonly doc: Doc,
    readonly data: TechnicalIncidentReport,
    fonts: FontBytes,
  ) {
    for (const k of Object.keys(FONT_FILES) as FontKey[]) doc.registerFont(k, fonts[k] as any);
    doc.font('sans');
  }

  get demo() {
    return this.data.metadata.isDemonstrationData;
  }

  get pageSize() {
    const p = this.pages[this.pages.length - 1];
    return p?.orientation === 'landscape' ? { w: PAGE.a4.h, h: PAGE.a4.w } : { w: PAGE.a4.w, h: PAGE.a4.h };
  }

  /** Adds a page and returns the usable content box for its kind. */
  addPage(meta: PageMeta): Box {
    this.doc.addPage({ size: 'A4', layout: meta.orientation, margin: 0 });
    this.pages.push(meta);
    if (!meta.continued && !this.toc.some((t) => t.no === meta.sectionNo)) {
      this.toc.push({ no: meta.sectionNo, title: meta.sectionTitle, page: this.pages.length });
      this.doc.outline.addItem(`${meta.sectionNo}  ${meta.sectionTitle}`);
    }
    return this.contentBox(meta);
  }

  /** Register a sub-document (e.g. an appendix) that starts on the current page. */
  registerToc(no: string, title: string) {
    this.toc.push({ no, title, page: this.pages.length });
    this.doc.outline.addItem(`${no}  ${title}`);
  }

  contentBox(meta: PageMeta): Box {
    const W = meta.orientation === 'landscape' ? PAGE.a4.h : PAGE.a4.w;
    const H = meta.orientation === 'landscape' ? PAGE.a4.w : PAGE.a4.h;
    const f = PAGE.frame;
    if (meta.kind === 'plate') {
      return { x: f + 10, y: f + 10, w: W - 2 * f - PAGE.plateColumnW - 20, h: H - 2 * f - 20 };
    }
    const top = f + (meta.kind === 'cover' ? 0 : PAGE.headerH) + PAGE.pad;
    const bottom = H - f - PAGE.footerH - PAGE.pad + 2;
    return { x: f + PAGE.pad, y: top, w: W - 2 * (f + PAGE.pad), h: bottom - top };
  }

  onFinalize(fn: () => void) {
    this.finalizers.push(fn);
  }
  runFinalizers() {
    this.finalizers.forEach((f) => f());
  }

  nextFigure(sectionNo: string) {
    const n = (this.figureNo.get(sectionNo) ?? 0) + 1;
    this.figureNo.set(sectionNo, n);
    return `FIG. ${sectionNo}.${n}`;
  }
  nextTable(sectionNo: string) {
    const n = (this.tableNo.get(sectionNo) ?? 0) + 1;
    this.tableNo.set(sectionNo, n);
    return `TABLE ${sectionNo}.${n}`;
  }

  /* ---------------------------------------------------------------- drawing helpers */

  font(key: FontKey, size: number, color: string = C.ink) {
    this.doc.font(key).fontSize(size).fillColor(color);
    return this;
  }

  /** Text anchored at its top-left (PDFKit convention). Returns rendered height. */
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const d = this.doc;
    if (o.color) d.fillColor(o.color);
    d.text(s, x, y, {
      width: o.nowrap ? undefined : o.w,
      height: o.h,
      align: o.align,
      lineGap: o.lineGap ?? 0,
      characterSpacing: o.cs ?? 0,
      ellipsis: o.ellipsis,
      lineBreak: !o.nowrap,
      underline: o.underline,
    });
    return o.nowrap ? d.currentLineHeight() : this.height(s, o);
  }

  /** Single-line text vertically centred (on cap height) at yc. */
  textMid(s: string, x: number, yc: number, o: TextOpts = {}) {
    const size = (this.doc as any)._fontSize as number;
    let tx = x;
    if (o.w !== undefined && o.align && o.align !== 'left') {
      const tw = this.width(s, o.cs);
      tx = o.align === 'center' ? x + (o.w - tw) / 2 : x + o.w - tw;
    }
    this.text(s, tx, yc - size * CAP_MID, { ...o, nowrap: true, w: undefined, align: undefined });
  }

  width(s: string, cs = 0) {
    return this.doc.widthOfString(s, { characterSpacing: cs } as any);
  }

  height(s: string, o: TextOpts = {}) {
    return this.doc.heightOfString(s, { width: o.w, lineGap: o.lineGap ?? 0, characterSpacing: o.cs ?? 0 } as any);
  }

  pen(lw: number, color: string = C.ink, dash: number[] | null = null) {
    const d = this.doc;
    d.lineWidth(lw).strokeColor(color).lineCap('butt').lineJoin('miter');
    if (dash) (d as any).dash(dash);
    else d.undash();
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, lw: number, color: string = C.ink, dash: number[] | null = null) {
    this.pen(lw, color, dash);
    this.doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    this.doc.undash();
  }

  rect(b: Box, lw: number, color: string = C.ink, fill?: string, dash: number[] | null = null) {
    this.pen(lw, color, dash);
    this.doc.rect(b.x, b.y, b.w, b.h);
    if (fill && lw > 0) this.doc.fillAndStroke(fill, color);
    else if (fill) this.doc.fill(fill);
    else this.doc.stroke();
    this.doc.undash();
  }

  fillRect(b: Box, fill: string) {
    this.doc.rect(b.x, b.y, b.w, b.h).fill(fill);
  }

  polyline(pts: [number, number][], close = false) {
    const d = this.doc;
    pts.forEach(([x, y], i) => (i ? d.lineTo(x, y) : d.moveTo(x, y)));
    if (close) d.closePath();
    return d;
  }

  /** Parallel hatch lines clipped to box (call inside save/clip for arbitrary shapes). */
  hatch(b: Box, spacing = 3, lw = 0.3, color: string = C.rule, angleDeg = 45) {
    const d = this.doc;
    d.save();
    d.rect(b.x, b.y, b.w, b.h).clip();
    this.pen(lw, color);
    const diag = Math.hypot(b.w, b.h);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let s = -diag; s <= diag; s += spacing) {
      const px = cx - dy * s, py = cy + dx * s;
      d.moveTo(px - dx * diag, py - dy * diag).lineTo(px + dx * diag, py + dy * diag);
    }
    d.stroke();
    d.restore();
  }
}
