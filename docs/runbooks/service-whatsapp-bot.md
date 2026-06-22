# Runbook — Servicio `apps/whatsapp-bot` (webhook Twilio WhatsApp + NLU)

- **Estado**: Vigente
- **Servicio Cloud Run**: `booster-ai-whatsapp-bot` · región `southamerica-west1` · project `booster-ai-494222` · `ingress = INTERNAL_LOAD_BALANCER` (el webhook entra por GCLB, ADR-063), `public = true` vía LB. `min/max = 0/20`, VPC connector (Redis privado).
- **Naturaleza**: webhook HTTP (Hono, puerto 8080) que recibe los mensajes de WhatsApp **vía Twilio** (no Meta Cloud API directo). Entrypoint `apps/whatsapp-bot/src/main.ts`. Conduce una conversación stateful (state machine XState v5 persistida en **Redis** por número E.164) para que el usuario cree una solicitud de carga; al completar el flujo llama `POST /trip-requests` del **api** (identity token OIDC SA-to-SA) y devuelve el `tracking_code` por WhatsApp.

---

## Endpoints

| Endpoint | Uso |
|---|---|
| `GET /health`, `GET /ready` | liveness/readiness (200; no tiene deps duras al startup). |
| `GET /webhooks/whatsapp` | responde 200 para la validación de Twilio Console. |
| `POST /webhooks/whatsapp` | inbound de mensajes (body `application/x-www-form-urlencoded`: `From`, `To`, `Body`, `MessageSid`…). **Valida `X-Twilio-Signature`** (HMAC-SHA1 sobre URL + params ordenados, comparación timing-safe). |
| `POST /webhooks/twilio-status` | callbacks de estado (delivered/read/failed). |

> La firma se valida contra `TWILIO_WEBHOOK_URL` (debe ser **exactamente** `https://api.boosterchile.com/webhooks/whatsapp`). Si la URL configurada en Twilio Console no coincide carácter por carácter con esa env var → toda request se rechaza por firma inválida (403). Esto es la causa #1 de "el bot no responde".

Env vars clave (`apps/whatsapp-bot/src/config.ts`, Zod): `TWILIO_ACCOUNT_SID` (`AC…`), `TWILIO_AUTH_TOKEN` (secret), `TWILIO_FROM_NUMBER` (E.164), `TWILIO_WEBHOOK_URL`, `TWILIO_STATUS_CALLBACK_URL` (opcional), `API_URL`, `API_OIDC_AUDIENCE`, `CONVERSATION_TTL_MS` (default 30 min), config Redis.

---

## Síntomas / alertas que disparan este runbook

> No hay alert policy dedicada al whatsapp-bot en `monitoring.tf` (los SLO de error-rate/latencia cubren `booster-ai-api`, no este servicio). Las señales son **operacionales / por reporte de usuario**:

| Síntoma | Probable causa |
|---|---|
| Usuarios escriben al WhatsApp y **no reciben respuesta** | webhook caído, firma inválida (URL mismatch), o Twilio no entrega |
| El bot responde pero **no crea la solicitud** (no llega `tracking_code`) | falla la llamada a `POST /trip-requests` del api (OIDC, api caído) |
| El bot "se olvida" del contexto a mitad de flujo | Redis inalcanzable (no persiste el snapshot XState) |
| Mensajes duplicados / re-procesados | dedup de Redis fallando (`bot:dedup:<MessageSid>`) |

---

## Diagnóstico

```bash
SVC=booster-ai-whatsapp-bot ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# 1. ¿La revisión está sana y sirviendo?
gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic, status.conditions[0].message)'

# 2. ¿Llegan los webhooks y con qué status responde el bot?
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-whatsapp-bot"' \
  --project=$PROJECT --limit=50 --freshness=30m \
  --format='value(timestamp, jsonPayload.message, httpRequest.requestUrl, httpRequest.status)'

# 3. Errores (firma inválida, OIDC, Redis)
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-whatsapp-bot" severity>=WARNING' \
  --project=$PROJECT --limit=40 --freshness=30m
```

---

## El bot no responde

1. **¿Twilio está entregando el webhook?** Twilio Console → Monitor → Logs → Errors (o Messaging logs). Si Twilio marca el POST con **11200/11205/timeout** o **403**, el problema es de recepción:
   - **403 / firma inválida**: la URL configurada en Twilio (Sender → Inbound URL) **no coincide** con `TWILIO_WEBHOOK_URL`. Corregir para que ambas sean `https://api.boosterchile.com/webhooks/whatsapp` exactas (sin `/` final, sin diferencias de host).
   - **timeout / 5xx**: el bot está caído o lento → seguir con paso 2.
2. **¿La revisión arranca?** Si está `Failed`, casi siempre es env/secret faltante (el Zod de `config.ts` corta el startup): falta `TWILIO_AUTH_TOKEN` (secret), `API_URL`, o una env mal formada. Revisar `--set-secrets`/`--set-env-vars` de la revisión.
3. **Mitigación = rollback** a la última revisión sana:
   ```bash
   gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
   gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
     --to-revisions=<REVISION_SANA>=100
   ```
4. **Smoke** end-to-end: mandar un WhatsApp real al `TWILIO_FROM_NUMBER` y confirmar respuesta. Si no llega, revisar también que el número/sender Twilio esté aprobado por Meta y el usuario no esté en opt-out (Twilio Studio → Logs).

---

## El bot responde pero no crea la solicitud

El flujo XState llega a `submitted` pero el `POST /trip-requests` al api falla.

1. Buscar el error de la llamada saliente en los logs (paso 3): típicamente `401/403` (OIDC) o `5xx` del api.
   - **OIDC 401/403**: el identity token SA-to-SA fue rechazado por el api → verificar que el caller SA del bot está en `ALLOWED_CALLER_SA` del api y que `API_OIDC_AUDIENCE` coincide con el `API_AUDIENCE` del api.
   - **5xx del api**: el problema es del backend → `service-api.md`.
2. Mientras se arregla, los mensajes del usuario quedan en su conversación Redis (TTL `CONVERSATION_TTL_MS`, 30 min) — si se resuelve rápido el usuario puede reintentar sin empezar de cero.

---

## Dependencia: Redis (conversaciones + dedup)

El bot guarda el snapshot XState en `bot:session:<E164>` y deduplica con `bot:dedup:<MessageSid>` (SET NX, TTL 1 h). Es la **misma instancia Memorystore** que el resto.

- **Síntoma**: el bot pierde contexto a mitad de flujo, o re-procesa mensajes duplicados de Twilio.
- Aplica la misma causa conocida de TLS/CA que el api (memoria "Redis TLS CA pinning", ADR-058): tras un replace de Memorystore, `REDIS_CA_CERT` puede quedar desalineada. Verificar (ver `service-api.md` §Redis) y hacer una op real de Redis tras tocar la instancia.

---

## Escalación

- **Operador único** (`dev@boosterchile.com`). Canal: email. Si no se resuelve en 30 min, registrar en `docs/handoff/CURRENT.md`.
- Problemas de **entrega de WhatsApp / templates / aprobación Meta** (no del servicio): ver `load-content-sids.md` y la memoria "Safety alert template". Si un template está atascado en revisión de Meta, eso no se resuelve desde el bot.

## Refs

- Templates/Content SIDs de WhatsApp: `load-content-sids.md`.
- WhatsApp como canal primario: ADR-006. Webhooks vía LB: ADR-063.
- Config/rutas: `apps/whatsapp-bot/src/config.ts`, `apps/whatsapp-bot/src/routes/webhook.ts`.
