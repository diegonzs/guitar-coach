import { CloudOff, RefreshCw, Check } from "lucide-react";
import { useSync, syncNow } from "@/lib/sync";
import { cn } from "@/lib/utils";

export function SyncBadge({ className }: { className?: string }) {
  const s = useSync();
  const base = "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium whitespace-nowrap";
  if (!s.online)
    return (
      <button onClick={() => syncNow()} className={cn(base, "border-warning/30 bg-warning/15 text-warning", className)} title="Sin conexión con tu servidor">
        <CloudOff className="size-3.5" />
        Sin conexión{s.pending ? ` · ${s.pending}` : ""}
      </button>
    );
  if (s.syncing || s.pending)
    return (
      <button onClick={() => syncNow()} className={cn(base, "border-info/30 bg-info/15 text-info", className)}>
        <RefreshCw className={cn("size-3.5", s.syncing && "animate-spin")} />
        {s.pending ? `Subiendo ${s.pending}` : "Sincronizando"}
      </button>
    );
  return (
    <button onClick={() => syncNow()} className={cn(base, "border-success/30 bg-success/12 text-success", className)} title={s.lastSync ? `Última sincronización ${new Date(s.lastSync).toLocaleTimeString()}` : ""}>
      <Check className="size-3.5" />
      Sincronizado
    </button>
  );
}
