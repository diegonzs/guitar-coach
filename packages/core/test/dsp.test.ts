import { describe, expect, test } from "bun:test";
import { OnsetDetector } from "../src/dsp/onsets.ts";
import { detectPitch } from "../src/dsp/pitch.ts";
import { pluck, mixInto } from "../src/dsp/synth.ts";
import { midiToFreq, centsOff } from "../src/music.ts";
import { pitchMatches } from "../src/scoring.ts";

const SR = 48000;

function run(signal: Float32Array, block = 128) {
  const det = new OnsetDetector(SR);
  const out = [];
  for (let i = 0; i < signal.length; i += block) out.push(...det.push(signal.subarray(i, i + block)));
  out.push(...det.push(new Float32Array(SR / 2))); // flush
  return out;
}

function noise(n: number, amp: number, seed = 42) {
  const a = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) a[i] = (((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1) * amp;
  return a;
}

describe("pitch (tuner)", () => {
  test.each([40, 45, 50, 55, 59, 64, 69, 76])("detects MIDI %i within 5 cents", (midi) => {
    const sig = pluck(midiToFreq(midi), SR, 0.6, { decay: 0.998 });
    const r = detectPitch(sig.subarray(4800, 4800 + 4096), SR);
    expect(r).not.toBeNull();
    const c = centsOff(r!.freq);
    expect(c.midi).toBe(midi);
    expect(Math.abs(c.cents)).toBeLessThan(5);
  });
});

describe("onset detector", () => {
  test("single plucks on every open string and some fretted notes", () => {
    for (const midi of [40, 45, 50, 55, 59, 64, 48, 57, 60, 65, 67, 72]) {
      const sig = new Float32Array(SR);
      sig.set(noise(SR, 0.0008));
      mixInto(sig, pluck(midiToFreq(midi), SR, 0.8, { seed: midi }), 9600);
      const on = run(sig);
      expect(on.length).toBe(1);
      expect(on[0]!.midi).toBe(midi);
      expect(Math.abs(on[0]!.frame - 9600)).toBeLessThan(SR * 0.012);
    }
  });

  test("ringing arpeggio (Am p-i-m-a-m-i, 2 reps at 80 BPM eighths)", () => {
    const seq = [45, 57, 60, 64, 60, 57, 45, 57, 60, 64, 60, 57];
    const step = (60 / 80 / 2) * SR;
    const sig = noise(Math.round(step * seq.length + SR), 0.001);
    seq.forEach((m, i) => mixInto(sig, pluck(midiToFreq(m), SR, 2.5, { seed: i * 7 + 1, decay: 0.9985 }), Math.round(SR * 0.2 + i * step)));
    const on = run(sig);
    expect(on.map((o) => o.midi)).toEqual(seq);
    on.forEach((o, i) => expect(Math.abs(o.frame - (SR * 0.2 + i * step)) / SR).toBeLessThan(0.015));
  });

  test("chord onsets contain every note", () => {
    const sig = noise(SR, 0.0008);
    for (const m of [45, 60]) mixInto(sig, pluck(midiToFreq(m), SR, 0.9, { seed: m }), 12000);
    const on = run(sig);
    expect(on.length).toBe(1);
    const sal = on[0]!.salience;
    const max = Math.max(...sal);
    expect(sal[45 - 40]!).toBeGreaterThan(0.3 * max);
    expect(sal[60 - 40]!).toBeGreaterThan(0.3 * max);
  });

  test("silence and steady noise produce no onsets", () => {
    expect(run(noise(SR * 2, 0.002))).toHaveLength(0);
  });

  test("repeated same note is detected each time", () => {
    const sig = noise(SR * 2, 0.001);
    for (let i = 0; i < 6; i++) mixInto(sig, pluck(midiToFreq(64), SR, 1.5, { seed: i + 3, decay: 0.999 }), Math.round(SR * 0.1 + i * SR * 0.25));
    const on = run(sig);
    expect(on.length).toBe(6);
    // the evaluator (which knows the expected note) must accept every re-pluck
    expect(on.every((o) => pitchMatches({ t: 0, salience: o.salience, present: o.present, midi: o.midi }, [64]))).toBe(true);
    // …and must reject a different note
    expect(on.some((o) => pitchMatches({ t: 0, salience: o.salience, present: o.present, midi: o.midi }, [62]))).toBe(false);
  });
});

describe("evaluation on synthetic audio", () => {
  test("a wrong note inside a ringing arpeggio is rejected, the rest accepted", () => {
    const expected = [45, 57, 60, 64, 60, 57];
    const played = [45, 57, 59, 64, 60, 57]; // B3 instead of C4
    const step = (60 / 70 / 2) * SR;
    const sig = noise(Math.round(step * 6 + SR), 0.003);
    played.forEach((m, i) => mixInto(sig, pluck(midiToFreq(m), SR, 2, { seed: i * 13 + 5, gain: 0.3 + 0.1 * (i % 3) }), Math.round(SR * 0.2 + i * step)));
    const on = run(sig);
    expect(on).toHaveLength(6);
    const ok = on.map((o, i) => pitchMatches({ t: 0, salience: o.salience, present: o.present, midi: o.midi }, [expected[i]!]));
    expect(ok).toEqual([true, true, false, true, true, true]);
  });
});
