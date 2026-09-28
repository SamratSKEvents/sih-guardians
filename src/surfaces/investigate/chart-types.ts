import { token } from '../../design/token';
/**
 * What a stage hands the chart.
 *
 * These were `InvestigationMap`'s own types until the chart became a Cesium
 * viewer. They live apart from the renderer now because they are the contract
 * six stages write against, and a stage should not have to import a map to
 * describe a shape.
 */

import type { Claim } from '../../design/components';
import type { LonLat } from '../../incidents/types';

const KM_PER_DEG_LAT = 111.132;

export type Extent = [west: number, south: number, east: number, north: number];

/** One thing drawn on the chart. */
export type Shape =
  | { kind: 'polygon'; rings: number[][][]; tone?: Tone }
  | { kind: 'path'; points: LonLat[]; tone?: Tone; width?: number }
  | { kind: 'circle'; centre: LonLat; radiusKm: number; tone?: Tone }
  | { kind: 'point'; at: LonLat; tone?: Tone; radius?: number; label?: string }
  /** A measured length, drawn as a drafting dimension: the line, a tick at each end, and its value in a chip. */
  | { kind: 'dimension'; at: LonLat; bearingDeg: number; lengthKm: number; label: string; tone?: Tone };

/** Which of the chart's colours a shape takes. Hues, never opacity. */
export type Tone = 'slick' | 'source' | 'vessel' | 'forecast' | 'muted' | 'select';

/** A raster laid over the chart: the scene a detection was cut from. */
export interface MapImage {
  id: string;
  label: string;
  url: string;
  /** Where the corners of the image sit, in degrees. */
  extent: Extent;
  defaultVisible?: boolean;
}

export interface MapLayer {
  id: string;
  label: string;
  claim: Claim;
  shapes: Shape[];
  /** Off until the operator asks. Heavy layers open closed. */
  defaultVisible?: boolean;
}

export function extentOf(points: readonly LonLat[], fallback: LonLat, minSpanDeg = 0.05): Extent {
  if (points.length === 0) {
    return [fallback.lon - minSpanDeg, fallback.lat - minSpanDeg, fallback.lon + minSpanDeg, fallback.lat + minSpanDeg];
  }
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const point of points) {
    w = Math.min(w, point.lon);
    e = Math.max(e, point.lon);
    s = Math.min(s, point.lat);
    n = Math.max(n, point.lat);
  }
  // A single point, or a track that never moved, still needs a box.
  if (e - w < minSpanDeg) {
    const mid = (e + w) / 2;
    w = mid - minSpanDeg / 2;
    e = mid + minSpanDeg / 2;
  }
  if (n - s < minSpanDeg) {
    const mid = (n + s) / 2;
    s = mid - minSpanDeg / 2;
    n = mid + minSpanDeg / 2;
  }
  return [w, s, e, n];
}

export function aroundKm(centre: LonLat, radiusKm: number): LonLat[] {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (KM_PER_DEG_LAT * Math.max(Math.cos((centre.lat * Math.PI) / 180), 1e-6));
  return [
    { lon: centre.lon - dLon, lat: centre.lat },
    { lon: centre.lon + dLon, lat: centre.lat },
    { lon: centre.lon, lat: centre.lat - dLat },
    { lon: centre.lon, lat: centre.lat + dLat },
  ];
}

/**
 * A tone's colour, taken from the live stylesheet rather than repeated here.
 *
 * The SVG chart got these by class, so a theme change moved the marks with
 * everything else. Cesium needs real values, and reading the custom property
 * keeps that one source: the map still recolours with the theme.
 */
const TONE_VAR: Record<Tone, string> = {
  slick: '--slick',
  source: '--series-3',
  vessel: '--series-4',
  forecast: '--series-2',
  select: '--accent-bright',
  muted: '--map-ink-muted',
};

export function toneCss(tone: Tone = 'slick'): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(TONE_VAR[tone]).trim();
  // A custom property can be empty before the stylesheet lands; a mark that
  // cannot be coloured is still better drawn than dropped.
  return value || token('--red-300');
}
