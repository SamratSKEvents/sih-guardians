/**
 * Response plan, computed from the forecast.
 *
 * Every number here derives from the drift runs (outlines, coast arrival
 * times, drift direction) and the forcing; the fleet, platforms and staging
 * are mock, placed at the nearest coastal towns. Deterministic per slick, so
 * the plan reads the same on every visit. The operator's own actions (assign,
 * acknowledge, resolve) live in `PlanState` and persist in the browser.
 */

import type { LonLat } from '../../../forecast/engine';
import type { OutlineStep, CoastPoint } from '../../../forecast/outline.worker';
import type { Forcing } from '../../../forecast/forcing';
import { bearingOf, kmBetween, move, type Pt } from './mapData';

export interface PlanState { assigned: Record<string, number>; acked: string[]; resolved: string[] }
export const EMPTY_STATE: PlanState = { assigned: {}, acked: [], resolved: [] };

export type AssetKind = 'boom' | 'skimmer' | 'response' | 'tug' | 'supply' | 'sampling';
export type AssetStatus = 'on scene' | 'en route' | 'standby' | 'unavailable';
export interface Asset {
  id: string; name: string; kind: AssetKind; knots: number; crew: number; home: Pt; target: Pt; task: string;
  status0: AssetStatus; depart: number; arrive: number; distKm: number; note?: string;
}
export interface Boom { id: 'A' | 'B'; line: Pt[]; lengthKm: number; centre: Pt; atH: number; recommended: boolean; reason: string; vessel?: string; readyH: number }
export interface Mission { id: string; name: string; objective: string; platform: string; callsign: string; sensors: string; box: Pt[]; route: Pt[]; start: number; end: number; kind: 'plane' | 'drone' }
export interface Station { id: string; role: string; at: Pt; priority: 'High' | 'Medium'; why: string; arrive: number }
export interface Zone { id: string; name: string; shore: string; pts: Pt[]; first: number | null; km: number; priority: 'Immediate' | 'High' | 'Moderate' | 'Watch'; access: string }
export interface Alert { id: string; title: string; severity: 'High' | 'Medium' | 'Low'; at: number; area: string; action: string; resolvedByDefault?: boolean; where?: Pt }
export interface Staging { name: string; at: Pt }

export type Plan = ReturnType<typeof buildPlan>;

const KN = 1.852;
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Position along a straight transit, hours relative to T0. */
export function assetAt(a: Asset, t: number): Pt {
  if (t <= a.depart) return a.home;
  const f = Math.min(1, (t - a.depart) / Math.max(1e-6, a.arrive - a.depart));
  return [a.home[0] + (a.target[0] - a.home[0]) * f, a.home[1] + (a.target[1] - a.home[1]) * f];
}
export function assetStatus(a: Asset, t: number, assigned: boolean): AssetStatus {
  if (a.status0 === 'unavailable') return 'unavailable';
  if (a.status0 === 'standby' && !assigned) return 'standby';
  if (t >= a.arrive) return 'on scene';
  if (t > a.depart) return 'en route';
  return a.status0 === 'on scene' ? 'en route' : a.status0 === 'standby' ? 'standby' : 'en route';
}
export function alongRoute(route: Pt[], f: number): Pt {
  const segs = route.slice(1).map((p, i) => kmBetween(route[i], p));
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i]) { const k = left / (segs[i] || 1); return [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k]; }
    left -= segs[i];
  }
  return route[route.length - 1];
}

export function buildPlan(o: {
  slickId: string; centre: Pt; fwd: OutlineStep[]; coast: CoastPoint[]; forcing: Forcing; towns: { name: string; at: Pt }[];
  driftBearing: number; driftMs: number; firstShore?: number; firstAt?: LonLat; envelope: LonLat[]; waveM: number;
  receptors: { name: string; kind: string; at: Pt; first?: number; reach: number }[]; topVessel?: { name: string; gaps: [number, number][] };
  state: PlanState;
}) {
  const { centre, fwd, forcing } = o;
  const h = hash(o.slickId);
  const at = (hr: number): Pt => {
    const s = fwd.find((x) => x.hour === Math.round(hr));
    return s ? (s.centre as Pt) : move(centre, o.driftBearing, (o.driftMs * 3.6) * hr);
  };
  const width = (hr: number) => {
    const s = fwd.find((x) => x.hour === Math.round(hr));
    if (!s || s.hull.length < 3) return 1;
    const perp = o.driftBearing + 90;
    const proj = s.hull.map((q) => { const d = kmBetween(s.centre as Pt, q as Pt); const b = bearingOf(s.centre as Pt, q as Pt); return d * Math.sin(((b - perp + 90) * Math.PI) / 180); });
    return Math.max(0.6, Math.max(...proj) - Math.min(...proj));
  };

  /* ------------------------------------------------ staging, the nearest ports */
  const byDist = [...o.towns].sort((a, b) => kmBetween(a.at, centre) - kmBetween(b.at, centre));
  const staging: Staging[] = (byDist.length ? byDist.slice(0, 2) : [{ name: 'Forward base', at: move(centre, 270, 25) }]).map((t) => ({ name: `${t.name} staging`, at: t.at }));
  const port = staging[0].at;

  /* ------------------------------------------------------------- booms */
  const mkBoom = (id: 'A' | 'B', hr: number, ahead: number): Boom => {
    const c = move(at(hr), o.driftBearing, ahead);
    const L = Math.min(2.6, Math.max(0.8, width(hr) * 1.3));
    const line: Pt[] = [];
    for (let k = -1; k <= 1.0001; k += 0.2) {
      // U open towards the oil: ends upstream, apex downstream.
      const p = move(c, o.driftBearing + 90, (k * L) / 2);
      line.push(move(p, o.driftBearing, 0.22 * L * (1 - k * k)));
    }
    return { id, line, lengthKm: L, centre: c, atH: hr, recommended: false, reason: '', readyH: 0 };
  };
  const boomA = mkBoom('A', 4, 1);
  const boomB = mkBoom('B', 1.5, 0.3);

  /* ------------------------------------------------------------ assets */
  const names = ['Sagar Rakshak', 'Samudra Seva', 'Neel Kamal', 'Tarangini', 'Jal Prahari', 'Vikram Sea', 'Coastal Hope', 'Harbour Star'];
  const pick = (k: number) => names[(h + k) % names.length];
  const spec: [string, string, AssetKind, number, number, AssetStatus, Pt, string][] = [
    ['boom-1', 'Boom Vessel ' + pick(0), 'boom', 10, 9, 'en route', boomA.line[0], 'Tow Boom A, west end'],
    ['tug-1', 'Tug ' + pick(1), 'tug', 11, 6, 'en route', boomA.line[boomA.line.length - 1], 'Tow Boom A, east end'],
    ['skim-1', 'Skimmer 01', 'skimmer', 7, 5, 'on scene', move(boomA.centre, o.driftBearing + 180, 0.4), 'Recover oil at Boom A apex'],
    ['skim-2', 'Skimmer 02', 'skimmer', 7, 5, 'standby', move(at(8), o.driftBearing + 180, 0.5), 'Intercept forecast slick'],
    ['resp-1', 'Pollution Control Vessel 1', 'response', 14, 22, 'on scene', move(centre, o.driftBearing + 150, 1.2), 'On-scene command, dispersant standby'],
    ['resp-2', 'Response Vessel ' + pick(2), 'response', 12, 14, 'standby', move(at(12), o.driftBearing + 90, 1.5), 'Shadow the leading edge'],
    ['samp-1', 'Sampling Vessel ' + pick(3), 'sampling', 12, 6, 'standby', centre, 'Sampling stations'],
    ['sup-1', 'Supply Vessel ' + pick(4), 'supply', 10, 12, 'unavailable', move(centre, 200, 6), 'Mechanical fault, ETA unknown'],
  ];
  const assets: Asset[] = spec.map(([id, name, kind, knots, crew, status0, target, task], k) => {
    const home = status0 === 'on scene' ? target : status0 === 'en route' ? move(target, bearingOf(target, port) + ((k * 23) % 40) - 20, Math.min(kmBetween(target, port), 6 + k * 2)) : staging[k % staging.length].at;
    const distKm = kmBetween(home, target);
    const assigned = o.state.assigned[id] !== undefined;
    const depart = status0 === 'on scene' ? -1 : status0 === 'en route' ? 0 : assigned ? 0.25 : 999;
    const arrive = status0 === 'on scene' ? -1 : depart + distKm / (knots * KN);
    return { id, name, kind, knots, crew, home, target, task, status0, depart, arrive, distKm, note: status0 === 'unavailable' ? 'Mechanical issue, ETA unknown' : undefined };
  });

  // Boom readiness: when both tow vessels are on station.
  const tows = assets.filter((a) => a.id === 'boom-1' || a.id === 'tug-1');
  boomA.readyH = Math.max(...tows.map((a) => a.arrive));
  boomA.vessel = tows.map((a) => a.name).join(' + ');
  const bEta = Math.max(...tows.map((a) => a.depart + kmBetween(a.home, boomB.centre) / (a.knots * KN)));
  boomB.readyH = bEta;
  const hsOk = o.waveM < 1.2, windKt = forcing.windSpeed * 1.944, windOk = windKt < 20;
  boomA.recommended = boomA.readyH < boomA.atH && hsOk && windOk;
  boomA.reason = boomA.recommended
    ? `Oil reaches this line at +${boomA.atH} h; both tow vessels are on station by +${boomA.readyH.toFixed(1)} h, leaving ${(boomA.atH - boomA.readyH).toFixed(1)} h to deploy.`
    : !hsOk ? `Sea state ${o.waveM.toFixed(1)} m exceeds offshore boom limits (≈1.2 m).` : !windOk ? `Wind ${windKt.toFixed(0)} kt exceeds boom limits (≈20 kt).` : `Tow vessels arrive at +${boomA.readyH.toFixed(1)} h, after the oil passes at +${boomA.atH} h.`;
  boomB.reason = bEta > boomB.atH ? `Oil passes this line at +${boomB.atH} h, before tow vessels can arrive (+${bEta.toFixed(1)} h).` : 'Shorter reach; leaves the thick leading edge unprotected.';

  /* ---------------------------------------------------------- missions */
  const box = (c: Pt, along: number, across: number): Pt[] => {
    const b = o.driftBearing;
    const f = move(c, b, along / 2), r = move(c, b + 180, along / 2);
    return [move(f, b + 90, across / 2), move(f, b - 90, across / 2), move(r, b - 90, across / 2), move(r, b + 90, across / 2)];
  };
  const mower = (c: Pt, along: number, across: number, legs = 4): Pt[] => {
    const pts: Pt[] = [];
    for (let k = 0; k < legs; k++) {
      const off = -across / 2 + (across * (k + 0.5)) / legs;
      const a = move(move(c, o.driftBearing + 90, off), o.driftBearing + 180, along / 2 - 0.5);
      const b = move(move(c, o.driftBearing + 90, off), o.driftBearing, along / 2 - 0.5);
      pts.push(...(k % 2 ? [b, a] : [a, b]));
    }
    return pts;
  };
  const edge = at(12);
  const shore: Pt = (o.firstAt as Pt | undefined) ?? byDist[0]?.at ?? move(centre, o.driftBearing, 20);
  const missions: Mission[] = [
    { id: 'SURV-001', name: 'Edge verification', objective: 'Verify slick extent and the leading edge the forecast is least sure of.', platform: 'Dornier 228 (fixed-wing)', callsign: 'GUARD-01', sensors: 'SLAR, IR/UV, optical', kind: 'plane', box: box(edge, 14, 9), route: mower(edge, 14, 9), start: 0.5, end: 3 },
    { id: 'SURV-002', name: 'Shoreline assessment', objective: 'Assess the coast where oil first comes ashore.', platform: 'Quadcopter UAV', callsign: 'KITE-02', sensors: 'Optical, thermal', kind: 'drone', box: box(move(shore, bearingOf(shore, centre), 3), 7, 5), route: mower(move(shore, bearingOf(shore, centre), 3), 7, 5, 3), start: 2, end: 4.5 },
    { id: 'SURV-003', name: 'Wide-area monitoring', objective: 'Search the uncertainty envelope for secondary slicks.', platform: 'Dornier 228 (fixed-wing)', callsign: 'GUARD-03', sensors: 'SLAR, optical', kind: 'plane', box: box(at(18), 22, 14), route: mower(at(18), 22, 14, 5), start: 9, end: 12.5 },
  ];

  /* ---------------------------------------------------------- sampling */
  const s6 = fwd.find((x) => x.hour === 6);
  const perpEdge: Pt = s6?.hull.length ? (s6.hull.reduce((best, q) => (Math.abs(bearingOf(s6.centre as Pt, q as Pt) - (o.driftBearing + 90)) < Math.abs(bearingOf(s6.centre as Pt, best as Pt) - (o.driftBearing + 90)) ? q : best), s6.hull[0]) as Pt) : move(at(6), o.driftBearing + 90, 2);
  const curTo = ((Math.atan2(forcing.driftU, forcing.driftV) * 180) / Math.PI + 360) % 360;
  const raw: Omit<Station, 'arrive'>[] = [
    { id: 'S-1', role: 'Impact zone', at: at(6), priority: 'High', why: 'Inferred highest concentration' },
    { id: 'S-2', role: 'Coastal', at: move(shore, bearingOf(shore, centre), 0.8), priority: 'High', why: 'Near the first coast reached' },
    { id: 'S-3', role: 'Boundary', at: perpEdge, priority: 'Medium', why: 'Confirm the outer boundary' },
    { id: 'S-4', role: 'Down-current', at: at(12), priority: 'Medium', why: 'Down-current monitoring' },
    { id: 'B-1', role: 'Background', at: move(centre, curTo + 180, 8), priority: 'Medium', why: 'Clean background reference' },
  ];
  // Nearest-neighbour route from the port.
  const sampler = assets.find((a) => a.id === 'samp-1')!;
  const left = [...raw];
  const order: Omit<Station, 'arrive'>[] = [];
  let cur = sampler.home;
  while (left.length) { left.sort((a, b) => kmBetween(cur, a.at) - kmBetween(cur, b.at)); const n = left.shift()!; order.push(n); cur = n.at; }
  const sampAssigned = o.state.assigned['samp-1'] !== undefined;
  // Nothing is collected until the sampling vessel is assigned.
  let tCur = 0.25, pos = sampler.home;
  const stations: Station[] = order.map((s) => { tCur += kmBetween(pos, s.at) / (sampler.knots * KN) + 0.4; pos = s.at; return { ...s, arrive: sampAssigned ? tCur : 999 }; });
  const samplingRoute: Pt[] = [sampler.home, ...stations.map((s) => s.at)];

  /* ----------------------------------------------------------- cleanup */
  const hit = o.coast.filter((c) => c.hour !== null) as (CoastPoint & { hour: number })[];
  const pool: CoastPoint[] = hit.length ? hit : o.coast
    .map((c) => ({ ...c, d: Math.min(...o.envelope.map((q) => kmBetween(c.at as Pt, q as Pt)), Infinity) }))
    .filter((c) => c.d < 25).sort((a, b) => a.d - b.d).slice(0, 60);
  const clusters: CoastPoint[][] = [];
  for (const p of [...pool].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1])) {
    const c = clusters.find((cl) => cl.some((q) => kmBetween(q.at as Pt, p.at as Pt) < 3));
    if (c) c.push(p); else clusters.push([p]);
  }
  const SHORES = ['Sandy beach', 'Rocky shore', 'Mangrove fringe', 'Mudflat', 'Mixed shoreline', 'Harbour wall'];
  const zones: Zone[] = clusters.filter((c) => c.length >= 2).map((c, k) => {
    const mid = c[Math.floor(c.length / 2)].at as Pt;
    const town = [...o.towns].sort((a, b) => kmBetween(a.at, mid) - kmBetween(b.at, mid))[0];
    const first = hit.length ? Math.min(...c.map((q) => q.hour as number)) : null;
    const shoreType = SHORES[(h + k * 7) % SHORES.length];
    return {
      id: '', name: town ? `near ${town.name}` : 'coast', shore: shoreType, pts: c.map((q) => q.at as Pt), first, km: c.length * 1.05,
      priority: first === null ? 'Watch' : first <= 6 ? 'Immediate' : first <= 12 ? 'High' : 'Moderate',
      access: shoreType === 'Rocky shore' ? 'Rough surf and rocky terrain; boat access only' : shoreType === 'Mangrove fringe' ? 'Sensitive habitat; low-impact methods only' : shoreType === 'Mudflat' ? 'Soft ground; tracked vehicles and boardwalks' : 'Road access open',
    } satisfies Zone;
  }).sort((a, b) => (a.first ?? 99) - (b.first ?? 99) || b.km - a.km).slice(0, 6).map((z, k) => ({ ...z, id: `Zone ${'ABCDEF'[k]}` }));

  /* ------------------------------------------------------------ alerts */
  const windowH = Math.max(1, Math.min(o.firstShore ?? 24, boomA.atH + 8));
  const hitRec = o.receptors.find((r) => r.first !== undefined) ?? o.receptors.find((r) => r.reach < 10);
  const alerts: Alert[] = [];
  if (o.firstShore !== undefined) alerts.push({ id: 'shore', title: 'Shoreline impact risk', severity: o.firstShore <= 12 ? 'High' : 'Medium', at: -0.5, area: `${zones[0]?.name ?? 'Coast'} (${zones.reduce((s, z) => s + z.km, 0).toFixed(0)} km)`, action: 'Increase shoreline protection and stage cleanup teams.', where: shore });
  if (hitRec) alerts.push({ id: 'habitat', title: 'Sensitive habitat at risk', severity: hitRec.first !== undefined ? 'High' : 'Medium', at: 0.3, area: hitRec.name, action: 'Prioritise containment to limit spread toward the habitat.', where: hitRec.at });
  alerts.push({ id: 'window', title: 'Response window closing', severity: windowH <= 12 ? 'High' : 'Medium', at: 0.1, area: `Offshore, ${(fwd.find((x) => x.hour === Math.round(windowH))?.areaKm2 ?? 0).toFixed(1)} km²`, action: `Deploy containment within ${windowH.toFixed(0)} hours.`, where: boomA.centre });
  alerts.push({ id: 'supply', title: 'Asset unavailable', severity: 'Medium', at: -1.2, area: assets.find((a) => a.id === 'sup-1')!.name, action: 'Re-task a standby vessel for resupply.', where: assets.find((a) => a.id === 'sup-1')!.home });
  if (o.topVessel?.gaps.length) alerts.push({ id: 'ais', title: `AIS silence · ${o.topVessel.name}`, severity: 'Medium', at: o.topVessel.gaps[0][0], area: 'Source region', action: 'Request port-state inspection and sample the vessel on arrival.' });
  if (o.firstShore === undefined) alerts.push({ id: 'open', title: 'Drift toward open sea', severity: 'Low', at: -5, area: 'Offshore', action: 'Continue surveillance; no shoreline action yet.', resolvedByDefault: true });
  alerts.push({ id: 'deviation', title: 'Asset deviation detected', severity: 'Low', at: -7, area: assets[0].name, action: 'Route corrected.', resolvedByDefault: true });

  /* ------------------------------------------------------------ events */

  return {
    staging, boomA, boomB, booms: [boomA, boomB], assets, missions, stations, samplingRoute, zones, alerts, windowH,
    sampAssigned, feasible: { hsOk, windOk, windKt, waveM: o.waveM }, sampling: { start: sampAssigned ? 0.25 : 1, end: sampAssigned ? tCur : 1 + tCur },
    recommend: (() => {
      const free = assets.filter((a) => a.status0 === 'standby' && o.state.assigned[a.id] === undefined);
      const best = free.map((a) => ({ a, eta: kmBetween(a.home, a.target) / (a.knots * KN) })).sort((x, y) => x.eta - y.eta)[0];
      return best ? { ...best, km: kmBetween(best.a.home, best.a.target), staging: staging.find((s) => s.at === best.a.home)?.name ?? staging[0].name } : undefined;
    })(),
  };
}
