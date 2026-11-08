import { useEffect, useRef, useState } from "react";
import type { ParsedMusic } from "@guitar-coach/core";

/** Where the music is right now: repetition and position in quarter notes inside it. */
export type Playhead = () => { rep: number; pos: number } | null;

interface TabProps {
  music: ParsedMusic;
  fingers?: (string | undefined)[];
  /** Event index to highlight. */
  cursor?: number;
  /** Per event index: "hit" | "off" | "miss" | "now" */
  states?: (string | undefined)[];
  /** Repetition the `states` belong to (only applied while the playhead is in that rep). */
  statesRep?: number;
  /**
   * Live position getter. When set, each note grows a "sustain trail" along its string
   * while it should ring (rhythm-game style), coloured by how it was judged.
   */
  playhead?: Playhead;
  /** Per event index: short text under the note (e.g. "+120" ms, a note name, "?"). */
  labels?: (string | undefined)[];
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
export function Tab({ music, fingers, cursor, states, statesRep, playhead, labels, minQuarter = 34, className, background }: TabProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // animate the playhead at display rate, without re-rendering the parent
  const [ph, setPh] = useState<{ rep: number; pos: number } | null>(null);
  useEffect(() => {
    if (!playhead) return setPh(null);
    let raf = 0;
    const loop = () => {
      const p = playhead();
      setPh((prev) => (p === null ? null : prev && prev.rep === p.rep && Math.abs(prev.pos - p.pos) < 0.004 ? prev : p));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playhead]);
  const pos = ph && ph.pos >= 0 ? ph.pos : null;
  // judgements from another rep must not colour this one's trails
  const liveStates = ph && statesRep !== undefined && ph.rep !== statesRep ? undefined : states;

  const barLen = (music.timeSignature[0] * 4) / music.timeSignature[1];
  const bars = Math.max(1, music.bars);
  const usable = width - LEFT - RIGHT;
  const perSystem = Math.max(1, Math.min(bars, Math.floor(usable / (barLen * minQuarter))));
  const systems: number[][] = [];
  for (let b = 0; b < bars; b += perSystem) systems.push(Array.from({ length: Math.min(perSystem, bars - b) }, (_, i) => b + i));
  const hasFingers = !!fingers?.some(Boolean);
  const hasLabels = !!labels?.some(Boolean);
  const LABEL_Y = TOP + GAP * 5 + (hasFingers ? 33 : 16);
  const H = TOP + GAP * 5 + (hasFingers ? 24 : 10) + (hasLabels ? 16 : 0);

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
              !playhead &&
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
            {pos !== null && pos >= startQ && pos < startQ + sysLen && <line className="tab-ph" x1={x(pos)} x2={x(pos)} y1={TOP - 5} y2={TOP + GAP * 5 + 5} />}
            {pos !== null &&
              evs.map((e) => {
                if (e.rest || e.start > pos + 0.001) return null;
                const cx = x(e.start) + Math.min(12, ((e.duration / sysLen) * usable) / 2);
                const end = Math.max(cx + 4, x(e.start + e.duration) - 5);
                const f = Math.min(1, (pos - e.start) / e.duration);
                const head = cx + (end - cx) * f;
                const st = liveStates?.[e.index] ?? "pending";
                const ringing = f < 1;
                return (
                  <g key={`t${e.index}`} className={`tab-trail ${st}`}>
                    {e.notes.map((n) => {
                      const y = TOP + (n.string - 1) * GAP;
                      return (
                        <g key={n.string}>
                          <line x1={cx} x2={head} y1={y} y2={y} />
                          {ringing && <circle className="tab-head" cx={head} cy={y} r={3.6} />}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            {evs.map((e) => {
              const cx = x(e.start) + Math.min(12, ((e.duration / sysLen) * usable) / 2);
              const active = pos !== null && !e.rest && pos >= e.start - 0.001 && pos < e.start + e.duration;
              const st = liveStates?.[e.index] ?? (active || (!playhead && e.index === cursor) ? "now" : "");
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
                  {labels?.[e.index] && (
                    <text className={`tab-l ${st}`} x={cx} y={LABEL_Y}>
                      {labels[e.index]}
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
