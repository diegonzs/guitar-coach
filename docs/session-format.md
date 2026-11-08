# Formato de sesiones y datos (v1)

Todo lo que la app registra vive en `data/` (gitignored), en JSON legible y archivos de medios.
Schemas: [`schema/session.schema.json`](../schema/session.schema.json), [`schema/profile.schema.json`](../schema/profile.schema.json).

```
data/
├── profile.json                 # nivel, evaluación, lección actual
├── progress.json                # agregado para LLMs (se regenera tras cada subida)
├── reports/latest.md            # informe legible (bun run report)
└── sessions/<id>/
    ├── session.json             # el registro de la sesión
    ├── grabacion.m4a | .webm | .mp4
    └── frame-01.jpg …           # fotogramas con el esqueleto dibujado
```

## `session.json`

```jsonc
{
  "formatVersion": 1,
  "id": "20261105-2014-3f9c1a2b",
  "kind": "exercise",            // exercise | free | assessment
  "mode": "camera",              // camera | audio
  "device": { "kind": "phone", "name": "iPhone" },
  "startedAt": "2026-11-05T20:14:03.120Z",
  "endedAt":   "2026-11-05T20:29:23.400Z",
  "durationSec": 920,
  "lesson":   { "id": "002-arpegio-am", "title": "…" },
  "exercise": { "id": "arpegio", "title": "…" },
  "bpm": 60, "beatUnit": 4,
  "latencyMs": 62,               // latencia compensada
  "reps":  [{ "index": 0, "clean": true, "hits": 6, "total": 6, "meanAbsDeviationMs": 18 }],
  "notes": [{                    // una por nota esperada
    "rep": 0, "event": 2, "t": 1.0,          // tiempo esperado (s desde el primer pulso)
    "expected": [60], "detected": 59,        // MIDI; detected null = no sonó
    "hit": false, "deviationMs": -12, "finger": "m"
  }],
  "extraOnsets": [{ "t": 3.71, "midi": 57 }], // sonidos que no casaron con ninguna nota (opcional)
  "timingToleranceMs": 70,       // tolerancia por nota usada (opcional)
  "posture": [{ "t": 41.2, "check": "posture.rightWrist", "value": 38.5, "message": "…", "frame": "frame-03.jpg" }],
  "cues":    [{ "t": 42.0, "level": "warn", "message": "Endereza la muñeca derecha. …" }],
  "summary": {
    "accuracy": 0.92, "meanDeviationMs": 12, "meanAbsDeviationMs": 21,
    "cleanReps": 8, "totalReps": 10, "notesExpected": 60, "notesHit": 55, "extraNotes": 2,
    "problemNotes": [{ "midi": 60, "misses": 4, "heardAs": 59 }],
    "posture": { "posture.rightWrist": 0.22 }   // fracción del tiempo en alerta
  },
  "unlockedBpm": 65,
  "userNote": "la uña del anular se engancha",
  "files": [{ "name": "frame-03.jpg", "type": "image/jpeg", "size": 81234, "kind": "frame", "t": 41.2, "caption": "Endereza la muñeca derecha" }]
}
```

- `deviationMs` > 0 significa **tarde**, < 0 **adelantado**.
- MIDI: 40 = Mi2 (6ª al aire), 45 = La2, 50 = Re3, 55 = Sol3, 59 = Si3, 64 = Mi4 (1ª al aire).
- En `kind: "assessment"` el campo `assessment` trae el resultado (nivel, pruebas, habilidades,
  respuestas) y las grabaciones se llaman `prueba-<id>.<ext>`.

## Cómo se mide

1. **Ataques (onsets):** flujo espectral con umbral adaptativo.
2. **Altura:** se compara el espectro justo después del ataque con el de justo antes. Así solo
   cuenta la energía *nueva* y las cuerdas que siguen sonando no confunden. Luego se hace una
   suma armónica con compresión espectral para cada nota de la guitarra (Mi2–Si5).
3. **Evaluación informada por la partitura:** cada ataque se empareja con la nota esperada más
   cercana dentro de una ventana (±45 % del espacio entre notas, máx. 250 ms).
4. **Clic del metrónomo:** los ataques que coinciden con un clic y no con una nota esperada se
   descartan como eco del altavoz.
5. **Postura:** MediaPipe Hands + Pose en el dispositivo. Ángulos en píxeles, suavizados, con
   histéresis. Una alerta se activa tras 1,2 s seguidos fuera de rango.

## API del servidor

| Método | Ruta | |
|---|---|---|
| GET | `/api/health` | estado y hash del currículo |
| GET | `/api/curriculum` | currículo validado (ETag) |
| GET | `/api/sessions` | lista (sin `notes`/`posture`/`cues`/`reps`/`extraOnsets`) |
| GET/PUT | `/api/sessions/:id` | sesión completa (PUT idempotente) |
| GET/PUT | `/api/sessions/:id/files/:name` | medios |
| GET/PUT | `/api/profile` | perfil (gana el `updatedAt` más reciente) |
| GET | `/api/report` | informe Markdown |
| WS | `/ws/signal?room=&role=camera\|viewer` | señalización WebRTC (2ª cámara) |
