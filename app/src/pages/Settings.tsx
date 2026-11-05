import { useEffect, useState } from "react";
import { Link } from "wouter";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Download, HardDrive, RefreshCw, Smartphone, Timer, Trash2, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SyncBadge } from "@/components/SyncBadge";
import { setSettings, useSettings, type Theme } from "@/lib/settings";
import { freeUploadedMedia, syncNow, useSync } from "@/lib/sync";
import { db } from "@/lib/db";
import { prefetchVisionAssets } from "@/vision/vision";
import { loopbackLatency, pluckAlongLatency } from "@/audio/latency";
import { audio } from "@/audio/engine";

function Row({ title, detail, children }: { title: string; detail?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;

export default function SettingsPage() {
  const s = useSettings();
  const sync = useSync();
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean; local: number } | null>(null);
  const [calibrating, setCalibrating] = useState<null | "loopback" | "pluck">(null);
  const [plucks, setPlucks] = useState(0);
  const [qr, setQr] = useState<string | null>(null);

  async function refreshStorage() {
    const est = await navigator.storage?.estimate?.();
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    let local = 0;
    await db.files.each((f) => void (local += f.blob.size));
    setStorage({ usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted, local });
  }
  useEffect(() => {
    void refreshStorage();
    QRCode.toDataURL(`${location.origin}/`, { margin: 1, width: 180 }).then(setQr);
  }, []);

  async function calibrate(kind: "loopback" | "pluck") {
    setCalibrating(kind);
    setPlucks(0);
    try {
      await audio.ensureContext();
      const ms = kind === "loopback" ? await loopbackLatency() : await pluckAlongLatency(setPlucks);
      if (ms === null) {
        toast.error(kind === "loopback" ? "No oí los clics con claridad. Sube el volumen o usa “Tocando junto al clic”." : "No detecté suficientes notas. Inténtalo otra vez tocando una cuerda al aire con cada clic.");
      } else {
        setSettings({ latencyMs: ms, latencyCalibrated: true });
        toast.success(`Latencia: ${ms} ms`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCalibrating(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <h1 className="display text-[31px] leading-none">Ajustes</h1>

      <Card className="gap-0 px-4 py-2">
        <Row title="Servidor (tu laptop)" detail={sync.online ? (sync.lastSync ? `Última sincronización ${new Date(sync.lastSync).toLocaleTimeString()}` : "Conectado") : "No disponible: tus sesiones se guardan aquí y se enviarán después"}>
          <SyncBadge />
        </Row>
        <Row title="Pendientes de enviar" detail={[sync.error && `Error: ${sync.error}`, sync.failed > 0 && `${sync.failed} sesión(es) rechazadas por el servidor (demasiado grandes o inválidas)`].filter(Boolean).join(" · ") || undefined}>
          <Button variant="secondary" size="sm" onClick={() => syncNow()} disabled={sync.syncing}>
            <RefreshCw className={sync.syncing ? "animate-spin" : ""} />
            {sync.pending} · Sincronizar
          </Button>
        </Row>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow px-1">Audio</h2>
        <Card className="gap-0 px-4 py-2">
          <Row
            title="Latencia"
            detail={
              <>
                {s.latencyMs} ms {s.latencyCalibrated ? "· calibrada" : "· sin calibrar (estimada)"}. Recalibra si cambias de audífonos o altavoz.
              </>
            }
          >
            <Timer className="size-5 text-muted-foreground" />
          </Row>
          <div className="grid gap-2 pb-3 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => calibrate("loopback")} disabled={!!calibrating}>
              {calibrating === "loopback" ? "Escuchando clics…" : "Automática (con altavoz)"}
            </Button>
            <Button variant="secondary" onClick={() => calibrate("pluck")} disabled={!!calibrating}>
              {calibrating === "pluck" ? `Toca con cada clic… (${plucks})` : "Tocando junto al clic"}
            </Button>
          </div>
          {calibrating === "pluck" && <p className="pb-3 text-xs text-muted-foreground">Escucharás 4 clics de cuenta y luego 8 más: toca una cuerda al aire exactamente con cada uno.</p>}
          <Row title="Volumen del metrónomo">
            <Slider className="w-40" min={0} max={1} step={0.05} value={[s.metronomeVolume]} onValueChange={([v]) => setSettings({ metronomeVolume: v })} />
          </Row>
          <Row title="Compases de cuenta" detail="Antes de empezar a evaluar">
            <ToggleGroup type="single" variant="outline" size="sm" value={String(s.countInBars)} onValueChange={(v) => v && setSettings({ countInBars: Number(v) })}>
              <ToggleGroupItem value="1">1</ToggleGroupItem>
              <ToggleGroupItem value="2">2</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row title="Indicaciones por voz">
            <Switch checked={s.voice} onCheckedChange={(v) => setSettings({ voice: v })} />
          </Row>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow px-1">Cámara</h2>
        <Card className="gap-0 px-4 py-2">
          <Row title="Guardar video de las sesiones" detail="Si lo apagas solo se guarda el audio y algunos fotogramas.">
            <Switch checked={s.saveVideo} onCheckedChange={(v) => setSettings({ saveVideo: v })} />
          </Row>
          <Row title="Calibración del mástil" detail={s.calibration ? `Hecha el ${new Date(s.calibration.date).toLocaleDateString()}` : "Necesaria para revisar el pulgar izquierdo"}>
            <Button asChild variant="secondary" size="sm">
              <Link href="/calibrar?volver=/ajustes">
                <Crosshair /> Calibrar
              </Link>
            </Button>
          </Row>
          <Row title="Usar este teléfono como 2ª cámara" detail="Ábrelo en el iPhone mientras practicas en la laptop.">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/camara-remota?sala=${s.remoteRoom}`}>
                <Smartphone /> Abrir
              </Link>
            </Button>
          </Row>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow px-1">Sin conexión y almacenamiento</h2>
        <Card className="gap-0 px-4 py-2">
          <Row title="Preparar para usar sin conexión" detail="Descarga la detección de postura (≈ 43 MB) y las lecciones.">
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const t = toast.loading("Descargando…");
                const n = await prefetchVisionAssets();
                await syncNow();
                toast.success(n >= 4 ? "Listo para usar sin conexión" : "Descarga incompleta: conéctate a tu servidor", { id: t });
                void refreshStorage();
              }}
            >
              <Download /> Preparar
            </Button>
          </Row>
          {storage && (
            <Row
              title="Espacio usado"
              detail={`${mb(storage.usage)} de ${mb(storage.quota)} · grabaciones en este dispositivo: ${mb(storage.local)} · ${storage.persisted ? "almacenamiento persistente ✓" : "el navegador podría borrar datos si falta espacio"}`}
            >
              <HardDrive className="size-5 text-muted-foreground" />
            </Row>
          )}
          <Row title="Borrar grabaciones ya enviadas" detail={`Se borran solas a los ${s.keepMediaDays} días. Siguen en tu laptop.`}>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const n = await freeUploadedMedia();
                toast.success(`${n} archivo(s) borrados de este dispositivo`);
                void refreshStorage();
              }}
            >
              <Trash2 /> Liberar
            </Button>
          </Row>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="eyebrow px-1">General</h2>
        <Card className="gap-0 px-4 py-2">
          <Row title="Tema">
            <ToggleGroup type="single" variant="outline" size="sm" value={s.theme} onValueChange={(v) => v && setSettings({ theme: v as Theme })}>
              <ToggleGroupItem value="dark">Oscuro</ToggleGroupItem>
              <ToggleGroupItem value="light">Claro</ToggleGroupItem>
              <ToggleGroupItem value="system">Sistema</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row title="Nombre de este dispositivo" detail="Aparece en los informes para tu instructor">
            <Input className="w-40" value={s.deviceName} placeholder="iPhone, laptop…" onChange={(e) => setSettings({ deviceName: e.target.value.slice(0, 40) })} />
          </Row>
        </Card>
        {qr && (
          <Card className="flex-row items-center gap-4 p-4">
            <img src={qr} alt="QR de esta app" className="size-24 rounded-lg bg-white p-1" />
            <p className="text-xs text-muted-foreground">
              Abre la app en otro dispositivo de tu tailnet escaneando este código. En el iPhone: <b>Compartir → Añadir a pantalla de inicio</b> para usarla sin conexión.
            </p>
          </Card>
        )}
      </section>
      <p className="pb-4 text-center text-[11px] text-muted-foreground">guitar-coach 0.1 · tus datos se quedan en tu red</p>
    </div>
  );
}
