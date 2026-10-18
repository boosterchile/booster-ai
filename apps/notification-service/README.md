# @booster-ai/notification-service

**Runtime**: `cloud-run`
**Status**: canal WhatsApp extraído (T10-21)

Consumer Pub/Sub pull de `notification-events`
(`notificationEventSchema` en `@booster-ai/shared-schemas`).
El api publica cuando `NOTIFICATIONS_VIA_MICROSERVICE=true`, y este servicio entrega el template por Twilio.
Con `NOTIFICATIONS_SHADOW=true` el api envía directo y publica en sombra.
En ese caso el servicio compara el hash del request a Twilio contra el suyo y nunca envía.

Sin base de datos ni Redis. Web Push y email siguen en el api (etapa 2).

- Spec: `.specs/notification-service-t10-21/spec.md`
- Runbook: `docs/runbooks/service-notification-service.md`
- Drill: `docs/runbooks/rollback-drill-microservicios.md`
