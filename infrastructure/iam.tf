# IAM — humanos + service accounts + Workload Identity Federation.
# Cumple ADR-010 Booster 2.0: IAM humana gestionada via IaC, no consola.

# =============================================================================
# HUMANOS — Owners via IaC
# =============================================================================

resource "google_project_iam_member" "human_owners" {
  for_each = var.human_owners
  project  = google_project.booster_ai.project_id
  role     = "roles/owner"
  member   = each.key

  depends_on = [google_project_service.apis]
}

# NOTA: roles/orgpolicy.policyAdmin NO se puede grantear a nivel proyecto
# (Google API limitation). Para que dev@ maneje overrides de org policy
# desde Terraform, contacto@ (org admin) debe otorgarlo a nivel
# organización con:
#
#   gcloud organizations add-iam-policy-binding 435506363892 \
#     --member="user:dev@boosterchile.com" \
#     --role="roles/orgpolicy.policyAdmin"
#
# Esto es one-time setup. Una vez hecho, terraform apply de dev@ puede
# gestionar google_org_policy_policy en este proyecto.

# =============================================================================
# SERVICE ACCOUNTS — runtime + deployer
# =============================================================================

# SA que usan los Cloud Run services en runtime (workload identity nativo).
# ADR-009 del 2.0: Maps Platform via OAuth, sin API keys. Fleet Engine via serviceSuperUser.
resource "google_service_account" "cloud_run_runtime" {
  account_id   = "booster-cloudrun-sa"
  display_name = "Booster Cloud Run Runtime Service Account"
  description  = "Identidad de runtime para todos los Cloud Run services de Booster AI."
  project      = google_project.booster_ai.project_id
  depends_on   = [google_project_service.apis]
}

locals {
  cloud_run_runtime_roles = [
    # Secret Manager (runtime pull de secrets)
    "roles/secretmanager.secretAccessor",
    # Cloud SQL connector (directo desde Cloud Run)
    "roles/cloudsql.client",
    # Pub/Sub (publish + consume)
    "roles/pubsub.publisher",
    "roles/pubsub.subscriber",
    # Firestore
    "roles/datastore.user",
    # BigQuery
    "roles/bigquery.dataEditor",
    "roles/bigquery.jobUser",
    # Cloud Storage
    "roles/storage.objectUser",
    # KMS (encrypt/decrypt con CMEK)
    "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    # Document AI (ADR-007)
    "roles/documentai.apiUser",
    # Vertex AI (Gemini + embeddings)
    "roles/aiplatform.user",
    # Maps Platform OAuth (ADR-009 del 2.0)
    "roles/serviceusage.serviceUsageConsumer",
    # "roles/fleetengine.serviceSuperUser",  # Requiere Fleet Engine API habilitada.
    #                                          Re-enable cuando se obtenga acuerdo comercial.
    # Firebase Admin SDK
    "roles/firebase.admin",
    "roles/firebaseauth.admin",
    # Cloud Trace + Monitoring (instrumentation automática)
    "roles/cloudtrace.agent",
    "roles/monitoring.metricWriter",
    "roles/logging.logWriter",
  ]
}

resource "google_project_iam_member" "cloud_run_runtime_bindings" {
  for_each = toset(local.cloud_run_runtime_roles)
  project  = google_project.booster_ai.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# SA para deploys desde GitHub Actions via WIF.
# NO Owner — solo permisos para deploy. Mínimo privilegio.
resource "google_service_account" "github_deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions Deployer (via WIF)"
  description  = "Service account impersonated por GitHub Actions para deploy a Cloud Run. Ver ADR-010 del 2.0."
  project      = google_project.booster_ai.project_id
  depends_on   = [google_project_service.apis]
}

locals {
  github_deployer_roles = [
    "roles/run.admin",                           # Deploy a Cloud Run
    "roles/cloudbuild.builds.editor",            # Trigger Cloud Build
    "roles/artifactregistry.writer",             # Push Docker images
    "roles/iam.serviceAccountUser",              # Impersonate cloud_run_runtime al deploy
    "roles/storage.objectAdmin",                 # Subir source al bucket _cloudbuild (gcloud builds submit)
    "roles/serviceusage.serviceUsageConsumer",   # Attribution de quota al usar APIs durante el build
    "roles/container.developer",                 # Deploy a GKE (telemetry gateway)
    "roles/logging.viewer",                      # Leer logs de Cloud Build para que gcloud builds submit los streamee
    "roles/logging.logWriter",                   # Escribir logs del build a Cloud Logging (cuando es el build SA)
  ]
}

resource "google_project_iam_member" "github_deployer_bindings" {
  for_each = toset(local.github_deployer_roles)
  project  = google_project.booster_ai.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.github_deployer.email}"
}

# github-deployer puede impersonar SOLO cloud_run_runtime (no puede impersonar
# cualquier SA del proyecto)
resource "google_service_account_iam_member" "github_can_impersonate_runtime" {
  service_account_id = google_service_account.cloud_run_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

# =============================================================================
# WORKLOAD IDENTITY FEDERATION — GitHub → GCP sin SA keys
# Lección de SEC-2026-04-01: nunca más descargar keys JSON.
# =============================================================================

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Federated identity pool para GitHub Actions del repo boosterchile/booster-ai"
  project                   = google_project.booster_ai.project_id
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"
  project                            = google_project.booster_ai.project_id

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    "attribute.ref_type"   = "assertion.ref_type"
  }

  # CRÍTICO: restringir a nuestro repo solamente. Sin esto, cualquier repo GitHub
  # podría obtener tokens.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Permitir que el WIF del repo asuma la identidad del github-deployer SA
resource "google_service_account_iam_member" "wif_to_deployer" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
