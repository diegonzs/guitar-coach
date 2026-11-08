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
  /** Like `pos`, but also negative just before the first beat (approach rings only). */
  const ahead = ph ? ph.pos : null;
  // judgements from another rep must not colour this one's trails
  const liveStates = ph && statesRep !== undefined && ph.rep !== statesRep ? undefined : states;

  const barLen = (music.timeSignature[0] * 4) / music.timeSignature[1];
  const bars = Math.max(1, music.bars);
  const usable = width - LEFT - RIGHT;
  const perSystem = Math.max(1, Math.min(bars, Math.floor(usable / (barLen * minQuarter))));
  const systems: number[][] = [];
  for (let b = 0; b < bars; b += perSystem) systems.push(Array.from({ length: Math.min(perSystem, bars - b) }, (_, i) => b + i));
  const hasFingers = !!fingers?.some(Boolean);
  const playable = music.events.filter((e) => !e.rest);
  /**
   * How long each note keeps sounding (quarter position where its trail ends): until
   * the same string is plucked again or the bar ends, whichever is first. That's how
   * fingerstyle sounds: a bass note rings under the melody, arpeggios let ring.
   */
  const ringEnd = (() => {
    const m = new Map<string, number>();
    for (const e of playable) {
      const barEnd = Math.min(music.length, music.events.find((o) => o.bar === e.bar + 1)?.start ?? (e.bar + 1) * barLen);
      for (const n of e.notes) {
        const again = playable.find((o) => o.start > e.start && o.notes.some((x) => x.string === n.string));
        m.set(`${e.index}:${n.string}`, Math.max(e.start + e.duration, Math.min(barEnd, again?.start ?? Infinity)));
      }
    }
    return m;
  })();
  const hasLabels = !!labels?.some(Boolean);
  const LABEL_Y = TOP + GAP * 5 + (hasFingers ? 33 : 16);
  const H = TOP + GAP * 5 + (hasFingers ? 24 : 10) + (hasLabels ? 16 : 0);

  return (
    <div ref={ref} className={className} style={background ? ({ "--tab-bg": background } as React.CSSProperties) : undefined}>
      {systems.map((sys, si) => {
        const first = sys[0]!;
        const startQ = music.events.find((e) => e.bar === first)?.start ?? first * barLen;
        const sysLen = sys.length * barLen;
        const evs = music.events.filter((e) => sys.includes(e.bar));
        // Numbers sit a bit to the right of their beat so they don't touch the bar line.
        // Use ONE constant offset per system so that time → x is a single linear map:
        // the playhead crosses each number exactly when it should be played and the
        // trail heads move at the playhead's speed.
        const qpx = usable / sysLen;
        const minDur = Math.min(...evs.map((e) => e.duration), barLen);
        const off = Math.min(12, (minDur * qpx) / 2);
        const x = (q: number) => LEFT + (q - startQ) * qpx + off;
        const lead = (e: (typeof evs)[number]) => {
          // the approach ring starts when the previous note is played (max one beat ahead)
          const i = playable.findIndex((p) => p.index === e.index);
          const prev = playable[(i - 1 + playable.length) % playable.length]!;
          const gap = prev === e ? music.length : (e.start - prev.start + music.length) % music.length || music.length;
          return Math.min(1, gap);
        };
        return (
          <svg key={si} viewBox={`0 0 ${width} ${H}`} width="100%" height={H} className="block overflow-visible" role="img" aria-label="Tablatura">
            {cursor !== undefined &&
              !playhead &&
              evs
                .filter((e) => e.index === cursor)
                .map((e) => {
                  const w = Math.max(14, e.duration * qpx - 3);
                  return <rect key="cur" className="tab-cur" x={x(e.start) - off + 1.5} y={TOP - 6} width={w} height={GAP * 5 + (hasFingers ? 30 : 12)} rx={6} />;
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
            {pos !== null &&
              evs.map((e) => {
                if (e.rest || e.start > pos + 0.001) return null;
                const from = x(e.start);
                const st = liveStates?.[e.index] ?? "pending";
                return (
                  <g key={`t${e.index}`} className={`tab-trail ${st}`}>
                    {e.notes.map((n) => {
                      const y = TOP + (n.string - 1) * GAP;
                      const stop = Math.max(from + 4, x(ringEnd.get(`${e.index}:${n.string}`) ?? e.start + e.duration) - 7);
                      const head = Math.min(x(pos), stop);
                      const ringing = x(pos) < stop;
                      return (
                        <g key={n.string}>
                          <line x1={from} x2={head} y1={y} y2={y} />
                          {ringing && <circle className="tab-head" cx={head} cy={y} r={3.6} />}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            {ahead !== null &&
              evs.map((e) => {
                if (e.rest) return null;
                // time until this note (also the first notes of the next repetition)
                let until = e.start - ahead;
                if (until < -0.5) until += music.length;
                const L = lead(e);
                const hitFlash = until <= 0 && until > -0.18;
                if (!(until > 0 && until <= L) && !hitFlash) return null;
                const k = until > 0 ? until / L : 0;
                return (
                  <g key={`a${e.index}`}>
                    {e.notes.map((n) => {
                      const y = TOP + (n.string - 1) * GAP;
                      return hitFlash ? (
                        <circle key={n.string} className="tab-flash" cx={x(e.start)} cy={y} r={7 + (-until / 0.18) * 9} style={{ opacity: 1 + until / 0.18 }} />
                      ) : (
                        <circle key={n.string} className="tab-approach" cx={x(e.start)} cy={y} r={7 + 13 * k} style={{ opacity: 0.35 + 0.65 * (1 - k) }} />
                      );
                    })}
                  </g>
                );
              })}
            {pos !== null && pos >= startQ - 0.001 && pos < startQ + sysLen && (
              <g className="tab-ph">
                <line x1={x(pos)} x2={x(pos)} y1={TOP - 6} y2={TOP + GAP * 5 + 6} />
                <path d={`M ${x(pos) - 4} ${TOP - 10} L ${x(pos) + 4} ${TOP - 10} L ${x(pos)} ${TOP - 5} Z`} />
              </g>
            )}
            {evs.map((e) => {
              const cx = x(e.start);
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
