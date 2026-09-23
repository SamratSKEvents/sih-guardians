/**
 * Run MASTER for one detection, live, following the clock.
 *
 * The worker keeps one simulation and no history. This hook tells it where the
 * clock is and shows whatever field it last sent: while playing, the model
 * steps alongside; scrubbing back makes it recompute from t = 0. The model is
 * seeded, so a moment recomputed is the same field it was the first time.
 *
 * Frames stay as the worker's byte codes. The chart uploads the one on screen
 * straight into a GPU texture; nothing is ever encoded as an image.
 */

import { useEffect, useRef, useState } from 'react';
import type { GeoPolygon } from '../api/slicks';
import type { LonLat } from './engine';
import type { Forcing } from './forcing';
import type { RunFrame, RunMessage, RunRequest, WorkerInput } from './types';

export interface RunState {
  /** The field at the model's current time, or undefined before the first. */
  frame: RunFrame | undefined;
  /** Whether the model is behind the clock and stepping to catch up. */
  catching: boolean;
  /** The model's own sentence when it could not run. */
  failed: string | undefined;
  /** The grid, metres per cell. */
  dx: number | undefined;
  /** Whether the coastline loaded; without it the run is open water only. */
  coast: boolean | undefined;
  /** Share of the detected area the model could not place (parts over its memory budget). */
  unplaced: number | undefined;
}

/**
 * The outer ring of every part, lon/lat. A detection is often several
 * fragments, and each one is released with its share of the oil; holes are
 * left out, as the model takes filled polygons.
 */
export function releaseRings(geometry: GeoPolygon | null): LonLat[][] {
  if (!geometry) return [];
  const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as number[][][][];
  return polygons
    .map((polygon) => polygon[0])
    .filter((ring) => Array.isArray(ring) && ring.length > 2)
    .map((ring) => ring.map(([lon, lat]) => [lon, lat] as LonLat));
}

export function useForecastRun(request: RunRequest | undefined, hoursIn: number): RunState {
  const [frame, setFrame] = useState<RunFrame>();
  const [failed, setFailed] = useState<string>();
  const [dx, setDx] = useState<number>();
  const [coast, setCoast] = useState<boolean>();
  const [unplaced, setUnplaced] = useState<number>();
  const worker = useRef<Worker | undefined>(undefined);
  const hourRef = useRef(hoursIn);
  hourRef.current = hoursIn;
  // The request is rebuilt every render by its caller; only its contents matter.
  const key = request ? JSON.stringify(request) : '';

  useEffect(() => {
    setFrame(undefined);
    setFailed(undefined);
    setDx(undefined);
    setCoast(undefined);
    setUnplaced(undefined);
    if (!request) return;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event: MessageEvent<RunMessage>) => {
      const message = event.data;
      if (message.kind === 'started') {
        setDx(message.dx);
        setCoast(message.coast);
        setUnplaced(message.unplaced);
      } else if (message.kind === 'frame') {
        setFrame(message.frame);
      } else {
        setFailed(message.detail);
      }
    };
    w.onerror = () => setFailed('The drift model stopped before it produced a frame.');
    w.postMessage({ kind: 'start', request, hour: hourRef.current } satisfies WorkerInput);
    return () => {
      // Its simulation is for a record the operator has already left.
      w.terminate();
      worker.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    worker.current?.postMessage({ kind: 'seek', hour: hoursIn } satisfies WorkerInput);
  }, [hoursIn]);

  const catching = !failed && !!request && (!frame || Math.abs(frame.hour - hoursIn) > 1 / 60);
  return { frame, catching, failed, dx, coast, unplaced };
}

export type { Forcing };
