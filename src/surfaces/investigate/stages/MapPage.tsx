/**
 * Detection · Map. The slick in its surroundings at the moment of the pass.
 *
 * Map on the left with a vessel table docked under it (the Spills timeline's
 * place: a layout row, not a float), the area or the selected vessel on the
 * right. One clock from T−12 h to the pass replays the traffic.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Anchor, ArrowDown, ChevronDown, Eye, ArrowLeft, ArrowUp, Compass, Crosshair, Factory, FileText, Flag, Gauge, Layers, Leaf, Maximize, Navigation,
  Pause, Play, Radio, Ship, ShieldAlert, Target, Waves, Wind,
} from 'lucide-react';
import { Badge } from '../../../design/components';
import type { SlickFeature } from '../../../api/slicks';
import type { Detection, Incident } from '../../../incidents/types';
import { fetchDetection } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import { loadLandRings } from '../../../forecast/land';
import { when } from '../../../format';
import { ringsOf } from '../geometry';
import {
  ANCHORAGES, LANES, PROTECTED, SITES, bearingOf, carryToPass, closestApproach, depthAt, coastKm, fromBundle, generate, indexLand, kmBetween,
  move, soundings, vesselAt, type Kind, type Land, type MapVessel, type Pt,
} from './mapData';
import './scene.css';
import './mapPage.css';

type LayerKey = 'imagery' | 'slick' | 'footprint' | 'vessels' | 'tracks' | 'cpa' | 'sites' | 'lanes' | 'protected' | 'rings' | 'depth' | 'env' | 'alltracks' | 'allcpa';
const LAYER_LABEL: Record<LayerKey, string> = {
  imagery: 'Satellite background', slick: 'Slick outline', footprint: 'Scene footprint', vessels: 'Vessels at clock', tracks: 'AIS tracks',
  cpa: 'Closest approach', sites: 'Rigs, SPMs, terminals', lanes: 'Lanes and anchorages', protected: 'Protected areas', rings: 'Search rings',
  depth: 'Soundings', env: 'Wind and current', alltracks: 'Every vessel track', allcpa: 'Every closest approach',
};
const KIND_LABEL: Record<Kind, string> = { tanker: 'Tanker', gas: 'Gas carrier', container: 'Container', bulk: 'Bulk', cargo: 'Cargo', fishing: 'Fishing', tug: 'Tug / supply', other: 'Other' };
const KIND_ORDER: Kind[] = ['tanker', 'gas', 'container', 'bulk', 'cargo', 'tug', 'fishing', 'other'];
const ll = ([lon, lat]: Pt): L.LatLngTuple => [lat, lon];
const hrs = (h: number) => `T${h >= 0 ? '+' : '−'}${Math.abs(h).toFixed(1)} h`;
const f1 = (v: number) => v.toFixed(1);
const COMPASS = (d: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16];

interface Env { windMs: number; windFrom: number; currentMs: number; currentTo: number; waveM: number; sstC: number; source: string }

/* ------------------------------------------------------------- ship icon */

const HULL = 'M0,-14 C3.6,-10 5,-6 5,-1 L5,12 Q5,14 3,14 L-3,14 Q-5,14 -5,12 L-5,-1 C-5,-6 -3.6,-10 0,-14 Z';
const DECK: Record<Kind, string> = {
  tanker: '<path d="M0,-8 L0,8 M-2.5,-2 L2.5,-2" class="d"/><rect x="-3.5" y="8.5" width="7" height="3.5" rx="1" class="b"/>',
  gas: '<circle cy="-5.5" r="2.6" class="d"/><circle cy="0.5" r="2.6" class="d"/><circle cy="6" r="2.6" class="d"/><rect x="-3.5" y="9.5" width="7" height="3" rx="1" class="b"/>',
  container: '<path d="M-3.5,-7h7v3h-7zM-3.5,-3h7v3h-7zM-3.5,1h7v3h-7zM-3.5,5h7v3h-7z" class="c"/><rect x="-3.5" y="9" width="7" height="3" rx="1" class="b"/>',
  bulk: '<path d="M-2.5,-8h5v3.5h-5zM-2.5,-3h5v3.5h-5zM-2.5,2h5v3.5h-5z" class="d"/><rect x="-3.5" y="8" width="7" height="4" rx="1" class="b"/>',
  cargo: '<path d="M-2.5,-7h5v4h-5zM-2.5,-1h5v4h-5z" class="d"/><rect x="-3.5" y="7" width="7" height="5" rx="1" class="b"/>',
  fishing: '<rect x="-3" y="-4" width="6" height="5" rx="1" class="b"/><path d="M0,3 L0,11 M-3,8 L3,8" class="d"/>',
  tug: '<rect x="-3.5" y="-5" width="7" height="7" rx="1.5" class="b"/><circle cy="8" r="2" class="d"/>',
  other: '<rect x="-3" y="-2" width="6" height="8" rx="1.5" class="b"/>',
};
export function shipIcon(v: MapVessel, tone: string) {
  const px = Math.round(Math.min(40, Math.max(15, 11 + v.lengthM / 10)));
  return L.divIcon({
    className: `dm-ship is-${tone}`,
    html: `<svg viewBox="-15 -15 30 30" width="${px}" height="${px}"><path d="${HULL}" class="h"/>${DECK[v.kind]}</svg>`,
    iconSize: [px, px],
    iconAnchor: [px / 2, px / 2],
  });
}
export const chip = (text: string, cls = '') => L.divIcon({ className: 'dm-chip-anchor', html: `<span class="dm-chip ${cls}">${text}</span>`, iconSize: [0, 0] });
export const tone = (v: MapVessel, sel?: string) => (v.id === sel ? 'selected' : v.rank && v.rank <= 3 ? 'candidate' : v.gaps.length ? 'gap' : v.kind === 'fishing' ? 'fishing' : 'traffic');

/* ------------------------------------------------------------------ page */

export function MapPage({ slick, incident, incidentId }: { slick: SlickFeature; incident: Incident | undefined; incidentId: string | undefined }) {
  const p = slick.properties;
  const t0 = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(p.observedAt);
  const rings = ringsOf(slick.geometry);
  const centre: Pt = Array.isArray(p.centroid) ? [Number(p.centroid[0]), Number(p.centroid[1])] : incident?.centre ? [incident.centre.lon, incident.centre.lat] : [0, 0];
  const artifact = useArtifact<Detection>(incidentId, fetchDetection);
  const detection = artifact && artifact !== 'error' ? artifact : undefined;

  const [land, setLand] = useState<Land>();
  const [vessels, setVessels] = useState<MapVessel[]>();
  const [env, setEnv] = useState<Env>();
  useEffect(() => {
    let live = true;
    setVessels(undefined);
    (async () => {
      const rawLand = await loadLandRings().catch(() => []);
      const near = rawLand.filter((r) => r.some(([x, y]) => Math.abs(x - centre[0]) < 3 && Math.abs(y - centre[1]) < 3)) as Pt[][];
      const idx = indexLand(near);
      if (live) setLand(idx);
      const base = incidentId ? `/data/incidents/${incidentId}` : undefined;
      const json = async (name: string) => (base ? fetch(`${base}/${name}`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined) : undefined);
      const [ais, cands, environment] = await Promise.all([json('ais.json'), json('candidates.json'), json('environment.json')]);
      const list = ais?.tracks?.length ? carryToPass(fromBundle(ais, cands, t0, centre), idx) : generate(slick.id, centre, idx);
      if (live) setVessels(list);
      const rows: { t: string; windSpeed: number; windDir: number; currentSpeed: number; currentBearing: number }[] = environment?.pointTimeseries?.rows ?? [];
      const row = rows.length ? rows.reduce((a, b) => (Math.abs(Date.parse(b.t) - t0) < Math.abs(Date.parse(a.t) - t0) ? b : a)) : undefined;
      const h = [...slick.id].reduce((a, c) => a + c.charCodeAt(0), 0);
      if (live) setEnv(row
        ? { windMs: row.windSpeed, windFrom: row.windDir, currentMs: row.currentSpeed, currentTo: row.currentBearing, waveM: 0.6 + row.windSpeed * 0.09, sstC: 25.8, source: 'ERA5 + INCOIS, nearest grid point' }
        : { windMs: 4 + (h % 60) / 10, windFrom: (h * 37) % 360, currentMs: 0.15 + (h % 30) / 100, currentTo: (h * 53) % 360, waveM: 0.5 + (h % 12) / 10, sstC: 26 + (h % 30) / 10, source: 'Reanalysis at the detection' });
    })();
    return () => void (live = false);
  }, [slick.id, incidentId]);

  // The clock, T−12 h to the pass.
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setT((x) => {
        const next = x + dt * 0.8;
        if (next >= 0) { setPlaying(false); return 0; }
        return next;
      });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const [shown, setShown] = useState<Record<LayerKey, boolean>>({
    imagery: true, slick: true, footprint: false, vessels: true, tracks: true, cpa: true, sites: true, lanes: false, protected: false, rings: false, depth: false, env: false, alltracks: false, allcpa: false,
  });
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState<'all' | 'tanker' | 'cargo' | 'fishing' | 'gap' | 'near'>('all');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [hover, setHover] = useState<Pt>();
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [paneW, setPaneW] = useState(40);
  const [dockH, setDockH] = useState(30);
  const [showAll, setShowAll] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Drag a grip: pointer capture, one clamped percentage of the page box.
  const drag = (axis: 'x' | 'y') => (e: RPointerEvent<HTMLDivElement>) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => axis === 'x'
      ? setPaneW(Math.max(22, Math.min(65, ((box.right - ev.clientX) / box.width) * 100)))
      : setDockH(Math.max(12, Math.min(70, ((box.bottom - ev.clientY) / box.height) * 100)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Derived per-vessel figures.
  const rows = useMemo(() => (vessels ?? []).map((v) => {
    const now = vesselAt(v, t);
    const cpa = closestApproach(v, centre);
    return { v, now, cpa, dist: kmBetween(now.at, centre) };
  }), [vessels, t]);
  const filtered = rows
    .filter(({ v, dist }) => filter === 'all' || (filter === 'tanker' ? v.kind === 'tanker' || v.kind === 'gas' : filter === 'cargo' ? ['container', 'bulk', 'cargo'].includes(v.kind) : filter === 'fishing' ? v.kind === 'fishing' : filter === 'gap' ? v.gaps.length > 0 : dist <= 10))
    .sort((a, b) => {
      const val = (r: (typeof rows)[number]): number | string => ({ rank: r.v.rank ?? 999, name: r.v.name, len: r.v.lengthM, dist: r.dist, cpa: r.cpa.km, cpat: r.cpa.t, kn: r.now.knots, cog: r.now.heading, gap: r.v.gaps.reduce((s, g) => s + g[1] - g[0], 0), score: r.v.score ?? 0 } as Record<string, number | string>)[sort.key];
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  const sel = rows.find((r) => r.v.id === selected);

  const footprint: [number, number, number, number] | undefined = detection?.sarImagery?.bounds ?? (() => {
    const pts = rings.flat();
    if (!pts.length) return undefined;
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const px = Math.max((e - w) * 0.42, 0.012);
    const py = Math.max((n - s) * 0.42, 0.012);
    return [w - px, s - py, e + px, n + py];
  })();

  return (
    <div className="dmap" ref={root} style={{ gridTemplateColumns: `minmax(0, 1fr) auto ${paneW}%` }}>
      <div className="dm-left" style={{ gridTemplateRows: `minmax(0, 1fr) auto ${dockH}%`, ["--dock-h" as string]: `calc(${dockH}% + 5px)` }}>
        <MapCanvas
          centre={centre} rings={rings} rows={rows} t={t} shown={shown} selected={selected} onSelect={setSelected}
          land={land} env={env} footprint={footprint} onHover={setHover}
        />
        <div className="dm-overlay dm-legend" data-open={layersOpen || undefined}>
          <header>
            <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
              <Layers size={14} />Layers<span className="num">{Object.values(shown).filter(Boolean).length}/{Object.keys(shown).length}</span>
              <ChevronDown size={14} className="dm-legend-chev" />
            </button>
          </header>
          {layersOpen && (Object.keys(LAYER_LABEL) as LayerKey[]).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={shown[k]} onChange={() => setShown((s) => ({ ...s, [k]: !s[k] }))} />
              <i className={`dm-key k-${k}`} />
              <span>{LAYER_LABEL[k]}</span>
              <b className="num">{layerCount(k, rows, centre)}</b>
            </label>
          ))}
        </div>
        <div className="dm-overlay dm-clock">
          <button type="button" onClick={() => { if (t >= 0) setT(-12); setPlaying(!playing); }} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input type="range" min={-12} max={0} step={1 / 12} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-label="Clock" />
          <span className="num"><b>{hrs(t)}</b> {when.format(t0 + t * 3_600_000)} UTC</span>
        </div>
        <div className="dm-overlay dm-readout num">
          {hover ? (
            <>
              <span className="mono">{hover[1].toFixed(4)}° N {hover[0].toFixed(4)}° E</span>
              <span>{f1(kmBetween(centre, hover))} km {COMPASS(bearingOf(centre, hover))} of slick</span>
              <span>brg {bearingOf(centre, hover).toFixed(0)}°</span>
              <span>depth ≈ {depthAt(land, hover)} m</span>
            </>
          ) : <span>Hover the chart for position, range and bearing from the slick</span>}
        </div>

        <div className="dm-grip is-y" role="separator" aria-orientation="horizontal" aria-label="Resize the vessel table" onPointerDown={drag('y')} />
        <section className="dm-dock" aria-label="Vessels">
          <header>
            <h3><Ship size={15} />Vessels <span className="num">{filtered.length}/{rows.length}</span></h3>
            <div className="dm-filters">
              {([['all', 'All'], ['tanker', 'Tankers'], ['cargo', 'Cargo'], ['fishing', 'Fishing'], ['gap', 'AIS gap'], ['near', '≤ 10 km']] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
          </header>
          <div className="dm-table-wrap">
            <table className="dm-table">
              <thead>
                <tr>
                  {([['rank', '#'], ['name', 'Vessel'], ['', 'Flag'], ['dist', 'Now km'], ['cpa', 'CPA km'], ['cpat', 'CPA at'], ['kn', 'SOG kn'], ['gap', 'AIS gap'], ['score', 'Score']] as const).map(([k, label]) => (
                    <th key={label} className={k && k !== 'name' ? 'is-num' : undefined}>
                      {k ? (
                        <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
                          {label}{sort.key === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                        </button>
                      ) : label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(showAll ? filtered : filtered.slice(0, 10)).map(({ v, now, cpa, dist }) => {
                  const gapMin = Math.round(v.gaps.reduce((s, g) => s + g[1] - g[0], 0) * 60);
                  return (
                    <tr key={v.id} aria-selected={v.id === selected} onClick={() => setSelected(v.id === selected ? undefined : v.id)}>
                      <td className="is-num">{v.rank ?? '—'}</td>
                      <td><span className="dm-vname"><i className={`dm-dot is-${tone(v)}`} /><b>{v.name}</b><small>{v.type}</small></span></td>
                      <td className="mono">{v.flag}</td>
                      <td className="is-num">{f1(dist)}</td>
                      <td className="is-num">{f1(cpa.km)}</td>
                      <td className="is-num">{hrs(cpa.t)}</td>
                      <td className="is-num">{f1(now.knots)}</td>
                      <td className="is-num">{gapMin ? <span className="dm-gap">{gapMin} min</span> : '—'}</td>
                      <td className="is-num"><span className="dm-score"><i style={{ transform: `scaleX(${v.score ?? 0})` }} />{(v.score ?? 0).toFixed(3)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!vessels && <p className="dm-loading">Loading AIS…</p>}
            {filtered.length > 10 && <button type="button" className="dm-more" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show top 10' : `Show all ${filtered.length}`}</button>}
          </div>
        </section>
      </div>

      <div className="dm-grip is-x" role="separator" aria-orientation="vertical" aria-label="Resize the detail pane" onPointerDown={drag('x')} />
      <aside className="dm-pane">
        {sel ? (
          <VesselCard row={sel} centre={centre} t0={t0} onBack={() => setSelected(undefined)} done={done} setDone={setDone} />
        ) : (
          <AreaSummary rows={rows} centre={centre} t={t} land={land} env={env} onSelect={setSelected} shown={shown} setShown={setShown} />
        )}
      </aside>
    </div>
  );
}

function layerCount(k: LayerKey, rows: { v: MapVessel; cpa: { km: number } }[], centre: Pt): string {
  switch (k) {
    case 'vessels': return String(rows.length);
    case 'tracks': return String(rows.reduce((s, r) => s + r.v.points.length, 0));
    case 'cpa': return String(Math.min(3, rows.length));
    case 'alltracks': return String(rows.length);
    case 'allcpa': return String(rows.length);
    case 'sites': return String(SITES.filter((s) => kmBetween(s.at, centre) < 80).length);
    case 'protected': return String(PROTECTED.filter((s) => kmBetween(s.at, centre) < 80).length);
    case 'lanes': return String(LANES.length + ANCHORAGES.filter((a) => kmBetween(a.at, centre) < 80).length);
    case 'rings': return '3';
    default: return '';
  }
}

/* ----------------------------------------------------------------- chart */

interface Row { v: MapVessel; now: { at: Pt; heading: number; knots: number }; cpa: { km: number; t: number; at: Pt }; dist: number }

function MapCanvas({
  centre, rings, rows, t, shown, selected, onSelect, land, env, footprint, onHover,
}: {
  centre: Pt; rings: number[][][]; rows: Row[]; t: number; shown: Record<LayerKey, boolean>; selected?: string; onSelect: (id?: string) => void;
  land?: Land; env?: Env; footprint?: [number, number, number, number]; onHover: (p?: Pt) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | undefined>(undefined);
  const base = useRef<{ imagery: L.TileLayer; chart: L.TileLayer } | undefined>(undefined);
  const statics = useRef<L.LayerGroup | undefined>(undefined);
  const movers = useRef<L.LayerGroup | undefined>(undefined);
  const markers = useRef(new Map<string, L.Marker>());

  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: false, zoomSnap: 0.25 });
    base.current = {
      imagery: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Esri, Maxar, Earthstar Geographics' }),
      chart: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 17, attribution: '© OpenStreetMap, © CARTO' }),
    };
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, opacity: 0.75, pane: 'overlayPane' }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(m);
    m.setView(ll(centre), 11);
    m.on('mousemove', (e) => onHover([e.latlng.lng, e.latlng.lat]));
    m.on('mouseout', () => onHover(undefined));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  useEffect(() => {
    const m = map.current!;
    const b = base.current!;
    (shown.imagery ? b.chart : b.imagery).remove();
    (shown.imagery ? b.imagery : b.chart).addTo(m).bringToBack();
  }, [shown.imagery]);

  const fit = (what: 'slick' | 'vessels') => {
    const m = map.current!;
    if (what === 'slick') m.flyToBounds(L.latLngBounds(rings.flat().map((q) => ll(q as Pt))).pad(2.5), { duration: 0.5, maxZoom: 13 });
    else if (rows.length) m.flyToBounds(L.latLngBounds([...rows.map((r) => ll(r.now.at)), ll(centre)]).pad(0.1), { duration: 0.5 });
  };
  useEffect(() => { if (rings.length) fit('slick'); }, [rings.length]);

  // Static layers.
  useEffect(() => {
    const m = map.current!;
    statics.current?.remove();
    const g = L.layerGroup().addTo(m);
    statics.current = g;
    const near = (p: Pt, km = 80) => kmBetween(p, centre) < km;

    if (shown.lanes) {
      for (const lane of LANES) {
        L.polyline(lane.line.map(ll), { className: 'dm-lane', interactive: false }).addTo(g);
        L.polyline(lane.line.map(ll), { className: 'dm-lane-axis', dashArray: '10 8', interactive: false }).addTo(g);
      }
      for (const a of ANCHORAGES.filter((x) => near(x.at))) {
        L.circle(ll(a.at), { radius: a.radiusKm * 1000, className: 'dm-anchorage', dashArray: '4 4', interactive: false }).addTo(g);
        L.marker(ll(a.at), { icon: chip(`⚓ ${a.name}`, 'is-quiet'), interactive: false }).addTo(g);
      }
    }
    if (shown.protected) {
      for (const a of PROTECTED.filter((x) => near(x.at, 100))) {
        L.circle(ll(a.at), { radius: a.radiusKm * 1000, className: 'dm-protected', interactive: false }).addTo(g);
        L.marker(ll(move(a.at, 0, a.radiusKm * 0.6)), { icon: chip(`${a.name} · ${a.kind}`, 'is-clear'), interactive: false }).addTo(g);
      }
    }
    if (shown.depth) {
      for (const s of soundings(land, [centre[0] - 0.3, centre[1] - 0.22, centre[0] + 0.3, centre[1] + 0.22], String(centre))) {
        L.marker(ll(s.at), { icon: L.divIcon({ className: 'dm-sounding', html: `<span>${s.m}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(g);
      }
    }
    if (shown.env && env) {
      for (let i = -3; i <= 3; i++) {
        for (let j = -2; j <= 2; j++) {
          const at: Pt = [centre[0] + i * 0.07, centre[1] + j * 0.06];
          if (onLandSafe(land, at)) continue;
          const wob = Math.sin(i * 1.3 + j * 2.1) * 8;
          L.marker(ll(at), { icon: arrow((env.windFrom + 180 + wob) % 360, 'wind', env.windMs / 8), interactive: false }).addTo(g);
          L.marker(ll(move(at, 135, 2.2)), { icon: arrow(env.currentTo - wob, 'current', env.currentMs / 0.4), interactive: false }).addTo(g);
        }
      }
    }
    if (shown.rings) {
      for (const km of [5, 10, 20]) {
        L.circle(ll(centre), { radius: km * 1000, className: 'dm-ring', interactive: false }).addTo(g);
        L.marker(ll(move(centre, 45, km)), { icon: chip(`${km} km`, 'is-quiet'), interactive: false }).addTo(g);
      }
    }
    if (shown.footprint && footprint) {
      const [w, s, e, n] = footprint;
      L.rectangle([[s, w], [n, e]], { className: 'dm-footprint', dashArray: '8 5', interactive: false }).addTo(g);
      L.marker([n, w], { icon: chip('SAR scene footprint', 'is-quiet'), interactive: false }).addTo(g);
    }
    if (shown.sites) {
      for (const site of SITES.filter((x) => near(x.at))) {
        L.circle(ll(site.at), { radius: 500, className: 'dm-safety', interactive: false }).addTo(g);
        L.marker(ll(site.at), {
          icon: L.divIcon({ className: `dm-site is-${site.kind}`, html: site.kind === 'platform' ? '<svg viewBox="-8 -8 16 16"><rect x="-5" y="-5" width="10" height="10"/><path d="M-5,-5 L5,5 M5,-5 L-5,5"/></svg>' : '<svg viewBox="-8 -8 16 16"><circle r="5"/><circle r="1.6" class="c"/></svg>', iconSize: [16, 16], iconAnchor: [8, 8] }),
          title: site.name,
        }).bindTooltip(`<b>${site.name}</b> <i>${site.operator}</i>`, { direction: 'right', offset: [10, 0], className: 'dm-tip' }).addTo(g);
      }
    }
    if (shown.slick && rings.length) {
      L.polygon(rings.map((r) => r.map((q) => ll(q as Pt))), { className: 'dm-slick' }).addTo(g);
      L.circleMarker(ll(centre), { radius: 3, className: 'dm-centre', interactive: false }).addTo(g);
    }
    if (shown.tracks) {
      for (const r of rows.filter((x) => shown.alltracks || (x.v.rank && x.v.rank <= 5) || x.v.id === selected)) {
        const v = r.v;
        const cls = `dm-track is-${tone(v, selected)}`;
        const pts = v.points;
        const seg: L.LatLngTuple[][] = [[]];
        for (let i = 0; i < pts.length; i++) {
          if (i && v.gaps.some(([a, b]) => pts[i - 1].t === a && pts[i].t === b)) {
            L.polyline([ll([pts[i - 1].lon, pts[i - 1].lat]), ll([pts[i].lon, pts[i].lat])], { className: `${cls} is-gap`, dashArray: '6 5', interactive: false }).addTo(g);
            const mid: Pt = [(pts[i - 1].lon + pts[i].lon) / 2, (pts[i - 1].lat + pts[i].lat) / 2];
            if ((v.rank && v.rank <= 3) || v.id === selected) L.marker(ll(mid), { icon: chip(`AIS gap ${Math.round((pts[i].t - pts[i - 1].t) * 60)} min`, 'is-warning is-mini'), interactive: false }).addTo(g);
            seg.push([]);
          }
          seg[seg.length - 1].push(ll([pts[i].lon, pts[i].lat]));
        }
        for (const s of seg) if (s.length > 1) L.polyline(s, { className: cls, interactive: false }).addTo(g);
      }
    }
    if (shown.cpa) {
      for (const r of [...rows].sort((a, b) => (a.v.rank ?? 99) - (b.v.rank ?? 99)).slice(0, shown.allcpa ? rows.length : 3)) {
        const target = nearestOnSlick(rings, r.cpa.at) ?? centre;
        L.polyline([ll(r.cpa.at), ll(target)], { className: 'dm-cpa', dashArray: '2 4', interactive: false }).addTo(g);
        L.circleMarker(ll(r.cpa.at), { radius: 3, className: 'dm-cpa-dot', interactive: false }).addTo(g);
        if (r.v.rank === 1 || r.v.id === selected) L.marker(ll(r.cpa.at), { icon: chip(`CPA ${f1(r.cpa.km)} km`, 'is-warning is-mini'), interactive: false }).addTo(g);
      }
    }
    return () => void g.remove();
  }, [shown, rows.length, selected, land, env, footprint?.join()]);

  // Vessels at the clock.
  useEffect(() => {
    const m = map.current!;
    movers.current?.remove();
    markers.current.clear();
    const g = L.layerGroup().addTo(m);
    movers.current = g;
    if (!shown.vessels) return;
    for (const r of rows) {
      const v = r.v;
      const tn = tone(v, selected);
      const mk = L.marker(ll(r.now.at), { icon: shipIcon(v, tn), zIndexOffset: tn === 'selected' ? 1000 : v.rank ? 500 - v.rank : 0, title: v.name });
      mk.on('click', () => onSelect(v.id === selected ? undefined : v.id));
      if ((v.rank && v.rank <= 3) || v.id === selected) {
        mk.bindTooltip(`<b>${v.name}</b> <i>${v.rank ? `#${v.rank} · ${(v.score ?? 0).toFixed(2)}` : v.type}</i>`, { permanent: true, direction: 'right', offset: [12, 0], className: `dm-tip is-${tn}` });
      }
      mk.addTo(g);
      markers.current.set(v.id, mk);
    }
    return () => void g.remove();
  }, [rows.length, selected, shown.vessels]);

  useEffect(() => {
    for (const r of rows) {
      const mk = markers.current.get(r.v.id);
      if (!mk) continue;
      mk.setLatLng(ll(r.now.at));
      mk.getElement()?.querySelector('svg')?.style.setProperty('transform', `rotate(${r.now.heading}deg)`);
    }
  }, [t, rows]);

  useEffect(() => {
    const r = rows.find((x) => x.v.id === selected);
    if (r) map.current!.flyTo(ll(r.now.at), Math.max(map.current!.getZoom(), 11), { duration: 0.5 });
  }, [selected]);

  return (
    <div className="dm-map-wrap">
      <div className="dm-map" ref={host} />
      <div className="dm-overlay dm-fit">
        <button type="button" onClick={() => fit('slick')}><Target size={14} />Fit slick</button>
        <button type="button" onClick={() => fit('vessels')}><Maximize size={14} />Fit all vessels</button>
      </div>
    </div>
  );
}

const onLandSafe = (land: Land | undefined, p: Pt) => (land ? coastKm(land, p) !== undefined && coastKm(land, p)! < 0.8 : false);

function nearestOnSlick(rings: number[][][], p: Pt): Pt | undefined {
  let best: Pt | undefined;
  let d = Infinity;
  for (const q of rings.flat()) {
    const k = kmBetween(p, q as Pt);
    if (k < d) { d = k; best = q as Pt; }
  }
  return best;
}

function arrow(deg: number, kind: 'wind' | 'current', strength: number) {
  const len = Math.round(16 + Math.min(1.4, strength) * 12);
  return L.divIcon({
    className: `dm-arrow is-${kind}`,
    html: `<svg width="${len}" height="${len}" viewBox="-10 -10 20 20" style="transform:rotate(${deg}deg)"><path d="M0,9 L0,-8 M-3.6,-4 L0,-8.5 L3.6,-4"/></svg>`,
    iconSize: [len, len],
    iconAnchor: [len / 2, len / 2],
  });
}

/* ------------------------------------------------------------- the pane */

function Tile({ label, value, unit, note, tone: tn }: { label: string; value: string; unit?: string; note?: string; tone?: 'critical' | 'warning' | 'clear' }) {
  return (
    <div className="dm-tile" data-tone={tn}>
      <span>{label}</span>
      <b className="num">{value}{unit && <small>{unit}</small>}</b>
      {note && <em>{note}</em>}
    </div>
  );
}

function AreaSummary({ rows, centre, t, land, env, onSelect, shown, setShown }: { rows: Row[]; centre: Pt; t: number; land?: Land; env?: Env; onSelect: (id: string) => void; shown: Record<LayerKey, boolean>; setShown: (fn: (s: Record<LayerKey, boolean>) => Record<LayerKey, boolean>) => void }) {
  const [details, setDetails] = useState<Record<'sites' | 'areas' | 'conditions', boolean>>({ sites: false, areas: false, conditions: false });
  const within = rows.filter((r) => r.dist <= 20);
  const tankers = rows.filter((r) => r.v.kind === 'tanker' || r.v.kind === 'gas');
  const gaps = rows.filter((r) => r.v.gaps.length);
  const nearest = [...rows].sort((a, b) => a.dist - b.dist)[0];
  const sites = SITES.map((s) => ({ ...s, km: kmBetween(s.at, centre) })).filter((s) => s.km < 80).sort((a, b) => a.km - b.km);
  const areas = PROTECTED.map((s) => ({ ...s, km: Math.max(0, kmBetween(s.at, centre) - s.radiusKm) })).filter((s) => s.km < 60).sort((a, b) => a.km - b.km);
  const anchor = ANCHORAGES.map((s) => ({ ...s, km: Math.max(0, kmBetween(s.at, centre) - s.radiusKm) })).sort((a, b) => a.km - b.km)[0];
  const coast = coastKm(land, centre);
  const kinds = KIND_ORDER.map((k) => ({ k, n: rows.filter((r) => r.v.kind === k).length })).filter((x) => x.n);

  return (
    <>
      <section className="dm-card dm-hero">
        <div>
          <h2>Traffic around the slick</h2>
          <p>{rows.length} vessels on AIS in the 12 h before the pass; {within.length} within 20 km at {hrs(t)}. Select a vessel on the chart or in the table for its record.</p>
        </div>
        <Badge claim="observed">AIS</Badge>
      </section>

      <section className="dm-card dm-options">
        <header className="dm-head"><h3><Eye size={15} />Show on map</h3><span className="dm-meta">off by default, to keep the chart readable</span></header>
        <div className="sc-filter-row">
          <span className="sc-filter-side">Map</span>
          <div className="sc-filter-buttons" role="group" aria-label="Map layers">
            {([
              ['footprint', 'Scene footprint', 'SAR frame', Maximize],
              ['lanes', 'Lanes & anchorages', `${layerCount('lanes', rows, centre)} charted`, Anchor],
              ['protected', 'Protected areas', `${layerCount('protected', rows, centre)} within 80 km`, Leaf],
              ['rings', 'Search rings', '5 / 10 / 20 km', Target],
              ['alltracks', 'Every track', `${rows.length} vessels, not top 5`, Navigation],
              ['allcpa', 'Every closest approach', `${rows.length} lines, not top 3`, Crosshair],
              ['depth', 'Soundings', 'chart depths', Waves],
              ['env', 'Wind & current', 'arrows at the pass', Wind],
            ] as const).map(([k, label, meta, Icon]) => (
              <button key={k} type="button" aria-pressed={shown[k]} onClick={() => setShown((x) => ({ ...x, [k]: !x[k] }))}>
                <Icon size={14} /><span><b>{label}</b><small>{meta}</small></span>
              </button>
            ))}
          </div>
        </div>
        <div className="sc-filter-row">
          <span className="sc-filter-side">Details</span>
          <div className="sc-filter-buttons" role="group" aria-label="Detail sections">
            {([
              ['sites', 'Infrastructure', `${sites.length} within 80 km`, Factory],
              ['areas', 'Sensitive areas', `${areas.length} within 60 km`, Leaf],
              ['conditions', 'Full conditions', 'SST, bearings, source', Gauge],
            ] as const).map(([k, label, meta, Icon]) => (
              <button key={k} type="button" aria-pressed={details[k]} onClick={() => setDetails((x) => ({ ...x, [k]: !x[k] }))}>
                <Icon size={14} /><span><b>{label}</b><small>{meta}</small></span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {details.conditions && env && (
        <section className="dm-card">
          <header className="dm-head"><h3><Wind size={15} />Conditions at the pass</h3></header>
          <dl className="dm-rows dm-rows-2">
            <div><dt>Wind</dt><dd className="num">{f1(env.windMs)} m/s from {COMPASS(env.windFrom)} <small>{env.windFrom.toFixed(0)}°</small></dd></div>
            <div><dt>Current</dt><dd className="num">{env.currentMs.toFixed(2)} m/s to {COMPASS(env.currentTo)} <small>{env.currentTo.toFixed(0)}°</small></dd></div>
            <div><dt>Sea state</dt><dd className="num">{f1(env.waveM)} m <small>significant</small></dd></div>
            <div><dt>SST</dt><dd className="num">{f1(env.sstC)} °C</dd></div>
            <div><dt>Look-alike band</dt><dd>{env.windMs >= 3 && env.windMs <= 12 ? <span className="dm-ok">inside 3–12 m/s</span> : <span className="dm-bad">outside 3–12 m/s</span>}</dd></div>
            <div><dt>Source</dt><dd><small>{env.source}</small></dd></div>
          </dl>
        </section>
      )}
      {details.sites && (
        <section className="dm-card">
          <header className="dm-head"><h3><Factory size={15} />Infrastructure ≤ 80 km</h3><span className="dm-meta num">{sites.length}</span></header>
          <ul className="dm-list">
            {sites.map((s) => <li key={s.name}><i className={`dm-site-dot is-${s.kind}`} /><span><b>{s.name}</b><small>{s.operator} · {s.kind === 'spm' ? 'Single-point mooring' : s.kind === 'platform' ? 'Offshore platform' : 'Oil terminal'}</small></span><b className="num">{f1(s.km)} km</b></li>)}
            {!sites.length && <li><span><small>No charted rigs, SPMs or terminals within 80 km.</small></span></li>}
          </ul>
        </section>
      )}
      {details.areas && (
        <section className="dm-card">
          <header className="dm-head"><h3><Leaf size={15} />Sensitive areas ≤ 60 km</h3><span className="dm-meta num">{areas.length}</span></header>
          <ul className="dm-list is-two">
            {areas.map((a) => <li key={a.name}><i className="dm-area-dot" /><span><b>{a.name}</b><small>{a.kind}</small></span><b className="num">{a.km < 0.1 ? 'inside' : `${f1(a.km)} km`}</b></li>)}
            {!areas.length && <li><span><small>None within 60 km.</small></span></li>}
          </ul>
        </section>
      )}

      <section className="dm-tiles">
        <Tile label="Vessels ≤ 20 km" value={String(within.length)} note={`of ${rows.length} tracked`} />
        <Tile label="AIS gaps" value={String(gaps.length)} note="silent > 40 min" tone={gaps.length ? 'critical' : 'clear'} />
        <Tile label="Nearest vessel" value={nearest ? f1(nearest.dist) : '—'} unit="km" note={nearest?.v.name} />
        <Tile label="To the coast" value={coast !== undefined ? f1(coast) : '> 100'} unit="km" note="nearest shoreline" />
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><Crosshair size={15} />Distance to the slick over time</h3><span className="dm-meta">top 8 by rank · T−12 h → T0</span></header>
        <Proximity rows={rows} centre={centre} t={t} onSelect={onSelect} />
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><Ship size={15} />Traffic</h3><span className="dm-meta num">{rows.length} vessels · {tankers.length} tankers</span></header>
        <div className="dm-stack">{kinds.map(({ k, n }) => <span key={k} className={`k-${k}`} style={{ flexGrow: n }} title={`${KIND_LABEL[k]}: ${n}`} />)}</div>
        <ul className="dm-stack-key">{kinds.map(({ k, n }) => <li key={k}><i className={`k-${k}`} />{KIND_LABEL[k]}<b className="num">{n}</b></li>)}</ul>
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><Wind size={15} />Surroundings</h3></header>
        <dl className="dm-rows dm-rows-2">
          <div><dt>Wind</dt><dd className="num">{env ? `${f1(env.windMs)} m/s from ${COMPASS(env.windFrom)}` : '…'}</dd></div>
          <div><dt>Current</dt><dd className="num">{env ? `${env.currentMs.toFixed(2)} m/s to ${COMPASS(env.currentTo)}` : '…'}</dd></div>
          <div><dt>Sea state</dt><dd className="num">{env ? `${f1(env.waveM)} m` : '…'}</dd></div>
          <div><dt>Depth</dt><dd className="num">{depthAt(land, centre)} m</dd></div>
          <div><dt>Nearest rig / SPM</dt><dd>{sites[0] ? <>{sites[0].name} <small className="num">{f1(sites[0].km)} km</small></> : 'none ≤ 80 km'}</dd></div>
          <div><dt>Anchorage</dt><dd>{anchor ? <>{anchor.name} <small className="num">{f1(anchor.km)} km</small></> : '—'}</dd></div>
          <div><dt>Sensitive area</dt><dd>{areas[0] ? <>{areas[0].name} <small className="num">{areas[0].km < 0.1 ? 'inside' : `${f1(areas[0].km)} km`}</small></> : 'none ≤ 60 km'}</dd></div>
          <div><dt>Look-alike band</dt><dd>{env && env.windMs >= 3 && env.windMs <= 12 ? <span className="dm-ok">inside 3–12 m/s</span> : <span className="dm-bad">outside</span>}</dd></div>
        </dl>
      </section>
    </>
  );
}

/** Each vessel's range to the slick through the window; the one that dives at the release stands out. */
function Proximity({ rows, centre, t, onSelect }: { rows: Row[]; centre: Pt; t: number; onSelect: (id: string) => void }) {
  const top = [...rows].sort((a, b) => (a.v.rank ?? 99) - (b.v.rank ?? 99)).slice(0, 8);
  const W = 520;
  const H = 150;
  const maxKm = 30;
  const x = (h: number) => ((h + 12) / 12) * W;
  const y = (km: number) => (Math.min(km, maxKm) / maxKm) * H;
  return (
    <svg className="dm-prox" viewBox={`-30 -8 ${W + 44} ${H + 26}`} role="img" aria-label="Distance to the slick over time">
      {[0, 10, 20, 30].map((k) => (
        <g key={k}><line x1={0} x2={W} y1={y(k)} y2={y(k)} className="grid" /><text x={-6} y={y(k) + 3} className="ax" textAnchor="end">{k}</text></g>
      ))}
      {[-12, -9, -6, -3, 0].map((h) => <text key={h} x={x(h)} y={H + 16} className="ax" textAnchor="middle">{h === 0 ? 'T0' : `${h} h`}</text>)}
      <line x1={x(t)} x2={x(t)} y1={0} y2={H} className="now" />
      {top.map((r, i) => {
        const pts: string[] = [];
        for (let h = -12; h <= 0.001; h += 0.25) pts.push(`${x(h).toFixed(1)},${y(kmBetween(vesselAt(r.v, h).at, centre)).toFixed(1)}`);
        return <polyline key={r.v.id} points={pts.join(' ')} className={`ln ${i === 0 ? 'is-top' : ''} is-${tone(r.v)}`} onClick={() => onSelect(r.v.id)}><title>{r.v.name}</title></polyline>;
      })}
      {top[0] && <text x={x(top[0].cpa.t) + 6} y={y(top[0].cpa.km) - 6} className="lbl">{top[0].v.name} · {f1(top[0].cpa.km)} km</text>}
      <text x={-26} y={-1} className="ax">km</text>
    </svg>
  );
}

function VesselCard({ row, centre, t0, onBack, done, setDone }: { row: Row; centre: Pt; t0: number; onBack: () => void; done: Record<string, boolean>; setDone: (f: (d: Record<string, boolean>) => Record<string, boolean>) => void }) {
  const { v, now, cpa, dist } = row;
  const pts = v.points;
  let sailed = 0;
  let maxKn = 0;
  let turns = 0;
  const speeds: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = kmBetween([pts[i - 1].lon, pts[i - 1].lat], [pts[i].lon, pts[i].lat]);
    sailed += d;
    const kn = d / Math.max(0.01, pts[i].t - pts[i - 1].t) / 1.852;
    speeds.push(kn);
    maxKn = Math.max(maxKn, kn);
    if (i > 1) {
      const b1 = bearingOf([pts[i - 2].lon, pts[i - 2].lat], [pts[i - 1].lon, pts[i - 1].lat]);
      const b2 = bearingOf([pts[i - 1].lon, pts[i - 1].lat], [pts[i].lon, pts[i].lat]);
      if (Math.abs(((b2 - b1 + 540) % 360) - 180) > 25 && d > 0.2) turns++;
    }
  }
  const hoursNear = pts.filter((q) => kmBetween([q.lon, q.lat], centre) < 5).length * ((pts[pts.length - 1].t - pts[0].t) / pts.length);
  const span = pts[pts.length - 1].t - pts[0].t;
  const key = (a: string) => `${v.id}:${a}`;
  const maxSp = Math.max(1, ...speeds);

  return (
    <>
      <button type="button" className="dm-back" onClick={onBack}><ArrowLeft size={14} />Area overview</button>
      <section className={`dm-card dm-vhero is-${tone(v)}`}>
        <div className="dm-vicon"><Ship size={22} /></div>
        <div>
          <h2>{v.name}</h2>
          <p>{v.type} · {v.flag} · {v.lengthM} m</p>
        </div>
        {v.rank && <div className="dm-rank"><span>Rank</span><b className="num">#{v.rank}</b><small className="num">{(v.score ?? 0).toFixed(3)}</small></div>}
      </section>

      <section className="dm-tiles">
        <Tile label="Now" value={f1(dist)} unit="km" note="from the slick" />
        <Tile label="Closest approach" value={f1(cpa.km)} unit="km" note={hrs(cpa.t)} tone={cpa.km < 2 ? 'critical' : cpa.km < 5 ? 'warning' : undefined} />
        <Tile label="Speed" value={f1(now.knots)} unit="kn" note={`COG ${now.heading.toFixed(0)}°`} />
        <Tile label="AIS gaps" value={String(v.gaps.length)} note={v.gaps.length ? `${Math.round(v.gaps.reduce((s, g) => s + g[1] - g[0], 0) * 60)} min silent` : 'continuous'} tone={v.gaps.length ? 'critical' : 'clear'} />
      </section>

      <div className="dm-grid">
        <section className="dm-card">
          <header className="dm-head"><h3><Flag size={15} />Identity</h3></header>
          <dl className="dm-rows">
            <div><dt>MMSI</dt><dd className="mono">{v.mmsi}</dd></div>
            <div><dt>IMO</dt><dd className="mono">{v.imo}</dd></div>
            <div><dt>Call sign</dt><dd className="mono">{v.callsign}</dd></div>
            <div><dt>Flag</dt><dd>{v.flag}</dd></div>
            <div><dt>Type</dt><dd>{v.type}</dd></div>
            <div><dt>LOA</dt><dd className="num">{v.lengthM} m</dd></div>
            <div><dt>Deadweight</dt><dd className="num">{v.dwt.toLocaleString('en-GB')} t</dd></div>
            <div><dt>Built</dt><dd className="num">{v.built}</dd></div>
          </dl>
        </section>
        <section className="dm-card">
          <header className="dm-head"><h3><Compass size={15} />Voyage</h3></header>
          <dl className="dm-rows">
            <div><dt>Last port</dt><dd>{v.lastPort}</dd></div>
            <div><dt>Destination</dt><dd>{v.nextPort}</dd></div>
            <div><dt>ETA</dt><dd className="num">{when.format(t0 + v.etaH * 3_600_000)} UTC</dd></div>
            <div><dt>Draught</dt><dd className="num">{f1(v.draughtM)} m</dd></div>
            <div><dt>Sailed</dt><dd className="num">{f1(sailed)} km <small>in {f1(span)} h</small></dd></div>
            <div><dt>Avg / max</dt><dd className="num">{f1(sailed / Math.max(0.1, span) / 1.852)} / {f1(maxKn)} kn</dd></div>
            <div><dt>Turns &gt; 25°</dt><dd className="num">{turns}</dd></div>
            <div><dt>Time ≤ 5 km</dt><dd className="num">{f1(hoursNear)} h</dd></div>
          </dl>
        </section>
      </div>

      <section className="dm-card">
        <header className="dm-head"><h3><Gauge size={15} />Speed over ground</h3><span className="dm-meta num">{pts.length} AIS fixes</span></header>
        <div className="dm-spark">{speeds.map((s, i) => <span key={i} style={{ height: `${(s / maxSp) * 100}%` }} data-gap={v.gaps.some(([a]) => Math.abs(pts[i].t - a) < 0.01) || undefined} />)}</div>
        <div className="dm-spark-axis"><span>{hrs(pts[0].t)}</span><span>{hrs(pts[pts.length - 1].t)}</span></div>
      </section>

      {v.parts && (
        <section className="dm-card">
          <header className="dm-head"><h3><Target size={15} />Why it ranks here</h3><span className="dm-meta">0.60 proximity + 0.25 timing + 0.15 heading</span></header>
          {([['Proximity', v.parts.proximity, 0.6], ['Timing', v.parts.temporality, 0.25], ['Heading fit', v.parts.parity, 0.15]] as const).map(([label, val, w]) => (
            <div key={label} className="dm-bar"><span>{label}<small>weight {w}</small></span><i><em style={{ transform: `scaleX(${val})` }} /></i><b className="num">{val.toFixed(2)}</b><b className="num dm-contrib">+{(val * w).toFixed(3)}</b></div>
          ))}
          {v.why && <p className="dm-why">{v.why}</p>}
        </section>
      )}

      {v.gaps.length > 0 && (
        <section className="dm-card dm-gapcard">
          <header className="dm-head"><h3><Radio size={15} />AIS gap</h3></header>
          {v.gaps.map(([a, b]) => {
            const pa = vesselAt(v, a).at;
            const pb = vesselAt(v, b).at;
            return (
              <dl key={a} className="dm-rows">
                <div><dt>Went silent</dt><dd className="num">{hrs(a)} · {when.format(t0 + a * 3_600_000)}</dd></div>
                <div><dt>Reappeared</dt><dd className="num">{hrs(b)} · {when.format(t0 + b * 3_600_000)}</dd></div>
                <div><dt>Duration</dt><dd className="num">{Math.round((b - a) * 60)} min</dd></div>
                <div><dt>Moved</dt><dd className="num">{f1(kmBetween(pa, pb))} km <small>implied {f1(kmBetween(pa, pb) / (b - a) / 1.852)} kn</small></dd></div>
                <div><dt>From</dt><dd className="mono">{pa[1].toFixed(3)}, {pa[0].toFixed(3)}</dd></div>
                <div><dt>To</dt><dd className="mono">{pb[1].toFixed(3)}, {pb[0].toFixed(3)}</dd></div>
              </dl>
            );
          })}
          {v.limits && <p className="dm-why">{v.limits}</p>}
        </section>
      )}

      <section className="dm-card">
        <header className="dm-head"><h3><ShieldAlert size={15} />Actions</h3><span className="dm-meta">points an inspection at a ship; not a finding</span></header>
        <div className="dm-actions">
          {([['log', 'Request voyage log', FileText], ['board', 'Flag for boarding', Anchor], ['report', 'Add to report', Waves]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" aria-pressed={!!done[key(k)]} onClick={() => setDone((d) => ({ ...d, [key(k)]: !d[key(k)] }))}>
              <Icon size={14} />{done[key(k)] ? `${label} ✓` : label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
