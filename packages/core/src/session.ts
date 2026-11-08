/**
 * Session record format (v1). One record per practice run. Stored by the server as
 * data/sessions/<id>/session.json next to its media files. See docs/session-format.md.
 */
import { z } from "zod";

export const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;
export const FILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

export const NoteResultSchema = z.object({
  rep: z.number().int().min(0),
  event: z.number().int().min(0),
  /** Expected time, seconds from the first beat. */
  t: z.number(),
  expected: z.array(z.number().int()),
  detected: z.number().int().nullable(),
  hit: z.boolean(),
  deviationMs: z.number().nullable(),
  finger: z.string().optional(),
});
export type NoteResult = z.infer<typeof NoteResultSchema>;

export const RepResultSchema = z.object({
  index: z.number().int().min(0),
  clean: z.boolean(),
  hits: z.number().int().min(0),
  total: z.number().int().min(0),
  meanAbsDeviationMs: z.number().nullable(),
});
export type RepResult = z.infer<typeof RepResultSchema>;

export const PostureEventSchema = z.object({
  t: z.number(),
  check: z.string(),
  value: z.number(),
  message: z.string(),
  frame: z.string().optional(),
});

export const CueSchema = z.object({
  t: z.number(),
  level: z.enum(["good", "warn", "bad", "info"]),
  message: z.string(),
});

export const SummarySchema = z.object({
  accuracy: z.number().nullable(),
  meanDeviationMs: z.number().nullable(),
  meanAbsDeviationMs: z.number().nullable(),
  cleanReps: z.number().int(),
  totalReps: z.number().int(),
  notesExpected: z.number().int(),
  notesHit: z.number().int(),
  extraNotes: z.number().int(),
  /** Most frequently missed expected notes (MIDI), most common first. */
  problemNotes: z.array(z.object({ midi: z.number().int(), misses: z.number().int(), heardAs: z.number().int().nullable() })).default([]),
  /** Share of analysed frames where each posture check was in warning state (0–1). */
  posture: z.record(z.string(), z.number()).default({}),
});
export type SessionSummary = z.infer<typeof SummarySchema>;

export const AssessmentResultSchema = z.object({
  assessmentId: z.string(),
  answers: z.record(z.string(), z.array(z.string())).default({}),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      level: z.number().int(),
      skill: z.string(),
      bpm: z.number(),
      status: z.enum(["passed", "failed", "skipped", "not-reached"]),
      accuracy: z.number().nullable(),
      meanAbsDeviationMs: z.number().nullable(),
    }),
  ),
  level: z.number().int().min(0),
  recommendedLessonId: z.string().nullable(),
  skills: z.record(z.string(), z.number()).default({}),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

export const SessionFileSchema = z.object({
  name: z.string().regex(FILE_NAME_RE),
  type: z.string().max(100),
  size: z.number().int().min(0),
  kind: z.enum(["audio", "video", "frame"]),
  t: z.number().optional(),
  caption: z.string().max(200).optional(),
});
export type SessionFile = z.infer<typeof SessionFileSchema>;

export const SessionSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().regex(SESSION_ID_RE),
  kind: z.enum(["exercise", "assessment", "free"]),
  mode: z.enum(["audio", "camera"]),
  device: z.object({ kind: z.enum(["phone", "tablet", "laptop"]), name: z.string().max(100).optional() }),
  startedAt: z.string(),
  endedAt: z.string(),
  durationSec: z.number().min(0),
  lesson: z.object({ id: z.string(), title: z.string() }).optional(),
  exercise: z.object({ id: z.string(), title: z.string() }).optional(),
  bpm: z.number().nullable(),
  beatUnit: z.number().int().optional(),
  latencyMs: z.number().default(0),
  reps: z.array(RepResultSchema).default([]),
  notes: z.array(NoteResultSchema).default([]),
  /** Onsets that matched no expected note (seconds from the first beat). */
  extraOnsets: z.array(z.object({ t: z.number(), midi: z.number().int().nullable() })).optional(),
  /** Per-note timing tolerance used for this session, in ms. */
  timingToleranceMs: z.number().optional(),
  posture: z.array(PostureEventSchema).default([]),
  cues: z.array(CueSchema).default([]),
  summary: SummarySchema,
  assessment: AssessmentResultSchema.optional(),
  /** Free-text note the student leaves for the instructor. */
  userNote: z.string().max(4000).optional(),
  files: z.array(SessionFileSchema).default([]),
  /** Tempo the student unlocked with this session (exercise sessions only). */
  unlockedBpm: z.number().nullable().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Light version used in lists, sync and progress charts. */
export type SessionListItem = Omit<Session, "notes" | "posture" | "cues" | "reps" | "extraOnsets">;

export function toListItem(s: Session): SessionListItem {
  const { notes: _n, posture: _p, cues: _c, reps: _r, extraOnsets: _x, ...rest } = s;
  return rest;
}

export const ProfileSchema = z.object({
  formatVersion: z.literal(1).default(1),
  updatedAt: z.string(),
  name: z.string().max(80).optional(),
  assessment: AssessmentResultSchema.extend({ sessionId: z.string(), date: z.string() }).optional(),
  /** Current lesson the student is working on. */
  currentLessonId: z.string().nullable().default(null),
});
export type Profile = z.infer<typeof ProfileSchema>;
