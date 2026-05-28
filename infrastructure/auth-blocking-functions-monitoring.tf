# SEC-001 Sprint 2c-B T12a — Monitoring for the Google Blocking Function
# (alert + synthetic reachability check).
#
# Spec: .specs/sec-001-h1-2-google-blocking-b/spec.md §11 SC-2C.B.6.
# Plan: .specs/sec-001-h1-2-google-blocking-b/plan.md v4 §T12a.
# Runbook: docs/qa/google-blocking-function-runbook.md §1 (pre-deploy
# checklist requires monitoring applied BEFORE T8 deploy).
#
# **F-B6 plan v4 fix**: this terraform file SHIPS + APPLIES BEFORE T8
# (function + IdP wire apply). Alerts must exist on day 0 so a regression
# during the deploy window is visible. T8 §Depends-on lists T12a applied
# (N-B3 plan v4 fix wires the ordering mechanically).
#
# Once T8 applies + the first Google signup hits the gate, the
# `signup.blocked.google` log entries from the handler (Sprint 2c-A T7)
# are captured by the log-based metric below. The alert threshold is a
# count threshold for v1; SC-2C.B.6 calls for re-tuning to "media +
# 3-sigma" post-baseline (operational tuning per runbook).

# =============================================================================
# Log-based metric — `signup.blocked.google` count
# =============================================================================
#
# Handler emits `logger.warn({event: 'signup.blocked.google', ...})` on
# every rejected Google signup (no matching solicitudes_registro aprobado
# row). The structured log has `severity=WARNING + jsonPayload.event=
# signup.blocked.google + jsonPayload.service=@booster-ai/auth-blocking-
# functions`. This metric counts those entries per minute.

resource "google_logging_metric" "signup_blocked_google" {
  project = google_project.booster_ai.project_id
  name    = "signup_blocked_google"

  description = "Count of `signup.blocked.google` structured-log events from the auth-blocking-functions handler (Sprint 2c-A T7). Used by the 3-sigma anomaly alert below."

  # The `severity=WARNING` filter narrows to handler.warn() output.
  filter = join(" AND ", [
    "resource.type=\"cloud_function\"",
    "resource.labels.function_name=\"beforeCreate\"",
    "severity=\"WARNING\"",
    "jsonPayload.event=\"signup.blocked.google\"",
  ])

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "signup.blocked.google rate"
  }
}

# =============================================================================
# Alert policy — anomaly threshold on blocked signup rate
# =============================================================================
#
# v1 implementation: simple count threshold (>= 10 blocked signups per
# hour). At Booster's expected <10 Google signups/month, this is well
# above noise floor + catches a "gate misfiring at scale" regression.
#
# SC-2C.B.6 mandates re-tuning to `media + 3-sigma` post-baseline (after
# T12b 7-day watch establishes typical rate). Re-tuning is operational
# via `gcloud monitoring policies update` per runbook §4; this terraform
# file ships the bootstrap threshold so alerts exist day 0.

resource "google_monitoring_alert_policy" "signup_blocked_google_rate" {
  project      = google_project.booster_ai.project_id
  display_name = "Signup blocked Google rate — exceeds bootstrap threshold"
  combiner     = "OR"

  conditions {
    display_name = "signup.blocked.google >= 10 events / hour (bootstrap threshold; re-tune post-T12b baseline)"
    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"logging.googleapis.com/user/${google_logging_metric.signup_blocked_google.name}\"",
        "resource.type=\"cloud_function\"",
      ])
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 10

      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_DELTA"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  documentation {
    content   = <<-EOT
      `signup.blocked.google` rate exceeded the bootstrap threshold (≥ 10
      blocked signups in 1h window).

      **Expected baseline**: Booster's typical Google signup attempt rate
      is < 10/month. ≥ 10 blocked per hour signals either (a) a real
      attack/abuse, (b) a regression in the admin-approval pipeline
      (`solicitudes_registro` not approving correctly), or (c) noise from
      a single misbehaving client.

      **First triage** (per `docs/qa/google-blocking-function-runbook.md` §3):
      1. Check Cloud Logging for the blocked entries:
         `logger.warn({event:'signup.blocked.google', emailHashed, ipAddress, correlationId})`.
         Look for patterns: same ipAddress (attack), same emailHashed
         (broken client retrying), or distributed (legitimate users
         confused about onboarding).
      2. If real attack: alert PO + investigate Identity Platform abuse
         tools. NO rollback needed (gate working as designed).
      3. If regression in admin-approval flow: check
         `solicitudes_registro WHERE estado='aprobado' ORDER BY id DESC LIMIT 10`
         — are recent approvals committing? If not, escalate to
         apps/api signup-request service.
      4. If noise: tune threshold (operational; see SC-2C.B.6 post-baseline
         re-tune to `media + 3-sigma`).

      **Post-T12b baseline**: PO re-tunes threshold per the 7-day window
      mean + 3 standard deviations. Bootstrap value of 10 is a placeholder.

      ADR: docs/adr/054-google-blocking-function-signup-gate.md.
      Spec: .specs/sec-001-h1-2-google-blocking-b/spec.md §11 SC-2C.B.6.
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    sev    = "p2"
    spec   = "sec-001-h1-2"
    sc     = "sc-2c-b-6"
    sprint = "2c-b"
  }
}

# =============================================================================
# Synthetic reachability check — function returns 403 to unauthenticated
# =============================================================================
#
# The function is deployed with `--no-allow-unauthenticated` + IAM
# binding granting `roles/cloudfunctions.invoker` ONLY to the Identity
# Platform service agent. Unauthenticated HTTP requests return 403.
#
# This uptime check probes the function's https_trigger_url and asserts
# status 403 = "deployed + IAM enforcement active". Status 200 would
# indicate IAM weakened (unauthenticated allowed — security regression).
# Status 404 / 5xx / timeout would indicate the function is undeployed
# or unhealthy.
#
# Cost: ~$0.10/month per uptime check (1st 100 free; we are well under).

resource "google_monitoring_uptime_check_config" "auth_blocking_reachability" {
  display_name = "Auth blocking function reachability (403 = healthy)"
  project      = google_project.booster_ai.project_id
  timeout      = "10s"
  period       = "300s" # 5 min — function reachability is not latency-critical

  http_check {
    request_method = "POST" # blocking function endpoints accept POST per IdP SDK convention
    path           = "/"
    port           = "443"
    use_ssl        = true
    validate_ssl   = true

    # 403 = healthy (function deployed + IAM rejects unauthenticated).
    # 200 = security regression (unauthenticated access allowed).
    accepted_response_status_codes {
      status_value = 403
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = google_project.booster_ai.project_id
      host       = "us-east1-${var.project_id}.cloudfunctions.net"
    }
  }

  lifecycle {
    # Function host suffix may change if the function is redeployed under
    # a different region or with a different invocation pattern (e.g.,
    # Gen 2 migration). When that happens, this resource gets replaced —
    # OK for an uptime check.
    create_before_destroy = true
  }
}
