import {
  ArcType,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  type Viewer,
} from 'cesium';
import type { MapLayerController, MapLayerDefinition } from './types';

import { token } from '../design/token';
const WIND_COLOR = Color.fromCssColorString(token('--neutral-100-g'));
const CURRENT_COLOR = Color.fromCssColorString(token('--cyan-200')).withAlpha(0.68);
const FLOW_HEIGHT_METERS = 8_000;
const FLOW_STEPS = 6;

function wrapLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

/** Deterministic synthetic U/V field until a real vector dataset is connected. */
function sampleFlow(longitude: number, latitude: number, seed: number) {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const phase = seed * 0.017;
  const east = Math.cos(lat * 2.4 + phase) * 0.7 + Math.sin(lon * 2.1 - phase) * 0.5;
  const north = Math.sin(lon * 1.7 + lat * 1.3 + phase) * 0.52 + Math.cos(lat * 3.2 - phase) * 0.25;

  return {
    direction: Math.atan2(north, east),
    length: 1.7 + Math.abs(east) * 1.25 + Math.abs(north) * 0.8,
    bend: Math.sin(lon * 2.8 - lat * 1.6 + phase) * 0.38,
  };
}

/**
 * Builds a flow field as batched static primitives: one draw call per geometry
 * type, compiled once on Cesium's workers. A PolylineCollection with thousands
 * of lines re-sorts and re-hashes every line's material on every frame, which
 * is what made the globe stutter while the AIS clock kept it rendering.
 */
function buildFlowField(seed: number, color: Color, width: number, gridDegrees: number, withArrows: boolean) {
  const colorAttribute = ColorGeometryInstanceAttribute.fromColor(color);
  const translucent = color.alpha < 1;
  const shafts: GeometryInstance[] = [];
  const heads: GeometryInstance[] = [];

  for (let latitude = -75; latitude <= 75; latitude += gridDegrees) {
    for (let longitude = -180; longitude < 180; longitude += gridDegrees) {
      const { direction, length, bend } = sampleFlow(longitude, latitude, seed);
      const latitudeDelta = Math.sin(direction) * length;
      const longitudeDelta =
        (Math.cos(direction) * length) /
        Math.max(Math.cos((latitude * Math.PI) / 180), 0.3);
      const positions: number[] = [];
      const curve = withArrows ? 0 : bend;

      // Multiple short segments follow outside the ellipsoid. A single long
      // chord can pass beneath the globe and be depth-clipped while zooming.
      for (let step = 0; step <= FLOW_STEPS; step += 1) {
        const progress = step / FLOW_STEPS;
        positions.push(
          wrapLongitude(longitude + longitudeDelta * progress),
          Math.max(
            -84,
            Math.min(84, latitude + latitudeDelta * progress + Math.sin(progress * Math.PI) * curve),
          ),
          FLOW_HEIGHT_METERS,
        );
      }

      shafts.push(
        new GeometryInstance({
          geometry: new PolylineGeometry({
            positions: Cartesian3.fromDegreesArrayHeights(positions),
            width,
            arcType: ArcType.NONE,
            vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: colorAttribute },
        }),
      );

      if (!withArrows) continue;

      const tipLongitude = wrapLongitude(longitude + longitudeDelta);
      const tipLatitude = Math.max(-84, Math.min(84, latitude + latitudeDelta));
      const arrowLength = Math.min(0.42, length * 0.22);
      const latitudeScale = Math.max(Math.cos((tipLatitude * Math.PI) / 180), 0.3);
      const arrowPoint = (angle: number) => [
        wrapLongitude(tipLongitude + (Math.cos(angle) * arrowLength) / latitudeScale),
        Math.max(-84, Math.min(84, tipLatitude + Math.sin(angle) * arrowLength)),
        FLOW_HEIGHT_METERS,
      ];

      heads.push(
        new GeometryInstance({
          geometry: PolygonGeometry.fromPositions({
            positions: Cartesian3.fromDegreesArrayHeights([
              ...arrowPoint(direction + Math.PI - 0.52),
              tipLongitude,
              tipLatitude,
              FLOW_HEIGHT_METERS,
              ...arrowPoint(direction + Math.PI + 0.52),
            ]),
            perPositionHeight: true,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: colorAttribute },
        }),
      );
    }
  }

  const primitives = [
    new Primitive({
      geometryInstances: shafts,
      appearance: new PolylineColorAppearance({ translucent }),
      allowPicking: false,
    }),
  ];
  if (heads.length > 0) {
    primitives.push(
      new Primitive({
        geometryInstances: heads,
        appearance: new PerInstanceColorAppearance({ flat: true, faceForward: true, translucent }),
        allowPicking: false,
      }),
    );
  }
  return primitives;
}

function primitiveLayer(viewer: Viewer, primitives: Primitive[]): MapLayerController {
  for (const primitive of primitives) viewer.scene.primitives.add(primitive);
  return {
    setVisible(visible) {
      for (const primitive of primitives) primitive.show = visible;
    },
    destroy() {
      for (const primitive of primitives) viewer.scene.primitives.remove(primitive);
    },
  };
}

export const windLayer = {
  id: 'wind',
  label: 'Wind',
  description: 'Synthetic surface vectors · 1,560 arrows',
  value: 'synthetic',
  swatch: 'wind',
  // Synthetic placeholder: off until real forcing is connected.
  defaultVisible: false,
  create: ({ viewer }) => primitiveLayer(viewer, buildFlowField(91, WIND_COLOR, 1.25, 6, true)),
} satisfies MapLayerDefinition;

export const currentsLayer = {
  id: 'currents',
  label: 'Ocean currents',
  description: 'Synthetic surface streamlines · 2,232 traces',
  value: 'synthetic',
  swatch: 'wind',
  // Synthetic placeholder: off until real forcing is connected.
  defaultVisible: false,
  create: ({ viewer }) => primitiveLayer(viewer, buildFlowField(7_301, CURRENT_COLOR, 0.85, 5, false)),
} satisfies MapLayerDefinition;
