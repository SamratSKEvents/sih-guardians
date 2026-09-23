/**
 * One MASTER run per record, shared by the stages that read it.
 *
 * Forecast scrubs this run with the clock. Impact reads the same request run
 * straight to the horizon; the model is seeded, so both agree wherever they
 * overlap.
 *
 * `enabled` keeps it honest about cost. The run does not start because a
 * record was opened; it starts when a stage that needs it is on screen.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SlickFeature } from '../api/slicks';
import type { Environment, Incident } from '../incidents/types';
import { fetchEnvironment } from '../api/incidents';
import { useArtifact } from '../incidents/useArtifact';
import { useTimeline, type TimelineState } from '../design/components';
import { forcingFor, type Forcing } from './forcing';
import { releaseRings, useForecastRun, type RunState } from './useForecastRun';
import type { RunFrame, RunRequest } from './types';

/** How far the clock goes. */
export const HOURS = 24;

/**
 * Oil per square metre of detected slick.
 *
 * A SAR detection gives an area, never a volume: backscatter says the surface
 * is flattened, not how much oil is doing it. The model needs a volume, so one
 * is assumed, and it is shown to the operator as an assumption rather than
 * folded silently into the result. 50 µm is the Bonn metallic/true-colour
 * boundary — a mid-range mean for a slick thick enough to detect at all.
 *
 * ponytail: one constant for every record. If a thickness retrieval ever lands
 * in a bundle, take it from there per record instead.
 */
export const ASSUMED_MEAN_UM = 50;

export interface ForecastContext {
  /** What the model is run on, whether or not a stage is running it. Impact runs its own copy to the horizon. */
  request: RunRequest | undefined;
  run: RunState;
  forcing: Forcing;
  timeline: TimelineState;
  /** Hours since the detection, where the clock is now. */
  hoursIn: number;
  /**
   * The same model run straight to the horizon, for Impact's result and for
   * framing: nobody can know where the oil goes before the model gets there.
   */
  horizon: RunState;
  /** [west, south, east, north] the oil covers over the whole horizon, once the horizon run has finished. */
  reach: [number, number, number, number] | undefined;
  /** The field the model last computed; the clock may be ahead of it while it catches up. */
  frame: RunFrame | undefined;
  observedAt: number;
  areaM2: number;
  volumeM3: number;
}

const Context = createContext<ForecastContext | undefined>(undefined);

/** The shared run. Throws rather than return a fake: a stage that asks for the
 * run outside the provider is a wiring mistake, not a missing dataset. */
export function useForecast(): ForecastContext {
  const value = useContext(Context);
  if (!value) throw new Error('useForecast outside ForecastProvider');
  return value;
}

export function ForecastProvider({
  slick,
  incident,
  incidentId,
  enabled,
  horizonEnabled,
  children,
}: {
  slick: SlickFeature;
  incident: Incident | undefined;
  incidentId: string | undefined;
  /** Whether Forecast, which plays the clocked run, is on screen. */
  enabled: boolean;
  /** Whether a stage that needs the horizon run (Forecast or Impact) is on screen. */
  horizonEnabled: boolean;
  children: ReactNode;
}) {
  const environment = useArtifact<Environment>(incidentId, fetchEnvironment);
  const p = slick.properties;

  const centre = useMemo(() => {
    const c = p.centroid;
    return Array.isArray(c) ? { lon: Number(c[0]), lat: Number(c[1]) } : incident?.centre;
  }, [p.centroid, incident?.centre]);

  const measuredAt = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : undefined;
  const observedAt = measuredAt ?? Date.parse(String(p.observedAt));

  const forcing = useMemo(
    () => forcingFor(environment === 'error' ? undefined : environment, centre ?? { lon: 0, lat: 0 }, observedAt),
    [environment, centre, observedAt],
  );

  const areaM2 = Number(p.areaM2) || 0;
  const volumeM3 = (areaM2 * ASSUMED_MEAN_UM) / 1e6;

  const request = useMemo(() => {
    if (!slick.geometry || volumeM3 <= 0) return undefined;
    const rings = releaseRings(slick.geometry);
    if (rings.length === 0) return undefined;
    return { rings, volumeM3, forcing };
  }, [slick.geometry, volumeM3, forcing]);

  const timeline = useTimeline(observedAt, observedAt + HOURS * 3_600_000);
  const hoursIn = (timeline.time - observedAt) / 3_600_000;

  // Opening Forecast plays the run from the detection; leaving it stops the
  // clock, so it is not mid-horizon the next time the stage opens.
  useEffect(() => {
    if (enabled) {
      timeline.setTime(timeline.start);
      if (!timeline.playing) timeline.togglePlay();
    } else timeline.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  const run = useForecastRun(enabled ? request : undefined, hoursIn);
  const horizon = useForecastRun(horizonEnabled ? request : undefined, HOURS);

  // Everywhere the horizon run's oil goes, gathered from every frame it
  // passes through and published once, when it finishes: one reframe, early,
  // never a camera that follows the oil around.
  const [reach, setReach] = useState<ForecastContext['reach']>();
  const box = useRef([Infinity, Infinity, -Infinity, -Infinity]);
  useEffect(() => {
    box.current = [Infinity, Infinity, -Infinity, -Infinity];
    setReach(undefined);
  }, [request]);
  useEffect(() => {
    const f = horizon.frame;
    if (!f || f.codes.length === 0) return;
    const b = box.current;
    box.current = [Math.min(b[0], f.west), Math.min(b[1], f.south), Math.max(b[2], f.east), Math.max(b[3], f.north)];
    if (!horizon.catching) setReach((current) => current ?? (box.current as ForecastContext['reach']));
  }, [horizon.frame, horizon.catching]);
  const frame = run.frame;

  const value = useMemo(
    () => ({ request, run, horizon, reach, forcing, timeline, hoursIn, frame, observedAt, areaM2, volumeM3 }),
    [request, run, horizon, reach, forcing, timeline, hoursIn, frame, observedAt, areaM2, volumeM3],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
