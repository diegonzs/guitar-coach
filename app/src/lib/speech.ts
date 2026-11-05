import { getSettings } from "./settings";

let voice: SpeechSynthesisVoice | null | undefined;

function pickVoice() {
  if (voice !== undefined || typeof speechSynthesis === "undefined") return voice ?? null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  voice = voices.find((v) => v.lang === "es-MX") ?? voices.find((v) => v.lang.startsWith("es-")) ?? voices.find((v) => v.lang.startsWith("es")) ?? null;
  return voice;
}

/** Short spoken cue. Never queues: a newer cue replaces an older one. */
export function speak(text: string) {
  if (!getSettings().voice || typeof speechSynthesis === "undefined") return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "es-ES";
    u.rate = 1.05;
    u.volume = 1;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

/** iOS only allows speech after a user gesture; call this from a tap. */
export function primeSpeech() {
  if (typeof speechSynthesis === "undefined") return;
  pickVoice();
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}
