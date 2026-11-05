/**
 * One-time setup: copies MediaPipe's wasm and downloads the hand/pose models
 * (≈ 13 MB) into app/public so everything is served locally and works offline.
 *   bun run setup
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dir, "..");
await $`bun ${resolve(root, "scripts/copy-mediapipe.ts")}`;

const models = resolve(root, "app/public/models");
await mkdir(models, { recursive: true });
const files: [string, string][] = [
  ["hand_landmarker.task", "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"],
  ["pose_landmarker_lite.task", "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"],
];
for (const [name, url] of files) {
  const dest = resolve(models, name);
  if (existsSync(dest)) {
    console.log("✓", name);
    continue;
  }
  process.stdout.write(`↓ ${name} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await writeFile(dest, new Uint8Array(await res.arrayBuffer()));
  console.log("ok");
}
console.log("\nListo. Siguiente: `bun run build && bun run start` (o `bun run dev`).");
