/**
 * The drift run, off the main thread, computed live.
 *
 * The model is `GlobeMaster` in its reduced scalar mode — the same solver the
 * standalone Slick Drift Lab runs. Its storage is sparse 64 x 64 blocks that
 * exist only where the oil is, so there is no domain edge for the slick to
 * leave by. The coast is real, the 1:50m Natural Earth land, and oil that
 * reaches it strands.
 *
 * Nothing is stored. The worker holds one simulation and the clock's position;
 * it steps the solver towards the clock and posts the field as it goes. Scrub
 * back and it resets to t = 0 and runs forward again. The model's seeds are
 * fixed, so the same moment is the same field every time: recomputed, not
 * remembered.
 *
 * One grid, 50 m: a quarter of a second of CPU per simulated hour, which keeps
 * up with playback. The Lab's 10 m grid costs about 30 s per hour and cannot.
 */

import { GlobeMaster, OPTIMISED_SOLVER } from './engine';
import type { GlobeBlock, GlobeRelease, GlobeSolver, LonLat } from './engine';
import { encodeThickness, BAND_LIMITS_UM } from './palette';
import { loadLandRings } from './land';
import type { RunRequest, RunFrame, RunMessage, WorkerInput } from './types';

const post = (message: RunMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

/* The Drift Lab's own settings: blocks live down to 0.05 µm, below the sheen
 * floor, and the solver refuses a release that would need more than 384 MB. */
const H_ALLOC = 5e-8;
const MEMORY_MB = 384;
/** Longest side of a stored frame, in pixels. Larger fields are averaged down. */
const MAX_PX = 1024;

const solverFor = (dx: number): GlobeSolver => ({
  ...OPTIMISED_SOLVER,
  dx,
  mode: 'reduced',
  hAlloc: H_ALLOC,
  filmDtScale: dx <= 10 ? 4 : 1,
  memoryMB: MEMORY_MB,
});

/** Area and perimeter of a lon/lat ring, in metres, on a local flat projection. */
function measureRing(ring: LonLat[]) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const lon0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const k = (Math.PI / 180) * 6_371_000;
  const xy = ring.map(([lon, lat]) => [(lon - lon0) * k * Math.cos(lat0 * (Math.PI / 180)), (lat - lat0) * k]);
  let twice = 0;
  let perimeter = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    twice += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
    perimeter += Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]);
  }
  return { area: Math.max(Math.abs(twice) / 2, 1), perimeter };
}

const DX = 50;
/** Longest stretch of solver work between yields, so a new clock position is heard promptly. */
const SLICE_MS = 12;
/** Least wall time between posted fields while catching up. */
const POST_MS = 33;

let globe: GlobeMaster | undefined;
let targetS = 0;
let loop: Promise<void> | undefined;

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const message = event.data;
  if (message.kind === 'start') {
    targetS = message.hour * 3600;
    start(message.request).catch((error: unknown) =>
      post({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) }),
    );
  } else {
    targetS = message.hour * 3600;
    loop ??= chase().finally(() => (loop = undefined));
  }
};

async function start(request: RunRequest) {
  const { rings, volumeM3, forcing } = request;
  // Largest part first: it is the one that must fit.
  const parts = rings.map((ring) => ({ ring, area: measureRing(ring).area })).sort((a, b) => b.area - a.area);
  const totalArea = parts.reduce((sum, part) => sum + part.area, 0);
  const releases: GlobeRelease[] = parts.map(({ ring, area }) => ({ ring, volumeM3: (volumeM3 * area) / totalArea, profile: 'dome' }));

  // Without a coast the run is still valid open-water physics, so a failed
  // download degrades the run and says so rather than stopping it.
  let land: LonLat[][] = [];
  let coast = true;
  try {
    land = await loadLandRings();
  } catch {
    coast = false;
  }

  const g = new GlobeMaster(solverFor(DX));
  g.params.windSpeed = forcing.windSpeed;
  g.params.windDirDeg = forcing.windDirDeg;
  g.params.driftU = forcing.driftU;
  g.params.driftV = forcing.driftV;
  g.setLand(land);
  const refused = g.addOil(releases[0], true);
  if (refused) {
    post({ kind: 'failed', detail: refused });
    return;
  }
  // The other fragments join the same spill area. One over the budget is left
  // out and counted, never shrunk: the budget reports what was placed.
  let unplacedArea = 0;
  for (let k = 1; k < releases.length; k++) if (g.addOil(releases[k], false)) unplacedArea += parts[k].area;

  globe = g;
  post({ kind: 'started', dx: DX, coast, unplaced: unplacedArea / totalArea });
  emit(g);
  loop ??= chase().finally(() => (loop = undefined));
}

/** Step towards the clock, yielding between slices so a newer position can arrive. */
async function chase() {
  let posted = performance.now();
  while (globe && !globe.halted) {
    const g = globe;
    if (targetS < g.t) {
      g.reset();
      emit(g);
    }
    if (g.t >= targetS) return;
    const sliceEnd = performance.now() + SLICE_MS;
    // 60 s is the solver's own largest sub-step; it subcycles the film inside.
    while (g.t < targetS && performance.now() < sliceEnd && !g.halted) g.step(Math.min(60, targetS - g.t));
    if (g.halted) {
      post({ kind: 'failed', detail: g.halted });
      return;
    }
    if (g.t >= targetS || performance.now() - posted >= POST_MS) {
      emit(g);
      posted = performance.now();
    }
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const halo = new Float32Array(66 * 66);

/**
 * Every visible block onto one grid, averaged down to MAX_PX, then coded.
 *
 * The blocks sit on the spill's stereographic plane and the frame is drawn on a
 * lon/lat rectangle; across a slick a few tens of km wide the two differ by
 * well under a cell, which is the same approximation the Drift Lab draws with.
 */
function emit(globe: GlobeMaster) {
  const hour = globe.t / 3600;
  const { blocks, B } = globe.view(true, null, false);
  const budget = globe.budget();
  const cellM2 = globe.solver.dx * globe.solver.dx;
  const areasKm2 = BAND_LIMITS_UM.map(() => 0);

  const frame: RunFrame = {
    hour,
    dx: globe.solver.dx,
    codes: new Uint8Array(0),
    width: 0,
    height: 0,
    west: 0,
    south: 0,
    east: 0,
    north: 0,
    areasKm2,
    budget: {
      released: budget.released,
      evaporated: budget.evaporated,
      dispersed: budget.dispersed,
      stranded: budget.stranded,
      afloat: globe.floating(),
    },
  };

  if (blocks.length > 0) {
    let bi0 = Infinity, bi1 = -Infinity, bj0 = Infinity, bj1 = -Infinity;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const b of blocks) {
      bi0 = Math.min(bi0, b.bi); bi1 = Math.max(bi1, b.bi);
      bj0 = Math.min(bj0, b.bj); bj1 = Math.max(bj1, b.bj);
      for (const [lon, lat] of b.corners) {
        west = Math.min(west, lon); east = Math.max(east, lon);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
    }
    const fullW = (bi1 - bi0 + 1) * B;
    const fullH = (bj1 - bj0 + 1) * B;
    const c = Math.ceil(Math.max(fullW, fullH) / MAX_PX);
    const width = Math.ceil(fullW / c);
    const height = Math.ceil(fullH / c);
    const sum = new Float32Array(width * height);
    const smooth = globe.solver.dx >= 50 ? 0.22 : globe.solver.dx > 10 ? 0.14 : 0;
    const row = B + 2;

    for (const b of blocks as GlobeBlock[]) {
      globe.blockThickness(b, halo);
      for (let j = 0; j < B; j++) {
        // Solver rows run north from the block's south edge; image rows run
        // south from the top. Flip both, or the slick mirrors about its centre.
        const y = Math.floor(((bj1 - b.bj) * B + (B - 1 - j)) / c);
        for (let i = 0; i < B; i++) {
          const k = (j + 1) * row + i + 1;
          const h = halo[k];
          for (let band = 0; band < BAND_LIMITS_UM.length; band++) {
            if (h * 1e6 < BAND_LIMITS_UM[band]) {
              if (band > 0 || h * 1e6 >= 0.04) areasKm2[band] += cellM2 / 1e6;
              break;
            }
          }
          // The Drift Lab's display blend, so a 25/50 m grid does not read as
          // a mosaic. Display only: the budget above is the raw field.
          const shown = smooth
            ? h * (1 - smooth) +
              ((halo[k - row - 1] + halo[k - row] + halo[k - row + 1] + halo[k - 1] + halo[k + 1] +
                halo[k + row - 1] + halo[k + row] + halo[k + row + 1]) / 8) * smooth
            : h;
          sum[y * width + Math.floor(((b.bi - bi0) * B + i) / c)] += shown;
        }
      }
    }
    const codes = new Uint8Array(width * height);
    const inv = 1 / (c * c);
    for (let p = 0; p < codes.length; p++) codes[p] = encodeThickness(sum[p] * inv);
    Object.assign(frame, { codes, width, height, west, south, east, north });
  }

  post({ kind: 'frame', frame }, [frame.codes.buffer]);
}
