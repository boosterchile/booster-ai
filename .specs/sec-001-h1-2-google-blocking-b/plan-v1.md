# Plan: sec-001-h1-2-google-blocking-b (Sprint 2c-B — deployment + IdP wire + 7d watch + ADR Accepted)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec)
- **Created**: 2026-05-27 (v1)
- **Status**: Draft
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history of plan-a (cumulative): [`../sec-001-h1-2-google-blocking-a/plan-review.md`](../sec-001-h1-2-google-blocking-a/plan-review.md) — Sprint 2c-A converged plan v4 lessons inform plan-b structure.
  - Sibling: [`../sec-001-h1-2-google-blocking-a/spec.md`](../sec-001-h1-2-google-blocking-a/spec.md) (Sprint 2c-A handler — **shipped 14/14 to main**).
  - ADR-054: [`../../docs/adr/054-google-blocking-function-signup-gate.md`](../../docs/adr/054-google-blocking-function-signup-gate.md) (Status: Proposed; flip to Accepted is T13 of this plan).
  - Castellanizar followup (bidirectional cross-ref): [`../_followups/castellanizar-adr-headers.md`](../_followups/castellanizar-adr-headers.md).

## Pre-conditions a `/build`

Sprint 2c-B `/build` gated por ALL of:

1. **Plan v1 approved** (this document) + DA pass.
2. **Sprint 2c-A merged a `main`** ✅ (last commit `22132a1`).
3. **ADR-052 Status flip Accepted** ⏸ — gated by Sprint-2b T13 canary deploy 30 min success + 2 h watch. The mechanical CI gate (`sprint-2c-build-gate.yml` shipped en 2c-A T2b) will fail all Sprint 2c-B PRs until this flip. **PO action required out-of-band**.
4. **Identity Platform SA email empirically verified** (T1 of this plan; SC-2C.B.9 per DA v2 G-10 fix).
5. **SIGNUP_REQUEST_FLOW_ACTIVATED flag flipped ON in staging** (per 2c-B spec §11 gate; out-of-band PO action).

## What the G-A9 path-verification revealed

Per plan v4 G-A9 fix, the apps/web translation path was annotated `estimated; 2c-B plan-b debe verificar antes de lockear; si file absent, T-LITERALS becomes "create file + add mapping" rather than "extend existing"`.

Empirical check (2026-05-27):
- `apps/web/src/utils/translate-auth-error.ts` — **does NOT exist**.
- `apps/web/src/lib/api-errors.ts` — **does NOT exist**.
- `translateAuthError` is currently an **inline `function` in `apps/web/src/routes/login.tsx`** (~30 LOC switch). It handles canonical Firebase auth codes but NOT `auth/internal-error` with custom message.
- Zero `BLOCKED_SIGNUP_PENDING_APPROVAL` matches in `apps/web/src`.

**Decision**: T2 extracts `translateAuthError` to a new module `apps/web/src/lib/translate-auth-error.ts`, then **extends** it with the `auth/internal-error` + message-substring branch that maps `BLOCKED_SIGNUP_PENDING_APPROVAL` to a user-facing message. Plan v4 spec §10 T-LITERALS test asserts the literal grep across both modules.

## Tasks

### T1: Pre-flight verification — SA email empirical + ghost user inventory dry-run

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/sa-email-verification.txt` (NEW, ~5 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-dry-run.csv` (NEW, ~variable LOC; CSV).
- **LOC estimate**: ~10 (committed evidence files only; commands run out-of-band).
- **Depends on**: ninguno; can run pre-ADR-052-flip (read-only ops).
- **Acceptance**:
  - SA email verified via `gcloud iam service-accounts list --project=booster-ai-494222 | grep -i identitytoolkit` per OQ-2C-B-3 + DA v2 G-10. Output redirected to `sa-email-verification.txt` with timestamp + PO sign-off comment.
  - Ghost user inventory script (2c-A T8) executed dry-run against prod Firebase Auth tenant per memory `reference_prod_db_headless_query.md` (gcloud auth ADC + IAP tunnel). Output `ghost-users-dry-run.csv` committed for PO review.
  - PO cleanup decision documented in `po-cleanup-decision.md` (see T11 for final post-wire execution + decision record).
- **SC trace**: SC-2C.B.9 (SA email); SC-2C.B.4 partial (inventory dry-run informs final execution post-wire).
- **Rollback**: revert evidence files (no prod impact; read-only).

### T2: Extract + extend translateAuthError + T-LITERALS integration test

- **Files**:
  - `apps/web/src/lib/translate-auth-error.ts` (NEW, ~50 LOC) — extracted from `login.tsx` inline function + new `auth/internal-error` branch with `BLOCKED_SIGNUP_PENDING_APPROVAL` substring detection in `error.message`.
  - `apps/web/src/lib/translate-auth-error.test.ts` (NEW, ~70 LOC) — unit tests covering all existing codes + new BLOCKED branch + fallback null.
  - `apps/web/src/routes/login.tsx` (MODIFY, ~-25 / +2 LOC) — remove inline function + import from new module.
  - `apps/web/src/components/profile/AuthProvidersSection.tsx` (MODIFY, ~-2 / +1 LOC) — re-route to extracted module.
  - **T-LITERALS test** (NEW location TBD): integration test asserting `apps/auth-blocking-functions/src/handler.ts` `BLOCKED_CODE` literal value equals the string handled by `translate-auth-error.ts`. Per G-A2 fix: same-PR file-visible obligation.
- **LOC estimate**: ~125 (**marginal +25 waiver over cap**, justified: T-LITERALS test is cross-package obligation lands en mismo PR as the apps/web extension per F-A4 mitigation contract).
- **Depends on**: Sprint 2c-A merged ✅.
- **Acceptance**:
  - `translateAuthError(code, message?)` exported from new module. Original switch preserved verbatim (call sites unchanged in semantics).
  - **New branch** `auth/internal-error`: if `message?.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')` → return `'Tu solicitud de registro debe ser aprobada por un administrador antes de poder iniciar sesión. Si ya solicitaste registro, espera la confirmación por email.'` (UI-facing Spanish, with hint).
  - Tests: existing codes preserved + new BLOCKED branch happy path + new branch with no message substring → fallback null.
  - **T-LITERALS test**: vitest reads `apps/auth-blocking-functions/src/handler.ts` + `apps/web/src/lib/translate-auth-error.ts` via fs; asserts BOTH contain literal `BLOCKED_SIGNUP_PENDING_APPROVAL`. Fails on drift.
  - Test location: place T-LITERALS test in `apps/api/test/integration/cross-source-literals.test.ts` since the assertion crosses 2 workspaces and apps/api integration tests already exist.
  - Coverage 80/75/80/80 maintained.
- **SC trace**: 2c-B §10 T-LITERALS; closes G-A2 cross-source-of-truth obligation introduced en 2c-A T7.
- **Rollback**: revert files.

### T3: tsup config + cloudbuild deploy step (NO terraform apply; code only)

- **Files**:
  - `apps/auth-blocking-functions/tsup.config.ts` (NEW, ~15 LOC) — explicit config for build artifact targeting Gen 1 Cloud Function (cjs format + node20 target + entry src/index.ts + dist output).
  - `cloudbuild.production.yaml` (MODIFY, ~+30 LOC) — new step `deploy-auth-blocking` running `pnpm --filter @booster-ai/auth-blocking-functions build` + `gcloud functions deploy beforeCreate --gen2=false --runtime=nodejs20 --source=apps/auth-blocking-functions/dist --entry-point=beforeCreate --region=us-east1 --no-allow-unauthenticated --max-instances=5 --min-instances=0`.
- **LOC estimate**: ~45.
- **Depends on**: T2 merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions build` succeeds locally + produces `dist/index.js` in CommonJS format.
  - Cloud Build step `deploy-auth-blocking` deterministic: idempotent + safe to re-run.
  - **DA v2 G-03 atomic deploy fix**: step exits non-zero if `gcloud functions describe` post-deploy returns missing `sourceArchiveUrl`. The subsequent step `wire-identity-platform` (T5) reads this status before applying.
  - Cloud Build YAML lint pass (deterministic step order + no orphan substitutions).
- **SC trace**: SC-2C.B.10 partial (atomic deploy verification scaffolding).
- **Rollback**: revert files.

### T4: infrastructure/auth-blocking-functions.tf — Cloud Function Gen 1 resource (gated)

- **Files**:
  - `infrastructure/auth-blocking-functions.tf` (NEW, ~60 LOC) — `google_cloudfunctions_function` (Gen 1) + `google_cloudfunctions_function_iam_member` granting `roles/cloudfunctions.invoker` to the Identity Platform SA from T1.
- **LOC estimate**: ~60.
- **Depends on**: T1 (SA email verified) + T3 (deploy step exists; terraform refs are name-only, no source archive bind).
- **Acceptance**:
  - Resource `google_cloudfunctions_function.before_create` with `runtime=nodejs20`, `available_memory_mb=256`, `timeout=60`, `entry_point=beforeCreate`, `region=us-east1`.
  - **DA v2 G-03 fix**: `lifecycle.ignore_changes = [source_archive_object, source_archive_bucket]` — Cloud Build manages the source artifact; Terraform manages the resource shape only.
  - IAM binding: `google_cloudfunctions_function_iam_member.idp_invoker` granting `roles/cloudfunctions.invoker` to the empirically-verified SA email from T1 (variable parameterized; not hardcoded).
  - `terraform validate` + `terraform plan` shows expected diff (1 resource + 1 IAM binding) when run pre-apply.
  - **NOTE**: Terraform apply is T8 (operational); T4 ships the .tf file only. The mechanical CI gate (`sprint-2c-build-gate.yml` from 2c-A T2b) will fire on this PR and require ADR-052 Accepted to pass.
- **SC trace**: SC-2C.B.1 partial (infra defined; not applied yet).
- **Rollback**: revert .tf file.

### T5: infrastructure/identity-platform.tf — wire blocking_functions.triggers.beforeCreate (gated)

- **Files**:
  - `infrastructure/identity-platform.tf` (MODIFY, ~+15 LOC) — add `blocking_functions { triggers { event_type = "beforeCreate"; function_uri = google_cloudfunctions_function.before_create.https_trigger_url } }` block.
- **LOC estimate**: ~20.
- **Depends on**: T4 merged.
- **Acceptance**:
  - HCL block syntactically correct + references T4 resource via Terraform interpolation (NOT hardcoded URL).
  - **DA v2 G-03 atomic deploy contract**: T5 MUST NOT be applied until T8 deploy verification passes. Documented as runbook constraint; mechanical guard provided by Cloud Build step ordering in T3.
  - `terraform plan` shows expected diff: 1 in-place update on `google_identity_platform_config.default.blocking_functions`.
- **SC trace**: SC-2C.B.1 (IdP wire defined); SC-2C.B.10 (apply ordering).

### T6: docs/qa/google-blocking-function-runbook.md — operational runbook

- **Files**:
  - `docs/qa/google-blocking-function-runbook.md` (NEW, ~120 LOC).
- **LOC estimate**: ~120 (**marginal +20 waiver**, justified: runbook covers 7d-watch + rollback + escape-hatch + emulator manual run + ghost cleanup; consolidated into a single document for incident-response usage).
- **Depends on**: T5 merged.
- **Acceptance**:
  - **§Pre-deploy checklist**: ADR-052 Accepted? SA email verified (T1)? Ghost user inventory dry-run reviewed (T1)? SIGNUP_REQUEST_FLOW_ACTIVATED flag ON in staging?
  - **§Deploy procedure**: Cloud Build trigger + manual approval (per ADR-051 + Booster-stack-conventions) + atomic apply order (T3 deploy → T8 verify → T5 IdP wire → smoke).
  - **§Rollback steps** (per umbrella §11 + DA v2 G-03 + G-11):
    - **Step 1 (5-min undo)**: Identity Platform Admin API `PATCH /v2/projects/.../config` con `updateMask=blockingFunctions` body `{}`.
    - **Step 2 (Terraform revert)**: revert wire commit + apply.
    - **Step 3 (Function destroy)**: `terraform destroy -target=google_cloudfunctions_function.before_create`.
    - **Step 4 (Ghost user cleanup revert)**: if option (a) disable applied, restore via `auth.updateUser(uid, {disabled: false})` per CSV row.
  - **§7d-watch semantics** (per DA v2 G-09): `T-WIRE-PROD-APPLY` timestamp recorded once at first apply; subsequent re-applies don't reset clock unless explicit "rollback + re-wire" event documented.
  - **§Emulator manual run procedure**: copy from 2c-A T9a doc-comment (firebase-tools install + emulator start + env vars + test:emulator invocation).
  - **§Smoke E2E procedure**: negative + positive cases with copy-pasteable curl commands.
  - **§Ghost user cleanup procedure**: how to apply option (a) disable per CSV row, with copy-pasteable `gcloud auth ... auth:disable` invocations.
  - **§Escape-hatch**: `gh workflow run sprint-2c-build-gate.yml -f force=true` + when to use.
- **SC trace**: SC-2C.B.10 documentation; operational reference for T8-T13.
- **Rollback**: revert runbook.

### T7: Atomic deploy verification script + tests (DA v2 G-03 mechanical fix)

- **Files**:
  - `apps/api/scripts/check-cloud-function-deployed.ts` (NEW, ~50 LOC) — invokes `gcloud functions describe beforeCreate --region=us-east1 --format=json` + asserts `sourceArchiveUrl` non-empty + `status === 'ACTIVE'`.
  - `apps/api/test/scripts/check-cloud-function-deployed.test.ts` (NEW, ~50 LOC) — fixture tests (active deploy → exit 0; missing sourceArchiveUrl → exit 1; status DEPLOY_IN_PROGRESS → exit 1; gcloud not installed → exit 1 with actionable message).
- **LOC estimate**: ~100.
- **Depends on**: T3 merged (Cloud Build step exists; this script verifies its outcome).
- **Acceptance**:
  - Script callable via `pnpm --filter @booster-ai/api exec tsx scripts/check-cloud-function-deployed.ts` (assumes `gcloud` available in env; documented).
  - Cloud Build step in T3 invokes this script between `deploy-auth-blocking` and `wire-identity-platform` — atomic deploy gate per DA v2 G-03 fix.
  - Tests run in vitest with mocked `child_process.execSync`.
- **SC trace**: SC-2C.B.10 mechanical verification.
- **Rollback**: revert files.

### T8: Terraform apply (T4 + T5 — operational task; evidence committed)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/terraform-apply-T8.log` (NEW, ~variable LOC) — sanitized output of `terraform apply` capturing the diff applied + timestamp + actor.
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY.txt` (NEW, ~3 LOC) — ISO timestamp of T-WIRE-PROD-APPLY for 7d-watch clock anchor per DA v2 G-09 fix.
- **LOC estimate**: ~10 (committed evidence; terraform apply runs out-of-band).
- **Depends on**: T4 + T5 + T6 + T7 merged + ADR-052 Status flip Accepted + Sprint 2b SIGNUP_REQUEST_FLOW_ACTIVATED ON.
- **Acceptance**:
  - `terraform apply` executed manually by PO per runbook §Deploy procedure.
  - Output sanitized (no secrets / SA email tokens) + committed.
  - `T-WIRE-PROD-APPLY.txt` timestamp recorded for 7d-watch anchor.
  - **Atomic ordering**: T4 resource created FIRST → Cloud Build deploy step runs → T7 script verifies → THEN T5 wire applies. Documented in runbook §Deploy.
- **SC trace**: SC-2C.B.1 + SC-2C.B.10 complete via evidence.
- **Rollback**: runbook §Rollback steps 1-4 (operational).

### T9: Smoke E2E negative + positive (operational task; evidence committed)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-negative.md` (NEW, ~15 LOC) — manual E2E run: cuenta Google ad-hoc sin matching aprobado → `signInWithPopup` falla con `auth/internal-error` + UI message traducido contiene BLOCKED text.
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-positive.md` (NEW, ~15 LOC) — manual E2E run: cuenta corporate Booster-domain (`dev@boosterchile.com` per OQ-2C-B-1) con matching aprobado pre-creado → signup succeeds + redirect to dashboard.
- **LOC estimate**: ~30 (committed evidence; E2E runs manually).
- **Depends on**: T8 applied.
- **Acceptance**:
  - **Negative**: screenshot + text log showing UI message; assert message contains "Tu solicitud de registro debe ser aprobada".
  - **Positive**: screenshot + text log; assert user UID created + redirect URL is post-login.
  - Per DA v2 G-06: positive case uses corporate domain (NO `@gmail.com` PII en audit log).
- **SC trace**: SC-2C.B.2 + SC-2C.B.3 closed via evidence.
- **Rollback**: revert evidence + runbook §Rollback.

### T10: Production perf smoke (script + first measurement)

- **Files**:
  - `apps/auth-blocking-functions/scripts/prod-perf-measure.ts` (NEW, ~40 LOC) — pulls Cloud Function metrics via Cloud Monitoring API (filter `metric.type=cloudfunctions.googleapis.com/function/execution_times` + `function_name=beforeCreate`) + computes p50/p95/p99 over (a) first 10 invocations OR (b) 7-day window — whichever applicable per SC-2C.B.5.
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/prod-perf-measure-<ISO>.json` (NEW, ~20 LOC) — first prod measurement output.
- **LOC estimate**: ~60.
- **Depends on**: T8 applied + at least 1 Google signup attempt post-wire.
- **Acceptance**:
  - Script executable via `pnpm --filter @booster-ai/auth-blocking-functions exec tsx scripts/prod-perf-measure.ts` (assumes `gcloud auth application-default login`).
  - First measurement output committed.
  - **Assertion**: p95 < 1500 ms per SC-2C.B.5 with OR-clause: "first 10 invocations OR 7-day window, whichever comes first" (DA v2 G-04 fix preserved).
  - If p95 fails assertion → escalation procedure (runbook §Performance regression).
- **SC trace**: SC-2C.B.5 + SC-2C.B.6.

### T11: Ghost user inventory execution + CSV + PO cleanup decision

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-T11-<ISO>.csv` (NEW, ~variable LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/po-cleanup-decision.md` (NEW, ~30 LOC) — PO decision per ghost: (a) leave alone, (b) disable, (c) email user with re-onboarding instructions.
- **LOC estimate**: ~50 (committed evidence; execution out-of-band).
- **Depends on**: T8 applied.
- **Acceptance**:
  - 2c-A T8 script (`inventory-google-ghost-users.ts`) re-executed against prod post-wire (this captures the canonical inventory).
  - PO decision recorded per ghost user. If option (b) disable applied, the operational `auth.updateUser(uid, {disabled:true})` invocations logged with timestamps.
- **SC trace**: SC-2C.B.4 closed.
- **Rollback**: per runbook §Rollback step 4 (revert disabled users via auth.updateUser).

### T12: 7-day watch + Cloud Monitoring alert verification

- **Files**:
  - `infrastructure/auth-blocking-functions-monitoring.tf` (NEW, ~50 LOC) — `google_monitoring_alert_policy` (3-sigma `signup.blocked.google` rate) + `google_monitoring_uptime_check_config` (Cloud Function reachability synthetic).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/7day-watch-log.md` (NEW, ~30 LOC) — daily check log between `T-WIRE-PROD-APPLY` and `T-WIRE-PROD-APPLY + 7 days`.
- **LOC estimate**: ~80.
- **Depends on**: T8 applied + T-WIRE-PROD-APPLY timestamp committed.
- **Acceptance**:
  - Monitoring infra applied via terraform.
  - Daily log of (a) blocked signup count, (b) baseline rate, (c) 3-sigma threshold, (d) alert firings — for 7 consecutive days.
  - SC-2C.B.7 closure: average < 1 blocked Google signup/day + 0 alert firings.
  - **Per DA v2 G-09 fix**: clock starts at T-WIRE-PROD-APPLY (T8); subsequent re-applies do NOT reset unless explicit "rollback + re-wire" event documented in runbook.
- **SC trace**: SC-2C.B.6 + SC-2C.B.7.

### T13: ADR-054 Status flip Proposed → Accepted (separate commit per ADR pattern)

- **Files**:
  - `docs/adr/054-google-blocking-function-signup-gate.md` (MODIFY, ~+1 LOC line 3 ONLY) — `- **Status**: Accepted (post-7d-watch cloudbuild run <ID>)`.
- **LOC estimate**: ~2.
- **Depends on**: T12 7-day watch passed.
- **Acceptance**:
  - Single-purpose commit: `docs(adr-054): Accepted post-7d-watch cloudbuild run <ID>`.
  - Status line matches ADR-052 lineage form (T2a regex from 2c-A still passes; gate continues firing on Sprint 2c-B paths until 2c-B CERRADO).
  - Note: 2c-B path-gate will continue requiring **ADR-052** Accepted (this script checks ADR-052 only; ADR-054 status is informational documentation).
- **SC trace**: SC-2C.B.7 closure.
- **Rollback**: revert commit.

### T14: CURRENT.md + sec-001-cierre §3 SC-1.2.2 transition → SEC-001 H1.2 CERRADO

- **Files**:
  - `docs/handoff/CURRENT.md` (MODIFY, ~+20 LOC) — section "Sprint 2c-B SHIPPED + H1.2 CERRADO".
  - `.specs/sec-001-cierre/spec.md` (MODIFY, ~+5 LOC §3 H1.2) — amendment A4: `SC-1.2.2 Google leg TRACKED_RESIDUAL → MET 2026-MM-DD via Sprint 2c-A + 2c-B`.
  - `.specs/_followups/sprint-2c-google-blocking-function.md` (MOVE to `.specs/_archive/`, 0 LOC change net).
- **LOC estimate**: ~25.
- **Depends on**: T13 merged.
- **Acceptance**:
  - CURRENT.md updated con Sprint 2c-B closure summary + links to evidence dir.
  - sec-001-cierre amendment A4 records SC-1.2.2 transition with date + ADR-054 reference.
  - Followup stub moved to archive (signals SEC-001 H1.2 closure).
  - **End of SEC-001 H1.2.**
- **SC trace**: parent spec sec-001-cierre §3 H1.2 closure.

## Out-of-band tasks (post-T14 cleanup)

- **Memory file update**: agregar lessons-learned from Sprint 2c-B (cross-workspace test pattern + atomic deploy verification + 7d-watch automation). **Owner**: Claude (post-T14). **Trigger**: post-T14 merged.
- **Castellanizar ADR-052/053/054**: per bidirectional cross-ref from 2c-A T2a, this followup unblocks. Execute coordinated batch (sed + T2a regex update + ADRs castellanized) per `.specs/_followups/castellanizar-adr-headers.md` §"Exclusiones / coordinación con Sprint 2c".

## Open questions

Inherited from umbrella OQ-2C-1..9 resolved + 2c-B-specific:

- **OQ-2C-B-1** (corporate Booster-domain for positive smoke): **resolved here** — `dev@boosterchile.com` per existing PO test account. Pre-create matching `solicitudes_registro.aprobado` row before T9 positive smoke.
- **OQ-2C-B-2** (Cloud Functions Gen 1 `min_instances` decision): **resolved here** — `min_instances=0` selected at T3 to minimize cost. Re-evaluate post-T10 baseline if cold-start latency unacceptable; revisit via separate amendment commit if needed.
- **OQ-2C-B-3** (SA email exact pattern): **resolved in T1** via empirical gcloud call.

## Alternatives considered (plan-level)

### Alt-2c-B-Plan-I: Combine T4 + T5 + T8 into single mega-PR

**Rejected**: violates atomic vertical slices + DA v2 G-03 atomic deploy gate (T4 must merge + Cloud Build deploy must succeed + T7 verify must pass BEFORE T5 wire applies).

### Alt-2c-B-Plan-II: Skip T2 apps/web extraction (extend inline in login.tsx)

**Rejected**: inline keeps T-LITERALS test grep-brittle (function not exported). Extraction to module enables proper unit tests + import-based assertion + cleaner cross-package contract.

### Alt-2c-B-Plan-III: Ship monitoring alert (T12) in same PR as terraform apply (T8)

**Rejected**: monitoring infra deserves its own PR + its own evidence trail. T8 is operational apply; T12 is code + apply.

### Alt-2c-B-Plan-IV: 7-day watch as automated CI job

**Rejected** at v1 scope: adds CI infrastructure cost without clear value over the daily-log manual approach. Re-evaluate in post-Sprint-2c-B retrospective if 7d-watch becomes a recurring pattern.

### Alt-2c-B-Plan-V: Auto-rerun Playwright a11y job on infra flake

**Defer to followup**: today's session observed 30-min timeout twice. Out-of-scope for 2c-B; tracked as separate infra concern (Playwright browser install hanging on GH runner).

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices (compile + test + mergeable independently); operational tasks (T1, T8, T9, T11) ship evidence files only.
- [x] All tasks ≤ 100 LOC OR waiver logged with genuine justification: T2 (125 marginal+25 T-LITERALS cross-package obligation), T6 (120 marginal+20 consolidated runbook).
- [x] Acceptance traces to 2c-B spec §3 SC o §10 test per task.
- [x] Rollback plan for each task.
- [ ] DA pass output captured: PENDING T152.
- [ ] User approval: PENDING T153.

## Total estimate

| Métrica | Valor |
|---|---|
| Tareas | **14** (T1-T14; mix code + operational) |
| LOC total estimate code | ~600 cross-stack (apps/web + apps/api + apps/auth-blocking-functions + infra .tf + cloudbuild.yaml + ADR + runbook) |
| LOC total estimate evidence | ~variable (CSVs + logs + decision records) |
| Tareas con waiver >100 LOC | 2 marginal (T2=125, T6=120) |
| **Wall-clock PO active** | ~3-5 días (depende ADR-052 flip + 7-day watch) |
| **Pre-condition crítica** | ADR-052 Status flip Accepted (gated by Sprint-2b T13 canary; out-of-band) |

## Decision log

- **2026-05-27 16:55Z** — /plan 2c-B phase entered post Sprint-2c-A CERRADO. Skill 20-planning-and-task-breakdown re-read. Empirical G-A9 path verification revealed `apps/web/src/lib/translate-auth-error.ts` does NOT exist; inline `translateAuthError` lives in `login.tsx`. Decision: T2 extracts + extends + tests.
- Plan-b v1 drafted. 14 tasks (mix code + operational evidence-only). Pending DA pass + user approval.
