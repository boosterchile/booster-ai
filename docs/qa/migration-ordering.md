# Migration ordering protocol — apps/api startup

> T3 SEC-001 (`.specs/sec-001-cierre/plan.md`) · ronda 4 P1-R4-4 + ronda 1 P0-4 · 2026-05-25

## Sequence

El api server arranca con esta secuencia estricta (`apps/api/src/main.ts`):

```
(1) createDb         → conecta pg.Pool
(2) runMigrationsGated → Drizzle migrate + recovery out-of-order (gated)
(3) getFirebaseAuth   → singleton Firebase Admin SDK
(4) ensureDemoSeeded  → no-op si DEMO_MODE_ACTIVATED=false
(5) createServer      → arma routes + middleware
(6) serve(...).listen → acepta tráfico
```

Migrations corren ANTES de cualquier seed/scheduler hook. El orden es deliberado: el seed puede asumir que el schema está al día.

## Gating env var `STRICT_MIGRATION_ORDERING`

Introducido en T3 para resolver round 1 P0-4 (introducir fail-closed startup sin gating fue clasificado como outage-class regression).

| Valor | Comportamiento si `runMigrations` falla |
|---|---|
| **`true`** | Logger.error con `{err, strict: true}` + RELANZA → main().catch → process.exit(1). Cloud Run revision queda Failed; LB no rutea tráfico. Fail-closed. |
| **`false`** (default Sprint 1 prod) | Logger.error con `{err, strict: false}` + NO relanza. Server arranca y atiende tráfico. Migrations parcialmente aplicadas (riesgo asumido). Legacy behavior. |

En ambos casos el error **se loguea a nivel ERROR** con stack completo. No hay silent fail-open. Cloud Logging captura `severity=ERROR` + el flag `strict` para que el operador identifique de inmediato qué modo estaba activo.

## Configuración

- **Código**: `apps/api/src/config.ts` — `STRICT_MIGRATION_ORDERING: booleanFlag(false)` en `apiEnvSchema`.
- **Cloud Run env var**: `infrastructure/compute.tf` (api service) — `STRICT_MIGRATION_ORDERING = tostring(var.strict_migration_ordering)`.
- **Terraform var**: `infrastructure/variables.tf:strict_migration_ordering` (default `false`).

Para flipear:
- Vía Terraform (preferido): set `strict_migration_ordering = true` en `terraform.tfvars.local` o variable de pipeline + `terraform apply`.
- Vía Cloud Run override (incident): `gcloud run services update booster-ai-api --update-env-vars=STRICT_MIGRATION_ORDERING=true` — útil para incident response inmediato, pero crea drift (Terraform lo revierte en el próximo apply).

## Rollout plan

| Fase | Sprint | Prod | Staging |
|---|---|---|---|
| 1 | Sprint 1 (este PR) | `false` (legacy preserved) | `true` (cuando exista staging — gap, ver abajo) |
| 2 | Sprint 2 | **flip a `true`** cuando entren migrations nuevas (demo_accounts, signup_requests) | `true` |
| 3+ | Sprint 3+ | `true` permanente | `true` |

## Staging gap

**El proyecto NO tiene un entorno staging hoy** (`.github/workflows/release.yml` líneas 60-65 documentan que el job `deploy-staging` fue removido — backlog #STAGING-ENV pendiente: requiere segundo proyecto GCP con infra paralela). Por lo tanto la acceptance del spec "Staging Cloud Run = `true` desde el merge de T3 en Sprint 1" **NO se materializa en Sprint 1**.

Impacto: el "Evidence Sprint 1" del plan T3 (smoke cold-starts con `strict=true` por 7+ días en staging) tampoco se puede ejecutar. El riesgo de outage en el flip prod de Sprint 2 se concentra ahí — sin la ventana de calentamiento staging.

Mitigación propuesta (separable de T3):
1. Acelerar #STAGING-ENV (segundo proyecto GCP con infra paralela vía Terraform workspace) antes del flip prod Sprint 2.
2. Si #STAGING-ENV no está listo: hacer el flip prod Sprint 2 con canary 1 réplica + monitoreo 30min ANTES del rollout completo (per acceptance T3 "Cloud Build canary 1 réplica").

## Falla esperada vs falla por bug

| Escenario | strict=true | strict=false |
|---|---|---|
| Migration nueva con SQL syntax error | crash startup | logged ERROR + server arranca con schema parcial |
| Migration out-of-order (Drizzle bug upstream) | `applyOutOfOrderPending` recupera → no falla. Si recovery falla, crash. | igual; si recovery falla, log + continúa |
| Migration timeout (DB lenta) | crash → Cloud Run reintenta startup probe | crash o log? depende de error semantics del migrator |
| Advisory lock no liberable post-migration | `finally` log.warn + continúa (no afecta el outcome del migrate) | igual |

## Testing

Unit test: `apps/api/test/unit/migrator-gated.test.ts` — 4 casos cubriendo strict={true,false} × runMigrations={success,throw}. Mocking via DI seam (`options.runner`) para no requerir Postgres real.

Integration tests existentes (`apps/api/test/integration/migrations.integration.test.ts`, `migration-journal-integrity.test.ts`) cubren el comportamiento del `runMigrations` real contra DB de test — no afectados por T3.

## Referencias

- Spec: `.specs/sec-001-cierre/spec.md` §SC-1.0.x + round 4 P1-R4-4.
- Plan: `.specs/sec-001-cierre/plan.md` T3.
- Round 1 devils-advocate: P0-4 (gating env var requerido).
- Round 2 devils-advocate: P0-B (staging `true` mandatorio para Sprint 1→2 ventana).
- Implementación: `apps/api/src/db/migrator.ts:runMigrationsGated`, `apps/api/src/main.ts`.
- Tests: `apps/api/test/unit/migrator-gated.test.ts`.
- Config: `apps/api/src/config.ts` + `infrastructure/variables.tf` + `infrastructure/compute.tf`.
