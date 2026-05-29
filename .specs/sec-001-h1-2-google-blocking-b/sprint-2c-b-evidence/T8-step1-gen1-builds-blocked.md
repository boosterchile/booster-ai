# T8 Step 1 blocked — Cloud Functions Gen 1 systemic build failure

**Date**: 2026-05-29 ~01:15Z
**Blocking task**: Sprint 2c-B T8 (terraform apply auth-blocking-functions Cloud Function shell)
**Status**: BLOCKED — requires PO decision (ADR-054 amendment OR GCP support)

## Diagnosis

T8 Step 1 per T6 runbook §2 requires `terraform apply -target=google_cloudfunctions_function.before_create`. The Cloud Function creation fails consistently regardless of source content.

### Attempts (chronological)

1. **First attempt** — terraform apply with original placeholder zip (`{ private: true, type: commonjs, engines: node 20, main: index.js }`).
   - GCP build ID: `81a5a4c7-2cb3-4591-9add-fbdbc27c2ad9`
   - Error: code=3 "Access to bucket gcf-sources-469283083998-us-east1 denied. You must grant Storage Object Viewer permission to 469283083998-compute@developer.gserviceaccount.com"
   - **Action taken**: added `google_project_iam_member.compute_default_storage_viewer` granting `roles/storage.objectViewer` to compute default SA at project level. Applied.

2. **Second attempt** — terraform apply with IAM fix in place.
   - GCP build ID: `632a5c53-1bf2-4219-918b-bd1eeab7b288`
   - Error: code=13 "Gen1 operation ... Build failed: Build error details not available"

3. **Third attempt** — placeholder simplified to `{ name, version, main }`.
   - GCP build ID: `a1efa63e-e947-4364-bbc7-0cf1b4c074f4`
   - Error: identical exit code 13 "details not available".

4. **Fourth attempt** — placeholder `{ name, version, main, engines.node=20, dependencies={} }`.
   - GCP build ID: (in apply output)
   - Error: identical exit code 13 "details not available".

5. **Direct gcloud test** — bypass terraform; deploy real locally-built dist (the same dist that succeeds via `pnpm --filter @booster-ai/auth-blocking-functions build`).
   - GCP build ID: `c28b2e19-6dc9-4beb-8869-e46ac472524e`
   - Error: identical.

6. **Minimal isolation test** — bare hello-world `exports.helloHttp = (req,res)=>res.send('ok')` + `{ name, version, main }` package.json.
   - GCP build ID: `3894742d-3f99-4378-a031-1ef9b4504c67`
   - Error: identical "Build error details not available".

### Root cause hypotheses

1. **Cloud Functions Gen 1 deprecation taking effect**: gcloud's deploy command emits `WARNING: Node.js 20 is no longer supported by the Node.js community as of 30 April, 2026. Runtime nodejs20 is currently deprecated for Cloud Functions.` Cloud Functions Gen 1 has been on Google's deprecation track since 2024.
2. Builder pipeline degradation specific to this project / region us-east1.
3. Org/project-level policy blocking new Gen 1 functions.

The "Build error details not available" generic message itself is a smell — healthy build pipelines surface meaningful step-level errors. The fact that ALL attempts (placeholder variants + real source + bare hello-world) hit the same opaque failure suggests a single project-level or service-level cause, not a content issue.

### Current GCP state

- Function `projects/booster-ai-494222/locations/us-east1/functions/beforeCreate`: **OFFLINE** (terraform state: tainted).
- Bucket `booster-ai-494222-auth-blocking-functions-source`: created ✅
- IAM bindings created during T8 attempt:
  - `google_storage_bucket.auth_blocking_source` ✅
  - `google_storage_bucket_object.auth_blocking_placeholder` ✅ (multiple iterations)
  - `google_project_iam_member.compute_default_storage_viewer` ✅ (NEW from this session — `roles/storage.objectViewer` to compute default SA at project level)
- `helloTest` function: not created (deploy failed).

### Options for path forward

**Option A — ADR-054 amendment + migrate to Gen 2**
Migrate the blocking function to Cloud Functions Gen 2 via `firebase-functions/v2/identity` `beforeUserCreated`. Gen 2 is the current supported path; Gen 1 is being phased out. Requires:
- ADR-054 amendment documenting the reversal.
- spec amendment in `.specs/sec-001-h1-2-google-blocking-b/` capturing new component design.
- Code change in `apps/auth-blocking-functions/` to use Firebase Functions v2 API.
- Terraform change from `google_cloudfunctions_function` (v1) → `google_cloudfunctions2_function` (v2).
- T3-fix cloudbuild step refactor (`--no-gen2` flag becomes `--gen2`).

**Option B — GCP support ticket**
Open a support ticket reporting "Cloud Functions Gen 1 builds fail with 'Build error details not available' for any source in project booster-ai-494222 us-east1". Wait for GCP response. Unknown ETA.

**Option C — wait + retry**
The failure may be transient (RC builder image rollback). Retry in 24-48h. If still failing, escalate to A or B.

### Recommended next step

PO judgment call. Option A is the most senior-engineering path (Gen 1 will eventually have to be migrated; doing it now removes future risk) but is substantial scope (~1-2 days). Option B may be the cheapest if GCP can resolve in <1 week.

### Tainted state cleanup (post PO decision)

After PO decides:
- If Option A: `terraform state rm google_cloudfunctions_function.before_create` + delete the partial GCP function via gcloud + the redesign begins.
- If Option B/C: leave tainted state in place; next `terraform apply` will retry creation.
