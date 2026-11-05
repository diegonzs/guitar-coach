/** Basic music helpers shared by the app, the server and the validator. */

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** Standard tuning, MIDI number per string. String 1 = high E, string 6 = low E. */
export const STANDARD_TUNING: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

/** Lowest/highest MIDI notes we try to detect on a classical guitar (E2 … B5). */
export const GUITAR_MIDI_MIN = 40;
export const GUITAR_MIDI_MAX = 83;
export const MAX_FRET = 19;

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** "A2", "C#4"… */
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function pitchClassName(midi: number): string {
  return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12]!;
}

export function fretToMidi(string: number, fret: number, tuning = STANDARD_TUNING): number {
  const open = tuning[string];
  if (open === undefined) throw new Error(`Cuerda inválida: ${string}`);
  return open + fret;
}

/** Deviation in cents between a frequency and the nearest equal-tempered note. */
export function centsOff(freq: number, a4 = 440): { midi: number; cents: number } {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

export const OPEN_STRINGS = [6, 5, 4, 3, 2, 1].map((s) => ({
  string: s,
  midi: STANDARD_TUNING[s]!,
  name: pitchClassName(STANDARD_TUNING[s]!),
}));
