#!/usr/bin/env bun
/**
 * Validates a curriculum folder. Designed to be run by humans *and* LLMs:
 *   bun run validate [folder]        (default: ./curriculum, else ./examples/curriculum)
 *   bun run validate folder --json   machine-readable output
 * Exit code 1 when there are errors.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadCurriculum } from "../node.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = resolve(import.meta.dir, "../../../..");
const target = args.find((a) => !a.startsWith("--")) ?? (existsSync(resolve(root, "curriculum")) ? resolve(root, "curriculum") : resolve(root, "examples/curriculum"));
const dir = resolve(process.cwd(), target);
if (!existsSync(dir)) {
  console.error(`No existe la carpeta ${dir}`);
  process.exit(2);
}
const c = await loadCurriculum(dir);
const errors = c.issues.filter((i) => i.level === "error");
if (json) {
  console.log(JSON.stringify({ ok: errors.length === 0, dir, lessons: c.lessons.map((l) => l.id), assessment: c.assessment?.id ?? null, issues: c.issues }, null, 2));
} else {
  console.log(`Currículo: ${dir}`);
  console.log(`  curso: ${c.course ? c.course.title : "(sin course.yaml)"}`);
  console.log(`  lecciones válidas: ${c.lessons.length}${c.lessons.length ? "  → " + c.lessons.map((l) => l.id).join(", ") : ""}`);
  console.log(`  evaluación: ${c.assessment ? c.assessment.id + ` (${c.assessment.exercises.length} pruebas)` : "(sin assessment.md)"}`);
  console.log(`  notas del instructor: ${c.notes.length}`);
  for (const i of c.issues) console.log(`${i.level === "error" ? "✗ ERROR" : "! aviso"}  ${i.file}${i.line ? ":" + i.line : ""}  ${i.message}`);
  console.log(errors.length ? `\n${errors.length} error(es).` : "\n✓ Todo válido.");
}
process.exit(errors.length ? 1 : 0);
