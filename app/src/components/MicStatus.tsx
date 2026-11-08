import { useEffect, useRef } from "react";
import { Mic, MicOff, RotateCcw } from "lucide-react";
import { audio } from "@/audio/engine";
import type { PracticeState } from "@/audio/practice";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Live input meter: shows that sound really reaches the app (not just that the mic is "on"). */
export function MicLevel({ className, dark }: { className?: string; dark?: boolean }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      // −60 dBFS … −12 dBFS → 0 … 100 %
      const db = 20 * Math.log10(Math.max(audio.level, 1e-6));
      const k = Math.min(1, Math.max(0, (db + 60) / 48));
      if (bar.current) {
        bar.current.style.transform = `scaleX(${k})`;
        bar.current.style.opacity = audio.micStatus() === "ok" ? "1" : "0.25";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title="Nivel del micrófono">
      <Mic className={cn("size-3.5", dark ? "text-white/80" : "text-muted-foreground")} />
      <span className={cn("relative h-1.5 w-14 overflow-hidden rounded-full", dark ? "bg-white/20" : "bg-muted")}>
        <span ref={bar} className="absolute inset-0 origin-left rounded-full bg-success transition-transform duration-75" style={{ transform: "scaleX(0)" }} />
      </span>
    </span>
  );
}

const TEXT: Record<NonNullable<PracticeState["micIssue"]>, { title: string; detail: string }> = {
  muted: {
    title: "El micrófono se cortó",
    detail: "El sistema lo pausó (una llamada, Siri, otra app o cambiaste de audífonos). Tócalo para reactivarlo.",
  },
  stalled: {
    title: "No me llega audio",
    detail: "El audio se detuvo (pasa al bloquear el teléfono o cambiar de app). Tócalo para reactivarlo.",
  },
  quiet: {
    title: "No te escucho",
    detail: "Solo me llega el ruido de la sala. Acerca el micrófono a la guitarra (30–60 cm), que no esté tapado, o reactívalo.",
  },
};

/** Banner shown when the guitar isn't reaching the detector, with a one-tap fix. */
export function MicIssue({ issue, onRestart, className }: { issue: PracticeState["micIssue"]; onRestart: () => void; className?: string }) {
  if (!issue) return null;
  const t = TEXT[issue];
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-xl border border-warning/40 bg-card/95 p-3 text-sm shadow-lg backdrop-blur", className)}>
      <MicOff className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-semibold">{t.title}</span>
        <span className="text-xs text-muted-foreground">{t.detail}</span>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0" onClick={onRestart}>
        <RotateCcw className="size-3.5" /> Reactivar
      </Button>
    </div>
  );
}
