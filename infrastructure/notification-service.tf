# T10-21 — observabilidad de la sombra de notification-service
# (.specs/notification-service-t10-21/spec.md). Criterio de corte: 3–7 días
# con `notification_shadow_divergencias` = 0 sin explicar antes de activar
# `notifications_via_microservice`.
#
# Campo = jsonPayload.message (Pino messageKey='message'). El filtro no admite
# comentarios `#` dentro del heredoc (Cloud Logging lo rechaza).
resource "google_logging_metric" "notification_shadow_divergencias" {
  name        = "notification_shadow_divergencias"
  project     = google_project.booster_ai.project_id
  description = "Envíos WhatsApp cuyo request a Twilio armado por notification-service difiere del que envió el api (modo sombra)."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-notification-service"
    jsonPayload.message="notificacion sombra diverge"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "notification-service: divergencias en sombra"
  }
}

resource "google_logging_metric" "notification_shadow_coincidencias" {
  name        = "notification_shadow_coincidencias"
  project     = google_project.booster_ai.project_id
  description = "Envíos WhatsApp en sombra cuyo request coincide entre api y notification-service (denominador de la tasa de divergencia)."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-notification-service"
    jsonPayload.message="notificacion sombra coincide"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "notification-service: coincidencias en sombra"
  }
}

resource "google_monitoring_alert_policy" "notification_shadow_divergencia" {
  display_name = "notification-service: divergencia en sombra (bloquea el corte)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "alguna divergencia en 5 min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.notification_shadow_divergencias.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = <<-EOT
      notification-service armó un request a Twilio distinto al que el api envió.

      1. Logs `jsonPayload.message="notificacion sombra diverge"`: comparar
         `hashEsperado` vs `hashServicio` y el `contentSid`.
      2. Causa típica: `TWILIO_FROM_NUMBER` distinto entre `service_api` y
         `service_notification` (compute.tf), o cambio de normalización en
         `@booster-ai/whatsapp-client` desplegado en un solo servicio.
      3. No afecta a usuarios (en sombra el api sigue enviando). Bloquea el
         corte (`notifications_via_microservice`) hasta explicar o corregir.

      Runbook: docs/runbooks/service-notification-service.md
    EOT
    mime_type = "text/markdown"
  }
}
