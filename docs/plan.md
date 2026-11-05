# Plan y arquitectura

## Visión

Un instructor de guitarra que vive en tu red. Un **LLM** diseña las lecciones y revisa tu
práctica. La **app** te acompaña mientras tocas: metrónomo, tablatura, detección de notas,
tiempo y postura en vivo. Todo queda en tus dispositivos.

```
 LLM ──escribe──▶ curriculum/ (lecciones, notas)
  ▲                    │
  │                    ▼
 data/reports ◀── servidor Bun (laptop) ◀──sync──▶ PWA (iPhone / laptop)
  (informe +           │                              │
   fotogramas)         └── tailscale serve (HTTPS) ───┘
```

## Decisiones

| Decisión | Por qué |
|---|---|
| **PWA offline-first** | Practicar en cualquier lugar solo con el teléfono; la laptop es el "servidor" cuando está disponible. |
| **Sincronización en un solo sentido por tipo de dato** | Sesiones: dispositivo → servidor (inmutables, PUT idempotente). Currículo: servidor → dispositivo. Perfil: gana el más reciente. Así no hay conflictos. |
| **Servidor Bun sin base de datos** | JSON y archivos que un LLM puede leer directamente. |
| **alphaTex** para la música | Texto que los LLMs escriben bien; compatible con alphaTab (comprobado por un test). |
| **Evaluación informada por la partitura** | Sabemos qué nota debería sonar y cuándo, así que verificar es mucho más fiable que transcribir a ciegas. |
| **DSP propio** (flujo espectral + suma armónica sobre la energía *nueva*) | Funciona con cuerdas que siguen sonando (arpegios), es ligero y corre en tiempo real en el iPhone. Probado con síntesis de cuerda pulsada. |
| **MediaPipe Hands + Pose en el dispositivo** | Mejor equilibrio precisión/velocidad en navegador y móvil; el video no sale del dispositivo. |
| **Indicaciones entre repeticiones** | Mientras tocas no puedes leer: borde de color (semáforo) + voz corta al terminar cada repetición. |
| **Escalera de tempo** | Subir 5 BPM solo después de N repeticiones limpias. |
| **Currículo privado, formato público** | El repo publica el formato, el validador, la guía para LLMs y ejemplos; tus lecciones y datos no. |

## Qué se construyó (v0.1)

- [x] Formato de lecciones, evaluación, curso y notas; validador CLI y JSON Schemas
- [x] Parser alphaTex (subconjunto) compatible con alphaTab
- [x] Detección de ataques y notas (polifonía con cuerdas que siguen sonando), afinador MPM
- [x] Evaluación por repetición, tempo desbloqueable, notas problemáticas
- [x] Postura: muñecas, pulgar izquierdo (con calibración del mástil) y hombros; fotogramas automáticos
- [x] Indicaciones en vivo (semáforo, mensajes, voz) y calibración de latencia (altavoz o tocando)
- [x] Modo evaluación de nivel adaptativo (cuestionario y pruebas por nivel)
- [x] PWA instalable y offline, sincronización con la laptop, limpieza de medios
- [x] iPhone como segunda cámara (WebRTC por la red local o tailnet)
- [x] Informe para el LLM (`bun run report`) y `data/progress.json`
- [x] Tests: núcleo, servidor y prueba de humo en el navegador

## Limitaciones conocidas

- La detección de altura está validada con síntesis; en una guitarra real puede necesitar
  ajustes de umbrales. Los fallos se ven en `problemNotes` y en los informes.
- La postura en 2D es aproximada (depende del ángulo de la cámara). Saber qué dedo (p-i-m-a)
  pulsó cada cuerda no es fiable con video: la digitación se muestra pero no se evalúa.
- Los efectos (ligados, slides, armónicos) se aceptan en las lecciones pero no se evalúan.
- WebRTC sin STUN: ambos dispositivos deben verse directamente (misma red o tailnet).

## Ideas siguientes

- Evaluar ligados y armónicos; dinámica (melodía más fuerte que el bajo).
- Modelo de transcripción polifónica (p. ej. basic-pitch) para la práctica libre.
- Reproducción de la lección con sonido de guitarra (alphaTab player).
- Recordatorios diarios (notificaciones web push en iOS ≥ 16.4 con la PWA instalada).
