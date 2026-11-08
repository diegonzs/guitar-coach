---
type: assessment
id: evaluacion-inicial
title: Evaluación de nivel
summary: Unos minutos tocando pruebas cortas para saber desde dónde empezar.
questions:
  - id: experiencia
    text: ¿Cuánto tiempo llevas tocando guitarra?
    options: [Estoy empezando, Menos de 6 meses, 6 meses a 2 años, Más de 2 años]
  - id: lectura
    text: ¿Qué sabes leer?
    multiple: true
    options: [Tablatura, Partitura, Cifrado de acordes, Nada todavía]
  - id: tecnicas
    text: ¿Qué técnicas ya usas?
    multiple: true
    options: [Acordes abiertos, Arpegios con p-i-m-a, Cejilla, Ligados, Trémolo, Ninguna]
stopAfterFailures: 2
exercises:
  - id: cuerdas-al-aire
    title: Cuerdas al aire con p-i-m-a
    level: 1
    skill: ritmo
    fingering: "p i m a"
    tempo: { start: 60 }
    reps: 2
    pass: { accuracy: 0.8, timingMs: 80 }
  - id: arpegio-am
    title: Arpegio en La menor
    level: 1
    skill: arpegio
    fingering: "p i m a m i"
    tempo: { start: 60 }
    reps: 3
    pass: { accuracy: 0.8, timingMs: 75 }
  - id: cambios
    title: Cambios Am – Dm – E – Am
    level: 2
    skill: cambios
    fingering: "p i m a m i"
    tempo: { start: 60 }
    reps: 1
    pass: { accuracy: 0.8, timingMs: 70 }
  - id: escala
    title: Escala de Do mayor
    level: 2
    skill: melodía
    fingering: "i m"
    tempo: { start: 80 }
    reps: 1
    pass: { accuracy: 0.85, timingMs: 65 }
  - id: melodia-bajo
    title: Melodía con bajo
    level: 3
    skill: independencia
    fingering: "p+a m i a  p+a m a m  p+i m a m  p+a m m"
    tempo: { start: 70 }
    reps: 1
    pass: { accuracy: 0.8, timingMs: 65 }
  - id: cejilla-f
    title: Arpegio con cejilla (Fa mayor)
    level: 3
    skill: cejilla
    fingering: "p i m a m i"
    tempo: { start: 70 }
    reps: 2
    pass: { accuracy: 0.8, timingMs: 65 }
  - id: tremolo
    title: Trémolo p-a-m-i
    level: 4
    skill: velocidad
    fingering: "p a m i"
    tempo: { start: 70 }
    reps: 2
    pass: { accuracy: 0.8, timingMs: 50 }
---

Cada prueba empieza con un compás de cuenta del metrónomo. Si una prueba
todavía no sabes tocarla, pulsa **"Todavía no sé"**: no pasa nada, sirve para
saber por dónde empezar. La evaluación se detiene sola tras dos pruebas falladas
seguidas.

```alphatex exercise=cuerdas-al-aire
\ts 4 4
:4 0.6 0.3 0.2 0.1 | 0.5 0.3 0.2 0.1
```

```alphatex exercise=arpegio-am
\ts 3 4
:8 0.5{lr} 2.3{lr} 1.2{lr} 0.1{lr} 1.2{lr} 2.3{lr}
```

```alphatex exercise=cambios
\ts 3 4
:8 0.5{lr} 2.3{lr} 1.2{lr} 0.1{lr} 1.2{lr} 2.3{lr} | 0.4{lr} 2.3{lr} 3.2{lr} 1.1{lr} 3.2{lr} 2.3{lr} | 0.6{lr} 1.3{lr} 0.2{lr} 0.1{lr} 0.2{lr} 1.3{lr} | 0.5{lr} 2.3{lr} 1.2{lr} 0.1{lr} 1.2{lr} 2.3{lr}
```

```alphatex exercise=escala
\ts 4 4
:4 3.5 0.4 2.4 3.4 | 0.3 2.3 0.2 1.2 | 1.2 0.2 2.3 0.3 | 3.4 2.4 0.4 3.5
```

```alphatex exercise=melodia-bajo
\ts 4 4
\voice // melodía
:4 0.1 0.1 1.1 3.1 | 3.1 1.1 0.1 3.2 | 1.2 1.2 3.2 0.1 | 0.1 3.2 3.2.2
\voice // bajo: cada nota se sostiene todo el compás
:1 3.5 | 3.6 | 3.5 | 3.6
```

```alphatex exercise=cejilla-f
\ts 3 4
:8 1.6{lr} 2.3{lr} 1.2{lr} 1.1{lr} 1.2{lr} 2.3{lr}
```

```alphatex exercise=tremolo
\ts 4 4
:16 0.5{lr} 0.1 0.1 0.1 0.5{lr} 0.1 0.1 0.1 0.4{lr} 0.1 0.1 0.1 0.4{lr} 0.1 0.1 0.1
```
