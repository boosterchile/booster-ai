# Spec: feat-ingress-posture-round-2

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-14
- Status: Approved
- Stacked sobre: PR #457 (`feat/cloud-run-ingress-internal-lb`, ADR-062) — introduce `var.ingress` en el módulo. Esta rama parte de esa rama; su PR mergea DESPUÉS de #457.
- Linked: follow-ups de ADR-062 → `.specs/_followups/whatsapp-bot-ingress-verify-twilio-url.md`, `.specs/_followups/private-services-ingress.md`. El `terraform apply` lo ejecuta el PO.

## 1. Objective

Completar el posture de ingress de Cloud Run iniciado en ADR-062 (que dejó api+web en INTERNAL_LOAD_BALANCER y sms-fallback en ALL). Faltan dos grupos:
1. **whatsapp-bot** → `INTERNAL_LOAD_BALANCER`: es público pero servido vía GCLB (webhook Twilio en `/webhooks/whatsapp`); su `*.run.app` no necesita ser alcanzable directo.
2. **Los 4 servicios privados** (matching-engine, telemetry-processor, notification, document) → `INTERNAL_ONLY`: ninguno recibe inbound HTTP de ningún origen. telemetry-processor es un consumidor pull ACTIVO (conexión saliente a Pub/Sub); matching-engine, notification y document son SKELETONS (~13 líneas, sin consumir Pub/Sub ni servir HTTP aún) — INTERNAL_ONLY es el default seguro-por-red para ellos. Hoy su `*.run.app` es alcanzable a nivel de red desde internet (lo único que rechaza es la falta de token de invoker) → un token robado sería explotable desde cualquier IP. `INTERNAL_ONLY` contiene ese blast-radius a "solo desde dentro del proyecto/VPC".

## 2. Why now

Son los dos residuos nombrados en ADR-062. El de privados es contención de blast-radius (no nice-to-have): IAM es la defensa primaria pero ALL deja el endpoint expuesto a nivel de red a un token comprometido.

## 3. Success criteria

- [ ] SC-1: `whatsapp-bot` → `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`. El webhook de Twilio (vía GCLB, `/webhooks/whatsapp`, ALLOW priority-400 en Cloud Armor) sigue 200; el run.app directo del bot deja de ser alcanzable.
- [ ] SC-2: matching-engine, telemetry-processor, notification, document → `INGRESS_TRAFFIC_INTERNAL_ONLY` (no LB — no lo necesitan, no tienen NEG).
- [ ] SC-3: terraform validate OK; plan = `~ ingress` update in-place en los 5 servicios, CERO recreación.
- [ ] SC-4: ADR-063 completa ADR-062 (no lo edita — convención de inmutabilidad).
- [ ] SC-5: los 2 follow-up stubs quedan marcados resueltos.

## 4. User-visible behaviour

Ninguno. WhatsApp inbound sigue por el dominio; los privados no reciben tráfico de usuarios. Cambio observable solo para un atacante con la URL run.app o un token robado: rechazo a nivel de red.

## 5. Out of scope

- Aplicar el `terraform apply` (PO, con validación §11).
- Cambiar el modelo pull→push de las subscriptions.
- sms-fallback (queda en ALL — Twilio directo, ya decidido en ADR-062).

## 6. Constraints

1. El bot es `public=true` (allUsers, para el webhook anónimo de Twilio vía GCLB) → necesita `INTERNAL_LOAD_BALANCER` (que SÍ acepta el GCLB), NO `INTERNAL_ONLY` (rechazaría el LB).
2. Los privados NO tienen NEG en el GCLB → `INTERNAL_ONLY` es correcto (más restrictivo, sin LB que mantener).
3. Bot: la firma X-Twilio-Signature se computa sobre `TWILIO_WEBHOOK_URL` = `api.boosterchile.com/webhooks/whatsapp` (ya provisionado, compute.tf:580). Que WhatsApp funcione hoy implica que Twilio postea a esa URL (si posteara al run.app, la firma ya fallaría). El PO confirma en la ventana con un mensaje real.
4. Cambio `update in-place` (ingress es campo mutable, no ForceNew) — sin downtime.

## 7. Approach

`compute.tf`: `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"` en `service_whatsapp_bot`; `ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"` en `service_matching_engine`, `service_telemetry_processor`, `service_notification`, `service_document`. ADR-063. Stubs resueltos.

## 8. Alternatives considered

- **A. Privados en `INTERNAL_LOAD_BALANCER` (como api/web)** — Rechazada: no tienen NEG ni se sirven por LB; `INTERNAL_ONLY` es estrictamente más restrictivo y correcto (no hay LB que admitir). Si alguno necesitara el LB en el futuro, se cambia esa línea.
- **B. Bot en `INTERNAL_ONLY`** — Rechazada: rechazaría el GCLB por el que entra Twilio → rompería WhatsApp inbound.
- **C. Dejar los privados en ALL (status quo)** — Rechazada: el residuo de blast-radius (token robado explotable desde internet) es el motivo del follow-up; IAM solo no contiene el origen de red.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Algún privado SÍ recibe inbound HTTP no detectado (push, service-to-service) y INTERNAL_ONLY lo rompe | L | M | Verificado: 0 NEG, 0 scheduler, 0 env-URL service-to-service, 0 Eventarc, 0 Pub/Sub-push; telemetry-processor consume por pull (saliente); los otros 3 son skeletons sin inbound. Health probes de Cloud Run no pasan por ingress. Validación post-apply del PO + rollback 1 línea |
| Twilio postea al run.app del bot (no al dominio) → INTERNAL_LOAD_BALANCER rompe WhatsApp | L | H | La firma sobre TWILIO_WEBHOOK_URL=dominio ya funciona en prod ⇒ Twilio usa el dominio. PO valida con mensaje real en la ventana; rollback bot→ALL si falla |
| Pub/Sub pull deja de conectar con INTERNAL_ONLY | VL | M | Pull = conexión SALIENTE del servicio a pubsub.googleapis.com; ingress solo afecta INBOUND. Sin impacto |
| Recreación en vez de update in-place | L | H | ingress es campo mutable (no ForceNew); el PO confirma en el plan |

## 10. Test list

- T1: terraform validate OK.
- T2 (PO): plan = `~ ingress` en 5 servicios, cero recreación.
- T3 (PO, post-apply): WhatsApp real → 200; run.app de cada servicio desde fuera → rechazado; telemetry-processor sigue procesando (logs de Pub/Sub ack; los otros 3 son skeletons, sin tráfico que validar).

## 11. Rollout (PO, tras #457)

Aplica DESPUÉS de #457 (necesita la variable). Por etapas con `-target`:
1. **Privados (bajo riesgo)**: `terraform apply -target=module.service_matching_engine -target=module.service_telemetry_processor -target=module.service_notification -target=module.service_document`. Validar: **telemetry-processor sigue ack-eando** (logs Pub/Sub; red de seguridad = alerta `telemetry_consumer_stalled_p1`); los otros 3 (skeletons) solo deben seguir arrancando (log skeleton). En los 4: run.app directo desde fuera → rechazado.
2. **Bot (ventana, con mensaje de prueba)**: `terraform apply -target=module.service_whatsapp_bot`. Validar: enviar un WhatsApp real → 200 en logs del bot; run.app del bot desde fuera → rechazado.
3. **Rollback** por servicio: revertir su `ingress` a ALL (bot) / al previo + `terraform apply -target=<módulo>` (~30s).

## 12. Open questions

- OQ1 (validación §11, no bloquea el PR): confirmación empírica de que Twilio postea al dominio GCLB (no al run.app del bot). Evidencia indirecta fuerte: la firma ya valida contra el dominio en prod.

## 13. Decision log

- 2026-06-14 — Draft + mandato del PO ("endurecer el bot inbound y los privados a INTERNAL_ONLY"). Bot → INTERNAL_LOAD_BALANCER (mantiene GCLB); privados → INTERNAL_ONLY (pull-consumers sin inbound). Stacked sobre #457.
