# Instrucciones para agentes

Este repo es **guitar-coach**. Puede que el usuario te pida dos cosas distintas:

## 1. Ser su instructor de guitarra
Sigue **[docs/llm-guide.md](docs/llm-guide.md)**. Resumen:
- `bun run report` → lee `data/reports/latest.md` y abre los fotogramas que cita.
- Escribe notas en `curriculum/notes/` y lecciones en `curriculum/lessons/` ([docs/lesson-format.md](docs/lesson-format.md)).
- `bun run validate` hasta que no haya errores.
- `curriculum/` y `data/` son privados (gitignored): **nunca los comitees**.

## 2. Trabajar en el código
- Monorepo Bun: `packages/core` (TS puro, testeado), `server` (Bun), `app` (Vite + React + shadcn/ui).
- `bun test` y `bun run typecheck` deben pasar. `bun run build` compila la app.
- UI en español. Código y comentarios en inglés.
- Tokens de diseño en `app/src/index.css` (nombres de shadcn + `success`/`warning`/`info`).
- Si cambias el formato de lecciones o sesiones: actualiza zod en `packages/core`, ejecuta
  `bun run schema` y actualiza `docs/`.
