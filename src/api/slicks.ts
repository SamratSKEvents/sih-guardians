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

/*
 * The wider catalogue: 13,789 slicks from public/data/catalog (built by the
 * earlier GUARDIANS catalogue tool). Map-only — no imagery, AIS or drift, so
 * they are drawn and inspectable but not investigable (`catalogOnly`).
 *
 *   meta.json            id -> [time, km², lon, lat]            (~0.7 MB, map boot)
 *   geom/lodN/<cell>.json outlines per 10° cell, 4 detail levels (per view)
 *   index.json           full per-slick record                   (~6 MB, first click)
 */
type CatalogMeta = Record<string, [string | null, number | null, number, number]>;
interface CatalogRecord {
  id: string; kind: string; src: string; t: string | null; c: [number, number]; bbox: number[];
  area: number | null; len: number | null; comp: number; p: number | null; warn: boolean; ver: string | null;
}

const json = <T,>(url: string, fallback: T): Promise<T> =>
  fetch(url).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);

let meta: Promise<CatalogMeta> | undefined;
let records: Promise<Map<string, CatalogRecord>> | undefined;
const cells = new Map<string, Promise<Record<string, GeoPolygon>>>();

const catalogMeta = () => (meta ??= json<CatalogMeta>('/data/catalog/meta.json', {}));
const catalogRecords = () =>
  (records ??= json<{ slicks: CatalogRecord[] }>('/data/catalog/index.json', { slicks: [] })
    .then(({ slicks }) => new Map(slicks.map((r) => [r.id, r]))));

/** Coarser outlines further out, as the source tool tiered them (≈445 m … full detail). */
const lodFor = (z: number) => (z <= 3 ? 'lod0' : z === 4 ? 'lod1' : z === 5 ? 'lod2' : 'lod3');

/** The catalogue's 10° cell name, e.g. e030_n30 or w010_s10. */
const cellName = (lon: number, lat: number) => {
  const x = Math.floor(lon / 10) * 10;
  const y = Math.floor(lat / 10) * 10;
  return `${x >= 0 ? 'e' : 'w'}${String(Math.abs(x)).padStart(3, '0')}_${y >= 0 ? 'n' : 's'}${String(Math.abs(y)).padStart(2, '0')}`;
};

const cellOutlines = (lod: string, cell: string) => {
  const key = `${lod}/${cell}`;
  let hit = cells.get(key);
  if (!hit) {
    hit = json<{ slicks?: Record<string, GeoPolygon> }>(`/data/catalog/geom/${key}.json`, {}).then((t) => t.slicks ?? {});
    cells.set(key, hit);
  }
  return hit;
};

async function catalogFeature(id: string): Promise<SlickFeature | undefined> {
  const r = (await catalogRecords()).get(id);
  if (!r) return undefined;
  const geometry = (await cellOutlines('lod3', cellName(r.c[0], r.c[1])))[id] ?? null;
  return {
    type: 'Feature',
    id,
    geometry,
    properties: {
      observedAt: r.t ?? '',
      timeSource: 'OBSERVED',
      catalogOnly: true,
      kind: r.kind,
      source: r.src,
      centroid: r.c,
      bbox: r.bbox,
      areaM2: r.area,
      lengthM: r.len,
      components: r.comp,
      probability: r.p ?? undefined,
      lookalikeWarning: r.warn,
      verifier: r.ver ?? undefined,
    },
  };
}

/** One slick with all its static metadata and geometry. */
export const fetchSlick = async (id: string): Promise<SlickFeature> => {
  const slick = byId.get(id) ?? (await catalogFeature(id));
  if (!slick) throw new Error(`Slick not found: ${id}`);
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

const tileLon = (x: number, n: number) => (x / n) * 360 - 180;
const tileLat = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

/** Catalogue slicks whose centroid falls in this Slippy tile, at the zoom's detail level. */
async function catalogTile(z: number, x: number, y: number): Promise<SlickTileSlick[]> {
  const n = 1 << z;
  const [west, east, north, south] = [tileLon(x, n), tileLon(x + 1, n), tileLat(y, n), tileLat(y + 1, n)];
  const names = new Set<string>();
  for (let lon = Math.floor(west / 10) * 10; lon < east; lon += 10)
    for (let lat = Math.floor(south / 10) * 10; lat < north; lat += 10) names.add(cellName(lon, lat));
  const [m, ...outlines] = await Promise.all([catalogMeta(), ...[...names].map((c) => cellOutlines(lodFor(z), c))]);
  const out: SlickTileSlick[] = [];
  for (const cell of outlines)
    for (const [id, geometry] of Object.entries(cell)) {
      const row = m[id];
      if (!row || tileX(row[2], n) !== x || tileY(row[3], n) !== y) continue;
      out.push({
        id,
        t: row[0] ?? '',
        a: row[1],
        polygons: (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as number[][][][],
      });
    }
  return out;
}

/** The 20 bundled features plus the wider catalogue; no tile endpoint required. */
export const fetchSlickMapTile = async (z: number, x: number, y: number): Promise<SlickTileSlick[]> => {
  const n = 1 << z;
  return [...demoTile(n, x, y), ...(await catalogTile(z, x, y))];
};

function demoTile(n: number, x: number, y: number): SlickTileSlick[] {
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
}

/** Every slick's centroid, demo and catalogue: what the density layer bins. */
export const fetchSlickPositions = async (): Promise<[number, number][]> => [
  ...DEMO_SLICKS.map((s) => s.properties.centroid as [number, number]),
  ...Object.values(await catalogMeta()).map((m) => [m[2], m[3]] as [number, number]),
];
