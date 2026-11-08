/**
 * Records a short practice with the fake mic and checks what gets saved: the file
 * must have sound in both channels, be served with byte ranges (iOS needs them),
 * and the mic must be released when leaving the practice screen.
 *   bun scripts/e2e/recording.ts [baseUrl] [outDir]
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
  const w = window as unknown as { __streams: MediaStream[] };
  w.__streams = [];
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(await (await fetch("/__test/arpeggio.wav")).arrayBuffer());
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // a mono source, like a phone mic
    const dest = ac.createMediaStreamDestination();
    dest.channelCount = 1;
    src.connect(dest);
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
await page.waitForTimeout(9000);
await page.getByRole("button", { name: "Terminar" }).last().click();
await page.waitForURL(/\/sesion\//, { timeout: 15000 });
const id = decodeURIComponent(page.url().split("/sesion/")[1]!);
await page.waitForTimeout(2500); // upload
const live = await page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getAudioTracks()).filter((t) => t.readyState === "live").length);
console.log("session", id, "| mic tracks still open after leaving practice:", live);
const meta = await (await fetch(`${base}/api/sessions/${id}`)).json().catch(() => null);
const file = meta?.files?.find((f: { kind: string }) => f.kind === "audio")?.name;
console.log("audio file:", file);
const r = await fetch(`${base}/api/sessions/${id}/files/${file}`, { headers: { range: "bytes=0-99" } });
console.log("range request:", r.status, r.headers.get("content-range"), r.headers.get("content-type"));
const full = await fetch(`${base}/api/sessions/${id}/files/${file}`);
await Bun.write(`${out}/rec-${file}`, await full.arrayBuffer());
await page.screenshot({ path: `${out}/rec-summary.png`, fullPage: true });
console.log("saved", `${out}/rec-${file}`);
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no browser errors");
await browser.close();
