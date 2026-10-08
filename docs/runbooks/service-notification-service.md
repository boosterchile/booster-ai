# Runbook — Servicio `apps/notification-service` (canal WhatsApp)

- **Estado**: Vigente desde T10-21 (`.specs/notification-service-t10-21/spec.md`, [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md)).
- **Servicio Cloud Run**: `booster-ai-notification-service` · región `southamerica-west1`.
  - Red y acceso: `ingress = INTERNAL_ONLY`, `public = false`.
  - Escala: `min/max = 1/5`, `cpu_idle = false`, `cpu = 1`, `memory = 512Mi`.
- **Naturaleza**: consumer **Pub/Sub pull** de `notification-events-sub`, topic `notification-events`, con exactly-once delivery y DLQ tras 5 intentos.
  - Entrega WhatsApp (Twilio Content Templates) con sus propias credenciales.
  - Health en `/health`.
  - Sin base de datos ni Redis.

## Lo primero que tenés que saber

**Quién envía un WhatsApp lo deciden dos flags del api** (`infrastructure/variables.tf` → env de `service_api`):

| `notifications_via_microservice` | `notifications_shadow` | Quién envía | Rol de este servicio |
|---|---|---|---|
| false | false | api directo | Ninguno (consume nada) |
| false | true | api directo | **Sombra**: arma el request con su config, compara el hash con el del api, **nunca envía** |
| true | — | **este servicio** | Entrega real |

Si un WhatsApp no llega, revisa primero los flags.

- **Si el api envía directo**, sigue aplicando `service-api.md`.
- **Si `notifications_via_microservice = true`**, aplica este runbook.

**Sigue en el api** (etapa 2):

- **Web Push / VAPID**: `apps/api/src/services/web-push.ts`.
- **Email**: `apps/api/src/services/notifications/email-sender.ts`.
- **Decidir a quién y qué enviar**: `notify-offer`, `notify-tracking-link`, `chat-whatsapp-fallback`, activación y safety.

## Síntomas / alertas

| Señal | Significado |
|---|---|
| Alerta `notification-service: divergencia en sombra` | El request armado por el servicio difiere del que envió el api. No afecta a usuarios, pero **bloquea el corte** |
| `Pub/Sub DLQ has messages` con mensajes de `notification-events` | 5 intentos fallidos: Twilio 429/5xx persistente o caída de red |
| Backlog creciente en `notification-events-sub` | No hay instancia consumiendo. Revisar que no volvió a `min=0` o `cpu_idle=true` |
| Log `notificacion rechazada por Twilio (no se reintenta)` | Error 4xx de Twilio: número inválido, template no aprobado o content SID mal cargado (`load-content-sids.md`) |
| Log `ack fallido tras envío` | Posible WhatsApp duplicado (el mensaje se reentrega). Raro; si se repite, investigar la latencia del ack |

## Diagnóstico

```bash
SVC=booster-ai-notification-service ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

# Flags vigentes en el api
gcloud run services describe booster-ai-api --region=$REGION --project=$PROJECT \
  --format=json | python3 -c "import json,sys;e=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env'];print({x['name']:x.get('value') for x in e if x['name'].startswith('NOTIFICATION')})"

# Resultados por mensaje (enviada / sombra coincide / diverge / rechazada)
gcloud logging read "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"$SVC\"" \
  --project=$PROJECT --limit=50 --freshness=1h --format='value(timestamp,jsonPayload.message,jsonPayload.contentSid)'

# Errores
gcloud logging read "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"$SVC\" severity>=WARNING" \
  --project=$PROJECT --limit=40 --freshness=1h
```

## Divergencia en sombra

1. Del log `notificacion sombra diverge`, comparar `hashEsperado` (api) con `hashServicio` y el `contentSid`.
2. El hash cubre `{From, To, ContentSid, ContentVariables}`. Las causas típicas son:
   - `TWILIO_FROM_NUMBER` distinto entre `service_api` y `service_notification` (los dos leen `var.twilio_from_number`, salvo un override manual);
   - una versión de `@booster-ai/whatsapp-client` desplegada en un solo servicio, si un release falló a medias.
3. Corregir y dejar correr la sombra hasta acumular ≥ 3 días seguidos con divergencias = 0 antes del corte.

## Rollback

**Del canal (el que importa).** Volver el WhatsApp al envío directo del api:

```bash
cd infrastructure
terraform apply -var=notifications_via_microservice=false   # o en el tfvars
```

El api vuelve a llamar a Twilio en la revisión nueva. Se distingue en los logs de los emisores: `twilioSid` empieza con `SM` (directo) o `pubsub:` (vía servicio). Lo que quedó en la subscription lo entrega igual este servicio mientras siga vivo. Si este servicio es la causa del problema, conviene **purgar** la subscription para no duplicar los reintentos (`gcloud pubsub subscriptions seek notification-events-sub --time=$(date -u +%FT%TZ)`), aceptando que esos mensajes se pierden.

**Del servicio (imagen mala)**:

```bash
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT --to-revisions=<REVISION_SANA>=100
```

## Drill de rollback en staging (criterio de salida T10-21)

Corre en `booster-ai-stg-494222` ([`staging.md`](staging.md)), con `notifications_via_microservice = true` en staging. Objetivo: el WhatsApp vuelve a salir por el api en < 5 min, sin pérdida ni duplicados sin explicar.

**Falla provocada**: una revisión del servicio que apunta a una subscription inexistente. Arranca, pero no consume nada, y los mensajes se acumulan en `notification-events-sub` sin perderse:

```bash
gcloud run services update $SVC --region=$REGION --project=booster-ai-stg-494222 \
  --update-env-vars=PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS=drill-sub-inexistente
```

| # | Criterio | Cómo se mide |
|---|---|---|
| N1 | La falla se detecta | Log `subscription error` del servicio y `num_undelivered_messages` creciente en `notification-events-sub` tras disparar un WhatsApp de prueba (p. ej. un mensaje de chat no leído en staging) |
| N2 | Rollback del canal en < 5 min | Desde `terraform apply -var=notifications_via_microservice=false` (staging) hasta el primer WhatsApp nuevo enviado directo: en los logs del emisor del api (p. ej. `notifyOfferToCarrier sent`), `twilioSid` vuelve a empezar con `SM` en vez de `pubsub:` |
| N3 | Sin pérdida | Al restaurar la env del servicio (`--update-env-vars=PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS=notification-events-sub`), el backlog se entrega una vez: log `notificacion enviada` con el `idempotencyKey` de cada mensaje acumulado |
| N4 | Config igual a Terraform | `terraform plan` de staging sin cambios en `module.service_notification` tras restaurar la env |

Registrar los timestamps (falla, apply, primer envío) y la salida del plan en el PR del corte o en un snapshot de `docs/handoff/`.

## Escalación

- **Operador único** (`dev@boosterchile.com`). Un WhatsApp que no llega con el flag activo: hacer el rollback del canal primero y diagnosticar después.

## Refs

- Spec: `.specs/notification-service-t10-21/spec.md`. Contrato: `packages/shared-schemas/src/events/notification-event.ts`.
- Enrutador del api: `apps/api/src/services/whatsapp-enrutado.ts`. Hash: `packages/whatsapp-client/src/twilio-content-form.ts`.
- Infra: `infrastructure/messaging.tf` (`notification_events_service`), `compute.tf` (`service_notification`) y `notification-service.tf` (métricas y alerta de sombra).
- Templates: `load-content-sids.md`.
