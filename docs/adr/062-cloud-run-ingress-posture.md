# ADR-062: Posture de ingress de Cloud Run (internal-and-cloud-LB para servicios GCLB)

- **Estado**: Accepted
- **Fecha**: 2026-06-14
- **Contexto previo**: La auditoría de seguridad de la ola 2 (2026-06-11, hallazgo ALTO sobre `fix/xff-trust-boundary`) detectó que el módulo `cloud-run-service` no seteaba `ingress`. El default real de Cloud Run v2 es `INGRESS_TRAFFIC_ALL` — no `internal-and-cloud-load-balancing`, como afirmaba erróneamente el comentario de `networking.tf`. Consecuencia: las URLs `*.run.app` (predecibles: `booster-ai-<svc>-<project-number>.<region>.run.app`) eran alcanzables DIRECTO desde internet, salteando el GCLB y Cloud Armor.
- **Spec del ciclo**: `.specs/feat-cloud-run-ingress-internal-lb/`

## Decisión

1. **El módulo `cloud-run-service` expone `var.ingress`** con default `INGRESS_TRAFFIC_ALL` (preserva el comportamiento histórico; el endurecimiento es opt-in por servicio).

2. **Posture por servicio:**

| Servicio | public | NEG en GCLB | ingress | Razón |
|---|---|---|---|---|
| api | true | sí | **INTERNAL_LOAD_BALANCER** | Servido vía GCLB+WAF. Cierra el bypass directo del run.app que reabría la forjabilidad del XFF (rate-limits, IP de consentimiento Ley 19.628). Callers internos (Cloud Scheduler `/admin/jobs`, whatsapp-bot→api) entran como tráfico interno del proyecto. |
| web | true | sí | **INTERNAL_LOAD_BALANCER** | PWA servida 100% vía GCLB; sin callers directos al run.app → canary del posture. |
| sms-fallback-gateway | true | **no** | **ALL** (explícito) | Twilio postea directo al run.app y NO hay NEG en el GCLB. Restringir rompería la ingesta SMS. La barrera de seguridad es la firma HMAC, no la red. |
| whatsapp-bot | true | sí | ALL (sin cambio, follow-up) | Webhook Twilio entra por una URL configurada en la consola de Twilio (fuera del repo); endurecer requiere confirmar primero que usa el dominio GCLB. |
| matching-engine, telemetry-processor, notification, document | false | no | ALL (sin cambio, follow-up) | `public=false` → IAM ya bloquea sin token (defensa primaria). El ingress es defensa en profundidad secundaria; requiere análisis de callers (Pub/Sub push, Eventarc). |

3. **`public=true` se mantiene en api/web** aunque el ingress se restrinja: son controles ORTOGONALES. `public` (IAM `allUsers` invoker) permite que el GCLB reenvíe tráfico anónimo legítimo (preflight CORS, browsers); `ingress` (red) decide QUÉ ORÍGENES llegan. El endurecimiento es de red, no de auth.

4. **NO se re-rutean los Cloud Scheduler jobs por el GCLB.** La regla ALLOW de Cloud Armor solo exime `/webhooks/*` (`networking.tf`), no `/admin/jobs/*`; hacerlos pasar por el WAF agregaría superficie de falsos-positivos (JWT OIDC + 9 jobs). Se confían en que el ingress interno permite Cloud Scheduler del mismo proyecto, validado empíricamente en el rollout.

## Consecuencias

- Un atacante que conozca la URL `*.run.app` del api/web ya no la alcanza directo: el acceso es solo vía `api.boosterchile.com`/`app.boosterchile.com` (GCLB → Cloud Armor → Cloud Run). El endurecimiento XFF (#448) deja de ser eludible por el bypass de red para esos dos servicios.
- El cambio es `update in-place` del recurso (campo mutable de Cloud Run v2) — sin recreación ni downtime.
- Quedan dos follow-ups documentados (whatsapp-bot inbound, servicios privados) — el posture es incremental, no big-bang.
- El `terraform apply` lo ejecuta el PO con rollout staged (web canary → api en ventana con rollback de 1 línea) — spec §11.

## Validación

- `terraform validate` OK; `terraform plan` = update in-place de `ingress` en api y web, sin recreación.
- Post-apply (PO): smoke de paths legítimos (200 vía dominio) + rechazo del path directo run.app + un Cloud Scheduler job real corriendo 200 contra el api endurecido.
