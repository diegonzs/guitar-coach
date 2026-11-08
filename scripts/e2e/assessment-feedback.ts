/**
 * Plays the first two assessment tasks with the fake-mic arpeggio (which is not in
 * sync with the metronome, so it fails) and screenshots the per-note explanation.
 *   bun scripts/e2e/assessment-feedback.ts [baseUrl] [outDir]
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
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext();
    const buf = await ac.decodeAudioData(await (await fetch("/__test/arpeggio.wav")).arrayBuffer());
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    src.start();
    return dest.stream;
  };
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(base + "/evaluacion");
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Empezar", exact: true }).click();
await page.getByRole("button", { name: "Continuar a las pruebas" }).click();
for (let task = 1; task <= 2; task++) {
  await page.getByRole("button", { name: "Empezar prueba" }).click();
  await page.waitForTimeout(3300);
  for (let k = 0; k < 8; k++) {
    await page.locator("svg[aria-label=Tablatura]").first().screenshot({ path: `${out}/fb-${task}-live-${k}.png` });
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${out}/fb-${task}-live.png` });
  await page.getByRole("button", { name: "Siguiente" }).waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${out}/fb-${task}-result.png`, fullPage: true });
  console.log(`task ${task}:`, (await page.locator("main, body").innerText()).split("\n").filter(Boolean).slice(0, 40).join(" | "));
  await page.getByRole("button", { name: "Siguiente" }).click();
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no browser errors");
await browser.close();
