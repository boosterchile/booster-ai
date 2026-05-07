# Wave 2 — Track B3: Crash Trace forensics storage.
#
# Cuando el device FMC150 detecta un Crash (eventIoId=247 priority=panic),
# el gateway publica el AVL packet completo (~1000 records) al topic
# `crash-traces`. El telemetry-processor lo consume, llama
# `extractCrashTrace()`, y persiste:
#
#   - Archivo JSON con el trace forense → GCS bucket dedicado
#     (CMEK + retention 7 años para compliance aseguradora).
#   - Fila índice en BigQuery `telemetry.crash_events` (partitioned by
#     fecha, clustered by vehicle_id) para query y dashboards.
#
# La métrica `crash_trace_persistence_failures` dispara alerta P0 si
# algún Crash Trace falla repetidamente (5 fallos consecutivos al DLQ
# = el processor no logra escribir; carriers grandes esperan que esto
# nunca pase).

# =============================================================================
# KMS — clave dedicada para CMEK del bucket crash-traces
# =============================================================================
# Separada del KMS de documentos para minimizar blast radius si una
# rotación o compromiso de clave afecta una sola categoría de datos.

resource "google_kms_crypto_key" "crash_traces" {
  name     = "crash-traces-cmek"
  key_ring = google_kms_key_ring.main.id
  purpose  = "ENCRYPT_DECRYPT"

  rotation_period = "7776000s" # 90 días

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "crash-trace-encryption"
    wave       = "2"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Permitir que la SA del Cloud Storage encrypter use la clave.
resource "google_kms_crypto_key_iam_member" "crash_traces_gcs_encrypter" {
  crypto_key_id = google_kms_crypto_key.crash_traces.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${google_project.booster_ai.number}@gs-project-accounts.iam.gserviceaccount.com"
}

# =============================================================================
# GCS BUCKET — booster-crash-traces-{env}
# =============================================================================

resource "google_storage_bucket" "crash_traces" {
  name          = "${var.project_id}-crash-traces-${var.environment}"
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.crash_traces.id
  }

  # Retention 7 años — requisito aseguradora + compliance forense.
  retention_policy {
    retention_period = 220752000 # 7 años en segundos = 7 * 365.25 * 24 * 3600
    is_locked        = false     # CAMBIAR A true MANUALMENTE post-validación
  }

  # Lifecycle: NEARLINE a los 30 días (raramente se accede), ARCHIVE
  # al año (compliance pero acceso esporádico).
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
    compliance = "forensics-7-anos"
  }

  depends_on = [google_kms_crypto_key_iam_member.crash_traces_gcs_encrypter]

  lifecycle {
    prevent_destroy = true
  }
}

# =============================================================================
# Pub/Sub topic + subscription — crash-traces
# =============================================================================

resource "google_pubsub_topic" "crash_traces" {
  name    = "crash-traces"
  project = google_project.booster_ai.project_id

  # 7 días de retention en el broker — aseguramos que un crash trace no se
  # pierda si el processor está caído por horas.
  message_retention_duration = "604800s"

  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
    purpose    = "crash-forensics"
  }

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_subscription" "crash_traces_processor" {
  name    = "crash-traces-processor-sub"
  topic   = google_pubsub_topic.crash_traces.name
  project = google_project.booster_ai.project_id

  # 5 minutos: upload GCS + insert BQ pueden tardar hasta 30s en p99.
  # Margen amplio para que el processor no NACK por timeout artificial.
  ack_deadline_seconds = 300

  # Retention en la subscription = 7 días (igual que el topic).
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    consumer   = "telemetry-processor"
    wave       = "2"
    purpose    = "crash-forensics"
  }
}

# =============================================================================
# BigQuery — telemetry.crash_events
# =============================================================================
# Tabla partitioned por DATE(timestamp) + clustered por vehicle_id.
# Query tipica: "todos los crashes de un vehículo en el último año" →
# pruning agresivo por partition + cluster scan eficiente.

resource "google_bigquery_table" "crash_events" {
  dataset_id = google_bigquery_dataset.telemetry.dataset_id
  table_id   = "crash_events"
  project    = google_project.booster_ai.project_id

  description = "Índice de Crash Traces — el JSON forense vive en gs://${google_storage_bucket.crash_traces.name}"

  time_partitioning {
    type          = "DAY"
    field         = "timestamp"
    expiration_ms = null # retención indefinida (compliance 7 años, alineado con GCS)
  }

  clustering = ["vehicle_id"]

  schema = jsonencode([
    {
      name        = "crash_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "UUID v4 generado por el processor al persistir."
    },
    {
      name        = "vehicle_id"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "FK a vehicles.id. NULL si el device estaba pendiente de aprobación al momento del crash."
    },
    {
      name        = "imei"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "IMEI del device origen — siempre presente."
    },
    {
      name        = "timestamp"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp del impacto (record con eventIoId=247)."
    },
    {
      name        = "gcs_path"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "URI completa del JSON forense (gs://...)."
    },
    {
      name        = "peak_g_force"
      type        = "FLOAT64"
      mode        = "REQUIRED"
      description = "Peak G-force calculado sobre todas las muestras del acelerómetro."
    },
    {
      name        = "duration_ms"
      type        = "INT64"
      mode        = "REQUIRED"
      description = "Span temporal del trace en milisegundos (típicamente ~10000 = 10s)."
    },
  ])

  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
  }

  deletion_protection = true
}

# =============================================================================
# IAM — Cloud Run runtime SA escribe en el bucket y BQ table
# =============================================================================
# Todos los Cloud Run services (api, telemetry-processor, etc.) corren con
# `cloud_run_runtime`. Le damos permisos específicos sobre el bucket y la
# tabla, no sobre el proyecto — least privilege.

# objectAdmin en el bucket crash-traces para upload + read en retry.
resource "google_storage_bucket_iam_member" "crash_traces_runtime" {
  bucket = google_storage_bucket.crash_traces.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# dataEditor en el dataset (insert rows en crash_events).
resource "google_bigquery_dataset_iam_member" "crash_events_runtime" {
  dataset_id = google_bigquery_dataset.telemetry.dataset_id
  project    = google_project.booster_ai.project_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# =============================================================================
# Cloud Monitoring — métrica + alerta P0
# =============================================================================
# `crash_trace_persistence_failures` cuenta errors de log estructurado del
# processor cuando falla un upload GCS o insert BQ. Si la métrica
# incrementa, el processor está dropping crash traces — alerta P0
# inmediata al on-call.

resource "google_logging_metric" "crash_trace_persistence_failures" {
  name    = "crash_trace_persistence_failures"
  project = google_project.booster_ai.project_id

  description = "Cuenta errores al persistir Crash Traces (upload GCS o insert BQ falló)."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-telemetry-processor"
    severity>=ERROR
    jsonPayload.msg="error persistiendo crash-trace, nack para reintento"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    display_name = "Crash Trace persistence failures"
  }

  label_extractors = {
    "imei" = "EXTRACT(jsonPayload.imei)"
  }
}

resource "google_monitoring_alert_policy" "crash_trace_persistence_failures" {
  display_name = "Crash Trace persistence failure (P0 — forensics drop)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "any failure in 5 min window"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.crash_trace_persistence_failures.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content = <<-EOT
      Crash Trace persistence failed in telemetry-processor.

      Investigación:
      1. Logs del processor con jsonPayload.msg="error persistiendo crash-trace" en
         Cloud Logging.
      2. Verificar bucket gs://${google_storage_bucket.crash_traces.name} (CMEK
         disponible? IAM correcto?).
      3. Verificar tabla telemetry.crash_events (existe? schema OK?).
      4. Si la falla persiste por > 30 min, los packets crash quedan en el DLQ
         pubsub-dead-letter — pueden reproesarse manualmente desde ahí.

      Por qué es P0: cada Crash Trace dropped es evidencia perdida para
      el reclamo de seguros del carrier. Sin esto Booster pierde su
      diferencial comercial.
    EOT
    mime_type = "text/markdown"
  }
}
