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
    # Observability dashboard (spec 2026-05-13) — read time series via API.
    # metricWriter solo permite write; viewer es el read mínimo necesario
    # para /admin/observability/usage/cloud-run|cloud-sql.
    "roles/monitoring.viewer",
  ]
}

resource "google_project_iam_member" "cloud_run_runtime_bindings" {
  for_each = toset(local.cloud_run_runtime_roles)
  project  = google_project.booster_ai.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# Permitir que el cloud_run runtime SA emita signed URLs v4 firmando con
# su propia identidad vía IAM signBlob API. Sin esto, @google-cloud/storage
# `bucket.file().getSignedUrl({version:'v4'})` falla con:
#   Permission 'iam.serviceAccounts.signBlob' denied
# Self-binding (NO project-wide) — la SA solo puede signBlob para sí
# misma, no impersonar otras SA. Mínimo privilegio.
# P3.f: necesario para POST /assignments/:id/messages/photo-upload-url
# (PUT signed URL) y POST /assignments/:id/messages/:msgId/photo-url
# (READ signed URL). Detectado durante smoke E2E con Felipe — endpoint
# devolvía 500 unhandled error en runtime.
resource "google_service_account_iam_member" "cloudrun_self_signer" {
  service_account_id = google_service_account.cloud_run_runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# Custom role mínimo para que el SA Cloud Run pueda crear/borrar
# subscriptions efímeras del chat SSE (P3.b). Los roles standard
# pubsub.publisher/pubsub.subscriber NO incluyen subscriptions.create
# (que es un permiso project-level — Pub/Sub modela subscriptions como
# recursos del proyecto, no del topic).
#
# No usamos roles/pubsub.editor porque incluye topics.delete /
# topics.update — peligroso aunque sea sobre 1 topic; el blast radius
# de un bug podría borrar el topic chat-messages y romper el realtime
# para todos. Custom role limitado a subscriptions es estrictamente
# lo necesario.
resource "google_project_iam_custom_role" "chat_subscription_manager" {
  role_id     = "chatSubscriptionManager"
  title       = "Chat SSE Subscription Manager"
  description = "Permite create/delete/consume de subscriptions Pub/Sub efímeras (P3.b chat SSE). Sin permisos sobre topics."
  project     = google_project.booster_ai.project_id
  permissions = [
    "pubsub.subscriptions.create",
    "pubsub.subscriptions.delete",
    "pubsub.subscriptions.get",
    "pubsub.subscriptions.consume",
  ]
  stage = "GA"
}

resource "google_project_iam_member" "cloud_run_chat_subscription_manager" {
  project = google_project.booster_ai.project_id
  role    = google_project_iam_custom_role.chat_subscription_manager.id
  member  = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
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
    "roles/run.admin",                 # Deploy a Cloud Run
    "roles/cloudbuild.builds.editor",  # Trigger Cloud Build
    "roles/cloudbuild.workerPoolUser", # Usar el private worker pool (PR #68)
    "roles/artifactregistry.writer",   # Push Docker images
    # roles/iam.serviceAccountUser REMOVIDO del project-level (Trivy IaC
    # AVD-GCP-0008 — too broad; permitia impersonar CUALQUIER SA del proyecto).
    # Reemplazado por google_service_account_iam_member.github_can_impersonate_runtime
    # mas abajo, que da iam.serviceAccountUser solo sobre cloud_run_runtime.
    "roles/storage.objectAdmin",               # Subir source al bucket _cloudbuild
    "roles/serviceusage.serviceUsageConsumer", # Attribution de quota al usar APIs
    "roles/container.developer",               # Deploy a GKE (telemetry gateway)
    "roles/logging.viewer",                    # Leer logs de Cloud Build (gcloud builds submit los streamea)
    "roles/logging.logWriter",                 # Escribir logs del build a Cloud Logging
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

# github-deployer puede actuar como SI MISMO. Necesario porque
# cloudbuild.production.yaml declara `serviceAccount: .../github-deployer@...`
# (Cloud Build corre el build "como github-deployer"), y actAs de uno mismo
# requiere binding explicito de roles/iam.serviceAccountUser desde que se
# scopeo el rol project-wide en PR #70.
#
# Sin este binding, gcloud builds submit falla con:
#   ERROR: PERMISSION_DENIED: caller does not have permission to act as
#   service account .../github-deployer@...
#
# Mantiene el aislamiento de PR #70 (no abre actAs sobre otros SAs del
# proyecto), solo permite la self-impersonation que el build necesita.
resource "google_service_account_iam_member" "github_deployer_self_impersonate" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.github_deployer.email}"
}

# =============================================================================
# GKE Autopilot Default Compute SA — necesita pull de Artifact Registry
# =============================================================================
# El kubelet de GKE Autopilot corre con el Compute Engine default SA
# (<project_number>-compute@developer.gserviceaccount.com) salvo que se
# configure un node SA custom. En projects nuevos (post-mayo 2024) este SA
# NO tiene roles default, así que sin esto los pods quedan en
# ImagePullBackOff al intentar pullear imágenes desde Artifact Registry.
resource "google_project_iam_member" "compute_default_sa_artifact_reader" {
  project = google_project.booster_ai.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_project.booster_ai.number}-compute@developer.gserviceaccount.com"
}

# =============================================================================
# IAP BASTION SA — Capa 1 del ADR-013
# =============================================================================
# SA dedicada para el bastion VM. cloud-sql-proxy en el bastion la usa para
# autenticarse contra la Admin API de Cloud SQL (cloudsql.client) y
# establecer el túnel TLS hacia la instancia privada. La auth IAM-database
# del operador al rol Postgres se hace per-laptop con su propio access
# token — el bastion SA NO conoce esa identidad.
resource "google_service_account" "db_bastion" {
  account_id   = "db-bastion-sa"
  display_name = "Booster AI DB Bastion (IAP)"
  description  = "Identidad del bastion VM que sirve cloud-sql-proxy a operadores via IAP TCP."
  project      = google_project.booster_ai.project_id
  depends_on   = [google_project_service.apis]
}

locals {
  db_bastion_roles = [
    "roles/cloudsql.client",         # Cloud SQL Admin API + establecer tunel TLS
    "roles/logging.logWriter",       # journalctl → Cloud Logging
    "roles/monitoring.metricWriter", # métricas de la VM
  ]
}

resource "google_project_iam_member" "db_bastion_bindings" {
  for_each = toset(local.db_bastion_roles)
  project  = google_project.booster_ai.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.db_bastion.email}"
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
