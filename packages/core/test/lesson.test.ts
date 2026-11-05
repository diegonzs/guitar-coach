import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadCurriculum } from "../src/node.ts";
import { buildCurriculum, parseFingering } from "../src/lesson.ts";
import { parseAlphaTex } from "../src/alphatex.ts";

describe("curriculum", () => {
  test("example curriculum is valid", async () => {
    const c = await loadCurriculum(resolve(import.meta.dir, "../../../examples/curriculum"));
    expect(c.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(c.lessons.length).toBeGreaterThanOrEqual(6);
    expect(c.assessment?.exercises.length).toBeGreaterThanOrEqual(5);
    expect(c.course?.units.length).toBe(4);
    // ordering: by level, then unit, then order
    const levels = c.lessons.map((l) => l.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  test("validation reports missing blocks, bad ids and unknown units", () => {
    const c = buildCurriculum([
      { path: "course.yaml", content: "title: X\nunits:\n  - { id: a, title: A, level: 1 }\n" },
      {
        path: "lessons/x.md",
        content: "---\nid: Bad_Id\ntitle: T\nlevel: 1\nunit: zzz\nexercises:\n  - id: e1\n    title: E\n    tempo: { start: 60 }\n---\nbody\n",
      },
      {
        path: "lessons/y.md",
        content: "---\nid: ok\ntitle: T\nlevel: 1\nunit: zzz\nexercises:\n  - id: e1\n    title: E\n    tempo: { start: 60 }\n---\nno blocks\n",
      },
    ]);
    const msgs = c.issues.map((i) => i.file + " " + i.message).join("\n");
    expect(msgs).toContain("lessons/x.md id:");
    expect(msgs).toContain("Falta el bloque");
    expect(c.lessons).toHaveLength(0);
  });

  test("fingering is cycled and checked against chords", () => {
    const m = parseAlphaTex(":8 0.5 2.3 1.2 0.1 1.2 2.3 0.5 2.3 1.2 0.1 1.2 2.3").music;
    expect(parseFingering("p i m a m i", m).fingers.slice(6, 8)).toEqual(["p", "i"]);
    expect(parseFingering("p i m a m", m).error).toContain("divisor");
    const c = parseAlphaTex(":4 (0.5 1.2) 2.4").music;
    expect(parseFingering("p p", c).error).toContain("dedo");
    expect(parseFingering("p+m p", c).fingers).toEqual(["p+m", "p"]);
  });
});
