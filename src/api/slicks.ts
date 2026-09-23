/**
 * The prototype catalog is bundled with the frontend. These helpers keep the
 * map and the investigation surface on the same feature shape without an API
 * process or a database.
 */

import catalog from '../data/slicks.json';

export interface GeoPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface SlickFeature {
  type: 'Feature';
  id: string;
  geometry: GeoPolygon | null;
  properties: { observedAt: string; timeSource: 'OBSERVED' | 'ASSIGNED_DEMO'; [key: string]: unknown };
}

export interface SlickTimeRange {
  oldest: string | null;
  newest: string | null;
  count: number;
}

export const DEMO_SLICKS = catalog as SlickFeature[];

const byId = new Map(DEMO_SLICKS.map((slick) => [slick.id, slick]));
const orderedDates = DEMO_SLICKS.map((slick) => slick.properties.observedAt).sort();

export const fetchSlickTimeRange = async (): Promise<SlickTimeRange> => ({
  oldest: orderedDates[0] ?? null,
  newest: orderedDates.at(-1) ?? null,
  count: DEMO_SLICKS.length,
});

/** One slick with all its static metadata and geometry. */
export const fetchSlick = async (id: string): Promise<SlickFeature> => {
  const slick = byId.get(id);
  if (!slick) throw new Error(`Demo slick not found: ${id}`);
  return slick;
};

/** One static slick in a Slippy-map tile. */
export interface SlickTileSlick {
  id: string;
  t: string;
  a: number | null;
  polygons: number[][][][];
}

const tileX = (lon: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
const tileY = (lat: number, n: number) => {
  const radians = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const sin = Math.sin(radians);
  return Math.min(n - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n)));
};

/** Client-side filter over the 20 bundled features; no tile endpoint required. */
export const fetchSlickMapTile = async (z: number, x: number, y: number): Promise<SlickTileSlick[]> => {
  const n = 1 << z;
  return DEMO_SLICKS.flatMap((slick) => {
    const centre = slick.properties.centroid;
    if (!Array.isArray(centre) || centre.length < 2 || tileX(Number(centre[0]), n) !== x || tileY(Number(centre[1]), n) !== y) {
      return [];
    }

    const geometry = slick.geometry;
    if (!geometry) return [];
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return [{
      id: slick.id,
      t: slick.properties.observedAt,
      a: typeof slick.properties.areaM2 === 'number' ? slick.properties.areaM2 / 1e6 : null,
      polygons: polygons as number[][][][],
    }];
  });
};
