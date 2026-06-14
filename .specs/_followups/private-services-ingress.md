# Follow-up: endurecer ingress de los servicios privados a INTERNAL_ONLY

**Origen**: review de seguridad del ciclo feat-cloud-run-ingress-internal-lb (2026-06-14, MEDIA). Derivado de ADR-062.
**Prioridad**: P2.

## Contexto

matching-engine, telemetry-processor, notification, document son `public=false` (sin allUsers → IAM bloquea sin token OIDC), sin NEG en el GCLB. Pero el ingress sigue en ALL (default del módulo): su `*.run.app` es alcanzable a nivel de RED desde internet. Lo único que rechaza es la ausencia de token de invoker válido.

## Motivación (no es nice-to-have)

Con ingress ALL, un **token de invoker robado/filtrado** (SA comprometida, exfil en un servicio vecino) es explotable **directo desde cualquier IP de internet** contra el run.app. Con `INTERNAL_ONLY`, ese mismo token solo sirve desde dentro del proyecto/VPC → contención de blast-radius. Estos servicios NO necesitan el LB (no se sirven públicamente) → `INTERNAL_ONLY` (no `INTERNAL_LOAD_BALANCER`).

## Bloqueador / análisis previo

Validar los callers de cada uno antes de flipear:
- telemetry-processor: ¿Pub/Sub push? (Pub/Sub push tiene semántica de ingress propia — verificar que llega con INTERNAL_ONLY).
- notification: ¿Pub/Sub / Eventarc / service-to-service?
- matching-engine, document: ¿quién los invoca y por qué path?

## Acción

1. Mapear callers por servicio (Pub/Sub subscriptions push, Eventarc triggers, service-to-service).
2. Para los que solo reciben Pub/Sub/interno: `ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"`.
3. Smoke por servicio: el caller legítimo sigue 200; el run.app directo desde fuera → rechazado.

## Estado
Pendiente.
