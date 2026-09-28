import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers } from 'lucide-react';
import type { SlickFeature } from '../../api/slicks';

import { token } from '../../design/token';
export type ResponsePanel = 'overview' | 'containment' | 'assets' | 'surveillance' | 'cleanup' | 'sampling' | 'alerts';

const ASSETS = [
  { name: 'Containment Boom A', status: 'On scene', dx: -0.035, dy: -0.015, color: token('--lime-300-d'), type: 'boom' },
  { name: 'Skimmer 01', status: 'En route · 2.1 h', dx: -0.105, dy: -0.055, color: token('--lime-300-d'), type: 'ship' },
  { name: 'Response Vessel 1', status: 'Standby', dx: -0.13, dy: 0.12, color: token('--lime-300-d'), type: 'ship' },
  { name: 'Supply Vessel 1', status: 'Unavailable', dx: 0.1, dy: -0.11, color: token('--rose-300-b'), type: 'ship' },
];

function label(name: string, detail: string, tone: string) {
  return L.divIcon({
    className: '',
    html: `<span class="response-pin response-pin-${tone}"><i></i><b>${name}</b><small>${detail}</small></span>`,
    iconSize: [0, 0],
  });
}

function assetPath(lon: number, lat: number, index: number): L.LatLngExpression[] {
  const course = index === 1 ? 118 : index === 2 ? 14 : 242;
  const angle = (course * Math.PI) / 180;
  const dx = Math.sin(angle) * 0.065;
  const dy = Math.cos(angle) * 0.065;
  return [[lat - dy, lon - dx], [lat - dy * 0.52, lon - dx * 0.52], [lat, lon], [lat + dy * 0.35, lon + dx * 0.35]];
}

export function ResponseMap({ slick, panel, hour }: { slick: SlickFeature; panel: ResponsePanel; hour: number }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | undefined>(undefined);
  const [showLayers, setShowLayers] = useState(false);
  const [enabled, setEnabled] = useState({ slick: true, forecast: true, assets: true, sensitive: true, missions: true, stations: true });
  const centre = useMemo<[number, number]>(() => {
    const c = slick.properties.centroid;
    if (Array.isArray(c)) return [Number(c[0]), Number(c[1])];
    return [0, 0];
  }, [slick]);

  useEffect(() => {
    if (!host.current) return;
    const map = L.map(host.current, { center: [centre[1], centre[0]], zoom: 9, zoomControl: false, worldCopyJump: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ position: 'bottomright', maxWidth: 90, metric: true, imperial: false }).addTo(map);
    const geo = slick.geometry && L.geoJSON(slick.geometry as unknown as GeoJSON.GeoJsonObject, {
      style: { color: token('--orange-200-d'), weight: 2.5, fillColor: token('--orange-300-d'), fillOpacity: 0.44 },
    }).addTo(map);
    const bounds = geo?.getBounds();
    if (bounds?.isValid()) map.fitBounds(bounds.pad(2.2), { animate: false, maxZoom: 9 });
    else map.setView([centre[1], centre[0]], 8);
    geo?.remove();
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = undefined; };
  }, [slick, centre]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const group = L.layerGroup().addTo(map);
    const at = (dx: number, dy: number): [number, number] => [centre[0] + dx, centre[1] + dy];
    const oilCenter = at(0, 0);
    const stageNorth = at(0.16, 0.07);
    const stageSouth = at(0.17, -0.08);
    if (enabled.forecast) {
      const radiusKm = 9 + Math.max(0, hour - 6) * 0.82;
      L.circle([oilCenter[1], oilCenter[0]], { radius: radiusKm * 1000, color: token('--blue-300-e'), weight: 2, dashArray: '6 8', fillColor: token('--blue-400-e'), fillOpacity: 0.15 }).addTo(group);
      L.polyline([[oilCenter[1], oilCenter[0]], [oilCenter[1] + 0.018, oilCenter[0] + 0.028], [oilCenter[1] + 0.032, oilCenter[0] + 0.071]], { color: token('--blue-300-e'), weight: 2.2, dashArray: '4 8' }).addTo(group);
      L.marker([oilCenter[1] + 0.035, oilCenter[0] + 0.07], { icon: label('24 h forecast', 'potential spread', 'forecast') }).addTo(group);
    }
    if (enabled.sensitive) {
      const coast = [[centre[1] + 0.27, centre[0] + 0.31], [centre[1] + 0.16, centre[0] + 0.29], [centre[1] + 0.05, centre[0] + 0.32], [centre[1] - 0.04, centre[0] + 0.3], [centre[1] - 0.15, centre[0] + 0.34], [centre[1] - 0.28, centre[0] + 0.3]] as L.LatLngExpression[];
      L.polyline(coast.slice(0, 4), { color: token('--red-300-c'), weight: 5, opacity: 0.9 }).addTo(group);
      L.polyline(coast.slice(3), { color: token('--amber-200-b'), weight: 5, opacity: 0.9 }).addTo(group);
      L.marker([centre[1] + 0.17, centre[0] + 0.31], { icon: label('Sensitive habitat', 'HIGH PRIORITY', 'warning') }).addTo(group);
      L.marker([centre[1] - 0.13, centre[0] + 0.33], { icon: label('North Coastline', `${Math.max(6, Math.round(hour * 1.5))} km at risk`, 'warning') }).addTo(group);
    }
    if (enabled.assets) {
      ASSETS.forEach((asset, index) => {
        const [lon, lat] = at(asset.dx, asset.dy);
        L.polyline(assetPath(lon, lat, index), { color: asset.color, weight: 2, opacity: 0.83, dashArray: asset.status.startsWith('Unavailable') ? '3 7' : '4 7' }).addTo(group);
        L.circleMarker([lat, lon], { radius: asset.type === 'boom' ? 8 : 6, color: token('--neutral-800-l'), weight: 2, fillColor: asset.color, fillOpacity: 1 })
          .bindTooltip(`${asset.name} · ${asset.status}`).addTo(group);
        L.marker([lat, lon], { icon: label(asset.name, asset.status, asset.color === token('--rose-300-b') ? 'unavailable' : 'asset') }).addTo(group);
      });
      L.marker([stageNorth[1], stageNorth[0]], { icon: label('Staging Point North', 'RESPONSE BASE', 'station') }).addTo(group);
      L.marker([stageSouth[1], stageSouth[0]], { icon: label('Staging Point South', 'RESPONSE BASE', 'station') }).addTo(group);
    }
    if (enabled.missions) {
      const first = at(-0.2, 0.15), second = at(0.06, -0.2);
      for (const [i, origin] of [first, second].entries()) {
        const end = at(origin[0] - centre[0] + 0.06, origin[1] - centre[1] + 0.04);
        const route = [[origin[1], origin[0]], [origin[1] + 0.03, origin[0] + 0.11], [end[1], end[0]], [end[1] - 0.018, end[0] - 0.025]] as L.LatLngExpression[];
        L.polygon(route, { color: token('--green-200-b'), weight: 1.5, dashArray: '4 7', fillColor: token('--green-200-b'), fillOpacity: 0.06 }).addTo(group);
        L.marker(route[0], { icon: label(`Surveillance S-${i + 1}`, i ? 'SHORELINE ASSESSMENT' : 'EDGE VERIFICATION', 'mission') }).addTo(group);
      }
    }
    if (enabled.stations) {
      const stations = [
        { id: 'S-1', detail: 'impact zone', pos: at(0.06, 0.02) },
        { id: 'S-2', detail: 'coastal', pos: at(0.22, -0.14) },
        { id: 'S-3', detail: 'near boundary', pos: at(-0.1, 0.12) },
        { id: 'S-4', detail: 'down-current', pos: at(0.1, -0.12) },
        { id: 'B-1', detail: 'background', pos: at(-0.23, -0.15) },
      ];
      stations.forEach((station, i) => L.circleMarker([station.pos[1], station.pos[0]], { radius: 5.5, color: token('--neutral-50-g'), weight: 2, fillColor: i === 4 ? token('--sky-400-c') : token('--green-300-f'), fillOpacity: 1 })
        .bindTooltip(`${station.id} · ${station.detail}`).addTo(group));
    }
    if (enabled.slick && slick.geometry) L.geoJSON(slick.geometry as unknown as GeoJSON.GeoJsonObject, {
      style: { color: token('--orange-200-j'), weight: 2.5, fillColor: token('--red-400'), fillOpacity: 0.42 },
    }).addTo(group);
    return () => { map.removeLayer(group); };
  }, [slick, panel, hour, centre, enabled]);

  const layerNames: [keyof typeof enabled, string][] = [
    ['slick', 'Current slick'], ['forecast', 'Forecast envelope'], ['assets', 'Response assets'],
    ['sensitive', 'Sensitive shorelines'], ['missions', 'Surveillance missions'], ['stations', 'Sampling stations'],
  ];

  return (
    <div className="response-map-wrap">
      <div className="response-map" ref={host} role="img" aria-label="Operational response map with slick, projected spread, response assets and missions" />
      <div className="response-north" aria-hidden="true"><span>N</span><i>▲</i></div>
      <button className="response-layers-button" type="button" onClick={() => setShowLayers((current) => !current)}><Layers size={15} /> Layers ({Object.values(enabled).filter(Boolean).length}) <b>›</b></button>
      {showLayers && <div className="response-layer-menu">{layerNames.map(([id, name]) => <label key={id}><input type="checkbox" checked={enabled[id]} onChange={(event) => setEnabled((current) => ({ ...current, [id]: event.target.checked }))} /><span>{name}</span></label>)}</div>}
      <div className="response-map-key"><span><i className="key-oil" /> Current slick</span><span><i className="key-forecast" /> Forecast window</span><span><i className="key-assets" /> Operational assets</span><span><i className="key-sensitive" /> Sensitive coast</span></div>
    </div>
  );
}
