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

describe("note lengths: voices and let ring", () => {
  const sus = (tex: string) => parseAlphaTex(tex).music.events.map((e) => e.notes.map((n) => `${n.fret}.${n.string}:${n.sustain}`).join("+"));

  test("single voice: each note lasts its written length", () => {
    expect(sus(String.raw`\ts 2 4 :4 0.1 2.3.8 0.2.8`)).toEqual(["0.1:1", "2.3:0.5", "0.2:0.5"]);
  });

  test("a bass in its own voice rings for its whole length under the melody", () => {
    const { music, issues } = parseAlphaTex(String.raw`\ts 3 4 \voice :8 0.1 0.1 1.1 3.1 0.1 1.1 | 3.1*6 \voice 3.6.2{d} | 3.5.2{d}`);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(music.voices).toBe(2);
    expect(music.bars).toBe(2);
    expect(music.events.length).toBe(12);
    expect(music.events[0]!.notes.map((n) => `${n.fret}.${n.string}:${n.sustain}`)).toEqual(["0.1:0.5", "3.6:3"]);
    expect(music.events[0]!.duration).toBe(0.5);
    expect(music.events[6]!.notes.map((n) => `${n.fret}.${n.string}:${n.sustain}`)).toEqual(["3.1:0.5", "3.5:3"]);
  });

  test("let ring lasts to the end of the bar, cut when the string is plucked again", () => {
    expect(sus(String.raw`\ts 3 4 :8 0.5{lr} 2.3{lr} 1.2{lr} 0.1{lr} 1.2 2.3{lr} | 0.5`)).toEqual(["0.5:3", "2.3:2", "1.2:1", "0.1:1.5", "1.2:0.5", "2.3:0.5", "0.5:0.5"]);
    expect(sus(String.raw`\ts 2 4 :8 (0.5{lr} 2.3{lr}) 0.1{lr}.4 1.2{lr}.8`)).toEqual(["0.5:2+2.3:2", "0.1:1.5", "1.2:0.5"]);
  });

  test("a second voice without \\voice before the first is an error (alphaTab would read it as more bars)", () => {
    const { issues } = parseAlphaTex(String.raw`\ts 4 4 :4 0.1*4 \voice :1 3.6`);
    expect(issues.some((i) => i.level === "error" && i.message.includes("voice"))).toBe(true);
  });

  test("two voices on the same string at once is an error", () => {
    const { issues } = parseAlphaTex(String.raw`\ts 4 4 \voice :1 0.1 \voice :1 3.1`);
    expect(issues.some((i) => i.level === "error" && i.message.includes("cuerda 1"))).toBe(true);
  });
});

/** Flatten an alphaTab score to {start (quarters), midis, letRing} per onset, all voices merged. */
function alphaTabOnsets(tex: string) {
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, new alphaTab.Settings());
  const score = imp.readScore();
  const at = new Map<number, { midis: number[]; lr: boolean[] }>();
  for (const bar of score.tracks[0]!.staves[0]!.bars)
    for (const v of bar.voices)
      for (const b of v.beats) {
        if (b.isRest || b.isEmpty) continue;
        const q = Math.round(((bar.masterBar.start + b.playbackStart) / 960) * 1e6) / 1e6;
        const cur = at.get(q) ?? { midis: [], lr: [] };
        for (const n of b.notes) {
          cur.midis.push(n.realValue);
          cur.lr.push(n.isLetRing);
        }
        at.set(q, cur);
      }
  return { score, at };
}

describe("compatibility with alphaTab", () => {
  test("voices and let ring are read the same way", () => {
    for (const tex of [
      String.raw`\ts 3 4 \voice :8 0.1 0.1 1.1 3.1 0.1 1.1 | 3.1*6 \voice 3.6.2{d} | 3.5.2{d}`,
      String.raw`\ts 3 4 :8 0.5{lr} 2.3{lr} 1.2{lr} 0.1{lr} 1.2 2.3{lr}`,
      String.raw`\ts 2 4 :8 (0.5{lr} 2.3{lr}) 0.1{lr}.4 1.2{lr}.8`,
      String.raw`\ts 4 4 \voice :4 0.1 r 0.1 0.1 \voice :2 3.6 r`,
    ]) {
      const ours = parseAlphaTex(tex).music;
      const { score, at } = alphaTabOnsets(tex);
      expect(score.masterBars.length).toBe(ours.bars);
      const sounding = ours.events.filter((e) => !e.rest);
      expect(sounding.map((e) => e.start)).toEqual([...at.keys()].sort((a, b) => a - b));
      for (const e of sounding) {
        const t = at.get(e.start)!;
        expect([...t.midis].sort()).toEqual(e.notes.map((n) => n.midi).sort());
        expect(t.lr.filter(Boolean).length).toBe(e.notes.filter((n) => n.letRing).length);
      }
    }
  });

  test("every example exercise parses identically in alphaTab", async () => {
    const files = await readCurriculumFiles(resolve(import.meta.dir, "../../../examples/curriculum"));
    let count = 0;
    for (const f of files) {
      const fm = splitFrontmatter(f.content);
      if (!fm) continue;
      for (const b of findExerciseBlocks(fm.body, fm.bodyLine)) {
        const ours = parseAlphaTex(b.tex).music;
        const { score, at } = alphaTabOnsets(b.tex);
        expect(score.masterBars.length).toBe(ours.bars);
        const sounding = ours.events.filter((e) => !e.rest);
        expect(sounding.map((e) => e.start)).toEqual([...at.keys()].sort((a, b) => a - b));
        for (const e of sounding) {
          expect([...at.get(e.start)!.midis].sort((a, b) => a - b)).toEqual(e.notes.map((n) => n.midi).sort((a, b) => a - b));
          expect(at.get(e.start)!.lr.filter(Boolean).length).toBe(e.notes.filter((n) => n.letRing).length);
        }
        count++;
      }
    }
    expect(count).toBeGreaterThan(10);
  });
});
