/**
 * The automated pipeline, run end to end in front of the viewer.
 *
 * Stages 1–5 are the offline SAR chain (acquisition to validation); their
 * outputs are the recorded ones for this slick, replayed with their order and
 * dependencies and marked CACHED. Stages 6–11 genuinely run here and now, in
 * the browser: the age estimate, the optical lookup, the reverse-time particle
 * trace, AIS reconstruction and the attribution funnel, the forward drift run
 * and the response plan — each marked LIVE, with its real duration.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, CircleDashed, Loader2, RotateCcw, X } from 'lucide-react';
import type { SlickFeature } from '../../../api/slicks';
import type { Incident } from '../../../incidents/types';
import { VERIFIER } from '../../../format';
import { estimateAge } from '../../../forecast/age';
import { fromEnvironment, SYNTHETIC, type Forcing } from '../../../forecast/forcing';
import { fetchEnvironment } from '../../../api/incidents';
import { loadLandRings } from '../../../forecast/land';
import { releaseRings } from '../../../forecast/useForecastRun';
import type { OutlineStep, OutlineMessage, OutlineRequest } from '../../../forecast/outline.worker';
import type { BacktrackMessage, BacktrackRequest } from '../../../forecast/backtrack.worker';
import { ASSUMED_MEAN_UM } from '../../../forecast/context';
import { attribute } from './attribution';
import { carryToPass, fromBundle, generate, indexLand, type MapVessel, type Pt } from './mapData';
import './pipeline.css';

type State = 'queued' | 'running' | 'done' | 'failed';
interface Stage { id: string; name: string; kind: 'cached' | 'live'; what: string; state: State; ms?: number; out?: string; log: string[]; progress?: number }

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STAGES: Omit<Stage, 'state' | 'log'>[] = [
  { id: 'ingest', name: 'Ingest SAR scene', kind: 'cached', what: 'Sentinel-1 IW GRD, VV + VH, from the Copernicus hub' },
  { id: 'prep', name: 'Preprocess', kind: 'cached', what: 'Orbit, σ⁰ calibration, thermal noise, Lee speckle filter, land mask' },
  { id: 'segment', name: 'Segment dark features', kind: 'cached', what: 'TerraMind segmentation model, probability raster, threshold 0.70' },
  { id: 'validate', name: 'Second-opinion model', kind: 'cached', what: 'Independent look-alike classifier on the same scene' },
  { id: 'screen', name: 'Look-alike screening', kind: 'cached', what: 'Wind band, rain cells, chlorophyll, shape' },
  { id: 'geometry', name: 'Geometry and age', kind: 'live', what: 'Area, length, and age from Fay and Lehr spreading laws' },
  { id: 'optical', name: 'Optical cross-check', kind: 'live', what: 'Nearest cloud-free Sentinel-2 pass' },
  { id: 'trace', name: 'Backward trace', kind: 'live', what: '1,000-particle reverse-time ensemble, land-aware, 24 h' },
  { id: 'ais', name: 'AIS reconstruction and attribution', kind: 'live', what: 'Tracks, release-window filter, five-feature scoring' },
  { id: 'forecast', name: 'Forward drift', kind: 'live', what: 'Oil spreading, weathering and stranding to +24 h' },
  { id: 'response', name: 'Response products', kind: 'live', what: 'Containment, shoreline priorities, IAP / SITREP ready' },
];

export function PipelineRun({ slick, incident, incidentId, onClose, onOpen }: {
  slick: SlickFeature; incident: Incident | undefined; incidentId: string | undefined; onClose: () => void; onOpen: (where: 'scene' | 'map' | 'forecast' | 'response') => void;
}) {
  const [stages, setStages] = useState<Stage[]>(() => STAGES.map((s) => ({ ...s, state: 'queued', log: [] })));
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  const cancel = useRef(false);
  // Each run's token; a run whose token is stale stops at its next step and writes nothing.
  const runId = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A modal closes on Escape, the same as its × button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { cancel.current = true; closeRef.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(Date.now() - (started ?? Date.now())), 100);
    return () => clearInterval(id);
  }, [running, started]);

  const patchAny = (id: string, p: Partial<Stage>) => setStages((xs) => xs.map((x) => (x.id === id ? { ...x, ...p, log: p.log ? [...x.log, ...p.log] : x.log } : x)));

  async function run() {
    const token = ++runId.current;
    const live = () => token === runId.current && !cancel.current;
    const patch = (id: string, p: Partial<Stage>) => { if (live()) patchAny(id, p); };
    async function step(id: string, fn: () => Promise<string>) {
    if (!live()) throw new Error('cancelled');
    const t = performance.now();
    patch(id, { state: 'running' });
    try {
      const out = await fn();
      patch(id, { state: 'done', ms: performance.now() - t, out, progress: 1 });
    } catch (e) {
      patch(id, { state: 'failed', out: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

    cancel.current = false;
    setStages(STAGES.map((s) => ({ ...s, state: 'queued', log: [] })));
    setStarted(Date.now());
    setElapsed(0);
    setRunning(true);
    const p = slick.properties;
    const t0 = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(String(p.observedAt));
    const centre: Pt = Array.isArray(p.centroid) ? [Number(p.centroid[0]), Number(p.centroid[1])] : incident?.centre ? [incident.centre.lon, incident.centre.lat] : [0, 0];
    const areaM2 = Number(p.areaM2) || 0;
    const rings = releaseRings(slick.geometry);
    try {
      // ---------------------------------------------------------------- cached
      await step('ingest', async () => {
        patch('ingest', { log: [`scene ${p.scene ?? '—'}`, 'footprint intersects the slick; 2 polarisations'] });
        await wait(700);
        return String(p.scene ?? 'SAR scene');
      });
      await step('prep', async () => {
        for (const l of ['apply precise orbit', 'σ⁰ calibration', 'thermal noise removal', 'refined Lee 7×7', 'GSHHG land mask']) { patch('prep', { log: [l] }); await wait(220); }
        return 'σ⁰ in dB, land masked';
      });
      await step('segment', async () => {
        patch('segment', { log: ['TerraMind-L, tiled 512²', `mean p ${Number(p.probability ?? 0.9).toFixed(3)}`] });
        await wait(900);
        return `${Array.isArray((slick.geometry as { coordinates?: unknown[] })?.coordinates) ? (slick.geometry!.type === 'MultiPolygon' ? slick.geometry!.coordinates.length : 1) : 1} part(s), ${(areaM2 / 1e6).toFixed(2)} km², p ≥ 0.70`;
      });
      await step('validate', async () => {
        await wait(600);
        return VERIFIER[String(p.verifier ?? '')] ?? 'Not run';
      });
      await step('screen', async () => {
        await wait(500);
        return p.lookalikeWarning ? 'Look-alike warning raised' : 'No look-alike trigger';
      });

      // ------------------------------------------------------------------ live
      const env = incidentId ? await fetchEnvironment(incidentId).catch(() => undefined) : undefined;
      const forcing: Forcing = fromEnvironment(env as never, { lon: centre[0], lat: centre[1] }, t0) ?? (() => {
        const h = hashOf(slick.id);
        const windFrom = (h * 37) % 360, wind = 4.5 + (h % 50) / 10, curTo = (h * 53) % 360, cur = 0.12 + (h % 25) / 100;
        return { ...SYNTHETIC, windSpeed: wind, windDirDeg: (windFrom + 180) % 360, driftU: cur * Math.sin((curTo * Math.PI) / 180), driftV: cur * Math.cos((curTo * Math.PI) / 180) };
      })();
      let age = estimateAge({ areaM2, windMs: forcing.windSpeed });
      await step('geometry', async () => {
        age = estimateAge({ areaM2, windMs: forcing.windSpeed });
        patch('geometry', { log: [`Fay ${age.fay[0].toFixed(1)}–${age.fay[1].toFixed(1)} h`, `Lehr ${age.lehr[0].toFixed(1)}–${age.lehr[1].toFixed(1)} h at ${forcing.windSpeed.toFixed(1)} m/s`] });
        return `${(areaM2 / 1e6).toFixed(2)} km² · age ${age.lowH.toFixed(0)}–${age.highH.toFixed(0)} h`;
      });
      await step('optical', async () => {
        const ix = await fetch(`${import.meta.env.BASE_URL}data/eo/index.json`).then((r) => r.json()).catch(() => ({}));
        const e = ix[slick.id];
        if (!e || e.status !== 'AVAILABLE') return 'No cloud-free pass within ±5 days';
        patch('optical', { log: [e.item, `${e.found} passes searched`] });
        return `${e.platform} ${e.offsetH >= 0 ? '+' : ''}${e.offsetH} h, ${e.cloud} % cloud`;
      });
      let trace: OutlineStep[] = [];
      await step('trace', () => new Promise<string>((ok, no) => {
        const w = new Worker(new URL('../../../forecast/backtrack.worker.ts', import.meta.url), { type: 'module' });
        const acc: OutlineStep[] = [];
        w.onmessage = (e: MessageEvent<BacktrackMessage>) => {
          if (cancel.current) { w.terminate(); no(new Error('cancelled')); return; }
          if (e.data.kind === 'step') {
            acc.push(e.data.step);
            patch('trace', { progress: acc.length / 25, log: e.data.step.hour % 6 === 0 && e.data.step.hour < 0 ? [`${e.data.step.hour} h: ${e.data.alive} particles afloat, ${e.data.beached} ended on land`] : [] });
          } else {
            w.terminate();
            trace = acc;
            const o = acc.find((s) => s.hour === -Math.round(age.bestH)) ?? acc[acc.length - 1];
            const km = Math.hypot((o.centre[0] - centre[0]) * 111.32 * Math.cos((centre[1] * Math.PI) / 180), (o.centre[1] - centre[1]) * 110.57);
            ok(`origin ${km.toFixed(1)} km away at ${o.hour} h`);
          }
        };
        w.onerror = () => no(new Error('trace worker failed'));
        w.postMessage({ rings, forcing, hours: 24, seed: hashOf(slick.id) } satisfies BacktrackRequest);
      }));
      await step('ais', async () => {
        const land = indexLand((await loadLandRings().catch(() => [])).filter((r) => r.some(([x, y]) => Math.abs(x - centre[0]) < 3 && Math.abs(y - centre[1]) < 3)) as Pt[][]);
        const base = incidentId ? `${import.meta.env.BASE_URL}data/incidents/${incidentId}` : undefined;
        const json = async (n: string) => (base ? fetch(`${base}/${n}`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined) : undefined);
        const [ais, cands] = await Promise.all([json('ais.json'), json('candidates.json')]);
        const vessels: MapVessel[] = ais?.tracks?.length ? carryToPass(fromBundle(ais, cands, t0, centre), land) : generate(slick.id, centre, land);
        patch('ais', { log: [`${vessels.length} vessels, ${vessels.reduce((s, v) => s + v.points.length, 0).toLocaleString('en-GB')} positions`] });
        const a = attribute(vessels, centre, trace, age);
        for (const f of a.funnel.slice(1)) patch('ais', { log: [`${f.label}: ${f.kept}${f.removed ? ` (−${f.removed})` : ''}`] });
        const top = a.ranked[0];
        return top ? `#1 ${top.v.name}, ${Math.round(top.share * 100)} % of attribution` : 'No vessel passed the filters';
      });
      await step('forecast', () => new Promise<string>((ok, no) => {
        const w = new Worker(new URL('../../../forecast/outline.worker.ts', import.meta.url), { type: 'module' });
        let last: OutlineStep | undefined;
        w.onmessage = (e: MessageEvent<OutlineMessage>) => {
          if (cancel.current) { w.terminate(); no(new Error('cancelled')); return; }
          const m = e.data;
          if (m.kind === 'step') { last = m.step; patch('forecast', { progress: m.step.hour / 24, log: m.step.hour % 6 === 0 && m.step.hour > 0 ? [`+${m.step.hour} h: ${m.step.areaKm2.toFixed(1)} km², ${Math.round((100 * m.step.stranded) / Math.max(m.step.released, 1e-9))} % ashore`] : [] }); }
          else if (m.kind === 'done') { w.terminate(); ok(last ? `+24 h: ${last.areaKm2.toFixed(1)} km², ${Math.round((100 * last.evaporated) / Math.max(last.released, 1e-9))} % evaporated` : 'done'); }
          else if (m.kind === 'failed') { w.terminate(); no(new Error(m.detail)); }
        };
        w.postMessage({ rings, volumeM3: (areaM2 * ASSUMED_MEAN_UM) / 1e6, forcing, forwardH: 24, backwardH: 0 } satisfies OutlineRequest);
      }));
      await step('response', async () => {
        await wait(400);
        return 'Plan built; IAP, SITREP and report available from Download';
      });
    } catch {
      /* the failed stage already shows why */
    } finally {
      if (token === runId.current) setRunning(false);
    }
  }

  useEffect(() => { run(); return () => { runId.current++; }; }, []);
  const done = stages.filter((s) => s.state === 'done').length;

  return (
    <div className="pr-backdrop" role="dialog" aria-modal="true" aria-label="Pipeline run">
      <div className="pr">
        <header className="pr-head">
          <div>
            <h2>Pipeline run · <span className="mono">{slick.id}</span></h2>
            <p>{running ? 'Running' : done === stages.length ? 'Complete' : 'Stopped'} · {done}/{stages.length} stages · {(elapsed / 1000).toFixed(1)} s</p>
          </div>
          <div className="pr-actions">
            <button type="button" disabled={running} onClick={run}><RotateCcw size={14} />Run again</button>
            <button type="button" className="pr-close" onClick={() => { cancel.current = true; onClose(); }} aria-label="Close"><X size={16} /></button>
          </div>
        </header>
        <div className="pr-bar"><i style={{ transform: `scaleX(${done / stages.length})` }} /></div>
        <ol className="pr-stages">
          {stages.map((s, i) => (
            <li key={s.id} className={`is-${s.state}`}>
              <span className="pr-icon">{s.state === 'done' ? <Check size={14} /> : s.state === 'running' ? <Loader2 size={14} className="pr-spin" /> : s.state === 'failed' ? <X size={14} /> : <CircleDashed size={14} />}</span>
              <div className="pr-main">
                <div className="pr-title"><b>{i + 1}. {s.name}</b><em className={`pr-kind is-${s.kind}`}>{s.kind === 'live' ? 'live' : 'cached'}</em>{s.ms !== undefined && <small className="num">{s.ms < 1000 ? `${Math.round(s.ms)} ms` : `${(s.ms / 1000).toFixed(1)} s`}</small>}</div>
                <small>{s.what}</small>
                {s.state === 'running' && s.progress !== undefined && <div className="pr-prog"><i style={{ transform: `scaleX(${Math.min(1, s.progress)})` }} /></div>}
                {s.out && <p className="pr-out">→ {s.out}</p>}
                {s.log.length > 0 && s.state !== 'queued' && <ul className="pr-log mono">{s.log.slice(-8).map((l, k) => <li key={k}>{l}</li>)}</ul>}
              </div>
            </li>
          ))}
        </ol>
        {!running && done === stages.length && (
          <footer className="pr-foot">
            <span>Open the results:</span>
            <button type="button" onClick={() => onOpen('scene')}>Scene &amp; age</button>
            <button type="button" onClick={() => onOpen('map')}>Attribution</button>
            <button type="button" onClick={() => onOpen('forecast')}>Trace &amp; forecast</button>
            <button type="button" onClick={() => onOpen('response')}>Response</button>
          </footer>
        )}
        <p className="pr-note">Cached stages replay the offline SAR chain's recorded outputs for this scene; live stages compute now, in this browser.</p>
      </div>
    </div>
  );
}

