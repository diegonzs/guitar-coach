import { describe, expect, test } from "bun:test";
import { diagnose, noteVerdict, parseAlphaTex, type NoteResult } from "../src/index.ts";

// Am arpeggio: A(5) E... as in the assessment: 0.5 2.3 1.2 0.1 1.2 2.3
const { music } = parseAlphaTex(`\\ts 3 4 :8 0.5 2.3 1.2 0.1 1.2 2.3`);
const playable = music.events.filter((e) => !e.rest);

function results(perNote: (i: number, rep: number) => Partial<NoteResult>, reps = 3): NoteResult[] {
  const out: NoteResult[] = [];
  for (let rep = 0; rep < reps; rep++)
    playable.forEach((e, i) => {
      const midi = e.notes[0]!.midi;
      out.push({ rep, event: e.index, t: rep * 3 + i * 0.5, expected: [midi], detected: midi, hit: true, deviationMs: 10, ...perNote(i, rep) });
    });
  return out;
}

describe("diagnosis", () => {
  test("verdicts", () => {
    const base = { rep: 0, event: 0, t: 0, expected: [57] };
    expect(noteVerdict({ ...base, detected: 57, hit: true, deviationMs: 20 }, 70)).toBe("ok");
    expect(noteVerdict({ ...base, detected: 57, hit: true, deviationMs: -120 }, 70)).toBe("early");
    expect(noteVerdict({ ...base, detected: 57, hit: true, deviationMs: 90 }, 70)).toBe("late");
    expect(noteVerdict({ ...base, detected: 59, hit: false, deviationMs: 5 }, 70)).toBe("wrong");
    expect(noteVerdict({ ...base, detected: null, hit: false, deviationMs: null }, 70)).toBe("missed");
  });

  test("all good", () => {
    const d = diagnose(music, results(() => ({})), { toleranceMs: 70 });
    expect(d.issues.map((i) => i.kind)).toEqual(["good"]);
    expect(d.events.every((e) => e.verdict === "ok")).toBe(true);
  });

  test("rushing is called out with the average and a latency hint when steady", () => {
    const d = diagnose(music, results(() => ({ deviationMs: -130 })), { toleranceMs: 70 });
    const i = d.issues.find((x) => x.kind === "early")!;
    expect(i).toBeDefined();
    expect(i.detail).toContain("130 ms antes");
    expect(i.tip).toContain("latencia");
    expect(d.events[0]!.label).toBe("−130");
  });

  test("uneven timing", () => {
    const d = diagnose(music, results((i) => ({ deviationMs: i % 2 ? 120 : -110 })), { toleranceMs: 70 });
    expect(d.issues[0]!.kind).toBe("uneven");
  });

  test("fretted note that sounded open explains the finger didn't press", () => {
    // 3rd note: string 2 fret 1 (C4 = 60); heard open B (59)
    const d = diagnose(music, results((i) => (i === 2 ? { detected: 59, hit: false } : {})), { toleranceMs: 70 });
    const w = d.issues.find((x) => x.kind === "wrong")!;
    expect(w.title).toContain("cuerda 2, traste 1");
    expect(w.detail).toContain("cuerda al aire");
    expect(d.events[2]!.label).toBe("Si");
  });

  test("neighbouring string", () => {
    // 4th note: open string 1 (E4 = 64); heard open string 2 (B3 = 59)
    const d = diagnose(music, results((i) => (i === 3 ? { detected: 59, hit: false } : {})), { toleranceMs: 70 });
    expect(d.issues.find((x) => x.kind === "wrong")!.detail).toContain("cuerda 2 en vez de la 1");
  });

  test("a missed note with a far-off onset becomes 'too late'", () => {
    const r = results((i, rep) => (i === 1 && rep === 0 ? { detected: null, hit: false, deviationMs: null } : {}), 1);
    const d = diagnose(music, r, { toleranceMs: 70, extraOnsets: [{ t: 0.5 + 0.3, midi: 57 }] });
    expect(d.notes.find((n) => n.event === playable[1]!.index)!.verdict).toBe("late");
    expect(d.counts.missed).toBe(0);
  });

  test("silence", () => {
    const d = diagnose(music, results(() => ({ detected: null, hit: false, deviationMs: null })), { toleranceMs: 70 });
    expect(d.issues[0]!.kind).toBe("quiet");
  });
});

describe("diagnosis: a whole note behind", () => {
  test("hearing the previous note is reported as late, not as a wrong note", () => {
    // every sound arrives ~one eighth late: note k sounds the pitch of note k-1
    const r = results((i) => {
      if (i === 0) return { deviationMs: 200 };
      const prev = playable[i - 1]!.notes[0]!.midi;
      const cur = playable[i]!.notes[0]!.midi;
      return Math.abs(prev - cur) % 12 === 0 ? { deviationMs: 200 } : { detected: prev, hit: false, deviationMs: 200 };
    });
    const d = diagnose(music, r, { toleranceMs: 70 });
    expect(d.counts.wrong).toBe(0);
    expect(d.issues[0]!.kind).toBe("late");
    expect(d.issues[0]!.detail).toMatch(/notas eran las correctas|nota entera/);
    expect(d.events[2]!.label).toBe("tarde");
  });
});
