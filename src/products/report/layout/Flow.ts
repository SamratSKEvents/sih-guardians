/**
 * Vertical flow + pagination. All section content goes through a Flow so that:
 *  - headings keep with following content,
 *  - figures keep with their captions,
 *  - nothing is drawn below the content box (footer is always clear).
 */
import { C, LW, T } from '../ReportTheme';
import type { FontKey } from '../ReportTheme';
import type { Box, PageMeta, ReportContext } from './ReportContext';

export class Flow {
  box!: Box;
  y = 0;
  private pageCount = 0;
  private sub = 0;

  constructor(
    readonly ctx: ReportContext,
    readonly meta: PageMeta,
  ) {
    this.newPage();
  }

  newPage() {
    this.box = this.ctx.addPage(this.pageCount++ ? { ...this.meta, continued: true } : this.meta);
    this.y = this.box.y;
  }

  get x() {
    return this.box.x;
  }
  get w() {
    return this.box.w;
  }
  get bottom() {
    return this.box.y + this.box.h;
  }
  get room() {
    return this.bottom - this.y;
  }
  get atTop() {
    return this.y <= this.box.y + 0.5;
  }

  /** Ensure `h` pt are available; breaks the page otherwise. Returns true on break. */
  ensure(h: number) {
    if (this.y + h > this.bottom + 0.01 && !this.atTop) {
      this.newPage();
      return true;
    }
    return false;
  }

  gap(h: number) {
    if (!this.atTop) this.y = Math.min(this.y + h, this.bottom);
  }

  /** Major section header. */
  sectionHeader(intro?: string) {
    const { ctx } = this;
    const no = this.meta.sectionNo, title = this.meta.sectionTitle.toUpperCase();
    const y = this.y;
    ctx.rect({ x: this.x, y, w: 30, h: 22 }, LW.heavy);
    ctx.font('monoMedium', 12.5);
    ctx.textMid(no, this.x, y + 11, { w: 30, align: 'center' });
    ctx.font('condSemi', T.h1, C.ink);
    ctx.textMid(title, this.x + 40, y + 11.5, { cs: 0.7 });
    ctx.line(this.x + 30, y + 22, this.x + this.w, y + 22, LW.heavy);
    ctx.font('mono', T.micro, C.ink3);
    const tag = `§${no}`;
    ctx.textMid(tag, this.x + this.w - ctx.width(tag), y + 11);
    this.y += 30;
    if (intro) this.para(intro, { color: C.ink2, size: T.body, w: this.w * 0.86 });
    this.gap(4);
  }

  /** Numbered sub-heading; kept with at least `keep` pt of following content. */
  heading(text: string, keep = 90) {
    this.gap(6);
    this.ensure(18 + keep);
    const { ctx } = this;
    this.sub++;
    const num = `${this.meta.sectionNo}.${this.sub}`;
    ctx.font('monoMedium', 7.6, C.ink);
    ctx.textMid(num, this.x, this.y + 6);
    ctx.font('condSemi', T.h2, C.ink);
    ctx.textMid(text.toUpperCase(), this.x + 30, this.y + 6, { cs: 0.55 });
    ctx.line(this.x, this.y + 13, this.x + this.w, this.y + 13, LW.hair, C.rule);
    ctx.line(this.x, this.y + 13, this.x + 24, this.y + 13, LW.heavy);
    this.y += 20;
  }

  para(text: string, o: { size?: number; font?: FontKey; color?: string; w?: number; x?: number; gapAfter?: number; lineGap?: number } = {}) {
    const { ctx } = this;
    const w = o.w ?? this.w;
    ctx.font(o.font ?? 'sans', o.size ?? T.body, o.color ?? C.ink);
    const lg = o.lineGap ?? 1.8;
    const h = ctx.height(text, { w, lineGap: lg });
    this.ensure(h);
    ctx.font(o.font ?? 'sans', o.size ?? T.body, o.color ?? C.ink);
    ctx.text(text, o.x ?? this.x, this.y, { w, lineGap: lg });
    this.y += h + (o.gapAfter ?? 5);
  }

  /** Numbered / bulleted list with hanging indent. */
  list(items: string[], o: { numbered?: boolean; size?: number; w?: number; x?: number; prefix?: string; gap?: number } = {}) {
    const { ctx } = this;
    const size = o.size ?? T.body;
    const x = o.x ?? this.x, w = o.w ?? this.w;
    ctx.font('monoMedium', size - 0.8);
    const ind = o.numbered ? ctx.width(`${o.prefix ?? ''}00`) + 8 : 11;
    items.forEach((it, i) => {
      ctx.font('sans', size);
      const h = ctx.height(it, { w: w - ind, lineGap: 1.6 });
      this.ensure(h + 2);
      if (o.numbered) {
        ctx.font('monoMedium', size - 0.8, C.ink);
        ctx.text(`${o.prefix ?? ''}${String(i + 1).padStart(2, '0')}`, x, this.y + 0.8);
      } else {
        ctx.doc.rect(x + 1, this.y + size * 0.5, 3, 3).fill(C.ink);
      }
      ctx.font('sans', size, C.ink);
      ctx.text(it, x + ind, this.y, { w: w - ind, lineGap: 1.6 });
      this.y += h + (o.gap ?? 4);
    });
  }

  /** Reserve a figure of height h with caption beneath; draw() receives the figure box. */
  figure(h: number, caption: string, draw: (b: Box) => void, o: { w?: number; x?: number; note?: string } = {}) {
    const { ctx } = this;
    const capH = 16;
    this.ensure(h + capH);
    const b = { x: o.x ?? this.x, y: this.y, w: o.w ?? this.w, h };
    draw(b);
    this.y += h + 4;
    this.caption(ctx.nextFigure(this.meta.sectionNo), caption, b.x, b.w, o.note);
  }

  caption(tag: string, text: string, x = this.x, w = this.w, note?: string) {
    const { ctx } = this;
    ctx.font('condBold', T.label, C.ink);
    const tw = ctx.width(tag) + 8;
    ctx.rect({ x, y: this.y, w: tw, h: 10 }, LW.fine);
    ctx.textMid(tag, x, this.y + 5, { w: tw, align: 'center' });
    ctx.font('cond', T.small, C.ink);
    ctx.textMid(text, x + tw + 6, this.y + 5);
    if (note) {
      ctx.font('cond', T.label, C.ink3);
      ctx.textMid(note, x + w - ctx.width(note), this.y + 5);
    }
    this.y += 16;
  }

  /** Two-column label/value list (engineering parameter sheet style). */
  keyValues(rows: [string, string][], o: { x?: number; w?: number; labelW?: number; mono?: boolean; rowH?: number } = {}) {
    const { ctx } = this;
    const x = o.x ?? this.x, w = o.w ?? this.w, lw = o.labelW ?? w * 0.42, rh = o.rowH ?? 13;
    const startY = this.y;
    rows.forEach(([k, v], i) => {
      ctx.font('sans', T.table);
      const vh = Math.max(rh, ctx.height(v, { w: w - lw - 8 }) + 5);
      this.ensure(vh);
      if (i === 0 || this.y === this.box.y) ctx.line(x, this.y, x + w, this.y, LW.medium);
      ctx.font('cond', T.table, C.ink2);
      ctx.textMid(k, x + 2, this.y + rh / 2);
      ctx.font(o.mono ? 'mono' : 'sans', T.table, C.ink);
      ctx.text(v, x + lw, this.y + rh / 2 - T.table * 0.69, { w: w - lw - 4 });
      this.y += vh;
      ctx.line(x, this.y, x + w, this.y, i === rows.length - 1 ? LW.medium : LW.hair, i === rows.length - 1 ? C.ink : C.grid);
    });
    return this.y - startY;
  }
}
