import { resolve, sep, extname } from "node:path";
import { stat } from "node:fs/promises";
import type { ServerWebSocket } from "bun";
import { loadCurriculum } from "@guitar-coach/core/node";
import type { Curriculum } from "@guitar-coach/core";
import type { Config } from "./config.ts";
import { Store, StoreError } from "./store.ts";
import { writeReport } from "./report-lib.ts";

export const VERSION = "0.1.0";

interface WsData {
  room: string;
  role: "camera" | "viewer";
  id: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export function createApp(cfg: Config) {
  const store = new Store(cfg.dataDir);
  let curriculum: Curriculum | null = null;
  let curriculumAt = 0;
  const rooms = new Map<string, Set<ServerWebSocket<WsData>>>();

  async function getCurriculum(): Promise<Curriculum> {
    // Cheap enough to re-read every couple of seconds; lets the LLM edit files live.
    if (!curriculum || Date.now() - curriculumAt > 2000) {
      curriculum = await loadCurriculum(cfg.curriculumDir);
      curriculumAt = Date.now();
    }
    return curriculum;
  }

  let reportTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReport() {
    if (reportTimer) clearTimeout(reportTimer);
    reportTimer = setTimeout(async () => {
      reportTimer = null;
      try {
        await writeReport(store, await getCurriculum(), cfg.curriculumDir);
      } catch (e) {
        console.error("No se pudo generar el informe:", e);
      }
    }, 1500);
  }

  async function api(req: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const m = (re: RegExp) => path.match(re);

    if (path === "/api/health" && req.method === "GET") {
      const c = await getCurriculum();
      return json({ ok: true, version: VERSION, time: new Date().toISOString(), curriculumHash: c.hash, curriculumIsExample: cfg.curriculumIsExample });
    }
    if (path === "/api/curriculum" && req.method === "GET") {
      const c = await getCurriculum();
      if (req.headers.get("if-none-match") === `"${c.hash}"`) return new Response(null, { status: 304 });
      return json({ ...c, isExample: cfg.curriculumIsExample }, 200, { etag: `"${c.hash}"` });
    }
    if (path === "/api/sessions" && req.method === "GET") return json(await store.listSessions());

    let r = m(/^\/api\/sessions\/([^/]+)$/);
    if (r) {
      const id = decodeURIComponent(r[1]!);
      if (req.method === "GET") {
        const s = await store.getSession(id);
        return s ? json(s) : json({ error: "No existe" }, 404);
      }
      if (req.method === "PUT") {
        const len = Number(req.headers.get("content-length") ?? 0);
        if (len > 20 * 1024 * 1024) return json({ error: "Demasiado grande" }, 413);
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        const s = await store.putSession(id, body);
        scheduleReport();
        return json({ ok: true, id: s.id });
      }
    }

    r = m(/^\/api\/sessions\/([^/]+)\/files\/([^/]+)$/);
    if (r) {
      const id = decodeURIComponent(r[1]!);
      const name = decodeURIComponent(r[2]!);
      if (req.method === "PUT") {
        const len = Number(req.headers.get("content-length") ?? 0);
        if (len > cfg.maxUpload) return json({ error: "Archivo demasiado grande" }, 413);
        const size = await store.putFile(id, name, req.body, cfg.maxUpload);
        return json({ ok: true, size });
      }
      if (req.method === "GET" || req.method === "HEAD") {
        const info = await store.fileInfo(id, name);
        if (!info) return json({ error: "No existe" }, 404);
        return fileResponse(req, info.path, { "cache-control": "private, max-age=3600" });
      }
    }

    if (path === "/api/profile") {
      if (req.method === "GET") return json(await store.getProfile());
      if (req.method === "PUT") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        const p = await store.putProfile(body);
        scheduleReport();
        return json(p);
      }
    }

    if (path === "/api/report" && req.method === "GET") {
      const { markdown } = await writeReport(store, await getCurriculum(), cfg.curriculumDir);
      return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
    }

    return json({ error: "No encontrado" }, 404);
  }

  /**
   * Serves a file honouring `Range` requests. iOS Safari only plays <audio>/<video> from
   * servers that answer byte ranges with 206; without it the player just stays silent.
   */
  function fileResponse(req: Request, path: string, headers: Record<string, string>): Response {
    const file = Bun.file(path);
    const size = file.size;
    const base = { ...headers, "accept-ranges": "bytes", "content-type": file.type };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (!range || (!range[1] && !range[2])) return new Response(file, { headers: base });
    let start: number;
    let end: number;
    if (!range[1]) {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    } else {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }

  async function staticFile(url: URL): Promise<Response> {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const p = resolve(cfg.appDist, "." + rel);
    if (p !== cfg.appDist && !p.startsWith(cfg.appDist + sep)) return new Response("Bad request", { status: 400 });
    const isFile = await stat(p).then((s) => s.isFile()).catch(() => false);
    if (isFile) {
      const name = p.slice(cfg.appDist.length + 1);
      const immutable = name.startsWith("assets/");
      const noCache = name === "index.html" || name === "sw.js" || name.startsWith("workbox-") || name === "manifest.webmanifest";
      return new Response(Bun.file(p), {
        headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : noCache ? "no-cache" : "public, max-age=3600" },
      });
    }
    // SPA fallback for client routes (paths without a file extension)
    if (!extname(rel)) {
      const index = resolve(cfg.appDist, "index.html");
      if (await Bun.file(index).exists()) return new Response(Bun.file(index), { headers: { "cache-control": "no-cache", "content-type": "text/html; charset=utf-8" } });
      return new Response("La app no está compilada. Ejecuta `bun run build` (o usa `bun run dev`).", { status: 503 });
    }
    return new Response("Not found", { status: 404 });
  }

  async function fetch(req: Request, server: import("bun").Server<WsData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (url.pathname === "/ws/signal") {
      const room = (url.searchParams.get("room") ?? "default").slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "") || "default";
      const role = url.searchParams.get("role") === "camera" ? "camera" : "viewer";
      if (server.upgrade(req, { data: { room, role, id: crypto.randomUUID() } })) return undefined;
      return new Response("Se esperaba WebSocket", { status: 400 });
    }
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, url);
      if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      return await staticFile(url);
    } catch (e) {
      if (e instanceof StoreError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Error interno" }, 500);
    }
  }

  const websocket = {
    open(ws: ServerWebSocket<WsData>) {
      const set = rooms.get(ws.data.room) ?? new Set();
      // one camera + one viewer per room is plenty; drop stale peers with the same role
      for (const peer of set) if (peer.data.role === ws.data.role) peer.close(4000, "Reemplazado");
      set.add(ws);
      rooms.set(ws.data.room, set);
      for (const peer of set) if (peer !== ws) {
        peer.send(JSON.stringify({ type: "peer-joined", role: ws.data.role }));
        ws.send(JSON.stringify({ type: "peer-joined", role: peer.data.role }));
      }
    },
    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      const text = typeof message === "string" ? message : message.toString();
      if (text.length > 64 * 1024) return;
      for (const peer of rooms.get(ws.data.room) ?? []) if (peer !== ws) peer.send(text);
    },
    close(ws: ServerWebSocket<WsData>) {
      const set = rooms.get(ws.data.room);
      if (!set) return;
      set.delete(ws);
      for (const peer of set) peer.send(JSON.stringify({ type: "peer-left", role: ws.data.role }));
      if (!set.size) rooms.delete(ws.data.room);
    },
  };

  return { store, fetch, websocket, getCurriculum };
}
