import { describe, expect, test } from "bun:test";
import * as alphaTab from "@coderline/alphatab";
import { resolve } from "node:path";
import { parseAlphaTex } from "../src/alphatex.ts";
import { findExerciseBlocks, splitFrontmatter } from "../src/lesson.ts";
import { readCurriculumFiles } from "../src/node.ts";

describe("parseAlphaTex", () => {
  test("arpeggio in 3/4 eighths", () => {
    const { music, issues } = parseAlphaTex("\\ts 3 4\n:8 0.5 2.3 1.2 0.1 1.2 2.3");
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(music.timeSignature).toEqual([3, 4]);
    expect(music.events).toHaveLength(6);
    expect(music.length).toBe(3);
    expect(music.events.map((e) => e.notes[0]!.midi)).toEqual([45, 57, 60, 64, 60, 57]);
    expect(music.events[3]!.start).toBe(1.5);
  });

  test("chords, per-beat durations, rests, repeats, dotted", () => {
    const { music, issues } = parseAlphaTex("\\tempo 80 .\n:4 (0.5 1.2).2 r 0.1 | 3.2.4{d} 0.1.16*2 :2 3.1");
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(music.tempo).toBe(80);
    expect(music.events.map((e) => e.duration)).toEqual([2, 1, 1, 1.5, 0.25, 0.25, 2]);
    expect(music.events[0]!.notes.map((n) => n.midi)).toEqual([45, 60]);
    expect(music.events[1]!.rest).toBe(true);
    expect(music.bars).toBe(2);
  });

  test("reports useful errors", () => {
    const { issues } = parseAlphaTex(":4 0.7 25.1 (0.1 2.1) 0.1 0.1 0.1 0.1 0.1 |");
    const msgs = issues.map((i) => i.message).join("\n");
    expect(msgs).toContain("Cuerda 7");
    expect(msgs).toContain("Traste 25");
    expect(msgs).toContain("misma cuerda");
    expect(msgs).toContain("dura");
  });

  test("triplets", () => {
    const { music } = parseAlphaTex(":8 0.1{tu 3} 0.2{tu 3} 0.3{tu 3} :4 0.1 0.1 0.1");
    expect(music.events[0]!.duration).toBeCloseTo(1 / 3, 5);
    expect(music.length).toBeCloseTo(4, 5);
  });
});

describe("compatibility with alphaTab", () => {
  test("every example exercise parses identically in alphaTab", async () => {
    const files = await readCurriculumFiles(resolve(import.meta.dir, "../../../examples/curriculum"));
    let count = 0;
    for (const f of files) {
      const fm = splitFrontmatter(f.content);
      if (!fm) continue;
      for (const b of findExerciseBlocks(fm.body, fm.bodyLine)) {
        const ours = parseAlphaTex(b.tex).music;
        const imp = new alphaTab.importer.AlphaTexImporter();
        imp.initFromString(b.tex, new alphaTab.Settings());
        const score = imp.readScore();
        const beats = score.tracks[0]!.staves[0]!.bars.flatMap((bar) => bar.voices[0]!.beats);
        expect(score.masterBars.length).toBe(ours.bars);
        expect(beats.length).toBe(ours.events.length);
        beats.forEach((beat, i) => {
          const ev = ours.events[i]!;
          expect(beat.isRest).toBe(ev.rest);
          const theirs = beat.notes.map((n) => n.realValue).sort((a, b) => a - b);
          expect(theirs).toEqual(ev.notes.map((n) => n.midi).sort((a, b) => a - b));
        });
        count++;
      }
    }
    expect(count).toBeGreaterThan(10);
  });
});
