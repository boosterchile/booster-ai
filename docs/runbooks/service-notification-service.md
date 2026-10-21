# Runbook — Servicio `apps/notification-service` (canal WhatsApp)

- **Estado**: Vigente desde T10-21 (`.specs/notification-service-t10-21/spec.md`, [ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md)).
- **Servicio Cloud Run**: `booster-ai-notification-service` · región `southamerica-west1`.
  - Red y acceso: `ingress = INTERNAL_ONLY`, `public = false`.
  - Escala: `min = 1` con algún flag `notifications_*` encendido y `0` con los dos apagados (ver abajo), `max = 20`, `cpu_idle = false`, `cpu = 1`, `memory = 512Mi`.
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

**El mínimo de instancias sigue a los flags** (`compute.tf`, `local.notification_service_min_instances`): con los dos en `false` el servicio escala a cero y no hay instancia viva; con cualquiera en `true`, `min_instances = 1`. Por eso los flags se cambian **siempre con `terraform apply -var=…`** (o en el tfvars), nunca con `gcloud run services update --update-env-vars` sobre el api ni con `--min` sobre el servicio: por fuera de Terraform el flag se encendería con el consumidor en cero. Terraform aplica el api después del servicio (`depends_on`) y corta si la revisión nueva del servicio no queda lista. El deploy de Cloud Build no toca el mínimo. Si igual pasa, avisa la alerta `Wave2 notification_events consumer stalled` (CRITICAL, mensaje sin confirmar > 10 min).

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
| Alerta `Wave2 notification_events consumer stalled` o backlog creciente en `notification-events-sub` | No hay instancia consumiendo. Con un flag encendido, el servicio debe tener `min=1` y `cpu_idle=false`; si está en `min=0`, el flag se prendió por fuera de Terraform: aplicar los flags con `terraform apply` |
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

**Del canal (el que importa).** Volver el WhatsApp al envío directo del api **dejando la sombra encendida**, para que el servicio siga con `min=1` y entregue lo que quedó en la subscription:

```bash
cd infrastructure
terraform apply -var=notifications_via_microservice=false -var=notifications_shadow=true   # o en el tfvars
```

El api vuelve a llamar a Twilio en la revisión nueva. Se distingue en los logs de los emisores: `twilioSid` empieza con `SM` (directo) o `pubsub:` (vía servicio). Los mensajes que quedaron en la subscription traen `modo: 'enviar'` y el servicio los entrega igual aunque el api esté en sombra. Cuando `num_undelivered_messages` de `notification-events-sub` llegue a 0, apagar también la sombra (`-var=notifications_shadow=false`); recién ahí el servicio baja a cero instancias. **No apagues los dos flags en un solo apply**: el mínimo bajaría a 0 en ese mismo apply y lo pendiente quedaría sin consumidor hasta vencer (1 día).

Si este servicio es la causa del problema, conviene **purgar** la subscription para no duplicar los reintentos (`gcloud pubsub subscriptions seek notification-events-sub --time=$(date -u +%FT%TZ)`), aceptando que esos mensajes se pierden. En ese caso sí se pueden apagar los dos flags juntos.

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
| N2 | Rollback del canal en < 5 min | Desde `terraform apply -var=notifications_via_microservice=false -var=notifications_shadow=true` (staging; la sombra mantiene `min=1` para N3) hasta el primer WhatsApp nuevo enviado directo: en los logs del emisor del api (p. ej. `notifyOfferToCarrier sent`), `twilioSid` vuelve a empezar con `SM` en vez de `pubsub:` |
| N3 | Sin pérdida | Al restaurar la env del servicio (`--update-env-vars=PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS=notification-events-sub`), el backlog se entrega una vez: log `notificacion enviada` con el `idempotencyKey` de cada mensaje acumulado |
| N4 | Config igual a Terraform | `terraform plan` de staging sin cambios en `module.service_notification` tras restaurar la env |

Registrar los timestamps (falla, apply, primer envío) y la salida del plan en el PR del corte o en un snapshot de `docs/handoff/`.

## Escalación

- **Operador único** (`dev@boosterchile.com`). Un WhatsApp que no llega con el flag activo: hacer el rollback del canal primero y diagnosticar después.

## Refs

- Spec: `.specs/notification-service-t10-21/spec.md`. Contrato: `packages/shared-schemas/src/events/notification-event.ts`.
- Enrutador del api: `apps/api/src/services/whatsapp-enrutado.ts`. Hash: `packages/whatsapp-client/src/twilio-content-form.ts`.
- Infra: `infrastructure/notification-service.tf` (subscription `notification_events_service`, métricas y alerta de sombra) y `compute.tf` (`service_notification`). El topic está en `messaging.tf`.
- Templates: `load-content-sids.md`.
