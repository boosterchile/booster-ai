# Plan: sec-001-h1-2-google-blocking-b (Sprint 2c-B — deployment + IdP wire + 7d watch + ADR Accepted)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec)
- **Created**: 2026-05-27 (v2)
- **Status**: Draft v2
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history v1 of THIS plan: [`./plan-review.md`](./plan-review.md) (5 P0 + 4 P1 + 3 P2; F-B1..F-B12).
  - Plan v1 (INVALIDATED): [`./plan-v1.md`](./plan-v1.md).
  - Plan-a DA history (cumulative): [`../sec-001-h1-2-google-blocking-a/plan-review.md`](../sec-001-h1-2-google-blocking-a/plan-review.md).
  - Sibling: [`../sec-001-h1-2-google-blocking-a/spec.md`](../sec-001-h1-2-google-blocking-a/spec.md) (**shipped 14/14 to main**).
  - ADR-054: [`../../docs/adr/054-google-blocking-function-signup-gate.md`](../../docs/adr/054-google-blocking-function-signup-gate.md).
  - Castellanizar followup (bidirectional cross-ref): [`../_followups/castellanizar-adr-headers.md`](../_followups/castellanizar-adr-headers.md).

## What changed v1 → v2

| Finding | Fix in v2 |
|---|---|
| **F-B1** TWO `translateAuthError` functions exist | T2 narrows to **login.tsx-only**. `AuthProvidersSection.tsx` keeps its provider-linking translator (different domain). Unification deferred to new followup `.specs/_followups/translate-auth-error-unify.md`. T2 LOC budget restated. |
| **F-B2** T-LITERALS path inconsistency | T2 also modifies `docs/adr/054-google-blocking-function-signup-gate.md` to change `utils/` → `lib/` paths in Decision + Notes-for-future-self. T-LITERALS test relocated to `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts` (reads both files via `fs.readFileSync`). |
| **F-B3** T7 honor-system + hidden `lifecycle.ignore_changes` bug | T5 acceptance now **mandates removing `blocking_functions` from `lifecycle.ignore_changes` (identity-platform.tf line 71) BEFORE adding the new block**. T7 acceptance honestly labels scope "post-deploy verification, NOT inter-apply ordering — inter-apply enforced by PO discipline + T6 runbook". NEW T7b adds `.github/workflows/sprint-2c-b-deploy-gate.yml` to convert ordering enforcement from honor-system to mechanical: workflow fires on PRs touching `infrastructure/identity-platform.tf` `blocking_functions` block, requires the deploy-verify script to pass against prod state. |
| **F-B4** Operational tasks lack templates | T1, T8, T9, T11 acceptance criteria each gain **exact evidence file format** + verification command + sanitization procedure (for T8) + per-decision rubric (for T11). Templates inlined in plan body. |
| **F-B5** Gate teardown + ADR-052 contingency missing | T14 expanded to include **teardown of `.github/workflows/sprint-2c-build-gate.yml` + new `.github/workflows/sprint-2c-b-deploy-gate.yml` (T7b)** + remove from branch protection. Pre-conditions §"if Sprint-2b T13 delayed >14 days" contingency clause added with explicit escape-hatch criterion. |
| **F-B6** T12 monitoring + watch conflated | **Split**: T12a (monitoring infra apply, depends on T7 merged + applies BEFORE T8 so alerts exist day 0). T12b (7-day watch log, depends on T8 applied + T-WIRE-PROD-APPLY anchor). |
| **F-B7** T10 cold-start ambiguity | T10 acceptance defines: (a) discard first post-deploy invocation as warm-up; (b) p95 bar 1500 ms for warmed measurement, 3500 ms for cold-start population if min_instances=0 reality forces it; (c) regression escalation path. Cold-start dominance acknowledged in script doc-comment. |
| **F-B8** 7d clock honor-system | T6 runbook §7d-watch-semantics enumerates EXACT artifact format for re-apply events (`T-WIRE-PROD-APPLY-amendments.md`). T12b daily log dates auditable. NEW T13a (formerly part of T13) adds `apps/api/scripts/check-7d-watch-log.ts` reading log + asserting 7 daily entries + date range vs anchor. |
| **F-B9** dist/ + Cloud Build sequencing | T6 runbook §Deploy procedure enumerates **four-step sequence** (terraform-apply-T4 → Cloud Build deploy → check-cloud-function-deployed → terraform-apply-T5) with copy-pasteable commands. T4 .tf gains comment about Cloud Build source dependency. |
| **F-B10** T152/T153 leftover labels | Removed; renamed to "PENDING (this DA pass)" / "PENDING (user approval after DA)". |
| **F-B11** OQ-2C-B-2 deferred-decision | Re-labeled as **deferred-decision** with contingent rule: `min_instances=0` unless T10 measurement p95 > 5000 ms → PO commits to amend T4 .tf to `min_instances=1` within 7 days before T13 ADR-054 flip. |
| **F-B12** Wall-clock vs active hours | Total estimate splits "PO active hours" from "Wall-clock elapsed". |

## Pre-conditions a `/build`

Sprint 2c-B `/build` gated por ALL of:

1. **Plan v2 approved** (this document) + DA v2 pass.
2. **Sprint 2c-A merged a `main`** ✅ (last commit `22132a1`).
3. **ADR-052 Status flip Accepted** ⏸ — gated by Sprint-2b T13 canary deploy 30 min success + 2 h watch.
4. **Identity Platform SA email empirically verified** (T1; SC-2C.B.9 per DA v2 G-10 fix).
5. **SIGNUP_REQUEST_FLOW_ACTIVATED flag flipped ON in staging** (per 2c-B spec §11 gate).

**Contingency clause** (F-B5 fix): If Sprint-2b T13 is deferred >14 calendar days past plan v2 approval, escalate to PO for explicit decision: (a) wait, OR (b) ship 2c-B via gate escape-hatch (`gh workflow run sprint-2c-build-gate.yml -f force=true` per merge), with each escape-hatch use justified in PR description and tracked in `.specs/_followups/sprint-2c-b-gate-bypasses.md`. Criterion for selecting (b): demonstrable business impact from continued delay AND documented PO acceptance of weakened ADR-052 lifecycle enforcement.

## G-A9 path-verification (preserved from v1)

Per plan v4 G-A9 fix, the apps/web translation path was annotated `estimated`. Empirical check (2026-05-27):
- `apps/web/src/utils/translate-auth-error.ts` — **does NOT exist**.
- `apps/web/src/lib/api-errors.ts` — **does NOT exist**.
- `apps/web/src/lib/` — **exists** (12 files; canonical lib dir).
- `translateAuthError` lives in **TWO files** (per F-B1 empirical):
  - `apps/web/src/routes/login.tsx:382-406` (signup/login domain: 10 cases incl. `auth/email-already-in-use → "Ya existe una cuenta..."`).
  - `apps/web/src/components/profile/AuthProvidersSection.tsx:598-621` (provider-linking domain: 10 cases incl. `auth/email-already-in-use → "Esa cuenta ya pertenece a otro..."`).

**Decision v2** (F-B1 + F-B2 fixes): T2 narrows scope to login.tsx-only. Extracts `translateAuthError` (login domain) to new module `apps/web/src/lib/translate-auth-error.ts`, extends with `auth/internal-error` + `BLOCKED_SIGNUP_PENDING_APPROVAL` branch. **`AuthProvidersSection.tsx` untouched** — its provider-linking translator is a different domain and unifying both is out-of-scope. New followup `.specs/_followups/translate-auth-error-unify.md` created for future consolidation.

## Tasks

### T1: Pre-flight verification — SA email empirical + ghost user inventory dry-run

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/sa-email-verification.txt` (NEW, ~5 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-dry-run.csv` (NEW, ~variable; CSV).
- **LOC estimate**: ~10.
- **Depends on**: ninguno (read-only ops).
- **Acceptance** (F-B4 fix — exact templates):
  - **SA email verification** — run literal command + commit verbatim output:
    ```bash
    gcloud iam service-accounts list --project=booster-ai-494222 \
      --format='value(email)' | grep -E 'identitytoolkit\.iam\.gserviceaccount\.com$' \
      > .specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/sa-email-verification.txt
    ```
    Then prepend with PO sign-off comment: `# Verified by Felipe Vicencio @ <ISO timestamp> for use in T4 var.identity_platform_sa_email`. SA email is a public identifier in prod logs (NO redaction needed). Commit literal output (single line + comment).
  - **Ghost user inventory dry-run**: run 2c-A T8 script per memory `reference_prod_db_headless_query.md` (gcloud auth ADC + IAP tunnel to db-bastion 5432 + psql). Output CSV with schema `firebaseUid,email,displayName,createdAt,matchingApprovedRequest`. Commit verbatim (emails are not PII per Booster IDOR audit — visible to admins anyway).
- **SC trace**: SC-2C.B.9 (SA email); SC-2C.B.4 partial.
- **Rollback**: revert evidence files.

### T2: Extract translateAuthError (login domain) + T-LITERALS test + ADR-054 path correction

- **Files**:
  - `apps/web/src/lib/translate-auth-error.ts` (NEW, ~50 LOC) — extracted from `login.tsx` verbatim + new `auth/internal-error` branch with `BLOCKED_SIGNUP_PENDING_APPROVAL` substring detection.
  - `apps/web/src/lib/translate-auth-error.test.ts` (NEW, ~60 LOC) — 10 existing-codes tests + new BLOCKED branch + fallback null.
  - `apps/web/src/routes/login.tsx` (MODIFY, ~-25 / +2 LOC) — remove inline function + import.
  - **`apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts`** (NEW, ~30 LOC) — T-LITERALS test reads both files via `fs.readFileSync` (NOT `import`; avoids pulling pg/gcip deps into apps/web).
  - **`docs/adr/054-google-blocking-function-signup-gate.md`** (MODIFY, ~+2 LOC line changes) — F-B2 fix: change `apps/web/src/utils/translate-auth-error.ts` → `apps/web/src/lib/translate-auth-error.ts` in Decision §BLOCKED_CODE-constant + §Notes-for-future-self.
  - `.specs/_followups/translate-auth-error-unify.md` (NEW, ~30 LOC) — F-B1 fix: track future unification of login.tsx + AuthProvidersSection.tsx translators (different domains; consolidation requires UX-copy reconciliation).
- **LOC estimate**: ~175 (**marginal waiver +75 over cap**, justified per F-B1+F-B2: cross-package T-LITERALS contract + ADR-054 path correction + followup tracking lands atomically; splitting would scatter related fixes across PRs).
- **Depends on**: Sprint 2c-A merged ✅.
- **Acceptance**:
  - `translateAuthError(code: string | undefined, message?: string): string | null` exported from new module. **All 10 existing cases preserved verbatim** with their existing Spanish copy.
  - **New branch**: `case 'auth/internal-error':` checks `message?.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')` → returns `'Tu solicitud de registro debe ser aprobada por un administrador antes de poder iniciar sesión. Si ya solicitaste registro, espera la confirmación por email.'`. If message present but doesn't include the literal → return null (fallback to caller default).
  - **`apps/web/src/routes/login.tsx`** removes local function + imports from new module. Two call sites (Google auth catch + form submit catch) keep their `?? 'No pudimos...'` fallback strings unchanged.
  - **`AuthProvidersSection.tsx` untouched** (per F-B1 decision).
  - **T-LITERALS test**: vitest reads `apps/auth-blocking-functions/src/handler.ts` + `apps/web/src/lib/translate-auth-error.ts` via `fs.readFileSync` + asserts BOTH contain literal `BLOCKED_SIGNUP_PENDING_APPROVAL`. Fails on drift. Test location is `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts` (handler workspace owns the literal that drives the contract).
  - **ADR-054 modify**: 2 line edits in §Decision + §Notes-for-future-self changing `utils/` to `lib/`. Diff visible in T2 PR.
  - **Followup file**: stub-only; documents unification intent + linking + provider-link domain rationale.
  - apps/web coverage 80/75/80/80 maintained (existing tests for login.tsx unchanged after extraction).
- **SC trace**: 2c-B §10 T-LITERALS; closes G-A2 + G-A9 obligations.
- **Rollback**: revert files.

### T3: tsup config + cloudbuild deploy step (code only; NO terraform apply)

- **Files**:
  - `apps/auth-blocking-functions/tsup.config.ts` (NEW, ~15 LOC) — cjs format + node20 target + entry src/index.ts + dist output.
  - `cloudbuild.production.yaml` (MODIFY, ~+30 LOC) — new step `deploy-auth-blocking` (build + `gcloud functions deploy beforeCreate --gen2=false --runtime=nodejs20 --source=apps/auth-blocking-functions/dist --entry-point=beforeCreate --region=us-east1 --no-allow-unauthenticated --max-instances=5 --min-instances=0`).
- **LOC estimate**: ~45.
- **Depends on**: T2 merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions build` succeeds locally + produces `dist/index.js` (CommonJS).
  - Cloud Build step idempotent + safe to re-run.
  - **DA v2 G-03 atomic deploy**: step exits non-zero if post-deploy `gcloud functions describe` returns missing `sourceArchiveUrl` (T7 script).
  - Cloud Build YAML lint pass.
- **SC trace**: SC-2C.B.10 partial.

### T4: infrastructure/auth-blocking-functions.tf — Cloud Function Gen 1 resource (gated)

- **Files**:
  - `infrastructure/auth-blocking-functions.tf` (NEW, ~65 LOC; +5 over v1 for inline comment per F-B9).
- **LOC estimate**: ~65.
- **Depends on**: T1 (SA email verified) + T3 merged.
- **Acceptance**:
  - `google_cloudfunctions_function.before_create` with `runtime=nodejs20`, `available_memory_mb=256`, `timeout=60`, `entry_point=beforeCreate`, `region=us-east1`, `min_instances=0`, `max_instances=5`.
  - `lifecycle.ignore_changes = [source_archive_object, source_archive_bucket]` — Cloud Build manages source.
  - **F-B9 fix**: comment block at top of file explicitly explains source-artifact lifecycle:
    ```hcl
    # NOTE: Function source is managed by Cloud Build deploy step
    # `deploy-auth-blocking` in cloudbuild.production.yaml (T3). The
    # first `terraform apply` creates the function shell with no
    # source; immediately after, run the Cloud Build trigger to
    # populate dist/index.js. Without Cloud Build deploy, the function
    # exists in API/console but has no executable code. Verification
    # via apps/api/scripts/check-cloud-function-deployed.ts (T7).
    ```
  - IAM binding `google_cloudfunctions_function_iam_member.idp_invoker` granting `roles/cloudfunctions.invoker` to SA from T1 (variable, NOT hardcoded).
  - `terraform validate` + `terraform plan` pass.
  - **NOTE**: Terraform apply is T8 (operational).
- **SC trace**: SC-2C.B.1 partial.

### T5: infrastructure/identity-platform.tf — wire blocking_functions + REMOVE lifecycle.ignore_changes (F-B3 fix)

- **Files**:
  - `infrastructure/identity-platform.tf` (MODIFY, ~+17 / -1 LOC) — F-B3 fix.
- **LOC estimate**: ~25.
- **Depends on**: T4 merged.
- **Acceptance**:
  - **F-B3 critical fix**: **REMOVE `blocking_functions,` from `lifecycle.ignore_changes` (existing line 71)** BEFORE adding the new block. Without this removal, terraform silently no-ops the new `blocking_functions` block.
  - Add `blocking_functions { triggers { event_type = "beforeCreate"; function_uri = google_cloudfunctions_function.before_create.https_trigger_url } }` block referencing T4 resource via Terraform interpolation (NOT hardcoded URL).
  - `terraform plan` shows expected diff: removal of `blocking_functions` from ignore_changes + 1 in-place update on `google_identity_platform_config.default.blocking_functions`.
  - PR description explicitly calls out the `lifecycle.ignore_changes` removal as load-bearing (reviewer must verify).
- **SC trace**: SC-2C.B.1.

### T6: docs/qa/google-blocking-function-runbook.md — operational runbook

- **Files**:
  - `docs/qa/google-blocking-function-runbook.md` (NEW, ~130 LOC).
- **LOC estimate**: ~130 (**marginal +30**, justified: consolidated operational reference for T8/T9/T11/T12b).
- **Depends on**: T5 merged.
- **Acceptance**:
  - **§Pre-deploy checklist**: ADR-052 Accepted? SA email verified (T1)? Ghost user inventory dry-run reviewed (T1)? SIGNUP_REQUEST_FLOW_ACTIVATED ON in staging?
  - **§Deploy procedure** (F-B9 fix — four-step sequence with copy-pasteable commands):
    1. `cd infrastructure && terraform apply -target=google_cloudfunctions_function.before_create -target=google_cloudfunctions_function_iam_member.idp_invoker` → creates function shell with no source.
    2. Trigger Cloud Build via `gcloud builds submit --config=cloudbuild.production.yaml --substitutions=...` OR PO clicks `Run` in Cloud Build console → executes `deploy-auth-blocking` step + populates source.
    3. `pnpm --filter @booster-ai/api exec tsx scripts/check-cloud-function-deployed.ts` (T7) → asserts `sourceArchiveUrl` non-empty + `status === 'ACTIVE'`. Exit non-zero blocks step 4.
    4. `terraform apply -target=google_identity_platform_config.default` → applies T5 wire to `blocking_functions`.
  - **§Rollback steps**:
    - **Step 1 (5-min undo)**: `gcloud identity-toolkit config update --project=booster-ai-494222 --no-blocking-functions` (or Admin API `PATCH /v2/projects/.../config` with `updateMask=blockingFunctions` body `{}`).
    - **Step 2 (Terraform revert)**: revert wire commit + `terraform apply`.
    - **Step 3 (Function destroy)**: `terraform destroy -target=google_cloudfunctions_function.before_create`.
    - **Step 4 (Ghost user cleanup revert)**: restore disabled users via `auth.updateUser(uid, {disabled: false})` per CSV row.
  - **§7d-watch semantics** (F-B8 fix): T-WIRE-PROD-APPLY timestamp recorded once at first apply. Re-apply events documented in `T-WIRE-PROD-APPLY-amendments.md` (committed alongside daily log). Format per amendment:
    ```markdown
    ## Re-apply event YYYY-MM-DDTHH:MM:SSZ
    Reason: <free-form>
    Decision: continue clock | reset clock
    Rationale: <why>
    PO: <name>
    ```
  - **§Emulator manual run procedure**: copy from 2c-A T9a doc-comment.
  - **§Smoke E2E procedure**: negative + positive cases with copy-pasteable steps.
  - **§Ghost user cleanup procedure**: per-decision-type commands.
  - **§Performance regression procedure** (F-B7 fix): if T10 p95 fails, classify by traffic rate (<2/day vs >10/day) and decide re-measure-vs-escalate per documented rule.
  - **§Escape-hatch**: `gh workflow run sprint-2c-build-gate.yml -f force=true` (2c-A T2b) + `gh workflow run sprint-2c-b-deploy-gate.yml -f force=true` (T7b NEW) + when to use.
- **SC trace**: SC-2C.B.10 documentation.

### T7: Atomic deploy verification script + tests (post-deploy verification only)

- **Files**:
  - `apps/api/scripts/check-cloud-function-deployed.ts` (NEW, ~50 LOC).
  - `apps/api/test/scripts/check-cloud-function-deployed.test.ts` (NEW, ~50 LOC) — 4 fixture tests (active deploy → exit 0; missing sourceArchiveUrl → exit 1; status DEPLOY_IN_PROGRESS → exit 1; gcloud absent → exit 1).
- **LOC estimate**: ~100.
- **Depends on**: T3 merged.
- **Acceptance** (F-B3 honest framing):
  - Script invokes `gcloud functions describe beforeCreate --region=us-east1 --format=json` + asserts `sourceArchiveUrl` non-empty + `status === 'ACTIVE'`.
  - **Mechanical scope** documented in script doc-comment: "**Post-deploy verification of the Cloud Function ARTIFACT only.** NOT an inter-apply ordering gate — that is enforced by PO discipline in T6 runbook §Deploy procedure step 3, plus T7b workflow path-filter on identity-platform.tf modifications."
  - Tests with mocked `child_process.execSync`.
- **SC trace**: SC-2C.B.10 mechanical scope.

### T7b: Inter-apply deploy-gate CI workflow (F-B3 mechanical enforcement upgrade)

- **Files**:
  - `.github/workflows/sprint-2c-b-deploy-gate.yml` (NEW, ~50 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T7 merged.
- **Acceptance** (F-B3 fix — converts honor-system to mechanical):
  - Workflow `on.pull_request.paths` fires when PR touches `infrastructure/identity-platform.tf` (specifically when diff includes the literal `blocking_functions {` — verified by grep step).
  - Workflow step `check-function-deployed-in-prod`: requires `GCP_SA_KEY` GitHub secret (already configured for staging E2E); authenticates `gcloud` + runs `apps/api/scripts/check-cloud-function-deployed.ts` against prod. If exit 1 → workflow fails → PR cannot merge.
  - `workflow_dispatch` with `force=true` escape-hatch (documented in T6 runbook).
  - YAML comment explicitly states scope: "Fires on PRs that wire `blocking_functions`; ensures the function exists + is ACTIVE in prod BEFORE the wire can merge. Mechanical enforcement of DA v2 G-03 atomic deploy contract (formerly runbook honor-system)."
- **SC trace**: SC-2C.B.10 mechanical upgrade per F-B3.

### T8: Terraform apply (T4 + T5 — operational task; evidence committed)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/terraform-apply-T8.log` (NEW, sanitized; ~20 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY.txt` (NEW, ~3 LOC).
- **LOC estimate**: ~25.
- **Depends on**: T4 + T5 + T6 + T7 + T7b merged + ADR-052 Status flip Accepted + SIGNUP_REQUEST_FLOW_ACTIVATED ON.
- **Acceptance** (F-B4 fix — exact templates):
  - **`terraform-apply-T8.log` sanitization procedure**: commit ONLY the final summary block (not full log):
    ```text
    Plan: <N> to add, <M> to change, 0 to destroy.
    Resources: <list of resource addresses>
    Applied successfully @ <ISO timestamp> by <actor email>
    Cloud Build run ID: <ID>
    ```
    Rationale: full terraform log contains state-token query parameters + access tokens. Summary block is auditable without leak risk.
  - **`T-WIRE-PROD-APPLY.txt`** content (single source-of-truth for F-B8 clock anchor):
    ```text
    T-WIRE-PROD-APPLY: <ISO 8601 timestamp UTC>
    Applied by: <actor email>
    Terraform apply run: <Cloud Build run ID>
    Notes: <any deviation from runbook §Deploy procedure>
    ```
  - **Atomic ordering**: 4 steps per T6 runbook §Deploy procedure (T4 apply → Cloud Build → T7 verify → T5 apply). T7b workflow enforces step 4 cannot merge until step 3 verifies.
- **SC trace**: SC-2C.B.1 + SC-2C.B.10 complete.

### T9: Smoke E2E negative + positive (operational; evidence committed)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-negative.md` (NEW, ~20 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-positive.md` (NEW, ~20 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-*.png` (optional screenshots; 2-4 files committed).
- **LOC estimate**: ~40 + screenshot bytes.
- **Depends on**: T8 applied.
- **Acceptance** (F-B4 fix — exact template):
  - Each smoke .md starts with YAML front-matter:
    ```yaml
    ---
    environment: prod
    firebase_project: booster-ai-494222
    tester: <name>
    tester_email_redacted: <sha256-first-16-chars>
    timestamp: <ISO 8601 UTC>
    git_sha_at_test: <sha of main at smoke run time>
    ---
    ```
    Body: step-by-step actions + assertions + screenshot references + final outcome.
  - **Negative case**: cuenta Google ad-hoc sin matching aprobado → `signInWithPopup` falla → UI message contains "Tu solicitud de registro debe ser aprobada".
  - **Positive case**: `dev@boosterchile.com` (per OQ-2C-B-1 resolved) con matching `solicitudes_registro.aprobado` row pre-created → signup succeeds + redirect to dashboard.
  - Per DA v2 G-06: positive uses corporate domain (NO `@gmail.com`).
- **SC trace**: SC-2C.B.2 + SC-2C.B.3.

### T10: Production perf smoke script + first measurement (F-B7 fix — cold-start aware)

- **Files**:
  - `apps/auth-blocking-functions/scripts/prod-perf-measure.ts` (NEW, ~50 LOC; +10 for cold-start handling per F-B7).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/prod-perf-measure-<ISO>.json` (NEW, ~25 LOC).
- **LOC estimate**: ~75.
- **Depends on**: T8 applied + at least 1 Google signup attempt post-wire.
- **Acceptance** (F-B7 fix):
  - Script pulls Cloud Monitoring metrics (`metric.type=cloudfunctions.googleapis.com/function/execution_times` + `function_name=beforeCreate`).
  - **Cold-start handling**: discard the first invocation post-deploy as warm-up. Report two p95 values:
    - `p95_warmed` (excludes invocation 1) — bar **1500 ms** per SC-2C.B.5.
    - `p95_with_cold_start` (includes invocation 1) — bar **3500 ms** (reality of Gen 1 + min_instances=0).
  - **OR-clause preserved** (DA v2 G-04 fix): assert against (a) first 10 warmed invocations OR (b) 7-day window post-T-WIRE-PROD-APPLY, whichever comes first.
  - Script doc-comment acknowledges: "min_instances=0 means most invocations are cold-starts at Booster's expected <10/month rate; bar interpretation depends on this. PO decision per F-B11: if p95_warmed > 5000 ms → amend T4 .tf to min_instances=1 within 7 days BEFORE T13 ADR-054 flip."
  - **Regression escalation** (per T6 runbook §Performance regression): traffic <2/day + p95 fails → re-measure 24h. Traffic >10/day + p95 fails 3 consecutive days → PO escalation.
- **SC trace**: SC-2C.B.5 + SC-2C.B.6.

### T11: Ghost user inventory execution + CSV + PO cleanup decision

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-T11-<ISO>.csv` (NEW, ~variable LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/po-cleanup-decision.md` (NEW, ~35 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T8 applied.
- **Acceptance** (F-B4 fix — exact template):
  - 2c-A T8 script re-executed against prod post-wire.
  - **CSV schema** (extends 2c-A T8 by adding decision column):
    ```csv
    firebaseUid,email,displayName,createdAt,matchingApprovedRequest,decision,decisionDate,decisionActor
    "<uid>","<email>","<displayName>","<createdAt>",<bool>,<a|b|c>,<ISO>,<actor>
    ```
    where `decision` is:
    - `a` = leave alone (no matching aprobado; user already locked out post-wire).
    - `b` = disable via `auth.updateUser(uid, {disabled: true})`.
    - `c` = email user with re-onboarding instructions (manual outreach).
  - **`po-cleanup-decision.md` template**:
    ```markdown
    # PO cleanup decision — Sprint 2c-B ghost users
    Generated: <ISO>
    PO: <name>
    Total ghosts: <N>
    Decisions: <count by type a/b/c>
    
    ## Rationale per decision type
    - a (leave alone): <free-form>
    - b (disable): <free-form>
    - c (email): <free-form>
    
    ## auth.updateUser invocations log (for decision=b)
    <command output, one block per UID>
    
    ## Outreach log (for decision=c)
    <email send confirmations, one block per UID>
    ```
- **SC trace**: SC-2C.B.4.

### T12a: Monitoring infra apply (BEFORE T8 — defense-in-depth day-0 alerts, F-B6 fix)

- **Files**:
  - `infrastructure/auth-blocking-functions-monitoring.tf` (NEW, ~50 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T7b merged.
- **Acceptance**:
  - `google_monitoring_alert_policy` for 3-sigma rate on `signup.blocked.google` log metric.
  - `google_monitoring_uptime_check_config` synthetic for Cloud Function reachability.
  - **Applied BEFORE T8** so alerts exist on day 0. Sequence documented in T6 runbook §Deploy preflight: "Apply monitoring (T12a) before function deploy (T8) — alerts must precede signups."
  - `terraform validate` + `terraform plan` pass.
- **SC trace**: SC-2C.B.6 partial (infra defined).

### T12b: 7-day watch log + verification script (F-B8 mechanical fix)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/7day-watch-log.md` (NEW, ~35 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY-amendments.md` (NEW only if re-apply occurs; ~variable).
  - `apps/api/scripts/check-7d-watch-log.ts` (NEW, ~40 LOC) — F-B8 mechanical fix.
  - `apps/api/test/scripts/check-7d-watch-log.test.ts` (NEW, ~40 LOC).
- **LOC estimate**: ~115 (**marginal waiver +15**, justified F-B8 fix converts honor-system to mechanical script + tests).
- **Depends on**: T8 applied + T-WIRE-PROD-APPLY anchor committed + T12a monitoring active.
- **Acceptance**:
  - **`7day-watch-log.md` template** (one entry per day):
    ```markdown
    # 7-day watch log — Sprint 2c-B
    T-WIRE-PROD-APPLY: <ISO from T8 evidence>
    Watch period: T-WIRE → T-WIRE + 7 days
    
    ## Day 1 (<ISO date>)
    - Blocked signup count (24h): <N>
    - Baseline rate (rolling): <X>
    - 3-sigma threshold: <Y>
    - Alert firings: <0 | list of incidents>
    - p95 latency (24h): <ms>
    - Anomalies: <free-form or "none">
    - Reviewer: <name>
    
    ## Day 2 ... Day 7 (same shape)
    ```
  - **`check-7d-watch-log.ts`** asserts: (a) exactly 7 dated entries; (b) entries' dates form contiguous T-WIRE → T-WIRE+7d sequence; (c) any 48h+ gap explicitly noted as "GAP — extended by N days" entry; (d) T-WIRE-PROD-APPLY-amendments.md exists if `git log --grep="re-apply"` shows commits between T-WIRE and now. Exit non-zero on violations. Run at T13 pre-flip as gate.
  - SC-2C.B.7 closure: average < 1 blocked Google signup/day + 0 alert firings.
  - **DA v2 G-09 fix preserved**: T-WIRE-PROD-APPLY timestamp recorded once at T8; subsequent re-applies create entries in `T-WIRE-PROD-APPLY-amendments.md` with explicit "continue clock | reset clock" decision.
- **SC trace**: SC-2C.B.6 + SC-2C.B.7.

### T13: ADR-054 Status flip Proposed → Accepted (separate commit per ADR pattern)

- **Files**:
  - `docs/adr/054-google-blocking-function-signup-gate.md` (MODIFY, ~+1 LOC line 3 ONLY).
- **LOC estimate**: ~2.
- **Depends on**: T12b 7-day watch passed + `check-7d-watch-log.ts` exit 0.
- **Acceptance**:
  - Single-purpose commit: `docs(adr-054): Accepted post-7d-watch cloudbuild run <ID>`.
  - Status line: `- **Status**: Accepted (post-7d-watch cloudbuild run <ID>)`.
  - **Note**: 2c-B path-gate continues requiring ADR-052 (gate script unchanged). ADR-054 flip is documentary closure for ADR-054 lifecycle; mechanical enforcement of ADR-054 NOT introduced (decision deferred to future amendment if pattern recurs).
- **SC trace**: SC-2C.B.7 closure.

### T14: Gate teardown + CURRENT.md + sec-001-cierre transition → SEC-001 H1.2 CERRADO (F-B5 fix)

- **Files**:
  - **`.github/workflows/sprint-2c-build-gate.yml`** (DELETE) — F-B5 fix; gate no longer needed post-CERRADO.
  - **`.github/workflows/sprint-2c-b-deploy-gate.yml`** (DELETE) — same rationale.
  - `apps/api/scripts/check-adr-status-accepted.ts` + `.test.ts` (DELETE) — gate script no longer wired; archive intent documented in T14 PR description.
  - `apps/api/scripts/check-handler-completeness.ts` + `.test.ts` (DELETE) — same.
  - `apps/api/scripts/check-cloud-function-deployed.ts` + `.test.ts` (DELETE if not reused elsewhere — verify).
  - `apps/api/scripts/check-7d-watch-log.ts` + `.test.ts` (DELETE — one-shot script).
  - `.github/workflows/sprint-2c-handler-completeness.yml` (DELETE) — F-B5 fix.
  - `docs/handoff/CURRENT.md` (MODIFY, ~+30 LOC) — section "Sprint 2c-B SHIPPED + H1.2 CERRADO".
  - `.specs/sec-001-cierre/spec.md` (MODIFY, ~+5 LOC §3 H1.2) — amendment A4: `SC-1.2.2 Google leg TRACKED_RESIDUAL → MET 2026-MM-DD via Sprint 2c-A + 2c-B`.
  - `.specs/_followups/sprint-2c-google-blocking-function.md` (MOVE to `.specs/_archive/`).
  - **Branch protection update** (PO command in PR description):
    ```bash
    gh api -X PATCH repos/boosterchile/booster-ai/branches/main/protection \
      --field 'required_status_checks[contexts][]=-Sprint 2c-B build gate (ADR-052 Accepted)' \
      --field 'required_status_checks[contexts][]=-Sprint 2c-B handler-completeness smoke (T4-state regression guard)' \
      --field 'required_status_checks[contexts][]=-Sprint 2c-B deploy gate'
    ```
- **LOC estimate**: ~50 LOC net (deletions + modifications).
- **Depends on**: T13 merged.
- **Acceptance**:
  - All 3 sprint-2c-*.yml workflows deleted (no longer needed post-CERRADO).
  - All 4 helper scripts deleted (one-shot or gate-only purpose).
  - Branch protection rules updated (PO command in PR description; PO executes post-merge).
  - CURRENT.md captures Sprint 2c-B closure summary + links to evidence dir.
  - sec-001-cierre amendment A4 records SC-1.2.2 transition.
  - Followup stub archived (signals SEC-001 H1.2 closure).
  - **End of SEC-001 H1.2.**
- **SC trace**: parent spec sec-001-cierre §3 H1.2 closure.
- **Rollback**: revert deletions if regression discovered post-CERRADO.

## Out-of-band tasks (post-T14)

- **Memory file update**: lessons-learned from Sprint 2c-B (cross-workspace test pattern + atomic deploy mechanical enforcement + 7d-watch automation script). **Owner**: Claude (post-T14).
- **Castellanizar ADR-052/053/054**: now unblocked. Execute coordinated batch per `.specs/_followups/castellanizar-adr-headers.md` §"Exclusiones / coordinación con Sprint 2c". **Owner**: PO.
- **translate-auth-error unification**: see `.specs/_followups/translate-auth-error-unify.md` (created en T2). **Owner**: PO future sprint.

## Open questions

- **OQ-2C-B-1** (corporate Booster-domain for positive smoke): **resolved** — `dev@boosterchile.com`.
- **OQ-2C-B-2** (Cloud Functions Gen 1 `min_instances` decision): **deferred-decision** (F-B11 fix) — `min_instances=0` selected at T3 to minimize cost; **contingent rule**: if T10 `p95_warmed` > 5000 ms, PO commits to amend T4 .tf to `min_instances=1` within 7 days BEFORE T13 ADR-054 flip.
- **OQ-2C-B-3** (SA email exact pattern): **resolved in T1**.

## Alternatives considered (plan-level)

(Same as v1 plus:)

### Alt-2c-B-Plan-VI (NEW): Unify both translateAuthError functions in T2

**Rejected** (F-B1): different domains (login vs provider-linking) with different Spanish copy for overlapping codes. Forcing unification requires UX-copy reconciliation that is out-of-scope for 2c-B. Tracked as followup `translate-auth-error-unify.md`.

### Alt-2c-B-Plan-VII (NEW): Strengthen ADR-052 Status check to also require ADR-054 Accepted

**Considered seriously per F-B5**: would convert ADR-054 flip from documentary to mechanical. **Rejected**: T14 teardown of the entire gate ecosystem (workflows + scripts) is cleaner closure. ADR-054 lifecycle weak enforcement is acceptable trade-off — future ADR cycles can adopt stronger patterns if needed.

### Alt-2c-B-Plan-VIII (NEW): Roll T12a (monitoring infra) into T8 single apply

**Considered seriously per F-B6**: simpler operationally. **Rejected**: keeps T12a as a separate dep so monitoring infra can land + apply BEFORE T4/T5 deploy + IdP wire. Defense-in-depth: alerts exist day 0.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices.
- [x] All tasks ≤ 100 LOC OR waiver logged with genuine justification: T2 (175 marginal+75 cross-package T-LITERALS + ADR-054 path correction + followup atomic), T6 (130 marginal+30 consolidated runbook), T12b (115 marginal+15 F-B8 mechanical script + tests).
- [x] Acceptance traces to 2c-B spec §3 SC o §10 test per task.
- [x] Rollback plan for each task.
- [x] DA v1 findings F-B1..F-B12 each have explicit fix in v2 per §"What changed v1 → v2" table.
- [ ] DA v2 pass output captured: PENDING (this DA pass).
- [ ] User approval: PENDING (user approval after DA).

## Total estimate v2

| Métrica | Valor |
|---|---|
| Tareas | **16** (T1, T2, T3, T4, T5, T6, T7, T7b, T8, T9, T10, T11, T12a, T12b, T13, T14) |
| LOC total estimate code | ~750 cross-stack |
| LOC total estimate evidence | ~variable |
| Tareas con waiver >100 LOC | 3 marginal (T2=175, T6=130, T12b=115) |
| **PO active hours** | ~3-5 días (excluding 7-day watch wait) |
| **Wall-clock elapsed** | ≥ 9-12 días (PRs T1-T12a + T7b + 7-day watch + T12b log entries + T13/T14 close) |

**G-14 threshold** (≥15 task split): 16 tasks > 15. Per umbrella pattern, this would normally trigger further split. **Conscious waiver** for v2: the operational tasks (T1, T8, T9, T11) are evidence-only PRs (small, sequential, not full feature work); the code tasks (T2-T7b, T10, T12a-b, T13-14) form a coherent deploy + verify + close arc. Splitting again would scatter related operational deliverables across more sub-sprints without benefit. Documented for DA pass v2 to scrutinize.

## Decision log

- **2026-05-27 16:55Z** — /plan 2c-B phase entered.
- **2026-05-27 17:30Z** — Plan v1 drafted. DA v1 pass: REVISE (5 P0 + 4 P1 + 3 P2; F-B1..F-B12). Plan v1 preserved as `plan-v1.md`.
- **2026-05-27 18:00Z** — Plan v2 drafted addressing all 12 findings per §"What changed v1 → v2" table. Status: Draft v2 awaiting DA v2 pass + user approval.
