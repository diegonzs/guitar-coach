/** Minimal radix-2 FFT for real input. Allocation-free after construction. */
export class FFT {
  readonly size: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;
  readonly re: Float32Array;
  readonly im: Float32Array;

  constructor(size: number) {
    if (size & (size - 1)) throw new Error("FFT size must be a power of two");
    this.size = size;
    this.cos = new Float32Array(size / 2);
    this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
  }

  /** Writes |X[k]| for k in [0, size/2] into `out`. `input` may be shorter than size (zero padded). */
  magnitudes(input: ArrayLike<number>, window: Float32Array | null, out: Float32Array): Float32Array {
    const n = this.size;
    const re = this.re;
    const im = this.im;
    const len = Math.min(input.length, n);
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]!;
      re[j] = i < len ? input[i]! * (window ? window[i]! : 1) : 0;
      im[j] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step]!;
          const s = this.sin[k * step]!;
          const a = start + k;
          const b = a + half;
          const tr = re[b]! * c - im[b]! * s;
          const ti = re[b]! * s + im[b]! * c;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
    for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(re[k]!, im[k]!);
    return out;
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
