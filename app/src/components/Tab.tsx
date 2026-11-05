import { useEffect, useRef, useState } from "react";
import type { ParsedMusic } from "@guitar-coach/core";

interface TabProps {
  music: ParsedMusic;
  fingers?: (string | undefined)[];
  /** Event index to highlight. */
  cursor?: number;
  /** Per event index: "hit" | "miss" | "now" */
  states?: (string | undefined)[];
  /** Pixels per quarter note at minimum. */
  minQuarter?: number;
  className?: string;
  background?: string;
}

const GAP = 10;
const TOP = 8;
const LEFT = 22;
const RIGHT = 6;

/** Guitar tablature that wraps into systems of whole bars to fit its container. */
export function Tab({ music, fingers, cursor, states, minQuarter = 34, className, background }: TabProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const barLen = (music.timeSignature[0] * 4) / music.timeSignature[1];
  const bars = Math.max(1, music.bars);
  const usable = width - LEFT - RIGHT;
  const perSystem = Math.max(1, Math.min(bars, Math.floor(usable / (barLen * minQuarter))));
  const systems: number[][] = [];
  for (let b = 0; b < bars; b += perSystem) systems.push(Array.from({ length: Math.min(perSystem, bars - b) }, (_, i) => b + i));
  const hasFingers = !!fingers?.some(Boolean);
  const H = TOP + GAP * 5 + (hasFingers ? 24 : 10);

  return (
    <div ref={ref} className={className} style={background ? ({ "--tab-bg": background } as React.CSSProperties) : undefined}>
      {systems.map((sys, si) => {
        const first = sys[0]!;
        const startQ = music.events.find((e) => e.bar === first)?.start ?? first * barLen;
        const sysLen = sys.length * barLen;
        const x = (q: number) => LEFT + ((q - startQ) / sysLen) * usable;
        const evs = music.events.filter((e) => sys.includes(e.bar));
        return (
          <svg key={si} viewBox={`0 0 ${width} ${H}`} width="100%" height={H} className="block overflow-visible" role="img" aria-label="Tablatura">
            {cursor !== undefined &&
              evs
                .filter((e) => e.index === cursor)
                .map((e) => {
                  const w = Math.max(14, (e.duration / sysLen) * usable - 3);
                  return <rect key="cur" className="tab-cur" x={x(e.start) + 1.5} y={TOP - 6} width={w} height={GAP * 5 + (hasFingers ? 30 : 12)} rx={6} />;
                })}
            {["T", "A", "B"].map((c, i) => (
              <text key={c} className="tab-clef" x={9} y={TOP + GAP * (1.15 + i * 1.35)}>
                {c}
              </text>
            ))}
            {Array.from({ length: 6 }, (_, i) => (
              <line key={i} className="tab-line" x1={LEFT - 6} x2={width - RIGHT} y1={TOP + i * GAP} y2={TOP + i * GAP} />
            ))}
            {Array.from({ length: sys.length + 1 }, (_, b) => {
              const bx = b === 0 ? LEFT - 6 : LEFT + (usable * b) / sys.length - 2;
              return <line key={b} className="tab-bar" x1={bx} x2={bx} y1={TOP} y2={TOP + GAP * 5} />;
            })}
            {evs.map((e) => {
              const cx = x(e.start) + Math.min(12, ((e.duration / sysLen) * usable) / 2);
              const st = states?.[e.index] ?? (e.index === cursor ? "now" : "");
              if (e.rest) return <text key={e.index} className="tab-f" x={cx} y={TOP + GAP * 2.7}>·</text>;
              return (
                <g key={e.index}>
                  {e.notes.map((n) => {
                    const y = TOP + (n.string - 1) * GAP;
                    const wide = n.fret >= 10;
                    return (
                      <g key={n.string}>
                        <rect className="tab-knock" x={cx - (wide ? 8 : 5.5)} y={y - 6} width={wide ? 16 : 11} height={12} />
                        <text className={`tab-n ${st}`} x={cx} y={y + 4}>
                          {n.fret}
                        </text>
                      </g>
                    );
                  })}
                  {hasFingers && fingers?.[e.index] && (
                    <text className={`tab-f ${st}`} x={cx} y={TOP + GAP * 5 + 17}>
                      {fingers[e.index]}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        );
      })}
    </div>
  );
}
