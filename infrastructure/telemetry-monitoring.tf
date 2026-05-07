# Wave 2 D5 — Métricas custom + dashboards + alertas para el sistema
# de telemetría (gateway + processor + apps consumer de eventos AVL).
#
# Estrategia: metric-from-log con `google_logging_metric` para no
# requerir cambios en código (los logs estructurados Pino ya tienen los
# campos necesarios). Lo que requiere instrumentation OpenTelemetry
# (latency p99) queda como TODO en docs/runbooks/oncall-telemetry-incidents.md.

# =============================================================================
# LOGGING METRICS — derivadas de logs estructurados
# =============================================================================

# Records/min agregado por device — el log "avl packet procesado" del
# gateway tiene `imei` + `recordCount`. Cuenta=count del log filtrado.
resource "google_logging_metric" "device_records_per_minute" {
  name    = "telemetry/device_records_per_minute"
  project = google_project.booster_ai.project_id

  description = "AVL records procesados por device por minuto. Si =0 por 30min → device offline."

  filter = <<-EOT
    resource.type="k8s_container"
    resource.labels.container_name="gateway"
    jsonPayload.msg="avl packet procesado"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Telemetry records per minute"
  }

  label_extractors = {
    "imei" = "EXTRACT(jsonPayload.imei)"
  }
}

# TCP connection resets — log "preamble inesperado" o "CRC inválido"
# del gateway indican corrupción/network issue.
resource "google_logging_metric" "tcp_connection_resets" {
  name    = "telemetry/tcp_connection_resets"
  project = google_project.booster_ai.project_id

  description = "Conexiones TCP cerradas por error de protocolo (preamble/CRC). Network Ping fallando o operador con jitter."

  filter = <<-EOT
    resource.type="k8s_container"
    resource.labels.container_name="gateway"
    severity>=WARNING
    (jsonPayload.msg=~"preamble inesperado" OR jsonPayload.msg=~"CRC inválido")
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "TCP connection resets"
  }
}

# Parser errors — packets malformados que llegan al gateway.
resource "google_logging_metric" "parser_errors" {
  name    = "telemetry/parser_errors"
  project = google_project.booster_ai.project_id

  description = "AVL parser errors. Si >5/min sostenido → cambio de protocolo del device o bug en el parser."

  filter = <<-EOT
    resource.type="k8s_container"
    resource.labels.container_name="gateway"
    jsonPayload.msg="parse error, ack 0 + cerramos"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "AVL parser errors"
  }
}

# Crash events — el processor logea "crash-trace persistido". Cada uno
# es un crash detectado (por device).
resource "google_logging_metric" "crash_events" {
  name    = "telemetry/crash_events"
  project = google_project.booster_ai.project_id

  description = "Crashes detectados (AVL 247). Cada incremento dispara alerta P0."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-telemetry-processor"
    jsonPayload.msg="crash-trace persistido"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Crash events total"
  }

  label_extractors = {
    "imei"        = "EXTRACT(jsonPayload.imei)"
    "vehicle_id"  = "EXTRACT(jsonPayload.vehicleId)"
  }
}

# Unplug events — derivado del log del notification-service cuando
# rutea un evento safety-p0 con eventName=Unplug.
resource "google_logging_metric" "unplug_events" {
  name    = "telemetry/unplug_events"
  project = google_project.booster_ai.project_id

  description = "Unplug events (AVL 252). Tamper alert — dispara alerta P0."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    (resource.labels.service_name="booster-ai-notification-service" OR resource.labels.service_name="booster-ai-telemetry-processor")
    jsonPayload.eventName="Unplug"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Unplug events total"
  }
}

# GNSS Jamming critical — AVL 318 con valor=2.
resource "google_logging_metric" "gnss_jamming_critical_events" {
  name    = "telemetry/gnss_jamming_critical_events"
  project = google_project.booster_ai.project_id

  description = "GNSS jamming critical (AVL 318=2). Probable intento de robo del vehículo."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    (resource.labels.service_name="booster-ai-notification-service" OR resource.labels.service_name="booster-ai-telemetry-processor")
    jsonPayload.eventName="GnssJamming"
    jsonPayload.rawValue=2
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "GNSS Jamming critical events"
  }
}

# SMS fallback — log del Cloud Run sms-fallback-gateway (Track B4).
resource "google_logging_metric" "sms_fallback_received" {
  name    = "telemetry/sms_fallback_received"
  project = google_project.booster_ai.project_id

  description = "SMS recibidos del fallback gateway. Si >0 → algún device sin GPRS."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-sms-fallback-gateway"
    jsonPayload.msg=~"sms fallback procesado"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "SMS fallback received"
  }
}

# =============================================================================
# ALERT POLICIES
# =============================================================================

# P0 — Crash detectado (cualquiera).
resource "google_monitoring_alert_policy" "crash_event_p0" {
  display_name = "Crash event detectado (P0)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "any crash in 1min window"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.crash_events.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content   = "Vehículo Booster sufrió un crash. Investigación: docs/runbooks/oncall-telemetry-incidents.md#crash-event"
    mime_type = "text/markdown"
  }
}

# P0 — Unplug detectado (cualquiera).
resource "google_monitoring_alert_policy" "unplug_event_p0" {
  display_name = "Unplug event detectado (P0)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "any unplug in 1min window"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.unplug_events.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content   = "Device unplug — posible tamper. Investigación: docs/runbooks/oncall-telemetry-incidents.md#unplug-event"
    mime_type = "text/markdown"
  }
}

# P0 — GNSS Jamming critical.
resource "google_monitoring_alert_policy" "gnss_jamming_p0" {
  display_name = "GNSS Jamming critical (P0)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "any critical jamming in 1min window"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.gnss_jamming_critical_events.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content   = "GPS jammer detectado en vehículo Booster — probable intento robo. Investigación: docs/runbooks/oncall-telemetry-incidents.md#gnss-jamming"
    mime_type = "text/markdown"
  }
}

# P1 — Gateway parser errors sostenido > 5/min.
resource "google_monitoring_alert_policy" "parser_errors_p1" {
  display_name = "Gateway parser errors sustained > 5/min (P1)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "parser errors > 5 per minute over 5 min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.parser_errors.name}\" AND resource.type=\"k8s_container\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content   = "El gateway está rechazando packets con parser error. Posible cambio de protocolo del device o bug. Runbook: docs/runbooks/oncall-telemetry-incidents.md#parser-errors"
    mime_type = "text/markdown"
  }
}

# P2 — Pub/Sub backlog > 1000 mensajes en cualquier topic de telemetría.
resource "google_monitoring_alert_policy" "pubsub_backlog_p2" {
  display_name = "Pub/Sub telemetry topics backlog > 1000 (P2)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "telemetry topic backlog"
    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND (resource.labels.subscription_id=\"telemetry-events-processor-sub\" OR resource.labels.subscription_id=\"crash-traces-processor-sub\") AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1000

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content   = "Backlog en subscription telemetría. Verificar processor health, ver runbook."
    mime_type = "text/markdown"
  }
}

# =============================================================================
# DASHBOARD — Telemetría Overview
# =============================================================================
# Un solo dashboard combinando overview + operations. Cada widget muestra
# una métrica relevante. Los widgets de latency p99 quedan TODO hasta que
# instrumentemos OpenTelemetry en el gateway/processor.

resource "google_monitoring_dashboard" "telemetry_overview" {
  project        = google_project.booster_ai.project_id
  dashboard_json = jsonencode({
    displayName = "Booster Telemetría — Overview + Operations"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos   = 0
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "Records/min by IMEI"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter             = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.device_records_per_minute.name}\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["metric.label.imei"]
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos   = 6
          yPos   = 0
          width  = 6
          height = 4
          widget = {
            title = "Crash events (last 24h)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.crash_events.name}\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos   = 0
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "TCP connection resets"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.tcp_connection_resets.name}\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos   = 6
          yPos   = 4
          width  = 6
          height = 4
          widget = {
            title = "Parser errors"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.parser_errors.name}\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
              }]
            }
          }
        },
        {
          xPos   = 0
          yPos   = 8
          width  = 12
          height = 4
          widget = {
            title = "Pub/Sub telemetry subscription backlog"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"pubsub_subscription\" AND (resource.labels.subscription_id=\"telemetry-events-processor-sub\" OR resource.labels.subscription_id=\"crash-traces-processor-sub\") AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.subscription_id"]
                    }
                  }
                }
              }]
            }
          }
        }
      ]
    }
  })
}
