import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Volume2 } from "lucide-react";
import { Link } from "wouter";
import { centsOff, detectPitch, midiToFreq, OPEN_STRINGS, pluck, pitchClassName } from "@guitar-coach/core";
import { addTunerTime, markStringTuned, tunedStringsToday } from "@/lib/tuner-usage";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { audio } from "@/audio/engine";
import { cn } from "@/lib/utils";

function Gauge({ cents }: { cents: number | null }) {
  const cx = 145;
  const cy = 140;
  const R = 118;
  const pt = (a: number, r: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)] as const;
  const arc = (a1: number, a2: number, r: number) => {
    const [x1, y1] = pt(a1, r);
    const [x2, y2] = pt(a2, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const a = cents === null ? null : (Math.max(-50, Math.min(50, cents)) / 50) * 70;
  const ok = cents !== null && Math.abs(cents) <= 5;
  return (
    <svg viewBox="0 0 290 150" className="w-full max-w-[320px]">
      <path d={arc(-70, 70, R)} stroke="var(--muted)" strokeWidth={10} fill="none" strokeLinecap="round" />
      <path d={arc(-7, 7, R)} stroke="var(--success)" strokeWidth={10} fill="none" strokeLinecap="round" />
      {Array.from({ length: 21 }, (_, i) => {
        const v = -50 + i * 5;
        const ang = (v / 50) * 70;
        const [x1, y1] = pt(ang, R - 14);
        const [x2, y2] = pt(ang, R - (v % 25 ? 20 : 26));
        return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted-foreground)" strokeOpacity={v % 25 ? 0.4 : 0.8} strokeWidth={1.5} />;
      })}
      {[-50, 0, 50].map((v) => {
        const [x, y] = pt((v / 50) * 70, R - 40);
        return (
          <text key={v} x={x} y={y + 4} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
            {v > 0 ? `+${v}` : v}
          </text>
        );
      })}
      {a !== null && (() => {
        const [tx, ty] = pt(a, R);
        return <circle cx={tx} cy={ty} r={9} fill={ok ? "var(--success)" : "var(--warning)"} stroke="var(--background)" strokeWidth={3} style={{ transition: "cx .12s, cy .12s" }} />;
      })()}
    </svg>
  );
}

export default function Tuner() {
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [target, setTarget] = useState<number | null>(null);
  const [reading, setReading] = useState<{ midi: number; cents: number; freq: number } | null>(null);
  const [tuned, setTuned] = useState<Set<number>>(() => new Set(tunedStringsToday()));
  const [error, setError] = useState<string | null>(null);
  const smooth = useRef<number | null>(null);
  const inTune = useRef(0);

  useEffect(() => {
    if (!on) return;
    let buf = new Float32Array(4096);
    let filled = 0;
    let last = 0;
    // save the time as it goes: on iOS the app may be closed without unmounting
    let since = Date.now();
    const flush = () => {
      addTunerTime((Date.now() - since) / 1000);
      since = Date.now();
    };
    const saver = setInterval(flush, 5000);
    const off = audio.onBlock((b) => {
      // sliding window of the last 4096 samples
      if (filled + b.samples.length > buf.length) {
        const keep = buf.length - b.samples.length;
        buf.copyWithin(0, filled - keep, filled);
        filled = keep;
      }
      buf.set(b.samples, filled);
      filled += b.samples.length;
      const now = performance.now();
      if (filled < buf.length || now - last < 70) return;
      last = now;
      const p = detectPitch(buf, audio.sampleRate);
      if (!p) {
        smooth.current = null;
        return setReading(null);
      }
      const f = smooth.current === null || Math.abs(Math.log2(p.freq / smooth.current)) > 0.03 ? p.freq : smooth.current * 0.6 + p.freq * 0.4;
      smooth.current = f;
      let { midi, cents } = centsOff(f);
      if (mode === "manual" && target !== null) {
        cents = 1200 * Math.log2(f / midiToFreq(target));
        midi = target;
      }
      setReading({ midi, cents, freq: f });
      const open = OPEN_STRINGS.find((s) => s.midi === midi);
      if (open && Math.abs(cents) <= 5) {
        if (++inTune.current > 6) {
          markStringTuned(open.string);
          setTuned((t) => (t.has(open.string) ? t : new Set(t).add(open.string)));
        }
      } else inTune.current = 0;
    });
    return () => {
      off();
      buf = new Float32Array(0);
      clearInterval(saver);
      flush();
    };
  }, [on, mode, target]);

  useEffect(() => () => audio.releaseMic(), []);

  async function enable() {
    try {
      await audio.startMic();
      setOn(true);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Necesito permiso para usar el micrófono." : (e as Error).message);
    }
  }

  function reference(midi: number) {
    void audio.ensureContext().then(() => audio.playBuffer(pluck(midiToFreq(midi), audio.sampleRate, 2.5, { decay: 0.9985, brightness: 0.45 }), 0, 0.9));
  }

  const name = reading ? pitchClassName(reading.midi) : "–";
  const octave = reading ? Math.floor(reading.midi / 12) - 1 : "";
  const ok = reading && Math.abs(reading.cents) <= 5;
  const hint = !reading ? (on ? "Toca una cuerda al aire" : "") : ok ? "¡Afinada!" : reading.cents > 0 ? "Un poco alta: afloja" : "Un poco baja: aprieta";
  const activeString = target ?? OPEN_STRINGS.find((s) => s.midi === reading?.midi)?.midi ?? null;

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-5 pt-3">
      <header className="flex items-end justify-between">
        <div>
          <div className="eyebrow">Estándar · 440 Hz</div>
          <h1 className="display text-[31px] leading-none">Afinador</h1>
        </div>
        <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "auto" | "manual")}>
          <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
          <ToggleGroupItem value="manual">Manual</ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="flex flex-col items-center">
        <Gauge cents={reading?.cents ?? null} />
        <div className="-mt-10 flex items-baseline">
          <span className="display text-[96px] leading-[.9]">{name}</span>
          <span className="display text-3xl text-muted-foreground">{octave}</span>
        </div>
        <div className="mt-1.5 font-mono text-sm text-muted-foreground">{reading ? `${reading.freq.toFixed(1)} Hz · ${reading.cents > 0 ? "+" : ""}${reading.cents.toFixed(0)} cents` : "—"}</div>
        {hint && <div className={cn("mt-3 rounded-full px-3 py-1 text-xs font-medium", ok ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{hint}</div>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <div>
          <div className="eyebrow mb-2">Cuerdas {mode === "manual" && "· elige una"}</div>
          <div className="grid grid-cols-6 gap-1.5">
            {OPEN_STRINGS.map((s) => (
              <button
                key={s.string}
                onClick={() => {
                  if (mode === "manual") setTarget(s.midi);
                  reference(s.midi);
                }}
                className={cn(
                  "flex flex-col items-center rounded-xl border bg-card py-2 font-mono text-[15px] font-semibold",
                  tuned.has(s.string) && "border-success/50",
                  activeString === s.midi && "border-transparent bg-primary text-primary-foreground",
                )}
              >
                {s.name}
                <small className="font-sans text-[10px] font-medium opacity-70">{s.string}ª</small>
              </button>
            ))}
          </div>
          <div className="mt-2 text-center text-xs text-muted-foreground">
            {tuned.size >= 6 ? (
              <span className="font-medium text-success">
                <Check className="mr-1 inline size-3.5" strokeWidth={3} />
                Las 6 cuerdas afinadas hoy
              </span>
            ) : (
              `${tuned.size} de 6 cuerdas afinadas hoy`
            )}
          </div>
        </div>
        {tuned.size >= 6 && (
          <Button asChild className="h-12">
            <Link href="/">
              Seguir con la práctica de hoy <ArrowRight className="size-4" />
            </Link>
          </Button>
        )}
        {!on ? (
          <Button className="h-12" onClick={enable}>
            Activar micrófono
          </Button>
        ) : (
          <Button variant="secondary" className="h-11" onClick={() => activeString && reference(activeString)} disabled={!activeString}>
            <Volume2 className="size-4" /> Tocar nota de referencia
          </Button>
        )}
      </div>
    </div>
  );
}
