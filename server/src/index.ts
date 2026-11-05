#!/usr/bin/env bun
import { loadConfig } from "./config.ts";
import { createApp, VERSION } from "./app.ts";

const cfg = loadConfig();
const app = createApp(cfg);
await app.store.init();
const c = await app.getCurriculum();

const server = Bun.serve({
  port: cfg.port,
  hostname: cfg.host,
  fetch: app.fetch,
  websocket: app.websocket,
  // uploads of long videos can take a while over Wi-Fi
  idleTimeout: 120,
  maxRequestBodySize: cfg.maxUpload,
});

const errors = c.issues.filter((i) => i.level === "error");
console.log(`guitar-coach ${VERSION} · http://${server.hostname}:${server.port}`);
console.log(`  datos:     ${cfg.dataDir}`);
console.log(`  currículo: ${cfg.curriculumDir}${cfg.curriculumIsExample ? "  (ejemplo — crea ./curriculum para el tuyo)" : ""}`);
console.log(`  lecciones: ${c.lessons.length}${errors.length ? ` · ${errors.length} error(es), ejecuta \`bun run validate\`` : ""}`);
if (cfg.host === "127.0.0.1") console.log(`  Para usarlo desde el iPhone: tailscale serve --bg ${cfg.port}   (ver docs/setup.md)`);
