# SLOs formales + alertas de burn-rate (F-13 / SC-20).
#
# Hasta acá monitoring.tf tenía alert policies de threshold "crudas" (error
# rate > 1%, p95 > 2s) pero NINGÚN `google_monitoring_slo`. Sin SLO no hay
# error-budget ni burn-rate: una alerta de threshold te dice "ahora mismo
# está mal", pero no "a este ritmo te quedás sin presupuesto de error del
# trimestre en 2 días". Este archivo agrega:
#
#   1. `google_monitoring_service` (basic service auto-detectado por Cloud Run)
#      para los servicios HTTP-serving críticos.
#   2. `google_monitoring_slo` request-based de availability (good = no-5xx) y
#      de latency (p de requests bajo el umbral) por servicio.
#   3. `google_monitoring_alert_policy` de burn-rate multi-ventana / multi-tasa
#      (fast-burn + slow-burn) por SLO, ruteadas al MISMO notification channel
#      que el resto (local.alert_channel_ids de monitoring.tf).
#
# Metodología de burn-rate (Google SRE Workbook, "Alerting on SLOs"):
#   - fast-burn: ventana corta (1h), tasa alta (14.4×) → consume 2% del budget
#     mensual en 1h. Page inmediato: algo se rompió fuerte AHORA.
#   - slow-burn: ventana larga (6h), tasa moderada (6×) → degradación sostenida
#     que igual te funde el budget. Ticket/aviso, no necesariamente page.
# Ambas ventanas se evalúan con `select_slo_burn_rate`, que GCP deriva del SLO.
#
# Alcance (por qué solo api + web):
#   - `booster-ai-api` y `booster-ai-web` son los únicos servicios que sirven
#     tráfico HTTP real (request_count / request_latencies poblados). SLOs
#     request-based aplican directo.
#   - `booster-ai-matching-engine`, `booster-ai-document-service`,
#     `booster-ai-telemetry-processor` y `booster-ai-notification-service` son
#     consumidores PULL de Pub/Sub (ingress INTERNAL_ONLY, sin tráfico HTTP de
#     negocio). Un SLO request-based sobre ellos mediría casi solo health-checks
#     → ruido. Su salud se observa por el lag/DLQ de sus subscriptions
#     (telemetry-monitoring.tf + la alerta pubsub_dlq de monitoring.tf), no por
#     un SLO de requests. Si en el futuro exponen un endpoint de negocio, sumar
#     su SLO acá siguiendo el mismo patrón.

# =============================================================================
# LOCALS — umbrales de SLO como variables comentadas (defaults sensatos)
# =============================================================================
locals {
  # Período rolling del SLO. 30 días = mismo horizonte que el budget mensual.
  slo_rolling_days = 30

  # --- Targets de availability (fracción de requests no-5xx) ---
  # 99.5% para el api: deja ~3.6h de budget de error al mes. Conservador para
  # pre-comercial (<=10 camiones) — subir a 99.9% al firmar B2B con SLA.
  slo_api_availability_goal = 0.995
  # 99.0% para la PWA estática: la landing tolera más (cold starts de min=0,
  # ADR-034). ~7.3h de budget mensual.
  slo_web_availability_goal = 0.99

  # --- Targets + umbral de latency ---
  # "Good" = request servido bajo el umbral. El SLO mide la fracción de
  # requests buenos contra ese corte de la distribución de latencia.
  #
  # api: 95% de las requests bajo 1s. El p95 crudo de monitoring.tf alerta a 2s;
  # el SLO de latencia es más estricto a propósito (mide presupuesto, no pico).
  slo_api_latency_goal      = 0.95
  slo_api_latency_threshold = 1.0 # segundos (la API de SLO usa segundos, no ms)
  # web: 95% bajo 2s (incluye cold start ocasional de la PWA con min=0).
  slo_web_latency_goal      = 0.95
  slo_web_latency_threshold = 2.0 # segundos

  # --- Parámetros de burn-rate (Google SRE Workbook) ---
  # fast: consume 2% del budget en 1h ⇒ burn-rate 14.4×, look-back 1h.
  slo_fast_burn_rate     = 14.4
  slo_fast_burn_lookback = "3600s" # 1h
  # slow: degradación sostenida ⇒ burn-rate 6×, look-back 6h.
  slo_slow_burn_rate     = 6.0
  slo_slow_burn_lookback = "21600s" # 6h
}

# =============================================================================
# MONITORING SERVICES — basic service auto-detectado de cada Cloud Run
# =============================================================================
# GCP mantiene un "basic service" por cada Cloud Run service. Lo declaramos
# explícito acá (en vez de importar el auto-generado) para anclar los SLOs a
# un recurso versionado en Terraform. El par {service_name, location} debe
# matchear el Cloud Run real — lo tomamos del output `name` del módulo y de
# var.region para no hardcodear.

resource "google_monitoring_service" "api" {
  project      = google_project.booster_ai.project_id
  service_id   = "slo-booster-ai-api"
  display_name = "booster-ai-api (SLO target)"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = module.service_api.name
      location     = var.region
    }
  }

  depends_on = [module.service_api]
}

resource "google_monitoring_service" "web" {
  project      = google_project.booster_ai.project_id
  service_id   = "slo-booster-ai-web"
  display_name = "booster-ai-web (SLO target)"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = module.service_web.name
      location     = var.region
    }
  }

  depends_on = [module.service_web]
}

# =============================================================================
# SLOs — booster-ai-api
# =============================================================================

# Availability: fracción de requests con response_code_class != 5xx.
# good_total_ratio con good = 2xx+3xx+4xx (todo lo no-5xx). Los 4xx son
# "buenos" desde la óptica de disponibilidad del servicio (el server respondió;
# el error es del cliente). Mismo criterio que el error-rate de monitoring.tf,
# que ya filtra response_code_class="5xx".
resource "google_monitoring_slo" "api_availability" {
  project      = google_project.booster_ai.project_id
  service      = google_monitoring_service.api.service_id
  slo_id       = "api-availability"
  display_name = "API availability (no-5xx) ${local.slo_api_availability_goal * 100}%"

  goal                = local.slo_api_availability_goal
  rolling_period_days = local.slo_rolling_days

  request_based_sli {
    good_total_ratio {
      # Total = todas las requests al Cloud Run del api.
      total_service_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${module.service_api.name}\"",
      ])
      # Good = las que NO son 5xx.
      good_service_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${module.service_api.name}\"",
        "metric.label.\"response_code_class\"!=\"5xx\"",
      ])
    }
  }
}

# Latency: fracción de requests servidas bajo el umbral (distribution_cut).
# El SLI es request-based: good = requests con latencia en [0, threshold].
resource "google_monitoring_slo" "api_latency" {
  project      = google_project.booster_ai.project_id
  service      = google_monitoring_service.api.service_id
  slo_id       = "api-latency"
  display_name = "API latency < ${local.slo_api_latency_threshold}s @ ${local.slo_api_latency_goal * 100}%"

  goal                = local.slo_api_latency_goal
  rolling_period_days = local.slo_rolling_days

  request_based_sli {
    distribution_cut {
      distribution_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_latencies\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${module.service_api.name}\"",
      ])
      range {
        # request_latencies está en MILISEGUNDOS; el umbral local está en
        # segundos para legibilidad → ×1000 acá.
        min = 0
        max = local.slo_api_latency_threshold * 1000
      }
    }
  }
}

# =============================================================================
# SLOs — booster-ai-web (PWA)
# =============================================================================

resource "google_monitoring_slo" "web_availability" {
  project      = google_project.booster_ai.project_id
  service      = google_monitoring_service.web.service_id
  slo_id       = "web-availability"
  display_name = "Web availability (no-5xx) ${local.slo_web_availability_goal * 100}%"

  goal                = local.slo_web_availability_goal
  rolling_period_days = local.slo_rolling_days

  request_based_sli {
    good_total_ratio {
      total_service_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${module.service_web.name}\"",
      ])
      good_service_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_count\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${module.service_web.name}\"",
        "metric.label.\"response_code_class\"!=\"5xx\"",
      ])
    }
  }
}

resource "google_monitoring_slo" "web_latency" {
  project      = google_project.booster_ai.project_id
  service      = google_monitoring_service.web.service_id
  slo_id       = "web-latency"
  display_name = "Web latency < ${local.slo_web_latency_threshold}s @ ${local.slo_web_latency_goal * 100}%"

  goal                = local.slo_web_latency_goal
  rolling_period_days = local.slo_rolling_days

  request_based_sli {
    distribution_cut {
      distribution_filter = join(" AND ", [
        "metric.type=\"run.googleapis.com/request_latencies\"",
        "resource.type=\"cloud_run_revision\"",
        "resource.label.\"service_name\"=\"${module.service_web.name}\"",
      ])
      range {
        min = 0
        max = local.slo_web_latency_threshold * 1000 # segundos → ms
      }
    }
  }
}

# =============================================================================
# BURN-RATE ALERT POLICIES — multi-ventana / multi-tasa por SLO
# =============================================================================
# Una policy por SLO con DOS condiciones (fast + slow) combinadas con OR: si
# CUALQUIERA dispara, la policy abre. `condition_threshold` sobre la métrica
# `select_slo_burn_rate(<slo>)` que GCP expone automáticamente por SLO.
#
# `lookback_period` define la ventana de la tasa de quema; `threshold_value` es
# la tasa (×). Patrón idéntico para los 4 SLOs.

# --- API availability burn-rate ---
resource "google_monitoring_alert_policy" "api_availability_burn" {
  project      = google_project.booster_ai.project_id
  display_name = "SLO burn — API availability"
  combiner     = "OR"

  conditions {
    display_name = "fast-burn (${local.slo_fast_burn_rate}× / 1h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_availability.id}\", \"${local.slo_fast_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_fast_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  conditions {
    display_name = "slow-burn (${local.slo_slow_burn_rate}× / 6h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_availability.id}\", \"${local.slo_slow_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_slow_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = <<-EOT
    El error-budget de **API availability** (no-5xx, objetivo ${local.slo_api_availability_goal * 100}% / ${local.slo_rolling_days}d) se está consumiendo demasiado rápido.

    - **fast-burn** (${local.slo_fast_burn_rate}× en 1h): incidente agudo. Tratar como page — algo está fallando AHORA. Ver `booster-skills:incident-response`.
    - **slow-burn** (${local.slo_slow_burn_rate}× en 6h): degradación sostenida. No urgente como page pero funde el budget del mes si no se atiende.

    Diagnóstico: Cloud Logging `resource.labels.service_name="booster-ai-api"` + `httpRequest.status>=500`. Correlacionar con deploy reciente (canary cloudbuild.production.yaml).
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_monitoring_slo.api_availability]
}

# --- API latency burn-rate ---
resource "google_monitoring_alert_policy" "api_latency_burn" {
  project      = google_project.booster_ai.project_id
  display_name = "SLO burn — API latency"
  combiner     = "OR"

  conditions {
    display_name = "fast-burn (${local.slo_fast_burn_rate}× / 1h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_latency.id}\", \"${local.slo_fast_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_fast_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  conditions {
    display_name = "slow-burn (${local.slo_slow_burn_rate}× / 6h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.api_latency.id}\", \"${local.slo_slow_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_slow_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = <<-EOT
    El error-budget de **API latency** (${local.slo_api_latency_goal * 100}% de requests < ${local.slo_api_latency_threshold}s / ${local.slo_rolling_days}d) se está consumiendo demasiado rápido.

    - **fast-burn** (${local.slo_fast_burn_rate}× en 1h): pico agudo de latencia. Revisar saturación (CPU/mem del api, conexiones a Cloud SQL/Redis, cold starts por min_instances=0).
    - **slow-burn** (${local.slo_slow_burn_rate}× en 6h): degradación sostenida de latencia.

    Diagnóstico: Cloud Monitoring metric `run.googleapis.com/request_latencies` (service_name="booster-ai-api"). Correlacionar con volumen de tráfico y deploy reciente.
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_monitoring_slo.api_latency]
}

# --- Web availability burn-rate ---
resource "google_monitoring_alert_policy" "web_availability_burn" {
  project      = google_project.booster_ai.project_id
  display_name = "SLO burn — Web availability"
  combiner     = "OR"

  conditions {
    display_name = "fast-burn (${local.slo_fast_burn_rate}× / 1h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.web_availability.id}\", \"${local.slo_fast_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_fast_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  conditions {
    display_name = "slow-burn (${local.slo_slow_burn_rate}× / 6h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.web_availability.id}\", \"${local.slo_slow_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_slow_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = <<-EOT
    El error-budget de **Web availability** (no-5xx, objetivo ${local.slo_web_availability_goal * 100}% / ${local.slo_rolling_days}d) se está consumiendo demasiado rápido.

    La PWA (booster-ai-web) sirve el bundle estático vía nginx. 5xx acá suele ser
    el contenedor caído o sin arrancar. Diagnóstico: Cloud Logging
    `resource.labels.service_name="booster-ai-web"`. Correlacionar con deploy reciente.
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_monitoring_slo.web_availability]
}

# --- Web latency burn-rate ---
resource "google_monitoring_alert_policy" "web_latency_burn" {
  project      = google_project.booster_ai.project_id
  display_name = "SLO burn — Web latency"
  combiner     = "OR"

  conditions {
    display_name = "fast-burn (${local.slo_fast_burn_rate}× / 1h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.web_latency.id}\", \"${local.slo_fast_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_fast_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  conditions {
    display_name = "slow-burn (${local.slo_slow_burn_rate}× / 6h)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.web_latency.id}\", \"${local.slo_slow_burn_lookback}\")"
      comparison      = "COMPARISON_GT"
      threshold_value = local.slo_slow_burn_rate
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    content   = <<-EOT
    El error-budget de **Web latency** (${local.slo_web_latency_goal * 100}% de requests < ${local.slo_web_latency_threshold}s / ${local.slo_rolling_days}d) se está consumiendo demasiado rápido.

    Causa típica en la PWA con min_instances=0: cold starts. Si es sostenido,
    evaluar subir min_instances. Diagnóstico: `run.googleapis.com/request_latencies`
    (service_name="booster-ai-web").
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_monitoring_slo.web_latency]
}
