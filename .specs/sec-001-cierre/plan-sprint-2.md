# Plan stub: sec-001-cierre — Sprint 2

> **Status**: Stub. Requiere `/agent-rigor:plan plan-sprint-2` propio + devils-advocate + PO approve antes de cualquier `/agent-rigor:build`.
> **Spec base**: `.specs/sec-001-cierre/spec.md` (Approved v3.2 2026-05-24).
> **Plan Sprint 1**: `.specs/sec-001-cierre/plan.md` (CERRADO 2026-05-25, 14 tasks shipped).

## Razonamiento

El plan original v3 cubrió Sprint 1 con 14 tasks (PRs #1-3 del spec §14 minimum-viable-merge + prereqs round 4 + INT-1). Sprints 2-3 quedaron documentados como "Future sprints" con `/plan` separados.

Este stub identifica las próximas 5 sub-fases que deben planearse para Sprint 2. **NO** enumera acceptance details, files, LOC, ni decision logs — eso es trabajo del `/plan` propio.

## Sub-fases Sprint 2

| Sub-fase | SCs spec | Origen | Bloqueante |
|---|---|---|---|
| **H1.1** Recreate 4 UIDs demo | SC-1.1.1, SC-1.1.2, SC-1.1.3, SC-1.1.8 | O-11 SP-800-63 post-disclosure account replacement | Sprint 1 ✓ (Secret Manager listo) |
| **H1.3** is-demo middleware enforcement | SC-1.3.1, SC-1.3.2, SC-1.3.3, SC-1.3.4, SC-1.3.5, SC-1.3.6, SC-1.3.7, SC-1.3.8 | Enforcement cross-tenant + interaction order con rate-limit | H1.1 (depende del nuevo set demo) |
| **H1.2** Signup migration a Admin SDK | SC-1.2.1, SC-1.2.2, SC-1.2.3, SC-1.2.4 | O-1 (in-scope expandido) — `createUserWithEmailAndPassword` + `sendPasswordResetEmail` + Google provider + 11 métodos | Independiente; puede paralelizarse con H1.1 |

## Sub-fases Sprint 3 (referencia, NO Sprint 2)

| Sub-fase | SCs | Plan separado |
|---|---|---|
| **H1.5** Forensia + audit logs filtering | round 4 P2-R4-2 | plan-sprint-3.md |
| **H1.6** Reactivación demo (flag flip a true) + TTL claim + 90d monitoring | SC-1.6.1..SC-1.6.5 | plan-sprint-3.md (requiere H3 hermano mergeado) |
| **H3 spec hermano** Bucket DTE retention lock SII Chile | spec-h3-dte-retention-lock | `.specs/sec-h3-dte-retention-lock/plan.md` |

## Orden Sprint 2 (recomendación inicial)

1. **PR #1 Sprint 2**: H1.1 (recreate UIDs) — habilita H1.3 enforcement test contra el nuevo set.
2. **PR #2 Sprint 2**: H1.3 (is-demo middleware) — depende de H1.1 + valida interaction order con T9/T10 rate-limit per SC-1.3.8.
3. **PR #3 Sprint 2**: H1.2 (signup migration) — independiente; puede mergearse antes/después de H1.1 sin bloqueos.

Orden alternativo si H1.2 es bloqueado por Identity Platform config externo: hacer H1.2 último.

## Tareas operacionales coordinadas con Sprint 2

- **#STAGING-ENV**: crear segundo GCP project con infra paralela (Terraform workspace). Bloquea el flip prod de `STRICT_MIGRATION_ORDERING=true` que debe ocurrir en este sprint (cuando entren las migrations nuevas `demo_accounts` y `signup_requests`).
- **Flip `STRICT_MIGRATION_ORDERING=true` en prod**: post H1.1+H1.3 merge, con canary 1 réplica + monitoreo 30min ANTES del rollout completo per `docs/qa/migration-ordering.md` §Staging gap mitigation.
- **Cosmetic dashboard drift**: el `terraform apply` del Sprint 2 va a propagar el cosmetic `monitoring_dashboard.telemetry_overview` formatter — esperado, no requiere acción separada.

## Diferencias de scope vs Sprint 1

| Sprint 1 | Sprint 2 |
|---|---|
| Defensa baseline + preserva flag OFF | Recreación demo + middleware + signup migration |
| No customer-facing changes | Customer-facing en H1.2 signup |
| Sin migrations nuevas | Drizzle migrations `demo_accounts` + `signup_requests` |
| Sin downtime risk | Risk de cold-start en `STRICT_MIGRATION_ORDERING` flip |
| Demo subdomain en mantenimiento | Demo subdomain sigue en mantenimiento (H1.6 reactiva en Sprint 3) |

## Decisión a tomar antes de `/agent-rigor:plan plan-sprint-2`

1. **PO**: ¿proceder con orden recomendado o alternativo H1.2-last?
2. **PO**: ¿#STAGING-ENV se acelera ahora o canary-only mitigation acepta?
3. **PO**: ¿agregar nuevos SCs descubiertos en Sprint 1 build? (e.g., métrica Prometheus `rate_limit_pin_blocked_total{scope}` tracked como follow-up T10; integration test contra real Redis para gate-fail-closed; CodeQL custom queries para auth-driver).

## Referencias

- Spec: [`.specs/sec-001-cierre/spec.md`](spec.md) §3 + §13 + §14.
- Plan Sprint 1 cerrado: [`.specs/sec-001-cierre/plan.md`](plan.md).
- Evidence Sprint 1: [`.specs/sec-001-cierre/sprint-1-evidence/`](sprint-1-evidence/).
- Doc cascade rate-limit: [`docs/qa/rate-limit-cascade.md`](../../docs/qa/rate-limit-cascade.md).
- Doc migration ordering: [`docs/qa/migration-ordering.md`](../../docs/qa/migration-ordering.md).
- Runbook secret init: [`docs/runbooks/secret-init-runbook.md`](../../docs/runbooks/secret-init-runbook.md).
- ADR-051 PII redaction: [`docs/adr/051-pii-redaction-logger.md`](../../docs/adr/051-pii-redaction-logger.md).
