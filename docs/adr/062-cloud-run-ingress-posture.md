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
| api | true | sí | **INTERNAL_LOAD_BALANCER** | Servido vía GCLB+WAF. Cierra el bypass directo del run.app que reabría la forjabilidad del XFF (rate-limits, IP de consentimiento Ley 19.628). Callers internos: los 9 Cloud Scheduler `/admin/jobs` entran como tráfico interno del proyecto (sin cambio); **whatsapp-bot→api se re-apunta al GCLB** (`public_api_url`) — su path service-to-service por run.app NO contaba como interno (egress PRIVATE_RANGES_ONLY) y se habría roto. |
| web | true | sí | **INTERNAL_LOAD_BALANCER** | PWA servida 100% vía GCLB; sin callers directos al run.app → canary del posture. |
| sms-fallback-gateway | true | **no** | **ALL** (explícito) | Twilio postea directo al run.app y NO hay NEG en el GCLB. Restringir rompería la ingesta SMS. La barrera es la firma HMAC (timingSafeEqual), no la red. Residuo BAJO: sin WAF ni rate-limit per-IP, el run.app es DoS-able / spam-able (un atacante fuerza cómputo de HMAC); la firma rechaza antes de Pub/Sub. Se acepta hasta frontearlo con GCLB (follow-up). |
| whatsapp-bot | true | sí | ALL (sin cambio, follow-up) | Webhook Twilio (inbound). El repo YA provisiona `TWILIO_WEBHOOK_URL=api.boosterchile.com/webhooks/whatsapp` (GCLB) y el bot tiene NEG+backend+ALLOW `/webhooks/*` en Cloud Armor → el path GCLB existe. Falta solo confirmar el valor REAL configurado en la consola de Twilio (fuera del repo) antes de flipear el ingress. Follow-up `whatsapp-bot-ingress-verify-twilio-url`. |
| matching-engine, telemetry-processor, notification, document | false | no | ALL (sin cambio, follow-up) | `public=false` → IAM ya bloquea sin token (defensa primaria). El ingress ALL deja, aun así, el run.app alcanzable a nivel de red desde internet: un token de invoker robado sería explotable desde cualquier IP. Pasar a `INTERNAL_ONLY` (no necesitan el LB) **contiene el blast-radius** de un token robado a "solo desde dentro del proyecto" — no es un mero nice-to-have. Requiere validar callers Pub/Sub push / Eventarc. Follow-up `private-services-ingress`. |

3. **`public=true` se mantiene en api/web** aunque el ingress se restrinja: son controles ORTOGONALES. `public` (IAM `allUsers` invoker) permite que el GCLB reenvíe tráfico anónimo legítimo (preflight CORS, browsers); `ingress` (red) decide QUÉ ORÍGENES llegan. El endurecimiento es de red, no de auth.

4. **Los 9 Cloud Scheduler jobs NO se tocan** (siguen en run.app + OIDC). Cloud Scheduler del mismo proyecto cuenta como tráfico interno para el ingress `internal-and-cloud-load-balancing` (doc GCP, confirmado en review) → no se rompen. (Corrección del review 2026-06-14: una versión previa de esta ADR justificaba no re-rutearlos "porque `/admin/jobs/*` caería bajo el WAF"; eso era FALSO — la regla ALLOW priority-390 de Cloud Armor bypassa TODO el WAF para `host==api.boosterchile.com`, networking.tf:198-225. El motivo real es el de arriba: ya funcionan como internos.) Esa misma regla priority-390 es la que hace seguro re-apuntar el bot→api al GCLB sin falsos positivos del scannerdetection.

## Consecuencias

- Un atacante que conozca la URL `*.run.app` del api/web ya no la alcanza directo: el acceso es solo vía `api.boosterchile.com`/`app.boosterchile.com` (GCLB → Cloud Armor → Cloud Run). El endurecimiento XFF (#448) deja de ser eludible por el bypass de red para esos dos servicios.
- El cambio es `update in-place` del recurso (campo mutable de Cloud Run v2) — sin recreación ni downtime.
- Quedan dos follow-ups documentados (whatsapp-bot inbound, servicios privados) — el posture es incremental, no big-bang.
- El `terraform apply` lo ejecuta el PO con rollout staged (web canary → api en ventana con rollback de 1 línea) — spec §11.

## Validación

- `terraform validate` OK; `terraform plan` = update in-place de `ingress` en api y web, sin recreación.
- Post-apply (PO): smoke de paths legítimos (200 vía dominio) + rechazo del path directo run.app + un Cloud Scheduler job real corriendo 200 contra el api endurecido.
