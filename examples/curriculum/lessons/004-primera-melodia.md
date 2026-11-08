---
id: 004-primera-melodia
title: Escala de Do y primera melodía
unit: independencia
level: 2
order: 2
summary: Leer y tocar melodías en primera posición alternando i y m.
goals:
  - Escala de Do mayor en primera posición
  - Alternar i-m sin repetir dedo
  - Tocar una melodía conocida
tags: [melodía, escala, lectura]
estimatedMinutes: 20
exercises:
  - id: escala-do
    title: Escala de Do mayor (subida y bajada)
    instructions: Alterna i y m. Un dedo de la mano izquierda por traste.
    fingering: "i m"
    tempo: { start: 60, target: 100, step: 5 }
    cleanRepsToAdvance: 6
    checks: [notes, timing, posture.leftThumb]
  - id: oda
    title: Himno de la alegría (Beethoven)
    fingering: "m i m i  m i m i  m i m i  m i m"
    tempo: { start: 60, target: 100, step: 5 }
    cleanRepsToAdvance: 6
    checks: [notes, timing]
---

## Escala de Do mayor

Do (cuerda 5, traste 3) – Re – Mi – Fa – Sol – La – Si – Do (cuerda 2, traste 1).

```alphatex exercise=escala-do
\ts 4 4
:4 3.5 0.4 2.4 3.4 | 0.3 2.3 0.2 1.2 | 1.2 0.2 2.3 0.3 | 3.4 2.4 0.4 3.5
```

## Himno de la alegría

Melodía de dominio público (Beethoven, 9ª sinfonía).

```alphatex exercise=oda
\ts 4 4
:4 0.1 0.1 1.1 3.1 | 3.1 1.1 0.1 3.2 | 1.2 1.2 3.2 0.1 | 0.1 3.2 3.2.2
```
