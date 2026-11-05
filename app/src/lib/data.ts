/** React hooks over the local database. Everything works offline. */
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { lessonProgress, type Lesson, type Profile, type Session, type SessionListItem } from "@guitar-coach/core";
import { db, type CurriculumPayload } from "./db";

export function useCurriculum(): CurriculumPayload | null | undefined {
  return useLiveQuery(async () => ((await db.kv.get("curriculum"))?.value as CurriculumPayload | undefined) ?? null, []);
}

export function useProfile(): Profile | null | undefined {
  return useLiveQuery(async () => ((await db.kv.get("profile"))?.value as Profile | undefined) ?? null, []);
}

export function useSessions(): SessionListItem[] | undefined {
  return useLiveQuery(async () => (await db.sessions.orderBy("startedAt").reverse().toArray()).map((s) => s.data), []);
}

export function useSession(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await db.sessions.get(id)) ?? null) : null), [id]);
}

export function useSessionFiles(id: string | undefined) {
  return useLiveQuery(async () => (id ? db.files.where("sessionId").equals(id).toArray() : []), [id]);
}

export function useLessonProgress(lessons: Lesson[] | undefined, sessions: SessionListItem[] | undefined) {
  return useMemo(() => {
    const m = new Map<string, ReturnType<typeof lessonProgress>>();
    if (lessons && sessions) for (const l of lessons) m.set(l.id, lessonProgress(l, sessions));
    return m;
  }, [lessons, sessions]);
}

export function isFullSession(s: Session | SessionListItem): s is Session {
  return Array.isArray((s as Session).notes);
}

/** Lesson the student should work on now. */
export function currentLesson(curriculum: CurriculumPayload | null | undefined, profile: Profile | null | undefined, progress: Map<string, { mastered: boolean }>): Lesson | undefined {
  if (!curriculum?.lessons.length) return undefined;
  const byId = (id: string | null | undefined) => (id ? curriculum.lessons.find((l) => l.id === id) : undefined);
  const chosen = byId(profile?.currentLessonId) ?? byId(profile?.assessment?.recommendedLessonId);
  if (chosen && !progress.get(chosen.id)?.mastered) return chosen;
  const start = chosen ? curriculum.lessons.indexOf(chosen) : 0;
  return curriculum.lessons.slice(start).find((l) => !progress.get(l.id)?.mastered) ?? chosen ?? curriculum.lessons[0];
}
