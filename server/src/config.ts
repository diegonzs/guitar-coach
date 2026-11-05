import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");

function curriculumDir(): { dir: string; isExample: boolean } {
  if (process.env.CURRICULUM_DIR) return { dir: resolve(process.env.CURRICULUM_DIR), isExample: false };
  const own = resolve(ROOT, "curriculum");
  if (existsSync(own)) return { dir: own, isExample: false };
  return { dir: resolve(ROOT, "examples/curriculum"), isExample: true };
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  curriculumDir: string;
  curriculumIsExample: boolean;
  appDist: string;
  /** Max upload size per file, in bytes. */
  maxUpload: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = curriculumDir();
  return {
    port: Number(env.PORT ?? 4321),
    // Local only by default; expose it to your tailnet with `tailscale serve` (HTTPS).
    host: env.HOST ?? "127.0.0.1",
    dataDir: resolve(env.DATA_DIR ?? resolve(ROOT, "data")),
    curriculumDir: c.dir,
    curriculumIsExample: c.isExample,
    appDist: resolve(env.APP_DIST ?? resolve(ROOT, "app/dist")),
    maxUpload: Number(env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024,
  };
}
