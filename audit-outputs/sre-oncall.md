# SRE Review — Auditoría Operacional Booster AI
**Fecha**: 2026-06-14
**Operational readiness**: NEEDS_WORK
**Auditor**: booster-skills:sre-oncall

---

## Contexto de la auditoría

Revisión de caminos críticos: telemetría (tcp-gateway, processor, codec8-parser), documentos (document-service, dte-provider), pagos/factoring (factoring-engine), matching (matching-engine, matching-algorithm), notificaciones. El repo es el monorepo booster-ai en `/Users/felipevicencio/booster-ai`.

---

## Findings — Must Fix (P0)

### F-01 [P0] — Routes API (`computeRoutes`) sin timeout configurado

**Ruta**: `apps/api/src/services/routes-api.ts` línea 179  
**Evidencia**: `fetchImpl(ROUTES_API_URL, { method: 'POST', headers: {...}, body: ... })` invoca `fetch` nativo **sin `signal` de AbortController**. Ni la llamada a ADC (`authClient.getClient()`) tiene timeout.  
**Contraste**: todos los demás clientes HTTP externos del repo (Twilio en `packages/whatsapp-client/src/twilio-client.ts:107`, Sovos en `packages/dte-provider/src/adapters/sovos.ts:138`, Gemini en `apps/api/src/services/gemini-client.ts:88`) implementan `AbortController` con `clearTimeout` en `finally`. Routes API es la única excepción.  
**Riesgo operacional**: una respuesta lenta de Google Routes API (>30s) bloquea el handler de tracking público indefinidamente, consumiendo un slot de concurrencia de Cloud Run. Con múltiples viajes activos y el polling del tracking a 30s, un incidente de latencia en Routes API puede agotar la concurrencia del servicio.  
**Recomendación**: agregar `AbortController` con timeout de 8–10 segundos al `fetchImpl`. El patrón exacto ya existe en `gemini-client.ts:88-90`.

---

### F-02 [P0] — GKE deploy del telemetry-tcp-gateway es manual; sin rollback automatizado

**Ruta**: `cloudbuild.production.yaml` líneas 486-500  
**Evidencia**: el step `gke-deploy-instructions` no ejecuta `kubectl set image`; emite instrucciones por stdout. El comentario explica que el pool de Cloud Build y el control plane de GKE no tienen rutas transitivas por limitación de VPC peering. El operador debe deployar manualmente desde laptop autorizado o vía IAP TCP.  
**Riesgo operacional**: cualquier deploy a producción que incluya cambios al gateway queda partido: Cloud Run y el Cloud Build step tienen rollback automatizado, pero el gateway queda en la versión anterior hasta que alguien ejecute `./scripts/deploy-telemetry-gateway.sh`. Si el operador no está disponible, los devices Teltonika continúan conectando a código desactualizado. No hay gate de verificación post-deploy del gateway en el pipeline.  
**Recomendación**: (a) corto plazo: agregar un step en Cloud Build que verifique que la imagen del gateway en GKE corresponda al `_COMMIT_SHA` del build, y falle el pipeline si no coincide, forzando la atención del operador. (b) largo plazo: resolver la conectividad VPC para habilitar `kubectl set image` desde el pool privado.

---

### F-03 [P0] — `notification-service`, `matching-engine` y `document-service` son skeletons en producción con subscriptions activas

**Rutas**: `apps/notification-service/src/main.ts`, `apps/matching-engine/src/main.ts`, `apps/document-service/src/main.ts`  
**Evidencia**: los tres servicios contienen únicamente `logger.info('starting (skeleton)')` sin implementación. Sin embargo:
- `messaging.tf` define `telemetry-events-safety-p0-notification-sub` (eventos de crash/unplug/jamming P0) apuntando al `notification-service`.
- `messaging.tf` define `telemetry-events-eco-score-matching-sub` y `telemetry-events-trip-transitions-sub` para `matching-engine`.
- El topic `document-events` existe sin subscription definida.
- Los tres servicios están desplegados en Cloud Run con `min_instances=0` (nada que consuma).  

**Riesgo operacional**: los mensajes de crash/unplug/jamming (P0 de seguridad física) se encolan en `telemetry-events-safety-p0-notification-sub` con 7 días de retención, pero **nadie los consume**. El `oldest_unacked_message_age` subirá sin que ninguna alerta lo detecte (la alerta `telemetry_consumer_stalled_p1` solo monitorea `telemetry-events-processor-sub`). Los eventos de unplug y GNSS jamming — cuya alerta P0 depende del log emitido por `panic-events.ts` en el **telemetry-processor**, no en notification-service — sí alertan, pero la notificación al transportista/operador no ocurre. El `factoring-engine` opera puramente en lógica de librería (package), sin exposición de servicio, lo cual es correcto.  
**Recomendación**: (a) inmediato: agregar alertas `oldest_unacked_message_age` para `telemetry-events-safety-p0-notification-sub`, `telemetry-events-eco-score-matching-sub`, y `telemetry-events-trip-transitions-sub`. (b) decidir en el PR próximo si los skeletons deben ser eliminados de Cloud Run hasta que estén implementados, o si existe un consumidor alternativo para los mensajes P0.

---

## Findings — Must Fix (P1)

### F-04 [P1] — Migraciones Drizzle sin "down migrations"; rollback de esquema requiere DDL manual

**Ruta**: `apps/api/drizzle/` (41 migrations, 0000 a 0040)  
**Evidencia**: todas las migraciones son SQL de `ALTER TABLE ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`. No existe ningún archivo `*.down.sql` ni un mecanismo de reversión automatizado. El migrator (`apps/api/src/db/migrator.ts`) solo aplica hacia adelante; incluye un mecanismo de recuperación de out-of-order pero sin inversión.  
**Riesgo operacional**: si un deploy introduce una migración errónea (ej. `ADD COLUMN NOT NULL` sin default en tabla con datos), el rollback al código anterior requiere DDL manual coordinado. El `STRICT_MIGRATION_ORDERING=true` (activado en Sprint 2) hace fail-closed el startup ante fallo de migración, lo cual es correcto, pero el tiempo de recuperación depende de un operador ejecutando DDL a mano en producción.  
**Recomendación**: para nuevas migraciones destructivas (DROP COLUMN, TYPE CHANGE), documentar el down-DDL como comentario en el mismo archivo SQL. Para columnas nuevas: `ADD COLUMN ... DEFAULT ...` siempre, nunca `NOT NULL` sin default en tabla poblada. Registrar en el PR si la migración es reversible con `ALTER TABLE DROP COLUMN` o si requiere snapshot de BD.

---

### F-05 [P1] — Sin alerta de `oldest_unacked_message_age` para los 4 topics Wave 2 de skeletons

**Ruta**: `infrastructure/telemetry-monitoring.tf` y `infrastructure/messaging.tf`  
**Evidencia**: la alerta `telemetry_consumer_stalled_p1` (línea 379, telemetry-monitoring.tf) es un patrón correcto y fue fruto del incidente 2026-06-07. Pero solo cubre `telemetry-events-processor-sub`. Las subscriptions `telemetry-events-safety-p0-notification-sub`, `telemetry-events-security-p1-notification-sub`, `telemetry-events-eco-score-matching-sub`, `telemetry-events-trip-transitions-sub` no tienen alerta equivalente.  
**Riesgo operacional**: un consumer detenido en cualquiera de esos 4 topics pasa desapercibido durante días (el único indicador sería el `pubsub_dlq` global, que no distingue topics). La alerta P0 de `crash_event_p0` dependiente de `telemetry-processor` sí funciona, pero los eventos de tipo safety/security que deberían disparar notificaciones al carrier quedan silenciados indefinidamente.  
**Recomendación**: replicar el patrón `oldest_unacked_message_age > 1800s` para cada subscription de consumer que no sea `telemetry-events-processor-sub`. Ajustar el umbral según el SLA de cada canal (safety-p0: umbral más agresivo, 600s).

---

### F-06 [P1] — `canary-verify` con `_CANARY_MIN_REQUESTS=0` por defecto: gate sin muestra real

**Ruta**: `cloudbuild.production.yaml` líneas 266, 339-344, 553  
**Evidencia**: el default de `_CANARY_MIN_REQUESTS` es `'0'`. La lógica en Python (línea 339) es: si `total < max(min_requests, 1)` y `min_requests == 0`, imprime WARN y hace `sys.exit(0)`. Esto significa que en el escenario típico (pre-comercial, pocos usuarios, 1% de tráfico en 30min puede ser 0 requests), el canary **se promueve a 100% sin haber validado ninguna métrica**.  
**Riesgo operacional**: la lógica canary está bien diseñada pero el parámetro lo vacía de efecto. Un deploy que rompa el 100% de requests pasaría el canary si en esos 30min no hubo carga suficiente. El SLO de error_rate < 1% y p95 < 500ms no se verifica.  
**Recomendación**: ajustar `_CANARY_MIN_REQUESTS` a un valor ≥ 5 cuando existan usuarios activos. Mientras no haya tráfico real, documentar explícitamente en el runbook que el gate canary no tiene validez estadística en pre-comercial.

---

### F-07 [P1] — `document-events` topic sin subscription ni consumer definido

**Ruta**: `infrastructure/messaging.tf` línea 83-91  
**Evidencia**: `google_pubsub_topic.document_events` existe. No hay ninguna `google_pubsub_subscription` para este topic en ningún archivo `.tf`. `apps/document-service/src/main.ts` es un skeleton. Cuando el API publique en `document-events`, los mensajes expirarán en el broker (retención no configurada explícitamente → default GCP de 7 días).  
**Riesgo operacional**: cualquier DTE o evento de OCR publicado al topic se perderá silenciosamente. No hay DLQ para mensajes huérfanos de este topic. No hay alerta de backlog porque no hay subscription.  
**Recomendación**: crear la subscription con DLQ desde ya, aunque el consumer no esté implementado. Esto evita pérdida de mensajes y permite medir el backlog acumulado.

---

### F-08 [P1] — DTE (Sovos) en modo `DTE_PROVIDER=disabled`; sin alerta de emisión fallida en producción

**Ruta**: `apps/api/src/config.ts:358`, `apps/api/src/services/dte-emitter-factory.ts`  
**Evidencia**: `DTE_PROVIDER` tiene default `'disabled'`. La función `getDteEmitter` retorna `null` cuando el provider está deshabilitado, y `emitirDteLiquidacion` hace skip silencioso con `{ status: 'skipped', reason: 'no_adapter' }`. No hay alerta en `monitoring.tf` ni `telemetry-monitoring.tf` sobre liquidaciones que alcanzan el estado `lista_para_dte` pero no progresan a `dte_emitido`.  
**Contexto**: en el estado actual (DTE_PROVIDER=disabled), **no se emite ningún DTE en producción**. El bucket `documents` con retention policy 6 años (SII) está vacío (`is_locked=false` por decisión del PO). La retención SII es una obligación legal desde el primer DTE real.  
**Riesgo operacional**: cuando se active `DTE_PROVIDER=sovos`, las liquidaciones en `lista_para_dte` sin DTE asociado son deuda fiscal. El cron `reconciliar-dtes` retry tiene `retryEmitLimit=50`, pero sin alerta no hay visibilidad de fallo sostenido.  
**Recomendación**: agregar log-based metric + alerta sobre `status='transient_error'` en `emitirDteLiquidacion` (ya loguea como WARN con `liquidacionId`). Verificar que `is_locked=true` en el bucket `documents` se active en el PR que habilite el primer DTE real en prod.

---

## Findings — Should Address (P2)

### F-09 [P2] — OTel instrumentación automática: sin spans de negocio explícitos en caminos críticos

**Rutas**: `packages/otel-bootstrap/src/index.ts`, `apps/api/src/instrumentation.ts`, `apps/telemetry-processor/src/instrumentation.ts`  
**Evidencia**: el bootstrap de OTel usa `getNodeAutoInstrumentations()` que instrumenta Hono (HTTP), Postgres y Pub/Sub automáticamente. Sin embargo, no hay spans manuales en operaciones de negocio críticas: `emitirDteLiquidacion`, `emitirCertificadoViaje`, `persistCrashTrace`, `evaluarShipper`, ni en el handler AVL del gateway (`handleConnection`/`processBuffer`). Los traces de Cloud Trace mostrarán el span HTTP del endpoint pero no el desglose interno.  
**Riesgo operacional**: durante un incidente, los traces de Cloud Trace no permitirán aislar si la latencia alta está en el DB, en Sovos, en GCS o en la lógica de cálculo. El dashboard de telemetría menciona explícitamente "los widgets de latency p99 quedan TODO hasta que instrumentemos OpenTelemetry" (`telemetry-monitoring.tf:7`).  
**Recomendación**: agregar `tracer.startActiveSpan()` manual en: el handler Pub/Sub del telemetry-processor (por mensaje, con `imei` y `vehicleId` como atributos), `persistCrashTrace`, `emitirDteLiquidacion`. La auto-instrumentación de Hono y PG ya cubre el resto.

---

### F-10 [P2] — `sms-fallback-gateway` con `ingress=INGRESS_TRAFFIC_ALL` y sin DLQ para fallos de publish a Pub/Sub

**Ruta**: `infrastructure/compute.tf` líneas 543-546  
**Evidencia**: el sms-fallback-gateway es el único servicio que mantiene `INGRESS_TRAFFIC_ALL` por necesidad (Twilio postea directo sin pasar por GCLB). La validación es HMAC (`TWILIO_AUTH_TOKEN`). Sin embargo, si el step `publisher.publishRecord()` falla al publicar al topic `telemetry-events`, el error se propaga y el handler del webhook retorna 5xx → Twilio reintenta automáticamente (hasta 3 veces con backoff). No hay dead-letter para eventos SMS que fallen múltiples veces.  
**Riesgo operacional**: en un incidente donde Pub/Sub esté degradado, Twilio agota sus reintentos y el evento SMS de un crash de vehículo se pierde sin trazabilidad.  
**Recomendación**: loguear el payload completo del SMS fallback antes de intentar la publicación a Pub/Sub (permite reproc manual desde logs). Documentar en el runbook de telemetría que los eventos SMS tienen una ventana de recuperación limitada por los reintentos de Twilio.

---

### F-11 [P2] — `notification-service` y `matching-engine` con `min_instances=0` y `cpu_idle=true` (default), pero son consumers Pub/Sub pull

**Ruta**: `infrastructure/compute.tf` líneas 470-501, 379-412  
**Evidencia**: cuando se implemente el `notification-service` y `matching-engine` como consumers pull (patrón `subscription.on('message')`), necesitarán `min_instances≥1` y `cpu_idle=false` (igual que `telemetry-processor`). El comentario en `telemetry-processor` explica el incidente 2026-06-07. Los dos skeletons tienen el default inseguro.  
**Riesgo operacional**: es un riesgo latente que se materializará en el momento de la implementación si no se ajustan los valores antes del primer deploy real.  
**Recomendación**: agregar TODO comentado en los módulos `service_notification` y `service_matching_engine` en `compute.tf` indicando que deben cambiar a `min_instances=1, cpu_idle=false` antes del primer deploy con consumer pull.

---

### F-12 [P2] — `retention_policy.is_locked=false` en buckets de compliance

**Rutas**: `infrastructure/storage.tf` línea 149 (documents), `infrastructure/crash-traces.tf` línea 86  
**Evidencia**: ambos buckets tienen `is_locked=false` con comentarios explícitos sobre las condiciones para activarlo. El bucket `documents` requiere first DTE real + 48h sin issues + decisión PO. El bucket `crash-traces` dice "CAMBIAR A true MANUALMENTE post-validación".  
**Riesgo operacional**: sin `is_locked=true`, la retención no es Retention Lock (WORM): un atacante con acceso a GCS o un error operacional puede borrar un DTE o crash trace antes de los 6/7 años requeridos. Para auditoría SII y reclamos aseguradores, la mutabilidad invalida la evidencia.  
**Nota**: el PO ha decidido mantener `false` con gate explícito. El riesgo está documentado y es una decisión deliberada. Se reporta como P2 para visibilidad.

---

### F-13 [P2] — Sin SLOs formales como `google_monitoring_slo` resource

**Ruta**: `infrastructure/monitoring.tf`  
**Evidencia**: las alert policies en `monitoring.tf` usan threshold fijo (error rate > 1%, latency p95 > 2s) configurados como `condition_threshold`, no como `google_monitoring_slo` con burn rate. No hay cálculo de error budget ni alertas por consumo de budget.  
**Riesgo operacional**: las alertas actuales son razonables como baseline, pero no permiten calcular "¿cuánto tiempo de downtime queda en el mes?". Con crecimiento de tráfico, el threshold fijo puede volverse demasiado sensible o demasiado permisivo.  
**Recomendación**: para el API principal, definir un `google_monitoring_slo` formal con ventana de 30 días y burn rate alerts (fast burn: > 14× en 1h; slow burn: > 2× en 6h). Los otros servicios pueden mantener threshold alerts hasta que tengan tráfico medible.

---

### F-14 [P2] — Chat fallback WhatsApp: Twilio sin retry backoff; 100 mensajes procesados secuencialmente en 100s

**Ruta**: `apps/api/src/services/chat-whatsapp-fallback.ts` líneas 124-127  
**Evidencia**: el comentario dice explícitamente "Procesamos secuencial — Twilio rate limit ~1msg/sec por sender. Para 100 candidatos = ~100s. Dentro del Cloud Scheduler timeout (60s default)". El timeout de Cloud Scheduler es de 60 segundos por defecto para HTTP handlers, pero el endpoint `/admin/jobs/chat-whatsapp-fallback` puede tardar hasta 100s con 100 candidatos.  
**Riesgo operacional**: si el batch tiene > ~50 candidatos, el job sobrepasa los 60s y Cloud Scheduler lo marca como fallido, aunque los primeros N mensajes ya se enviaron y marcaron. Los mensajes marcados con `whatsapp_notif_sent_at` pero no enviados (por `markNotifSent` que ocurre antes del send) quedan silenciados para siempre.  
**Recomendación**: verificar si el timeout de Cloud Scheduler está configurado en `infrastructure/scheduling.tf` para este job específico. Si está en 60s, reducir `RUN_LIMIT` a 50 o extender el timeout a 120s.

---

## Observability Checklist

| Componente | Logs estructurados | trace_id propagado | Span OTel | Métrica de negocio | Alerta SLO |
|---|---|---|---|---|---|
| API (Hono) | SI (`@booster-ai/logger`) | Parcial (X-Cloud-Trace-Context en algunos middleware) | SI (auto-instrumentation) | NO (sin custom metrics por endpoint) | SI (error rate + latency) |
| telemetry-tcp-gateway | SI | No aplica (TCP) | SI (initOtel) | SI (device_records_per_minute log-metric) | SI (gateway_down P1) |
| telemetry-processor | SI | SI (messageId en logs) | SI (initOtel) | SI (crash_events, parser_errors) | SI (consumer_stalled P1) |
| notification-service | Skeleton | — | — | — | NO |
| matching-engine | Skeleton | — | — | — | NO |
| document-service | Skeleton | — | — | — | NO |
| whatsapp-bot | SI | Parcial | NO (sin instrumentation.ts) | NO | NO |
| sms-fallback-gateway | SI | Parcial | NO (sin instrumentation.ts) | SI (sms_fallback_received log-metric) | NO |
| DTE (Sovos) | SI | SI (liquidacionId en logs) | NO | NO (sin alerta de skip/error) | NO |
| Factoring engine | SI (función pura, sin servicio propio) | — | — | — | — |

---

## Rollback Plan

| Componente | Rollback disponible | Tiempo estimado | Probado |
|---|---|---|---|
| API Cloud Run | SI: `--to-revisions=PREVIOUS=100` (runbook en cloudbuild) | < 2 min | SI (canary procedure) |
| Telemetry-processor Cloud Run | SI: misma vía gcloud | < 2 min | NO (no hay test de rollback documentado) |
| telemetry-tcp-gateway GKE | Parcial: manual `kubectl set image` al SHA anterior | 5-10 min + operador disponible | NO |
| DB migrations | NO: no hay down migrations | Minutos a horas (DDL manual) | NO |
| Feature flags (matching v2, auth universal, demo mode) | SI: variable Terraform + apply | < 5 min (apply) | Parcial |
| Retention Lock (documents, crash-traces) | N/A: no está activado aún | — | — |

**Conclusión rollback**: el rollback de Cloud Run services es rápido y documentado. El gap más grave es el gateway GKE (manual) y las migraciones DB (sin inversión). Un fallo de migración con `STRICT_MIGRATION_ORDERING=true` detendría el API hasta resolución DDL manual.

---

## Capacity Impact

| Servicio | min_instances | max_instances | CPU | Memory | Observaciones |
|---|---|---|---|---|---|
| booster-ai-api | 0 | 20 | 1 | 1Gi | Cold start 5-10s aceptable (pre-comercial). Revisar al firmar B2B con SLA. |
| telemetry-processor | 1 | 50 | 2 | 1Gi | Correcto. `cpu_idle=false`. Concurrencia=10. |
| telemetry-tcp-gateway (GKE) | GKE Autopilot gestiona | — | — | — | Sin límites explícitos de pods/recursos en GKE Autopilot. |
| notification-service | 0 | 20 | 1 (default) | 512Mi (default) | Cuando se implemente como pull consumer, necesita min=1 + cpu_idle=false. |
| matching-engine | 0 | 10 | 1 (default) | 512Mi (default) | Ídem. |
| document-service | 0 | 10 | 1 (default) | 1Gi | Skeleton. |
| whatsapp-bot | 0 | 20 | 1 (default) | 512Mi (default) | Cold start OK (Twilio reintenta). |
| sms-fallback-gateway | 0 | 10 | 1 | 512Mi | Sin DLQ propia para eventos SMS no publicados. |

**Load tests**: no hay evidencia de load tests en el repo. El volumen actual es pre-comercial (declarado en varios comentarios: ~10-19 req/día para bot, ~100 req/día para web). Justificación de no load test aceptable para pre-comercial.

---

## Costos GCP

Los items con costo no trivial identificados:

1. **telemetry-processor**: `min_instances=1` + `cpu_idle=false` es correcto operacionalmente pero genera costo fijo ~24/7. Es la decisión correcta documentada; el costo es conocido.
2. **Routes API**: alerta configurada (routes_api_rate > 500/h, routes_api_daily_volume > 4000). Bien controlado.
3. **Gemini API**: alerta configurada (> 100/h). Bien controlado.
4. **Buckets STANDARD con CMEK y versioning**: múltiples buckets en STANDARD. Los lifecycle rules migran a NEARLINE/ARCHIVE. Razonable para el volumen actual.
5. **BigQuery `crash_events`**: partitioned + clustered. Sin costo de query problemático actual (tabla vacía/baja densidad). Sin riesgo.
6. **GKE Autopilot**: costo variable según carga del gateway. Sin estimado documentado en el repo. Recomendable agregarlo en un comentario o ADR.

---

## Dependencias Externas

| Dependencia | Timeout | Retry backoff | Circuit breaker | Fallback |
|---|---|---|---|---|
| Twilio (WhatsApp/SMS) | SI: 10s (default) en whatsapp-client | NO (sin backoff; errores se loguean) | NO | SI: fallback a plantilla en coaching; skip en chat |
| Sovos DTE | SI: 15s configurable | NO (retry en `reconciliar-dtes` pero sin backoff exponencial) | NO | SI: `DteTransientError` → skip + retry en cron |
| Google Routes API | NO — F-01 | NO | NO | SI: fallback a estimación haversine |
| Google Gemini | SI: TIMEOUT_MS (gemini-client.ts:89) | NO | NO | SI: plantilla fallback en coaching-generator |
| Redis Memorystore | SI: ioredis defaults + TLS pinning corregido | SI: ioredis reconnect automático | NO | NO: rate limiter falla si Redis cae |
| Postgres (Cloud SQL) | SI: `idleTimeoutMillis=30s`, pool=10 | SI: ioredis reconnect | NO | NO |
| Firebase Auth | SI: SDK defaults | SI: SDK retry | NO | NO |
| Pub/Sub | SI: ack_deadline configurados | SI: retry_policy min/max backoff en subscriptions | NO | DLQ configurada en todas las subscriptions activas |

**Ausencia de circuit breaker**: ninguna dependencia externa implementa circuit breaker. Para el volumen pre-comercial actual es aceptable, pero Sovos y Routes API deberían tenerlo antes de escalar (un Sovos caído retiene la emisión de DTEs indefinidamente si el cron de reconciliación sigue intentando).

---

## Compliance Operacional

| Item | Estado |
|---|---|
| Docs SII → Retention Lock (6 años) | Configurado en `storage.tf` pero `is_locked=false`. Gate documentado. NO activado. |
| Crash traces → Retention 7 años | Ídem (`is_locked=false`). |
| Telemetría → DLQ global `pubsub-dead-letter` | SI. Alerta `pubsub_dlq` en monitoring.tf. |
| IAM audit logs | No auditado en esta revisión (contexto de memoria indica drift SEC-001 en prod). |
| SEC-001 drift IAM en prod | Conocido desde memoria. Validar `terraform plan` antes de cualquier apply. |
| Redis TLS CA pinning (ADR-058) | RESUELTO: `packages/config/src/redis-tls.ts` + `compute.tf:28` inyectan todos los `server_ca_certs`. |
| E2E nightly pega a PRODUCCIÓN | Conocido. `e2e-staging.yml` contra `PRODUCTION_URL`. Backlog `#STAGING-ENV`. |
| DB migrations con advisory lock | SI: `runMigrationsGated` + `pg_advisory_lock`. Correcto. |
| `STRICT_MIGRATION_ORDERING=true` en prod | Activado. Fail-closed en fallo de migración. |

---

## Conexión con contexto de memorias

- **SEC-001 drift IAM (jun-2026)**: el monitoreo actual usa log-based metrics cuyo scope es `cloud_run_revision`. Si hay recursos IAM en drift (funciones huérfanas, Owner = grupo), estos no afectan la observabilidad de Cloud Run directamente, pero las alertas pueden enviarse a canales con permisos incorrectos. Validar `terraform plan` antes del próximo apply de infra.
- **Redis TLS CA pinning (ADR-058)**: resuelto correctamente. `buildRedisTlsOptions` en `packages/config/src/redis-tls.ts` pineaa los `server_ca_certs` y falla ruidosamente si `REDIS_TLS=true` y `REDIS_CA_CERT` está ausente en prod (`requireCa: true`). Terraform inyecta todos los certs concatenados. El incidente 2026-06-07 no se repetirá por esta causa.
- **CI release paths-ignore (jun-2026)**: confirmado en `release.yml:16`. No se usa `**/*.md`. La ruta docs/adr está en el denylist. Correcto.

---

## Signed Off?

NO — requiere resolución de F-01 (Routes API timeout) antes de poder considerar los caminos críticos como ready para SLA. F-03 (skeletons con subscriptions activas) bloquea la operatividad real de las notificaciones de seguridad física. F-02 (deploy GKE manual) es un riesgo de proceso que debe documentarse en el runbook de deploy con gate explícito.

---

## Resumen de Severidades

| Severidad | Cantidad | IDs |
|---|---|---|
| P0 | 3 | F-01, F-02, F-03 |
| P1 | 5 | F-04, F-05, F-06, F-07, F-08 |
| P2 | 6 | F-09, F-10, F-11, F-12, F-13, F-14 |
