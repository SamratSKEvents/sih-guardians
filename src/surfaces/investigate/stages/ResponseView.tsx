/**
 * Response: the map layers, timeline events and panes for the plan in
 * `responsePlan.ts`. Rendered inside the Forecast page's frame, so the map,
 * the live oil and the clock are the same ones the forecast uses.
 */

import { useEffect, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle, BarChart3, Bell, Check, CheckCircle2, ChevronRight, Clock, ClipboardList, Crosshair, FileText, FlaskConical, Gauge, Link2, MapPin,
  Plane, Send, Shield, ShieldCheck, Ship, Target, Waves, Wind, Zap,
} from 'lucide-react';
import { Badge } from '../../../design/components';
import { when } from '../../../format';
import type { Forcing } from '../../../forecast/forcing';
import type { ResponsePanel } from '../Workspace';
import type { ProductContext } from '../../../products/generate';
import { alongRoute, assetAt, assetStatus, EMPTY_STATE, type Asset, type Plan, type PlanState } from './responsePlan';
import { kmBetween, type Pt } from './mapData';

const ll = ([lon, lat]: Pt): L.LatLngTuple => [lat, lon];
const f1 = (v: number) => v.toFixed(1);
const signed = (h: number) => `${h < 0 ? '−' : '+'}${Math.abs(h).toFixed(1)} h`;
const clockAt = (t0: number, h: number) => `${when.format(t0 + h * 3_600_000)} UTC`;

/* ================================================================ state */

/** The operator's actions on this slick's plan, kept in the browser. */
export function usePlanState(slickId: string): [PlanState, (fn: (s: PlanState) => PlanState) => void] {
  const key = `guardians.response.${slickId}`;
  const read = (): PlanState => { try { return { ...EMPTY_STATE, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return EMPTY_STATE; } };
  const [state, setState] = useState<PlanState>(read);
  useEffect(() => setState(read()), [key]);
  const update = (fn: (s: PlanState) => PlanState) => setState((s) => {
    const next = fn(s);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window: keep in memory */ }
    return next;
  });
  return [state, update];
}

/* ================================================================== map */

export type ResponseLayer = 'booms' | 'assets' | 'staging' | 'missions' | 'stations' | 'zones' | 'alerts';
export const RESPONSE_LAYER_LABEL: Record<ResponseLayer, string> = {
  booms: 'Containment booms', assets: 'Response assets', staging: 'Staging points', missions: 'Surveillance missions', stations: 'Sampling stations', zones: 'Cleanup zones', alerts: 'Alert markers',
};
// One idea per page: the slick, the live oil, and that page's own layer. The rest is in Layers.
export const RESPONSE_DEFAULTS: Record<ResponsePanel, string[]> = {
  overview: ['live', 'observed', 'booms', 'alerts'],
  containment: ['live', 'observed', 'booms'],
  assets: ['live', 'observed', 'assets', 'staging'],
  surveillance: ['live', 'observed', 'missions'],
  cleanup: ['live', 'observed', 'zones', 'staging'],
  sampling: ['live', 'observed', 'stations'],
  alerts: ['live', 'observed', 'alerts'],
};

const COLOUR: Record<string, string> = { 'on scene': '#35c46a', 'en route': '#35c46a', standby: '#9aa7b3', unavailable: '#e3464d' };
const HULL = 'M0,-14 C3.6,-10 5,-6 5,-1 L5,12 Q5,14 3,14 L-3,14 Q-5,14 -5,12 L-5,-1 C-5,-6 -3.6,-10 0,-14 Z';
const PLANE = 'M0,-13 L2,-4 L12,1 L12,3.5 L2,1 L1.5,9 L5,11.5 L5,13 L0,12 L-5,13 L-5,11.5 L-1.5,9 L-2,1 L-12,3.5 L-12,1 L-2,-4 Z';
const DRONE = 'M-9,-9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M9,-9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M-9,9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M9,9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M-3,-3 h6 v6 h-6 Z M-7,-7 L7,7 M7,-7 L-7,7';
const bearing = ([x1, y1]: Pt, [x2, y2]: Pt) => (Math.atan2((x2 - x1) * Math.cos((y1 * Math.PI) / 180), y2 - y1) * 180) / Math.PI;
const icon = (path: string, colour: string, deg: number, size = 26, stroke = false) => L.divIcon({
  className: 'rs-icon',
  html: `<svg viewBox="-15 -15 30 30" width="${size}" height="${size}" style="transform:rotate(${deg}deg)"><path d="${path}" fill="${stroke ? 'none' : colour}" stroke="${stroke ? colour : '#0b0f14'}" stroke-width="${stroke ? 1.6 : 1.2}"/></svg>`,
  iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});
const chip = (text: string, cls = '') => L.divIcon({ className: 'dm-chip-anchor', html: `<span class="dm-chip rs-chip ${cls}">${text}</span>`, iconSize: [0, 0] });

/** What each page is about, to frame the map on when the page opens. */
export function focusOf(plan: Plan, page: ResponsePanel, centre: Pt): Pt[] {
  const pts: Pt[] = [centre];
  if (page === 'containment' || page === 'overview') pts.push(...plan.boomA.line, ...(page === 'containment' ? plan.boomB.line : []));
  if (page === 'assets') pts.push(...plan.assets.flatMap((a) => [a.home, a.target]));
  if (page === 'surveillance') pts.push(...plan.missions.flatMap((m) => m.box));
  if (page === 'cleanup') pts.push(...plan.zones.flatMap((z) => z.pts), ...plan.staging.map((x) => x.at));
  if (page === 'sampling') pts.push(...plan.samplingRoute);
  if (page === 'alerts') pts.push(...plan.alerts.filter((a) => a.where).map((a) => a.where!));
  return pts;
}

export function drawResponse(g: L.LayerGroup, plan: Plan, shown: Set<string>, t: number, state: PlanState, page: ResponsePanel, onPick: (id: string) => void) {
  if (shown.has('booms')) for (const b of plan.booms.filter((x) => page === 'containment' || x.recommended)) {
    const good = b.recommended;
    L.polyline(b.line.map(ll), { color: '#0b0f14', weight: 7, opacity: 0.7, interactive: false }).addTo(g);
    L.polyline(b.line.map(ll), { color: good ? '#35c46a' : '#e3464d', weight: 3.5, dashArray: good ? '8 5' : '6 6', interactive: false }).addTo(g);
    for (const p of [b.line[0], b.line[Math.floor(b.line.length / 2)], b.line[b.line.length - 1]]) L.circleMarker(ll(p), { radius: 4, color: '#fff', weight: 1.5, fillColor: good ? '#35c46a' : '#e3464d', fillOpacity: 1, interactive: false }).addTo(g);
    if (page === 'containment' || (page === 'overview' && good)) L.marker(ll(b.line[0]), { icon: chip(`${good ? '✓' : '✕'} Candidate Boom ${b.id} · ${good ? 'Recommended' : 'Not recommended'} · ${f1(b.lengthKm)} km`, good ? 'is-good' : 'is-bad'), interactive: false }).addTo(g);
  }
  if (shown.has('staging')) for (const s of plan.staging) {
    L.circleMarker(ll(s.at), { radius: 7, color: '#fff', weight: 2.5, fillColor: '#2f6fc4', fillOpacity: 1, interactive: false }).addTo(g);
    if (page === 'assets' || page === 'cleanup') L.marker(ll(s.at), { icon: chip(`⚓ ${s.name}`), interactive: false }).addTo(g);
  }
  if (shown.has('zones')) for (const z of plan.zones) {
    const col = z.priority === 'Immediate' ? '#e3464d' : z.priority === 'High' ? '#ff7a3d' : z.priority === 'Moderate' ? '#f5c542' : '#9aa7b3';
    for (const p of z.pts) L.circleMarker(ll(p), { radius: 4.5, stroke: false, fillColor: col, fillOpacity: 0.95, interactive: false }).addTo(g);
    if (page === 'cleanup') L.marker(ll(z.pts[Math.floor(z.pts.length / 2)]), { icon: chip(`${z.id} · ${z.shore} (${z.priority})`, `is-${z.priority.toLowerCase()}`), interactive: false }).addTo(g);
  }
  if (shown.has('missions')) for (const m of plan.missions) {
    const active = t >= m.start && t <= m.end;
    L.polygon(m.box.map(ll), { color: '#4dd6d6', weight: 1.6, dashArray: '6 5', fillColor: '#4dd6d6', fillOpacity: active ? 0.2 : 0.08, interactive: false }).addTo(g);
    L.polyline(m.route.map(ll), { color: '#4dd6d6', weight: 1.4, dashArray: '3 5', opacity: 0.9, interactive: false }).addTo(g);
    for (const p of m.route.filter((_, k) => k % 2 === 0)) L.circleMarker(ll(p), { radius: 3, color: '#4dd6d6', weight: 1.5, fillColor: '#0b0f14', fillOpacity: 1, interactive: false }).addTo(g);
    const f = (t - m.start) / (m.end - m.start);
    const pos = alongRoute(m.route, f);
    const ahead = alongRoute(m.route, Math.min(1, f + 0.02));
    L.marker(ll(pos), { icon: icon(m.kind === 'plane' ? PLANE : DRONE, '#ffffff', m.kind === 'plane' ? bearing(pos, ahead) : 0, 28, m.kind === 'drone'), interactive: false }).addTo(g);
    if (page === 'surveillance') L.marker(ll(m.box[0]), { icon: chip(`${m.id} · ${m.name}${active ? ' · in flight' : t > m.end ? ' · done' : ` · from ${signed(m.start)}`}`, 'is-mission'), interactive: false }).addTo(g);
  }
  if (shown.has('stations') && page === 'sampling' && !shown.has('assets')) {
    const v = plan.assets.find((a) => a.kind === 'sampling')!;
    const pos = samplingPos(plan, t, state.assigned[v.id] !== undefined);
    L.marker(ll(pos), { icon: icon(HULL, state.assigned[v.id] !== undefined ? '#35c46a' : '#9aa7b3', 0, 26), interactive: false }).addTo(g);
    L.marker(ll(pos), { icon: chip(`${v.name}${state.assigned[v.id] !== undefined ? '' : ' (not assigned)'}`, state.assigned[v.id] !== undefined ? 'is-good' : ''), interactive: false }).addTo(g);
  }
  if (shown.has('stations')) {
    L.polyline(plan.samplingRoute.map(ll), { color: '#8be38b', weight: 2, dashArray: '6 6', interactive: false }).addTo(g);
    for (const s of plan.stations) {
      const done = t >= s.arrive;
      L.circleMarker(ll(s.at), { radius: 7, color: '#fff', weight: 2.5, fillColor: s.id === 'B-1' ? '#2f6fc4' : done ? '#35c46a' : '#0b0f14', fillOpacity: 1, interactive: false }).addTo(g);
      if (page === 'sampling') L.marker(ll(s.at), { icon: chip(`${s.id} · ${s.role}${done ? ' ✓' : ''}`), interactive: false }).addTo(g);
    }
  }
  const boomCrew = page === 'containment' && shown.has('booms');
  if (shown.has('assets') || boomCrew) for (const a of plan.assets) {
    if (!shown.has('assets') && !['boom-1', 'tug-1', 'skim-1'].includes(a.id)) continue;
    const assigned = state.assigned[a.id] !== undefined;
    if (a.kind === 'sampling' && !shown.has('stations') && page !== 'assets') continue;
    const st = assetStatus(a, t, assigned);
    const moving = a.status0 !== 'on scene' && (a.status0 !== 'standby' || assigned);
    const target = a.kind === 'sampling' ? samplingPos(plan, t, assigned) : undefined;
    const pos = target ?? assetAt(a, t);
    if (moving && a.kind !== 'sampling') L.polyline([a.home, a.target].map(ll), { color: COLOUR[st], weight: 2, dashArray: '2 7', opacity: 0.9, interactive: false }).addTo(g);
    const mk = L.marker(ll(pos), { icon: icon(HULL, COLOUR[st], bearing(a.home, a.target) || 0, 26) }).addTo(g);
    mk.on('click', () => onPick(a.id));
    const eta = st === 'en route' ? ` · ETA ${signed(a.arrive)}` : '';
    if (page === 'assets' || (page === 'containment' && (a.kind === 'boom' || a.kind === 'tug' || a.kind === 'skimmer')) || (page === 'sampling' && a.kind === 'sampling')) L.marker(ll(pos), { icon: chip(`${a.name} (${cap(st)}${eta})`, st === 'unavailable' ? 'is-bad' : st === 'standby' ? '' : 'is-good'), interactive: false }).addTo(g);
  }
  if (shown.has('alerts')) for (const al of plan.alerts) {
    if (!al.where || state.resolved.includes(al.id) || al.resolvedByDefault) continue;
    L.marker(ll(al.where), { icon: L.divIcon({ className: 'rs-alert-pin', html: `<span class="is-${al.severity.toLowerCase()}">!</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false }).addTo(g);
    if (page === 'alerts') L.marker(ll(al.where), { icon: chip(al.title, al.severity === 'High' ? 'is-bad' : ''), interactive: false }).addTo(g);
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function samplingPos(plan: Plan, t: number, assigned: boolean): Pt {
  if (!assigned) return plan.samplingRoute[0];
  return alongRoute(plan.samplingRoute, (t - plan.sampling.start) / Math.max(0.1, plan.sampling.end - plan.sampling.start));
}

/* =============================================================== events */

type Tone = 'observed' | 'predicted' | 'reconstructed' | 'critical' | 'warning';
export function responseEvents(plan: Plan, state: PlanState) {
  const out: { h: number; label: string; detail: string; tone: Tone; to?: number; quiet?: boolean; primary?: boolean }[] = [];
  out.push({ h: Math.min(24, plan.windowH), label: 'Response window closes', detail: 'Deploy containment before this', tone: 'critical' });
  if (plan.boomA.readyH > 0 && plan.boomA.readyH < 24) out.push({ h: plan.boomA.readyH, label: 'Boom A ready', detail: plan.boomA.vessel ?? '', tone: 'predicted' });
  out.push({ h: plan.boomA.atH, label: 'Oil at Boom A', detail: 'Forecast oil reaches the boom line', tone: 'warning', quiet: true });
  for (const a of plan.assets) {
    const assigned = state.assigned[a.id] !== undefined;
    if (a.arrive > 0 && a.arrive < 24 && (a.status0 === 'en route' || assigned) && a.kind !== 'boom' && a.kind !== 'tug') out.push({ h: a.arrive, label: `${a.name.split(' ').slice(-1)[0]} on scene`, detail: a.task, tone: 'predicted', quiet: true });
  }
  for (const m of plan.missions) out.push({ h: m.start, to: m.end, label: m.id, detail: m.name, tone: 'observed', quiet: m.id !== 'SURV-001' });
  if (plan.sampAssigned) out.push({ h: plan.sampling.start, to: Math.min(24, plan.sampling.end), label: 'Sampling', detail: `${plan.stations.length} stations`, tone: 'predicted', quiet: true });
  return out;
}

/* ================================================================ panes */

function Tile({ label, value, unit, note, tone }: { label: string; value: string; unit?: string; note?: string; tone?: 'critical' | 'warning' | 'clear' }) {
  return <div className="dm-tile" data-tone={tone}><span>{label}</span><b className="num">{value}{unit && <small>{unit}</small>}</b>{note && <em>{note}</em>}</div>;
}
function Card({ icon: Icon, title, meta, children, onClick, tone }: { icon: typeof Bell; title: string; meta?: React.ReactNode; children: React.ReactNode; onClick?: () => void; tone?: string }) {
  return (
    <section className={`dm-card rs-card${onClick ? ' fc-link' : ''}${tone ? ` is-${tone}` : ''}`} onClick={onClick}>
      <header className="dm-head"><h3><Icon size={15} />{title}</h3>{meta ?? (onClick && <ChevronRight size={14} />)}</header>
      {children}
    </section>
  );
}
const Pill = ({ v }: { v: string }) => <b className={`rs-pill is-${v.toLowerCase().replace(/\s+/g, '-')}`}>{v}</b>;

interface PaneProps {
  page: ResponsePanel; setPage: (p: ResponsePanel) => void; plan: Plan; t: number; t0: number; state: PlanState; setState: (fn: (s: PlanState) => PlanState) => void;
  forcing: Forcing; waveM: number; firstShore?: number; picked?: string; setPicked: (id?: string) => void; products: ProductContext;
}

export function ResponsePane(p: PaneProps) {
  return (
    <>
      {p.page === 'overview' && <OverviewPane {...p} />}
      {p.page === 'containment' && <ContainmentPane {...p} />}
      {p.page === 'assets' && <AssetsPane {...p} />}
      {p.page === 'surveillance' && <SurveillancePane {...p} />}
      {p.page === 'cleanup' && <CleanupPane {...p} />}
      {p.page === 'sampling' && <SamplingPane {...p} />}
      {p.page === 'alerts' && <AlertsPane {...p} />}
    </>
  );
}

const counts = (plan: Plan, t: number, state: PlanState) => {
  const st = plan.assets.map((a) => assetStatus(a, t, state.assigned[a.id] !== undefined));
  return { total: st.length, scene: st.filter((s) => s === 'on scene').length, route: st.filter((s) => s === 'en route').length, standby: st.filter((s) => s === 'standby').length, down: st.filter((s) => s === 'unavailable').length };
};
const activeAlerts = (plan: Plan, state: PlanState) => plan.alerts.filter((a) => !a.resolvedByDefault && !state.resolved.includes(a.id));

function OverviewPane({ plan, t, state, setPage, firstShore, products, forcing, waveM }: PaneProps) {
  const c = counts(plan, t, state);
  const alerts = activeAlerts(plan, state);
  const shoreKm = plan.zones.reduce((s, z) => s + z.km, 0);
  return (
    <>
      <section className="dm-card dm-hero">
        <div>
          <h2>Response overview</h2>
          <p>Active response. {plan.boomA.recommended ? `Boom A recommended at +${plan.boomA.atH} h` : 'Containment not feasible at the recommended line'}; {firstShore !== undefined ? `oil reaches the coast at +${firstShore} h` : 'no shore contact forecast within 24 h'}. Plan state at {signed(t)}.</p>
        </div>
        <Badge status={alerts.some((a) => a.severity === 'High') ? 'warning' : 'clear'}>{alerts.length} alerts</Badge>
      </section>
      <section className="dm-tiles">
        <Tile label="Response window" value={f1(plan.windowH)} unit="h" note="to deploy containment" tone={plan.windowH <= 12 ? 'critical' : 'warning'} />
        <Tile label="Assets on scene" value={String(c.scene)} note={`of ${c.total} · ${c.route} en route`} tone="clear" />
        <Tile label="Boom length" value={f1(plan.boomA.lengthKm)} unit="km" note={plan.boomA.recommended ? 'Boom A, recommended' : 'not feasible'} />
        <Tile label="Shoreline to clean" value={f1(shoreKm)} unit="km" note={`${plan.zones.length} zones`} tone={shoreKm ? 'warning' : undefined} />
      </section>
      <Card icon={Bell} title={`Active alerts (${alerts.length})`} onClick={() => setPage('alerts')}>
        <ul className="rs-list">{alerts.slice(0, 3).map((a) => <li key={a.id}><i className={`rs-dot is-${a.severity.toLowerCase()}`} /><span>{a.title}<small>{a.area}</small></span><small className="num">{signed(a.at)}</small></li>)}</ul>
      </Card>
      <div className="dm-grid">
        <Card icon={Shield} title="Containment" onClick={() => setPage('containment')}><dl className="dm-rows"><div><dt>Deployments</dt><dd>1</dd></div><div><dt>Total length</dt><dd className="num">{f1(plan.boomA.lengthKm)} km</dd></div><div><dt>Status</dt><dd>{t >= plan.boomA.readyH ? <Pill v="Deployed" /> : <Pill v="In progress" />}</dd></div></dl></Card>
        <Card icon={Ship} title="Assets" onClick={() => setPage('assets')}><dl className="dm-rows"><div><dt>Total</dt><dd>{c.total}</dd></div><div><dt>On scene · en route</dt><dd>{c.scene} · {c.route}</dd></div><div><dt>Standby · down</dt><dd>{c.standby} · {c.down}</dd></div></dl></Card>
        <Card icon={Plane} title="Surveillance" onClick={() => setPage('surveillance')}><dl className="dm-rows"><div><dt>Active missions</dt><dd>{plan.missions.filter((m) => t >= m.start && t <= m.end).length}</dd></div><div><dt>Planned</dt><dd>{plan.missions.filter((m) => t < m.start).length}</dd></div><div><dt>Next flight</dt><dd className="num">{plan.missions.find((m) => m.start > t)?.id ?? '—'}</dd></div></dl></Card>
        <Card icon={Waves} title="Cleanup" onClick={() => setPage('cleanup')}><dl className="dm-rows"><div><dt>Priority areas</dt><dd>{plan.zones.filter((z) => z.priority !== 'Watch').length}</dd></div><div><dt>Shoreline</dt><dd className="num">{f1(shoreKm)} km</dd></div><div><dt>Status</dt><dd><Pill v={plan.zones.length ? 'Planning' : 'Watch'} /></dd></div></dl></Card>
        <Card icon={FlaskConical} title="Sampling" onClick={() => setPage('sampling')}><dl className="dm-rows"><div><dt>Stations</dt><dd>{plan.stations.length}</dd></div><div><dt>Collected</dt><dd>{plan.stations.filter((s) => t >= s.arrive).length}</dd></div><div><dt>Status</dt><dd><Pill v={plan.stations.some((s) => t >= s.arrive) ? 'In progress' : 'Planned'} /></dd></div></dl></Card>
        <Card icon={Wind} title="Conditions"><dl className="dm-rows"><div><dt>Wind</dt><dd className="num">{f1(forcing.windSpeed * 1.944)} kt</dd></div><div><dt>Sea state</dt><dd className="num">{f1(waveM)} m</dd></div><div><dt>Boom limits</dt><dd>{plan.feasible.hsOk && plan.feasible.windOk ? <Pill v="Within" /> : <Pill v="Exceeded" />}</dd></div></dl></Card>
      </div>
      <QuickActions products={products} />
    </>
  );
}

function QuickActions({ products }: { products: ProductContext }) {
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const run = async (kind: 'iap' | 'sitrep' | 'report') => {
    setBusy(kind); setFailed(undefined);
    try {
      const g = await import('../../../products/generate');
      await (kind === 'iap' ? g.openIap : kind === 'sitrep' ? g.openSitrep : g.openReport)(products);
    } catch (e) { setFailed(e instanceof Error ? e.message : String(e)); } finally { setBusy(undefined); }
  };
  return (
    <section className="rs-actions">
      <h3><Zap size={14} />Quick actions</h3>
      <div>
        <button type="button" className="is-primary" disabled={!!busy} onClick={() => run('iap')}><FileText size={14} />{busy === 'iap' ? 'Generating…' : 'Generate IAP'}</button>
        <button type="button" disabled={!!busy} onClick={() => run('sitrep')}><ClipboardList size={14} />{busy === 'sitrep' ? 'Generating…' : 'Create SITREP'}</button>
        <button type="button" disabled={!!busy} onClick={() => run('report')}><BarChart3 size={14} />{busy === 'report' ? 'Generating…' : 'Technical report'}</button>
      </div>
      <small className="fc-note">PDFs from the GUARDIANS IAP, SITREP and technical-report generators, set to this slick. Demonstration content is marked in each document.</small>
      {failed && <small className="fc-note rs-fail">Could not generate: {failed}</small>}
    </section>
  );
}

function ContainmentPane({ plan, forcing, waveM, firstShore }: PaneProps) {
  const A = plan.boomA, B = plan.boomB;
  return (
    <>
      <section className={`dm-card dm-hero ${A.recommended ? '' : 'fc-risk is-high'}`}>
        <div><h2>Containment plan</h2><p>Plan and deploy interception resources to contain the slick before it spreads further.</p></div>
        <Badge status={A.recommended ? 'clear' : 'warning'}>{A.recommended ? 'Boom A recommended' : 'Not feasible'}</Badge>
      </section>
      <Card icon={CheckCircle2} title="Recommended interception zone" meta={<Pill v={A.recommended ? 'Recommended' : 'Blocked'} />}>
        <dl className="dm-rows rs-3">
          <div><dt>Position (centre)</dt><dd className="num">{A.centre[1].toFixed(2)}° N, {A.centre[0].toFixed(2)}° E</dd></div>
          <div><dt>Estimated length</dt><dd className="num">{f1(A.lengthKm)} km</dd></div>
          <div><dt>Oil arrives</dt><dd className="num">+{A.atH} h</dd></div>
        </dl>
      </Card>
      <div className="dm-grid">
        <Card icon={Link2} title="Boom deployment"><dl className="dm-rows"><div><dt>Total length</dt><dd className="num">{f1(A.lengthKm)} km</dd></div><div><dt>Type</dt><dd>Offshore, inflatable</dd></div><div><dt>Vessels</dt><dd>{A.vessel}</dd></div><div><dt>Configuration</dt><dd>U-boom, skimmer at apex</dd></div></dl></Card>
        <Card icon={Clock} title="Interception window"><dl className="dm-rows"><div><dt>Earliest deployment</dt><dd className="num">{signed(A.readyH)}</dd></div><div><dt>Oil at line</dt><dd className="num">+{A.atH} h</dd></div><div><dt>Slack</dt><dd className="num">{f1(A.atH - A.readyH)} h</dd></div><div><dt>Effectiveness</dt><dd><Pill v={A.recommended ? 'High' : 'Low'} /></dd></div></dl></Card>
        <Card icon={ShieldCheck} title="Feasibility & safety"><dl className="dm-rows"><div><dt>Sea state (Hs)</dt><dd className="num">{f1(waveM)} m {plan.feasible.hsOk ? <Pill v="OK" /> : <Pill v="Too high" />}</dd></div><div><dt>Wind</dt><dd className="num">{plan.feasible.windKt.toFixed(0)} kt {plan.feasible.windOk ? <Pill v="OK" /> : <Pill v="Too high" />}</dd></div><div><dt>Current</dt><dd className="num">{f1(Math.hypot(forcing.driftU, forcing.driftV) * 1.944)} kt</dd></div><div><dt>Entrainment risk</dt><dd>{Math.hypot(forcing.driftU, forcing.driftV) * 1.944 > 0.7 ? 'Current above 0.7 kt: angle the boom' : 'Low'}</dd></div></dl></Card>
        <Card icon={ClipboardList} title="Candidate comparison"><dl className="dm-rows"><div><dt>Boom A</dt><dd>{f1(A.lengthKm)} km · +{A.atH} h · {A.recommended ? '✓' : '✕'}</dd></div><div><dt>Boom B</dt><dd>{f1(B.lengthKm)} km · +{B.atH} h · ✕</dd></div><div><dt>Why not B</dt><dd><small>{B.reason}</small></dd></div></dl></Card>
      </div>
      <Card icon={FileText} title="Rationale"><p className="fc-note">{A.reason} {A.recommended ? 'Intercepting here keeps the thick leading edge offshore, with vessels available and the sea state inside boom limits.' : ''}</p></Card>
      {firstShore !== undefined && <section className="dm-card rs-banner"><AlertTriangle size={16} /><span><b>Slick approaching the coast</b><small>First shore contact forecast at +{firstShore} h.</small></span></section>}
    </>
  );
}

function AssetsPane({ plan, t, t0, state, setState, picked, setPicked }: PaneProps) {
  const c = counts(plan, t, state);
  const sel: Asset = plan.assets.find((a) => a.id === picked) ?? plan.assets[0];
  const st = assetStatus(sel, t, state.assigned[sel.id] !== undefined);
  const rec = plan.recommend;
  return (
    <>
      <section className="dm-card dm-hero"><div><h2>Response assets</h2><p>Vessels and equipment for on-water response and pre-positioning. Select an asset on the map or in the list.</p></div><Badge claim="predicted">Plan</Badge></section>
      <section className="dm-tiles">
        <Tile label="Total assets" value={String(c.total)} /><Tile label="On scene" value={String(c.scene)} tone="clear" /><Tile label="En route" value={String(c.route)} /><Tile label="Standby" value={String(c.standby)} /><Tile label="Unavailable" value={String(c.down)} tone={c.down ? 'critical' : undefined} />
      </section>
      <Card icon={Ship} title={sel.name} meta={<Pill v={cap(st)} />}>
        <dl className="dm-rows rs-2col">
          <div><dt>Type</dt><dd>{cap(sel.kind)}</dd></div><div><dt>Task</dt><dd>{sel.task}</dd></div>
          <div><dt>Position</dt><dd className="num">{assetAt(sel, t)[1].toFixed(2)}° N, {assetAt(sel, t)[0].toFixed(2)}° E</dd></div><div><dt>Speed</dt><dd className="num">{sel.knots} kn</dd></div>
          <div><dt>Distance to task</dt><dd className="num">{f1(sel.distKm)} km</dd></div><div><dt>Crew</dt><dd>{sel.crew}</dd></div>
          <div><dt>ETA</dt><dd className="num">{sel.arrive > 0 && sel.arrive < 99 ? clockAt(t0, sel.arrive) : st === 'on scene' ? 'On station' : '—'}</dd></div>{sel.note && <div><dt>Note</dt><dd>{sel.note}</dd></div>}
        </dl>
      </Card>
      {rec && (
        <section className="dm-card rs-rec">
          <header className="dm-head"><h3><Target size={15} />Pre-positioning recommendation</h3><Pill v="High priority" /></header>
          <p>Position <b>{rec.a.name}</b> from {rec.staging} to <i>{rec.a.task.toLowerCase()}</i>.</p>
          <div className="rs-rec-row"><span><small>ETA</small><b className="num">{f1(rec.eta)} h</b></span><span><small>Distance</small><b className="num">{f1(rec.km)} km</b></span>
            <button type="button" onClick={() => { setState((s) => ({ ...s, assigned: { ...s.assigned, [rec.a.id]: Date.now() } })); setPicked(rec.a.id); }}><Send size={14} />Assign</button></div>
        </section>
      )}
      <Card icon={Clock} title="Readiness and ETA">
        <ul className="rs-list">{plan.assets.map((a) => { const s = assetStatus(a, t, state.assigned[a.id] !== undefined); return (
          <li key={a.id} aria-selected={a.id === sel.id} onClick={() => setPicked(a.id)} className="fc-link"><i className="rs-dot" style={{ background: COLOUR[s] }} /><span>{a.name}<small>{a.task}</small></span><Pill v={cap(s)} /><small className="num">{s === 'en route' ? `${f1(a.arrive - t)} h` : s === 'standby' ? `${f1(a.distKm / (a.knots * 1.852))} h` : '—'}</small>
            {s === 'standby' && <button type="button" className="rs-mini" onClick={(e) => { e.stopPropagation(); setState((x) => ({ ...x, assigned: { ...x.assigned, [a.id]: Date.now() } })); }}>Assign</button>}
            {state.assigned[a.id] !== undefined && <button type="button" className="rs-mini is-quiet" onClick={(e) => { e.stopPropagation(); setState((x) => { const n = { ...x.assigned }; delete n[a.id]; return { ...x, assigned: n }; }); }}>Undo</button>}
          </li>); })}</ul>
      </Card>
      <Card icon={AlertTriangle} title="Conflicts and constraints" tone="warn">
        <ul className="rs-list">{plan.assets.filter((a) => a.status0 === 'unavailable').map((a) => <li key={a.id}><i className="rs-dot is-high" /><span>{a.name} unavailable<small>{a.note}</small></span></li>)}
          {plan.assets.filter((a) => a.arrive > 0 && a.arrive < 99 && (a.id === 'boom-1' || a.id === 'tug-1') && a.arrive > plan.boomA.atH).map((a) => <li key={a.id}><i className="rs-dot is-high" /><span>{a.name} late for Boom A<small>arrives {signed(a.arrive)}, oil at +{plan.boomA.atH} h</small></span></li>)}</ul>
      </Card>
    </>
  );
}

function SurveillancePane({ plan, t, t0, firstShore }: PaneProps) {
  const active = plan.missions.find((m) => t >= m.start && t <= m.end) ?? plan.missions.find((m) => m.start > t) ?? plan.missions[0];
  const status = t < active.start ? 'Planned' : t > active.end ? 'Complete' : 'In progress';
  // Daylight on the Indian coast, about 01:00–12:30 UTC: the window containing the clock, else the next.
  const d0 = new Date(t0);
  let dayStart = 1 - (d0.getUTCHours() + d0.getUTCMinutes() / 60);
  while (dayStart + 11.5 < t) dayStart += 24;
  while (dayStart - 24 + 11.5 >= t) dayStart -= 24;
  const dayEnd = dayStart + 11.5;
  return (
    <>
      <section className="dm-card dm-hero"><div><h2>Surveillance missions</h2><p>Aerial surveillance to track the slick and assess impact. Aircraft move along their search patterns with the clock.</p></div><Badge claim="observed">Air</Badge></section>
      <Card icon={Plane} title={`${status === 'In progress' ? 'Active' : 'Next'} mission`} meta={<Pill v={status} />}>
        <dl className="dm-rows rs-2col"><div><dt>Mission ID</dt><dd className="num">{active.id}</dd></div><div><dt>Platform</dt><dd>{active.platform}</dd></div><div><dt>Start</dt><dd className="num">{clockAt(t0, active.start)}</dd></div><div><dt>Estimated end</dt><dd className="num">{clockAt(t0, active.end)}</dd></div><div><dt>Progress</dt><dd className="num">{Math.round(Math.max(0, Math.min(1, (t - active.start) / (active.end - active.start))) * 100)} %</dd></div><div><dt>Call sign</dt><dd>{active.callsign}</dd></div></dl>
      </Card>
      <div className="dm-grid">
        <Card icon={Crosshair} title="Evidence gap" meta={<Pill v="High" />}><p className="fc-note">No observation covers the forecast leading edge after the pass. Recommended: aerial pass over {plan.missions[0].id}'s box to verify extent.</p></Card>
        <Card icon={Clock} title="Observation window" meta={<Pill v={t >= dayStart && t <= dayEnd ? 'Optimal now' : 'Night'} />}><p className="fc-note">Daylight {signed(dayStart)} to {signed(dayEnd)} ({clockAt(t0, dayStart).slice(-9)} – {clockAt(t0, dayEnd).slice(-9)}). Low cloud forecast.</p></Card>
        <Card icon={Gauge} title="Platform assignment" meta={<Pill v={status === 'In progress' ? 'In flight' : 'Ready'} />}><dl className="dm-rows"><div><dt>Platform</dt><dd>{active.platform}</dd></div><div><dt>Sensors</dt><dd>{active.sensors}</dd></div><div><dt>Endurance</dt><dd>{active.kind === 'plane' ? '≈ 5 h' : '≈ 45 min per battery'}</dd></div></dl></Card>
        <Card icon={Target} title="Mission objective"><p className="fc-note">{active.objective}</p></Card>
      </div>
      <Card icon={BarChart3} title="Expected information gain"><p className="fc-note">Refined slick boundary (±25 %), a corrected drift start point for the next forecast run{firstShore !== undefined ? `, and early confirmation of shore contact before +${firstShore} h` : ''}.</p></Card>
      <Card icon={Zap} title={`Mission queue (${plan.missions.length})`}>
        <ul className="rs-list">{plan.missions.map((m, i) => <li key={m.id}><b className="num">{i + 1}</b><span>{m.id}<small>{m.name}</small></span><Pill v={t < m.start ? 'Planned' : t > m.end ? 'Complete' : 'In flight'} /><small className="num">{signed(m.start)}</small></li>)}</ul>
      </Card>
    </>
  );
}

function CleanupPane({ plan, firstShore, products, t0 }: PaneProps) {
  const total = plan.zones.reduce((s, z) => s + z.km, 0);
  const high = plan.zones.filter((z) => z.priority === 'Immediate' || z.priority === 'High').reduce((s, z) => s + z.km, 0);
  const watch = plan.zones.every((z) => z.priority === 'Watch');
  return (
    <>
      <section className={`dm-card dm-hero ${watch ? '' : 'fc-risk is-high'}`}><div><h2>Cleanup priorities</h2><p>{watch ? 'No shore contact forecast within 24 h. The zones below are where the envelope comes closest to the coast; keep them on watch.' : 'Prioritise and plan shoreline cleanup by arrival time, shoreline type and access.'}</p></div><Badge status={watch ? 'watch' : 'warning'}>{watch ? 'Watch' : 'Active'}</Badge></section>
      <Card icon={Target} title="Priority areas">
        <ul className="rs-list">{plan.zones.map((z) => <li key={z.id}><i className={`rs-dot is-${z.priority.toLowerCase()}`} /><span>{z.id} – {z.shore}<small>{z.name}{z.first !== null ? ` · oil at +${z.first} h` : ''}</small></span><small className="num">{f1(z.km)} km</small><Pill v={z.priority} /></li>)}
          {!plan.zones.length && <li><span><small>No coastline within 25 km of the forecast.</small></span></li>}</ul>
      </Card>
      <section className="dm-tiles"><Tile label="Total at risk" value={f1(total)} unit="km" /><Tile label="High priority" value={f1(high)} unit="km" tone={high ? 'critical' : undefined} /><Tile label="Moderate / watch" value={f1(total - high)} unit="km" /><Tile label="First contact" value={firstShore !== undefined ? `+${firstShore}` : '—'} unit={firstShore !== undefined ? 'h' : undefined} /></section>
      <div className="dm-grid">
        <Card icon={AlertTriangle} title="Access & safety"><ul className="rs-bullets">{plan.zones.slice(0, 4).map((z) => <li key={z.id}>{z.id}: {z.access}.</li>)}</ul></Card>
        <Card icon={ClipboardList} title={watch ? 'Resource needs (pre-staged)' : 'Resource needs'}><dl className="dm-rows"><div><dt>Personnel</dt><dd className="num">{Math.max(12, Math.round((watch ? high || total * 0.15 : total) * 4))}</dd></div><div><dt>Vessels</dt><dd className="num">{Math.max(2, Math.round((watch ? total * 0.15 : total) / 5))}</dd></div><div><dt>Shoreline kits</dt><dd className="num">{Math.max(4, Math.round((watch ? total * 0.15 : total) / 3))} sets</dd></div><div><dt>Waste storage</dt><dd className="num">{Math.max(20, Math.round((watch ? total * 0.15 : total) * 12))} m³</dd></div></dl></Card>
        <Card icon={Clock} title="Urgency" meta={<Pill v={firstShore !== undefined && firstShore <= 12 ? 'High' : firstShore !== undefined ? 'Medium' : 'Low'} />}><p className="fc-note">{firstShore !== undefined ? `Teams on the first zone before +${Math.max(1, firstShore - 2)} h. Optimal cleanup window 0–72 h after contact.` : 'No immediate action; pre-stage kits at the nearest staging point.'}</p></Card>
        <Card icon={FileText} title="Planning status"><dl className="dm-rows"><div><dt>Cleanup plan</dt><dd><Pill v={watch ? 'Standby' : 'In progress'} /></dd></div><div><dt>Teams mobilised</dt><dd>{watch ? 'No' : 'Yes'}</dd></div><div><dt>Estimated start</dt><dd className="num">{firstShore !== undefined ? clockAt(t0, Math.max(0, firstShore - 2)) : '—'}</dd></div></dl></Card>
      </div>
      <QuickActions products={products} />
    </>
  );
}

function SamplingPane({ plan, t, t0, setState }: PaneProps) {
  const done = plan.stations.filter((s) => t >= s.arrive).length;
  const lab = plan.stations.filter((s) => t >= s.arrive + 6).length;
  const analysed = plan.stations.filter((s) => t >= s.arrive + 12).length;
  return (
    <>
      <section className="dm-card dm-hero"><div><h2>Sampling plan</h2><p>Targeted sampling to confirm impact, monitor spread and inform decisions. Stations are placed from the forecast and visited in the shortest order.</p></div><Badge claim="predicted">Plan</Badge></section>
      <Card icon={Target} title="Sampling objectives"><ul className="rs-checks">{['Confirm slick boundary and extent', 'Hydrocarbon concentration in water', 'Monitor nearshore sensitive areas', 'Establish background conditions', 'Fingerprint oil against suspect vessels'].map((x) => <li key={x}><Check size={13} />{x}</li>)}</ul></Card>
      <Card icon={MapPin} title="Planned stations" meta={<span className="dm-meta">{plan.stations.length} stations</span>}>
        <ul className="rs-list">{plan.stations.map((s) => <li key={s.id}><i className={`rs-dot ${s.id === 'B-1' ? 'is-blue' : s.priority === 'High' ? 'is-high' : 'is-medium'}`} /><span>{s.id} · {s.role}<small>{s.why}</small></span><small className="num">{plan.sampAssigned ? signed(s.arrive) : '—'}</small><Pill v={t >= s.arrive ? 'Collected' : 'Planned'} /></li>)}</ul>
        {!plan.sampAssigned && <div className="rs-btns"><button type="button" className="is-primary" onClick={() => setState((x) => ({ ...x, assigned: { ...x.assigned, 'samp-1': Date.now() } }))}><Send size={14} />Assign sampling vessel</button></div>}
      </Card>
      <div className="dm-grid">
        <Card icon={Clock} title="Sample window"><dl className="dm-rows"><div><dt>Start</dt><dd className="num">{clockAt(t0, plan.sampling.start)}</dd></div><div><dt>End</dt><dd className="num">{clockAt(t0, plan.sampling.end)}</dd></div><div><dt>Tide</dt><dd>Slack water near {clockAt(t0, plan.sampling.start + 2.5).slice(-9)}</dd></div></dl></Card>
        <Card icon={Link2} title="Chain of custody"><div className="rs-custody"><span><b className="num">{done}</b><small>Collected</small></span><span><b className="num">{plan.stations.length - done}</b><small>Planned</small></span><span><b className="num">{lab}</b><small>In lab</small></span><span><b className="num">{analysed}</b><small>Analysed</small></span></div></Card>
      </div>
      <Card icon={BarChart3} title="Expected information gain"><ul className="rs-checks">{['Refine slick extent and the drift model', 'Quantify environmental concentrations', 'Assess risk to coastal and sensitive areas', 'Support enforcement and regulatory reporting'].map((x) => <li key={x}><Check size={13} />{x}</li>)}</ul></Card>
    </>
  );
}

function AlertsPane({ plan, t0, state, setState }: PaneProps) {
  const active = activeAlerts(plan, state);
  const resolved = plan.alerts.filter((a) => a.resolvedByDefault || state.resolved.includes(a.id));
  const acked = active.filter((a) => state.acked.includes(a.id));
  return (
    <>
      <section className="dm-card dm-hero"><div><h2>Operational alerts</h2><p>Active and recent alerts for this incident. Acknowledge to take ownership; resolve when the action is done. Kept in this browser.</p></div><Badge status={active.length ? 'warning' : 'clear'}>{active.length} active</Badge></section>
      <section className="dm-tiles"><Tile label="Active" value={String(active.length)} tone={active.length ? 'critical' : 'clear'} /><Tile label="Acknowledged" value={String(acked.length)} /><Tile label="Pending action" value={String(active.length - acked.length)} tone={active.length - acked.length ? 'warning' : undefined} /><Tile label="Resolved" value={String(resolved.length)} tone="clear" /></section>
      {active.map((a) => (
        <section key={a.id} className="dm-card rs-alert">
          <header className="dm-head"><h3><AlertTriangle size={15} className={`is-${a.severity.toLowerCase()}`} />{a.title}</h3><Pill v={a.severity} /></header>
          <dl className="dm-rows rs-3"><div><dt>Triggered</dt><dd className="num">{clockAt(t0, a.at)}</dd></div><div><dt>Affected area</dt><dd>{a.area}</dd></div><div><dt>Status</dt><dd><Pill v={state.acked.includes(a.id) ? 'Acknowledged' : 'Active'} /></dd></div></dl>
          <p className="rs-action"><ChevronRight size={13} />{a.action}</p>
          <div className="rs-btns">
            {!state.acked.includes(a.id) && <button type="button" onClick={() => setState((s) => ({ ...s, acked: [...s.acked, a.id] }))}>Acknowledge</button>}
            <button type="button" className="is-primary" onClick={() => setState((s) => ({ ...s, resolved: [...s.resolved, a.id] }))}>Resolve</button>
          </div>
        </section>
      ))}
      <Card icon={CheckCircle2} title={`Resolved alerts (${resolved.length})`}>
        <ul className="rs-list">{resolved.map((a) => <li key={a.id}><i className="rs-dot is-clear" /><span>{a.title}<small>{clockAt(t0, a.at)}</small></span><Pill v={a.severity} />
          {state.resolved.includes(a.id) && <button type="button" className="rs-mini is-quiet" onClick={() => setState((s) => ({ ...s, resolved: s.resolved.filter((x) => x !== a.id), acked: s.acked.filter((x) => x !== a.id) }))}>Reopen</button>}</li>)}</ul>
      </Card>
    </>
  );
}
