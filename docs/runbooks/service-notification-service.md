# Runbook — Servicio `apps/notification-service` (SKELETON)

- **Estado**: Vigente · **el servicio es un SKELETON** (no implementado)
- **Servicio Cloud Run**: `booster-ai-notification-service` · región `southamerica-west1` · project `booster-ai-494222` · `ingress = INTERNAL_ONLY`, `public = false`, `min/max = 0/20`.

## Lo primero que tenés que saber

> **El fan-out de notificaciones NO corre en este servicio hoy.** `apps/notification-service/src/main.ts` es un skeleton: arranca, loguea `@booster-ai/notification-service starting (skeleton)` y nada más. El plan es que sea el consumer de `notification-events` que abanica a Web Push / FCM / WhatsApp / Email / SMS, pero **aún no se extrajo**.

**Las notificaciones productivas salen hoy desde `apps/api`**:
- **Web Push / VAPID**: `apps/api/src/routes/webpush.ts`.
- **Safety / incidentes**: `apps/api/src/services/dispatch-safety-notification.ts`, `notify-incident-shipper.ts`, `internal-safety-events.ts` (consume el topic `telemetry-events-safety-p0`).
- **WhatsApp (ofertas, tracking, chat unread, safety)**: el api dispara templates Twilio (ver `load-content-sids.md`).

**Si una notificación no llega en producción, el runbook que aplica es `service-api.md`** (+ los específicos abajo), no éste.

## Síntomas / dónde responder

| Síntoma | Dónde |
|---|---|
| No llega un **WhatsApp** (oferta, tracking, safety alert) | `service-whatsapp-bot.md` (recepción) y `load-content-sids.md` (templates/Content SIDs, aprobación Meta). El envío lo hace `apps/api`. |
| No llega un **Web Push** | `apps/api` → `service-api.md`; revisar `webpush.ts` y los secrets `WEBPUSH_VAPID_*`. |
| No llega una alerta de **safety** (crash/unplug/jamming) al shipper/carrier | `apps/api/src/services/dispatch-safety-notification.ts` (consume `telemetry-events-safety-p0`); el evento upstream → `oncall-telemetry-incidents.md`. |
| La revisión `booster-ai-notification-service` está caída | impacto **nulo** hoy (no procesa tráfico). Ver abajo. |

## Diagnóstico del skeleton (si alguien pregunta por la revisión)

```bash
SVC=booster-ai-notification-service ; REGION=southamerica-west1 ; PROJECT=booster-ai-494222

gcloud run services describe $SVC --region=$REGION --project=$PROJECT \
  --format='value(status.traffic, status.conditions[0].message)'

# Sólo debería verse la línea "skeleton"
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="booster-ai-notification-service"' \
  --project=$PROJECT --limit=20 --freshness=1h
```

Si está `Failed`, no es emergencia (sin ingesta real). Restaurar con `update-traffic` a una revisión que arranque:

```bash
gcloud run revisions list --service=$SVC --region=$REGION --project=$PROJECT --limit=5
gcloud run services update-traffic $SVC --region=$REGION --project=$PROJECT \
  --to-revisions=<REVISION_SANA>=100
```

## Cuando se implemente

Al extraer el fan-out a este servicio (skill `booster-skills:adding-cloud-run-service`), este runbook debe crecer con: subscription `notification-events` + DLQ, manejo por canal (Web Push/FCM/WhatsApp/Email/SMS) y su degradación independiente, idempotencia (no notificar dos veces), y rollback. Hasta entonces, **las notificaciones son `apps/api`**.

## Escalación

- **Operador único** (`dev@boosterchile.com`). Para notificaciones reales que no llegan → el canal correspondiente arriba. La caída del skeleton no escala (sin impacto productivo); registrarla en `docs/handoff/CURRENT.md` si llama la atención.

## Refs

- Envío real: `service-api.md`, `service-whatsapp-bot.md`, `load-content-sids.md`.
- Safety fan-out: `oncall-telemetry-incidents.md`, `apps/api/src/services/dispatch-safety-notification.ts`.
- Plan de extracción: skill `booster-skills:adding-cloud-run-service`. README: `apps/notification-service/README.md`.
