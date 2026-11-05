import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "wouter";
import { RefreshCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoteCameraSender, type RtcStatus } from "@/lib/rtc";
import { useSettings } from "@/lib/settings";
import { useCamera } from "@/pages/Practice";

const LABEL: Record<RtcStatus, string> = {
  connecting: "Conectando con el servidor…",
  waiting: "Esperando a la laptop… abre “Práctica con cámara” y activa la 2ª cámara",
  connected: "Enviando video a la laptop ✓",
  disconnected: "Desconectado, reintentando…",
  replaced: "Otro teléfono tomó esta cámara. Recarga para volver a conectar.",
  error: "Error",
};

/** Phone page: streams its camera to the laptop's practice screen. */
export default function RemoteCamera() {
  const [search] = useSearchParams();
  const settings = useSettings();
  const room = search.get("sala") || settings.remoteRoom;
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const { stream, error } = useCamera(true, facing);
  const [status, setStatus] = useState<RtcStatus>("connecting");
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    if (!stream) return;
    const s = new RemoteCameraSender(room, stream, setStatus);
    s.start();
    // keep the screen awake while streaming when supported
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => {
      s.stop();
      void lock?.release();
    };
  }, [stream, room]);

  return (
    <div className="fixed inset-0 bg-black text-white">
      <video ref={ref} autoPlay playsInline muted className={`size-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} />
      <div className="absolute inset-x-3 top-[max(env(safe-area-inset-top),0.75rem)] flex justify-between">
        <Link href="/" className="glass">
          <X className="size-3.5" /> Salir
        </Link>
        <span className="glass">Sala {room}</span>
      </div>
      <div className="absolute inset-x-4 bottom-[max(env(safe-area-inset-bottom),1rem)] flex flex-col gap-3">
        <div className="glass justify-center rounded-2xl py-3 text-sm">{error ?? LABEL[status]}</div>
        <p className="text-center text-xs text-white/70">Apunta a tu mano derecha (de lado o desde abajo). Puedes dejar el teléfono en un atril.</p>
        <Button variant="secondary" className="h-11" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
          <RefreshCcw className="size-4" /> Cambiar cámara
        </Button>
      </div>
    </div>
  );
}
