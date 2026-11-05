/**
 * PracticeRun: one practice attempt. Ties together the metronome, mic analysis,
 * score-informed evaluation, posture tracking, live cues, recording and keyframes.
 */
import {
  OnsetDetector,
  TimelineMatcher,
  beatsPerBar,
  expectedForRep,
  isClickEcho,
  midiToName,
  repLength,
  secondsPerQuarter,
  summarize,
  type AssessmentTask,
  type Exercise,
  type NoteResult,
  type RepResult,
  type Session,
  type SessionFile,
} from "@guitar-coach/core";
import { audio } from "./engine";
import { Metronome } from "./metronome";
import { Recorder, extFor } from "./recorder";
import { getSettings } from "@/lib/settings";
import { speak } from "@/lib/speech";
import { deviceKind, newId } from "@/lib/device";
import { computePosture, MESSAGES, PostureTracker, SPOKEN, THRESHOLDS, type PostureCheck, type PostureValues } from "@/vision/posture";
import { VisionLoop, drawOverlay, snapshot } from "@/vision/vision";

export type Feedback = "neutral" | "good" | "warn" | "bad";

export interface Cue {
  id: number;
  t: number;
  level: "good" | "warn" | "bad" | "info";
  title: string;
  detail?: string;
}

export interface PracticeState {
  phase: "idle" | "starting" | "countin" | "running" | "finishing" | "done" | "error";
  error?: string;
  countIn: number | null;
  beatInBar: number;
  elapsed: number;
  rep: number;
  cursor: number;
  /** Per event index of the current rep: "hit" | "miss" | undefined */
  repStates: (string | undefined)[];
  recent: NoteResult[];
  lastHeard: { midi: number | null; t: number } | null;
  hits: number;
  total: number;
  meanDevMs: number | null;
  cleanReps: number;
  totalReps: number;
  feedback: Feedback;
  cue: Cue | null;
  cueLog: Cue[];
  unlockedBpm: number | null;
  mastered: boolean;
  posture: PostureValues;
  postureWarnings: PostureCheck[];
  vision: "off" | "loading" | "on" | "error";
  visionError?: string;
  freeNotes: number;
}

export interface PracticeConfig {
  kind: "exercise" | "free" | "assessment";
  mode: "audio" | "camera";
  bpm: number;
  lesson?: { id: string; title: string };
  exercise?: Exercise | AssessmentTask;
  /** Stop automatically after this many repetitions. */
  maxReps?: number;
  record?: boolean;
  /** Getters, because React may re-mount these elements between setup and practice. */
  video?: () => HTMLVideoElement | null;
  videoStream?: MediaStream | null;
  overlay?: () => HTMLCanvasElement | null;
  remoteVideo?: () => HTMLVideoElement | null;
  /** Called when a fixed-length run ends by itself. */
  onAutoFinish?: () => void;
}

export interface PracticeResult {
  session: Session;
  files: { name: string; blob: Blob }[];
}

const MAX_FRAMES = 24;

export class PracticeRun {
  private listeners = new Set<() => void>();
  state: PracticeState = {
    phase: "idle",
    countIn: null,
    beatInBar: -1,
    elapsed: 0,
    rep: 0,
    cursor: -1,
    repStates: [],
    recent: [],
    lastHeard: null,
    hits: 0,
    total: 0,
    meanDevMs: null,
    cleanReps: 0,
    totalReps: 0,
    feedback: "neutral",
    cue: null,
    cueLog: [],
    unlockedBpm: null,
    mastered: false,
    posture: {},
    postureWarnings: [],
    vision: "off",
    freeNotes: 0,
  };

  private metronome: Metronome | null = null;
  private detector: OnsetDetector | null = null;
  private matcher: TimelineMatcher | null = null;
  private recorder: Recorder | null = null;
  private vision: VisionLoop | null = null;
  private tracker: PostureTracker | null = null;
  private unsubscribeAudio: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstBeat = 0;
  private startedAt = new Date();
  private latency = 0;
  private cueId = 0;
  private cueCooldown = new Map<string, number>();
  private pendingCues: Cue[] = [];
  private postureEvents: Session["posture"] = [];
  private frames: { name: string; blob: Blob; t: number; caption: string }[] = [];
  private lastPeriodicFrame = -35; // first periodic frame after ~5 s
  private devSum = 0;
  private devN = 0;
  private cleanStreak = 0;
  private freeNotes: NoteResult[] = [];
  private repDevs: number[] = [];
  private finished = false;
  private sessionId = newId();
  private allCues: Cue[] = [];

  constructor(readonly cfg: PracticeConfig) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<PracticeState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  get id() {
    return this.sessionId;
  }

  private get beatUnit(): 4 | 8 {
    return (this.cfg.exercise?.beatUnit ?? 4) as 4 | 8;
  }

  /** Current time on the musical timeline (seconds from the first beat), latency-compensated. */
  private musicNow() {
    return audio.now() - this.latency - this.firstBeat;
  }

  async start() {
    this.set({ phase: "starting" });
    try {
      const settings = getSettings();
      this.latency = settings.latencyMs / 1000;
      const ctx = await audio.ensureContext();
      await audio.startMic();
      this.detector = new OnsetDetector(ctx.sampleRate);
      const ex = this.cfg.exercise;
      const bpb = ex ? beatsPerBar(ex.music, this.beatUnit) : 4;

      if (ex && this.cfg.kind !== "free") {
        const maxReps = this.cfg.maxReps ?? (ex.loop ? Infinity : 1);
        this.matcher = new TimelineMatcher(
          ex.music,
          ex.fingers,
          this.cfg.bpm,
          this.beatUnit,
          ex.timingToleranceMs,
          maxReps,
          (n) => this.onNote(n),
          (r) => this.onRep(r),
        );
      }

      // camera analysis
      if (this.cfg.mode === "camera" && this.cfg.video) {
        const checks = (ex?.checks ?? ["posture.rightWrist", "posture.leftWrist", "posture.shoulders"]).filter((c): c is PostureCheck => c.startsWith("posture."));
        this.tracker = new PostureTracker(checks.length ? checks : ["posture.rightWrist", "posture.shoulders"]);
        this.set({ vision: "loading" });
        this.vision = new VisionLoop(this.cfg.video, (obs, tMs) => this.onVision(obs, tMs));
        this.vision.start().then(
          () => this.set({ vision: "on" }),
          (e) => this.set({ vision: "error", visionError: String(e?.message ?? e) }),
        );
      }

      // recording
      if (this.cfg.record !== false && audio.mic) {
        const withVideo = this.cfg.mode === "camera" && settings.saveVideo && !!this.cfg.videoStream;
        const stream = withVideo ? new MediaStream([...this.cfg.videoStream!.getVideoTracks(), ...audio.mic.getAudioTracks()]) : audio.mic;
        this.recorder = new Recorder();
        if (!this.recorder.start(stream, withVideo)) this.recorder = null;
      }

      const beatSec = 60 / this.cfg.bpm;
      // free play has no score to line up with, so no count-in
      const countInBeats = this.cfg.kind === "free" ? 0 : Math.max(0, settings.countInBars) * bpb;
      const t0 = ctx.currentTime + 0.3;
      this.firstBeat = t0 + countInBeats * beatSec;
      this.metronome = new Metronome(ctx, this.cfg.bpm, bpb, settings.metronomeVolume);
      this.metronome.onBeat = (b) => {
        const remaining = countInBeats - b.index;
        this.set({ beatInBar: b.index % bpb, countIn: remaining > 0 ? remaining : null, phase: remaining > 0 ? "countin" : this.state.phase === "countin" || this.state.phase === "starting" ? "running" : this.state.phase });
      };
      this.metronome.start(t0);
      this.startedAt = new Date();
      this.set({ phase: countInBeats ? "countin" : "running", countIn: countInBeats || null });

      // The detector counts samples from the first block it receives; anchor that to the context clock.
      this.anchorFrame = null;
      this.unsubscribeAudio = audio.onBlock((b) => {
        if (!this.detector) return;
        if (this.anchorFrame === null) this.anchorFrame = b.frame;
        for (const o of this.detector.push(b.samples)) this.onOnset(o);
      });
      this.timer = setInterval(() => this.tick(), 50);
    } catch (e) {
      const err = e as Error;
      const msg =
        err.name === "NotAllowedError"
          ? "Necesito permiso para usar el micrófono. Actívalo en los ajustes del navegador."
          : err.name === "NotFoundError"
            ? "No encontré ningún micrófono."
            : err.message;
      this.set({ phase: "error", error: msg });
      await this.teardown();
    }
  }

  private anchorFrame: number | null = null;

  private onOnset(o: ReturnType<OnsetDetector["push"]>[number]) {
    // OnsetDetector counts samples since it was created; the first block's frame anchors it.
    if (this.anchorFrame === null) return;
    const ctxTime = (this.anchorFrame + o.frame) / audio.sampleRate;
    const t = ctxTime - this.latency - this.firstBeat;
    if (t < -0.4) return; // during count-in
    const ex = this.cfg.exercise;
    if (this.metronome && ex && this.matcher) {
      const clicks = this.metronome.clicks.map((c) => c - this.firstBeat);
      const rl = repLength(ex.music, this.cfg.bpm, this.beatUnit);
      const rep = Math.max(0, Math.floor(t / rl));
      const near = [...expectedForRep(ex.music, ex.fingers, rep, this.cfg.bpm, this.beatUnit), ...expectedForRep(ex.music, ex.fingers, rep + 1, this.cfg.bpm, this.beatUnit)];
      if (isClickEcho(t, clicks, near)) return;
    }
    this.set({ lastHeard: { midi: o.midi, t } });
    if (this.matcher) this.matcher.addOnset({ t, salience: o.salience, present: o.present, midi: o.midi });
    else if (this.cfg.kind === "free" && o.midi !== null) {
      const n: NoteResult = { rep: 0, event: this.freeNotes.length, t: round3(t), expected: [], detected: o.midi, hit: true, deviationMs: null };
      this.freeNotes.push(n);
      this.set({ freeNotes: this.freeNotes.length, recent: [...this.state.recent.slice(-7), n] });
    }
  }

  private tick() {
    const now = this.musicNow();
    this.set({ elapsed: Math.max(0, audio.now() - this.firstBeat) });
    const ex = this.cfg.exercise;
    if (ex && now >= 0) {
      const rl = repLength(ex.music, this.cfg.bpm, this.beatUnit);
      const spq = secondsPerQuarter(this.cfg.bpm, this.beatUnit);
      const rep = Math.floor(now / rl);
      const pos = (now - rep * rl) / spq;
      let cursor = -1;
      for (const e of ex.music.events) if (!e.rest && e.start <= pos + 0.05) cursor = e.index;
      if (rep !== this.state.rep) this.set({ rep, repStates: [] });
      if (cursor !== this.state.cursor) this.set({ cursor });
    }
    // allow time for the pitch estimate (≈100 ms after the attack) before closing windows
    this.matcher?.advance(now - 0.15);
    this.maybePeriodicFrame(now);
    if (this.cfg.maxReps !== undefined && ex && !this.finished) {
      const end = this.cfg.maxReps * repLength(ex.music, this.cfg.bpm, this.beatUnit);
      if (now > end + 0.45) {
        this.finished = true;
        this.cfg.onAutoFinish?.();
      }
    } else if (ex && !ex.loop && !this.finished && this.cfg.kind === "exercise") {
      const end = repLength(ex.music, this.cfg.bpm, this.beatUnit);
      if (now > end + 0.45) {
        this.finished = true;
        this.cfg.onAutoFinish?.();
      }
    }
  }

  private onNote(n: NoteResult) {
    if (n.hit && n.deviationMs !== null) {
      this.devSum += n.deviationMs;
      this.devN++;
      this.repDevs.push(n.deviationMs);
    }
    const states = [...this.state.repStates];
    if (n.rep === this.state.rep || this.state.rep === n.rep + 1) states[n.event] = n.hit ? "hit" : "miss";
    this.set({
      recent: [...this.state.recent.slice(-7), n],
      hits: this.state.hits + (n.hit ? 1 : 0),
      total: this.state.total + 1,
      meanDevMs: this.devN ? Math.round(this.devSum / this.devN) : null,
      repStates: n.rep === this.state.rep ? states : this.state.repStates,
    });
  }

  private onRep(r: RepResult) {
    const ex = this.cfg.exercise!;
    const clean = r.clean;
    this.cleanStreak = clean ? this.cleanStreak + 1 : 0;
    const cleanReps = this.state.cleanReps + (clean ? 1 : 0);
    const feedback: Feedback = clean ? "good" : r.hits < r.total ? "bad" : "warn";
    this.set({ cleanReps, totalReps: this.state.totalReps + 1, feedback });

    if (this.cfg.kind === "exercise" && "cleanRepsToAdvance" in ex) {
      const target = ex.tempo.target ?? ex.tempo.start;
      if (cleanReps === ex.cleanRepsToAdvance) {
        if (this.cfg.bpm >= target) {
          this.set({ mastered: true });
          this.cue("good", "¡Ejercicio dominado!", `${cleanReps} repeticiones limpias a ${this.cfg.bpm} BPM.`, "¡Ejercicio dominado!", "unlock");
        } else {
          const next = Math.min(target, this.cfg.bpm + ex.tempo.step);
          this.set({ unlockedBpm: next });
          this.cue("good", `¡${cleanReps} repeticiones limpias!`, `Desbloqueaste ${next} BPM.`, `Muy bien. Desbloqueaste ${next}`, "unlock");
        }
      } else if (clean && this.cleanStreak > 0 && this.cleanStreak % 5 === 0) {
        this.cue("good", `¡${this.cleanStreak} seguidas sin fallos!`, "Sigue así: relajado y parejo.", "Muy bien, sigue así", "streak");
      }
    }

    // timing trend over the last ~3 reps
    const recent = this.repDevs.slice(-3 * r.total);
    this.repDevs = this.repDevs.slice(-6 * r.total);
    if (recent.length >= r.total * 2) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (mean > ex.timingToleranceMs) this.cue("warn", "Vas un poco tarde", "Escucha el clic y adelántate apenas.", "Vas un poco tarde", "timing", 25);
      else if (mean < -ex.timingToleranceMs) this.cue("warn", "Te estás adelantando", "Espera el clic; no corras.", "Te adelantas, espera el clic", "timing", 25);
    }
    // a note that keeps failing
    const lastRepNotes = this.matcher!.results.filter((n) => n.rep >= r.index - 2);
    const fails = new Map<number, number>();
    for (const n of lastRepNotes) if (!n.hit && n.expected.length === 1) fails.set(n.expected[0]!, (fails.get(n.expected[0]!) ?? 0) + 1);
    for (const [midi, count] of fails)
      if (count >= 3) {
        this.cue("bad", `El ${midiToName(midi)} no está sonando bien`, "Revisa que el dedo esté arqueado y cerca del traste.", `Revisa el ${spokenNote(midi)}`, `note-${midi}`, 30);
        break;
      }

    // deliver posture cues between repetitions
    const pc = this.pendingCues.shift();
    if (pc) this.showCue(pc);
  }

  private cue(level: Cue["level"], title: string, detail: string | undefined, spoken: string | null, key: string, cooldownSec = 0) {
    const t = this.musicNow();
    const last = this.cueCooldown.get(key);
    if (last !== undefined && t - last < cooldownSec) return;
    this.cueCooldown.set(key, t);
    const c: Cue = { id: ++this.cueId, t, level, title, detail };
    this.showCue(c);
    if (spoken) speak(spoken);
  }

  private showCue(c: Cue) {
    this.allCues.push(c);
    this.set({ cue: c, cueLog: [c, ...this.state.cueLog].slice(0, 12) });
    setTimeout(() => {
      if (this.state.cue?.id === c.id) this.set({ cue: null });
    }, 4500);
  }

  private onVision(obs: Parameters<typeof computePosture>[0], tMs: number) {
    if (!this.tracker) return;
    const calib = getSettings().calibration;
    const { values, right, left } = computePosture(obs, calib);
    const t = this.musicNow();
    const entered = this.tracker.update(values, tMs / 1000);
    const warnings = [...this.tracker.warning];
    const overlay = this.cfg.overlay?.();
    if (overlay) {
      if (overlay.width !== obs.width) {
        overlay.width = obs.width;
        overlay.height = obs.height;
      }
      const css = getComputedStyle(document.documentElement);
      const ok = css.getPropertyValue("--success").trim() || "#4ade80";
      const warn = css.getPropertyValue("--warning").trim() || "#facc15";
      const info = css.getPropertyValue("--info").trim() || "#60a5fa";
      drawOverlay(overlay.getContext("2d")!, obs, { right, left }, {
        right: warnings.includes("posture.rightWrist") ? warn : ok,
        left: warnings.some((w) => w === "posture.leftWrist" || w === "posture.leftThumb") ? warn : ok,
        pose: warnings.includes("posture.shoulders") ? warn : info,
        neck: calib,
      });
    }
    const smoothed: PostureValues = {};
    for (const k of Object.keys(THRESHOLDS) as PostureCheck[]) {
      const v = this.tracker.value(k);
      if (v !== undefined) smoothed[k] = v;
    }
    this.set({ posture: smoothed, postureWarnings: warnings, feedback: warnings.length && this.state.feedback === "good" ? "warn" : this.state.feedback });
    for (const e of entered) {
      const msg = MESSAGES[e.check](e.value);
      this.postureEvents.push({ t: round3(t), check: e.check, value: Math.round(e.value * 100) / 100, message: msg.title });
      void this.captureFrame(t, msg.title).then((name) => {
        const ev = this.postureEvents.at(-1);
        if (name && ev) ev.frame = name;
      });
      const last = this.cueCooldown.get(e.check);
      if (last !== undefined && t - last < 20) continue;
      this.cueCooldown.set(e.check, t);
      const c: Cue = { id: ++this.cueId, t, level: "warn", title: msg.title, detail: msg.detail };
      // wait for the end of the repetition when practising a loop; immediately otherwise
      if (this.matcher && this.state.phase === "running") this.pendingCues.push(c);
      else this.showCue(c);
      speak(SPOKEN[e.check]);
    }
  }

  private async captureFrame(t: number, caption: string): Promise<string | null> {
    const video = this.cfg.video?.();
    if (!video || this.frames.length >= MAX_FRAMES) return null;
    const blob = await snapshot(video, this.cfg.overlay?.() ?? null);
    if (!blob) return null;
    const name = `frame-${String(this.frames.length + 1).padStart(2, "0")}.jpg`;
    this.frames.push({ name, blob, t, caption });
    const remote = this.cfg.remoteVideo?.();
    if (remote?.videoWidth && this.frames.length < MAX_FRAMES) {
      const rb = await snapshot(remote, null);
      if (rb) this.frames.push({ name: name.replace(".jpg", "-mano.jpg"), blob: rb, t, caption: `${caption} (cámara 2)` });
    }
    return name;
  }

  private maybePeriodicFrame(t: number) {
    if (this.cfg.mode !== "camera" || t < 3) return;
    if (t - this.lastPeriodicFrame >= 40) {
      this.lastPeriodicFrame = t;
      void this.captureFrame(t, "Fotograma periódico");
    }
  }

  private async teardown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribeAudio?.();
    this.unsubscribeAudio = null;
    this.metronome?.dispose();
    this.metronome = null;
    this.vision?.stop();
    this.vision = null;
  }

  /** Stops everything and builds the session record. */
  async finish(userNote?: string): Promise<PracticeResult> {
    this.set({ phase: "finishing" });
    const now = this.musicNow();
    this.matcher?.flush(now - 0.05);
    await this.teardown();
    const media = await this.recorder?.stop();
    const ex = this.cfg.exercise;
    const notes = this.matcher ? this.matcher.results : this.freeNotes;
    const reps = this.matcher ? this.matcher.reps : [];
    const summary = summarize(this.matcher ? notes : [], reps, this.matcher?.extras ?? 0, this.tracker?.ratios() ?? {});
    if (!this.matcher) {
      summary.notesHit = this.freeNotes.length;
      summary.notesExpected = 0;
    }
    const files: { name: string; blob: Blob }[] = [];
    const fileMeta: SessionFile[] = [];
    if (media) {
      const name = `grabacion.${extFor(media.type)}`;
      files.push({ name, blob: media });
      fileMeta.push({ name, type: media.type, size: media.size, kind: media.type.startsWith("video") ? "video" : "audio" });
    }
    for (const f of this.frames) {
      files.push({ name: f.name, blob: f.blob });
      fileMeta.push({ name: f.name, type: "image/jpeg", size: f.blob.size, kind: "frame", t: round3(f.t), caption: f.caption });
    }
    const endedAt = new Date();
    const settings = getSettings();
    const session: Session = {
      formatVersion: 1,
      id: this.sessionId,
      kind: this.cfg.kind,
      mode: this.cfg.mode,
      device: { kind: deviceKind(), ...(settings.deviceName ? { name: settings.deviceName } : {}) },
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSec: Math.round((endedAt.getTime() - this.startedAt.getTime()) / 1000),
      ...(this.cfg.lesson ? { lesson: this.cfg.lesson } : {}),
      ...(ex ? { exercise: { id: ex.id, title: ex.title } } : {}),
      bpm: this.cfg.kind === "free" ? null : this.cfg.bpm,
      beatUnit: this.beatUnit,
      latencyMs: Math.round(this.latency * 1000),
      reps,
      notes,
      posture: this.postureEvents,
      cues: this.allCues.map((c) => ({ t: round3(c.t), level: c.level, message: c.detail ? `${c.title}. ${c.detail}` : c.title })),
      summary,
      ...(userNote ? { userNote } : {}),
      files: fileMeta,
      unlockedBpm: this.state.unlockedBpm,
    };
    this.set({ phase: "done" });
    return { session, files };
  }

  /** Abort without producing a session. */
  async cancel() {
    await this.teardown();
    await this.recorder?.stop();
    this.set({ phase: "done" });
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function spokenNote(midi: number) {
  const names = ["do", "do sostenido", "re", "re sostenido", "mi", "fa", "fa sostenido", "sol", "sol sostenido", "la", "la sostenido", "si"];
  return names[((midi % 12) + 12) % 12]!;
}
