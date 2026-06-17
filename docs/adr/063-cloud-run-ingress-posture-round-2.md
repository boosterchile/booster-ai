# ADR-063: Posture de ingress de Cloud Run — round 2 (bot + servicios privados)

- **Estado**: Accepted
- **Fecha**: 2026-06-14
- **Completa**: [ADR-062](062-cloud-run-ingress-posture.md) — que endureció api+web a `INTERNAL_LOAD_BALANCER`, dejó sms-fallback en `ALL` (Twilio directo) y nombró como follow-ups el bot y los 4 servicios privados. Esta ADR ejecuta esos dos follow-ups (no edita ADR-062 — convención de inmutabilidad del repo).
- **Spec del ciclo**: `.specs/feat-ingress-posture-round-2/`

## Decisión

Con esto, los 8 Cloud Run quedan con `ingress` explícito (cero servicios en el default-ALL implícito):

| Servicio | ingress | Razón |
|---|---|---|
| api, web | INTERNAL_LOAD_BALANCER | (ADR-062) servidos vía GCLB. |
| sms-fallback-gateway | ALL | (ADR-062) Twilio directo, sin NEG en GCLB. |
| **whatsapp-bot** | **INTERNAL_LOAD_BALANCER** | Público pero servido vía GCLB: Twilio postea a `api.boosterchile.com/webhooks/whatsapp` (TWILIO_WEBHOOK_URL, compute.tf) → backend del bot, con ALLOW priority-400 de Cloud Armor. INTERNAL_LOAD_BALANCER mantiene ese path y cierra el run.app directo. NO INTERNAL_ONLY (rechazaría el LB). El bot→api (saliente) ya va por el GCLB desde ADR-062. |
| **matching-engine, telemetry-processor, notification, document** | **INTERNAL_ONLY** | Ninguno recibe inbound HTTP: sin NEG en GCLB, sin Cloud Scheduler, sin callers HTTP service-to-service, sin Eventarc, sin Pub/Sub push (todas las subscriptions son pull = conexión saliente). El único inbound es el health probe de Cloud Run (interno, NO sujeto a ingress). INTERNAL_ONLY (más restrictivo que internal-and-cloud-LB — no necesitan el LB) cierra el run.app a nivel de red. **Estado de implementación (review 2026-06-14): telemetry-processor es un consumidor pull ACTIVO; matching-engine, notification y document son SKELETONS (`apps/*/src/main.ts`, ~13 líneas: log + `TODO`, sin consumir Pub/Sub ni levantar HTTP). INTERNAL_ONLY es el default seguro-por-red para ellos — y DEBE re-evaluarse al implementarlos si introducen un endpoint inbound (ver §Re-evaluación).** |

## Por qué INTERNAL_ONLY en los privados no es "nice-to-have"

Con `public=false` el IAM ya rechaza invocaciones sin token de invoker — pero con ingress `ALL` el `*.run.app` sigue siendo **alcanzable a nivel de red desde cualquier IP de internet**. Un token de invoker robado/filtrado (SA comprometida, exfil en un servicio vecino) sería explotable **directo desde fuera**. `INTERNAL_ONLY` reduce ese blast-radius a "solo desde dentro del proyecto/VPC": el token robado deja de servir desde internet. Para los skeletons es secure-by-default: cuando se implementen, abren conscientemente lo que necesiten en vez de heredar ALL.

## Por qué restringir el inbound es seguro hoy

El ingress restringe tráfico **entrante**. telemetry-processor consume Pub/Sub por **streaming pull** (`messaging.tf`: "el consumer crea conexión streaming pull al startup") — conexión **saliente** a Pub/Sub, no afectada por el ingress. Los otros tres no reciben (ni envían) nada todavía. Verificado: cero `push_config` en `messaging.tf`/`crash-traces.tf`, cero referencias a sus URLs run.app en `apps/` y `*.tf`, cero Cloud Scheduler/Eventarc hacia ellos.

## Re-evaluación al implementar matching/notification/document

Estos tres están en `min_instances=0`. Un consumidor **pull** real necesita `min_instances=1 + cpu_idle=false` (como telemetry-processor lo documenta en `compute.tf`), así que su configuración actual confirma que aún NO consumen. Al implementarlos:
- Si consumen por **pull** → `INTERNAL_ONLY` sigue correcto (saliente); ajustar min_instances/cpu_idle.
- Si introducen un endpoint **inbound** (Pub/Sub push, callback service-to-service, webhook) → re-evaluar: push del mismo proyecto funciona con INTERNAL_ONLY, pero un caller service-to-service por run.app NO (mismo modo de fallo que bot→api en ADR-062). Documentar el contrato de tráfico antes de asumir el ingress.

## Consecuencias

- Ningún `*.run.app` de Booster queda alcanzable directo desde internet salvo sms-fallback (Twilio, protegido por HMAC) — documentado en ADR-062.
- Cambio `update in-place` (ingress es campo mutable, no ForceNew) — sin downtime.
- `terraform apply` staged por el PO (privados primero, bot en ventana con un WhatsApp de prueba) — spec §11; rollback de 1 línea por servicio.
- Cierra los 2 follow-ups de ADR-062.

## Validación

- `terraform validate` OK; plan = `~ ingress` update in-place en los 5 servicios de este round, cero recreación (gate pre-apply del PO).
- Post-apply (PO): WhatsApp real → 200; run.app directo de cada servicio rechazado; pull-consumers siguen ack-eando.
