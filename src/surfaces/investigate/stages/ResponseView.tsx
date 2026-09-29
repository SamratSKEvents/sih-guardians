import { token } from '../../../design/token';
/**
 * Response: the map layers, timeline events and panes for the plan in
 * `responsePlan.ts`. Rendered inside the Forecast page's frame, so the map,
 * the live oil and the clock are the same ones the forecast uses.
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  AlertTriangle, ArrowLeft, BarChart3, Bell, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, ClipboardList, Crosshair, FileText, FlaskConical, Gauge, Link2, MapPin,
  Plane, Send, Shield, ShieldCheck, Ship, Target, Waves, Zap,
} from 'lucide-react';
import { Badge } from '../../../design/components';
import { when } from '../../../format';
import type { Forcing } from '../../../forecast/forcing';
import type { ResponsePanel } from '../Workspace';
import { alongRoute, assetAt, assetStatus, EMPTY_STATE, isDeployed, type Plan, type PlanState } from './responsePlan';
import type { Pt } from './mapData';

/** "1 zone", "3 zones". */
const many = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
import { card, hover } from './mapTip';

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

const COLOUR: Record<string, string> = { 'on scene': token('--lime-300-c'), 'en route': token('--lime-300-c'), standby: token('--neutral-300-b'), unavailable: token('--series-5') };
const HULL = 'M0,-14 C3.6,-10 5,-6 5,-1 L5,12 Q5,14 3,14 L-3,14 Q-5,14 -5,12 L-5,-1 C-5,-6 -3.6,-10 0,-14 Z';
const PLANE = 'M0,-13 L2,-4 L12,1 L12,3.5 L2,1 L1.5,9 L5,11.5 L5,13 L0,12 L-5,13 L-5,11.5 L-1.5,9 L-2,1 L-12,3.5 L-12,1 L-2,-4 Z';
const DRONE = 'M-9,-9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M9,-9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M-9,9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M9,9 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0 M-3,-3 h6 v6 h-6 Z M-7,-7 L7,7 M7,-7 L-7,7';
const bearing = ([x1, y1]: Pt, [x2, y2]: Pt) => (Math.atan2((x2 - x1) * Math.cos((y1 * Math.PI) / 180), y2 - y1) * 180) / Math.PI;
const icon = (path: string, colour: string, deg: number, size = 26, stroke = false) => L.divIcon({
  className: 'rs-icon',
  html: `<svg viewBox="-15 -15 30 30" width="${size}" height="${size}" style="transform:rotate(${deg}deg)"><path d="${path}" fill="${stroke ? 'none' : colour}" stroke="${stroke ? colour : token('--neutral-800-i')}" stroke-width="${stroke ? 1.6 : 1.2}"/></svg>`,
  iconSize: [size, size], iconAnchor: [size / 2, size / 2],
});
const chip = (text: string, cls = '') => L.divIcon({ className: 'dm-chip-anchor', html: `<span class="dm-chip rs-chip ${cls}">${text}</span>`, iconSize: [0, 0] });

/** What each page is about, to frame the map on when the page opens. */
export function focusOf(plan: Plan, page: ResponsePanel, centre: Pt): Pt[] {
  const pts: Pt[] = [centre];
  if (page === 'containment') pts.push(...plan.booms.flatMap((b) => b.line));
  if (page === 'overview') pts.push(...plan.boomA.line);
  if (page === 'assets') pts.push(...plan.assets.flatMap((a) => [a.home, a.target]));
  if (page === 'surveillance') pts.push(...plan.missions.flatMap((m) => m.box));
  if (page === 'cleanup') pts.push(...plan.zones.flatMap((z) => z.pts), ...plan.staging.map((x) => x.at));
  if (page === 'sampling') pts.push(...plan.samplingRoute);
  if (page === 'alerts') pts.push(...plan.alerts.filter((a) => a.where).map((a) => a.where!));
  return pts;
}

export function drawResponse(g: L.LayerGroup, plan: Plan, shown: Set<string>, t: number, state: PlanState, page: ResponsePanel, onPick: (id: string) => void, picked?: string) {
  if (shown.has('booms')) for (const b of plan.booms.filter((x) => page === 'containment' || isDeployed(x, state))) {
    const on = isDeployed(b, state);
    const sel = picked === `boom:${b.id}`;
    const col = on ? token('--lime-300-c') : b.recommended ? token('--amber-200') : token('--neutral-300-b');
    L.polyline(b.line.map(ll), { color: sel ? '#ffffff' : token('--neutral-800-i'), weight: sel ? 10 : 7, opacity: sel ? 0.9 : 0.7, interactive: false }).addTo(g);
    const hit = hover(L.polyline(b.line.map(ll), { color: col, weight: 14, opacity: 0.001 }), () => card(b.name, `${b.kind === 'offshore' ? 'Offshore interception' : 'Shoreline protection'} · ${on ? 'deployed' : b.recommended ? 'recommended' : 'candidate'}`, [['Length', `${f1(b.lengthKm)} km`], ['Oil reaches line', b.atH !== null ? `+${b.atH} h` : 'not within 24 h'], ['Ready by', signed(b.readyH)], ['Protects', b.protects]]));
    hit.on('click', () => onPick(`boom:${b.id}`));
    hit.addTo(g);
    L.polyline(b.line.map(ll), { color: col, weight: 3.5, dashArray: on ? undefined : '6 6', interactive: false }).addTo(g);
    for (const p of [b.line[0], b.line[b.line.length - 1]]) L.circleMarker(ll(p), { radius: 4, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: 1, interactive: false }).addTo(g);
    if (page === 'containment' || page === 'overview') L.marker(ll(b.line[0]), { icon: chip(`${b.name}${on ? '' : b.recommended ? ' · recommended' : ''}`, on ? 'is-good' : ''), interactive: false }).addTo(g);
  }
  if (shown.has('staging')) for (const s of plan.staging) {
    hover(L.circleMarker(ll(s.at), { radius: 7, color: '#fff', weight: 2.5, fillColor: token('--sky-500'), fillOpacity: 1 }), () => card(s.name, 'Staging point', [['Assets based here', plan.assets.filter((a) => a.home === s.at).map((a) => a.name).join(', ') || '—']])).addTo(g);
    if (page === 'assets' || page === 'cleanup') L.marker(ll(s.at), { icon: chip(`⚓ ${s.name}`), interactive: false }).addTo(g);
  }
  if (shown.has('zones')) for (const z of plan.zones) {
    const col = z.priority === 'Immediate' ? token('--series-5') : z.priority === 'High' ? token('--red-300-i') : z.priority === 'Moderate' ? token('--amber-200-g') : token('--neutral-300-b');
    for (const p of z.pts) hover(L.circleMarker(ll(p), { radius: 4.5, stroke: false, fillColor: col, fillOpacity: 0.95 }), () => card(`${z.id} · ${z.shore}`, z.name, [['Priority', z.priority], ['Oil arrives', z.first !== null ? `+${z.first} h` : 'watch only'], ['Shoreline', `${f1(z.km)} km`], ['Access', z.access]])).addTo(g);
    if (page === 'cleanup') L.marker(ll(z.pts[Math.floor(z.pts.length / 2)]), { icon: chip(`${z.id} · ${z.shore} (${z.priority})`, `is-${z.priority.toLowerCase()}`), interactive: false }).addTo(g);
  }
  if (shown.has('missions')) for (const m of plan.missions) {
    const active = t >= m.start && t <= m.end;
    hover(L.polygon(m.box.map(ll), { color: token('--teal-200-d'), weight: 1.6, dashArray: '6 5', fillColor: token('--teal-200-d'), fillOpacity: active ? 0.2 : 0.08 }), () => card(`${m.id} · ${m.name}`, m.platform, [['Status', active ? 'In flight' : t > m.end ? 'Complete' : `Planned from ${signed(m.start)}`], ['Window', `${signed(m.start)} to ${signed(m.end)}`], ['Call sign', m.callsign], ['Sensors', m.sensors]])).addTo(g);
    L.polyline(m.route.map(ll), { color: token('--teal-200-d'), weight: 1.4, dashArray: '3 5', opacity: 0.9, interactive: false }).addTo(g);
    for (const p of m.route.filter((_, k) => k % 2 === 0)) L.circleMarker(ll(p), { radius: 3, color: token('--teal-200-d'), weight: 1.5, fillColor: token('--neutral-800-i'), fillOpacity: 1, interactive: false }).addTo(g);
    const f = (t - m.start) / (m.end - m.start);
    const pos = alongRoute(m.route, f);
    const ahead = alongRoute(m.route, Math.min(1, f + 0.02));
    L.marker(ll(pos), { icon: icon(m.kind === 'plane' ? PLANE : DRONE, '#ffffff', m.kind === 'plane' ? bearing(pos, ahead) : 0, 28, m.kind === 'drone'), interactive: false }).addTo(g);
    if (page === 'surveillance') L.marker(ll(m.box[0]), { icon: chip(`${m.id} · ${m.name}${active ? ' · in flight' : t > m.end ? ' · done' : ` · from ${signed(m.start)}`}`, 'is-mission'), interactive: false }).addTo(g);
  }
  if (shown.has('stations') && page === 'sampling' && !shown.has('assets')) {
    const v = plan.assets.find((a) => a.kind === 'sampling')!;
    const pos = samplingPos(plan, t, state.assigned[v.id] !== undefined);
    L.marker(ll(pos), { icon: icon(HULL, state.assigned[v.id] !== undefined ? token('--lime-300-c') : token('--neutral-300-b'), 0, 26), interactive: false }).addTo(g);
    L.marker(ll(pos), { icon: chip(`${v.name}${state.assigned[v.id] !== undefined ? '' : ' (not assigned)'}`, state.assigned[v.id] !== undefined ? 'is-good' : ''), interactive: false }).addTo(g);
  }
  if (shown.has('stations')) {
    L.polyline(plan.samplingRoute.map(ll), { color: token('--map-clear-ink'), weight: 2, dashArray: '6 6', interactive: false }).addTo(g);
    for (const s of plan.stations) {
      const done = t >= s.arrive;
      hover(L.circleMarker(ll(s.at), { radius: 7, color: '#fff', weight: 2.5, fillColor: s.id === 'B-1' ? token('--sky-500') : done ? token('--lime-300-c') : token('--neutral-800-i'), fillOpacity: 1 }), () => card(`${s.id} · ${s.role}`, s.why, [['Priority', s.priority], ['Status', done ? 'Collected' : 'Planned'], ['Vessel arrives', plan.sampAssigned ? signed(s.arrive) : 'vessel not assigned']])).addTo(g);
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
    if (picked === a.id) L.circleMarker(ll(pos), { radius: 17, color: '#ffffff', weight: 2.5, fill: false, interactive: false }).addTo(g);
    hover(mk, () => card(a.name, `${cap(a.kind)} · ${cap(st)}`, [['Task', a.task], ['Speed', `${a.knots} kn`], ['Crew', a.crew], ['ETA', st === 'en route' ? signed(a.arrive) : st === 'on scene' ? 'on station' : st === 'standby' ? 'awaiting assignment' : '—'], ['Note', a.note]]));
    const eta = st === 'en route' ? ` · ETA ${signed(a.arrive)}` : '';
    if (page === 'assets' || (page === 'containment' && (a.kind === 'boom' || a.kind === 'tug' || a.kind === 'skimmer')) || (page === 'sampling' && a.kind === 'sampling')) L.marker(ll(pos), { icon: chip(`${a.name} (${cap(st)}${eta})`, st === 'unavailable' ? 'is-bad' : st === 'standby' ? '' : 'is-good'), interactive: false }).addTo(g);
  }
  if (shown.has('alerts')) for (const al of plan.alerts) {
    if (!al.where || state.resolved.includes(al.id) || al.resolvedByDefault) continue;
    hover(L.marker(ll(al.where), { icon: L.divIcon({ className: 'rs-alert-pin', html: `<span class="is-${al.severity.toLowerCase()}">!</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }), () => card(al.title, `${al.severity} · ${al.area}`, [['Triggered', signed(al.at)], ['Status', state.acked.includes(al.id) ? 'Acknowledged' : 'Active'], ['Action', al.action]])).addTo(g);
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
  for (const b of plan.booms.filter((x) => isDeployed(x, state))) {
    if (b.readyH > 0 && b.readyH < 24) out.push({ h: b.readyH, label: `${b.name} ready`, detail: b.vessel ?? '', tone: 'predicted', quiet: b.id !== 'A' });
    if (b.atH !== null) out.push({ h: b.atH, label: `Oil at ${b.name}`, detail: 'Forecast oil reaches the boom line', tone: 'warning', quiet: true });
  }
  for (const a of plan.assets) {
    const assigned = state.assigned[a.id] !== undefined;
    if (a.arrive > 0 && a.arrive < 24 && (a.status0 === 'en route' || assigned) && a.kind !== 'boom' && a.kind !== 'tug') out.push({ h: a.arrive, label: `${a.name.split(' ').slice(-1)[0]} on scene`, detail: a.task, tone: 'predicted', quiet: true });
  }
  for (const m of plan.missions) out.push({ h: m.start, to: m.end, label: m.id, detail: m.name, tone: 'observed', quiet: m.id !== 'SURV-001' });
  if (plan.sampAssigned) out.push({ h: plan.sampling.start, to: Math.min(24, plan.sampling.end), label: 'Sampling', detail: many(plan.stations.length, 'station'), tone: 'predicted', quiet: true });
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
  forcing: Forcing; waveM: number; firstShore?: number; picked?: string; setPicked: (id?: string) => void;
}

/** The plan's sections, reached from Overview; each section leads back to it. */
const SECTIONS: { id: ResponsePanel; label: string; icon: typeof Bell }[] = [
  { id: 'containment', label: 'Containment', icon: Shield },
  { id: 'assets', label: 'Assets', icon: Ship },
  { id: 'surveillance', label: 'Surveillance', icon: Plane },
  { id: 'cleanup', label: 'Cleanup', icon: Waves },
  { id: 'sampling', label: 'Sampling', icon: FlaskConical },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

function SectionNav({ plan, t, state, setPage, forcing, waveM }: PaneProps) {
  const c = counts(plan, t, state);
  const shoreKm = plan.zones.reduce((x, z) => x + z.km, 0);
  const flying = plan.missions.filter((m) => t >= m.start && t <= m.end);
  const next = plan.missions.find((m) => m.start > t);
  const collected = plan.stations.filter((s) => t >= s.arrive).length;
  const alerts = activeAlerts(plan, state);
  const high = alerts.filter((a) => a.severity === 'High').length;
  const deployedBooms = plan.booms.filter((b) => isDeployed(b, state));
  const rows: Record<string, { status: string; lines: [string, string] }> = {
    containment: {
      status: !deployedBooms.length ? 'None' : deployedBooms.every((b) => t >= b.readyH) ? 'Deployed' : 'In progress',
      lines: [`${deployedBooms.length} of ${plan.booms.length} lines · ${f1(deployedBooms.reduce((x, b) => x + b.lengthKm, 0))} km of boom`, `Wind ${f1(forcing.windSpeed * 1.944)} kt · Hs ${f1(waveM)} m · ${plan.feasible.hsOk && plan.feasible.windOk ? 'within limits' : 'over limits'}`],
    },
    assets: {
      status: c.down ? `${c.down} down` : 'Ready',
      lines: [`${c.scene} on scene · ${c.route} en route`, `${c.standby} standby · ${c.total} total`],
    },
    surveillance: {
      status: flying.length ? 'In flight' : next ? 'Planned' : 'Complete',
      lines: [flying.length ? `${flying.map((m) => m.id).join(', ')} flying` : many(plan.missions.length, 'mission'), next ? `Next ${next.id} at ${signed(next.start)}` : 'No flights queued'],
    },
    cleanup: {
      status: plan.zones.some((z) => z.priority === 'Immediate' || z.priority === 'High') ? 'Planning' : 'Watch',
      lines: [`${many(plan.zones.length, 'zone')} · ${f1(shoreKm)} km of shore`, `${plan.zones.filter((z) => z.priority !== 'Watch').length} priority areas`],
    },
    sampling: {
      status: !plan.sampAssigned ? 'Not assigned' : collected === plan.stations.length ? 'Complete' : collected ? 'In progress' : 'Planned',
      lines: [many(plan.stations.length, 'station'), `${collected} collected${plan.sampAssigned ? '' : ' · vessel not assigned'}`],
    },
    alerts: {
      status: high ? `${high} high` : alerts.length ? 'Medium' : 'Clear',
      lines: [`${alerts.length} active · ${state.acked.length} acknowledged`, alerts[0]?.title ?? 'Nothing pending'],
    },
  };
  return (
    <nav className="rs-nav" aria-label="Response plan sections">
      {SECTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" onClick={() => setPage(id)}>
          <Icon size={16} />
          <span>
            <b>{label}<Pill v={rows[id].status} /></b>
            <small>{rows[id].lines[0]}</small>
            <small>{rows[id].lines[1]}</small>
          </span>
          <ChevronRight size={14} />
        </button>
      ))}
    </nav>
  );
}

export function ResponsePane(p: PaneProps) {
  return (
    <>
      {p.page !== 'overview' && (
        <button type="button" className="rs-back" onClick={() => p.setPage('overview')}>
          <ArrowLeft size={15} />Response overview
        </button>
      )}
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

function OverviewPane(p: PaneProps) {
  const { plan, t, state, setPage, firstShore } = p;
  const c = counts(plan, t, state);
  const alerts = activeAlerts(plan, state);
  const shoreKm = plan.zones.reduce((s, z) => s + z.km, 0);
  return (
    <>
      <section className="dm-card dm-hero">
        <div>
          <h2>Response overview</h2>
          <p>Active response. {plan.booms.filter((b) => isDeployed(b, state)).length} boom lines deployed; {firstShore !== undefined ? `oil reaches the coast at +${firstShore} h` : 'no shore contact forecast within 24 h'}. Plan state at {signed(t)}.</p>
        </div>
        <Badge status={alerts.some((a) => a.severity === 'High') ? 'warning' : 'clear'}>{many(alerts.length, 'alert')}</Badge>
      </section>
      <SectionNav {...p} />
      <section className="dm-tiles">
        <Tile label="Response window" value={f1(plan.windowH)} unit="h" note="to deploy containment" tone={plan.windowH <= 12 ? 'critical' : 'warning'} />
        <Tile label="Assets on scene" value={String(c.scene)} note={`of ${c.total} · ${c.route} en route`} tone="clear" />
        <Tile label="Boom in use" value={f1(plan.booms.filter((b) => isDeployed(b, state)).reduce((x, b) => x + b.lengthKm, 0))} unit="km" note={many(plan.booms.filter((b) => isDeployed(b, state)).length, 'line')} />
        <Tile label="Shoreline to clean" value={f1(shoreKm)} unit="km" note={many(plan.zones.length, 'zone')} tone={shoreKm ? 'warning' : undefined} />
      </section>
      <Card icon={Bell} title={`Active alerts (${alerts.length})`} onClick={() => setPage('alerts')}>
        <ul className="rs-list">{alerts.slice(0, 3).map((a) => <li key={a.id}><i className={`rs-dot is-${a.severity.toLowerCase()}`} /><span>{a.title}<small>{a.area}</small></span><small className="num">{signed(a.at)}</small></li>)}</ul>
      </Card>
    </>
  );
}

/** One expandable row: the summary is the button, the detail opens directly under it. */
function Row({ id, open, onToggle, dot, title, sub, pill, aside, children }: {
  id: string; open: boolean; onToggle: (id: string) => void; dot: string; title: string; sub: string; pill: string; aside?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  // Opened from the map: bring the row into view so the change is seen.
  useEffect(() => { if (open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  return (
    <li ref={ref} className={`rs-acc${open ? ' is-open' : ''}`}>
      <button type="button" className="rs-acc-head" aria-expanded={open} onClick={() => onToggle(id)}>
        <i className="rs-dot" style={{ background: dot }} />
        <span><b>{title}</b><small>{sub}</small></span>
        <Pill v={pill} />
        {aside && <small className="num rs-acc-aside">{aside}</small>}
        <ChevronDown size={15} className="rs-acc-chev" />
      </button>
      {open && <div className="rs-acc-body">{children}</div>}
    </li>
  );
}

function ContainmentPane({ plan, t, state, setState, forcing, waveM, firstShore, picked, setPicked }: PaneProps) {
  const deployed = plan.booms.filter((b) => isDeployed(b, state));
  const total = deployed.reduce((s, b) => s + b.lengthKm, 0);
  const openId = picked?.startsWith('boom:') ? picked.slice(5) : undefined;
  const toggle = (id: string) => setPicked(openId === id ? undefined : `boom:${id}`);
  const set = (id: string, on: boolean) => setState((s) => {
    const crew = plan.booms.find((b) => b.id === id)?.crewIds ?? [];
    const assigned = { ...s.assigned };
    // Deploying a line puts its crew to work; standing it down releases them.
    for (const c of crew) { if (on) assigned[c] ??= Date.now(); else delete assigned[c]; }
    return { ...s, assigned, booms: { ...s.booms, [id]: on } };
  });
  const curKt = Math.hypot(forcing.driftU, forcing.driftV) * 1.944;
  const group = (kind: 'offshore' | 'shoreline') => plan.booms.filter((b) => b.kind === kind);
  const status = (b: Plan['booms'][number]) => !isDeployed(b, state) ? (b.recommended ? 'Recommended' : 'Candidate') : t >= b.readyH ? 'Deployed' : 'Deploying';
  const list = (kind: 'offshore' | 'shoreline') => (
    <ul className="rs-accs">
      {group(kind).map((b) => (
        <Row key={b.id} id={b.id} open={openId === b.id} onToggle={toggle}
          dot={isDeployed(b, state) ? token('--lime-300-c') : b.recommended ? token('--amber-200') : token('--neutral-300-b')}
          title={b.name} sub={b.protects ?? `${f1(b.lengthKm)} km · ${b.type}`}
          pill={status(b)} aside={b.atH !== null ? `oil +${b.atH} h` : 'no oil 24 h'}>
          <dl className="dm-rows rs-2col">
            <div><dt>Length</dt><dd className="num">{f1(b.lengthKm)} km</dd></div>
            <div><dt>Type</dt><dd>{b.type}</dd></div>
            <div><dt>Oil reaches line</dt><dd className="num">{b.atH !== null ? `+${b.atH} h` : 'not within 24 h'}</dd></div>
            <div><dt>Ready by</dt><dd className="num">{signed(b.readyH)}</dd></div>
            <div><dt>Slack</dt><dd className="num">{b.atH !== null ? `${f1(b.atH - b.readyH)} h` : '—'}</dd></div>
            <div><dt>Crew</dt><dd>{b.vessel ?? '—'}</dd></div>
          </dl>
          <p className="fc-note">{b.reason}</p>
          <div className="rs-btns">
            {isDeployed(b, state)
              ? <button type="button" onClick={() => set(b.id, false)}>Stand down</button>
              : <button type="button" className="is-primary" onClick={() => set(b.id, true)}><Send size={14} />Deploy</button>}
          </div>
        </Row>
      ))}
    </ul>
  );
  return (
    <>
      <section className="dm-card dm-hero">
        <div><h2>Containment</h2><p>Every boom line in the plan. Open one for its timing and crew; Deploy or Stand down changes the plan, the map and the timeline. Choices are kept in this browser.</p></div>
        <Badge status={deployed.length ? 'clear' : 'warning'}>{deployed.length} deployed</Badge>
      </section>
      <section className="dm-tiles">
        <Tile label="Deployments" value={String(deployed.length)} note={`of ${plan.booms.length} candidate lines`} tone={deployed.length ? 'clear' : 'warning'} />
        <Tile label="Boom in use" value={f1(total)} unit="km" note="total length" />
        <Tile label="First oil at a line" value={deployed.some((b) => b.atH !== null) ? `+${Math.min(...deployed.filter((b) => b.atH !== null).map((b) => b.atH!))}` : '—'} unit={deployed.some((b) => b.atH !== null) ? 'h' : undefined} />
        <Tile label="Boom limits" value={plan.feasible.hsOk && plan.feasible.windOk ? 'OK' : 'Over'} note={`Hs ${f1(waveM)} m · ${plan.feasible.windKt.toFixed(0)} kt`} tone={plan.feasible.hsOk && plan.feasible.windOk ? 'clear' : 'critical'} />
      </section>
      <section className="dm-card">
        <header className="dm-head"><h3><Shield size={15} />Offshore interception</h3><span className="dm-meta">{group('offshore').filter((b) => isDeployed(b, state)).length} of {group('offshore').length} deployed</span></header>
        {list('offshore')}
      </section>
      <section className="dm-card">
        <header className="dm-head"><h3><Waves size={15} />Shoreline protection</h3><span className="dm-meta">{group('shoreline').length ? `${group('shoreline').filter((b) => isDeployed(b, state)).length} of ${group('shoreline').length} deployed` : 'none needed'}</span></header>
        {group('shoreline').length ? list('shoreline') : <p className="fc-note">No coast within reach of the forecast; no shoreline booms are planned.</p>}
      </section>
      <Card icon={ShieldCheck} title="Conditions for booming">
        <dl className="dm-rows rs-2col">
          <div><dt>Sea state (Hs)</dt><dd className="num">{f1(waveM)} m {plan.feasible.hsOk ? <Pill v="OK" /> : <Pill v="Too high" />}</dd></div>
          <div><dt>Wind</dt><dd className="num">{plan.feasible.windKt.toFixed(0)} kt {plan.feasible.windOk ? <Pill v="OK" /> : <Pill v="Too high" />}</dd></div>
          <div><dt>Current</dt><dd className="num">{f1(curKt)} kt</dd></div>
          <div><dt>Entrainment</dt><dd>{curKt > 0.7 ? 'Above 0.7 kt: angle the boom' : 'Low'}</dd></div>
        </dl>
      </Card>
      {firstShore !== undefined && <section className="dm-card rs-banner"><AlertTriangle size={16} /><span><b>Slick approaching the coast</b><small>First shore contact forecast at +{firstShore} h.</small></span></section>}
    </>
  );
}

function AssetsPane({ plan, t, t0, state, setState, picked, setPicked }: PaneProps) {
  const c = counts(plan, t, state);
  const rec = plan.recommend;
  const openId = picked && !picked.startsWith('boom:') ? picked : undefined;
  const assign = (id: string, on: boolean) => setState((x) => {
    const n = { ...x.assigned };
    if (on) n[id] = Date.now(); else delete n[id];
    return { ...x, assigned: n };
  });
  return (
    <>
      <section className="dm-card dm-hero"><div><h2>Response assets</h2><p>Every vessel in the plan. Open a row, or click a ship on the map, for its details; assign standby vessels from their row.</p></div><Badge claim="predicted">Plan</Badge></section>
      <section className="dm-tiles">
        <Tile label="On scene" value={String(c.scene)} tone="clear" note={`of ${c.total}`} /><Tile label="En route" value={String(c.route)} /><Tile label="Standby" value={String(c.standby)} /><Tile label="Unavailable" value={String(c.down)} tone={c.down ? 'critical' : undefined} />
      </section>
      {rec && (
        <section className="dm-card rs-rec">
          <header className="dm-head"><h3><Target size={15} />Recommended next</h3><Pill v="High priority" /></header>
          <p>Assign <b>{rec.a.name}</b> from {rec.staging} to <i>{rec.a.task.toLowerCase()}</i>: {f1(rec.km)} km, about {f1(rec.eta)} h.</p>
          <div className="rs-btns"><button type="button" className="is-primary" onClick={() => { assign(rec.a.id, true); setPicked(rec.a.id); }}><Send size={14} />Assign</button></div>
        </section>
      )}
      <section className="dm-card">
        <header className="dm-head"><h3><Ship size={15} />Fleet</h3><span className="dm-meta">{c.total} vessels</span></header>
        <ul className="rs-accs">
          {plan.assets.map((a) => {
            const assigned = state.assigned[a.id] !== undefined;
            const s = assetStatus(a, t, assigned);
            const pos = assetAt(a, t);
            return (
              <Row key={a.id} id={a.id} open={openId === a.id} onToggle={(id) => setPicked(openId === id ? undefined : id)}
                dot={COLOUR[s]} title={a.name} sub={a.task} pill={cap(s)}
                aside={s === 'en route' ? `ETA ${f1(a.arrive - t)} h` : s === 'standby' ? `${f1(a.distKm / (a.knots * 1.852))} h away` : undefined}>
                <dl className="dm-rows rs-2col">
                  <div><dt>Type</dt><dd>{cap(a.kind)}</dd></div>
                  <div><dt>Speed · crew</dt><dd className="num">{a.knots} kn · {a.crew}</dd></div>
                  <div><dt>Position</dt><dd className="num">{pos[1].toFixed(2)}° N, {pos[0].toFixed(2)}° E</dd></div>
                  <div><dt>Distance to task</dt><dd className="num">{f1(a.distKm)} km</dd></div>
                  <div><dt>ETA</dt><dd className="num">{a.arrive > 0 && a.arrive < 99 ? clockAt(t0, a.arrive) : s === 'on scene' ? 'On station' : '—'}</dd></div>
                  {a.note && <div><dt>Note</dt><dd>{a.note}</dd></div>}
                </dl>
                <div className="rs-btns">
                  {s === 'standby' && <button type="button" className="is-primary" onClick={() => assign(a.id, true)}><Send size={14} />Assign</button>}
                  {assigned && <button type="button" onClick={() => assign(a.id, false)}>Unassign</button>}
                </div>
              </Row>
            );
          })}
        </ul>
      </section>
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

function CleanupPane({ plan, firstShore, t0 }: PaneProps) {
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
      <Card icon={MapPin} title="Planned stations" meta={<span className="dm-meta">{many(plan.stations.length, 'station')}</span>}>
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
