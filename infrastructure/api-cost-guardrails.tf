# =============================================================================
# API COST GUARDRAILS — Routes API + Gemini API
# =============================================================================
# Phase 1 (eco-route preview) y Phase 3 (coaching IA) introdujeron consumo de
# 2 APIs externas pagas:
#
#   - Routes API (`routes.googleapis.com`):
#       Eco-preview pre-aceptación de oferta. Costo ~$5 USD por 1000 advanced
#       requests (incluye FUEL_CONSUMPTION). Budget interno objetivo ~$300/mes
#       = 60K req/mes = 2K req/día = 83 req/h sostenido. Hard ceiling estimado
#       en 500 req/h sostenido 10 min — dispara alarma para investigar antes
#       de que el run-rate se proyecte > $1500/mes.
#
#   - Gemini API (`generativelanguage.googleapis.com`):
#       Coaching IA post-entrega (~1 call por trip entregado). Modelo
#       gemini-1.5-flash con maxOutputTokens=200 → ~$0.30 USD por 1M output
#       tokens. Budget interno ~$5/mes (volumen actual 1-2 trips/día). Hard
#       ceiling 100 req/h — más allá de eso es loop runaway o prompt injection
#       que está re-disparando el endpoint.
#
# Por qué Cloud Monitoring y NO `google_billing_budget`:
#   project.tf:152 documenta que el API billingbudgets.googleapis.com rechaza
#   request via Terraform con 400 opaco. Mientras eso no se resuelva, Cloud
#   Monitoring sobre el metric `serviceruntime.googleapis.com/api/request_count`
#   da real-time alerting (resolución ~1 min vs billing export diario) sin
#   depender del API problemático.
#
# Defensa en profundidad: el budget global ($500/mes) sigue creado a mano via
# Console (ver project.tf:152). Estos alerts cubren el caso "una API se
# desboca" antes de que llegue al budget global.

# -----------------------------------------------------------------------------
# Routes API — request rate alert
# -----------------------------------------------------------------------------
# Métrica `serviceruntime.googleapis.com/api/request_count` en el resource
# type `consumed_api`. Filtra por `service` para aislar Routes API. La
# agregación ALIGN_RATE convierte el counter en req/s; cross_series_reducer
# REDUCE_SUM agrega cualquier label (response_code, method) que pudiera
# splittear las series.
#
# Threshold: 500 req/h = 0.139 req/s. Sostenido 10 min para evitar falsos
# positivos en spikes legítimos (ej. carrier abre 50 ofertas en 5 min).
resource "google_monitoring_alert_policy" "routes_api_rate" {
  display_name = "Routes API request rate > 500/h"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "routes.googleapis.com request rate"
    condition_threshold {
      filter          = <<-EOT
        metric.type="serviceruntime.googleapis.com/api/request_count"
        resource.type="consumed_api"
        resource.labels.service="routes.googleapis.com"
      EOT
      duration        = "600s" # 10 min sostenido
      comparison      = "COMPARISON_GT"
      threshold_value = 0.139 # ≈ 500 req/h en req/s

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  alert_strategy {
    auto_close = "3600s" # 1h — la API rate es un signal lento
  }

  documentation {
    content   = <<-EOT
      Routes API está consumiendo > 500 req/h sostenido por > 10 min. Run-rate
      proyectado > $1500/mes (vs budget objetivo $300/mes).

      Probables causas:
        1. Carrier abriendo eco-preview en bucle (UI bug, drag-loop)
        2. Endpoint /offers/:id/eco-preview siendo polled por cliente sin
           respetar staleTime (revisar useEcoPreview en apps/web)
        3. Test load injectado por error contra prod
        4. Spike legítimo de uso (validar con dashboard Cloud Run de api)

      Mitigación inmediata:
        - Revertir el último deploy del api si introduce nuevo polling
        - gcloud monitoring metrics list --filter="routes" para ver request_count por método
        - Si es legítimo: subir budget objetivo + threshold de este alert
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Gemini API — request rate alert
# -----------------------------------------------------------------------------
# Coaching IA es ~1 call por trip entregado. Volumen actual ≤ 100 trips/día =
# ≤ 5 req/h promedio. 100 req/h sostenido es 20× lo esperado y sugiere loop.
resource "google_monitoring_alert_policy" "gemini_api_rate" {
  display_name = "Gemini API request rate > 100/h"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "generativelanguage.googleapis.com request rate"
    condition_threshold {
      filter          = <<-EOT
        metric.type="serviceruntime.googleapis.com/api/request_count"
        resource.type="consumed_api"
        resource.labels.service="generativelanguage.googleapis.com"
      EOT
      duration        = "600s" # 10 min sostenido
      comparison      = "COMPARISON_GT"
      threshold_value = 0.0278 # ≈ 100 req/h en req/s

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    content   = <<-EOT
      Gemini API está consumiendo > 100 req/h sostenido. Volumen esperado
      es ≤5 req/h (1 coaching por trip entregado, ≤100 trips/día).

      Probables causas:
        1. Loop en confirmar-entrega-viaje.ts (re-disparo de generarCoachingViaje
           sin idempotencia respetada)
        2. Pub/Sub redelivery con DLQ deshabilitado en algún sub
        3. Test load contra prod
        4. Prompt injection forzando reintentos

      Mitigación inmediata:
        - Revisar logs api con jsonPayload.msg="coaching persistido" — ¿mismo
          tripId repetido?
        - El package coaching-generator tiene fallback a plantilla — apagar
          el genFn temporalmente seteando GEMINI_API_KEY a "" via secret rota
          si la API se descontrola
        - gcloud monitoring metrics list --filter="generativelanguage"
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Routes API — daily volume hard ceiling (defensa adicional)
# -----------------------------------------------------------------------------
# El rate alert de arriba detecta spikes. Este alert cubre el caso de drift
# lento: 200 req/h sostenido 24h también revienta el budget. Threshold 4000
# req/día corresponde a $20 USD/día = ~$600/mes (2× budget objetivo).
resource "google_monitoring_alert_policy" "routes_api_daily_volume" {
  display_name = "Routes API daily volume > 4000 req/24h"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"

  conditions {
    display_name = "routes.googleapis.com 24h sum"
    condition_threshold {
      filter          = <<-EOT
        metric.type="serviceruntime.googleapis.com/api/request_count"
        resource.type="consumed_api"
        resource.labels.service="routes.googleapis.com"
      EOT
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 4000

      aggregations {
        alignment_period     = "86400s" # 24h
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_alerts.id]

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    content   = <<-EOT
      Routes API superó 4000 requests en 24h (~$20/día). Run-rate proyectado
      ≥ 2× del budget objetivo $300/mes. Investigar antes del próximo billing
      cycle.
    EOT
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.apis]
}
