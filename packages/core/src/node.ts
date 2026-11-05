/** Node/Bun-only helpers (filesystem). */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { buildCurriculum, type Curriculum, type SourceFile } from "./lesson.ts";

async function walk(dir: string, root: string, out: SourceFile[], depth = 0) {
  if (depth > 3) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, root, out, depth + 1);
    else if (/\.(md|ya?ml)$/i.test(e.name)) {
      const s = await stat(p);
      if (s.size > 512 * 1024) continue;
      out.push({ path: relative(root, p).split(sep).join("/"), content: await readFile(p, "utf8") });
    }
  }
}

export async function readCurriculumFiles(dir: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  await walk(dir, dir, out);
  return out;
}

export async function loadCurriculum(dir: string): Promise<Curriculum> {
  return buildCurriculum(await readCurriculumFiles(dir));
}
