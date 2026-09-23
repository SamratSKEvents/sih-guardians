// In-place radix-2 complex FFT (1D and square 2D). n must be a power of two.
// The bit-reversal pairs and the per-level rotation factors are cached per (n, direction). The factors are generated
// with the same running recurrence the loop used to apply (c ← c·w), so results are bit-identical to the uncached form.

interface Tables { swaps: Int32Array; cos: Float64Array; sin: Float64Array }
const cache = new Map<number, Tables>();

function tables(n: number, inverse: boolean): Tables {
  const key = inverse ? -n : n;
  let t = cache.get(key);
  if (t) return t;
  const swaps: number[] = [];
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) swaps.push(i, j);
  }
  // level len uses factors k = 0 … len/2 − 1, stored at offset len/2 − 1 (levels 2, 4, 8, … pack into n − 1 slots)
  const cos = new Float64Array(n), sin = new Float64Array(n);
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? -2 : 2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), o = (len >> 1) - 1;
    let cr = 1, ci = 0;
    for (let k = 0; k < len >> 1; k++) {
      cos[o + k] = cr; sin[o + k] = ci;
      const tt = cr * wr - ci * wi;
      ci = cr * wi + ci * wr;
      cr = tt;
    }
  }
  t = { swaps: Int32Array.from(swaps), cos, sin };
  cache.set(key, t);
  return t;
}

export function fft(re: Float64Array, im: Float64Array, inverse: boolean, off = 0, n = re.length, stride = 1): void {
  const { swaps, cos, sin } = tables(n, inverse);
  for (let s = 0; s < swaps.length; s += 2) {
    const a = off + swaps[s] * stride, b = off + swaps[s + 1] * stride;
    let t = re[a]; re[a] = re[b]; re[b] = t;
    t = im[a]; im[a] = im[b]; im[b] = t;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, o = half - 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const a = off + (i + k) * stride, b = a + half * stride, cr = cos[o + k], ci = sin[o + k];
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[off + i * stride] /= n; im[off + i * stride] /= n; }
}

/** 2D FFT of an n × n row-major field. */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  for (let r = 0; r < n; r++) fft(re, im, inverse, r * n, n, 1);
  // columns: copy into a contiguous buffer (cache-friendly), transform, copy back — same arithmetic as in place
  if (colRe.length !== n) { colRe = new Float64Array(n); colIm = new Float64Array(n); }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) { colRe[r] = re[r * n + c]; colIm[r] = im[r * n + c]; }
    fft(colRe, colIm, inverse, 0, n, 1);
    for (let r = 0; r < n; r++) { re[r * n + c] = colRe[r]; im[r * n + c] = colIm[r]; }
  }
}
let colRe = new Float64Array(0), colIm = new Float64Array(0);
