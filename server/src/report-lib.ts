/**
 * Builds the progress report an LLM tutor reads to review the student's practice
 * (data/reports/latest.md) and a machine-readable data/progress.json.
 */
import { join } from "node:path";
import {
  CHECK_LABELS,
  LEVEL_NAMES,
  lessonProgress,
  midiToName,
  minutesByDay,
  streak,
  localDay,
  type Curriculum,
  type Session,
  type Check,
} from "@guitar-coach/core";
import type { Store } from "./store.ts";

export interface ReportOptions {
  days?: number;
  maxSessions?: number;
  now?: Date;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${Math.round(x * 100)}%`);
const ms = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${x} ms`);
const checkLabel = (c: string) => CHECK_LABELS[c as Check] ?? c;

export async function buildReport(store: Store, curriculum: Curriculum, curriculumDir: string, opts: ReportOptions = {}) {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 14;
  const list = await store.listSessions();
  const profile = await store.getProfile();
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const recent = list.filter((s) => s.startedAt >= since);
  const mins = minutesByDay(recent);
  const lessons = curriculum.lessons.map((l) => ({ lesson: l, progress: lessonProgress(l, list) }));

  const progressJson = {
    generatedAt: now.toISOString(),
    curriculumDir,
    profile,
    streak: streak(list, now),
    minutesByDay: Object.fromEntries([...minutesByDay(list).entries()].map(([d, m]) => [d, Math.round(m)])),
    lessons: lessons.map(({ lesson, progress }) => ({ id: lesson.id, title: lesson.title, level: lesson.level, ...progress })),
    sessions: list.slice(0, 200),
  };

  const L: string[] = [];
  L.push(`# Informe de práctica · guitar-coach`, ``);
  L.push(`Generado: ${now.toISOString()} · Periodo: últimos ${days} días`);
  L.push(`Datos: \`${store.dataDir}\` · Currículo: \`${curriculumDir}\``, ``);

  L.push(`## Estudiante`, ``);
  if (profile?.assessment) {
    const a = profile.assessment;
    L.push(`- **Nivel** (evaluación del ${a.date.slice(0, 10)}): ${a.level} · ${LEVEL_NAMES[a.level] ?? ""}`);
    L.push(`- Lección recomendada por la evaluación: ${a.recommendedLessonId ?? "–"}`);
    const skills = Object.entries(a.skills).map(([k, v]) => `${k} ${pct(v)}`).join(", ");
    if (skills) L.push(`- Habilidades: ${skills}`);
    for (const t of a.tasks) L.push(`  - ${t.title} (nivel ${t.level}, ${t.skill}): **${t.status}** · precisión ${pct(t.accuracy)} · desfase ${ms(t.meanAbsDeviationMs)}`);
    const ans = Object.entries(a.answers);
    if (ans.length) {
      L.push(`- Cuestionario:`);
      for (const [q, v] of ans) {
        const text = curriculum.assessment?.questions.find((x) => x.id === q)?.text ?? q;
        L.push(`  - ${text} → ${v.join(", ")}`);
      }
    }
  } else L.push(`- Todavía no hizo la evaluación de nivel.`);
  if (profile?.currentLessonId) L.push(`- Lección actual: ${profile.currentLessonId}`);
  L.push(``);

  const totalMin = [...mins.values()].reduce((a, b) => a + b, 0);
  L.push(`## Constancia`, ``);
  L.push(`- Sesiones en el periodo: ${recent.length} · Minutos: ${Math.round(totalMin)} · Días con práctica: ${mins.size}/${days}`);
  L.push(`- Racha actual: ${streak(list, now)} días`, ``);

  L.push(`## Progreso por lección`, ``);
  L.push(`| Lección | Ejercicio | Mejor BPM limpio | Objetivo | Sugerido | Dominado | Sesiones |`, `|---|---|---|---|---|---|---|`);
  for (const { lesson, progress } of lessons) {
    for (const e of progress.exercises) {
      const ex = lesson.exercises.find((x) => x.id === e.exerciseId)!;
      L.push(`| ${lesson.id} | ${ex.title} | ${e.bestCleanBpm ?? "–"} | ${ex.tempo.target ?? ex.tempo.start} | ${e.suggestedBpm} | ${e.mastered ? "sí" : "no"} | ${e.sessions} |`);
    }
  }
  L.push(``);

  L.push(`## Sesiones recientes`, ``);
  const detailed = recent.slice(0, opts.maxSessions ?? 15);
  if (!detailed.length) L.push(`(sin sesiones en el periodo)`, ``);
  for (const item of detailed) {
    const s = (await store.getSession(item.id)) as Session | null;
    if (!s) continue;
    const what = s.kind === "assessment" ? "Evaluación de nivel" : s.kind === "free" ? "Práctica libre" : `${s.lesson?.title ?? "?"} → ${s.exercise?.title ?? "?"}`;
    L.push(`### ${localDay(s.startedAt)} · ${what}`, ``);
    L.push(`- id: \`${s.id}\` · modo: ${s.mode === "camera" ? "cámara" : "solo audio"} · dispositivo: ${s.device.kind} · ${s.bpm ?? "–"} BPM · ${Math.round(s.durationSec / 60)} min`);
    const sm = s.summary;
    L.push(`- Precisión ${pct(sm.accuracy)} (${sm.notesHit}/${sm.notesExpected}) · desfase medio ${ms(sm.meanDeviationMs)} (abs ${ms(sm.meanAbsDeviationMs)}) · reps limpias ${sm.cleanReps}/${sm.totalReps} · notas de más ${sm.extraNotes}`);
    if (s.unlockedBpm) L.push(`- Desbloqueó ${s.unlockedBpm} BPM`);
    if (sm.problemNotes.length)
      L.push(`- Notas problemáticas: ${sm.problemNotes.map((p) => `${midiToName(p.midi)} falló ${p.misses}×${p.heardAs !== null ? ` (sonó ${midiToName(p.heardAs)})` : " (no sonó)"}`).join("; ")}`);
    const post = Object.entries(sm.posture).filter(([, v]) => v > 0);
    if (post.length) L.push(`- Postura (tiempo en alerta): ${post.map(([k, v]) => `${checkLabel(k)} ${pct(v)}`).join(", ")}`);
    if (s.cues.length) L.push(`- Indicaciones dadas: ${[...new Set(s.cues.map((c) => c.message))].slice(0, 6).join(" · ")}`);
    if (s.userNote) L.push(`- **Nota del estudiante:** "${s.userNote.replace(/\n/g, " ")}"`);
    if (s.assessment) L.push(`- Resultado: nivel ${s.assessment.level}, recomendada ${s.assessment.recommendedLessonId ?? "–"}`);
    const media = s.files.filter((f) => f.kind !== "frame");
    const frames = s.files.filter((f) => f.kind === "frame");
    const dir = store.sessionDir(s.id);
    if (media.length) L.push(`- Grabación: ${media.map((f) => `\`${join(dir, f.name)}\``).join(", ")}`);
    if (frames.length) {
      L.push(`- Fotogramas (ábrelos para revisar la postura):`);
      for (const f of frames.slice(0, 8)) L.push(`  - \`${join(dir, f.name)}\`${f.caption ? ` · ${f.caption}` : ""}${f.t !== undefined ? ` · t=${f.t.toFixed(1)} s` : ""}`);
    }
    L.push(``);
  }

  L.push(`## Instrucciones para el instructor (LLM)`, ``);
  L.push(`Lee docs/llm-guide.md. Con este informe:`);
  L.push(`1. Escribe una nota breve para el estudiante en \`${join(curriculumDir, "notes")}/AAAA-MM-DD-tema.md\` (frontmatter: title, date).`);
  L.push(`2. Si hace falta, crea o ajusta lecciones en \`${join(curriculumDir, "lessons")}\` siguiendo docs/lesson-format.md.`);
  L.push(`3. Valida con \`bun run validate ${curriculumDir}\` antes de terminar.`);
  return { markdown: L.join("\n") + "\n", progressJson };
}

export async function writeReport(store: Store, curriculum: Curriculum, curriculumDir: string, opts: ReportOptions = {}) {
  const { markdown, progressJson } = await buildReport(store, curriculum, curriculumDir, opts);
  const md = await store.writeText("reports/latest.md", markdown);
  const json = await store.writeText("progress.json", JSON.stringify(progressJson, null, 2));
  return { md, json, markdown };
}
