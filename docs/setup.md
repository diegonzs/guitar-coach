# Instalación y uso

## Requisitos

- [Bun](https://bun.sh) ≥ 1.3
- Una laptop que hará de servidor (macOS, Linux o Windows)
- Opcional: [Tailscale](https://tailscale.com) para usarla desde el teléfono, en casa o fuera

## Primera vez

```bash
git clone https://github.com/<tu-usuario>/guitar-coach && cd guitar-coach
bun install
bun run setup        # copia MediaPipe y descarga los modelos de manos/cuerpo (~13 MB)
bun run build        # compila la app
bun run start        # http://127.0.0.1:4321
```

Abre <http://127.0.0.1:4321> en la laptop. Sin `curriculum/` propio, usa el ejemplo.

Para desarrollar: `bun run dev` levanta el servidor (4321) y Vite (5173) con recarga en caliente.

## Tu currículo

```bash
cp -r examples/curriculum curriculum     # o pide a tu LLM que lo cree (docs/llm-guide.md)
bun run validate
```

`curriculum/` y `data/` están en `.gitignore`: tus lecciones, grabaciones y progreso nunca
se publican.

## Usarla desde el iPhone (Tailscale)

El navegador solo permite micrófono, cámara y modo sin conexión con **HTTPS**. Tailscale lo
resuelve con un certificado válido para tu dominio `*.ts.net`:

```bash
bun run start                     # el servidor escucha solo en 127.0.0.1 (seguro por defecto)
tailscale serve --bg 4321         # lo publica en https://<tu-laptop>.<tu-tailnet>.ts.net (solo tu tailnet)
tailscale serve status            # muestra la URL
```

En el iPhone (con la app de Tailscale conectada):

1. Abre la URL en **Safari**.
2. **Compartir → Añadir a pantalla de inicio.** Es importante: en iOS solo así los datos
   pendientes de sincronizar están a salvo y la app funciona sin conexión.
3. Ábrela desde el ícono → **Ajustes → Preparar para usar sin conexión** (descarga la detección
   de postura ~43 MB y las lecciones).
4. **Ajustes → Latencia → Calibrar.**

Para dejar de publicarla: `tailscale serve --https=443 off`.

### Cómo funciona sin conexión

- Lecciones, metrónomo, afinador, detección de notas y de postura corren **en el teléfono**.
- Las sesiones se guardan en el teléfono y se suben a la laptop cuando vuelve a estar
  disponible (al abrir la app, cada minuto y al recuperar la red).
- En iOS no hay sincronización en segundo plano: abre la app para que suba lo pendiente.
- Las grabaciones ya subidas se borran del teléfono a los 7 días (configurable). Siguen en
  la laptop.

## iPhone como segunda cámara

En la laptop: **Práctica → Cámara → "Usar el iPhone como 2ª cámara"** y escanea el QR.
El video va directo de un dispositivo al otro por WebRTC, dentro de tu red o tailnet. No se usan
servidores STUN/TURN externos.

## Variables de entorno del servidor

| Variable | Por defecto | |
|---|---|---|
| `PORT` | 4321 | |
| `HOST` | 127.0.0.1 | usa `0.0.0.0` solo si sabes lo que haces (no hay autenticación) |
| `DATA_DIR` | `./data` | sesiones, perfil, informes |
| `CURRICULUM_DIR` | `./curriculum` o `./examples/curriculum` | |
| `MAX_UPLOAD_MB` | 500 | tamaño máximo por archivo |

## Mantenerlo encendido

Deja una terminal con `bun run start` (o configúralo como servicio de tu sistema). Si la laptop
está apagada, la app del teléfono sigue funcionando y sincroniza después.

## Tests

```bash
bun test                                  # núcleo (formato, DSP, evaluación) + servidor
bun run typecheck
bun scripts/e2e/make-audio.ts && bun scripts/e2e/smoke.ts http://127.0.0.1:4321   # navegador (Chrome)
```
