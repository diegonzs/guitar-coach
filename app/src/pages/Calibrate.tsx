import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "wouter";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setSettings, useSettings } from "@/lib/settings";
import { useCamera } from "@/pages/Practice";
import { cn } from "@/lib/utils";

/** Two taps on the (mirrored) camera image: the nut and the 12th fret. */
export default function Calibrate() {
  const [search] = useSearchParams();
  const back = search.get("volver") || "/ajustes";
  const [, navigate] = useLocation();
  const settings = useSettings();
  const { stream, error } = useCamera(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nut, setNut] = useState<[number, number] | null>(null);
  const [fret12, setFret12] = useState<[number, number] | null>(null);
  const step = !nut ? 1 : !fret12 ? 2 : 3;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  /** Converts a tap on the mirrored, object-cover video into normalised unmirrored image coords. */
  function toImage(e: React.PointerEvent<HTMLDivElement>): [number, number] | null {
    const v = videoRef.current;
    if (!v?.videoWidth) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const scale = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    const dw = v.videoWidth * scale;
    const dh = v.videoHeight * scale;
    const xIn = (e.clientX - r.left - (r.width - dw) / 2) / dw;
    const yIn = (e.clientY - r.top - (r.height - dh) / 2) / dh;
    if (xIn < 0 || xIn > 1 || yIn < 0 || yIn > 1) return null;
    return [1 - xIn, yIn];
  }
  function toScreen(p: [number, number], el: HTMLDivElement | null) {
    const v = videoRef.current;
    if (!el || !v?.videoWidth) return { left: 0, top: 0 };
    const r = el.getBoundingClientRect();
    const scale = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    const dw = v.videoWidth * scale;
    const dh = v.videoHeight * scale;
    return { left: (r.width - dw) / 2 + (1 - p[0]) * dw, top: (r.height - dh) / 2 + p[1] * dh };
  }
  const area = useRef<HTMLDivElement>(null);

  return (
    <div className="fixed inset-0 bg-black text-white">
      <div
        ref={area}
        className="absolute inset-0"
        onPointerDown={(e) => {
          const p = toImage(e);
          if (!p) return;
          if (step === 1) setNut(p);
          else if (step === 2) setFret12(p);
        }}
      >
        <video ref={videoRef} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
        {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm">{error}</div>}
        {[
          { p: nut, label: "Cejuela", color: "var(--success)" },
          { p: fret12, label: "Traste 12", color: "var(--primary)" },
        ].map(
          ({ p, label, color }) =>
            p && (
              <div key={label} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center" style={toScreen(p, area.current)}>
                <div className="mb-1 text-xs font-semibold" style={{ color }}>
                  {label}
                </div>
                <div className="size-8 rounded-full border-[2.5px]" style={{ borderColor: color, background: `color-mix(in oklch, ${color} 30%, transparent)` }} />
              </div>
            ),
        )}
      </div>
      <div className="absolute inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] flex justify-between">
        <Link href={back} className="glass">
          <X className="size-3.5" /> Cancelar
        </Link>
        <span className="glass">Calibración</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 rounded-t-3xl bg-card px-5 pt-4 pb-safe text-card-foreground">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Paso {Math.min(step, 2)} de 2</span>
          <div className="flex gap-1.5">
            <span className={cn("size-2 rounded-full bg-muted", nut && "bg-success")} />
            <span className={cn("size-2 rounded-full bg-muted", fret12 && "bg-success", step === 2 && "bg-primary")} />
          </div>
        </div>
        <div className="display text-[26px] leading-tight">
          {step === 1 ? (
            <>
              Toca la <span className="text-primary">cejuela</span> en la imagen
            </>
          ) : step === 2 ? (
            <>
              Toca el <span className="text-primary">traste 12</span> en la imagen
            </>
          ) : (
            "¡Listo!"
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Así la app sabe dónde está el mástil y puede ubicar tus dedos. Solo hay que repetirlo si mueves la cámara.
          {settings.calibration && step === 1 && " (Ya tienes una calibración guardada.)"}
        </p>
        <div className="grid grid-cols-2 gap-2 pb-2">
          <Button
            variant="secondary"
            className="h-11"
            onClick={() => {
              setNut(null);
              setFret12(null);
            }}
          >
            Repetir
          </Button>
          <Button
            className="h-11"
            disabled={step !== 3}
            onClick={() => {
              setSettings({ calibration: { nut: nut!, fret12: fret12!, date: new Date().toISOString() } });
              navigate(back);
            }}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
