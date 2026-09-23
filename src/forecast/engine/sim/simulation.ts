// Simulation state + one physics step. Pure TS, no rendering.
import { displace, localDistance } from '../geo/geodesy';
import { Rng, subSeed } from '../rng/prng';
import { emptySample, type EnvironmentProvider } from '../env/types';
import { computeMetrics, initialCurve, resampleCurve, type Curve } from '../curve/curve';
import { surgery } from '../curve/surgery';
import { Particles, seedInsideCurve, STATUS_FLOATING, STATUS_STRANDED } from '../particles/particles';
import { DEFAULT_WEATHERING, weather, type WeatheringParams } from '../particles/weathering';
import { analyseSlick, analyseSplatSlick, KERNEL_M, SPLAT_RADIUS_M, type SlickState } from '../particles/density';
import { VelocityField, integrate, type IntegratorKind, type Pos } from './integrator';

export interface SimParams extends WeatheringParams {
  seed: number;
  alpha: number; // windage coefficient
  Kh: number; // horizontal diffusivity, m²/s
  dt: number; // physics step, s (always positive; direction sets the sign)
  integrator: IntegratorKind;
  currentOn: boolean;
  windOn: boolean;
  stokesOn: boolean;
  dMin: number; // m
  dMax: number; // m
  maxVertices: number;
  minCurveAreaM2: number;
  surgeryDistanceM: number; // split across necks narrower than this, m (0 = crossings only)
  curveResampling: boolean; // insertion/deletion + surgery (tests can disable for exact reversibility)
  particleCount: number;
  releaseMassKg: number;
  releaseLat: number;
  releaseLon: number;
  initialRadiusM: number;
  initialVertices: number;
  landStops: boolean; // vertices/particles that reach landMask ≥ 0.5 stop moving
  cflLimitM: number; // instability warning if any displacement per step exceeds this, m
  trailIntervalS: number;
  trailParticles: number; // how many particles carry trails
  oilDensity: number; // kg/m³, converts deposited mass to equivalent thickness
  sheenThicknessM: number; // slick = equivalent thickness at or above this, m
  kernelM: number; // particle kernel radius for the thickness field, m
  slickModel: 'thickness' | 'reference'; // how the slick is derived from particles
  splatRadiusM: number; // reference model: soft disc radius per particle, m
}

export const DEFAULT_PARAMS: SimParams = {
  ...DEFAULT_WEATHERING,
  oilDensity: 860,
  sheenThicknessM: 1e-6,
  kernelM: KERNEL_M,
  slickModel: 'thickness',
  splatRadiusM: SPLAT_RADIUS_M,
  seed: 1234,
  alpha: 0.015,
  Kh: 5,
  dt: 60,
  integrator: 'rk4',
  currentOn: true,
  windOn: true,
  stokesOn: true,
  dMin: 20,
  dMax: 100,
  maxVertices: 30000,
  minCurveAreaM2: 20000, // drops filament slivers left by neck surgery
  surgeryDistanceM: 50,
  curveResampling: true,
  particleCount: 5000,
  releaseMassKg: 300000, // ≈ 350 m³ at 860 kg/m³: ~50 µm mean over the initial slick
  releaseLat: 25,
  releaseLon: -60,
  initialRadiusM: 1500,
  initialVertices: 200,
  landStops: true,
  cflLimitM: 13900, // half of the 0.25° grid spacing
  trailIntervalS: 900,
  trailParticles: 60,
};

export interface Warnings {
  vertexCap: boolean;
  outOfDomain: number; // samples flagged this step
  landCrossings: number; // vertices/particles that hit land this step
  instability: string | null;
  massError: number; // |Σmass + evaporated + dispersed − released| / released
}

export class Simulation {
  params: SimParams;
  field: VelocityField;
  t = 0; // s
  steps = 0;
  direction: 1 | -1 = 1;
  curves: Curve[] = [];
  particles!: Particles;
  releasedMassKg = 0;
  evaporatedKg = 0;
  dispersedKg = 0;
  trails = new Map<string, number[]>(); // key → flat [lat, lon, ...]
  trailsVersion = 0;
  warnings: Warnings = { vertexCap: false, outOfDomain: 0, landCrossings: 0, instability: null, massError: 0 };
  version = 0;
  resets = 0; // increments on every reset
  initialSlick: SlickState | null = null; // slick at release, for the reference-style overlay
  surgerySplits = 0; // cumulative
  curvesDropped = 0; // cumulative (area below minCurveAreaM2)
  private nextId = 1;
  private walk!: Rng;
  private lastTrailSlot = 0;
  private landSample = emptySample();
  private weatherSample = emptySample();
  private slickCache: { version: number; key: string; state: SlickState | null } | null = null;

  constructor(readonly env: EnvironmentProvider, params: Partial<SimParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.field = new VelocityField(env, this.params);
    this.reset();
  }

  /** Re-initialise from params (seed, release point, counts). t returns to 0. */
  reset(): void {
    const p = this.params;
    this.field.p = p;
    this.t = 0;
    this.steps = 0;
    this.direction = 1;
    this.nextId = 1;
    this.curves = [initialCurve(new Rng(subSeed(p.seed, 100)), p.releaseLat, p.releaseLon, p.initialRadiusM, p.initialVertices, this.nextId++)];
    this.particles = seedInsideCurve(new Rng(subSeed(p.seed, 102)), this.curves[0], p.particleCount, p.releaseMassKg);
    this.releasedMassKg = this.particles.totalMass();
    this.evaporatedKg = 0;
    this.dispersedKg = 0;
    this.walk = new Rng(subSeed(p.seed, 101));
    this.trails.clear();
    this.lastTrailSlot = 0;
    this.surgerySplits = 0;
    this.curvesDropped = 0;
    this.warnings = { vertexCap: false, outOfDomain: 0, landCrossings: 0, instability: null, massError: 0 };
    this.recordTrails();
    this.version++;
    this.resets++;
    this.slickCache = null;
    this.initialSlick = this.slick();
  }

  totalVertices(): number {
    let n = 0;
    for (const c of this.curves) n += c.lat.length;
    return n;
  }

  step(): void {
    const p = this.params;
    this.field.p = p;
    const dt = p.dt * this.direction;
    const t0 = this.t;
    const w: Warnings = { vertexCap: false, outOfDomain: 0, landCrossings: 0, instability: null, massError: 0 };
    const pos: Pos = { lat: 0, lon: 0 };
    let maxDisp = 0, nan = false;

    // 1. curve vertices: deterministic RK advection, no diffusion
    for (const c of this.curves) {
      const la = c.lat, lo = c.lon;
      for (let i = 0; i < la.length; i++) {
        if (integrate(this.field, p.integrator, la[i], lo[i], t0, dt, pos)) w.outOfDomain++;
        if (p.landStops && this.landAt(pos.lat, pos.lon, t0 + dt) >= 0.5) { w.landCrossings++; continue; }
        const d = localDistance(la[i], lo[i], pos.lat, pos.lon);
        if (d > maxDisp) maxDisp = d;
        if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) { nan = true; continue; }
        la[i] = pos.lat;
        lo[i] = pos.lon;
      }
    }

    // 2–4. maintenance, surgery, metrics
    if (p.curveResampling) {
      let total = this.totalVertices();
      const next: Curve[] = [];
      for (const c of this.curves) {
        const before = c.lat.length;
        const r = resampleCurve(c, p.dMin, p.dMax, p.maxVertices - (total - before));
        total += c.lat.length - before;
        if (r.capped) w.vertexCap = true;
        const s = surgery(c, p.minCurveAreaM2, () => this.nextId++, p.surgeryDistanceM);
        this.surgerySplits += s.splits;
        this.curvesDropped += s.dropped;
        for (const k of s.curves) next.push(k);
      }
      this.curves = next;
      if (this.totalVertices() >= p.maxVertices) w.vertexCap = true;
    } else {
      for (const c of this.curves) c.metrics = computeMetrics(c.lat, c.lon);
    }

    // particles: same RK velocity + random walk  dx = sqrt(2 Kh |dt|)·N(0,1)
    const P = this.particles;
    const sigma = Math.sqrt(2 * p.Kh * Math.abs(dt));
    for (let i = 0; i < P.count; i++) {
      if (P.status[i] !== STATUS_FLOATING) continue;
      if (integrate(this.field, p.integrator, P.lat[i], P.lon[i], t0, dt, pos)) w.outOfDomain++;
      const nx = this.walk.normal(), ny = this.walk.normal();
      if (sigma > 0) displace(pos.lat, pos.lon, sigma * nx, sigma * ny, pos);
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) { nan = true; continue; }
      P.ageSeconds[i] += dt;
      if (p.landStops && this.landAt(pos.lat, pos.lon, t0 + dt) >= 0.5) {
        P.status[i] = STATUS_STRANDED; // stays at its last water position
        w.landCrossings++;
        continue;
      }
      P.lat[i] = pos.lat;
      P.lon[i] = pos.lon;
    }

    const lost = weather(P, this.env, t0 + dt, dt, p, this.weatherSample);
    this.evaporatedKg += lost.evaporatedKg;
    this.dispersedKg += lost.dispersedKg;

    this.t = t0 + dt;
    this.steps++;
    if (nan) w.instability = 'non-finite position (NaN/Inf) — step rejected for affected points';
    else if (maxDisp > p.cflLimitM) w.instability = `vertex moved ${(maxDisp / 1000).toFixed(1)} km in one step (> ${(p.cflLimitM / 1000).toFixed(1)} km): reduce dt`;
    const m = P.totalMass();
    w.massError = this.releasedMassKg > 0 ? Math.abs(m + this.evaporatedKg + this.dispersedKg - this.releasedMassKg) / this.releasedMassKg : 0;
    if (w.massError > 1e-9) w.instability = `mass not conserved (rel. error ${w.massError.toExponential(2)})`;
    this.warnings = w;
    this.recordTrails();
    this.version++;
  }

  /** Particle-derived slick (thickness field, outline, patches), recomputed only when state or its parameters change. */
  slick(): SlickState | null {
    const p = this.params, key = `${p.slickModel}|${p.oilDensity}|${p.sheenThicknessM}|${p.kernelM}|${p.splatRadiusM}`;
    const c = this.slickCache;
    if (c && c.version === this.version && c.key === key) return c.state;
    const state = p.slickModel === 'reference' ? analyseSplatSlick(this.particles, p.splatRadiusM) : analyseSlick(this.particles, p.oilDensity, p.sheenThicknessM, p.kernelM);
    this.slickCache = { version: this.version, key, state };
    return state;
  }

  private landAt(lat: number, lon: number, t: number): number {
    return this.env.sample(lat, lon, t, this.landSample).landMask;
  }

  private recordTrails(): void {
    const slot = Math.floor(this.t / this.params.trailIntervalS);
    if (this.steps > 0 && slot === this.lastTrailSlot) return;
    this.lastTrailSlot = slot;
    const add = (key: string, lat: number, lon: number) => {
      let a = this.trails.get(key);
      if (!a) this.trails.set(key, (a = []));
      if (a.length < 4000) a.push(lat, lon);
    };
    this.trailsVersion++;
    for (const c of this.curves) add('c' + c.id, c.metrics.centroidLat, c.metrics.centroidLon);
    const P = this.particles, n = Math.min(this.params.trailParticles, P.count);
    for (let i = 0; i < n; i++) add('p' + i, P.lat[i], P.lon[i]);
  }
}
