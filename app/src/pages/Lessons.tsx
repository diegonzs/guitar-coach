import { Link } from "wouter";
import { ChevronRight, ClipboardCheck, Music } from "lucide-react";
import { LEVEL_NAMES } from "@guitar-coach/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ring } from "@/components/viz";
import { currentLesson, useCurriculum, useLessonProgress, useProfile, useSessions } from "@/lib/data";
import { useSync } from "@/lib/sync";

export default function Lessons() {
  const curriculum = useCurriculum();
  const sessions = useSessions();
  const profile = useProfile();
  const progress = useLessonProgress(curriculum?.lessons, sessions);
  const current = currentLesson(curriculum, profile, progress);
  const sync = useSync();

  if (curriculum === undefined) return null;
  if (!curriculum) return <p className="py-16 text-center text-sm text-muted-foreground">Conéctate a tu servidor para descargar las lecciones.</p>;

  const units = curriculum.course?.units ?? [{ id: "_", title: "Lecciones", level: 1, description: undefined }];
  const groups = units.map((u) => ({ unit: u, lessons: curriculum.lessons.filter((l) => (curriculum.course ? l.unit === u.id : true)) }));
  const orphans = curriculum.course ? curriculum.lessons.filter((l) => !l.unit || !curriculum.course!.units.some((u) => u.id === l.unit)) : [];
  if (orphans.length) groups.push({ unit: { id: "_otras", title: "Otras lecciones", level: 0, description: undefined }, lessons: orphans });

  return (
    <div className="flex flex-col gap-4 pt-3">
      <header>
        <div className="eyebrow">{curriculum.course?.title ?? "Tu curso"}</div>
        <h1 className="display text-[31px] leading-none">Lecciones</h1>
        {sync.exampleCurriculum && (
          <p className="mt-2 text-xs text-muted-foreground">
            Estás usando el currículo de ejemplo. Crea el tuyo en <code className="font-mono">curriculum/</code> (ver docs/llm-guide.md).
          </p>
        )}
      </header>

      {curriculum.assessment && (
        <Link href="/evaluacion">
          <Card className="flex-row items-center gap-3 px-4 py-3 transition-colors hover:bg-accent">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
              <ClipboardCheck className="size-5" />
            </span>
            <div className="flex-1">
              <div className="font-medium">{curriculum.assessment.title}</div>
              <div className="text-xs text-muted-foreground">
                {profile?.assessment ? `Tu nivel: ${profile.assessment.level} · ${LEVEL_NAMES[profile.assessment.level]} — repetirla` : "Para saber desde dónde empezar"}
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Card>
        </Link>
      )}

      {groups
        .filter((g) => g.lessons.length)
        .map(({ unit, lessons }) => (
          <section key={unit.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="display text-xl">{unit.title}</h2>
              {unit.level > 0 && <span className="eyebrow">Nivel {unit.level}</span>}
            </div>
            {unit.description && <p className="-mt-1 px-1 text-xs text-muted-foreground">{unit.description}</p>}
            {lessons.map((l) => {
              const p = progress.get(l.id);
              return (
                <Link key={l.id} href={`/lecciones/${l.id}`}>
                  <Card className="flex-row items-center gap-3 px-4 py-3 transition-colors hover:bg-accent">
                    {p && p.ratio > 0 ? (
                      <Ring value={p.ratio} size={44} stroke={5} />
                    ) : (
                      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
                        <Music className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {l.exercises.length} {l.exercises.length === 1 ? "ejercicio" : "ejercicios"} · {l.estimatedMinutes} min
                      </div>
                    </div>
                    {p?.mastered ? <Badge className="bg-success/15 text-success">Dominada</Badge> : current?.id === l.id ? <Badge className="bg-primary/15 text-primary">Actual</Badge> : null}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Card>
                </Link>
              );
            })}
          </section>
        ))}
    </div>
  );
}
