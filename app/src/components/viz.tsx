/** Small hand-rolled SVG charts (no chart library: keeps the PWA light and offline). */
import { cn } from "@/lib/utils";

export function Ring({ value, size = 58, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={label ?? `${Math.round(v * 100)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dy="0.35em" textAnchor="middle" className="fill-foreground font-mono text-[11px] font-semibold">
        {label ?? `${Math.round(v * 100)}%`}
      </text>
    </svg>
  );
}

export function Beats({ count, active, className }: { count: number; active: number; className?: string }) {
  return (
    <div className={cn("flex gap-1.5", className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={cn("size-2.5 rounded-full bg-foreground/20 transition-colors", i === active && "bg-primary ring-4 ring-primary/30", i === 0 && i !== active && "bg-foreground/35")}
        />
      ))}
    </div>
  );
}

export function LineChart({ points, target, height = 110, yMin, yMax, labels }: { points: { x: string; y: number }[]; target?: number; height?: number; yMin?: number; yMax?: number; labels?: [string, string] }) {
  const W = 300;
  const H = height;
  const pl = 26;
  const pb = 16;
  if (!points.length) return <div className="grid h-24 place-items-center text-xs text-muted-foreground">Sin datos todavía</div>;
  const ys = points.map((p) => p.y).concat(target ?? []);
  const lo = yMin ?? Math.floor((Math.min(...ys) - 5) / 10) * 10;
  const hi = yMax ?? Math.ceil((Math.max(...ys) + 5) / 10) * 10;
  const y = (v: number) => 8 + (H - pb - 8) * (1 - (v - lo) / Math.max(1, hi - lo));
  const x = (i: number) => (points.length === 1 ? (pl + W) / 2 : pl + ((W - pl - 6) * i) / (points.length - 1));
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const path = points.map((p, i) => `${x(i)},${y(p.y)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pl} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" />
          <text x={0} y={y(t) + 3} className="fill-muted-foreground font-mono text-[9px]">
            {t}
          </text>
        </g>
      ))}
      {target !== undefined && (
        <g>
          <line x1={pl} x2={W} y1={y(target)} y2={y(target)} stroke="var(--primary)" strokeDasharray="4 4" opacity={0.7} />
          <text x={W - 2} y={y(target) - 5} textAnchor="end" className="fill-primary text-[9px] font-semibold">
            meta {target}
          </text>
        </g>
      )}
      <polygon points={`${x(0)},${y(lo)} ${path} ${x(points.length - 1)},${y(lo)}`} fill="var(--primary)" opacity={0.12} />
      <polyline points={path} fill="none" stroke="var(--primary)" strokeWidth={2.2} strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.y)} r={i === points.length - 1 ? 4 : 2.2} fill="var(--primary)" stroke="var(--card)" strokeWidth={i === points.length - 1 ? 2 : 0} />
      ))}
      {labels && (
        <>
          <text x={pl} y={H - 2} className="fill-muted-foreground text-[9px]">
            {labels[0]}
          </text>
          <text x={W} y={H - 2} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {labels[1]}
          </text>
        </>
      )}
    </svg>
  );
}

/** Practice minutes per day for the last `weeks` weeks (columns = weeks). */
export function Heatmap({ minutes, weeks = 16, goal = 30 }: { minutes: Map<string, number>; weeks?: number; goal?: number }) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7); // Monday, `weeks` ago
  const cells: { day: string; v: number; future: boolean; today: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    cells.push({ day: key, v: minutes.get(key) ?? 0, future: d > today, today: d.toDateString() === today.toDateString() });
  }
  return (
    <div className="grid grid-flow-col grid-rows-7 justify-between gap-[3px]" style={{ gridAutoColumns: "minmax(0, 12px)" }}>
      {cells.map((c) => (
        <i
          key={c.day}
          title={`${c.day}: ${Math.round(c.v)} min`}
          className={cn("aspect-square rounded-[3px] bg-muted", c.future && "opacity-0", c.today && "ring-1 ring-primary ring-inset")}
          style={c.v > 0 ? { background: `color-mix(in oklch, var(--primary) ${Math.round(30 + 70 * Math.min(1, c.v / goal))}%, var(--muted))` } : undefined}
        />
      ))}
    </div>
  );
}

/** Deviation (ms) per played note: above the line = late, below = early. */
export function TimingBars({ deviations, tolerance = 70, height = 76 }: { deviations: (number | null)[]; tolerance?: number; height?: number }) {
  const W = 300;
  const mid = height / 2;
  const scale = (mid - 6) / Math.max(tolerance * 2, ...deviations.map((d) => Math.abs(d ?? 0)));
  const bw = W / Math.max(1, deviations.length);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <rect x={0} y={mid - tolerance * scale} width={W} height={tolerance * 2 * scale} fill="var(--success)" opacity={0.1} />
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
      {deviations.map((d, i) =>
        d === null ? (
          <rect key={i} x={i * bw + bw * 0.2} y={mid - 2} width={Math.max(1, bw * 0.6)} height={4} fill="var(--destructive)" />
        ) : (
          <rect
            key={i}
            x={i * bw + bw * 0.15}
            y={d > 0 ? mid - Math.abs(d) * scale : mid}
            width={Math.max(1, bw * 0.7)}
            height={Math.max(1.5, Math.abs(d) * scale)}
            rx={1}
            fill={Math.abs(d) > tolerance ? "var(--warning)" : "var(--success)"}
          />
        ),
      )}
      <text x={2} y={10} className="fill-muted-foreground text-[9px]">
        tarde
      </text>
      <text x={2} y={height - 3} className="fill-muted-foreground text-[9px]">
        antes
      </text>
    </svg>
  );
}

export function StatTile({ value, label, tone, className }: { value: React.ReactNode; label: string; tone?: "success" | "primary" | "warning" | "destructive"; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card px-3 py-2.5", className)}>
      <div
        className={cn(
          "font-mono text-xl font-semibold tracking-tight tnum",
          tone === "success" && "text-success",
          tone === "primary" && "text-primary",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Horizontal early/late meter. */
export function TimingMeter({ ms, tolerance = 70 }: { ms: number | null; tolerance?: number }) {
  const range = Math.max(150, tolerance * 2.5);
  const pos = ms === null ? 50 : 50 + Math.max(-1, Math.min(1, ms / range)) * 48;
  const zone = (tolerance / range) * 48;
  return (
    <div className="relative h-2.5 rounded-full bg-gradient-to-r from-warning/45 via-muted to-warning/45">
      <span className="absolute inset-y-0 rounded-full bg-success/40" style={{ left: `${50 - zone}%`, width: `${zone * 2}%` }} />
      {ms !== null && <span className="absolute -top-1.5 h-5 w-1 -translate-x-1/2 rounded bg-foreground shadow-[0_0_0_3px_var(--background)] transition-[left] duration-300" style={{ left: `${pos}%` }} />}
    </div>
  );
}
