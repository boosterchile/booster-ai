# Runbook — Servicio `apps/document-service` (worker TED, Pub/Sub consumer)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-document-service` · región `southamerica-west1` · project `booster-ai-494222` · `ingress = INTERNAL_ONLY`, `public = false`, `min/max = 0/10`, `memory = 1Gi` (rasterizar PDF usa RAM).
- **Naturaleza**: **consumer Pub/Sub pull** (entrypoint `apps/document-service/src/main.ts`; health probe HTTP en `/health` puerto 8080). Consume la subscription `document-uploaded-processor-sub` (topic `document.uploaded`). Por mensaje: valida el payload (Zod), **reclama la fila por estado** (idempotencia: `UPDATE documentos_transporte SET extraction_status='procesando' WHERE id=? AND extraction_status IN ('pendiente','fallido')`), descarga el objeto de GCS y **decodifica el TED** (Timbre Electrónico Documento, PDF417) de los documentos tributarios de terceros (Guía de Despacho DTE 52, Factura 33…) vía `@booster-ai/transport-documents` (pdfium WASM + zxing-wasm + sharp). Persiste `decodificado` (campos `<DD>` + `ted_raw` + `retention_until`) o `fallido`.

> **Importante (ADR-069 / ADR-070)**: Booster **recibe y archiva** documentos de terceros — **NO emite DTE ni se integra con el SII**. Este servicio sólo decodifica e indexa. La verificación criptográfica de la firma `<FRMT>` está **fuera de alcance** (gate C-7 §6). No busques acá lógica de facturación electrónica.

---

## Dependencias y datos

| Recurso | Detalle |
|---|---|
| **Pub/Sub** | sub `document-uploaded-processor-sub` (ack deadline 120 s, **DLQ `pubsub-dead-letter` tras 5 nacks**, retry 10 s–600 s). |
| **GCS bucket `documents`** | `{project}-documents-{env}` (env `DOCUMENTS_BUCKET`). **Retención SII 6 años**, CMEK key `documents`. Objetos en `transport-documents/<tripId>/<uuid>.<ext>`. El worker **nunca borra ni reescribe** el objeto original (retención legal, O-3). |
| **Postgres** | tabla `documentos_transporte` (`extraction_status`, `decodificado` JSONB, `ted_raw`, `retention_until`). |

Env vars (`apps/document-service/src/config.ts`, Zod): `DATABASE_URL` (secret), `GOOGLE_CLOUD_PROJECT`, `DOCUMENTS_BUCKET` (required), `PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED` (default `document-uploaded-processor-sub`), `MAX_MESSAGES_IN_FLIGHT` (default 5).

> La lógica de dominio (parser `<DD>`, cálculo de retención) vive en `packages/transport-documents`, no inline (C-4).

---

## Síntomas / alertas que disparan este runbook

| Alerta (policy) | Significado |
|---|---|
| `Pub/Sub DLQ has messages` (`monitoring.tf:194`) | mensajes en `pubsub-dead-letter` tras 5 nacks — incluye los de este worker |
| (operacional) documentos quedan en `extraction_status='pendiente'` o `'procesando'` y no avanzan | el consumer no consume, o falla la decodificación/GCS/DB |
| (operacional) muchos `extraction_status='fallido'` | TED ilegible (PDF malo) o regresión del decoder |

> No tiene alert policy propia más allá de la DLQ compartida. Es procesamiento **offline** (los docs no son tiempo-real): `min_instances=0` y cold start son aceptables — un doc que tarda en procesarse no es incidente, uno que **nunca** procesa sí.

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

# 3. Errores
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-document-service" severity>=ERROR' \
  --project=$PROJECT --limit=40 --freshness=1h

# 4. Backlog de la subscription (¿se está acumulando?)
gcloud pubsub subscriptions describe document-uploaded-processor-sub --project=$PROJECT \
  --format='value(name)' && \
gcloud monitoring time-series list --project=$PROJECT \
  --filter='metric.type="pubsub.googleapis.com/subscription/num_undelivered_messages" AND resource.labels.subscription_id="document-uploaded-processor-sub"' \
  --interval-end-time=$(date -u +%Y-%m-%dT%H:%M:%SZ) 2>/dev/null | tail -5
```

> Si el `gcloud monitoring` es engorroso, mirá el backlog en la consola (Pub/Sub → Subscriptions → `document-uploaded-processor-sub` → Unacked).

---

## Los documentos no se procesan (quedan en `pendiente`)

1. **¿El consumer está vivo?** Como `min_instances=0`, una instancia levanta cuando hay mensajes (Cloud Run for Pub/Sub pull con autoscaling). Si hay backlog pero ninguna instancia procesa, revisar que la revisión arranca (no `Failed` por env faltante: `DOCUMENTS_BUCKET`/`DATABASE_URL`).
2. **Errores en el handler** (paso 3): patrones:
   - `permission denied` leyendo GCS → IAM del SA sin `storage.objectViewer` sobre `documents` (reaplicar Terraform).
   - `bucket not found` → `DOCUMENTS_BUCKET` mal seteada.
   - DB inalcanzable → no puede reclamar la fila ni persistir.
3. **Reproc**: un documento en `pendiente`/`fallido` se **re-reclama** si vuelve a entrar un mensaje para su `id` (el claim condicional acepta `IN ('pendiente','fallido')`). Si el mensaje original ya se ack-eó, re-publicar al topic `document.uploaded` con el payload del doc, o reprocesar desde el api el flujo que lo emite.

---

## Muchos `fallido` (TED ilegible)

1. Mirar el log de la decodificación: ¿el PDF417 no se detecta, o el PDF no rasteriza?
2. **Un solo documento** → probablemente un PDF de mala calidad / sin TED válido. Es un fallo esperado del dato, no del servicio; queda `fallido` con su `retention_until` igual seteado (el objeto se archiva).
3. **Muchos a la vez tras un deploy** → posible **regresión del decoder** (`@booster-ai/transport-documents`). Verificar `git log packages/transport-documents/` y considerar rollback (abajo).

---

## Mensajes en DLQ

Tras 5 nacks el mensaje va a `pubsub-dead-letter`. Ver `service-telemetry-processor.md` §"Mensajes en DLQ" para el procedimiento de inspección/reproc (es el mismo topic compartido). Resumen:

```bash
gcloud pubsub subscriptions pull pubsub-dead-letter-sub \
  --limit=20 --project=$PROJECT --format=json | python3 -m json.tool   # SIN --auto-ack
```
Arreglar la causa raíz (GCS/IAM/DB) y re-publicar al topic `document.uploaded`.

---

## Restart / rollback

```bash
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
  --to-revisions=<REVISION_SANA>=100
```

> El rollback de código es seguro: este servicio **no corre migraciones** ni reescribe los objetos GCS (sólo lee de `documents` y escribe filas en `documentos_transporte`). El objeto original siempre se preserva (retención legal).

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal: email. Si no se resuelve en 30 min, registrar en `docs/handoff/CURRENT.md`.
- **Nunca** tocar la retención del bucket `documents` (6 años SII) ni borrar objetos para "resolver" un fallo — es obligación legal. Si hace falta tocar el lock/retención, es decisión del PO en sesión dedicada (sec-h3).

## Refs

- DLQ compartida: `service-telemetry-processor.md`.
- Migración del bucket de certificados (separó certs de `documents`): `migracion-bucket-certificados.md`.
- ADR-069 / ADR-070 (recibir/archivar, NO emitir DTE). Sub/DLQ: `infrastructure/messaging.tf`. Bucket: `infrastructure/storage.tf`.
- Config: `apps/document-service/src/config.ts`. Dominio: `packages/transport-documents`.
