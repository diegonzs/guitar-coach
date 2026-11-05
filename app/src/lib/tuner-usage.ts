import { localDay } from "@guitar-coach/core";

const USAGE_KEY = "gc-tuner-usage";

/** Minutes spent in the tuner today (counts as the warm-up step of the daily routine). */
export function tunerMinutesToday(): number {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}");
    return u.day === localDay(new Date()) ? u.minutes : 0;
  } catch {
    return 0;
  }
}

export function addTunerTime(sec: number) {
  const day = localDay(new Date());
  const minutes = tunerMinutesToday() + sec / 60;
  localStorage.setItem(USAGE_KEY, JSON.stringify({ day, minutes }));
}
