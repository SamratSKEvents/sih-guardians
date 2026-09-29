/**
 * Shape measurements the record does not carry.
 *
 * `slicks.sqlite` stores area, length and a part count. It has no orientation
 * and no width, and both are what an operator actually reads a slick by: a
 * long thin feature lying along the wind is a discharge trail, the same area
 * in a round blob is not. The outline is already on the client, so these are
 * derived locally from the polygon outline.
 *
 * Principal-axis analysis, in a local tangent plane with longitude squeezed by
 * cos(lat) so degrees are comparable. Vertices are weighted equally, which is
 * a real approximation — a densely sampled part of the ring pulls the axis —
 * and is why `bearingDeg` is labelled reconstructed wherever it is shown.
 */

import type { GeoPolygon } from '../../api/slicks';
import type { MapLayer } from './chart-types';
import type { LonLat } from '../../incidents/types';

const KM_PER_DEG_LAT = 111.132;

/** Every ring of a (Multi)Polygon, as lon/lat pairs. */
export function ringsOf(geometry: GeoPolygon | null): number[][][] {
  if (!geometry) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out: number[][][] = [];
  for (const polygon of polygons as number[][][][]) {
    for (const ring of polygon) {
      if (Array.isArray(ring) && ring.length > 2) out.push(ring as number[][]);
    }
  }
  return out;
}

export interface Axis {
  /** Bearing of the long axis, degrees true, folded into [0, 180). */
  bearingDeg: number;
  /** Extent along the long axis. */
  lengthKm: number;
  /** Extent across it. */
  widthKm: number;
}

/**
 * The outline's long axis, or undefined when there is no outline to measure.
 * A near-circular shape has no meaningful orientation, so one is not reported.
 */
export function principalAxis(rings: number[][][], centre: LonLat | undefined): Axis | undefined {
  const points = rings.flat();
  if (points.length < 3 || !centre) return undefined;

  const cos = Math.max(Math.cos((centre.lat * Math.PI) / 180), 1e-6);
  // Local tangent plane in km, east/north, about the centroid.
  const local = points.map(([lon, lat]) => [
    (lon - centre.lon) * KM_PER_DEG_LAT * cos,
    (lat - centre.lat) * KM_PER_DEG_LAT,
  ]);

  const n = local.length;
  const mx = local.reduce((sum, [x]) => sum + x, 0) / n;
  const my = local.reduce((sum, [, y]) => sum + y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of local) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  sxx /= n;
  syy /= n;
  sxy /= n;

  // Principal direction of the 2x2 covariance matrix.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  let alongMin = Infinity;
  let alongMax = -Infinity;
  let acrossMin = Infinity;
  let acrossMax = -Infinity;
  for (const [x, y] of local) {
    const along = (x - mx) * ux + (y - my) * uy;
    const across = -(x - mx) * uy + (y - my) * ux;
    alongMin = Math.min(alongMin, along);
    alongMax = Math.max(alongMax, along);
    acrossMin = Math.min(acrossMin, across);
    acrossMax = Math.max(acrossMax, across);
  }

  const lengthKm = alongMax - alongMin;
  const widthKm = acrossMax - acrossMin;
  // Within 10% of square, the axis is an artefact of vertex placement.
  if (lengthKm <= 0 || widthKm / lengthKm > 0.9) return undefined;

  // atan2(east, north) gives a compass bearing; a line has no direction, so
  // the two ends are the same answer and it folds into a half-turn.
  const bearing = (Math.atan2(ux, uy) * 180) / Math.PI;
  return { bearingDeg: ((bearing % 180) + 180) % 180, lengthKm, widthKm };
}

/**
 * The slick itself, as a layer any chart can carry.
 *
 * Every stage draws something ABOUT the slick — a source region, a track, a
 * vessel — and three of them drew only a dot where it was. The outline is on
 * the client already, so the thing under investigation is on every chart it
 * belongs on rather than only on stage ①.
 */
export function slickLayer(geometry: GeoPolygon | null): MapLayer | undefined {
  const rings = ringsOf(geometry);
  if (rings.length === 0) return undefined;
  return { id: 'slick', label: 'Slick outline', claim: 'observed', shapes: [{ kind: 'polygon', rings }] };
}
