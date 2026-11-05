import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { ChevronLeft, CircleCheck, CircleX, ClipboardCheck, Mic, SkipForward, Square } from "lucide-react";
import { gradeAssessment, LEVEL_NAMES, taskPassed, beatsPerBar, type AssessmentResult, type AssessmentTask, type Session, type TaskOutcome } from "@guitar-coach/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tab } from "@/components/Tab";
import { Beats } from "@/components/viz";
import { useCurriculum } from "@/lib/data";
import { saveLocalSession, saveProfile } from "@/lib/db";
import { syncNow } from "@/lib/sync";
import { useSettings } from "@/lib/settings";
import { deviceKind, newId } from "@/lib/device";
import { primeSpeech } from "@/lib/speech";
import { audio } from "@/audio/engine";
import { PracticeRun } from "@/audio/practice";
import { Prose } from "@/pages/LessonDetail";
import { cn } from "@/lib/utils";

type Stage = "intro" | "questions" | "task" | "result";

export default function Assessment() {
  const curriculum = useCurriculum();
  const settings = useSettings();
  const [, navigate] = useLocation();
  const a = curriculum?.assessment;
  const [stage, setStage] = useState<Stage>("intro");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [idx, setIdx] = useState(0);
  const [outcomes, setOutcomes] = useState<TaskOutcome[]>([]);
  const [files, setFiles] = useState<{ name: string; blob: Blob }[]>([]);
  const [run, setRun] = useState<PracticeRun | null>(null);
  const [last, setLast] = useState<TaskOutcome | null>(null);
  const [startedAt] = useState(() => new Date());
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [saving, setSaving] = useState(false);
  /** The run whose result we still accept; stale runs (skipped, cancelled) are ignored. */
  const currentRun = useRef<PracticeRun | null>(null);

  const task: AssessmentTask | undefined = a?.exercises[idx];
  const empty = useMemo(() => new PracticeRun({ kind: "assessment", mode: "audio", bpm: 60 }), []);
  const st = useSyncExternalStore((run ?? empty).subscribe, (run ?? empty).getState);
  useEffect(() => () => void run?.cancel(), [run]);

  if (curriculum === undefined) return null;
  if (!a)
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-muted-foreground">
        <div>
          Este currículo no tiene evaluación (assessment.md). <Link href="/" className="text-primary underline">Volver</Link>
        </div>
      </div>
    );

  const consecutiveFails = (list: TaskOutcome[]) => {
    let n = 0;
    for (let i = list.length - 1; i >= 0 && list[i]!.status !== "passed"; i--) n++;
    return n;
  };

  function record(o: TaskOutcome) {
    const next = [...outcomes.filter((x) => x.id !== o.id), o];
    setOutcomes(next);
    setLast(o);
    return next;
  }

  function advance(list: TaskOutcome[]) {
    currentRun.current = null;
    setLast(null);
    setRun(null);
    if (consecutiveFails(list) >= a!.stopAfterFailures || idx + 1 >= a!.exercises.length) {
      setResult(gradeAssessment(a!, list, curriculum!.lessons, answers));
      setStage("result");
    } else setIdx(idx + 1);
  }

  async function startTask() {
    if (!task) return;
    primeSpeech();
    await audio.ensureContext().catch(() => {});
    setLast(null);
    const r: PracticeRun = new PracticeRun({
      kind: "assessment",
      mode: "audio",
      bpm: task.tempo.start,
      exercise: task,
      maxReps: task.reps,
      onAutoFinish: async () => {
        if (currentRun.current !== r) return;
        const { session, files: f } = await r.finish();
        if (currentRun.current !== r) return;
        currentRun.current = null;
        const passed = taskPassed(task, session.summary);
        record({ id: task.id, status: passed ? "passed" : "failed", accuracy: session.summary.accuracy, meanAbsDeviationMs: session.summary.meanAbsDeviationMs, bpm: task.tempo.start });
        const rec = f.find((x) => x.name.startsWith("grabacion."));
        if (rec) setFiles((prev) => [...prev.filter((x) => !x.name.startsWith(`prueba-${task.id}.`)), { name: `prueba-${task.id}.${rec.name.split(".").pop()}`, blob: rec.blob }]);
        setRun(null);
      },
    });
    currentRun.current = r;
    setRun(r);
    await r.start();
  }

  function skip() {
    if (!task) return;
    advance(record({ id: task.id, status: "skipped", accuracy: null, meanAbsDeviationMs: null, bpm: task.tempo.start }));
  }

  async function finishAssessment(go: "lesson" | "home") {
    if (!result || saving) return;
    setSaving(true);
    try {
      const id = newId();
      const tried = outcomes.filter((o) => o.accuracy !== null);
      const session: Session = {
        formatVersion: 1,
        id,
        kind: "assessment",
        mode: "audio",
        device: { kind: deviceKind(), ...(settings.deviceName ? { name: settings.deviceName } : {}) },
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
        bpm: null,
        latencyMs: settings.latencyMs,
        reps: [],
        notes: [],
        posture: [],
        cues: [],
        summary: {
          accuracy: tried.length ? Math.round((tried.reduce((s, o) => s + (o.accuracy ?? 0), 0) / tried.length) * 1000) / 1000 : null,
          meanDeviationMs: null,
          meanAbsDeviationMs: tried.length ? Math.round(tried.reduce((s, o) => s + (o.meanAbsDeviationMs ?? 0), 0) / tried.length) : null,
          cleanReps: 0,
          totalReps: 0,
          notesExpected: 0,
          notesHit: 0,
          extraNotes: 0,
          problemNotes: [],
          posture: {},
        },
        assessment: result,
        files: files.map((f) => ({ name: f.name, type: f.blob.type, size: f.blob.size, kind: "audio" as const })),
      };
      await saveLocalSession(session, files);
      await saveProfile({ assessment: { ...result, sessionId: id, date: new Date().toISOString() }, currentLessonId: result.recommendedLessonId });
      void syncNow();
      navigate(go === "lesson" && result.recommendedLessonId ? `/lecciones/${result.recommendedLessonId}` : "/");
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  const header = (
    <div className="flex items-center justify-between pt-2">
      <Button asChild variant="secondary" size="icon" className="rounded-full">
        <Link href="/" aria-label="Salir">
          <ChevronLeft className="size-5" />
        </Link>
      </Button>
      <span className="text-sm font-semibold">{a.title}</span>
      <span className="size-9" />
    </div>
  );

  // ------------------------------------------------------------ intro
  if (stage === "intro")
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-safe pb-safe">
        {header}
        <span className="mx-auto mt-4 grid size-16 place-items-center rounded-2xl bg-primary/15 text-primary">
          <ClipboardCheck className="size-8" />
        </span>
        <h1 className="display text-center text-[34px] leading-tight">{a.title}</h1>
        {a.summary && <p className="text-center text-muted-foreground">{a.summary}</p>}
        <Card className="gap-1 p-4">
          <Prose>{a.body.replace(/```alphatex[\s\S]*?```/g, "").trim()}</Prose>
        </Card>
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <li>• {a.questions.length} preguntas rápidas y hasta {a.exercises.length} pruebas cortas.</li>
          <li>• Solo audio: deja la guitarra afinada y el teléfono cerca.</li>
          {!settings.latencyCalibrated && (
            <li className="text-warning">
              • Recomendado: calibra la latencia en <Link href="/ajustes" className="underline">Ajustes</Link> antes de empezar.
            </li>
          )}
        </ul>
        <Button className="mt-auto mb-2 h-12" onClick={() => setStage(a.questions.length ? "questions" : "task")}>
          Empezar
        </Button>
      </div>
    );

  // ------------------------------------------------------------ questions
  if (stage === "questions")
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-safe pb-safe">
        {header}
        <h1 className="display text-[30px] leading-tight">Cuéntame un poco</h1>
        {a.questions.map((q) => (
          <Card key={q.id} className="gap-3 p-4">
            <div className="font-medium">{q.text}</div>
            {q.multiple ? (
              <div className="flex flex-col gap-2.5">
                {q.options.map((o) => {
                  const checked = answers[q.id]?.includes(o) ?? false;
                  return (
                    <Label key={o} className="flex items-center gap-2.5 font-normal">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setAnswers((prev) => ({ ...prev, [q.id]: v ? [...(prev[q.id] ?? []), o] : (prev[q.id] ?? []).filter((x) => x !== o) }))
                        }
                      />
                      {o}
                    </Label>
                  );
                })}
              </div>
            ) : (
              <RadioGroup value={answers[q.id]?.[0] ?? ""} onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: [v] }))}>
                {q.options.map((o) => (
                  <Label key={o} className="flex items-center gap-2.5 font-normal">
                    <RadioGroupItem value={o} />
                    {o}
                  </Label>
                ))}
              </RadioGroup>
            )}
          </Card>
        ))}
        <Button className="mt-auto mb-2 h-12" onClick={() => setStage("task")}>
          Continuar a las pruebas
        </Button>
      </div>
    );

  // ------------------------------------------------------------ result
  if (stage === "result" && result) {
    const rec = curriculum!.lessons.find((l) => l.id === result.recommendedLessonId);
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-safe pb-safe">
        {header}
        <div className="mt-2 text-center">
          <div className="eyebrow">Tu nivel</div>
          <div className="display text-[64px] leading-none text-primary">{result.level}</div>
          <div className="display text-2xl">{LEVEL_NAMES[result.level]}</div>
        </div>
        <Card className="gap-2.5 p-4">
          <span className="text-sm font-semibold">Habilidades</span>
          {Object.entries(result.skills).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 capitalize">{k}</span>
              <Progress value={v * 100} className="h-2" />
              <span className="w-10 text-right font-mono text-xs">{Math.round(v * 100)}%</span>
            </div>
          ))}
        </Card>
        <Card className="gap-2 p-4">
          <span className="text-sm font-semibold">Pruebas</span>
          {result.tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 text-sm">
              {t.status === "passed" ? <CircleCheck className="size-4 text-success" /> : t.status === "not-reached" ? <span className="size-4 rounded-full border" /> : <CircleX className="size-4 text-destructive" />}
              <span className="flex-1">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                {t.status === "skipped" ? "saltada" : t.status === "not-reached" ? "—" : `${Math.round((t.accuracy ?? 0) * 100)}% · ${t.meanAbsDeviationMs ?? "–"} ms`}
              </span>
            </div>
          ))}
        </Card>
        {rec && (
          <Card className="gap-1 border-primary/40 bg-primary/10 p-4">
            <div className="eyebrow">Empieza por</div>
            <div className="display text-2xl">{rec.title}</div>
            {rec.summary && <p className="text-sm text-muted-foreground">{rec.summary}</p>}
          </Card>
        )}
        <div className="mt-auto mb-2 grid gap-2">
          <Button className="h-12" onClick={() => finishAssessment("lesson")} disabled={saving}>
            {rec ? "Empezar esa lección" : "Guardar"}
          </Button>
          <Button variant="secondary" className="h-11" onClick={() => finishAssessment("home")} disabled={saving}>
            Ir al inicio
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ tasks
  if (!task) return null;
  const running = !!run && (st.phase === "countin" || st.phase === "running" || st.phase === "starting" || st.phase === "finishing");
  const bpb = beatsPerBar(task.music, (task.beatUnit ?? 4) as 4 | 8);
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-safe pb-safe">
      {header}
      <div>
        <div className="flex items-center justify-between">
          <span className="eyebrow">
            Prueba {idx + 1} de {a.exercises.length} · nivel {task.level} · {task.skill}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{task.tempo.start} BPM</span>
        </div>
        <Progress value={(idx / a.exercises.length) * 100} className="mt-2 h-1.5" />
      </div>
      <h1 className="display text-[30px] leading-tight">{task.title}</h1>
      {task.instructions && <p className="text-sm text-muted-foreground">{task.instructions}</p>}
      <Card className="p-3">
        <Tab music={task.music} fingers={task.fingers} cursor={running && st.phase === "running" ? st.cursor : undefined} states={running ? st.repStates : undefined} />
      </Card>
      <p className="text-xs text-muted-foreground">
        Se toca {task.reps} {task.reps === 1 ? "vez" : "veces seguidas"} después de un compás de cuenta. Para pasar: {Math.round(task.pass.accuracy * 100)}% de notas correctas y desfase medio menor a {task.pass.timingMs} ms.
      </p>

      {running && (
        <div className="flex flex-col items-center gap-3 py-2">
          <span className="display text-7xl text-primary">{st.countIn ?? (st.beatInBar >= 0 ? st.beatInBar + 1 : "·")}</span>
          <Beats count={bpb} active={st.beatInBar} />
          <span className="text-sm text-muted-foreground">{st.phase === "countin" ? "Prepárate…" : `Repetición ${Math.min(st.rep + 1, task.reps)} de ${task.reps}`}</span>
        </div>
      )}

      {st.phase === "error" && <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm">{st.error}</Card>}

      {last && !running && (
        <Card className={cn("flex-row items-center gap-3 p-4", last.status === "passed" ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10")}>
          {last.status === "passed" ? <CircleCheck className="size-6 text-success" /> : <CircleX className="size-6 text-destructive" />}
          <div className="text-sm">
            <b>{last.status === "passed" ? "¡Superada!" : last.status === "skipped" ? "Saltada" : "Todavía no"}</b>
            {last.accuracy !== null && (
              <div className="text-muted-foreground">
                {Math.round(last.accuracy * 100)}% notas correctas · desfase {last.meanAbsDeviationMs ?? "–"} ms
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="mt-auto mb-2 grid gap-2">
        {running ? (
          <Button
            variant="destructive"
            className="h-12"
            disabled={st.phase === "finishing"}
            onClick={() => {
              currentRun.current = null;
              void run?.cancel().then(() => setRun(null));
            }}
          >
            <Square className="size-4 fill-current" /> Cancelar prueba
          </Button>
        ) : last ? (
          <>
            <Button className="h-12" onClick={() => advance(outcomes)}>
              Siguiente
            </Button>
            {last.status === "failed" && (
              <Button variant="secondary" className="h-11" onClick={startTask}>
                Repetir esta prueba
              </Button>
            )}
          </>
        ) : (
          <>
            <Button className="h-12" onClick={startTask}>
              <Mic className="size-4" /> Empezar prueba
            </Button>
            <Button variant="secondary" className="h-11" onClick={skip}>
              <SkipForward className="size-4" /> Todavía no sé tocarla
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
