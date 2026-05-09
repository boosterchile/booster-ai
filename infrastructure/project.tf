# Proyecto GCP, billing, APIs y budgets.

resource "google_project" "booster_ai" {
  name            = "Booster AI"
  project_id      = var.project_id
  billing_account = var.billing_account
  org_id          = var.organization_id
  labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = "booster-ai" # label corto (slug del producto), no el project_id
  }

  # No eliminar proyecto accidentalmente
  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Audit Logs — Trivy IaC AVD-GCP-0029 ("IAM Audit Not Properly Configured")
# ---------------------------------------------------------------------------
# Habilitamos los 3 tipos de Data Access logs para allServices a nivel
# proyecto. Esto da visibilidad completa de quien hace que con que recurso
# (ADMIN_READ + DATA_READ + DATA_WRITE), critico para forensics + compliance.
#
# Costo: Cloud Logging cobra ~$0.50/GB ingest. Servicios de alto volumen
# (Storage GETs, BigQuery reads) pueden inflar la factura. Si crece mucho,
# considerar:
#   - Exclusion filter en Logs Router para servicios specificos
#   - Sink a BigQuery con TTL corto vs Cloud Logging retention default
#   - Bajar a solo ADMIN_* + DATA_WRITE (skip DATA_READ, el mas verboso)
#
# Por ahora full enable porque el volumen del piloto es manejable.
resource "google_project_iam_audit_config" "all_services" {
  project = google_project.booster_ai.project_id
  service = "allServices"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}

# ---------------------------------------------------------------------------
# APIs habilitadas — mínimo necesario para todo el stack
# ---------------------------------------------------------------------------
locals {
  required_apis = [
    # Core compute
    "run.googleapis.com",                 # Cloud Run
    "cloudbuild.googleapis.com",          # Cloud Build
    "artifactregistry.googleapis.com",    # Docker images
    "container.googleapis.com",           # GKE (telemetry-tcp-gateway)

    # Data
    "sqladmin.googleapis.com",            # Cloud SQL
    "redis.googleapis.com",               # Memorystore
    "firestore.googleapis.com",           # Firestore
    "bigquery.googleapis.com",            # BigQuery
    "pubsub.googleapis.com",              # Pub/Sub
    "storage.googleapis.com",             # Cloud Storage

    # Security
    "secretmanager.googleapis.com",       # Secret Manager
    "cloudkms.googleapis.com",            # KMS
    "iam.googleapis.com",                 # IAM
    "iamcredentials.googleapis.com",      # WIF
    "sts.googleapis.com",                 # WIF Security Token Service

    # Observability
    "logging.googleapis.com",             # Cloud Logging
    "monitoring.googleapis.com",          # Cloud Monitoring
    "cloudtrace.googleapis.com",          # Cloud Trace
    "cloudprofiler.googleapis.com",       # Cloud Profiler
    "clouderrorreporting.googleapis.com", # Error Reporting

    # Maps Platform (ADR-009 del 2.0 aplicado aquí)
    "routes.googleapis.com",
    "routeoptimization.googleapis.com",
    "addressvalidation.googleapis.com",
    # "fleetengine.googleapis.com",  # Google exige 20K viajes/mes mínimos + acuerdo comercial.
    #                                  Reemplazado 1:1 por arquitectura propia en ADR-005 amendment v2:
    #                                  Teltonika + Pub/Sub + Firestore + BigQuery + Redis + Routes API v2.
    #                                  Re-evaluar cuando Booster AI supere el umbral de volumen.
    "geocoding-backend.googleapis.com",
    "elevation-backend.googleapis.com",
    "places.googleapis.com",

    # AI
    "generativelanguage.googleapis.com",  # Gemini
    "aiplatform.googleapis.com",          # Vertex AI
    "documentai.googleapis.com",          # Document AI (OCR, ADR-007)

    # Firebase (para auth end-user)
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",     # Firebase Auth
    "fcm.googleapis.com",                 # FCM push notifications

    # Networking
    "compute.googleapis.com",             # VPC, Load Balancer
    "servicenetworking.googleapis.com",   # VPC peering Cloud SQL
    "vpcaccess.googleapis.com",           # Serverless VPC Access
    "dns.googleapis.com",                 # Cloud DNS
    "iap.googleapis.com",                 # IAP TCP forwarding (ADR-013 bastion)
    "oslogin.googleapis.com",             # OS Login (auth SSH del bastion via IAM)
    "cloudscheduler.googleapis.com",      # Cloud Scheduler (P3.d chat-whatsapp-fallback cron)

    # Billing
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",

    # Org Policy (para overrides a nivel proyecto, ver org-policies.tf)
    "orgpolicy.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)

  project = google_project.booster_ai.project_id
  service = each.value

  disable_on_destroy         = false
  disable_dependent_services = false
}

# ---------------------------------------------------------------------------
# Budget alerts — DESACOPLADO de Terraform (runbook POST-APPLY)
# ---------------------------------------------------------------------------
# El API `billingbudgets.googleapis.com` devolvió 400 "Request contains an
# invalid argument" de forma opaca al crear el budget via Terraform, incluso
# con la configuración mínima válida según la doc del provider. El budget
# no es crítico para el funcionamiento del stack (los alerts de monitoring
# sí están en Terraform), por lo que se crea manualmente una sola vez:
#
#   Console GCP → Billing → Budgets & alerts → CREATE BUDGET
#     - Name: "Booster AI — prod"
#     - Scope: Project booster-ai-494222
#     - Amount: 500 USD (valor de var.monthly_budget_usd)
#     - Thresholds: 50%, 90%, 100%
#     - Notifications: email a dev@boosterchile.com
#
# Si el API deja de rechazar en el futuro, codificar el budget aquí de nuevo
# y remover este bloque. Tracking: Booster AI backlog #BUDGET-001.
# ---------------------------------------------------------------------------
