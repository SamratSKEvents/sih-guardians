import type { LatLon } from '../ReportTypes';
import { C, DASH, LW, T } from '../ReportTheme';
import type { Box, ReportContext } from '../layout/ReportContext';
import { KM_PER_DEG_LAT, kmPerDegLon, toXY, type XY } from '../utils/geo';

export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Extent (km) covering points with padding. */
export function extentOf(origin: LatLon, pts: LatLon[], padKm = 2, extra: Extent[] = []): Extent {
  const xy = pts.map((p) => toXY(origin, p));
  const e = {
    x0: Math.min(...xy.map((p) => p.x), ...extra.map((x) => x.x0)) - padKm,
    x1: Math.max(...xy.map((p) => p.x), ...extra.map((x) => x.x1)) + padKm,
    y0: Math.min(...xy.map((p) => p.y), ...extra.map((x) => x.y0)) - padKm,
    y1: Math.max(...xy.map((p) => p.y), ...extra.map((x) => x.y1)) + padKm,
  };
  return e;
}

/**
 * Local-tangent-plane map viewport. Scale is isotropic (true km in both axes);
 * requested extent is expanded to fill the rectangle.
 */
export class MapView {
  readonly scale: number; // pt per km
  readonly ext: Extent;

  constructor(
    readonly ctx: ReportContext,
    readonly rect: Box,
    readonly origin: LatLon,
    want: Extent,
  ) {
    this.scale = Math.min(rect.w / (want.x1 - want.x0), rect.h / (want.y1 - want.y0));
    const cx = (want.x0 + want.x1) / 2, cy = (want.y0 + want.y1) / 2;
    const hw = rect.w / this.scale / 2, hh = rect.h / this.scale / 2;
    this.ext = { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
  }

  xy(p: XY) {
    return { x: this.rect.x + (p.x - this.ext.x0) * this.scale, y: this.rect.y + (this.ext.y1 - p.y) * this.scale };
  }
  ll(p: LatLon) {
    return this.xy(toXY(this.origin, p));
  }
  km(p: LatLon) {
    return toXY(this.origin, p);
  }
  pathLL(pts: LatLon[], close = false) {
    return this.ctx.polyline(
      pts.map((p) => {
        const q = this.ll(p);
        return [q.x, q.y];
      }),
      close,
    );
  }
  pathXY(pts: XY[], close = false) {
    return this.ctx.polyline(
      pts.map((p) => {
        const q = this.xy(p);
        return [q.x, q.y];
      }),
      close,
    );
  }

  clip(fn: () => void) {
    const d = this.ctx.doc;
    d.save();
    d.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h).clip();
    fn();
    d.restore();
  }

  get latRange() {
    return [this.origin.lat + this.ext.y0 / KM_PER_DEG_LAT, this.origin.lat + this.ext.y1 / KM_PER_DEG_LAT];
  }
  get lonRange() {
    const k = kmPerDegLon(this.origin.lat);
    return [this.origin.lon + this.ext.x0 / k, this.origin.lon + this.ext.x1 / k];
  }

  /**
   * Nautical-chart neatline: graduated border (alternating 1′ bars), 5′/10′ grid lines, DM labels.
   */
  drawNeatline(o: { minorMin?: number; gridMin?: number; labels?: boolean; gridLines?: boolean } = {}) {
    const { ctx, rect: r } = this;
    const minor = o.minorMin ?? 1, grid = o.gridMin ?? 5;
    const band = 4;
    const [la0, la1] = this.latRange, [lo0, lo1] = this.lonRange;
    const yOfLat = (lat: number) => this.ll({ lat, lon: this.origin.lon }).y;
    const xOfLon = (lon: number) => this.ll({ lat: this.origin.lat, lon }).x;

    // grid lines
    if (o.gridLines !== false) this.clip(() => {
      for (let m = Math.ceil((la0 * 60) / grid) * grid; m <= la1 * 60; m += grid) {
        const y = yOfLat(m / 60);
        ctx.line(r.x, y, r.x + r.w, y, LW.hair, C.grid, DASH.short);
      }
      for (let m = Math.ceil((lo0 * 60) / grid) * grid; m <= lo1 * 60; m += grid) {
        const x = xOfLon(m / 60);
        ctx.line(x, r.y, x, r.y + r.h, LW.hair, C.grid, DASH.short);
      }
    });

    // graduated band outside the map rect
    const outer = { x: r.x - band, y: r.y - band, w: r.w + 2 * band, h: r.h + 2 * band };
    ctx.rect(outer, LW.fine);
    const bars = (a0: number, a1: number, pos: (v: number) => number, draw: (p0: number, p1: number) => void) => {
      const start = Math.floor(a0 * 60 / minor) * minor;
      for (let m = start; m < a1 * 60; m += minor) {
        if (Math.round(m / minor) % 2 !== 0) continue;
        const p0 = pos(Math.max(a0, m / 60)), p1 = pos(Math.min(a1, (m + minor) / 60));
        draw(p0, p1);
      }
    };
    bars(lo0, lo1, xOfLon, (p0, p1) => {
      ctx.fillRect({ x: Math.min(p0, p1), y: r.y - band, w: Math.abs(p1 - p0), h: band }, C.ink);
      ctx.fillRect({ x: Math.min(p0, p1), y: r.y + r.h, w: Math.abs(p1 - p0), h: band }, C.ink);
    });
    bars(la0, la1, yOfLat, (p0, p1) => {
      ctx.fillRect({ x: r.x - band, y: Math.min(p0, p1), w: band, h: Math.abs(p1 - p0) }, C.ink);
      ctx.fillRect({ x: r.x + r.w, y: Math.min(p0, p1), w: band, h: Math.abs(p1 - p0) }, C.ink);
    });
    ctx.rect(r, LW.medium);

    if (o.labels === false) return;
    ctx.font('mono', T.micro, C.ink);
    const dm = (v: number, h: string) => {
      const d = Math.floor(v + 1e-9);
      const m = Math.round((v - d) * 60);
      return `${d}°${String(m).padStart(2, '0')}′${h}`;
    };
    let lastY = Infinity;
    for (let m = Math.ceil((la0 * 60) / grid) * grid; m <= la1 * 60; m += grid) {
      const y = yOfLat(m / 60);
      if (y < r.y + 20 || y > r.y + r.h - 20 || y + 24 > lastY) continue;
      lastY = y;
      const s = dm(m / 60, 'N');
      ctx.doc.save();
      ctx.doc.translate(r.x - band - 4, y).rotate(-90);
      ctx.font('mono', T.micro, C.ink);
      ctx.textMid(s, -ctx.width(s) / 2, 0);
      ctx.doc.restore();
    }
    let lastX = -Infinity;
    for (let m = Math.ceil((lo0 * 60) / grid) * grid; m <= lo1 * 60; m += grid) {
      const x = xOfLon(m / 60);
      const s = dm(m / 60, 'E');
      ctx.font('mono', T.micro, C.ink);
      const tw = ctx.width(s);
      if (x < r.x + 20 || x > r.x + r.w - 20 || x - tw / 2 < lastX + 8) continue;
      ctx.textMid(s, x - tw / 2, r.y + r.h + band + 5.5);
      lastX = x + tw / 2;
    }
  }

  /** Land east of a coastline polyline: white fill + 45° hatch + heavy shoreline. */
  drawLand(coast: LatLon[]) {
    const { ctx } = this;
    const pts = coast.map((p) => this.km(p));
    const far = this.ext.x1 + 50;
    const poly: XY[] = [...pts, { x: far, y: pts[pts.length - 1].y + 50 }, { x: far, y: pts[0].y - 50 }];
    this.clip(() => {
      const d = ctx.doc;
      d.save();
      this.pathXY(poly, true).clip();
      ctx.fillRect(this.rect, C.paper);
      ctx.hatch(this.rect, 3.2, LW.hair, C.rule, 45);
      d.restore();
      ctx.pen(LW.heavy, C.ink);
      d.lineJoin('round');
      this.pathXY(pts).stroke();
    });
  }
}
