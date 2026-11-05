import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, ClipboardCheck, Mic, Music, Video } from "lucide-react";
import { minutesByDay, streak, localDay, type SessionListItem } from "@guitar-coach/core";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heatmap, LineChart, StatTile } from "@/components/viz";
import { currentLesson, useCurriculum, useLessonProgress, useProfile, useSessions } from "@/lib/data";
import { cn } from "@/lib/utils";

const RANGES = { semana: 7, mes: 30, todo: 3650 } as const;

export default function Progress() {
  const curriculum = useCurriculum();
  const sessions = useSessions();
  const profile = useProfile();
  const progress = useLessonProgress(curriculum?.lessons, sessions);
  const [range, setRange] = useState<keyof typeof RANGES>("mes");
  const current = currentLesson(curriculum, profile, progress);

  const exOptions = useMemo(
    () => curriculum?.lessons.flatMap((l) => l.exercises.map((e) => ({ key: `${l.id}/${e.id}`, label: `${l.title} · ${e.title}`, lesson: l, ex: e }))) ?? [],
    [curriculum],
  );
  const practised = exOptions.filter((o) => progress.get(o.lesson.id)?.exercises.find((x) => x.exerciseId === o.ex.id)?.sessions);
  const [chosen, setChosen] = useState<string | null>(null);
  const sel = exOptions.find((o) => o.key === chosen) ?? practised.at(-1) ?? exOptions.find((o) => o.lesson.id === current?.id);
  const selProgress = sel ? progress.get(sel.lesson.id)?.exercises.find((x) => x.exerciseId === sel.ex.id) : undefined;

  const all = sessions ?? [];
  const since = new Date(Date.now() - RANGES[range] * 86400000).toISOString();
  const inRange = all.filter((s) => s.startedAt >= since);
  const minutes = inRange.reduce((a, s) => a + s.durationSec / 60, 0);
  const byDay = useMemo(() => minutesByDay(all), [all]);
  const units = curriculum?.course?.units ?? [];
  const curUnit = units.findIndex((u) => u.id === current?.unit);

  const history = selProgress?.history ?? [];
  const points = history.map((h) => ({ x: h.date, y: h.bpm }));

  return (
    <div className="flex flex-col gap-3.5 pt-3">
      <header className="flex items-end justify-between gap-3">
        <h1 className="display text-[31px] leading-none">Progreso</h1>
        <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v as keyof typeof RANGES)}>
          <ToggleGroupItem value="semana">Semana</ToggleGroupItem>
          <ToggleGroupItem value="mes">Mes</ToggleGroupItem>
          <ToggleGroupItem value="todo">Todo</ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <StatTile value={minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(Math.round(minutes % 60)).padStart(2, "0")}` : `${Math.round(minutes)}m`} label="practicadas" />
        <StatTile value={inRange.length} label="sesiones" />
        <StatTile value={streak(all)} label="días seguidos" tone="primary" />
      </div>

      <Card className="gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Tempo por ejercicio</span>
          {selProgress?.bestCleanBpm && <span className="text-xs text-success">mejor: {selProgress.bestCleanBpm} BPM</span>}
        </div>
        {exOptions.length > 0 && (
          <Select value={sel?.key} onValueChange={setChosen}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elige un ejercicio" />
            </SelectTrigger>
            <SelectContent>
              {exOptions.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <LineChart points={points} target={sel?.ex.tempo.target} labels={points.length ? [new Date(points[0]!.x).toLocaleDateString("es", { day: "numeric", month: "short" }), "hoy"] : undefined} />
      </Card>

      <Card className="gap-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Minutos por día</span>
          <span className="text-xs text-muted-foreground">últimas 16 semanas</span>
        </div>
        <Heatmap minutes={byDay} />
      </Card>

      {units.length > 0 && (
        <Card className="gap-0 px-4 pt-3 pb-1">
          <div className="mb-2.5 text-sm font-semibold">Camino a {curriculum?.course?.goal?.title ?? "tu meta"}</div>
          {units.map((u, i) => (
            <div key={u.id} className="relative flex gap-2.5 pb-3">
              {i < units.length - 1 && <span className="absolute top-6 bottom-0 left-[9px] w-0.5 bg-border" />}
              <span className={cn("size-5 shrink-0 rounded-full border-2 bg-card", i < curUnit && "border-success bg-success", i === curUnit && "border-primary ring-4 ring-primary/20")} />
              <div>
                <div className="text-[13px] font-medium">{u.title}</div>
                {i === curUnit && current && <div className="text-[11.5px] text-muted-foreground">{current.title} · en curso</div>}
              </div>
            </div>
          ))}
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="display px-1 text-xl">Historial</h2>
        {all.length === 0 && <p className="px-1 text-sm text-muted-foreground">Todavía no hay sesiones. ¡A practicar!</p>}
        {all.slice(0, 40).map((s) => (
          <SessionRow key={s.id} s={s} />
        ))}
      </section>
    </div>
  );
}

function SessionRow({ s }: { s: SessionListItem }) {
  const Icon = s.kind === "assessment" ? ClipboardCheck : s.mode === "camera" ? Video : s.kind === "free" ? Music : Mic;
  const title = s.kind === "assessment" ? "Evaluación de nivel" : s.kind === "free" ? "Práctica libre" : s.exercise?.title ?? "Sesión";
  const acc = s.summary.accuracy;
  return (
    <Link href={`/sesion/${s.id}`}>
      <Card className="flex-row items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent">
        <Icon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            {localDay(s.startedAt)} · {Math.max(1, Math.round(s.durationSec / 60))} min{s.bpm ? ` · ${s.bpm} BPM` : ""}
          </div>
        </div>
        {acc !== null && <span className={cn("font-mono text-sm", acc >= 0.85 ? "text-success" : acc < 0.6 ? "text-destructive" : "")}>{Math.round(acc * 100)}%</span>}
        <ChevronRight className="size-4 text-muted-foreground" />
      </Card>
    </Link>
  );
}
