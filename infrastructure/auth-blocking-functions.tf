# SEC-001 Sprint 2c-B H1.2 — Cloud Function Gen 1 `beforeCreate` for
# Identity Platform Blocking Function.
#
# Spec: .specs/sec-001-h1-2-google-blocking-b/spec.md §7 component 3.
# Plan: .specs/sec-001-h1-2-google-blocking-b/plan.md v4 §T4 acceptance.
# ADR: docs/adr/054-google-blocking-function-signup-gate.md (Proposed;
#      Status flip Accepted en T13 post-7d-watch success).
#
# NOTE — Source artifact lifecycle (F-B9 plan v4 fix):
# Function source is managed by Cloud Build deploy step
# `deploy-auth-blocking` in cloudbuild.production.yaml (T3). The first
# `terraform apply` creates the function shell with a placeholder
# source (the `archive_file` data source below produces a tiny zip
# with a stub index.js); immediately after, run the Cloud Build
# trigger to populate `apps/auth-blocking-functions/dist/index.js` as
# the real source. Without Cloud Build deploy, the function exists in
# API/console but executes the placeholder no-op. Verification via
# the cloudbuild step `verify-auth-blocking-deployed` (T3) + the
# T7b CI workflow (`sprint-2c-b-deploy-gate.yml`).
#
# Atomic deploy contract (DA v2 G-03 fix):
#   1. terraform apply -target=google_cloudfunctions_function.before_create
#      → creates function shell with placeholder source.
#   2. Cloud Build trigger → gcloud functions deploy replaces source.
#   3. verify-auth-blocking-deployed step asserts sourceArchiveUrl
#      non-empty + status ACTIVE.
#   4. terraform apply -target=google_identity_platform_config.default
#      → wires blocking_functions (T5).
#
# Step 4 cannot proceed until step 3 verifies (T7b workflow gate).

# ---------------------------------------------------------------------------
# Placeholder source archive
# ---------------------------------------------------------------------------
# The Cloud Function resource REQUIRES source_archive_bucket +
# source_archive_object at creation. The actual source ships via
# Cloud Build deploy (T3). We initialize with a tiny placeholder zip
# that gcloud functions deploy replaces on first prod deploy.

data "archive_file" "auth_blocking_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform/tmp/auth-blocking-placeholder.zip"

  source {
    content  = "// Sprint 2c-B T4 placeholder. Real source ships via Cloud Build deploy step `deploy-auth-blocking` in cloudbuild.production.yaml. If you see this in prod logs, the Cloud Build deploy did NOT run — escalate per runbook §Rollback.\nexports.beforeCreate = (_user, _ctx) => ({});\n"
    filename = "index.js"
  }

  source {
    content = jsonencode({
      name    = "@booster-ai/auth-blocking-functions-placeholder"
      version = "0.0.0"
      private = true
      type    = "commonjs"
      main    = "index.js"
      engines = { node = "20" }
    })
    filename = "package.json"
  }
}

resource "google_storage_bucket" "auth_blocking_source" {
  name          = "${var.project_id}-auth-blocking-functions-source"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = false
  }

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_object" "auth_blocking_placeholder" {
  name   = "auth-blocking-functions-placeholder-${data.archive_file.auth_blocking_placeholder.output_md5}.zip"
  bucket = google_storage_bucket.auth_blocking_source.name
  source = data.archive_file.auth_blocking_placeholder.output_path
}

# ---------------------------------------------------------------------------
# Cloud Function Gen 1 — `beforeCreate`
# ---------------------------------------------------------------------------
# Identity Platform Blocking Functions only support Gen 1 as of 2026-05
# (verified empirically in `docs/lessons-learned/2026-05-sprint-2c-gen1-
# vs-gen2.md`). Therefore `google_cloudfunctions_function` (NOT
# `google_cloudfunctions2_function`).

resource "google_cloudfunctions_function" "before_create" {
  project = google_project.booster_ai.project_id
  region  = "us-east1" # Identity Platform Blocking Functions require us-east1 per docs.cloud.google.com/identity-platform/docs/blocking-functions
  name    = "beforeCreate"

  runtime             = "nodejs20"
  entry_point         = "beforeCreate"
  available_memory_mb = 256
  timeout             = 60
  min_instances       = 0
  max_instances       = 5
  ingress_settings    = "ALLOW_ALL"

  source_archive_bucket = google_storage_bucket.auth_blocking_source.name
  source_archive_object = google_storage_bucket_object.auth_blocking_placeholder.name

  trigger_http = true

  # ENV vars (DATABASE_URL via Secret Manager mount + project context).
  # SECRET_MANAGER_SECRET_NAME pattern matches existing Booster apps.
  environment_variables = {
    GCP_PROJECT_ID = google_project.booster_ai.project_id
    LOG_LEVEL      = "info"
  }

  secret_environment_variables {
    key     = "DATABASE_URL"
    secret  = "database-url"
    version = "latest"
  }

  lifecycle {
    # Cloud Build deploy step manages the actual source artifact
    # (gcloud functions deploy uploads to a gcloud-internal bucket).
    # Terraform should ignore source drift to avoid re-deploying the
    # placeholder on every apply.
    ignore_changes = [
      source_archive_object,
      source_archive_bucket,
      build_environment_variables,
    ]
  }

  depends_on = [google_project_service.apis]
}

# ---------------------------------------------------------------------------
# IAM binding — Identity Platform service agent as invoker
# ---------------------------------------------------------------------------
# Per Sprint 2c-B T1 empirical verification (sprint-2c-b-evidence/
# sa-email-verification.txt): the IdP invoker is
# `service-<project_number>@gcp-sa-identitytoolkit.iam.gserviceaccount.com`
# (Google-managed service agent, auto-provisioned via `gcloud beta
# services identity create --service=identitytoolkit.googleapis.com`).
# Computed from `google_project.booster_ai.number` (NOT hardcoded — this
# makes the resource portable to any project that wires Identity
# Platform Blocking Functions).

locals {
  identitytoolkit_service_agent = "service-${google_project.booster_ai.number}@gcp-sa-identitytoolkit.iam.gserviceaccount.com"
}

resource "google_cloudfunctions_function_iam_member" "idp_invoker" {
  project        = google_project.booster_ai.project_id
  region         = google_cloudfunctions_function.before_create.region
  cloud_function = google_cloudfunctions_function.before_create.name
  role           = "roles/cloudfunctions.invoker"
  member         = "serviceAccount:${local.identitytoolkit_service_agent}"
}

# ---------------------------------------------------------------------------
# Cloud Functions Gen 1 build SA — Compute Engine default SA needs
# storage.objectViewer on `gcf-sources-<project_number>-<region>` to read
# source archives during build. Standard GCP requirement (see
# https://cloud.google.com/functions/docs/troubleshooting#build-service-account).
# Surfaced during T8 Step 1 first apply 2026-05-29 ~01:00Z with error:
#   "Access to bucket gcf-sources-469283083998-us-east1 denied. You must
#    grant Storage Object Viewer permission to
#    469283083998-compute@developer.gserviceaccount.com"
# Project-level grant is the standard pattern (GCP auto-creates the
# `gcf-sources-*` bucket on first function deploy; bucket-level grant
# would race with bucket creation).
# ---------------------------------------------------------------------------
resource "google_project_iam_member" "compute_default_storage_viewer" {
  project = google_project.booster_ai.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_project.booster_ai.number}-compute@developer.gserviceaccount.com"
}
