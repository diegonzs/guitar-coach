/**
 * Mic health in a practice run, with a fake mic:
 *  1. music plays → the level meter moves, no warning;
 *  2. the input goes silent → "No te escucho" after a few seconds;
 *  3. the track gets disabled (like iOS muting it) → "El micrófono se cortó", and
 *     "Reactivar" reopens the mic and clears it.
 *   bun scripts/e2e/mic-health.ts [baseUrl] [outDir]
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:4321";
const out = process.argv[3] ?? "/tmp/gc-shots";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ["microphone"], colorScheme: "dark", serviceWorkers: "block" });
await ctx.route("**/__test/arpeggio.wav", (r) => r.fulfill({ path: "/tmp/gc-arpeggio.wav", contentType: "audio/wav" }));
await ctx.addInitScript(() => {
  const w = window as unknown as { __gain?: GainNode; __streams: MediaStream[]; __opens: number };
  w.__streams = [];
  w.__opens = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    w.__opens++;
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(await (await fetch("/__test/arpeggio.wav")).arrayBuffer());
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ac.createGain();
    w.__gain = g;
    const dest = ac.createMediaStreamDestination();
    src.connect(g).connect(dest);
    src.start();
    w.__streams.push(dest.stream);
    return dest.stream;
  };
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(base + "/practicar/002-arpegio-am/arpegio");
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Solo audio" }).click().catch(() => {});
await page.getByRole("button", { name: "Empezar", exact: true }).click();
await page.waitForTimeout(6000);
const alert = () => page.getByRole("alert").filter({ hasText: /micrófono|escucho|audio/ });
const meter = () => page.evaluate(() => (document.querySelector("[title='Nivel del micrófono'] span span") as HTMLElement | null)?.style.transform ?? "none");
console.log("1 music: meter", await meter(), "alert?", await alert().count());
await page.screenshot({ path: `${out}/mic-1-music.png` });

await page.evaluate(() => ((window as unknown as { __gain: GainNode }).__gain.gain.value = 0));
await page.waitForTimeout(9000);
console.log("2 silent: meter", await meter(), "alert:", await alert().innerText().catch(() => "none"));
await page.screenshot({ path: `${out}/mic-2-silent.png` });

await page.evaluate(() => ((window as unknown as { __gain: GainNode }).__gain.gain.value = 1));
await page.waitForTimeout(1500);
console.log("2b sound back: alert?", await alert().count());

await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.at(-1)!.getAudioTracks()[0]!.enabled = false);
await page.waitForTimeout(2500);
console.log("3 muted: alert:", await alert().innerText().catch(() => "none"));
await page.screenshot({ path: `${out}/mic-3-muted.png` });
await page.getByRole("button", { name: "Reactivar" }).click();
await page.waitForTimeout(2500);
console.log("3b after Reactivar: opens", await page.evaluate(() => (window as unknown as { __opens: number }).__opens), "alert?", await alert().count(), "meter", await meter());
await page.screenshot({ path: `${out}/mic-4-restarted.png` });
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no browser errors");
await browser.close();
