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
- [ ] SC-3: `api` queda en `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`; los 9 Cloud Scheduler jobs siguen entrando por run.app (tráfico interno del proyecto — sin cambio) y el caller **whatsapp-bot→api se re-apunta al GCLB** (`public_api_url`) porque su path service-to-service por run.app dejaría de contar como interno (egress PRIVATE_RANGES_ONLY). Validación empírica obligatoria en §11; rollback si falla.
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
- **B. Re-rutear los 9 schedulers al GCLB (`public_api_url`)** — Rechazada, pero NO por el WAF (corrección del review 2026-06-14): existe una regla ALLOW priority-390 en Cloud Armor que bypassa TODO el WAF para `host==api.boosterchile.com` (networking.tf:198-225), así que `/admin/jobs/*` por el GCLB NO caería bajo OWASP. Se rechaza por un motivo más simple: **los Cloud Scheduler jobs del mismo proyecto ya alcanzan el ingress interno** (es tráfico interno, confirmado por la doc GCP y por ambos revisores) → no necesitan cambio. Dejarlos en run.app es lo menos invasivo. (El caso del **bot→api SÍ se re-rutea** al GCLB — ver §7 y ADR-062 fila api: el bot es service-to-service con egress PRIVATE_RANGES_ONLY, su path run.app NO cuenta como interno, así que debe ir por el LB.)
- **C. Aplicar a TODOS los servicios de una** — Rechazada: sms-fallback rompe (Twilio directo sin GCLB); los privados necesitan análisis de Pub/Sub. Staged + per-service es el patrón seguro que el followup pidió.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cloud Scheduler→api NO funciona con ingress interno (semántica GCP) → 9 crons caen | M | H | Canary web primero (valida el path GCLB); api en ventana del PO con validación empírica inmediata (`gcloud scheduler jobs run reconciliar-dtes` → 200); rollback = revertir ingress del api a ALL (1 línea, ~30s) |
| whatsapp-bot→api roto por ingress interno (egress PRIVATE_RANGES_ONLY → run.app no cuenta como interno) | ~~M~~ resuelto en el PR | H | **Fix incluido**: el bot se re-apunta a `public_api_url` (GCLB) — el api ve tráfico originado en el LB (aceptado por internal-and-cloud-LB) independiente del egress del bot. Audience ya aceptado; WAF bypassed para el host api (priority-390). Validación §11 confirma 200. |
| El plan recrea el servicio (downtime) en vez de update in-place | L | H | SC-7: revisar el plan ANTES de aplicar; `ingress` es un campo mutable de v2 service → update in-place esperado |
| Romper el GCLB→Cloud Run al restringir | L | H | networking.tf:696 confirma que el LB invoca con su SA y que internal-and-cloud-LB lo permite; web es el canary que lo prueba en un servicio no transaccional |
| sms-fallback queda olvidado en el endurecimiento futuro y alguien lo rompe | L | M | Override EXPLÍCITO a ALL + comentario en compute.tf y ADR-062 (no es omisión, es decisión) |

## 10. Test list

- T1: `terraform validate` OK con la variable nueva.
- T2: `terraform plan` muestra SOLO `~ ingress` en service_web y service_api (update in-place), `sms-fallback` sin cambio (ya ALL por override = default efectivo), CERO `-/+` (recreación).
- T3: revisión manual de que ningún otro consumidor del módulo rompe (los 8 modules siguen compilando; default preserva ALL).
- T4 (post-apply, PO — §11): smoke de los paths legítimos + rechazo del path directo run.app.

## 11. Rollout (staged con `-target` OBLIGATORIO — ejecuta el PO)

Primero revisar el plan completo y confirmar **update in-place** (`~ ingress`), CERO `-/+` recreación (SC-7). Luego aplicar por etapas con `-target` (NO de una — el rollback debe ser aislable por servicio, review R4):

**Etapa 1 — canary web:**
1. `terraform apply -target=module.service_web` (+ el módulo, que es el refactor de la variable).
2. Validar: `curl https://app.boosterchile.com/` → 200; `curl https://booster-ai-web-<n>.<region>.run.app/` desde fuera → rechazado a nivel de red.

**Etapa 2 — api (ventana, rollback armado):**
3. Confirmado web OK, `terraform apply -target=module.service_api`. Validación INMEDIATA y medible (no esperar a degradación):
   - **Schedulers**: `gcloud scheduler jobs run reconciliar-dtes --location=southamerica-east1` → 200 en logs del job.
   - **bot→api (re-apuntado al GCLB)**: `gcloud scheduler jobs run chat-whatsapp-fallback --location=southamerica-east1` (ese cron ejercita el path bot→api) → verificar 200 en logs del bot y del api. NO confiar en que un mensaje real lo revele (no hay uptime check del bot — review R3).
   - **Bypass cerrado**: `curl https://booster-ai-api-<n>.<region>.run.app/health` desde fuera → rechazado; `curl https://api.boosterchile.com/health` → 200.
4. **Rollback** si algo falla: revertir el `ingress` del servicio afectado a `"INGRESS_TRAFFIC_ALL"` + `terraform apply -target=<ese módulo>` (~30s, aislado). Sin pérdida de datos (cambio de red puro).

- Monitoring durante la ventana: error rate del api + logs success/failure de los scheduler jobs y del bot.

## 12. Open questions

- OQ1 (se resuelve en la validación §11, no bloquea el PR): ¿Cloud Scheduler con OIDC alcanza ingress `internal-and-cloud-load-balancing` en el mismo proyecto? Hipótesis: sí (es tráfico interno del proyecto, patrón documentado por GCP para Scheduler/Tasks/Pub/Sub). Validación empírica en la ventana del api con rollback armado.

## 13. Decision log

- 2026-06-14 — Draft + mandato del PO (elegido sobre re-auditoría/onboarding). Diseño: variable con default ALL (refactor seguro) + opt-in web/api; sms-fallback explícito en ALL; schedulers NO se re-rutean por GCLB (WAF). Staged web→api con rollback de 1 línea.
