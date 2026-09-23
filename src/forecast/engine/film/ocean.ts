import { DEG, dLon, EARTH_RADIUS_M as R } from '../geo/geodesy';
import { DEFAULT_WEATHERING } from '../particles/weathering';
import { Budget } from './grid';
import { entrainmentAt } from './master';
import { GLOBE_DEFAULTS, type GlobeRelease, type GlobeStroke, type GlobeView, type GlobeBlock } from './globe';
import { finish } from './raster';
import { oceanArea, oceanReleaseProblem, oceanShares } from './ocean-release';
import { SphereTransport, type OceanVelocity, type SphereDomain } from './sphere';

export const OCEAN_TOLERANCE = 0.04;
const THRESHOLDS = [0.3e-6, 5e-6, 50e-6];
export interface OceanAccuracy { thickness: number; area: number; drift: number; weathering: number; maximum: number }
const emptyAccuracy = (): OceanAccuracy => ({ thickness: 0, area: 0, drift: 0, weathering: 0, maximum: 0 });

/** Basin-scale, drag-equilibrium transport; deliberately separate from the 50 m momentum/rupture model. */
export class OceanMaster {
  readonly params = { ...GLOBE_DEFAULTS, oceanEddySpeed: 0.15 } as Record<string, number>;
  readonly coarse: SphereTransport;
  readonly fine: SphereTransport;
  readonly solver: { B: number; dx: number; memoryMB: number };
  releases: GlobeRelease[] = [];
  strokes: GlobeStroke[] = [];
  t = 0;
  halted = '';
  accuracy = emptyAccuracy();
  private coarseBudget = new Budget(0);
  private fineBudget = new Budget(0);
  private readonly savedCoarse: Float64Array;
  private readonly savedFine: Float64Array;

  constructor(nx = 512, memoryMB = 256, readonly domain?: SphereDomain) {
    // Account for both solvers, rollback buffers and two release buffers BEFORE allocating.
    const cells = nx * nx / 2 * 5, peakBytes = cells * 8 * 10 + nx * 12 * 3;
    if (peakBytes > memoryMB * 2 ** 20) throw new Error('Spherical resolution exceeds the memory budget.');
    if (nx % 32 !== 0) throw new Error('Ocean resolution must be a multiple of 32.');
    this.coarse = new SphereTransport(nx, domain); this.fine = new SphereTransport(nx * 2, domain);
    this.savedCoarse = new Float64Array(this.coarse.mass.length); this.savedFine = new Float64Array(this.fine.mass.length);
    this.solver = { B: 16, dx: R * this.fine.latitudeAngle, memoryMB };
  }

  get bytes() { return this.coarse.bytes + this.fine.bytes + this.savedCoarse.byteLength + this.savedFine.byteLength; }
  floating() { return this.fine.volume(); }
  budget() { return this.fineBudget; }
  clear() {
    this.coarse.mass.fill(0); this.fine.mass.fill(0); this.t = 0; this.halted = ''; this.releases = [];
    this.coarseBudget = new Budget(0); this.fineBudget = new Budget(0); this.accuracy = emptyAccuracy();
  }
  reset() {
    // Reuse the original accepted release rasterisations; a fresh run is checked before replacing the current one.
    const releases = this.releases.slice();
    this.clear();
    for (const r of releases) { const problem = this.addOil(r, false); if (problem) { this.halted = problem; break; } }
  }
  setStrokes(strokes: GlobeStroke[]) { this.strokes = strokes; }
  addOil(r: GlobeRelease, replace: boolean) { return finish(this.addOilSteps(r, replace)); }

  *addOilSteps(r: GlobeRelease, replace: boolean): Generator<number, string | null> {
    const problem = oceanReleaseProblem(r);
    if (problem) return problem;
    if (this.domain && r.ring.some(([lon, lat]) => {
      const mid = (this.domain!.west + this.domain!.east) / 2, x = mid + dLon(mid / DEG, lon) * DEG;
      return x <= this.domain!.west || x >= this.domain!.east || lat * DEG <= this.domain!.south || lat * DEG >= this.domain!.north;
    })) return 'This release lies outside the current regional grid. Restart with a polygon covering the combined region.';
    const c = yield* oceanShares(this.coarse, r), f = yield* oceanShares(this.fine, r);
    if (!replace) {
      for (let k = 0; k < c.length; k++) c[k] += this.coarse.mass[k];
      for (let k = 0; k < f.length; k++) f[k] += this.fine.mass[k];
    }
    const accuracy = this.compare(c, f);
    if (!Number.isFinite(accuracy.maximum) || accuracy.maximum > OCEAN_TOLERANCE) return `Release resolution check is ${(accuracy.maximum * 100).toFixed(2)}%, above 4%. Increase basin resolution, use a broader/smoother slick or use the local Master; no oil was changed.`;
    if (replace) this.clear();
    this.coarse.mass.set(c); this.fine.mass.set(f);
    this.coarseBudget.add(r.volumeM3); this.fineBudget.add(r.volumeM3);
    this.releases.push({ ...r, ring: r.ring.map(([lon, lat]): [number, number] => [lon, lat]) });
    this.accuracy = accuracy; this.halted = '';
    return null;
  }

  /** Synthetic smooth global flow, with independent current and wind overrides drawn by the user. */
  velocity(time = this.t): OceanVelocity {
    const p = this.params, angle = p.windDirDeg * DEG, phase = p.seed * 0.61803398875 + time / (5 * 86400);
    const a = p.oceanEddySpeed * Math.cos(phase), b = p.oceanEddySpeed * Math.sin(phase);
    return (lon, lat) => {
      let cu = p.driftU * Math.cos(lat) - Math.sin(lat) * (a * Math.cos(lon) + b * Math.sin(lon));
      let cv = p.driftV * Math.cos(lat) + a * Math.sin(lon) - b * Math.cos(lon);
      let wu = p.windSpeed * Math.sin(angle) * Math.cos(lat), wv = p.windSpeed * Math.cos(angle) * Math.cos(lat);
      for (const stroke of this.strokes) {
        let best = Infinity, u = 0, v = 0;
        for (let k = 1; k < stroke.path.length; k++) {
          const start = stroke.path[k - 1], end = stroke.path[k], scale = R * DEG * Math.max(1e-6, Math.cos(lat));
          const ax = dLon(lon / DEG, start[0]) * scale, ay = (start[1] * DEG - lat) * R;
          const dx = dLon(start[0], end[0]) * scale, dy = (end[1] - start[1]) * DEG * R, length = Math.hypot(dx, dy);
          if (!length) continue;
          const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (length * length)));
          const distance = Math.hypot(ax + t * dx, ay + t * dy);
          if (distance < best) { best = distance; u = stroke.speed * dx / length; v = stroke.speed * dy / length; }
        }
        const weight = Math.max(0, Math.min(1, 2 * (1 - best / stroke.widthM)));
        if (stroke.kind === 'wind') { wu += weight * (u - wu); wv += weight * (v - wv); }
        else { cu += weight * (u - cu); cv += weight * (v - cv); }
      }
      return [cu + p.windage * wu, cv + p.windage * wv];
    };
  }

  /** Compare native threshold areas and mass centroids, plus thickness on the common conservative coarse grid. */
  compare(c = this.coarse.mass, f = this.fine.mass): OceanAccuracy {
    const coarse = this.coarse, fine = this.fine, out = emptyAccuracy();
    let l1 = 0, total = 0;
    const thresholds = [...THRESHOLDS, this.params.sheenUm * 1e-6];
    const ca = thresholds.map(() => 0), fa = thresholds.map(() => 0), cm = [0, 0, 0], fm = [0, 0, 0];
    const moment = (g: SphereTransport, mass: Float64Array, areas: number[], m: number[]) => {
      for (let j = 0; j < g.ny; j++) {
        const lat = g.latitude(j), cos = Math.cos(lat), sin = Math.sin(lat), area = g.area[j];
        for (let i = 0; i < g.nx; i++) {
          const v = mass[j * g.nx + i];
          if (!v) continue;
          const h = v / area, lon = g.longitude(i);
          m[0] += v * cos * Math.cos(lon); m[1] += v * cos * Math.sin(lon); m[2] += v * sin;
          for (let q = 0; q < thresholds.length; q++) if (h >= thresholds[q]) areas[q] += area;
        }
      }
    };
    moment(coarse, c, ca, cm); moment(fine, f, fa, fm);
    for (let j = 0; j < coarse.ny; j++) for (let i = 0; i < coarse.nx; i++) {
      const k = 2 * j * fine.nx + 2 * i, ref = f[k] + f[k + 1] + f[k + fine.nx] + f[k + fine.nx + 1];
      l1 += Math.abs(c[j * coarse.nx + i] - ref); total += ref;
    }
    out.thickness = l1 / Math.max(total, 1e-100);
    out.area = Math.max(...ca.map((v, i) => Math.abs(v - fa[i]) / Math.max(fa[i], 1)));
    const cn = Math.hypot(...cm), fn = Math.hypot(...fm);
    if (cn > total * 1e-8 && fn > total * 1e-8) {
      const chord = Math.hypot(...cm.map((v, i) => v / cn - fm[i] / fn));
      out.drift = 2 * R * Math.asin(Math.min(1, chord / 2)) / Math.max(R * fine.angle, Math.sqrt(fa[0] / Math.PI));
    } else if (Math.max(cn, fn) > total * 1e-8) out.drift = 1;
    // Removed-volume differences are measured against total released volume (defined even when a sink is zero).
    const cb = this.coarseBudget, fb = this.fineBudget;
    out.weathering = Math.max(Math.abs(cb.evaporated - fb.evaporated), Math.abs(cb.dispersed - fb.dispersed), Math.abs(c.reduce((s, v) => s + v, 0) - total)) / Math.max(fb.released, total, 1e-100);
    out.maximum = Math.max(out.thickness, out.area, out.drift, out.weathering);
    return out;
  }

  /** Reject and roll back a failed comparison. Never silently accept >4% or reinitialise the reference to hide error. */
  step(dt: number) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid ocean timestep.');
    if (this.halted || dt === 0) return;
    let remaining = dt;
    while (remaining > 1e-8) {
      const sub = Math.min(remaining, 600), p = this.params, flow = this.velocity(this.t + sub / 2);
      this.savedCoarse.set(this.coarse.mass); this.savedFine.set(this.fine.mass);
      const cb = Object.assign(new Budget(0), this.coarseBudget), fb = Object.assign(new Budget(0), this.fineBudget);
      try {
        this.coarse.advance(sub, flow, p.Kh);
        // Two half steps also test temporal convergence; both use forcing at their own midpoint.
        this.fine.advance(sub / 2, this.velocity(this.t + sub / 4), p.Kh);
        this.fine.advance(sub / 2, this.velocity(this.t + 3 * sub / 4), p.Kh);
        for (const [g, budget] of [[this.coarse, this.coarseBudget], [this.fine, this.fineBudget]] as const) {
          const factor = budget.weather(g.volume(), this.t + sub, sub, p.sst, p.permanentShare * entrainmentAt(p.windSpeed), { ...DEFAULT_WEATHERING, evapMax: p.evapMax });
          for (let k = 0; k < g.mass.length; k++) g.mass[k] *= factor;
        }
        const a = this.compare();
        if (this.domain) {
          // Stop before a regional boundary can influence transport. Never clip mass or treat an artificial wall as a coast.
          let edge = 0;
          const g = this.fine;
          for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
            if (i < 4 || i >= g.nx - 4 || (this.domain.south > -Math.PI / 2 && j < 4) || (this.domain.north < Math.PI / 2 && j >= g.ny - 4)) edge += g.mass[j * g.nx + i];
          }
          if (edge > this.fineBudget.released * 1e-10) throw new Error('Oil reached the regional grid margin. Step rolled back; restart with a larger region.');
        }
        const massError = Math.max(this.coarseBudget.error(this.coarse.volume()), this.fineBudget.error(this.fine.volume()));
        if (!Number.isFinite(a.maximum) || a.maximum > OCEAN_TOLERANCE || massError > 1e-9) {
          throw new Error(`Accuracy guard: thickness ${(100 * a.thickness).toFixed(2)}%, area ${(100 * a.area).toFixed(2)}%, drift ${(100 * a.drift).toFixed(2)}%, volume ${(100 * a.weathering).toFixed(2)}%; mass residual ${massError.toExponential(1)}. Step rolled back. Increase resolution for this case.`);
        }
        this.accuracy = a;
      } catch (error) {
        this.coarse.mass.set(this.savedCoarse); this.fine.mass.set(this.savedFine);
        this.coarseBudget = cb; this.fineBudget = fb;
        this.halted = error instanceof Error ? error.message : String(error);
        return;
      }
      this.t += sub; remaining -= sub;
    }
  }

  blockThickness(b: GlobeBlock, out: Float32Array) {
    const g = this.fine, B = this.solver.B;
    for (let j = -1; j <= B; j++) for (let i = -1; i <= B; i++) {
      const y = Math.max(0, Math.min(g.ny - 1, b.bj * B + j)), x = (b.bi * B + i + g.nx) % g.nx;
      out[(j + 1) * (B + 2) + i + 1] = g.mass[y * g.nx + x] / g.area[y];
    }
  }

  view(full: boolean, viewport: [number, number, number, number] | null = null, stats = true): GlobeView {
    const g = this.fine, B = this.solver.B, angle = g.angle / DEG, latAngle = g.latitudeAngle / DEG;
    const out: GlobeView = { t: this.t, B, blocks: [], hiddenBlocks: 0, stats: [], warnings: [], outlines: [], arrows: [], box: null };
    if (!full) return out;
    const sheen = this.params.sheenUm * 1e-6;
    const wet = (x: number, y: number) => {
      if (y < 0 || y >= g.ny || (!g.periodic && (x < 0 || x >= g.nx))) return false;
      return g.mass[y * g.nx + (x + g.nx) % g.nx] / g.area[y] >= sheen;
    };
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity, affected = 0;
    for (let bj = 0; bj < g.ny / B; bj++) for (let bi = 0; bi < g.nx / B; bi++) {
      let visible = false;
      for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
        const y = bj * B + j, h = g.mass[y * g.nx + bi * B + i] / g.area[y];
        if (h >= 0.04e-6) visible = true;
        if (stats && h >= sheen) {
          affected += g.area[y];
          const x = bi * B + i, w = g.west / DEG + x * angle, e = w + angle;
          const s = g.south / DEG + y * latAngle, n = s + latAngle;
          if (!wet(x - 1, y)) out.outlines.push([s, w, n, w]);
          if (!wet(x + 1, y)) out.outlines.push([s, e, n, e]);
          if (!wet(x, y - 1)) out.outlines.push([s, w, s, e]);
          if (!wet(x, y + 1)) out.outlines.push([n, w, n, e]);
        }
      }
      if (!visible) continue;
      const w = g.west / DEG + bi * B * angle, e = w + B * angle, s = g.south / DEG + bj * B * latAngle, n = s + B * latAngle;
      west = Math.min(west, w); east = Math.max(east, e); south = Math.min(south, s); north = Math.max(north, n);
      if (viewport) {
        const [vw, vs, ve, vn] = viewport, span = ve >= vw ? ve - vw : ve + 360 - vw;
        const delta = dLon(vw + span / 2, (w + e) / 2);
        if (n < vs || s > vn || (span < 359 && Math.abs(delta) > (span + e - w) / 2)) { out.hiddenBlocks++; continue; }
      }
      out.blocks.push({ id: `ocean:${bi}:${bj}`, spill: 0, bi, bj, corners: [[w, s], [w, n], [e, n], [e, s]] });
    }
    if (!stats) return out;
    if (west < east) out.box = { lon: (west + east) / 2, lat: (south + north) / 2, wLon: west, eLon: east, sLat: south, nLat: north };
    const flow = this.velocity();
    const spacing = Math.max(0.01, Math.max(east - west, north - south) / 12);
    if (out.box) for (let lat = south + spacing / 2; lat < north; lat += spacing) for (let lon = west + spacing / 2; lon < east; lon += spacing) {
      const [u, v] = flow(lon * DEG, lat * DEG); out.arrows.push(lon, lat, u, v, spacing * DEG * R);
    }
    const a = this.accuracy, percent = (v: number) => `${(100 * v).toFixed(2)}%`;
    out.stats = [
      ['solver', `spherical transport · ${g.nx} × ${g.ny} · ${(this.bytes / 2 ** 20).toFixed(1)} MB including companion and rollback`],
      ['elapsed', `${(this.t / 3600).toFixed(2)} h`],
      ['resolution', `${(this.solver.dx / 1000).toFixed(2)} km north–south; ${(R * g.angle / 1000).toFixed(2)} km × cos(latitude) east–west${this.domain ? ' · regional grid' : ' · full globe'}`],
      ['affected area', `${(affected / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`],
      ['resolution comparison (4% limit)', `thickness ${percent(a.thickness)} · area ${percent(a.area)} · drift ${percent(a.drift)} · volume ${percent(a.weathering)}`],
      ...this.fineBudget.rows(this.floating()),
    ];
    out.warnings = ['Basin approximation: resolution agreement is not a 4% guarantee against the 50 m Master. Unresolved rupture, windrows, momentum transients and coastal processes are omitted. Synthetic forcing; open ocean everywhere.'];
    if (this.strokes.some(s => s.widthM < 2 * this.solver.dx)) out.warnings.push('Some forcing arrows are narrower than two basin cells and may be unresolved. Widen them for basin transport.');
    if (this.halted) out.warnings.push(this.halted);
    return out;
  }
}

/** Quick scale decision: never rasterise billions of 50 m cells just to estimate their cost. */
export function needsOcean(r: GlobeRelease): boolean {
  if (oceanReleaseProblem(r)) return false;
  if (oceanArea(r.ring) > 2000e6) return true;
  const first = r.ring[0];
  return r.ring.some(p => Math.abs(dLon(first[0], p[0])) * Math.cos(first[1] * DEG) > 3 || Math.abs(p[1] - first[1]) > 3);
}
