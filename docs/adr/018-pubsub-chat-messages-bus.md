# ADR-018 — Pub/Sub `chat-messages` con subscriptions efímeras por viewer como bus interno del chat realtime

- **Estado**: Accepted
- **Fecha**: 2026-04-30 (decisión); 2026-05-03 (ADR escrito retroactivo)
- **Decisores**: Felipe Vicencio (Product Owner)
- **Supersede**: —

## Contexto

ADR-017 estableció **SSE** como el mecanismo client-facing de chat realtime. Falta definir **el bus que conecta** el `INSERT` del mensaje en Postgres con cada SSE viewer abierto:

- Múltiples instancias de Cloud Run api (autoscaling) — el INSERT puede ocurrir en `instance #3` y los SSE viewers conectados pueden estar en `instance #7` y `#11`. Necesitamos un bus que cruce instances.
- Múltiples viewers concurrent del mismo `assignment` (driver mobile + driver desktop + shipper desktop) — todos deben recibir el mensaje.
- Filtros server-side: cada SSE solo recibe los mensajes de **su** `assignment_id`, no de los otros 200 chats activos en el sistema.

Booster AI ya tiene **Memorystore Redis** (`infrastructure/data.tf:239+`, ADR-005) para conversation store + caching. Redis pub/sub funcionaría. También está habilitada la **Pub/Sub API** (`project.tf:36`) para telemetry events. ¿Cuál usar para el chat?

## Decisión

Usar **Cloud Pub/Sub** con un topic `chat-messages` y **subscriptions efímeras por viewer** (creadas y borradas en runtime). Implementación:

- **Topic**: `infrastructure/messaging.tf:100-109` — `chat-messages`, retención 1h.
- **Publish**: `apps/api/src/services/chat-pubsub.ts:48-75` (`publishChatMessage`). Fire-and-forget post-INSERT. Si Pub/Sub falla, el mensaje ya está en DB; los viewers se enteran al próximo refetch.
- **Subscribe**: `apps/api/src/services/chat-pubsub.ts:83-128` (`createEphemeralChatSubscription`). El handler SSE crea una subscription **única por viewer**, con nombre `chat-sse-{assignmentId}-{uuid8}`, **filter server-side** `attributes.assignment_id = "..."`, **TTL 24h** (auto-cleanup si crashea), `ackDeadlineSeconds=10`, `messageRetentionDuration=600s`.
- **Cleanup**: el handler SSE borra la subscription explícitamente al cerrar (`cleanup()` en el return). Si el handler crashea, el TTL la barre.

## Alternativas consideradas y rechazadas

### A. Redis Pub/Sub

Usar el Memorystore Redis existente con `PUBLISH chat-messages:assignment:{id} {payload}` y `SUBSCRIBE` en cada SSE handler.

- **Por qué se rechazó**:
  - **Sin filter server-side a nivel topic**: con Redis tendrías que abrir 1 channel por `assignment_id` (`SUBSCRIBE chat-messages:assignment:{id}`) o consumir todo y filtrar en aplicación. Pub/Sub permite `filter` en la subscription que GCP aplica antes de entregar — menos tráfico, menos CPU.
  - **Persistence cero**: Redis pub/sub es fire-and-forget puro. Si una instance reinicia justo cuando llega un mensaje, se pierde sin posibilidad de redelivery. Pub/Sub mantiene el mensaje hasta que se ACKea (con retención 1h en este topic).
  - **Sin DLQ**: Redis no tiene dead-letter pattern nativo. Pub/Sub sí (topic `pubsub-dead-letter` configurado en TF).
  - **Memorystore como SPOF crítico ya**: Redis se usa para sessions + rate limiting + AI conversation store. Cargarle un canal pub/sub adicional aumenta el blast radius si Redis cae.
  - **Misma cosa, sin ventaja**: Pub/Sub managed con cuota generosa, pricing trivial para nuestro volumen.

### B. Postgres `LISTEN/NOTIFY`

`pg_notify('chat_messages', payload)` desde un trigger post-INSERT, `LISTEN chat_messages` desde cada SSE handler.

- **Por qué se rechazó**:
  - **Conexiones persistentes a Postgres**: cada SSE viewer requiere mantener una conexión Postgres con `LISTEN` activo. Con 200 viewers concurrent, son 200 conexiones idle del pool — agota el `max_connections` del Cloud SQL tier (200 default).
  - **Payload limitado a 8000 bytes**: PostgreSQL `pg_notify` tiene límite hardcoded. Para mensajes JSON grandes (con metadata extra) hay que partir.
  - **Acoplamiento con la BD**: triggers SQL son lógica de negocio escondida. Ya el principio del repo dice "Algoritmos viven en `packages/`, services orquesta DB" — meter un trigger pg_notify viola esa frontera.

### C. Server-Sent Events broadcast directo (in-memory pub/sub)

Cada instance Cloud Run mantiene un mapa `assignmentId → Set<SSEResponse>` y al recibir `INSERT` del mismo proceso, escribe a todos.

- **Por qué se rechazó**: solo funciona si el `INSERT` y todos los SSE viewers viven en la misma instance. Con autoscaling es impredecible. Falla el principio multi-instance del stack.

### D. WebSocket con sticky sessions + in-memory broadcast

WebSocket con session affinity al LB para garantizar que un viewer siempre cae en la misma instance.

- **Por qué se rechazó**: ya descartado WebSocket en ADR-017 por motivos de Cloud Run. Sticky sessions complican el autoscaling y costo.

### E. Subscription compartida (1 sub para todos los viewers de un topic)

Una sola subscription `chat-messages-all-viewers` que recibe todo y la app filtra in-memory.

- **Por qué se rechazó (por ahora)**:
  - Cada instance Cloud Run tendría que mantener mapa `assignmentId → Set<viewers>` y filtrar en code. Es lo que descartamos en (C).
  - Pub/Sub paga 1 ACK por mensaje × subscription. Con N viewers en N instances, son N ACKs por mensaje. Con subscription efímera por viewer es 1 ACK por viewer-message — mismo costo.
- **Reevaluación**: si llegamos a >5000 viewers concurrent, costo de mantener tantas subscriptions efímeras se vuelve significativo (~$0.40/mes/idle subscription). Migrar a 1 subscription compartida + filter in-app.

## Consecuencias

### Positivas

- **Filter server-side por GCP**: el filter `attributes.assignment_id = "..."` se evalúa en el plano de control de Pub/Sub antes de entregar. Cada SSE handler solo procesa los mensajes que le interesan, sin tráfico desperdiciado.
- **Cross-instance natural**: cualquier `INSERT` desde cualquier instance api alcanza a todos los viewers, sin importar dónde estén corriendo.
- **Auto-cleanup robusto**: TTL 24h en cada subscription. Si una Cloud Run instance muere mid-handler sin cleanup explícito, GCP la barre.
- **Audit trail**: cada `publishChatMessage` queda en logs estructurados Pino. Cada subscription create/delete queda en Cloud Audit Logs (`pubsub.googleapis.com/v1.SubscriptionService`).
- **Naming descubrible**: prefijo `chat-sse-` permite a un operador ver qué subscriptions están vivas con `gcloud pubsub subscriptions list --filter="name:chat-sse-*"` y limpiar a mano si un día se acumulan huérfanas.
- **DLQ pattern reutilizable**: el topic `pubsub-dead-letter` está disponible si en el futuro se quisiera pasar de fire-and-forget a "garantía de entrega".

### Negativas

- **Latencia de subscription create**: ~500ms al abrir el SSE. Para chat (no live trading) es invisible al user.
- **Costo creciente con viewers**: ~$0.40/mes por subscription idle. 100 viewers concurrent = $40/mes. 1000 = $400/mes. Sostenible para piloto; reevaluar a partir de 1000 viewers concurrent.
- **Mensajes perdidos sin viewer**: retención del topic = 1h. Si nadie está suscrito al INSERT (ninguna tab abierta), el mensaje no se entrega via Pub/Sub. **No es bug**: el cliente al refrescar trae el mensaje desde Postgres (canónico). El topic es solo el canal de "push instantáneo a tabs vivos". Para tab cerrada hay Web Push (ADR-016). Para reconectar tras outage el listado regular de mensajes (HTTP) cubre.
- **Operacional**: si una versión del stack tiene bug que no llama `cleanup()`, las subscriptions efímeras se acumulan. El TTL las limpia en 24h pero hay ventana de costo. Mitigación: alerta de monitoring sobre `pubsub.googleapis.com/subscription/num_undelivered_messages` para `chat-sse-*` agrupado.

### Riesgos abiertos

- **Cuotas de Pub/Sub**: GCP impone límite default 10000 subscriptions per project. Con `chat-sse-*` efímeras, si llegamos a 5000+ viewers concurrent, acercamos el límite. Hoy cuota muy holgada para el volumen.
- **Migración a subscription compartida**: cuando viewers >5000 o cuando el costo idle supere algún threshold (~$200/mes), migrar al patrón (E). Refactor mantenible en `chat-pubsub.ts`.

## Implementación (estado actual)

| # | Ítem | Archivo | Estado |
|---|------|---------|--------|
| 1 | Topic `chat-messages` con retention 1h | `infrastructure/messaging.tf:100-109` | ✅ aplicado |
| 2 | Env var `CHAT_PUBSUB_TOPIC` en Cloud Run api | `infrastructure/compute.tf:117` | ✅ aplicado |
| 3 | `publishChatMessage` fire-and-forget post-INSERT | `apps/api/src/services/chat-pubsub.ts:48-75` | ✅ commiteado |
| 4 | `createEphemeralChatSubscription` con filter + TTL + naming descubrible | `apps/api/src/services/chat-pubsub.ts:83-128` | ✅ commiteado |
| 5 | DLQ topic disponible (no enchufado al `chat-messages` por ahora — fire-and-forget OK) | `infrastructure/messaging.tf:112-122` | ✅ aplicado |
| 6 | Alerta sobre `num_undelivered_messages` para `chat-sse-*` | `infrastructure/monitoring.tf` | 📅 backlog |
| 7 | Migración a 1-subscription-shared + filter in-app | n/a | 📅 al alcanzar 5000 viewers o $200/mes |

## Referencias

- `apps/api/src/services/chat-pubsub.ts` — implementación
- `infrastructure/messaging.tf:75-122` — topic + DLQ
- ADR-017 — SSE como mecanismo client-facing
- ADR-016 — Web Push (cubre tab cerrada)
- ADR-005 — Telemetry IoT (Pub/Sub fue elegido como bus por defecto del stack)
- Pub/Sub — [Subscription filter syntax](https://cloud.google.com/pubsub/docs/filtering)
- Pub/Sub — [Pricing](https://cloud.google.com/pubsub/pricing)
