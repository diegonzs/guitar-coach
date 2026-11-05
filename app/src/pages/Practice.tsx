import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useParams, useSearchParams } from "wouter";
import QRCode from "qrcode";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, CircleCheck, Hand, Laptop, Minus, Mic, Plus, Smartphone, Sparkles, Square, Target, Video, X } from "lucide-react";
import { beatsPerBar, midiToName, type Exercise } from "@guitar-coach/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tab } from "@/components/Tab";
import { Beats, TimingMeter } from "@/components/viz";
import { useCurriculum, useLessonProgress, useSessions } from "@/lib/data";
import { saveLocalSession } from "@/lib/db";
import { syncNow } from "@/lib/sync";
import { setSettings, useSettings } from "@/lib/settings";
import { primeSpeech } from "@/lib/speech";
import { RemoteCameraViewer, type RtcStatus } from "@/lib/rtc";
import { audio } from "@/audio/engine";
import { PracticeRun, type Cue, type PracticeState } from "@/audio/practice";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// camera

export function useCamera(enabled: boolean, facing: "user" | "environment" = "user") {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let s: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false })
      .then((st) => {
        if (cancelled) return st.getTracks().forEach((t) => t.stop());
        s = st;
        setStream(st);
        setError(null);
      })
      .catch((e: Error) => setError(e.name === "NotAllowedError" ? "Necesito permiso para usar la cámara." : `No pude abrir la cámara (${e.message}).`));
    return () => {
      cancelled = true;
      s?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [enabled, facing]);
  return { stream, error };
}

function VideoEl({ stream, mirrored, videoRef, className }: { stream: MediaStream | null; mirrored?: boolean; videoRef?: React.RefObject<HTMLVideoElement | null>; className?: string }) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream, ref]);
  return <video ref={ref} autoPlay playsInline muted className={cn("size-full object-cover", mirrored && "-scale-x-100", className)} />;
}

// ---------------------------------------------------------------------------

const FEEDBACK_COLOR: Record<PracticeState["feedback"], string> = {
  neutral: "transparent",
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
};

function CueToast({ cue, className }: { cue: Cue | null; className?: string }) {
  if (!cue) return null;
  const c = cue.level === "good" ? "var(--success)" : cue.level === "bad" ? "var(--destructive)" : cue.level === "info" ? "var(--info)" : "var(--warning)";
  const Icon = cue.level === "good" ? Sparkles : cue.level === "bad" ? Target : cue.title.toLowerCase().includes("muñeca") || cue.title.toLowerCase().includes("pulgar") ? Hand : AlertTriangle;
  return (
    <div
      key={cue.id}
      className={cn("flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-white backdrop-blur-xl animate-in fade-in slide-in-from-top-2", className)}
      style={{ background: "oklch(0.17 0.02 80 / .8)", borderColor: `color-mix(in oklch, ${c} 45%, transparent)` }}
      role="status"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in oklch, ${c} 22%, transparent)`, color: c }}>
        <Icon className="size-4" />
      </span>
      <div>
        <b className="block text-[13.5px]">{cue.title}</b>
        {cue.detail && <span className="text-xs text-white/80">{cue.detail}</span>}
      </div>
    </div>
  );
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function NoteChips({ st }: { st: PracticeState }) {
  return (
    <div className="flex justify-center gap-1.5">
      {st.recent.slice(-6).map((n, i) => {
        const expected = n.expected.length === 1 ? n.expected[0] : null;
        const label = n.detected !== null ? midiToName(n.detected) : "—";
        const isFree = !n.expected.length;
        return (
          <span
            key={`${n.rep}-${n.event}-${i}`}
            className={cn(
              "w-[46px] rounded-xl border bg-card py-1.5 text-center font-mono text-[13px] font-semibold",
              !isFree && n.hit && "border-success/40 text-success",
              !isFree && !n.hit && "border-destructive/50 bg-destructive/10 text-destructive",
            )}
          >
            {n.hit && expected !== null && expected !== undefined ? midiToName(expected) : label}
            <small className="block text-[9.5px] font-medium text-muted-foreground">{!isFree && !n.hit && expected ? `era ${midiToName(expected)}` : n.finger ?? (n.deviationMs !== null ? `${n.deviationMs > 0 ? "+" : ""}${n.deviationMs}` : "")}</small>
          </span>
        );
      })}
    </div>
  );
}

function Stats({ st, compact }: { st: PracticeState; compact?: boolean }) {
  const acc = st.total ? Math.round((st.hits / st.total) * 100) : null;
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-xl bg-muted px-2.5 py-2">
        <div className={cn("font-mono text-lg font-semibold tnum", acc !== null && acc >= 85 && "text-success", acc !== null && acc < 70 && "text-destructive")}>{acc === null ? "–" : `${acc}%`}</div>
        <div className="text-[11px] text-muted-foreground">notas bien</div>
      </div>
      <div className="rounded-xl bg-muted px-2.5 py-2">
        <div className="font-mono text-lg font-semibold tnum">
          {st.meanDevMs === null ? "–" : `${st.meanDevMs > 0 ? "+" : ""}${st.meanDevMs}`}
          {!compact && <small className="text-xs"> ms</small>}
        </div>
        <div className="text-[11px] text-muted-foreground">{st.meanDevMs === null ? "tiempo" : st.meanDevMs > 25 ? "un poco tarde" : st.meanDevMs < -25 ? "adelantado" : "a tiempo"}</div>
      </div>
      <div className="rounded-xl bg-muted px-2.5 py-2">
        <div className="font-mono text-lg font-semibold tnum">
          {st.cleanReps}
          <small className="text-xs text-muted-foreground">/{st.totalReps}</small>
        </div>
        <div className="text-[11px] text-muted-foreground">reps limpias</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function Practice() {
  const params = useParams<{ lessonId?: string; exerciseId?: string }>();
  const [search] = useSearchParams();
  const [, navigate] = useLocation();
  const curriculum = useCurriculum();
  const sessions = useSessions();
  const settings = useSettings();
  const free = !params.lessonId;
  const lesson = curriculum?.lessons.find((l) => l.id === params.lessonId);
  const exercise: Exercise | undefined = lesson?.exercises.find((e) => e.id === params.exerciseId);
  const progress = useLessonProgress(lesson ? [lesson] : undefined, sessions);
  const exProgress = progress.get(lesson?.id ?? "")?.exercises.find((e) => e.exerciseId === exercise?.id);

  const [mode, setMode] = useState<"audio" | "camera">(search.get("modo") === "camara" ? "camera" : "audio");
  const [bpm, setBpm] = useState<number>(() => Number(search.get("bpm")) || 60);
  const [useRemote, setUseRemote] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RtcStatus>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [run, setRun] = useState<PracticeRun | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const { stream, error: camError } = useCamera(mode === "camera");
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

  useEffect(() => {
    if (exProgress && !search.get("bpm")) setBpm(exProgress.suggestedBpm);
    else if (exercise && !search.get("bpm") && !exProgress) setBpm(exercise.tempo.start);
  }, [exProgress?.suggestedBpm, exercise?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // phone as a second camera (laptop only)
  useEffect(() => {
    if (!useRemote) return;
    const url = `${location.origin}/camara-remota?sala=${settings.remoteRoom}`;
    QRCode.toDataURL(url, { margin: 1, width: 220 }).then(setQr);
    const v = new RemoteCameraViewer(settings.remoteRoom, setRemoteStream, setRemoteStatus);
    v.start();
    return () => v.stop();
  }, [useRemote, settings.remoteRoom]);
  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream, run]);

  const empty = useMemo(() => new PracticeRun({ kind: "free", mode: "audio", bpm: 60 }), []);
  const st = useSyncExternalStore((run ?? empty).subscribe, (run ?? empty).getState);

  // stop everything if the user leaves mid-run
  useEffect(() => () => void run?.cancel(), [run]);

  async function start() {
    primeSpeech();
    await audio.ensureContext().catch(() => {});
    const r = new PracticeRun({
      kind: free ? "free" : "exercise",
      mode,
      bpm,
      lesson: lesson ? { id: lesson.id, title: lesson.title } : undefined,
      exercise,
      video: mode === "camera" ? () => videoRef.current : undefined,
      videoStream: stream,
      overlay: () => overlayRef.current,
      remoteVideo: () => (useRemote ? remoteRef.current : null),
      onAutoFinish: () => void stop(r),
    });
    setRun(r);
    await r.start();
  }

  async function stop(r = run) {
    if (!r || saving) return;
    setSaving(true);
    try {
      const { session, files } = await r.finish();
      if (session.durationSec < 5 && !session.notes.length) {
        toast("Sesión demasiado corta, no se guardó.");
        setRun(null);
        return;
      }
      await saveLocalSession(session, files);
      void syncNow();
      navigate(`/sesion/${session.id}`);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (curriculum === undefined) return null;
  if (!free && (!lesson || !exercise))
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          No encontré ese ejercicio. <Link href="/lecciones" className="text-primary underline">Volver a lecciones</Link>
        </div>
      </div>
    );

  const running = !!run && st.phase !== "idle" && st.phase !== "error";
  const bpb = exercise ? beatsPerBar(exercise.music, (exercise.beatUnit ?? 4) as 4 | 8) : 4;
  const target = exercise?.tempo.target ?? exercise?.tempo.start ?? 200;
  const unlocked = exProgress?.suggestedBpm ?? exercise?.tempo.start ?? bpm;
  const backHref = lesson ? `/lecciones/${lesson.id}` : "/";
  const title = exercise?.title ?? "Práctica libre";
  const needsCalib = exercise?.checks.includes("posture.leftThumb") && !settings.calibration;
  const tab = exercise && (
    <Tab music={exercise.music} fingers={exercise.fingers} cursor={running && st.phase === "running" ? st.cursor : undefined} states={running ? st.repStates : undefined} />
  );

  // ------------------------------------------------------------- setup
  if (!running) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 pt-safe pb-safe">
        <div className="flex items-center justify-between pt-2">
          <Button asChild variant="secondary" size="icon" className="rounded-full">
            <Link href={backHref} aria-label="Volver">
              <ChevronLeft className="size-5" />
            </Link>
          </Button>
          <div className="text-center">
            <div className="text-sm font-semibold">{title}</div>
            {lesson && <div className="text-xs text-muted-foreground">{lesson.title}</div>}
          </div>
          <span className="size-9" />
        </div>

        {st.phase === "error" && (
          <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">
            <b>No se pudo empezar.</b> {st.error}
          </Card>
        )}

        {exercise && (
          <Card className="gap-2 p-4">
            {tab}
            {exercise.instructions && <p className="text-sm text-muted-foreground">{exercise.instructions}</p>}
          </Card>
        )}

        <Card className="gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tempo</span>
            {exercise && (
              <span className="text-xs text-muted-foreground">
                desbloqueado hasta {unlocked} · meta {target}
              </span>
            )}
          </div>
          <div className="flex items-center justify-center gap-5">
            <Button variant="secondary" size="icon" className="size-12 rounded-full" onClick={() => setBpm((b) => Math.max(30, b - 5))} aria-label="Más lento">
              <Minus />
            </Button>
            <div className="text-center">
              <div className="display text-6xl leading-none tnum">{bpm}</div>
              <div className="eyebrow mt-1">BPM</div>
            </div>
            <Button variant="secondary" size="icon" className="size-12 rounded-full" onClick={() => setBpm((b) => Math.min(240, b + 5))} aria-label="Más rápido">
              <Plus />
            </Button>
          </div>
          {exercise && bpm > unlocked && <p className="text-center text-xs text-warning">Aún no desbloqueaste este tempo: primero consigue {exercise.cleanRepsToAdvance} repeticiones limpias a {unlocked}.</p>}
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <Button variant={mode === "camera" ? "default" : "secondary"} className="h-11" onClick={() => setMode("camera")}>
            <Video className="size-4" /> Cámara
          </Button>
          <Button variant={mode === "audio" ? "default" : "secondary"} className="h-11" onClick={() => setMode("audio")}>
            <Mic className="size-4" /> Solo audio
          </Button>
        </div>

        {mode === "camera" && (
          <Card className="gap-3 overflow-hidden p-0">
            <div className="relative aspect-video bg-black">
              <VideoEl stream={stream} mirrored videoRef={videoRef} />
              <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full -scale-x-100" />
              {camError && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">{camError}</div>}
            </div>
            <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
              <p className="text-muted-foreground">Coloca la cámara de frente, a 1–2 m, que se vean la guitarra completa y tus dos manos.</p>
              {needsCalib && (
                <Link href={`/calibrar?volver=${encodeURIComponent(location.pathname + location.search)}`} className="text-primary underline">
                  Calibra el mástil (10 s) para revisar el pulgar izquierdo
                </Link>
              )}
              {wide && (
                <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <span className="flex items-center gap-2">
                    <Smartphone className="size-4" /> Usar el iPhone como 2ª cámara (mano derecha)
                  </span>
                  <Switch checked={useRemote} onCheckedChange={setUseRemote} />
                </label>
              )}
              {useRemote && (
                <div className="flex items-center gap-4 rounded-xl bg-muted p-3">
                  {qr && <img src={qr} alt="Código QR" className="size-28 rounded-lg bg-white p-1" />}
                  <div className="text-xs text-muted-foreground">
                    Escanéalo con el iPhone (misma red o tailnet) y apunta la cámara a tu mano derecha.
                    <div className="mt-2 font-medium text-foreground">
                      Estado: {remoteStatus === "connected" ? "conectado ✓" : remoteStatus === "waiting" ? "esperando al iPhone…" : remoteStatus === "connecting" ? "conectando…" : "desconectado"}
                    </div>
                  </div>
                </div>
              )}
              {useRemote && <video ref={remoteRef} autoPlay playsInline muted className="hidden" />}
            </div>
          </Card>
        )}

        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {!settings.latencyCalibrated && (
            <p>
              <AlertTriangle className="mr-1 inline size-3.5 text-warning" />
              Calibra la latencia en <Link href="/ajustes" className="text-primary underline">Ajustes</Link> para que la medición del tiempo sea justa.
            </p>
          )}
          <p>Consejo: con audífonos con cable el clic del metrónomo no se mezcla con tu guitarra.</p>
        </div>

        <div className="mt-auto flex flex-col gap-2 pb-2">
          <label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
            Indicaciones por voz
            <Switch checked={settings.voice} onCheckedChange={(v) => setSettings({ voice: v })} />
          </label>
          <Button className="h-13 text-base" onClick={start} disabled={mode === "camera" && !stream}>
            Empezar
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- running
  const countIn = st.phase === "countin" ? st.countIn : null;
  const borderColor = FEEDBACK_COLOR[st.feedback];
  const finishBtn = (
    <Button variant="destructive" className="h-12 flex-1" onClick={() => stop()} disabled={saving}>
      <Square className="size-4 fill-current" />
      {saving ? "Guardando…" : "Terminar"}
    </Button>
  );

  if (mode === "audio") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-safe pb-safe">
        <div className="flex items-center justify-between pt-2">
          <Button variant="secondary" size="icon" className="rounded-full" onClick={() => stop()} aria-label="Terminar">
            <X className="size-5" />
          </Button>
          <div className="text-center">
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">
              Solo audio · {free ? `${st.freeNotes} notas` : `Rep ${st.rep + 1}`} · {fmtTime(st.elapsed)}
            </div>
          </div>
          <span className="size-9" />
        </div>
        <div className="relative mx-auto mt-2 grid size-48 place-items-center rounded-full" style={{ background: "radial-gradient(circle, color-mix(in oklch, var(--primary) 26%, transparent) 0%, transparent 70%)" }}>
          <span className="absolute inset-3 rounded-full border-[1.5px] border-primary/55" />
          <span className="absolute -inset-0.5 rounded-full border-[1.5px] transition-colors" style={{ borderColor: st.feedback === "neutral" ? "color-mix(in oklch, var(--primary) 18%, transparent)" : borderColor }} />
          <span key={st.beatInBar + "-" + st.elapsed.toFixed(0)} className="display text-[92px] leading-none text-primary" style={{ animation: "beat-pop .18s ease-out" }}>
            {countIn ?? (st.beatInBar >= 0 ? st.beatInBar + 1 : "·")}
          </span>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Beats count={bpb} active={st.beatInBar} />
          <span className="font-mono text-sm text-muted-foreground">{bpm} BPM</span>
        </div>
        {countIn !== null && <p className="text-center text-sm text-muted-foreground">Prepárate… empieza en el 1</p>}
        <div>
          <div className="eyebrow mb-2 text-center">Últimas notas</div>
          <NoteChips st={st} />
        </div>
        {!free && (
          <Card className="gap-2.5 px-4 py-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Adelantado</span>
              <span className="font-semibold text-success">A tiempo</span>
              <span>Atrasado</span>
            </div>
            <TimingMeter ms={st.meanDevMs} tolerance={exercise?.timingToleranceMs} />
          </Card>
        )}
        {exercise && <Card className="p-3">{tab}</Card>}
        {!free && <Stats st={st} />}
        <CueToast cue={st.cue} className="fixed inset-x-4 top-[max(env(safe-area-inset-top),1rem)] z-50 mx-auto max-w-md" />
        <div className="mt-auto flex gap-2 pb-2">{finishBtn}</div>
      </div>
    );
  }

  // camera mode
  return (
    <div className="relative min-h-dvh bg-black lg:grid lg:h-dvh lg:grid-cols-[1fr_320px] lg:grid-rows-[1fr_auto] lg:gap-3 lg:bg-background lg:p-4">
      <div className="fixed inset-0 overflow-hidden lg:relative lg:inset-auto lg:rounded-2xl" style={{ background: "radial-gradient(120% 80% at 50% 45%,#2a2420 0%,#120f0d 70%)" }}>
        <VideoEl stream={stream} mirrored videoRef={videoRef} />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full -scale-x-100 object-cover" />
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] transition-[box-shadow] duration-300" style={{ boxShadow: `inset 0 0 0 4px ${borderColor}, inset 0 0 60px -10px ${borderColor}` }} />
        <div className="absolute inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] flex items-center justify-between gap-2">
          <span className="glass">
            <span className="size-2 rounded-full bg-destructive" />
            {fmtTime(st.elapsed)}
          </span>
          <Beats count={bpb} active={st.beatInBar} />
          <span className="glass font-mono">{bpm} BPM</span>
        </div>
        {countIn !== null && <div className="absolute inset-0 grid place-items-center"><span className="display text-[140px] text-white/90 drop-shadow-lg">{countIn}</span></div>}
        <div className="absolute inset-x-3 top-[calc(max(env(safe-area-inset-top),0.75rem)+3rem)] flex flex-col gap-2">
          {st.vision === "loading" && <span className="glass self-start">Cargando detección de postura…</span>}
          {st.vision === "error" && <span className="glass self-start text-warning">Postura no disponible: {st.visionError}</span>}
          <CueToast cue={st.cue} className="lg:max-w-md" />
        </div>
        <span className="glass absolute bottom-3 left-3 hidden lg:inline-flex">
          <Laptop className="size-3.5" /> {free ? "Práctica libre" : `Rep ${st.rep + 1}`}
        </span>
      </div>

      {/* side panel on laptops */}
      <div className="hidden flex-col gap-3 lg:flex">
        {useRemote && (
          <div className="relative h-48 overflow-hidden rounded-2xl bg-black">
            <video ref={remoteRef} autoPlay playsInline muted className="size-full object-cover" />
            <span className="glass absolute top-2 left-2 text-[11px]">iPhone · mano derecha</span>
            {remoteStatus !== "connected" && <span className="absolute inset-0 grid place-items-center text-xs text-white/70">Esperando al iPhone…</span>}
          </div>
        )}
        {!free && (
          <Card className="p-3">
            <Stats st={st} />
          </Card>
        )}
        <Card className="min-h-0 flex-1 gap-2 overflow-auto p-4">
          <span className="text-sm font-semibold">Indicaciones</span>
          {st.cueLog.length === 0 && <p className="text-xs text-muted-foreground">Aquí verás las correcciones mientras tocas.</p>}
          {st.cueLog.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-[12.5px]">
              <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">{fmtTime(Math.max(0, c.t))}</span>
              {c.level === "good" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", c.level === "bad" ? "text-destructive" : "text-warning")} />}
              <span>{c.title}</span>
            </div>
          ))}
        </Card>
        <div className="flex shrink-0">{finishBtn}</div>
      </div>

      {/* bottom sheet on phones / tab strip on laptops */}
      <div className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-3 rounded-t-3xl border-t bg-card px-4 pt-3 pb-safe lg:static lg:col-span-2 lg:rounded-2xl lg:border lg:pb-3">
        <div className="mx-auto h-1 w-9 rounded-full bg-muted-foreground/35 lg:hidden" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{title}</span>
          <span className="font-mono text-xs text-muted-foreground">{free ? `${st.freeNotes} notas` : `Rep ${st.rep + 1} · ${st.cleanReps} limpias`}</span>
        </div>
        {exercise ? tab : <NoteChips st={st} />}
        <div className="lg:hidden">{!free && <Stats st={st} compact />}</div>
        <div className="flex gap-2 lg:hidden">{finishBtn}</div>
      </div>
    </div>
  );
}
