# Runbook — Servicio `apps/document-service` (worker TED, Pub/Sub consumer)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-document-service` · región `southamerica-west1` · project `booster-ai-494222` · `ingress = INTERNAL_ONLY`, `public = false`, `max = 10`, `cpu = 1`, `memory = 1Gi` (rasterizar PDF usa RAM), concurrencia 4, VPC connector `serverless` (Cloud SQL privado). Mínimo y CPU según el modo (abajo). Imagen propia desde T10-21 (`cloudbuild.production.yaml` step `deploy-document-service`, que no toca mínimo ni CPU).
- **Naturaleza**: **consumer Pub/Sub** de la subscription `document-uploaded-processor-sub` (topic `document.uploaded`), en uno de dos modos que fija `var.document_service_push` (ADR-085):

  | Modo | Cómo llega el mensaje | Mínimo / CPU | `DOCUMENT_CONSUMER_MODE` |
  |---|---|---|---|
  | **pull** (`false`, default) | StreamingPull dentro del container | `min=1`, CPU siempre asignada | `pull` |
  | **push** (`true`) | Pub/Sub hace `POST /pubsub/document-uploaded` con un OIDC de `document-push-invoker@` | `min=0`, CPU solo en requests | `push` |

  El HTTP (`/health` y el endpoint push, puerto 8080) corre en los dos modos; el endpoint solo acepta el OIDC de `PUSH_CALLER_SA`. Entrypoint `apps/document-service/src/main.ts`. Por mensaje: valida el payload (Zod), **reclama la fila por estado** (idempotencia: `UPDATE documentos_transporte SET extraction_status='procesando' WHERE id=? AND extraction_status IN ('pendiente','fallido')`), descarga el objeto de GCS y **decodifica el TED** (Timbre Electrónico Documento, PDF417) de los documentos tributarios de terceros (Guía de Despacho DTE 52, Factura 33…) vía `@booster-ai/transport-documents` (pdfium WASM + zxing-wasm + sharp). Persiste `decodificado` (campos `<DD>` + `ted_raw` + `retention_until`) o `fallido`.

> **Importante (ADR-069 / ADR-070)**: Booster **recibe y archiva** documentos de terceros — **NO emite DTE ni se integra con el SII**. Este servicio sólo decodifica e indexa. La verificación criptográfica de la firma `<FRMT>` está **fuera de alcance** (gate C-7 §6). No busques acá lógica de facturación electrónica.

---

## Dependencias y datos

| Recurso | Detalle |
|---|---|
| **Pub/Sub** | sub `document-uploaded-processor-sub` (ack deadline 300 s, igual al timeout del request del servicio, **DLQ `pubsub-dead-letter` tras 5 intentos**, retry 10 s–600 s). En push, ack = respuesta 204 y nack = 500/401/403/404. El reenvío a la DLQ necesita que el service agent de Pub/Sub tenga `pubsub.publisher` sobre `pubsub-dead-letter` y `pubsub.subscriber` sobre esta sub (`messaging.tf`). |
| **IAM del push** | SA `document-push-invoker@` (`messaging.tf`): `run.invoker` solo sobre este servicio; el service agent de Pub/Sub tiene `serviceAccountOpenIdTokenCreator` sobre él. El servicio declara la audience del push (`PUSH_OIDC_AUDIENCE`, URL run.app determinista) como custom audience. |
| **GCS bucket `documents`** | `{project}-documents-{env}` (env `DOCUMENTS_BUCKET`). **Retención SII 6 años**, CMEK key `documents`. Objetos en `transport-documents/<tripId>/<uuid>.<ext>`. El worker **nunca borra ni reescribe** el objeto original (retención legal, O-3). |
| **Postgres** | tabla `documentos_transporte` (`extraction_status`, `decodificado` JSONB, `ted_raw`, `retention_until`). |

Env vars (`apps/document-service/src/config.ts`, Zod): `DATABASE_URL` (secret), `GOOGLE_CLOUD_PROJECT`, `DOCUMENTS_BUCKET` (required), `DOCUMENT_CONSUMER_MODE` (`pull`|`push`, default `pull`), `PUSH_CALLER_SA` y `PUSH_OIDC_AUDIENCE` (juntos; obligatorios en push), `PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED` (default `document-uploaded-processor-sub`, solo pull), `MAX_MESSAGES_IN_FLIGHT` (default 5, solo pull).

> La lógica de dominio (parser `<DD>`, cálculo de retención) vive en `packages/transport-documents`, no inline (C-4).

---

## Síntomas / alertas que disparan este runbook

| Alerta (policy) | Significado |
|---|---|
| `document-service: mensajes de document.uploaded enviados a la DLQ (ERROR)` (`document-service.tf`) | un mensaje agotó sus 5 intentos. En push, casi siempre OIDC/IAM/endpoint mal aplicados (ver §Push) o GCS/DB caídos |
| `document-service: document.uploaded sin confirmar > 30 min (ERROR)` (`document-service.tf`) | hay un mensaje sin confirmar hace 30 min: en pull, no hay instancia consumiendo; en push, Pub/Sub no logra entregar ni reenviar a la DLQ |
| `Pub/Sub DLQ has messages` (`monitoring.tf:194`) | **no se dispara hoy**: mira `num_unacked_messages_by_region` del topic `pubsub-dead-letter`, que no tiene suscripción. Usar la alerta de DLQ propia (primera fila) |
| (operacional) documentos quedan en `extraction_status='pendiente'` o `'procesando'` y no avanzan | el consumer no consume, o falla la decodificación/GCS/DB |
| (operacional) muchos `extraction_status='fallido'` | TED ilegible (PDF malo) o regresión del decoder |

> Es procesamiento **offline** (los docs no son tiempo-real): un doc que tarda en procesarse no es incidente, uno que **nunca** procesa sí.
>
> En **pull**, `min_instances=1` + `cpu_idle=false` no son optimización: con `min=0` la instancia escala a cero y **nadie consume** (no llegan requests que la despierten); con `cpu_idle=true` el pull queda CPU-throttled. Mismo modo de falla del incidente de telemetry-processor del 2026-06-07. En **push** sí van `min=0` + `cpu_idle=true`: cada mensaje es un request que despierta una instancia. El modo, el mínimo y la CPU se cambian juntos con `var.document_service_push` y `terraform apply`; nunca con `gcloud run services update`.

---

## Diagnóstico

```bash
SVC=booster-ai-document-service ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# 1. ¿Hay instancia consumiendo? ¿Revisión sana?
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic, status.conditions[0].message)'

# 2. Logs del worker (por mensaje: claim, decode, persist, ack/nack)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-document-service"' \
  --project=$PROJECT --limit=50 --freshness=1h

# 3. Errores y rechazos. WARNING incluye los 4xx que registra Cloud Run
#    (p. ej. el 403 de IAM, que no llega a la app).
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-document-service" severity>=WARNING' \
  --project=$PROJECT --limit=40 --freshness=1h

# 4. Backlog de la subscription (¿se está acumulando?)
gcloud pubsub subscriptions describe document-uploaded-processor-sub --project=$PROJECT \
  --format='value(name)' && \
gcloud monitoring time-series list --project=$PROJECT \
  --filter='metric.type="pubsub.googleapis.com/subscription/num_undelivered_messages" AND resource.labels.subscription_id="document-uploaded-processor-sub"' \
  --interval-end-time=$(date -u +%Y-%m-%dT%H:%M:%SZ) 2>/dev/null | tail -5
```

> Si el `gcloud monitoring` es engorroso, mirá el backlog en la consola (Pub/Sub → Subscriptions → `document-uploaded-processor-sub` → Unacked).

```bash
# 5. ¿En qué modo está? La sub y el servicio deben coincidir.
gcloud pubsub subscriptions describe document-uploaded-processor-sub --project=$PROJECT \
  --format='value(pushConfig.pushEndpoint)'          # vacío = pull
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='yaml(spec.template.metadata.annotations,spec.template.spec.containers[0].env)' \
  | grep -E -A1 'minScale|cpu-throttling|DOCUMENT_CONSUMER_MODE'   # -A1: el value va en la línea siguiente
```

> **Métrica de negocio**: `workload.googleapis.com/documentos_entregas_total` (Metrics Explorer), por `transporte` (`pull`/`push`) y `resultado`: `decodificado`, `fallido`, `skipped`, `malformado`, `sobre_invalido`, `error_transitorio` y `no_autorizado`. Muchos `no_autorizado` = OIDC mal configurado; `error_transitorio` sostenido = GCS o la base. Con CPU solo en requests, los puntos pueden llegar con atraso: se vacían al apagarse la instancia.

---

## Los documentos no se procesan (quedan en `pendiente`)

1. **¿El consumer está vivo?** En pull debe haber siempre 1 instancia (`min_instances=1`); en push no hace falta ninguna entre documentos. Revisar que la revisión arranca (no `Failed` por env faltante: `DOCUMENTS_BUCKET`/`DATABASE_URL`, o `PUSH_CALLER_SA` en push) y que el modo de la sub coincide con el del servicio (diagnóstico 5). Una sub en pull con el servicio en `min=0` deja todo sin consumir; una sub en push con la revisión vieja (sin endpoint) da 404 y termina en la DLQ.
2. **¿El api publica?** El api necesita `DOCUMENT_UPLOADED_TOPIC` (compute.tf `service_api`); sin él omite el publish y los documentos quedan en `pendiente`. El cron `documentos-pendientes` (cada 15 min, `POST /admin/jobs/documentos-pendientes`) republica los `pendiente` sin tocar por > 10 min; su respuesta `skipped: topic_not_configured` delata la env faltante.
3. **Errores en el handler** (paso 3): patrones:
   - `permission denied` leyendo GCS → IAM del SA sin `storage.objectViewer` sobre `documents` (reaplicar Terraform).
   - `bucket not found` → `DOCUMENTS_BUCKET` mal seteada.
   - DB inalcanzable → no puede reclamar la fila ni persistir.
4. **Reproc**: un documento en `pendiente`/`fallido` se **re-reclama** si vuelve a entrar un mensaje para su `id` (el claim condicional acepta `IN ('pendiente','fallido')`). Los `pendiente` los republica solo el cron `documentos-pendientes`. Un `fallido` se reprocesa re-publicando al topic `document.uploaded` con el payload del doc.
5. **Atascados en `procesando`**: el worker murió a mitad (p. ej. OOM al rasterizar). El cron los pasa a `fallido` tras 30 min **sin republicarlos** (republicar un PDF que tumba al worker repetiría la caída); quedan habilitados para ingreso manual.

---

## Push: Pub/Sub no logra entregar (ADR-085)

Los rechazos del endpoint se ven en los logs de la revisión (`severity>=WARNING`: la app registra los 401 como ERROR y Cloud Run registra los 4xx como WARNING) y en el `request_count` del servicio por código de respuesta.

| Código / log | Causa | Arreglo |
|---|---|---|
| `403` en `request_count`, sin log de la app | `document-push-invoker@` sin `run.invoker` sobre el servicio | reaplicar Terraform (`google_cloud_run_v2_service_iam_member.document_push_invoker`) |
| `401` + `push document.uploaded: emisor no autorizado` | el OIDC no es de `PUSH_CALLER_SA` (sub con otro SA, o env mal seteada). El log trae `emailDomain`, no el email | `gcloud pubsub subscriptions describe … --format='value(pushConfig.oidcToken)'` debe mostrar `document-push-invoker@`; reaplicar Terraform |
| `401` + `push document.uploaded: ID token inválido` | `aud` distinto de `PUSH_OIDC_AUDIENCE` (`Wrong recipient` en el error), firma o vencimiento | la `audience` del `oidcToken` de la sub debe ser igual a `PUSH_OIDC_AUDIENCE` del servicio; si no es eso y es sistemático, rollback a pull (abajo) mientras se investiga |
| `404` | la revisión viva no tiene el endpoint (imagen anterior a ADR-085) | desplegar el release con el endpoint, o rollback a pull |
| `500` + `error procesando document.uploaded, nack para reintento` | GCS o la base fallan | igual que en pull (sección anterior, paso 3) |
| sin requests y backlog creciendo | Pub/Sub no llega al servicio (ingress, URL) | el `pushEndpoint` debe ser la URL `run.app` del servicio, no un dominio propio: con `INTERNAL_ONLY` solo esa URL cuenta como tráfico interno |

**Prueba de humo del push** (después de un apply que lo cambie): publicar un mensaje fuera de contrato. No toca la base ni GCS; el worker lo confirma y lo descarta.

```bash
gcloud pubsub topics publish document.uploaded --project=$PROJECT --message='{"smoke":"adr-085"}'
# Esperado en ~1 min: una instancia arranca y el log dice
#   «document.uploaded malformado, ack para descartar (no reintentar)»
# Un 401/403/404 en su lugar → tabla de arriba.
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-document-service" jsonPayload.message:"malformado"' \
  --project=$PROJECT --limit=5 --freshness=10m
```

---

## Muchos `fallido` (TED ilegible)

1. Mirar el log de la decodificación: ¿el PDF417 no se detecta, o el PDF no rasteriza?
2. **Un solo documento** → probablemente un PDF de mala calidad / sin TED válido. Es un fallo esperado del dato, no del servicio; queda `fallido` con su `retention_until` igual seteado (el objeto se archiva).
3. **Muchos a la vez tras un deploy** → posible **regresión del decoder** (`@booster-ai/transport-documents`). Verificar `git log packages/transport-documents/` y considerar rollback (abajo).

---

## Mensajes en DLQ

Tras 5 intentos el mensaje va al topic `pubsub-dead-letter` (retención 30 días). **El topic no tiene suscripción** (verificado el 2026-10-21; la `pubsub-dead-letter-sub` que nombraba este runbook no existe), así que para leerlo hay que crear una y llevarla hacia atrás con `seek`, que la retención del topic permite. Es un cambio en prod: lo decide el PO.

```bash
# Suscripción temporal sobre el topic de la DLQ, llevada 7 días atrás.
gcloud pubsub subscriptions create dlq-inspeccion-documentos --project=$PROJECT \
  --topic=pubsub-dead-letter
gcloud pubsub subscriptions seek dlq-inspeccion-documentos --project=$PROJECT \
  --time=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)
# El atributo CloudPubSubDeadLetterSourceSubscription dice de qué sub vino cada
# mensaje (el topic es compartido con las demás subs que tienen DLQ).
gcloud pubsub subscriptions pull dlq-inspeccion-documentos \
  --limit=20 --project=$PROJECT --format=json | python3 -m json.tool   # SIN --auto-ack
# Al terminar: gcloud pubsub subscriptions delete dlq-inspeccion-documentos --project=$PROJECT
```
Arreglar la causa raíz (OIDC/IAM/endpoint, GCS, DB) y re-publicar al topic `document.uploaded`. El cron `documentos-pendientes` ya republica solo los que quedaron en `pendiente`.

---

## Restart / rollback

```bash
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
  --to-revisions=<REVISION_SANA>=100
```

> El rollback de código es seguro: este servicio **no corre migraciones** ni reescribe los objetos GCS (sólo lee de `documents` y escribe filas en `documentos_transporte`). El objeto original siempre se preserva (retención legal).
>
> Con la sub en push, volver a una revisión anterior a ADR-085 deja el endpoint en 404: primero el rollback del modo.

**Rollback del modo (push → pull, ADR-085)**. La imagen no cambia: sirve los dos modos. Va en dos pasos y **en este orden**, porque Terraform actualiza el servicio antes que la suscripción, y un StreamingPull rechazado contra una suscripción todavía en push podría no reintentarse:

```bash
# 1. La suscripción a pull (endpoint vacío). Los mensajes quedan retenidos.
gcloud pubsub subscriptions modify-push-config document-uploaded-processor-sub \
  --project=$PROJECT --push-endpoint=""
# 2. document_service_push = false y terraform apply con el mismo -target del
#    rollout (.specs/document-service-push/spec.md §10). El servicio vuelve a
#    min=1, CPU siempre asignada y modo pull. El plan ya no muestra cambios en
#    la suscripción.
# 3. Verificar: pushConfig vacío (diagnóstico 5), StreamingPull abierto y la
#    prueba de humo del push, ahora consumida por el pull.
gcloud monitoring time-series list --project=$PROJECT \
  --filter='metric.type="pubsub.googleapis.com/subscription/open_streaming_pulls" AND resource.labels.subscription_id="document-uploaded-processor-sub"' \
  --interval-start-time=$(date -u -v-10M +%Y-%m-%dT%H:%M:%SZ) --interval-end-time=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --format='value(points[0].value.int64Value)'   # > 0
```

Si `open_streaming_pulls` queda en 0 con la sub ya en pull, el cliente se cerró: los logs dicen `subscription error`. Forzar una revisión nueva con un cambio de env, que siempre crea revisión: `gcloud run services update $SVC --region=$REGION --project=$PROJECT --update-env-vars=REINICIO=<timestamp>`. El siguiente `terraform apply` quita esa env.

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal: email. Si no se resuelve en 30 min, registrar en `docs/handoff/CURRENT.md`.
- **Nunca** tocar la retención del bucket `documents` (6 años SII) ni borrar objetos para "resolver" un fallo — es obligación legal. Si hace falta tocar el lock/retención, es decisión del PO en sesión dedicada (sec-h3).

## Refs

- DLQ compartida: `service-telemetry-processor.md`.
- Migración del bucket de certificados (separó certs de `documents`): `migracion-bucket-certificados.md`.
- ADR-069 / ADR-070 (recibir/archivar, NO emitir DTE). Sub/DLQ: `infrastructure/messaging.tf`. Bucket: `infrastructure/storage.tf`.
- Config: `apps/document-service/src/config.ts`. Dominio: `packages/transport-documents`.
- Reconciliación: `apps/api/src/services/reconciliar-documentos-pendientes.ts`; job `documentos_pendientes` en `infrastructure/document-service.tf`.
- Drill de rollback: [`rollback-drill-microservicios.md`](rollback-drill-microservicios.md). Spec: `.specs/document-service-t10-21/spec.md`.
- Pull o push: [ADR-085](../adr/085-document-service-consumidor-push.md), `.specs/document-service-push/spec.md`. Flag `document_service_push` (`infrastructure/variables.tf`).
