# -----------------------------------------------------------------------------
# T10-21 — document-service (worker TED): reconciliación periódica.
# Declara un job de Scheduler y la alerta de DLQ del worker: sin IAM (el IAM
# del push vive en messaging.tf, ADR-085). Reutiliza el SA
# `internal_cron_invoker` (scheduling.tf), igual que el resto de
# /admin/jobs/*. Va en su propio archivo porque scheduling.tf declara IAM y
# service accounts (archivo protegido por CLAUDE.md).
# -----------------------------------------------------------------------------

# T10-21 — reconciliación de `documentos_transporte` con el worker TED
# (`apps/document-service`): libera `procesando` abandonados (> 30 min) a
# `fallido` y republica a `document.uploaded` los `pendiente` sin tocar por
# > 10 min (documentos subidos antes de cablear el topic o con publish
# fallido). Idempotente: el claim condicional del worker descarta duplicados.
resource "google_cloud_scheduler_job" "documentos_pendientes" {
  name        = "documentos-pendientes"
  description = "Cada 15 min: reconcilia documentos_transporte pendientes/atascados con el worker TED (T10-21)."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "*/15 * * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 1
    min_backoff_duration = "60s"
    max_backoff_duration = "120s"
    max_doublings        = 1
  }

  depends_on = [google_project_service.apis, module.service_api]

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/documentos-pendientes"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }
}

# ADR-085 — un mensaje de `document-uploaded-processor-sub` agotó sus 5
# intentos y Pub/Sub lo reenvió a `pubsub-dead-letter`. Con push, un 401/403/
# 404/5xx persistente (OIDC, IAM o endpoint mal aplicados; GCS o la base caídos)
# termina acá tras unos minutos de reintentos (backoff 10–600 s), antes de que la alerta de suscripción
# estancada llegue a sus 30 min. La alerta general `pubsub_dlq` (monitoring.tf)
# mira `num_unacked_messages_by_region` del topic, que no tiene suscripción
# propia, así que no se dispara: esta mira la métrica de la suscripción de
# origen, que no depende de eso.
resource "google_monitoring_alert_policy" "document_uploaded_dead_lettered" {
  display_name = "document-service: mensajes de document.uploaded enviados a la DLQ (ERROR)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "dead_letter_message_count > 0"
    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${google_pubsub_subscription.document_uploaded_processor.name}\" AND metric.type=\"pubsub.googleapis.com/subscription/dead_letter_message_count\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = "Un `document.uploaded` falló 5 veces y quedó en el topic `pubsub-dead-letter` (retención 30 días, sin suscripción). El documento quedó en `fallido` o `pendiente`. Revisar los logs `severity>=ERROR` de booster-ai-document-service: 401 = OIDC del push, 403 = run.invoker, 404 = revisión sin el endpoint, 500 = GCS o base. Runbook: docs/runbooks/service-document-service.md#mensajes-en-dlq"
    mime_type = "text/markdown"
  }
}
