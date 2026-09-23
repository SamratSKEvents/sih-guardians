import {
  CallbackProperty,
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  JulianDate,
  NearFarScalar,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
} from 'cesium';
import type { MapLayerDefinition } from './types';

interface AisPositionReport {
  timestamp: string;
  longitude: number;
  latitude: number;
  speedKnots: number;
  courseDegrees: number;
}

interface DemoAisVessel {
  mmsi: string;
  name: string;
  vesselType: 'Cargo' | 'Tanker' | 'Container';
  reports: AisPositionReport[];
}

/* Invented names; no real vessel is intended. */
const DEMO_NAMES = [
  'SAGAR KANYA', 'OCEAN VEDA', 'KAVERI SPIRIT', 'MV TAPTI', 'JAL KIRAN', 'BLUE NILGIRI', 'SEA KONARK', 'MAHI EXPRESS',
  'CORAL ANDAMAN', 'MV SABARMATI', 'INDUS STAR', 'GOLDEN KOCHI', 'VAIGAI', 'MALABAR PEARL', 'MV NARMADA', 'LAKSHADWEEP',
  'ARABIAN TERN', 'BAY OF BENGAL',
];

function seeded(index: number) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

/** Deterministic random AIS reports, shaped like a real timestamped feed. */
// 49 reports half an hour apart: one day of traffic for the timeline to scrub.
const REPORT_INTERVAL_S = 30 * 60;
const DEMO_START_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

function createDemoAisTimeSeries(vesselCount = 18, reportCount = 49): DemoAisVessel[] {
  return Array.from({ length: vesselCount }, (_, vesselIndex) => {
    const originLongitude = 52 + seeded(vesselIndex + 2) * 42;
    const originLatitude = -8 + seeded(vesselIndex + 31) * 26;
    const courseRadians = seeded(vesselIndex + 67) * Math.PI * 2;
    const speedKnots = 10 + seeded(vesselIndex + 103) * 11;
    const reports = Array.from({ length: reportCount }, (_, reportIndex) => {
      const distance = reportIndex * (0.06 + speedKnots * 0.0025);
      const drift = Math.sin(reportIndex * 0.32 + vesselIndex) * 0.16;
      const longitude = originLongitude + Math.cos(courseRadians) * distance - Math.sin(courseRadians) * drift;
      const latitude = originLatitude + Math.sin(courseRadians) * distance + Math.cos(courseRadians) * drift;
      return {
        timestamp: new Date(DEMO_START_MS + reportIndex * REPORT_INTERVAL_S * 1000).toISOString(),
        longitude,
        latitude,
        speedKnots: Number(speedKnots.toFixed(1)),
        courseDegrees: (courseRadians * 180) / Math.PI,
      };
    });

    return {
      mmsi: String(636_000_000 + vesselIndex),
      name: DEMO_NAMES[vesselIndex % DEMO_NAMES.length],
      vesselType: (['Cargo', 'Tanker', 'Container'] as const)[vesselIndex % 3],
      reports,
    };
  });
}

const AIS_DEMO_TIME_SERIES = createDemoAisTimeSeries();
const ROUTE_SECONDS = (AIS_DEMO_TIME_SERIES[0].reports.length - 1) * REPORT_INTERVAL_S;

const DAY_MS = 86_400_000;

/**
 * The demo traffic is one day of reports, replayed every day: any moment maps
 * onto the same time of day on that reference day. So the ships stay on the
 * map whatever window the timeline shows (the slick catalog spans ~20 months).
 */
function onDemoDay(time: JulianDate, result: JulianDate): JulianDate {
  const ms = JulianDate.toDate(time).getTime();
  const offset = (((ms - DEMO_START_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return JulianDate.fromDate(new Date(DEMO_START_MS + offset), result);
}

/** Time span the demo traffic covers; the timeline window until incident data sets one. */
export const AIS_DEMO_WINDOW = {
  start: DEMO_START_MS,
  end: DEMO_START_MS + ROUTE_SECONDS * 1000,
};

const VESSEL_COLORS = [Color.CYAN, Color.ORANGE, Color.LIME];
const TRACK_COLOR = Color.fromCssColorString('#ff9f3f');

const AIS_FOCUS_STYLE = {
  haloColor: Color.WHITE,
  haloSize: 52,
  selectedPathColor: Color.fromCssColorString('#ffd95a'),
  selectedPathWidth: 8,
  normalPathWidth: 2,
};

function shipIcon(color: Color) {
  const fill = color.toCssColorString();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 3C21 9 13 22 13 39c0 10 7 18 19 22 12-4 19-12 19-22C51 22 43 9 32 3Z" fill="white" stroke="#17191f" stroke-width="6" stroke-linejoin="round"/><path d="M32 13c-7 6-11 15-11 25 0 6 4 11 11 14 7-3 11-8 11-14 0-10-4-19-11-25Z" fill="${fill}" stroke="#17191f" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const aisDemoLayer = {
  id: 'ais-demo',
  label: 'AIS demo vessels',
  description: 'Synthetic ship traffic in the Indian Ocean: one day of AIS reports, replayed every day.',
  value: 'demo',
  swatch: 'ais',
  defaultVisible: true,
  create: ({ viewer }) => {
    const first = JulianDate.fromIso8601(AIS_DEMO_TIME_SERIES[0].reports[0].timestamp);
    const scratch = new JulianDate();
    const tracks: { entity: ReturnType<typeof viewer.entities.add>; solid: ColorMaterialProperty; dash: PolylineDashMaterialProperty; focus: PolylineGlowMaterialProperty; fadedSolid: ColorMaterialProperty; fadedDash: PolylineDashMaterialProperty }[] = [];
    const haloNormal = new Cartesian3();
    const haloOffset = new Cartesian3();
    const entities = AIS_DEMO_TIME_SERIES.map((vessel, index) => {
      const sampledRoute = new SampledPositionProperty();
      const sampledShip = new SampledPositionProperty();
      for (const report of vessel.reports) {
        const time = JulianDate.fromIso8601(report.timestamp);
        sampledRoute.addSample(time, Cartesian3.fromDegrees(report.longitude, report.latitude, 30));
        // Keep the visual marker just above its route to avoid depth-buffer fighting.
        sampledShip.addSample(time, Cartesian3.fromDegrees(report.longitude, report.latitude, 300));
      }
      const position = new CallbackPositionProperty(
        (time, result) => sampledRoute.getValue(onDemoDay(time ?? first, scratch), result),
        false,
      );
      const shipPosition = new CallbackPositionProperty(
        (time, result) => sampledShip.getValue(onDemoDay(time ?? first, scratch), result),
        false,
      );
      const color = VESSEL_COLORS[index % VESSEL_COLORS.length];
      const courseAt = (time: JulianDate) => {
        const seconds = Math.max(0, JulianDate.secondsDifference(onDemoDay(time, scratch), first));
        const reportIndex = Math.min(vessel.reports.length - 2, Math.floor(seconds / REPORT_INTERVAL_S));
        const here = vessel.reports[reportIndex];
        const next = vessel.reports[reportIndex + 1];
        const east = (next.longitude - here.longitude) * Math.cos((here.latitude * Math.PI) / 180);
        return Math.atan2(next.latitude - here.latitude, east);
      };
      const solid = new ColorMaterialProperty(TRACK_COLOR.withAlpha(0.82));
      const dash = new PolylineDashMaterialProperty({
        color: TRACK_COLOR.withAlpha(0.92),
        dashLength: 10,
      });
      const fadedSolid = new ColorMaterialProperty(TRACK_COLOR.withAlpha(0.1));
      const fadedDash = new PolylineDashMaterialProperty({ color: TRACK_COLOR.withAlpha(0.12), dashLength: 10 });
      const focus = new PolylineGlowMaterialProperty({
        color: AIS_FOCUS_STYLE.selectedPathColor,
        glowPower: 0.22,
      });
      const properties = {
        mmsi: vessel.mmsi,
        vesselType: vessel.vesselType,
        reports: vessel.reports.length,
        routeDuration: `${((vessel.reports.length - 1) * REPORT_INTERVAL_S) / 3600} h`,
        routePositions: vessel.reports.map(({ longitude, latitude }) => ({ longitude, latitude })),
      };
      const pathEntity = viewer.entities.add({
        id: `ais-path-${vessel.mmsi}`,
        name: `${vessel.name} route`,
        position,
        // The whole day's route as a fixed line: a trail sampled around the
        // current time would jump across the map at the midnight wrap.
        polyline: {
          positions: vessel.reports.map((report) => Cartesian3.fromDegrees(report.longitude, report.latitude, 30)),
          material: solid,
          width: AIS_FOCUS_STYLE.normalPathWidth,
        },
        properties,
      });
      const entity = viewer.entities.add({
        id: `ais-ship-${vessel.mmsi}`,
        name: vessel.name,
        position: shipPosition,
        billboard: {
          image: shipIcon(color),
          width: 38,
          height: 38,
          // Route angles are measured counter-clockwise from east; this icon points north.
          rotation: new CallbackProperty((time) => courseAt(time ?? first) - Math.PI / 2, false),
          scaleByDistance: new NearFarScalar(500_000, 1, 18_000_000, 0.65),
        },
        label: {
          text: vessel.name,
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          font: '11px sans-serif',
          pixelOffset: new Cartesian2(22, -18),
          showBackground: true,
          backgroundColor: Color.BLACK.withAlpha(0.78),
          backgroundPadding: new Cartesian2(5, 3),
          scaleByDistance: new NearFarScalar(500_000, 1, 18_000_000, 0.65),
        },
        properties,
      });
      tracks.push({ entity: pathEntity, solid, dash, focus, fadedSolid, fadedDash });
      return entity;
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
    let focusedEntityId: string | undefined;

    let styleKey = '';
    const updateTrackStyle = () => {
      const zoomedOut = viewer.camera.positionCartographic.height > 3_500_000;
      // camera.changed fires on every pan; new properties force Cesium to rebuild paths.
      if (`${zoomedOut}|${focusedEntityId}` === styleKey) return;
      styleKey = `${zoomedOut}|${focusedEntityId}`;
      for (const track of tracks) {
        const focusedMmsi = focusedEntityId?.split('-').at(-1);
        const isFocused = Boolean(focusedMmsi && track.entity.id.endsWith(focusedMmsi));
        const faded = Boolean(focusedEntityId && !isFocused);
        if (track.entity.polyline) {
          track.entity.polyline.width = new ConstantProperty(
            isFocused
              ? AIS_FOCUS_STYLE.selectedPathWidth
              : AIS_FOCUS_STYLE.normalPathWidth,
          );
          track.entity.polyline.material = isFocused
            ? track.focus
            : zoomedOut ? (faded ? track.fadedSolid : track.solid) : (faded ? track.fadedDash : track.dash);
        }
      }
      viewer.scene.requestRender();
    };
    updateTrackStyle();
    viewer.camera.changed.addEventListener(updateTrackStyle);

    // Time is owned by the app timeline, which sets viewer.clock.currentTime.
    let visible = true;

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
        entityId = focusedEntityId;
        const focusedMmsi = entityId?.split('-').at(-1);
        const focused = entities.find((entity) => focusedMmsi && entity.id.endsWith(focusedMmsi));
        for (const entity of entities) {
          const isFocused = entity === focused;
          if (entity.billboard) {
            entity.billboard.color = new ConstantProperty(
              isFocused || !focused ? Color.WHITE : Color.WHITE.withAlpha(0.16),
            );
          }
          if (entity.label) {
            entity.label.fillColor = new ConstantProperty(isFocused || !focused ? Color.WHITE : Color.WHITE.withAlpha(0.16));
          }
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
        viewer.camera.changed.removeEventListener(updateTrackStyle);
        for (const entity of entities) viewer.entities.remove(entity);
        for (const track of tracks) viewer.entities.remove(track.entity);
        viewer.entities.remove(focusHalo);
      },
    };
  },
} satisfies MapLayerDefinition;
