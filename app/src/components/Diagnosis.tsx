import { CircleAlert, CircleCheck, CircleX, Lightbulb } from "lucide-react";
import { noteNameEs, type Diagnosis, type ParsedMusic, type Verdict } from "@guitar-coach/core";
import { Card } from "@/components/ui/card";
import { Tab } from "@/components/Tab";
import { cn } from "@/lib/utils";

const STATE: Record<Verdict, string | undefined> = { ok: "hit", early: "off", late: "off", wrong: "miss", missed: "miss" };

/** Per-event Tab states and labels for a diagnosis. */
export function diagnosisMarks(d: Diagnosis) {
  const states: (string | undefined)[] = [];
  const labels: (string | undefined)[] = [];
  for (const e of d.events) {
    states[e.event] = STATE[e.verdict];
    labels[e.event] = e.label;
  }
  return { states, labels };
}

/** Tab coloured by what went wrong on each note, plus the explained list of problems. */
export function DiagnosisView({ music, fingers, diagnosis, className }: { music: ParsedMusic; fingers?: (string | undefined)[]; diagnosis: Diagnosis; className?: string }) {
  const { states, labels } = diagnosisMarks(diagnosis);
  const c = diagnosis.counts;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Card className="gap-2 p-3">
        <Tab music={music} fingers={fingers} states={states} labels={labels} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <Legend className="bg-success" text={`bien (${c.ok})`} />
          <Legend className="bg-warning" text={`a destiempo (${c.early + c.late}) · −ms antes, +ms después`} />
          <Legend className="bg-destructive" text={`nota distinta (${c.wrong}) · ? no se escuchó (${c.missed})`} />
        </div>
      </Card>
      {diagnosis.issues.map((i, k) => (
        <Card key={k} className={cn("gap-1.5 p-4", i.severity === "bad" ? "border-destructive/30" : i.severity === "warn" ? "border-warning/30" : "border-success/30")}>
          <div className="flex items-start gap-2.5">
            {i.severity === "good" ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            ) : i.severity === "warn" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : (
              <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{i.title}</span>
              {i.detail && <span className="text-sm text-muted-foreground">{i.detail}</span>}
            </div>
          </div>
          {i.severity !== "good" && (
            <div className="ml-6.5 flex items-start gap-2 rounded-lg bg-muted/60 p-2.5 text-sm">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>{i.tip}</span>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} />
      {text}
    </span>
  );
}

/** One-line live feedback for the note that was just judged. */
export function LiveVerdict({ v }: { v: { verdict: Verdict; deviationMs: number | null; detected: number | null; expected: number[] } | null }) {
  if (!v) return <span className="h-7" />;
  const exp = v.expected.length === 1 ? noteNameEs(v.expected[0]!) : null;
  const text =
    v.verdict === "ok"
      ? "Bien, a tiempo"
      : v.verdict === "early"
        ? `Antes de tiempo · ${Math.abs(v.deviationMs ?? 0)} ms`
        : v.verdict === "late"
          ? `Tarde · ${v.deviationMs ?? 0} ms`
          : v.verdict === "wrong"
            ? v.detected !== null && exp
              ? `Sonó ${noteNameEs(v.detected)}, debía ser ${exp}`
              : "No sonaron todas las notas"
            : "No se escuchó la nota";
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-sm font-medium",
        v.verdict === "ok" ? "bg-success/15 text-success" : v.verdict === "early" || v.verdict === "late" ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive",
      )}
    >
      {text}
    </span>
  );
}
