import { token } from '../../design/token';
/**
 * The globe: a 2D/3D Earth over a selectable basemap, the registered map
 * layers, and the controls that belong to the map itself.
 *
 * Time is not owned here. The app timeline passes `time` in and this component
 * only mirrors it onto Cesium's clock, so every time-dependent layer follows
 * one clock.
 *
 * Cesium's bundled Natural Earth II imagery always sits underneath as the
 * offline fallback: any streamed tile that fails to load simply shows it.
 *
 * Nothing streams from Cesium ion, so no ion token is needed.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  BoundingSphere,
  buildModuleUrl,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Ellipsoid,
  Entity,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  ImageryLayer,
  Ion,
  JulianDate,
  Occluder,
  SceneMode,
  type Scene,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  ShadowMode,
  SkyBox,
  Math as CesiumMath,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium';
import { MAP_LAYERS, type MapLayerController, type SlickTimeMode } from '../../layers';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  Button,
  IconButton,
  MapLegend,
  MapStatusBar,
  Segmented,
  Select,
  Slider,
  Toggle,
} from '../../design/components';
import { LayerSwatch } from '../../surfaces/swatches';
import { fetchSlick, type GeoPolygon, type SlickFeature } from '../../api/slicks';
import { SlickCard } from './SlickCard';
import { onDemoSelectSlick } from '../../surfaces/demo';
import './map.css';

// No ion assets are used; an empty token stops Cesium phoning home and keeps
// the app fully self-hosted.
Ion.defaultAccessToken = '';

type EarthMode = '2D' | '3D';

/** Pick tolerance in pixels, so a thin slick is clickable (Cerulean: pickingRadius 10). */
const PICK_PX = 10;

/** The slick behind a Cesium pick id: slick primitives tag their instances with { slickId }. */
function slickIdOf(id: unknown): string | undefined {
  return typeof id === 'object' && id !== null && 'slickId' in id ? String((id as { slickId: unknown }).slickId) : undefined;
}

/** Where the selected slick is on screen: its anchor, and its outline when the
 *  shape is big enough on screen to be worth drawing. */
interface SlickFocus {
  x: number;
  y: number;
  /** One "x,y x,y ..." string per ring, ready for an SVG polygon. */
  outline?: string[];
  /** The shape's screen box, so the card can sit beside the slick rather than
   *  beside its centre, which is how it ended up covering half of it. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Every ring of a slick's geometry as lon/lat pairs, thinned to something a
 * per-frame projection can afford. A coastline-hugging detection can carry
 * thousands of vertices; at spotlight scale a few hundred is the same shape.
 */
const MAX_POINTS = 360;
function ringsOf(geometry: GeoPolygon | null): number[][][] | undefined {
  if (!geometry) return undefined;
  const polygons = (
    geometry.type === 'MultiPolygon' ? (geometry.coordinates as number[][][][]) : [geometry.coordinates as number[][][]]
  );
  const rings = polygons.flat();
  const total = rings.reduce((sum, ring) => sum + ring.length, 0);
  if (total <= MAX_POINTS) return rings;
  const step = Math.ceil(total / MAX_POINTS);
  // Keep the closing vertex of every ring: dropping it leaves a gap in the cut-out.
  return rings.map((ring) => ring.filter((_, i) => i % step === 0 || i === ring.length - 1));
}

/**
 * A slick's rings in screen space, or undefined when the shape is not worth
 * cutting out: too small to read, partly behind the globe, or absent.
 *
 * Below a few dozen pixels across, a hugging cut-out is a speck and tells you
 * less than a disc does, so the caller falls back to one.
 */
const MIN_OUTLINE_PX = 28;
/** The fallback disc's radius, and the clearance a speck-sized slick gets. */
const DISC_R = 44;
interface Outline {
  rings: string[];
  box: { x0: number; y0: number; x1: number; y1: number };
}

function outlineOnScreen(
  scene: Scene,
  rings: number[][][] | undefined,
  occluder: Occluder,
): Outline | undefined {
  if (!rings?.length) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const out: string[] = [];
  for (const ring of rings) {
    const points: string[] = [];
    for (const [lon, lat] of ring) {
      const world = Cartesian3.fromDegrees(lon, lat);
      if (scene.mode === SceneMode.SCENE3D && !occluder.isPointVisible(world)) return undefined;
      const point = SceneTransforms.worldToWindowCoordinates(scene, world);
      if (!point) return undefined;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
      points.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    }
    if (points.length > 2) out.push(points.join(' '));
  }
  if (!out.length) return undefined;
  if (Math.max(maxX - minX, maxY - minY) < MIN_OUTLINE_PX) return undefined;
  return { rings: out, box: { x0: minX, y0: minY, x1: maxX, y1: maxY } };
}

interface FocusedAisVessel {
  id: string;
  name: string;
  mmsi: string;
  vesselType: string;
  reports: number;
  routeDuration: string;
  screen: { x: number; y: number };
  routeScreen: string;
  /** Vessel is behind the globe: keep the selection, hide the popup. */
  occluded: boolean;
}

interface ImageryAdjustments {
  alpha: number;
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
  gamma: number;
}

const DEFAULT_ADJUSTMENTS: ImageryAdjustments = {
  alpha: 1,
  brightness: 1,
  contrast: 1,
  hue: 0,
  saturation: 1,
  gamma: 1,
};

/** Label, then the range Cesium accepts. Hue is radians, hence ±π. */
const ADJUSTMENTS: readonly [keyof ImageryAdjustments, string, number, number][] = [
  ['brightness', 'Brightness', 0, 3],
  ['contrast', 'Contrast', 0, 3],
  ['hue', 'Hue', -Math.PI, Math.PI],
  ['saturation', 'Saturation', 0, 3],
  ['gamma', 'Gamma', 0.1, 3],
  ['alpha', 'Opacity', 0, 1],
];

const PROJECTIONS = [
  { value: '2D', label: '2D' },
  { value: '3D', label: '3D' },
] as const satisfies readonly { value: EarthMode; label: string }[];

// Keyless, CORS-enabled Web Mercator sources. CARTO's dark tiles now need an
// API key, so they are not listed.
const BASEMAPS = [
  {
    // Full-resolution NE2 cut by scripts/build-basemap-tiles.ts: local, works
    // offline. Missing after a fresh clone until rebuilt; the bundled copy
    // underneath covers that.
    id: 'natural-earth',
    label: 'Natural Earth II (offline)',
    url: '/tiles/NaturalEarthII/{z}/{x}/{reverseY}.jpg',
    maximumLevel: 5,
    geographic: true,
    credit: 'Natural Earth II (public domain)',
  },
  {
    id: 's2cloudless',
    label: 'Sentinel-2 cloudless 2024',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
    maximumLevel: 16,
    // CC BY-NC-SA 4.0: attribution is a licence condition, and non-commercial only.
    credit: 'Sentinel-2 cloudless by EOX IT Services GmbH (modified Copernicus Sentinel data 2024)',
  },
  {
    id: 'blue-marble',
    label: 'NASA Blue Marble + bathymetry',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
    maximumLevel: 8,
    credit: 'NASA Earth Observatory / NASA EOSDIS GIBS',
  },
  {
    id: 'black-marble',
    label: 'NASA Black Marble (night)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
    maximumLevel: 8,
    credit: 'NASA Earth Observatory / NASA EOSDIS GIBS',
  },
  {
    id: 'esri-dark',
    label: 'Esri dark gray',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    // Place names ship as a separate transparent layer drawn over the base.
    labelsUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 16,
    credit: 'Esri, HERE, Garmin, FAO, NOAA, USGS',
  },
  {
    id: 'esri-light',
    label: 'Esri light gray',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    labelsUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 16,
    credit: 'Esri, HERE, Garmin, FAO, NOAA, USGS',
  },
  // Light, Google-Maps-like styles. Past each maximumLevel Esri serves
  // "map data not available" placeholders, so Cesium upsamples instead.
  {
    id: 'esri-physical',
    label: 'Esri physical (light)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 8,
    credit: 'Esri, US National Park Service',
  },
  {
    id: 'esri-topo',
    label: 'Esri topographic (light)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 17,
    credit: 'Esri, HERE, Garmin, Intermap, USGS, NGA, EPA, NPS, OpenStreetMap contributors',
  },
  {
    id: 'esri-street',
    label: 'Esri streets (light)',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 17,
    credit: 'Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS, OpenStreetMap contributors',
  },
];

type Basemap = (typeof BASEMAPS)[number];

/** What the status bar reports about the view, not about any selection. */
interface Readout {
  /** Cursor position, or undefined when the pointer is off the globe. */
  latLon?: string;
  /** Representative fraction, e.g. "1:2 500 000". */
  scale?: string;
}

/**
 * Degrees as a navigator writes them: absolute value, hemisphere letter.
 * Four decimals is about 11 m, which is finer than anything here is accurate
 * to and coarse enough that the string stops twitching while you read it.
 */
const degrees = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(4)} ${value >= 0 ? positive : negative}`;

/** Grouped with thin spaces: 1:2 500 000 reads, 1:2500000 does not. */
const ratio = (denominator: number) =>
  `1:${Math.round(denominator).toLocaleString('en-GB').replace(/,/g, ' ')}`;

const BASEMAP_OPTIONS = BASEMAPS.map(({ id, label }) => ({ value: id, label }));

function EarthCanvas({
  time,
  mode,
  basemap,
  adjustments,
  layerVisibility,
  focusedEntityId,
  onFocus,
  selectedSlickId,
  onSelectSlick,
  onSlickScreen,
  slickRings,
  slickCentroid,
  flyToSlick,
  onReadout,
  timeMode,
  dateRange,
  areaRange,
}: {
  time: number;
  mode: EarthMode;
  basemap: Basemap;
  adjustments: ImageryAdjustments;
  layerVisibility: Record<string, boolean>;
  focusedEntityId: string | undefined;
  onFocus: (vessel: FocusedAisVessel | undefined) => void;
  selectedSlickId: string | undefined;
  onSelectSlick: (slickId: string | undefined) => void;
  /** Where the selected slick sits on screen, or undefined when it is behind
   *  the globe. Updated every frame so the card tracks the camera. */
  onSlickScreen: (at: SlickFocus | undefined) => void;
  /** The selected slick's rings in lon/lat, projected here every frame. */
  slickRings: number[][][] | undefined;
  /** The record's own centroid. The click that selected it can be tens of
   *  kilometres off at world zoom, where a pixel is a wide thing. */
  slickCentroid: [number, number] | undefined;
  /** Fly the camera to the slick once its centroid is known (the demo's pick, not a click). */
  flyToSlick: boolean;
  onReadout: (readout: Readout) => void;
  timeMode: SlickTimeMode;
  dateRange: [number, number] | undefined;
  areaRange: [number, number | undefined] | undefined;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const layerControllersRef = useRef(new Map<string, MapLayerController>());
  const adjustmentsRef = useRef(adjustments);
  const layerVisibilityRef = useRef(layerVisibility);
  const onFocusRef = useRef(onFocus);
  const focusedEntityRef = useRef<Entity | undefined>(undefined);
  const focusedInfoRef = useRef<FocusedAisVessel | undefined>(undefined);
  adjustmentsRef.current = adjustments;
  layerVisibilityRef.current = layerVisibility;
  onFocusRef.current = onFocus;
  const onSelectSlickRef = useRef(onSelectSlick);
  onSelectSlickRef.current = onSelectSlick;
  const onSlickScreenRef = useRef(onSlickScreen);
  onSlickScreenRef.current = onSlickScreen;
  const slickRingsRef = useRef(slickRings);
  slickRingsRef.current = slickRings;
  // The point on the globe the selected slick was picked at, in world
  // coordinates, so the card can be re-projected as the camera moves instead
  // of sitting where the mouse happened to be.
  const slickAnchorRef = useRef<Cartesian3 | undefined>(undefined);
  // Last position reported, rounded. A still camera re-projects to the same
  // pixel every frame, and reporting it would re-render the card 60 times a
  // second for no movement.
  const slickAtRef = useRef<string>('');
  const onReadoutRef = useRef(onReadout);
  onReadoutRef.current = onReadout;

  useEffect(() => {
    if (!selectedSlickId) {
      slickAnchorRef.current = undefined;
      slickAtRef.current = '';
    }
  }, [selectedSlickId]);

  // The click point holds the card in place for the moment before the record
  // arrives; the centroid takes over as soon as it does.
  //
  // Both of these land from a fetch, outside any frame. The scene runs in
  // requestRenderMode, and the spotlight is projected in postRender, so
  // without asking for a frame here the outline sat and waited for an
  // unrelated one -- a tile finishing, a mouse move -- which is seconds of
  // showing the fallback disc after the shape was already known.
  useEffect(() => {
    if (!slickCentroid) return;
    slickAnchorRef.current = Cartesian3.fromDegrees(slickCentroid[0], slickCentroid[1]);
    slickAtRef.current = '';
    viewerRef.current?.scene.requestRender();
    if (flyToSlick) {
      viewerRef.current?.camera.flyTo({ destination: Cartesian3.fromDegrees(slickCentroid[0], slickCentroid[1], 350_000), duration: 2.5 });
    }
  }, [slickCentroid, flyToSlick]);

  useEffect(() => {
    slickAtRef.current = '';
    viewerRef.current?.scene.requestRender();
  }, [slickRings]);

  useEffect(() => {
    if (!hostRef.current) return;

    const viewer = new Viewer(hostRef.current, {
      // Every default widget is off: this app supplies its own controls.
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      creditContainer: document.createElement('div'),
      terrainProvider: new EllipsoidTerrainProvider(),
      // Local, three levels deep: the offline floor under the streamed basemap.
      baseLayer: ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
      ),
      // Drawn here, not Cesium's six star photos (~850 KB on a phone connection).
      skyBox: starfield(),
      shadows: false,
      terrainShadows: ShadowMode.DISABLED,
      // Renders happen on camera change, or when the timeline moves time.
      requestRenderMode: true,
      // Cesium otherwise renders at 1 CSS pixel per pixel and lets the browser
      // upscale, which is soft on any HiDPI display.
      useBrowserRecommendedResolution: false,
    });

    viewerRef.current = viewer;
    // Cesium's clock never advances by itself; the timeline sets it.
    viewer.clock.shouldAnimate = false;

    const { scene } = viewer;
    scene.backgroundColor = Color.fromCssColorString(token('--neutral-900'));
    // Ground atmosphere washes the surface pale blue, which on a dark globe
    // reads as haze rather than air. The sky atmosphere stays, so the limb
    // still reads as a planet.
    scene.globe.showGroundAtmosphere = false;
    scene.globe.enableLighting = false;
    // depthTestAgainstTerrain stays at Cesium's default (false): overlays draw
    // over the globe surface instead of sinking into it at oblique angles, and
    // Cesium's depth plane still hides whatever is on the far side.
    // Keep revisited tiles on the GPU instead of refetching on every zoom-out.
    scene.globe.tileCacheSize = 1_000;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.saturationShift = -0.42;
      scene.skyAtmosphere.brightnessShift = -0.24;
    }
    scene.fog.enabled = false;
    scene.highDynamicRange = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;

    // A throw inside Cesium's render loop sets useDefaultRenderLoop false and
    // the globe is dead for the rest of the session -- no error on screen, and
    // every later draw silently does nothing. Seen
    // twice from a zero-length rotation axis in the camera controller's zoom
    // path (Camera.rotate -> Quaternion.fromAxisAngle -> Cartesian3.normalize),
    // which is Cesium's own code and not reproducible on demand. Recover a
    // bounded number of times so one bad frame is survivable while a persistent
    // fault still stops and reports itself.
    let recoveries = 0;
    scene.renderError.addEventListener((_scene: unknown, error: unknown) => {
      if (recoveries >= 3) return;
      recoveries += 1;
      console.warn(`Cesium render loop threw; restarting (${recoveries}/3).`, error);
      viewer.useDefaultRenderLoop = true;
    });

    // Full devicePixelRatio is what keeps hairlines sharp, but on a DPR-3 phone
    // that is nine times the fragments of a CSS-pixel canvas, and past 2 the
    // extra sharpness is not visible at arm's length. Cesium computes its pixel
    // ratio as devicePixelRatio * resolutionScale, so divide the cap back out.
    const dpr = window.devicePixelRatio || 1;
    const pixelRatio = Math.min(dpr, 2);
    viewer.resolutionScale = pixelRatio / dpr;
    // Above one device pixel per CSS pixel the render is already supersampled,
    // so MSAA on top is fill cost with nothing to show.
    scene.msaaSamples = pixelRatio > 1 ? 1 : 4;

    const controller = scene.screenSpaceCameraController;
    controller.enableCollisionDetection = false;
    controller.minimumZoomDistance = 250;
    // Detail/focus is a deliberate single-click interaction in this app.
    // Remove Cesium's default double-click camera action.
    viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    viewer.camera.setView({ destination: Cartesian3.fromDegrees(74, 16, 15_000_000) });

    const layerControllers = new Map<string, MapLayerController>();
    for (const layer of MAP_LAYERS) {
      const controller = layer.create({ viewer });
      controller.setVisible(layerVisibilityRef.current[layer.id] ?? layer.defaultVisible);
      layerControllers.set(layer.id, controller);
    }
    layerControllersRef.current = layerControllers;

    const clearFocus = () => {
      focusedEntityRef.current = undefined;
      focusedInfoRef.current = undefined;
      onFocusRef.current(undefined);
    };

    const pickAt = (position: Cartesian2) => scene.pick(position, PICK_PX, PICK_PX)?.id as unknown;
    const isVessel = (id: unknown): id is Entity =>
      id instanceof Entity && id.id.startsWith('ais-') && id.id !== 'ais-focus-halo';

    const clickHandler = new ScreenSpaceEventHandler(scene.canvas);
    clickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const entity = pickAt(movement.position);
      // The halo is intentionally not a second selectable object.
      if (entity instanceof Entity && entity.id === 'ais-focus-halo') return;
      const slickId = slickIdOf(entity);
      if (!isVessel(entity)) {
        clearFocus();
        slickAnchorRef.current = slickId
          ? scene.globe.pick(scene.camera.getPickRay(movement.position)!, scene)
          : undefined;
        onSelectSlickRef.current(slickId);
        return;
      }
      slickAnchorRef.current = undefined;
      onSelectSlickRef.current(undefined);
      onSlickScreenRef.current(undefined);
      const time = viewer.clock.currentTime;
      const mmsi = entity.id.split('-').at(-1) ?? '';
      const vessel = viewer.entities.getById(`ais-ship-${mmsi}`) ?? entity;
      const info: FocusedAisVessel = {
        id: entity.id,
        name: String(vessel.name ?? vessel.id),
        mmsi: String(vessel.properties?.mmsi?.getValue(time) ?? '—'),
        vesselType: String(vessel.properties?.vesselType?.getValue(time) ?? '—'),
        reports: Number(vessel.properties?.reports?.getValue(time) ?? 0),
        routeDuration: String(vessel.properties?.routeDuration?.getValue(time) ?? '—'),
        screen: { x: movement.position.x, y: movement.position.y },
        routeScreen: '',
        occluded: false,
      };
      focusedEntityRef.current = entity;
      focusedInfoRef.current = info;
      onFocusRef.current(info);
    }, ScreenSpaceEventType.LEFT_CLICK);

    /*
     * Ground resolution at a screen point, in metres per pixel.
     *
     * Measured by picking the globe twice, a hundred pixels apart, rather than
     * derived from camera height and field of view. The derivation is only
     * correct looking straight down: tilt the camera and it reports the scale
     * at the centre of a view whose near edge is several times finer. Two
     * picks are correct at any tilt, and they work unchanged in 2D, where
     * there is no field of view to reason about.
     */
    const SPAN_PX = 100;
    const metresPerPixel = (at: Cartesian2) => {
      const here = scene.globe.pick(scene.camera.getPickRay(at)!, scene);
      const there = scene.globe.pick(
        scene.camera.getPickRay(new Cartesian2(at.x + SPAN_PX, at.y))!,
        scene,
      );
      if (!here || !there) return undefined;
      return Cartesian3.distance(here, there) / SPAN_PX;
    };

    // Pointer cursor over anything clickable, and the status bar readout.
    // One pick per frame at most: this runs on every mouse move.
    let hoverAt: Cartesian2 | undefined;
    let hoverFrame = 0;
    clickHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      hoverAt = Cartesian2.clone(movement.endPosition, hoverAt);
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!hoverAt || viewer.isDestroyed()) return;
        const id = pickAt(hoverAt);
        scene.canvas.style.cursor = isVessel(id) || slickIdOf(id) ? 'pointer' : '';

        const ground = scene.globe.pick(scene.camera.getPickRay(hoverAt)!, scene);
        const carto = ground && Cartographic.fromCartesian(ground);
        const mpp = metresPerPixel(hoverAt);
        onReadoutRef.current({
          // Off the globe entirely: say nothing rather than the last position,
          // which would read as a live coordinate that is no longer true.
          latLon: carto
            ? `${degrees(CesiumMath.toDegrees(carto.latitude), 'N', 'S')}  ${degrees(
                CesiumMath.toDegrees(carto.longitude),
                'E',
                'W',
              )}`
            : undefined,
          // 0.28 mm is the OGC standard pixel, which is what makes a
          // representative fraction mean the same thing on any display.
          scale: mpp ? ratio(mpp / 0.00028) : undefined,
        });
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);

    const occluder = new Occluder(new BoundingSphere(Cartesian3.ZERO, Ellipsoid.WGS84.minimumRadius), viewer.camera.positionWC);
    const updateFocusPopup = () => {
      occluder.cameraPosition = viewer.camera.positionWC;

      const anchor = slickAnchorRef.current;
      if (anchor) {
        const at = SceneTransforms.worldToWindowCoordinates(scene, anchor);
        const behind = scene.mode === SceneMode.SCENE3D && !occluder.isPointVisible(anchor);
        const shape = at && !behind ? outlineOnScreen(scene, slickRingsRef.current, occluder) : undefined;
        const next: SlickFocus | undefined =
          at && !behind
            ? {
                x: Math.round(at.x),
                y: Math.round(at.y),
                outline: shape?.rings,
                // Without a drawable outline the slick is a speck, and a disc
                // the size of the fallback one is the box to keep clear of.
                box: shape?.box ?? { x0: at.x - DISC_R, y0: at.y - DISC_R, x1: at.x + DISC_R, y1: at.y + DISC_R },
              }
            : undefined;
        const key = next ? `${next.x},${next.y},${next.outline?.length ?? 0},${Math.round(next.box.x1 - next.box.x0)}` : '';
        // The rings move with the anchor, so the anchor's pixel is enough to
        // tell a moved camera from a still one.
        if (key !== slickAtRef.current) {
          slickAtRef.current = key;
          // flushSync paints in this frame; a queued update visibly trails the camera.
          flushSync(() => onSlickScreenRef.current(next));
        }
      }

      const entity = focusedEntityRef.current;
      const info = focusedInfoRef.current;
      if (!entity || !info) return;
      // Hiding the owning layer drops the selection instead of leaving a popup
      // floating over nothing.
      if (!entity.isShowing) {
        clearFocus();
        return;
      }
      const position = entity.position?.getValue(viewer.clock.currentTime);
      if (!position) return;
      // worldToWindowCoordinates happily projects points on the far side of the globe.
      const screen = SceneTransforms.worldToWindowCoordinates(scene, position);
      const occluded = !screen || (scene.mode === SceneMode.SCENE3D && !occluder.isPointVisible(position));
      const route = viewer.entities.getById(`ais-path-${info.mmsi}`);
      const routePositions = route?.properties?.routePositions?.getValue(viewer.clock.currentTime) as
        | { longitude: number; latitude: number }[]
        | undefined;
      const routeScreen = routePositions?.map(({ longitude, latitude }) => {
        const point = SceneTransforms.worldToWindowCoordinates(scene, Cartesian3.fromDegrees(longitude, latitude, 30));
        return point ? `${point.x},${point.y}` : '';
      }).filter(Boolean).join(' ') ?? '';
      // flushSync paints the spotlight in this same frame; a normal state update
      // lands a frame or more later and visibly trails the camera.
      flushSync(() =>
        onFocusRef.current({ ...info, screen: screen ? { x: screen.x, y: screen.y } : info.screen, routeScreen, occluded }),
      );
    };
    scene.postRender.addEventListener(updateFocusPopup);

    return () => {
      viewerRef.current = null;
      for (const controller of layerControllers.values()) controller.destroy();
      layerControllersRef.current.clear();
      cancelAnimationFrame(hoverFrame);
      clickHandler.destroy();
      scene.postRender.removeEventListener(updateFocusPopup);
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const provider = (url: string) =>
      new UrlTemplateImageryProvider({
        url,
        maximumLevel: basemap.maximumLevel,
        credit: basemap.credit,
        tilingScheme: basemap.geographic ? new GeographicTilingScheme() : undefined,
      });
    const layers = [basemap.url, basemap.labelsUrl]
      .filter((url): url is string => Boolean(url))
      .map((url) => Object.assign(new ImageryLayer(provider(url)), adjustmentsRef.current));
    for (const layer of layers) viewer.imageryLayers.add(layer);
    viewer.scene.requestRender();
    return () => {
      if (viewer.isDestroyed()) return;
      for (const layer of layers) viewer.imageryLayers.remove(layer);
    };
  }, [basemap]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (let index = 0; index < viewer.imageryLayers.length; index += 1) {
      Object.assign(viewer.imageryLayers.get(index), adjustments);
    }
    viewer.scene.requestRender();
  }, [adjustments]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (const layer of MAP_LAYERS) {
      layerControllersRef.current
        .get(layer.id)
        ?.setVisible(layerVisibility[layer.id] ?? layer.defaultVisible);
    }
    viewer.scene.requestRender();
  }, [layerVisibility]);

  // Layout effect: the refs must clear before the next Cesium frame, or
  // postRender would re-announce the vessel that was just closed.
  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // One focus across layers: a vessel id, or 'slick:<id>' for a selected slick.
    const focus = focusedEntityId ?? (selectedSlickId ? `slick:${selectedSlickId}` : undefined);
    for (const controller of layerControllersRef.current.values()) controller.setFocus?.(focus);
    if (!focusedEntityId) {
      focusedEntityRef.current = undefined;
      focusedInfoRef.current = undefined;
    }
    viewer.scene.requestRender();
  }, [focusedEntityId, selectedSlickId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.clock.currentTime = JulianDate.fromDate(new Date(time), viewer.clock.currentTime);
    for (const controller of layerControllersRef.current.values()) controller.setTime?.(time);
    viewer.scene.requestRender();
  }, [time]);

  // Only layers with dated features implement this; the rest ignore it.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    for (const controller of layerControllersRef.current.values()) controller.setTimeMode?.(timeMode);
    viewer.scene.requestRender();
  }, [timeMode]);

  // The rail's date window. Destructured so the effect keys on the two numbers
  // rather than on a tuple identity the parent rebuilds every render.
  const [rangeStart, rangeEnd] = dateRange ?? [];
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const range =
      rangeStart === undefined || rangeEnd === undefined
        ? undefined
        : ([rangeStart, rangeEnd] as [number, number]);
    for (const controller of layerControllersRef.current.values()) controller.setDateRange?.(range);
    viewer.scene.requestRender();
  }, [rangeStart, rangeEnd]);

  const [areaMin, areaMax] = areaRange ?? [];
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const range = areaMin === undefined ? undefined : ([areaMin, areaMax] as [number, number | undefined]);
    for (const controller of layerControllersRef.current.values()) controller.setAreaRange?.(range);
    viewer.scene.requestRender();
  }, [areaMin, areaMax]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const target = mode === '2D' ? SceneMode.SCENE2D : SceneMode.SCENE3D;
    if (viewer.scene.mode === target) return;

    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.9;
    if (target === SceneMode.SCENE2D) viewer.scene.morphTo2D(duration);
    else viewer.scene.morphTo3D(duration);
  }, [mode]);

  return <div ref={hostRef} className="earth-canvas" aria-label="Interactive Earth" />;
}

/** A cube of generated stars: same look as Cesium's default sky, nothing to download. */
function starfield() {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const N = 1024; // generated, so resolution is free; 512 blurs once stretched over the sky
  const face = () => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 1800; i++) {
      const b = rand() ** 4; // mostly faint, a few bright
      g.fillStyle = `rgba(255,255,255,${0.18 + b * 0.8})`;
      g.fillRect(rand() * N, rand() * N, 1, 1);
    }
    return c;
  };
  return new SkyBox({
    sources: { positiveX: face(), negativeX: face(), positiveY: face(), negativeY: face(), positiveZ: face(), negativeZ: face() },
  });
}

export function EarthMap({
  time,
  timeMode = 'all',
  dateRange,
  areaRange,
  onFocusChange,
}: {
  time: number;
  /** What the clock does to dated layers. See SlickTimeMode. */
  timeMode?: SlickTimeMode;
  /** The filter rail's window, epoch ms [start, end). Undefined draws every date. */
  dateRange?: [number, number];
  /** The rail's area window, km²; max undefined means no upper bound. Undefined draws every size. */
  areaRange?: [number, number | undefined];
  /** Fires with the selected entity id, or undefined when selection clears. */
  onFocusChange?: (entityId: string | undefined) => void;
}) {
  const [mode, setMode] = useState<EarthMode>('3D');
  const [basemap, setBasemap] = useState<Basemap>(BASEMAPS[0]);
  const [adjustments, setAdjustments] = useState<ImageryAdjustments>(DEFAULT_ADJUSTMENTS);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, layer.defaultVisible])),
  );
  const [readout, setReadout] = useState<Readout>({});
  const [focusedVessel, setFocusedVessel] = useState<FocusedAisVessel>();
  const [selectedSlickId, setSelectedSlickId] = useState<string>();
  // Set when the demo picks the slick, so the camera goes to it; a click is
  // already looking at what it picked.
  const [flyToSlick, setFlyToSlick] = useState(false);
  useEffect(() => onDemoSelectSlick((id) => {
    setFlyToSlick(true);
    setSelectedSlickId(id);
  }), []);
  const [slickAt, setSlickAt] = useState<SlickFocus>();
  // The selected slick's own rings, in lon/lat. Fetched once per selection and
  // projected every frame, so the spotlight is the shape of the thing rather
  // than a circle near it.
  // One fetch for the selection, not two. The spotlight needs the geometry and
  // the card needs the properties; they are the same record, and fetching it
  // in both places meant two round trips for one click.
  const [slick, setSlick] = useState<SlickFeature | 'error'>();

  useEffect(() => {
    if (!selectedSlickId) {
      setSlick(undefined);
      return;
    }
    let current = true;
    // Deliberately not cleared first. Clearing unmounts the backdrop and the
    // card for however long the next record takes, and clicking from one slick
    // straight to another then reads as a flash rather than as a move. The
    // outgoing record holds the highlight in place until the incoming one
    // replaces it, which is how the vessel selection behaves.
    fetchSlick(selectedSlickId)
      .then((feature) => current && setSlick(feature))
      .catch(() => current && setSlick('error'));
    return () => {
      current = false;
    };
  }, [selectedSlickId]);

  const record = slick && slick !== 'error' ? slick : undefined;
  const slickRings = useMemo(() => ringsOf(record?.geometry ?? null), [record]);
  const slickCentroid = useMemo(() => {
    const centroid = record?.properties.centroid;
    return Array.isArray(centroid) && typeof centroid[0] === 'number' && typeof centroid[1] === 'number'
      ? ([centroid[0], centroid[1]] as [number, number])
      : undefined;
  }, [record]);
  // Closed by default: basemap and imagery adjustments are set once and then
  // left alone, so the panel spent the rest of the session covering the chart.
  const [styleOpen, setStyleOpen] = useState(false);
  const focusedId = focusedVessel?.id;
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  useEffect(() => onFocusChangeRef.current?.(focusedId), [focusedId]);

  const setAdjustment = (key: keyof ImageryAdjustments, value: number) =>
    setAdjustments((current) => ({ ...current, [key]: value }));

  // Carried on the legend so folding it away never hides that a layer is off.
  const shownLayers = MAP_LAYERS.filter(
    (layer) => layerVisibility[layer.id] ?? layer.defaultVisible,
  ).length;

  const showFocus = focusedVessel && !focusedVessel.occluded;

  /*
   * The hole in the backdrop: the focused vessel with its route, or the
   * selected slick's own shape, or the disc a speck-sized slick falls back to.
   */
  const cutout = showFocus ? (
    <>
      <polyline
        points={focusedVessel.routeScreen}
        fill="none"
        stroke="black"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <circle cx={focusedVessel.screen.x} cy={focusedVessel.screen.y} r="48" fill="black" />
    </>
  ) : selectedSlickId && slickAt && slick ? (
    slickAt.outline ? (
      // Stroked as well as filled: half the stroke falls outside the ring,
      // which is the ring of clear water that makes the shape read as lit
      // rather than cut out. 28 matches the vessel route's 22 optically, a
      // closed shape needing a little more air than a line.
      slickAt.outline.map((points, ring) => (
        <polygon key={ring} points={points} fill="black" stroke="black" strokeWidth="28" strokeLinejoin="round" />
      ))
    ) : (
      <circle cx={slickAt.x} cy={slickAt.y} r={DISC_R} fill="black" />
    )
  ) : null;

  /*
   * A selection that is still loading has no hole to show yet. Rather than
   * drop the backdrop for those few frames -- which is the flash -- the
   * outgoing hole stays until the incoming one is ready. When nothing is
   * selected at all, both go.
   */
  const lastCutout = useRef<ReactNode>(null);
  useEffect(() => {
    if (cutout) lastCutout.current = cutout;
  }, [cutout]);
  const shownCutout = cutout ?? (selectedSlickId || showFocus ? lastCutout.current : null);

  /*
   * The card does the same. Clicking a vessel from a slick swaps both in one
   * commit, but the other way round the slick's record has to arrive first,
   * and the vessel card was unmounting into those two frames. It holds until
   * the slick card is ready to take its place.
   */
  const slickReady = Boolean(selectedSlickId && slickAt && slick);
  const heldVessel = useRef(focusedVessel);
  useEffect(() => {
    if (focusedVessel) heldVessel.current = focusedVessel;
  }, [focusedVessel]);
  const handoverVessel = !showFocus && selectedSlickId && !slickReady ? heldVessel.current : undefined;
  const shownVessel = showFocus ? focusedVessel : handoverVessel;

  return (
    <div className="earth-map">
      <EarthCanvas
        time={time}
        mode={mode}
        basemap={basemap}
        adjustments={adjustments}
        layerVisibility={layerVisibility}
        focusedEntityId={focusedVessel?.id}
        onFocus={setFocusedVessel}
        selectedSlickId={selectedSlickId}
        onSelectSlick={(id) => {
          setFlyToSlick(false);
          setSelectedSlickId(id);
          setSlickAt(undefined);
        }}
        onSlickScreen={setSlickAt}
        slickRings={slickRings}
        slickCentroid={slickCentroid}
        flyToSlick={flyToSlick}
        onReadout={setReadout}
        timeMode={timeMode}
        dateRange={dateRange}
        areaRange={areaRange}
      />

      {/* One backdrop for both kinds of selection.
        *
        * Two overlays, each mounted with its own selection, meant that
        * clicking a slick while a vessel was focused -- or the reverse --
        * unmounted one and mounted the other, and the frames in between read
        * as a flash. This one stays mounted for as long as anything is
        * selected; only the hole in it changes. */}
      {shownCutout && (
        <svg className="entity-dim" aria-hidden="true">
          <defs>
            <mask id="focus-mask">
              <rect width="100%" height="100%" fill="white" />
              {shownCutout}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(1,5,10,.58)" mask="url(#focus-mask)" />
        </svg>
      )}

      {/* Anchored to the slick, like the vessel card: a detail popup belongs
        * beside the thing it describes, not in a corner the eye has to travel
        * to. Clamped in CSS so a slick near an edge never pushes it out, and
        * dropped entirely while the slick is behind the globe. */}
      {selectedSlickId && slickAt && slick && (
        <SlickCard
          slickId={selectedSlickId}
          slick={slick}
          at={slickAt}
          onClose={() => setSelectedSlickId(undefined)}
        />
      )}

      {shownVessel && (
        <aside
          className="entity-focus"
          aria-label={`Selected vessel ${shownVessel.name}`}
          // Clamped in CSS so a vessel near the map edge never pushes the card out.
          style={{
            left: `min(${shownVessel.screen.x + 28}px, calc(100% - 252px))`,
            top: `clamp(110px, ${shownVessel.screen.y}px, calc(100% - 110px))`,
          }}
        >
          <button type="button" aria-label="Close vessel details" onClick={() => setFocusedVessel(undefined)}>×</button>
          <p>AIS vessel · playback paused</p>
          <h2>{shownVessel.name}</h2>
          <dl>
            <div><dt>MMSI</dt><dd>{shownVessel.mmsi}</dd></div>
            <div><dt>Type</dt><dd>{shownVessel.vesselType}</dd></div>
            <div><dt>Reports</dt><dd>{shownVessel.reports}</dd></div>
            <div><dt>Route window</dt><dd>{shownVessel.routeDuration}</dd></div>
          </dl>
        </aside>
      )}

      <nav className="earth-projection" aria-label="Projection">
        <Segmented
          label="Projection"
          value={mode}
          onChange={setMode}
          options={PROJECTIONS}
        />
      </nav>

      {!styleOpen && (
        <div className="earth-style-open">
          <IconButton label="Map style" onClick={() => setStyleOpen(true)}>
            <SlidersHorizontal size={15} strokeWidth={2.25} />
          </IconButton>
        </div>
      )}

      {styleOpen && (
      <section className="earth-panel" aria-label="Map style">
        <header className="earth-panel-head">
          <h2>Map style</h2>
          <IconButton label="Close map style" onClick={() => setStyleOpen(false)}>
            <X size={15} strokeWidth={2.25} />
          </IconButton>
        </header>
        <Select
          label="Basemap"
          value={basemap.id}
          options={BASEMAP_OPTIONS}
          onChange={(id) => setBasemap(BASEMAPS.find((option) => option.id === id) ?? BASEMAPS[0])}
        />
        <div className="earth-adjustments">
          {ADJUSTMENTS.map(([key, label, min, max]) => (
            <Slider
              key={key}
              label={label}
              min={min}
              max={max}
              value={adjustments[key]}
              onChange={(value) => setAdjustment(key, value)}
            />
          ))}
        </div>
        <Button className="earth-reset" onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}>
          Reset to defaults
        </Button>

        {/*
          * Attribution lives with the basemap picker rather than floating on
          * the chart. It cannot simply be deleted: EOX's Sentinel-2 is
          * CC BY-NC-SA and NASA GIBS asks for credit, so the notice is a
          * condition of using those tiles, not decoration. Here it is off the
          * map, next to the control that chooses what it describes, and it
          * changes when you change basemap.
          */}
        <p className="earth-credit">{basemap.credit}</p>
      </section>
      )}

      {/* The same legend the other surfaces use. A legend answers "what am I
        * looking at", which is a question about the mark under the cursor, so
        * it lives on the chart rather than in a side menu. */}
      <MapLegend shown={shownLayers} total={MAP_LAYERS.length}>
        {MAP_LAYERS.map((layer) => (
          <Toggle
            key={layer.id}
            dense
            label={layer.label}
            description={layer.description}
            value={layer.value}
            swatch={<LayerSwatch kind={layer.swatch} />}
            checked={layerVisibility[layer.id] ?? layer.defaultVisible}
            onChange={(checked) =>
              setLayerVisibility((current) => ({ ...current, [layer.id]: checked }))
            }
          />
        ))}
      </MapLegend>

      {/*
        * Where the cursor is and how big things are: the two facts that are
        * continuously true of the view rather than of any selection, which is
        * what this strip is for. An operator reads a coordinate off it
        * mid-sentence on a radio call.
        *
        * An em dash before the pointer has ever been over the globe, and
        * whenever it leaves it. Holding the last position would read as a
        * live coordinate that is no longer true.
        */}
      <MapStatusBar
        items={[
          { label: 'lat/lon', value: readout.latLon ?? '—' },
          { label: 'scale', value: readout.scale ?? '—' },
        ]}
      />
    </div>
  );
}
