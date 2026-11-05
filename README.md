# guitar-coach

**Tu instructor de guitarra, en tu propia red.** Un LLM diseña tus lecciones y revisa tu
práctica. La app te escucha y te mira mientras tocas, y te corrige en vivo: notas, tiempo y
postura. Funciona en el iPhone sin conexión y sincroniza con tu laptop.

> Pensado para guitarra clásica *fingerstyle* (arreglos de melodía + bajo), pero el formato de
> lecciones sirve para cualquier ejercicio en tablatura.

| | |
|---|---|
| 🎯 **Evaluación de nivel** | Cuestionario y pruebas cortas que se adaptan; te dice desde qué lección empezar. |
| 🎼 **Lecciones en texto** | Markdown + [alphaTex](https://alphatab.net/docs/alphatex/introduction). Las escribe tu LLM y se validan con `bun run validate`. |
| 🎧 **Te escucha** | Detecta qué nota tocaste y si fue a tiempo, incluso en arpegios con cuerdas sonando. Afinador incluido. |
| 📷 **Te mira** | MediaPipe en el dispositivo: muñecas, pulgar izquierdo y hombros. Borde de color e indicaciones por voz. |
| ⏱️ **Escalera de tempo** | Sube 5 BPM solo cuando completas N repeticiones limpias. |
| 📴 **Offline-first** | PWA instalable. Practicas en el sofá solo con el teléfono y sincroniza cuando vuelves. |
| 📱 **iPhone como 2ª cámara** | Enfoca tu mano derecha mientras la laptop te ve de frente (WebRTC dentro de tu red). |
| 🤖 **Informe para tu LLM** | `bun run report`: precisión, notas problemáticas, postura, fotogramas y tus comentarios. |

Diseño: [mockups](docs/design/mobile.html) · Stack: Bun · Vite · React · Tailwind · shadcn/ui · MediaPipe · Dexie.

## Empezar

```bash
bun install
bun run setup     # MediaPipe + modelos (~13 MB)
bun run build
bun run start     # http://127.0.0.1:4321
```

Desde el iPhone: `tailscale serve --bg 4321`, abre la URL en Safari y **Añadir a pantalla de
inicio**. Detalles en [docs/setup.md](docs/setup.md).

## Conecta tu LLM

1. Haz la evaluación de nivel en la app.
2. Pide a tu LLM que siga [docs/llm-guide.md](docs/llm-guide.md). Creará `curriculum/` (privado,
   en `.gitignore`) con lecciones en el [formato documentado](docs/lesson-format.md).
3. Practica. Cada cierto tiempo pídele que lea `bun run report` y te deje una nota. La verás en
   la pantalla **Hoy**.

Con Claude Code, Codex u otros agentes que leen `AGENTS.md`, basta con abrir el repo y decir
"sé mi instructor de guitarra".

## Estructura

```
packages/core   formato de lecciones, parser alphaTex, DSP (notas/afinador), evaluación
server          Bun: API de sincronización, currículo, informes, señalización WebRTC
app             PWA (Vite + React + shadcn/ui)
examples        currículo de ejemplo (curso, evaluación, 6 lecciones)
schema          JSON Schemas generados
docs            plan, formatos, guía para LLMs, instalación, mockups
```

## Privacidad

Sin cuentas ni nube. El servidor escucha solo en `127.0.0.1` y lo expones a tu tailnet con
`tailscale serve`. El análisis de audio y video corre en tu dispositivo. Grabaciones, progreso y
lecciones viven en `data/` y `curriculum/`, que nunca se publican.

## Licencia

MIT
