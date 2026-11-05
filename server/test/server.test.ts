import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";

let dir: string;
let app: ReturnType<typeof createApp>;
const base = "http://test.local";
const call = (path: string, init?: RequestInit) => app.fetch(new Request(base + path, init), {} as any) as Promise<Response>;

const session = (id: string, over: Record<string, unknown> = {}) => ({
  formatVersion: 1,
  id,
  kind: "exercise",
  mode: "audio",
  device: { kind: "phone" },
  startedAt: "2026-11-04T20:00:00.000Z",
  endedAt: "2026-11-04T20:10:00.000Z",
  durationSec: 600,
  lesson: { id: "002-arpegio-am", title: "Arpegio" },
  exercise: { id: "arpegio", title: "Arpegio en Am" },
  bpm: 60,
  summary: { accuracy: 0.9, meanDeviationMs: 12, meanAbsDeviationMs: 20, cleanReps: 10, totalReps: 12, notesExpected: 72, notesHit: 65, extraNotes: 1, problemNotes: [{ midi: 60, misses: 4, heardAs: 59 }], posture: { "posture.rightWrist": 0.2 } },
  userNote: "la uña se engancha",
  ...over,
});

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "gc-"));
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "dist/index.html"), "<html>app</html>");
  const cfg: Config = {
    port: 0,
    host: "127.0.0.1",
    dataDir: join(dir, "data"),
    curriculumDir: resolve(import.meta.dir, "../../examples/curriculum"),
    curriculumIsExample: true,
    appDist: join(dir, "dist"),
    maxUpload: 1024 * 1024,
  };
  app = createApp(cfg);
  await app.store.init();
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("api", () => {
  test("health and curriculum", async () => {
    const h = await (await call("/api/health")).json();
    expect(h.ok).toBe(true);
    const res = await call("/api/curriculum");
    const c = await res.json();
    expect(c.lessons.length).toBeGreaterThan(5);
    expect(c.isExample).toBe(true);
    const etag = res.headers.get("etag")!;
    expect((await call("/api/curriculum", { headers: { "if-none-match": etag } })).status).toBe(304);
  });

  test("sessions round trip", async () => {
    const put = await call("/api/sessions/sess-000001", { method: "PUT", body: JSON.stringify(session("sess-000001")) });
    expect(put.status).toBe(200);
    const list = await (await call("/api/sessions")).json();
    expect(list).toHaveLength(1);
    expect(list[0].notes).toBeUndefined();
    const full = await (await call("/api/sessions/sess-000001")).json();
    expect(full.userNote).toBe("la uña se engancha");
  });

  test("rejects invalid sessions, mismatched ids and path traversal", async () => {
    expect((await call("/api/sessions/sess-000002", { method: "PUT", body: JSON.stringify({ id: "sess-000002" }) })).status).toBe(422);
    expect((await call("/api/sessions/sess-000003", { method: "PUT", body: JSON.stringify(session("sess-000009")) })).status).toBe(400);
    expect((await call("/api/sessions/..%2F..%2Fetc", { method: "PUT", body: "{}" })).status).toBe(400);
    expect((await call("/api/sessions/sess-000001/files/..%2Fsession.json", { method: "PUT", body: "x" })).status).toBe(400);
    expect((await call("/api/sessions/sess-000001/files/session.json", { method: "PUT", body: "x" })).status).toBe(400);
    // URL normalisation keeps it inside the app: it gets the SPA shell, never the real file
    expect(await (await call("/%2e%2e/%2e%2e/etc/passwd")).text()).not.toContain("root:");
    expect(await (await call("/..%2F..%2Fpackage.json")).text()).not.toContain("workspaces");
  });

  test("file upload and download", async () => {
    const put = await call("/api/sessions/sess-000001/files/audio.webm", { method: "PUT", body: new Uint8Array([1, 2, 3, 4]) });
    expect((await put.json()).size).toBe(4);
    const get = await call("/api/sessions/sess-000001/files/audio.webm");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    const big = await call("/api/sessions/sess-000001/files/big.webm", { method: "PUT", body: new Uint8Array(2 * 1024 * 1024) });
    expect(big.status).toBe(413);
  });

  test("profile is last-write-wins", async () => {
    const p1 = { formatVersion: 1, updatedAt: "2026-11-04T10:00:00.000Z", currentLessonId: "a" };
    const p0 = { formatVersion: 1, updatedAt: "2026-11-03T10:00:00.000Z", currentLessonId: "old" };
    await call("/api/profile", { method: "PUT", body: JSON.stringify(p1) });
    const r = await (await call("/api/profile", { method: "PUT", body: JSON.stringify(p0) })).json();
    expect(r.currentLessonId).toBe("a");
  });

  test("report for the LLM", async () => {
    const md = await (await call("/api/report")).text();
    expect(md).toContain("Informe de práctica");
    expect(md).toContain("C4 falló 4× (sonó B3)");
    expect(md).toContain("la uña se engancha");
    const progress = JSON.parse(await readFile(join(dir, "data/progress.json"), "utf8"));
    expect(progress.lessons.length).toBeGreaterThan(5);
  });

  test("SPA fallback and 404s", async () => {
    expect(await (await call("/lecciones/002")).text()).toContain("app");
    expect((await call("/missing.js")).status).toBe(404);
    expect((await call("/api/nope")).status).toBe(404);
  });
});
