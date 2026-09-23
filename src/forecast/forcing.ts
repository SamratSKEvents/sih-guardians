/**
 * What drives a MASTER run, and whether it was measured.
 *
 * This is the seam. The model needs a handful of scalars — wind speed and
 * direction, a background current — and it does not care
 * where they came from. This module decides, per record, and says so in a
 * sentence the stage prints verbatim.
 *
 * Today one bundle of the four carries gridded wind and currents; the other
 * three state, in the pipeline's own words, that no forcing exists for them,
 * and most prototype records have none either. So those runs are
 * synthetic, and a synthetic run is a physics demonstration, not a forecast of
 * the slick it is drawn around. Nothing here lets that distinction blur: the
 * `measured` flag travels with the run and the stage refuses to call an
 * unmeasured run a forecast.
 *
 * When real forcing arrives, `fromEnvironment` is where it lands, and the rest
 * of the pipeline — worker, timeline, chart — does not change.
 */

import type { Environment } from '../incidents/types';

export interface Forcing {
  /** Wind speed at 10 m, m/s. */
  windSpeed: number;
  /** Direction the wind blows TOWARDS, degrees true. The engine's convention. */
  windDirDeg: number;
  /** Background surface current, m/s east and north. */
  driftU: number;
  driftV: number;
  /** Whether every number above came from data rather than from the seed. */
  measured: boolean;
  /** One sentence, printed to the operator as-is. */
  provenance: string;
}

/**
 * The synthetic default.
 *
 * Deliberately the engine's own defaults rather than a plausible-looking
 * invention: a number picked to look like weather is harder to recognise as
 * fiction than one that came with the model.
 */
export const SYNTHETIC: Forcing = {
  windSpeed: 7,
  windDirDeg: 70,
  driftU: 0,
  driftV: 0,
  measured: false,
  provenance:
    'Synthetic environment. Wind, current and eddies come from the model’s own seed, not from data for this place or time, so this run shows how a slick of this shape spreads — not where this slick will go.',
};

/** Nearest sample in a monotonic axis. */
const nearest = (axis: readonly number[], value: number) => {
  let best = 0;
  for (let i = 1; i < axis.length; i++) {
    if (Math.abs(axis[i] - value) < Math.abs(axis[best] - value)) best = i;
  }
  return best;
};

/**
 * One hourly field of vectors.
 *
 * The bundle's own shape, confirmed against the CleanSeaNet artifact rather
 * than assumed: `frames[t]` is ONE flat array per time step, holding u and v
 * interleaved — `[u, v, u, v, ...]` — row-major over `[lat][lon]`, with
 * `gridShape` giving `[nLat, nLon]`. Not separate `u` and `v` grids.
 */
interface VectorField {
  lats?: number[];
  lons?: number[];
  times?: string[];
  frames?: number[][];
  gridShape?: [number, number];
  units?: string;
}

/** The [u, v] nearest this place and moment, or undefined if the field cannot say. */
function vectorAt(
  field: VectorField | undefined,
  at: { lon: number; lat: number },
  whenMs: number,
): [number, number] | undefined {
  if (!field?.lats?.length || !field.lons?.length || !field.frames?.length) return undefined;
  const nLon = field.gridShape?.[1] ?? field.lons.length;
  const t = field.times?.length ? nearest(field.times.map((iso) => Date.parse(iso)), whenMs) : 0;
  const frame = field.frames[Math.min(t, field.frames.length - 1)];
  if (!Array.isArray(frame)) return undefined;
  const j = nearest(field.lats, at.lat);
  const i = nearest(field.lons, at.lon);
  const k = (j * nLon + i) * 2;
  const u = frame[k];
  const v = frame[k + 1];
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : undefined;
}

/**
 * Forcing from a bundle's environment artifact, or undefined if it has none.
 *
 * The grids are hourly fields over a box; a MASTER run needs one wind and one
 * current for the whole run, so this takes the sample nearest the
 * detection in space and at the start of the run in time. That is a real
 * simplification — a spatially varying field flattened to a scalar — and it is
 * stated in the provenance rather than hidden.
 *
 * ponytail: nearest-neighbour in space and time. Bilinear plus time
 * interpolation matters once a run is longer than the field's hour spacing;
 * wire it here when it does.
 */
export function fromEnvironment(
  environment: Environment | undefined,
  at: { lon: number; lat: number },
  whenMs: number,
): Forcing | undefined {
  if (!environment || environment.status !== 'AVAILABLE') return undefined;
  const source = environment as unknown as { wind?: VectorField; currents?: VectorField };
  const wind = vectorAt(source.wind, at, whenMs);
  if (!wind) return undefined;
  const current = vectorAt(source.currents, at, whenMs);
  const [u, v] = wind;

  return {
    windSpeed: Math.hypot(u, v),
    // u is towards-east and v towards-north; the engine wants the direction
    // the wind blows TOWARDS, clockwise from north.
    windDirDeg: ((450 - (Math.atan2(v, u) * 180) / Math.PI) % 360 + 360) % 360,
    driftU: current?.[0] ?? 0,
    driftV: current?.[1] ?? 0,
      measured: true,
    provenance:
      `Measured forcing: wind${current ? ' and surface current' : ''} from this incident's environmental fields, ` +
      'sampled at the detection and at the start of the run. One value drives the whole run; the eddies ' +
      'and windrows on top of it are still the model’s own.',
  };
}

/** The forcing for this record: measured when it exists, synthetic otherwise. */
export function forcingFor(
  environment: Environment | undefined,
  at: { lon: number; lat: number },
  whenMs: number,
): Forcing {
  return fromEnvironment(environment, at, whenMs) ?? SYNTHETIC;
}
