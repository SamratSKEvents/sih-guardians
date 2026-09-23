// Phase-field (Cahn–Hilliard) slick on a periodic local square that moves with the mean surface drift.
//
//   φ = +1 oil-covered, −1 clean water, interface a tanh profile of width ≈ 2√2·ε
//   ∂φ/∂t + u·∇φ = M ∇²μ,   μ = φ³ − φ − ε²∇²φ
//
// The free energy makes interfaces shorten (thin filaments pinch off into patches, touching patches merge), the
// divergence-free eddy field stretches and folds the slick. Oil volume is spread over the oil phase: h = V·c / ∫c,
// c = smoothstep(−0.8, 0.8, φ), so the diffuse tail of the interface carries no oil. Pseudo-spectral, linearly stabilised semi-implicit time stepping for the stiff linear terms,
// variable-step Adams–Bashforth 2 for advection and the nonlinear term.
//
// ε and M are numerical-physical parameters, not measured oil properties: the readout checks interface resolution
// (≥ 3 cells), boundedness of φ and conservation of ∫φ, which is what "careful interface-resolution and parameter
// checks" means in practice.
import { Rng, subSeed } from '../rng/prng';
import { DEFAULT_WEATHERING } from '../particles/weathering';
import { Budget, fieldSlick, type Frame, type MapModel, type ParamSpec } from './grid';
import { DEFAULT_FLOW, SurfaceFlow } from './flow';
import { fft2 } from './fft';
import { BONN, OIL_SPEC } from './thinfilm';
import { signedDistance, type ForcingRegion, type Polygon, type SlickProfile } from './shapes';

export const PHASE_DEFAULTS = {
  ...DEFAULT_FLOW,
  eddySpeed: 0.05, eddyScaleM: 2400, // eddies span 2.4 km down to 300 m
  releaseM3: 350, radiusM: 550, oilDensity: 860, sst: 20,
  dispersionRate: DEFAULT_WEATHERING.dispersionRate, evapMax: DEFAULT_WEATHERING.evapMax, sheenUm: 1, seed: 7,
  epsilonM: 36, mobility: 0.1, domainM: 4096, gridN: 128,
};

export class PhaseFieldModel implements MapModel {
  readonly kind = 'map';
  readonly id = 'phasefield';
  readonly title = 'Phase field (Cahn–Hilliard)';
  readonly info = {
    calculates: 'Where the surface is oil-covered, as a smooth phase variable with a narrow interface: filaments stretched by eddies pinch off into separate patches (breakup) and patches that touch merge (coalescence); oil volume is spread over the covered area.',
    assumptions: 'Interface width ε and mobility M are chosen for resolution and time scale, not measured; the domain is a periodic 4 km square that moves with the mean drift and re-centres on the oil; eddies are synthetic and divergence-free (no windrows, which would need a compressible phase). Thickness is uniform inside the oil phase.',
    master: 'Dropped as a separate solver: breakup and coalescence are already produced by the thin-film rupture term acting on the oil-layer thickness. Kept: its interface-resolution check, applied in the master to the rupture wavelength.',
  };
  readonly spec: ParamSpec[] = [
    OIL_SPEC[0], OIL_SPEC[1], ...OIL_SPEC.slice(2, 6),
    { key: 'epsilonM', label: 'Interface width parameter ε', unit: 'm', min: 4, max: 80, step: 1, assumption: true },
    { key: 'mobility', label: 'Mobility M', unit: 'm²/s', min: 0, max: 5, step: 0.05, assumption: true },
    { key: 'eddySpeed', label: 'Eddy rms speed', unit: 'm/s', min: 0, max: 0.3, step: 0.005, assumption: true, reset: true },
    { key: 'eddyScaleM', label: 'Eddy length scale', unit: 'm', min: 200, max: 3200, step: 50, assumption: true, reset: true },
    { key: 'gridN', label: 'Grid cells per side (power of 2)', unit: '', min: 64, max: 256, step: 64, reset: true },
    OIL_SPEC[7],
  ];
  readonly params = { ...PHASE_DEFAULTS } as typeof PHASE_DEFAULTS & Record<string, number>;
  readonly speeds = [60, 300, 900, 1800, 3600];
  readonly frame: Frame = { nx: 128, ny: 128, dx: 25, lat0: 25, lon0: -60, ox: 0, oy: 0 };
  t = 0;
  phi = new Float64Array(0);
  h = new Float64Array(0);
  flow!: SurfaceFlow;
  budget!: Budget;
  private re = new Float64Array(0); private im = new Float64Array(0);
  private gx = new Float64Array(0); private gxi = new Float64Array(0);
  private gy = new Float64Array(0); private gyi = new Float64Array(0);
  private nr = new Float64Array(0); private ni = new Float64Array(0);
  private xr = new Float64Array(0); private xi = new Float64Array(0);
  private u = new Float64Array(0); private v = new Float64Array(0);
  private kx = new Float64Array(0);
  private velT = -Infinity;
  private umax = 0;
  private phiSum0 = 0;
  lastDt = 0; substeps = 0;
  readonly supportsRegions = false; // current/wind regions would break the divergence-free periodic flow

  get rhoOil() { return this.params.oilDensity; }
  get sheenM() { return this.params.sheenUm * 1e-6; }

  constructor(params: Partial<typeof PHASE_DEFAULTS> = {}) {
    Object.assign(this.params, params);
    this.reset();
  }

  reset() {
    const p = this.params, f = this.frame;
    const n = 2 ** Math.round(Math.log2(Math.max(32, p.gridN)));
    p.gridN = n;
    f.nx = f.ny = n; f.dx = p.domainM / n; f.ox = 0; f.oy = 0;
    const N = n * n;
    for (const key of ['phi', 'h', 're', 'im', 'gx', 'gxi', 'gy', 'gyi', 'nr', 'ni', 'xr', 'xi', 'u', 'v'] as const) this[key] = new Float64Array(N);
    this.kx = new Float64Array(n);
    for (let i = 0; i < n; i++) this.kx[i] = ((2 * Math.PI) / p.domainM) * (i <= n / 2 ? i : i - n);
    this.t = 0;
    this.lastDt = 0;
    this.velT = -Infinity;
    this.flow = new SurfaceFlow(p, subSeed(p.seed, 1), p.domainM, 16);
    // disc with a ragged edge and a few satellite droplets, as a tanh profile
    const rng = new Rng(subSeed(p.seed, 2));
    const harm = Array.from({ length: 5 }, (_, m) => ({ a: (0.12 * (rng.next() - 0.5) * 2) / (m + 1), q: rng.next() * 2 * Math.PI }));
    const drops = Array.from({ length: 6 }, () => ({ x: (rng.next() - 0.5) * 3 * p.radiusM, y: (rng.next() - 0.5) * 3 * p.radiusM, r: p.radiusM * rng.range(0.08, 0.2) }));
    const w = Math.SQRT2 * p.epsilonM;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5 - n / 2) * f.dx, y = (j + 0.5 - n / 2) * f.dx, th = Math.atan2(y, x);
        let edge = 1;
        harm.forEach((q, m) => { edge += q.a * Math.cos((m + 2) * th + q.q); });
        let d = p.radiusM * edge - Math.hypot(x, y); // signed distance, + inside
        for (const s of drops) d = Math.max(d, s.r - Math.hypot(x - s.x, y - s.y));
        this.phi[j * n + i] = Math.tanh(d / w);
      }
    this.phiSum0 = this.phi.reduce((a, b) => a + b, 0);
    this.budget = new Budget(p.releaseM3);
    this.updateThickness(p.releaseM3);
  }

  private velocities() {
    const { nx: n, dx, ox, oy } = this.frame, o = { u: 0, v: 0 };
    let um = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        o.u = 0; o.v = 0;
        // eddies are periodic on the domain, so sampling at the grid's world position keeps them periodic on the grid
        this.flow.anomaly(ox + (i + 0.5 - n / 2) * dx, oy + (j + 0.5 - n / 2) * dx, this.t, o, false);
        this.u[j * n + i] = o.u; this.v[j * n + i] = o.v;
        um = Math.max(um, Math.abs(o.u), Math.abs(o.v));
      }
    this.umax = um;
    this.velT = this.t;
  }

  step(dt: number) {
    const p = this.params, f = this.frame, n = f.nx, N = n * n;
    const { phi, re, im, gx, gxi, gy, gyi, nr, ni, kx } = this;
    const S = 2, M = p.mobility, eps2 = p.epsilonM * p.epsilonM, kmax = kx[n / 2];
    let done = 0;
    this.substeps = 0;
    while (done < dt - 1e-9) {
      if (Math.abs(this.t - this.velT) >= 300) this.velocities();
      const sub = Math.min(dt - done, 120, (0.2 * f.dx) / Math.max(this.umax, 1e-9));
      const first = this.lastDt === 0, w = first ? 0 : sub / this.lastDt;
      // φ̂ and its gradient
      re.set(phi); im.fill(0);
      fft2(re, im, n, false);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const k = j * n + i;
          gx[k] = -kx[i] * im[k]; gxi[k] = kx[i] * re[k];
          gy[k] = -kx[j] * im[k]; gyi[k] = kx[j] * re[k];
        }
      fft2(gx, gxi, n, true);
      fft2(gy, gyi, n, true);
      // nonlinear chemical potential part and advection, back to spectral space
      for (let k = 0; k < N; k++) {
        const q = phi[k];
        nr[k] = q * q * q - (1 + S) * q; ni[k] = 0;
        gx[k] = this.u[k] * gx[k] + this.v[k] * gy[k]; gxi[k] = 0;
      }
      fft2(nr, ni, n, false);
      fft2(gx, gxi, n, false);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const k = j * n + i, k2 = kx[i] * kx[i] + kx[j] * kx[j];
          const den = 1 + sub * M * (S * k2 + eps2 * k2 * k2);
          // mild exponential filter on the top wavenumbers against aliasing of φ³ and u·∇φ
          const kr = Math.sqrt(k2) / kmax, filt = kr > 0.7 ? Math.exp(-36 * ((kr - 0.7) / 0.3) ** 8) : 1;
          // explicit part X = u·∇φ + M k² N, Adams–Bashforth 2 with variable step (Euler on the first step)
          const xr = gx[k] + M * k2 * nr[k], xi = gxi[k] + M * k2 * ni[k];
          const er = first ? xr : (1 + w / 2) * xr - (w / 2) * this.xr[k], ei = first ? xi : (1 + w / 2) * xi - (w / 2) * this.xi[k];
          this.xr[k] = xr; this.xi[k] = xi;
          re[k] = (filt * (re[k] - sub * er)) / den;
          im[k] = (filt * (im[k] - sub * ei)) / den;
        }
      re[0] = this.phiSum0; im[0] = 0; // exact conservation of ∫φ (mean mode)
      fft2(re, im, n, true);
      phi.set(re);
      const [mu, mv] = this.flow.mean();
      f.ox += mu * sub; f.oy += mv * sub;
      this.t += sub;
      done += sub;
      this.lastDt = sub;
      this.substeps++;
    }
    this.recentre();
    const vol = this.floating();
    const factor = this.budget.weather(vol, this.t, dt, p.sst, p.dispersionRate, { ...DEFAULT_WEATHERING, evapMax: p.evapMax });
    this.updateThickness(vol * factor);
  }

  /**
   * Keep the oil in the middle of the periodic square: roll the field by whole cells towards its circular centre of mass
   * and move the grid by the same amount (exact for a periodic field), so the slick is not cut at the grid edges.
   */
  private recentre() {
    const f = this.frame, n = f.nx, phi = this.phi;
    let cx = 0, sx = 0, cy = 0, sy = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const c = Math.max(0, 0.5 * (1 + phi[j * n + i]));
        cx += c * Math.cos((2 * Math.PI * i) / n); sx += c * Math.sin((2 * Math.PI * i) / n);
        cy += c * Math.cos((2 * Math.PI * j) / n); sy += c * Math.sin((2 * Math.PI * j) / n);
      }
    const wrap = (v: number) => ((v % n) + n) % n;
    const di = Math.round(wrap((Math.atan2(sx, cx) * n) / (2 * Math.PI) - 0.5) - n / 2 + 0.5), dj = Math.round(wrap((Math.atan2(sy, cy) * n) / (2 * Math.PI) - 0.5) - n / 2 + 0.5);
    if (Math.abs(di) < 2 && Math.abs(dj) < 2) return;
    const old = phi.slice();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) phi[j * n + i] = old[wrap(j + dj) * n + wrap(i + di)];
    f.ox += di * f.dx; f.oy += dj * f.dx;
    this.lastDt = 0; // Adams–Bashforth history belongs to the old position: restart with one Euler step
    this.velT = -Infinity;
  }

  setRegions(_regions: ForcingRegion[]) {}

  /** A drawn slick: its shape becomes oil phase (tanh of the distance to the edge); the thickness profile does not apply. */
  addOil(poly: Polygon, volumeM3: number, _profile: SlickProfile, replace: boolean) {
    const f = this.frame, n = f.nx, w = Math.SQRT2 * this.params.epsilonM;
    let vol = replace ? 0 : this.floating();
    if (replace) {
      this.reset();
      f.ox = 0.5 * (poly.minX + poly.maxX); f.oy = 0.5 * (poly.minY + poly.maxY);
      this.phi.fill(-1);
      this.budget = new Budget(0);
    }
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i, x = f.ox + (i + 0.5 - n / 2) * f.dx, y = f.oy + (j + 0.5 - n / 2) * f.dx;
        this.phi[k] = Math.max(this.phi[k], Math.tanh(signedDistance(poly, x, y) / w));
      }
    // share of the outline beyond the periodic square (that part wraps, so it is counted as lost)
    const half = (n * f.dx) / 2;
    let out = 0;
    for (let q = 0; q < poly.x.length; q++) if (Math.abs(poly.x[q] - f.ox) > half || Math.abs(poly.y[q] - f.oy) > half) out++;
    const lost = out / poly.x.length, placed = volumeM3 * (1 - lost);
    this.phiSum0 = this.phi.reduce((a, b) => a + b, 0);
    this.lastDt = 0;
    this.velT = -Infinity;
    this.budget.add(placed);
    vol += placed;
    this.updateThickness(vol);
    return { placed, lost };
  }

  private floating() { return this.h.reduce((a, b) => a + b, 0) * this.frame.dx * this.frame.dx; }

  private updateThickness(vol: number) {
    const c = (q: number) => { const x = Math.min(1, Math.max(0, (q + 0.8) / 1.6)); return x * x * (3 - 2 * x); };
    let s = 0;
    for (const q of this.phi) s += c(q);
    const scale = s > 0 ? vol / (s * this.frame.dx * this.frame.dx) : 0;
    for (let k = 0; k < this.phi.length; k++) this.h[k] = scale * c(this.phi[k]);
  }

  thickness() { return this.h; }
  land() { return null; }

  arrows(): number[] {
    const { nx: n, dx, ox, oy } = this.frame, a: number[] = [];
    for (let j = n / 16; j < n; j += n / 8)
      for (let i = n / 16; i < n; i += n / 8) a.push(ox + (i + 0.5 - n / 2) * dx, oy + (j + 0.5 - n / 2) * dx, this.u[j * n + i], this.v[j * n + i]);
    return a;
  }

  private checks() {
    const p = this.params, f = this.frame;
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (const q of this.phi) { lo = Math.min(lo, q); hi = Math.max(hi, q); sum += q; }
    return { lo, hi, massErr: Math.abs(sum - this.phiSum0) / Math.max(Math.abs(this.phiSum0), 1), cells: (2 * Math.SQRT2 * p.epsilonM) / f.dx, cfl: (this.lastDt * this.umax) / f.dx };
  }

  stats(): [string, string][] {
    const p = this.params, f = this.frame, c = this.checks();
    // slick edge at φ = 0 (c = 1/2); patches are the oil phase
    const s = fieldSlick(f, this.h, p.oilDensity, 0.5 * Math.max(...this.h) * 0.999 || 1);
    const total = s.patches.reduce((a, q) => a + q.massKg, 0);
    const area = new Array(BONN.length).fill(0);
    for (const v of this.h) for (let b = BONN.length - 1; b >= 0; b--) if (v >= BONN[b].min) { area[b] += f.dx * f.dx; break; }
    return [
      ['elapsed', `${(this.t / 3600).toFixed(2)} h`],
      ['oil patches (φ > 0)', `${s.patches.length}${s.patches.length ? ' — ' + s.patches.slice(0, 6).map((q) => `${(q.areaM2 / 1e6).toFixed(3)} km² (${((100 * q.massKg) / Math.max(total, 1e-300)).toFixed(0)}%)`).join(' / ') : ''}`],
      ['oil-covered area', `${(s.areaM2 / 1e6).toFixed(3)} km²`],
      ['thickness in oil phase', `${(Math.max(...this.h) * 1e6).toFixed(0)} µm`],
      ['Bonn classes', BONN.map((b, k) => `${b.name} ${(area[k] / 1e6).toFixed(2)}`).join(' · ') + ' km²'],
      ['interface resolution', `${c.cells.toFixed(1)} cells across 2√2·ε (need ≥ 3)`],
      ['Cahn number ε/L', (p.epsilonM / p.domainM).toExponential(2)],
      ['φ range', `${c.lo.toFixed(3)} … ${c.hi.toFixed(3)} (bounded if within ±1.1)`],
      ['∫φ conservation', c.massErr.toExponential(1)],
      ['sub-steps', `${this.substeps} last frame, dt ${this.lastDt.toFixed(1)} s, CFL ${c.cfl.toFixed(2)}`],
      ['grid', `${f.nx}², ${f.dx.toFixed(1)} m cells, periodic ${p.domainM / 1000} km square`],
      ...this.budget.rows(this.floating()),
    ];
  }

  warnings(): string[] {
    const c = this.checks(), w: string[] = [];
    if (c.cells < 3) w.push(`Interface under-resolved: ${c.cells.toFixed(1)} cells across it (need ≥ 3). Raise ε or the grid size.`);
    if (c.hi > 1.1 || c.lo < -1.1) w.push(`φ overshoots ±1 (${c.lo.toFixed(2)} … ${c.hi.toFixed(2)}): time step or advection too strong for the interface width.`);
    if (c.massErr > 1e-6) w.push(`∫φ drift ${c.massErr.toExponential(1)}.`);
    if (this.params.mobility * 3600 < this.params.epsilonM ** 2 * 1e-3) w.push('Mobility is so small that coalescence and pinch-off are frozen on hour scales.');
    return w;
  }
}
