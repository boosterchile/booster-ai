# Cloud Monitoring — notification channels, uptime checks, alert policies base.
# Dashboards custom se crean después con Terraform module separado o via consola.

# =============================================================================
# NOTIFICATION CHANNELS
# =============================================================================

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

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

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

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

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

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]
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

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]
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

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]
}

# =============================================================================
# T6a SEC-001 Sprint 2a — Log-based metrics + alerts demo accounts (H1.1)
# =============================================================================
# Per spec sec-001-cierre §3 H1.1 SC-1.1.6 + plan-sprint-2a T6a P0-R4-2:
# conditional-counter pattern (NO custom metric SDK). Matches el patrón
# existente de telemetry-monitoring.tf (device_records_per_minute,
# tcp_connection_resets, etc.).
#
# IAM nota (per plan T6a + iam.tf:74): el SA del API ya tiene
# `roles/monitoring.metricWriter` global; no se requiere binding nuevo.

# -----------------------------------------------------------------------------
# Log-based metric 1 — demo.ttl_low events emitted by
# apps/api/src/services/demo-account-ttl-alerter.ts cuando una cuenta
# demo activa tiene days_remaining ≤ 7.
# -----------------------------------------------------------------------------
resource "google_logging_metric" "demo_ttl_low" {
  name    = "sec001/demo_ttl_low"
  project = google_project.booster_ai.project_id

  description = "Cuentas demo con TTL ≤ 7 días. Counter DELTA — cada datapoint es 1 alert dedupeado por día (Redis dedup en el alerter)."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-api"
    jsonPayload.event="demo.ttl_low"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Demo accounts TTL low (≤7d)"
    labels {
      key         = "persona"
      value_type  = "STRING"
      description = "Persona enum Spanish (generador_carga/transportista/stakeholder/conductor)"
    }
  }

  label_extractors = {
    "persona" = "EXTRACT(jsonPayload.persona)"
  }
}

# -----------------------------------------------------------------------------
# Log-based metric 2 — audit.demo_uid_retired events emitted by
# apps/api/src/services/harden-demo-accounts.ts retire(). Cada batch
# retire (4 UIDs viejas) produce 4 datapoints. Counter pattern para
# observabilidad de operación + base para silent-window guard futuro
# (deferred a follow-up post-T4 operational execution).
# -----------------------------------------------------------------------------
resource "google_logging_metric" "demo_uid_retired" {
  name    = "sec001/demo_uid_retired"
  project = google_project.booster_ai.project_id

  description = "Auditoría de UID demo retirado (harden-demo-accounts retire). Counter DELTA — 4 events expected en batch one-shot post-deploy. Spec §3 H1.1 SC-1.1.4."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-api"
    jsonPayload.event="audit.demo_uid_retired"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Demo UID retired (audit)"
  }
}

# -----------------------------------------------------------------------------
# Alert policy — TTL low (primary). Fires cuando rate(demo_ttl_low) > 0
# sustained 1min. Notifica al email channel existente (PO).
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "demo_ttl_low" {
  display_name = "Demo accounts TTL ≤ 7 days"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "demo.ttl_low events present"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.demo_ttl_low.name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  alert_strategy {
    # Auto-close 25h post-trigger: el cron diario corre 06:00; si TTL
    # se renovó, no habrá más eventos en 24h → alert se cierra sola.
    auto_close = "90000s"
  }

  documentation {
    content   = <<-EOT
    Una o más cuentas demo tienen TTL ≤ 7 días. Renovar via:
      `node apps/api/scripts/harden-demo-accounts.mjs --renew <uid> --extend-days 30`
    Ver `docs/qa/demo-accounts.md` §"Renovación TTL".

    UIDs y personas afectados aparecen en los logs del job
    `demo-account-ttl-alert` (Cloud Logging filter: `jsonPayload.event=demo.ttl_low`).
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.demo_ttl_low]
}

# -----------------------------------------------------------------------------
# T4 SEC-001 Sprint 2b — Log-based metric auth.is_demo.blocked events
# emitted by apps/api/src/middleware/is-demo-enforcement.ts cuando una
# sesión con claim `is_demo:true` recibe 403 forbidden_demo en un mount
# point auth-required. Conditional-counter pattern alineado con T6a
# `demo_uid_retired`: solo se emite en branches que retornan 403, no
# en passthrough (zero ruido baseline). Spec §3 H1.3 SC-1.3.7 +
# plan-sprint-2b §3 T4.
# -----------------------------------------------------------------------------
resource "google_logging_metric" "auth_is_demo_blocked" {
  name    = "sec001/auth_is_demo_blocked"
  project = google_project.booster_ai.project_id

  description = "is-demo enforcement bloqueó request (sesión demo con is_demo:true intentó POST/PUT/PATCH/DELETE auth-required). Counter DELTA — 0 events expected baseline (demo sessions read-only por design). Spec §3 H1.3 SC-1.3.7."

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-api"
    jsonPayload.event="auth.is_demo.blocked"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "is-demo enforcement blocked"
  }
}

# -----------------------------------------------------------------------------
# T4 SEC-001 — Alert policy auth_is_demo_blocked_anomaly.
# Pattern `count > 0 sustained 5min` (no 3σ — sin baseline día-0, mismo
# enfoque que Sprint 2a `demo_ttl_low`). Auto-close 25h (mismo que T6a).
# Follow-up tracked: upgrade a 3σ después de 1-2 semanas baseline real
# en .specs/_followups/ (plan §3 T4).
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "auth_is_demo_blocked_anomaly" {
  display_name = "is-demo enforcement blocked (anomaly)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "auth.is_demo.blocked events present > 5min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.auth_is_demo_blocked.name}\" AND resource.type=\"cloud_run_revision\""
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

  alert_strategy {
    # Auto-close 25h post-trigger: si demo session activa stops
    # generating events, el alert se cierra sola.
    auto_close = "90000s"
  }

  documentation {
    content   = <<-EOT
    is-demo enforcement bloqueó ≥1 request sustained 5min. Demo sessions
    NO deberían generar writes contra mount points auth-required.

    Causas posibles:
      1. Demo UI bug — frontend está intentando POST/PUT/PATCH/DELETE
         que no debería. Buscar `path` + `method` en logs.
      2. Demo session siendo abusada — investigar `uid` + `correlationId`
         en logs (Cloud Logging filter `jsonPayload.event=auth.is_demo.blocked`).
      3. Wire de allowlist mal — endpoint legítimo demo está bloqueado
         por error. Revisar `apps/api/src/middleware/is-demo-allowlist.ts`.

    Investigar logs:
      `jsonPayload.event=auth.is_demo.blocked` en Cloud Logging.

    Ver `.specs/sec-001-cierre/spec.md` §3 H1.3 SC-1.3.7 + `plan-sprint-2b.md` §3 T4.
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_logging_metric.auth_is_demo_blocked]
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

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

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
