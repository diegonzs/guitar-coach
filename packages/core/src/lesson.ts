/**
 * The guitar-coach lesson format (v1).
 *
 * A curriculum is a folder with:
 *   course.yaml          – course title, goal, units, daily routine           (optional)
 *   assessment.md        – the placement test                                  (optional)
 *   lessons/*.md         – one lesson per file (YAML frontmatter + Markdown)
 *   notes/*.md           – messages from the instructor shown in the app       (optional)
 *
 * See docs/lesson-format.md for the human-readable specification.
 */
import { z } from "zod";
import YAML from "yaml";
import { parseAlphaTex, type ParsedMusic, type TexIssue } from "./alphatex.ts";

export const FORMAT_VERSION = 1;

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Usa solo minúsculas, números y guiones (p. ej. 002-arpegio-am)")
  .max(64);

export const CHECKS = [
  "notes",
  "timing",
  "posture.rightWrist",
  "posture.leftWrist",
  "posture.leftThumb",
  "posture.shoulders",
] as const;
export type Check = (typeof CHECKS)[number];

export const CHECK_LABELS: Record<Check, string> = {
  notes: "Notas",
  timing: "Tiempo",
  "posture.rightWrist": "Muñeca derecha",
  "posture.leftWrist": "Muñeca izquierda",
  "posture.leftThumb": "Pulgar izquierdo",
  "posture.shoulders": "Hombros",
};

const fingeringToken = /^(-|[pimac](\+[pimac])*)$/;

export const TempoSchema = z
  .object({
    start: z.number().int().min(20).max(300).describe("BPM con el que se empieza"),
    target: z.number().int().min(20).max(300).optional().describe("BPM objetivo; al alcanzarlo el ejercicio se considera dominado"),
    step: z.number().int().min(1).max(40).default(5).describe("Cuántos BPM se suben cada vez que se desbloquea el siguiente tempo"),
  })
  .refine((t) => t.target === undefined || t.target >= t.start, { message: "target debe ser mayor o igual que start" });

export const ExerciseSchema = z.object({
  id,
  title: z.string().min(1).max(120),
  instructions: z.string().max(2000).optional().describe("Indicación corta que se muestra mientras se practica"),
  fingering: z
    .string()
    .optional()
    .describe('Digitación de la mano derecha, un símbolo por golpe (p i m a c, acordes con +, "-" sin indicar). Si es más corta que el ejercicio, se repite.'),
  tempo: TempoSchema,
  beatUnit: z.union([z.literal(4), z.literal(8)]).default(4).describe("Qué figura cuenta como un pulso del metrónomo"),
  cleanRepsToAdvance: z.number().int().min(1).max(50).default(8),
  timingToleranceMs: z.number().int().min(20).max(250).default(70),
  checks: z.array(z.enum(CHECKS)).default(["notes", "timing"]),
  loop: z.boolean().default(true).describe("Si el ejercicio se repite en bucle (true) o se toca una vez"),
});
export type ExerciseMeta = z.infer<typeof ExerciseSchema>;

export const LessonMetaSchema = z.object({
  type: z.literal("lesson").default("lesson"),
  formatVersion: z.literal(1).default(1),
  id,
  title: z.string().min(1).max(120),
  unit: id.optional().describe("id de la unidad en course.yaml"),
  level: z.number().int().min(1).max(5),
  order: z.number().int().min(0).default(0),
  summary: z.string().max(400).optional(),
  goals: z.array(z.string().max(200)).max(10).default([]),
  tags: z.array(z.string().max(40)).max(20).default([]),
  estimatedMinutes: z.number().int().min(1).max(120).default(15),
  exercises: z.array(ExerciseSchema).min(1).max(12),
});
export type LessonMeta = z.infer<typeof LessonMetaSchema>;

export const AssessmentTaskSchema = ExerciseSchema.extend({
  level: z.number().int().min(1).max(5).describe("Nivel que demuestra quien supera esta prueba"),
  skill: z.string().min(1).max(40).describe("Habilidad que mide (ritmo, arpegio, melodía, cejilla…)"),
  reps: z.number().int().min(1).max(8).default(2),
  pass: z
    .object({
      accuracy: z.number().min(0).max(1).default(0.8).describe("Proporción mínima de notas correctas"),
      timingMs: z.number().int().min(10).max(300).default(70).describe("Desviación media máxima en ms"),
    })
    .prefault({}),
  loop: z.boolean().default(true),
});
export type AssessmentTaskMeta = z.infer<typeof AssessmentTaskSchema>;

export const AssessmentMetaSchema = z.object({
  type: z.literal("assessment"),
  formatVersion: z.literal(1).default(1),
  id,
  title: z.string().min(1).max(120),
  summary: z.string().max(400).optional(),
  questions: z
    .array(
      z.object({
        id,
        text: z.string().min(1).max(200),
        options: z.array(z.string().min(1).max(120)).min(2).max(8),
        multiple: z.boolean().default(false),
      }),
    )
    .max(12)
    .default([]),
  stopAfterFailures: z.number().int().min(1).max(10).default(2),
  exercises: z.array(AssessmentTaskSchema).min(1).max(20),
});
export type AssessmentMeta = z.infer<typeof AssessmentMetaSchema>;

export const CourseSchema = z.object({
  formatVersion: z.literal(1).default(1),
  title: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  goal: z
    .object({ title: z.string().min(1).max(120), description: z.string().max(500).optional(), level: z.number().int().min(1).max(5).optional() })
    .optional(),
  units: z
    .array(z.object({ id, title: z.string().min(1).max(80), level: z.number().int().min(1).max(5), description: z.string().max(500).optional() }))
    .min(1)
    .max(20),
  dailyRoutine: z
    .array(
      z.object({
        kind: z.enum(["tuner", "lesson", "free", "review"]),
        title: z.string().min(1).max(80),
        minutes: z.number().int().min(1).max(120),
      }),
    )
    .default([
      { kind: "tuner", title: "Afinar y calentar", minutes: 5 },
      { kind: "lesson", title: "Lección del día", minutes: 15 },
      { kind: "free", title: "Toca lo que quieras", minutes: 10 },
    ]),
});
export type Course = z.infer<typeof CourseSchema>;

export const NoteMetaSchema = z.object({
  title: z.string().min(1).max(120),
  date: z.union([z.string(), z.date()]).transform((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d)),
  lesson: id.optional(),
  session: z.string().optional(),
});

// ---------------------------------------------------------------------------

export interface Exercise extends ExerciseMeta {
  music: ParsedMusic;
  /** Fingering token per event index (undefined for rests). */
  fingers: (string | undefined)[];
}
export interface AssessmentTask extends AssessmentTaskMeta {
  music: ParsedMusic;
  fingers: (string | undefined)[];
}
export interface Lesson extends Omit<LessonMeta, "exercises"> {
  exercises: Exercise[];
  body: string;
  file: string;
}
export interface Assessment extends Omit<AssessmentMeta, "exercises"> {
  exercises: AssessmentTask[];
  body: string;
  file: string;
}
export interface InstructorNote {
  id: string;
  title: string;
  date: string;
  lesson?: string;
  session?: string;
  body: string;
}

export interface Curriculum {
  formatVersion: 1;
  course?: Course;
  lessons: Lesson[];
  assessment?: Assessment;
  notes: InstructorNote[];
  issues: Issue[];
  /** Content hash, used by clients to know when to refresh. */
  hash: string;
}

export interface Issue {
  file: string;
  level: "error" | "warning";
  message: string;
  line?: number;
}

export interface SourceFile {
  /** Path relative to the curriculum root, with forward slashes. */
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------

export function splitFrontmatter(src: string): { data: string; body: string; bodyLine: number } | undefined {
  const text = src.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return undefined;
  const after = text.indexOf("\n", end + 4);
  const data = text.slice(4, end);
  const body = after < 0 ? "" : text.slice(after + 1);
  return { data, body, bodyLine: data.split("\n").length + 3 };
}

const BLOCK_RE = /^```alphatex[ \t]+exercise=([a-z0-9-]+)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

export function findExerciseBlocks(body: string, bodyLine: number) {
  const blocks: { id: string; tex: string; line: number }[] = [];
  for (const m of body.matchAll(BLOCK_RE)) {
    const line = bodyLine + body.slice(0, m.index).split("\n").length;
    blocks.push({ id: m[1]!, tex: m[2]!, line });
  }
  return blocks;
}

function zodIssues(file: string, error: z.ZodError, prefix = ""): Issue[] {
  return error.issues.map((i) => ({
    file,
    level: "error" as const,
    message: `${prefix}${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`,
  }));
}

function texIssues(file: string, exId: string, blockLine: number, issues: TexIssue[]): Issue[] {
  return issues.map((i) => ({
    file,
    level: i.level,
    line: blockLine + i.line,
    message: `ejercicio "${exId}": ${i.message}`,
  }));
}

export function parseFingering(fingering: string | undefined, music: ParsedMusic): { fingers: (string | undefined)[]; error?: string } {
  const playable = music.events.filter((e) => !e.rest);
  if (!fingering?.trim()) return { fingers: music.events.map(() => undefined) };
  const tokens = fingering.trim().split(/\s+/);
  const bad = tokens.find((t) => !fingeringToken.test(t));
  if (bad) return { fingers: [], error: `digitación: "${bad}" no es válido (usa p, i, m, a, c, combinados con + o "-")` };
  if (playable.length % tokens.length !== 0)
    return { fingers: [], error: `digitación: tiene ${tokens.length} símbolos pero el ejercicio tiene ${playable.length} golpes (debe ser igual o divisor)` };
  let k = 0;
  const fingers = music.events.map((e) => {
    if (e.rest) return undefined;
    const t = tokens[k++ % tokens.length]!;
    return t === "-" ? undefined : t;
  });
  for (const e of music.events) {
    const f = fingers[e.index];
    if (f && f.split("+").length !== e.notes.length)
      return { fingers: [], error: `digitación: el golpe ${e.index + 1} tiene ${e.notes.length} nota(s) pero "${f}" indica ${f.split("+").length} dedo(s)` };
  }
  return { fingers };
}

function parseDoc<T extends z.ZodTypeAny>(file: SourceFile, schema: T, issues: Issue[]) {
  const fm = splitFrontmatter(file.content);
  if (!fm) {
    issues.push({ file: file.path, level: "error", message: "Falta el frontmatter YAML al inicio (--- … ---)" });
    return undefined;
  }
  let raw: unknown;
  try {
    raw = YAML.parse(fm.data);
  } catch (e) {
    issues.push({ file: file.path, level: "error", message: `YAML inválido: ${(e as Error).message}` });
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    issues.push(...zodIssues(file.path, parsed.error));
    return undefined;
  }
  return { meta: parsed.data as z.infer<T>, body: fm.body, bodyLine: fm.bodyLine };
}

function attachMusic<E extends { id: string; fingering?: string | undefined; tempo: { start: number } }>(
  file: string,
  exercises: E[],
  body: string,
  bodyLine: number,
  issues: Issue[],
): (E & { music: ParsedMusic; fingers: (string | undefined)[] })[] | undefined {
  const blocks = findExerciseBlocks(body, bodyLine);
  const byId = new Map<string, (typeof blocks)[number]>();
  for (const b of blocks) {
    if (byId.has(b.id)) issues.push({ file, level: "error", line: b.line, message: `Hay dos bloques alphatex para el ejercicio "${b.id}"` });
    byId.set(b.id, b);
  }
  const seen = new Set<string>();
  let ok = true;
  const out: (E & { music: ParsedMusic; fingers: (string | undefined)[] })[] = [];
  for (const ex of exercises) {
    if (seen.has(ex.id)) {
      issues.push({ file, level: "error", message: `Ejercicio repetido: "${ex.id}"` });
      ok = false;
    }
    seen.add(ex.id);
    const block = byId.get(ex.id);
    if (!block) {
      issues.push({ file, level: "error", message: `Falta el bloque \`\`\`alphatex exercise=${ex.id} en el cuerpo de la lección` });
      ok = false;
      continue;
    }
    const { music, issues: ti } = parseAlphaTex(block.tex);
    issues.push(...texIssues(file, ex.id, block.line, ti));
    if (ti.some((i) => i.level === "error")) {
      ok = false;
      continue;
    }
    if (music.tempo && music.tempo !== ex.tempo.start)
      issues.push({ file, level: "warning", line: block.line, message: `ejercicio "${ex.id}": \\tempo ${music.tempo} se ignora; la app usa tempo.start (${ex.tempo.start})` });
    const f = parseFingering(ex.fingering, music);
    if (f.error) {
      issues.push({ file, level: "error", message: `ejercicio "${ex.id}": ${f.error}` });
      ok = false;
      continue;
    }
    out.push({ ...ex, music, fingers: f.fingers });
  }
  for (const b of blocks)
    if (!exercises.some((e) => e.id === b.id))
      issues.push({ file, level: "warning", line: b.line, message: `El bloque alphatex "${b.id}" no corresponde a ningún ejercicio del frontmatter` });
  return ok ? out : undefined;
}

export function parseLesson(file: SourceFile, issues: Issue[]): Lesson | undefined {
  const doc = parseDoc(file, LessonMetaSchema, issues);
  if (!doc) return undefined;
  const exercises = attachMusic(file.path, doc.meta.exercises, doc.body, doc.bodyLine, issues);
  if (!exercises) return undefined;
  return { ...doc.meta, exercises, body: doc.body, file: file.path };
}

export function parseAssessment(file: SourceFile, issues: Issue[]): Assessment | undefined {
  const doc = parseDoc(file, AssessmentMetaSchema, issues);
  if (!doc) return undefined;
  const exercises = attachMusic(file.path, doc.meta.exercises, doc.body, doc.bodyLine, issues);
  if (!exercises) return undefined;
  return { ...doc.meta, exercises, body: doc.body, file: file.path };
}

function hashString(s: string): string {
  // FNV-1a 32-bit, good enough for change detection.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Parses and validates a whole curriculum given its files. Never throws. */
export function buildCurriculum(files: SourceFile[]): Curriculum {
  const issues: Issue[] = [];
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  let course: Course | undefined;
  let assessment: Assessment | undefined;
  const lessons: Lesson[] = [];
  const notes: InstructorNote[] = [];

  for (const f of sorted) {
    if (f.path === "course.yaml" || f.path === "course.yml") {
      try {
        const parsed = CourseSchema.safeParse(YAML.parse(f.content));
        if (parsed.success) course = parsed.data;
        else issues.push(...zodIssues(f.path, parsed.error));
      } catch (e) {
        issues.push({ file: f.path, level: "error", message: `YAML inválido: ${(e as Error).message}` });
      }
    } else if (f.path === "assessment.md") {
      assessment = parseAssessment(f, issues);
    } else if (/^lessons\/[^/]+\.md$/.test(f.path)) {
      const l = parseLesson(f, issues);
      if (l) lessons.push(l);
    } else if (/^notes\/[^/]+\.md$/.test(f.path)) {
      const fm = splitFrontmatter(f.content);
      if (!fm) {
        issues.push({ file: f.path, level: "error", message: "Falta el frontmatter (title, date)" });
        continue;
      }
      try {
        const parsed = NoteMetaSchema.safeParse(YAML.parse(fm.data));
        if (parsed.success)
          notes.push({ id: f.path.replace(/^notes\//, "").replace(/\.md$/, ""), ...parsed.data, body: fm.body.trim() });
        else issues.push(...zodIssues(f.path, parsed.error));
      } catch (e) {
        issues.push({ file: f.path, level: "error", message: `YAML inválido: ${(e as Error).message}` });
      }
    }
  }

  const ids = new Map<string, string>();
  for (const l of lessons) {
    const prev = ids.get(l.id);
    if (prev) issues.push({ file: l.file, level: "error", message: `El id "${l.id}" ya se usa en ${prev}` });
    ids.set(l.id, l.file);
    if (course && l.unit && !course.units.some((u) => u.id === l.unit))
      issues.push({ file: l.file, level: "error", message: `La unidad "${l.unit}" no existe en course.yaml` });
  }
  if (!lessons.length) issues.push({ file: "lessons/", level: "warning", message: "No hay lecciones válidas" });

  lessons.sort((a, b) => a.level - b.level || unitIndex(course, a.unit) - unitIndex(course, b.unit) || a.order - b.order || a.id.localeCompare(b.id));
  notes.sort((a, b) => b.date.localeCompare(a.date));

  // Hash what clients receive, not just the source files: if the parser changes (new
  // features, fixes) the same files can produce a different curriculum, and clients must
  // not keep a stale copy because the files' text didn't change.
  const built = { formatVersion: 1 as const, course, lessons, assessment, notes, issues };
  return { ...built, hash: hashString(JSON.stringify(built)) };
}

function unitIndex(course: Course | undefined, unit: string | undefined) {
  if (!course || !unit) return 0;
  const i = course.units.findIndex((u) => u.id === unit);
  return i < 0 ? 999 : i;
}
