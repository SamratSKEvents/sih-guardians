/**
 * Dashboard: the catalogue as analysis.
 *
 * The Spills composition: a rail on the left, here navigating three views
 * (catalogue, suspect vessels, investigations), and a scrolling page of
 * figures and charts beside it. The catalogue view is computed from
 * public/data/catalog/rows.json (tools/dashboard-stats.mjs) under a row of
 * filters above its charts; the vessel view from public/data/slick-vessels.json.
 *
 * Charts are plain HTML/CSS bars: one measure per category, so one hue
 * (the slick orange), except verification, which is status and carries its
 * status colours with labels and a legend. Every mark has a hover readout.
 */

import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { FolderSearch, Layers, RotateCcw, Ship } from 'lucide-react';
import { Badge, DateRangeRow, RangeSlider, type Status } from '../design/components';
import { DEMO_SLICKS } from '../api/slicks';
import { seaName } from '../seas';
import { investigate } from './tabs';
import './filterRail.css';
import './dashboard.css';

/* ------------------------------------------------------------------ data */

interface RowData {
  kinds: string[];
  kind: number[];
  ver: number[];
  day: (string | null)[];
  km2: number[];
  lon: number[];
  lat: number[];
  p: (number | null)[];
  inv: number[];
  /** 72×36 cells of 5°, '1' = land (tools/dashboard-stats.mjs). */
  land: string;
}
interface Stats { aisVessels: number; forecasts: number; bundles: number }

const KIND_LABEL: Record<string, string> = { EDGE: 'Edge segmenter', CERULEAN: 'Cerulean (SkyTruth)', CLEANSEANET: 'CleanSeaNet (EMSA)', RECONSTRUCTION: 'Reconstruction' };
/* Status order chosen so green never sits beside yellow (validated for colour-blind separation). */
const VER = [
  { label: 'Second model agrees', token: 'clear', status: 'clear' as Status },
  { label: 'Independent catalogue', token: 'watch', status: 'watch' as Status },
  { label: 'No second opinion', token: 'inactive', status: 'inactive' as Status },
  { label: 'Look-alike flagged', token: 'warning', status: 'warning' as Status },
];

function useData() {
  const [rows, setRows] = useState<RowData>();
  const [stats, setStats] = useState<Stats>();
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/catalog/rows.json`).then((r) => r.json()).then(setRows).catch(() => undefined);
    fetch(`${import.meta.env.BASE_URL}data/catalog/stats.json`).then((r) => r.json()).then(setStats).catch(() => undefined);
  }, []);
  // Sea names once per load, not per filter change.
  const seas = useMemo(() => rows?.lon.map((x, i) => seaName([x, rows.lat[i]]) ?? 'Open sea'), [rows]);
  return { rows, stats, seas };
}

/* --------------------------------------------------------------- filters */

interface Filters {
  dates: [string, string];
  area: [number, number];
  datedOnly: boolean;
  investigatedOnly: boolean;
  kinds: Record<number, boolean>;
  ver: Record<number, boolean>;
}
const INITIAL: Filters = { dates: ['', ''], area: [0, 100], datedOnly: false, investigatedOnly: false, kinds: {}, ver: {} };
const on = (r: Record<number, boolean>, i: number) => r[i] ?? true;

function activeCount(f: Filters) {
  return (
    Number(Boolean(f.dates[0] || f.dates[1])) + Number(f.area[0] > 0 || f.area[1] < 100) + Number(f.datedOnly) + Number(f.investigatedOnly) +
    Number(Object.values(f.kinds).some((v) => !v)) + Number(Object.values(f.ver).some((v) => !v))
  );
}

/* --------------------------------------------------------------- tooltip */

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; text: ReactNode }>();
  const bind = (text: ReactNode) => ({
    onMouseMove: (e: MouseEvent) => setTip({ x: e.clientX, y: e.clientY, text }),
    onMouseLeave: () => setTip(undefined),
  });
  const node = tip && <div className="db-tip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>;
  return { bind, node };
}
type Bind = ReturnType<typeof useTip>['bind'];

/* ---------------------------------------------------------------- charts */

const n = (v: number) => v.toLocaleString('en-US');
const km = (v: number) => (v >= 100 ? n(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toFixed(2));

/** Vertical bars over a category axis; labels every `every` bars. */
function Columns({ data, bind, every = 1, unit }: { data: { label: string; value: number; tip?: string }[]; bind: Bind; every?: number; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="db-cols-wrap">
      <span className="db-ymax num">{n(max)}</span>
      <div className="db-cols" style={{ '--count': data.length } as CSSProperties}>
        {data.map((d, i) => (
          <div key={i} className="db-col" {...bind(<><b>{d.tip ?? d.label}</b><br />{n(d.value)} {unit}</>)}>
            <span style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="db-xaxis num" style={{ '--count': data.length } as CSSProperties}>
        {data.map((d, i) => <span key={i}>{i % every === 0 ? d.label : ''}</span>)}
      </div>
    </div>
  );
}

/** Horizontal bars, label | bar | value: for named categories. */
function HBars({ data, bind, unit }: { data: { label: string; value: number; sub?: string }[]; bind: Bind; unit: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="db-rows">
      {data.map((d) => (
        <li key={d.label} {...bind(<><b>{d.label}</b><br />{n(d.value)} {unit}{d.sub ? ` · ${d.sub}` : ''}</>)}>
          <span className="db-row-label">{d.label}</span>
          <span className="db-row-bar"><span style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="db-row-value num">{n(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One 100% bar split by verification, with gaps between segments. */
function Split({ counts, bind, label }: { counts: number[]; bind: Bind; label: string }) {
  const total = counts.reduce((x, y) => x + y, 0) || 1;
  return (
    <div className="db-split" role="img" aria-label={label}>
      {counts.map((c, i) =>
        c ? (
          <span key={i} style={{ flexGrow: c, background: `var(--${VER[i].token})` }}
            {...bind(<><b>{VER[i].label}</b><br />{n(c)} · {((c / total) * 100).toFixed(1)}%</>)} />
        ) : null,
      )}
    </div>
  );
}

function Card({ title, note, wide, full, children }: { title: string; note?: ReactNode; wide?: boolean; full?: boolean; children: ReactNode }) {
  return (
    <section className={`db-card${wide ? ' is-wide' : ''}${full ? ' is-full' : ''}`}>
      <header>
        <h2>{title}</h2>
        {note && <span className="db-note">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ page */

const AREA_BINS: [number, number, string][] = [
  [0, 0.1, '<0.1'], [0.1, 0.5, '0.1–0.5'], [0.5, 1, '0.5–1'], [1, 5, '1–5'], [5, 10, '5–10'], [10, 50, '10–50'], [50, Infinity, '50+'],
];
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const verOf = (p: Record<string, unknown>) => (p.lookalikeWarning ? 3 : p.verifier === 'MULTI_MODEL_SUPPORTED' ? 0 : 2);

/* ---------------------------------------------------------------- vessels */

interface Suspect {
  slickId: string;
  vessel: {
    name: string; type: string; kind: string; flag: string; mmsi: string; rank: number; score: number;
    gaps: [number, number][]; parts?: { proximity: number; temporality: number; parity: number };
  };
}
/** The one incident whose suspects come from a real AIS feed; the rest are the investigation's modelled traffic. */
const REAL_AIS = 'edge:oil_04471';

function useSuspects(want: boolean) {
  const [list, setList] = useState<Suspect[]>();
  useEffect(() => {
    if (!want || list) return;
    fetch(`${import.meta.env.BASE_URL}data/slick-vessels.json`).then((r) => r.json()).then(setList).catch(() => setList([]));
  }, [want, list]);
  return list;
}

const tally = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const t of items) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1]);
};

function VesselsView({ list, bind }: { list: Suspect[]; bind: Bind }) {
  const gapH = (s: Suspect) => s.vessel.gaps.reduce((h, [a, b]) => h + (b - a), 0);
  const silent = list.filter((s) => s.vessel.gaps.length);
  const tankers = list.filter((s) => s.vessel.kind === 'tanker' || s.vessel.kind === 'gas');
  const leads = list.filter((s) => s.vessel.rank === 1);
  const avg = (k: 'proximity' | 'temporality' | 'parity') =>
    leads.reduce((a, s) => a + (s.vessel.parts?.[k] ?? 0), 0) / Math.max(1, leads.length);
  const scoreBins = Array.from({ length: 10 }, (_, i) => list.filter((s) => Math.min(9, Math.floor(s.vessel.score * 10)) === i).length);
  const gapBins: [number, number, string][] = [[0, 1, '<1 h'], [1, 2, '1–2 h'], [2, 3, '2–3 h'], [3, 6, '3–6 h'], [6, Infinity, '6+ h']];
  return (
    <>
      <dl className="db-kpis">
        <div><dt>Suspect vessels</dt><dd className="num">{n(list.length)}</dd><small>top 5 for each of 20 slicks</small></div>
        <div><dt>Tankers &amp; gas carriers</dt><dd className="num">{n(tankers.length)}</dd><small>{Math.round((tankers.length / Math.max(1, list.length)) * 100)}% of suspects</small></div>
        <div><dt>AIS went silent</dt><dd className="num">{n(silent.length)}</dd><small>{km(silent.reduce((h, s) => h + gapH(s), 0))} h of silence in total</small></div>
        <div><dt>Flags</dt><dd className="num">{tally(list, (s) => s.vessel.flag).length}</dd><small>states of registry</small></div>
        <div><dt>Lead suspect score</dt><dd className="num">{(leads.reduce((a, s) => a + s.vessel.score, 0) / Math.max(1, leads.length)).toFixed(2)}</dd><small>mean over {leads.length} slicks</small></div>
        <div><dt>From real AIS</dt><dd className="num">{list.filter((s) => s.slickId === REAL_AIS).length}</dd><small>Gulf of Kutch feed; rest modelled</small></div>
      </dl>
      <div className="db-grid">
        <Card title="Vessel type" note="suspects by type">
          <HBars data={tally(list, (s) => s.vessel.type).map(([label, value]) => ({ label, value }))} bind={bind} unit="vessels" />
        </Card>
        <Card title="Flag state" note="suspects by registry">
          <HBars data={tally(list, (s) => s.vessel.flag).map(([label, value]) => ({ label, value }))} bind={bind} unit="vessels" />
        </Card>
        <Card title="What drives the lead suspect" note="mean score part, rank 1">
          <HBars data={[
            { label: 'Proximity', value: Math.round(avg('proximity') * 100) },
            { label: 'Timing', value: Math.round(avg('temporality') * 100) },
            { label: 'Vessel profile', value: Math.round(avg('parity') * 100) },
          ]} bind={bind} unit="/ 100" />
          <p className="db-foot">Proximity: how close the track came to where the oil was traced back to. Timing: whether it was there when the oil was released. Profile: whether the vessel type fits the discharge.</p>
        </Card>
        <Card wide title="Attribution score" note="all suspects">
          <Columns data={scoreBins.map((v, i) => ({ label: (i / 10).toFixed(1), value: v, tip: `score ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}` }))} bind={bind} every={2} unit="vessels" />
        </Card>
        <Card title="Length of AIS silence" note={`${silent.length} vessels`}>
          <Columns data={gapBins.map(([lo, hi, label]) => ({ label, value: silent.filter((s) => gapH(s) >= lo && gapH(s) < hi).length }))} bind={bind} unit="vessels" />
          <p className="db-foot">A gap is a question for the operator, not evidence of discharge.</p>
        </Card>
        <Card full title="Lead suspect per slick" note="open one for the full case">
          <table className="db-table is-click">
            <thead><tr><th>Slick</th><th>Vessel</th><th>Type</th><th>Flag</th><th>AIS</th><th className="is-num">Silent h</th><th className="is-num">Score</th></tr></thead>
            <tbody>
              {[...leads].sort((x, y) => y.vessel.score - x.vessel.score).map((s) => (
                <tr key={s.slickId} onClick={() => investigate(s.slickId)}>
                  <td className="mono">{s.slickId}</td>
                  <td>{s.vessel.name}<small className="num">MMSI {s.vessel.mmsi}</small></td>
                  <td>{s.vessel.type}</td>
                  <td>{s.vessel.flag}</td>
                  <td>{s.slickId === REAL_AIS ? <Badge status="clear">Real feed</Badge> : <Badge status="inactive">Modelled</Badge>}</td>
                  <td className="is-num num">{s.vessel.gaps.length ? km(gapH(s)) : '—'}</td>
                  <td className="is-num num">{s.vessel.score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ page */

type View = 'catalogue' | 'vessels' | 'cases';

export function DashboardSurface() {
  const { rows, stats, seas } = useData();
  const [view, setView] = useState<View>('catalogue');
  const [f, setF] = useState<Filters>(INITIAL);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF({ ...f, [key]: value });
  const { bind, node: tip } = useTip();
  const suspects = useSuspects(view === 'vessels' || view === 'cases');

  const days = useMemo(() => (rows ? rows.day.filter((d): d is string => Boolean(d)).sort() : []), [rows]);
  const minDay = days[0] ?? '';
  const maxDay = days.at(-1) ?? '';

  // Indices of the rows that pass every filter.
  const idx = useMemo(() => {
    if (!rows) return [];
    const [from, to] = f.dates;
    const out: number[] = [];
    for (let i = 0; i < rows.kind.length; i++) {
      const d = rows.day[i];
      if ((from || to || f.datedOnly) && !d) continue;
      if (from && d! < from) continue;
      if (to && d! > to) continue;
      const area = rows.km2[i];
      if (area < f.area[0] || (f.area[1] < 100 && area > f.area[1])) continue;
      if (f.investigatedOnly && !rows.inv[i]) continue;
      if (!on(f.kinds, rows.kind[i]) || !on(f.ver, rows.ver[i])) continue;
      out.push(i);
    }
    return out;
  }, [rows, f]);

  const a = useMemo(() => {
    if (!rows || !seas) return undefined;
    const ver = [0, 0, 0, 0];
    const kinds = rows.kinds.map(() => [0, 0, 0, 0]);
    const bySea = new Map<string, { count: number; km2: number }>();
    const areaBins = AREA_BINS.map(() => 0);
    const pBins = Array.from({ length: 10 }, () => 0);
    const months = new Map<string, number>();
    const grid = new Map<number, number>();
    const cells = new Map<string, { count: number; km2: number; lon: number; lat: number; seas: Map<string, number> }>();
    const areas: number[] = [];
    let km2 = 0, dated = 0;
    for (const i of idx) {
      const area = rows.km2[i];
      ver[rows.ver[i]]++;
      kinds[rows.kind[i]][rows.ver[i]]++;
      const s = bySea.get(seas[i]) ?? { count: 0, km2: 0 };
      s.count++; s.km2 += area; bySea.set(seas[i], s);
      areaBins[AREA_BINS.findIndex(([lo, hi]) => area >= lo && area < hi)]++;
      const p = rows.p[i];
      if (p != null) pBins[Math.min(9, Math.floor(p * 10))]++;
      const d = rows.day[i];
      if (d) { dated++; months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + 1); }
      const g = Math.min(35, Math.floor((90 - rows.lat[i]) / 5)) * 72 + Math.min(71, Math.floor((rows.lon[i] + 180) / 5));
      grid.set(g, (grid.get(g) ?? 0) + 1);
      const cx = Math.floor(rows.lon[i] / 5) * 5, cy = Math.floor(rows.lat[i] / 5) * 5;
      const c = cells.get(`${cx},${cy}`) ?? { count: 0, km2: 0, lon: cx + 2.5, lat: cy + 2.5, seas: new Map() };
      c.count++; c.km2 += area; c.seas.set(seas[i], (c.seas.get(seas[i]) ?? 0) + 1); cells.set(`${cx},${cy}`, c);
      areas.push(area);
      km2 += area;
    }
    areas.sort((x, y) => x - y);
    // Every month between the first and last dated record, zeros included.
    const keys = [...months.keys()].sort();
    const series: { label: string; value: number; tip: string }[] = [];
    if (keys.length) {
      let [y, m] = keys[0].split('-').map(Number);
      const [ly, lm] = keys[keys.length - 1].split('-').map(Number);
      while (y < ly || (y === ly && m <= lm)) {
        const k = `${y}-${String(m).padStart(2, '0')}`;
        const label = MONTH.format(new Date(`${k}-01T00:00:00Z`));
        series.push({ label, value: months.get(k) ?? 0, tip: label });
        if (++m > 12) { m = 1; y++; }
      }
    }
    return {
      total: idx.length, km2, dated, ver, kinds,
      median: areas.length ? areas[Math.floor(areas.length / 2)] : 0,
      largest: areas.length ? areas[areas.length - 1] : 0,
      seas: [...bySea].sort((x, y) => y[1].count - x[1].count).slice(0, 10),
      areaBins, pBins, series, grid,
      gridMax: Math.max(1, ...grid.values()),
      // Named by the sea most of its slicks are in, not by its centre, which can fall on land or the wrong basin.
      hotspots: [...cells.values()].sort((x, y) => y.count - x.count).slice(0, 8)
        .map((c) => ({ ...c, name: [...c.seas].sort((x, y) => y[1] - x[1])[0][0] })),
    };
  }, [rows, seas, idx]);

  const cases = useMemo(() => [...DEMO_SLICKS].sort((x, y) => Number(y.properties.areaM2) - Number(x.properties.areaM2)), []);
  const active = activeCount(f);
  const opinion = a ? a.ver[0] + a.ver[3] : 0;

  const NAV: { id: View; label: string; note: string; count?: number; icon: typeof Layers }[] = [
    { id: 'catalogue', label: 'Catalogue', note: 'Every detection: when, where, how big, how sure', count: rows?.kind.length, icon: Layers },
    { id: 'vessels', label: 'Suspect vessels', note: 'Who was there: types, flags, scores, AIS silence', count: suspects?.length ?? 100, icon: Ship },
    { id: 'cases', label: 'Investigations', note: 'The 20 slicks with a full case behind them', count: DEMO_SLICKS.length, icon: FolderSearch },
  ];
  const current = NAV.find((x) => x.id === view)!;

  return (
    <div className="db">
      <aside className="fr db-nav" aria-label="Analysis views">
        <header className="fr-head"><h2>Analysis</h2></header>
        <nav className="fr-body">
          {NAV.map(({ id, label, note, count, icon: Icon }) => (
            <button key={id} type="button" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
              <Icon size={17} />
              <span><b>{label}</b><small>{note}</small></span>
              {count !== undefined && <i className="num">{n(count)}</i>}
            </button>
          ))}
        </nav>
      </aside>

      <main className="db-main">
        <header className="db-head">
          <div>
            <h1>{current.label}</h1>
            <p>
              {view === 'catalogue'
                ? a && rows ? <><b className="num">{n(a.total)}</b> of {n(rows.kind.length)} slicks match the filters</> : 'Loading the catalogue…'
                : current.note}
            </p>
          </div>
          {view === 'catalogue' && active > 0 && (
            <button type="button" className="db-reset" onClick={() => setF(INITIAL)}><RotateCcw size={14} />Reset filters</button>
          )}
        </header>

        {view === 'catalogue' && (
          <div className="db-filters" role="group" aria-label="Filters">
            {minDay && (
              <div className="db-f-dates">
                <DateRangeRow from={f.dates[0] || minDay} to={f.dates[1] || maxDay} min={minDay} max={maxDay}
                  onChange={([from, to]) => set('dates', [from === minDay ? '' : from, to === maxDay ? '' : to])} />
              </div>
            )}
            <div className="db-f-area">
              <RangeSlider label="Area" min={0} max={100} step={5} value={f.area} onChange={(v) => set('area', v)} ticks={[0, 50, 100]} openTop unit="km²" />
            </div>
            <div className="db-f-group">
              <span>Verification</span>
              {VER.map((v, i) => (
                <button key={v.label} type="button" className="db-chip" aria-pressed={on(f.ver, i)} onClick={() => set('ver', { ...f.ver, [i]: !on(f.ver, i) })}>
                  <i style={{ background: `var(--${v.token})` }} />{v.label}
                </button>
              ))}
            </div>
            <div className="db-f-group">
              <button type="button" className="db-chip" aria-pressed={f.datedOnly} onClick={() => set('datedOnly', !f.datedOnly)}>Dated only</button>
              <button type="button" className="db-chip" aria-pressed={f.investigatedOnly} onClick={() => set('investigatedOnly', !f.investigatedOnly)}>Investigated only</button>
            </div>
          </div>
        )}

        {view === 'catalogue' && a && rows && (
          <>
            <dl className="db-kpis">
              <div><dt>Slicks</dt><dd className="num">{n(a.total)}</dd><small>{n(a.dated)} with a date</small></div>
              <div><dt>Area mapped</dt><dd className="num">{n(Math.round(a.km2))}<i> km²</i></dd><small>total footprint</small></div>
              <div><dt>Median slick</dt><dd className="num">{km(a.median)}<i> km²</i></dd><small>largest {km(a.largest)} km²</small></div>
              <div><dt>Second model agrees</dt><dd className="num">{opinion ? Math.round((a.ver[0] / opinion) * 100) : 0}<i>%</i></dd><small>of {n(opinion)} with an opinion</small></div>
              <div><dt>Look-alikes</dt><dd className="num">{n(a.ver[3])}</dd><small>to review by hand</small></div>
              <div><dt>Investigated</dt><dd className="num">{DEMO_SLICKS.length}</dd><small>{stats ? `${n(stats.aisVessels)} AIS vessels screened` : 'full cases'}</small></div>
            </dl>

            <div className="db-grid">
              <Card wide title="Detections per month" note={`${n(a.dated)} dated records`}>
                {a.series.length > 1
                  ? <Columns data={a.series} bind={bind} every={Math.ceil(a.series.length / 12)} unit="slicks" />
                  : <p className="db-empty">No dated records under these filters.</p>}
              </Card>

              <Card title="Verification" note="second-model opinion">
                <Split counts={a.ver} bind={bind} label="Verification mix of the filtered slicks" />
                <ul className="db-legend">
                  {VER.map((v, i) => (
                    <li key={v.label}><span style={{ background: `var(--${v.token})` }} />{v.label}<b className="num">{n(a.ver[i])}</b></li>
                  ))}
                </ul>
                <h3 className="db-sub">By detector</h3>
                {rows.kinds.map((k, i) => {
                  const total = a.kinds[i].reduce((x, y) => x + y, 0);
                  return total ? (
                    <div key={k} className="db-bykind">
                      <span>{KIND_LABEL[k] ?? k}<b className="num">{n(total)}</b></span>
                      <Split counts={a.kinds[i]} bind={bind} label={`Verification for ${k}`} />
                    </div>
                  ) : null;
                })}
              </Card>

              <Card title="Where they are" note="top seas by count">
                <HBars data={a.seas.map(([name, s]) => ({ label: name, value: s.count, sub: `${km(s.km2)} km²` }))} bind={bind} unit="slicks" />
              </Card>

              <Card title="Slick size" note="count by footprint, km²">
                <Columns data={AREA_BINS.map(([, , label], i) => ({ label, value: a.areaBins[i], tip: `${label} km²` }))} bind={bind} unit="slicks" />
              </Card>

              <Card title="Detection confidence" note="model probability">
                <Columns data={a.pBins.map((v, i) => ({ label: (i / 10).toFixed(1), value: v, tip: `p ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}` }))} bind={bind} every={2} unit="slicks" />
              </Card>

              <Card wide title="Density" note="slicks per 5° cell">
                <div className="db-density" role="img" aria-label="World grid of slick counts per 5 degree cell">
                  {Array.from({ length: 36 * 72 }, (_, g) => {
                    const c = a.grid.get(g);
                    if (!c) return <span key={g} className={rows.land[g] === '1' ? 'is-land' : undefined} />;
                    const lat = 90 - Math.floor(g / 72) * 5 - 2.5, lon = (g % 72) * 5 - 180 + 2.5;
                    return <span key={g} className="is-on" style={{ opacity: 0.25 + 0.75 * (Math.log1p(c) / Math.log1p(a.gridMax)) }}
                      {...bind(<><b>{seaName([lon, lat]) ?? 'Open sea'}</b><br />{n(c)} slicks · {lat.toFixed(1)}°, {lon.toFixed(1)}°</>)} />;
                  })}
                </div>
                <p className="db-scale"><span>fewer</span><i /><span>more (log scale)</span></p>
              </Card>

              <Card title="Hotspots" note="5° cells">
                <table className="db-table">
                  <thead><tr><th>Area</th><th className="is-num">Slicks</th><th className="is-num">km²</th></tr></thead>
                  <tbody>
                    {a.hotspots.map((h) => (
                      <tr key={`${h.lon},${h.lat}`}>
                        <td>{h.name}<small className="num">{h.lat.toFixed(1)}°, {h.lon.toFixed(1)}°</small></td>
                        <td className="is-num num">{n(h.count)}</td>
                        <td className="is-num num">{km(h.km2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </>
        )}

        {view === 'vessels' && (suspects ? <VesselsView list={suspects} bind={bind} /> : <p className="db-empty">Loading suspects…</p>)}

        {view === 'cases' && (
          <>
            <dl className="db-kpis">
              <div><dt>Cases</dt><dd className="num">{cases.length}</dd><small>slicks with a full investigation</small></div>
              <div><dt>Area</dt><dd className="num">{km(cases.reduce((s, c) => s + Number(c.properties.areaM2) / 1e6, 0))}<i> km²</i></dd><small>combined footprint</small></div>
              <div><dt>Verified</dt><dd className="num">{cases.filter((c) => verOf(c.properties) === 0).length}</dd><small>second model agrees</small></div>
              <div><dt>Look-alikes</dt><dd className="num">{cases.filter((c) => verOf(c.properties) === 3).length}</dd><small>flagged for review</small></div>
              <div><dt>Full data bundle</dt><dd className="num">1</dd><small>AIS, drift, shore impact, response</small></div>
              <div><dt>Suspects ranked</dt><dd className="num">{suspects?.length ?? '—'}</dd><small>across all cases</small></div>
            </dl>
            <div className="db-grid">
              <Card wide title="Cases by week" note="observation date">
                <Columns bind={bind} unit="cases" data={(() => {
                  const t = cases.map((c) => Date.parse(c.properties.observedAt));
                  const w0 = Math.min(...t), W = 7 * 86_400_000;
                  const weeks = Array.from({ length: Math.floor((Math.max(...t) - w0) / W) + 1 }, (_, k) => ({
                    label: DAY.format(w0 + k * W).replace(/ \d{4}$/, ''), value: 0, tip: `Week of ${DAY.format(w0 + k * W)}`,
                  }));
                  for (const x of t) weeks[Math.floor((x - w0) / W)].value++;
                  return weeks;
                })()} every={2} />
              </Card>
              <Card title="Where" note="cases by sea">
                <HBars data={tally(cases, (c) => seaName(c.properties.centroid) ?? 'Open sea').map(([label, value]) => ({ label, value }))} bind={bind} unit="cases" />
                <h3 className="db-sub">Verification</h3>
                <Split counts={[0, 1, 2, 3].map((v) => cases.filter((c) => verOf(c.properties) === v).length)} bind={bind} label="Verification of the 20 cases" />
                <ul className="db-legend">
                  {VER.map((v, i) => {
                    const c = cases.filter((x) => verOf(x.properties) === i).length;
                    return c ? <li key={v.label}><span style={{ background: `var(--${v.token})` }} />{v.label}<b className="num">{c}</b></li> : null;
                  })}
                </ul>
              </Card>
              <Card full title="All cases" note="open one for the full case">
                <table className="db-table is-click">
                  <thead><tr><th>Slick</th><th>Sea</th><th>Seen</th><th>Verification</th><th>Lead suspect</th><th className="is-num">Probability</th><th className="is-num">Area km²</th></tr></thead>
                  <tbody>
                    {cases.map((s) => {
                      const p = s.properties;
                      const v = VER[verOf(p)];
                      const lead = suspects?.find((x) => x.slickId === s.id && x.vessel.rank === 1);
                      return (
                        <tr key={s.id} onClick={() => investigate(s.id)}>
                          <td className="mono">{s.id}</td>
                          <td>{seaName(p.centroid) ?? 'Open sea'}</td>
                          <td className="num">{DAY.format(Date.parse(p.observedAt))}</td>
                          <td><Badge status={v.status}>{v.label}</Badge></td>
                          <td>{lead ? <>{lead.vessel.name}<small className="num">score {lead.vessel.score.toFixed(2)}</small></> : '—'}</td>
                          <td className="is-num num">{typeof p.probability === 'number' ? p.probability.toFixed(2) : '—'}</td>
                          <td className="is-num num">{(Number(p.areaM2) / 1e6).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>
          </>
        )}
      </main>
      {tip}
    </div>
  );
}
