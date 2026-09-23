import { EARTH_RADIUS_M as R } from '../geo/geodesy';

/** Geographic east/north velocity (m/s); arguments are longitude/latitude in radians. */
export type OceanVelocity = (lon: number, lat: number) => [number, number];
export interface SphereDomain { west: number; east: number; south: number; north: number }
const minmod = (a: number, b: number) => a * b <= 0 ? 0 : Math.sign(a) * Math.min(Math.abs(a), Math.abs(b));

/**
 * Conservative transport on the entire sphere. Stores VOLUME, not thickness, so every shared face transfers
 * exactly the same quantity even when latitude changes the cell area. Periodic longitude; zero-length pole faces.
 * MUSCL/minmod spatial reconstruction + SSP-RK2, with a donor-volume limiter also applied to diffusive fluxes.
 * All arrays are reused. No per-cell objects, empty-ocean tiles, local projections or per-step allocations.
 */
export class SphereTransport {
  readonly ny: number;
  readonly angle: number;
  readonly latitudeAngle: number;
  readonly west: number;
  readonly south: number;
  readonly periodic: boolean;
  readonly area: Float64Array;
  readonly mass: Float64Array;
  private readonly stage: Float64Array;
  private readonly next: Float64Array;
  private readonly fx: Float64Array;
  private readonly fy: Float64Array;
  private readonly ratio: Float64Array;
  private readonly u: Float64Array;
  private readonly v: Float64Array;
  private readonly eastMetric: Float64Array;
  private readonly northLength: Float64Array;
  substeps = 0;

  constructor(readonly nx: number, domain?: SphereDomain) {
    if (!Number.isInteger(nx) || nx < 16 || nx % 2 !== 0) throw new Error('Sphere width must be an even integer >= 16.');
    const d = domain ?? { west: -Math.PI, east: Math.PI, south: -Math.PI / 2, north: Math.PI / 2 };
    if (![d.west, d.east, d.south, d.north].every(Number.isFinite) || d.east <= d.west || d.east - d.west > 2 * Math.PI + 1e-10 || d.north <= d.south || d.south < -Math.PI / 2 || d.north > Math.PI / 2) throw new Error('Invalid spherical domain.');
    this.ny = nx / 2; this.angle = (d.east - d.west) / nx; this.latitudeAngle = (d.north - d.south) / this.ny;
    this.west = d.west; this.south = d.south; this.periodic = d.east - d.west > 2 * Math.PI - 1e-10;
    const alloc = () => new Float64Array(nx * this.ny);
    this.mass = alloc(); this.stage = alloc(); this.next = alloc(); this.fx = alloc(); this.fy = alloc();
    this.ratio = alloc(); this.u = alloc(); this.v = alloc();
    this.area = new Float64Array(this.ny);
    this.eastMetric = new Float64Array(this.ny);
    this.northLength = new Float64Array(this.ny);
    for (let j = 0; j < this.ny; j++) {
      const south = this.south + j * this.latitudeAngle, north = south + this.latitudeAngle;
      this.area[j] = R * R * this.angle * (Math.sin(north) - Math.sin(south));
      this.eastMetric[j] = this.latitudeAngle / (this.angle * Math.cos(this.latitude(j)));
      this.northLength[j] = j === this.ny - 1 ? 0 : R * this.angle * Math.cos(north);
    }
  }

  get bytes() { return this.mass.byteLength * 8 + this.area.byteLength * 3; }
  longitude(i: number) { return this.west + (i + 0.5) * this.angle; }
  latitude(j: number) { return this.south + (j + 0.5) * this.latitudeAngle; }
  volume() { let sum = 0; for (const v of this.mass) sum += v; return sum; }

  /** Sample each face once for this forcing interval, and compute a global advection + diffusion CFL. */
  private prepare(flow: OceanVelocity, diffusivity: number): number {
    const { nx, ny, angle, area, u, v } = this;
    const length = R * this.latitudeAngle;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      u[k] = !this.periodic && i === nx - 1 ? 0 : flow(this.longitude(i) + angle / 2, this.latitude(j))[0] * length;
      v[k] = j === ny - 1 ? 0 : flow(this.longitude(i), this.latitude(j) + this.latitudeAngle / 2)[1] * this.northLength[j];
      if (!Number.isFinite(u[k]) || !Number.isFinite(v[k])) throw new Error('Non-finite ocean forcing.');
    }
    let rate = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, west = j * nx + (i + nx - 1) % nx;
      const adv = Math.abs(u[k]) + Math.abs(u[west]) + Math.abs(v[k]) + (j ? Math.abs(v[k - nx]) : 0);
      const diff = diffusivity * (2 * this.eastMetric[j] + (this.northLength[j] + (j ? this.northLength[j - 1] : 0)) / length);
      rate = Math.max(rate, (adv + 2 * diff) / area[j]);
    }
    return rate > 0 ? 0.4 / rate : Infinity;
  }

  private euler(input: Float64Array, output: Float64Array, dt: number, D: number) {
    const { nx, ny, area, fx, fy, ratio, u, v } = this;
    const length = R * this.latitudeAngle;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const row = j * nx, k = row + i;
      const w = row + (this.periodic ? (i + nx - 1) % nx : Math.max(0, i - 1));
      const e = row + (this.periodic ? (i + 1) % nx : Math.min(nx - 1, i + 1));
      const ee = row + (this.periodic ? (i + 2) % nx : Math.min(nx - 1, i + 2));
      const h = input[k] / area[j], he = input[e] / area[j];
      const left = h + 0.5 * minmod(h - input[w] / area[j], he - h);
      const right = he - 0.5 * minmod(he - h, input[ee] / area[j] - he);
      fx[k] = dt * (u[k] * (u[k] >= 0 ? left : right) - D * this.eastMetric[j] * (he - h));
      if (!this.periodic && i === nx - 1) fx[k] = 0;
      if (j === ny - 1) { fy[k] = 0; continue; }
      const hn = input[k + nx] / area[j + 1];
      const hs = j ? input[k - nx] / area[j - 1] : h;
      const hnn = j + 2 < ny ? input[k + 2 * nx] / area[j + 2] : hn;
      const bottom = h + 0.5 * minmod(h - hs, hn - h);
      const top = hn - 0.5 * minmod(hn - h, hnn - hn);
      fy[k] = dt * (v[k] * (v[k] >= 0 ? bottom : top) - D * this.northLength[j] / length * (hn - h));
    }
    // A single donor ratio limits ALL its outgoing faces together, preserving positivity and conservation.
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, west = j * nx + (i + nx - 1) % nx;
      const out = Math.max(0, fx[k]) + Math.max(0, -fx[west]) + Math.max(0, fy[k]) + (j ? Math.max(0, -fy[k - nx]) : 0);
      ratio[k] = out > input[k] ? input[k] / out : 1;
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, east = j * nx + (i + 1) % nx;
      fx[k] *= ratio[fx[k] >= 0 ? k : east];
      if (j < ny - 1) fy[k] *= ratio[fy[k] >= 0 ? k : k + nx];
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, west = j * nx + (i + nx - 1) % nx;
      output[k] = input[k] - fx[k] + fx[west] - fy[k] + (j ? fy[k - nx] : 0);
      // Only roundoff can be negative after the donor limiter. No mass correction is booked to hide drift.
      if (output[k] < 0 && output[k] > -1e-12 * Math.max(1, input[k])) output[k] = 0;
    }
  }

  advance(dt: number, flow: OceanVelocity, diffusivity: number) {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(diffusivity) || diffusivity < 0) throw new Error('Invalid transport timestep or diffusivity.');
    this.substeps = 0;
    if (dt === 0) return;
    const limit = this.prepare(flow, diffusivity), count = Math.max(1, Math.ceil(dt / limit)), sub = dt / count;
    if (count > 10000) throw new Error('Ocean timestep requires more than 10000 CFL substeps.');
    for (let s = 0; s < count; s++) {
      this.euler(this.mass, this.stage, sub, diffusivity);
      this.euler(this.stage, this.next, sub, diffusivity);
      for (let k = 0; k < this.mass.length; k++) this.mass[k] = 0.5 * (this.mass[k] + this.next[k]);
    }
    this.substeps = count;
  }
}
