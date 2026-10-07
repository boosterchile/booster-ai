# Cloud Monitoring — notification channels, uptime checks, alert policies base.
# Dashboards custom se crean después con Terraform module separado o via consola.

# =============================================================================
# NOTIFICATION CHANNELS
# =============================================================================

# Webhook SRE (segundo canal — count-gated: sin URL no se crea nada y
# todo sigue solo-email). Poblar var.sre_webhook_url y aplicar.
resource "google_monitoring_notification_channel" "sre_webhook" {
  count        = var.sre_webhook_url != "" ? 1 : 0
  display_name = "SRE webhook (Slack/Chat)"
  project      = google_project.booster_ai.project_id
  type         = "webhook_tokenauth"

  labels = {
    url = var.sre_webhook_url
  }

  depends_on = [google_project_service.apis]
}

# Lista única de canales: TODAS las alert policies referencian este local
# (sed global 2026-06-11) — agregar un canal nuevo = tocar solo esto.
locals {
  alert_channel_ids = concat(
    [google_monitoring_notification_channel.email_alerts.id],
    google_monitoring_notification_channel.sre_webhook[*].id,
  )
}

resource "google_monitoring_notification_channel" "email_alerts" {
  display_name = "Email alerts"
  project      = google_project.booster_ai.project_id
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.apis]
}

# =============================================================================
# UPTIME CHECKS — endpoints críticos
# =============================================================================

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "API /health"
  project      = google_project.booster_ai.project_id
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health"
    port         = "443"
    use_ssl      = true
    validate_ssl = true
    accepted_response_status_codes {
      status_value = 200
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = google_project.booster_ai.project_id
      host       = "api.${var.domain}"
    }
  }

  depends_on = [google_dns_record_set.api]
}

resource "google_monitoring_uptime_check_config" "marketing_home" {
  display_name = "Marketing home"
  project      = google_project.booster_ai.project_id
  timeout      = "10s"
  period       = "300s"

  http_check {
    path    = "/"
    port    = "443"
    use_ssl = true
    accepted_response_status_codes {
      status_value = 200
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = google_project.booster_ai.project_id
      host       = "www.${var.domain}"
    }
  }

  depends_on = [google_dns_record_set.www]
}

# =============================================================================
# ALERT POLICIES — baseline de SLOs
# =============================================================================

# API errors > 1% sostenido 5 min
resource "google_monitoring_alert_policy" "api_error_rate" {
  display_name = "API error rate > 1%"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "error rate"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"booster-ai-api\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.01

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

# API latency p95 > 2s sostenido 5 min
resource "google_monitoring_alert_policy" "api_latency_p95" {
  display_name = "API latency p95 > 2s"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "p95 latency"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"booster-ai-api\" AND metric.type=\"run.googleapis.com/request_latencies\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 2000 # ms

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

# Uptime check failures
resource "google_monitoring_alert_policy" "uptime_failures" {
  display_name = "Uptime check failing"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "uptime failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\""
      duration        = "120s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = ["resource.host"]
      }
    }
  }

  notification_channels = local.alert_channel_ids
}

# Pub/Sub dead-letter queue no vacía → algo se rompió
resource "google_monitoring_alert_policy" "pubsub_dlq" {
  display_name = "Pub/Sub DLQ has messages"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "DLQ messages > 0"
    condition_threshold {
      filter          = "resource.type=\"pubsub_topic\" AND resource.labels.topic_id=\"pubsub-dead-letter\" AND metric.type=\"pubsub.googleapis.com/topic/num_unacked_messages_by_region\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids
}

# Cloud SQL storage > 80%
resource "google_monitoring_alert_policy" "cloudsql_storage" {
  display_name = "Cloud SQL storage > 80%"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "storage utilization"
    condition_threshold {
      filter          = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/utilization\""
      duration        = "600s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids
}

# =============================================================================
# T9 SEC-001 boundary-closure — counter del reaper IdP + alerta de volumen
# =============================================================================
# Spec .specs/sec-001-h1-2-google-boundary-closure/spec.md SC-G4/§11 + ADR-057.
# El runner (apps/api/src/jobs/reap-inert-idp-accounts.ts) emite structured log
# `reaper.account.delete` por cada cuenta que CALIFICA para borrado. OJO: el log
# se emite tanto en dry-run (destructive:false, would-be-delete) como en modo
# destructivo (destructive:true, borrado real). Este counter filtra
# `jsonPayload.destructive=true` para contar SOLO borrados reales — si no, la
# alerta de volumen se dispararía durante el primer dry-run (donde la población
# inerte es grande). REVIEW finding C.
resource "google_logging_metric" "reaper_account_reaped" {
  name    = "sec001/reaper_account_reaped"
  project = google_project.booster_ai.project_id

  description = "Cuentas IdP Google borradas REALMENTE por el reaper (event reaper.account.delete + destructive=true). Counter DELTA — señal de volumen anómalo de borrados."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-api"
    jsonPayload.event="reaper.account.delete"
    jsonPayload.destructive=true
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Reaper IdP accounts deleted"
  }
}

resource "google_monitoring_alert_policy" "reaper_volume_anomaly" {
  project      = google_project.booster_ai.project_id
  display_name = "Reaper IdP — volumen de borrados anómalo"
  combiner     = "OR"

  conditions {
    display_name = "reaper.account.delete > 20 en 1h (bootstrap; re-tune post primer run destructivo)"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.reaper_account_reaped.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 20
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = <<-EOT
      El reaper borró > 20 cuentas IdP en 1h. Población esperada: self-signup
      Google sin solicitud, baja. Un pico señala (a) backlog del primer run
      destructivo (esperado una vez), o (b) un bug en el predicado matcheando
      cuentas legítimas — revisar `jsonPayload.event=reaper.account.delete` +
      `emailHashed` en Cloud Logging y el dual-guard (apps/api/src/services/reaper-predicate.ts).

      Review manual 24h post primer run destructivo (spec §11). Re-tune el
      threshold tras observar el volumen real del primer run.

      ADR: docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md.
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.reaper_account_reaped]
}
