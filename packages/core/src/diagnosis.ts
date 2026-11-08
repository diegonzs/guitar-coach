/**
 * Explains *why* notes were marked wrong, in words a student can act on:
 * early / late / wrong note (open string, neighbouring string, wrong fret) / not heard.
 */
import type { ParsedMusic } from "./alphatex.ts";
import { STANDARD_TUNING } from "./music.ts";
import type { NoteResult } from "./session.ts";

export type Verdict = "ok" | "early" | "late" | "wrong" | "missed";

export interface NoteDiag {
  rep: number;
  event: number;
  verdict: Verdict;
  deviationMs: number | null;
  expected: number[];
  detected: number | null;
  /** Played so far from the beat that it fell outside the matching window. */
  far?: boolean;
  /** The sound heard here was the previous (late) or next (early) note of the exercise. */
  shifted?: boolean;
}

export interface EventDiag {
  event: number;
  /** Most common problem for this note across reps ("ok" if none). */
  verdict: Verdict;
  /** Reps with that verdict / reps played. */
  count: number;
  reps: number;
  /** Short text to print under the note in the tab ("−120", "+90", "Si", "?"). */
  label?: string;
}

export interface DiagIssue {
  kind: "early" | "late" | "uneven" | "wrong" | "chord" | "missed" | "quiet" | "tuning" | "extra" | "good";
  severity: "bad" | "warn" | "good";
  title: string;
  detail: string;
  tip: string;
  /** Event indexes this issue is about. */
  events?: number[];
}

export interface Diagnosis {
  notes: NoteDiag[];
  events: EventDiag[];
  issues: DiagIssue[];
  counts: Record<Verdict, number>;
}

export interface ExtraOnset {
  t: number;
  midi: number | null;
}

/** Spanish note names, the way a student reads them. */
const ES = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
export const noteNameEs = (midi: number) => ES[((Math.round(midi) % 12) + 12) % 12]!;

/** How far from an expected note an unmatched onset may be to still count as "that note, badly timed". */
const FAR_REACH_S = 0.5;
const SEVERITY: Record<Verdict, number> = { missed: 4, wrong: 3, late: 2, early: 2, ok: 0 };

export function noteVerdict(n: NoteResult, toleranceMs: number): Verdict {
  if (n.hit) {
    if (n.deviationMs === null || Math.abs(n.deviationMs) <= toleranceMs) return "ok";
    return n.deviationMs < 0 ? "early" : "late";
  }
  return n.detected !== null || n.deviationMs !== null ? "wrong" : "missed";
}

export function diagnose(music: ParsedMusic, results: NoteResult[], opts: { toleranceMs: number; extraOnsets?: ExtraOnset[] }): Diagnosis {
  const tol = opts.toleranceMs;
  const extras = [...(opts.extraOnsets ?? [])].map((e) => ({ ...e, used: false }));
  const notes: NoteDiag[] = results.map((n) => {
    const d: NoteDiag = { rep: n.rep, event: n.event, verdict: noteVerdict(n, tol), deviationMs: n.deviationMs, expected: n.expected, detected: n.detected };
    if (d.verdict !== "missed") return d;
    // Nothing inside the window, but maybe the student played it much too early/late.
    let best: (typeof extras)[number] | undefined;
    for (const e of extras) if (!e.used && Math.abs(e.t - n.t) <= FAR_REACH_S && (!best || Math.abs(e.t - n.t) < Math.abs(best.t - n.t))) best = e;
    if (!best) return d;
    best.used = true;
    const dev = Math.round((best.t - n.t) * 1000);
    const samePitch = best.midi === null || n.expected.some((m) => m === best!.midi || Math.abs(m - best!.midi!) === 12);
    return { ...d, verdict: samePitch ? (dev < 0 ? "early" : "late") : "wrong", deviationMs: dev, detected: best.midi, far: true };
  });
  const leftoverExtras = extras.filter((e) => !e.used).length;

  // A "wrong" note that is really the neighbouring note of the exercise means the
  // student is a whole note behind (or ahead of) the click, not playing wrong notes.
  const tOf = new Map(notes.map((n, i) => [n, results[i]!.t]));
  const order = [...notes].sort((a, b) => tOf.get(a)! - tOf.get(b)!);
  const same = (a: number, b: number) => a === b || Math.abs(a - b) === 12;
  order.forEach((n, i) => {
    if (n.verdict !== "wrong" || n.far || n.detected === null || n.expected.length !== 1 || n.deviationMs === null) return;
    const heardAt = tOf.get(n)! + n.deviationMs / 1000;
    const prev = order[i - 1];
    const next = order[i + 1];
    const fits = (o: NoteDiag | undefined) => !!o && o.expected.length === 1 && !same(o.expected[0]!, n.expected[0]!) && same(o.expected[0]!, n.detected!);
    if (n.deviationMs >= 0 && fits(prev)) Object.assign(n, { verdict: "late", far: true, shifted: true, deviationMs: Math.round((heardAt - tOf.get(prev!)!) * 1000) });
    else if (n.deviationMs <= 0 && fits(next)) Object.assign(n, { verdict: "early", far: true, shifted: true, deviationMs: Math.round((heardAt - tOf.get(next!)!) * 1000) });
  });

  const counts: Record<Verdict, number> = { ok: 0, early: 0, late: 0, wrong: 0, missed: 0 };
  for (const n of notes) counts[n.verdict]++;

  // ---- per event (aggregated over reps)
  const playable = music.events.filter((e) => !e.rest);
  const ordinal = new Map(playable.map((e, i) => [e.index, i + 1]));
  const events: EventDiag[] = playable.map((e) => {
    const mine = notes.filter((n) => n.event === e.index);
    const bad = mine.filter((n) => n.verdict !== "ok");
    if (!bad.length) return { event: e.index, verdict: "ok", count: mine.length, reps: mine.length };
    const tally = new Map<Verdict, NoteDiag[]>();
    for (const n of bad) tally.set(n.verdict, [...(tally.get(n.verdict) ?? []), n]);
    const [verdict, list] = [...tally.entries()].sort((a, b) => b[1].length - a[1].length || SEVERITY[b[0]] - SEVERITY[a[0]])[0]!;
    return { event: e.index, verdict, count: list.length, reps: mine.length, label: eventLabel(verdict, list) };
  });

  // ---- issues
  const issues: DiagIssue[] = [];
  const total = notes.length;
  const where = (ev: number) => {
    const e = music.events[ev];
    const n = e?.notes[0];
    const k = ordinal.get(ev) ?? ev + 1;
    if (!e || !n) return `la nota ${k}`;
    if (e.notes.length > 1) return `el acorde ${k}`;
    return `la nota ${k} (cuerda ${n.string}, ${n.fret === 0 ? "al aire" : `traste ${n.fret}`})`;
  };

  if (total && counts.missed >= Math.max(3, total * 0.6)) {
    issues.push({
      kind: "quiet",
      severity: "bad",
      title: "Casi no se escuchó la guitarra",
      detail: `${counts.missed} de ${total} notas no se oyeron.`,
      tip: "Acerca el teléfono o la laptop a la guitarra (a un metro o menos), toca con más decisión y revisa que el navegador tenga permiso de micrófono. Si estabas tocando bien, prueba la afinación en el Afinador.",
    });
  } else {
    const missedEvents = events.filter((e) => e.verdict === "missed");
    if (missedEvents.length)
      issues.push({
        kind: "missed",
        severity: "bad",
        title: missedEvents.length === 1 ? `No se escuchó ${where(missedEvents[0]!.event)}` : `No se escucharon ${missedEvents.length} notas`,
        detail:
          missedEvents.length === 1
            ? `Faltó en ${missedEvents[0]!.count} de ${missedEvents[0]!.reps} repeticiones.`
            : `Faltaron ${missedEvents.map((e) => where(e.event)).join(", ")}.`,
        tip: "Pulsa la cuerda con más decisión y deja que suene. Revisa también que ningún otro dedo la esté rozando sin querer: eso la apaga.",
        events: missedEvents.map((e) => e.event),
      });
  }

  // wrong notes, explained by what was heard instead
  const wrongEvents = events.filter((e) => e.verdict === "wrong");
  const semitoneSlips: number[] = [];
  for (const ev of wrongEvents.slice(0, 2)) {
    const e = music.events[ev.event]!;
    if (e.notes.length > 1) {
      issues.push({
        kind: "chord",
        severity: "bad",
        title: `No sonaron todas las notas en ${where(ev.event)}`,
        detail: `Pasó en ${ev.count} de ${ev.reps} repeticiones.`,
        tip: "Toca todas las cuerdas a la vez y revisa, una por una, que ningún dedo apague la cuerda de al lado. Arquea los dedos para tocar con la punta.",
        events: [ev.event],
      });
      continue;
    }
    const n = e.notes[0]!;
    const heard = mostCommon(notes.filter((x) => x.event === ev.event && x.verdict === "wrong").map((x) => x.detected));
    const why = explainWrong(n.string, n.fret, n.midi, heard);
    if (heard !== null && Math.abs(heard - n.midi) === 1) semitoneSlips.push(heard - n.midi);
    issues.push({
      kind: "wrong",
      severity: "bad",
      title: `Nota distinta en ${where(ev.event)}`,
      detail: `Debía sonar ${noteNameEs(n.midi)}${heard !== null ? ` y se escuchó ${noteNameEs(heard)}` : ""} (${ev.count} de ${ev.reps} veces). ${why.detail}`,
      tip: why.tip,
      events: [ev.event],
    });
  }
  let restIssue: DiagIssue | undefined;
  if (wrongEvents.length > 2) {
    const rest = wrongEvents.slice(2);
    issues.push((restIssue = {
      kind: "wrong",
      severity: "bad",
      title: rest.length === 1 ? "Otra nota distinta" : `${rest.length} notas distintas más`,
      detail: `En ${rest.map((e) => where(e.event)).join(", ")}.`,
      tip: "Toca el ejercicio lento y sin metrónomo mirando la tablatura, nota por nota, antes de volver a intentarlo.",
      events: rest.map((e) => e.event),
    }));
  }
  if (semitoneSlips.length >= 2 && semitoneSlips.every((s) => s === semitoneSlips[0]))
    issues.push({
      kind: "tuning",
      severity: "warn",
      title: "¿Está afinada la guitarra?",
      detail: `Varias notas sonaron medio tono ${semitoneSlips[0]! > 0 ? "más agudas" : "más graves"} de lo esperado.`,
      tip: "Pasa por el Afinador antes de repetir la prueba.",
    });

  // timing, over everything we could time
  const timed = notes.filter((n) => (n.verdict === "ok" || n.verdict === "early" || n.verdict === "late") && n.deviationMs !== null);
  if (timed.length >= 3) {
    // shifted notes are a whole note off; keep them out of the "how many ms" figure
    const inPlace = timed.filter((n) => !n.shifted);
    const mostlyShifted = inPlace.length < 2;
    const devs = (mostlyShifted ? timed : inPlace).map((n) => n.deviationMs!);
    const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
    const sd = Math.sqrt(devs.reduce((a, b) => a + (b - mean) ** 2, 0) / devs.length);
    const early = timed.filter((n) => n.verdict === "early").length;
    const late = timed.filter((n) => n.verdict === "late").length;
    const off = early + late;
    const steady = sd < 35;
    const latencyHint = steady
      ? " Si sentiste que tocabas justo con el clic, puede que la latencia no esté calibrada en este dispositivo: Ajustes → Calibrar latencia."
      : "";
    const shifted = timed.filter((n) => n.shifted).length;
    const farNote = shifted
      ? ` En ${shifted} ${shifted === 1 ? "caso" : "casos"} la nota llegó tan ${mean > 0 ? "tarde" : "pronto"} que sonó donde iba la ${mean > 0 ? "siguiente" : "anterior"}: las notas eran las correctas, pero fuera de lugar.`
      : timed.some((n) => n.far)
        ? " Algunas notas llegaron muy lejos del clic."
        : "";
    if (mean < -tol * 0.6 && early >= off * 0.6) {
      issues.push({
        kind: "early",
        severity: early >= timed.length * 0.4 ? "bad" : "warn",
        title: "Te adelantas al clic",
        detail: mostlyShifted
          ? `Tocas casi una nota entera antes del clic: las notas eran las correctas, pero cada una sonó donde iba la anterior (${shifted} veces).`
          : `${early} de ${timed.length} notas sonaron antes de tiempo, en promedio ${Math.round(-mean)} ms antes.${farNote}`,
        tip: `Es muy común cuando uno se apura o está nervioso. Deja que el clic suene y toca junto con él, no antes. Contar en voz alta («1 y 2 y…») ayuda a esperar.${latencyHint}`,
        events: uniqueEvents(timed.filter((n) => n.verdict === "early")),
      });
    } else if (mean > tol * 0.6 && late >= off * 0.6) {
      issues.push({
        kind: "late",
        severity: late >= timed.length * 0.4 ? "bad" : "warn",
        title: "Vas detrás del clic",
        detail: mostlyShifted
          ? `Vas casi una nota entera detrás del clic: las notas eran las correctas, pero cada una sonó donde iba la siguiente (${shifted} veces).`
          : `${late} de ${timed.length} notas sonaron tarde, en promedio ${Math.round(mean)} ms después.${farNote}`,
        tip: `Ten el dedo de la siguiente nota ya apoyado en su cuerda antes de que llegue el clic; así solo tienes que soltarla cuando suena. Mira la tablatura un poco por delante de donde estás.${latencyHint}`,
        events: uniqueEvents(timed.filter((n) => n.verdict === "late")),
      });
    } else if (off >= Math.max(2, timed.length * 0.25)) {
      issues.push({
        kind: "uneven",
        severity: off >= timed.length * 0.4 ? "bad" : "warn",
        title: "El tiempo es irregular",
        detail: `${early} notas sonaron antes y ${late} después del clic (más de ${tol} ms).${farNote}`,
        tip: "Busca que todas las notas estén separadas por el mismo espacio, como pasos al caminar. Cuenta en voz alta y no te detengas a corregir: sigue al clic.",
        events: uniqueEvents(timed.filter((n) => n.verdict !== "ok")),
      });
    }
  }

  if (leftoverExtras >= 2)
    issues.push({
      kind: "extra",
      severity: "warn",
      title: `Se escucharon ${leftoverExtras} notas de más`,
      detail: "Sonidos que no correspondían a ninguna nota del ejercicio.",
      tip: "Puede ser una cuerda que roza, un golpe en la guitarra o una nota repetida. Apaga con la mano las cuerdas que no estás tocando.",
    });

  if (!issues.length && total)
    issues.push({ kind: "good", severity: "good", title: "Todo en su sitio", detail: "Notas correctas y a tiempo.", tip: "Sigue así." });

  // most severe first; within the same severity, whatever affected more notes
  const weight = (i: DiagIssue) =>
    i === restIssue
      ? 0
      : i.kind === "early" ? counts.early : i.kind === "late" ? counts.late : i.kind === "uneven" ? counts.early + counts.late : i.kind === "quiet" ? total : (i.events?.length ?? 1) * Math.max(1, total / Math.max(1, playable.length) / 2);
  issues.sort((a, b) => sev(b) - sev(a) || weight(b) - weight(a));
  return { notes, events, issues, counts };
}

const sev = (i: DiagIssue) => (i.severity === "bad" ? 2 : i.severity === "warn" ? 1 : 0);

function uniqueEvents(list: NoteDiag[]) {
  return [...new Set(list.map((n) => n.event))];
}

function mostCommon(xs: (number | null)[]): number | null {
  const m = new Map<number, number>();
  for (const x of xs) if (x !== null) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function eventLabel(v: Verdict, list: NoteDiag[]): string | undefined {
  if ((v === "early" || v === "late") && list.filter((n) => n.shifted).length * 2 > list.length) return v === "late" ? "tarde" : "antes";
  if (v === "early" || v === "late") {
    const ms = median(list.map((n) => n.deviationMs ?? 0));
    return `${ms > 0 ? "+" : "−"}${Math.abs(ms)}`;
  }
  if (v === "wrong") {
    const h = mostCommon(list.map((n) => n.detected));
    return h === null ? "✗" : noteNameEs(h);
  }
  if (v === "missed") return "?";
  return undefined;
}

/** Guess what the hand did, from the note that sounded instead. */
function explainWrong(string: number, fret: number, midi: number, heard: number | null): { detail: string; tip: string } {
  const generic = {
    detail: "",
    tip: "Toca esa nota sola y lento, mirando la tablatura, hasta que suene igual que en el ejercicio.",
  };
  if (heard === null) return generic;
  const open = STANDARD_TUNING[string]!;
  if (fret > 0 && heard === open)
    return {
      detail: "Sonó la cuerda al aire: el dedo no llegó a presionarla.",
      tip: "Presiona con la punta del dedo justo detrás del traste (pegado a la barrita de metal), no en medio de la casilla, y pon el dedo antes de pulsar la cuerda.",
    };
  for (const s of [string - 1, string + 1]) {
    const o = STANDARD_TUNING[s];
    if (o === undefined) continue;
    if (heard === o || heard === o + fret)
      return {
        detail: `Parece que sonó la cuerda ${s} en vez de la ${string}.`,
        tip: `En la tablatura la línea de arriba es la cuerda 1 (la más fina) y la de abajo la 6. Antes de tocar, apoya el dedo de la mano derecha sobre la cuerda ${string} para sentir que es la correcta.`,
      };
  }
  const diff = heard - midi;
  if (Math.abs(diff) <= 2 && fret + diff >= 0)
    return {
      detail: `Suena como el traste ${fret + diff} en vez del ${fret}.`,
      tip: "Revisa en qué traste pones el dedo; cuenta los trastes desde la cejuela (el extremo del mástil).",
    };
  if (Math.abs(diff) === 12)
    return {
      detail: "Sonó la misma nota una octava más arriba o más abajo; puede ser un armónico o que la cuerda vecina siguiera sonando.",
      tip: "Apaga las cuerdas que no tocas y pulsa la cuerda en el centro de la boca de la guitarra.",
    };
  return generic;
}
