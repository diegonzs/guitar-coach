/**
 * Browser smoke test with fake mic (a WAV of a plucked arpeggio) and fake camera.
 *   bun scripts/e2e/smoke.ts [baseUrl] [outDir]
 * Requires Google Chrome installed and the server running (bun run start).
 */
import { chromium, type Page } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:4321";
const out = process.argv[3] ?? "/tmp/gc-shots";
await mkdir(out, { recursive: true });
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const errors: string[] = [];
async function newPage(mobile: boolean) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    permissions: ["microphone", "camera"],
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  // macOS blocks automated Chrome from the (even fake) microphone, so feed a WAV
  // through WebAudio instead: the app receives a normal MediaStream audio track.
  await ctx.route("**/__test/arpeggio.wav", (route) => route.fulfill({ path: "/tmp/gc-arpeggio.wav", contentType: "audio/wav" }));
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      if (!c?.audio) return original(c);
      const ac = new AudioContext();
      const buf = await ac.decodeAudioData(await (await fetch("/__test/arpeggio.wav")).arrayBuffer());
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      src.start();
      const audio = dest.stream;
      if (c.video) {
        const v = await original({ video: c.video });
        return new MediaStream([...v.getVideoTracks(), ...audio.getAudioTracks()]);
      }
      return audio;
    };
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  return page;
}
const shot = (p: Page, name: string) => p.screenshot({ path: `${out}/${name}.png`, fullPage: false });
const step = async (name: string, fn: () => Promise<void>) => {
  const t = Date.now();
  try {
    await fn();
    console.log(`✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    console.log(`✗ ${name}: ${(e as Error).message.split("\n")[0]}`);
  }
};

const page = await newPage(true);
await step("home loads and syncs curriculum", async () => {
  await page.goto(base + "/");
  await page.getByText("Empieza con la evaluación de nivel").waitFor({ timeout: 10000 });
  await shot(page, "01-home");
});
await step("lessons list", async () => {
  await page.goto(base + "/lecciones");
  await page.getByText("Arpegio p-i-m-a en La menor").waitFor();
  await shot(page, "02-lessons");
});
await step("lesson detail with tab", async () => {
  await page.goto(base + "/lecciones/002-arpegio-am");
  await page.getByRole("img", { name: "Tablatura" }).first().waitFor();
  await shot(page, "03-lesson");
});
await step("practice (audio) detects the arpeggio", async () => {
  await page.goto(base + "/practicar/002-arpegio-am/arpegio?modo=audio&bpm=60");
  await page.getByRole("button", { name: "Empezar" }).click();
  await page.waitForTimeout(9000);
  await shot(page, "04-practice-audio");
  await page.getByRole("button", { name: "Terminar" }).first().click();
  await page.waitForURL(/\/sesion\//, { timeout: 10000 });
  await page.waitForTimeout(800);
  await shot(page, "05-summary");
  const txt = await page.locator("body").innerText();
  const m = txt.match(/(\d+)%\s*\n?\s*notas correctas/);
  console.log("   accuracy shown:", m?.[1] ?? "?");
});
await step("tuner hears notes", async () => {
  await page.goto(base + "/afinador");
  await page.getByRole("button", { name: "Activar micrófono" }).click();
  await page.waitForTimeout(2500);
  await shot(page, "06-tuner");
});
await step("assessment intro → questions → first task", async () => {
  await page.goto(base + "/evaluacion");
  await page.getByRole("button", { name: "Empezar" }).click();
  await page.getByText("Cuéntame un poco").waitFor();
  await page.getByText("Estoy empezando").click();
  await shot(page, "07-assessment-questions");
  await page.getByRole("button", { name: "Continuar a las pruebas" }).click();
  await page.getByRole("button", { name: "Empezar prueba" }).waitFor();
  await shot(page, "08-assessment-task");
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Todavía no sé tocarla" }).click();
  await page.getByText("Tu nivel").first().waitFor();
  await shot(page, "09-assessment-result");
  await page.getByRole("button", { name: "Empezar esa lección" }).click();
  await page.waitForURL(/\/lecciones\//);
});
await step("progress + settings", async () => {
  await page.goto(base + "/progreso");
  await page.waitForTimeout(500);
  await shot(page, "10-progress");
  await page.goto(base + "/ajustes");
  await page.waitForTimeout(500);
  await shot(page, "11-settings");
});
await step("free play", async () => {
  await page.goto(base + "/libre");
  await page.getByRole("button", { name: "Empezar" }).click();
  await page.waitForTimeout(8000);
  await shot(page, "12-free");
  await page.getByRole("button", { name: "Terminar" }).first().click();
  await page.waitForURL(/\/sesion\//, { timeout: 10000 });
});

const desk = await newPage(false);
await step("practice (camera) on laptop with posture model", async () => {
  await desk.goto(base + "/practicar/002-arpegio-am/arpegio?modo=camara&bpm=60");
  await desk.getByRole("button", { name: "Empezar" }).click();
  await desk.waitForTimeout(9000);
  await shot(desk, "13-practice-camera-desktop");
  const txt = await desk.locator("body").innerText();
  console.log("   vision:", txt.includes("Postura no disponible") ? "ERROR" : txt.includes("Cargando detección") ? "still loading" : "loaded");
  await desk.getByRole("button", { name: "Terminar" }).first().click();
  await desk.waitForURL(/\/sesion\//, { timeout: 15000 });
  await desk.waitForTimeout(800);
  await shot(desk, "14-summary-camera");
});
const phoneCam = await newPage(true);
await step("practice (camera) on phone", async () => {
  await phoneCam.goto(base + "/practicar/002-arpegio-am/arpegio?modo=camara&bpm=60");
  await phoneCam.getByRole("button", { name: "Empezar" }).click();
  await phoneCam.waitForTimeout(6000);
  await shot(phoneCam, "15-practice-camera-phone");
  await phoneCam.getByRole("button", { name: "Terminar" }).first().click();
  await phoneCam.waitForURL(/\/sesion\//, { timeout: 15000 });
});
await page.waitForTimeout(2500);
const sessions = await (await fetch(base + "/api/sessions")).json();
console.log(`server sessions: ${sessions.length} → ${sessions.map((s: { kind: string; mode: string; summary: { accuracy: number | null; notesHit: number } }) => `${s.kind}/${s.mode} acc=${s.summary.accuracy} hits=${s.summary.notesHit}`).join(", ")}`);
const free = sessions.find((s: { kind: string }) => s.kind === "free");
if (free) {
  const full = await (await fetch(`${base}/api/sessions/${free.id}`)).json();
  console.log("free-play notes heard:", full.notes.map((n: { detected: number }) => n.detected).join(" "), "(expected repeating 45 57 60 64 60 57)");
}
console.log(errors.length ? `\n${errors.length} browser error(s):\n${[...new Set(errors)].slice(0, 15).join("\n")}` : "\nno browser errors");
await browser.close();
