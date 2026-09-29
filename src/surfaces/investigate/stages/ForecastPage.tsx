import { token } from '../../../design/token';
/**
 * Forecast & impact. The Slick Drift Lab's run around the detected slick.
 *
 * Two runs share the map. The live one is oil-imp's 50 m GlobeMaster, stepped
 * on this thread and drawn with its continuous thickness ramp; the clock plays
 * it and can scrub back through the half-hour copies it keeps. A second, 100 m
 * run in a worker goes straight to the horizon, forwards and backwards, so the
 * +6/+12/+24 h outlines, the envelope, the source region and the coast arrival
 * times are on the map before the live run gets there.
 *
 * Four pages share the map and the clock: Overview, Environment, Shoreline
 * impact and Vessels. Forward/backward is the clock's, so every page has it.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Activity, AlertTriangle, ArrowRight, ChevronDown, Clock, Compass, Crosshair, Droplets, Gauge, Layers, Leaf, MapPin, Maximize, Pause, Play, SkipBack, SkipForward,
  Ship, Target, Thermometer, Waves, Wind,
} from 'lucide-react';
import { Badge } from '../../../design/components';
import type { SlickFeature } from '../../../api/slicks';
import type { Environment, Incident } from '../../../incidents/types';
import { fetchEnvironment } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import { loadLandRings } from '../../../forecast/land';
import { fromEnvironment, SYNTHETIC, type Forcing } from '../../../forecast/forcing';
import { ASSUMED_MEAN_UM } from '../../../forecast/context';
import { releaseRings } from '../../../forecast/useForecastRun';
import { RAMP_CSS, type LiveFrame, type LiveStats } from '../../../forecast/live';
import { FRAME_MIN, type LiveMessage, type LiveRequest } from '../../../forecast/live.worker';
import type { CoastPoint, OutlineMessage, OutlineRequest, OutlineStep } from '../../../forecast/outline.worker';
import type { LonLat } from '../../../forecast/engine';
import { when } from '../../../format';
import { ringsOf } from '../geometry';
import type { ForecastDirection, ForecastPanel, ResponsePanel } from '../Workspace';
import { PROTECTED, SITES, bearingOf, carryToPass, fromBundle, generate, indexLand, kmBetween, move, vesselAt, type Land, type MapVessel, type Pt } from './mapData';
import { chip, shipIcon, tone } from './MapPage';
import './mapPage.css';
import './forecastPage.css';
import './response.css';
import { buildPlan } from './responsePlan';
import { estimateAge, type AgeEstimate } from '../../../forecast/age';
import type { BacktrackMessage, BacktrackRequest } from '../../../forecast/backtrack.worker';
import { card, hover } from './mapTip';
import { useAttribution } from './attribution';
import { setProductContext, type ProductContext } from '../../../products/context';
import { drawResponse, focusOf, responseEvents, ResponsePane, RESPONSE_DEFAULTS, RESPONSE_LAYER_LABEL, usePlanState } from './ResponseView';

type LayerKey = 'live' | 'observed' | 'steps' | 'track' | 'envelope' | 'source' | 'wind' | 'current' | 'coast' | 'borders' | 'protected' | 'towns' | 'sites' | 'vessels' | 'tracks';
const LAYER_LABEL: Record<LayerKey, string> = {
  live: 'Modelled oil (live)', observed: 'Detected slick', steps: 'Forecast +6 / +12 / +24 h', track: 'Drift track', envelope: 'Uncertainty envelope',
  source: 'Possible source region', wind: 'Wind (10 m)', current: 'Surface current', coast: 'Coast by arrival time', borders: 'Highlighted land borders',
  protected: 'Protected areas', towns: 'Coastal towns', sites: 'Rigs, SPMs, terminals', vessels: 'Vessels (AIS)', tracks: 'AIS tracks',
};
const DEFAULTS: Record<ForecastPanel, LayerKey[]> = {
  overview: ['live', 'observed', 'steps', 'track', 'envelope', 'source', 'coast', 'towns'],
  environment: ['live', 'observed', 'wind', 'current', 'track', 'towns'],
  impact: ['live', 'observed', 'steps', 'coast', 'borders', 'protected', 'towns', 'sites'],
  vessels: ['live', 'observed', 'source', 'envelope', 'vessels', 'tracks'],
};
const STEP_HOURS = [6, 12, 24];
/** How far back the trace and the clock go. */
const BACK_H = 24;
const STEP_FILL = [token('--sky-100'), token('--sky-300-b'), token('--sky-500')];
const SPEEDS = [[60, '1×'], [300, '5×'], [900, '15×'], [1800, '30×'], [2400, '40×']] as const;
const COMPASS = (d: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
const ll = ([lon, lat]: Pt | LonLat): L.LatLngTuple => [lat, lon];
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const signed = (h: number) => `${h < 0 ? '−' : '+'}${Math.abs(h).toFixed(1)} h`;

/** Coastal towns the arrival windows are read against. */
const TOWNS: { name: string; at: Pt }[] = [
  { name: 'Vadinar', at: [69.72, 22.47] }, { name: 'Jamnagar', at: [70.07, 22.47] }, { name: 'Bedi port', at: [70.03, 22.52] }, { name: 'Sikka', at: [69.83, 22.43] },
  { name: 'Okha', at: [69.07, 22.47] }, { name: 'Mundra', at: [69.72, 22.74] }, { name: 'Kandla', at: [70.22, 23.03] }, { name: 'Navlakhi', at: [70.45, 22.95] },
  { name: 'Mumbai', at: [72.83, 18.94] }, { name: 'Uran (JNPT)', at: [72.95, 18.88] }, { name: 'Alibag', at: [72.87, 18.64] }, { name: 'Murud', at: [72.96, 18.33] },
  { name: 'Versova', at: [72.81, 19.13] }, { name: 'Vasai', at: [72.8, 19.33] }, { name: 'Konark', at: [86.1, 19.88] }, { name: 'Puri', at: [85.83, 19.8] },
  { name: 'Astaranga', at: [86.27, 19.98] }, { name: 'Paradip', at: [86.67, 20.26] }, { name: 'Kochi', at: [76.24, 9.96] }, { name: 'Vypin', at: [76.21, 10.07] },
  { name: 'Alappuzha', at: [76.32, 9.49] }, { name: 'Chellanam', at: [76.27, 9.8] }, { name: 'Munambam', at: [76.17, 10.18] },
];

interface Props {
  slick: SlickFeature;
  incident: Incident | undefined;
  incidentId: string | undefined;
  page: ForecastPanel;
  setPage: (p: ForecastPanel) => void;
  direction: ForecastDirection;
  setDirection: (d: ForecastDirection) => void;
  /** The Response tab: same frame, the plan's layers, events and panes. */
  response?: { page: ResponsePanel; setPage: (p: ResponsePanel) => void };
}

/**
 * A compact label on a short leader, set off the feature so it never covers
 * the oil. `up` picks the side; the text stays one small line.
 */
const callout = (text: string, cls: string, up: boolean, sub?: string) => L.divIcon({
  className: 'fc-maptag-anchor',
  html: `<span class="fc-maptag ${cls} ${up ? 'is-up' : 'is-down'}"><i></i><b>${text}${sub ? `<small>${sub}</small>` : ''}</b></span>`,
  iconSize: [0, 0],
});

/** What the document generators need, from the slick alone; the page refines drift and forcing once the run exists. */
export function baseProductContext(slick: SlickFeature, incident: Incident | undefined): ProductContext {
  const p = slick.properties;
  const centre: Pt = Array.isArray(p.centroid) ? [Number(p.centroid[0]), Number(p.centroid[1])] : incident?.centre ? [incident.centre.lon, incident.centre.lat] : [0, 0];
  const town = [...TOWNS].sort((x, y) => kmBetween(x.at, centre) - kmBetween(y.at, centre))[0]?.name ?? 'the coast';
  const h = hashOf(slick.id);
  const windFrom = (h * 37) % 360, curTo = (h * 53) % 360, wind = 4.5 + (h % 50) / 10, cur = 0.12 + (h % 25) / 100;
  const areaM2 = Number(p.areaM2) || 0;
  return {
    slickId: slick.id, town, region: `${town} offshore`, t0: incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(String(p.observedAt)),
    centre: { lat: centre[1], lon: centre[0] }, areaKm2: areaM2 / 1e6, lengthKm: (Number(p.lengthM) || Math.sqrt(areaM2) * 2) / 1000,
    driftTowardDeg: curTo, windSpeedMs: wind, windFromDeg: windFrom, currentSpeedMs: cur, currentTowardDeg: curTo, waveHsM: 0.25 + wind * 0.08 + (h % 7) / 40,
  };
}

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function ForecastPage({ slick, incident, incidentId, page, setPage, direction, setDirection, response }: Props) {
  const p = slick.properties;
  const t0 = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(String(p.observedAt));
  const rings = useMemo(() => ringsOf(slick.geometry), [slick.id]);
  const release = useMemo(() => releaseRings(slick.geometry), [slick.id]);
  const centre: Pt = Array.isArray(p.centroid) ? [Number(p.centroid[0]), Number(p.centroid[1])] : incident?.centre ? [incident.centre.lon, incident.centre.lat] : [0, 0];
  const areaM2 = Number(p.areaM2) || 0;
  const volumeM3 = (areaM2 * ASSUMED_MEAN_UM) / 1e6;
  const backward = direction === 'backward';

  /* ----------------------------------------------------------- forcing */
  const envArtifact = useArtifact<Environment>(incidentId, fetchEnvironment);
  const forcing: Forcing = useMemo(() => {
    const measured = fromEnvironment(envArtifact && envArtifact !== 'error' ? envArtifact : undefined, { lon: centre[0], lat: centre[1] }, t0);
    if (measured) return measured;
    // No forcing for this record: a seeded scenario per slick, stated as synthetic.
    const h = hashOf(slick.id);
    const windFrom = (h * 37) % 360, wind = 4.5 + (h % 50) / 10, curTo = (h * 53) % 360, cur = 0.12 + (h % 25) / 100;
    return { ...SYNTHETIC, windSpeed: wind, windDirDeg: (windFrom + 180) % 360, driftU: cur * Math.sin((curTo * Math.PI) / 180), driftV: cur * Math.cos((curTo * Math.PI) / 180) };
  }, [envArtifact, slick.id]);
  const windFrom = (forcing.windDirDeg + 180) % 360;
  const curMs = Math.hypot(forcing.driftU, forcing.driftV);
  const curTo = ((Math.atan2(forcing.driftU, forcing.driftV) * 180) / Math.PI + 360) % 360;
  const h = hashOf(slick.id);
  const waveM = 0.25 + forcing.windSpeed * 0.08 + (h % 7) / 40;
  const sstC = 25.5 + (h % 30) / 10;

  /* -------------------------------------------------------------- land */
  const [landRings, setLandRings] = useState<LonLat[][]>();
  const [land, setLand] = useState<Land>();
  useEffect(() => {
    let live = true;
    loadLandRings().catch(() => [] as LonLat[][]).then((all) => {
      if (!live) return;
      const near = all.filter((r) => r.some(([x, y]) => Math.abs(x - centre[0]) < 3 && Math.abs(y - centre[1]) < 3));
      setLandRings(near);
      setLand(indexLand(near as Pt[][]));
    });
    return () => void (live = false);
  }, [slick.id]);

  /* ---------------------------------------------------------- live runs */
  // Both directions run at once in workers; the clock spans −12 h to +24 h and
  // blends between the frames either side of it, so the oil glides.
  const forcingKey = `${forcing.windSpeed}|${forcing.windDirDeg}|${forcing.driftU}|${forcing.driftV}`;
  const fwdRun = useLiveRun(release, volumeM3, forcing, false, 24, `${slick.id}|${forcingKey}`);
  const bwdRun = useLiveRun([], volumeM3, forcing, true, BACK_H, `${slick.id}|${forcingKey}`);
  const [t, setT] = useState(0);
  const bwdHeadRef = useRef(0);
  const tRef = useRef(0);
  const seek = (v: number) => { tRef.current = Math.max(-BACK_H, Math.min(24, v)); setT(tRef.current); };
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1800);
  useEffect(() => { seek(0); setPlaying(true); }, [slick.id]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      raf = requestAnimationFrame(tick);
      if (now - last < 30) return;
      const wall = Math.min(0.1, (now - last) / 1000);
      last = now;
      const dir = backward ? -1 : 1;
      const edge = backward ? -Math.min(BACK_H, bwdHeadRef.current) : Math.min(24, fwdRun.head.current);
      if ((backward && tRef.current <= -BACK_H + 1e-6) || (!backward && tRef.current >= 24 - 1e-6)) { setPlaying(false); return; }
      const next = tRef.current + (dir * wall * speed) / 3600;
      seek(backward ? Math.max(edge, next) : Math.min(edge, next));
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, backward]);
  // Crossing T0 on the clock switches the direction the pages describe.
  useEffect(() => {
    if (t < 0 && !backward) setDirection('backward');
    if (t > 0 && backward) setDirection('forward');
  }, [t < 0, t > 0]);
  const run = fwdRun;
  const a = Math.abs(t);
  const i = Math.min(Math.floor((a * 60) / FRAME_MIN), Math.max(0, run.frames.current.length - 1));
  const fa = run.frames.current[i];
  const fb = run.frames.current[i + 1];
  const mix = fb ? Math.max(0, Math.min(1, (a * 60) / FRAME_MIN - i)) : 0;
  // Motion-compensated blend: both frames slide along the step between their
  // centres so they overlap where the oil is now, rather than fading in place.
  const dx = fa && fb ? fb.centre[0] - fa.centre[0] : 0, dy = fa && fb ? fb.centre[1] - fa.centre[1] : 0;
  const shift = (b: [number, number, number, number], k: number): [number, number, number, number] => [b[0] + dx * k, b[1] + dy * k, b[2] + dx * k, b[3] + dy * k];
  const overlay = backward ? { a: undefined, b: undefined } : {
    a: fa?.canvas ? { canvas: fa.canvas, bounds: shift(fa.bounds, mix), opacity: 1 - mix * mix } : undefined,
    b: fb?.canvas && mix > 0 ? { canvas: fb.canvas, bounds: shift(fb.bounds, mix - 1), opacity: mix * (2 - mix) * 0.999 } : undefined,
  };
  const stats = fa?.stats;
  const problem = fwdRun.failed ?? bwdRun.failed;

  /* ------------------------------------------------------ outline run */
  const [fwd, setFwd] = useState<OutlineStep[]>([]);
  const [bwd, setBwd] = useState<OutlineStep[]>([]);
  const [coast, setCoast] = useState<CoastPoint[]>([]);
  const [outlineDone, setOutlineDone] = useState({ forward: false, backward: false });
  const [envRings, setEnvRings] = useState<LonLat[][]>([]);
  const clouds = useRef(new Map<number, LonLat[]>());
  useEffect(() => {
    if (!release.length || volumeM3 <= 0) return;
    setFwd([]); setBwd([]); setCoast([]); setEnvRings([]); clouds.current.clear(); setOutlineDone({ forward: false, backward: false });
    const w = new Worker(new URL('../../../forecast/outline.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<OutlineMessage>) => {
      const m = e.data;
      if (m.kind === 'step') (m.dir === 'forward' ? setFwd : setBwd)((s) => [...s, m.step]);
      else if (m.kind === 'coast') setCoast(m.points);
      else if (m.kind === 'envelope') setEnvRings(m.rings);
      else if (m.kind === 'done') setOutlineDone((s) => ({ ...s, [m.dir]: true }));
    };
    w.postMessage({ rings: release, volumeM3, forcing, forwardH: 24, backwardH: 0 } satisfies OutlineRequest);
    // Backward: the reverse-time particle ensemble, not the reversed oil solver.
    const b = new Worker(new URL('../../../forecast/backtrack.worker.ts', import.meta.url), { type: 'module' });
    b.onmessage = (e: MessageEvent<BacktrackMessage>) => {
      const m = e.data;
      if (m.kind === 'step') { clouds.current.set(m.step.hour, m.cloud); bwdHeadRef.current = -m.step.hour; setBwd((x) => [...x, m.step]); }
      else setOutlineDone((x) => ({ ...x, backward: true }));
    };
    b.postMessage({ rings: release, forcing, hours: BACK_H, seed: hashOf(slick.id) } satisfies BacktrackRequest);
    return () => { w.terminate(); b.terminate(); };
  }, [slick.id, forcingKey]);

  /* ----------------------------------------------------------- vessels */
  const [rawVessels, setVessels] = useState<MapVessel[]>();
  const vessels = useAttribution(rawVessels, slick, incident, incidentId, centre).vessels;
  useEffect(() => {
    if (!land) return;
    let live = true;
    (async () => {
      const base = incidentId ? `${import.meta.env.BASE_URL}data/incidents/${incidentId}` : undefined;
      const json = async (name: string) => (base ? fetch(`${base}/${name}`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined) : undefined);
      const [ais, cands] = await Promise.all([json('ais.json'), json('candidates.json')]);
      const list = ais?.tracks?.length ? carryToPass(fromBundle(ais, cands, t0, centre), land) : generate(slick.id, centre, land);
      if (live) setVessels(list);
    })();
    return () => void (live = false);
  }, [land, incidentId]);
  const [selected, setSelected] = useState<string>();

  /* ------------------------------------------------------------ layers */
  const defaults = response ? RESPONSE_DEFAULTS[response.page] : DEFAULTS[page];
  const labels: Record<string, string> = response ? { ...LAYER_LABEL, ...RESPONSE_LAYER_LABEL } : LAYER_LABEL;
  const [shown, setShown] = useState<Set<string>>(new Set(defaults));
  useEffect(() => setShown(new Set(defaults)), [page, response?.page]);
  const [layersOpen, setLayersOpen] = useState(false);
  const [hover, setHover] = useState<Pt>();

  /* ---------------------------------------------------------- derived */
  const age = useMemo(() => estimateAge({ areaM2, windMs: forcing.windSpeed }), [areaM2, forcing.windSpeed]);
  const d = useMemo(() => derive({ centre, fwd, bwd, coast, vessels: vessels ?? [], forcing, H: 12, age, envRings }), [fwd, bwd, coast, vessels, forcing, age, envRings]);

  /* -------------------------------------------------------- resizing */
  const [paneW, setPaneW] = useState(40);
  const root = useRef<HTMLDivElement>(null);
  const grab = (e: RPointerEvent<HTMLDivElement>) => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPaneW(Math.max(24, Math.min(62, ((box.right - ev.clientX) / box.width) * 100)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const display = t;
  const [planState, setPlanState] = usePlanState(slick.id);
  const [picked, setPicked] = useState<string>();
  const plan = useMemo(() => (response && fwd.length > 12 ? buildPlan({
    slickId: slick.id, centre, fwd, coast, forcing, towns: TOWNS.filter((x) => kmBetween(x.at, centre) < 120), driftBearing: d.driftBearing, driftMs: d.driftMs,
    firstShore: d.firstShore, firstAt: d.firstAt, envelope: d.envelope, waveM, receptors: d.receptors, topVessel: d.top[0]?.v, state: planState,
  }) : undefined), [response !== undefined, fwd.length, coast, d, planState]);
  useEffect(() => {
    if (!d.last) return;
    setProductContext({ ...baseProductContext(slick, incident), driftTowardDeg: d.driftBearing, windSpeedMs: forcing.windSpeed, windFromDeg: windFrom, currentSpeedMs: curMs, currentTowardDeg: curTo, waveHsM: waveM });
  }, [slick.id, d.last?.hour, forcingKey]);
  const events = useMemo(() => [...timelineEvents(d, fwd, bwd), ...(plan ? responseEvents(plan, planState) : [])].sort((a, b) => a.h - b.h), [d, fwd.length, bwd.length, plan, planState]);
  const tKey = Math.round(t * 20) / 20;

  return (
    <div className="fc" ref={root} style={{ gridTemplateColumns: `minmax(0, 1fr) auto ${paneW}%` }}>
      <div className="fc-left">
        <div className="fc-map-wrap">
          <DriftMap
            centre={centre} rings={rings} shown={shown} overlay={overlay} fwd={fwd} bwd={bwd} coast={coast} vessels={d.top.map((r) => r.v)} selected={selected}
            onSelect={setSelected} landRings={landRings} forcing={forcing} backward={backward}
            onHover={setHover} envelope={d.envelope} envRings={envRings} t0={t0} origin={d.src} cloudAt={backward ? clouds.current.get(Math.max(-BACK_H, Math.round(t))) : undefined}
            extra={plan && response ? (g) => drawResponse(g, plan, shown, tKey, planState, response.page, (id) => { setPicked(id); response.setPage(id.startsWith('boom:') ? 'containment' : 'assets'); }, picked) : undefined}
            focus={plan && response ? focusOf(plan, response.page, centre) : undefined}
            focusKey={plan && response ? `${response.page}|${plan.zones.length}` : ''}
            extraKey={plan && response ? `${tKey}|${picked}|${response.page}|${[...shown].join()}|${JSON.stringify(planState)}|${fwd.length}` : ''}
          />
          <div className="dm-overlay dm-legend fc-legend" data-open={layersOpen || undefined}>
            <header>
              <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
                <Layers size={14} />Layers<span className="num">{shown.size}/{Object.keys(labels).length}</span>
                <ChevronDown size={14} className="dm-legend-chev" />
              </button>
            </header>
            {layersOpen && Object.keys(labels).map((k) => (
              <label key={k}>
                <input type="checkbox" checked={shown.has(k)} onChange={() => setShown((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })} />
                <i className={`fc-key k-${k}`} />
                <span>{labels[k]}</span>
                <b />
              </label>
            ))}
          </div>
          <div className="dm-overlay fc-heading">
            <span className={`fc-live-dot${playing ? ' is-on' : ''}`} />
            <b>{response ? 'Response plan' : backward ? 'Backward source trace' : 'Forward drift simulation'}</b>
            <span className="num">{signed(display)}</span>
            <span className="fc-heading-meta">50 m grid · {forcing.measured ? 'measured forcing' : 'synthetic forcing'}</span>
          </div>
          <div className="dm-overlay fc-ramp">
            <span>Oil thickness</span>
            <i style={{ background: RAMP_CSS }} />
            <small><span>0.04 µm sheen</span><span>metallic</span><span>1 mm</span></small>
          </div>
          <div className="dm-overlay dm-readout num fc-readout">
            {hover ? (
              <>
                <span className="mono">{hover[1].toFixed(4)}° N {hover[0].toFixed(4)}° E</span>
                <span>{f1(kmBetween(centre, hover))} km {COMPASS(bearingOf(centre, hover))} of slick</span>
                <span>{reachAt(fwd, hover)}</span>
              </>
            ) : <span>Hover the chart for range, bearing and when oil reaches that spot</span>}
          </div>
        </div>
        <ForecastTimeline
          t={t} t0={t0} fwdHead={fwdRun.headH} bwdHead={Math.max(0, bwd.length - 1)} playing={playing} speed={speed} setSpeed={setSpeed} events={events}
          onPlay={() => { if ((backward && t <= -BACK_H + 1e-6) || (!backward && t >= 24 - 1e-6)) seek(0); setPlaying(!playing); }}
          onSeek={(v) => { seek(v); }}
          direction={direction}
          onDirection={(dir) => { setDirection(dir); seek(0); setPlaying(true); }}
        />
      </div>
      <div className="dm-grip is-x" role="separator" aria-orientation="vertical" aria-label="Resize the detail pane" onPointerDown={grab} />
      <aside className="dm-pane fc-pane">
        {problem && <section className="dm-card fc-warn"><AlertTriangle size={15} /><span>{problem}</span></section>}
        {response && (plan
          ? <ResponsePane page={response.page} setPage={response.setPage} plan={plan} t={t} t0={t0} state={planState} setState={setPlanState} forcing={forcing} waveM={waveM} firstShore={d.firstShore} picked={picked} setPicked={setPicked} />
          : <p className="dm-loading">Building the response plan from the forecast…</p>)}
        {!response && page === 'overview' && <Overview d={d} fwd={fwd} bwd={bwd} stats={stats} backward={backward} forcing={forcing} areaM2={areaM2} volumeM3={volumeM3} shownHour={display} t0={t0} setPage={setPage} setDirection={setDirection} waveM={waveM} sstC={sstC} windFrom={windFrom} curMs={curMs} curTo={curTo} />}
        {!response && page === 'environment' && <EnvironmentPane d={d} forcing={forcing} windFrom={windFrom} curMs={curMs} curTo={curTo} waveM={waveM} sstC={sstC} t0={t0} />}
        {!response && page === 'impact' && <ImpactPane d={d} outlineDone={outlineDone.forward} setPage={setPage} />}
        {!response && page === 'vessels' && <VesselPane d={d} vessels={vessels} selected={selected} setSelected={setSelected} t0={t0} />}
      </aside>
    </div>
  );
}

/* =================================================================== derived */

type Derived = ReturnType<typeof derive>;

function derive({ centre, fwd, bwd, coast, vessels, forcing, H, age, envRings }: { centre: Pt; fwd: OutlineStep[]; bwd: OutlineStep[]; coast: CoastPoint[]; vessels: MapVessel[]; forcing: Forcing; H: number; age: AgeEstimate; envRings: LonLat[][] }) {
  const step = (hr: number) => fwd.find((s) => s.hour === hr);
  const last = fwd[fwd.length - 1];
  const driftKm = last ? kmBetween(centre, last.centre) : 0;
  const driftBearing = last ? bearingOf(centre, last.centre) : 0;
  const driftMs = last && last.hour ? (driftKm * 1000) / (last.hour * 3600) : 0;
  const envelope = envRings.length ? envRings.flat() : hull2(fwd.flatMap((s) => s.hull));
  const envelopeKm2 = envRings.length ? envRings.reduce((a, r) => a + polyKm2(r), 0) : polyKm2(envelope);
  // The origin: where the backward ensemble is at the estimated age of the slick.
  const src = bwd.find((x) => x.hour === -Math.min(BACK_H, Math.round(age.bestH)));
  const sourceKm = src ? kmBetween(centre, src.centre) : undefined;
  const sourceBearing = src ? bearingOf(centre, src.centre) : undefined;

  const hit = coast.filter((c) => c.hour !== null) as (CoastPoint & { hour: number })[];
  const seg = 1.05; // km per densified coast point
  const bands = { high: hit.filter((c) => c.hour <= 12).length * seg, medium: hit.filter((c) => c.hour > 12 && c.hour <= 24).length * seg };
  const firstShore = hit.length ? Math.min(...hit.map((c) => c.hour)) : undefined;
  const firstAt = hit.find((c) => c.hour === firstShore)?.at;

  const towns = TOWNS.map((t) => {
    const near = hit.filter((c) => kmBetween(t.at, c.at as Pt) < 8);
    const first = near.length ? Math.min(...near.map((c) => c.hour)) : undefined;
    return { ...t, km: kmBetween(centre, t.at), first, last: first !== undefined ? Math.max(...near.map((c) => c.hour)) : undefined, coastKm: near.length * seg };
  }).filter((t) => t.km < 120).sort((a, b) => (a.first ?? 99) - (b.first ?? 99) || a.km - b.km);

  const receptors = PROTECTED.map((a) => {
    const near = hit.filter((c) => kmBetween(a.at, c.at as Pt) < a.radiusKm + 3);
    const first = near.length ? Math.min(...near.map((c) => c.hour)) : undefined;
    const reach = envelope.length ? Math.max(0, Math.min(...envelope.map((q) => kmBetween(a.at, q as Pt))) - a.radiusKm) : kmBetween(a.at, centre);
    return { ...a, km: kmBetween(centre, a.at), first, reach, rating: first !== undefined && first <= 12 ? 'High' : first !== undefined ? 'Medium' : reach < 10 ? 'Watch' : 'Low' };
  }).filter((a) => a.km < 120).sort((a, b) => (a.first ?? 99) - (b.first ?? 99) || a.reach - b.reach);

  const sites = SITES.map((s) => ({ ...s, km: kmBetween(centre, s.at), reach: envelope.length ? Math.min(...envelope.map((q) => kmBetween(s.at, q as Pt))) : kmBetween(centre, s.at) })).filter((s) => s.km < 80).sort((a, b) => a.reach - b.reach);

  const srcHull = src?.hull ?? [];
  const inSource = (q: Pt) => (srcHull.length > 2 ? pointIn(q, srcHull as Pt[]) || kmBetween(q, src!.centre as Pt) < 3 : false);
  const rows0 = vessels.map((v) => {
    const now = vesselAt(v, 0);
    const pts = v.points.filter((q) => q.t <= 0 && q.t >= -H);
    const inside = pts.filter((q) => inSource([q.lon, q.lat]));
    const toSource = src ? Math.min(...(pts.length ? pts : [{ lon: now.at[0], lat: now.at[1], t: 0 }]).map((q) => kmBetween([q.lon, q.lat], src.centre as Pt))) : undefined;
    return { v, now, dist: kmBetween(now.at, centre), toSource, insideH: inside.length > 1 ? inside[inside.length - 1].t - inside[0].t : 0, firstSeen: v.points[0]?.t, lastSeen: v.points[v.points.length - 1]?.t };
  });
  // Ranking is the shared attribution's (attribution.ts), so every page agrees.
  const traceReady = vessels.some((v) => v.features !== undefined || v.excluded !== undefined);
  const ranked = rows0.filter((r) => !r.v.excluded && r.v.rank !== undefined)
    .map((r) => ({ ...r, pass: r.v.pass, prob: r.v.share ?? 0, inWindow: (r.v.features?.timing ?? 0) > 0.9 }))
    .sort((x, y) => (x.v.rank ?? 99) - (y.v.rank ?? 99));
  const top = ranked.slice(0, 5);

  const risk: 'High' | 'Medium' | 'Low' = firstShore !== undefined && firstShore <= 12 ? 'High' : firstShore !== undefined ? 'Medium' : 'Low';
  const windage = forcing.windSpeed * 0.03;
  return { step, last, driftKm, driftBearing, driftMs, envelope, envelopeKm2, src, sourceKm, sourceBearing, bands, firstShore, firstAt, hit, towns, receptors, sites, rows: ranked, top, total: vessels.length, traceReady, age, envRings, risk, windage, centre };
}

function reachAt(fwd: OutlineStep[], q: Pt) {
  const s = fwd.find((x) => x.hull.length > 2 && pointIn(q, x.hull as Pt[]));
  return s ? `oil here from ${signed(s.hour)}` : fwd.length ? 'outside the 24 h reach' : 'forecast still running';
}

function pointIn([x, y]: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function hull2(points: LonLat[]): LonLat[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: LonLat, a: LonLat, b: LonLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: LonLat[] = [], up: LonLat[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

function polyKm2(ring: LonLat[]) {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][1];
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  let t = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) t += ring[j][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[j][1] * ky;
  return Math.abs(t) / 2;
}

/* ====================================================================== map */

/**
 * One stored frame, drawn into a canvas of its own (so two overlays can pass
 * frames between them) and shown through Leaflet's ImageOverlay, which already
 * follows pan, zoom animation and resets exactly; only the image source is ours.
 */
class CanvasOverlay extends L.ImageOverlay {
  private readonly el = document.createElement('canvas');
  private src?: HTMLCanvasElement;
  constructor() {
    super('', L.latLngBounds([0, 0], [0, 0]), { interactive: false, zIndex: 420 });
  }
  // Leaflet builds an <img> here; hand it the canvas instead.
  _initImage() {
    const el = this.el as unknown as HTMLImageElement;
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if ((this as unknown as { _zoomAnimated: boolean })._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    el.style.pointerEvents = 'none';
    (this as unknown as { _image: HTMLImageElement })._image = el;
  }
  set(canvas: HTMLCanvasElement | undefined, bounds?: [number, number, number, number], opacity = 1) {
    this.el.style.display = canvas ? '' : 'none';
    if (canvas && canvas !== this.src) {
      if (this.el.width !== canvas.width || this.el.height !== canvas.height) { this.el.width = canvas.width; this.el.height = canvas.height; }
      const ctx = this.el.getContext('2d')!;
      ctx.clearRect(0, 0, this.el.width, this.el.height);
      ctx.drawImage(canvas, 0, 0);
    }
    this.src = canvas;
    if (bounds) this.setBounds(L.latLngBounds([bounds[1], bounds[0]], [bounds[3], bounds[2]]));
    this.setOpacity(opacity);
  }
}

function DriftMap({
  centre, rings, shown, overlay, fwd, bwd, coast, vessels, selected, onSelect, landRings, forcing, backward, onHover, envelope, extra, extraKey, focus, focusKey, t0, origin, cloudAt, envRings,
}: {
  t0: number; origin?: OutlineStep; cloudAt?: LonLat[]; envRings: LonLat[][];
  extra?: (g: L.LayerGroup) => void; extraKey?: string; focus?: Pt[]; focusKey?: string;
  centre: Pt; rings: number[][][]; shown: Set<string>; overlay: Record<'a' | 'b', { canvas: HTMLCanvasElement; bounds: [number, number, number, number]; opacity: number } | undefined>;
  fwd: OutlineStep[]; bwd: OutlineStep[]; coast: CoastPoint[]; vessels: MapVessel[]; selected?: string; onSelect: (id?: string) => void;
  landRings?: LonLat[][]; forcing: Forcing;
  backward: boolean; onHover: (p?: Pt) => void; envelope: LonLat[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | undefined>(undefined);
  const oilA = useRef(new CanvasOverlay());
  const oilB = useRef(new CanvasOverlay());
  const statics = useRef<L.LayerGroup | undefined>(undefined);
  const vectors = useRef<L.LayerGroup | undefined>(undefined);
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: false, zoomSnap: 0.25, preferCanvas: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, attribution: 'Esri, Maxar, Earthstar Geographics' }).addTo(m);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17, opacity: 0.75 }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(m);
    m.attributionControl.addAttribution('Coastline © OpenStreetMap contributors (ODbL)');
    m.setView(ll(centre), 11);
    m.on('mousemove', (e) => onHover([e.latlng.lng, e.latlng.lat]));
    m.on('mouseout', () => onHover(undefined));
    m.on('moveend', () => setMoved((x) => x + 1));
    oilA.current.addTo(m);
    oilB.current.addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(host.current!);
    return () => { ro.disconnect(); m.remove(); };
  }, []);

  const fit = (what: 'slick' | 'forecast') => {
    const m = map.current!;
    const reach = backward ? [...rings.flat() as LonLat[], ...bwd.flatMap((s) => [s.centre, ...s.hull])] : envelope;
    const pts = what === 'slick' || !reach.length ? rings.flat().map((q) => ll(q as Pt)) : reach.map(ll);
    m.flyToBounds(L.latLngBounds(pts).pad(what === 'slick' ? 2 : 0.08), { duration: 0.5, maxZoom: 13, paddingTopLeft: [270, 90], paddingBottomRight: [170, 70] });
  };
  const framed = useRef(false);
  useEffect(() => { framed.current = false; if (rings.length) fit('slick'); }, [rings.length]);
  // Once the forecast reaches its horizon, frame all of it once.
  useEffect(() => { if (!framed.current && fwd.length >= 25) { framed.current = true; fit('forecast'); } }, [fwd.length]);
  // A Response page frames its own content when it opens.
  useEffect(() => {
    if (!focus?.length || !map.current) return;
    framed.current = true;
    map.current.flyToBounds(L.latLngBounds(focus.map(ll)).pad(0.25), { duration: 0.6, maxZoom: 12.5, paddingTopLeft: [60, 90], paddingBottomRight: [60, 60] });
  }, [focusKey]);
  // Switching direction frames what that direction draws.
  const firstDir = useRef(true);
  useEffect(() => { if (firstDir.current) { firstDir.current = false; return; } fit('forecast'); }, [backward]);

  // The live field.
  useEffect(() => {
    const on = shown.has('live');
    oilA.current.set(on ? overlay.a?.canvas : undefined, overlay.a?.bounds, overlay.a?.opacity);
    oilB.current.set(on ? overlay.b?.canvas : undefined, overlay.b?.bounds, overlay.b?.opacity);
  });

  // Everything else.
  useEffect(() => {
    const m = map.current!;
    statics.current?.remove();
    const g = L.layerGroup().addTo(m);
    statics.current = g;
    const near = (q: Pt, km = 100) => kmBetween(q, centre) < km;

    if (shown.has('borders') && landRings) for (const r of landRings) {
      if (!r.some((q) => near(q as Pt, 150))) continue;
      L.polyline(r.map(ll), { color: token('--neutral-800-c'), weight: 5, opacity: 0.8, interactive: false }).addTo(g);
      L.polyline(r.map(ll), { color: token('--lime-100'), weight: 2.2, interactive: false }).addTo(g);
    }
    if (shown.has('protected')) for (const a of PROTECTED.filter((x) => near(x.at, 120))) {
      hover(L.circle(ll(a.at), { radius: a.radiusKm * 1000, className: 'dm-protected' }), () => card(a.name, a.kind, [['Radius', `${a.radiusKm} km`], ['From slick', `${f1(Math.max(0, kmBetween(a.at, centre) - a.radiusKm))} km to edge`]])).addTo(g);
      L.marker(ll(move(a.at, 0, a.radiusKm * 0.6)), { icon: chip(`${a.name}`, 'is-clear'), interactive: false }).addTo(g);
    }
    if (shown.has('envelope') && envRings.length && !backward) {
      hover(L.polygon(envRings.map((r) => r.map(ll)), { className: 'fc-envelope', dashArray: '8 7' }), () => card('Uncertainty envelope', 'Everywhere the oil reaches in 24 h', [['Area', `${f1(envRings.reduce((a, r) => a + polyKm2(r), 0))} km²`]])).addTo(g);
    }
    if (shown.has('steps') && !backward) STEP_HOURS.slice().reverse().forEach((hr) => {
      const s = fwd.find((x) => x.hour === hr);
      if (!s || s.hull.length < 3) return;
      const k = STEP_HOURS.indexOf(hr);
      hover(L.polygon((s.rings?.length ? s.rings : [s.hull]).map((r) => r.map(ll)), { color: '#ffffff', weight: 1, opacity: 0.55, fillColor: STEP_FILL[k], fillOpacity: 0.34 }), () => card(`Forecast +${hr} h`, `${when.format(t0 + hr * 3_600_000)} UTC`, [['Area', `${f2(s.areaKm2)} km²`], ['From slick', `${f1(kmBetween(centre, s.centre as Pt))} km ${COMPASS(bearingOf(centre, s.centre as Pt))}`], ['Afloat', `${Math.round((100 * s.afloat) / Math.max(s.released, 1e-9))} %`], ['Evaporated', `${Math.round((100 * s.evaporated) / Math.max(s.released, 1e-9))} %`]])).addTo(g);
    });
    if (shown.has('track') && fwd.length > 1 && !backward) {
      L.polyline(fwd.map((s) => ll(s.centre)), { color: '#ffffff', weight: 2, dashArray: '6 6', opacity: 0.9, interactive: false }).addTo(g);
      for (const hr of STEP_HOURS) {
        const s = fwd.find((x) => x.hour === hr);
        if (!s) continue;
        L.circleMarker(ll(s.centre), { radius: 5, color: '#ffffff', weight: 2, fillColor: STEP_FILL[STEP_HOURS.indexOf(hr)], fillOpacity: 1, interactive: false }).addTo(g);
        L.marker(ll(s.centre), { icon: callout(`+${hr} h`, 'is-step', STEP_HOURS.indexOf(hr) % 2 === 0, `${f1(s.areaKm2)} km²`), interactive: false }).addTo(g);
      }
    }
    if (shown.has('source') && bwd.length > 1) {
      const src = origin;
      L.polyline([centre, ...bwd.filter((s) => !src || s.hour >= src.hour).map((s) => s.centre)].map(ll), { color: token('--orange-200-k'), weight: 2, dashArray: '3 6', interactive: false }).addTo(g);
      if (src && src.hull.length > 2) hover(L.polygon((src.rings?.length ? src.rings : [src.hull]).map((r) => r.map(ll)), { className: 'fc-source' }), () => card('Estimated origin', `${signed(src.hour)} · reverse-time particle ensemble`, [['From slick', `${f1(kmBetween(centre, src.centre as Pt))} km ${COMPASS(bearingOf(centre, src.centre as Pt))}`], ['Area', `${f2(src.areaKm2)} km²`]])).addTo(g);
      if (backward) for (const hr of [-6, -12, -18]) {
        const s = bwd.find((x) => x.hour === hr);
        if (!s) continue;
        L.circleMarker(ll(s.centre), { radius: 4, color: '#fff', weight: 1.5, fillColor: token('--orange-200-k'), fillOpacity: 1, interactive: false }).addTo(g);
        L.marker(ll(s.centre), { icon: callout(signed(hr).replace('.0', ''), 'is-source', hr % 6 === 0), interactive: false }).addTo(g);
      }
      if (src) L.marker(ll(src.centre), { icon: callout('Origin', 'is-source', false, signed(src.hour).replace('.0', '')), interactive: false }).addTo(g);
    }
    if (shown.has('coast')) for (const c of coast) {
      if (c.hour === null) continue;
      const hr = c.hour;
      hover(L.circleMarker(ll(c.at), { radius: 3.2, stroke: false, fillColor: hr <= 6 ? token('--series-5') : hr <= 12 ? token('--red-300-i') : token('--amber-200-g'), fillOpacity: 0.95 }), () => card('Oil reaches this coast', `+${hr} h · ${when.format(t0 + hr * 3_600_000)} UTC`, [['Risk band', hr <= 12 ? '0–12 h (high)' : '12–24 h (medium)'], ['Nearest town', [...TOWNS].sort((x, y) => kmBetween(x.at, c.at as Pt) - kmBetween(y.at, c.at as Pt))[0]?.name]])).addTo(g);
    }
    if (shown.has('sites')) for (const s of SITES.filter((x) => near(x.at, 80))) {
      hover(L.marker(ll(s.at), { icon: L.divIcon({ className: 'dm-site', html: `<i class="dm-site-dot is-${s.kind}"></i>`, iconSize: [12, 12] }) }), () => card(s.name, s.operator, [['Type', s.kind === 'spm' ? 'Single-point mooring' : s.kind === 'platform' ? 'Offshore platform' : 'Oil terminal'], ['From slick', `${f1(kmBetween(s.at, centre))} km`]])).addTo(g);
    }
    if (shown.has('towns')) for (const t of TOWNS.filter((x) => near(x.at, 120))) {
      hover(L.circleMarker(ll(t.at), { radius: 5, color: token('--neutral-800-i'), weight: 1.5, fillColor: '#ffffff', fillOpacity: 1 }), () => { const first = coast.filter((c) => c.hour !== null && kmBetween(t.at, c.at as Pt) < 8).map((c) => c.hour as number); return card(t.name, 'Coastal town', [['From slick', `${f1(kmBetween(t.at, centre))} km`], ['Oil arrives', first.length ? `+${Math.min(...first)} h` : 'not within 24 h']]); }).addTo(g);
      L.marker(ll(t.at), { icon: L.divIcon({ className: 'dm-chip-anchor', html: `<span class="fc-town">${t.name}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(g);
    }
    if (shown.has('tracks')) for (const v of vessels) {
      const pts = v.points.filter((q) => q.t <= 0).map((q) => ll([q.lon, q.lat]));
      if (pts.length > 1) L.polyline(pts, { className: `fc-track is-${tone(v, selected)}`, interactive: false }).addTo(g);
    }
    if (shown.has('vessels')) for (const v of vessels) {
      const now = vesselAt(v, 0);
      const mk = hover(L.marker(ll(now.at), { icon: shipIcon(v, tone(v, selected)) }), () => card(v.name, `${v.type} · ${v.flag}`, [['Rank', v.rank ? `#${v.rank}` : '—'], ['From slick', `${f1(kmBetween(now.at, centre))} km`], ['Speed · course', `${f1(now.knots)} kn · ${now.heading.toFixed(0)}°`], ['AIS silences', v.gaps.length ? `${v.gaps.length}` : 'none']])).addTo(g);
      const el = mk.getElement()?.querySelector('svg');
      if (el) el.style.transform = `rotate(${now.heading}deg)`;
      mk.on('click', () => onSelect(v.id));
      if (v.rank && v.rank <= 3 || v.id === selected) L.marker(ll(now.at), { icon: chip(`${v.name} · ${v.type}`, v.id === selected ? 'is-selected' : ''), interactive: false }).addTo(g);
    }
    if (shown.has('observed')) {
      for (const r of rings) hover(L.polygon(r.map((q) => ll(q as Pt)), { color: token('--orange-300-h'), weight: 2, fillColor: token('--orange-300-h'), fillOpacity: 0.28 }), () => card('Detected slick', `T0 · ${when.format(t0)} UTC`, [['Parts', rings.length]])).addTo(g);
      L.marker(ll(centre), { icon: callout('T0', 'is-slick', false, 'detected'), interactive: false }).addTo(g);
    }
  }, [shown, fwd.length, bwd.length, coast, vessels, selected, landRings, envelope.length, envRings, backward, origin?.hour]);

  // The backward ensemble's particles, at the clock's hour.
  const cloudGroup = useRef<L.LayerGroup | undefined>(undefined);
  useEffect(() => {
    cloudGroup.current?.remove();
    if (!backward || !shown.has('source') || !cloudAt?.length) return;
    const g = L.layerGroup().addTo(map.current!);
    cloudGroup.current = g;
    for (const p of cloudAt) L.circleMarker(ll(p), { radius: 1.8, stroke: false, fillColor: token('--amber-100'), fillOpacity: 0.8, interactive: false }).addTo(g);
  }, [cloudAt, backward, shown]);

  // The Response tab's own layers, redrawn as the clock moves.
  const extraGroup = useRef<L.LayerGroup | undefined>(undefined);
  useEffect(() => {
    extraGroup.current?.remove();
    if (!extra) return;
    const g = L.layerGroup().addTo(map.current!);
    extraGroup.current = g;
    extra(g);
  }, [extraKey]);

  // Wind and current, oil-imp's arrow grid, redrawn on every move.
  useEffect(() => {
    const m = map.current!;
    vectors.current?.remove();
    const g = L.layerGroup().addTo(m);
    vectors.current = g;
    const kinds = (['wind', 'current'] as const).filter((k) => shown.has(k));
    if (!kinds.length) return;
    const size = m.getSize();
    const stepPx = Math.max(82, Math.round(Math.min(size.x, size.y) / 8));
    const base = (k: 'wind' | 'current'): [number, number] => k === 'wind'
      ? [forcing.windSpeed * Math.sin((((forcing.windDirDeg + (backward ? 180 : 0)) * Math.PI) / 180)), forcing.windSpeed * Math.cos((((forcing.windDirDeg + (backward ? 180 : 0)) * Math.PI) / 180))]
      : [backward ? -forcing.driftU : forcing.driftU, backward ? -forcing.driftV : forcing.driftV];
    for (const kind of kinds) {
      const colour = kind === 'wind' ? token('--orange-200-f') : token('--cyan-400');
      const off = kind === 'current' ? stepPx / 2 : 0;
      for (let y = 70 + off / 2; y < size.y - 40; y += stepPx) for (let x = 30 + off; x < size.x; x += stepPx) {
        const at = m.containerPointToLatLng([x, y]);
        // ponytail: the run's mean forcing; the solver's eddies live in the worker, not here.
        const wob = Math.sin(at.lat * 40 + at.lng * 31) * 0.12;
        const [bu, bv] = base(kind);
        const u = bu * Math.cos(wob) - bv * Math.sin(wob), v = bu * Math.sin(wob) + bv * Math.cos(wob);
        const mag = Math.hypot(u, v);
        if (mag < 1e-4) continue;
        const len = 21, dx = (u / mag) * len, dy = (-v / mag) * len;
        const tail = [x - dx * 0.48, y - dy * 0.48], tip = [x + dx * 0.52, y + dy * 0.52];
        const nx = -dy / len, ny = dx / len;
        const left = [tip[0] - (dx / len) * 5 + nx * 3.5, tip[1] - (dy / len) * 5 + ny * 3.5];
        const right = [tip[0] - (dx / len) * 5 - nx * 3.5, tip[1] - (dy / len) * 5 - ny * 3.5];
        for (const line of [[tail, tip], [left, tip], [right, tip]]) {
          const lls = line.map(([px, py]) => m.containerPointToLatLng([px, py]));
          L.polyline(lls, { color: token('--neutral-800-e'), weight: 4.6, opacity: 0.84, interactive: false }).addTo(g);
          L.polyline(lls, { color: colour, weight: 2.15, interactive: false }).addTo(g);
        }
      }
    }
  }, [shown, moved, forcing, backward]);

  return (
    <>
      <div className="dm-map" ref={host} />
      <div className="dm-overlay dm-fit fc-fit">
        <button type="button" onClick={() => fit('slick')}><Target size={13} />Fit slick</button>
        <button type="button" onClick={() => fit('forecast')}><Maximize size={13} />Fit forecast</button>
      </div>
    </>
  );
}

/* ================================================================ live runs */

interface Frame { hour: number; canvas?: HTMLCanvasElement; bounds: [number, number, number, number]; stats: LiveStats; centre: [number, number] }

/** One live run in a worker; frames land in a ref (canvases are not state) and the head is state. */
function useLiveRun(rings: LonLat[][], volumeM3: number, forcing: Forcing, backward: boolean, hours: number, key: string) {
  const frames = useRef<Frame[]>([]);
  const head = useRef(0);
  const [headH, setHeadH] = useState(0);
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    frames.current = [];
    head.current = 0;
    setHeadH(0);
    setFailed(undefined);
    if (!rings.length || volumeM3 <= 0) return;
    const w = new Worker(new URL('../../../forecast/live.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<LiveMessage>) => {
      const m = e.data;
      if (m.kind === 'failed') { setFailed(m.detail); return; }
      if (m.kind !== 'frame') return;
      const f: LiveFrame = m.frame;
      let canvas: HTMLCanvasElement | undefined;
      if (f.width) {
        canvas = document.createElement('canvas');
        canvas.width = f.width;
        canvas.height = f.height;
        canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(f.pixels), f.width, f.height), 0, 0);
      }
      // Opacity-weighted centre of the oil, for sliding between frames.
      let sx = 0, sy = 0, sw = 0;
      for (let y = 0; y < f.height; y += 2) for (let x = 0; x < f.width; x += 2) {
        const a = f.pixels[(y * f.width + x) * 4 + 3];
        if (a) { sx += x * a; sy += y * a; sw += a; }
      }
      const [w, so, ea, n] = f.bounds;
      const centre: [number, number] = sw ? [w + ((sx / sw + 0.5) / f.width) * (ea - w), n - ((sy / sw + 0.5) / f.height) * (n - so)] : [(w + ea) / 2, (so + n) / 2];
      frames.current.push({ hour: f.hour, canvas, bounds: f.bounds, stats: f.stats, centre });
      head.current = f.hour;
      setHeadH(f.hour);
    };
    w.postMessage({ rings, volumeM3, forcing, backward, hours } satisfies LiveRequest);
    return () => w.terminate();
  }, [key, rings.length]);
  return { frames, head, headH, failed };
}

/* ================================================================== events */

type Tone = 'observed' | 'predicted' | 'reconstructed' | 'critical' | 'warning';
interface TlEvent { h: number; label: string; detail: string; tone: Tone; primary?: boolean; to?: number; quiet?: boolean }

function timelineEvents(d: Derived, fwd: OutlineStep[], bwd: OutlineStep[]): TlEvent[] {
  const out: TlEvent[] = [{ h: 0, label: 'Detected', detail: 'Satellite pass, slick outlined', tone: 'observed', primary: true }];
  for (const hr of STEP_HOURS) {
    const s = fwd.find((x) => x.hour === hr);
    if (s) out.push({ h: hr, label: `+${hr} h outline`, detail: `${f1(s.areaKm2)} km², ${f1(kmBetween(d.centre, s.centre as Pt))} km from the slick`, tone: 'predicted' });
  }
  if (d.firstShore !== undefined) {
    const town = d.towns.find((t) => t.first === d.firstShore);
    out.push({ h: d.firstShore, label: 'Oil reaches coast', detail: town ? `First landfall near ${town.name}` : 'First landfall', tone: 'critical' });
  }
  for (const t of d.towns.filter((x) => x.first !== undefined && x.first !== d.firstShore).slice(0, 3)) {
    out.push({ h: t.first!, label: `Reaches ${t.name}`, detail: `${f1(t.coastKm)} km of shore near ${t.name}`, tone: 'critical' });
  }
  for (const r of d.receptors.filter((x) => x.first !== undefined).slice(0, 2)) {
    out.push({ h: r.first!, label: `Reaches ${r.name}`, detail: r.kind, tone: 'warning' });
  }
  const evap = fwd.find((s) => s.hour > 0 && s.evaporated / Math.max(s.released, 1e-9) >= 0.25);
  if (evap) out.push({ h: evap.hour, label: '¼ evaporated', detail: 'A quarter of the released oil has evaporated', tone: 'predicted' });
  const stranded = fwd.find((s) => s.stranded / Math.max(s.released, 1e-9) >= 0.05);
  if (stranded) out.push({ h: stranded.hour, label: '5 % ashore', detail: 'One twentieth of the oil is stranded', tone: 'critical' });

  // The release window the slick's age allows, and the origin at its best estimate.
  out.push({ h: -Math.min(BACK_H, d.age.highH), to: -d.age.lowH, label: 'Release window (age)', detail: `Spreading says the slick is ${f1(d.age.lowH)}–${f1(d.age.highH)} h old`, tone: 'reconstructed' });
  if (d.src) out.push({ h: d.src.hour, label: 'Estimated origin', detail: `${f1(d.sourceKm ?? 0)} km ${COMPASS(d.sourceBearing ?? 0)} of the slick`, tone: 'reconstructed', primary: true });
  // Where the top candidates came closest to the backward track: the likely release moments.
  d.top.slice(0, 3).forEach((r, k) => {
    if (r.pass === undefined) return;
    out.push({ h: r.pass.h, quiet: k > 0, label: k === 0 ? `Possible release · ${r.v.name}` : `Closest pass · ${r.v.name}`, detail: `${f1(r.pass.km)} km from the traced oil · ${Math.round(r.prob * 100)} % of attribution`, tone: k === 0 ? 'critical' : 'reconstructed', primary: k === 0, to: k === 0 ? Math.min(0, r.pass.h + 1) : undefined });
  });
  for (const r of d.top.slice(0, 3)) for (const [g0, g1] of r.v.gaps) {
    if (g1 < -BACK_H || g0 > 0) continue;
    out.push({ h: Math.max(-BACK_H, g0), to: Math.min(0, g1), label: `AIS silent · ${r.v.name}`, detail: `${Math.round((g1 - g0) * 60)} min without a position`, tone: 'warning' });
  }
  return out.sort((a, b) => a.h - b.h);
}

/* ================================================================ timeline */

const T_MIN = -BACK_H, T_MAX = 24, SPAN = T_MAX - T_MIN;
const pct = (h: number) => ((h - T_MIN) / SPAN) * 100;
const clockOf = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const dayOf = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function ForecastTimeline({ t, t0, fwdHead, bwdHead, playing, speed, setSpeed, events, onPlay, onSeek, direction, onDirection }: {
  t: number; t0: number; fwdHead: number; bwdHead: number; playing: boolean; speed: number; setSpeed: (s: number) => void; events: TlEvent[];
  onPlay: () => void; onSeek: (h: number) => void; direction: ForecastDirection; onDirection: (d: ForecastDirection) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, []);
  const scrub = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    const h = T_MIN + Math.max(0, Math.min(1, (x - r.left) / r.width)) * SPAN;
    // Only as far as each run has computed.
    onSeek(Math.max(-bwdHead, Math.min(fwdHead, h)));
  };
  // Labels in lanes so none overlaps its neighbour.
  const lanes: number[] = [];
  const placed = events.map((e) => {
    const x = (pct(e.h) / 100) * width;
    if (e.quiet) return { ...e, lane: 0, flip: false };
    const w = e.label.length * 6.2 + 18;
    let lane = lanes.findIndex((end) => end < x - 4);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = x + w;
    return { ...e, lane: Math.min(lane, 3), flip: x + w > width };
  });
  const ticks = Array.from({ length: SPAN / 3 + 1 }, (_, k) => T_MIN + k * 3);
  const at = t0 + t * 3_600_000;
  return (
    <footer className="tl fc-tl">
      <div className="tl-bar">
        <div className="fc-dir" role="group" aria-label="Direction">
          <button type="button" aria-pressed={direction === 'backward'} onClick={() => onDirection('backward')}>Backward 24 h</button>
          <button type="button" aria-pressed={direction === 'forward'} onClick={() => onDirection('forward')}>Forward 24 h</button>
        </div>
        <div className="tl-transport">
          <button type="button" className="fc-icon" onClick={() => onSeek(Math.max(-bwdHead, t - 1))} aria-label="Back 1 h"><SkipBack size={14} /></button>
          <button type="button" className="tl-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
          <button type="button" className="fc-icon" onClick={() => onSeek(Math.min(fwdHead, t + 1))} aria-label="Forward 1 h"><SkipForward size={14} /></button>
        </div>
        <div className="fc-tl-legend">
          <span><i className="is-recon" />Reconstruction</span>
          <span><i className="is-obs" />Detection</span>
          <span><i className="is-pred" />Forecast</span>
          <span><i className="is-crit" />Impact / release</span>
          <em className="num">{events.length} events</em>
        </div>
        <div className="fc-speeds" role="group" aria-label="Speed">
          {SPEEDS.map(([s, label]) => <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} title={`${s / 60} model-minutes per second`}>{label}</button>)}
        </div>
      </div>
      <div className="tl-rail">
        <div className="fc-tl-now">
          <b className="num">{t === 0 ? 'T0' : signed(t)}</b>
          <span className="num">{clockOf(at)} <small>UTC</small></span>
          <span>{dayOf.format(at)}</span>
        </div>
        <div
          ref={track}
          className="tl-track fc-tl-track"
          role="slider" tabIndex={0} aria-label="Model time" aria-valuemin={T_MIN} aria-valuemax={T_MAX} aria-valuenow={t} aria-valuetext={signed(t)}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
          onPointerMove={(e) => e.buttons === 1 && scrub(e.clientX)}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') onSeek(Math.max(-bwdHead, t - 0.25)); if (e.key === 'ArrowRight') onSeek(Math.min(fwdHead, t + 0.25)); if (e.key === ' ') { e.preventDefault(); onPlay(); } }}
        >
          <span className="fc-zone is-recon" style={{ left: 0, width: `${pct(0)}%` }} />
          <span className="fc-zone is-pred" style={{ left: `${pct(0)}%`, right: 0 }} />
          <span className="fc-done is-recon" style={{ left: `${pct(-Math.min(BACK_H, bwdHead))}%`, width: `${pct(0) - pct(-Math.min(BACK_H, bwdHead))}%` }} />
          <span className="fc-done is-pred" style={{ left: `${pct(0)}%`, width: `${pct(Math.min(24, fwdHead)) - pct(0)}%` }} />
          {ticks.map((h) => <span key={h} className={`tl-tick${h % 6 === 0 ? ' is-labelled' : ''}`} style={{ left: `${pct(h)}%` }}>{h % 6 === 0 && <span className={`tl-tick-label num${h === T_MAX ? ' is-end' : ''}`}>{h === 0 ? 'T0' : `${h > 0 ? '+' : '−'}${Math.abs(h)} h`}</span>}</span>)}
          {placed.filter((e) => e.to !== undefined).map((e, k) => <span key={`b${k}`} className={`fc-band is-${e.tone}`} style={{ left: `${pct(e.h)}%`, width: `${Math.max(0.4, pct(e.to!) - pct(e.h))}%` }} title={`${e.label}: ${e.detail}`} />)}
          {placed.map((e, k) => (
            <button
              key={k} type="button" className={`fc-ev is-${e.tone}${e.primary ? ' is-primary' : ''}${e.flip ? ' is-flip' : ''}${e.quiet ? ' is-quiet' : ''}`} data-lane={e.lane}
              style={{ left: `${pct(e.h)}%` }} title={`${signed(e.h)} · ${e.label}\n${e.detail}`}
              onPointerDown={(ev) => ev.stopPropagation()} onClick={() => onSeek(Math.max(-bwdHead, Math.min(fwdHead, e.h)))}
            >
              <i />{!e.quiet && <span>{e.label}</span>}
            </button>
          ))}
          <span className="tl-cursor" style={{ left: `${pct(t)}%` }} />
        </div>
      </div>
    </footer>
  );
}

/* ==================================================================== panes */

function Tile({ label, value, unit, note, tone: tn }: { label: string; value: string; unit?: string; note?: string; tone?: 'critical' | 'warning' | 'clear' }) {
  return <div className="dm-tile" data-tone={tn}><span>{label}</span><b className="num">{value}{unit && <small>{unit}</small>}</b>{note && <em>{note}</em>}</div>;
}

function Dial({ deg }: { deg: number }) {
  return <svg className="fc-dial" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="11" /><path d="M0,7 L0,-7 M-3,-3.5 L0,-7.5 L3,-3.5" style={{ transform: `rotate(${deg}deg)` }} /></svg>;
}

function Overview({ d, fwd, bwd, stats, backward, forcing, areaM2, volumeM3, shownHour, t0, setPage, setDirection, waveM, sstC, windFrom, curMs, curTo }: {
  d: Derived; fwd: OutlineStep[]; bwd: OutlineStep[]; stats?: LiveStats; backward: boolean; forcing: Forcing; areaM2: number; volumeM3: number; shownHour: number; t0: number;
  setPage: (p: ForecastPanel) => void; setDirection: (x: ForecastDirection) => void; waveM: number; sstC: number; windFrom: number; curMs: number; curTo: number;
}) {
  const rows = backward ? [0, 6, 12, 18, 24].map((hr) => bwd.find((s) => s.hour === -hr)) : [0, 6, 12, 24].map((hr) => fwd.find((s) => s.hour === hr));
  const pct = (a: number, s: OutlineStep) => `${Math.round((100 * a) / Math.max(s.released, 1e-9))} %`;
  return (
    <>
      <section className="dm-card dm-hero">
        <div>
          <h2>{backward ? 'Where the oil came from' : 'Where the oil goes'}</h2>
          <p>
            {backward
              ? d.src ? `Traced back ${f1(d.age.bestH)} h (the slick's estimated age), 1,000 particles put the release ${f1(d.sourceKm ?? 0)} km ${COMPASS(d.sourceBearing ?? 0)} of the detection, around ${when.format(t0 + d.src.hour * 3_600_000)} UTC.` : 'Tracing the slick backwards…'
              : d.last ? `Drifting ${COMPASS(d.driftBearing)} at about ${f2(d.driftMs)} m/s; ${f1(d.driftKm)} km by +${d.last.hour} h. ${d.firstShore !== undefined ? `First shore contact at +${d.firstShore} h.` : 'No shore contact within the run.'}` : 'Computing the horizon run…'}
          </p>
        </div>
        <Badge claim="predicted">Model</Badge>
      </section>

      <section className="dm-tiles">
        <Tile label="Detected area" value={f2(areaM2 / 1e6)} unit="km²" note="at the pass" />
        {STEP_HOURS.map((hr) => <Tile key={hr} label={`Area +${hr} h`} value={d.step(hr) ? f1(d.step(hr)!.areaKm2) : '…'} unit="km²" note="visible sheen and thicker" />)}
        <Tile label="Drift toward" value={d.last ? `${Math.round(d.driftBearing)}°` : '…'} note={d.last ? `${COMPASS(d.driftBearing)} · ${f2(d.driftMs)} m/s` : undefined} />
        <Tile label="First shore contact" value={d.firstShore !== undefined ? `+${d.firstShore}` : '—'} unit={d.firstShore !== undefined ? 'h' : undefined} note={d.firstShore !== undefined ? 'nearest landfall' : 'none in 24 h'} tone={d.risk === 'High' ? 'critical' : d.risk === 'Medium' ? 'warning' : 'clear'} />
        <Tile label="Envelope" value={f1(d.envelopeKm2)} unit="km²" note="all hours to +24 h" />
        <Tile label="Source region" value={d.sourceKm !== undefined ? f1(d.sourceKm) : '…'} unit="km" note={d.sourceBearing !== undefined && d.src ? `${COMPASS(d.sourceBearing)} · ${signed(d.src.hour)}` : 'backward run'} />
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><Clock size={15} />Key {backward ? 'backtrack' : 'forecast'} times</h3><span className="dm-meta">{backward ? '1,000-particle reverse-time ensemble' : '100 m horizon run'}</span></header>
        <div className="dm-table-wrap fc-tablewrap">
          <table className="dm-table">
            <thead><tr><th>Time</th><th>UTC</th><th className="is-num">{backward ? 'Spread km²' : 'Area km²'}</th>{!backward && <><th className="is-num">Afloat</th><th className="is-num">Evap.</th><th className="is-num">Disp.</th><th className="is-num">Ashore</th></>}<th className="is-num">From slick</th></tr></thead>
            <tbody>
              {rows.map((s, i) => s ? (
                <tr key={s.hour}>
                  <td><span className="fc-swatch" style={{ background: s.hour === 0 ? token('--orange-300-h') : backward ? token('--orange-200-k') : STEP_FILL[i - 1] }} />{s.hour === 0 ? 'Now' : signed(s.hour)}</td>
                  <td className="num">{when.format(t0 + s.hour * 3_600_000).split(', ').at(-1)}</td>
                  <td className="is-num">{f2(s.areaKm2)}</td>
                  {!backward && <><td className="is-num">{pct(s.afloat, s)}</td>
                  <td className="is-num">{pct(s.evaporated, s)}</td>
                  <td className="is-num">{pct(s.dispersed, s)}</td>
                  <td className="is-num">{pct(s.stranded, s)}</td></>}
                  <td className="is-num">{f1(kmBetween(d.centre, s.centre as Pt))} km</td>
                </tr>
              ) : <tr key={i}><td colSpan={backward ? 4 : 8} className="dm-meta">computing…</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dm-grid">
        <section className="dm-card">
          <header className="dm-head"><h3><Activity size={15} />Area over time</h3><span className="dm-meta">km²</span></header>
          <AreaChart steps={backward ? [...bwd].reverse() : fwd} now={shownHour} backward={backward} />
        </section>
        {backward ? (
          <section className="dm-card">
            <header className="dm-head"><h3><Clock size={15} />Release time</h3><span className="dm-meta">from the slick's spread</span></header>
            <dl className="dm-rows">
              <div><dt>Age</dt><dd className="num">{f1(d.age.lowH)}–{f1(d.age.highH)} h</dd></div>
              <div><dt>Most likely</dt><dd className="num">{when.format(t0 - d.age.bestH * 3_600_000)} UTC</dd></div>
              <div><dt>Window</dt><dd className="num">{when.format(t0 - d.age.highH * 3_600_000).split(', ').at(-1)}–{when.format(t0 - d.age.lowH * 3_600_000).split(', ').at(-1)} UTC</dd></div>
            </dl>
          </section>
        ) : (
          <section className="dm-card">
            <header className="dm-head"><h3><Droplets size={15} />Where the oil is</h3><span className="dm-meta">share of released</span></header>
            <BudgetChart steps={fwd} backward={false} />
          </section>
        )}
      </div>

      <section className="dm-card">
        <header className="dm-head"><h3><Gauge size={15} />Live run</h3><span className="dm-meta num">{signed(shownHour)}</span></header>
        <dl className="dm-rows fc-cols">
          <div><dt>Solver</dt><dd>GlobeMaster · 50 m</dd></div>
          <div><dt>Oil released</dt><dd className="num">{f1(volumeM3)} m³ <small>assumed {ASSUMED_MEAN_UM} µm mean</small></dd></div>
          <div><dt>Visible area</dt><dd className="num">{stats ? f2(stats.areaKm2) : '—'} km²</dd></div>
          <div><dt>Afloat</dt><dd className="num">{stats ? f1(stats.afloat) : '—'} m³</dd></div>
          <div><dt>Evaporated</dt><dd className="num">{stats ? f1(stats.evaporated) : '—'} m³</dd></div>
          <div><dt>Dispersed</dt><dd className="num">{stats ? f1(stats.dispersed) : '—'} m³</dd></div>
          <div><dt>Stranded</dt><dd className="num">{stats ? f1(stats.stranded) : '—'} m³</dd></div>
          <div><dt>Active blocks</dt><dd className="num">{stats?.blocks ?? '—'}</dd></div>
        </dl>
        <p className="fc-note">{forcing.provenance}{backward ? ' Backward runs reverse wind and current; spreading and weathering still run forwards, so the source region is a search area, not a release point.' : ''}</p>
      </section>

      <button type="button" className={`fc-impact is-${d.risk.toLowerCase()}`} onClick={() => setPage('impact')}>
        <i />
        <span><b>{d.risk} risk to shoreline · 24 h</b><small>{d.firstShore !== undefined ? `${f1(d.bands.high + d.bands.medium)} km of coast reached; first at +${d.firstShore} h near ${d.towns.find((t) => t.first !== undefined)?.name ?? 'the nearest coast'}.` : `No coast reached.${d.receptors[0] ? ` Nearest receptor: ${d.receptors[0].name}, ${d.receptors[0].reach < 0.5 ? 'at the edge of the envelope' : `${f1(d.receptors[0].reach)} km beyond the envelope`}.` : ''}`}</small></span>
        <ArrowRight size={15} />
      </button>
    </>
  );
}

function AreaChart({ steps, now, backward }: { steps: OutlineStep[]; now: number; backward: boolean }) {
  const W = 300, Hh = 120, P = 26;
  if (steps.length < 2) return <p className="dm-meta">computing…</p>;
  const hrs = steps.map((s) => s.hour);
  const x0 = Math.min(...hrs), x1 = Math.max(...hrs, x0 + 1);
  const max = Math.max(...steps.map((s) => s.areaKm2), 0.1);
  const X = (h: number) => P + ((h - x0) / (x1 - x0)) * (W - P - 6);
  const Y = (a: number) => Hh - 18 - (a / max) * (Hh - 30);
  const line = steps.map((s) => `${X(s.hour)},${Y(s.areaKm2)}`).join(' ');
  return (
    <svg className="fc-chart" viewBox={`0 0 ${W} ${Hh}`}>
      {[0, 0.5, 1].map((k) => <g key={k}><line x1={P} x2={W - 6} y1={Y(max * k)} y2={Y(max * k)} className="grid" /><text x={P - 4} y={Y(max * k) + 3} className="axis" textAnchor="end">{(max * k).toFixed(max * k < 10 ? 1 : 0)}</text></g>)}
      <polygon points={`${X(x0)},${Y(0)} ${line} ${X(steps[steps.length - 1].hour)},${Y(0)}`} className={backward ? 'fill is-back' : 'fill'} />
      <polyline points={line} className={backward ? 'stroke is-back' : 'stroke'} />
      {!backward && STEP_HOURS.map((hr, i) => { const s = steps.find((q) => q.hour === hr); return s ? <circle key={hr} cx={X(hr)} cy={Y(s.areaKm2)} r={3.5} fill={STEP_FILL[i]} stroke="#fff" /> : null; })}
      <line x1={X(Math.max(x0, Math.min(x1, now)))} x2={X(Math.max(x0, Math.min(x1, now)))} y1={8} y2={Hh - 18} className="now" />
      {[x0, (x0 + x1) / 2, x1].map((hr) => <text key={hr} x={X(hr)} y={Hh - 4} className="axis" textAnchor="middle">{signed(hr).replace('.0', '')}</text>)}
    </svg>
  );
}

function BudgetChart({ steps, backward }: { steps: OutlineStep[]; backward: boolean }) {
  const W = 300, Hh = 120, P = 6;
  if (steps.length < 2) return <p className="dm-meta">computing…</p>;
  const x0 = steps[0].hour, x1 = steps[steps.length - 1].hour || 1;
  const X = (h: number) => P + ((h - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const keys = ['afloat', 'evaporated', 'dispersed', 'stranded'] as const;
  const cls = ['afloat', 'evap', 'disp', 'strand'];
  const layers = keys.map((_, k) => steps.map((s) => {
    const tot = Math.max(s.released, 1e-9);
    const below = keys.slice(0, k).reduce((a, key) => a + s[key] / tot, 0);
    return [X(s.hour), below, below + s[keys[k]] / tot] as const;
  }));
  const Y = (f: number) => Hh - 22 - Math.min(1, f) * (Hh - 30);
  const last = steps[backward ? 0 : steps.length - 1];
  return (
    <>
      <svg className="fc-chart" viewBox={`0 0 ${W} ${Hh}`}>
        {layers.map((pts, k) => <polygon key={k} className={`b-${cls[k]}`} points={[...pts.map(([x, , hi]) => `${x},${Y(hi)}`), ...[...pts].reverse().map(([x, lo]) => `${x},${Y(lo)}`)].join(' ')} />)}
        <text x={P} y={Hh - 6} className="axis">{signed(x0).replace('.0', '')}</text>
        <text x={W - P} y={Hh - 6} className="axis" textAnchor="end">{signed(x1).replace('.0', '')}</text>
      </svg>
      <ul className="fc-bkey">{keys.map((k, i) => <li key={k}><i className={`b-${cls[i]}`} />{['Afloat', 'Evaporated', 'Dispersed', 'Ashore'][i]}<b className="num">{Math.round((100 * last[k]) / Math.max(last.released, 1e-9))} %</b></li>)}</ul>
    </>
  );
}

function EnvironmentPane({ d, forcing, windFrom, curMs, curTo, waveM, sstC, t0 }: { d: Derived; forcing: Forcing; windFrom: number; curMs: number; curTo: number; waveM: number; sstC: number; t0: number }) {
  // Drift as the model builds it: ~3 % of the wind plus the current.
  const wu = forcing.windSpeed * 0.03 * Math.sin((forcing.windDirDeg * Math.PI) / 180), wv = forcing.windSpeed * 0.03 * Math.cos((forcing.windDirDeg * Math.PI) / 180);
  const ru = wu + forcing.driftU, rv = wv + forcing.driftV;
  const rMs = Math.hypot(ru, rv), rTo = ((Math.atan2(ru, rv) * 180) / Math.PI + 360) % 360;
  const level = forcing.windSpeed > 12 ? 'Rough conditions' : forcing.windSpeed > 7 ? 'Moderate conditions' : 'Calm to moderate conditions';
  return (
    <>
      <section className="dm-card dm-hero">
        <div>
          <h2>{level}</h2>
          <p>{f1(forcing.windSpeed)} m/s wind from the {COMPASS(windFrom)} and a {f2(curMs)} m/s current to the {COMPASS(curTo)} push the slick {COMPASS(rTo)} at about {f2(rMs)} m/s.</p>
        </div>
        <Badge claim={forcing.measured ? 'observed' : 'reconstructed'}>{forcing.measured ? 'Measured' : 'Synthetic'}</Badge>
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><Wind size={15} />Forcing at the slick</h3><span className="dm-meta">{when.format(t0)} UTC</span></header>
        <div className="fc-readings">
          <div><Wind size={18} /><span>Wind (10 m)</span><b className="num">{f1(forcing.windSpeed)} m/s</b><small>gusts to {f1(forcing.windSpeed * 1.35)} m/s</small><span className="fc-dir-cell"><Dial deg={forcing.windDirDeg} />{Math.round(windFrom)}° ({COMPASS(windFrom)})</span></div>
          <div><Waves size={18} /><span>Surface current</span><b className="num">{f2(curMs)} m/s</b><small>{f2(forcing.driftU)} E · {f2(forcing.driftV)} N</small><span className="fc-dir-cell"><Dial deg={curTo} />{Math.round(curTo)}° ({COMPASS(curTo)})</span></div>
          <div><Activity size={18} /><span>Waves</span><b className="num">{f1(waveM)} m</b><small>significant height · period {f1(3 + waveM * 2.2)} s</small><span className="fc-dir-cell"><Dial deg={forcing.windDirDeg} />with the wind</span></div>
          <div><Thermometer size={18} /><span>Sea surface temp.</span><b className="num">{f1(sstC)} °C</b><small>range {f1(sstC - 0.4)}–{f1(sstC + 0.3)} °C in area</small><span className="fc-dir-cell">evaporation {sstC > 26 ? 'fast' : 'moderate'}</span></div>
        </div>
      </section>

      <div className="dm-grid">
        <section className="dm-card">
          <header className="dm-head"><h3><Compass size={15} />How the drift is built</h3><span className="dm-meta">m/s</span></header>
          <DriftVectors parts={[{ u: wu, v: wv, label: 'Wind drift 3 %', cls: 'wind' }, { u: forcing.driftU, v: forcing.driftV, label: 'Current', cls: 'current' }, { u: ru, v: rv, label: 'Resultant', cls: 'result' }]} />
        </section>
        <section className="dm-card">
          <header className="dm-head"><h3><Crosshair size={15} />Model against the estimate</h3></header>
          <dl className="dm-rows">
            <div><dt>Wind drift</dt><dd className="num">{f2(forcing.windSpeed * 0.03)} m/s to {COMPASS(forcing.windDirDeg)}</dd></div>
            <div><dt>Current</dt><dd className="num">{f2(curMs)} m/s to {COMPASS(curTo)}</dd></div>
            <div><dt>Estimate</dt><dd className="num">{f2(rMs)} m/s to {COMPASS(rTo)} <small>{Math.round(rTo)}°</small></dd></div>
            <div><dt>Model, 24 h</dt><dd className="num">{d.last ? `${f2(d.driftMs)} m/s to ${COMPASS(d.driftBearing)}` : '…'} {d.last && <small>{Math.round(d.driftBearing)}°</small>}</dd></div>
            <div><dt>Difference</dt><dd className="num">{d.last ? `${Math.round(Math.abs(((d.driftBearing - rTo + 540) % 360) - 180))}° · eddies, windrows, coast` : '…'}</dd></div>
          </dl>
        </section>
      </div>

      <section className="dm-card">
        <header className="dm-head"><h3><MapPin size={15} />Sources</h3></header>
        <div className="dm-table-wrap fc-tablewrap">
          <table className="dm-table">
            <thead><tr><th>Field</th><th>Product</th><th>Grid</th><th>Step</th><th>Use in run</th></tr></thead>
            <tbody>
              <tr><td>Wind 10 m</td><td>{forcing.measured ? 'ERA5 reanalysis' : 'Model seed'}</td><td>0.25°</td><td>1 h</td><td>{forcing.measured ? 'Nearest point, whole run' : 'Synthetic'}</td></tr>
              <tr><td>Surface current</td><td>{forcing.measured ? 'CMEMS / INCOIS HOOFS' : 'Model seed'}</td><td>1/12°</td><td>1 h</td><td>{forcing.measured ? 'Background drift' : 'Synthetic'}</td></tr>
              <tr><td>Eddies, windrows</td><td>GlobeMaster SurfaceFlow</td><td>50 m</td><td>solver</td><td>Always model</td></tr>
              <tr><td>Waves</td><td>WAVEWATCH III</td><td>0.5°</td><td>3 h</td><td>Display only</td></tr>
              <tr><td>SST</td><td>OSTIA</td><td>0.05°</td><td>1 d</td><td>Display only</td></tr>
              <tr><td>Coastline</td><td>Natural Earth 1:50m</td><td>—</td><td>—</td><td>Stranding</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="dm-card fc-callout">
        <header className="dm-head"><h3><Leaf size={15} />How conditions affect the forecast</h3></header>
        <p>{curMs > forcing.windSpeed * 0.03 ? 'The current outweighs wind drift, so the slick follows the water: a small error in current direction moves the whole forecast.' : 'Wind drift outweighs the current: a wind shift changes the track within hours.'} {forcing.windSpeed > 6 ? 'Breaking waves at this wind speed mix oil into the water, so the dispersed share grows through the run.' : 'Light wind leaves the slick coherent; little is dispersed.'} {sstC > 26 ? 'Warm water speeds up evaporation of the light ends.' : ''}</p>
      </section>
    </>
  );
}

function DriftVectors({ parts }: { parts: { u: number; v: number; label: string; cls: string }[] }) {
  const max = Math.max(...parts.map((q) => Math.hypot(q.u, q.v)), 0.05);
  const R = 52;
  return (
    <div className="fc-vec">
      <svg viewBox="-64 -64 128 128">
        <circle r={R} className="ring" /><circle r={R / 2} className="ring" />
        <path d="M0,-60 L0,60 M-60,0 L60,0" className="axis" />
        <text y={-56} textAnchor="middle" className="lbl">N</text>
        {parts.map((q) => { const x = (q.u / max) * R, y = (-q.v / max) * R; return <g key={q.label} className={q.cls}><line x2={x} y2={y} /><circle cx={x} cy={y} r={3} /></g>; })}
      </svg>
      <ul>{parts.map((q) => <li key={q.label} className={q.cls}><i />{q.label}<b className="num">{f2(Math.hypot(q.u, q.v))}</b></li>)}</ul>
    </div>
  );
}

function ImpactPane({ d, outlineDone, setPage }: { d: Derived; outlineDone: boolean; setPage: (p: ForecastPanel) => void }) {
  const total = d.bands.high + d.bands.medium;
  const reached = d.towns.filter((t) => t.first !== undefined);
  const sector = (hit: boolean, near: boolean) => (hit ? 'High' : near ? 'Medium' : 'Low');
  const recHit = d.receptors.some((r) => r.first !== undefined);
  return (
    <>
      <section className={`dm-card dm-hero fc-risk is-${d.risk.toLowerCase()}`}>
        <div>
          <h2>{d.risk} risk of shoreline impact</h2>
          <p>{!outlineDone ? 'The horizon run is still going; figures fill in as it reaches each hour.' : d.firstShore !== undefined ? `Oil reaches the coast at +${d.firstShore} h and ${f1(total)} km of shoreline by +24 h${recHit ? ', including sensitive areas' : ''}.` : 'The model keeps the oil offshore for the whole 24 h run.'}</p>
        </div>
        <Badge claim="predicted">24 h</Badge>
      </section>

      <section className="dm-tiles">
        <Tile label="Coast at risk" value={f1(total)} unit="km" tone={total ? 'critical' : 'clear'} note="reached by +24 h" />
        <Tile label="0–12 h" value={f1(d.bands.high)} unit="km" tone={d.bands.high ? 'critical' : undefined} note="high" />
        <Tile label="12–24 h" value={f1(d.bands.medium)} unit="km" tone={d.bands.medium ? 'warning' : undefined} note="medium" />
        <Tile label="First contact" value={d.firstShore !== undefined ? `+${d.firstShore}` : '—'} unit={d.firstShore !== undefined ? 'h' : undefined} note={reached[0]?.name ?? 'none'} />
        <Tile label="Towns reached" value={String(reached.length)} note={`of ${d.towns.length} within 120 km`} />
        <Tile label="Receptors hit" value={String(d.receptors.filter((r) => r.first !== undefined).length)} note={`of ${d.receptors.length} protected areas`} />
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><MapPin size={15} />Arrival windows</h3><span className="dm-meta">first to last contact within 8 km of each town</span></header>
        <div className="fc-arrivals">
          <div className="fc-arr-axis num"><span /><span>0</span><span>6</span><span>12</span><span>18</span><span>24 h</span></div>
          {d.towns.slice(0, 9).map((t) => (
            <div key={t.name} className="fc-arr-row">
              <span>{t.name}<small>{f1(t.km)} km</small></span>
              <div>
                {t.first !== undefined
                  ? <i className={t.first <= 12 ? 'is-high' : 'is-med'} style={{ left: `${(t.first / 24) * 100}%`, width: `${Math.max(2, (((t.last ?? t.first) - t.first + 1) / 24) * 100)}%` }}><b>+{t.first}–{(t.last ?? t.first) + 1} h</b></i>
                  : <em>not reached</em>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="dm-grid">
        <section className="dm-card">
          <header className="dm-head"><h3><Leaf size={15} />Sensitive receptors</h3><span className="dm-meta num">{d.receptors.length}</span></header>
          <ul className="dm-list">
            {d.receptors.slice(0, 6).map((r) => <li key={r.name}><i className={`fc-rdot is-${r.rating.toLowerCase()}`} /><span><b>{r.name}</b><small>{r.kind} · {r.first !== undefined ? `oil at +${r.first} h` : `${f1(r.reach)} km beyond reach`}</small></span><b className={`fc-rating is-${r.rating.toLowerCase()}`}>{r.rating}</b></li>)}
            {!d.receptors.length && <li><span><small>No protected areas within 120 km.</small></span></li>}
          </ul>
        </section>
        <section className="dm-card">
          <header className="dm-head"><h3><Target size={15} />Impact likelihood</h3></header>
          <dl className="dm-rows">
            {[
              ['Shoreline contamination', sector(d.firstShore !== undefined && d.firstShore <= 12, d.firstShore !== undefined)],
              ['Sensitive habitats', sector(recHit, d.receptors.some((r) => r.reach < 10))],
              ['Fisheries & aquaculture', sector(d.firstShore !== undefined, d.envelopeKm2 > 20)],
              ['Tourism & recreation', sector(reached.length > 1, reached.length > 0)],
              ['Ports & intakes', sector(d.sites.some((s) => s.reach < 2), d.sites.some((s) => s.reach < 10))],
            ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd><b className={`fc-rating is-${v.toLowerCase()}`}>{v}</b></dd></div>)}
          </dl>
        </section>
      </div>

      <section className="dm-card">
        <header className="dm-head"><h3><Ship size={15} />Infrastructure in the path</h3><span className="dm-meta num">{d.sites.length}</span></header>
        <ul className="dm-list is-two">
          {d.sites.slice(0, 8).map((s) => <li key={s.name}><i className={`dm-site-dot is-${s.kind}`} /><span><b>{s.name}</b><small>{s.operator}</small></span><b className="num">{s.reach < 0.5 ? 'inside' : `${f1(s.reach)} km`}</b></li>)}
          {!d.sites.length && <li><span><small>No charted rigs, SPMs or terminals within 80 km.</small></span></li>}
        </ul>
      </section>

      <section className="dm-card fc-callout fc-link" onClick={() => setPage('overview')}>
        <header className="dm-head"><h3><AlertTriangle size={15} />Implication for response</h3></header>
        <p>{d.firstShore !== undefined
          ? `Protect ${reached.slice(0, 2).map((t) => t.name).join(' and ') || 'the first landfall'} before +${Math.max(1, d.firstShore - 2)} h; boom sensitive inlets${recHit ? ` at ${d.receptors.find((r) => r.first !== undefined)?.name}` : ''}; stage shoreline clean-up for ${f1(total)} km.`
          : 'Keep response offshore: containment and recovery near the slick, with aerial surveillance each tide to confirm the drift.'}</p>
      </section>
    </>
  );
}

function VesselPane({ d, vessels, selected, setSelected, t0 }: { d: Derived; vessels?: MapVessel[]; selected?: string; setSelected: (id?: string) => void; t0: number }) {
  if (!vessels) return <p className="dm-loading">Loading AIS…</p>;
  const focus = d.top.find((r) => r.v.id === selected) ?? d.top[0];
  const topShare = d.top.reduce((s, r) => s + r.prob, 0);
  const conf = Math.round((focus?.prob ?? 0) * 100);
  return (
    <>
      <section className="dm-card dm-hero">
        <div>
          <h2>Most likely sources</h2>
          <p>The five vessels most likely to have caused this slick, of {d.total} on AIS. Same attribution as Detection → Map: vessels are filtered by the release window and distance to the backward-traced oil, then scored on proximity, timing, heading, behaviour near the trace and vessel type.</p>
        </div>
        <Badge claim="reconstructed">Ranked</Badge>
      </section>
      <section className="dm-tiles">
        <Tile label="Top 5 share" value={String(Math.round(topShare * 100))} unit="%" note={`of attribution across ${d.total} vessels`} />
        <Tile label="Leading" value={d.top[0] ? String(Math.round(d.top[0].prob * 100)) : '—'} unit="%" note={d.top[0]?.v.name} tone="warning" />
        <Tile label="Closest pass" value={d.top[0]?.pass ? f1(d.top[0].pass.km) : '—'} unit="km" note={d.top[0]?.pass ? `at ${signed(d.top[0].pass.h)}` : undefined} />
        <Tile label="AIS silences" value={String(d.top.filter((r) => r.v.gaps.some(([a, b]) => b >= -12 && a <= 0)).length)} note="in the last 12 h" tone={d.top.some((r) => r.v.gaps.length) ? 'critical' : undefined} />
      </section>

      <section className="dm-card">
        <header className="dm-head"><h3><Target size={15} />Attribution probability</h3><span className="dm-meta">{d.traceReady ? `share among all ${d.total} vessels` : 'provisional · backward trace still running'}</span></header>
        <ol className="fc-prob">
          {d.top.map((r, i) => (
            <li key={r.v.id} aria-selected={r.v.id === focus?.v.id} onClick={() => setSelected(r.v.id === selected ? undefined : r.v.id)}>
              <b className="num">{i + 1}</b>
              <span className="fc-prob-name"><b><i className={`dm-dot is-${tone(r.v)}`} />{r.v.name}</b><small>{r.v.type} · {r.v.flag}</small></span>
              <span className="fc-prob-bar"><i style={{ transform: `scaleX(${r.prob / d.top[0].prob})` }} /></span>
              <b className="num">{Math.round(r.prob * 100)} %</b>
              <small className="num">{r.pass ? `${f1(r.pass.km)} km at ${signed(r.pass.h)}` : '—'}</small>
            </li>
          ))}
        </ol>
      </section>

      {focus && (
        <div className="dm-grid">
          <section className="dm-card">
            <header className="dm-head"><h3><Ship size={15} />{focus.v.name}</h3><span className="dm-meta">{focus.v.type}</span></header>
            <dl className="dm-rows">
              <div><dt>Closest to trace</dt><dd className="num">{focus.pass ? `${f1(focus.pass.km)} km at ${signed(focus.pass.h)}` : '—'}</dd></div>
              <div><dt>At</dt><dd className="num">{focus.pass ? `${when.format(t0 + focus.pass.h * 3_600_000)} UTC` : '—'}</dd></div>
              <div><dt>In source region</dt><dd className="num">{focus.insideH ? `${f1(focus.insideH)} h` : '—'}</dd></div>
              <div><dt>AIS silences</dt><dd className="num">{focus.v.gaps.length ? focus.v.gaps.map(([a, b]) => `${signed(a)} for ${Math.round((b - a) * 60)} min`).join(', ') : 'none'}</dd></div>
              <div><dt>Speed · course now</dt><dd className="num">{f1(focus.now.knots)} kn · {Math.round(focus.now.heading)}°</dd></div>
              <div><dt>MMSI · IMO</dt><dd className="num">{focus.v.mmsi} · {focus.v.imo}</dd></div>
            </dl>
          </section>
          <section className="dm-card">
            <header className="dm-head"><h3><Target size={15} />Confidence</h3></header>
            <div className="fc-conf">
              <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" className="bg" /><circle cx="22" cy="22" r="18" className="fg" strokeDasharray={`${(conf / 100) * 113} 113`} /></svg>
              <b className="num">{conf} %</b>
            </div>
            <p className="fc-note">{focus.v.why ?? `${focus.v.name} came within ${f1(focus.pass?.km ?? focus.dist)} km of the traced oil${focus.pass ? ` at ${signed(focus.pass.h)}` : ''}.`} Alternative sources cannot be excluded.</p>
          </section>
        </div>
      )}
    </>
  );
}
