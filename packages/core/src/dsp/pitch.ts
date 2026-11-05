/**
 * McLeod Pitch Method (normalised square difference function) for the tuner.
 * Works on a single sustained note, which is what tuning needs.
 */
export interface PitchResult {
  freq: number;
  clarity: number;
  rms: number;
}

export function detectPitch(buf: Float32Array, sampleRate: number, minFreq = 60, maxFreq = 1100): PitchResult | null {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i]! * buf[i]!;
  rms = Math.sqrt(rms / n);
  if (rms < 0.004) return null;

  const maxLag = Math.min(Math.floor(sampleRate / minFreq), n - 1);
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let acf = 0;
    let m = 0;
    for (let i = 0; i < n - tau; i++) {
      const a = buf[i]!;
      const b = buf[i + tau]!;
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // Key maxima: local maxima after the first dip of the NSDF (the region around lag 0
  // is always maximal and must be skipped, even when the NSDF never goes negative).
  const peaks: number[] = [];
  let pos = 1;
  while (pos < maxLag && nsdf[pos]! <= nsdf[pos - 1]!) pos++;
  for (let i = Math.max(pos, minLag, 1); i < maxLag; i++) {
    if (nsdf[i]! > 0 && nsdf[i]! > nsdf[i - 1]! && nsdf[i]! >= nsdf[i + 1]!) peaks.push(i);
  }
  if (!peaks.length) return null;
  let highest = 0;
  for (const p of peaks) highest = Math.max(highest, nsdf[p]!);
  const threshold = 0.9 * highest;
  const chosen = peaks.find((p) => nsdf[p]! >= threshold)!;

  // Parabolic interpolation around the chosen lag.
  const y0 = nsdf[chosen - 1] ?? nsdf[chosen]!;
  const y1 = nsdf[chosen]!;
  const y2 = nsdf[chosen + 1] ?? nsdf[chosen]!;
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const lag = chosen + Math.max(-1, Math.min(1, shift));
  const clarity = y1;
  if (clarity < 0.7) return null;
  return { freq: sampleRate / lag, clarity, rms };
}
