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
# ACCESS LOGS — Trivy IaC AVD-GCP-0002 ("Bucket Logging Not Enabled")
# =============================================================================
# Bucket dedicado para Cloud Storage access logs. Recibe logs de todos
# los buckets via logging.log_bucket en cada fuente. Itself NO tiene logging
# habilitado (avoid recursion + Trivy lo respeta para self-hosted log buckets).
#
# Storage class NEARLINE: logs son write-once / read-rare; NEARLINE es 50%
# mas barato que STANDARD ($0.01/GB/mo vs $0.020/GB/mo en us regions) y
# mantiene latency aceptable para auditoria.
#
# Lifecycle 90d: post-incident forensics necesita ~30-60d de logs. 90d da
# margen sin crecer ilimitado.
resource "google_storage_bucket" "access_logs" {
  name          = "${var.project_id}-access-logs-${var.environment}"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "NEARLINE"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Trivy IaC AVD-GCP-0066 (CMEK + versioning): cifrado en reposo con key
  # operacional compartida + versioning para recovery de logs accidentalmente
  # borrados. Logs son evidencia forense — un atacante con write podria
  # intentar borrar trazas (defense-in-depth aunque IAM lo bloquee).
  # Disable-key en KMS = kill-switch instantaneo en caso de exfiltracion.
  encryption {
    default_kms_key_name = google_kms_crypto_key.storage_operational.id
  }

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  # Versiones archivadas (post-delete) -> 7 dias extra y borran. Suficiente
  # para detectar y recuperar deletions accidentales sin acumular costo.
  lifecycle_rule {
    condition {
      age        = 7
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "access-logs"
  }
}

# IAM: cloud-storage-analytics@google.com es el SA bien-conocido que GCS
# usa internamente para escribir logs de acceso. Necesita legacyBucketWriter
# en el log bucket (no objectAdmin a nivel proyecto, que seria over-grant).
# Ref: https://cloud.google.com/storage/docs/access-logs#delivery
resource "google_storage_bucket_iam_member" "access_logs_writer" {
  bucket = google_storage_bucket.access_logs.name
  role   = "roles/storage.legacyBucketWriter"
  member = "group:cloud-storage-analytics@google.com"
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

  # Trivy IaC AVD-GCP-0002: access logs delivered al bucket dedicado.
  logging {
    log_bucket        = google_storage_bucket.access_logs.name
    log_object_prefix = "documents/"
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

  # Trivy IaC AVD-GCP-0066: CMEK con key operacional compartida.
  encryption {
    default_kms_key_name = google_kms_crypto_key.storage_operational.id
  }

  # Trivy IaC AVD-GCP-0002: access logs.
  logging {
    log_bucket        = google_storage_bucket.access_logs.name
    log_object_prefix = "uploads-raw/"
  }

  # Trivy IaC: versioning habilitado para recovery de delete accidental.
  # Lifecycle inmediato debajo limita costo extra de versiones archivadas.
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete" # raw uploads se procesan y mueven a bucket definitivo
    }
  }

  # Versiones archivadas (post-delete) → expiran 7 días después.
  # Suficiente para deshacer un delete accidental sin acumular costo.
  lifecycle_rule {
    condition {
      age        = 7
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
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

  # Trivy IaC AVD-GCP-0066: CMEK con key operacional compartida.
  # Aunque los assets son publicos (servidos al PWA), el cifrado en reposo
  # con CMEK satisface compliance estandar y permite revocacion rapida via
  # disable-key si se detecta exfiltracion.
  encryption {
    default_kms_key_name = google_kms_crypto_key.storage_operational.id
  }

  # Trivy IaC AVD-GCP-0002: access logs.
  logging {
    log_bucket        = google_storage_bucket.access_logs.name
    log_object_prefix = "public-assets/"
  }

  # Trivy IaC: versioning habilitado. Assets estáticos del sitio marketing
  # — versionado permite rollback rápido si subimos un asset roto.
  # Sin lifecycle de archivadas → quedan acumulándose; manualmente prunable.
  versioning {
    enabled = true
  }

  # Versiones archivadas viejas → expiran 30 días después para evitar
  # crecimiento ilimitado. 30d permite rollback durante una semana o dos.
  lifecycle_rule {
    condition {
      age        = 30
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

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

# =============================================================================
# CHAT ATTACHMENTS — fotos del chat shipper↔transportista (P3)
# =============================================================================
# Bucket privado para fotos enviadas por mensajes de chat. El api emite
# signed URLs de 5 min para upload (PUT) y download (READ) — el bucket
# nunca se expone público. Lifecycle de 90 días: las fotos del chat son
# operacionales (confirmaciones de entrega, reportes de problema), no
# evidencia legal — TTL corto controla costo y aplica privacidad por
# default (los datos se borran solos pasada la operación del viaje).
resource "google_storage_bucket" "chat_attachments" {
  name          = "${var.project_id}-chat-attachments-${var.environment}"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Trivy IaC AVD-GCP-0066: CMEK con key operacional compartida. Importante
  # para chat attachments porque contiene PII (fotos del chat shipper-carrier).
  # Disable-key en KMS revoca acceso instantaneo en caso de breach.
  encryption {
    default_kms_key_name = google_kms_crypto_key.storage_operational.id
  }

  # Trivy IaC AVD-GCP-0002: access logs (importante por PII — auditoria
  # de quien accede a fotos del chat).
  logging {
    log_bucket        = google_storage_bucket.access_logs.name
    log_object_prefix = "chat-attachments/"
  }

  # Trivy IaC: versioning habilitado para recovery de delete accidental
  # de fotos del chat. Versiones archivadas se purgan a los 7 días para
  # mantener el TTL de 90d alineado con privacy-by-default.
  versioning {
    enabled = true
  }

  # Versiones archivadas (post-delete o post-90d) → 7 días extra y borran.
  lifecycle_rule {
    condition {
      age        = 7
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # Lifecycle: borrar objetos a los 90 días. Mensajes texto/ubicacion en
  # DB se preservan; las fotos en GCS son las únicas que expiran.
  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  # CORS: el upload es PUT directo desde browser via signed URL. El
  # response del PUT no necesita ser leído por la PWA, pero los headers
  # CORS del bucket tienen que aceptar el origin del PWA + métodos PUT
  # y GET (por las dudas a futuro). Sin esto el browser rechaza el PUT
  # con net::ERR_FAILED por preflight failure.
  cors {
    origin          = ["https://app.boosterchile.com", "http://localhost:5173"]
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type", "Content-MD5", "x-goog-content-length-range"]
    max_age_seconds = 3600
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "chat-attachments"
  }

  depends_on = [google_project_service.apis]
}

# Cloud Run runtime SA necesita read+write para emitir signed URLs y
# leer las fotos al servir el download. roles/storage.objectAdmin sobre
# este bucket específico (no project-wide).
resource "google_storage_bucket_iam_member" "chat_attachments_runtime" {
  bucket = google_storage_bucket.chat_attachments.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# =============================================================================
# Public assets bucket — ADR-039 Site Settings Runtime Configuration
# =============================================================================
#
# Bucket público (read CDN-cached) para assets editables desde Site
# Settings Editor: logos, favicons, imágenes de marca subidas por el
# platform-admin desde /app/platform-admin/site-settings.
#
# Write restringido al SA del Cloud Run api; read público vía
# storage.googleapis.com (sin signed URLs, máxima cacheabilidad CDN).

resource "google_storage_bucket" "public_assets" {
  name                        = "booster-ai-public-assets-${var.environment}"
  project                     = google_project.booster_ai.project_id
  location                    = "US" # multi-region para edges CDN globales
  uniform_bucket_level_access = true
  force_destroy               = false

  cors {
    origin = [
      "https://app.${var.domain}",
      "https://demo.${var.domain}",
      "https://${var.domain}",
      "https://www.${var.domain}",
      "http://localhost:5173",
    ]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Cache-Control"]
    max_age_seconds = 3600
  }

  versioning {
    enabled = true
  }

  # Mantener últimas 5 versiones de cada objeto (rollback rápido si un
  # logo se reemplaza por error).
  lifecycle_rule {
    condition {
      num_newer_versions = 5
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "public-assets-site-settings"
  }

  depends_on = [google_project_service.apis]
}

# Read público — cualquier visitante puede descargar los assets vía CDN.
resource "google_storage_bucket_iam_member" "public_assets_public_read" {
  bucket = google_storage_bucket.public_assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Write para el Cloud Run runtime SA — usado por POST /admin/site-settings/assets.
resource "google_storage_bucket_iam_member" "public_assets_runtime_admin" {
  bucket = google_storage_bucket.public_assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}
