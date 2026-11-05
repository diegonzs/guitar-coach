import { Link, useParams } from "wouter";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, CircleCheck, Mic, Target, Video, Gauge, Hand } from "lucide-react";
import { CHECK_LABELS, type Exercise, type ExerciseProgress, type Lesson } from "@guitar-coach/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tab } from "@/components/Tab";
import { currentLesson, useCurriculum, useLessonProgress, useProfile, useSessions } from "@/lib/data";
import { saveProfile } from "@/lib/db";
import { syncNow } from "@/lib/sync";
import { cn } from "@/lib/utils";

const BLOCK_RE = /^```alphatex[ \t]+exercise=([a-z0-9-]+)[ \t]*\n[\s\S]*?^```[ \t]*$/gm;

export function splitBody(body: string): ({ kind: "md"; text: string } | { kind: "ex"; id: string })[] {
  const out: ({ kind: "md"; text: string } | { kind: "ex"; id: string })[] = [];
  let last = 0;
  for (const m of body.matchAll(BLOCK_RE)) {
    if (m.index! > last) out.push({ kind: "md", text: body.slice(last, m.index) });
    out.push({ kind: "ex", id: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push({ kind: "md", text: body.slice(last) });
  return out;
}

export function Prose({ children }: { children: string }) {
  return (
    <div
      className={cn(
        "text-[15px] leading-relaxed text-muted-foreground",
        "[&_h1]:display [&_h2]:display [&_h1]:text-2xl [&_h2]:mt-5 [&_h2]:mb-1 [&_h2]:text-xl [&_h2]:text-foreground [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-foreground",
        "[&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_table]:my-3 [&_table]:w-full [&_table]:text-sm [&_td]:border-b [&_td]:py-1.5 [&_td]:pr-2 [&_th]:border-b [&_th]:py-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:text-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px]",
      )}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

const CHECK_ICON: Record<string, typeof Target> = { notes: Target, timing: Gauge };

export function TempoLadder({ ex, p }: { ex: Exercise; p?: ExerciseProgress }) {
  const target = ex.tempo.target ?? ex.tempo.start;
  const steps: number[] = [];
  for (let b = ex.tempo.start; b < target; b += ex.tempo.step) steps.push(b);
  steps.push(target);
  return (
    <div className="flex gap-1">
      {steps.map((b) => {
        const done = p?.bestCleanBpm !== null && p?.bestCleanBpm !== undefined && b <= p.bestCleanBpm;
        const now = b === (p?.suggestedBpm ?? ex.tempo.start) && !p?.mastered;
        return (
          <span
            key={b}
            className={cn(
              "flex-1 rounded-md bg-muted py-1.5 text-center font-mono text-[11px] font-medium text-muted-foreground",
              done && "bg-success/18 text-success",
              now && "bg-primary text-primary-foreground",
            )}
          >
            {b}
          </span>
        );
      })}
    </div>
  );
}

function ExerciseCard({ lesson, ex, p }: { lesson: Lesson; ex: Exercise; p?: ExerciseProgress }) {
  const bpm = p?.suggestedBpm ?? ex.tempo.start;
  const hasPosture = ex.checks.some((c) => c.startsWith("posture."));
  return (
    <Card className="my-3 gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-foreground">{ex.title}</div>
          {ex.instructions && <p className="text-sm text-muted-foreground">{ex.instructions}</p>}
        </div>
        {p?.mastered && (
          <Badge className="bg-success/15 text-success">
            <CircleCheck className="size-3" />
            Dominado
          </Badge>
        )}
      </div>
      <Tab music={ex.music} fingers={ex.fingers} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {ex.music.timeSignature.join("/")} · {ex.loop ? "en bucle" : "una vez"}
        </span>
        <span>
          sube {ex.tempo.step} BPM con {ex.cleanRepsToAdvance} reps limpias
        </span>
      </div>
      <TempoLadder ex={ex} p={p} />
      <div className="flex flex-wrap gap-1.5">
        {ex.checks.map((c) => {
          const Icon = CHECK_ICON[c] ?? Hand;
          return (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs">
              <Icon className="size-3.5" />
              {CHECK_LABELS[c]}
            </span>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild className="h-11">
          <Link href={`/practicar/${lesson.id}/${ex.id}?modo=camara&bpm=${bpm}`}>
            <Video className="size-4" />
            Practicar con cámara
          </Link>
        </Button>
        <Button asChild variant="secondary" className="h-11">
          <Link href={`/practicar/${lesson.id}/${ex.id}?modo=audio&bpm=${bpm}`}>
            <Mic className="size-4" />
            Solo audio
          </Link>
        </Button>
      </div>
      {!hasPosture && <p className="-mt-1 text-[11px] text-muted-foreground">Este ejercicio no evalúa postura; la cámara solo graba para tu instructor.</p>}
    </Card>
  );
}

export default function LessonDetail() {
  const { id } = useParams<{ id: string }>();
  const curriculum = useCurriculum();
  const sessions = useSessions();
  const profile = useProfile();
  const progress = useLessonProgress(curriculum?.lessons, sessions);
  const lesson = curriculum?.lessons.find((l) => l.id === id);
  if (curriculum === undefined) return null;
  if (!lesson) return <p className="py-16 text-center text-sm text-muted-foreground">No encontré esa lección.</p>;
  const p = progress.get(lesson.id);
  const isCurrent = currentLesson(curriculum, profile, progress)?.id === lesson.id;
  const unit = curriculum?.course?.units.find((u) => u.id === lesson.unit);

  return (
    <article className="flex flex-col gap-2 pt-3">
      <div className="flex items-center justify-between">
        <Button asChild variant="secondary" size="icon" className="rounded-full">
          <Link href="/lecciones" aria-label="Volver">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
        <Badge className="bg-success/15 text-success">
          <CircleCheck className="size-3" />
          Disponible sin conexión
        </Badge>
      </div>
      <div className="mt-2">
        <div className="eyebrow">
          {unit ? `${unit.title} · ` : ""}Nivel {lesson.level}
        </div>
        <h1 className="display text-[32px] leading-[1.05]">{lesson.title}</h1>
        {lesson.summary && <p className="mt-1.5 text-muted-foreground">{lesson.summary}</p>}
      </div>
      {lesson.goals.length > 0 && (
        <ul className="my-1 flex flex-col gap-1 text-sm">
          {lesson.goals.map((g) => (
            <li key={g} className="flex items-start gap-2">
              <Target className="mt-0.5 size-4 shrink-0 text-primary" />
              {g}
            </li>
          ))}
        </ul>
      )}
      {!isCurrent && (
        <Button
          variant="outline"
          className="self-start"
          onClick={async () => {
            await saveProfile({ currentLessonId: lesson.id });
            void syncNow();
          }}
        >
          Trabajar en esta lección
        </Button>
      )}
      {splitBody(lesson.body).map((part, i) => {
        if (part.kind === "md") return <Prose key={i}>{part.text}</Prose>;
        const ex = lesson.exercises.find((e) => e.id === part.id);
        return ex ? <ExerciseCard key={i} lesson={lesson} ex={ex} p={p?.exercises.find((x) => x.exerciseId === ex.id)} /> : null;
      })}
    </article>
  );
}
