/**
 * The live 50 m run, off the main thread. Steps GlobeMaster to the horizon and
 * posts a composited frame every FRAME_MIN model-minutes. Seeded, so the same
 * request always gives the same frames.
 */

import { GlobeMaster } from './engine';
import type { LonLat } from './engine';
import { applyForcing, composite, release, solverFor, statsOf, type LiveFrame } from './live';
import { loadLandRings } from './land';
import type { Forcing } from './forcing';

export interface LiveRequest { rings: LonLat[][]; volumeM3: number; forcing: Forcing; backward: boolean; hours: number }
export type LiveMessage = { kind: 'frame'; frame: LiveFrame } | { kind: 'done' } | { kind: 'failed'; detail: string };

export const FRAME_MIN = 5;
const post = (m: LiveMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function emit(g: GlobeMaster) {
  const img = composite(g);
  const stats = statsOf(g);
  const frame: LiveFrame = img
    ? { hour: g.t / 3600, ...img, stats }
    : { hour: g.t / 3600, width: 0, height: 0, bounds: [0, 0, 0, 0], pixels: new Uint8ClampedArray(0), stats };
  post({ kind: 'frame', frame }, [frame.pixels.buffer]);
}

self.onmessage = async (event: MessageEvent<LiveRequest>) => {
  const req = event.data;
  const land = await loadLandRings().catch(() => [] as LonLat[][]);
  const g = new GlobeMaster(solverFor(50));
  applyForcing(g, req.forcing, req.backward);
  g.setLand(land);
  const problem = release(g, req.rings, req.volumeM3);
  if (problem) { post({ kind: 'failed', detail: problem }); return; }
  emit(g);
  for (let k = 1; k * FRAME_MIN <= req.hours * 60; k++) {
    const target = k * FRAME_MIN * 60;
    while (g.t < target && !g.halted) g.step(Math.min(60, target - g.t));
    if (g.halted) { post({ kind: 'failed', detail: g.halted }); return; }
    emit(g);
  }
  post({ kind: 'done' });
};
