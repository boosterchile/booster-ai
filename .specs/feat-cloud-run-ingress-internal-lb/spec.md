# Spec: feat-cloud-run-ingress-internal-lb

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-14
- Status: Approved
- Linked: `.specs/_followups/cloud-run-ingress-internal-lb.md` (hallazgo ALTO del review de seguridad de la ola 2, 2026-06-11, sobre fix/xff-trust-boundary). CLAUDE.md §archivos críticos (infra) — el `terraform apply` lo ejecuta el PO; este ciclo entrega el PR + procedimiento.

## 1. Objective

Cerrar el bypass de red de Cloud Run: hoy el módulo `cloud-run-service` no setea `ingress`, por lo que el default es `INGRESS_TRAFFIC_ALL` y las URLs `*.run.app` son alcanzables DIRECTO desde internet — salteando el GCLB y Cloud Armor. Por ese camino un atacante controla todo el `X-Forwarded-For` salvo la última entry, reabriendo la forjabilidad que el ciclo XFF (#448) creía cerrada (rate-limits per-IP del signup, IP de evidencia de consentimiento Ley 19.628) y operando sin WAF. El objetivo es que el api solo sea alcanzable vía GCLB + callers internos del proyecto, restringiendo su ingress a `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, con `web` como canary de validación y el resto de servicios analizados explícitamente.

## 2. Why now

Es el hallazgo de mayor severidad que quedó abierto tras la remediación de la auditoría. Mientras el ingress sea ALL, el endurecimiento XFF (#448, ya en prod) es parcialmente eludible y Cloud Armor (WAF) es opcional para un atacante que conozca la URL run.app (predecible: `booster-ai-api-<project-number>.<region>.run.app`).

## 3. Success criteria

- [ ] SC-1: el módulo `cloud-run-service` expone una variable `ingress` (default `"INGRESS_TRAFFIC_ALL"`) → aplicarla sin override es CERO cambio de comportamiento para los 8 servicios (refactor seguro, mergeable solo).
- [ ] SC-2: `web` queda en `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` — su run.app deja de ser alcanzable directo; el tráfico legítimo (browsers → app/marketing domain → GCLB) sigue 200.
- [ ] SC-3: `api` queda en `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`; tras el apply, los 9 Cloud Scheduler jobs y el caller whatsapp-bot→api siguen funcionando (validación empírica obligatoria en §11; rollback de 1 línea si falla).
- [ ] SC-4: `sms-fallback-gateway` queda EXPLÍCITAMENTE en `INGRESS_TRAFFIC_ALL` (Twilio postea directo a su run.app — NO tiene NEG en el GCLB; restringirlo rompería la ingesta SMS) — documentado, no omisión.
- [ ] SC-5: el comentario erróneo de `networking.tf:696` ("Por defecto Cloud Run acepta internal-and-cloud-load-balancing") se corrige al default real (`INGRESS_TRAFFIC_ALL`).
- [ ] SC-6: ADR del posture de ingress (qué servicio, por qué, qué queda en ALL y por qué).
- [ ] SC-7: `terraform validate` OK; el plan muestra exactamente los cambios de ingress esperados y CERO recreación de servicios (es un update in-place).

## 4. User-visible behaviour

Ninguno para usuarios legítimos (browsers entran por el GCLB; Twilio por las rutas que ya usa). Cambio observable solo para un atacante: `curl https://booster-ai-api-<n>.<region>.run.app/...` desde fuera → rechazado a nivel de red (antes respondía).

## 5. Out of scope

- **whatsapp-bot (inbound)**: público con NEG en GCLB, PERO Twilio postea su webhook a una URL configurada en la consola de Twilio (fuera del repo). Restringir su ingress requiere confirmar primero que Twilio usa el dominio GCLB y no el run.app. Queda en ALL este ciclo + follow-up `whatsapp-bot-ingress-verify-twilio-url`.
- **Servicios privados (matching-engine, telemetry-processor, notification, document)**: `public=false` (IAM ya bloquea sin token), sin NEG en GCLB. Su ingress puede endurecerse pero requiere análisis de sus callers (Pub/Sub push, Eventarc, service-to-service) — follow-up `private-services-ingress`. El IAM (sin `allUsers`) ya da la defensa primaria; el ingress es defensa en profundidad secundaria para estos.
- **Re-rutear los schedulers por el GCLB**: descartado (ver §8.B) — la regla ALLOW de Cloud Armor solo cubre `/webhooks/*`, no `/admin/jobs/*`.
- Aplicar el `terraform apply` (lo ejecuta el PO con el procedimiento §11).

## 6. Constraints

1. El módulo es compartido por los 8 servicios → la variable DEBE tener default que preserve el comportamiento actual (ALL). El endurecimiento es opt-in por servicio en compute.tf.
2. El cambio es `update in-place` de `google_cloud_run_v2_service` — NO recreación (verificar en el plan; una recreación causaría downtime).
3. `traffic` está en `ignore_changes` del módulo (gestionado por Cloud Build) — agregar `ingress` no debe tocar ese bloque.
4. El api ya acepta ambos audiences OIDC (`API_AUDIENCE` = public_api_url + cloud_run_api_url, compute.tf:95) — no hace falta tocar audiences.

## 7. Approach

Variable `ingress` en `modules/cloud-run-service/{variables.tf,main.tf}` (campo `ingress = var.ingress` en el recurso). En `compute.tf`, `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"` en `service_web` y `service_api`; el resto sin override (default ALL); `sms-fallback` con override explícito a ALL + comentario. Fix del comentario en networking.tf. ADR-062. Rollout staged web→api.

## 8. Alternatives considered

- **A. `INGRESS_TRAFFIC_INTERNAL_ONLY` (sin LB)** — Rechazada: el api/web SE sirven públicamente vía GCLB; `internal-only` rechaza al propio GCLB (lo dice el comentario de networking.tf:696). El valor `internal-and-cloud-load-balancing` es justamente "interno del proyecto + Application LB".
- **B. Re-rutear los 9 schedulers + bot→api al GCLB (`public_api_url`)** — Rechazada: la regla ALLOW de Cloud Armor solo exime `/webhooks/*` (networking.tf:22); `/admin/jobs/*` quedaría bajo evaluación OWASP (xss/sqli/rce/lfi/scannerdetection). El JWT OIDC en el header + 9 jobs nuevos bajo WAF = superficie de falsos-positivos que hoy no existe. Mantener los schedulers en run.app y confiar en que el ingress interno permite Cloud Scheduler (mismo proyecto) es menos invasivo; si la validación §11 falla, esta alternativa queda como fallback documentado (con su ALLOW rule de /admin).
- **C. Aplicar a TODOS los servicios de una** — Rechazada: sms-fallback rompe (Twilio directo sin GCLB); los privados necesitan análisis de Pub/Sub. Staged + per-service es el patrón seguro que el followup pidió.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cloud Scheduler→api NO funciona con ingress interno (semántica GCP) → 9 crons caen | M | H | Canary web primero (valida el path GCLB); api en ventana del PO con validación empírica inmediata (`gcloud scheduler jobs run reconciliar-dtes` → 200); rollback = revertir ingress del api a ALL (1 línea, ~30s) |
| whatsapp-bot→api (service-to-service run.app) rechazado por ingress interno | M | M | Mismo gate de validación; si falla, el bot se re-apunta a public_api_url (audience ya aceptado) o se le da VPC egress — decisión en la ventana |
| El plan recrea el servicio (downtime) en vez de update in-place | L | H | SC-7: revisar el plan ANTES de aplicar; `ingress` es un campo mutable de v2 service → update in-place esperado |
| Romper el GCLB→Cloud Run al restringir | L | H | networking.tf:696 confirma que el LB invoca con su SA y que internal-and-cloud-LB lo permite; web es el canary que lo prueba en un servicio no transaccional |
| sms-fallback queda olvidado en el endurecimiento futuro y alguien lo rompe | L | M | Override EXPLÍCITO a ALL + comentario en compute.tf y ADR-062 (no es omisión, es decisión) |

## 10. Test list

- T1: `terraform validate` OK con la variable nueva.
- T2: `terraform plan` muestra SOLO `~ ingress` en service_web y service_api (update in-place), `sms-fallback` sin cambio (ya ALL por override = default efectivo), CERO `-/+` (recreación).
- T3: revisión manual de que ningún otro consumidor del módulo rompe (los 8 modules siguen compilando; default preserva ALL).
- T4 (post-apply, PO — §11): smoke de los paths legítimos + rechazo del path directo run.app.

## 11. Rollout (staged — ejecuta el PO)

**Etapa 1 — refactor + canary web:**
1. `terraform apply` con la variable nueva. Plan esperado: `~ ingress` en web (→ internal-and-cloud-LB) y api. Si el PO quiere separar, puede `-target=module.service_web` primero.
2. Validar web: `curl https://app.boosterchile.com/` → 200; `curl https://booster-ai-web-<n>.<region>.run.app/` desde fuera → 403/404 de red.

**Etapa 2 — api (ventana, con rollback armado):**
3. Confirmado web OK, aplicar api (si se separó). Validación INMEDIATA:
   - `gcloud scheduler jobs run reconciliar-dtes --location=southamerica-east1` → el job corre y el api responde 200 (revisar logs del job).
   - Un mensaje de WhatsApp de prueba o trigger del bot→api → 200.
   - `curl https://booster-ai-api-<n>.<region>.run.app/health` desde fuera → rechazado; `curl https://api.boosterchile.com/health` → 200.
4. **Rollback** si cualquier validación falla: revertir el `ingress` del api a `"INGRESS_TRAFFIC_ALL"` y `terraform apply` (~30s) → estado previo restaurado. Sin pérdida de datos (cambio de red puro).

- Monitoring: error rate del api en la ventana; logs de los scheduler jobs (success/failure).

## 12. Open questions

- OQ1 (se resuelve en la validación §11, no bloquea el PR): ¿Cloud Scheduler con OIDC alcanza ingress `internal-and-cloud-load-balancing` en el mismo proyecto? Hipótesis: sí (es tráfico interno del proyecto, patrón documentado por GCP para Scheduler/Tasks/Pub/Sub). Validación empírica en la ventana del api con rollback armado.

## 13. Decision log

- 2026-06-14 — Draft + mandato del PO (elegido sobre re-auditoría/onboarding). Diseño: variable con default ALL (refactor seguro) + opt-in web/api; sms-fallback explícito en ALL; schedulers NO se re-rutean por GCLB (WAF). Staged web→api con rollback de 1 línea.
