import { Link } from "wouter";
import { useMemo } from "react";
import Markdown from "react-markdown";
import { Check, ClipboardCheck, Flame, Play, Share, Sparkles } from "lucide-react";
import { localDay, streak, minutesByDay, LEVEL_NAMES } from "@guitar-coach/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Ring } from "@/components/viz";
import { SyncBadge } from "@/components/SyncBadge";
import { currentLesson, useCurriculum, useLessonProgress, useProfile, useSessions } from "@/lib/data";
import { isIOS, isStandalone } from "@/lib/device";
import { cn } from "@/lib/utils";
import { tunerMinutesToday, warmupDoneToday } from "@/lib/tuner-usage";

const DAYS = ["L", "M", "M", "J", "V", "S", "D"];

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches";
}

export function Home() {
  const curriculum = useCurriculum();
  const profile = useProfile();
  const sessions = useSessions();
  const progress = useLessonProgress(curriculum?.lessons, sessions);
  const lesson = currentLesson(curriculum, profile, progress);
  const today = localDay(new Date());

  const week = useMemo(() => {
    const days = new Set((sessions ?? []).map((s) => localDay(s.startedAt)));
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return DAYS.map((label, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = localDay(d);
      return { label, done: days.has(key), today: key === today, future: d > now && key !== today };
    });
  }, [sessions, today]);

  const todayMin = useMemo(() => {
    const m = { lesson: 0, free: 0 };
    for (const s of sessions ?? []) {
      if (localDay(s.startedAt) !== today) continue;
      if (s.kind === "free") m.free += s.durationSec / 60;
      else m.lesson += s.durationSec / 60;
    }
    return m;
  }, [sessions, today]);

  const routine = curriculum?.course?.dailyRoutine ?? [
    { kind: "tuner" as const, title: "Afinar y calentar", minutes: 5 },
    { kind: "lesson" as const, title: "Lección del día", minutes: 15 },
    { kind: "free" as const, title: "Toca lo que quieras", minutes: 10 },
  ];
  // The warm-up is done when the guitar was tuned today (or after its minutes in the tuner),
  // and it's behind you anyway once you've started practising: never send you back to it.
  const warmupDone = (minutes: number) => warmupDoneToday(minutes) || todayMin.lesson + todayMin.free > 0;
  const doneMin = (r: { kind: string; minutes: number }) =>
    r.kind === "tuner" ? (warmupDone(r.minutes) ? r.minutes : tunerMinutesToday()) : r.kind === "lesson" ? todayMin.lesson : r.kind === "free" ? todayMin.free : 0;
  const totalMin = routine.reduce((a, r) => a + r.minutes, 0);
  const totalDone = routine.reduce((a, r) => a + Math.min(r.minutes, doneMin(r)), 0);
  const nextItem = routine.find((r) => doneMin(r) < r.minutes);

  const lp = lesson ? progress.get(lesson.id) : undefined;
  const nextExercise = lesson && lp ? lesson.exercises.find((e) => !lp.exercises.find((x) => x.exerciseId === e.id)?.mastered) ?? lesson.exercises[0] : lesson?.exercises[0];
  const allEx = curriculum?.lessons.flatMap((l) => l.exercises.map((e) => progress.get(l.id)?.exercises.find((x) => x.exerciseId === e.id)?.mastered)) ?? [];
  const overall = allEx.length ? allEx.filter(Boolean).length / allEx.length : 0;
  const unit = curriculum?.course?.units.find((u) => u.id === lesson?.unit);
  const note = curriculum?.notes[0];
  const s = streak(sessions ?? []);

  const cta = nextItem?.kind === "tuner" ? "/afinador" : nextItem?.kind === "free" ? "/libre" : lesson && nextExercise ? `/lecciones/${lesson.id}` : "/lecciones";

  return (
    <div className="flex flex-col gap-3.5 pt-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1 className="display mt-0.5 text-[31px] leading-none">{greeting()}</h1>
        </div>
        <SyncBadge className="mt-1" />
      </header>

      {isIOS() && !isStandalone() && (
        <Card className="flex-row items-center gap-3 border-info/30 bg-info/10 px-4 py-3 text-sm">
          <Share className="size-5 shrink-0 text-info" />
          <span>
            Para usarla sin conexión, instálala: <b>Compartir → Añadir a pantalla de inicio</b>. Si no, Safari puede borrar tus sesiones pendientes.
          </span>
        </Card>
      )}

      {curriculum && !profile?.assessment && (
        <Card className="gap-3 border-primary/40 bg-primary/10 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
              <ClipboardCheck className="size-5" />
            </span>
            <div>
              <div className="font-semibold">Empieza con la evaluación de nivel</div>
              <p className="text-sm text-muted-foreground">Unos minutos tocando pruebas cortas para saber desde qué lección arrancar.</p>
            </div>
          </div>
          <Button asChild className="h-11">
            <Link href="/evaluacion">Hacer la evaluación</Link>
          </Button>
        </Card>
      )}

      <Card className="flex-row items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Flame className="size-5" />
          </span>
          <div>
            <div className="display text-2xl leading-none">
              {s} {s === 1 ? "día" : "días"}
            </div>
            <div className="text-xs text-muted-foreground">seguidos practicando</div>
          </div>
        </div>
        <div className="flex gap-1.5">
          {week.map((d, i) => (
            <span key={i} className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
              <b className={cn("size-2.5 rounded-full bg-muted", d.done && "bg-primary", d.today && !d.done && "bg-transparent ring-[1.5px] ring-primary ring-inset", d.future && "opacity-50")} />
              {d.label}
            </span>
          ))}
        </div>
      </Card>

      <Card className="gap-0 p-4">
        <div className="flex items-center justify-between">
          <b className="text-[15px]">Práctica de hoy</b>
          <span className="font-mono text-xs text-muted-foreground">
            {Math.round(totalDone)} / {totalMin} min
          </span>
        </div>
        <Progress value={(totalDone / totalMin) * 100} className="mt-2.5 h-1.5" />
        <ol className="my-3 flex flex-col gap-0.5">
          {routine.map((r, i) => {
            const done = doneMin(r) >= r.minutes;
            const now = r === nextItem;
            const detail = r.kind === "lesson" && lesson ? `${lesson.title}${nextExercise ? ` · ${nextExercise.title}` : ""}` : `${r.minutes} min`;
            return (
              <li key={i} className={cn("flex items-center gap-3 rounded-xl px-2 py-2.5", now && "bg-primary/10")}>
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] font-semibold",
                    done && "border-transparent bg-success text-background",
                    now && "border-transparent bg-primary text-primary-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate", done && "text-muted-foreground line-through")}>{r.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.kind === "lesson" ? detail : `${r.minutes} min`}</div>
                </div>
                {now && <Badge className="bg-primary/15 text-primary">Ahora</Badge>}
              </li>
            );
          })}
        </ol>
        <Button asChild className="h-12 text-[15px]">
          <Link href={cta}>
            <Play className="size-4 fill-current" />
            {totalDone > 0 ? "Continuar práctica" : "Empezar práctica"}
          </Link>
        </Button>
      </Card>

      <Card className="flex-row items-center justify-between p-4">
        <div className="min-w-0">
          <div className="eyebrow">Tu meta</div>
          <div className="display mt-0.5 truncate text-2xl leading-tight">{curriculum?.course?.goal?.title ?? "Tocar fingerstyle"}</div>
          <div className="text-xs text-muted-foreground">
            {unit ? `${unit.title} · nivel ${unit.level}` : lesson ? `Nivel ${lesson.level}` : ""}
            {profile?.assessment ? ` · evaluado: ${LEVEL_NAMES[profile.assessment.level]}` : ""}
          </div>
        </div>
        <Ring value={overall} />
      </Card>

      {note && (
        <Card className="gap-2 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="eyebrow">Mensaje de tu instructor · {note.date}</span>
          </div>
          <div className="font-semibold">{note.title}</div>
          <div className="prose-sm text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
            <Markdown>{note.body}</Markdown>
          </div>
        </Card>
      )}

      {curriculum === null && (
        <Card className="p-4 text-sm text-muted-foreground">
          Todavía no hay lecciones en este dispositivo. Conéctate una vez a tu servidor (la laptop) para descargarlas.
        </Card>
      )}
      {(sessions?.length ?? 0) > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          {Math.round([...minutesByDay(sessions!).values()].reduce((a, b) => a + b, 0))} minutos practicados en total
        </p>
      )}
    </div>
  );
}
