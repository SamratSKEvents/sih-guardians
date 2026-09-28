import {
  CallbackProperty,
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  JulianDate,
  NearFarScalar,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
} from 'cesium';
import type { MapLayerDefinition } from './types';
import { loadSlickVessels } from './slickVessels';

import { token } from '../design/token';
/**
 * Time span shown before the slick catalog's own window loads. Spills replaces
 * it with the catalog's extent as soon as that resolves.
 */
export const AIS_DEMO_WINDOW = {
  start: Date.UTC(2026, 0, 16),
  end: Date.UTC(2026, 2, 15),
};

const VESSEL_COLORS = [Color.CYAN, Color.ORANGE, Color.LIME];
const TRACK_COLOR = Color.fromCssColorString(token('--orange-200-i'));

const AIS_FOCUS_STYLE = {
  haloColor: Color.WHITE,
  haloSize: 52,
  selectedPathColor: Color.fromCssColorString(token('--amber-100-d')),
  selectedPathWidth: 8,
  normalPathWidth: 2,
};

function shipIcon(color: Color) {
  const fill = color.toCssColorString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 3C21 9 13 22 13 39c0 10 7 18 19 22 12-4 19-12 19-22C51 22 43 9 32 3Z" fill="white" stroke=token('--neutral-800-m') stroke-width="6" stroke-linejoin="round"/><path d="M32 13c-7 6-11 15-11 25 0 6 4 11 11 14 7-3 11-8 11-14 0-10-4-19-11-25Z" fill="${fill}" stroke=token('--neutral-800-m') stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

type Added = ReturnType<import('cesium').EntityCollection['add']>;

export const aisDemoLayer = {
  id: 'ais-demo',
  label: 'AIS vessels',
  description:
    'Top suspect vessels for each of the 20 investigated slicks: real AIS for the Gulf of Kutch, the ' +
    'investigation traffic picture elsewhere. A ship moves along its reports and waits at either end outside them.',
  value: 'slicks',
  swatch: 'ais',
  defaultVisible: true,
  create: ({ viewer }) => {
    const tracks: { entity: Added; solid: ColorMaterialProperty; dash: PolylineDashMaterialProperty; focus: PolylineGlowMaterialProperty; fadedSolid: ColorMaterialProperty; fadedDash: PolylineDashMaterialProperty }[] = [];
    const entities: Added[] = [];
    const haloNormal = new Cartesian3();
    const haloOffset = new Cartesian3();
    const scratch = new JulianDate();
    let destroyed = false;
    let visible = true;
    let focusedEntityId: string | undefined;

    let styleKey = '';
    const updateTrackStyle = () => {
      const zoomedOut = viewer.camera.positionCartographic.height > 3_500_000;
      // camera.changed fires on every pan; new properties force Cesium to rebuild paths.
      if (`${zoomedOut}|${focusedEntityId}|${tracks.length}` === styleKey) return;
      styleKey = `${zoomedOut}|${focusedEntityId}|${tracks.length}`;
      const focusedMmsi = focusedEntityId?.split('-').at(-1);
      for (const track of tracks) {
        const isFocused = Boolean(focusedMmsi && track.entity.id.endsWith(focusedMmsi));
        const faded = Boolean(focusedEntityId && !isFocused);
        if (!track.entity.polyline) continue;
        track.entity.polyline.width = new ConstantProperty(isFocused ? AIS_FOCUS_STYLE.selectedPathWidth : AIS_FOCUS_STYLE.normalPathWidth);
        track.entity.polyline.material = isFocused
          ? track.focus
          : zoomedOut ? (faded ? track.fadedSolid : track.solid) : (faded ? track.fadedDash : track.dash);
      }
      viewer.scene.requestRender();
    };

    loadSlickVessels().then((list) => {
      if (destroyed) return;
      list.forEach(({ vessel, track, slickId }, index) => {
        const start = JulianDate.fromDate(new Date(track[0][0]));
        const end = JulianDate.fromDate(new Date(track[track.length - 1][0]));
        const sampled = new SampledPositionProperty();
        for (const [ms, lon, lat] of track) sampled.addSample(JulianDate.fromDate(new Date(ms)), Cartesian3.fromDegrees(lon, lat, 300));
        // Before its reports the ship is at the first one, after them at the last.
        const clamp = (time: JulianDate | undefined) =>
          !time || JulianDate.lessThan(time, start) ? start : JulianDate.greaterThan(time, end) ? end : JulianDate.clone(time, scratch);
        const courseAt = (time: JulianDate | undefined) => {
          const ms = JulianDate.toDate(clamp(time)).getTime();
          let k = track.findIndex((p) => p[0] > ms);
          if (k <= 0) k = k === 0 ? 1 : track.length - 1;
          const [, x0, y0] = track[k - 1];
          const [, x1, y1] = track[k];
          return Math.atan2(y1 - y0, (x1 - x0) * Math.cos((y0 * Math.PI) / 180));
        };
        const hours = (track[track.length - 1][0] - track[0][0]) / 3_600_000;
        const properties = {
          mmsi: vessel.mmsi,
          vesselType: `${vessel.type} · suspect #${vessel.rank} for ${slickId.split(':').at(-1)}`,
          reports: track.length,
          routeDuration: `${hours.toFixed(1)} h`,
          routePositions: track.map(([, longitude, latitude]) => ({ longitude, latitude })),
        };
        const path = viewer.entities.add({
          id: `ais-path-${vessel.mmsi}`,
          name: `${vessel.name} route`,
          show: visible,
          polyline: {
            positions: track.map(([, lon, lat]) => Cartesian3.fromDegrees(lon, lat, 30)),
            material: new ColorMaterialProperty(TRACK_COLOR.withAlpha(0.82)),
            width: AIS_FOCUS_STYLE.normalPathWidth,
          },
          properties,
        });
        entities.push(viewer.entities.add({
          id: `ais-ship-${vessel.mmsi}`,
          name: vessel.name,
          show: visible,
          position: new CallbackPositionProperty((time, result) => sampled.getValue(clamp(time), result), false),
          billboard: {
            image: shipIcon(VESSEL_COLORS[index % VESSEL_COLORS.length]),
            width: 30,
            height: 30,
            // Course is counter-clockwise from east; the icon points north.
            rotation: new CallbackProperty((time) => courseAt(time) - Math.PI / 2, false),
            scaleByDistance: new NearFarScalar(200_000, 1, 12_000_000, 0.5),
          },
          label: {
            text: vessel.name,
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            font: '11px sans-serif',
            pixelOffset: new Cartesian2(18, -14),
            showBackground: true,
            backgroundColor: Color.BLACK.withAlpha(0.78),
            backgroundPadding: new Cartesian2(5, 3),
            // Names only once zoomed in: a hundred labels at world view is noise.
            distanceDisplayCondition: new DistanceDisplayCondition(0, 1_500_000),
          },
          properties,
        }));
        tracks.push({
          entity: path,
          solid: new ColorMaterialProperty(TRACK_COLOR.withAlpha(0.82)),
          dash: new PolylineDashMaterialProperty({ color: TRACK_COLOR.withAlpha(0.92), dashLength: 10 }),
          fadedSolid: new ColorMaterialProperty(TRACK_COLOR.withAlpha(0.1)),
          fadedDash: new PolylineDashMaterialProperty({ color: TRACK_COLOR.withAlpha(0.12), dashLength: 10 }),
          focus: new PolylineGlowMaterialProperty({ color: AIS_FOCUS_STYLE.selectedPathColor, glowPower: 0.22 }),
        });
      });
      updateTrackStyle();
    });

    const focusHalo = viewer.entities.add({
      id: 'ais-focus-halo',
      show: false,
      point: {
        pixelSize: AIS_FOCUS_STYLE.haloSize,
        color: Color.WHITE.withAlpha(0.08),
        outlineColor: AIS_FOCUS_STYLE.haloColor,
        outlineWidth: 2,
      },
    });

    updateTrackStyle();
    viewer.camera.changed.addEventListener(updateTrackStyle);

    return {
      setVisible(show) {
        visible = show;
        for (const entity of entities) entity.show = show;
        for (const track of tracks) track.entity.show = show;
        focusHalo.show = show && Boolean(focusedEntityId);
      },
      setFocus(entityId) {
        // Focus is shared with other layers (e.g. a selected slick): only ours counts here.
        focusedEntityId = entityId?.startsWith('ais-') ? entityId : undefined;
        const focusedMmsi = focusedEntityId?.split('-').at(-1);
        const focused = entities.find((entity) => focusedMmsi && entity.id.endsWith(focusedMmsi));
        for (const entity of entities) {
          const tint = entity === focused || !focused ? Color.WHITE : Color.WHITE.withAlpha(0.16);
          if (entity.billboard) entity.billboard.color = new ConstantProperty(tint);
          if (entity.label) entity.label.fillColor = new ConstantProperty(tint);
        }
        focusHalo.position = focused?.position && new CallbackPositionProperty((time, result) => {
          const currentPosition = focused.position?.getValue(time);
          if (!currentPosition) return undefined;
          Cartesian3.normalize(currentPosition, haloNormal);
          Cartesian3.multiplyByScalar(haloNormal, 5_000, haloOffset);
          return Cartesian3.add(currentPosition, haloOffset, result ?? new Cartesian3());
        }, false);
        focusHalo.show = visible && Boolean(focused);
        updateTrackStyle();
      },
      destroy() {
        destroyed = true;
        viewer.camera.changed.removeEventListener(updateTrackStyle);
        for (const entity of entities) viewer.entities.remove(entity);
        for (const track of tracks) viewer.entities.remove(track.entity);
        viewer.entities.remove(focusHalo);
      },
    };
  },
} satisfies MapLayerDefinition;
