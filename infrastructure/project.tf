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

  # Trivy IaC AVD-GCP-0050: el proyecto NO crea la default VPC. Usamos
  # google_compute_network.vpc (custom) en data.tf, no la default.
  #
  # Importante: este atributo es CREATE-time only en GCP. Cambiar de
  # default-true a false post-creacion no hace nada (la default VPC ya
  # existe si el proyecto se creo sin esta linea). Para realmente
  # eliminarla, ejecutar manualmente UNA VEZ:
  #   gcloud compute networks delete default --project=$PROJECT_ID --quiet
  #   (esto solo funciona si la default no tiene firewall rules ni VMs;
  #    en booster-ai-494222 ya esta limpia post-bootstrap).
  #
  # ignore_changes en lifecycle previene que terraform intente recrear
  # el proyecto (que ya esta creado y tiene prevent_destroy=true).
  auto_create_network = false

  # No eliminar proyecto accidentalmente
  lifecycle {
    prevent_destroy = true
    # auto_create_network es CREATE-time only — no aplicar drift
    # post-creacion. Trivy ve el atributo en codigo (alert closes).
    # billing_account: gestionado una sola vez; se ignora para (a) que el drift
    # check (#412) no falsee si var.billing_account no se provee, y (b) evitar el
    # footgun de que una var vacía intente DESVINCULAR billing del proyecto.
    ignore_changes = [auto_create_network, billing_account]
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
    "run.googleapis.com",              # Cloud Run
    "cloudbuild.googleapis.com",       # Cloud Build
    "artifactregistry.googleapis.com", # Docker images
    "container.googleapis.com",        # GKE (telemetry-tcp-gateway)
    "cloudfunctions.googleapis.com",   # Cloud Functions Gen 1 (Sprint 2c-B `beforeCreate`)

    # Data
    "sqladmin.googleapis.com",  # Cloud SQL
    "redis.googleapis.com",     # Memorystore
    "firestore.googleapis.com", # Firestore
    "bigquery.googleapis.com",  # BigQuery
    "pubsub.googleapis.com",    # Pub/Sub
    "storage.googleapis.com",   # Cloud Storage

    # Security
    "secretmanager.googleapis.com",  # Secret Manager
    "cloudkms.googleapis.com",       # KMS
    "iam.googleapis.com",            # IAM
    "iamcredentials.googleapis.com", # WIF
    "sts.googleapis.com",            # WIF Security Token Service

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
    "places-backend.googleapis.com", # Places clásica; la necesita #794
    "maps-backend.googleapis.com",   # ya habilitada a mano; reconcilia el drift

    # AI
    "generativelanguage.googleapis.com", # Gemini
    "aiplatform.googleapis.com",         # Vertex AI
    "documentai.googleapis.com",         # Document AI (OCR, ADR-007)

    # Firebase (para auth end-user)
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com", # Firebase Auth
    "fcm.googleapis.com",             # FCM push notifications

    # Networking
    "compute.googleapis.com",           # VPC, Load Balancer
    "servicenetworking.googleapis.com", # VPC peering Cloud SQL
    "vpcaccess.googleapis.com",         # Serverless VPC Access
    "dns.googleapis.com",               # Cloud DNS
    "iap.googleapis.com",               # IAP TCP forwarding (ADR-013 bastion)
    "oslogin.googleapis.com",           # OS Login (auth SSH del bastion via IAM)
    "cloudscheduler.googleapis.com",    # Cloud Scheduler (P3.d chat-whatsapp-fallback cron)

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
# Budget alerts — DESACOPLADO de Terraform (se gestiona con gcloud o consola)
# ---------------------------------------------------------------------------
# El API `billingbudgets.googleapis.com` devolvió 400 "Request contains an
# invalid argument" al crear el budget via Terraform. Causa probable, no
# verificada: la cuenta de facturación factura en CLP, el monto de un budget
# tiene que ir en la moneda de la cuenta (`gcloud billing budgets create
# --help`) y el budget se pedía en USD. Los alerts de monitoring sí están en
# Terraform.
#
# Budget vigente (actualizado por el PO el 2026-10-23):
#   - billingAccounts/019461-C73CDE-DCE377/budgets/d3604cde-159e-439c-895f-fe16a7c5b4cd
#   - Nombre: "Booster GCP mensual (CLP 450.000)"
#   - Alcance: toda la cuenta de facturación, mes calendario
#   - Monto: CLP 450.000
#   - Umbrales: 50 %, 90 % y 100 % del gasto real
#
# Para cambiarlo:
#   gcloud billing budgets update \
#     billingAccounts/019461-C73CDE-DCE377/budgets/d3604cde-159e-439c-895f-fe16a7c5b4cd \
#     --billing-project=booster-ai-494222 --budget-amount=450000CLP \
#     --clear-threshold-rules --add-threshold-rule=percent=0.5 \
#     --add-threshold-rule=percent=0.9 --add-threshold-rule=percent=1.0
# `percent` va como fracción (1.0 = 100 %) aunque la ayuda de `update` diga
# entero de 0 a 100: gcloud lo pasa tal cual a `thresholdPercent`.
#
# var.monthly_budget_usd no crea ni cambia este budget: solo alimenta la
# pestaña Forecast del dashboard (MONTHLY_BUDGET_USD × dólar del día). Si
# cambia el monto de arriba, actualizar también su equivalente en USD.
# Tracking: Booster AI backlog #BUDGET-001.
# ---------------------------------------------------------------------------
