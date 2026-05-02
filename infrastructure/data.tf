# Data layer — Cloud SQL (Postgres), Memorystore (Redis), Firestore, BigQuery.

# =============================================================================
# VPC — necesario para peering con Cloud SQL privada
# =============================================================================

resource "google_compute_network" "vpc" {
  name                    = "booster-ai-vpc"
  project                 = google_project.booster_ai.project_id
  auto_create_subnetworks = false

  depends_on = [google_project_service.apis]
}

resource "google_compute_subnetwork" "private" {
  name          = "booster-ai-private"
  project       = google_project.booster_ai.project_id
  ip_cidr_range = "10.10.0.0/20"
  region        = var.region
  network       = google_compute_network.vpc.id

  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "gke-pods"
    ip_cidr_range = "10.20.0.0/14"
  }

  secondary_ip_range {
    range_name    = "gke-services"
    ip_cidr_range = "10.24.0.0/20"
  }
}

# VPC peering range para Cloud SQL privada
resource "google_compute_global_address" "private_services" {
  name          = "booster-ai-private-services"
  project       = google_project.booster_ai.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

# Serverless VPC Access para que Cloud Run pueda llegar a Cloud SQL privada + Redis.
# Instance-based sizing (moderno). `throughput` es legacy y conflictúa con `instances`.
resource "google_vpc_access_connector" "serverless" {
  name          = "booster-serverless-vpc"
  project       = google_project.booster_ai.project_id
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"
  min_instances = 2
  max_instances = 10

  depends_on = [google_project_service.apis]
}

# =============================================================================
# CLOUD SQL — PostgreSQL 16 con HA regional
# =============================================================================

resource "random_id" "cloudsql_suffix" {
  byte_length = 4
}

resource "google_sql_database_instance" "main" {
  name             = "booster-ai-pg-${random_id.cloudsql_suffix.hex}"
  project          = google_project.booster_ai.project_id
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = true

  settings {
    tier              = var.cloudsql_tier
    edition           = "ENTERPRISE" # ENTERPRISE_PLUS requiere tiers dedicados (db-perf-optimized-*); ENTERPRISE es el default comercial.
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 50 # GB inicial
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      start_time                     = "06:00" # 06:00 UTC = 03:00 Chile
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.cloudsql_backup_retention_days
      }
    }

    ip_configuration {
      ipv4_enabled    = false # solo IP privada
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    database_flags {
      name  = "log_statement"
      value = "ddl" # audit de schema changes
    }

    # Habilita IAM database authentication. Permite que users / SAs IAM
    # se conecten via cloud-sql-proxy --auto-iam-authn sin password,
    # autenticando con OAuth tokens. Reemplaza el modelo password-based
    # para operadores humanos (devs ops, db admins). El password-based
    # `booster_app` se mantiene para que los Cloud Run services usen
    # DATABASE_URL clásico via Secret Manager.
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false # PII: no loguear IPs
    }

    maintenance_window {
      day          = 7 # Domingo
      hour         = 5 # 05:00 UTC = 02:00 Chile
      update_track = "stable"
    }

    user_labels = {
      env        = var.environment
      managed_by = "terraform"
    }
  }

  depends_on = [google_service_networking_connection.private_vpc]

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [settings[0].disk_size] # autoresize maneja esto
  }
}

resource "google_sql_database" "booster_ai" {
  name     = "booster_ai"
  instance = google_sql_database_instance.main.name
  project  = google_project.booster_ai.project_id
}

resource "random_password" "pg_app_password" {
  # 32 chars, ~190 bits entropía con este alfabeto (62 alphanum + 4 safe).
  # `override_special` restringe los specials a chars URL-safe (RFC 3986
  # unreserved + algunos sub-delims sin riesgo) — evita que `urlencode()`
  # del DATABASE_URL produzca `%XX` que algunos drivers Postgres (notablemente
  # `pg` de Node) NO decodifican antes de pasar el password a Postgres,
  # causando `password authentication failed`. Excluidos a propósito:
  #   : / ? # @ & = % + " ' \ space  → rompen URL parser
  #   $ ^ * ( ) [ ] { } < > , ;       → ambiguos según driver
  length           = 32
  special          = true
  override_special = "!-_.~"
}

resource "google_sql_user" "app" {
  name     = "booster_app"
  instance = google_sql_database_instance.main.name
  project  = google_project.booster_ai.project_id
  password = random_password.pg_app_password.result
}

# IAM users con acceso a la DB. Cada operador agregar su email acá.
# Conexión via cloud-sql-proxy --auto-iam-authn (sin password).
# El postgres role que se crea tiene el mismo nombre que el email truncado
# (ver Cloud SQL docs). Por defecto solo CONNECT a la DB; permisos extra
# se asignan via GRANT directo en SQL una vez creado.
locals {
  db_iam_operators = [
    "dev@boosterchile.com",
  ]
}

resource "google_sql_user" "iam_operators" {
  for_each = toset(local.db_iam_operators)
  name     = each.value
  type     = "CLOUD_IAM_USER"
  instance = google_sql_database_instance.main.name
  project  = google_project.booster_ai.project_id
  # Sin password: autenticación via IAM token.
}

resource "google_project_iam_member" "db_iam_operators_client" {
  for_each = toset(local.db_iam_operators)
  project  = google_project.booster_ai.project_id
  role     = "roles/cloudsql.client"
  member   = "user:${each.value}"
}

resource "google_project_iam_member" "db_iam_operators_instanceuser" {
  for_each = toset(local.db_iam_operators)
  project  = google_project.booster_ai.project_id
  role     = "roles/cloudsql.instanceUser"
  member   = "user:${each.value}"
}

# Guardar password en Secret Manager (rotación posterior vía otro flujo).
#
# urlencode() en el password evita que chars reservados de URL (`:`, `?`,
# `*`, `}`, etc.) rompan el parser zod del API. libpq decodifica el
# percent-encoding al leer la URL, así que Cloud SQL sigue autenticando
# contra el password literal sin cambios.
#
# uselibpqcompat=true&sslmode=require: pg v9+/pg-connection-string v3+
# tratan `sslmode=require` como `verify-full` (validación estricta del CA),
# pero Cloud SQL usa un CA interno que no está en el trust store de Node →
# UNABLE_TO_VERIFY_LEAF_SIGNATURE. Con `uselibpqcompat=true` el driver
# vuelve a la semántica clásica de libpq (encrypted-but-unverified), que
# es aceptable porque la conexión va por VPC privada hacia Cloud SQL.
# Para verify-full real habría que montar el server CA de Cloud SQL como
# secret y pasar sslrootcert= — task de hardening pendiente (#TODO).
resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.secrets["database-url"].id
  secret_data = format(
    "postgresql://%s:%s@%s:5432/%s?sslmode=require&uselibpqcompat=true",
    google_sql_user.app.name,
    urlencode(random_password.pg_app_password.result),
    google_sql_database_instance.main.private_ip_address,
    google_sql_database.booster_ai.name,
  )
}

# =============================================================================
# MEMORYSTORE REDIS
# =============================================================================

resource "google_redis_instance" "main" {
  name           = "booster-ai-redis"
  project        = google_project.booster_ai.project_id
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_gb
  region         = var.region
  redis_version  = "REDIS_7_2"

  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 5
        minutes = 0
      }
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }

  depends_on = [google_service_networking_connection.private_vpc]
}

# =============================================================================
# FIRESTORE — Native mode, para real-time sync (ADR-005)
# =============================================================================

resource "google_firestore_database" "default" {
  project     = google_project.booster_ai.project_id
  name        = "(default)"
  location_id = "southamerica-east1" # Firestore no tiene región Chile, más cercana es SP
  type        = "FIRESTORE_NATIVE"

  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  deletion_policy                   = "DELETE_PROTECTION_ENABLED"

  depends_on = [google_project_service.apis]
}

# =============================================================================
# BIGQUERY — Datasets para telemetría, ESG, matching, observatorio
# =============================================================================

resource "google_bigquery_dataset" "telemetry" {
  dataset_id  = "telemetry"
  project     = google_project.booster_ai.project_id
  location    = var.region
  description = "Telemetría histórica de vehículos Teltonika (ADR-005)"

  default_table_expiration_ms = null # retención indefinida, gestionada por queries
  delete_contents_on_destroy  = false

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

resource "google_bigquery_dataset" "esg_analytics" {
  dataset_id  = "esg_analytics"
  project     = google_project.booster_ai.project_id
  location    = var.region
  description = "Métricas ESG GLEC v3.0 + certificados emitidos"

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

resource "google_bigquery_dataset" "matching" {
  dataset_id  = "matching"
  project     = google_project.booster_ai.project_id
  location    = var.region
  description = "Decisiones del matching engine — auditabilidad (ADR-004)"

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

resource "google_bigquery_dataset" "observatory" {
  dataset_id  = "observatory"
  project     = google_project.booster_ai.project_id
  location    = var.region
  description = "Observatorio urbano de flujos de transporte (ADR-012)"

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

resource "google_bigquery_dataset" "audit" {
  dataset_id  = "audit"
  project     = google_project.booster_ai.project_id
  location    = var.region
  description = "Audit log estructurado (ADR-011). Retención 7 años."

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}
