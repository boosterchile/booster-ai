# Plan: sec-001-h1-2-google-blocking-b (Sprint 2c-B — deployment + IdP wire + 7d watch + ADR Accepted)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec)
- **Created**: 2026-05-27 (v3)
- **Status**: **Approved** (PO 2026-05-27 post-DA v4 ACCEPT_WITH_RESIDUAL; 1 P2 residual accepted)
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history (cumulative): [`./plan-review.md`](./plan-review.md) (v1: F-B1..F-B12 5P0+4P1+3P2 → v2: N-B1..N-B5 2P0+3P1 → v3: N-B6+N-B7 2P0).
  - Plan v1 (INVALIDATED): [`./plan-v1.md`](./plan-v1.md).
  - Plan v2 (INVALIDATED): [`./plan-v2.md`](./plan-v2.md).
  - Plan v3 (INVALIDATED): [`./plan-v3.md`](./plan-v3.md).
  - Plan-a DA history: [`../sec-001-h1-2-google-blocking-a/plan-review.md`](../sec-001-h1-2-google-blocking-a/plan-review.md).
  - Sibling: [`../sec-001-h1-2-google-blocking-a/spec.md`](../sec-001-h1-2-google-blocking-a/spec.md) (**shipped 14/14 to main**).
  - ADR-054: [`../../docs/adr/054-google-blocking-function-signup-gate.md`](../../docs/adr/054-google-blocking-function-signup-gate.md).
  - Castellanizar followup: [`../_followups/castellanizar-adr-headers.md`](../_followups/castellanizar-adr-headers.md).

## What changed v3 → v4

| Finding | Fix in v4 |
|---|---|
| **N-B6** (DA v3) `roles/cloudfunctions.viewer` not in `local.github_deployer_roles`; T7b had no terraform deliverable | T7b §Files now includes **`infrastructure/iam.tf` MODIFY** — add `roles/cloudfunctions.viewer` to `local.github_deployer_roles` list (line ~173-187). Same atomic PR as the workflow ships. Verification: `terraform plan` shows 1 new IAM binding before T7b merges. |
| **N-B7** (DA v3) T14a Step 3 `--field-from-file` is not a real `gh api` flag | T14a Step 3 replaced with **stdin-piped JSON** pattern: `jq -n --argjson contexts "$(cat after.txt)" '{strict: true, contexts: $contexts}' \| gh api -X PUT repos/boosterchile/booster-ai/branches/main/protection/required_status_checks --input -`. Standard `gh api --input -` reads JSON from stdin. Verified syntactically. |

## What changed v2 → v3

| Finding | Fix in v3 |
|---|---|
| **N-B1** T7b workflow uses fictional `GCP_SA_KEY` secret | T7b workflow now uses **Workload Identity Federation** per `release.yml` precedent: `permissions: id-token: write` + `google-github-actions/auth@v2` con `workload_identity_provider: ${{ vars.WIF_PROVIDER }}` + `service_account: ${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}`. Acceptance también verifica que ese SA tenga `roles/cloudfunctions.viewer` (IAM grant via terraform en T7b o documented out-of-band si ya existe). |
| **N-B2** T14 mass-deletion bundles too much | **Split into T14a + T14b + T14c**: T14a = operational branch-protection PATCH evidence file (PO out-of-band command + evidence committed). T14b = workflow + script deletions (depends on T14a evidence committed; atomic + rollback-safe). T14c = CURRENT.md + sec-001-cierre amendment + followup archive (low-risk docs closure). Sequence prevents phantom required-context lockout. |
| **N-B3** T8 missing T12a dep | T8 §Depends-on now explicitly lists `+ T12a applied (monitoring infra evidence committed)`. |
| **N-B4** OQ-2C-B-2 day-5 scenario undefined | T6 runbook §Performance regression enumerates explicit day-5 scenario procedure: (1) commit min_instances=1 amendment within 24h, (2) re-apply (does NOT reset 7d-watch — config-only change), (3) re-measure at +48h, (4) if still failing → escalate + delay T13. |
| **N-B5** T2 multi-deliverable PR (nit) | T2 kept atomic; PR description **must** include structured reviewer checklist mapping each of the 4 deliverables (extract / ADR-054 / cross-source-test / followup) to a reviewer-acceptance line. Documented in T2 acceptance. |

## Pre-conditions a `/build`

Sprint 2c-B `/build` gated por ALL of:

1. **Plan v3 approved** (this document) + DA v3 pass.
2. **Sprint 2c-A merged a `main`** ✅ (last commit `22132a1`).
3. **ADR-052 Status flip Accepted** ⏸ — gated by Sprint-2b T13 canary deploy 30 min success + 2 h watch.
4. **Identity Platform SA email empirically verified** (T1).
5. **SIGNUP_REQUEST_FLOW_ACTIVATED flag flipped ON in staging**.
6. **WIF_SERVICE_ACCOUNT_DEPLOY has `roles/cloudfunctions.viewer`** on `booster-ai-494222` (T7b N-B1 fix; verify pre-T7b apply).

**Contingency clause**: If Sprint-2b T13 is deferred >14 calendar days past plan v3 approval, escalate to PO for explicit decision: (a) wait, OR (b) ship 2c-B via gate escape-hatch (`gh workflow run sprint-2c-build-gate.yml -f force=true`), with each use justified in PR description and tracked in `.specs/_followups/sprint-2c-b-gate-bypasses.md`.

## G-A9 path-verification (preserved from v1/v2)

- `apps/web/src/utils/translate-auth-error.ts` — does NOT exist.
- `apps/web/src/lib/api-errors.ts` — does NOT exist.
- `apps/web/src/lib/` — exists (12 files; canonical lib dir).
- `translateAuthError` lives in **TWO files**:
  - `apps/web/src/routes/login.tsx:382-406` (signup/login domain).
  - `apps/web/src/components/profile/AuthProvidersSection.tsx:598-621` (provider-linking domain; **untouched** in 2c-B).

**Decision**: T2 narrows scope to login.tsx-only. Extracts to new module + extends with `auth/internal-error` branch. AuthProvidersSection.tsx untouched — unification deferred to `.specs/_followups/translate-auth-error-unify.md`.

## Tasks

### T1: Pre-flight verification — SA email empirical + ghost user inventory dry-run

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/sa-email-verification.txt` (NEW, ~5 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-dry-run.csv` (NEW, variable).
- **LOC estimate**: ~10.
- **Depends on**: ninguno (read-only ops).
- **Acceptance**:
  - **SA email verification** — literal command + commit verbatim:
    ```bash
    gcloud iam service-accounts list --project=booster-ai-494222 \
      --format='value(email)' | grep -E 'identitytoolkit\.iam\.gserviceaccount\.com$' \
      > .specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/sa-email-verification.txt
    ```
    Prepend PO sign-off: `# Verified by Felipe Vicencio @ <ISO> for use in T4 var.identity_platform_sa_email`.
  - **Ghost user inventory dry-run**: 2c-A T8 script per memory `reference_prod_db_headless_query.md`. CSV verbatim.
- **SC trace**: SC-2C.B.9 + SC-2C.B.4 partial.

### T2: Extract translateAuthError (login domain) + T-LITERALS test + ADR-054 path correction

- **Files**:
  - `apps/web/src/lib/translate-auth-error.ts` (NEW, ~50 LOC).
  - `apps/web/src/lib/translate-auth-error.test.ts` (NEW, ~60 LOC).
  - `apps/web/src/routes/login.tsx` (MODIFY, ~-25/+2 LOC).
  - `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts` (NEW, ~30 LOC).
  - `docs/adr/054-google-blocking-function-signup-gate.md` (MODIFY, ~+2 LOC).
  - `.specs/_followups/translate-auth-error-unify.md` (NEW, ~30 LOC).
- **LOC estimate**: ~175 (**marginal +75 waiver**, justified: cross-package T-LITERALS contract + ADR-054 path correction + followup tracking lands atomically).
- **Depends on**: Sprint 2c-A merged ✅.
- **Acceptance**:
  - `translateAuthError(code, message?): string | null` exported. All 10 existing cases preserved verbatim.
  - New `auth/internal-error` branch: `message?.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')` → returns BLOCKED user message.
  - `login.tsx` imports from new module; AuthProvidersSection.tsx untouched.
  - T-LITERALS test reads handler.ts + translate-auth-error.ts via `fs.readFileSync`, asserts both contain `BLOCKED_SIGNUP_PENDING_APPROVAL`.
  - ADR-054 modify: 2 line edits (`utils/` → `lib/`) in Decision + Notes-for-future-self.
  - Followup stub documents unification intent.
  - **N-B5 fix**: PR description **must** include reviewer checklist:
    ```markdown
    ## Reviewer acceptance checklist (per T2 multi-deliverable PR contract)
    - [ ] (1) apps/web extraction: function moved verbatim; all 10 existing cases preserved; new auth/internal-error branch correct
    - [ ] (2) ADR-054 path correction: utils/ → lib/ in Decision + Notes-for-future-self
    - [ ] (3) T-LITERALS test: fs.readFileSync over both files; assertion catches drift
    - [ ] (4) Followup stub: scope + rationale documented
    ```
  - apps/web coverage 80/75/80/80 maintained.
- **SC trace**: 2c-B §10 T-LITERALS; closes G-A2 + G-A9.

### T3: tsup config + cloudbuild deploy step (code only)

- **Files**:
  - `apps/auth-blocking-functions/tsup.config.ts` (NEW, ~15 LOC).
  - `cloudbuild.production.yaml` (MODIFY, ~+30 LOC).
- **LOC estimate**: ~45.
- **Depends on**: T2 merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions build` produces `dist/index.js` (cjs).
  - Cloud Build step idempotent; exit non-zero if post-deploy `gcloud functions describe` returns missing `sourceArchiveUrl`.

### T4: infrastructure/auth-blocking-functions.tf — Cloud Function Gen 1 resource

- **Files**: `infrastructure/auth-blocking-functions.tf` (NEW, ~65 LOC).
- **LOC estimate**: ~65.
- **Depends on**: T1 + T3 merged.
- **Acceptance**:
  - `google_cloudfunctions_function.before_create`: runtime=nodejs20, memory=256MB, timeout=60, entry_point=beforeCreate, region=us-east1, min_instances=0, max_instances=5.
  - `lifecycle.ignore_changes = [source_archive_object, source_archive_bucket]`.
  - Inline comment per F-B9: function source managed by Cloud Build deploy step.
  - IAM binding to SA from T1 (var-parameterized).
  - `terraform validate` + `terraform plan` pass.

### T5: infrastructure/identity-platform.tf — wire blocking_functions + REMOVE lifecycle.ignore_changes (F-B3 fix)

- **Files**: `infrastructure/identity-platform.tf` (MODIFY, ~+17/-1 LOC).
- **LOC estimate**: ~25.
- **Depends on**: T4 merged.
- **Acceptance**:
  - **CRITICAL F-B3 fix**: REMOVE `blocking_functions,` from `lifecycle.ignore_changes` (existing line 71) BEFORE adding new block.
  - Add `blocking_functions { triggers { ... function_uri = google_cloudfunctions_function.before_create.https_trigger_url } }` referencing T4 resource.
  - `terraform plan` shows expected diff (ignore_changes removal + in-place update on blocking_functions).
  - PR description calls out the `lifecycle.ignore_changes` removal as load-bearing.

### T6: docs/qa/google-blocking-function-runbook.md — operational runbook (with N-B4 day-5 scenario)

- **Files**: `docs/qa/google-blocking-function-runbook.md` (NEW, ~135 LOC).
- **LOC estimate**: ~135 (**marginal +35**, justified consolidated runbook).
- **Depends on**: T5 merged.
- **Acceptance**:
  - **§Pre-deploy checklist**: ADR-052 Accepted? SA email verified? Ghost dry-run reviewed? SIGNUP_REQUEST_FLOW_ACTIVATED ON staging?
  - **§Deploy procedure** (F-B9 fix): 4-step sequence per T6 prior.
  - **§Rollback steps**: 4 steps per umbrella §11.
  - **§7d-watch semantics** (F-B8 fix): T-WIRE-PROD-APPLY-amendments.md format.
  - **§Performance regression — day-5 scenario** (N-B4 fix):
    ```markdown
    ### Scenario: T10 measurement at day N (N ∈ {3..7}) finds p95_warmed > 5000ms

    Per OQ-2C-B-2 contingent rule:

    1. **Within 24h** of T10 finding: commit min_instances=1 amendment to
       `infrastructure/auth-blocking-functions.tf` (T4) via dedicated PR.
       PR title: `fix(auth-blocking-functions): bump min_instances=1
       post-T10-regression (Sprint 2c-B day-N)`.
    2. **Re-apply terraform** with `-target=google_cloudfunctions_function
       .before_create` only. **Per §7d-watch-semantics this is a
       config-only change, NOT a "re-wire" event — clock does NOT reset.**
    3. **Re-measure perf at +48h** via T10 script. Output committed as
       `prod-perf-measure-<ISO>-after-min-instances-fix.json`.
    4. If re-measurement passes (p95_warmed < 1500ms): continue 7d-watch.
       T13 fires when T12b's `check-7d-watch-log.ts` exit 0.
    5. If re-measurement still fails: **ESCALATE to PO** + create
       `T-WIRE-PROD-APPLY-amendments.md` entry "GAP — perf regression
       investigation, watch extended by 7 days". T13 delayed.
    ```
  - **§Emulator manual run**: copy from 2c-A T9a doc-comment.
  - **§Smoke E2E procedure**: copy-pasteable.
  - **§Ghost user cleanup procedure**: per-decision-type commands.
  - **§Escape-hatch**: workflow_dispatch + when to use.

### T7: Atomic deploy verification script + tests (post-deploy verification only)

- **Files**:
  - `apps/api/scripts/check-cloud-function-deployed.ts` (NEW, ~50 LOC).
  - `apps/api/test/scripts/check-cloud-function-deployed.test.ts` (NEW, ~50 LOC).
- **LOC estimate**: ~100.
- **Depends on**: T3 merged.
- **Acceptance**:
  - Script invokes `gcloud functions describe beforeCreate --region=us-east1 --format=json` + asserts `sourceArchiveUrl` non-empty + `status === 'ACTIVE'`.
  - Doc-comment explicit: "**Post-deploy verification of the Cloud Function ARTIFACT only.** NOT inter-apply ordering — that's T7b workflow + T6 runbook."
  - Tests with mocked `child_process.execSync`.

### T7b: Inter-apply deploy-gate CI workflow + IAM grant (WIF auth per N-B1 + IAM per N-B6)

- **Files**:
  - `.github/workflows/sprint-2c-b-deploy-gate.yml` (NEW, ~55 LOC).
  - **`infrastructure/iam.tf`** (MODIFY, +1 LOC per N-B6 fix) — add `"roles/cloudfunctions.viewer"` to `local.github_deployer_roles` list (line ~173-187). Atomic with the workflow.
- **LOC estimate**: ~56.
- **Depends on**: T7 merged.
- **Acceptance** (N-B1 fix):
  - **WIF auth pattern** per `release.yml` precedent:
    ```yaml
    permissions:
      contents: read
      id-token: write
      pull-requests: read
    
    jobs:
      check-function-deployed-in-prod:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4
          - uses: google-github-actions/auth@v2
            with:
              project_id: booster-ai-494222
              workload_identity_provider: ${{ vars.WIF_PROVIDER }}
              service_account: ${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}
          - uses: google-github-actions/setup-gcloud@v3
          - uses: pnpm/action-setup@v6
            with:
              version: '9.15.4'
          - uses: actions/setup-node@v6
            with:
              node-version: '24'
              cache: pnpm
          - run: pnpm install --frozen-lockfile
          - name: Verify function deployed + active in prod
            run: pnpm --filter @booster-ai/api exec tsx scripts/check-cloud-function-deployed.ts
    ```
  - **IAM grant** (per N-B6 fix — mechanical, NOT honor-system): `infrastructure/iam.tf` modified in same PR to add `"roles/cloudfunctions.viewer"` to `local.github_deployer_roles`. The existing `for_each` loop on `google_project_iam_member.github_deployer_bindings` (lines ~189-194) picks up the new role automatically + applies it to `google_service_account.github_deployer.email` (the WIF SA). Verification: `terraform plan` before merge shows exactly 1 new `google_project_iam_member` resource for the cloudfunctions.viewer role; apply happens as part of next routine infra apply OR T7b PR description includes `terraform apply -target=google_project_iam_member.github_deployer_bindings\["roles/cloudfunctions.viewer"\]` snippet.
  - Workflow `on.pull_request.paths` fires when PR touches `infrastructure/identity-platform.tf` + diff contains literal `blocking_functions {`.
  - `workflow_dispatch` with `force=true` escape-hatch.
  - YAML comment documents scope.

### T8: Terraform apply (T4 + T5 — operational; evidence committed)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/terraform-apply-T8.log` (NEW, ~20 LOC sanitized).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY.txt` (NEW, ~3 LOC).
- **LOC estimate**: ~25.
- **Depends on** (N-B3 fix): T4 + T5 + T6 + T7 + T7b merged **+ T12a applied (monitoring infra evidence committed)** + ADR-052 Status flip Accepted + SIGNUP_REQUEST_FLOW_ACTIVATED ON.
- **Acceptance**:
  - `terraform-apply-T8.log` sanitized to summary block only:
    ```text
    Plan: <N> to add, <M> to change, 0 to destroy.
    Resources: <list>
    Applied successfully @ <ISO> by <actor>
    Cloud Build run ID: <ID>
    ```
  - `T-WIRE-PROD-APPLY.txt`: ISO timestamp + actor + Cloud Build run ID + notes.
  - **Atomic ordering** (T6 runbook §Deploy procedure): T12a monitoring applied → T4 apply → Cloud Build deploy → T7 verify → T5 wire apply. T7b workflow enforces step 4 (T5 wire) cannot merge until step 3 verifies.

### T9: Smoke E2E negative + positive (operational; evidence committed)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-negative.md` (NEW, ~20 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-positive.md` (NEW, ~20 LOC).
  - `*.png` screenshots (2-4 files; committed).
- **LOC estimate**: ~40.
- **Depends on**: T8 applied.
- **Acceptance**:
  - YAML front-matter per case: environment, firebase_project, tester, tester_email_redacted (sha256-16), timestamp, git_sha_at_test.
  - **Negative**: ad-hoc Google sin matching aprobado → UI message contains "Tu solicitud de registro debe ser aprobada".
  - **Positive**: `dev@boosterchile.com` con matching aprobado pre-creado → succeeds + redirect.
  - Per DA v2 G-06: corporate domain (NO `@gmail.com`).

### T10: Production perf smoke script + first measurement

- **Files**:
  - `apps/auth-blocking-functions/scripts/prod-perf-measure.ts` (NEW, ~50 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/prod-perf-measure-<ISO>.json` (NEW, ~25 LOC).
- **LOC estimate**: ~75.
- **Depends on**: T8 applied + ≥1 Google signup attempt post-wire.
- **Acceptance**:
  - Script pulls Cloud Monitoring metrics (`metric.type=cloudfunctions.googleapis.com/function/execution_times`).
  - **Cold-start handling** (F-B7): discard first invocation; report `p95_warmed` (bar 1500ms) + `p95_with_cold_start` (bar 3500ms).
  - OR-clause preserved (first 10 warmed OR 7-day window).
  - **Regression** → T6 runbook §Performance regression including N-B4 day-5 scenario.

### T11: Ghost user inventory execution + CSV + PO cleanup decision

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-T11-<ISO>.csv` (NEW).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/po-cleanup-decision.md` (NEW, ~35 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T8 applied.
- **Acceptance**:
  - CSV schema extends 2c-A T8 with `decision` (`a|b|c`) + `decisionDate` + `decisionActor` columns.
  - `po-cleanup-decision.md` template per decision type + auth.updateUser invocation log + outreach log.

### T12a: Monitoring infra apply (BEFORE T8 — F-B6 fix)

- **Files**:
  - `infrastructure/auth-blocking-functions-monitoring.tf` (NEW, ~50 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/terraform-apply-T12a.log` (NEW, summary block only).
- **LOC estimate**: ~55.
- **Depends on**: T7b merged.
- **Acceptance**:
  - `google_monitoring_alert_policy` for 3-sigma rate on `signup.blocked.google`.
  - `google_monitoring_uptime_check_config` synthetic for function reachability.
  - **Applied BEFORE T8** so alerts exist day 0 (T6 runbook §Deploy preflight).
  - Evidence `terraform-apply-T12a.log` committed (summary block); referenced from T8 PR description.

### T12b: 7-day watch log + verification script (F-B8 mechanical fix)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/7day-watch-log.md` (NEW, ~35 LOC).
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY-amendments.md` (NEW only if re-apply).
  - `apps/api/scripts/check-7d-watch-log.ts` (NEW, ~40 LOC).
  - `apps/api/test/scripts/check-7d-watch-log.test.ts` (NEW, ~40 LOC).
- **LOC estimate**: ~115 (**marginal +15**, justified mechanical conversion).
- **Depends on**: T8 applied + T-WIRE-PROD-APPLY anchor committed + T12a active.
- **Acceptance**:
  - Daily log template: 7 entries (Day 1..Day 7) with blocked count + baseline + 3-sigma threshold + alert firings + p95 + anomalies + reviewer.
  - `check-7d-watch-log.ts` asserts: exactly 7 dated entries, contiguous T-WIRE → T-WIRE+7d range, 48h+ gap explicitly logged, T-WIRE-PROD-APPLY-amendments.md present on re-apply events.
  - SC-2C.B.7 closure: < 1 blocked Google signup/day + 0 alert firings.

### T13: ADR-054 Status flip Proposed → Accepted

- **Files**: `docs/adr/054-google-blocking-function-signup-gate.md` (MODIFY, ~+1 LOC line 3).
- **LOC estimate**: ~2.
- **Depends on**: T12b 7-day watch passed + `check-7d-watch-log.ts` exit 0.
- **Acceptance**:
  - Single-purpose commit: `docs(adr-054): Accepted post-7d-watch cloudbuild run <ID>`.
  - Status: `- **Status**: Accepted (post-7d-watch cloudbuild run <ID>)`.

### T14a: Branch protection PATCH (operational; PO out-of-band; evidence first per N-B2 fix)

- **Files**:
  - `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/branch-protection-PATCH-T14a.md` (NEW, ~30 LOC).
- **LOC estimate**: ~30.
- **Depends on**: T13 merged.
- **Acceptance** (N-B2 fix — PATCH-first sequencing):
  - **Step 1 — verify current state**:
    ```bash
    gh api repos/boosterchile/booster-ai/branches/main/protection/required_status_checks \
      --jq '.contexts' > before.txt
    ```
  - **Step 2 — compute new list (current minus 3 contexts to remove)**:
    ```bash
    jq 'map(select(. != "Sprint 2c-B build gate (ADR-052 Accepted)" and . != "Sprint 2c-B handler-completeness smoke (T4-state regression guard)" and . != "Sprint 2c-B deploy gate"))' before.txt > after.txt
    ```
  - **Step 3 — PUT the new list** (N-B7 fix: GitHub API requires PUT of full `required_status_checks` object; `gh api --input -` reads JSON from stdin per gh CLI documentation):
    ```bash
    jq -n --argjson contexts "$(cat after.txt)" \
      '{strict: true, contexts: $contexts}' \
      | gh api -X PUT repos/boosterchile/booster-ai/branches/main/protection/required_status_checks \
          --input -
    ```
  - **Step 4 — verify**:
    ```bash
    gh api repos/boosterchile/booster-ai/branches/main/protection/required_status_checks \
      --jq '.contexts' > final.txt
    diff after.txt final.txt  # MUST be empty
    ```
  - Evidence file commits the before/after/final + diff output + ISO timestamp + actor.
  - **If PATCH fails**: STOP. T14b/T14c must not proceed until T14a evidence shows successful PATCH.
- **SC trace**: SC-2C.B.10 closure prep.

### T14b: Workflow + script deletions (atomic; depends on T14a evidence)

- **Files** (deletions only):
  - DELETE `.github/workflows/sprint-2c-build-gate.yml` (2c-A T2b).
  - DELETE `.github/workflows/sprint-2c-handler-completeness.yml` (2c-A T11).
  - DELETE `.github/workflows/sprint-2c-b-deploy-gate.yml` (2c-B T7b).
  - DELETE `apps/api/scripts/check-adr-status-accepted.ts` + `apps/api/test/scripts/check-adr-status-accepted.test.ts` (2c-A T2a).
  - DELETE `apps/api/scripts/check-handler-completeness.ts` + `apps/api/test/scripts/check-handler-completeness.test.ts` (2c-A T11).
  - DELETE `apps/api/scripts/check-cloud-function-deployed.ts` + `apps/api/test/scripts/check-cloud-function-deployed.test.ts` (T7).
  - DELETE `apps/api/scripts/check-7d-watch-log.ts` + `apps/api/test/scripts/check-7d-watch-log.test.ts` (T12b).
- **LOC estimate**: ~+0 / -650 (net deletion).
- **Depends on**: T14a evidence committed + PATCH verified.
- **Acceptance**:
  - All 3 sprint-2c-*.yml workflows removed from `.github/workflows/`.
  - All 4 gate scripts + their tests removed from `apps/api/scripts/` + `apps/api/test/scripts/`.
  - PR description references T14a evidence + asserts: "branch protection PATCH verified successful per T14a; deletions are safe — no phantom required contexts."
  - `pnpm typecheck` + `pnpm test` pass post-deletion.

### T14c: CURRENT.md + sec-001-cierre amendment + followup archive

- **Files**:
  - `docs/handoff/CURRENT.md` (MODIFY, ~+30 LOC).
  - `.specs/sec-001-cierre/spec.md` (MODIFY, ~+5 LOC §3 H1.2 amendment A4).
  - `.specs/_followups/sprint-2c-google-blocking-function.md` → `.specs/_archive/sprint-2c-google-blocking-function.md` (MOVE).
- **LOC estimate**: ~35.
- **Depends on**: T14b merged.
- **Acceptance**:
  - CURRENT.md captures Sprint 2c-B closure summary + links to evidence dir.
  - sec-001-cierre amendment A4: `SC-1.2.2 Google leg TRACKED_RESIDUAL → MET 2026-MM-DD via Sprint 2c-A + 2c-B`.
  - Followup stub archived.
  - **End of SEC-001 H1.2.**

## Out-of-band tasks (post-T14c)

- **Memory file update**: lessons-learned from Sprint 2c-B. **Owner**: Claude.
- **Castellanizar ADR-052/053/054**: unblocked post-CERRADO. **Owner**: PO.
- **translate-auth-error unification**: per followup created en T2. **Owner**: PO future sprint.

## Open questions

- **OQ-2C-B-1**: resolved — `dev@boosterchile.com`.
- **OQ-2C-B-2**: **deferred-decision** (F-B11) — `min_instances=0` selected at T3; contingent rule: if T10 `p95_warmed` > 5000 ms, PO commits to amend within 7 days BEFORE T13. **Day-5 scenario** enumerated in T6 runbook §Performance regression (N-B4 fix).
- **OQ-2C-B-3**: resolved in T1.

## Alternatives considered (plan-level)

(Same as v1/v2 plus N-B5 trade-off acceptance:)

### Alt-2c-B-Plan-IX (NEW v3): Split T2 into T2a (extraction + ADR-054) + T2b (cross-source-test + followup)

**Rejected per N-B5 acceptance**: atomic landing has real upside (ADR-054 and the file it references consistent in one commit). 175 LOC bounded. Reviewer checklist in PR description mitigates the multi-deliverable scatter concern. Acceptable trade-off accepted by PO judgment.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices.
- [x] All tasks ≤ 100 LOC OR waiver logged: T2 (175 marginal+75), T6 (135 marginal+35), T12b (115 marginal+15).
- [x] Acceptance traces to 2c-B spec §3 SC o §10 test per task.
- [x] Rollback plan per task.
- [x] DA v1 findings F-B1..F-B12 fixed in v2.
- [x] DA v2 findings N-B1..N-B5 fixed in v3.
- [x] DA v3 findings N-B6+N-B7 fixed in v4 per §"What changed v3 → v4" table.
- [x] DA v4 pass output captured: ACCEPT_WITH_RESIDUAL (1 P2 nit; plan-review.md §v4 DA pass).
- [x] User approval: **Approved** 2026-05-27 by PO Felipe Vicencio (chose "Approve v4 + ship plan PR").

## Total estimate v4

| Métrica | Valor |
|---|---|
| Tareas | **18** (T1, T2, T3, T4, T5, T6, T7, T7b, T8, T9, T10, T11, T12a, T12b, T13, T14a, T14b, T14c) |
| LOC total estimate code | ~810 cross-stack |
| LOC total estimate evidence | ~variable |
| Tareas con waiver >100 LOC | 3 marginal (T2=175, T6=135, T12b=115) |
| **PO active hours** | ~3-5 días |
| **Wall-clock elapsed** | ≥ 9-12 días (PRs T1-T12a + T7b + 7-day watch + T12b + T13 + T14a-c close) |

**G-14 threshold** (≥15 tasks split): 18 tasks. **Conscious waiver** continues from v2: operational tasks (T1, T8, T9, T11, T14a) ship evidence-only PRs; code tasks form coherent deploy + verify + close arc. Splitting again would scatter operational deliverables without benefit. Per F-B12 sequencing, 18 tasks over ~9-12 wall-clock days averages ~1.5 PRs/day — sustainable cadence given the prior 2c-A precedent of 15 PRs in 1 day.

## Decision log

- **2026-05-27 16:55Z** — /plan 2c-B phase entered.
- **2026-05-27 17:30Z** — DA v1 pass: REVISE (5P0+4P1+3P2; F-B1..F-B12). v1 preserved.
- **2026-05-27 18:00Z** — Plan v2 drafted. DA v2 pass: REVISE (2 NEW P0 + 2 NEW P1 + 1 nit; N-B1..N-B5). v2 preserved.
- **2026-05-27 18:30Z** — Plan v3 drafted addressing all N-B1..N-B5. DA v3 pass: REVISE (2 NEW P0: N-B6 IAM grant missing + N-B7 `--field-from-file` not real gh flag). v3 preserved.
- **2026-05-27 19:00Z** — Plan v4 drafted with surgical fixes for N-B6 + N-B7. DA v4 pass: ACCEPT_WITH_RESIDUAL (2/2 fixes mechanically present; 1 P2 nit accepted). 
- **2026-05-27 19:15Z** — PO approved (chose "Approve v4 + ship plan PR"). Plan-b v4 **Approved**. Next: phase_exit + commit + PR.
- **2026-05-28 19:30Z** — Regression detected: 15 consecutive Cloud Build FAILURES since 2026-05-27 15:46Z due to T3 `--gen2=false` syntax bug + sequencing flaw (auth-blocking steps auto-run on every main merge instead of being gated to T8 procedure). Detected during T8 prep gcloud check. CI/CD blocked 28h. T3-fix amendment added below.

## Amendment: T3-fix (regression hotfix, 2026-05-28)

### Background

T3 (PR #384, merged 2026-05-27 17:00Z) shipped 3 new Cloud Build steps (`build-auth-blocking`, `deploy-auth-blocking`, `verify-auth-blocking-deployed`) intended to be invoked **manually as Step 2 of the T8 deploy procedure** per the T6 runbook §2. Two defects shipped together:

1. **Syntax bug**: `--gen2=false` is invalid gcloud syntax (boolean flags don't accept `=value`). Causes `deploy-auth-blocking` step to fail immediately with exit code 2 (`ERROR: (gcloud.functions.deploy) argument --gen2: ignored explicit argument 'false'`).
2. **Sequencing flaw**: steps have `waitFor: ['-']` / `waitFor: [build-auth-blocking]` with no substitution gate, so they execute on every push-to-main Cloud Build trigger. Cloud Build cancels all in-flight steps when any step fails, which means the 3 auth-blocking steps blocked every api/web/whatsapp/telemetry deploy for 28h (15 consecutive build failures 2026-05-27 15:46Z → 2026-05-28 19:14Z).

Per T6 runbook §2, the intended invocation pattern is `gcloud builds submit --config=cloudbuild.production.yaml --substitutions=_COMMIT_SHA=$(git rev-parse HEAD)` triggered manually as Step 2 of T8, **after** Step 1 (`terraform apply -target=google_cloudfunctions_function.before_create`) creates the function shell with placeholder source. T3 didn't implement the substitution gate the runbook implies.

### T3-fix: cloudbuild substitution gate + syntax fix

- **Files**:
  - `cloudbuild.production.yaml` (MODIFY, ~+15 LOC): add `_AUTH_BLOCKING_DEPLOY: 'false'` substitution; wrap each of 3 auth-blocking steps' bash with early-exit `if [ "$$_AUTH_BLOCKING_DEPLOY" != "true" ]; then echo "SKIP: ..."; exit 0; fi`; replace `--gen2=false` with `--no-gen2` at line 460; update inline comment at line 435.
  - `apps/auth-blocking-functions/tsup.config.ts` (MODIFY, ~±2 LOC): update doc comment from `--gen2=false` to `--no-gen2`.
  - `docs/qa/google-blocking-function-runbook.md` (MODIFY, ~+3 LOC): update §2 Step 2 `gcloud builds submit` invocation to include `--substitutions=_AUTH_BLOCKING_DEPLOY=true,_COMMIT_SHA=$(git rev-parse HEAD)`.
- **LOC estimate**: ~20.
- **Depends on**: T3 merged ✅.
- **Acceptance**:
  - With `_AUTH_BLOCKING_DEPLOY=false` (default): all 3 auth-blocking steps echo `SKIP` + exit 0. Cloud Build proceeds to api/web/etc. deploys. **Empirically verified by this PR's own Cloud Build run going past the previously-failing step**.
  - With `_AUTH_BLOCKING_DEPLOY=true` (T8 invocation): steps execute with corrected `--no-gen2` flag.
  - Runbook §2 Step 2 reflects the substitution invocation.
  - T6 runbook §2 deploy sequence unchanged (Step 1 terraform create → Step 2 cloudbuild submit with `_AUTH_BLOCKING_DEPLOY=true` → Step 3 verify → Step 4 wire).
- **Rollback**: revert this PR. Reverts to T3 state (CI broken). Lower-risk than leaving the gate active during ramp; the substitution flag is the canonical control point.
- **Verification path**: PR's own Cloud Build run = empirical proof. `gcloud builds describe <PR-build-id>` shows the 3 auth-blocking steps SUCCESS with skip-message; api/web/etc. deploys SUCCESS.

### Why amendment, not new sub-spec

T3-fix is scoped to ~20 LOC repairing a defect introduced 24h ago in this same sub-spec. Keeping it as a plan amendment preserves Sprint 2c-B traceability (the regression is part of the 2c-B story). A separate sub-spec would scatter the incident record across two dirs without analytic benefit.

### Post-merge state

- `_AUTH_BLOCKING_DEPLOY=false` default → auto-merge Cloud Builds skip the auth-blocking lane → api/web/etc. deploys resume → next api deploy runs the 5-step canary sequence → unblocks ADR-052 flip → unblocks T8.
- T8 execution: per T6 runbook §2, invoke `gcloud builds submit --config=cloudbuild.production.yaml --substitutions=_AUTH_BLOCKING_DEPLOY=true,_COMMIT_SHA=$(git rev-parse HEAD) ...` AFTER Step 1 terraform apply.
