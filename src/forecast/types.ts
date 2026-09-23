/** The worker protocol. Shared by both sides, owned by neither. */

import type { LonLat } from './engine';
import type { Forcing } from './forcing';

export interface RunRequest {
  /** The outer ring of each part of the detection, lon/lat. */
  rings: LonLat[][];
  /** For the whole detection; shared between parts by area. */
  volumeM3: number;
  forcing: Forcing;
}

/** To the worker: build the run, then keep it told where the clock is. */
export type WorkerInput =
  | { kind: 'start'; request: RunRequest; hour: number }
  | { kind: 'seek'; hour: number };

export interface RunFrame {
  /** Hours since the detection. */
  hour: number;
  /** The grid this frame was computed on, metres per cell. */
  dx: number;
  /** One byte per cell, row-major from the top-left; see `encodeThickness`. Empty when no oil is visible. */
  codes: Uint8Array;
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
  /** Sea covered per Bonn band, km², in legend order. */
  areasKm2: number[];
  budget: {
    released: number;
    evaporated: number;
    dispersed: number;
    /** Against the real 1:50m coastline. */
    stranded: number;
    /** What is still on the surface, measured from the field. */
    afloat: number;
  };
}

export type RunMessage =
  | { kind: 'started'; dx: number; coast: boolean; unplaced: number }
  /** The field at the model's current time; the worker keeps no others. */
  | { kind: 'frame'; frame: RunFrame }
  | { kind: 'failed'; detail: string };
