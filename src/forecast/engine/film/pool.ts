// Parallel sweeps for SparseMaster, with the same arithmetic as the sequential solver.
//
// A sweep only reads the old state of every block and writes each block's own next arrays (kernels.ts), so blocks can
// be computed on several threads at once and the result is bit-identical to running them one after another. Block
// arrays live in SharedArrayBuffer slabs that every thread maps; which of a block's two h (and q) arrays is current is
// a flag in shared memory, flipped by the coordinator's commit. The coordinator stays the only thread that allocates,
// retires, commits, weathers and books the budget.
//
// Messages to the threads (in order, so registry changes always arrive before the sweep that needs them):
//   slab {id, sab, B, dx}           a new slab of blocks
//   reg  {ops: [spill, slot, bi, bj, alive]…}   blocks created or retired
//   flow {spill, seed, params, regions}         (re)build a spill's synthetic flow
//   run  {task, spill, slots, …}    compute these blocks, then decrement the shared pending count and notify
// The coordinator waits with Atomics.wait, which a Web Worker and Node's main thread may do (a page's main thread may not).
// The host supplies the transport (Web Workers, worker_threads, or an in-process loop for tests).
import { SurfaceFlow, type FlowParams } from './flow';
import { reportError } from '../runtime';
import type { FilmFluxParams } from './thinfilm';
import type { ForcingRegion } from './shapes';
import { BlockKernels, RES, type BlockData, type DriftArgs } from './kernels';

/** Float64 arrays per block, in slab order: hA hB qxA qxB qyA qyB hb aU aV cW cU cV, then RES result doubles. */
const ARRAYS = 12;
const SLAB_BLOCKS = 32;

export type ThreadMessage =
  | { t: 'init'; ctrl: SharedArrayBuffer }
  | { t: 'slab'; id: number; sab: SharedArrayBuffer; B: number; dx: number }
  | { t: 'reg'; ops: number[] }
  | { t: 'flow'; spill: number; seed: number; params: FlowParams; regions: ForcingRegion[] }
  | { t: 'run'; task: 'oil'; spill: number; slots: number[]; dt: number; gp: number; Ci: number; drift: DriftArgs; hAlloc: number }
  | { t: 'run'; task: 'film'; spill: number; slots: number[]; dt: number; fp: FilmFluxParams; hAlloc: number }
  | { t: 'run'; task: 'flow'; spill: number; slots: number[]; time: number; params: FlowParams }
  | { t: 'run'; task: 'speed'; spill: number; slots: number[]; gp: number }
  | { t: 'run'; task: 'filmPre' | 'filmPost'; spill: number; slots: number[] }
  | { t: 'run'; task: 'scale'; spill: number; slots: number[]; factor: number; hAlloc: number };

type RunMessage = Extract<ThreadMessage, { t: 'run' }>;
/** A sweep task as the coordinator describes it (the pool adds the message tag and the slots). */
export type RunTask = RunMessage extends infer M ? (M extends RunMessage ? Omit<M, 'slots' | 't'> : never) : never;

/** A block in shared memory: views on its slab, and its flag byte (bit 0: hB is current, bit 1: qxB/qyB are). */
export interface SharedBlock extends BlockData { slot: number; spill: number; flags: Uint8Array }

const blockBytes = (B: number) => (ARRAYS * B * B + RES) * 8;
function views(sab: SharedArrayBuffer, B: number, i: number): Float64Array[] {
  const N = B * B, base = Math.ceil(SLAB_BLOCKS / 8) * 8 + i * blockBytes(B);
  return [...Array.from({ length: ARRAYS }, (_, a) => new Float64Array(sab, base + a * N * 8, N)), new Float64Array(sab, base + ARRAYS * N * 8, RES)];
}

/** Current/next arrays of a slot from its views and flag. */
function resolve(v: Float64Array[], f: number, bi: number, bj: number, flags: Uint8Array, slot: number, spill: number): SharedBlock {
  const h = f & 1, q = (f >> 1) & 1;
  return {
    bi, bj, slot, spill, flags,
    h: v[h], nh: v[1 - h], qx: v[2 + q], nqx: v[3 - q], qy: v[4 + q], nqy: v[5 - q],
    hb: v[6], aU: v[7], aV: v[8], cW: v[9], cU: v[10], cV: v[11], res: v[12],
  };
}

export class SweepPool {
  private readonly ctrl = new Int32Array(new SharedArrayBuffer(8)); // [pending, failed]
  private slabs: { sab: SharedArrayBuffer; flags: Uint8Array; views: Float64Array[][] }[] = [];
  private free: number[] = [];
  private ops: number[] = [];
  private spills = 0;
  /** Blocks per sweep below which the coordinator runs the sweep itself (posting costs more than it saves). */
  minBlocks = 8;

  /** post(thread, message): deliver to one sweep thread, in order. */
  constructor(readonly threads: number, readonly B: number, readonly dx: number, private readonly post: (thread: number, msg: ThreadMessage) => void) {
    for (let t = 0; t < threads; t++) post(t, { t: 'init', ctrl: this.ctrl.buffer as SharedArrayBuffer });
  }

  newSpill() { return this.spills++; }

  /** A zeroed block in shared memory, registered with the threads before the next sweep. */
  alloc(spill: number, bi: number, bj: number): SharedBlock {
    if (!this.free.length) {
      const sab = new SharedArrayBuffer(Math.ceil(SLAB_BLOCKS / 8) * 8 + SLAB_BLOCKS * blockBytes(this.B)), id = this.slabs.length;
      this.slabs.push({ sab, flags: new Uint8Array(sab, 0, SLAB_BLOCKS), views: Array.from({ length: SLAB_BLOCKS }, (_, i) => views(sab, this.B, i)) });
      for (let t = 0; t < this.threads; t++) this.post(t, { t: 'slab', id, sab, B: this.B, dx: this.dx });
      for (let i = SLAB_BLOCKS - 1; i >= 0; i--) this.free.push(id * SLAB_BLOCKS + i);
    }
    const slot = this.free.pop()!, s = this.slabs[Math.floor(slot / SLAB_BLOCKS)], i = slot % SLAB_BLOCKS;
    for (const a of s.views[i]) a.fill(0);
    s.flags[i] = 0;
    this.ops.push(spill, slot, bi, bj, 1);
    return resolve(s.views[i], 0, bi, bj, s.flags, slot, spill);
  }

  release(b: SharedBlock) {
    this.ops.push(b.spill, b.slot, b.bi, b.bj, 0);
    this.free.push(b.slot);
  }

  /** Swap current and next in place for a committed block (both the flag and the coordinator's references). */
  static swap(b: SharedBlock, momentum: boolean) {
    const i = b.slot % SLAB_BLOCKS;
    b.flags[i] ^= momentum ? 3 : 1;
  }

  flow(spill: number, seed: number, params: FlowParams, regions: ForcingRegion[]) {
    for (let t = 0; t < this.threads; t++) this.post(t, { t: 'flow', spill, seed, params: { ...params }, regions });
  }

  /** Run a task over these blocks on the threads and wait for all of them. Returns false when too few to be worth it. */
  run(blocks: SharedBlock[], task: RunTask): boolean {
    if (blocks.length < this.minBlocks) return false;
    const n = Math.min(this.threads, Math.ceil(blocks.length / 4)), parts: number[][] = Array.from({ length: n }, () => []);
    blocks.forEach((b, i) => parts[i % n].push(b.slot));
    const ops = this.ops;
    this.ops = [];
    if (ops.length) for (let t = 0; t < this.threads; t++) this.post(t, { t: 'reg', ops });
    Atomics.store(this.ctrl, 0, n);
    for (let t = 0; t < n; t++) this.post(t, { ...task, t: 'run', slots: parts[t] } as ThreadMessage);
    for (let v = Atomics.load(this.ctrl, 0); v > 0; v = Atomics.load(this.ctrl, 0)) Atomics.wait(this.ctrl, 0, v);
    if (Atomics.load(this.ctrl, 1)) throw new Error('a sweep thread failed (see its console)');
    return true;
  }
}

/** The message handler of one sweep thread. */
export function createSweepThread(): (msg: ThreadMessage) => void {
  let ctrl: Int32Array | null = null, kernels: BlockKernels | null = null;
  const slabs: { flags: Uint8Array; views: Float64Array[][] }[] = [];
  const where = new Map<number, { slot: number; bi: number; bj: number }>(); // spill·2³² + block key → slot
  const bySlot = new Map<number, { spill: number; bi: number; bj: number }>();
  const flows = new Map<number, SurfaceFlow>();
  const key = (spill: number, bi: number, bj: number) => spill * 4294967296 + (bi + 32768) * 65536 + (bj + 32768);
  const block = (slot: number): SharedBlock => {
    const r = bySlot.get(slot)!, s = slabs[Math.floor(slot / SLAB_BLOCKS)], i = slot % SLAB_BLOCKS;
    return resolve(s.views[i], s.flags[i], r.bi, r.bj, s.flags, slot, r.spill);
  };
  return (msg) => {
    switch (msg.t) {
      case 'init': ctrl = new Int32Array(msg.ctrl); return;
      case 'slab':
        slabs[msg.id] = { flags: new Uint8Array(msg.sab, 0, SLAB_BLOCKS), views: Array.from({ length: SLAB_BLOCKS }, (_, i) => views(msg.sab, msg.B, i)) };
        if (!kernels) kernels = new BlockKernels(msg.B, msg.dx);
        return;
      case 'reg':
        for (let o = 0; o < msg.ops.length; o += 5) {
          const [spill, slot, bi, bj, alive] = msg.ops.slice(o, o + 5), k = key(spill, bi, bj);
          if (alive) { where.set(k, { slot, bi, bj }); bySlot.set(slot, { spill, bi, bj }); }
          else if (where.get(k)?.slot === slot) { where.delete(k); bySlot.delete(slot); }
        }
        return;
      case 'flow': {
        const f = new SurfaceFlow({ ...msg.params }, msg.seed);
        f.setRegions(msg.regions);
        flows.set(msg.spill, f);
        return;
      }
      case 'run':
        try {
          const k = kernels!, lookup = (bi: number, bj: number) => { const w = where.get(key(msg.spill, bi, bj)); return w ? block(w.slot) : undefined; };
          if (msg.task === 'flow') {
            const f = flows.get(msg.spill)!;
            Object.assign(f.p, msg.params); // windrows follow the live wind
            for (const s of msg.slots) k.flowBlock(block(s), f, msg.time);
          } else if (msg.task === 'oil') for (const s of msg.slots) { const b = block(s); k.oilBlock(b, lookup, msg.dt, msg.gp, msg.Ci, msg.drift); k.commitStats(b, msg.hAlloc); }
          else if (msg.task === 'film') for (const s of msg.slots) { const b = block(s); k.filmBlock(b, lookup, msg.dt, msg.fp); k.commitStats(b, msg.hAlloc); }
          else if (msg.task === 'speed') for (const s of msg.slots) k.speed(block(s), msg.gp);
          else if (msg.task === 'filmPre') for (const s of msg.slots) k.filmPre(block(s));
          else if (msg.task === 'filmPost') for (const s of msg.slots) k.filmPost(block(s));
          else if (msg.task === 'scale') for (const s of msg.slots) k.scale(block(s), msg.factor, msg.hAlloc);
        } catch (e) {
          reportError(e);
          Atomics.store(ctrl!, 1, 1);
        }
        Atomics.sub(ctrl!, 0, 1);
        Atomics.notify(ctrl!, 0);
    }
  };
}

