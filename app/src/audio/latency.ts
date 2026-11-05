/**
 * Measuring the round-trip latency (speaker → ear/mic → guitar → mic) so timing
 * feedback is fair. Two methods:
 *  - loopback: the mic hears the speaker's clicks directly (no headphones).
 *  - pluck-along: the student plucks an open string with each click (works with headphones).
 */
import { OnsetDetector } from "@guitar-coach/core";
import { audio } from "./engine";
import { Metronome } from "./metronome";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : NaN;
};

async function withClicks<T>(bpm: number, count: number, collect: (clicks: number[]) => { onBlock: (frame: number, samples: Float32Array) => void; done: () => T }): Promise<T> {
  const ctx = await audio.ensureContext();
  await audio.startMic();
  const m = new Metronome(ctx, bpm, 4, 0.9);
  const start = ctx.currentTime + 0.5;
  const clicks = Array.from({ length: count }, (_, i) => start + (i * 60) / bpm);
  const c = collect(clicks);
  const off = audio.onBlock((b) => c.onBlock(b.frame, b.samples));
  m.start(start);
  await new Promise((r) => setTimeout(r, ((count * 60) / bpm + 1.2) * 1000));
  m.dispose();
  off();
  return c.done();
}

/** Returns latency in ms, or null when the clicks weren't heard clearly. */
export async function loopbackLatency(): Promise<number | null> {
  const sr = audio.sampleRate;
  return withClicks(100, 10, (clicks) => {
    // simple high-band energy detector (clicks are 2–2.6 kHz sine bursts)
    const hop = 64;
    const energies: { t: number; e: number }[] = [];
    let prev = 0;
    let acc = 0;
    let n = 0;
    let startFrame = 0;
    return {
      onBlock(frame, samples) {
        for (let i = 0; i < samples.length; i++) {
          if (n === 0) startFrame = frame + i;
          const x = samples[i]!;
          const hp = x - prev; // first difference ≈ high-pass
          prev = x;
          acc += hp * hp;
          if (++n === hop) {
            energies.push({ t: startFrame / sr, e: acc / hop });
            acc = 0;
            n = 0;
          }
        }
      },
      done() {
        const delays: number[] = [];
        const noise = median(energies.map((x) => x.e));
        for (const c of clicks) {
          const win = energies.filter((x) => x.t >= c - 0.02 && x.t <= c + 0.4);
          const peak = win.reduce((a, b) => (b.e > a.e ? b : a), { t: 0, e: 0 });
          if (peak.e > noise * 30) {
            // first hop above half the peak = arrival
            const first = win.find((x) => x.e >= peak.e * 0.5)!;
            delays.push(first.t - c);
          }
        }
        if (delays.length < 6) return null;
        const med = median(delays);
        const spread = median(delays.map((d) => Math.abs(d - med)));
        if (spread > 0.015) return null;
        return Math.round(med * 1000);
      },
    };
  });
}

export async function pluckAlongLatency(onProgress?: (n: number) => void): Promise<number | null> {
  const sr = audio.sampleRate;
  return withClicks(80, 12, (clicks) => {
    const det = new OnsetDetector(sr);
    let anchor: number | null = null;
    const onsets: number[] = [];
    return {
      onBlock(frame, samples) {
        if (anchor === null) anchor = frame;
        for (const o of det.push(samples)) {
          const t = (anchor + o.frame) / sr;
          onsets.push(t);
          onProgress?.(onsets.length);
        }
      },
      done() {
        // ignore the first 4 clicks (count-in)
        const delays: number[] = [];
        for (const c of clicks.slice(4)) {
          const near = onsets.filter((t) => t > c - 0.25 && t < c + 0.45);
          if (near.length) delays.push(near.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a)) - c);
        }
        if (delays.length < 5) return null;
        return Math.max(0, Math.round(median(delays) * 1000));
      },
    };
  });
}
