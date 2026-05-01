# Cloud Run services + GKE Autopilot (para TCP gateway Teltonika).
# Los Cloud Run arrancan con imagen placeholder — CI/CD los actualiza después.

# =============================================================================
# CLOUD RUN SERVICES (via módulo reusable)
# =============================================================================

locals {
  common_env_vars = {
    NODE_ENV             = var.environment == "prod" ? "production" : "staging"
    LOG_LEVEL            = "info"
    GOOGLE_CLOUD_PROJECT = var.project_id
    SERVICE_VERSION      = "0.0.0"
    # Memorystore Redis — compartido entre services para conversation store +
    # caching de OIDC tokens + rate limiting. Privado por VPC con AUTH +
    # transit encryption (SERVER_AUTHENTICATION) requeridos.
    REDIS_HOST     = google_redis_instance.main.host
    REDIS_PORT     = tostring(google_redis_instance.main.port)
    REDIS_PASSWORD = google_redis_instance.main.auth_string
    REDIS_TLS      = "true"
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

  # URLs *.run.app de los Cloud Run services — audience canónica para tráfico
  # interno Cloud Run-to-Cloud Run (el caller arma un OIDC token con audience
  # = la URL del service que va a invocar, y Google la valida contra esta
  # config). Cloud Run nombra cada service como
  # https://<service-name>-<project-number>.<region>.run.app.
  cloud_run_api_url = "https://booster-ai-api-${google_project.booster_ai.number}.${var.region}.run.app"
  cloud_run_bot_url = "https://booster-ai-whatsapp-bot-${google_project.booster_ai.number}.${var.region}.run.app"

  # URL pública canónica del api (post-migración DNS GoDaddy → Cloud DNS).
  # Usada como audience primaria del OIDC token desde el bot, y como webhook
  # URL configurada en Twilio Sender. El LB global rutea api.boosterchile.com
  # al backend del api (y /webhooks/whatsapp* al backend del bot — ver
  # url_map en networking.tf).
  public_api_url = "https://api.${var.domain}"
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
    SERVICE_NAME        = "booster-ai-api"
    FIREBASE_PROJECT_ID = var.project_id
    # API_AUDIENCE valida los OIDC tokens entrantes. CSV de URLs aceptadas
    # como diseño permanente:
    #   - cloud_run_api_url (*.run.app): tráfico interno Cloud Run-to-Cloud Run
    #     (bot → api). Es el camino canónico — bypass del LB, sin Cloud Armor.
    #   - public_api_url (api.boosterchile.com): por si un caller futuro entra
    #     vía LB y necesita autenticarse con OIDC contra el api (ej. backend
    #     externo que solo conoce la URL pública).
    # Hoy en producción solo el bot llama, y va por *.run.app. La pública
    # queda aceptada defensivamente — su costo es 0 y abre la opción sin
    # tener que modificar el middleware después.
    API_AUDIENCE         = "${local.public_api_url},${local.cloud_run_api_url}"
    ALLOWED_CALLER_SA    = google_service_account.cloud_run_runtime.email
    CORS_ALLOWED_ORIGINS = "${local.public_api_url},https://${var.domain},https://marketing.${var.domain},${local.cloud_run_api_url}"

    # B.8 — dispatcher de notificaciones WhatsApp post-matching.
    # El api comparte el mismo Sender (+19383365293) que el bot — Twilio
    # identifica el sender por From + auth, así que ambos servicios pueden
    # mandar mensajes desde el mismo número. TWILIO_AUTH_TOKEN va por
    # Secret Manager (mismo secret `twilio-auth-token` que el bot).
    TWILIO_FROM_NUMBER    = var.twilio_from_number
    # CONTENT_SID_OFFER_NEW: vacío hasta que Meta apruebe el template
    # `offer_new_v1` (24-48h tras submit en Twilio Console). Mientras esté
    # vacío, el dispatcher loguea warn y skipea — las offers siguen
    # creándose en DB y aparecen en /app/ofertas via poll cada 30s.
    # Setear con `terraform apply -var content_sid_offer_new=HX...` una
    # vez aprobado.
    CONTENT_SID_OFFER_NEW = var.content_sid_offer_new
    # WEB_APP_URL usa el dominio público del frontend para construir el
    # deep-link al dashboard en el template de WhatsApp.
    WEB_APP_URL           = "https://app.${var.domain}"
  })
  secrets = merge(local.common_secrets, {
    # Mismo secret que el bot — un solo lugar de verdad para rotaciones.
    # El SA del Cloud Run del api tiene secretAccessor sobre todo el set
    # vía security.tf, así que no hace falta IAM extra.
    TWILIO_ACCOUNT_SID = google_secret_manager_secret.secrets["twilio-account-sid"].secret_id
    TWILIO_AUTH_TOKEN  = google_secret_manager_secret.secrets["twilio-auth-token"].secret_id
  })

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

  # Notification-service es stub hasta que tenga implementación. NO monta
  # secrets de Meta WhatsApp Cloud API (deprecated post-Fase 6.4 — el envío
  # de mensajes WA va via Twilio en el bot). Cuando se implemente, montar los
  # secrets que realmente use (probablemente Twilio + email/SMS providers).
  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-notification-service"
  })

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

  # Fase 6.4 — bot migró a Twilio API (el número +1 938-336-5293 está en Twilio).
  # TWILIO_ACCOUNT_SID y TWILIO_FROM_NUMBER son env vars; TWILIO_AUTH_TOKEN
  # va por Secret Manager.
  #
  # TWILIO_WEBHOOK_URL debe coincidir EXACTAMENTE con la URL configurada en
  # Twilio console (porque Twilio firma con la URL). Post-migración DNS, la
  # URL canónica es https://api.boosterchile.com/webhooks/whatsapp — el LB
  # global rutea ese path al bot (ver url_map.path_matcher "api" en
  # networking.tf).
  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME      = "booster-ai-whatsapp-bot"
    # Tráfico interno bot → api: usar *.run.app directo (NO el LB público).
    # Razones:
    #   1. El LB tiene Cloud Armor con scannerdetection-v33-stable que falsea
    #      positivo con bodies del api (contienen JSON con identifiers que el
    #      WAF confunde con scanner output) → 403 desde el WAF.
    #   2. *.run.app es el canal canónico Cloud Run-to-Cloud Run, autenticado
    #      via OIDC token con audience = URL del service. Cero hops adicionales,
    #      cero costo de LB, cero falsos positivos del WAF.
    # Solo Twilio (caller externo, no controlado) entra por el LB público.
    API_URL           = local.cloud_run_api_url
    API_OIDC_AUDIENCE = local.cloud_run_api_url
    # TWILIO_FROM_NUMBER: variable porque cambia entre sandbox y producción.
    # Sandbox compartido (+14155238886) hasta que +19383365293 esté
    # registrado como WhatsApp Sender via Meta business verification (runbook
    # docs/runbooks/twilio-sender-registration.md).
    TWILIO_FROM_NUMBER = var.twilio_from_number
    # TWILIO_WEBHOOK_URL debe matchear EXACTAMENTE la URL configurada en
    # Twilio Sender (Inbound URL) porque la firma X-Twilio-Signature se
    # computa sobre esta URL + sorted body params. Si no coincide → 403.
    # Post-migración: api.boosterchile.com (LB rutea /webhooks/whatsapp* al
    # backend del bot via url_map.path_matcher en networking.tf).
    TWILIO_WEBHOOK_URL = "${local.public_api_url}/webhooks/whatsapp"
  })

  secrets = {
    TWILIO_ACCOUNT_SID = google_secret_manager_secret.secrets["twilio-account-sid"].secret_id
    TWILIO_AUTH_TOKEN  = google_secret_manager_secret.secrets["twilio-auth-token"].secret_id
    GEMINI_API_KEY     = google_secret_manager_secret.secrets["gemini-api-key"].secret_id
  }

  # Necesario para llegar a Redis (172.25.0.4) que vive en VPC privado.
  # Sin esto, las conexiones a Memorystore Redis fallan con ETIMEDOUT.
  vpc_connector = google_vpc_access_connector.serverless.id

  public = true # webhook público — Twilio postea sin IAM; el bot valida X-Twilio-Signature

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
