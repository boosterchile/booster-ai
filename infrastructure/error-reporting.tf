# =============================================================================
# Error Reporting de backends (T10-16, ADR-082)
# =============================================================================
# @booster-ai/logger marca cada entrada error/fatal que trae un Error con
# `@type` ReportedErrorEvent + `stack_trace` + `serviceContext`; Cloud Error
# Reporting la agrupa leyendo Cloud Logging (sin SDK ni IAM nuevos: el SA
# runtime ya escribe logs). Las fallas no controladas (uncaughtException /
# unhandledRejection) se loguean como `fatal` antes de salir con 1.
#
# Error Reporting no expone sus notificaciones por grupo en Terraform, así
# que la alerta se construye sobre una log-based metric con el mismo filtro:
#   - Cualquier `fatal` (CRITICAL) de los 4 backends → alerta inmediata.
#   - Más de 5 errores reportables en 5 min por servicio → alerta.
# Alcance: api, telemetry-processor, whatsapp-bot (Cloud Run) y
# telemetry-tcp-gateway (GKE, contenedor `gateway`).
# =============================================================================

resource "google_logging_metric" "backend_errores_reportados" {
  name    = "error-reporting/backend_errores_reportados"
  project = google_project.booster_ai.project_id

  description = "Entradas de log reportadas a Error Reporting (ReportedErrorEvent) por los backends. T10-16."

  filter = <<-EOT
    jsonPayload."@type"="type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"
    severity>=ERROR
    (
      (resource.type="cloud_run_revision" AND resource.labels.service_name=("booster-ai-api" OR "booster-ai-telemetry-processor" OR "booster-ai-whatsapp-bot"))
      OR (resource.type="k8s_container" AND resource.labels.container_name="gateway")
    )
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Errores de backend reportados (Error Reporting)"

    labels {
      key         = "servicio"
      value_type  = "STRING"
      description = "serviceContext.service del logger"
    }
    labels {
      key         = "severidad"
      value_type  = "STRING"
      description = "ERROR o CRITICAL (fatal: falla no controlada)"
    }
  }

  label_extractors = {
    "servicio"  = "EXTRACT(jsonPayload.serviceContext.service)"
    "severidad" = "EXTRACT(severity)"
  }
}

resource "google_monitoring_alert_policy" "backend_errores_reportados" {
  display_name = "Backend: errores no controlados (Error Reporting)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "Falla no controlada (fatal) en un backend"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.backend_errores_reportados.name}\" AND metric.label.severidad=\"CRITICAL\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.servicio"]
      }
    }
  }

  conditions {
    display_name = "Más de 5 errores reportables en 5 min por servicio"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.backend_errores_reportados.name}\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["metric.label.servicio"]
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content   = <<-EOT
    Un backend reportó errores con stack a Cloud Error Reporting.

    1. Abrir Error Reporting (consola → Error Reporting) y filtrar por el
       servicio de la etiqueta `servicio`: el grupo muestra el stack, la
       primera/última aparición y la versión (`serviceContext.version`).
    2. `severidad=CRITICAL` = uncaughtException/unhandledRejection: el
       proceso salió con 1 y Cloud Run/GKE lo reinició. Revisar si se repite.
    3. Runbook del servicio: `docs/runbooks/service-<servicio>.md`.
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.backend_errores_reportados]
}
