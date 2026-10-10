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

# T10-21 — subscription pull de notification-service sobre `notification-events`
# (.specs/notification-service-t10-21/spec.md). Va aquí y no en messaging.tf
# porque ese archivo declara service accounts e IAM (protegido por CLAUDE.md);
# no agrega IAM. Exactly-once delivery: un
# mensaje confirmado no se reentrega (evita WhatsApp duplicados por
# redelivery); el servicio confirma con ackWithResponse. DLQ tras 5 intentos
# (Twilio 429/5xx o red); los 4xx de Twilio se confirman sin reintento.
resource "google_pubsub_subscription" "notification_events_service" {
  name    = "notification-events-sub"
  topic   = google_pubsub_topic.notification_events.name
  project = google_project.booster_ai.project_id

  ack_deadline_seconds         = 60
  enable_exactly_once_delivery = true

  # 1 día: un WhatsApp con más de 24 h de atraso ya no sirve (oferta vencida,
  # chat respondido); mejor DLQ + revisión que entrega tardía.
  message_retention_duration = "86400s"

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
    consumer   = "notification-service"
  }
}
