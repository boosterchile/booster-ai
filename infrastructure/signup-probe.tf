# SEC-001 Sprint 2b H1.2 — Synthetic monitor signup-probe (T13).
#
# Spec: .specs/sec-001-cierre/spec.md §3 H1.2 SC-1.2.3.
# Plan: .specs/sec-001-cierre/plan-sprint-2b.md T13 acceptance.
# ADR: docs/adr/052-signup-migration-admin-sdk-gate.md (Proposed; flip
# Accepted depends on signup-probe success rate > 99% durante 2h watch
# post-canary).
#
# **Nota location**: plan T13 referencia `infrastructure/monitoring/signup-
# probe.tf` (subdirectorio). Decisión: archivo top-level
# `infrastructure/signup-probe.tf` para consistency con patrón existente
# (otros monitoring resources viven top-level: monitoring.tf, telemetry-
# monitoring.tf, api-cost-guardrails.tf, crash-traces.tf). Terraform
# auto-loads *.tf del working dir; subdir requiere `module {}` overhead
# innecesario para un solo resource pair.

# =============================================================================
# Uptime check — GET https://api.boosterchile.com/health/signup-flow
# =============================================================================
#
# Targets el liveness endpoint specific al signup flow (T8 entrega).
# Distinguible de /health (cubre todo el API) para alerting fino post-deploy:
# si /health/signup-flow cae pero /health sigue OK → señal específica del
# signup flow regression.
#
# Period 60s (mismo que api_health) — denser que el default 300s porque
# este es el critical path SEC-001 Sprint 2b. Cost extra: ~$0.10/mes per
# Cloud Monitoring pricing (uptime checks gratis hasta 100/proyecto, este
# es el 3º o 4º).

resource "google_monitoring_uptime_check_config" "signup_probe" {
  display_name = "Signup flow /health/signup-flow"
  project      = google_project.booster_ai.project_id
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health/signup-flow"
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

  # T13 dependency: el path /health/signup-flow se entrega en T8
  # (apps/api/src/routes/health-signup-flow.ts mergeado en sha 8f8b281).
  # Si el deploy del api revierte ese commit, el probe empieza a 404 →
  # alerta dispara. Comportamiento esperado.
  depends_on = [google_dns_record_set.api]
}

# =============================================================================
# Alert policy — page on 2 consecutive failures
# =============================================================================
#
# Per plan T13 acceptance: "Page on 2 consecutive failures". Diferenciable
# del api_error_rate (que fire >1% sostenido 5min): el signup-probe alert
# dispara más rápido (2 minutos = 2 períodos failed) porque el critical
# window post-canary deploy es 30min — necesitamos detectar regression
# bien dentro de ese window.

resource "google_monitoring_alert_policy" "signup_probe_failure" {
  display_name = "Signup probe — /health/signup-flow failures (2 consecutive)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "signup-probe 2 consecutive failures"
    condition_threshold {
      filter = join(" AND ", [
        "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\"",
        "metric.label.check_id=\"${google_monitoring_uptime_check_config.signup_probe.uptime_check_id}\"",
        "resource.type=\"uptime_url\""
      ])
      # 2 consecutive period (60s each) → 120s window con check_passed=false.
      duration   = "120s"
      comparison = "COMPARISON_LT"
      # check_passed retorna 1.0 cuando pasa, 0.0 cuando falla. Threshold 1
      # con LT detecta any failure dentro de la window.
      threshold_value = 1

      # `check_passed` se reporta como DOUBLE (1.0 ok / 0.0 fail). ALIGN_
      # FRACTION_TRUE convierte a fracción true por período (1.0 = todos
      # los samples pass, 0.0 = todos fail). Sin cross_series_reducer
      # explícito el monitor opera por serie individual (uno por uptime
      # check_id), que es lo que queremos para alertar sobre este check
      # específico.
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_FRACTION_TRUE"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = <<-EOT
      Signup flow `/health/signup-flow` failed 2 consecutive uptime checks (120s window).

      **First triage steps** (per `docs/qa/signup-canary-rollback.md` §3):
      1. Describe the service to confirm latest revision + traffic split via
         `gcloud run services describe`.
      2. Check Cloud Run logs for `health-signup-flow` route 5xx errors.
      3. If canary deploy in progress (revision tag starts with `canary-signup-`),
         execute rollback fast-path with `gcloud run services update-traffic`
         + `--to-revisions=PREVIOUS=100`. Comandos exactos en el runbook §3.
      4. If full deploy (no canary tag), investigate without rollback — could be
         downstream dep (DB unreachable, Redis fail-closed) affecting other paths
         too.

      ADR: docs/adr/052-signup-migration-admin-sdk-gate.md
      Spec: .specs/sec-001-cierre/spec.md §3 H1.2 SC-1.2.3.
    EOT
    mime_type = "text/markdown"
  }

  user_labels = {
    sev          = "p1"
    spec         = "sec-001-h1-2"
    sc           = "sc-1-2-3"
    canary_phase = "active"
  }
}
