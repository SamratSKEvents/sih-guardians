/**
 * Slicks drawn the way SkyTruth Cerulean draws them (cerulean.skytruth.org:
 * a deck.gl MVTLayer over PostGIS vector tiles), in Cesium:
 *
 *  - Slippy-map tiles are filtered from the 20 features bundled with the app.
 *  - Geometry stays in its original coordinates at every zoom level.
 *  - A screen-space outline, so a slick never thins below that width however
 *    far out the camera is, plus a translucent fill.
 *  - Cerulean's light-theme slick colour, [230, 102, 0].
 *
 * WEIGHT is the one deliberate departure from Cerulean's numbers; see the
 * constant below for what changed and why.
 *
 * Selection: every other slick dims as in Cerulean (fill 75/255, a third of the
 * outline alpha), and the selected one turns the GUARDIANS demo's selection
 * cyan, since orange-on-orange does not say which slick was picked. Set via
 * setFocus('slick:<id>'); like time, it rewrites instance attributes only.
 *
 * Time: what the clock does to the map is a MODE, because there is no single
 * right answer. 'all' ignores it; 'only' draws the clock's day alone. See
 * SlickTimeMode.
 *
 * The rail's date range is a second, independent cut: the clock asks "when am
 * I looking", the range asks "what is in the catalog at all". Both narrow the
 * same per-instance show attribute, so a slick is drawn only if it passes both.
 *
 * Both rewrite per-instance show attributes; tiles are never rebuilt for time.
 */

import {
  ArcType,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  ShowGeometryInstanceAttribute,
  type Viewer,
} from 'cesium';
import { fetchSlickMapTile, type SlickTileSlick } from '../../api/slicks';
import type { MapLayerDefinition } from '../types';

// Cerulean: minZoom 1.5 (rounds to 2), maxZoom 7.
const MIN_TILE_ZOOM = 2;
const MAX_TILE_ZOOM = 7;
/** Metres per pixel at zoom 0 on the equator for 512 px tiles (Mapbox / deck.gl zoom). */
const MPP_AT_ZOOM_0 = 78_271.517;
/** Beyond this many tiles in view the far ones are left out. */
const MAX_TILES = 256;
/** Built tiles kept for quick return; older ones out of view are dropped past this. */
const MAX_CACHED_TILES = 600;
/** Tiles are requested once the camera has been still this long (Cerulean: debounceTime: 500). */
const DEBOUNCE_MS = 500;

/** A tile's extent in Web Mercator world units [0, 1): [minX, minY, maxX, maxY]. */
function tileBounds(key: string): [number, number, number, number] {
  const [z, x, y] = key.split('/').map(Number);
  const n = 1 << z;
  return [x / n, y / n, (x + 1) / n, (y + 1) / n];
}
const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const SLICK = Color.fromBytes(230, 102, 0);

/** Selection highlight (GUARDIANS demo): distinct from the slick orange on light and dark maps. */
const SELECTED = Color.fromBytes(0, 224, 255);


/**
 * What the clock does to the map.
 *
 * - `all`  every detection in the catalog, regardless of the clock.
 * - `only` only detections observed on the clock's day.
 */
export type SlickTimeMode = 'all' | 'only';

const DAY_MS = 86_400_000;

interface Part {
  slickId: string;
  kind: 'fill' | 'line';
  observedMs: number;
  /** km²; null when the record has no measured area. */
  areaKm2: number | null;
  primitive: Primitive;
  id: object;
  attributes?: { show: Uint8Array; color: Uint8Array };
  shown?: boolean;
  /** Last written colour, as RGBA bytes packed in a number, so unchanged parts are skipped. */
  rgba?: number;
}

interface Tile {
  z: number;
  /** Layer opacity baked into this tile's colours: 0.5 below zoom 3. */
  opacity: number;
  primitives: Primitive[];
  parts: Part[];
  ready: boolean;
}

function ringPositions(ring: number[][]): Cartesian3[] {
  return Cartesian3.fromDegreesArray(ring.flat());
}

/*
 * How heavily a slick draws.
 *
 * Cerulean's own values are a 2 px outline, 102/255 fill, and half opacity
 * below zoom 3. Those are tuned for a map whose default view is regional; at
 * the world view this app opens on, all three reductions compound and a slick
 * renders as a faint hairline.
 *
 * Raised until a slick reads as an object at world zoom. The outline is the
 * part that matters, because it is screen-space and therefore the only thing
 * holding a shape together once the geometry is sub-pixel.
 *
 * These are the knobs. Nothing else in this file decides visual weight.
 */
const WEIGHT = {
  /** Screen-space outline width, px. Cerulean: 2. */
  outlinePx: 3,
  /** Fill alpha. Cerulean: 102/255 = 0.40. */
  fill: 0.55,
  /** Outline alpha. Cerulean: 200/255 = 0.78. */
  line: 0.92,
  /** Layer opacity below zoom 3, where the whole catalog is in view.
   *  Cerulean: 0.5. Kept below 1 so dense regions stay readable. */
  farOpacity: 0.85,

};

/** Alphas while another slick is selected: everything else recedes. */
const ALPHA = {
  fill: WEIGHT.fill,
  line: WEIGHT.line,
  fillDimmed: 75 / 255,
  lineDimmed: WEIGHT.line * 0.33,
};

/** A part's colour: 'selected', 'dimmed' (another slick is selected) or normal. */
function colourFor(part: Part, tile: Tile, selected: string | undefined, result: Color): Color {
  const fill = part.kind === 'fill';
  if (selected === part.slickId) return Color.clone(SELECTED, result).withAlpha(fill ? 0.6 : 1, result);
  const dimmed = selected !== undefined;
  const alpha = fill ? (dimmed ? ALPHA.fillDimmed : ALPHA.fill) : dimmed ? ALPHA.lineDimmed : ALPHA.line;
  return Color.clone(SLICK, result).withAlpha(alpha * tile.opacity, result);
}

/** Build a tile's fill and outline primitives. Opacity is baked in: 0.5 below zoom 3. */
function buildTile(z: number, slicks: SlickTileSlick[]): Tile {
  const opacity = z < 3 ? WEIGHT.farOpacity : 1;
  const fillColour = ColorGeometryInstanceAttribute.fromColor(SLICK.withAlpha(ALPHA.fill * opacity));
  const lineColour = ColorGeometryInstanceAttribute.fromColor(SLICK.withAlpha(ALPHA.line * opacity));
  const fills: GeometryInstance[] = [];
  const lines: GeometryInstance[] = [];
  const fillParts: Omit<Part, 'primitive'>[] = [];
  const lineParts: Omit<Part, 'primitive'>[] = [];

  for (const slick of slicks) {
    const observedMs = Date.parse(slick.t);
    const areaKm2 = slick.a ?? null;
    slick.polygons.forEach(([outer, ...holes], polygon) => {
      const id = { slickId: slick.id, polygon };
      fills.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(
              ringPositions(outer),
              holes.map((hole) => new PolygonHierarchy(ringPositions(hole))),
            ),
            vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
            arcType: ArcType.RHUMB,
            granularity: Math.PI / 32,
          }),
          attributes: { color: fillColour, show: new ShowGeometryInstanceAttribute(false) },
          id,
        }),
      );
      fillParts.push({ slickId: slick.id, kind: 'fill', observedMs, areaKm2, id });
      [outer, ...holes].forEach((ring, index) => {
        const lineId = { slickId: slick.id, polygon, ring: index };
        lines.push(
          new GeometryInstance({
            // Width is in screen pixels, like lineWidthUnits: 'pixels'.
            geometry: new PolylineGeometry({
              positions: ringPositions(ring),
              width: WEIGHT.outlinePx,
              arcType: ArcType.RHUMB,
              vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: lineColour, show: new ShowGeometryInstanceAttribute(false) },
            id: lineId,
          }),
        );
        lineParts.push({ slickId: slick.id, kind: 'line', observedMs, areaKm2, id: lineId });
      });
    });
  }

  if (fills.length === 0) return { z, opacity, primitives: [], parts: [], ready: true };
  const fill = new Primitive({
    geometryInstances: fills,
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
    allowPicking: true,
  });
  const line = new Primitive({
    geometryInstances: lines,
    appearance: new PolylineColorAppearance({ translucent: true }),
    allowPicking: false,
  });
  return {
    z,
    opacity,
    primitives: [fill, line],
    parts: [
      ...fillParts.map((part) => ({ ...part, primitive: fill })),
      ...lineParts.map((part) => ({ ...part, primitive: line })),
    ],
    ready: false,
  };
}

/** Mapbox / deck.gl zoom at the camera: metres per pixel at the view centre, Mercator-scaled. */
function mapZoom(viewer: Viewer): number {
  const { camera, scene } = viewer;
  const height = scene.canvas.clientHeight || 1;
  const frustum = camera.frustum as { fovy?: number; left?: number; right?: number };
  const mpp =
    typeof frustum.left === 'number' && typeof frustum.right === 'number'
      ? (frustum.right - frustum.left) / (scene.canvas.clientWidth || 1)
      : (2 * Math.max(camera.positionCartographic.height, 1) * Math.tan((frustum.fovy ?? Math.PI / 3) / 2)) / height;
  return Math.log2((MPP_AT_ZOOM_0 * Math.cos(camera.positionCartographic.latitude)) / mpp);
}

const tileX = (lon: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
function tileY(lat: number, n: number): number {
  const sin = Math.sin(CesiumMath.toRadians(Math.max(-85.0511, Math.min(85.0511, lat))));
  return Math.min(n - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n)));
}

/** Slippy-map tiles at zoom z covering the view (all of them when the whole globe shows). */
function tilesInView(viewer: Viewer, z: number): string[] {
  const n = 1 << z;
  const rect = viewer.camera.computeViewRectangle();
  const deg = CesiumMath.toDegrees;
  const west = rect ? deg(rect.west) : -180;
  const east = rect ? deg(rect.east) : 180;
  const xRanges: [number, number][] =
    west <= east ? [[tileX(west, n), tileX(east, n)]] : [[tileX(west, n), n - 1], [0, tileX(east, n)]];
  const y0 = tileY(rect ? deg(rect.north) : 90, n);
  const y1 = tileY(rect ? deg(rect.south) : -90, n);
  const keys: string[] = [];
  for (const [x0, x1] of xRanges)
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) keys.push(`${z}/${x}/${y}`);
  return keys.slice(0, MAX_TILES);
}

export const slicksLayer = {
  id: 'slicks',
  label: 'Oil slicks',
  description:
    'Demo slick catalog: Edge segmenter detections and Cerulean slicks, drawn as Cerulean does. ' +
    'Most dates are assigned for the demo. Shows every slick observed up to the timeline position.',
  value: 'SAR',
  swatch: 'slick',
  defaultVisible: true,
  create({ viewer }) {
    const { scene } = viewer;
    const tiles = new Map<string, Tile | 'loading'>();
    let wanted = new Set<string>();
    let visible = true;
    let time: number | undefined;
    let timeMode: SlickTimeMode = 'all';
    /** The rail's window, epoch ms, [start, end). Undefined means no date filter. */
    let dateRange: [number, number] | undefined;
    /** The rail's area window, km², [min, max]; max undefined means no upper bound. */
    let areaRange: [number, number | undefined] | undefined;
    let slickFilter: ((slickId: string) => boolean) | undefined;
    let selected: string | undefined;
    let destroyed = false;
    let scheduled = 0;

    const colour = new Color();
    const applyStyle = (tile: Tile) => {
      for (const part of tile.parts) {
        if (!part.attributes) continue;
        const rgba = colourFor(part, tile, selected, colour).toRgba();
        if (rgba === part.rgba) continue;
        part.rgba = rgba;
        part.attributes.color = ColorGeometryInstanceAttribute.toValue(colour, part.attributes.color);
      }
    };

    /**
     * Apply the clock to one tile.
     *
     * The window is the UTC day containing the clock, which is what "the date
     * on the slider" means to the person reading it.
     */
    const applyTime = (tile: Tile) => {
      const dayStart = time === undefined ? undefined : Math.floor(time / DAY_MS) * DAY_MS;
      for (const part of tile.parts) {
        if (!part.attributes) continue;
        const onDay =
          dayStart !== undefined &&
          part.observedMs >= dayStart &&
          part.observedMs < dayStart + DAY_MS;
        const inRange =
          !dateRange || (part.observedMs >= dateRange[0] && part.observedMs < dateRange[1]);
        // An unmeasured area passes: the filter narrows sizes, it does not hide records without one.
        const inArea =
          !areaRange || part.areaKm2 === null ||
          (part.areaKm2 >= areaRange[0] && (areaRange[1] === undefined || part.areaKm2 <= areaRange[1]));
        const shown = inRange && inArea && (!slickFilter || slickFilter(part.slickId)) && (timeMode === 'only' ? onDay : true);
        if (shown === part.shown) continue;
        part.shown = shown;
        part.attributes.show = ShowGeometryInstanceAttribute.toValue(shown, part.attributes.show);
      }
    };

    /**
     * Show every wanted tile that is built. A tile from another zoom that is
     * already on screen stays only as a placeholder for its own area: while a
     * wanted tile overlapping it is still loading. It goes the moment those
     * are ready, not when every tile in view is.
     */
    const updateShown = () => {
      const pending = [...wanted]
        .filter((key) => {
          const tile = tiles.get(key);
          return !tile || tile === 'loading' || !tile.ready;
        })
        .map(tileBounds);
      for (const [key, tile] of tiles) {
        if (tile === 'loading') continue;
        const current = wanted.has(key) && tile.ready;
        const placeholder =
          !wanted.has(key) &&
          tile.ready &&
          tile.primitives.some((primitive) => primitive.show) &&
          pending.some((bounds) => overlaps(bounds, tileBounds(key)));
        const show = visible && (current || placeholder);
        for (const primitive of tile.primitives) primitive.show = show;
      }
      scene.requestRender();
    };

    const update = () => {
      scheduled = 0;
      if (destroyed || viewer.isDestroyed()) return;
      const z = Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, Math.round(mapZoom(viewer))));
      wanted = new Set(tilesInView(viewer, z));
      for (const key of wanted) {
        if (tiles.has(key)) continue;
        tiles.set(key, 'loading');
        const [tz, tx, ty] = key.split('/').map(Number);
        fetchSlickMapTile(tz, tx, ty)
          .then((slicks) => {
            if (destroyed) return;
            const tile = buildTile(tz, slicks);
            for (const primitive of tile.primitives) {
              primitive.show = false;
              scene.primitives.add(primitive);
            }
            tiles.set(key, tile);
            updateShown();
          })
          .catch((error: unknown) => {
            console.warn(`Static slick tile ${key} could not be prepared.`, error);
            tiles.set(key, { z: tz, opacity: 1, primitives: [], parts: [], ready: true });
          });
      }
      // Oldest-first Map order: drop built tiles that are out of view once the cache is full.
      for (const [key, tile] of tiles) {
        if (tiles.size <= MAX_CACHED_TILES) break;
        if (wanted.has(key) || tile === 'loading') continue;
        for (const primitive of tile.primitives) scene.primitives.remove(primitive);
        tiles.delete(key);
      }
      updateShown();
    };
    // Waiting for the camera to settle means a zoom gesture fetches the level it
    // stops at, not every level it passes through on the way.
    const schedule = () => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(update, DEBOUNCE_MS);
    };

    // Instance attributes exist only once a tile's workers finish.
    const onRender = () => {
      let changed = false;
      for (const tile of tiles.values()) {
        if (tile === 'loading' || tile.ready || !tile.primitives.every((p) => p.ready)) continue;
        // Lookup walks ids from the last hit, so in-order access is O(1) per part.
        for (const part of tile.parts) part.attributes = part.primitive.getGeometryInstanceAttributes(part.id);
        tile.ready = true;
        applyTime(tile);
        applyStyle(tile);
        changed = true;
      }
      if (changed) updateShown();
    };

    const off = [
      viewer.camera.changed.addEventListener(schedule),
      viewer.camera.moveEnd.addEventListener(schedule),
      scene.morphComplete.addEventListener(schedule),
      scene.postRender.addEventListener(onRender),
    ];
    update();

    return {
      setVisible(show) {
        visible = show;
        updateShown();
      },
      setFocus(entityId) {
        selected = entityId?.startsWith('slick:') ? entityId.slice('slick:'.length) : undefined;
        for (const tile of tiles.values()) if (tile !== 'loading' && tile.ready) applyStyle(tile);
        scene.requestRender();
      },
      setTime(ms) {
        time = ms;
        for (const tile of tiles.values()) if (tile !== 'loading' && tile.ready) applyTime(tile);
        scene.requestRender();
      },
      setDateRange(range) {
        dateRange = range as [number, number] | undefined;
        for (const tile of tiles.values()) if (tile !== 'loading' && tile.ready) applyTime(tile);
        scene.requestRender();
      },
      setAreaRange(range) {
        areaRange = range;
        for (const tile of tiles.values()) if (tile !== 'loading' && tile.ready) applyTime(tile);
        scene.requestRender();
      },
      setSlickFilter(test) {
        slickFilter = test;
        for (const tile of tiles.values()) if (tile !== 'loading' && tile.ready) applyTime(tile);
        scene.requestRender();
      },
      setTimeMode(mode) {
        timeMode = mode as SlickTimeMode;
        for (const tile of tiles.values()) if (tile !== 'loading' && tile.ready) applyTime(tile);
        scene.requestRender();
      },
      destroy() {
        destroyed = true;
        window.clearTimeout(scheduled);
        for (const remove of off) remove();
        for (const tile of tiles.values()) {
          if (tile !== 'loading') for (const primitive of tile.primitives) scene.primitives.remove(primitive);
        }
      },
    };
  },
} satisfies MapLayerDefinition;
