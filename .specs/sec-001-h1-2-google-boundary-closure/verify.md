# Verify: sec-001-h1-2-google-boundary-closure (Stream A)

- **Fase**: VERIFY · **Fecha**: 2026-06-04 · **Rama**: `feat/sec-001-boundary-closure`
- **Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md) (T1–T11 BUILD done)
- **Superficie**: backend puro (harness CI, predicado, runner, handler HTTP, infra Terraform, docs). **Sin UI** → browser-testing (skill 40) N/A.

## Test results

Suite `@booster-ai/api` (unit; integration excluida por config, requiere DB):

- **Test Files**: 114/114 passed
- **Tests**: **1398 passed | 2 skipped** (1400 total)
- Los 2 skipped son preexistentes y ajenos a esta feature (`test/unit/seed-demo.test.ts:355,427` — `ensureMembership` error-handling, no relacionado). Cero `.only`.

Tests de la feature (5 archivos, **97 casos**):

| Componente | Archivo de test | Casos |
|---|---|---|
| Harness default-deny (SC-G1b / T15) | `apps/api/test/scripts/check-route-default-deny.test.ts` | 24 |
| Predicado reaper (SC-G3 / T1,T2,T2b,T3,T4,T5,T5b,T11) | `apps/api/src/services/reaper-predicate.test.ts` | 22 |
| Runner reaper (SC-G4 / T6,T7,T12) | `apps/api/src/jobs/reap-inert-idp-accounts.test.ts` | 21 |
| Clasificación IdP (SC-G2) | `apps/api/test/scripts/classify-google-idp-accounts.test.ts` | 19 |
| Handler scheduler + flag (SC-G5) | `apps/api/test/unit/admin-jobs-route.test.ts` (subset reaper) | 11 |

Lint (`biome check`): 0 errores. Typecheck (`tsc --noEmit`): 0 errores. `terraform validate` (T9/T10): Success.

## Mapeo SC → tests

| SC | Verificación |
|---|---|
| **SC-G1** (audit cero GAP) | `route-boundary-audit.md` (doc, T1); el harness lo hace durable. |
| **SC-G1b / T15** (harness default-deny) | server.ts real pasa (40 mounts clasificados); factory ficticio + sub-mount `<router>.route()` ficticio → falla el build; stale + rationale-vacío → falla. |
| **SC-G2** (clasificación IdP) | funciones puras (LEGITIMATE/PENDING/INERT, dual-match degradado, never-reapable) + **paginación >1000 + SQL degradado** (agregado en VERIFY) + exclusión no-Google. |
| **SC-G3 / T1–T11** (predicado) | dual-guard uid+email (incl. simultáneo), grace creation+lastSignIn (estricto, límite exacto, =0, NaN, fecha inválida), pipeline solicitud, scope Google-only+email+whitespace, never-reapable, match degradado (Foo≡foo, no colapsa plus-tags). |
| **SC-G4 / T6,T7,T12** (runner) | dry-run no muta; disable-before-delete; 2º grace (dentro/pasado/**exacto**/inválido); hard-guard; **PII hasheada en disable+delete+wait**; paginación >1000; `reaper.run.summary` con conteos exactos. |
| **SC-G5** (scheduling + flag) | 503 deps-missing; dry-run default; destructive desde config server-side; **request no puede forzar destructive** (C-G2). Scheduler + counter en IaC (`terraform validate`). |
| **SC-G6** (ADR) | doc (ADR-057 supersede ADR-054). |
| **SC-G7** (decomiso) | `terraform validate` Success + análisis state-rm/destroy + IAM-reuse (`t10-decommission-analysis.md`). T9 spec (terraform plan per-env) = gate operacional. |
| **SC-G8** (cierre residual) | doc (SC-1.2.2 → MET, T11). |

## Test-engineer findings

Sub-agent `test-engineer` invocado (Prove-It pattern). Veredicto: harness default-deny **ejemplar**; predicado **sólido**; runner **bueno** con hueco PII en delete-path; calidad por encima del promedio. **Todos los P0 y P1 abordados en VERIFY**:

| Hallazgo | Estado | Test agregado |
|---|---|---|
| **P0-1** PII no testeada en delete/wait (C-G5/T7) | ✅ resuelto | `reap-inert…test.ts` "T7 (P0-1) delete y wait logean hasheado, nunca crudo" |
| **P0-2** `fetchReaperFacts` no testea email-match uid-distinto (T2b e2e) | ✅ resuelto | `reap-inert…test.ts` "P0-2 match por email con firebase_uid DISTINTO" |
| **P1-1** límite exacto 2º grace | ✅ resuelto | `decideAction` "límite EXACTO del 2º grace (30d) → delete" + reaperDisabledAt inválido |
| **P1-2** grace=0 / NaN | ✅ resuelto | predicado "graceDays=0 → reapable", "graceDays=NaN → fail-safe", "creationTime inválido → fail-safe" |
| **P1-3** classify paginación + SQL sin test | ✅ resuelto | classify "classifyGoogleIdpAccounts IO paginado" (2500/3 págs) + LEGITIMATE + phone-excluido |
| **P1-4** flag no forzable desde request | ✅ resuelto | admin-jobs "request body/query destructive:true NO fuerza el modo" |
| **P2-1** email solo-whitespace | ✅ **código endurecido** | `isGoogleWithEmail` ahora trata `'   '` como sin-email + test |
| **P2-2** uid-match Y email-match simultáneo | ✅ resuelto | predicado "uid Y email matchean a la vez → reason uid+email" |
| **P2-3** concurrencia / orden iteración | ✅ verificado | runner itera secuencial, cada cuenta independiente (sin estado compartido salvo summary) — sin gap |
| Assertions débiles (`toBeDefined` summary; T1 sin reason; regex laxa reporte) | ✅ fortalecidas | summary → estructura+conteos exactos; T1 → `reason /INERT/`; reporte → celda exacta `\| LEGITIMATE \| 1 \|` |

## Coverage

- **Suite completa (gate CI)**: All files **84.74% stmts / 75.87% branch / 87.48% funcs / 84.84% lines** — sobre los thresholds globales (`vitest.config.ts`: lines 80 / functions 75 / branches 75 / statements 80). ✅
- **Archivos gated de la feature**:
  - `src/services/reaper-predicate.ts`: ~100% (22 casos; ramas invalid-date/NaN/whitespace/dual-guard cubiertas).
  - `src/config.ts`: 91.3% (uncovered = `booleanFlag` helper interno, preexistente).
  - `src/routes/admin-jobs.ts`: 80% (uncovered `140-150` = handler `demo-account-ttl-alert` **preexistente**, no de esta feature; `181` = closure glue `fetchFacts`, cuya lógica está cubierta directo en el test del job).
- **Excluidos del gate por config del repo** (CLI con `main()` self-executing): `apps/api/scripts/**` (harness 24 tests, classify 19 tests) y `src/jobs/**` (runner 21 tests) — testeados por sus propias suites pese a no contar en el gate.

## UI verification

N/A — la feature no toca interfaz de usuario (sin HTML/JSX/componentes). Browser-testing checklist no aplica.

## Performance verification

Sin budgets de §6 para esta feature. El runner usa `listUsers` paginado (chunks 1000) + 2 queries/cuenta; el reaper corre como cron diario fuera de hot-path. El harness CI es estático (regex sobre `server.ts`, <100ms). No se requieren mediciones en staging.

## Gates operacionales pendientes (no son código)

1. Primer run destructivo: dry-run revisado + sign-off PO → `REAPER_DESTRUCTIVE=true` en `compute.tf` + redeploy.
2. `terraform plan` per-entorno (dev/staging/prod) — decomiso (T10) + scheduler/metric (T9).
3. Branch protection: quitar workflows `sprint-2c-*` removidos si eran required checks.
4. T4 run contra prod + decisión PO por cada INERT.

## Veredicto

✅ Suite verde (1398/1398 ejecutables; 2 skips preexistentes ajenos). Typecheck/lint/terraform-validate limpios. **Todos los P0/P1 del test-engineer resueltos**; P2 + assertions débiles abordadas. Feature lista para `/review`.
