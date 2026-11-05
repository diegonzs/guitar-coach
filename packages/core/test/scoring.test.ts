import { describe, expect, test } from "bun:test";
import { parseAlphaTex } from "../src/alphatex.ts";
import { TimelineMatcher, expectedForRep, summarize, gradeAssessment, streak, type Onset } from "../src/scoring.ts";
import { GUITAR_MIDI_MIN, GUITAR_MIDI_MAX } from "../src/music.ts";
import { buildCurriculum } from "../src/lesson.ts";
import { resolve } from "node:path";
import { readCurriculumFiles } from "../src/node.ts";

function onset(t: number, midi: number | number[]): Onset {
  const sal = new Float32Array(GUITAR_MIDI_MAX - GUITAR_MIDI_MIN + 1);
  const ms = Array.isArray(midi) ? midi : [midi];
  for (const m of ms) sal[m - GUITAR_MIDI_MIN] = 1;
  return { t, salience: sal, midi: ms[0]! };
}

const am = parseAlphaTex("\\ts 3 4\n:8 0.5 2.3 1.2 0.1 1.2 2.3").music;
const fingers = ["p", "i", "m", "a", "m", "i"];

describe("timeline", () => {
  test("expected times at 60 BPM", () => {
    const ev = expectedForRep(am, fingers, 1, 60, 4);
    expect(ev.map((e) => e.t)).toEqual([3, 3.5, 4, 4.5, 5, 5.5]);
    expect(ev[0]!.window).toBeCloseTo(0.225, 3);
  });

  test("matcher: hits, a wrong note, a late note and an extra", () => {
    const reps: boolean[] = [];
    const m = new TimelineMatcher(am, fingers, 60, 4, 70, 2, undefined, (r) => reps.push(r.clean));
    const seq = [45, 57, 60, 64, 60, 57];
    seq.forEach((n, i) => m.addOnset(onset(i * 0.5 + 0.01, n)));
    // rep 2: wrong note at index 2, index 4 late by 150 ms, extra onset
    seq.forEach((n, i) => m.addOnset(onset(3 + i * 0.5 + (i === 4 ? 0.15 : -0.02), i === 2 ? 59 : n)));
    m.addOnset(onset(5.8, 50));
    for (let t = 0; t < 7; t += 0.05) m.advance(t);
    m.flush(7);
    expect(m.results).toHaveLength(12);
    expect(m.results.slice(0, 6).every((r) => r.hit)).toBe(true);
    expect(m.results[8]!.hit).toBe(false);
    expect(m.results[8]!.detected).toBe(59);
    expect(m.results[10]!.deviationMs).toBe(150);
    expect(reps).toEqual([true, false]);
    const s = summarize(m.results, m.reps, m.extras);
    expect(s.accuracy).toBeCloseTo(11 / 12, 3);
    expect(s.cleanReps).toBe(1);
    expect(s.extraNotes).toBe(1);
  });

  test("missed notes are reported as misses", () => {
    const m = new TimelineMatcher(am, fingers, 60, 4, 70, 1);
    m.addOnset(onset(0, 45));
    for (let t = 0; t < 4; t += 0.1) m.advance(t);
    m.flush(4);
    expect(m.results.filter((r) => r.hit)).toHaveLength(1);
    expect(m.results.filter((r) => r.detected === null)).toHaveLength(5);
  });

  test("chords need every note", () => {
    const c = parseAlphaTex(":4 (0.5 1.2) 2.4 (0.5 0.1) 2.4").music;
    const m = new TimelineMatcher(c, [], 60, 4, 70, 1);
    m.addOnset(onset(0, [45, 60]));
    m.addOnset(onset(1, 52));
    m.addOnset(onset(2, [45]));
    m.addOnset(onset(3, 52));
    for (let t = 0; t < 5; t += 0.1) m.advance(t);
    m.flush(5);
    expect(m.results.map((r) => r.hit)).toEqual([true, true, false, true]);
  });
});

describe("assessment", () => {
  test("level is the highest fully passed level", async () => {
    const c = buildCurriculum(await readCurriculumFiles(resolve(import.meta.dir, "../../../examples/curriculum")));
    const a = c.assessment!;
    const pass = (id: string) => ({ id, status: "passed" as const, accuracy: 1, meanAbsDeviationMs: 20, bpm: 60 });
    const r0 = gradeAssessment(a, [{ id: "cuerdas-al-aire", status: "failed", accuracy: 0.4, meanAbsDeviationMs: 120, bpm: 60 }], c.lessons);
    expect(r0.level).toBe(0);
    expect(r0.recommendedLessonId).toBe("001-cuerdas-al-aire");
    const r1 = gradeAssessment(a, [pass("cuerdas-al-aire"), pass("arpegio-am"), pass("cambios"), { ...pass("escala"), status: "skipped" }], c.lessons);
    expect(r1.level).toBe(1);
    expect(r1.recommendedLessonId).toBe("003-cambios-am-dm-e");
    expect(r1.tasks.find((t) => t.id === "tremolo")!.status).toBe("not-reached");
    const all = gradeAssessment(a, a.exercises.map((t) => pass(t.id)), c.lessons);
    expect(all.level).toBe(4);
    expect(all.recommendedLessonId).toBe("006-melodia-con-bajo");
  });
});

describe("streak", () => {
  test("counts consecutive days", () => {
    const mk = (d: string) => ({ startedAt: d, durationSec: 600 }) as any;
    const today = new Date("2026-03-10T20:00:00");
    const days = ["2026-03-10T10:00:00", "2026-03-09T10:00:00", "2026-03-08T10:00:00", "2026-03-06T10:00:00"].map((d) => mk(new Date(d).toISOString()));
    expect(streak(days, today)).toBe(3);
    expect(streak(days.slice(1), today)).toBe(2);
  });
});
