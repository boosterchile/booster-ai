# Plan: sec-001-cierre — Sprint 2a

- **Spec**: `.specs/sec-001-cierre/spec.md` (Status: Approved v3.2 2026-05-24)
- **Plan Sprint 1**: `.specs/sec-001-cierre/plan.md` (CERRADO 2026-05-25, 14 tasks shipped)
- **Plan Sprint 2 META**: `.specs/sec-001-cierre/plan-sprint-2.md`
- **Created**: 2026-05-25 (v1 → v2 round 2 → v3 round 3 → v4 round 4)
- **Status**: **Active** (Approved 2026-05-25 post devils-advocate round 5 verdict APPROVE; 0 new P0; convergence verificada R1:5→R2:3→R3:5→R4:3→R5:0; iteration halted; ready para `/agent-rigor:build T0`)
- **Scope**: H1.1 (SC-1.1.1..SC-1.1.8) + T0 (CI integration job, fix Sprint 1 drift) + T0.5 (GitHub branch protection on main, fix round 3 P0-R3-2) + T8 (Redis testcontainers, ex-T17 Sprint 2 inicial). NO cubre H1.3, H1.2, T16, T18 — esos van en Sprint 2b.
- **Wall-clock estimate v3**: ~7-9 días hábiles ejecución (corregido per P2-R3-1: incluye cooling-off + review + ship + out-of-band).
- **Spec hermano**: `.specs/sec-h3-dte-retention-lock/spec.md`.

## Cambios v3 → v4 (post devils-advocate round 4)

Round 4 (2026-05-25) verdict: **APPROVE_WITH_RESERVATIONS**. Convergence reached (R1:5P0 → R2:3P0 → R3:5P0 → R4:3P0; classes converging on contract-coherence). 3 P0 reconciliation fixes:

| Objection | Resolución v4 |
|---|---|
| **P0-R4-1**: persona enum Spanish vs spec hardcoded English | **PO decisión 2026-05-25**: Spanish completo + amend spec. Spec.md v3.3 amendment aplicada inline (SC-1.0.2, §4 líneas 189-190, T15 — `shipper` → `generador_carga`; equivalencias documentadas en spec decision log). Plan T1+T3+T4 mantiene Spanish completo. |
| **P0-R4-2**: T6a `value_extractor` semantics undefined + no repo precedent | **T6a v4**: pivot a **conditional-counter pattern** (matches 8 existing `google_logging_metric` exactly). Service emite log SOLO cuando `days_remaining ≤ 7` (no every-tick); `google_logging_metric` counter type DELTA; alert policy fires si `count(metric) > 0` sustained 1min. Zero gauge-with-extractor complexity. Silent-window guard idéntico (counter of `audit.demo_uid_retired_count` events; alert si count < 4 within 4h post-deploy). |
| **P0-R4-3**: T5 perf budget 350ms drift vs spec 200ms | **T5 v4**: budget aligned a spec ≤200ms p95 uncached (1× getUser solo, sin verifyIdToken — Hono context reuse). Mi v3 350ms fue math error: removing 1 verifyIdToken REDUCE budget vs spec asume both calls; net 1× getUser ≈ 200ms confirmado. |
| **P1-R4-1**: T0.5 prose contradice payload | **T0.5 v4 prose**: removida confusión "Permite admin bypass = true". Clarificado: `enforce_admins=true` significa rules apply to admins (no bypass). PO self-merge funciona porque `required_approving_review_count=0`. Nota agregada: "raising review_count >0 deadlocks until second dev exists". |
| **P1-R4-2**: T5 Firebase emulator hidden mini-task | **T5 v4**: explicit "mocked network layer" para perf integration test (no emulator). Eliminada mención emulator. |
| **P2-R4-1**: T5 pre-warm wire semantics | **T5 v4**: pre-warm vía `useEffect` on mount en `routes/demo.tsx`, NO render-time fetch ni click handler. |
| **Misc**: Hono context key | **T5 v4 acceptance**: clarificado `c.get('firebaseClaims')` (verificado en `firebase-auth.ts:116`), NO `c.get('user')`. |

## Cambios v2 → v3 (post devils-advocate round 3)

Round 3 (2026-05-25) identificó 5 P0 + 5 P1 + 3 P2 NUEVOS (no relitigación). Cambios v3:

| Objection | Resolución v3 | PO decision aplicada |
|---|---|---|
| **P0-R3-1**: T6a custom metric infrastructure no existe | **T6a v3**: pivot a **log-based metric** (`google_logging_metric` pattern — 8 ejemplos existentes en `crash-traces.tf` + `telemetry-monitoring.tf`). Service emite `logger.warn({ event: "demo.ttl_low", days_remaining, persona })` → `google_logging_metric` extrae → alert policy fires. Silent-window guard idéntico: log-based metric sobre absence de `audit.demo_uid_retired` count == 4 within 4h. Zero new SDK deps. | (mecánico) |
| **P0-R3-2**: `main` branch no protected | **T0.5 nuevo**: enable GitHub branch protection on `main` con `ci-success` como required check via `gh api repos/boosterchile/booster-ai/branches/main/protection -X PUT` (one-shot manual por PO, mismo pattern Sprint 1 T7.5 init-demo-secrets). GitHub Terraform provider NO en uso (solo google) — full IaC migration tracked como `_followups/main-branch-protection-terraform-iac.md`. | T0.5 dentro Sprint 2a (Recommended) |
| **P0-R3-3**: T0 referencia `db:migrate` inexistente | **T0 v3 acceptance**: steps corregidos a `pnpm install --frozen-lockfile` + `pnpm --filter @booster-ai/api test:integration` (vitest globalSetup `setup-global.ts` corre migrations inline). Env vars: `TEST_DATABASE_URL=postgres://...`, `REDIS_HOST=localhost`, `REDIS_PORT=6379` per `setup.integration.ts:38`. | (mecánico) |
| **P0-R3-4**: T1 viola CLAUDE.md naming bilingüe | **T1 v3**: tabla renamed `demo_accounts` → `cuentas_demo`; enum `personaDemo` → `persona_demo`; values English → Spanish `['generador_carga', 'transportista', 'stakeholder', 'conductor']`. Firebase claim `persona` también Spanish. Emails siguen English (identificadores, no contract). Zero violación CLAUDE.md. | Spanish completo per CLAUDE.md (Recommended) |
| **P0-R3-5**: T5 perf budget ignora firebase-auth re-verify | **T5 v3**: rewire demo-expires DESPUÉS de firebase-auth middleware; consume decoded claims via Hono context (`c.get('user')`) — skip redundant `verifyIdToken` re-call. Solo `getUser(uid)` para freshness. Perf budget actualizado: ≤5ms p95 cached + ≤350ms p95 uncached (1× getUser; excluye firebase-auth shared cost). Agrega perf integration test. | (mecánico) |
| **P1-R3-1**: schema.ts merge-conflict risk | **Pre-build checklist v3**: query open PRs touching `apps/api/src/db/schema.ts` antes de T1 build. Coordinate insertion order. Si concurrente con sec-h3-dte-retention-lock (likely), agendar T1 después de H3 schema add o coordinar via single commit. | (mecánico) |
| **P1-R3-2**: T8 fallback degrades SC-1.1.2c silently | **T8 v3 acceptance**: fallback degradation matrix explícita — si `services: redis` fallback ship, SC-1.1.2c "real Redis fail-closed" se downgrada a "mock-only validated" + spec follow-up `_followups/sec-001-sc-1-1-2c-real-redis-validation.md` programado para Sprint 2b o post. | (mecánico) |
| **P1-R3-3**: T7 ADR después de T4 = process violation | **T7 split v3**: **T7a** (ADR `Status: Proposed` con full decision content) DEBE mergeable ANTES de T4 build. **T7b** (transition a `Status: Accepted` post-PR-merge). | (mecánico) |
| **P1-R3-4**: T4 SLA 4h vs Friday 16:00 colisión | **T4 v3 SLA**: one-shot retire forbidden en Friday after 12:00 Santiago (4h SLA fits before 16:00 cutoff). Pre-build checklist item. | (mecánico) |
| **P1-R3-5**: T4 test fixture coupling a prod UIDs | **T4 v3 acceptance**: test usa synthetic UIDs con mocked Admin SDK (mock-only acknowledged); agrega `--dry-run` flag al script + staging-rehearsal step antes de prod one-shot. | (mecánico) |
| **P2-R3-1**: wall-clock arithmetic wrong | **Estimate v3**: ~20h pure exec + 5h cooling-off + 5h review + 2.5h ship + 3h out-of-band = ~35.5h ≈ **~7-9 días hábiles a 4h/día focused** (vs v2 ~5-6 días incorrecto). | (mecánico) |
| **P2-R3-2**: T0 timeout 10min slim | **T0 v3**: timeout bumped 10min → 15min. Si flake persiste, add `actions/cache` Docker layers en P2 follow-up. | (mecánico) |
| **P2-R3-3**: T6a IAM duplication risk | **T6a v3**: pre-build verify `monitoring.metricWriter` ya en `iam.tf:74` (confirmed). Skip duplicate binding en T6a Terraform. | (mecánico) |

## Decisiones PO 2026-05-25 acumuladas

1. **Sprint sizing**: split Sprint 2 → 2a + 2b (round 1 P1-5).
2. **T8 ubicación**: Sprint 2a dependiendo de T5 merged (round 1 P0-5 + round 2 P1-R2-5).
3. **#STAGING-ENV**: canary-only.
4. **T0.5 branch protection**: dentro Sprint 2a, manual `gh api` one-shot (round 3 P0-R3-2).
5. **Naming bilingüe**: Spanish completo per CLAUDE.md (round 3 P0-R3-4).
6. **OQs resueltas pre-build**: S2-1, S2-2, S2-3, S2-4, S2-5, S2-6, S2a-1 (todas).

## Razonamiento del scope Sprint 2a

H1.1 cierra **SC-1.1.1..SC-1.1.8** en un solo PR. Spec §14.1 PR #4 minimum-viable-merge. T0 prerequisite estructural (CI integration job). T0.5 prerequisite (branch protection). T8 discovery para SC-1.1.2c real-Redis validation.

## Modules touched en Sprint 2a v3 (PR principal + 1 sub-PR T8 + 2 one-shots operacionales)

**T0 + T0.5 — Prerequisites (1 archivo + 1 one-shot)**:
- `.github/workflows/ci.yml` (T0: extend con `integration-tests` job).
- `gh api repos/boosterchile/booster-ai/branches/main/protection -X PUT` (T0.5: one-shot manual por PO post-T0 merge; JSON payload documented en evidence).

**PR #1 H1.1 — Recreate UIDs (~18 archivos, 10 módulos lógicos)**:
- `apps/api/drizzle/0038_cuentas_demo.sql` (new migration — naming Spanish per CLAUDE.md).
- `packages/shared-schemas/src/domain/cuentas-demo.ts` (new Zod; kebab-case file).
- `packages/shared-schemas/src/index.ts` (extend barrel).
- `packages/shared-schemas/src/all-schemas.test.ts` (extend coverage).
- `apps/api/src/db/schema.ts` (extend — sección "Cuentas demo" al final post-Intake legacy; update Layout header).
- `infrastructure/security-hotfixes-2026-05-14.tf` (extend con 4 secrets `demo-account-password-*-2026`).
- `infrastructure/scripts/init-demo-secrets.ts` + test (new).
- `apps/api/src/services/seed-demo.ts` + `seed-demo.test.ts` (refactor DB-driven, naming Spanish).
- `apps/api/src/services/seed-demo-startup.ts` + `seed-demo-startup.test.ts` (new).
- `apps/api/test/integration/seed-demo-second-cold-start.integration.test.ts` + `seed-demo-third-cold-start.integration.test.ts` (new).
- `infrastructure/scripts/harden-demo-accounts.ts` + test (new; `--recreate`/`--retire`/`--retire-old-batch`/`--renew`/`--dry-run`).
- `apps/api/src/middleware/demo-expires.ts` + test (new; consume Hono context).
- `apps/api/src/routes/demo-cache-warm.ts` + test (new; hereda IP rate-limit).
- `apps/web/src/routes/demo.tsx` (modify pre-warm wire).
- `apps/api/src/routes/admin-jobs.ts` (extend con `POST /admin/jobs/demo-account-ttl-alert`).
- `apps/api/src/services/demo-account-ttl-alerter.ts` + test (new; emit structured log para log-based metric).
- `infrastructure/scheduling.tf` (extend con `google_cloud_scheduler_job` daily).
- `infrastructure/monitoring.tf` (extend con 2 `google_logging_metric` + 2 `google_monitoring_alert_policy`: TTL alert primary + silent-window guard).
- `docs/qa/demo-accounts.md` (new minimal en T4 + expansion en T6b).
- `docs/adr/053-post-disclosure-account-replacement.md` (T7a Proposed full content; T7b → Accepted).
- `apps/api/test/integration/demo-expires-perf.integration.test.ts` (new perf integration test per P0-R3-5).

**PR #2 H1.1 extension — Redis testcontainers (3 archivos, 1 módulo)**:
- `apps/api/test/integration/redis-fail-closed-real.integration.test.ts` (new).
- `apps/api/package.json` (add `@testcontainers/redis` devDep + license verify).
- `.github/workflows/ci.yml` (extend `integration-tests` job de T0 con Docker socket o `services: redis` fallback).

**Total Sprint 2a v3**: ~23 archivos, ~11 módulos lógicos. **Levemente sobre SKILL ≤10 módulos** (Sprint 1 también; aceptable).

## Sprint 2a interrupt points v3

| Punto | Interruptible? | Razón |
|---|---|---|
| Pre-T0 / T0.5 | N/A | |
| Post-T0 (CI job) | **SÍ** | job existe sin tests escritos. |
| Post-T0.5 (branch protection) | **SÍ** | protection enabled, sin PR open todavía. |
| Post-T7a (ADR Proposed) | **SÍ** | ADR documents decision, código pendiente. |
| Post-T1 | **SÍ** | tabla vacía. |
| Post-T2 | **SÍ** | secrets vacíos. |
| Post-T3 | **SÍ** | seed lee DB vacía. |
| Post-T4 script + RUNBOOK shipped, PRE one-shot retire | **SÍ** | retire **NO ejecutado**; UIDs viejas activas (vulnerabilidad sin cerrar pero NO degradada). |
| Mid-T4 one-shot retire | **NO** | comando en vuelo. |
| Post-T4 one-shot retire + T6a alert wire | **SÍ** | UIDs viejas disabled + alert activa. |
| Post-T5 | **SÍ** | H1.1 core complete. |
| Post-T6a (logging metric + alerts) | **SÍ** | observability shipped. |
| Post-T6b (docs full) | **SÍ** | T8 test-only. |
| Post-T7b (ADR Accepted at merge) | N/A | parte del merge event. |
| Post-T8 | **N/A** | sprint done. |

## Tasks

### T0: CI integration-tests job (P0-R2-1 v2 + P0-R3-3 v3 fixes) [DONE 2026-05-25]

- **Files**: `.github/workflows/ci.yml`.
- **LOC estimate**: ~40.
- **Wall-clock**: ~1.5h.
- **Depends on**: ninguna.
- **Acceptance**:
  - Nuevo job `integration-tests` en `ci.yml`: spins up `postgres:15-alpine` + `redis:7-alpine` como services (sidecars).
  - Env vars wired: `TEST_DATABASE_URL=postgres://test:test@localhost:5432/test`, `REDIS_HOST=localhost`, `REDIS_PORT=6379` (per `apps/api/test/setup.integration.ts:38` requirements).
  - Steps: `pnpm install --frozen-lockfile` + `pnpm --filter @booster-ai/api test:integration` (vitest globalSetup `setup-global.ts` corre migrations inline via `runMigrations(pool, logger)` — **NO** intermediate `db:migrate` script needed; ese script NO existe).
  - Job timeout: **15min** (P2-R3-2 bump from 10min).
  - Listed en `ci-success` aggregator required-checks (T0.5 enable enforcement).
  - Verificación: PR fixture con failing integration test → CI rojo → branch protection bloquea merge (post-T0.5).
- **Rollback**: revertir workflow extension. T0.5 branch protection sigue activa pero check ya no existe — merge se desbloquea (degradación silenciosa hasta re-add).
- **Spec trace**: ENABLER para SC-1.1.8, SC-1.1.2c, SC-H2.1b integration tests gating.

### T0.5: Enable GitHub branch protection on `main` (P0-R3-2 fix) [DONE 2026-05-25]

- **Files**: documentado en `sprint-2a-evidence/t0-5-branch-protection.md`; comando ejecutado manualmente por PO.
- **LOC estimate**: ~0 LOC repo (operacional one-shot).
- **Wall-clock**: ~30min.
- **Depends on**: T0 (job `ci-success` debe existir antes de marcarlo required).
- **Acceptance**:
  - Comando ejecutado (forma final, JSON via stdin — más robusto que `-f` flags para nested objects). **Discovery durante T0.5 build (2026-05-25)**: GitHub Checks API registra el status check con el `name:` field del workflow job (display name **`CI Success`**, con espacio + capital S), NO el job key (`ci-success`). Plan v3 + initial PR #333 commit asumieron job key; corregido pre-merge vía segundo `gh api PUT` con contexts `["CI Success"]`:
    ```bash
    gh api repos/boosterchile/booster-ai/branches/main/protection \
      -X PUT \
      -H "Accept: application/vnd.github+json" \
      --input - <<'JSON'
    {
      "required_status_checks": {"strict": true, "contexts": ["CI Success"]},
      "enforce_admins": true,
      "required_pull_request_reviews": {"required_approving_review_count": 0},
      "restrictions": null,
      "allow_force_pushes": false,
      "allow_deletions": false
    }
    JSON
    ```
  - Result verificado: `gh api ... /branches/main/protection | jq '.required_status_checks.contexts'` retorna `["CI Success"]`.
  - **Configuración**: `enforce_admins=true` (rules apply to admins, no bypass) + `required_approving_review_count=0` (zero approvals required) → PO puede self-merge sin bloqueo. **Nota v4 (P1-R4-1)**: raising `required_approving_review_count >0` en futuro deadlocks until second human dev exists.
  - Future IaC: full Terraform migration tracked en `_followups/main-branch-protection-terraform-iac.md` (requiere `integrations/github` provider + PAT secret en Secret Manager).
- **Rollback**: `gh api repos/boosterchile/booster-ai/branches/main/protection -X DELETE` (revert protection). Solo PO con admin scope.
- **Spec trace**: ENABLER para T0 enforcement; cierre de gap "T0 gate es promesa, no enforcement" round 3 P0-R3-2.

### T7a: ADR-053 con `Status: Proposed` full content (P1-R3-3 fix) [DONE 2026-05-25]

- **Files**: `docs/adr/053-post-disclosure-account-replacement.md` (transición desde `Reserved` stub a `Proposed` con full decision content).
- **LOC estimate**: ~50 (markdown).
- **Wall-clock**: ~1h.
- **Depends on**: ninguna (decision puede articularse pre-código).
- **Acceptance**:
  - ADR `Status: Proposed` con: Context (literal `BoosterDemo2026!` exposed git history desde 2026-05-10 + 4 UIDs públicas), Decision (post-disclosure account replacement per NIST SP 800-63 + OWASP Top 10 A07), Consequences (irreversible by design, monitoring 90d window, no rotation alternative aceptada), Alternatives considered (rotation only, monitoring without recreate, account suspension without replacement).
  - Linked a spec §3 H1.1 + spec §13 decision log + plan T4.
  - SC traceability: SC-IAC.3.
- **Rollback**: revertir commit. ADR vuelve a `Reserved` stub.
- **Spec trace**: §3 SC-IAC.3; §7.1 ADR numbering.

### T1: Drizzle migration `cuentas_demo` (Spanish naming per CLAUDE.md, P0-R3-4 fix) [DONE 2026-05-25]

- **Files**: `apps/api/drizzle/0038_cuentas_demo.sql`, `packages/shared-schemas/src/domain/cuentas-demo.ts`, `packages/shared-schemas/src/index.ts`, `packages/shared-schemas/src/all-schemas.test.ts`, `apps/api/src/db/schema.ts`.
- **LOC estimate**: ~75 (migration ~20 + Zod ~20 + schema.ts ~20 + barrel ~1 + all-schemas test ~5 + layout header ~5 + section header ~4).
- **Wall-clock**: ~2h.
- **Depends on**: T0 (CI integration job), T7a (ADR Proposed antes de implementar).
- **Acceptance**:
  - Tabla `cuentas_demo` (Spanish per CLAUDE.md).
  - Enum `persona_demo` (snake_case Spanish) con values `['generador_carga', 'transportista', 'stakeholder', 'conductor']` (Spanish per CLAUDE.md §Reglas naming; "stakeholder" es anglicismo aceptado per ADR-004/ADR-034).
  - Columnas: `persona` (enum `persona_demo`), `email` (varchar unique), `firebase_uid` (varchar nullable), `creado_en` (timestamptz default now()), `deshabilitado_en` (timestamptz nullable).
  - **Insertion location**: nueva sección `// ----- Cuentas demo -----` al final post-Intake legacy. Update Layout header.
  - Barrel `index.ts`: `export * from './domain/cuentas-demo.js';`.
  - Coverage test: `import * as cuentasDemo from './domain/cuentas-demo.js';` + describe block.
  - Zod `cuentaDemoSchema` derived = `typeof cuentasDemo.$inferSelect`. Cero `any`. Unit test round-trip.
  - Migration corre clean en T0 integration job.
  - `pnpm typecheck` + `pnpm lint` green.
  - SC traceability: SC-1.1.8 prereq.
- **Rollback**: revertir + migration `0039_drop_cuentas_demo.sql` si staging-applied.
- **Spec trace**: §3 SC-1.1.8; CLAUDE.md §Reglas naming bilingüe compliance.

### T2: Secret Manager — 4 secrets `demo-account-password-*-2026` + init script [DONE 2026-05-25]

- **Files**: `infrastructure/security-hotfixes-2026-05-14.tf`, `infrastructure/scripts/init-demo-secrets.ts` + test.
- **LOC estimate**: ~80.
- **Wall-clock**: ~1.5h.
- **Depends on**: T0, T7a (ADR before code).
- **Acceptance**:
  - 4 secrets via Terraform: `demo-account-password-shipper-2026`, `demo-account-password-carrier-2026`, `demo-account-password-stakeholder-2026`, `demo-account-password-conductor-2026-firebase` (naming SC-1.1.5 — secrets siguen English nomenclature porque SC-1.1.5 lo especifica; este patch NO renombra secrets).
  - IAM bindings `roles/secretmanager.secretAccessor`: API SA + `dev@boosterchile.com`.
  - `init-demo-secrets.ts` idempotente: random 128-bit; one-shot manual por PO (Sprint 1 T7.5 pattern).
  - SC traceability: SC-1.1.5.
- **Rollback**: revertir Terraform.
- **Spec trace**: §3 SC-1.1.5; §7.4 P0 secrets.

### T3: seed-demo refactor DB-driven (Spanish naming) [DONE 2026-05-25]

- **Files**: `apps/api/src/services/seed-demo.ts`, `seed-demo-startup.ts`, tests, integration tests.
- **LOC estimate**: ~100.
- **Wall-clock**: ~2h.
- **Depends on**: T0, T1, T2.
- **Acceptance**:
  - Per persona: `SELECT email FROM cuentas_demo WHERE persona=X AND deshabilitado_en IS NULL`. Persona X usa enum value Spanish (`'generador_carga'` para shipper, `'transportista'` para carrier, etc.).
  - Si null → INSERT con email determinístico (emails English per spec, mapping persona enum Spanish → email key English en seed-demo helper).
  - Cold-start N+1: SELECT → email → getUserByEmail: active → skip; deshabilitado → alert; null → create.
  - Integration tests: second-cold-start + third-cold-start (idempotency + no unbounded growth).
  - Unit tests: emails determinísticos, mapping persona enum Spanish ↔ email key English.
  - **CI gating** via T0 integration job.
  - SC traceability: SC-1.1.8.
- **Rollback**: PRE-T1-apply-prod viable; post requires migration backward.
- **Spec trace**: §3 SC-1.1.8.

### T4: `harden-demo-accounts.ts` + RUNBOOK + one-shot retire 4 UIDs viejas (P0-R2-3 + P1-R3-4 + P1-R3-5 fixes) [DONE 2026-05-25]

- **Files**: `infrastructure/scripts/harden-demo-accounts.ts` + test, `docs/qa/demo-accounts.md` (minimal en T4).
- **LOC estimate**: ~100.
- **Wall-clock**: ~2.5h.
- **Depends on**: T1, T2, T3, T7a.
- **Acceptance**:
  - Subcommands: `--recreate`, `--retire <uid>`, `--retire-old-batch` (4 prod UIDs hardcoded; idempotent + resume-from-partial-retire), `--renew <uid> --extend-days N`, **`--dry-run`** (P1-R3-5 fix: simulate sin Firebase Admin SDK calls reales; output planned actions; usado en staging rehearsal).
  - claims set: `{ is_demo: true, persona: <Spanish enum value>, expires_at: <now+30d ISO-8601> }`.
  - Test fixture usa **synthetic UIDs** (e.g., `test-uid-1`..`test-uid-4`) con mocked Firebase Admin SDK — mock-only validation acknowledged. Test partial-retire recovery: fixture state "2 of 4 synthetic UIDs ya disabled" → batch retire skip 2 + retire 2 + 0 errors.
  - **Staging rehearsal step** ANTES de prod one-shot: ejecutar `tsx infrastructure/scripts/harden-demo-accounts.ts --dry-run --retire-old-batch` contra staging Firebase project; verificar output planned matches expected; document en evidence.
  - Runbook minimal: comando curl-verify pre-retire + comando retire + SLA + window-of-overlap.
  - **SLA actualizado v3 (P1-R3-4 fix)**: one-shot retire forbidden en Friday after 12:00 Santiago (4h SLA fits before 16:00 cutoff). Pre-build checklist item agregado.
  - **One-shot ejecución timing**: post-PR #1 prod-deploy approved + curl-verified 4 nuevas activas + T5 middleware deployed + T6a Cloud Monitoring log-based alert active. SLA 4h max.
  - SC traceability: SC-1.1.1, SC-1.1.2, SC-1.1.4, SC-1.1.5.
- **Rollback**: script en repo sin efecto. One-shot retire irreversible by design; resume-from-partial-retire mitigates partial failure.
- **Spec trace**: §3 SC-1.1.1, SC-1.1.2, SC-1.1.4, SC-1.1.5; §7.5 H1.1 rollback irreversible.

### T5: demo-expires middleware (Hono context) + cache-warm (rate-limited) (P0-R3-5 fix) [DONE 2026-05-25]

- **Files**: `apps/api/src/middleware/demo-expires.ts` + test, `apps/api/src/routes/demo-cache-warm.ts` + test (hereda IP rate-limit Sprint 1), `apps/web/src/routes/demo.tsx` (modify pre-warm wire).
- **LOC estimate**: ~100.
- **Wall-clock**: ~2h.
- **Depends on**: T4.
- **Acceptance**:
  - **Middleware position**: DESPUÉS de `firebase-auth` middleware en main.ts wire chain. Consume decoded claims via Hono context `c.get('firebaseClaims')` (key verificado en `apps/api/src/middleware/firebase-auth.ts:116`).
  - **NO re-verify token**: firebase-auth ya ejecutó `verifyIdToken(token, /*checkRevoked*/ true)`. demo-expires usa claims decoded de context.
  - Admin SDK `getUser(uid)` server-side re-read para claim freshness, cached ≤60s en Redis `demo-claim:<uid>`.
  - **Perf budget v4 (aligned a spec)**: ≤5ms p95 cached + **≤200ms p95 uncached** (1× getUser solo, sin re-verify; matches spec SC-1.1.2b + §6.8) + 1s timeout.
  - **Perf integration test nuevo**: `apps/api/test/integration/demo-expires-perf.integration.test.ts` mide p95 con Firebase Admin SDK **network layer mockeado** (NO Firebase emulator — evita 1-2h hidden setup overhead). Falla si p95 uncached > 200ms.
  - **Landing pre-warm**: `useEffect` on mount en `apps/web/src/routes/demo.tsx` dispara fetch fire-and-forget para 4 personas (path persona Spanish per spec v3.3 amendment).
  - Fail-closed: Firebase timeout/5xx/network → 503 + `Retry-After: 30` + log `auth.demo.fail_closed.firebase` + métrica. Redis unreachable → 503 + métrica `auth.demo.fail_closed.redis`.
  - `claims.expires_at` past → 401. Claim ausente → passthrough.
  - **Cache-warm endpoint**: `GET /api/v1/demo/cache-warm/:persona` invoca `getUser(uid)` + seed Redis. Aplica IP rate-limit middleware Sprint 1 (10 req/min/IP) — abuse mitigation.
  - Landing pre-warm: `apps/web/src/routes/demo.tsx` (path confirmed) dispara fetch fire-and-forget.
  - Unit tests cubren todos los escenarios spec §10 T2.
  - SC traceability: SC-1.1.2b, SC-1.1.2c, SC-1.1.3; P2-R2-3 abuse mitigation; P0-R3-5 perf budget realistic.
- **Rollback**: revertir merge. Demo path pierde enforcement.
- **Spec trace**: §3 SC-1.1.2b, SC-1.1.2c, SC-1.1.3; §9 R-DA-CLAIM-LATENCY.

### T6a: TTL alerter Cloud Run endpoint + Cloud Scheduler + LOG-BASED alerts (P0-R3-1 fix) [DONE 2026-05-25]

- **Files**: `apps/api/src/routes/admin-jobs.ts` (extend), `apps/api/src/services/demo-account-ttl-alerter.ts` + test (new — emite **structured logs** para log-based metrics, no SDK custom metric), `infrastructure/scheduling.tf` (extend Cloud Scheduler), `infrastructure/monitoring.tf` (extend con 2 `google_logging_metric` + 2 `google_monitoring_alert_policy`).
- **LOC estimate**: ~80 (endpoint ~10 + service ~25 + scheduler tf ~15 + monitoring tf con 2 log-metrics + 2 alerts ~30).
- **Wall-clock**: ~2h.
- **Depends on**: T4, T7a.
- **Acceptance**:
  - Cron daily 06:00 Santiago invoca `POST /admin/jobs/demo-account-ttl-alert` via OIDC SA `internal-cron-invoker`.
  - Service: lee `customClaims` de 4 UIDs activas; emite structured log **SOLO cuando** `days_remaining ≤ 7`: `logger.warn({ event: "demo.ttl_low", days_remaining, persona })`. No emite log para días ≥ 8 (idempotencia via Redis dedup key `demo-ttl-alerted:<uid>:<bucket>` TTL 24h).
  - **Log-based metric 1 (TTL primary, counter pattern per P0-R4-2 fix)**: `google_logging_metric` counter type DELTA con filter `jsonPayload.event = "demo.ttl_low"` — emite solo cuando log existe. `google_monitoring_alert_policy` fires si `rate(metric) > 0` sustained 1min → notify email `dev@boosterchile.com` + canal SRE. Pattern idéntico a `telemetry-monitoring.tf` existing counters (e.g., `device_records_per_minute` línea 15).
  - **Log-based metric 2 (T4 silent-window guard, counter pattern)**: cuando one-shot retire ejecuta, script logs `audit.demo_uid_retired` per UID (4 events expected). `google_logging_metric` counter con filter `jsonPayload.event = "audit.demo_uid_retired"`. Alert policy: si `count(metric) < 4 WITHIN 4h of deploy_event_timestamp` → notify on-call. Cloud Monitoring soporta count-based conditions sin gauge complexity.
  - **IAM verify pre-build**: `monitoring.metricWriter` ya en `iam.tf:74` (confirmed) — skip duplicate binding.
  - Test unitario: 4 UIDs con `expires_at` variado → emit logs correctos.
  - SC traceability: SC-1.1.6 + cierre P0-R3-1 (no custom metric infra needed).
- **Rollback**: deshabilitar Cloud Scheduler + remove log-metrics + alerts.
- **Spec trace**: §3 SC-1.1.6.

### T6b: docs/qa/demo-accounts.md expansion

- **Files**: `docs/qa/demo-accounts.md` (extend desde minimal T4).
- **LOC estimate**: ~30.
- **Wall-clock**: ~0.5h.
- **Depends on**: T4, T6a.
- **Acceptance**: per-UID metadata + retire commands + window-of-overlap cronología + Cloud Monitoring alerts references + staging-rehearsal dry-run procedure.
- **Rollback**: revertir doc.
- **Spec trace**: §3 SC-1.1.7.

### T7b: ADR-053 transition `Proposed` → `Accepted` (PR #1 merge event)

- **Files**: `docs/adr/053-post-disclosure-account-replacement.md`.
- **LOC estimate**: ~2 (Status line update).
- **Wall-clock**: ~5min.
- **Depends on**: T7a (Proposed), T4 (decision implementada), T5, T6a (consequences materializadas).
- **Acceptance**: `Status: Accepted` + date update en frontmatter; final commit del PR antes de merge.
- **Spec trace**: §3 SC-IAC.3.

### T8: Redis testcontainers integration test (P1-R3-2 explicit degradation)

- **Files**: `apps/api/test/integration/redis-fail-closed-real.integration.test.ts`, `apps/api/package.json`, `.github/workflows/ci.yml`.
- **LOC estimate**: ~80.
- **Wall-clock**: ~5h.
- **Depends on**: T5 **merged a main** (sin deploy gate), T0 (CI job ya existe).
- **Acceptance**:
  - Test con `@testcontainers/redis`: 3 escenarios (Redis up + 6 requests → 429; Redis stopped mid-test → 503 demo-expires + rate-limit-pin; Redis restart → recovered).
  - License verification `@testcontainers/redis` MIT/Apache + capturado en `sprint-2a-evidence/t8-license-audit.md`.
  - `booster-skills:dependency-auditor` sub-agent run + output capturado.
  - **Fallback path con degradation matrix explícita**:
    | Scenario | Testcontainers (primary) | `services: redis` fallback |
    |---|---|---|
    | Redis up + rate-limit | ✓ Validated | ✓ Validated |
    | Redis stopped mid-test | ✓ Validated (real fail-closed) | **✗ NOT VALIDATED** (cannot kill sidecar from inside test) |
    | Redis restart | ✓ Validated | ✗ NOT VALIDATED |
    - Si fallback shipped: SC-1.1.2c "real Redis fail-closed" downgrada a "mock-only validated" + crear follow-up `_followups/sec-001-sc-1-1-2c-real-redis-validation.md` con priority P1 para Sprint 2b o post.
  - CI workflow extension con Docker socket privilege (primary) o `services: redis` fallback.
  - SC traceability: SC-1.1.2c (con degradation acknowledged), SC-H2.1b.
- **Rollback**: revertir tests + workflow + devDep.
- **Spec trace**: §3 SC-1.1.2c, SC-H2.1b.

## Out-of-band tasks Sprint 2a

- **ADR-053 Reserved stub** (existente): mantiene numbering lock hasta T7a Proposed.
- **One-shot init secrets** post-T2 apply.
- **One-shot retire 4 UIDs viejas** post-T5+T6a deployed + curl-verified (T4 acceptance).
- **One-shot `gh api` branch protection** post-T0 merge (T0.5 acceptance).
- **Staging rehearsal dry-run** ANTES de prod one-shot retire (T4 acceptance).
- **Update CURRENT.md** post-Sprint 2a.
- **Sprint 2a evidence dir** setup.
- **Verify Cloud Monitoring notification channels** (T6a sub-step 0).

## Open questions Sprint 2a v3

- **OQ-S2a-2** (residual round 2 P1-R2-4): testcontainers vs `services: redis` fallback per T8 acceptance matrix.

(Resto OQs cerradas v1/v2/v3.)

## Total estimate v3 (corrected per P2-R3-1)

| Task | LOC | Wall-clock | Depends on |
|---|---|---|---|
| T0 | ~40 | ~1.5h | — |
| T0.5 | ~0 | ~0.5h | T0 |
| T7a | ~50 | ~1h | — |
| T1 | ~75 | ~2h | T0, T7a |
| T2 | ~80 | ~1.5h | T0, T7a |
| T3 | ~100 | ~2h | T0, T1, T2 |
| T4 | ~100 | ~2.5h | T1, T2, T3, T7a |
| T5 | ~100 | ~2h | T4 |
| T6a | ~80 | ~2h | T4, T7a |
| T6b | ~30 | ~0.5h | T4, T6a |
| T7b | ~2 | ~0.1h | T7a, T4, T5, T6a |
| T8 | ~80 | ~5h | T5 merged |
| **Subtotal pure exec** | **~737** | **~20.6h** | |
| Cooling-off (12 tasks × 30min) | | ~6h | |
| Review (per PR ~30min × 2 PRs) | | ~1h | |
| Ship (per PR ~15min × 2 PRs) | | ~0.5h | |
| Out-of-band (5 tasks) | | ~3h | |
| **Total wall-clock estimate** | | **~31h** | |

**~31h / 4h per día focused = ~7-9 días hábiles realistic** (vs v2 incorrecto ~5-6).

**Sprint 2a task count v3 = 12 tasks, todos ≤100 LOC, cero waivers.** Cumple SKILL §Red Flags ≤15 tasks. Módulos ~11 (Sprint 1 fue 13, aceptable).

## Decision log Sprint 2a

- 2026-05-25 — Split Sprint 2 → 2a + 2b (round 1 P1-5).
- 2026-05-25 — Round 2: 3 P0 (CI, Pub/Sub, silent-window) + 5 P1 + 3 P2. v2 produced.
- 2026-05-25 — Round 3: 5 P0 (custom metric infra, branch protection, db:migrate fictional, naming bilingüe, perf budget) + 5 P1 + 3 P2. v3 produced.
- 2026-05-25 — PO decisiones round 3: Spanish naming completo per CLAUDE.md; T0.5 branch protection dentro Sprint 2a vía `gh api` manual.
- 2026-05-25 — Plan v3: 12 tasks, ~737 LOC, cero waivers, ~7-9 días realistic estimate.
- 2026-05-25 — Round 4 verdict APPROVE_WITH_RESERVATIONS. 3 P0 contract-coherence. PO decisión: Spanish completo + amend spec → spec.md v3.3 amendment aplicada inline (SC-1.0.2 + §4 + T15: `shipper` → `generador_carga`). Plan v4: same 12 tasks; T6a pivot a conditional-counter pattern; T5 perf budget aligned ≤200ms uncached per spec; T0.5 prose clarified; T5 useEffect + `firebaseClaims` Hono context key explicit; Firebase emulator path eliminado a favor de mocked network layer.

## Pre-build checklist Sprint 2a v3

- [ ] Sprint 1 PR mergeado.
- [ ] `terraform plan` desde main muestra 0 diffs P0.
- [ ] Latest migration en main es `0037_stakeholder_access_log.sql` → T1 usa 0038.
- [ ] `pnpm install` + `pnpm typecheck` + `pnpm lint` + `pnpm test` green en main HEAD.
- [ ] **Open PRs touching `apps/api/src/db/schema.ts` verificadas** (P1-R3-1 merge-conflict mitigation): query via `gh pr list --search "schema.ts"`. Coordinar insertion order si encuentra alguno active (especialmente sec-h3-dte-retention-lock).
- [ ] T7a (ADR-053 Proposed) DEBE mergear ANTES de T1 build per agent-rigor "ADR before code".
- [ ] T0 DEBE mergear ANTES de T1 (CI integration job para correr T3 integration tests).
- [ ] T0.5 (branch protection) ejecutado por PO post-T0 merge ANTES de T1 PR open (sin esto T0 gate no es enforcement).
- [ ] T4 one-shot retire NO ejecutado hasta T5 deployed + curl-verified + T6a alert active.
- [ ] **T4 one-shot retire NO ejecutado Friday después de 12:00 Santiago** (4h SLA fits before 16:00 cutoff per CLAUDE.md).
- [ ] T4 staging rehearsal `--dry-run` ejecutado ANTES de prod one-shot.
- [ ] `dependency-auditor` sub-agent run programado para T8 + /review.
- [ ] `security-scanner` sub-agent run programado para /review (Sprint 2a toca auth/middleware/secrets surface).
- [ ] LOC waivers: cero planeados — si surge >100 LOC en build, parar y re-split.

## Devils-advocate rounds output

**Round 1** (sobre Sprint 2 monolítico original): DO_NOT_APPROVE, 5 P0 + 7 P1 + 4 P2. Resolución: split 2 → 2a + 2b.

**Round 2** (sobre Sprint 2a v1): DO_NOT_APPROVE, 3 P0 + 5 P1 + 3 P2. Resolución: v2 produced (CI job + Cloud Monitoring + silent-window guard + barrel/coverage + perf budget + license + ADR planeación).

**Round 3** (sobre Sprint 2a v2): DO_NOT_APPROVE, 5 P0 + 5 P1 + 3 P2. Resolución: v3 produced (log-based metric pivot + branch protection + db:migrate fix + Spanish naming + Hono context perf budget + ADR before code + Friday rule + dry-run flag + wall-clock corrected).

**Round 4** (sobre Sprint 2a v3): **APPROVE_WITH_RESERVATIONS**, 3 P0 contract-coherence + 3 P1 + 2 P2. **Convergence judgment**: classes converging on spec↔plan coherence; R5 expected 0-1 P0. Resolución: v4 produced (spec amendment v3.3 con persona Spanish aplicada inline + T6a conditional-counter pattern + T5 perf budget aligned a spec 200ms + T0.5 prose clarified + Firebase emulator removed + useEffect explicit + Hono context key corrected `firebaseClaims`).

**Iteration halted at round 4**: PO authority. Residual P1/P2 items son refinements menores no bloqueantes; abordables en build phase si emergen.

**Round 5** (sobre Sprint 2a v4, PO-requested final check): **APPROVE** (sin reservations). Convergence verificada R1:5 → R2:3 → R3:5 → R4:3 → **R5:0**. Verdict explícito "Another round would not be productive — it would manufacture objections rather than find them. Build phase is the next correct step." 3 P2 residuales documentados como `/build` o `/test` phase concerns (spec partial amendment scope, procedural deviation inline approve, T5 200ms perf budget realism — todos tracked sin bloqueo).
