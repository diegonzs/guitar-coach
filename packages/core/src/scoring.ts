/**
 * Score-informed evaluation: we know which notes the student should play and when,
 * so each detected onset is matched against the expected timeline.
 */
import type { ParsedMusic } from "./alphatex.ts";
import { GUITAR_MIDI_MIN } from "./music.ts";
import type { NoteResult, RepResult, SessionSummary, AssessmentResult, SessionListItem } from "./session.ts";
import type { Assessment, Lesson, Exercise } from "./lesson.ts";

export interface ExpectedEvent {
  rep: number;
  event: number;
  /** Seconds from the first beat. */
  t: number;
  midis: number[];
  finger?: string;
  /** Half-width of the matching window in seconds. */
  window: number;
}

/** Seconds per quarter note for a BPM measured in the given beat unit. */
export function secondsPerQuarter(bpm: number, beatUnit: 4 | 8 = 4): number {
  return (60 / bpm) * (beatUnit === 8 ? 2 : 1);
}

/** Length of one repetition of the exercise in seconds. */
export function repLength(music: ParsedMusic, bpm: number, beatUnit: 4 | 8 = 4): number {
  return music.length * secondsPerQuarter(bpm, beatUnit);
}

/** Metronome beats per bar for the time signature, expressed in the beat unit. */
export function beatsPerBar(music: ParsedMusic, beatUnit: 4 | 8 = 4): number {
  const [n, d] = music.timeSignature;
  return (n * beatUnit) / d;
}

export function expectedForRep(music: ParsedMusic, fingers: (string | undefined)[], rep: number, bpm: number, beatUnit: 4 | 8 = 4): ExpectedEvent[] {
  const spq = secondsPerQuarter(bpm, beatUnit);
  const len = music.length * spq;
  const playable = music.events.filter((e) => !e.rest);
  return playable.map((e, i) => {
    const t = rep * len + e.start * spq;
    const prev = playable[i - 1];
    const next = playable[i + 1];
    const gapPrev = prev ? (e.start - prev.start) * spq : (e.start + music.length - (playable.at(-1)?.start ?? 0)) * spq;
    const gapNext = next ? (next.start - e.start) * spq : (music.length - e.start + (playable[0]?.start ?? 0)) * spq;
    const gap = Math.min(gapPrev || Infinity, gapNext || Infinity);
    return {
      rep,
      event: e.index,
      t,
      midis: e.notes.map((n) => n.midi),
      finger: fingers[e.index],
      window: Math.min(0.45 * (Number.isFinite(gap) ? gap : 1), 0.25),
    };
  });
}

export interface Onset {
  /** Seconds from the first beat (already latency-compensated). */
  t: number;
  /** Salience of the new energy per MIDI note starting at GUITAR_MIDI_MIN. */
  salience: Float32Array | number[];
  /** Salience of everything sounding after the attack (same indexing). */
  present?: Float32Array | number[];
  /** Best MIDI guess, or null if unclear. */
  midi: number | null;
}

export function salienceOf(o: Onset, midi: number): number {
  return o.salience[midi - GUITAR_MIDI_MIN] ?? 0;
}

export function maxSalience(o: Onset): number {
  let m = 0;
  for (let i = 0; i < o.salience.length; i++) m = Math.max(m, o.salience[i]!);
  return m;
}

function presentRatio(o: Onset, midi: number): number {
  if (!o.present) return 0;
  let max = 0;
  for (let i = 0; i < o.present.length; i++) max = Math.max(max, o.present[i]!);
  return max > 0 ? (o.present[midi - GUITAR_MIDI_MIN] ?? 0) / max : 0;
}

/** Did the onset contain all the expected notes? */
export function pitchMatches(o: Onset, midis: number[]): boolean {
  const max = maxSalience(o);
  if (max <= 0) return false;
  if (midis.length === 1) {
    const m = midis[0]!;
    if (o.midi === m) return true;
    // The estimator may land on a harmonic of the expected note when the string was
    // re-plucked while ringing; accept it if the expected note is clearly sounding.
    if (o.midi !== null && [12, 19, 24].includes(o.midi - m) && presentRatio(o, m) >= 0.5) return true;
    return salienceOf(o, m) >= 0.8 * max;
  }
  return midis.every((m) => salienceOf(o, m) >= 0.3 * max || presentRatio(o, m) >= 0.5);
}

/**
 * Streaming matcher. Feed it onsets as they're detected and call `advance(now)`
 * regularly; it emits note results once each expected note's window has closed.
 */
export class TimelineMatcher {
  private pending: ExpectedEvent[] = [];
  private onsets: (Onset & { used: boolean })[] = [];
  private nextRep = 0;
  readonly results: NoteResult[] = [];
  readonly reps: RepResult[] = [];
  extras = 0;
  private repBuffer = new Map<number, NoteResult[]>();

  constructor(
    private music: ParsedMusic,
    private fingers: (string | undefined)[],
    private bpm: number,
    private beatUnit: 4 | 8,
    private toleranceMs: number,
    /** Max number of repetitions (Infinity for loops). */
    private maxReps = Infinity,
    private onNote?: (r: NoteResult) => void,
    private onRep?: (r: RepResult) => void,
  ) {}

  private playableCount = () => this.music.events.filter((e) => !e.rest).length;

  private ensureReps(now: number) {
    const len = repLength(this.music, this.bpm, this.beatUnit);
    while (this.nextRep < this.maxReps && this.nextRep * len <= now + len) {
      this.pending.push(...expectedForRep(this.music, this.fingers, this.nextRep, this.bpm, this.beatUnit));
      this.nextRep++;
    }
  }

  addOnset(o: Onset) {
    this.onsets.push({ ...o, used: false });
  }

  /** Finalise every expected note whose window closed before `now`. */
  advance(now: number) {
    this.ensureReps(now);
    while (this.pending.length && this.pending[0]!.t + this.pending[0]!.window < now - 0.02) {
      this.finalize(this.pending.shift()!);
    }
    // onsets that can no longer match anything are extras
    const horizon = this.pending[0] ? this.pending[0].t - this.pending[0].window : now;
    this.onsets = this.onsets.filter((o) => {
      if (o.t < horizon) {
        if (!o.used && o.t > -0.3) this.extras++;
        return false;
      }
      return true;
    });
  }

  /** Close everything (end of the session). */
  flush(now: number) {
    while (this.pending.length && this.pending[0]!.t - this.pending[0]!.window < now) this.finalize(this.pending.shift()!);
    this.pending = [];
  }

  private finalize(ev: ExpectedEvent) {
    const cands = this.onsets.filter((o) => !o.used && Math.abs(o.t - ev.t) <= ev.window);
    let best: (typeof cands)[number] | undefined;
    for (const c of cands) {
      const better =
        !best ||
        (pitchMatches(c, ev.midis) && !pitchMatches(best, ev.midis)) ||
        (pitchMatches(c, ev.midis) === pitchMatches(best, ev.midis) && Math.abs(c.t - ev.t) < Math.abs(best.t - ev.t));
      if (better) best = c;
    }
    if (best) best.used = true;
    const hit = !!best && pitchMatches(best, ev.midis);
    const r: NoteResult = {
      rep: ev.rep,
      event: ev.event,
      t: round3(ev.t),
      expected: ev.midis,
      detected: best ? best.midi : null,
      hit,
      deviationMs: best ? Math.round((best.t - ev.t) * 1000) : null,
      ...(ev.finger ? { finger: ev.finger } : {}),
    };
    this.results.push(r);
    this.onNote?.(r);
    const buf = this.repBuffer.get(ev.rep) ?? [];
    buf.push(r);
    this.repBuffer.set(ev.rep, buf);
    if (buf.length === this.playableCount()) {
      this.repBuffer.delete(ev.rep);
      const rep = summarizeRep(ev.rep, buf, this.toleranceMs);
      this.reps.push(rep);
      this.onRep?.(rep);
    }
  }
}

export function summarizeRep(index: number, notes: NoteResult[], toleranceMs: number): RepResult {
  const hits = notes.filter((n) => n.hit).length;
  const devs = notes.filter((n) => n.hit && n.deviationMs !== null).map((n) => Math.abs(n.deviationMs!));
  const mad = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : null;
  const clean = hits === notes.length && notes.every((n) => n.deviationMs !== null && Math.abs(n.deviationMs) <= toleranceMs * 1.5) && (mad ?? Infinity) <= toleranceMs;
  return { index, clean, hits, total: notes.length, meanAbsDeviationMs: mad === null ? null : Math.round(mad) };
}

export function summarize(notes: NoteResult[], reps: RepResult[], extras: number, posture: Record<string, number> = {}): SessionSummary {
  const hits = notes.filter((n) => n.hit);
  const devs = hits.filter((n) => n.deviationMs !== null).map((n) => n.deviationMs!);
  const misses = new Map<number, { misses: number; heard: Map<number, number> }>();
  for (const n of notes) {
    if (n.hit || n.expected.length !== 1) continue;
    const m = n.expected[0]!;
    const e = misses.get(m) ?? { misses: 0, heard: new Map() };
    e.misses++;
    if (n.detected !== null) e.heard.set(n.detected, (e.heard.get(n.detected) ?? 0) + 1);
    misses.set(m, e);
  }
  const problemNotes = [...misses.entries()]
    .map(([midi, e]) => {
      const heard = [...e.heard.entries()].sort((a, b) => b[1] - a[1])[0];
      return { midi, misses: e.misses, heardAs: heard ? heard[0] : null };
    })
    .filter((p) => p.misses >= 2)
    .sort((a, b) => b.misses - a.misses)
    .slice(0, 5);
  return {
    accuracy: notes.length ? round3(hits.length / notes.length) : null,
    meanDeviationMs: devs.length ? Math.round(devs.reduce((a, b) => a + b, 0) / devs.length) : null,
    meanAbsDeviationMs: devs.length ? Math.round(devs.reduce((a, b) => a + Math.abs(b), 0) / devs.length) : null,
    cleanReps: reps.filter((r) => r.clean).length,
    totalReps: reps.length,
    notesExpected: notes.length,
    notesHit: hits.length,
    extraNotes: extras,
    problemNotes,
    posture,
  };
}

// ---------------------------------------------------------------------------
// Tempo ladder

export interface ExerciseProgress {
  lessonId: string;
  exerciseId: string;
  /** Highest BPM at which the student completed the required clean reps. */
  bestCleanBpm: number | null;
  /** Tempo the app suggests next. */
  suggestedBpm: number;
  mastered: boolean;
  sessions: number;
  history: { date: string; bpm: number; accuracy: number | null; cleanReps: number }[];
}

export function exerciseProgress(lessonId: string, ex: Exercise, sessions: SessionListItem[]): ExerciseProgress {
  const mine = sessions
    .filter((s) => s.kind === "exercise" && s.lesson?.id === lessonId && s.exercise?.id === ex.id && s.bpm)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  let best: number | null = null;
  for (const s of mine) if (s.summary.cleanReps >= ex.cleanRepsToAdvance && s.bpm! >= (best ?? 0)) best = s.bpm!;
  const target = ex.tempo.target ?? ex.tempo.start;
  const mastered = best !== null && best >= target;
  const suggested = best === null ? ex.tempo.start : Math.min(target, best + ex.tempo.step);
  return {
    lessonId,
    exerciseId: ex.id,
    bestCleanBpm: best,
    suggestedBpm: mastered ? target : suggested,
    mastered,
    sessions: mine.length,
    history: mine.map((s) => ({ date: s.startedAt, bpm: s.bpm!, accuracy: s.summary.accuracy, cleanReps: s.summary.cleanReps })),
  };
}

export function lessonProgress(lesson: Lesson, sessions: SessionListItem[]) {
  const exercises = lesson.exercises.map((e) => exerciseProgress(lesson.id, e, sessions));
  const done = exercises.filter((e) => e.mastered).length;
  return { lessonId: lesson.id, exercises, mastered: done === exercises.length, ratio: exercises.length ? done / exercises.length : 0, started: exercises.some((e) => e.sessions > 0) };
}

// ---------------------------------------------------------------------------
// Assessment

export type TaskOutcome = { id: string; status: "passed" | "failed" | "skipped" | "not-reached"; accuracy: number | null; meanAbsDeviationMs: number | null; bpm: number };

export function taskPassed(task: Assessment["exercises"][number], s: { accuracy: number | null; meanAbsDeviationMs: number | null }): boolean {
  return (s.accuracy ?? 0) >= task.pass.accuracy && s.meanAbsDeviationMs !== null && s.meanAbsDeviationMs <= task.pass.timingMs;
}

export function gradeAssessment(assessment: Assessment, outcomes: TaskOutcome[], lessons: Lesson[], answers: Record<string, string[]> = {}): AssessmentResult {
  const byId = new Map(outcomes.map((o) => [o.id, o]));
  const levels = [...new Set(assessment.exercises.map((t) => t.level))].sort((a, b) => a - b);
  let level = 0;
  for (const l of levels) {
    const tasks = assessment.exercises.filter((t) => t.level === l);
    if (tasks.every((t) => byId.get(t.id)?.status === "passed")) level = l;
    else break;
  }
  const skills: Record<string, number> = {};
  for (const t of assessment.exercises) {
    const o = byId.get(t.id);
    const score = o?.status === "passed" ? 1 : o?.status === "failed" ? Math.min(0.9, (o.accuracy ?? 0) * 0.9) : 0;
    skills[t.skill] = Math.max(skills[t.skill] ?? 0, round3(score));
  }
  const maxLessonLevel = Math.max(0, ...lessons.map((l) => l.level));
  const startLevel = Math.min(level + 1, maxLessonLevel || 1);
  const recommended = lessons.find((l) => l.level === startLevel) ?? lessons.filter((l) => l.level <= startLevel).at(-1) ?? lessons[0];
  return {
    assessmentId: assessment.id,
    answers,
    tasks: assessment.exercises.map((t) => {
      const o = byId.get(t.id);
      return {
        id: t.id,
        title: t.title,
        level: t.level,
        skill: t.skill,
        bpm: o?.bpm ?? t.tempo.start,
        status: o?.status ?? "not-reached",
        accuracy: o?.accuracy ?? null,
        meanAbsDeviationMs: o?.meanAbsDeviationMs ?? null,
      };
    }),
    level,
    recommendedLessonId: recommended?.id ?? null,
    skills,
  };
}

export const LEVEL_NAMES = ["Principiante", "Fundamentos", "Independencia", "Primeros arreglos", "Intermedio", "Avanzado"];

// ---------------------------------------------------------------------------
// Activity

/** Local calendar day (YYYY-MM-DD) for an ISO timestamp. */
export function localDay(iso: string | Date, tzOffsetMin = new Date().getTimezoneOffset()): string {
  const d = new Date(typeof iso === "string" ? iso : iso.getTime());
  return new Date(d.getTime() - tzOffsetMin * 60000).toISOString().slice(0, 10);
}

export function minutesByDay(sessions: SessionListItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    const d = localDay(s.startedAt);
    m.set(d, (m.get(d) ?? 0) + s.durationSec / 60);
  }
  return m;
}

/** Consecutive days with practice, counting today or (if not yet practised today) ending yesterday. */
export function streak(sessions: SessionListItem[], today = new Date()): number {
  const days = new Set(sessions.map((s) => localDay(s.startedAt)));
  const d = new Date(today);
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
