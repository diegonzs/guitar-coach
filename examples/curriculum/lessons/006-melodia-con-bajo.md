---
id: 006-melodia-con-bajo
title: Melodía con bajo
unit: primeros-arreglos
level: 3
order: 1
summary: "Tu primer mini arreglo: la melodía arriba y el bajo en el tiempo fuerte."
goals:
  - Hacer sonar la melodía por encima del bajo
  - Coordinar ambas manos en las pinzas
tags: [arreglo, melodía, bajo]
estimatedMinutes: 20
exercises:
  - id: oda-con-bajo
    title: Himno de la alegría con bajo
    fingering: "p+a m i a  p+a m a m  p+i m a m  p+a m m"
    tempo: { start: 50, target: 90, step: 5 }
    cleanRepsToAdvance: 6
    checks: [notes, timing, posture.rightWrist, posture.leftThumb]
---

## Melodía con bajo

En el primer tiempo de cada compás tocas el bajo (Do o Sol) junto con la nota de
la melodía. Haz que la melodía suene **un poco más fuerte** que el bajo.

```alphatex exercise=oda-con-bajo
\ts 4 4
\voice // melodía
:4 0.1 0.1 1.1 3.1 | 3.1 1.1 0.1 3.2 | 1.2 1.2 3.2 0.1 | 0.1 3.2 3.2.2
\voice // bajo: cada nota se sostiene todo el compás
:1 3.5 | 3.6 | 3.5 | 3.6
```
