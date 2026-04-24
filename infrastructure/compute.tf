# Cloud Run services + GKE Autopilot (para TCP gateway Teltonika).
# Los Cloud Run arrancan con imagen placeholder — CI/CD los actualiza después.

# =============================================================================
# CLOUD RUN SERVICES (via módulo reusable)
# =============================================================================

locals {
  common_env_vars = {
    NODE_ENV            = var.environment == "prod" ? "production" : "staging"
    LOG_LEVEL           = "info"
    GOOGLE_CLOUD_PROJECT = var.project_id
    SERVICE_VERSION     = "0.0.0"
  }

  common_secrets = {
    DATABASE_URL = google_secret_manager_secret.secrets["database-url"].secret_id
  }

  # Lista de IDs de todas las secret versions que deben existir antes de crear
  # cualquier Cloud Run service que monte secrets. Se pasa a cada módulo via
  # `secret_versions_ready` para que Terraform propague el orden automáticamente.
  # Incluye los 14 placeholders + database_url (que es generado dinámicamente).
  all_secret_versions_ready = concat(
    [for v in values(google_secret_manager_secret_version.placeholder) : v.id],
    [google_secret_manager_secret_version.database_url.id],
  )
}

# --- apps/api ---
module "service_api" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-api"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = var.environment == "prod" ? 1 : 0
  max_instances = 20
  cpu           = "1"
  memory        = "1Gi"

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME         = "booster-ai-api"
    REDIS_HOST           = google_redis_instance.main.host
    REDIS_PORT           = tostring(google_redis_instance.main.port)
    FIREBASE_PROJECT_ID  = var.project_id
    # Thin slice (Fase 6)
    API_AUDIENCE         = "https://api.boosterchile.com"
    ALLOWED_CALLER_SA    = google_service_account.cloud_run_runtime.email
    CORS_ALLOWED_ORIGINS = "https://api.boosterchile.com,https://boosterchile.com,https://marketing.boosterchile.com"
  })
  secrets = local.common_secrets

  vpc_connector = google_vpc_access_connector.serverless.id

  public = false # tráfico público entra via Global HTTPS LB (networking.tf); Cloud Run no acepta allUsers por org policy

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "api", env = var.environment }
}

# --- apps/web (PWA) ---
module "service_web" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-web"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = var.environment == "prod" ? 1 : 0
  max_instances = 10
  memory        = "512Mi"

  env_vars = {
    NODE_ENV = "production"
  }

  public = false # tráfico público entra via Global HTTPS LB (networking.tf); Cloud Run no acepta allUsers por org policy

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "web", env = var.environment }
}

# --- apps/marketing (Next.js) ---
module "service_marketing" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-marketing"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 1 # always-on para SEO
  max_instances = 10
  memory        = "512Mi"

  env_vars = {
    NODE_ENV = "production"
  }

  public = false # tráfico público entra via Global HTTPS LB (networking.tf); Cloud Run no acepta allUsers por org policy

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "marketing", env = var.environment }
}

# --- apps/matching-engine ---
module "service_matching_engine" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-matching-engine"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 0
  max_instances = 10

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-matching-engine"
    REDIS_HOST   = google_redis_instance.main.host
    REDIS_PORT   = tostring(google_redis_instance.main.port)
  })
  secrets = local.common_secrets

  vpc_connector = google_vpc_access_connector.serverless.id

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "matching-engine", env = var.environment }
}

# --- apps/telemetry-processor (Pub/Sub push consumer) ---
module "service_telemetry_processor" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-telemetry-processor"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 1 # siempre activo para procesamiento real-time
  max_instances = 50
  cpu           = "2"
  memory        = "1Gi"
  concurrency   = 10 # control de rate a Firestore/BigQuery

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-telemetry-processor"
    REDIS_HOST   = google_redis_instance.main.host
    REDIS_PORT   = tostring(google_redis_instance.main.port)
  })
  secrets = local.common_secrets

  vpc_connector = google_vpc_access_connector.serverless.id

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "telemetry-processor", env = var.environment }
}

# --- apps/notification-service ---
module "service_notification" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-notification-service"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 0
  max_instances = 20

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-notification-service"
  })
  secrets = {
    WHATSAPP_ACCESS_TOKEN = google_secret_manager_secret.secrets["whatsapp-access-token"].secret_id
    WHATSAPP_APP_SECRET   = google_secret_manager_secret.secrets["whatsapp-app-secret"].secret_id
  }

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "notification-service", env = var.environment }
}

# --- apps/whatsapp-bot ---
module "service_whatsapp_bot" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-whatsapp-bot"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 1 # webhook Meta requiere respuesta rápida
  max_instances = 20

  # Thin slice (Fase 6) — además de los secrets, el bot necesita env vars
  # que apuntan al apps/api y al audience del OIDC token.
  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME      = "booster-ai-whatsapp-bot"
    API_URL           = "https://api.boosterchile.com"
    API_OIDC_AUDIENCE = "https://api.boosterchile.com"
  })

  secrets = {
    WHATSAPP_APP_SECRET           = google_secret_manager_secret.secrets["whatsapp-app-secret"].secret_id
    WHATSAPP_ACCESS_TOKEN         = google_secret_manager_secret.secrets["whatsapp-access-token"].secret_id
    WHATSAPP_PHONE_NUMBER_ID      = google_secret_manager_secret.secrets["whatsapp-phone-number-id"].secret_id
    WHATSAPP_WEBHOOK_VERIFY_TOKEN = google_secret_manager_secret.secrets["whatsapp-webhook-verify-token"].secret_id
    GEMINI_API_KEY                = google_secret_manager_secret.secrets["gemini-api-key"].secret_id
  }

  public = false # tráfico público entra via Global HTTPS LB (networking.tf); Cloud Run no acepta allUsers por org policy # webhook requiere invocación desde Meta

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "whatsapp-bot", env = var.environment }
}

# --- apps/document-service ---
module "service_document" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-document-service"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 0
  max_instances = 10
  memory        = "1Gi" # OCR puede requerir más RAM

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME      = "booster-ai-document-service"
    DOCUMENTS_BUCKET  = google_storage_bucket.documents.name
    UPLOADS_BUCKET    = google_storage_bucket.uploads_raw.name
    SIGNING_KEY_NAME  = google_kms_crypto_key.document_signing.id
  })
  secrets = merge(local.common_secrets, {
    DTE_PROVIDER_API_KEY        = google_secret_manager_secret.secrets["dte-provider-api-key"].secret_id
    DTE_PROVIDER_CLIENT_SECRET  = google_secret_manager_secret.secrets["dte-provider-client-secret"].secret_id
  })

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "document-service", env = var.environment }
}

# =============================================================================
# GKE AUTOPILOT — para telemetry-tcp-gateway (conexiones TCP persistentes)
# ADR-005: Cloud Run no sirve TCP, necesitamos K8s.
# =============================================================================

resource "google_container_cluster" "telemetry" {
  name     = "booster-ai-telemetry"
  project  = google_project.booster_ai.project_id
  location = var.region

  enable_autopilot    = true
  deletion_protection = true

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.private.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods"
    services_secondary_range_name = "gke-services"
  }

  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "10.10.0.0/20"
      display_name = "booster-ai-private-subnet"
    }
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  release_channel {
    channel = "STABLE"
  }

  workload_identity_config {
    workload_pool = "${google_project.booster_ai.project_id}.svc.id.goog"
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  resource_labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "telemetry-tcp-gateway"
  }

  depends_on = [google_project_service.apis]
}

# IP estática externa para el Network Load Balancer TCP de Teltonika
resource "google_compute_address" "telemetry_lb" {
  name    = "booster-telemetry-lb-ip"
  project = google_project.booster_ai.project_id
  region  = var.region

  description = "IP pública estática para el Network LB TCP del gateway Teltonika. Configurar esta IP en los dispositivos Teltonika."

  depends_on = [google_project_service.apis]
}
