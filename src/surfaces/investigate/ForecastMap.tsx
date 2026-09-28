import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SlickFeature } from '../../api/slicks';
import type { RunFrame } from '../../forecast/types';
import type { SourceHypothesis } from '../../incidents/types';
import { CODE_RGBA } from '../../forecast/palette';

import { token } from '../../design/token';
type ViewKind = 'overview' | 'backward' | 'environment' | 'impact' | 'vessels';
type LMap = L.Map;

/** Canvas layer adapted from oil-imp's Leaflet CanvasOverlay renderer. */
class SlickCanvas extends L.Layer {
  private map?: LMap;
  private bounds = L.latLngBounds([0, 0], [0, 0]);
  private readonly canvas = document.createElement('canvas');

  constructor() {
    super();
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '420';
    this.canvas.style.imageRendering = 'auto';
  }

  onAdd(map: LMap) {
    this.map = map;
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on('move zoom resize', this.update, this);
    this.update();
    return this;
  }

  onRemove(map: LMap) {
    map.off('move zoom resize', this.update, this);
    this.canvas.remove();
    this.map = undefined;
    return this;
  }

  setFrame(frame: RunFrame | undefined) {
    if (!frame || frame.width < 1 || frame.height < 1 || frame.codes.length === 0) {
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.bounds = L.latLngBounds([0, 0], [0, 0]);
      this.update();
      return;
    }
    this.canvas.width = frame.width;
    this.canvas.height = frame.height;
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      const image = ctx.createImageData(frame.width, frame.height);
      for (let i = 0; i < frame.codes.length; i++) image.data.set(CODE_RGBA.subarray(frame.codes[i] * 4, frame.codes[i] * 4 + 4), i * 4);
      ctx.putImageData(image, 0, 0);
    }
    this.bounds = L.latLngBounds([frame.south, frame.west], [frame.north, frame.east]);
    this.update();
  }

  private update = () => {
    if (!this.map) return;
    const nw = this.map.latLngToLayerPoint(this.bounds.getNorthWest());
    const se = this.map.latLngToLayerPoint(this.bounds.getSouthEast());
    this.canvas.style.transform = `translate3d(${nw.x}px,${nw.y}px,0)`;
    this.canvas.style.width = `${Math.max(1, se.x - nw.x)}px`;
    this.canvas.style.height = `${Math.max(1, se.y - nw.y)}px`;
  };
}

const VESSELS = [
  { name: 'Med Star', imo: '9234567', kind: 'Tanker', color: token('--orange-200-k'), offset: [-0.035, -0.018], course: 126, speed: 3.2 },
  { name: 'Northwind', imo: '9412073', kind: 'Cargo', color: token('--green-200-d'), offset: [0.042, 0.012], course: 304, speed: 11.8 },
  { name: 'Asterion', imo: '9701142', kind: 'Tanker', color: token('--rose-300-d'), offset: [0.014, -0.049], course: 82, speed: 6.4 },
];

function vesselRoute(lon: number, lat: number, course: number, index: number): L.LatLngExpression[] {
  const angle = (course * Math.PI) / 180;
  const distance = 0.24 + index * 0.035;
  const dx = Math.sin(angle) * distance;
  const dy = Math.cos(angle) * distance;
  return [
    [lat - dy, lon - dx],
    [lat - dy * 0.52, lon - dx * 0.52],
    [lat, lon],
    [lat + dy * 0.42, lon + dx * 0.42],
  ];
}

function addVessels(map: LMap, centre: [number, number]) {
  VESSELS.forEach((vessel, index) => {
    const lon = centre[0] + vessel.offset[0];
    const lat = centre[1] + vessel.offset[1];
    L.polyline(vesselRoute(lon, lat, vessel.course, index), {
      color: vessel.color,
      opacity: 0.74,
      weight: 2.5,
      dashArray: '7 7',
    }).bindTooltip(`${vessel.name} · ${vessel.kind} · ${vessel.speed} kn`).addTo(map);
    L.circleMarker([lat, lon], {
      radius: 7,
      color: token('--neutral-800-f'),
      weight: 2,
      fillColor: vessel.color,
      fillOpacity: 1,
    }).bindTooltip(`${vessel.name} · AIS position at image capture`).addTo(map);
  });
}

function addWindAndCurrent(map: LMap, centre: [number, number], windSpeed: number, windDir: number, current: [number, number]) {
  const vector = (bearing: number, len: number) => {
    const angle = (bearing * Math.PI) / 180;
    return [centre[1] + Math.cos(angle) * len, centre[0] + Math.sin(angle) * len] as [number, number];
  };
  const windEnd = vector(windDir, 0.09);
  const currentBearing = (Math.atan2(current[0], current[1]) * 180) / Math.PI;
  const currentEnd = vector(currentBearing, Math.max(0.035, Math.hypot(...current) * 0.12));
  for (const [label, end, color] of [['Wind', windEnd, token('--orange-200-g')], ['Surface current', currentEnd, token('--teal-200-b')]] as const) {
    L.polyline([[centre[1], centre[0]], end], { color, weight: 3, opacity: 0.92 }).addTo(map);
    L.circleMarker(end, { radius: 5, color: token('--neutral-800-k'), weight: 1, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(map);
  }
  L.circleMarker([centre[1], centre[0]], { radius: 4, color: token('--orange-200-g'), weight: 2, fillColor: token('--amber-50'), fillOpacity: 1 }).bindTooltip(`${windSpeed.toFixed(1)} m/s wind`).addTo(map);
}

function addImpactMarkers(map: LMap, centre: [number, number]) {
  const sites = [
    { name: 'Coastal habitat', dx: -0.09, dy: -0.05, risk: 'High', color: token('--red-300-e') },
    { name: 'Shellfish beds', dx: 0.07, dy: 0.04, risk: 'Moderate', color: token('--amber-200-c') },
    { name: 'Protected shoreline', dx: 0.11, dy: -0.07, risk: 'Watch', color: token('--green-200-e') },
  ];
  sites.forEach((site) => {
    const point: L.LatLngExpression = [centre[1] + site.dy, centre[0] + site.dx];
    L.circle(point, { radius: 1600, color: site.color, weight: 2, opacity: 0.88, fillColor: site.color, fillOpacity: 0.2 })
      .bindTooltip(`${site.name} · ${site.risk} demo risk`).addTo(map);
    L.circleMarker(point, { radius: 5, color: token('--neutral-800-k'), weight: 1, fillColor: site.color, fillOpacity: 1 })
      .bindTooltip(site.name).addTo(map);
  });
}

function addBacktrack(
  map: LMap,
  centre: [number, number],
  windDir: number,
  hours: number,
  hypotheses: readonly SourceHypothesis[],
) {
  if (hypotheses.length > 0) {
    const path = hypotheses.map(({ centre: point }) => [point.lat, point.lon] as L.LatLngTuple);
    L.polyline(path, { color: token('--blue-300-c'), weight: 3, opacity: 0.92, dashArray: '5 7' })
      .bindTooltip('Lagrangian source-support corridor · reconstructed').addTo(map);
    hypotheses.forEach((hypothesis) => {
      const at: L.LatLngTuple = [hypothesis.centre.lat, hypothesis.centre.lon];
      L.circle(at, {
        radius: hypothesis.spreadRadiusKm * 1000,
        color: token('--blue-200'),
        weight: 1.5,
        opacity: 0.9,
        fillColor: token('--blue-300-c'),
        fillOpacity: 0.13,
      }).bindTooltip(`T−${hypothesis.ageHours} h support · ${hypothesis.particleCount} particles · ${hypothesis.spreadRadiusKm.toFixed(1)} km spread`).addTo(map);
      L.circleMarker(at, {
        radius: hypothesis.ageHours === hypotheses[0].ageHours ? 7 : 4.5,
        color: token('--blue-700'),
        weight: 2,
        fillColor: token('--blue-200'),
        fillOpacity: 1,
      }).bindTooltip(`T−${hypothesis.ageHours} h · ${new Date(hypothesis.time).toISOString()}`).addTo(map);
    });
    return;
  }

  const upstream = ((windDir + 180) * Math.PI) / 180;
  const scale = Math.max(0.15, hours / 12);
  const end: [number, number] = [
    centre[0] + Math.sin(upstream) * 0.19 * scale,
    centre[1] + Math.cos(upstream) * 0.13 * scale,
  ];
  const mid: [number, number] = [(centre[0] + end[0]) / 2, (centre[1] + end[1]) / 2];
  L.polyline([[centre[1], centre[0]], [mid[1] + 0.008, mid[0] - 0.007], [end[1], end[0]]], {
    color: token('--blue-300-c'), weight: 3, opacity: 0.9, dashArray: '5 7',
  }).bindTooltip(`Illustrative ${hours} h backtrack corridor`).addTo(map);
  L.circleMarker([end[1], end[0]], {
    radius: 8, color: token('--blue-800'), weight: 2, fillColor: token('--blue-300-c'), fillOpacity: 1,
  }).bindTooltip('Possible upstream source area · demo').addTo(map);
}

export function ForecastMap({ slick, frame, view, windSpeed, windDir, current, backtrackHours = 12, backtrackTrack = [], backtrackHypotheses = [] }: {
  slick: SlickFeature;
  frame?: RunFrame;
  view: ViewKind;
  windSpeed: number;
  windDir: number;
  current: [number, number];
  backtrackHours?: number;
  /** Full selected windage case, used only to frame the backward map. */
  backtrackTrack?: readonly SourceHypothesis[];
  /** Selected case clipped to the scrubber age. */
  backtrackHypotheses?: readonly SourceHypothesis[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | undefined>(undefined);
  const canvasRef = useRef<SlickCanvas | undefined>(undefined);
  const centre = useMemo<[number, number]>(() => {
    const c = slick.properties.centroid;
    if (Array.isArray(c) && c.length >= 2) return [Number(c[0]), Number(c[1])];
    const ring = slick.geometry?.coordinates?.[0] as unknown as number[][] | undefined;
    return ring?.[0] ? [ring[0][0], ring[0][1]] : [0, 0];
  }, [slick]);

  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { center: [centre[1], centre[0]], zoom: 9, zoomControl: false, worldCopyJump: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const canvas = new SlickCanvas().addTo(map);
    mapRef.current = map;
    canvasRef.current = canvas;
    if (slick.geometry) {
      const geometryLayer = L.geoJSON(slick.geometry as unknown as GeoJSON.GeoJsonObject, {
        style: { color: token('--orange-200-e'), weight: 2.5, fillColor: token('--orange-200-e'), fillOpacity: 0.12 },
      }).addTo(map);
      const bounds = geometryLayer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds.pad(1.2), { animate: false, maxZoom: 10 });
    }
    return () => {
      map.remove();
      mapRef.current = undefined;
      canvasRef.current = undefined;
    };
  }, [slick]);

  useEffect(() => canvasRef.current?.setFrame(frame), [frame]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (view === 'backward' && backtrackTrack.length > 0) {
      const bounds = slick.geometry
        ? L.geoJSON(slick.geometry as unknown as GeoJSON.GeoJsonObject).getBounds()
        : L.latLngBounds([centre[1], centre[0]], [centre[1], centre[0]]);
      for (const hypothesis of backtrackTrack) {
        const latitudeDelta = hypothesis.spreadRadiusKm / 110.57;
        const longitudeDelta = hypothesis.spreadRadiusKm / (111.32 * Math.max(Math.cos((hypothesis.centre.lat * Math.PI) / 180), 0.2));
        bounds.extend([hypothesis.centre.lat - latitudeDelta, hypothesis.centre.lon - longitudeDelta]);
        bounds.extend([hypothesis.centre.lat + latitudeDelta, hypothesis.centre.lon + longitudeDelta]);
      }
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.18), { animate: false, maxZoom: 9 });
    }
  }, [view, slick, centre, backtrackTrack]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Each layer group is replaced together when the selected view changes.
    const group = L.layerGroup().addTo(map);
    const removeGroup = () => map.removeLayer(group);
    if (view === 'environment') addWindAndCurrent(group as unknown as LMap, centre, windSpeed, windDir, current);
    if (view === 'impact') addImpactMarkers(group as unknown as LMap, centre);
    if (view === 'vessels') addVessels(group as unknown as LMap, centre);
    if (view === 'backward') addBacktrack(group as unknown as LMap, centre, windDir, backtrackHours, backtrackHypotheses);
    return () => { removeGroup(); };
  }, [view, centre, windSpeed, windDir, current[0], current[1], backtrackHours, backtrackHypotheses]);

  return <div className="forecast-map" ref={host} role="img" aria-label="Map showing the simulated oil slick and forecast overlays" />;
}
