# Cloud Storage buckets + Artifact Registry.
# Documentos SII tienen Retention Lock 6 años (ADR-007).

# =============================================================================
# ARTIFACT REGISTRY — imágenes Docker de todas las apps
# =============================================================================

resource "google_artifact_registry_repository" "containers" {
  repository_id = "containers"
  project       = google_project.booster_ai.project_id
  location      = var.region
  format        = "DOCKER"
  description   = "Imágenes Docker de todos los apps Booster AI"

  cleanup_policies {
    id     = "keep-last-20-per-tag"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  cleanup_policies {
    id     = "delete-untagged-after-30d"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s" # 30 días
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }

  depends_on = [google_project_service.apis]
}

# =============================================================================
# BUCKETS
# =============================================================================

# Documentos SII + Carta Porte + Actas + firmas + fotos (ADR-007)
# Retention Lock 6 años + CMEK + versioning
resource "google_storage_bucket" "documents" {
  name          = "${var.project_id}-documents-${var.environment}"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.documents.id
  }

  # Retention Lock 6 años (SII Chile)
  retention_policy {
    retention_period = 189216000 # 6 años en segundos = 6 * 365.25 * 24 * 3600
    is_locked        = false     # CAMBIAR A true MANUALMENTE después de validar
  }

  lifecycle_rule {
    condition {
      age = 730 # 2 años
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 1460 # 4 años
    }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    compliance = "sii-6-anos"
  }

  depends_on = [google_kms_crypto_key_iam_member.gcs_encrypter]

  lifecycle {
    prevent_destroy = true
  }
}

# Bucket para uploads de documentos externos (facturas combustible, etc.) pre-OCR
resource "google_storage_bucket" "uploads_raw" {
  name          = "${var.project_id}-uploads-raw-${var.environment}"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete" # raw uploads se procesan y mueven a bucket definitivo
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

# Bucket para assets estáticos públicos (marketing site)
resource "google_storage_bucket" "public_assets" {
  name          = "${var.project_id}-public-assets-${var.environment}"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }

  cors {
    origin          = ["https://${var.domain}", "https://www.${var.domain}", "https://app.${var.domain}"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    visibility = "public"
  }
}

# Binding público del bucket public_assets deshabilitado por Organization Policy
# `iam.allowedPolicyMemberDomains` que bloquea allUsers. La arquitectura comercial
# sirve los assets estáticos desde apps/marketing (Next.js) sobre Cloud Run con CDN,
# no requiere bucket público. Esta es la práctica recomendada para TRL 10
# (un bucket público sería superficie de ataque innecesaria).
#
# Si en el futuro se necesita CDN→bucket directo, resolver org policy
# primero con un org admin: crear exception en el constraint para este bucket
# específico, o usar un dominio bajo tu customer.
#
# resource "google_storage_bucket_iam_member" "public_assets_reader" {
#   bucket = google_storage_bucket.public_assets.name
#   role   = "roles/storage.objectViewer"
#   member = "allUsers"
# }
