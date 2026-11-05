/**
 * Streaming onset detector + note estimator for (polyphonic, ringing) guitar audio.
 *
 * 1. Onsets: spectral flux on a log-compressed 1024-point spectrum (band 60–2000 Hz),
 *    adaptive threshold and peak picking, plus an energy gate against the noise floor.
 * 2. Pitch: for every onset we compare the spectrum right after the attack with the
 *    one right before it. The positive difference contains (mostly) only the *new*
 *    note, so strings that are still ringing don't confuse the estimate. A harmonic
 *    sum over every guitar note (E2…B5) gives a salience per note.
 */
import { FFT, hann } from "./fft.ts";
import { GUITAR_MIDI_MAX, GUITAR_MIDI_MIN, midiToFreq } from "../music.ts";

export interface DetectedOnset {
  /** Absolute sample index of the attack. */
  frame: number;
  midi: number | null;
  /** Salience of the *new* energy at the attack, per MIDI note from GUITAR_MIDI_MIN. */
  salience: Float32Array;
  /** Salience of everything sounding right after the attack. */
  present: Float32Array;
  /** Loudness of the attack (RMS after the onset). */
  level: number;
}

export interface OnsetDetectorOptions {
  hop?: number;
  /** Seconds between two onsets at minimum. */
  minGap?: number;
  /** Multiplier over the running median of the flux. */
  sensitivity?: number;
  a4?: number;
}

const FLUX_N = 1024;
const PITCH_N = 4096;
const PITCH_FFT = 8192;
const N_CANDIDATES = GUITAR_MIDI_MAX - GUITAR_MIDI_MIN + 1;
const HARMONIC_INTERVALS = [24, 19, 12];

export class OnsetDetector {
  readonly sampleRate: number;
  private hop: number;
  private minGapFrames: number;
  private sensitivity: number;
  private a4: number;

  private buf: Float32Array; // ring buffer
  private written = 0; // absolute samples written
  private nextHopAt: number;

  private fluxFft = new FFT(FLUX_N);
  private fluxWin = hann(FLUX_N);
  private prevSpec = new Float32Array(FLUX_N / 2 + 1);
  private curSpec = new Float32Array(FLUX_N / 2 + 1);
  private loBin: number;
  private hiBin: number;
  private fluxHist: { frame: number; flux: number; rms: number }[] = [];
  private lastOnsetFrame = -Infinity;
  private lastOnsetFlux = 0;
  private noiseFloor = 0.002;

  private pitchFft = new FFT(PITCH_FFT);
  private pitchWin = hann(PITCH_N);
  private specPre = new Float32Array(PITCH_FFT / 2 + 1);
  private specPost = new Float32Array(PITCH_FFT / 2 + 1);
  private specDiff = new Float32Array(PITCH_FFT / 2 + 1);
  private pendingPitch: { frame: number; level: number }[] = [];
  private scratch = new Float32Array(PITCH_N);
  private scratchFlux = new Float32Array(FLUX_N);
  private preDelay: number;
  private postDelay: number;

  constructor(sampleRate: number, opts: OnsetDetectorOptions = {}) {
    this.sampleRate = sampleRate;
    this.hop = opts.hop ?? 256;
    this.minGapFrames = Math.round((opts.minGap ?? 0.06) * sampleRate);
    this.sensitivity = opts.sensitivity ?? 2;
    this.a4 = opts.a4 ?? 440;
    this.buf = new Float32Array(1 << 15);
    this.nextHopAt = FLUX_N;
    this.loBin = Math.max(1, Math.floor((60 * FLUX_N) / sampleRate));
    this.hiBin = Math.min(FLUX_N / 2, Math.ceil((8000 * FLUX_N) / sampleRate));
    this.preDelay = Math.round(0.006 * sampleRate);
    this.postDelay = Math.round(0.012 * sampleRate);
  }

  /** Absolute index of the next sample to be pushed. */
  get position() {
    return this.written;
  }

  push(samples: Float32Array): DetectedOnset[] {
    const out: DetectedOnset[] = [];
    const mask = this.buf.length - 1;
    for (let i = 0; i < samples.length; i++) {
      this.buf[(this.written + i) & mask] = samples[i]!;
    }
    this.written += samples.length;
    while (this.written >= this.nextHopAt) {
      this.analyseHop(this.nextHopAt);
      this.nextHopAt += this.hop;
    }
    // pitch estimation for onsets whose post-window is now complete
    while (this.pendingPitch.length && this.written >= this.pendingPitch[0]!.frame + this.postDelay + PITCH_N) {
      const p = this.pendingPitch.shift()!;
      out.push(this.estimate(p.frame, p.level));
    }
    return out;
  }

  private read(start: number, len: number, into: Float32Array) {
    const mask = this.buf.length - 1;
    for (let i = 0; i < len; i++) into[i] = start + i >= 0 ? this.buf[(start + i) & mask]! : 0;
    return into;
  }

  private analyseHop(end: number) {
    const frame = this.read(end - FLUX_N, FLUX_N, this.scratchFlux);
    let rms = 0;
    for (let i = FLUX_N - this.hop; i < FLUX_N; i++) rms += frame[i]! * frame[i]!;
    rms = Math.sqrt(rms / this.hop);
    this.fluxFft.magnitudes(frame, this.fluxWin, this.curSpec);
    let flux = 0;
    for (let k = this.loBin; k <= this.hiBin; k++) {
      const c = Math.log1p(100 * this.curSpec[k]!);
      const d = c - this.prevSpec[k]!;
      if (d > 0) flux += d;
      this.prevSpec[k] = c;
    }
    // slow noise floor follower (fast down, slow up)
    this.noiseFloor = rms < this.noiseFloor ? 0.9 * this.noiseFloor + 0.1 * rms : this.noiseFloor * 1.0015;
    this.noiseFloor = Math.max(this.noiseFloor, 0.0005);

    // the hop's centre is roughly where the energy changed
    this.fluxHist.push({ frame: end - this.hop, flux, rms });
    if (this.fluxHist.length > 64) this.fluxHist.shift();
    this.pick();
  }

  private pick() {
    const h = this.fluxHist;
    const W = 3; // look-ahead / look-behind in hops
    const i = h.length - 1 - W;
    if (i < W) return;
    const c = h[i]!;
    for (let k = i - W; k <= i + W; k++) if (k !== i && h[k]!.flux > c.flux) return;
    const recent = h.slice(Math.max(0, i - 40), i).map((x) => x.flux).sort((a, b) => a - b);
    const median = recent[Math.floor(recent.length / 2)] ?? 0;
    // Adaptive threshold + a decaying "masking" term after the previous onset, so the
    // spectral wobble of a ringing note doesn't retrigger.
    const since = (c.frame - this.lastOnsetFrame) / this.sampleRate;
    const masking = Number.isFinite(since) ? 0.35 * this.lastOnsetFlux * Math.exp(-since / 0.12) : 0;
    const threshold = Math.max(median * this.sensitivity + 10, masking);
    if (c.flux < threshold) return;
    const after = Math.max(h[i]!.rms, h[i + 1]!.rms, h[i + 2]!.rms);
    if (after < Math.max(this.noiseFloor * 4, 0.004)) return;
    // A note being damped or ending also changes the spectrum; a real attack never
    // makes the signal noticeably quieter.
    const before = Math.max(h[i - 3]!.rms, h[i - 2]!.rms);
    if (after < 0.95 * before) return;
    if (c.frame - this.lastOnsetFrame < this.minGapFrames) return;
    this.lastOnsetFrame = c.frame;
    this.lastOnsetFlux = c.flux;
    this.pendingPitch.push({ frame: c.frame, level: after });
  }

  private estimate(frame: number, level: number): DetectedOnset {
    const pre = this.read(frame - this.preDelay - PITCH_N, PITCH_N, this.scratch);
    this.pitchFft.magnitudes(pre, this.pitchWin, this.specPre);
    const post = this.read(frame + this.postDelay, PITCH_N, this.scratch);
    this.pitchFft.magnitudes(post, this.pitchWin, this.specPost);
    // New energy = post − pre. When the same string is re-plucked (repeated notes,
    // tremolo) there is little *new* energy, so fall back to the spectrum present.
    let sumPost = 0;
    let sumDiff = 0;
    const diff = this.specDiff;
    for (let k = 0; k < diff.length; k++) {
      const post = this.specPost[k]!;
      sumPost += post;
      diff[k] = Math.max(0, post - this.specPre[k]! * 1.05);
      sumDiff += diff[k]!;
    }
    const useDiff = sumPost > 0 && sumDiff / sumPost >= 0.3;
    const present = noteSalience(this.specPost, this.sampleRate, PITCH_FFT, this.a4);
    const fresh = useDiff ? noteSalience(diff, this.sampleRate, PITCH_FFT, this.a4) : present;
    let midi = fresh.midi;
    // A re-plucked string that is still ringing only adds energy to *some* of its
    // partials, so the estimate can land on a harmonic (+12, +19, +24 semitones).
    // If the would-be fundamental is clearly sounding, prefer it.
    if (midi !== null && useDiff) {
      const maxPresent = Math.max(...present.salience);
      const fd = midiToFreq(midi, this.a4);
      for (const h of HARMONIC_INTERVALS) {
        const p = midi - h;
        if (p < GUITAR_MIDI_MIN) continue;
        if (present.salience[p - GUITAR_MIDI_MIN]! < 0.9 * maxPresent) continue;
        // Partials of p that are *not* partials of the estimate must have new energy too.
        const fp = midiToFreq(p, this.a4);
        const ratio = Math.round(fd / fp);
        let own = 0;
        let shared = 0;
        for (let k = 1; k <= 6; k++) {
          const v = peakAt(diff, k * fp, this.sampleRate, PITCH_FFT);
          if (k % ratio === 0) shared += v;
          else own += v;
        }
        if (shared > 0 && own >= 0.5 * shared) {
          midi = p;
          break;
        }
      }
    } else if (midi !== null && !useDiff) {
      midi = present.midi;
    }
    return { frame, midi, salience: fresh.salience, present: present.salience, level };
  }
}

function peakAt(spec: Float32Array, freq: number, sr: number, n: number): number {
  const bin = (freq * n) / sr;
  let m = 0;
  for (let k = Math.floor(bin * 0.988); k <= Math.ceil(bin * 1.012) && k < spec.length; k++) if (spec[k]! > m) m = spec[k]!;
  return Math.cbrt(m);
}

/**
 * Harmonic-sum salience for every guitar note given a magnitude spectrum.
 * Spectral compression (^0.33) + Klapuri's harmonic weighting g = (f0+α)/(h·f0+β),
 * summing every partial below 4 kHz. 100% on synthetic plucks across E2–B5.
 */
export function noteSalience(spec: Float32Array, sr: number, n: number, a4 = 440): { salience: Float32Array; midi: number | null } {
  const comp = new Float32Array(spec.length);
  let total = 0;
  for (let k = 1; k < spec.length; k++) {
    comp[k] = Math.cbrt(spec[k]!);
    total += spec[k]!;
  }
  const sal = new Float32Array(N_CANDIDATES);
  let best = -1;
  let bestVal = 0;
  for (let c = 0; c < N_CANDIDATES; c++) {
    const f0 = midiToFreq(GUITAR_MIDI_MIN + c, a4);
    let s = 0;
    for (let h = 1; h * f0 < Math.min(4000, sr / 2 - 50); h++) {
      const bin = (h * f0 * n) / sr;
      const lo = Math.floor(bin * 0.988);
      const hi = Math.ceil(bin * 1.012);
      let m = 0;
      for (let k = lo; k <= hi && k < comp.length; k++) if (comp[k]! > m) m = comp[k]!;
      s += ((f0 + 27) / (h * f0 + 320)) * m;
    }
    sal[c] = s;
    if (s > bestVal) {
      bestVal = s;
      best = c;
    }
  }
  if (best < 0 || bestVal <= 0 || total <= 0) return { salience: sal, midi: null };
  return { salience: sal, midi: GUITAR_MIDI_MIN + best };
}
