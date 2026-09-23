/**
 * The investigation chart, as a Cesium viewer.
 *
 * This replaced an inline-SVG chart that drew the same marks over plain tile images.
 * That chart owned its own projection, camera and pan/zoom, all of which a
 * globe already has. What forced the change is the forecast: a drift run is a
 * thickness field per frame on a moving lat/lon rectangle, and an SVG chart
 * can only show that by rasterising it by hand every frame. Cesium takes it as
 * a texture.
 *
 * It keeps the old chart's props exactly, so the six stages did not change
 * when it was swapped in: an extent, layers of claim-tagged shapes, an
 * optional scene image, an overlay.
 *
 * SCENE2D on purpose. Every subject here is one slick over open water a few km
 * across, and a tilted globe adds foreshortening to a picture whose whole job
 * is that lengths and bearings read true. `EarthMap` is the globe.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  GeometryInstance,
  ImageryLayer,
  Ion,
  Material,
  MaterialAppearance,
  Primitive,
  PolylineDashMaterialProperty,
  Rectangle,
  RectangleGeometry,
  SceneMode,
  ShadowMode,
  SingleTileImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium';
import { Advanced, CLAIM_STROKE, Switch } from '../../design/components';
import { CODE_RGBA } from '../../forecast/palette';
import type { RunFrame } from '../../forecast/types';
import { toneCss, type Extent, type MapImage, type MapLayer, type Shape } from './chart-types';

Ion.defaultAccessToken = '';

/* The same keyless ocean base the SVG chart used, so the ground did not change
 * appearance when the renderer over it did. */
const TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';
const LABEL_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}';
const TILE_CREDIT = 'Esri, GEBCO, NOAA, Garmin, HERE';
/* Esri's ocean base carries real bathymetry to about zoom 10 and serves a "map
 * data not yet available" placeholder past it. Cesium is allowed further and
 * upsamples, rather than drawing that sentence across the sea. */
const MAX_LEVEL = 10;

const EDGE = 0.18; // the subject never runs to the frame

const rectOf = (extent: Extent) => Rectangle.fromDegrees(extent[0], extent[1], extent[2], extent[3]);

/** The extent with room around it, so a slick is not drawn against an edge. */
function padded(extent: Extent): Rectangle {
  const [w, s, e, n] = extent;
  const dx = Math.max((e - w) * EDGE, 0.002);
  const dy = Math.max((n - s) * EDGE, 0.002);
  return Rectangle.fromDegrees(w - dx, s - dy, e + dx, n + dy);
}

/** Metres per degree of longitude here, for the axis mark. */
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

export function CesiumChart({
  extent,
  layers,
  image,
  field,
  caption,
  overlay,
}: {
  extent: Extent;
  layers: readonly MapLayer[];
  /** A scene drawn between the basemap and the marks. */
  image?: MapImage;
  /**
   * A modelled thickness field — a forecast frame.
   *
   * Kept apart from `image` because the lifecycles differ: a scene loads once
   * and stays, while this is replaced many times a second as the clock plays.
   */
  field?: RunFrame;
  /** What the chart shows, in one line. Its accessible name; not drawn. */
  caption?: string;
  /** Chips and readouts the stage wants pinned to the chart. */
  overlay?: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [moved, setMoved] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...layers, ...(image ? [image] : [])].filter((l) => l.defaultVisible === false).map((l) => [l.id, true]),
    ),
  );

  /*
   * One viewer for the life of the chart. Every widget is off: this surface
   * supplies its own controls, and Cesium's own timeline would sit under the
   * forecast's own.
   */
  useEffect(() => {
    if (!host.current) return;
    const view = new Viewer(host.current, {
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
      baseLayer: new ImageryLayer(new UrlTemplateImageryProvider({ url: TILE_URL, maximumLevel: MAX_LEVEL })),
      sceneMode: SceneMode.SCENE2D,
      shadows: false,
      terrainShadows: ShadowMode.DISABLED,
      requestRenderMode: true,
      useBrowserRecommendedResolution: false,
    });
    viewer.current = view;
    view.clock.shouldAnimate = false;
    view.scene.backgroundColor = Color.fromCssColorString('#0a1420');
    view.scene.globe.showGroundAtmosphere = false;
    view.scene.globe.baseColor = Color.fromCssColorString('#0a1420');
    view.imageryLayers.add(
      new ImageryLayer(new UrlTemplateImageryProvider({ url: LABEL_URL, maximumLevel: MAX_LEVEL })),
    );
    // 2D has no tilt to offer and no look to use.
    view.scene.screenSpaceCameraController.enableTilt = false;
    view.scene.screenSpaceCameraController.enableLook = false;
    setReady(true);
    return () => {
      if (!view.isDestroyed()) view.destroy();
      viewer.current = undefined;
    };
  }, []);

  const home = useMemo(() => padded(extent), [extent]);

  /* Frame the subject. A new subject is a new framing. */
  useEffect(() => {
    const view = viewer.current;
    if (!view || view.isDestroyed()) return;
    view.camera.setView({ destination: home });
    setMoved(false);
  }, [home, ready]);

  /*
   * Whether the operator has left the subject.
   *
   * Taken from their gestures on the canvas, not from the camera: `moveEnd`
   * fires for our own framing too, and fires late enough that no amount of
   * deferring the listener tells the two apart. A drag or a wheel over the
   * chart is unambiguous, and it is the question Recentre actually asks.
   */
  useEffect(() => {
    const canvas = viewer.current?.canvas;
    if (!canvas) return;
    const leave = () => setMoved(true);
    canvas.addEventListener('pointerdown', leave);
    canvas.addEventListener('wheel', leave, { passive: true });
    return () => {
      canvas.removeEventListener('pointerdown', leave);
      canvas.removeEventListener('wheel', leave);
    };
  }, [ready]);

  /* The scene image, as its own imagery layer on its own rectangle. */
  useEffect(() => {
    const view = viewer.current;
    if (!view || view.isDestroyed() || !image || hidden[image.id]) return;
    let layer: ImageryLayer | undefined;
    let dropped = false;
    void SingleTileImageryProvider.fromUrl(image.url, { rectangle: rectOf(image.extent) })
      .then((provider) => {
        if (dropped || view.isDestroyed()) return;
        layer = new ImageryLayer(provider);
        view.imageryLayers.add(layer);
        view.scene.requestRender();
      })
      .catch(() => {
        // A scene that will not load is the catalog's answer, not an error to
        // throw here; the stage already prints why when it knows.
      });
    return () => {
      dropped = true;
      if (layer && !view.isDestroyed()) view.imageryLayers.remove(layer);
    };
  }, [image, hidden, ready]);

  /*
   * The modelled slick: one rectangle, one texture.
   *
   * The frame's byte codes go through the palette table into a canvas, and the
   * canvas is handed to the material. Two canvases alternate because the
   * material re-uploads only when its image changes identity; it swaps the
   * texture after the new one is on the GPU, so the slick never blinks. No
   * image encoding, no imagery-layer reload: a scrub tick is one texImage2D.
   *
   * The rectangle does not follow the frame's extent. Each frame is drawn at
   * its place inside one fixed rectangle, which is rebuilt, with room to
   * spare, only when a frame falls outside it. Rebuilding it synchronously
   * whenever the solver allocated or freed a block was a visible stall.
   */
  const slick = useRef<{
    canvases: [HTMLCanvasElement, HTMLCanvasElement];
    turn: number;
    material: Material;
    scratch: Scratch;
    primitive?: Primitive;
    extent?: Extent;
  }>(undefined);
  useEffect(() => {
    const view = viewer.current;
    if (!view || view.isDestroyed()) return;
    const state = slick.current;
    if (!field || field.codes.length === 0) {
      if (state?.primitive) view.scene.primitives.remove(state.primitive);
      if (state) {
        state.primitive = undefined;
        state.extent = undefined;
      }
      view.scene.requestRender();
      return;
    }
    const s = (slick.current ??= {
      canvases: [document.createElement('canvas'), document.createElement('canvas')],
      turn: 0,
      material: Material.fromType('Image', { image: Material.DefaultImageId }),
      scratch: { canvas: document.createElement('canvas') },
    });
    const grown = !s.extent || !contains(s.extent, field);
    if (grown) s.extent = around(s.extent, field);
    const extent = s.extent!;
    const canvas = s.canvases[(s.turn ^= 1)];
    paint(canvas, s.scratch, field, extent, grown);
    s.material.uniforms.image = canvas;

    if (grown || !s.primitive) {
      const next = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: new RectangleGeometry({
            rectangle: rectOf(extent),
            vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
          }),
        }),
        appearance: new MaterialAppearance({
          material: s.material,
          materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
          translucent: true,
          flat: true,
        }),
        asynchronous: false,
      });
      // Under the marks: the outline stays readable over the oil.
      view.scene.primitives.add(next, 0);
      if (s.primitive) view.scene.primitives.remove(s.primitive);
      s.primitive = next;
    }
    view.scene.requestRender();
    // The material uploads its new canvas during that render and shows it on
    // the next. An animation supplies the next render itself; a single frame
    // (a finished result) would never be drawn without this one.
    // A timer, not requestAnimationFrame: that can land in the same frame as
    // the render above and merge into it.
    const again = setTimeout(() => {
      if (!view.isDestroyed()) view.scene.requestRender();
    }, 120);
    return () => clearTimeout(again);
  }, [field, ready]);

  // The slick goes with the chart, not with the next record's first frame.
  useEffect(
    () => () => {
      const view = viewer.current;
      const s = slick.current;
      if (view && !view.isDestroyed() && s?.primitive) view.scene.primitives.remove(s.primitive);
      slick.current = undefined;
    },
    [],
  );

  /*
   * The marks. Rebuilt whole whenever they change: a stage hands over a few
   * dozen shapes, and diffing them would cost more than redrawing them.
   */
  useEffect(() => {
    const view = viewer.current;
    if (!view || view.isDestroyed()) return;
    view.entities.removeAll();
    for (const layer of layers) {
      if (hidden[layer.id]) continue;
      for (const shape of layer.shapes) draw(view, shape, layer);
    }
    view.scene.requestRender();
  }, [layers, hidden, ready]);

  const shown = layers.filter((layer) => !hidden[layer.id]);

  return (
    <div className="imap" role="group" aria-label={caption ?? 'Investigation chart'}>
      <div className="imap-host" ref={host} />

      {overlay}

      {moved && (
        <button
          type="button"
          className="imap-recentre"
          onClick={() => {
            viewer.current?.camera.flyTo({ destination: home, duration: 0.4 });
            setMoved(false);
          }}
        >
          Recentre
        </button>
      )}

      <div className="imap-layers">
        <Advanced label="Layers" count={shown.length + (image && !hidden[image.id] ? 1 : 0)} defaultOpen={false}>
          {image && (
            <Switch
              label={image.label}
              checked={!hidden[image.id]}
              onChange={(next) => setHidden((current) => ({ ...current, [image.id]: !next }))}
            />
          )}
          {layers.map((layer) => (
            <Switch
              key={layer.id}
              label={layer.label}
              checked={!hidden[layer.id]}
              onChange={(next) => setHidden((current) => ({ ...current, [layer.id]: !next }))}
              value={
                <span className="imap-claim">
                  <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true">
                    <line
                      x1="0"
                      y1="4"
                      x2="14"
                      y2="4"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeDasharray={CLAIM_STROKE[layer.claim] === 'none' ? undefined : CLAIM_STROKE[layer.claim]}
                    />
                  </svg>
                </span>
              }
            />
          ))}
        </Advanced>
      </div>

      <p className="imap-credit">{TILE_CREDIT}</p>
    </div>
  );
}

/**
 * One shape, as entities.
 *
 * The claim decides the dash and the tone the hue, the same pairing the SVG
 * chart drew and the badges use. Cesium's dashed material takes a 16-bit
 * pattern rather than SVG's dash array, so the two patterns are named here
 * against the same claims instead of being translated.
 */
const CLAIM_DASH: Record<string, number | undefined> = {
  observed: undefined,
  reconstructed: 0xf0f0,
  predicted: 0xcccc,
};

function draw(view: Viewer, shape: Shape, layer: MapLayer) {
  const stroke = Color.fromCssColorString(toneCss(shape.tone));
  const dash = CLAIM_DASH[layer.claim];
  const material = dash === undefined ? stroke : new PolylineDashMaterialProperty({ color: stroke, dashPattern: dash });

  switch (shape.kind) {
    case 'polygon':
      for (const ring of shape.rings) {
        const positions = Cartesian3.fromDegreesArray([...ring, ring[0]].flat());
        view.entities.add({
          polygon: {
            hierarchy: Cartesian3.fromDegreesArray(ring.flat()),
            material: stroke.withAlpha(0.2),
            outline: false,
          },
          polyline: {
            positions,
            width: 7,
            material: Color.fromCssColorString('#07131e').withAlpha(0.96),
          },
        });
        view.entities.add({
          polyline: {
            positions,
            width: 3.5,
            material,
          },
        });
      }
      return;

    case 'path':
      view.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray(shape.points.flatMap((p) => [p.lon, p.lat])),
          width: shape.width ?? 2,
          material,
        },
      });
      return;

    case 'circle':
      view.entities.add({
        position: Cartesian3.fromDegrees(shape.centre.lon, shape.centre.lat),
        ellipse: {
          semiMajorAxis: shape.radiusKm * 1000,
          semiMinorAxis: shape.radiusKm * 1000,
          material: Color.TRANSPARENT,
          outline: true,
          outlineColor: stroke,
          outlineWidth: 2,
          height: 0,
        },
      });
      return;

    case 'point':
      view.entities.add({
        position: Cartesian3.fromDegrees(shape.at.lon, shape.at.lat),
        point: {
          pixelSize: (shape.radius ?? 3.5) * 2,
          color: stroke,
          outlineColor: Color.fromCssColorString('#06111b'),
          outlineWidth: 3,
        },
      });
      return;

    case 'dimension': {
      const at = (alongM: number, acrossM: number) => {
        const rad = (shape.bearingDeg * Math.PI) / 180;
        // Along the bearing, then square to it: east and north components of each.
        const east = alongM * Math.sin(rad) + acrossM * Math.cos(rad);
        const north = alongM * Math.cos(rad) - acrossM * Math.sin(rad);
        return [shape.at.lon + east / mPerDegLon(shape.at.lat), shape.at.lat + north / 111_320];
      };
      const half = (shape.lengthKm * 1000) / 2;
      const tick = Math.max(shape.lengthKm * 1000 * 0.06, 15);
      view.entities.add({ polyline: { positions: Cartesian3.fromDegreesArray([...at(-half, 0), ...at(half, 0)]), width: 1.5, material } });
      for (const end of [-half, half]) {
        view.entities.add({ polyline: { positions: Cartesian3.fromDegreesArray([...at(end, -tick), ...at(end, tick)]), width: 1.5, material: stroke } });
      }
      // On the chart, so a chip (DESIGN.md §6): the map-chip ground and ink, read from the tokens.
      const css = getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
      view.entities.add({
        // At the line's far end, not its middle: two dimensions share a centre.
        position: Cartesian3.fromDegrees(...(at(half, 0) as [number, number])),
        label: {
          text: shape.label,
          font: `500 12px ${token('--font-sans', 'sans-serif')}`,
          fillColor: Color.fromCssColorString(token('--map-ink', '#ffffff')),
          showBackground: true,
          backgroundColor: Color.fromCssColorString(token('--map-chip', '#1c2c30')),
          backgroundPadding: new Cartesian2(8, 5),
          pixelOffset: new Cartesian2(0, -14),
        },
      });
      return;
    }

  }
}

const RGBA = new Uint32Array(CODE_RGBA.buffer);

/** Longest side of the fixed canvas, pixels. */
const CANVAS_MAX = 2048;

/** The frame at its own size, and the pixel buffer reused to fill it. */
interface Scratch {
  canvas: HTMLCanvasElement;
  image?: ImageData;
}

const contains = (e: Extent, f: RunFrame) => f.west >= e[0] && f.south >= e[1] && f.east <= e[2] && f.north <= e[3];

/** The union of the old rectangle and the frame, padded by half its size so the next few frames fit too. */
function around(e: Extent | undefined, f: RunFrame): Extent {
  const w = Math.min(e?.[0] ?? f.west, f.west), s = Math.min(e?.[1] ?? f.south, f.south);
  const east = Math.max(e?.[2] ?? f.east, f.east), n = Math.max(e?.[3] ?? f.north, f.north);
  const dx = (east - w) / 4, dy = (n - s) / 4;
  return [w - dx, Math.max(-89.9, s - dy), east + dx, Math.min(89.9, n + dy)];
}

/**
 * A frame's codes, coloured, drawn at its place inside the fixed rectangle.
 * The canvas is sized once per rectangle, at the density of the frame that
 * made it, so a later, smaller frame is not blurred by a coarser canvas.
 */
function paint(canvas: HTMLCanvasElement, scratch: Scratch, frame: RunFrame, e: Extent, grown: boolean) {
  const spanX = e[2] - e[0], spanY = e[3] - e[1];
  if (grown) {
    const perDeg = Math.max(frame.width / (frame.east - frame.west), frame.height / (frame.north - frame.south));
    const scale = Math.min(perDeg, CANVAS_MAX / Math.max(spanX, spanY));
    canvas.width = Math.max(1, Math.round(spanX * scale));
    canvas.height = Math.max(1, Math.round(spanY * scale));
  }
  const context = canvas.getContext('2d');
  const small = scratch.canvas.getContext('2d');
  if (!context || !small) return;
  if (scratch.canvas.width !== frame.width || scratch.canvas.height !== frame.height) {
    scratch.canvas.width = frame.width;
    scratch.canvas.height = frame.height;
    scratch.image = undefined;
  }
  const image = (scratch.image ??= small.createImageData(frame.width, frame.height));
  const out = new Uint32Array(image.data.buffer);
  const codes = frame.codes;
  for (let i = 0; i < codes.length; i++) out[i] = RGBA[codes[i]];
  small.putImageData(image, 0, 0);

  context.clearRect(0, 0, canvas.width, canvas.height);
  // The codes are bands, not a gradient: blending neighbours would invent thicknesses.
  context.imageSmoothingEnabled = false;
  const kx = canvas.width / spanX, ky = canvas.height / spanY;
  context.drawImage(
    scratch.canvas,
    (frame.west - e[0]) * kx,
    (e[3] - frame.north) * ky,
    (frame.east - frame.west) * kx,
    (frame.north - frame.south) * ky,
  );
}
