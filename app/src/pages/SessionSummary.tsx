import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { ChevronLeft, CloudOff, Hand, RotateCcw, Target, TrendingUp, CircleCheck, Sparkles } from "lucide-react";
import { CHECK_LABELS, LEVEL_NAMES, diagnose, midiToName, type Check, type Session } from "@guitar-coach/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { StatTile, TimingBars } from "@/components/viz";
import { DiagnosisView } from "@/components/Diagnosis";
import { isFullSession, useCurriculum, useSession, useSessionFiles } from "@/lib/data";
import { updateLocalSession } from "@/lib/db";
import { syncNow, useSync } from "@/lib/sync";
import { cn } from "@/lib/utils";

function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Media({ sessionId, name, type, online }: { sessionId: string; name: string; type: string; online: boolean }) {
  const files = useSessionFiles(sessionId);
  const local = files?.find((f) => f.name === name)?.blob;
  const localUrl = useObjectUrl(local);
  const src = localUrl ?? (online ? `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(name)}` : null);
  if (!src) return <p className="text-xs text-muted-foreground">Disponible cuando te conectes al servidor.</p>;
  if (type.startsWith("video")) return <video src={src} controls playsInline className="w-full rounded-xl bg-black" />;
  if (type.startsWith("audio")) return <audio src={src} controls className="w-full" />;
  return <img src={src} alt={name} className="w-full rounded-xl" loading="lazy" />;
}

export default function SessionSummary() {
  const { id } = useParams<{ id: string }>();
  const row = useSession(id);
  const curriculum = useCurriculum();
  const sync = useSync();
  const [note, setNote] = useState<string | null>(null);

  const s = row?.data;
  const full = s && isFullSession(s) ? (s as Session) : null;
  const lesson = curriculum?.lessons.find((l) => l.id === s?.lesson?.id);
  const exercise = lesson?.exercises.find((e) => e.id === s?.exercise?.id);
  const deviations = useMemo(() => full?.notes.map((n) => (n.hit ? n.deviationMs : null)) ?? [], [full]);
  const diagnosis = useMemo(
    () =>
      full && exercise && full.notes.length
        ? diagnose(exercise.music, full.notes, { toleranceMs: full.timingToleranceMs ?? exercise.timingToleranceMs, extraOnsets: full.extraOnsets })
        : null,
    [full, exercise],
  );

  if (row === undefined) return null;
  if (!s) return <p className="py-16 text-center text-sm text-muted-foreground">No encontré esa sesión.</p>;
  const sm = s.summary;
  const acc = sm.accuracy;
  const title = s.kind === "assessment" ? "Evaluación de nivel" : s.kind === "free" ? "Práctica libre" : s.exercise?.title ?? "Sesión";
  const headline = s.kind === "assessment" ? "¡Evaluación completa!" : acc === null ? "Sesión guardada" : acc >= 0.9 ? "¡Buen trabajo!" : acc >= 0.7 ? "Vas bien" : "Sigue practicando";
  const posture = Object.entries(sm.posture).filter(([, v]) => v > 0.05);
  const frames = s.files.filter((f) => f.kind === "frame");
  const media = s.files.find((f) => f.kind !== "frame");

  async function saveNote() {
    if (note === null || note === (s?.userNote ?? "")) return;
    await updateLocalSession(id, { userNote: note.trim() || undefined });
    void syncNow();
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-center justify-between">
        <Button asChild variant="secondary" size="icon" className="rounded-full">
          <Link href={lesson ? `/lecciones/${lesson.id}` : "/progreso"} aria-label="Volver">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        {row.synced === 1 ? (
          <Badge className="bg-success/15 text-success">
            <CircleCheck className="size-3" /> En tu laptop
          </Badge>
        ) : row.synced === 2 ? (
          <Badge className="bg-destructive/15 text-destructive" title={row.syncError}>
            <CloudOff className="size-3" /> El servidor la rechazó
          </Badge>
        ) : (
          <Badge className="bg-warning/15 text-warning">
            <CloudOff className="size-3" /> Se enviará al conectar
          </Badge>
        )}
      </div>
      <div>
        <div className="eyebrow">
          {title} · {new Date(s.startedAt).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" })} · {Math.max(1, Math.round(s.durationSec / 60))} min
        </div>
        <h1 className="display text-[32px] leading-none">{headline}</h1>
      </div>

      {s.unlockedBpm && (
        <Card className="flex-row items-center gap-3 border-success/40 bg-success/10 px-4 py-3">
          <Sparkles className="size-5 text-success" />
          <div className="text-sm">
            <b>Desbloqueaste {s.unlockedBpm} BPM.</b> La próxima vez la app empezará a ese tempo.
          </div>
        </Card>
      )}

      {s.kind === "assessment" && s.assessment && (
        <Card className="gap-1 p-4">
          <div className="eyebrow">Tu nivel</div>
          <div className="display text-3xl">
            {s.assessment.level} · {LEVEL_NAMES[s.assessment.level]}
          </div>
          {s.assessment.recommendedLessonId && (
            <Link href={`/lecciones/${s.assessment.recommendedLessonId}`} className="text-sm text-primary underline">
              Empezar por: {curriculum?.lessons.find((l) => l.id === s.assessment!.recommendedLessonId)?.title ?? s.assessment.recommendedLessonId}
            </Link>
          )}
        </Card>
      )}

      {s.kind !== "free" && s.kind !== "assessment" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile value={acc === null ? "–" : `${Math.round(acc * 100)}%`} label="notas correctas" tone={acc !== null && acc >= 0.85 ? "success" : acc !== null && acc < 0.6 ? "destructive" : undefined} />
          <StatTile
            value={
              <>
                {sm.meanDeviationMs === null ? "–" : `${sm.meanDeviationMs > 0 ? "+" : ""}${sm.meanDeviationMs}`}
                <small className="text-xs"> ms</small>
              </>
            }
            label={sm.meanDeviationMs === null ? "desfase" : sm.meanDeviationMs > 20 ? "desfase (tarde)" : sm.meanDeviationMs < -20 ? "desfase (adelantado)" : "desfase promedio"}
          />
          <StatTile
            value={
              <>
                {sm.cleanReps}
                <small className="text-sm text-muted-foreground">/{sm.totalReps}</small>
              </>
            }
            label="repeticiones limpias"
          />
          <StatTile value={s.bpm ?? "–"} label="BPM" tone="primary" />
        </div>
      )}
      {s.kind === "free" && (
        <div className="grid grid-cols-2 gap-2">
          <StatTile value={sm.notesHit} label="notas tocadas" tone="primary" />
          <StatTile value={`${Math.max(1, Math.round(s.durationSec / 60))} min`} label="duración" />
        </div>
      )}

      {full && deviations.length > 0 && (
        <Card className="gap-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Tiempo por nota</span>
            <span className="text-xs text-muted-foreground">ms vs metrónomo · rojo = fallada</span>
          </div>
          <TimingBars deviations={deviations.slice(-90)} tolerance={exercise?.timingToleranceMs ?? 70} />
        </Card>
      )}

      {diagnosis && exercise && (
        <>
          <span className="eyebrow mt-1">Nota por nota</span>
          <DiagnosisView music={exercise.music} fingers={exercise.fingers} diagnosis={diagnosis} />
        </>
      )}

      {(sm.problemNotes.length > 0 || posture.length > 0 || exercise) && s.kind === "exercise" && (
        <Card className="gap-2.5 px-4 py-3">
          <span className="text-sm font-semibold">Para revisar</span>
          {!diagnosis && sm.problemNotes.map((p) => (
            <div key={p.midi} className="flex items-start gap-2.5 text-[13px]">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-destructive/15 text-destructive">
                <Target className="size-3.5" />
              </span>
              <span>
                El <b>{midiToName(p.midi)}</b> falló <b>{p.misses} veces</b>
                {p.heardAs !== null ? ` (sonó ${midiToName(p.heardAs)})` : " (no se oyó)"}. Arquea el dedo y apoya cerca del traste.
              </span>
            </div>
          ))}
          {posture.map(([k, v]) => (
            <div key={k} className="flex items-start gap-2.5 text-[13px]">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-warning/15 text-warning">
                <Hand className="size-3.5" />
              </span>
              <span>
                {CHECK_LABELS[k as Check] ?? k}: en alerta el <b>{Math.round(v * 100)}%</b> del tiempo.
              </span>
            </div>
          ))}
          {exercise && s.bpm && (
            <div className="flex items-start gap-2.5 text-[13px]">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-success/15 text-success">
                <TrendingUp className="size-3.5" />
              </span>
              <span>
                {sm.cleanReps >= exercise.cleanRepsToAdvance
                  ? `Siguiente vez: prueba a ${Math.min(exercise.tempo.target ?? s.bpm, s.bpm + exercise.tempo.step)} BPM.`
                  : `Necesitas ${exercise.cleanRepsToAdvance} repeticiones limpias a ${s.bpm} BPM para subir (llevas ${sm.cleanReps}).`}
              </span>
            </div>
          )}
        </Card>
      )}

      {media && (
        <Card className="gap-2 px-4 py-3">
          <span className="text-sm font-semibold">Grabación</span>
          <Media sessionId={s.id} name={media.name} type={media.type} online={sync.online} />
        </Card>
      )}

      {frames.length > 0 && (
        <Card className="gap-2 px-4 py-3">
          <span className="text-sm font-semibold">Fotogramas para tu instructor</span>
          <div className="grid grid-cols-2 gap-2">
            {frames.slice(0, 6).map((f) => (
              <figure key={f.name} className="flex flex-col gap-1">
                <Media sessionId={s.id} name={f.name} type="image/jpeg" online={sync.online} />
                <figcaption className="text-[11px] text-muted-foreground">{f.caption}</figcaption>
              </figure>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="text-sm font-medium">
          Nota para tu instructor
        </label>
        <Textarea
          id="note"
          placeholder="p. ej. “la uña del anular se engancha”"
          value={note ?? s.userNote ?? ""}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveNote}
          maxLength={4000}
          className="min-h-20"
        />
      </div>

      <div className={cn("grid gap-2", exercise ? "grid-cols-2" : "grid-cols-1")}>
        {exercise && lesson && (
          <Button asChild variant="secondary" className="h-11">
            <Link href={`/practicar/${lesson.id}/${exercise.id}?modo=${s.mode === "camera" ? "camara" : "audio"}`}>
              <RotateCcw className="size-4" /> Otra vez
            </Link>
          </Button>
        )}
        <Button asChild className="h-11" onClick={saveNote}>
          <Link href="/">Listo</Link>
        </Button>
      </div>
    </div>
  );
}
