# Plan: sec-001-h1-2-google-blocking

- **Spec**: [`.specs/sec-001-h1-2-google-blocking/spec.md`](./spec.md) (Approved v2 + OQ-2C-1..9 resolved 2026-05-26)
- **Created**: 2026-05-26 (v2 redraft post DA findings)
- **Status**: Draft v2
- **Linked artifacts**:
  - [`plan-v1.md`](./plan-v1.md) — INVALIDATED historical (4 P0 + 7 P1 findings DA review).
  - [`plan-review.md`](./plan-review.md) — DA pass v1 (19 substantive findings).
  - [`spec-v1.md`](./spec-v1.md) — spec INVALIDATED historical.
  - [`review.md`](./review.md) — spec DA pass v1.
  - [`oq-research.md`](./oq-research.md) — 9 OQs resolution.

## Pre-conditions a `/build`

`/plan` v2 puede aprobarse ahora. `/build` (es decir, starting T3a que toca `apps/auth-blocking-functions/`) está gated por:

1. **ADR-052 Status flip `Proposed → Accepted`** — requires Sprint-2b T13 canary deploy success + 2h watch.
2. **Mechanical CI gate** `scripts/check-adr-status-accepted.ts` — entregable en **T2** (T1 = ADR-NNN draft + T2 = CI gate). T2 ship NO está gated; lo que gate es T3a+ vía path-based protection.

T1+T2 pueden ejecutarse inmediatamente post-plan-approval; T3a+ esperan ADR-052 Accepted.

## Cambios v1 → v2 (addressing DA findings)

| Finding | v1 issue | v2 fix |
|---|---|---|
| F-01 (P0) | T1 mechanical gate sin test contra real ADR-052 content | T2 (was T1) acceptance adds test fixture clonado del ADR real + escape-hatch documented en runbook |
| F-02 (P0) | T3 acceptance claimed tests T1+T2 pero handler sin DB code | T3a (bootstrap) + T3b (skeleton + provider check + T4 only). Tests T1+T2 moved to T5b |
| F-03 (P0) | T6a + T6b broken-state window if applied independently | T6 single PR merged (~115 LOC waiver justified, atomic deploy) |
| F-04 (P0) | T6b "10 curl baseline" measures rejection latency, not handler perf | Baseline moved to T9 Firebase emulator measurement + T7 post-apply production smoke |
| F-05 (P1) | T1 (code) before T2 (ADR) reverses Booster pattern | T1 = ADR-NNN draft, T2 = CI gate |
| F-06 (P1) | T3 (165) + T5 (135) + T13 (110) waivers split-able | T3 → T3a/T3b, T5 → T5a/T5b, T13 → T13 monolítico (waiver kept, docs interdependientes) |
| F-07 (P1) | T10 race test tautological | T10 renamed "race-documents-invariant" + added pg_sleep-based fault-injection optional |
| F-08 (P1) | T12 ghost inventory missing execution context | T8 acceptance: Cloud Run job (one-shot via `gcloud run jobs deploy + execute`) reusing SA pattern de Sprint 2a `harden-demo-accounts.ts`; refs `reference_prod_db_headless_query.md` memory |
| F-09 (P1) | T14 7d clock-start undefined | T14 explicit `T-WIRE-PROD-APPLY` clock-start; T7 acceptance records timestamp |
| F-10 (P1) | 3-4d estimate misleading | Wall-clock recalc: ~3.5d PO active + 7d watch = ~10d calendar |
| F-11 (P1) | T7 rollback 5min unmeasured | T7 acceptance documents propagation latency + mid-OAuth-flow user-visible scenarios |
| F-12..F-19 (P2) | Various hygiene | Drift vocab clean, out-of-band owners assigned, OQ-PLAN-1..4 resolved inline, T11 dep removed, Alternatives section added, smoke E2E account defined, day-30 undo cost quantified |

## Tasks

### T1: ADR-NNN draft — Google Blocking Function signup gate (Proposed)

- **Files**:
  - `docs/adr/NNN-google-blocking-function-signup-gate.md` (NEW, ~100 LOC).
  - Numbering: assigned via `pnpm exec scripts/check-adr-numbering.ts` pre-merge (estimated ADR-054 o ADR-055).
- **LOC estimate**: ~100.
- **Depends on**: ninguno (plan approved es único requirement). Per Booster pattern "ADR antes de código" (spec §6 C12).
- **Acceptance**:
  - Sigue pattern ADR-052 + ADR-053 (Context / Decision / Consequences / Alternatives / Acceptance criterion).
  - Status: `Proposed (2026-MM-DD; T1 Sprint 2c)`. Transición a `Accepted` agendada al T14 post-launch + 7d watch.
  - Sections completas: Context (parent spec §1+§2), Decision (Cloud Function Gen 1 + gcip-cloud-functions + handler design), Consequences (positivas/negativas/riesgo residual), Alternatives considered (A1/A2/A3 con empirical citation; B/C/D/E con cost-benefit de spec §8), Notes for future-self (Gen 2 migration when IdP supports + 1.0 SDK upgrade), Acceptance criterion para flip Proposed→Accepted (SC-2C.8 closure).
- **SC trace**: spec §6 C12.
- **Rollback**: revertir ADR file.
- **Spec trace**: §6 C12 + §8 alternatives.

### T2: Mechanical CI gate — `check-adr-status-accepted.ts` + workflow + tests (incluido real-ADR fixture)

- **Files**:
  - `apps/api/scripts/check-adr-status-accepted.ts` (NEW, ~40 LOC) — standalone script.
  - `apps/api/scripts/check-adr-status-accepted.test.ts` (NEW, ~45 LOC) — unit tests + **integration-fixture test que clona el contenido actual de `docs/adr/052-signup-migration-admin-sdk-gate.md`** y verifica que el script lo identifica correctamente como Status: Proposed.
  - `.github/workflows/sprint-2c-build-gate.yml` (NEW, ~30 LOC) — path-filtered job.
- **LOC estimate**: ~115 (waiver vs ≤100 — justificado: script + workflow + comprehensive tests including real-ADR fixture, all interlinked per F-01).
- **Depends on**: T1 merged (ADR-052 file existing y referenced).
- **Acceptance**:
  - Script lee `docs/adr/052-signup-migration-admin-sdk-gate.md`, grep regex `^- \*\*Status\*\*:\s*Accepted` sobre líneas 1-10 (relaxed range vs strict line 3).
  - Exit 0 si match; exit 1 con mensaje claro si no.
  - Workflow corre on `pull_request` con `paths: ['apps/auth-blocking-functions/**', 'infrastructure/auth-blocking-functions.tf', 'infrastructure/identity-platform.tf']`. Si paths matchean + ADR-052 status != Accepted → job fails.
  - Tests fixtures:
    - (a) fixture ADR file con `Status: Proposed` → exit 1.
    - (b) fixture con `Status: Accepted (post-canary success...)` → exit 0.
    - (c) ADR file ausente → exit 1.
    - (d) malformed (no Status line) → exit 1.
    - **(e) NEW per F-01: integration test que abre actual `docs/adr/052-signup-migration-admin-sdk-gate.md` from filesystem → expect exit 1 (current state Proposed)**. Esto verifica que la regex matchea contra contenido real, no solo synthetic fixtures.
  - Branch protection rule `main` adds workflow as required check (configuration manual post-merge, documented en runbook T13).
  - **Escape-hatch documented en runbook**: si gate has bug requiring fix that touches `apps/auth-blocking-functions/**`, override via `workflow_dispatch` admin trigger OR temporary path-filter exclusion en commit dedicated.
- **SC trace**: SC-2C.10 + T15 (spec §10).
- **Rollback**: revertir 3 archivos + remove from branch protection rules manually.
- **Spec trace**: §6 C14 + §3 SC-2C.10 + §10 T15.

### T3a: apps/auth-blocking-functions bootstrap (package.json + tsconfig + workspace)

- **Files**:
  - `apps/auth-blocking-functions/package.json` (NEW, ~30 LOC) — deps **exact pin** `gcip-cloud-functions: "0.2.0"` + `firebase-admin: "^13.7.0"` + `firebase-functions: "^3.x"` (Gen 1 compatible) + `pg: "^8.13.1"` + `@booster-ai/logger` + `@booster-ai/shared-schemas`.
  - `apps/auth-blocking-functions/tsconfig.json` (NEW, ~15 LOC) — extends base, module commonjs (Gen 1 runtime).
  - `pnpm-workspace.yaml` (MODIFY, ~1 LOC) — verify wildcard catches new dir (resolve OQ-PLAN-2).
  - `apps/auth-blocking-functions/.gitignore` (NEW, ~5 LOC) — node_modules, dist, .env.
- **LOC estimate**: ~50.
- **Depends on**: **T2 merged + ADR-052 Status=Accepted** (mechanical CI gate fires al hacer cualquier change a `apps/auth-blocking-functions/**`).
- **Acceptance**:
  - `pnpm install --frozen-lockfile` succeeds; nuevo workspace recognized.
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors (handler.ts NOT exists yet; typecheck no-op succeeds via tsconfig validation).
  - Empty src/ acceptable; tests no yet.
- **SC trace**: §7.2 component 1 setup.
- **Rollback**: delete dir + remove pnpm-workspace.yaml entry.
- **Spec trace**: §7.2 component 1.

### T3b: handler skeleton + provider check + T4 test only

- **Files**:
  - `apps/auth-blocking-functions/src/index.ts` (NEW, ~20 LOC) — wire `gcipCloudFunctions.AuthFunction.beforeCreateHandler` import scaffold (NOT export yet — handler not complete).
  - `apps/auth-blocking-functions/src/handler.ts` (NEW, ~30 LOC) — provider check + structured return (no DB code yet).
  - `apps/auth-blocking-functions/src/handler.test.ts` (NEW, ~40 LOC) — test T4 (`providerData !== google.com` early-return) + structure smoke tests. **NO T1/T2 yet** — those require DB code, moved to T5b.
- **LOC estimate**: ~90.
- **Depends on**: T3a merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test` → tests T4 pass (provider not google.com → early-return); structure tests pass (function exported correctly).
  - Coverage % en handler.ts limitado en este stage (más cobertura llega en T5b).
- **SC trace**: §10 T4 (provider passthrough). §3 SC-2C.11 partial (defense early-return implemented).
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 1 partial + §10 T4.

### T4: handler email normalization + R-2C-9 tests (IDN/punycode/casing)

- **Files**:
  - `apps/auth-blocking-functions/src/email-normalize.ts` (NEW, ~30 LOC).
  - `apps/auth-blocking-functions/src/email-normalize.test.ts` (NEW, ~50 LOC) — 20+ variantes per R-2C-9.
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~10 LOC) — import `normalizeEmail` (call site arrives en T5b cuando DB code lands).
- **LOC estimate**: ~90.
- **Depends on**: T3b merged.
- **Acceptance**:
  - `normalizeEmail(input)` applies: lowercase + trim + NFC unicode + punycode decode. NO gmail alias collapsing.
  - Tests cubren: 20+ variantes per R-2C-9 (casing/IDN/punycode/whitespace/NFD vs NFC equivalence).
  - 80 % lines / 75 % branches coverage en email-normalize.ts.
- **SC trace**: §3 SC-2C.7; §9 R-2C-9; §10 T5.
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 1 + §9 R-2C-9.

### T5a: DB pool singleton + logger instance

- **Files**:
  - `apps/auth-blocking-functions/src/db.ts` (NEW, ~50 LOC) — singleton DB pool con Cloud SQL Auth Proxy unix socket; lazy init; pg.Pool con timeouts internos 3s.
  - `apps/auth-blocking-functions/src/logger.ts` (NEW, ~15 LOC) — `@booster-ai/logger` instance configured.
  - `apps/auth-blocking-functions/src/db.test.ts` (NEW, ~20 LOC) — basic lazy init + reuse test con mock pg.
- **LOC estimate**: ~85.
- **Depends on**: T4 merged.
- **Acceptance**:
  - `getDbPool()` returns lazily-initialized singleton; subsequent calls reuse same instance.
  - Config read from `DATABASE_URL` env var (matches T6 Secret Manager mount).
  - Tests verify lazy init + reuse + timeout config.
- **SC trace**: §3 SC-2C.7 partial.
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 1 + §6 C5+C6.

### T5b: handler DB lookup + fail-closed + structured logging + tests T1+T2+T3+T6+T7

- **Files**:
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~35 LOC) — call `normalizeEmail` (T4) → call `getDbPool()` (T5a) → query `solicitudes_registro` → fail-closed catch + structured log con `event.ipAddress` + email-hashed.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +60 LOC) — tests T1 (DB empty → permission-denied), T2 (DB row aprobado → no throw), T3 (DB throw → HttpsError internal), T6 (email missing → invalid-argument), T7 (estado != aprobado → permission-denied).
- **LOC estimate**: ~95.
- **Depends on**: T5a merged.
- **Acceptance**:
  - Handler completo: extract email + provider → if non-google return (T3b stub remains valid) → normalize email (T4) → DB query (T5a pool) → if no rows throw permission-denied → if row exists return + structured log.
  - All 5 new tests pass.
  - Structured log entry: `event: 'signup.blocked.google'` + `correlationId` + `ipAddress` + `emailHashed`. NO email plaintext.
  - Coverage SC-2C.7 ≥ 80 % / 75 % branches en handler.ts ahora that DB code lands.
- **SC trace**: §3 SC-2C.2, SC-2C.5, SC-2C.7; §10 T1+T2+T3+T6+T7.
- **Rollback**: revert files (T3b stub remains).
- **Spec trace**: §7.2 component 1 complete + §7.4 failure modes + §10 T1+T2+T3+T6+T7.

### T6: Cloud Function Gen 1 infra + Cloud Build deploy (single atomic PR)

- **Files**:
  - `infrastructure/auth-blocking-functions.tf` (NEW, ~80 LOC):
    - `google_cloudfunctions_function.enforce_signup_approval` Gen 1; region `southamerica-west1`; `runtime=nodejs20`; `available_memory_mb=256`; `timeout=60`; `trigger_http=true`; `vpc_connector` reusing existing; `min_instances=0` (default; raise post-baseline if needed per OQ-2C-2 resolution).
    - `google_service_account.blocking_function_runtime`.
    - IAM bindings: cloudsql.client + secretmanager.secretAccessor (database-url) + vpcaccess.user.
    - `google_cloudfunctions_function_iam_member` `roles/cloudfunctions.invoker` para Identity Platform SA (resolve OQ-PLAN-3: SA email = `service-{PROJECT_NUMBER}@gcp-sa-identitytoolkit.iam.gserviceaccount.com`).
    - `lifecycle.ignore_changes = [source_archive_object]`.
  - `cloudbuild.production.yaml` (MODIFY, ~35 LOC):
    - Step `build-auth-blocking` (Function Gen 1 source upload via gcloud).
    - Step `deploy-auth-blocking` (gcloud functions deploy `southamerica-west1`).
    - **Pre-build gate step `check-adr-status-accepted`** (uses T2 script directly desde Cloud Build).
- **LOC estimate**: ~115 (waiver vs ≤100 — **justificado per F-03 fix**: Terraform infra + Cloud Build deploy son atomic operation — applying Terraform sin Cloud Build deploy crea broken-state with function in API state pero no code archive. Merging single PR ensures no intermediate broken state. Precedent: Sprint 2b T8 200 LOC waiver justified similar way).
- **Depends on**: T5b merged (handler complete) + ADR-052 Accepted (gate active).
- **Acceptance**:
  - `terraform validate` Success.
  - `terraform plan -target=google_cloudfunctions_function.enforce_signup_approval` muestra `1 to add, 0 to change, 0 to destroy`.
  - **Apply ejecutado post-merge** + Cloud Build trigger ejecutado → `gcloud functions describe enforce-signup-approval --region=southamerica-west1 --format='value(sourceArchiveUrl,status,httpsTrigger.url)'` retorna non-empty `sourceArchiveUrl` (archive exists) + status `ACTIVE` + non-empty `httpsTrigger.url`.
  - Function endpoint NOT yet wired to IdP (`blocking_functions.triggers.beforeCreate` NOT set in identity-platform.tf yet).
- **SC trace**: §7.2 component 3+5.
- **Rollback**: `terraform destroy -target=google_cloudfunctions_function.enforce_signup_approval` + revert tf + cloudbuild.yaml. NO impact a otros services.
- **Spec trace**: §7.2 component 3 + component 5.

### T7: Identity Platform wire + production smoke E2E + baseline measurement

- **Files**:
  - `infrastructure/identity-platform.tf` (MODIFY, ~15 LOC) — remove `blocking_functions` from `lifecycle.ignore_changes`; add `blocking_functions.triggers.beforeCreate.function_uri = google_cloudfunctions_function.enforce_signup_approval.https_trigger_url`.
  - `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/t-wire-prod-apply.txt` (NEW post-apply, ~10 LOC) — records exact timestamp of `terraform apply` for wire (defines `T-WIRE-PROD-APPLY` per F-09).
- **LOC estimate**: ~25.
- **Depends on**: T6 merged + apply ejecutado + function endpoint reachable.
- **Acceptance**:
  - `terraform plan` muestra `0 to add, 1 to change, 0 to destroy` con cambio focused en `blocking_functions`.
  - Post-apply: `curl -s "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.blockingFunctions'` retorna non-null `triggers.beforeCreate.function_uri` (SC-2C.1 verification).
  - **Smoke E2E manual** (define account per F-18 P2):
    - **Account A** (negative case): cuenta Google de prueba creada **ad-hoc** (e.g., `test-sprint-2c-negative@gmail.com`) sin matching `solicitudes_registro.aprobado`. Login attempt → expect error UI "No pudimos completar..." (SC-2C.2 verification). **Cleanup post-test**: ad-hoc Google account deleted manually by PO.
    - **Account B** (positive case): seed `solicitudes_registro.estado='aprobado'` con email Google account real PO test (e.g., `dev@boosterchile.com` o test cuenta). Login Google → expect success → Firebase user creado con UID estable (SC-2C.3 verification).
  - **Baseline measurement** (F-04 fix): post-Smoke E2E, query Cloud Monitoring metric `cloudfunctions.googleapis.com/function/execution_times` over first 10 real invocations → assert p95 < 1500 ms (SC-2C.4). Si falla, escalate `min_instances=1` via separate apply.
  - **Propagation latency measured** (F-11 fix): record time from `terraform apply` completion to first signup attempt being affected. Expected ~30s; document actual en sprint-2c-evidence.
  - **Mid-OAuth-flow scenarios documented** (F-11 fix): si user mid-flow durante apply, behaviour es: (a) si OAuth callback pre-apply → user created with old (unblocked) state; (b) si OAuth callback post-apply → blocking function fires normalmente. Window ~30s.
- **SC trace**: §3 SC-2C.1, SC-2C.2, SC-2C.3, SC-2C.4; §10 T9 (config gate) + T10 (perf smoke).
- **Rollback** (F-11 fix detailed):
  - Step 1 (5-min undo via Admin API): `curl -X PATCH -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" -d '{"blockingFunctions":{}}' "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config?updateMask=blockingFunctions"`. Propagation ~30s.
  - Step 2 (Terraform-source-of-truth restore): revert this PR + apply → restaura `lifecycle.ignore_changes` con `blocking_functions`.
  - Cost-to-undo at day 30: irreversible side effect = any Google users created during the wire window with state divergent vs `solicitudes_registro`. Inventory script T8 can audit ghost state post-rollback.
- **Spec trace**: §7.2 component 4 + §3 SC-2C.1..4 + §11 Rollout.

### T8: Ghost user inventory script (Cloud Run job-deployable) + tests

- **Files**:
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.test.ts` (NEW, ~30 LOC).
- **LOC estimate**: ~110 (waiver vs ≤100 — marginal +10 LOC; tests + script interlinked).
- **Depends on**: T5a merged (DB pool reusable from same app).
- **Acceptance**:
  - Script lista Firebase users (`auth.listUsers()` paginado) con `providerData.find(p => p.providerId === 'google.com')`.
  - Cross-reference cada user contra `solicitudes_registro WHERE email=lower(user.email) AND estado='aprobado'`.
  - Output CSV `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/ghost-users-inventory-<ISO-timestamp>.csv` con cols: firebaseUid, email, displayName, createdAt, matchingApprovedRequest.
  - **Read-only**: NO disabling, NO deletion.
  - Tests con mock Admin SDK + mock DB.
  - **Execution context** (F-08 fix): script puede correr en 3 modos:
    1. **Local laptop**: `gcloud auth application-default login` + IAP tunnel a `db-bastion` per memory `reference_prod_db_headless_query.md` → `pnpm tsx scripts/inventory-google-ghost-users.ts`.
    2. **Cloud Run job** (preferred for production execution): `gcloud run jobs deploy inventory-google-ghost-users --image=<archive> --vpc-connector=serverless --set-secrets=DATABASE_URL=database-url:latest --region=southamerica-west1` + `gcloud run jobs execute`.
    3. **Cloud Build trigger** (one-shot manual): trigger via build config that runs `pnpm tsx` step.
  - Mode (1) is default per Sprint 2a `harden-demo-accounts.ts` precedent.
- **SC trace**: §3 SC-2C.9; §10 T14.
- **Rollback**: revert files (script read-only operationally).
- **Spec trace**: §7.2 component 2 + §3 SC-2C.9.

### T9: Firebase emulator integration test + baseline measurement (REQUIRED per P1-1 + F-04)

- **Files**:
  - `apps/auth-blocking-functions/test/integration/firebase-emulator.test.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/firebase.json` (NEW, ~15 LOC) — Firebase emulator config (auth + functions).
  - `apps/auth-blocking-functions/scripts/baseline-measure.ts` (NEW, ~30 LOC) — script que invokes handler via emulator 10x + measures p50/p95/p99 → output `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/baseline-perf-<ISO>.json`.
- **LOC estimate**: ~125 (waiver vs ≤100 — F-04 fix: emulator test + baseline script atomically validates SC-2C.4 strategy; previously T6b "curl baseline" was invalid).
- **Depends on**: T5b merged (handler complete).
- **Acceptance**:
  - `firebase emulators:start --only auth,functions` arranca local emulator.
  - Test setup: seed `solicitudes_registro` row con estado=aprobado para email X; trigger emulator signup with Google provider stub email X → expect Firebase user created.
  - Test setup: trigger emulator signup with email Y (no matching) → expect Firebase user NOT created + error `auth/internal-error`.
  - `baseline-measure.ts` script runs 10 invocations via emulator → output p50/p95/p99 → assert p95 < 1500 ms in initial measurement.
  - CI integration: optional Cloud Build step (decide per OQ-PLAN-1 resolution: if emulator startup < 30s, integrate CI; else corrida manual pre-merge documented en runbook).
- **SC trace**: §3 SC-2C.2, SC-2C.3, SC-2C.4 baseline, SC-2C.7; §10 T8 (REQUIRED) + T10 (perf smoke).
- **Rollback**: revert files.
- **Spec trace**: §10 T8 + T10 (REQUIRED, not stretch).

### T10: Race-documents-invariant + Admin SDK no-impact integration tests

- **Files**:
  - `apps/auth-blocking-functions/test/integration/race-documents-invariant.test.ts` (NEW, ~60 LOC) — **renamed per F-07 fix**: documents the invariant que serial commit order garantiza deterministic outcome. Optional `pg_sleep(2)` fault-injection variant que demuestra explícitamente que MVCC visibility behaves as expected even bajo artificial delay.
  - `apps/auth-blocking-functions/test/integration/admin-sdk-no-impact.test.ts` (NEW, ~50 LOC) — T13 spec §10.
- **LOC estimate**: ~110 (waiver vs ≤100 — 2 integration tests interlinked + emulator setup overhead shared).
- **Depends on**: T9 merged (Firebase emulator setup reusable).
- **Acceptance**:
  - **race-documents-invariant**: 
    - Test 1 (commit-order-A): approve commits first → Google signup attempt allowed.
    - Test 2 (commit-order-B): Google signup attempt first → permission-denied; subsequent approve commits → retry signup allowed.
    - Test 3 (fault-injection optional): `BEGIN; pg_sleep(2); UPDATE solicitudes_registro SET estado='aprobado'; COMMIT` en background. Concurrent Google signup attempt durante sleep → expect permission-denied (snapshot pre-commit). Post-commit signup → allowed.
    - **Documents the invariant** que blocking function sees committed state only; race window is theoretical given operational flow.
  - **admin-sdk-no-impact**: invocar approveSignupRequest desde apps/api con email matching pending solicitudes_registro → verify (a) Admin SDK createUser succeeds without rejection (handler early-returns por providerId !== 'google.com'), (b) row updated to estado=aprobado, (c) NO log entry from blocking function indicating rejection. EMPIRICALLY RESOLVES OQ-2C-8.
- **SC trace**: §3 SC-2C.11; §10 T12 (renamed) + T13.
- **Rollback**: revert files.
- **Spec trace**: §7.5 Admin SDK defense + §3 SC-2C.11 + §10 T12+T13.

### T11: apps/web translateAuthError extension + tests (INDEPENDENT — parallel-OK)

- **Files**:
  - `apps/web/src/lib/api-errors.ts` (MODIFY, ~20 LOC) — substring-search pattern per OQ-2C-1/OQ-2C-4 resolution.
  - `apps/web/src/lib/api-errors.test.ts` (MODIFY, +20 LOC) — tests mapping con FirebaseError mocks.
- **LOC estimate**: ~40.
- **Depends on**: T4 merged (just for `'BLOCKED_SIGNUP_PENDING_APPROVAL'` constant export from shared). **F-16 fix**: NO depends on T7. Can ship in parallel con T5a/T5b/T6 since unit-testable from spec OQ-2C-1 resolution + Firebase docs sample patterns directly. The smoke E2E in T7 verifies the pattern works against real Identity Platform, not the implementation correctness itself.
- **Acceptance**:
  - `translateAuthError(error)` retorna mensaje específico user-friendly español si `error.code === 'auth/internal-error'` AND `error.message.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')`. Returns generic Spanish fallback para otros `auth/internal-error`.
  - Tests con FirebaseError mocks cubren ambos paths + edge cases (message null, message vacío).
- **SC trace**: §3 SC-2C.2 user-visible message; OQ-2C-1 + OQ-2C-4 resolution.
- **Rollback**: revert files.
- **Spec trace**: §7.2 component 7 + §4 user-visible AFTER + OQ-2C-1+OQ-2C-4 resolution.

### T12: Pre-launch ghost user inventory EXECUTION + PO decision recorded

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/ghost-users-inventory-<ISO>.csv` (NEW, generated by T8 script execution).
  - `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/po-cleanup-decision.md` (NEW, ~30 LOC) — PO decision recorded per SC-2C.9 (option a/b/c).
- **LOC estimate**: ~30 (data file + decision doc).
- **Depends on**: T8 merged + T7 applied + Cloud Run job created (per T8 execution context option 2).
- **Acceptance**:
  - Script ejecutado contra prod Firebase Auth tenant → CSV generated con full inventory.
  - PO reviews CSV → documents decision en `po-cleanup-decision.md`:
    - Option (a) disable + audit: enumerate UIDs + invocar `auth.updateUser(uid, {disabled: true})` per uid.
    - Option (b) whitelist específico: decision per-uid.
    - Option (c) accept all (no cleanup): documentar deuda + monitor.
  - **Cost-to-undo at day 30** (F-19 fix): si option (a) y un user legítimo cayó en cleanup, restore via `auth.updateUser(uid, {disabled: false})`; reputational cost = customer-trust scar si user is professional B2B customer. Mitigation: PO reviews each CSV row antes de cleanup; preferred default es option (b) cuando inventory > 0.
- **SC trace**: §3 SC-2C.9.
- **Rollback**: data file (immutable artifact). Cleanup execution (if option a chosen) es operational task separate.
- **Spec trace**: §7.6 + §3 SC-2C.9 + §11 Rollout migration step.

### T13: Documentation — runbook + CURRENT.md update

- **Files**:
  - `docs/qa/google-blocking-function-runbook.md` (NEW, ~80 LOC) — smoke E2E manual + rollback fast-path + monitoring 7d watch + ADR-NNN flip workflow + T8 inventory script Cloud Run job procedure.
  - `docs/handoff/CURRENT.md` (MODIFY, ~30 LOC delta) — Sprint 2c ship status (pattern Sprint 2b H1.2 cierre).
- **LOC estimate**: ~110 (waiver vs ≤100 — F-06 marginal split rejected: 2 docs interdependientes que cross-reference each other; ship-time documentation atomic).
- **Depends on**: T7 merged + apply ejecutado + T8 + T9 + T10 + T11 + T12 merged.
- **Acceptance**:
  - Runbook documenta:
    - Smoke E2E manual instructions (per T7 acceptance criteria).
    - Rollback fast-path commands (Steps 1-2 per T7 detail).
    - 7-day watch monitoring (SC-2C.8 numeric baseline `< 1 blocked Google signup/day promedio + 0 alert firings`).
    - ADR-NNN Status flip Proposed → Accepted workflow (T14).
    - T8 inventory script Cloud Run job procedure.
    - Escape-hatch para T2 CI gate (workflow_dispatch override).
  - CURRENT.md updated con Sprint 2c ship summary.
- **SC trace**: §3 SC-2C.6 monitoring runbook; §3 SC-2C.8 closure path.
- **Rollback**: revert docs.
- **Spec trace**: §11 Rollout monitoring + §7.2 component 9.

### T14: ADR-NNN Status flip Proposed → Accepted (separate post-launch commit)

- **Files**:
  - `docs/adr/NNN-google-blocking-function-signup-gate.md` (MODIFY, line 3 only) — Status: `Proposed` → `Accepted (post-Sprint-2c-ship 2026-MM-DD; 7d watch passed)`.
  - `.specs/sec-001-cierre/spec.md` (MODIFY, ~3 LOC) — §3 SC-1.2.2 amendment A3 line: `TRACKED_RESIDUAL` → `MET`.
- **LOC estimate**: ~5.
- **Depends on**: T13 merged + **7-day watch passed con metrics verifying SC-2C.8 thresholds**.
- **Clock-start definition** (F-09 fix): `T-WIRE-PROD-APPLY` = timestamp recorded en T7 `sprint-2c-evidence/t-wire-prod-apply.txt`. 7-day clock starts t=`T-WIRE-PROD-APPLY`; T14 executes at t+7d earliest.
- **Acceptance**:
  - Cloud Monitoring shows `< 1 blocked Google signup/day promedio` over 7-day window since `T-WIRE-PROD-APPLY`.
  - `signup_probe_failure` alert NO disparó relacionado a blocking function.
  - Sprint 2c marked CERRADO en CURRENT.md (separate T13 commit).
  - Parent spec `.specs/sec-001-cierre/spec.md` §3 SC-1.2.2 amendment A3 transitions `TRACKED_RESIDUAL` → `MET`.
- **SC trace**: §3 SC-2C.8 closure.
- **Rollback**: revert status flip line if metrics regress within 14d post-Accepted.
- **Spec trace**: §3 SC-2C.8 + §11 Rollout monitoring.

## Out-of-band tasks (with owners + triggers per F-14)

| # | Task | Owner | Trigger |
|---|---|---|---|
| 1 | Sprint 2c followup stub cleanup: mark `.specs/_followups/sprint-2c-google-blocking-function.md` "EXECUTED" o move to `.specs/_archive/` | Felipe (PO) | Post-T14 ship + 14d |
| 2 | Memory file update: agregar `feedback_sprint_2c_pattern.md` documentando lesson learned del Gen 1 vs Gen 2 architectural empirical verification | Claude (next session) | Post-T7 successful apply |
| 3 | PEP review: actualizar `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` si Sprint 2c introduce patterns útiles para otros services | Felipe + Claude | Post-T14 |
| 4 | Ghost user cleanup execution (post-T12 decision option a): operational task via `harden-demo-accounts.ts` pattern adapted | Felipe (PO operational) | Post-T12 si option (a) chosen |
| 5 | OQ-PLAN-3 SA email exact verification: post-T6 init confirm `service-{PROJECT_NUMBER}@gcp-sa-identitytoolkit.iam.gserviceaccount.com` correct para current project | Claude/Felipe | T6 init pre-apply |

## Open questions (resolved per F-15 → resolved here, NOT deferred to /build)

- **OQ-PLAN-1** _(F-15 fix: resolved here)_: Cloud Build emulator setup overhead — decision: **manual corrida pre-merge documented en runbook**. Cloud Build CI integration of Firebase emulator adds 1-2 min per build; complexity > value for Sprint 2c critical path. CI integration tracked as future optimization out-of-scope.
- **OQ-PLAN-2** _(resolved)_: `pnpm-workspace.yaml` wildcard pattern `'apps/*'` already catches `apps/auth-blocking-functions/` — verified existing config supports new app addition without modification. T3a tiny modify if pattern needs tightening.
- **OQ-PLAN-3** _(F-15 fix: resolved here)_: Identity Platform SA email = `service-{PROJECT_NUMBER}@gcp-sa-identitytoolkit.iam.gserviceaccount.com` where PROJECT_NUMBER = `469283083998` (verified via `gcloud projects describe booster-ai-494222 --format='value(projectNumber)'`). Exact email: `service-469283083998@gcp-sa-identitytoolkit.iam.gserviceaccount.com`. T6 uses this directly.
- **OQ-PLAN-4** _(F-15 fix: addressed)_: Sandbox spike OQ-2C-8 (Admin SDK trigger) → addressed by T10 admin-sdk-no-impact integration test (Firebase emulator). NO separate pre-T6a sandbox needed — T10 verification suffices.

## Alternatives considered (F-17 fix)

### Alt-A: Sprint 2c entirely in apps/api as new endpoint (no new app)

**Rejected**: Identity Platform Blocking Functions require Cloud Function URI (per spec §6 C3 empirical verification). apps/api is Cloud Run service, NOT Cloud Function. Can't be used as blocking function trigger. Per spec §8 A1.

### Alt-B: Merge T1+T2 (ADR + CI gate) into single PR

**Rejected**: T1 (ADR-NNN draft) is pure docs; T2 (CI gate) is code. Conventional Commits convention separates scopes; squash-merging mixed scope violates CLAUDE.md. Plus T2 has integration test against T1 file content (real-ADR fixture) — requires T1 in main before T2 tests can pass meaningfully.

### Alt-C: Skip ADR-NNN (T1) and reuse ADR-052 amendments

**Rejected**: ADR-052 documents email/password leg decision; Google leg is architecturally distinct (Cloud Function Gen 1 vs Terraform IdP config). Amending ADR-052 would dilute the original decision context per ADR-046 "ADRs are immutable historical records".

### Alt-D: All-in-one PR (T3..T11 merged together)

**Rejected**: 700+ LOC single PR violates Booster review-quality threshold (CLAUDE.md). Atomic vertical slices are core agent-rigor principle. Risk: regression caught at T8 means reverting 700 LOC instead of 110.

### Alt-E: Defer T8 ghost inventory + T12 execution to post-ship

**Rejected per F-19**: ghost users created BEFORE Sprint 2c ship continue existing in tenant + remain audit log noise. Inventory + cleanup decision pre-launch is the cleanest cutoff. Defer would create open question about cleanup ownership post-ship.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices (compile + test + mergeable independently): cada T_n produces working state (F-02 + F-03 fixes ensure no fake-vertical).
- [x] All tasks ≤ 100 LOC estimate OR waiver logged: T2 (115), T6 (115), T8 (110), T9 (125), T10 (110), T13 (110) — cada waiver justified inline + cita F-XX fix.
- [x] Acceptance traces to spec §3 SC o §10 test per task.
- [x] Rollback plan for each task that lands en production.
- [ ] Devils-advocate output captured: v1 review en `plan-review.md`; v2 será DA-re-passed per skill §85-87.
- [ ] User approval: PENDING T76.

## Total estimate (recalculated per F-10)

| Métrica | Valor v1 | Valor v2 |
|---|---|---|
| Tareas | 14 | **16** (T1, T2, T3a, T3b, T4, T5a, T5b, T6, T7, T8, T9, T10, T11, T12, T13, T14) |
| LOC total estimate | ~1,030 | **~1,170** (split adds some boilerplate) |
| Tareas con waiver >100 LOC | 4 | **6** (T2, T6, T8, T9, T10, T13) |
| **Wall-clock PO active** | 3-4 días | **~3.5 días** (T1-T13 active execution) |
| **Wall-clock calendar incluyendo 7d watch** | NOT documented | **~10-11 días** (T1-T13 ~3.5d + 7d watch post-`T-WIRE-PROD-APPLY` para T14) |
| Pre-condition para T3a+ | ADR-052 Accepted | unchanged |
| Pre-condition para T1+T2 ship | Plan approved | unchanged |

## Decision log

- **2026-05-26 22:49Z** — /plan phase entered post-spec-Approved-v2 + OQ-2C-1..9 resolved. Skill 20-planning-and-task-breakdown read. Plan v1 drafted (14 tasks).

- **2026-05-26 23:05Z** — Devils-advocate review v1 returns **4 P0 + 7 P1 + 8 P2** findings (ver `plan-review.md`):
  - P0-1 (F-01): T1 self-locking — no test against real ADR-052.
  - P0-2 (F-02): T3 fake-vertical — tests T1+T2 can't pass without DB code.
  - P0-3 (F-03): T6a+T6b broken-state window.
  - P0-4 (F-04): T6b curl baseline invalid (JWT validation rejects).
  - Plus 7 P1 + 8 P2 findings.
  - Conclusion: plan v1 NOT approved; redraft to v2.

- **2026-05-26 23:30Z** — Plan v2 redraft (this version). Addresses all 4 P0 + 7 P1 + key P2:
  - **F-01 fix (T2)**: integration-fixture test que clona contenido actual de ADR-052 + escape-hatch documented en runbook.
  - **F-02 fix (T3 split)**: T3 → T3a (bootstrap) + T3b (skeleton + provider check + T4 test only). Tests T1+T2 moved to T5b.
  - **F-03 fix (T6 merged)**: T6a + T6b merged into single atomic PR (~115 LOC waiver justified per atomic-deploy).
  - **F-04 fix (baseline strategy)**: T9 Firebase emulator baseline + T7 post-apply production smoke (no T6b curl).
  - **F-05 fix (T1/T2 reorder)**: T1 = ADR-NNN draft, T2 = CI gate (ADR before code per Booster pattern).
  - **F-06 fix (waiver splits)**: T5 → T5a (DB+logger) + T5b (handler+tests).
  - **F-07 fix (T10 rename)**: race-documents-invariant + optional pg_sleep fault-injection.
  - **F-08 fix (T8 execution context)**: Cloud Run job + local laptop + Cloud Build trigger modes documented.
  - **F-09 fix (T14 clock-start)**: `T-WIRE-PROD-APPLY` defined explicitly; T7 records timestamp.
  - **F-10 fix (wall-clock)**: PO active ~3.5d + 7d watch = ~10d calendar.
  - **F-11 fix (T7 rollback)**: propagation latency measured + mid-OAuth scenarios documented.
  - **F-12..F-19 (P2)**: drift vocab cleaned; OOB tasks owners assigned; OQ-PLAN-1..4 resolved inline; T11 dep removed; Alternatives section added; smoke E2E account defined (ad-hoc); day-30 undo cost quantified.

  Status: Draft v2 awaiting user approval. Per skill §145, no /build hasta explicit user approve.
