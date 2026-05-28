# Google Blocking Function — operational runbook

> SEC-001 Sprint 2c-B (`.specs/sec-001-h1-2-google-blocking-b/plan.md` v4) · 2026-05-28
> SC-2C.B.1..SC-2C.B.10 — Identity Platform `beforeCreate` admin-approval gate.
> Terraform: `infrastructure/auth-blocking-functions.tf` (T4), `infrastructure/identity-platform.tf` (T5).
> Cloud Build: `cloudbuild.production.yaml` steps `build-auth-blocking → deploy-auth-blocking → verify-auth-blocking-deployed` (T3).
> ADR: [`054-google-blocking-function-signup-gate.md`](../adr/054-google-blocking-function-signup-gate.md) (Proposed; Status flip Accepted at T13 post-7d-watch success).
> Pre-condition: [`052-signup-migration-admin-sdk-gate.md`](../adr/052-signup-migration-admin-sdk-gate.md) flipped Accepted (Sprint-2b T13 canary success out-of-band).

## 1. Pre-deploy checklist

Before triggering the deploy sequence (T8 operational task), confirm ALL of:

- [ ] **ADR-052 Status: Accepted** — verify via `grep '^- \*\*Status\*\*:' docs/adr/052-signup-migration-admin-sdk-gate.md`.
- [ ] **SA email empirically verified** — `cat .specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/sa-email-verification.txt` shows `service-469283083998@gcp-sa-identitytoolkit.iam.gserviceaccount.com` (T1).
- [ ] **Ghost user inventory dry-run reviewed** — `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-dry-run.csv` reviewed by PO (T1).
- [ ] **`SIGNUP_REQUEST_FLOW_ACTIVATED=true` in staging** — verify via feature-flags endpoint or Secret Manager.
- [ ] **Monitoring infra applied (T12a)** — `terraform plan` against `auth-blocking-functions-monitoring.tf` shows no diff (already applied).
- [ ] **WIF SA has `roles/cloudfunctions.viewer`** (T7b dep) — `gcloud projects get-iam-policy booster-ai-494222 --flatten='bindings[].members' --filter='bindings.members:github-deployer@booster-ai-494222.iam.gserviceaccount.com AND bindings.role:roles/cloudfunctions.viewer'` returns ≥1 binding.

## 2. Deploy procedure (4-step atomic sequence per DA G-03)

Execute **in order**. Step N+1 cannot proceed until Step N verifies.

```bash
# Step 1 — Apply Cloud Function shell + IAM binding (T4 resource only)
cd infrastructure
terraform apply \
  -target=google_storage_bucket.auth_blocking_source \
  -target=google_storage_bucket_object.auth_blocking_placeholder \
  -target=google_cloudfunctions_function.before_create \
  -target=google_cloudfunctions_function_iam_member.idp_invoker
# Output: 4 resources created with placeholder source.

# Step 2 — Cloud Build deploy step replaces real source via gcloud.
# T3-fix (2026-05-28): the 3 auth-blocking steps default to SKIP on
# every push-to-main build; this invocation must pass
# `_AUTH_BLOCKING_DEPLOY=true` to actually run the lane.
gcloud builds submit \
  --config=cloudbuild.production.yaml \
  --substitutions=_AUTH_BLOCKING_DEPLOY=true,_COMMIT_SHA=$(git rev-parse HEAD) \
  --project=booster-ai-494222
# This triggers build-auth-blocking → deploy-auth-blocking →
# verify-auth-blocking-deployed. All other deploy steps in the
# pipeline still run as part of this submission.

# Step 3 — Verify function ACTIVE in prod (already done by cloudbuild
# verify step; this is a defense-in-depth re-check)
pnpm --filter @booster-ai/api exec tsx scripts/check-cloud-function-deployed.ts
# Exit 0 confirms sourceArchiveUrl non-empty + status=ACTIVE.

# Step 4 — Wire IdP blocking_functions (T5 modify only)
terraform apply -target=google_identity_platform_config.default
# Output: 1 in-place update (blocking_functions block).
# Verify via Admin API:
TOKEN=$(gcloud auth application-default print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: booster-ai-494222" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" \
  | jq '.blockingFunctions'
# Expected: { "triggers": { "beforeCreate": { "functionUri": "https://..." } } }

# Step 5 — Record T-WIRE-PROD-APPLY anchor (T8 evidence)
date -u +"T-WIRE-PROD-APPLY: %Y-%m-%dT%H:%M:%SZ
Applied by: $(git config user.email)
Terraform apply run: <Cloud Build run ID from step 2>
Notes: clean apply, no deviation from runbook" \
  > .specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY.txt
```

T7b workflow (when shipped) enforces Step 4 cannot merge until Step 3 verifies (mechanical inter-apply gate). For PRs touching `infrastructure/identity-platform.tf` `blocking_functions` block.

## 3. Rollback steps (4 levels of undo)

| Step | Time-to-undo | Action |
|---|---|---|
| **1 (5-min undo)** | 5 min | Identity Platform Admin API patch unwires the trigger without destroying anything else. Reverts user signup flow to pre-Sprint-2c-B behavior in real-time. |
| **2 (Terraform revert)** | 10-20 min | Revert the wire commit + `terraform apply -target=google_identity_platform_config.default`. Persistent infrastructure state restored. |
| **3 (Function destroy)** | 5 min | `terraform destroy -target=google_cloudfunctions_function.before_create`. Removes the function entirely. Required if the function code itself is faulty. |
| **4 (Ghost user cleanup revert)** | per-user | If T11 cleanup applied `auth.updateUser(uid, {disabled:true})` to any users, restore via `auth.updateUser(uid, {disabled:false})` per CSV row in evidence dir. |

```bash
# Step 1 commands (5-min undo)
TOKEN=$(gcloud auth application-default print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: booster-ai-494222" \
  -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"blockingFunctions": {}}' \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config?updateMask=blockingFunctions"

# Step 2 commands
git revert <T5 wire commit sha>  # creates revert commit; PR + merge first
cd infrastructure && terraform apply -target=google_identity_platform_config.default

# Step 3 commands
cd infrastructure && terraform destroy \
  -target=google_cloudfunctions_function_iam_member.idp_invoker \
  -target=google_cloudfunctions_function.before_create

# Step 4 commands (per CSV row)
gcloud identity-toolkit users update --uid=<UID> --enabled --project=booster-ai-494222
```

## 4. 7-day watch semantics (F-B8 fix)

`T-WIRE-PROD-APPLY.txt` timestamp is the canonical anchor — recorded **once** at first apply. Subsequent re-applies do NOT reset the clock unless explicit "rollback + re-wire" event is documented.

Re-apply amendment format (write to `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY-amendments.md`):

```markdown
## Re-apply event YYYY-MM-DDTHH:MM:SSZ

**Reason**: <free-form: drift fix, terraform refactor, min_instances bump, etc.>
**Decision**: continue clock | reset clock
**Rationale**: <why; e.g., "config-only change per F-B11; clock continues" OR
              "rollback + re-wire; clock resets per umbrella SC-2C.8">
**PO**: <name>
```

T13 pre-flip gate (`check-7d-watch-log.ts` in T12b) asserts:
- Exactly 7 dated entries in `7day-watch-log.md`.
- Date range matches `T-WIRE-PROD-APPLY` anchor.
- Any 48h+ gap explicitly logged as "GAP — extended by N days".
- `T-WIRE-PROD-APPLY-amendments.md` exists when `git log --grep="re-apply" .specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/` shows commits.

## 5. Performance regression — day-N (N ≥ 3) scenario (N-B4 fix)

Per OQ-2C-B-2 deferred-decision contingent rule: if T10 measurement at day N > 3 finds `p95_warmed > 5000 ms`, execute this procedure:

1. **Within 24h** of T10 finding: commit `min_instances=1` amendment to `infrastructure/auth-blocking-functions.tf` (T4) via dedicated PR. PR title: `fix(auth-blocking-functions): bump min_instances=1 post-T10-regression (Sprint 2c-B day-N)`.
2. **Re-apply terraform** with `-target=google_cloudfunctions_function.before_create`. **This is a config-only change, NOT a "re-wire" event — clock does NOT reset** per §7d-watch-semantics.
3. **Re-measure perf at +48h** via T10 script. Output committed as `prod-perf-measure-<ISO>-after-min-instances-fix.json`.
4. If re-measurement passes (p95_warmed < 1500 ms): continue 7-day watch. T13 fires when T12b's `check-7d-watch-log.ts` exits 0.
5. If re-measurement still fails: **ESCALATE to PO** + create `T-WIRE-PROD-APPLY-amendments.md` entry "GAP — perf regression investigation, watch extended by 7 days". T13 delayed.

## 6. Emulator manual run procedure (copy from 2c-A T9a)

```bash
# 1. Install firebase-tools globally (once per dev machine)
npm install -g firebase-tools

# 2. Build the function for the emulator
cd apps/auth-blocking-functions
pnpm build

# 3. Start a throwaway Postgres + create the schema
# (or point TEST_DATABASE_URL to a pre-seeded local DB)

# 4. Start the emulators (auth + functions only)
firebase emulators:start --only auth,functions --project demo-booster-ai

# 5. In a separate terminal:
cd apps/auth-blocking-functions
FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099' \
TEST_DATABASE_URL='postgresql://localhost/booster_test' \
pnpm test:emulator

# 6. Stop emulators when done (Ctrl+C in step 4)
```

**Expected outcomes** (from `test/integration/firebase-emulator.test.ts`):
- Scenario A — pre-seeded `solicitudes_registro` row with `estado='aprobado'` for `approved@booster.test` → Firebase Auth signup succeeds; user created.
- Scenario B — no matching row for `unknown@booster.test` → Firebase Auth signup fails with `auth/internal-error`.

## 7. Smoke E2E procedure (T9 operational task)

| Case | Setup | Run | Expected |
|---|---|---|---|
| **Negative** | Random new Google account ad-hoc (NOT in `solicitudes_registro`) | Open `https://app.boosterchile.com/login` → click "Iniciar sesión con Google" → complete OAuth | UI message contains "Tu solicitud de registro debe ser aprobada"; user NOT created in Firebase Auth |
| **Positive** | Pre-create `solicitudes_registro` row `email='dev@boosterchile.com', estado='aprobado'`; ensure user does NOT already exist in Firebase Auth | Open `/login` → "Iniciar sesión con Google" with `dev@boosterchile.com` | Signup succeeds; redirect to `/app`; user appears in Firebase Auth |

Document each run with YAML front-matter:

```yaml
---
environment: prod
firebase_project: booster-ai-494222
tester: <name>
tester_email_redacted: <sha256-first-16-chars of tester email>
timestamp: <ISO 8601 UTC>
git_sha_at_test: <sha of main at smoke run time>
---
```

Commit to `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/smoke-e2e-{negative,positive}.md`.

## 8. Ghost user cleanup procedure (T11 operational task)

After wire goes live (T8 step 4 complete), re-run the 2c-A T8 inventory script:

```bash
cd apps/auth-blocking-functions
GOOGLE_CLOUD_PROJECT=booster-ai-494222 \
DATABASE_URL=$(gcloud secrets versions access latest --secret=database-url --project=booster-ai-494222) \
pnpm exec tsx scripts/inventory-google-ghost-users.ts
# Output: ghost-users-inventory-T11-<ISO>.csv in evidence dir
```

PO reviews CSV row-by-row, decides per ghost user:
- **(a)** Leave alone — user already locked out post-wire (no harm).
- **(b)** Disable — `gcloud identity-toolkit users update --uid=<UID> --disabled --project=booster-ai-494222`.
- **(c)** Email user with re-onboarding instructions (manual outreach via support@boosterchile.com).

Decision log per ghost user in `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/po-cleanup-decision.md`.

## 9. Escape-hatch (CI gates)

If a future Sprint 2c-B-related PR triggers the build gate erroneously (e.g., touching `cloudbuild.production.yaml` for an unrelated deploy step), use:

```bash
gh workflow run sprint-2c-build-gate.yml -f force=true
gh workflow run sprint-2c-b-deploy-gate.yml -f force=true  # T7b workflow (when shipped)
```

Document each escape-hatch use in `.specs/_followups/sprint-2c-b-gate-bypasses.md` with:
- PR number + commit SHA.
- Reason the bypass was needed.
- Confirmation that the change is NOT a Sprint 2c-B deploy operation.

Post-Sprint-2c-B CERRADO (T14 closure): both gate workflows are deleted; escape-hatch no longer applicable.
