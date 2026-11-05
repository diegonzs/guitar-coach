import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light" | "system";
export interface CameraCalibration {
  /** Normalised [0..1] image coords (unmirrored) of the nut and the 12th fret. */
  nut: [number, number];
  fret12: [number, number];
  date: string;
}

export interface Settings {
  theme: Theme;
  /** Round-trip audio latency to compensate, in ms (speaker → ear → guitar → mic). */
  latencyMs: number;
  latencyCalibrated: boolean;
  voice: boolean;
  metronomeVolume: number;
  countInBars: number;
  saveVideo: boolean;
  calibration: CameraCalibration | null;
  remoteRoom: string;
  deviceName: string;
  /** Delete media from this device N days after it was uploaded. */
  keepMediaDays: number;
}

const DEFAULTS: Settings = {
  theme: "dark",
  latencyMs: 60,
  latencyCalibrated: false,
  voice: true,
  metronomeVolume: 0.6,
  countInBars: 1,
  saveVideo: true,
  calibration: null,
  remoteRoom: Math.random().toString(36).slice(2, 8),
  deviceName: "",
  keepMediaDays: 7,
};

const KEY = "gc-settings";
let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const s = { ...DEFAULTS, ...raw };
    if (!raw.remoteRoom) localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings {
  return current;
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  if (patch.theme) {
    localStorage.setItem("gc-theme", patch.theme);
    applyTheme(patch.theme);
  }
  listeners.forEach((l) => l());
}

export function applyTheme(theme: Theme = current.theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#161310" : "#f8f5f0");
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
