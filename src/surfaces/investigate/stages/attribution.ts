/**
 * Who released the oil: one attribution, used by every page.
 *
 * A funnel from every vessel on AIS to a ranked shortlist, each step with its
 * reason, then one score over five named features:
 *
 *   filter 1  space   never within SPACE_KM of the traced oil in the release window
 *   filter 2  time    no AIS position inside the release window at all
 *   filter 3  moving  at anchor or berth (< 0.5 kn) the whole window
 *
 *   proximity  how close it came to the backward-traced oil, at the same hour
 *   timing     whether that pass falls inside the release window the slick's age allows
 *   heading    whether it was travelling along the trace (a moving source leaves a streak)
 *   behaviour  anomalies near the pass: AIS silence, loitering, speed drop, sharp turn
 *   type       what it could plausibly discharge (tanker > cargo > tug > fishing)
 *
 * score = 0.35 proximity + 0.20 timing + 0.10 heading + 0.25 behaviour + 0.10 type.
 * Share of attribution = score over the sum of all candidates' scores.
 *
 * ponytail: hand-set weights on interpretable features. Calibrating them on
 * labelled cases (CleanSeaNet follow-ups) is the upgrade.
 */

import { useEffect, useMemo, useState } from 'react';
import type { SlickFeature } from '../../../api/slicks';
import type { Environment, Incident } from '../../../incidents/types';
import { fetchEnvironment } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import { fromEnvironment, SYNTHETIC, type Forcing } from '../../../forecast/forcing';
import { estimateAge, type AgeEstimate } from '../../../forecast/age';
import { releaseRings } from '../../../forecast/useForecastRun';
import type { OutlineStep } from '../../../forecast/outline.worker';
import type { BacktrackMessage, BacktrackRequest } from '../../../forecast/backtrack.worker';
import { bearingOf, kmBetween, vesselAt, type MapVessel, type Pt } from './mapData';

export const WEIGHTS = { proximity: 0.35, timing: 0.2, heading: 0.1, behaviour: 0.25, type: 0.1 } as const;
export type Feature = keyof typeof WEIGHTS;
export const FEATURE_LABEL: Record<Feature, string> = { proximity: 'Proximity to traced oil', timing: 'Timing vs release window', heading: 'Travelling along the trace', behaviour: 'Behavioural anomalies', type: 'Vessel type' };
const SPACE_KM = 25;

export interface Suspect {
  v: MapVessel;
  excluded?: string;
  features: Record<Feature, number>;
  flags: string[];
  pass?: { h: number; km: number };
  score: number;
  share: number;
  rank?: number;
}
export interface FunnelStep { label: string; kept: number; removed: number; reason?: string }
export interface Attribution { suspects: Suspect[]; ranked: Suspect[]; funnel: FunnelStep[]; window: [number, number]; ready: boolean }

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Forcing for a slick: measured when the bundle has it, else the slick's seeded scenario. */
export function useSlickForcing(slick: SlickFeature, incident: Incident | undefined, incidentId: string | undefined): Forcing {
  const p = slick.properties;
  const env = useArtifact<Environment>(incidentId, fetchEnvironment);
  const centre = Array.isArray(p.centroid) ? { lon: Number(p.centroid[0]), lat: Number(p.centroid[1]) } : incident?.centre ?? { lon: 0, lat: 0 };
  const t0 = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(String(p.observedAt));
  return useMemo(() => {
    const measured = fromEnvironment(env && env !== 'error' ? env : undefined, centre, t0);
    if (measured) return measured;
    const h = hashOf(slick.id);
    const windFrom = (h * 37) % 360, wind = 4.5 + (h % 50) / 10, curTo = (h * 53) % 360, cur = 0.12 + (h % 25) / 100;
    return { ...SYNTHETIC, windSpeed: wind, windDirDeg: (windFrom + 180) % 360, driftU: cur * Math.sin((curTo * Math.PI) / 180), driftV: cur * Math.cos((curTo * Math.PI) / 180) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, slick.id]);
}

/** The reverse-time ensemble's hourly centres, for pages that do not draw it. */
export function useBacktrace(slick: SlickFeature, forcing: Forcing, hours = 24): OutlineStep[] {
  const [steps, setSteps] = useState<OutlineStep[]>([]);
  const key = `${slick.id}|${forcing.windSpeed}|${forcing.windDirDeg}|${forcing.driftU}|${forcing.driftV}`;
  useEffect(() => {
    setSteps([]);
    const rings = releaseRings(slick.geometry);
    if (!rings.length) return;
    const w = new Worker(new URL('../../../forecast/backtrack.worker.ts', import.meta.url), { type: 'module' });
    const acc: OutlineStep[] = [];
    w.onmessage = (e: MessageEvent<BacktrackMessage>) => {
      if (e.data.kind === 'step') acc.push(e.data.step);
      else setSteps([...acc]); // publish once, complete: a partial trace would reorder the ranking
    };
    w.postMessage({ rings, forcing, hours, seed: hashOf(slick.id) } satisfies BacktrackRequest);
    return () => w.terminate();
  }, [key]);
  return steps;
}

const TYPE_PRIOR: Record<string, number> = { tanker: 1, gas: 0.8, bulk: 0.6, container: 0.6, cargo: 0.6, tug: 0.4, other: 0.4, fishing: 0.3 };

export function attribute(vessels: MapVessel[], centre: Pt, trace: OutlineStep[], age: AgeEstimate): Attribution {
  const ready = trace.length > 0;
  // Release window, hours before the pass: the age band with an hour of slack.
  const window: [number, number] = [-(age.highH + 1), -Math.max(0, age.lowH - 1)];
  const traceAt = (h: number): Pt => {
    if (!trace.length) return centre;
    const k = Math.floor(-h), f = -h - k;
    const a = trace.find((x) => x.hour === -k) ?? trace[trace.length - 1];
    const b = trace.find((x) => x.hour === -k - 1);
    return b ? [a.centre[0] + (b.centre[0] - a.centre[0]) * f, a.centre[1] + (b.centre[1] - a.centre[1]) * f] : (a.centre as Pt);
  };
  const traceBearing = (h: number) => bearingOf(traceAt(h), traceAt(h + 1));

  const suspects: Suspect[] = vessels.map((v) => {
    const first = v.points[0]?.t ?? 0, last = v.points[v.points.length - 1]?.t ?? 0;
    const flags: string[] = [];
    const zero = { proximity: 0, timing: 0, heading: 0, behaviour: 0, type: 0 };
    // Hours this vessel was observed, anywhere back to the trace's start.
    const lo = Math.max(first, -(trace.length ? trace.length - 1 : 24)), hi = Math.min(last, 0);
    let pass: { h: number; km: number } | undefined;
    let movingInWindow = false, seenInWindow = false;
    for (let h = hi; h >= lo; h -= 0.25) {
      const s = vesselAt(v, h);
      const km = kmBetween(s.at, traceAt(h));
      if (!pass || km < pass.km) pass = { h, km };
      if (h >= window[0] && h <= window[1]) { seenInWindow = true; if (s.knots > 0.5) movingInWindow = true; }
    }
    // Filters, in funnel order.
    const minInWindow = (() => {
      let m = Infinity;
      for (let h = Math.min(hi, window[1]); h >= Math.max(lo, window[0]); h -= 0.25) m = Math.min(m, kmBetween(vesselAt(v, h).at, traceAt(h)));
      return m;
    })();
    let excluded: string | undefined;
    if (!seenInWindow) excluded = 'No AIS in the release window';
    else if (minInWindow > SPACE_KM) excluded = `Never within ${SPACE_KM} km of the traced oil`;
    else if (!movingInWindow) excluded = 'At anchor or berth the whole window';
    if (excluded) return { v, excluded, features: zero, flags, pass, score: 0, share: 0 };

    // Features.
    const proximity = Math.exp(-(pass?.km ?? SPACE_KM) / 5);
    const ph = pass?.h ?? 0;
    const outside = ph < window[0] ? window[0] - ph : ph > window[1] ? ph - window[1] : 0;
    const timing = Math.exp(-outside / 3);
    const at = vesselAt(v, ph);
    const align = Math.abs(Math.cos(((at.heading - traceBearing(ph)) * Math.PI) / 180));
    const heading = at.knots > 0.5 ? align : 0.3;
    // Anomalies only count where the oil was: a silence 20 km away says nothing about this slick.
    const NEAR = 10;
    const near = (h: number) => kmBetween(vesselAt(v, h).at, traceAt(h)) <= NEAR;
    let behaviour = 0;
    const gap = v.gaps.find(([g0, g1]) => g1 >= window[0] - 1 && g0 <= window[1] + 1 && (near(g0) || near(g1)));
    if (gap) { behaviour += 0.5; flags.push(`AIS silent ${Math.round((gap[1] - gap[0]) * 60)} min near the trace`); }
    let slow = 0;
    for (let h = Math.max(lo, ph - 2); h <= Math.min(hi, ph + 2); h += 0.25) if (vesselAt(v, h).knots < 3 && kmBetween(vesselAt(v, h).at, traceAt(h)) < 10) slow += 0.25;
    if (slow >= 0.5) { behaviour += 0.3; flags.push(`Loitered ${slow.toFixed(1)} h near the trace`); }
    const before = vesselAt(v, Math.max(lo, ph - 1)), after = vesselAt(v, Math.min(hi, ph + 1));
    const close = (pass?.km ?? 99) <= NEAR;
    if (close && before.knots > 4 && at.knots < before.knots * 0.5) { behaviour += 0.2; flags.push(`Slowed ${before.knots.toFixed(0)} → ${at.knots.toFixed(0)} kn at the pass`); }
    const turn = Math.abs(((after.heading - before.heading + 540) % 360) - 180);
    if (close && turn > 45 && after.knots > 1) { behaviour += 0.2; flags.push(`Turned ${turn.toFixed(0)}° near the pass`); }
    behaviour = Math.min(1, behaviour);
    const type = TYPE_PRIOR[v.kind] ?? 0.4;
    const features = { proximity, timing, heading, behaviour, type };
    const score = (Object.keys(WEIGHTS) as Feature[]).reduce((s, k) => s + WEIGHTS[k] * features[k], 0);
    return { v, features, flags, pass, score, share: 0 };
  });

  const candidates = suspects.filter((s) => !s.excluded);
  const total = candidates.reduce((a, s) => a + s.score, 0) || 1;
  for (const s of candidates) s.share = s.score / total;
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  ranked.forEach((s, i) => (s.rank = i + 1));

  const count = (r: string) => suspects.filter((s) => s.excluded === r).length;
  const n0 = vessels.length;
  const r1 = count('No AIS in the release window');
  const r2 = count(`Never within ${SPACE_KM} km of the traced oil`);
  const r3 = count('At anchor or berth the whole window');
  const funnel: FunnelStep[] = [
    { label: 'On AIS around the pass', kept: n0, removed: 0 },
    { label: 'Seen in the release window', kept: n0 - r1, removed: r1, reason: 'no AIS positions in the window' },
    { label: `Within ${SPACE_KM} km of the traced oil`, kept: n0 - r1 - r2, removed: r2, reason: 'too far from where the oil was' },
    { label: 'Under way', kept: n0 - r1 - r2 - r3, removed: r3, reason: 'at anchor or berth throughout' },
    { label: 'Scored and ranked', kept: ranked.length, removed: 0 },
  ];
  return { suspects, ranked, funnel, window, ready };
}

/** Vessels with rank and score rewritten from the attribution, so every view reads the same. */
export function useAttribution(vessels: MapVessel[] | undefined, slick: SlickFeature, incident: Incident | undefined, incidentId: string | undefined, centre: Pt) {
  const forcing = useSlickForcing(slick, incident, incidentId);
  const age = useMemo(() => estimateAge({ areaM2: Number(slick.properties.areaM2) || 0, windMs: forcing.windSpeed }), [slick.id, forcing.windSpeed]);
  const trace = useBacktrace(slick, forcing);
  // No ranking until the trace is complete: ranking against the slick's own position would name the wrong ships.
  const tracing = trace.length === 0;
  const result = useMemo(() => (vessels && !tracing ? attribute(vessels, centre, trace, age) : undefined), [vessels, trace, age, tracing]);
  const ranked = useMemo(() => (tracing ? vessels?.map((v) => ({ ...v, rank: undefined, score: undefined, share: undefined })) : result?.suspects.map((s) => ({ ...s.v, rank: s.rank, score: s.score, share: s.share, excluded: s.excluded, flags: s.flags, features: s.features, pass: s.pass }))), [result, tracing, vessels]);
  return { result, vessels: ranked, age, forcing, trace, tracing };
}
