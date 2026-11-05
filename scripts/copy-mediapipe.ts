/** Copies MediaPipe's wasm runtime into app/public so the server can serve it (offline-capable). */
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(resolve(import.meta.dir, "../app/package.json"));
const pkgDir = dirname(require.resolve("@mediapipe/tasks-vision"));
const out = resolve(import.meta.dir, "../app/public/mediapipe/wasm");
await mkdir(out, { recursive: true });
await cp(resolve(pkgDir, "wasm"), out, { recursive: true });
console.log("mediapipe wasm →", out);
