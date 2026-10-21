# ADR-085 — document-service consume `document.uploaded` por push

**Estado**: Propuesto
**Fecha**: 2026-10-21
**Decider**: Felipe Vicencio (Product Owner). Pendiente de aprobación en el PR.
**Se desvía de**:
- [ADR-063](./063-cloud-run-ingress-posture-round-2.md): su tabla clasifica a document-service como servicio «sin Pub/Sub push (todas las subscriptions son pull)». Su §Re-evaluación ya preveía este caso: «push del mismo proyecto funciona con INTERNAL_ONLY». El ingress se mantiene; cambia el supuesto de que el servicio no recibe inbound.
- [ADR-083](./083-staging-gemelo-y-extraccion-con-shadow.md) §3: un servicio que se desvía del patrón de extracción lleva su ADR. Este es el de document-service.

No supersede a ninguno: ADR-063 y ADR-083 siguen vigentes en todo lo demás.

**Relacionado**: ADR-069 y ADR-070 (qué hace el worker), PR #822 (el mismo recorte para matching-engine y notification-service), auditoría de costos GCP del 2026-10-21.
**Spec y evidencia**: `.specs/document-service-push/`

---

## Contexto

`document-service` es el worker que decodifica el TED de los documentos de transporte. Consume `document.uploaded` por **StreamingPull** dentro del container. Un consumidor pull necesita `min_instances=1` y CPU siempre asignada: con `min=0` nada despierta la instancia y nadie consume; con `cpu_idle=true` el pull queda sin CPU entre requests (incidente de telemetry-processor del 2026-06-07).

Esa configuración entró en prod con el PR #763 (revisión `00008`, 2026-10-12). Desde entonces:

- **Costo**: USD 2,07/día (~USD 63/mes), todo CPU y memoria de una instancia encendida las 24 horas (691.421 vCPU-s en 8 días = 1 vCPU continua).
- **Uso**: 0 publicaciones en `document.uploaded` y 0 mensajes entregados en 30 días. Los logs del servicio son solo arranques, apagados, probes y auditoría de deploys.

Bajar el mínimo a 0 no sirve con pull. El api publica `document.uploaded` en **cada** subida de documento, sin flag (`apps/api/src/routes/transport-documents.ts`). El cron `documentos-pendientes` republica cada 15 min los `pendiente` sin tocar. Con pull y `min=0`, esos mensajes esperan a un consumidor que nunca arranca y vencen a los 7 días.

Hay además un hueco previo: el service agent de Pub/Sub no tiene `pubsub.publisher` sobre `pubsub-dead-letter` ni `pubsub.subscriber` sobre la suscripción (verificado en vivo). Sin esos permisos Pub/Sub no cuenta intentos ni reenvía a la DLQ, y un mensaje que falla siempre se reintenta hasta vencer.

## Decisión

### 1. El transporte pasa a push

La suscripción `document-uploaded-processor-sub` recibe un `push_config`:

- endpoint `POST <url run.app del servicio>/pubsub/document-uploaded`;
- OIDC firmado como `document-push-invoker@`, con `audience` igual a la URL run.app, sin path.

Es la misma suscripción: el cambio es in-place y los mensajes retenidos se quedan en ella.

Cada mensaje llega como un request HTTP, así que el servicio puede escalar a cero sin dejar mensajes sin procesar.

### 2. Autenticación

- `public = false`. Cloud Run IAM exige el OIDC antes de que el request llegue al container.
- SA dedicado `document-push-invoker@`, con `roles/run.invoker` **solo** sobre `booster-ai-document-service`.
- El service agent de Pub/Sub tiene Token Creator sobre ese SA. Es el mismo patrón que `safety-push-invoker@`.
- La app repite la verificación en `src/push-auth.ts`, como defensa en profundidad: firma contra las claves de Google, `email` igual a `PUSH_CALLER_SA` y `email_verified`. Así un principal con `run.invoker` heredado del proyecto (owners, el deployer) no puede inyectar mensajes.
- `aud` lo exige Cloud Run; la app no lo repite, porque Terraform no puede pasarle al servicio su propia URL sin un ciclo.

### 3. El ingress se queda en `INTERNAL_ONLY`

La documentación de Cloud Run trata como interno el tráfico de las suscripciones de Pub/Sub del mismo proyecto que usan la URL `run.app` por defecto. Por eso el endpoint es la URL `run.app` y no un dominio propio.

Consecuencia: el servicio no puede tener un dominio propio como endpoint del push, ni deshabilitar su URL `run.app` por defecto.

### 4. Escala, CPU y tiempos

| Parámetro | pull (hoy) | push | Por qué |
|---|---|---|---|
| `min_instances` | 1 | **0** | Cada mensaje despierta una instancia |
| `cpu_idle` | false | **true** | Todo el trabajo ocurre dentro del request: se responde después de persistir |
| concurrencia por instancia | 80 (sin gestionar) | **4** | Medido con el ingestor real: 4 fotos de 12 MP en paralelo llegan a ~670 MB de RSS (memoria de 1 GiB). Más requests no aceleran el decode (WASM en un hilo) |
| `ack_deadline_seconds` | 120 | 120 | En push es lo que Pub/Sub espera la respuesta, sin extensión de lease. Un decode medido toma 0,05–0,2 s y el arranque en frío segundos |
| timeout del request | 300 s | 300 s | Mayor que el ack deadline |
| `max_instances` | 10 | 10 | Sin cambio |

La concurrencia se fija con una variable nueva del módulo `cloud-run-service` (`max_instance_request_concurrency`, `null` por defecto: no genera diff en los demás servicios). La variable vieja `concurrency` nunca estuvo conectada; se documenta y se deja para un cambio aparte.

### 5. Reintentos, DLQ e idempotencia

- La decisión ack/nack no cambia. Un mensaje procesado o salteado por idempotencia se confirma (204). Un JSON o sobre fuera de contrato también se confirma (204) y se registra como error, porque ningún reintento lo arregla. Un error transitorio de GCS o de la base se rechaza (500).
- El JSON inválido ahora se confirma en los dos modos. Antes, en pull, caía en el `catch` y se reintentaba.
- Retry exponencial de 10 a 600 s; tras 5 intentos, la DLQ.
- Se agregan los dos bindings que permiten reenviar a la DLQ desde esta suscripción. El de publisher sobre el topic es compartido, pero no habilita el reenvío de las otras suscripciones: cada una necesita además su propio subscriber.
- La idempotencia sigue en el claim condicional por estado (`pendiente|fallido → procesando`). Pub/Sub no ofrece entrega exactamente una vez en push; el claim vuelve inocuo un duplicado.

### 6. Un flag mueve todo junto

`var.document_service_push` (default `false`) fija en el mismo apply:

- el `push_config` de la suscripción;
- `DOCUMENT_CONSUMER_MODE` (`pull` o `push`);
- `min_instances` y `cpu_idle`.

La imagen sirve los dos modos. El endpoint push existe también en pull (solo acepta el OIDC de `PUSH_CALLER_SA`), así que el orden en que se actualizan la suscripción y la revisión no deja mensajes en 404. El rollback es apagar el flag y aplicar, sin redeploy.

Cuando el push lleve dos semanas estable, el camino pull y el flag se eliminan en un commit aparte (mismo criterio que ADR-083 §2 paso 6).

### 7. El deploy deja de fijar mínimo y CPU

`deploy-document-service` (`cloudbuild.production.yaml`) deja de pasar `--min-instances=1` y `--no-cpu-throttling`. Si no, cada release devolvería el servicio a `min=1` con CPU siempre asignada, que es lo que pasó con matching-engine y notification-service (PR #822). `gcloud run services update` conserva lo que fija Terraform.

### 8. Observabilidad

- Alerta ERROR si un mensaje de esta suscripción se reenvía a la DLQ (`subscription/dead_letter_message_count`). Cubre los fallos persistentes del push: 401, 403, 404 o 5xx.
- Alerta ERROR si un mensaje queda más de 30 min sin confirmar (`oldest_unacked_message_age`, mismo patrón que las demás suscripciones). Cubre los fallos que no llegan a la DLQ.

La alerta general `pubsub_dlq` no sirve para esto: mira un topic sin suscripción.

## Alternativas consideradas

| Alternativa | Veredicto |
|---|---|
| **A. Dejarlo como está** (pull, `min=1`) | Rechazada: ~USD 63/mes por 0 mensajes. Es la línea base y sigue siendo el rollback |
| **B. Pull con `min=0`** | Rechazada: el api publica en cada subida sin flag y el cron republica cada 15 min. Nada despierta la instancia, así que los mensajes esperan sin consumidor hasta vencer a los 7 días |
| **C. Push a Cloud Run** | **Elegida**: escala a cero y conserva la suscripción, su retención, la DLQ y el retry en `messaging.tf`. El ingress no cambia |
| **D. Eventarc** (trigger de Pub/Sub hacia Cloud Run) | Rechazada: Eventarc crea y administra su propia suscripción push. La DLQ, el retry y el ack deadline dejan de declararse en `messaging.tf` con las demás. Suma un trigger con su SA y el formato CloudEvents, sin ganancia para un solo consumidor de un solo topic. Además, una suscripción nueva no hereda el backlog de la actual |

## Consecuencias

### Positivas

- El costo fijo de ~USD 63/mes pasa a costo por documento. Al volumen actual (0 en 30 días) es ~0.
- La DLQ de esta suscripción empieza a funcionar, y su alerta propia sí se dispara.
- La concurrencia del servicio queda gestionada y medida, en vez del 80 por defecto.

### Negativas

- **Arranque en frío**: el primer documento después de un rato sin uso espera unos segundos. El procesamiento es offline (el documento queda en `pendiente` mientras tanto), así que no se ve en la subida.
- **Ack deadline duro**: en push no hay extensión de lease. Si un decode pasara de 120 s, Pub/Sub reentregaría el mensaje mientras el primero sigue. El segundo intento ve `procesando`, se saltea y se confirma; si después el primero fallara, el documento quedaría en `fallido` sin reintento automático, disponible para ingreso manual. Lo medido (0,2 s) deja margen de sobra; el riesgo se registra en la spec.
- **Dependencia de la URL `run.app`**: no se puede deshabilitar mientras el push la use.
- **Código de transición**: el worker mantiene los dos modos hasta que se retire el pull.
- **IAM nuevo**: un SA y cuatro bindings (token creator, `run.invoker` sobre el servicio, y publisher/subscriber para la DLQ). Ninguno es IAM humana.

## Validación

- [x] Tests del worker: 51/51, cobertura 100 % líneas y 90,5 % ramas. Typecheck, Biome y build OK.
- [x] `terraform validate` y `fmt`. Plan acotado contra prod con `-lock=false`: con el flag apagado, 7 to add y 1 to change; encendido, 7 to add y 2 to change; 0 to destroy en los dos (`verify.md`).
- [ ] PO: apply con el flag apagado, release, encendido del flag y prueba de humo (spec §10).
- [ ] PO: a las 48 h del encendido, el costo diario del servicio en el export por recurso está en ~0.
- [ ] Dos semanas estable en push: retirar el modo pull y el flag (commit aparte).
