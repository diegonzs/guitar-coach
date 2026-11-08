import { localDay } from "@guitar-coach/core";

const USAGE_KEY = "gc-tuner-usage";

interface Usage {
  day: string;
  minutes: number;
  /** Open strings (1–6) confirmed in tune today. */
  strings: number[];
}

function read(): Usage {
  const day = localDay(new Date());
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}");
    if (u.day === day) return { day, minutes: Number(u.minutes) || 0, strings: Array.isArray(u.strings) ? u.strings : [] };
  } catch {
    /* fall through */
  }
  return { day, minutes: 0, strings: [] };
}

/** Minutes spent in the tuner today. */
export function tunerMinutesToday(): number {
  return read().minutes;
}

/** Strings already tuned today (kept across visits to the tuner). */
export function tunedStringsToday(): number[] {
  return read().strings;
}

export function addTunerTime(sec: number) {
  const u = read();
  u.minutes += sec / 60;
  localStorage.setItem(USAGE_KEY, JSON.stringify(u));
}

export function markStringTuned(string: number) {
  const u = read();
  if (u.strings.includes(string)) return;
  u.strings.push(string);
  localStorage.setItem(USAGE_KEY, JSON.stringify(u));
}

/**
 * The warm-up step is done once all six strings were tuned today, or after its minutes
 * in the tuner. Tuning takes a minute or two, so time alone almost never completed it.
 */
export function warmupDoneToday(minutes: number): boolean {
  const u = read();
  return u.strings.length >= 6 || u.minutes >= minutes;
}
