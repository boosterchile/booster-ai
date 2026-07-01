# Runbook — Servicio `apps/sms-fallback-gateway` (webhook Twilio SMS → Pub/Sub)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-sms-fallback-gateway` · región `southamerica-west1` · project `booster-ai-494222`.
- **Ingress**: `INGRESS_TRAFFIC_ALL`, `public = true` — **decisión deliberada** (`compute.tf`): Twilio postea desde su propia infra **directo al `*.run.app`** (no pasa por el GCLB). Restringir el ingress rompería la ingesta de respaldo. `min/max = 0/10`.
- **Naturaleza**: webhook HTTP (Hono, puerto 8080, entrypoint `apps/sms-fallback-gateway/src/main.ts`) para el **fallback por SMS** de los devices Teltonika: cuando un FMC150 detecta un evento panic (Crash/Unplug/GNSS Jamming) y **no tiene GPRS**, envía un SMS al número Twilio. Twilio lo POSTea acá, el servicio valida la firma, parsea el formato canónico `BSTR|imei|datetime|lat,lon|spd|val|io_id` y **publica a Pub/Sub `telemetry-events`** (atributos `priority=2`, `source='sms-fallback'`). De ahí lo consume el `telemetry-processor` igual que un record normal (ver `service-telemetry-processor.md`).

> Es **stateless**: no usa Redis ni DB. Su única dependencia de salida es Pub/Sub. La idempotencia la garantiza el `UNIQUE(imei, timestamp_device)` aguas abajo en `telemetria_puntos`.

---

## Endpoints y comportamiento de status codes

| Endpoint | Uso |
|---|---|
| `GET /health` | liveness (`{status:'ok', service:'sms-fallback-gateway'}`). |
| `POST /webhook` | inbound SMS de Twilio (`application/x-www-form-urlencoded`: `From`, `Body`, `MessageSid`…). Valida `X-Twilio-Signature` (HMAC-SHA1, timing-safe). |

**Semántica de respuesta (clave para el diagnóstico):**
- **Parse inválido** (IMEI/fecha/coords mal, AVL id fuera de whitelist) → **200 OK** a propósito: Twilio **no reintenta** un SMS irrecuperable. Queda log `warn`.
- **Fallo al publicar a Pub/Sub** → **500**: Twilio **reintenta** el webhook (no se pierde el evento).
- **Fail-closed en prod**: si falta `TWILIO_AUTH_TOKEN` o `WEBHOOK_PUBLIC_URL`, el servicio **rechaza todos los webhooks** (log `TWILIO_AUTH_TOKEN o WEBHOOK_PUBLIC_URL faltante en producción — rechazando todos los webhooks`).

Env vars (`apps/sms-fallback-gateway/src/config.ts`, Zod): `TWILIO_AUTH_TOKEN` (secret), `WEBHOOK_PUBLIC_URL` (la URL canónica que Twilio tiene configurada; la firma se valida contra ella), `GOOGLE_CLOUD_PROJECT`, `PUBSUB_TOPIC_TELEMETRY` (default `telemetry-events`).

---

## Síntomas / alertas que disparan este runbook

> No hay alert policy dedicada a este servicio. Es un **camino de respaldo de baja frecuencia** (idealmente ~0 SMS: significa que el GPRS funciona). Las señales:

| Síntoma | Probable causa |
|---|---|
| Un evento panic (unplug/jamming) **llegó por SMS pero no apareció** en telemetría | webhook rechazando (fail-closed / firma), o fallo de publish a Pub/Sub |
| Twilio Console muestra el SMS entrante con **error de webhook** (5xx/timeout) | servicio caído, o Pub/Sub inalcanzable (500) |
| Twilio muestra **403** en el webhook | firma inválida: `WEBHOOK_PUBLIC_URL` ≠ URL configurada en Twilio |

Como es el respaldo de un sistema de **seguridad física**, un evento panic perdido es serio aunque el volumen sea bajo. Reportar horarios al PO en **America/Santiago**.

---

## Diagnóstico

```bash
SVC=booster-ai-sms-fallback-gateway ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# 1. Revisión sana + env/secrets presentes
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic, status.conditions[0].message)'

# 2. ¿Llegan webhooks y qué pasa con ellos? (parse ok/fail, publish, latency)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-sms-fallback-gateway"' \
  --project=$PROJECT --limit=50 --freshness=2h \
  --format='value(timestamp, jsonPayload.message, jsonPayload.imei, jsonPayload.avlId, jsonPayload.publishedId)'

# 3. Errores (fail-closed, firma, publish)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-sms-fallback-gateway" severity>=WARNING' \
  --project=$PROJECT --limit=40 --freshness=2h
```

Verificación cruzada con Twilio: Console → Monitor → Logs → Messaging, filtrar por el número de respaldo; ver si el SMS entrante marca el webhook OK o con error.

---

## El SMS llegó pero el evento no aparece

1. **¿El servicio está rechazando todo (fail-closed)?** Buscar en logs `rechazando todos los webhooks`. Si aparece → falta `TWILIO_AUTH_TOKEN` o `WEBHOOK_PUBLIC_URL` en la revisión activa. Reaplicar secret/env y redeploy:
   ```bash
   gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
     --format='value(spec.template.spec.containers[0].env[].name)'   # ¿está WEBHOOK_PUBLIC_URL?
   ```
2. **¿Firma inválida (403)?** `WEBHOOK_PUBLIC_URL` debe coincidir **exactamente** con la URL que Twilio tiene configurada (Console → número → Messaging → webhook entrante). Como este servicio recibe en su `*.run.app` directo, la URL es `https://booster-ai-sms-fallback-gateway-<...>.southamerica-west1.run.app/webhook`. Si el servicio fue recreado y cambió la URL `*.run.app`, hay que **actualizar Twilio Y `WEBHOOK_PUBLIC_URL`** a la nueva.
3. **¿Fallo de publish a Pub/Sub (500)?** Buscar el error de publish en logs (paso 3). Causas: IAM (el SA del servicio sin `pubsub.publisher` sobre el topic), o el topic `telemetry-events` ausente/renombrado. Como devuelve 500, Twilio reintenta → el evento se recupera al arreglar la causa.
4. **El parse fue inválido (200, descartado)**: si el `Body` del SMS no cumple el formato `BSTR|…`, el servicio lo descarta a propósito. Eso apunta a un problema de **firmware/config del device** (formato del SMS), no del gateway → ver config del device en `docs/research/teltonika-fmc150/`.

---

## Restart / rollback

```bash
# Rollback a revisión sana:
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
  --to-revisions=<REVISION_SANA>=100

# Forzar nueva revisión (p.ej. tras cargar el secret) sin cambiar imagen:
gcloud run services update $SVC --region=$REGION --project=$PROJECT \
  --update-annotations=last-restart=$(date +%s)
```

> Tras recrear el servicio o cambiar su URL `*.run.app`, **siempre** re-sincronizar la URL en Twilio Console y en `WEBHOOK_PUBLIC_URL` — si quedan desalineadas, todo entra como firma inválida.

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal: email. Si no se resuelve en 30 min, registrar en `docs/handoff/CURRENT.md`.
- Un evento panic real perdido (unplug/jamming que vino por SMS y no se procesó) es un incidente de **seguridad física** → tras restaurar la ingesta, seguir `oncall-telemetry-incidents.md` para el evento en sí (confirmar con el carrier, etc.).

## Refs

- Procesamiento aguas abajo: `service-telemetry-processor.md`, `oncall-telemetry-incidents.md`.
- Ingress deliberadamente abierto: `infrastructure/compute.tf` (bloque `service_sms_fallback_gateway`), ADR-062.
- Config/parser: `apps/sms-fallback-gateway/src/config.ts`, `apps/sms-fallback-gateway/src/parser.ts`.
