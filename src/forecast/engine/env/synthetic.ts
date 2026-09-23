// Synthetic 6-hourly gridded environment, generated once from a single integer seed.
// It is stored exactly like gridded forecast output (node values per time slice) so the
// interpolator/engine cannot tell it apart from real data. It is NOT a forecast.
import { DEG, EARTH_RADIUS_M } from '../geo/geodesy';
import { Rng, subSeed } from '../rng/prng';

export interface GridSpec {
  latMin: number; // deg
  lonMin: number; // deg
  latSpan: number; // deg
  lonSpan: number; // deg
  spacing: number; // deg
  sliceHours: number; // h between slices
  durationHours: number; // h covered, starting at t = 0
}

export const DEFAULT_GRID: GridSpec = {
  latMin: 20,
  lonMin: -65,
  latSpan: 10,
  lonSpan: 10,
  spacing: 0.25,
  sliceHours: 6,
  durationHours: 72,
};

// Field layout inside each node record. The current is stored as its rotational and divergent
// parts separately so divergenceWeight can be a live parameter at sampling time.
export const F_CUR_ROT_U = 0, F_CUR_ROT_V = 1, F_CUR_DIV_U = 2, F_CUR_DIV_V = 3,
  F_WIND_U = 4, F_WIND_V = 5, F_STOKES_U = 6, F_STOKES_V = 7, F_WAVE_H = 8, F_SST = 9;
export const NF = 10;

// Tunable generator assumptions (synthetic, not physical constants).
export const GEN = {
  currentModes: 20,
  currentMinCycles: 1,
  currentMaxCycles: 12,
  // Measured (scripts/perf.ts): with A ∝ 1/n² and log-uniform n the 72-h stretching factor stayed ≤ 2.4 and the
  // slick stayed a disc. A flatter 1/n spectrum with uniform n puts more strain at the smallest resolvable scale.
  uniformCycles: true, // true: wavenumbers uniform in cycles; false: log-uniform
  currentAmpExponent: 1, // streamfunction/potential amplitude A_k ∝ 1/n^exp (n = cycles across domain)
  currentPartP99Speed: 0.6, // m/s, 99th-percentile speed of each of the rotational and divergent parts
  currentPartMaxSpeed: 0.6, // m/s, hard cap on each part (so the combined current stays ≤ 0.8 m/s for divergenceWeight ≤ 0.33)
  currentOmegaMax: 0.25, // rad per 6-h slice, max phase advance of a current mode
  currentDriftMax: 2500, // m per slice, max drift of a mode centre
  windModes: 4,
  windMinSpeed: 2, // m/s
  windMaxSpeed: 15, // m/s
  stokesFraction: 0.012, // |stokes| / |wind|
  stokesMaxOffsetDeg: 20,
  waveMin: 0.2, // m
  waveMax: 4, // m
  landFraction: 0.1, // of nodes, kept away from the domain centre
  landClearRadiusDeg: 3,
};

export interface GriddedData {
  spec: GridSpec;
  nx: number; // lon nodes
  ny: number; // lat nodes
  nSlices: number;
  sliceSeconds: number;
  slices: Float64Array[]; // each ny*nx*NF, row-major (j lat, i lon)
  landMask: Uint8Array; // ny*nx, static
  seed: number;
}

interface Mode {
  amp: number;
  kx: number; // rad/m
  ky: number; // rad/m
  phase: number; // rad
  omega: number; // rad per slice
  driftX: number; // m per slice
  driftY: number; // m per slice
}

function makeModes(rng: Rng, count: number, minCycles: number, maxCycles: number, L: number, ampPow: number, omegaMax: number, driftMax: number): Mode[] {
  const modes: Mode[] = [];
  for (let m = 0; m < count; m++) {
    const n = GEN.uniformCycles ? rng.range(minCycles, maxCycles) : Math.exp(Math.log(minCycles) + rng.next() * (Math.log(maxCycles) - Math.log(minCycles)));
    const dir = rng.range(0, 2 * Math.PI);
    const k = (2 * Math.PI * n) / L;
    const driftDir = rng.range(0, 2 * Math.PI);
    const drift = rng.range(0, driftMax);
    modes.push({
      amp: rng.range(0.5, 1.5) / Math.pow(n, ampPow),
      kx: k * Math.cos(dir),
      ky: k * Math.sin(dir),
      phase: rng.range(0, 2 * Math.PI),
      omega: rng.range(0.3, 1) * omegaMax * (rng.next() < 0.5 ? -1 : 1),
      driftX: drift * Math.cos(driftDir),
      driftY: drift * Math.sin(driftDir),
    });
  }
  return modes;
}

/** Mode argument at local metres (x, y) and slice index s. Phases advance and centres drift per slice. */
function arg(md: Mode, x: number, y: number, s: number): number {
  return md.kx * (x - md.driftX * s) + md.ky * (y - md.driftY * s) + md.phase + md.omega * s;
}

export function generateEnvironment(seed: number, spec: GridSpec = DEFAULT_GRID): GriddedData {
  const nx = Math.round(spec.lonSpan / spec.spacing) + 1;
  const ny = Math.round(spec.latSpan / spec.spacing) + 1;
  const nSlices = Math.round(spec.durationHours / spec.sliceHours) + 1;
  const latC = spec.latMin + spec.latSpan / 2;
  const lonC = spec.lonMin + spec.lonSpan / 2;
  const cosC = Math.cos(latC * DEG);
  const Lx = spec.lonSpan * DEG * EARTH_RADIUS_M * cosC;
  const Ly = spec.latSpan * DEG * EARTH_RADIUS_M;
  const L = (Lx + Ly) / 2;
  const nodes = nx * ny;

  const psiModes = makeModes(new Rng(subSeed(seed, 1)), GEN.currentModes, GEN.currentMinCycles, GEN.currentMaxCycles, L, GEN.currentAmpExponent, GEN.currentOmegaMax, GEN.currentDriftMax);
  const phiModes = makeModes(new Rng(subSeed(seed, 2)), GEN.currentModes, GEN.currentMinCycles, GEN.currentMaxCycles, L, GEN.currentAmpExponent, GEN.currentOmegaMax, GEN.currentDriftMax);
  const windUModes = makeModes(new Rng(subSeed(seed, 3)), GEN.windModes, 0.3, 1.5, L, 0, 0.08, 0);
  const windVModes = makeModes(new Rng(subSeed(seed, 4)), GEN.windModes, 0.3, 1.5, L, 0, 0.08, 0);
  const stokesOffModes = makeModes(new Rng(subSeed(seed, 5)), 3, 0.5, 2, L, 0, 0.1, 0);
  const sstModes = makeModes(new Rng(subSeed(seed, 6)), 2, 0.5, 2, L, 0, 0.05, 0);
  const landModes = makeModes(new Rng(subSeed(seed, 7)), 4, 0.5, 2.5, L, 0, 0, 0);
  const wr = new Rng(subSeed(seed, 8));
  const windDir0 = wr.range(0, 2 * Math.PI);
  const windTurn = wr.range(-Math.PI / 2, Math.PI / 2); // total rotation over the duration
  const windBase = wr.range(6, 10); // m/s

  const xs = new Float64Array(nx);
  const ys = new Float64Array(ny);
  for (let i = 0; i < nx; i++) xs[i] = (spec.lonMin + i * spec.spacing - lonC) * DEG * EARTH_RADIUS_M * cosC;
  for (let j = 0; j < ny; j++) ys[j] = (spec.latMin + j * spec.spacing - latC) * DEG * EARTH_RADIUS_M;

  const sumAmp = (ms: Mode[]) => ms.reduce((a, m) => a + m.amp, 0);
  const windAmpNorm = 4 / sumAmp(windUModes); // perturbation up to ±4 m/s per component
  const windVAmpNorm = 4 / sumAmp(windVModes);
  const stokesNorm = 1 / sumAmp(stokesOffModes);
  const sstNorm = 1 / sumAmp(sstModes);

  const slices: Float64Array[] = [];
  const rotSpeeds: number[] = [], divSpeeds: number[] = [];
  for (let s = 0; s < nSlices; s++) {
    const buf = new Float64Array(nodes * NF);
    const frac = nSlices > 1 ? s / (nSlices - 1) : 0;
    const windDir = windDir0 + windTurn * frac;
    const wbu = windBase * Math.cos(windDir);
    const wbv = windBase * Math.sin(windDir);
    for (let j = 0; j < ny; j++) {
      const y = ys[j];
      const lat = spec.latMin + j * spec.spacing;
      for (let i = 0; i < nx; i++) {
        const x = xs[i];
        const o = (j * nx + i) * NF;
        // current: rotational = (-dpsi/dy, dpsi/dx), divergent = (dphi/dx, dphi/dy)
        let ru = 0, rv = 0, du = 0, dv = 0;
        for (const md of psiModes) {
          const c = md.amp * Math.cos(arg(md, x, y, s));
          ru -= md.ky * c;
          rv += md.kx * c;
        }
        for (const md of phiModes) {
          const c = md.amp * Math.cos(arg(md, x, y, s));
          du += md.kx * c;
          dv += md.ky * c;
        }
        buf[o + F_CUR_ROT_U] = ru;
        buf[o + F_CUR_ROT_V] = rv;
        buf[o + F_CUR_DIV_U] = du;
        buf[o + F_CUR_DIV_V] = dv;
        rotSpeeds.push(Math.hypot(ru, rv));
        divSpeeds.push(Math.hypot(du, dv));

        // wind: slowly rotating base + large-scale smooth perturbation, speed clamped to [2, 15]
        let wu = wbu, wv = wbv;
        for (const md of windUModes) wu += windAmpNorm * md.amp * Math.sin(arg(md, x, y, s));
        for (const md of windVModes) wv += windVAmpNorm * md.amp * Math.sin(arg(md, x, y, s));
        let ws = Math.hypot(wu, wv);
        const target = Math.min(GEN.windMaxSpeed, Math.max(GEN.windMinSpeed, ws));
        if (ws === 0) { wu = Math.cos(windDir); wv = Math.sin(windDir); ws = 1; }
        wu *= target / ws;
        wv *= target / ws;
        ws = target;
        buf[o + F_WIND_U] = wu;
        buf[o + F_WIND_V] = wv;

        // Stokes: 1.2% of wind speed, direction within ±20° of the wind, offset smooth in space
        let off = 0;
        for (const md of stokesOffModes) off += md.amp * Math.sin(arg(md, x, y, s));
        const ang = off * stokesNorm * GEN.stokesMaxOffsetDeg * DEG;
        const ca = Math.cos(ang), sa = Math.sin(ang), sf = GEN.stokesFraction;
        buf[o + F_STOKES_U] = sf * (wu * ca - wv * sa);
        buf[o + F_STOKES_V] = sf * (wu * sa + wv * ca);

        // wave height ∝ wind speed², mapped into [0.2, 4] m
        const w2 = (ws * ws - GEN.windMinSpeed ** 2) / (GEN.windMaxSpeed ** 2 - GEN.windMinSpeed ** 2);
        buf[o + F_WAVE_H] = GEN.waveMin + (GEN.waveMax - GEN.waveMin) * Math.min(1, Math.max(0, w2));

        let sm = 0;
        for (const md of sstModes) sm += md.amp * Math.sin(arg(md, x, y, s));
        buf[o + F_SST] = 28 - 0.45 * (lat - spec.latMin) + 0.8 * sm * sstNorm;
      }
    }
    slices.push(buf);
  }

  // normalise each current part so its 99th-percentile speed is currentPartP99Speed, then cap at currentPartMaxSpeed
  const p99 = (v: number[]) => v.sort((x, y) => x - y)[Math.floor(0.99 * (v.length - 1))];
  const kr = GEN.currentPartP99Speed / (p99(rotSpeeds) || 1);
  const kd = GEN.currentPartP99Speed / (p99(divSpeeds) || 1);
  for (const buf of slices) {
    for (let n = 0; n < nodes; n++) {
      const o = n * NF;
      for (const [fu, k] of [[F_CUR_ROT_U, kr], [F_CUR_DIV_U, kd]]) {
        let u = buf[o + fu] * k, v = buf[o + fu + 1] * k;
        const sp = Math.hypot(u, v);
        if (sp > GEN.currentPartMaxSpeed) { u *= GEN.currentPartMaxSpeed / sp; v *= GEN.currentPartMaxSpeed / sp; }
        buf[o + fu] = u;
        buf[o + fu + 1] = v;
      }
    }
  }

  // static synthetic land mask: smooth field thresholded at the top landFraction, cleared near the centre
  const lf = new Float64Array(nodes);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let v = 0;
      for (const md of landModes) v += md.amp * Math.sin(arg(md, xs[i], ys[j], 0));
      const r = Math.hypot(i * spec.spacing - spec.lonSpan / 2, j * spec.spacing - spec.latSpan / 2);
      lf[j * nx + i] = v - 3 * Math.exp(-((r / GEN.landClearRadiusDeg) ** 4));
    }
  }
  const sorted = Array.from(lf).sort((a, b) => a - b);
  const thr = sorted[Math.min(nodes - 1, Math.floor(nodes * (1 - GEN.landFraction)))];
  const landMask = new Uint8Array(nodes);
  for (let n = 0; n < nodes; n++) landMask[n] = lf[n] > thr ? 1 : 0;

  return { spec, nx, ny, nSlices, sliceSeconds: spec.sliceHours * 3600, slices, landMask, seed };
}
