# ADR-017 — Server-Sent Events (SSE) para chat realtime

- **Estado**: Accepted
- **Fecha**: 2026-04-30 (decisión); 2026-05-03 (ADR escrito retroactivo)
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede**: —

## Contexto

El chat entre `transportista` y `generador de carga` dentro de una asignación activa necesita propagar mensajes nuevos al receptor en menos de 1 segundo cuando ambos están con la PWA abierta. Casos de uso:

- Driver manda "Llegando en 15 min" → shipper lo ve sin refresh.
- Shipper manda "Cargá por la puerta C" → driver lo ve sin refresh.
- Sistema inserta un mensaje (cambio de estado del viaje) → ambos lados lo ven.

El chat **NO** es financial trading: tolerancia a 200-1000ms de latencia, tolerancia a perder un mensaje aislado (que se recupera al refetch). El path crítico para "tab cerrada" lo cubre Web Push (ADR-016) — este ADR es solo para el caso "tab abierta".

Espacio de decisión:

- **WebSocket** (RFC 6455) — bidireccional, full-duplex.
- **SSE** (HTML5 EventSource) — server-to-client unidireccional.
- **Long polling** — simulación pre-realtime con HTTP estándar.
- **Fetch streaming con ReadableStream** — moderno pero soporte browser dispar.

## Decisión

Usar **Server-Sent Events (SSE)** para el push server→cliente. Implementación:

- **Endpoint** `GET /assignments/:id/messages/stream` (Hono, `apps/api/src/routes/...`): `Content-Type: text/event-stream`, mantiene la conexión abierta, escribe `data: {json}\n\n` por cada mensaje nuevo.
- **Cliente** `apps/web/src/hooks/use-chat-stream.ts`: hook React que abre `new EventSource(url)`, escucha `message`, dispara callback `onMessage` que invalida cache de TanStack Query o appendea al cache local. Reconnect manual con exponential backoff (1s → 2s → 4s → … → 30s max) además del reconnect nativo de EventSource — el nativo a veces "se duerme" en errores transitorios.
- **Auth**: el endpoint requiere Firebase ID token. Como `EventSource` **no soporta headers custom**, el token va como query param `?auth=<token>`. El middleware `firebase-auth.ts:52` tiene un branch especial para SSE que lee del query string. Trade-off documentado abajo.
- **Backend del push real**: Pub/Sub topic `chat-messages` + subscription efímera por viewer (ver ADR-018). El handler SSE itera el `AsyncIterable` que devuelve la subscription y stream-ea cada mensaje al cliente.

## Alternativas consideradas y rechazadas

### A. WebSocket (RFC 6455)

Bidireccional, full-duplex, con framing eficiente y headers en el handshake.

- **Por qué se rechazó (para chat)**:
  - **Cloud Run no soporta WebSocket bien**: hasta 2024 era una limitación dura; en 2025 se habilitó pero con tradeoffs (timeout 60min, una conexión cuenta como una request en términos de billing/quota, instances no scale-down mientras hay sockets abiertos). Para una PWA donde típicamente hay 50-200 viewers concurrent en la región Chile, eso es 50-200 instances permanentes — overhead de costo y complejidad operativa.
  - **Bidireccionalidad innecesaria**: el chat no necesita bidi para realtime. El cliente envía mensajes via `POST /assignments/:id/messages` (HTTP estándar), y el server le notifica con SSE. WebSocket sería sobre-arquitectura.
  - **HTTP/2 multiplexing**: SSE corre sobre HTTP/2 normal, comparte conexión TCP con el resto de las requests al api. WebSocket abre una conexión TCP dedicada por socket — desperdicio.

### B. Long polling

`GET /assignments/:id/messages?wait=30s` que bloquea hasta que aparezca un mensaje nuevo o expire el timeout.

- **Por qué se rechazó**: cada poll consume una request slot del cliente y del servidor, no permite el server iniciar el push sin un cliente esperando, y el code en cliente para manejar timeouts + reconnects es más feo que SSE. SSE es lo que se inventó para reemplazar long polling.

### C. Fetch streaming con ReadableStream

`fetch(url).then(res => res.body.getReader())` — moderno, soporta `AbortController` y headers custom (resuelve el trade-off de auth de SSE).

- **Por qué se rechazó**:
  - Soporte browser dispar — Safari iOS tenía bugs hasta 2024 con streaming responses (gzip, buffering del proxy).
  - No hay reconnect nativo — todo el código de retry hay que escribirlo.
  - El stack de Hono no tiene helper específico para fetch streaming; SSE sí (`streamSSE` helper).
- **Reevaluación futura**: cuando Safari iOS estabilice + el stack tenga primitive native, migrar para eliminar el query param `?auth=`.

### D. Firestore real-time listener (`onSnapshot`)

Aprovechar Firestore que ya está configurado (ADR-005) para `tracking` de viajes.

- **Por qué se rechazó**: requiere duplicar los mensajes de chat en Firestore (costo de write extra + sincronización con Postgres canónico) o mover el storage primario de chat a Firestore (rompe consistencia con el resto de domain en Postgres). Pub/Sub + SSE mantiene el storage canónico en Postgres y solo notifica realtime.

### E. Polling cliente cada 5s

Simple y robusto, pero alto costo de battery + tráfico.

- **Por qué se rechazó (para realtime de chat)**: latencia 5s degrada UX percibido. Pero se mantiene como **fallback** cuando SSE no conecta — `useChatStream` con `enabled: false` y `useQuery` con `refetchInterval` de fondo hace el equivalente.

## Consecuencias

### Positivas

- **Latencia <1s**: empíricamente 200-500ms desde `INSERT` en Postgres hasta render en cliente.
- **Cloud Run friendly**: SSE consume una request HTTP normal, suma 1 a `concurrency` mientras está abierta, no bloquea autoscaling como WebSocket. Una instance Cloud Run con `concurrency=80` aguanta 80 SSE concurrent sin problema.
- **Reconnect nativo + manual**: EventSource hace reconnect automático en errores transitorios. El backoff manual del hook cubre los casos donde el nativo falla (server explícitamente cierra, error 401 por token expirado, etc.).
- **Compatible HTTP/1.1 y HTTP/2**: el LB delante del Cloud Run (Global HTTPS LB con NEGs) hace passthrough sin tocar el stream.
- **Auth con Firebase token**: aunque va como query param (workaround), el resto del stack reusa el mismo middleware.
- **Stack mínimo**: Hono `streamSSE` helper + EventSource del browser. ~40 líneas en server, ~80 en cliente.

### Negativas

- **Token Firebase en query string**: el token aparece en logs server + posibles caches de proxies entre cliente y server. Mitigación:
  - Token Firebase TTL = 1h, scope-bounded.
  - URL HTTPS only (no MITM en transit).
  - El cliente que abre el SSE es el mismo cliente que tiene el token — no se filtra a terceros.
  - Logs estructurados Pino redactan `auth=` con serializer (a verificar en `apps/api/src/middleware/firebase-auth.ts`).
- **No bidirectional**: para enviar mensaje, cliente hace `POST /messages` separado. UX OK porque el cliente no espera respuesta; pero hay un round-trip extra vs WebSocket.
- **Buffering de proxies**: si algún proxy intermedio buffer-ea el response, los mensajes llegan en batches. Mitigación: header `X-Accel-Buffering: no` en el response del SSE + Hono `streamSSE` helper que mete keepalive frames cada 15s.
- **Cleanup en desconexión abrupta**: si el cliente cierra la tab sin disconnect (kill -9 al browser), el handler en server detecta el `request aborted` y limpia la subscription Pub/Sub. Si no detecta, el TTL=24h de la subscription la limpia (ver ADR-018).

### Riesgos abiertos

- **Indicador "Reconectando…"**: ya implementado vía `onConnect`/`onDisconnect` del hook. Bug abierto en task #120 (anotado en HANDOFF.md): a veces el indicador se queda colgado en "Reconectando…" cuando el cliente reconectó pero el callback no se disparó. Investigar.
- **Migración a fetch streaming**: cuando Safari iOS estabilice + el stack tenga helper native, eliminar el query param `?auth=` y usar headers reales. Backlog.
- **Multi-region**: hoy todo el stack vive en `southamerica-west1`. Si en el futuro se sirve desde múltiples regiones, las subscriptions Pub/Sub son globales pero la UX se beneficiaría de affinity (cliente conecta SSE a la región más cercana). Out of scope.

## Implementación (estado actual)

| # | Ítem | Archivo | Estado |
|---|------|---------|--------|
| 1 | Endpoint `GET /assignments/:id/messages/stream` con `streamSSE` helper de Hono | `apps/api/src/routes/...` | ✅ commiteado |
| 2 | Branch especial en middleware Firebase Auth para leer `?auth=` query param | `apps/api/src/middleware/firebase-auth.ts:52` | ✅ commiteado |
| 3 | `createEphemeralChatSubscription()` que devuelve AsyncIterable | `apps/api/src/services/chat-pubsub.ts:83-128` | ✅ commiteado |
| 4 | Hook `useChatStream` con reconnect exponential backoff | `apps/web/src/hooks/use-chat-stream.ts` | ✅ commiteado |
| 5 | UI indicator "Conectado" / "Reconectando…" en ChatPanel | `apps/web/src/components/...` | ✅ commiteado (con bug task #120) |
| 6 | Logs Pino redact de `auth=` | `apps/api/src/middleware/firebase-auth.ts` | ⏳ verificar |
| 7 | Migración a fetch streaming + headers reales | n/a | 📅 backlog |

## Referencias

- `apps/api/src/services/chat-pubsub.ts` — capa Pub/Sub
- `apps/api/src/middleware/firebase-auth.ts` — auth con branch SSE
- `apps/web/src/hooks/use-chat-stream.ts` — cliente SSE
- HTML5 — [Server-Sent Events specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- MDN — [EventSource interface](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- ADR-016 — Web Push VAPID (cubre tab cerrada — complementario)
- ADR-018 — Pub/Sub `chat-messages` (mecanismo backend de SSE)
