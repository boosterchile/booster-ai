# Plan: sec-001-h1-2-google-blocking

- **Spec**: [`.specs/sec-001-h1-2-google-blocking/spec.md`](./spec.md) (Approved v2 + OQ-2C-1..9 resolved 2026-05-26)
- **Created**: 2026-05-26
- **Status**: Draft
- **Linked artifacts**:
  - [`spec-v1.md`](./spec-v1.md) — INVALIDATED historical.
  - [`review.md`](./review.md) — DA pass v1.
  - [`oq-research.md`](./oq-research.md) — 9 OQs resolution.

## Pre-conditions a `/build`

`/plan` puede draftearse y aprobarse ahora. `/build` (es decir, starting T2 que toca `apps/auth-blocking-functions/`) está gated por:

1. **ADR-052 Status flip `Proposed → Accepted`** — requires Sprint-2b T13 canary deploy success + 2h watch (separate sesión cuando deploy api real ocurra).
2. **Mechanical CI gate** `scripts/check-adr-status-accepted.ts` — entregable en **T1** de este plan (T1 ship NO está gated; lo que gate es T2+ vía path-based protection sobre `apps/auth-blocking-functions/**`).

Por tanto T1 puede ejecutarse inmediatamente post-plan-approval; T2+ esperan ADR-052 Accepted.

## Tasks

### T1: Mechanical CI gate — `check-adr-status-accepted.ts` + workflow + tests

- **Files**:
  - `apps/api/scripts/check-adr-status-accepted.ts` (NEW, ~40 LOC) — standalone script.
  - `apps/api/scripts/check-adr-status-accepted.test.ts` (NEW, ~30 LOC) — unit tests.
  - `.github/workflows/sprint-2c-build-gate.yml` (NEW, ~30 LOC) — path-filtered job que ejecuta el script.
- **LOC estimate**: ~100 (3 archivos pequeños complementarios).
- **Depends on**: ninguno (plan.md approved es el único requirement).
- **Acceptance**:
  - Script lee `docs/adr/052-signup-migration-admin-sdk-gate.md`, grep regex `^- \*\*Status\*\*:\s*Accepted` sobre línea 3 (o equivalent: file content matches regex anywhere en first 10 lines).
  - Exit 0 si match; exit 1 con mensaje claro si no.
  - Workflow `.github/workflows/sprint-2c-build-gate.yml` corre on `pull_request` con `paths: ['apps/auth-blocking-functions/**', 'infrastructure/auth-blocking-functions.tf', 'infrastructure/identity-platform.tf']`. Si paths matchean + ADR-052 status != Accepted → job fails.
  - Unit tests: (a) fixture ADR file con Status Proposed → exit 1; (b) fixture con Status Accepted → exit 0; (c) ADR file ausente → exit 1 con error message clara; (d) malformed (no Status line) → exit 1.
  - Branch protection rule `main` adds workflow as required check para PRs que matchean los paths (configuration manual post-merge, documented en `docs/qa/google-blocking-function-runbook.md`).
- **SC trace**: SC-2C.10 + T15 (spec §10).
- **Rollback**: revertir 3 archivos + remove from branch protection rules manually.
- **Spec trace**: §6 C14 + §3 SC-2C.10 + §10 T15.

### T2: ADR-NNN draft — Google Blocking Function signup gate (Proposed)

- **Files**:
  - `docs/adr/NNN-google-blocking-function-signup-gate.md` (NEW, ~100 LOC).
  - Numbering: assigned via `pnpm exec scripts/check-adr-numbering.ts` pre-merge (estimated ADR-054 o ADR-055).
- **LOC estimate**: ~100.
- **Depends on**: T1 merged (mechanical gate active; this PR doesn't touch gated paths so no block).
- **Acceptance**:
  - Sigue mismo pattern ADR-052 + ADR-053.
  - Status: `Proposed (2026-MM-DD; T2 Sprint 2c)`. Transición a `Accepted` agendada al T14 post-launch + 7d watch.
  - Sections completas: Context (parent spec §1 + §2), Decision (Cloud Function Gen 1 + gcip-cloud-functions + handler design), Consequences (positivas/negativas/riesgo residual), Alternatives considered (A1, A2 ADOPTED, A3 con empirical citation; B, C, D, E con cost-benefit ya en spec §8), Notes for future-self (Gen 2 migration when IdP supports + 1.0 SDK upgrade), Acceptance criterion para flip Proposed → Accepted (SC-2C.8 closure).
- **SC trace**: spec §6 C12.
- **Rollback**: revert ADR file.
- **Spec trace**: §6 C12 + §8 alternatives.

### T3: apps/auth-blocking-functions skeleton + handler stub + unit tests T1+T2+T4

- **Files**:
  - `apps/auth-blocking-functions/package.json` (NEW, ~30 LOC) — deps `gcip-cloud-functions: 0.2.0` exact + `firebase-admin@^13.7.0` + `firebase-functions@^3.x` + `pg` + `@booster-ai/logger` + `@booster-ai/shared-schemas`. Workspace entry.
  - `apps/auth-blocking-functions/tsconfig.json` (NEW, ~15 LOC) — extends base, module commonjs (Gen 1).
  - `apps/auth-blocking-functions/src/index.ts` (NEW, ~20 LOC) — wire `gcipCloudFunctions.AuthFunction` + export `beforeCreate`.
  - `apps/auth-blocking-functions/src/handler.ts` (NEW, ~40 LOC, stub with provider check + DB-less skeleton) — pure async.
  - `apps/auth-blocking-functions/src/handler.test.ts` (NEW, ~60 LOC) — unit tests T1 (negative not-found), T2 (positive approved), T4 (provider !== google.com passthrough).
- **LOC estimate**: ~165 (waiver vs ≤100 EXPLICIT — justificado: package.json + tsconfig + skeleton + handler stub + tests must land together for the package to compile and lint; splitting produces incomplete states. Precedent Sprint 2a T1 = 80 LOC pure infra; Sprint 2b T8 ~200 LOC con waiver).
- **Depends on**: **T1 merged + ADR-052 Status=Accepted** (mechanical CI gate fires).
- **Acceptance**:
  - `pnpm install --frozen-lockfile` succeeds; new workspace recognized.
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test` → 3 tests pass (T1, T2, T4 from spec §10).
  - `gcipCloudFunctions.AuthFunction` wired correctly per `gcip-cloud-functions@0.2.0` docs.
- **SC trace**: §3 SC-2C.7 partial (coverage starts); §10 T1, T2, T4.
- **Rollback**: delete dir + remove from pnpm-workspace.yaml.
- **Spec trace**: §7.2 component 1 + §10 T1-T4.

### T4: handler email normalization + R-2C-9 tests (IDN/punycode/casing)

- **Files**:
  - `apps/auth-blocking-functions/src/email-normalize.ts` (NEW, ~30 LOC).
  - `apps/auth-blocking-functions/src/email-normalize.test.ts` (NEW, ~50 LOC) — 20+ variantes per R-2C-9.
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~10 LOC) — call `normalizeEmail` before DB query.
- **LOC estimate**: ~90.
- **Depends on**: T3 merged.
- **Acceptance**:
  - `normalizeEmail(input)` applies: lowercase + trim + NFC unicode + punycode decode (e.g., `xn--mxico-bsa.cl` → `méxico.cl`). NO gmail alias collapsing.
  - Tests cubren: `'MiXeD@Case.CL'` → `'mixed@case.cl'`; `'foo+alias@gmail.com'` → `'foo+alias@gmail.com'` (no collapse); IDN `'user@xn--mxico-bsa.cl'` → `'user@méxico.cl'`; whitespace `' x@y.cl '` → `'x@y.cl'`; NFD vs NFC equivalence.
  - 80 % lines / 75 % branches coverage en este archivo.
- **SC trace**: §3 SC-2C.7; §9 R-2C-9; §10 T5.
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 1 + §9 R-2C-9.

### T5: handler DB lookup + fail-closed + structured logging + tests T3+T6+T7

- **Files**:
  - `apps/auth-blocking-functions/src/db.ts` (NEW, ~40 LOC) — singleton DB pool con Cloud SQL Auth Proxy unix socket; lazy init.
  - `apps/auth-blocking-functions/src/logger.ts` (NEW, ~15 LOC) — `@booster-ai/logger` instance.
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~30 LOC) — DB query + fail-closed catch + structured log con `event.ipAddress` + email-hashed.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +50 LOC) — tests T3 (DB throw → HttpsError internal), T6 (email missing → invalid-argument), T7 (estado != aprobado → permission-denied).
- **LOC estimate**: ~135 (waiver vs ≤100 — justificado: DB connection + logger + handler complete logic + tests interlinked; partial commit produces broken handler).
- **Depends on**: T4 merged.
- **Acceptance**:
  - Handler completo: extract email + provider → if non-google return → normalize email → DB query → if no rows throw permission-denied → if row exists return + structured log.
  - Test T3: mock DB throws ECONNREFUSED → expect `HttpsError('internal', ...)`.
  - Test T6: event sin email → expect `HttpsError('invalid-argument', ...)`.
  - Test T7: row con estado='pendiente_aprobacion' → expect `HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`.
  - Structured log entry sale con `event: 'signup.blocked.google'` + `correlationId` + `ipAddress` + `emailHashed`. NO email plaintext (PII per Ley 19.628).
  - Coverage SC-2C.7 ≥ 80 % / 75 % branches en handler.ts.
- **SC trace**: §3 SC-2C.2, SC-2C.5, SC-2C.7; §10 T3, T6, T7.
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 1 + §7.4 failure modes + §10 T3+T6+T7.

### T6a: Cloud Function Gen 1 infra Terraform (without IdP wire)

- **Files**:
  - `infrastructure/auth-blocking-functions.tf` (NEW, ~80 LOC):
    - `google_cloudfunctions_function.enforce_signup_approval` Gen 1 (NOT `_v2`); region `southamerica-west1`; runtime `nodejs20`; `available_memory_mb=256`; `timeout=60`; `trigger_http=true`; `vpc_connector` reusing existing.
    - `google_service_account.blocking_function_runtime`.
    - IAM bindings: cloudsql.client + secretmanager.secretAccessor (database-url) + vpcaccess.user.
    - `google_cloudfunctions_function_iam_member` `roles/cloudfunctions.invoker` for Identity Platform SA (verify exact SA email post-init).
    - `lifecycle.ignore_changes = [source_archive_object]` (Cloud Build deploys archive con commit SHA).
- **LOC estimate**: ~80.
- **Depends on**: T5 merged + ADR-052 Accepted.
- **Acceptance**:
  - `terraform validate` Success.
  - `terraform plan -target=google_cloudfunctions_function.enforce_signup_approval` muestra `1 to add, 0 to change, 0 to destroy`.
  - **NO apply en este task** — apply queda como evidencia operacional post-merge (documented en runbook T11).
- **SC trace**: §7.2 component 3.
- **Rollback**: `terraform destroy -target=...` + revert tf file.
- **Spec trace**: §7.2 component 3.

### T6b: Cloud Build deploy step + initial deploy verification

- **Files**:
  - `cloudbuild.production.yaml` (MODIFY, ~30 LOC) — agregar `build-auth-blocking` step (Function Gen 1 source upload via `gcloud functions deploy`) + `deploy-auth-blocking` step.
  - Includes mechanical gate step `check-adr-status-accepted` PRE-build per C14 (uses T1 script directly desde Cloud Build, no via GH Actions only).
- **LOC estimate**: ~30.
- **Depends on**: T6a merged + apply ejecutado (function deployed).
- **Acceptance**:
  - Cloud Build trigger build api commit → `build-auth-blocking` step succeeds → function deployed con commit SHA tag.
  - Function endpoint reachable via curl con fake event payload (not yet wired to IdP).
  - Pre-launch baseline test: 10 curl invocations measured → assert p95 < 1500 ms (SC-2C.4 baseline).
- **SC trace**: §3 SC-2C.4 baseline; §7.2 component 5.
- **Rollback**: revert cloudbuild step → no impact a otros deploys (otros services use existing steps).
- **Spec trace**: §7.2 component 5 + §3 SC-2C.4.

### T7: Identity Platform wire + smoke E2E manual instructions

- **Files**:
  - `infrastructure/identity-platform.tf` (MODIFY, ~15 LOC) — remove `blocking_functions` from `lifecycle.ignore_changes`; add `blocking_functions.triggers.beforeCreate.function_uri = google_cloudfunctions_function.enforce_signup_approval.https_trigger_url`.
- **LOC estimate**: ~15.
- **Depends on**: T6b merged + function deployed + baseline test pass.
- **Acceptance**:
  - `terraform plan` muestra `0 to add, 1 to change, 0 to destroy` con cambio focused en `blocking_functions`.
  - Post-apply: `curl -s "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.blockingFunctions'` retorna non-null `triggers.beforeCreate.function_uri` (SC-2C.1 verification).
  - Smoke E2E manual: nuevo browser incognito → app.boosterchile.com login → click Google → cuenta de prueba sin matching solicitudes_registro.aprobado → expect error UI con mensaje "No pudimos completar el registro..." (SC-2C.2 verification). Plus segundo test con cuenta aprobada → expect success login (SC-2C.3 verification).
- **SC trace**: §3 SC-2C.1, SC-2C.2, SC-2C.3; §10 T9 (config gate).
- **Rollback**: Identity Platform Admin API `PATCH config blockingFunctions={}` (5-min undo per spec §11) OR `terraform apply` previous commit.
- **Spec trace**: §7.2 component 4 + §3 SC-2C.1..3 + §10 T9.

### T8: Ghost user inventory script + tests

- **Files**:
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.test.ts` (NEW, ~30 LOC).
- **LOC estimate**: ~110 (waiver vs ≤100 — justificado: script + tests must land together; script depende of types from `@booster-ai/shared-schemas` signup-request domain).
- **Depends on**: T5 merged (DB pool reusable from same app).
- **Acceptance**:
  - Script lista Firebase users (`auth.listUsers()` paginado) con `providerData.find(p => p.providerId === 'google.com')`.
  - Cross-reference cada user contra `solicitudes_registro WHERE email=lower(user.email) AND estado='aprobado'`.
  - Output CSV `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/ghost-users-inventory-<ISO-timestamp>.csv` con cols: firebaseUid, email, displayName, createdAt, matchingApprovedRequest.
  - **Read-only**: NO disabling, NO deletion.
  - Tests con mock Admin SDK + mock DB: (a) empty Firebase users → CSV con 0 rows + header; (b) 5 Firebase users, 3 con matching aprobado → CSV con 2 ghost users.
- **SC trace**: §3 SC-2C.9; §10 T14.
- **Rollback**: revert files (script no-op since not auto-executed).
- **Spec trace**: §7.2 component 2 + §3 SC-2C.9.

### T9: Firebase emulator integration test (REQUIRED per P1-1)

- **Files**:
  - `apps/auth-blocking-functions/test/integration/firebase-emulator.test.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/firebase.json` (NEW, ~15 LOC) — Firebase emulator config (auth + functions).
- **LOC estimate**: ~95.
- **Depends on**: T5 merged (handler complete).
- **Acceptance**:
  - `firebase emulators:start --only auth,functions` arranca local emulator.
  - Test setup: seed `solicitudes_registro` row con estado=aprobado para email X; trigger emulator signup with Google provider stub email X → expect Firebase user created.
  - Test setup: trigger emulator signup with email Y (no matching) → expect Firebase user NOT created + error `auth/internal-error`.
  - CI integration: optional Cloud Build step that spins up emulator + runs test. Si CI complexity es alto, skip CI mode + corrida manual pre-merge (documentado en runbook).
- **SC trace**: §3 SC-2C.2, SC-2C.3, SC-2C.7; §10 T8.
- **Rollback**: revert test file.
- **Spec trace**: §10 T8 (REQUIRED, not stretch).

### T10: Race condition + Admin SDK no-impact integration tests

- **Files**:
  - `apps/auth-blocking-functions/test/integration/race-condition.test.ts` (NEW, ~50 LOC) — T12 spec §10.
  - `apps/auth-blocking-functions/test/integration/admin-sdk-no-impact.test.ts` (NEW, ~50 LOC) — T13 spec §10.
- **LOC estimate**: ~100.
- **Depends on**: T9 merged (Firebase emulator setup reusable).
- **Acceptance**:
  - T12 race test: dos concurrent signup attempts mismo email (one Google new, one approve flow). Verify deterministic outcome dado serial commit order. Documents OQ-2C resolution + R-2C-13 invariant.
  - T13 Admin SDK test: invocar approveSignupRequest desde apps/api con email matching pending solicitudes_registro → verify (a) Admin SDK createUser succeeds without rejection (handler early-returns), (b) row updated to estado=aprobado, (c) NO log entry from blocking function indicating rejection (early-return defense works). EMPIRICALLY RESOLVES OQ-2C-8.
- **SC trace**: §3 SC-2C.11; §10 T12 + T13.
- **Rollback**: revert files.
- **Spec trace**: §7.5 Admin SDK defense + §3 SC-2C.11 + §10 T12+T13.

### T11: apps/web translateAuthError extension + tests

- **Files**:
  - `apps/web/src/lib/api-errors.ts` (MODIFY, ~20 LOC) — substring-search pattern per OQ-2C-1 resolution.
  - `apps/web/src/lib/api-errors.test.ts` (MODIFY, +20 LOC) — tests mapping con FirebaseError mocks.
- **LOC estimate**: ~40.
- **Depends on**: T7 merged (smoke E2E manual confirms error reaches frontend with expected message format).
- **Acceptance**:
  - `translateAuthError(error)` retorna mensaje específico user-friendly español si `error.code === 'auth/internal-error'` AND `error.message.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')`. Returns generic Spanish fallback para otros `auth/internal-error`.
  - Tests con FirebaseError mocks cubren ambos paths + edge cases (message null, message vacío).
- **SC trace**: §3 SC-2C.2 user-visible message; OQ-2C-1 + OQ-2C-4 resolution.
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 7 + §4 user-visible AFTER + OQ-2C-1 resolution.

### T12: Pre-launch ghost user inventory execution + PO decision

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/ghost-users-inventory-<ISO>.csv` (NEW, generated by T8 script).
  - `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/po-cleanup-decision.md` (NEW, ~30 LOC) — PO decision recorded per SC-2C.9 (option a/b/c).
- **LOC estimate**: ~30 (data file + decision doc).
- **Depends on**: T8 merged + T7 applied + apps/api running with Admin SDK access.
- **Acceptance**:
  - Script ejecutado contra prod Firebase Auth tenant → CSV generated con full inventory.
  - PO reviews CSV → documents decision en `po-cleanup-decision.md`: option (a) disable + audit / option (b) whitelist específico / option (c) accept all.
  - Decision committed to spec §13 decision log.
- **SC trace**: §3 SC-2C.9.
- **Rollback**: data file (immutable artifact). Cleanup execution (if option a chosen) es operational task separate.
- **Spec trace**: §7.6 + §3 SC-2C.9 + §11 Rollout migration step.

### T13: Documentation — ADR-NNN Acceptance + runbook + CURRENT.md update

- **Files**:
  - `docs/qa/google-blocking-function-runbook.md` (NEW, ~80 LOC) — smoke E2E manual + rollback fast-path + monitoring 7d watch + ADR-NNN flip workflow.
  - `docs/handoff/CURRENT.md` (MODIFY, ~30 LOC delta) — update con Sprint 2c ship status.
- **LOC estimate**: ~110 (waiver vs ≤100 — justificado: 2 docs interdependientes que reference each other; ship-time documentation needs to land together).
- **Depends on**: T7 merged + T11 merged + 7-day watch initiated (SC-2C.8 starts).
- **Acceptance**:
  - Runbook documenta:
    - Smoke E2E manual instructions (per §11 Rollout).
    - Rollback fast-path commands (Step 1: Admin API PATCH; Step 2: Terraform revert; Step 3: function destroy).
    - 7-day watch monitoring (SC-2C.8 numeric baseline `< 1 blocked Google signup/day promedio + 0 alert firings`).
    - ADR-NNN Status flip Proposed → Accepted workflow.
  - CURRENT.md updated con Sprint 2c ship summary similar al Sprint 2b H1.2 cierre pattern.
- **SC trace**: §3 SC-2C.6 monitoring runbook; §3 SC-2C.8 closure path.
- **Rollback**: revert docs.
- **Spec trace**: §11 Rollout monitoring + §7.2 component 9.

### T14: ADR-NNN Status flip Proposed → Accepted (separate post-launch commit)

- **Files**:
  - `docs/adr/NNN-google-blocking-function-signup-gate.md` (MODIFY, line 3 only) — Status: `Proposed` → `Accepted (post-Sprint-2c ship 2026-MM-DD; 7d watch passed)`.
- **LOC estimate**: ~2.
- **Depends on**: T13 merged + 7-day watch post-launch with metrics passing SC-2C.8 thresholds.
- **Acceptance**:
  - Cloud Monitoring shows `< 1 blocked Google signup/day promedio` over 7-day window.
  - `signup_probe_failure` alert NO disparó relacionado a blocking function.
  - Sprint 2c marked CERRADO en CURRENT.md.
  - Parent spec `.specs/sec-001-cierre/spec.md` §3 SC-1.2.2 amendment A3 transitions `TRACKED_RESIDUAL` → `MET` (separate commit a `sec-001-cierre/spec.md`).
- **SC trace**: §3 SC-2C.8 closure.
- **Rollback**: revert status flip line if metrics regress within 14d post-Accepted.
- **Spec trace**: §3 SC-2C.8 + §11 Rollout monitoring.

## Out-of-band tasks

Items que no están en la critical path pero se trackearán:

- **Sprint 2c followup stub cleanup**: `.specs/_followups/sprint-2c-google-blocking-function.md` debe marcarse "EXECUTED" o moverse a `.specs/_archive/` post-Sprint-2c ship.
- **Memory file update**: agregar memory `feedback_sprint_2c_pattern.md` documentando la lección learned del Gen 1 vs Gen 2 architectural empirical verification (so future sprints don't repeat the v1 mistake of trusting docs without spike).
- **PEP review**: actualizar `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` si Sprint 2c introduce nuevos patterns útiles para otros services.
- **Ghost user cleanup execution** (post-T12 PO decision): operational task separate, ejecutar via `harden-demo-accounts.ts` pattern adapted to disable Google ghost users si PO eligió option (a).

## Open questions

Resolved durante /plan o tracked para /build T0:

- **OQ-PLAN-1**: ¿Cloud Build emulator setup overhead — Firebase emulator dentro de Cloud Build CI complejidad? Si setup > 30 min, T9 corrida manual pre-merge documentada en runbook en lugar de CI integration.
- **OQ-PLAN-2**: ¿`pnpm-workspace.yaml` packages list necesita extension explícita para `apps/auth-blocking-functions/`? Verify wildcard pattern.
- **OQ-PLAN-3**: ¿Identity Platform SA email exacto para `cloudfunctions.invoker` binding? Verify en T6a init step contra real GCP project metadata.
- **OQ-PLAN-4**: ¿Sandbox spike OQ-2C-8 ejecutado fuera de Sprint 2c critical path? Pre-T6a deploy a staging Identity Platform tenant (si existe; else accept defensive design without empirical confirmation y proceed).

OQ-PLAN-1..4 sobre /plan craft are smaller scope que OQ-2C-1..9 spec-level. Resolverse en /build T1-T10 execution.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices (compile + test + mergeable independently): cada T_n produces working state.
- [x] All tasks ≤ 100 LOC estimate OR waiver logged: T3 (165 LOC waiver), T5 (135 LOC waiver), T8 (110 LOC waiver), T13 (110 LOC waiver). Cada waiver justified inline.
- [x] Acceptance traces to spec §3 SC o §10 test per task.
- [x] Rollback plan for each task that lands en production.
- [ ] Devils-advocate output captured: PENDING T75 mandatory invoke.
- [ ] User approval: PENDING T76.

## Total estimate

| Métrica | Valor |
|---|---|
| Tareas | 14 (T1-T14, T6a/b sub-split) |
| LOC total estimate | ~1,030 cross-stack (api + auth-blocking-functions + infra + docs) |
| Tareas con waiver >100 LOC | 4 (T3, T5, T8, T13) — cada uno justified |
| Wall-clock estimate | ~3-4 días PO time (T1-T11 ~2.5 días; T12-T14 ~1 día post-7d-watch) |
| Pre-condition para T2+ | ADR-052 Accepted (Sprint-2b T13 canary success + 2h watch) |
| Pre-condition para T1 ship | Plan approved (no other gate) |

## Decision log

- **2026-05-26 22:49Z** — /plan phase entered post-spec-Approved-v2 + OQ-2C-1..9 resolved. Skill 20-planning-and-task-breakdown read. Plan drafted.
