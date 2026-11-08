# Formato de lecciones (v1)

Un **currículo** es una carpeta de archivos de texto. La app lo lee desde `./curriculum/`
(que no se sube a git). Si no existe, usa `./examples/curriculum/`.

```
curriculum/
├── course.yaml          # curso, meta, unidades y rutina diaria   (opcional)
├── assessment.md        # evaluación de nivel                      (opcional)
├── lessons/*.md         # una lección por archivo
└── notes/*.md           # mensajes del instructor para el alumno  (opcional)
```

Valida siempre con:

```bash
bun run validate            # ./curriculum o, si no existe, el ejemplo
bun run validate otra/carpeta --json
```

JSON Schemas para editores y LLMs: [`schema/`](../schema). Se regeneran con `bun run schema`.

---

## `course.yaml`

```yaml
title: Guitarra clásica fingerstyle
description: Del primer arpegio a tocar arreglos sencillos.
goal:
  title: Nate's Theme (Uncharted 4)
  description: Arreglo fingerstyle completo.
  level: 4
units:
  - { id: fundamentos, title: Fundamentos, level: 1, description: Postura, p-i-m-a… }
  - { id: independencia, title: Independencia de manos, level: 2 }
dailyRoutine:                      # aparece en "Práctica de hoy"
  - { kind: tuner, title: Afinar y calentar, minutes: 5 }
  - { kind: lesson, title: Lección del día, minutes: 15 }
  - { kind: free, title: Toca lo que quieras, minutes: 10 }
```

`kind` puede ser `tuner`, `lesson`, `free` o `review`.

---

## Lección: `lessons/<id>.md`

Frontmatter YAML y luego Markdown libre. Cada ejercicio declarado en el frontmatter
**debe** tener un bloque de código `alphatex` con `exercise=<id>` en el cuerpo. La app
dibuja la tablatura justo donde está el bloque.

````markdown
---
id: 002-arpegio-am            # minúsculas, números y guiones; único
title: Arpegio p-i-m-a en La menor
unit: fundamentos             # id de una unidad de course.yaml
level: 1                      # 1–5
order: 2                      # orden dentro de la unidad
summary: Tu primer arpegio con un acorde formado.
goals: [Formar Am sin zumbidos, Arpegio parejo]
tags: [arpegio, mano-derecha]
estimatedMinutes: 15
exercises:
  - id: arpegio
    title: Arpegio en Am
    instructions: Mantén el pulgar por delante de los dedos.   # se muestra al practicar
    fingering: "p i m a m i"   # mano derecha, uno por golpe (se repite si es más corto)
    tempo: { start: 50, target: 80, step: 5 }
    cleanRepsToAdvance: 10     # repeticiones limpias para desbloquear el siguiente tempo
    timingToleranceMs: 70      # desviación aceptable
    beatUnit: 4                # 4 = el metrónomo marca negras; 8 = corcheas
    loop: true                 # se repite en bucle hasta que el alumno pare
    checks: [notes, timing, posture.rightWrist, posture.leftThumb]
---

## Ejercicio

```alphatex exercise=arpegio
\ts 3 4
:8 0.5 2.3 1.2 0.1 1.2 2.3
```
````

### Campos de cada ejercicio

| Campo | Por defecto | Qué hace |
|---|---|---|
| `tempo.start` | — | BPM inicial |
| `tempo.target` | `start` | BPM al que el ejercicio se considera **dominado** |
| `tempo.step` | 5 | cuánto sube el tempo al desbloquear |
| `cleanRepsToAdvance` | 8 | repeticiones limpias seguidas o no, en una sesión, para desbloquear |
| `timingToleranceMs` | 70 | una repetición es limpia si todas las notas suenan y la desviación media ≤ esto |
| `fingering` | — | `p i m a c`, acordes con `+` (`p+m`), `-` sin indicar |
| `checks` | `[notes, timing]` | qué evalúa la app (ver abajo) |
| `beatUnit` | 4 | figura del pulso del metrónomo |
| `loop` | true | `false` = se toca una vez y termina |

### `checks`

| Valor | Qué revisa | Necesita |
|---|---|---|
| `notes` | que suenen las notas correctas | micrófono |
| `timing` | que caigan a tiempo con el metrónomo | micrófono |
| `posture.rightWrist` | muñeca derecha doblada (> 35°) | cámara |
| `posture.leftWrist` | muñeca izquierda colapsada (> 45°) | cámara |
| `posture.leftThumb` | pulgar izquierdo asomando por encima del mástil | cámara + calibración del mástil |
| `posture.shoulders` | hombros desnivelados (> 8°) | cámara |

---

## Música: subconjunto de alphaTex

Los bloques son [alphaTex](https://alphatab.net/docs/alphatex/introduction) válido; un test
compara nuestro parser con el oficial de alphaTab. Afinación estándar, cuerda **1 = Mi agudo**.

| Sintaxis | Significado |
|---|---|
| `\ts 3 4` | compás (al principio) |
| `:4` `:8` `:16` | duración por defecto (negra, corchea, semicorchea…) |
| `2.3` | traste 2 de la cuerda 3 |
| `2.3.8` | lo mismo, con duración propia (corchea) |
| `(0.5 2.3 1.2)` | acorde; `(0.5 1.2).2` con duración |
| `r` / `r.4` | silencio |
| `0.1*4` | repetir el golpe 4 veces |
| `3.2.4{d}` | con puntillo |
| `0.1{tu 3}` | tresillo |
| `0.5{lr}` | dejar sonar (*let ring*): suena hasta el final del compás; en acordes `(0.5{lr} 2.3{lr})`, con duración `0.5{lr}.4` |
| `\voice` | empieza una voz; va antes de **cada** voz, también la primera (ver abajo) |
| `\|` | barra de compás |
| `// comentario` | comentario |

Los efectos de articulación (`h`, `p`, `sl`, `v`, `lf`, `rf`, `nh`…) se aceptan pero la app
todavía no los evalúa. `\tempo` se ignora: manda `tempo.start`. No se admiten notas muertas (`x`)
porque no se pueden evaluar.

### Cuánto dura cada nota

Al practicar, cada nota dibuja una estela que le dice al alumno **cuánto tiempo mantenerla
sonando** (y las notas largas se ven de antemano en gris). Esa duración sale de la partitura:

- **Una voz:** cada nota dura su figura. `:4 0.1 0.1` → dos negras.
- **Dejar sonar:** `{lr}` hace que la nota suene hasta el final del compás. Es lo normal en
  arpegios: `:8 0.5{lr} 2.3{lr} 1.2{lr} 0.1{lr} 1.2{lr} 2.3{lr}`.
- **Varias voces:** para un bajo que se sostiene bajo la melodía, escribe cada parte en su voz.
  Las voces corren en paralelo y cada una tiene sus compases:

  ```
  \ts 4 4
  \voice // melodía
  :4 0.1 0.1 1.1 3.1 | 3.1 1.1 0.1 3.2
  \voice // bajo: redondas, suenan todo el compás
  :1 3.5 | 3.6
  ```

  Las notas que empiezan a la vez en distintas voces forman **un solo golpe** (para la
  digitación y la evaluación): el ejemplo tiene los mismos 8 golpes que
  `:4 (0.1 3.5) 0.1 1.1 3.1 | (3.1 3.6) 1.1 0.1 3.2`, pero ahora la app sabe que el bajo dura
  todo el compás. `\voice` va antes de **cada** voz, también la primera: sin él, alphaTab lee la
  segunda voz como compases nuevos (el validador lo marca como error). Dos voces no pueden
  tocar la misma cuerda a la vez.
- En todos los casos, una cuerda deja de sonar cuando se vuelve a pulsar.

> **Derechos de autor:** usa melodías de dominio público o tus propios ejercicios. No copies
> arreglos ajenos en un repositorio público; el currículo personal (`curriculum/`) no se publica.

---

## Evaluación: `assessment.md`

Igual que una lección, con `type: assessment`, preguntas y pruebas (`exercises`) que
indican el **nivel** que demuestran:

```yaml
---
type: assessment
id: evaluacion-inicial
title: Evaluación de nivel
stopAfterFailures: 2          # se detiene tras N fallos (o saltos) seguidos
questions:
  - { id: experiencia, text: ¿Cuánto llevas tocando?, options: [Estoy empezando, Más de 2 años] }
  - { id: tecnicas, text: ¿Qué técnicas usas?, multiple: true, options: [Cejilla, Trémolo] }
exercises:
  - id: arpegio-am
    title: Arpegio en La menor
    level: 1                  # nivel que demuestra
    skill: arpegio            # habilidad (agrupa resultados)
    fingering: "p i m a m i"
    tempo: { start: 60 }
    reps: 3                   # veces seguidas que se toca
    pass: { accuracy: 0.8, timingMs: 75 }
---
```

**Nivel resultante** = el nivel más alto cuyas pruebas se superaron *todas*.
La lección recomendada es la primera con `level = nivel + 1`.

---

## Notas del instructor: `notes/<fecha>-<tema>.md`

```markdown
---
title: Buen avance con el arpegio
date: 2026-11-05
lesson: 002-arpegio-am        # opcional
---
Tu tiempo mejoró mucho. Esta semana: muñeca derecha recta…
```

La más reciente aparece en la pantalla **Hoy**.
