/** Generates JSON Schemas (for editors and LLMs) from the zod definitions. */
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LessonMetaSchema, AssessmentMetaSchema, CourseSchema, NoteMetaSchema } from "../src/lesson.ts";
import { SessionSchema, ProfileSchema } from "../src/session.ts";

const out = resolve(import.meta.dir, "../../../schema");
await mkdir(out, { recursive: true });
const items: [string, z.ZodType, string][] = [
  ["lesson.frontmatter.schema.json", LessonMetaSchema, "Frontmatter de una lección (lessons/*.md)"],
  ["assessment.frontmatter.schema.json", AssessmentMetaSchema, "Frontmatter de la evaluación (assessment.md)"],
  ["course.schema.json", CourseSchema, "course.yaml"],
  ["note.frontmatter.schema.json", NoteMetaSchema, "Frontmatter de una nota del instructor (notes/*.md)"],
  ["session.schema.json", SessionSchema, "Registro de una sesión de práctica (data/sessions/<id>/session.json)"],
  ["profile.schema.json", ProfileSchema, "Perfil del estudiante (data/profile.json)"],
];
for (const [file, schema, title] of items) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  json.title = title;
  await writeFile(resolve(out, file), JSON.stringify(json, null, 2) + "\n");
  console.log("schema/" + file);
}
