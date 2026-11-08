/**
 * Parser for the subset of alphaTex (https://alphatab.net/docs/alphatex/introduction)
 * that guitar-coach lessons use. Any file accepted here is also valid alphaTex, so
 * other tools (alphaTab, Guitar Pro importers…) can render the same exercises.
 *
 * Supported:
 *   metadata   \title "…"  \subtitle "…"  \artist "…"  \tempo 60  \ts 3 4   (optional "." separator)
 *   durations  :1 :2 :4 :8 :16 :32   (sticky default) or per beat  0.5.8
 *   notes      fret.string            e.g. 0.5 (open A string), 2.3 (2nd fret, G string)
 *   chords     (0.5 2.3 1.2)          optional duration: (0.5 2.3).4
 *   rests      r   r.4
 *   repeat     beat*N                 e.g. 0.1*4
 *   effects    {d} dotted, {tu 3} triplet, {lr} let ring (note effect: 0.5{lr}, (0.5{lr} 2.3{lr}), 0.5{lr}.4);
 *              articulation effects (h, p, sl, v, lf, rf, nh…) are accepted and ignored
 *   voices     \voice before EACH voice (also the first): voices run in parallel, e.g. a melody
 *              in eighths and a bass in dotted halves. Beats starting together are merged into
 *              one event; every note keeps its own length in `sustain`.
 *   bars       |
 *   comments   // line   /* block *\/
 */
import { fretToMidi, MAX_FRET } from "./music.ts";

export interface MusicNote {
  string: number;
  fret: number;
  midi: number;
  /**
   * How long the note should keep sounding, in quarter notes: its written length (from
   * its own voice), or until the end of the bar with {lr}; always cut when the same
   * string is plucked again.
   */
  sustain?: number;
  /** Written with {lr} (let ring). */
  letRing?: boolean;
}

export interface MusicEvent {
  /** Index of the event in the exercise (0-based). */
  index: number;
  /** Bar number (0-based). */
  bar: number;
  /** Start position measured in quarter notes from the beginning. */
  start: number;
  /** Time until the next event (or the end), in quarter notes. Per-note lengths are in `notes[].sustain`. */
  duration: number;
  notes: MusicNote[];
  rest: boolean;
}

export interface ParsedMusic {
  title?: string;
  tempo?: number;
  timeSignature: [number, number];
  events: MusicEvent[];
  bars: number;
  /** Total length in quarter notes. */
  length: number;
  /** Number of voices (1 unless \voice is used). */
  voices: number;
}

export interface TexIssue {
  level: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

export class AlphaTexError extends Error {
  constructor(public issues: TexIssue[]) {
    super(issues.map((i) => `${i.line}:${i.column} ${i.message}`).join("\n"));
  }
}

const VALID_DURATIONS = new Set([1, 2, 4, 8, 16, 32, 64]);
const IGNORED_EFFECTS = new Set([
  "h", "p", "sl", "ss", "v", "vw", "lf", "rf", "nh", "ah", "th", "ph", "sh", "fh",
  "g", "gr", "ac", "hac", "pm", "st", "lr", "tr", "x", "t", "su", "sd", "f", "fo", "cre", "dec", "txt",
  "dy", "tt", "sib",
]);
const KNOWN_META = new Set(["title", "subtitle", "artist", "album", "words", "music", "copyright", "tempo", "ts", "tuning", "instrument", "capo", "tab", "track", "staff", "voice"]);

type Tok =
  | { t: "meta"; v: string; line: number; col: number }
  | { t: "str"; v: string; line: number; col: number }
  | { t: "num"; v: number; line: number; col: number }
  | { t: "word"; v: string; line: number; col: number }
  | { t: "sym"; v: string; line: number; col: number };

function tokenize(src: string, issues: TexIssue[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const adv = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === "\n") {
        line++;
        col = 1;
      } else col++;
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n" || c === " " || c === "\t" || c === "\r") {
      adv();
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") adv();
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      adv(2);
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) adv();
      adv(2);
      continue;
    }
    const sl = line;
    const sc = col;
    if (c === "\\") {
      adv();
      let w = "";
      while (i < src.length && /[A-Za-z]/.test(src[i]!)) {
        w += src[i];
        adv();
      }
      toks.push({ t: "meta", v: w.toLowerCase(), line: sl, col: sc });
      continue;
    }
    if (c === '"' || c === "'") {
      adv();
      let s = "";
      while (i < src.length && src[i] !== c) {
        s += src[i];
        adv();
      }
      if (src[i] !== c) issues.push({ level: "error", message: "Texto sin cerrar (falta comilla)", line: sl, column: sc });
      adv();
      toks.push({ t: "str", v: s, line: sl, col: sc });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let s = c;
      adv();
      while (i < src.length && /[0-9]/.test(src[i]!)) {
        s += src[i];
        adv();
      }
      toks.push({ t: "num", v: Number(s), line: sl, col: sc });
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let w = "";
      while (i < src.length && /[A-Za-z]/.test(src[i]!)) {
        w += src[i];
        adv();
      }
      toks.push({ t: "word", v: w, line: sl, col: sc });
      continue;
    }
    if ("|.:(){}*".includes(c)) {
      toks.push({ t: "sym", v: c, line: sl, col: sc });
      adv();
      continue;
    }
    issues.push({ level: "error", message: `Carácter inesperado "${c}"`, line: sl, column: sc });
    adv();
  }
  return toks;
}

export function parseAlphaTex(src: string): { music: ParsedMusic; issues: TexIssue[] } {
  const issues: TexIssue[] = [];
  const toks = tokenize(src, issues);
  let p = 0;
  const peek = () => toks[p];
  const err = (tok: Tok | undefined, message: string, level: "error" | "warning" = "error") =>
    issues.push({ level, message, line: tok?.line ?? 0, column: tok?.col ?? 0 });

  const music: ParsedMusic = { timeSignature: [4, 4], events: [], bars: 0, length: 0, voices: 1 };
  let multiVoice = false;

  // ---- metadata ----
  const META_NUM_ARGS: Record<string, number> = { tempo: 1, ts: 2, capo: 1 };
  while (peek()?.t === "meta") {
    const m = toks[p++] as Extract<Tok, { t: "meta" }>;
    if (m.v === "voice") {
      // first voice starts: the body begins here
      multiVoice = true;
      break;
    }
    const args: Tok[] = [];
    const nNum = META_NUM_ARGS[m.v];
    if (nNum !== undefined) {
      for (let k = 0; k < nNum && peek()?.t === "num"; k++) args.push(toks[p++]!);
    } else {
      while (peek() && (peek()!.t === "str" || peek()!.t === "word")) args.push(toks[p++]!);
    }
    if (!KNOWN_META.has(m.v)) err(m, `Metadato desconocido \\${m.v}`, "warning");
    if (m.v === "title" && args[0]?.t === "str") music.title = args[0].v;
    if (m.v === "tempo") {
      if (args[0]?.t !== "num" || args[0].v < 20 || args[0].v > 300) err(m, "\\tempo necesita un número entre 20 y 300");
      else music.tempo = args[0].v;
    }
    if (m.v === "ts") {
      const n = args[0];
      const d = args[1];
      if (n?.t !== "num" || d?.t !== "num" || n.v < 1 || n.v > 16 || !VALID_DURATIONS.has(d.v)) err(m, "\\ts necesita dos números, p. ej. \\ts 3 4");
      else music.timeSignature = [n.v, d.v];
    }
    if (m.v === "tuning" && args.length) err(m, "Solo se admite afinación estándar; \\tuning se ignora", "warning");
    if (m.v === "capo") err(m, "\\capo no se admite todavía; se ignora", "warning");
  }

  function isNoteStart(): boolean {
    const a = toks[p];
    const b = toks[p + 1];
    const c = toks[p + 2];
    return a?.t === "num" && b?.t === "sym" && b.v === "." && c?.t === "num";
  }

  if (peek()?.t === "sym" && peek()!.v === ".") p++; // optional metadata separator

  // ---- body ----
  interface RawBeat {
    voice: number;
    bar: number;
    start: number;
    dur: number;
    notes: MusicNote[];
    rest: boolean;
  }
  const raw: RawBeat[] = [];
  /** Start of every bar, per voice (plus the end), to know where a let-ring note stops. */
  const barStarts: number[][] = [[0]];
  let voice = 0;
  let maxBars = 0;
  let maxPos = 0;
  let defaultDur = 4;
  let pos = 0;
  let bar = 0;
  let barStart = 0;
  const barLen = () => (music.timeSignature[0] * 4) / music.timeSignature[1];

  const readDuration = (): number | undefined => {
    // ".N" after a beat
    if (peek()?.t === "sym" && peek()!.v === "." && toks[p + 1]?.t === "num") {
      p++;
      const d = toks[p++] as Extract<Tok, { t: "num" }>;
      if (!VALID_DURATIONS.has(d.v)) err(d, `Duración inválida ${d.v} (usa 1, 2, 4, 8, 16 o 32)`);
      return d.v;
    }
    return undefined;
  };

  const readNote = (): MusicNote | undefined => {
    const f = toks[p];
    if (f?.t === "word" && f.v === "x") {
      err(f, "Las notas muertas (x) no se pueden evaluar; usa un traste", "error");
      p++;
      return undefined;
    }
    if (f?.t !== "num") {
      err(f, "Se esperaba una nota con formato traste.cuerda (p. ej. 2.3)");
      p++;
      return undefined;
    }
    p++;
    const dot = toks[p];
    const s = toks[p + 1];
    if (dot?.t !== "sym" || dot.v !== "." || s?.t !== "num") {
      err(f, "Se esperaba traste.cuerda (p. ej. 2.3)");
      return undefined;
    }
    p += 2;
    if (s.v < 1 || s.v > 6) {
      err(s, `Cuerda ${s.v} fuera de rango (1–6)`);
      return undefined;
    }
    if (f.v < 0 || f.v > MAX_FRET) {
      err(f, `Traste ${f.v} fuera de rango (0–${MAX_FRET})`);
      return undefined;
    }
    return { string: s.v, fret: f.v, midi: fretToMidi(s.v, f.v) };
  };

  const readBeatEffects = (): { dotted: boolean; tuplet?: number; letRing?: boolean } => {
    const out: { dotted: boolean; tuplet?: number; letRing?: boolean } = { dotted: false };
    while (peek()?.t === "sym" && peek()!.v === "{") {
      const open = toks[p++]!;
      while (peek() && !(peek()!.t === "sym" && peek()!.v === "}")) {
        const e = toks[p++]!;
        if (e.t === "word") {
          if (e.v === "d") out.dotted = true;
          else if (e.v === "lr") out.letRing = true;
          else if (e.v === "tu") {
            const n = toks[p];
            if (n?.t === "num" && (n.v === 3 || n.v === 5 || n.v === 6 || n.v === 7)) {
              out.tuplet = n.v;
              p++;
            } else err(e, "{tu N} necesita 3, 5, 6 o 7");
          } else if (!IGNORED_EFFECTS.has(e.v)) err(e, `Efecto desconocido "${e.v}" (se ignora)`, "warning");
        }
      }
      if (!peek()) err(open, "Falta cerrar }");
      else p++;
    }
    return out;
  };

  const pushBeat = (notes: MusicNote[], rest: boolean, dur: number, fx: { dotted: boolean; tuplet?: number }, tok: Tok) => {
    let q = 4 / dur;
    if (fx.dotted) q *= 1.5;
    if (fx.tuplet) q *= (fx.tuplet === 3 ? 2 : fx.tuplet === 6 ? 4 : 4) / fx.tuplet;
    let times = 1;
    if (peek()?.t === "sym" && peek()!.v === "*") {
      p++;
      const n = toks[p];
      if (n?.t === "num" && n.v >= 1 && n.v <= 64) {
        times = n.v;
        p++;
      } else err(tok, "Repetición inválida: usa beat*N con N entre 1 y 64");
    }
    for (let k = 0; k < times; k++) {
      raw.push({ voice, bar, start: round(pos), dur: round(q), notes: notes.map((n) => ({ ...n })), rest });
      pos += q;
    }
  };

  while (p < toks.length) {
    const tok = toks[p]!;
    if (tok.t === "sym" && tok.v === "|") {
      p++;
      checkBar(tok);
      continue;
    }
    if (tok.t === "sym" && tok.v === ":") {
      p++;
      const d = toks[p];
      if (d?.t === "num" && VALID_DURATIONS.has(d.v)) {
        defaultDur = d.v;
        p++;
      } else err(tok, "Después de : va una duración (1, 2, 4, 8, 16 o 32)");
      continue;
    }
    if (tok.t === "sym" && tok.v === "(") {
      p++;
      const notes: MusicNote[] = [];
      while (peek() && !(peek()!.t === "sym" && peek()!.v === ")")) {
        if (peek()!.t === "sym" && peek()!.v === "{") {
          // note-level effects inside chord
          const fx = readBeatEffects();
          if (fx.letRing && notes.length) notes[notes.length - 1]!.letRing = true;
          continue;
        }
        const n = readNote();
        if (n) notes.push(n);
      }
      if (!peek()) {
        err(tok, "Falta cerrar el acorde con )");
        break;
      }
      p++;
      const strings = new Set(notes.map((n) => n.string));
      if (strings.size !== notes.length) err(tok, "Un acorde no puede tener dos notas en la misma cuerda");
      if (!notes.length) err(tok, "Acorde vacío");
      const dur = readDuration() ?? defaultDur;
      const fx = readBeatEffects();
      if (fx.letRing) for (const n of notes) n.letRing = true;
      pushBeat(notes, false, dur, fx, tok);
      continue;
    }
    if (tok.t === "word" && tok.v === "r") {
      p++;
      const dur = readDuration() ?? defaultDur;
      const fx = readBeatEffects();
      pushBeat([], true, dur, fx, tok);
      continue;
    }
    if (tok.t === "num" || (tok.t === "word" && tok.v === "x")) {
      const n = readNote();
      // note effects (0.5{lr}.4), then duration, then beat effects (0.5.4{d})
      const nfx = readBeatEffects();
      const dur = readDuration() ?? defaultDur;
      const bfx = readBeatEffects();
      const fx = { dotted: nfx.dotted || bfx.dotted, tuplet: bfx.tuplet ?? nfx.tuplet, letRing: nfx.letRing || bfx.letRing };
      if (n && fx.letRing) n.letRing = true;
      if (n) pushBeat([n], false, dur, fx, tok);
      continue;
    }
    if (tok.t === "meta" && tok.v === "voice") {
      p++;
      if (!multiVoice) {
        err(tok, "Para usar varias voces escribe \\voice también antes de la primera voz (si no, alphaTab lo lee como compases nuevos)");
        multiVoice = true;
      }
      endVoice();
      voice++;
      barStarts.push([0]);
      pos = 0;
      bar = 0;
      barStart = 0;
      continue;
    }
    if (tok.t === "meta") {
      err(tok, "Los metadatos (\\…) van al principio, antes de las notas");
      p++;
      while (peek() && (peek()!.t === "num" || peek()!.t === "str") && !isNoteStart()) p++;
      continue;
    }
    err(tok, `No se entiende "${"v" in tok ? tok.v : ""}"`);
    p++;
  }
  endVoice();

  function endVoice() {
    if (round(pos) > round(barStart)) checkBar(undefined, true);
    maxBars = Math.max(maxBars, bar);
    maxPos = Math.max(maxPos, round(pos));
  }

  function checkBar(tok: Tok | undefined, last = false) {
    const len = round(pos - barStart);
    const expected = barLen();
    if (Math.abs(len - expected) > 1e-6) {
      const isPickupOrLast = last || bar === 0;
      if (len > expected + 1e-6) err(tok ?? toks[toks.length - 1], `El compás ${bar + 1} dura ${fmt(len)} negras pero el compás es de ${fmt(expected)}`);
      else if (!isPickupOrLast) err(tok, `El compás ${bar + 1} está incompleto (${fmt(len)} de ${fmt(expected)} negras)`, "warning");
    }
    bar++;
    barStart = pos;
    barStarts[voice]!.push(round(pos));
  }

  music.bars = maxBars;
  music.length = maxPos;
  music.voices = voice + 1;
  mergeVoices();

  /** Beats that start together (in any voice) become one event; each note keeps its own length. */
  function mergeVoices() {
    const groups = new Map<number, RawBeat[]>();
    for (const b of raw) groups.set(b.start, [...(groups.get(b.start) ?? []), b]);
    const starts = [...groups.keys()].sort((a, b) => a - b);
    for (const start of starts) {
      const g = groups.get(start)!;
      const sounding = g.filter((b) => !b.rest);
      // a rest only counts in the first voice; rests in other voices just fill time
      if (!sounding.length && !g.some((b) => b.voice === 0)) continue;
      const notes: MusicNote[] = [];
      for (const b of sounding)
        for (const n of b.notes) {
          if (notes.some((x) => x.string === n.string)) err(undefined, `Dos voces tocan la cuerda ${n.string} a la vez (pulso ${fmt(start)} del ejercicio)`);
          else {
            const vb = barStarts[b.voice]!;
            const barEnd = vb[b.bar + 1] ?? Math.max(maxPos, b.start + b.dur);
            notes.push({ ...n, sustain: n.letRing ? round(Math.max(b.dur, barEnd - b.start)) : b.dur });
          }
        }
      music.events.push({ index: music.events.length, bar: Math.min(...g.map((b) => b.bar)), start, duration: 0, notes, rest: !notes.length });
    }
    music.events.forEach((e, i) => {
      const next = music.events[i + 1];
      const end = Math.max(...(groups.get(e.start) ?? []).map((b) => b.start + b.dur));
      e.duration = round((next ? next.start : end) - e.start);
      // a string stops ringing when it is plucked again
      for (const n of e.notes) {
        const again = music.events.find((o) => o.start > e.start && o.notes.some((x) => x.string === n.string));
        if (again && n.sustain !== undefined) n.sustain = round(Math.min(n.sustain, again.start - e.start));
      }
    });
  }
  if (!music.events.length) issues.push({ level: "error", message: "El ejercicio no tiene notas", line: 1, column: 1 });
  else if (music.events.every((e) => e.rest)) issues.push({ level: "error", message: "El ejercicio solo tiene silencios", line: 1, column: 1 });
  return { music, issues };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/** Throws AlphaTexError when there are errors. */
export function parseAlphaTexStrict(src: string): ParsedMusic {
  const { music, issues } = parseAlphaTex(src);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new AlphaTexError(errors);
  return music;
}
