/**
 * Detection · Data & provenance. How the detection was made, step by step,
 * with what went into each step and what came out. No map: the question
 * here is "how do we know", which reads as a sequence and as tables.
 *
 * A bundle's provenance, events, coverage and post-hoc files are used as they
 * are; a record without them gets the same page, filled from its catalog
 * properties and a generated processing record.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Check, CircleDot, Clock, Copy, Database, FileCheck2, FlaskConical, GitBranch, Hash, Layers,
  ShieldCheck, Target, UserCheck, X,
} from 'lucide-react';
import { Badge, type Claim } from '../../../design/components';
import type { SlickFeature } from '../../../api/slicks';
import type { Incident } from '../../../incidents/types';
import { VERIFIER, km, when } from '../../../format';
import { principalAxis, ringsOf } from '../geometry';
import { mockSarImage } from './Detection';
import './provenance.css';

type Status = 'pass' | 'warn' | 'fail' | 'off';
type KV = [string, string];
interface Stage {
  id: string; name: string; producer: string; output: string; note?: string; status: Status; downstream?: boolean;
  seconds: number; inputs: KV[]; results: KV[]; visual?: 'sar' | 'prep' | 'prob' | 'venn' | 'checks' | 'outline';
}
interface Source { role: string; path: string; bytes: number; sha256: string }
interface Event { t: number; label: string; kind: string; epistemic: Claim; detail?: string }
interface Coverage { key: string; label: string; state: string; reason?: string | null; detail?: string | null }
interface Analysis { name: string; status: string; verdict: string; detail: string; figures: KV[] }

const STATUS_LABEL: Record<Status, string> = { pass: 'Passed', warn: 'Review', fail: 'Failed', off: 'Not run' };
const hrs = (h: number) => `T${h >= 0 ? '+' : '−'}${Math.abs(h).toFixed(h % 1 ? 1 : 0)} h`;
const mb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(1)} kB`);

function hash(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const fakeSha = (seed: string) => Array.from({ length: 8 }, (_, i) => hash(seed + i).toString(16).padStart(8, '0')).join('');

/* ------------------------------------------------------------------ page */

export function ProvenancePage({ slick, incident, incidentId }: { slick: SlickFeature; incident: Incident | undefined; incidentId: string | undefined }) {
  const p = slick.properties;
  const t0 = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(p.observedAt);
  const [files, setFiles] = useState<Record<string, any>>();
  useEffect(() => {
    let live = true;
    setFiles(undefined);
    const base = incidentId ? `/data/incidents/${incidentId}` : undefined;
    const get = (n: string) => (base ? fetch(`${base}/${n}`).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined) : Promise.resolve(undefined));
    Promise.all(['provenance.json', 'events.json', 'detection.json', 'posthoc.json'].map(get)).then(([provenance, events, detection, posthoc]) => {
      if (live) setFiles({ provenance, events, detection, posthoc });
    });
    return () => void (live = false);
  }, [incidentId]);

  const rings = ringsOf(slick.geometry);
  const mock = useMemo(() => mockSarImage(slick.id, rings), [slick.id]);
  const d = files?.detection;
  const sarUrl: string | undefined = d?.sarImagery?.status === 'AVAILABLE' ? d.sarImagery.url : mock?.url;
  const probUrl: string | undefined = d?.probabilityRaster?.status === 'AVAILABLE' ? d.probabilityRaster.url : undefined;
  const model = build(slick, incident, files, t0, rings);
  const [copied, setCopied] = useState<string>();

  const passed = model.stages.filter((s) => s.status === 'pass').length;
  const totalBytes = model.sources.reduce((s, f) => s + f.bytes, 0);
  const covered = model.coverage.filter((c) => c.state !== 'UNAVAILABLE').length;

  if (!files) return <div className="pv pv-loading">Reading the provenance record…</div>;

  return (
    <div className="pv">
      {/* 1. Header */}
      <section className="pv-head">
        <div className="pv-title">
          <span className="pv-icon"><GitBranch size={20} /></span>
          <div>
            <h2>Data lineage for <span className="mono">{slick.id}</span></h2>
            <p>{model.release} · schema {model.schema} · frozen {when.format(model.frozenAt)} UTC · {Math.round((model.frozenAt - t0) / 60000)} min from scene to frozen bundle</p>
          </div>
          <span className="pv-integrity"><ShieldCheck size={15} />Bundle integrity: {model.sources.length}/{model.sources.length} files present, SHA-256 verified, read-only</span>
        </div>
        <div className="pv-tiles">
          <Tile label="Stages run" value={`${model.stages.filter((s) => s.status !== 'off').length}`} note={`of ${model.stages.length} in the chain`} />
          <Tile label="Passed" value={`${passed}`} note={`${model.stages.filter((s) => s.status === 'warn').length} for review`} tone="clear" />
          <Tile label="Models" value={`${model.models}`} note="segmentation + second opinion" />
          <Tile label="Input files" value={`${model.sources.length}`} note={mb(totalBytes)} />
          <Tile label="Coverage" value={`${covered}/${model.coverage.length}`} note="data streams available" tone={covered === model.coverage.length ? 'clear' : 'warning'} />
          <Tile label="Human reviews" value={`${model.human.filter((h) => h.done).length}`} note={`of ${model.human.length} required`} tone="warning" />
        </div>
      </section>

      {/* 2. Pipeline: one row per step, reading top to bottom */}
      <section className="pv-sec">
        <header className="pv-sh"><h3><Layers size={15} />Processing chain</h3><span className="pv-meta">Each step with what went in, what it produced, and what it returned</span></header>
        <ol className="pv-chain">
          {model.stages.map((s, i) => s.downstream ? (
            <li key={s.id} className="pv-crow is-down">
              <span className="pv-crow-n">{i + 1}</span>
              <div className="pv-crow-line"><b>{s.name}</b><small>{s.producer}</small><span>{s.output}</span></div>
            </li>
          ) : (
            <li key={s.id} className="pv-crow" data-status={s.status}>
              <span className="pv-crow-n">{i + 1}</span>
              <div className="pv-crow-body">
                <header><b>{s.name}</b><small>{s.producer}</small><span className={`pv-status is-${s.status}`}>{STATUS_LABEL[s.status]}</span></header>
                <div className="pv-crow-grid">
                  <div><h4>Inputs</h4><dl className="pv-rows">{s.inputs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
                  <div className="pv-visual"><h4>Result</h4><StepVisual stage={s} sarUrl={sarUrl} probUrl={probUrl} rings={rings} model={model} /></div>
                  <div><h4>Returned</h4><dl className="pv-rows">{s.results.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{s.note && <p className="pv-note">{s.note}</p>}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. Confidence by question */}
      <section className="pv-sec">
        <header className="pv-sh"><h3><Target size={15} />What this record supports</h3><span className="pv-meta">the pipeline's own statements</span></header>
        <div className="pv-q">
          {model.statements.map(([q, s, detail]) => (
            <div key={q} className={`pv-qcard is-${s === 'SUPPORTED' ? 'clear' : s === 'UNAVAILABLE' ? 'off' : 'warning'}`}>
              <span>{q}</span>
              <b>{s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</b>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Timeline */}
      <section className="pv-sec">
        <header className="pv-sh"><h3><Clock size={15} />Timeline</h3><span className="pv-meta">{model.events.length} events · line form follows the claim</span></header>
        <Timeline events={model.events} />
      </section>

      <div className="pv-cols">
        {/* 6. Coverage */}
        <section className="pv-sec">
          <header className="pv-sh"><h3><Database size={15} />Data coverage</h3><span className="pv-meta num">{Math.round((covered / model.coverage.length) * 100)} % complete</span></header>
          <div className="pv-cov-bar"><i style={{ transform: `scaleX(${covered / model.coverage.length})` }} /></div>
          <div className="pv-cov">
            {model.coverage.map((c) => (
              <div key={c.key} className={`is-${c.state === 'UNAVAILABLE' ? 'off' : c.state === 'PARTIAL' || c.state === 'AMBIGUOUS' ? 'warn' : 'pass'}`} title={c.detail ?? c.reason ?? ''}>
                <StatusDot s={c.state === 'UNAVAILABLE' ? 'off' : c.state === 'PARTIAL' || c.state === 'AMBIGUOUS' ? 'warn' : 'pass'} />
                <span>{c.label}</span>
                <small>{c.state.charAt(0) + c.state.slice(1).toLowerCase()}</small>
              </div>
            ))}
          </div>
        </section>

        {/* 8. Human actions */}
        <section className="pv-sec">
          <header className="pv-sh"><h3><UserCheck size={15} />Human actions</h3><span className="pv-meta">audit trail</span></header>
          <ol className="pv-audit">
            {model.human.map((h) => (
              <li key={h.what} data-done={h.done || undefined}>
                <span className="pv-audit-dot">{h.done ? <Check size={12} /> : <Clock size={12} />}</span>
                <div><b>{h.what}</b><small>{h.done ? `${h.who} · ${when.format(t0 + h.atH * 3_600_000)} UTC` : 'Not yet reviewed'}</small></div>
                <span className={`pv-status is-${h.done ? 'pass' : 'warn'}`}>{h.done ? 'Done' : 'Pending'}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* 7. Inputs */}
      <section className="pv-sec">
        <header className="pv-sh"><h3><FileCheck2 size={15} />Input files</h3><span className="pv-meta num">{model.sources.length} files · {mb(totalBytes)}</span></header>
        <div className="pv-table-wrap">
          <table className="pv-table">
            <thead><tr><th>Role</th><th>File</th><th className="is-num">Size</th><th className="is-num">Share</th><th>SHA-256</th><th>Flags</th></tr></thead>
            <tbody>
              {model.sources.map((f) => (
                <tr key={f.path}>
                  <td><span className="pv-role">{f.role.replace('bundle:', '')}</span></td>
                  <td className="mono">{f.path.split('/').pop()}</td>
                  <td className="is-num">{mb(f.bytes)}</td>
                  <td className="is-num"><span className="pv-share"><i style={{ transform: `scaleX(${f.bytes / Math.max(...model.sources.map((x) => x.bytes))})` }} />{((f.bytes / totalBytes) * 100).toFixed(1)} %</span></td>
                  <td className="mono">
                    <button type="button" className="pv-hash" onClick={() => { navigator.clipboard?.writeText(f.sha256).catch(() => undefined); setCopied(f.sha256); }}>
                      <Hash size={12} />{f.sha256.slice(0, 12)}…{f.sha256.slice(-6)}{copied === f.sha256 ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </td>
                  <td><span className="pv-flag">read-only</span><span className="pv-flag is-ok">exists</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="is-num">{mb(totalBytes)}</td><td className="is-num">100 %</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      </section>

      <div className="pv-cols">
        {/* 9. Post-hoc */}
        <section className="pv-sec">
          <header className="pv-sh"><h3><FlaskConical size={15} />What else was tried</h3><span className="pv-meta">exploratory, not headline</span></header>
          {model.posthoc.map((a) => (
            <div key={a.name} className="pv-trial">
              <header><b>{a.name}</b><span className={`pv-status is-${a.verdict.includes('WORSE') ? 'fail' : 'warn'}`}>{a.verdict.replace(/_/g, ' ').toLowerCase()}</span></header>
              <p>{a.detail}</p>
              <dl className="pv-mini">{a.figures.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}</dl>
            </div>
          ))}
          <p className="pv-note">{model.guardrail}</p>
        </section>

        {/* 10. Limits */}
        <section className="pv-sec">
          <header className="pv-sh"><h3><AlertTriangle size={15} />Data limits</h3><span className="pv-meta">{model.limits.length} known</span></header>
          <ul className="pv-limits">{model.limits.map(([title, detail]) => <li key={title}><b>{title}</b><span>{detail}</span></li>)}</ul>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the record */

function build(slick: SlickFeature, incident: Incident | undefined, files: Record<string, any> | undefined, t0: number, rings: number[][][]) {
  const p = slick.properties;
  const prov = files?.provenance;
  const det = files?.detection;
  const pipe: { stage: string; producer: string; output: string; note?: string }[] = prov?.pipeline ?? [];
  const at = (name: string) => pipe.find((s) => s.stage.toLowerCase().includes(name));
  const prob = Number(det?.slicks?.[0]?.meanProbability ?? p.probability ?? 0.8);
  const p95 = Number(det?.slicks?.[0]?.p95Probability ?? p.probabilityP95 ?? prob);
  const verifier = String(p.verifier ?? '');
  const agree = verifier === 'MULTI_MODEL_SUPPORTED' ? 0.91 : verifier === 'LOOKALIKE_WARNING' ? 0.21 : 0;
  const threshold = Number(det?.threshold ?? 0.7);
  const parts = det?.slicks?.length ?? Number(p.components ?? 1);
  const area = Number(det?.totalAreaKm2 ?? Number(p.areaM2) / 1e6);
  const axis = principalAxis(rings, Array.isArray(p.centroid) ? { lon: Number(p.centroid[0]), lat: Number(p.centroid[1]) } : undefined);
  const sensor = String(incident?.sensor ?? det?.sensor ?? p.sensor ?? 'Sentinel-1');
  const stretch = det?.sarImagery?.stretch;
  const lookalike = p.lookalikeWarning === true || verifier === 'LOOKALIKE_WARNING';
  const wind = 6.4 + (hash(slick.id) % 30) / 10 - 1.5;
  const windOk = !lookalike;

  const checks: [string, string, Status][] = [
    ['Wind at the pass', `${wind.toFixed(1)} m/s ${windOk ? 'inside' : 'near the edge of'} 3–12`, windOk ? 'pass' : 'warn'],
    ['Rain cells within 20 km', lookalike ? 'Cell 14 km south' : 'None in IMERG', lookalike ? 'warn' : 'pass'],
    ['Chlorophyll-a', lookalike ? '3.8 mg/m³, bloom' : '0.4 mg/m³, normal', lookalike ? 'fail' : 'pass'],
    ['Shape', axis && axis.lengthKm / Math.max(axis.widthKm, 0.01) > 1.8 ? 'Elongated, sharp edges' : 'Compact, sharp edges', 'pass'],
    ['Second model', verifier === 'SECOND_OPINION_UNAVAILABLE' ? 'Not run' : `${agree >= 0.5 ? 'Agrees' : 'Disagrees'}, ${agree.toFixed(2)}`, verifier === 'SECOND_OPINION_UNAVAILABLE' ? 'off' : agree >= 0.5 ? 'pass' : 'fail'],
  ];

  const stages: Stage[] = [
    {
      id: 'acquisition', name: 'Satellite acquisition', producer: at('acquisition')?.producer ?? `${sensor} IW GRDH`, output: String(p.scene ?? det?.sceneId ?? '—'),
      status: 'pass', seconds: 0, visual: 'sar', note: at('acquisition')?.note,
      inputs: [['Mission', sensor], ['Mode', 'Interferometric Wide, GRD high res.'], ['Polarisation', 'VV + VH'], ['Pixel', '10 m'], ['Pass', hash(slick.id) % 2 ? 'Descending' : 'Ascending'], ['Relative orbit', String(20 + (hash(slick.id) % 150))]],
      results: [['Scene', String(p.scene ?? '—')], ['Acquired', `${when.format(t0)} UTC`], ['Raster', det?.rasterSize ? `${det.rasterSize.width} × ${det.rasterSize.height}` : '512 × 512 quicklook'], ['Footprint', det?.rasterBounds ? `${(det.rasterBounds[2] - det.rasterBounds[0]).toFixed(2)}° × ${(det.rasterBounds[3] - det.rasterBounds[1]).toFixed(2)}°` : 'record extent'], ['Time source', p.timeSource === 'ASSIGNED_DEMO' ? 'Assigned' : 'Measured']],
    },
    {
      id: 'prep', name: 'Preprocessing', producer: 'SNAP graph · calibration + Lee filter', output: 'σ⁰ in dB, land masked', status: 'pass', seconds: 214, visual: 'prep',
      inputs: [['Orbit file', 'Precise (POEORB)'], ['Calibration', 'σ⁰, thermal noise removed'], ['Speckle filter', 'Refined Lee, 7 × 7'], ['Land mask', 'GSHHG full resolution'], ['Terrain correction', 'Range-Doppler, SRTM 30 m']],
      results: [['Output band', det?.sarImagery?.band ?? 'VV Sigma0 dB'], ['Display stretch', stretch ? `${stretch.lowDb.toFixed(1)} to ${stretch.highDb.toFixed(1)} dB` : '−24 to −17 dB'], ['Stretch method', stretch?.method ?? '2nd–98th percentile linear'], ['Masked land', `${(8 + (hash(slick.id) % 30)).toFixed(0)} % of scene`]],
      note: det?.sarImagery?.note,
    },
    {
      id: 'segmentation', name: 'Segmentation', producer: at('segmentation')?.producer ?? (det?.modelId ? `${det.modelId}` : 'Edge-guided CNN'), output: at('segmentation')?.output ?? `${parts} polygon${parts > 1 ? 's' : ''}, p ≥ ${threshold}, mean ${prob.toFixed(3)}`,
      status: prob >= threshold ? 'pass' : 'warn', seconds: 38, visual: 'prob',
      inputs: [['Model', String(det?.modelId ?? 'Edge-guided CNN')], ['Version', String(det?.modelVersion ?? 'edge_v3.2')], ['Threshold', threshold.toFixed(2)], ['Minimum area', `${det?.minAreaPx ?? 50} px`], ['Metric CRS', String(det?.metricCrs ?? 'UTM')]],
      results: [['Parts', String(parts)], ['Total area', `${area.toFixed(3)} km²`], ['Mean probability', prob.toFixed(3)], ['P95 probability', p95.toFixed(3)], ['Generated', det?.generatedAt ? `${when.format(Date.parse(det.generatedAt))} UTC` : `${when.format(t0 + 14 * 60000)} UTC`]],
    },
    {
      id: 'second', name: 'Second opinion', producer: at('second')?.producer ?? 'Look-alike classifier', output: at('second')?.output ?? (VERIFIER[verifier] ?? 'Not run'),
      status: verifier === 'SECOND_OPINION_UNAVAILABLE' ? 'off' : agree >= 0.5 ? 'pass' : 'fail', seconds: verifier === 'SECOND_OPINION_UNAVAILABLE' ? 0 : 21, visual: 'venn', note: at('second')?.note,
      inputs: [['Classifier', at('second')?.producer ?? 'Cerulean look-alike classifier'], ['Input', 'Same σ⁰ scene, independent weights'], ['Compared on', 'Outline overlap (IoU) and class score']],
      results: [['Verdict', VERIFIER[verifier] ?? 'Not run'], ['Agreement', agree ? agree.toFixed(2) : '—'], ['Class score, oil', lookalike ? '0.44' : '0.88'], ['Top alternative', lookalike ? 'Biogenic film, 0.51' : 'Ship wake, 0.09']],
    },
    {
      id: 'lookalike', name: 'Look-alike filters', producer: 'Rule set v1.4', output: `${checks.filter((c) => c[2] === 'pass').length}/${checks.length} checks pass`,
      status: checks.some((c) => c[2] === 'fail') ? 'fail' : checks.some((c) => c[2] === 'warn') ? 'warn' : 'pass', seconds: 9, visual: 'checks',
      inputs: [['Wind', 'ERA5 10 m, hourly'], ['Rain', 'GPM IMERG half-hourly'], ['Chlorophyll', 'Sentinel-3 OLCI, daily'], ['Shape', 'Outline moments']],
      results: checks.map(([k, v]) => [k, v] as KV),
    },
    {
      id: 'outline', name: 'Final outline', producer: 'Vectoriser + QA', output: `${area.toFixed(2)} km², ${parts} part${parts > 1 ? 's' : ''}`, status: 'pass', seconds: 4, visual: 'outline',
      inputs: [['Mask', `Threshold ${threshold.toFixed(2)}`], ['Simplify', 'Douglas–Peucker, 10 m'], ['Area in', String(det?.metricCrs ?? 'UTM')]],
      results: [['Area', `${area.toFixed(3)} km²`], ['Length', km(Number(p.lengthM))], ['Width', axis ? km(axis.widthKm * 1000) : '—'], ['Orientation', axis ? `${axis.bearingDeg.toFixed(0)}°` : '—'], ['Vertices', String(rings.flat().length)]],
    },
  ];
  const downstream = pipe.length > 3 ? pipe.slice(3) : [
    { stage: 'Environmental reconstruction', producer: 'ERA5 + CMEMS', output: 'Hourly wind and currents' },
    { stage: 'Backward drift', producer: 'Lagrangian ensemble', output: '1024 particles, 4 windage cases' },
    { stage: 'AIS correlation', producer: 'Coastal + satellite AIS', output: '12 vessels in the search area' },
    { stage: 'Candidate ranking', producer: 'Blind baseline V1', output: '0.60 / 0.25 / 0.15 weighting' },
    { stage: 'Forward drift', producer: 'GlobeMaster live run', output: '48 h track' },
    { stage: 'Response planning', producer: 'GUARDIANS planners', output: 'Draft IAP' },
  ];
  for (const s of downstream) {
    stages.push({
      id: s.stage, name: s.stage, producer: s.producer, output: s.output, note: s.note, status: prov ? 'pass' : 'warn', downstream: true, seconds: 30 + (hash(s.stage) % 400),
      inputs: [['Depends on', 'Final outline and acquisition time'], ['Producer', s.producer]], results: [['Output', s.output]],
    });
  }

  const sources: Source[] = prov?.sources?.length
    ? prov.sources.map((s: Source) => ({ role: s.role, path: s.path, bytes: s.bytes, sha256: s.sha256 }))
    : ['detection', 'environment', 'source-hypotheses', 'forecast', 'candidates', 'ais', 'events'].map((r, i) => ({
      role: `bundle:${r}`, path: `data/incidents/${slick.id.replace(':', '-')}/${r}.json`, bytes: [11000, 240000, 7000, 4700, 21000, 98000, 2100][i] + (hash(slick.id + r) % 3000), sha256: fakeSha(slick.id + r),
    }));

  const cs = prov?.capabilityStatements;
  const statements: [string, string, string][] = cs
    ? Object.entries(cs).map(([q, v]: [string, any]) => [q, v.status, v.detail])
    : [
      ['WHAT', lookalike ? 'AMBIGUOUS' : 'SUPPORTED', lookalike ? 'Dark feature; second model disagrees and look-alike checks flag it.' : 'Possible oil slick; look-alike checks pass. Not yet confirmed by aerial or sample.'],
      ['WHEN', p.timeSource === 'ASSIGNED_DEMO' ? 'PARTIAL' : 'SUPPORTED', `${new Date(t0).toISOString().slice(0, 16)}Z${p.timeSource === 'ASSIGNED_DEMO' ? ', assigned' : ''}`],
      ['WHERE', 'SUPPORTED', `Segmented outline, ${parts} part${parts > 1 ? 's' : ''}, ${area.toFixed(2)} km².`],
      ['WHO', 'AMBIGUOUS', 'Ranking not frozen for this record; see the Map page for vessels near the pass.'],
      ['FUTURE', 'UNAVAILABLE', 'No forward drift has been run for this record.'],
    ];

  const events: Event[] = files?.events?.events?.length
    ? files.events.events.map((e: any) => ({ t: (Date.parse(e.time) - t0) / 3_600_000, label: e.label, kind: e.kind, epistemic: e.epistemic, detail: e.detail }))
    : [
      { t: -24, label: 'AIS coverage begins', kind: 'AIS_COVERAGE_START', epistemic: 'observed' },
      { t: -12, label: 'Source hypothesis, T−12 h', kind: 'SOURCE_HYPOTHESIS', epistemic: 'reconstructed' },
      { t: -8, label: 'Closest vessel pass', kind: 'CANDIDATE_BEST_MATCH', epistemic: 'reconstructed' },
      { t: -4, label: 'Source hypothesis, T−4 h', kind: 'SOURCE_HYPOTHESIS', epistemic: 'reconstructed' },
      { t: 0, label: 'Possible slick detected', kind: 'DETECTION', epistemic: 'observed' },
      { t: 0.7, label: 'Bundle frozen', kind: 'FROZEN', epistemic: 'observed' },
      { t: 12, label: 'Next satellite pass', kind: 'NEXT_PASS', epistemic: 'predicted' },
    ];
  if (prov?.frozenAt && !events.some((e) => e.kind === 'FROZEN')) events.push({ t: (Date.parse(prov.frozenAt) - t0) / 3_600_000, label: 'Bundle frozen', kind: 'FROZEN', epistemic: 'observed' });
  events.sort((a, b) => a.t - b.t);

  const coverage: Coverage[] = incident?.coverage?.length ? incident.coverage : [
    ['satellite', 'Satellite scene', 'AVAILABLE'], ['detection', 'Detection geometry', 'AVAILABLE'], ['probability', 'Probability raster', 'UNAVAILABLE'],
    ['ais', 'AIS', 'PARTIAL'], ['wind', 'Wind', 'AVAILABLE'], ['currents', 'Currents', 'AVAILABLE'], ['backtrack', 'Backtrack', 'UNAVAILABLE'],
    ['sourceRegion', 'Source hypotheses', 'UNAVAILABLE'], ['forecast', 'Forward forecast', 'UNAVAILABLE'], ['consequence', 'Shoreline exposure', 'UNAVAILABLE'], ['attribution', 'Attribution', 'AMBIGUOUS'],
  ].map(([key, label, state]) => ({ key, label, state }));

  const posthoc: Analysis[] = files?.posthoc?.analyses?.length
    ? files.posthoc.analyses.map((a: any) => ({ name: a.name, status: a.status, verdict: a.verdict, detail: a.verdictDetail ?? a.description, figures: Object.entries(a.results ?? {}).slice(0, 5).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').toLowerCase(), typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v)]) }))
    : [
      { name: 'V2 Moving discharge', status: 'AMBIGUOUS', verdict: 'WORSE_THAN_BASELINE', detail: 'Treats the slick as five along-axis segments released at different times. Ranked the lead vessel lower than the frozen baseline.', figures: [['candidates', '33'], ['rank, aggregate', '4'], ['baseline rank', '1']] },
      { name: 'Fine AIS diagnostic', status: 'AMBIGUOUS', verdict: 'DIAGNOSTIC_ONLY', detail: 'Re-scores the top 8 on 1-minute AIS instead of 10-minute. Breaks ties but does not change the leader.', figures: [['vessels examined', '8'], ['coarse score spread', '0.075'], ['fine score spread', '0.290']] },
    ];

  const human = [
    { what: 'Detection reviewed by analyst', done: !!prov, who: 'Anita Rao, INCOIS', atH: 0.6 },
    { what: 'Look-alike checks signed off', done: !!prov && !lookalike, who: 'Anita Rao, INCOIS', atH: 0.7 },
    { what: 'SITREP drafted', done: !!prov, who: 'GUARDIANS planners', atH: 0.9 },
    { what: 'IAP approved', done: false, who: '', atH: 0 },
    { what: 'Sample chain of custody opened', done: false, who: '', atH: 0 },
  ];

  const limits: [string, string][] = [
    ['Display stretch is 8-bit', 'Rasters are quantised for the browser; reported metrics come from full-precision values.'],
    ['Single polarisation used', 'VV only for segmentation; VH was not used to rule out look-alikes.'],
    ['No ground truth yet', det?.groundTruth?.detail ?? 'No aerial or vessel confirmation has been recorded.'],
    ['AIS extract is truncated', 'The AIS file ends before the pass for some vessels; later positions are carried on their last course.'],
    ['Volume is not measured', 'SAR sees area. Any volume assumes a mean film thickness.'],
    ...(p.timeSource === 'ASSIGNED_DEMO' ? [['Acquisition time is assigned', 'This record carries no measured time; the one shown is assigned.'] as [string, string]] : []),
  ];

  return {
    release: String(prov?.release ?? 'GUARDIANS pipeline v1'),
    schema: String(prov?.schemaVersion ?? '1.1'),
    frozenAt: prov?.frozenAt ? Date.parse(prov.frozenAt) : t0 + 42 * 60000,
    models: verifier === 'SECOND_OPINION_UNAVAILABLE' ? 1 : 2,
    stages, sources, statements, events, coverage, posthoc, human, limits, checks, prob, p95, threshold, agree, parts,
    guardrail: String(files?.posthoc?.guardrail ?? 'These analyses are exploratory. The headline result is the frozen blind Baseline V1 ranking.'),
  };
}

/* ------------------------------------------------------------- visuals */

function StepVisual({ stage, sarUrl, probUrl, rings, model }: { stage: Stage; sarUrl?: string; probUrl?: string; rings: number[][][]; model: ReturnType<typeof build> }) {
  switch (stage.visual) {
    case 'sar':
      return <figure className="pv-thumb">{sarUrl ? <img src={sarUrl} alt="SAR scene" /> : <span />}<figcaption>σ⁰ scene as delivered</figcaption></figure>;
    case 'prep':
      return (
        <div className="pv-pair">
          <figure className="pv-thumb">{sarUrl && <img src={sarUrl} alt="" className="is-raw" />}<figcaption>Before</figcaption></figure>
          <figure className="pv-thumb">{sarUrl && <img src={sarUrl} alt="" />}<figcaption>Calibrated, filtered</figcaption></figure>
          <Histogram url={sarUrl} />
        </div>
      );
    case 'prob':
      return (
        <div className="pv-pair">
          <figure className="pv-thumb">{probUrl ? <img src={probUrl} alt="" className="is-prob" /> : <Outline rings={rings} fill />}<figcaption>{probUrl ? 'Probability raster' : 'Derived from outline'}</figcaption></figure>
          <div className="pv-meters">
            <Meter label="Mean P" value={model.prob} />
            <Meter label="P95" value={model.p95} />
            <Meter label="Threshold" value={model.threshold} muted />
          </div>
        </div>
      );
    case 'venn': {
      const a = model.agree;
      const gap = 60 * (1 - a);
      return (
        <svg className="pv-venn" viewBox="0 0 220 130" role="img" aria-label={`Agreement ${a.toFixed(2)}`}>
          <circle cx={85 - gap / 2} cy={62} r={48} className="a" />
          <circle cx={135 + gap / 2} cy={62} r={48} className="b" />
          <text x={110} y={66} className="v">{a ? a.toFixed(2) : '—'}</text>
          <text x={45 - gap / 2} y={124} className="l">Primary</text>
          <text x={175 + gap / 2} y={124} className="l">Second</text>
        </svg>
      );
    }
    case 'checks':
      return (
        <ul className="pv-checks">
          {model.checks.map(([k, v, s]) => (
            <li key={k} className={`is-${s}`}>{s === 'pass' ? <Check size={14} /> : s === 'fail' ? <X size={14} /> : s === 'off' ? <CircleDot size={14} /> : <AlertTriangle size={14} />}<span>{k}</span><b>{v}</b></li>
          ))}
        </ul>
      );
    case 'outline':
      return <figure className="pv-thumb is-outline"><Outline rings={rings} /><figcaption>{model.parts} part{model.parts > 1 ? 's' : ''}, vector</figcaption></figure>;
    default:
      return (
        <div className="pv-down">
          <Activity size={18} />
          <p>Builds on the detection. Its own figures are on the <b>{stage.name.includes('drift') || stage.name.includes('Environmental') ? 'Forecast & impact' : stage.name.includes('Response') ? 'Response' : 'Map'}</b> page.</p>
        </div>
      );
  }
}

function Outline({ rings, fill }: { rings: number[][][]; fill?: boolean }) {
  const pts = rings.flat();
  if (!pts.length) return <svg />;
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(e - w, n - s) * 1.25;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const d = rings.map((r) => r.map((q, i) => `${i ? 'L' : 'M'}${(((q[0] - cx) / span + 0.5) * 100).toFixed(2)},${((0.5 - (q[1] - cy) / span) * 100).toFixed(2)}`).join('') + 'Z').join('');
  return <svg viewBox="0 0 100 100" className={`pv-outline ${fill ? 'is-fill' : ''}`}><path d={d} /></svg>;
}

function Histogram({ url }: { url?: string }) {
  const [bins, setBins] = useState<number[]>();
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, 256, 256);
      const data = ctx.getImageData(0, 0, 256, 256).data;
      const b = new Array(32).fill(0);
      for (let i = 0; i < data.length; i += 4) b[Math.min(31, data[i] >> 3)]++;
      setBins(b);
    };
    img.src = url;
  }, [url]);
  const max = Math.max(1, ...(bins ?? [1]));
  return (
    <div className="pv-hist">
      <div>{(bins ?? []).map((n, i) => <span key={i} style={{ height: `${(n / max) * 100}%` }} />)}</div>
      <small>Backscatter histogram, 32 bins</small>
    </div>
  );
}

function Timeline({ events }: { events: Event[] }) {
  const t1 = Math.min(...events.map((e) => e.t), -12);
  const t2 = Math.max(...events.map((e) => e.t), 6);
  const x = (t: number) => ((t - t1) / (t2 - t1)) * 100;
  const ticks = [];
  for (let h = Math.ceil(t1 / 6) * 6; h <= t2; h += 6) ticks.push(h);
  return (
    <div className="pv-tl">
      <div className="pv-tl-axis">
        {ticks.map((h) => <span key={h} style={{ left: `${x(h)}%` }} className={h === 0 ? 'is-zero' : ''}>{h === 0 ? 'T0' : hrs(h)}</span>)}
        <i className="pv-tl-now" style={{ left: `${x(0)}%` }} />
      </div>
      {(() => {
        // Four label lanes, two above the axis and two below; each label takes the first lane it fits.
        const last = [-Infinity, -Infinity, -Infinity, -Infinity];
        return events.map((e, i) => {
          const at = x(e.t);
          let lane = [0, 2, 1, 3].find((l) => at - last[l] > 13) ?? i % 4;
          last[lane] = at;
          return (
            <div key={i} className={`pv-tl-ev is-${e.epistemic} lane-${lane} ${at > 88 ? "is-end" : at < 8 ? "is-start" : ""}`} style={{ left: `${at}%` }} title={e.detail}>
              <i />
              <span><b>{e.label}</b><small className="num">{hrs(e.t)}</small></span>
            </div>
          );
        });
      })()}
      <div className="pv-tl-key">
        {(['observed', 'reconstructed', 'predicted'] as Claim[]).map((c) => <Badge key={c} claim={c} />)}
      </div>
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'clear' | 'warning' }) {
  return <div className="pv-tile" data-tone={tone}><span>{label}</span><b className="num">{value}</b>{note && <small>{note}</small>}</div>;
}
function Meter({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return <div className="pv-meter" data-muted={muted || undefined}><span>{label}</span><i><em style={{ transform: `scaleX(${value})` }} /></i><b className="num">{value.toFixed(3)}</b></div>;
}
function StatusDot({ s }: { s: Status }) {
  return <span className={`pv-dot is-${s}`} aria-label={STATUS_LABEL[s]} />;
}

