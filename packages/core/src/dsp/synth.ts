/** Karplus–Strong plucked string (with fractional delay so it's in tune). Used for reference tones and tests. */
export function pluck(freq: number, sampleRate: number, seconds: number, opts: { decay?: number; brightness?: number; seed?: number; gain?: number } = {}): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  // The two-point average adds half a sample of delay.
  const P = sampleRate / freq - 0.5;
  const burst = Math.max(2, Math.floor(P));
  let seed = opts.seed ?? 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const bright = opts.brightness ?? 0.5;
  const decay = opts.decay ?? 0.996;
  const gain = opts.gain ?? 0.5;
  const read = (i: number) => {
    // linear interpolation of past output at fractional index i
    const i0 = Math.floor(i);
    const f = i - i0;
    const a = i0 >= 0 ? out[i0]! : 0;
    const b = i0 + 1 >= 0 && i0 + 1 < out.length ? out[i0 + 1]! : 0;
    return a + (b - a) * f;
  };
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    if (i < burst) {
      lp = bright * rnd() + (1 - bright) * lp;
      x = lp;
    }
    const fb = i >= P ? decay * 0.5 * (read(i - P) + read(i - P - 1)) : 0;
    out[i] = x + fb;
  }
  const fade = Math.min(n, Math.round(0.03 * sampleRate));
  for (let i = 0; i < n; i++) out[i]! *= gain * (i >= n - fade ? (n - i) / fade : 1);
  return out;
}

/** Mixes `src` into `dst` starting at `offset` samples. */
export function mixInto(dst: Float32Array, src: Float32Array, offset: number) {
  for (let i = 0; i < src.length && offset + i < dst.length; i++) if (offset + i >= 0) dst[offset + i]! += src[i]!;
}
