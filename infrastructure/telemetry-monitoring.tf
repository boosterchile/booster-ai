# Wave 2 D5 — Métricas custom + dashboards + alertas para el sistema
# de telemetría (gateway + processor + apps consumer de eventos AVL).
#
# Estrategia: metric-from-log con `google_logging_metric` para no
# requerir cambios en código (los logs estructurados Pino ya tienen los
# campos necesarios). Lo que requiere instrumentation OpenTelemetry
# (latency p99) queda como TODO en docs/runbooks/oncall-telemetry-incidents.md.
#
# ⚠️ CAMPO DEL MENSAJE = `jsonPayload.message` (no `jsonPayload.msg`).
# El logger Booster configura Pino con `messageKey: 'message'`
# (packages/logger/src/createLogger.ts). Los filtros originales usaban
# `jsonPayload.msg=...` → matcheaban 0 entradas → los log-metrics que SÍ se
# emiten (device_records_per_minute, tcp_connection_resets, parser_errors,
# crash_events, sms_fallback_received, y crash_trace_persistence_failures en
# crash-traces.tf) estuvieron MUERTOS desde su creación.
# (unplug_events y gnss_jamming_critical_events están muertos por OTRA razón:
# de eventName las emite telemetry-processor/src/panic-events.ts desde 2026-06-11.)
# Corregido 2026-06-08 (.specs/telemetry-monitoring-observability).

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
    jsonPayload.message="avl packet procesado"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Telemetry records per minute"
    labels {
      key         = "imei"
      value_type  = "STRING"
      description = "IMEI del device Teltonika"
    }
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
    (jsonPayload.message=~"preamble inesperado" OR jsonPayload.message=~"CRC inválido")
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
    jsonPayload.message="parse error, ack 0 + cerramos"
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
    jsonPayload.message="crash-trace persistido"
  EOT

  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Crash events total"
    labels {
      key         = "imei"
      value_type  = "STRING"
      description = "IMEI del device origen del crash"
    }
    labels {
      key         = "vehicle_id"
      value_type  = "STRING"
      description = "UUID del vehículo (puede ser empty si device pendiente)"
    }
  }

  label_extractors = {
    "imei"       = "EXTRACT(jsonPayload.imei)"
    "vehicle_id" = "EXTRACT(jsonPayload.vehicleId)"
  }
}

# Unplug events (AVL 252) — emitido por telemetry-processor
# (src/panic-events.ts) al detectar el IO en cualquier record, incluidos
# los del path SMS fallback. DESBLOQUEADO 2026-06-11 (antes dependía del
# notification-service skeleton y producía 0 series — auditoría 2026-06-09).
# Los literales eventName/rawValue son CONTRATO con panic-events.ts.
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

# GNSS Jamming critical — AVL 318 con valor=2 (1=warning queda en logs sin
# disparar P0). Emitido por telemetry-processor (src/panic-events.ts).
# DESBLOQUEADO 2026-06-11; literales = contrato con panic-events.ts.
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
    jsonPayload.message=~"sms fallback procesado"
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

  notification_channels = local.alert_channel_ids

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

  notification_channels = local.alert_channel_ids

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

  notification_channels = local.alert_channel_ids

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

  notification_channels = local.alert_channel_ids

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

  notification_channels = local.alert_channel_ids

  documentation {
    content   = "Backlog (conteo) en subscription telemetría. Señal SECUNDARIA: el conteo depende del volumen y de noche (fleet estacionado, poco tráfico) tarda horas en cruzar 1000 → enmascara un consumer caído. El detector PRIMARIO de consumer detenido es `telemetry_consumer_stalled_p1` (oldest_unacked_message_age). Ver runbook: docs/runbooks/oncall-telemetry-incidents.md#telemetry-consumer-stalled"
    mime_type = "text/markdown"
  }
}

# P1 — Consumer de telemetría DETENIDO (el modo de falla del incidente
# 2026-06-07: el telemetry-processor escaló a cero y dejó de consumir ~26h).
#
# Detector: `oldest_unacked_message_age` — la antigüedad del mensaje más viejo
# sin ack. Sube +60s/min apenas muere el consumer, INDEPENDIENTE del volumen, así
# que cruza el umbral incluso de madrugada con poco tráfico (a diferencia del
# conteo de backlog, que de noche tardó 14h en cruzar 1000).
#
# Evidencia (incidente real, verificada en vivo): durante el corte con el Cloud
# Run en CERO instancias, esta métrica subió linealmente 0.8h→25.6h (no se volvió
# sparse ni desapareció), y su baseline sano post-fix es 0s. Por eso es threshold
# positivo (GT 1800), no detección por ausencia. Umbral 30min + 5min sostenido →
# dispara a ~35min del inicio.
#
# Sólo `telemetry-events-processor-sub` (el stream de alto volumen, que es el
# incidente). NO incluye `crash-traces-processor-sub`: es bursty/raro y un único
# crash-trace lento (upload GCS + insert BQ con retries) podría envejecer >30min y
# flapear sin outage real. El stall del consumer de crash-traces ya está cubierto
# por `pubsub_dlq` (monitoring.tf) + `crash_trace_persistence_failures` (crash-traces.tf).
resource "google_monitoring_alert_policy" "telemetry_consumer_stalled_p1" {
  display_name = "Telemetry consumer stalled — oldest unacked > 30min (P1)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "oldest unacked message age > 30 min"
    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"telemetry-events-processor-sub\" AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1800 # 30 min

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = "El telemetry-processor no está consumiendo Pub/Sub (mensajes envejeciendo sin ack). Causa típica: el Cloud Run escaló a cero (es un consumer PULL/StreamingPull — necesita min-instances>=1 + CPU always-on). Cubre 'consumer muerto', NO 'consumer vivo pero fallando el write' (ese es pubsub_dlq + crash_trace_persistence_failures). Runbook: docs/runbooks/oncall-telemetry-incidents.md#telemetry-consumer-stalled"
    mime_type = "text/markdown"
  }
}

# P1 — Gateway de telemetría CAÍDO (no hay capacidad de ingreso).
#
# Modo de falla complementario al consumer-stall: si el pod del gateway muere
# (crash, OOM, evicción sin reschedule, config error) o el cluster lo pierde, NO
# entra telemetría a Pub/Sub. El consumer-stall NO lo caza (sin mensajes nuevos,
# oldest_unacked se queda en 0), así que esta es la ÚNICA alerta de ese modo.
#
# Detector: liveness POSITIVO del pod vía `kubernetes.io/container/uptime`. Es una
# serie estable 24/7 que existe mientras el container corre y DESAPARECE si el pod
# muere — sin enmascaramiento nocturno (a diferencia de device_records, que cae a 0
# legítimamente con el fleet estacionado; los Network Pings 0xFF no cuentan como
# records). Verificado en vivo: serie continua, 0 huecos en 96h.
#
# `condition_absent` + agregación que COLAPSA pod_name (REDUCE_COUNT por
# cluster/namespace/container): así un rolling restart (pod_name nuevo) mantiene la
# serie presente y NO falsea; sólo dispara si NO hay ningún pod del gateway por
# `duration`. duration=600s (10min) > cualquier gap de restart normal (0 restarts
# en 96h observados); el consumer-stall (30min) queda como backstop.
#
# ⚠️ PENDIENTE VALIDACIÓN EMPÍRICA: una alerta por ausencia no se confía sin verla
# disparar. Validar con un stop controlado del gateway (~3min, los devices Teltonika
# buffean y reenvían → pérdida ≈0). Ver runbook §Telemetry ingress stopped y
# .specs/telemetry-gateway-liveness-alert.
resource "google_monitoring_alert_policy" "telemetry_gateway_down_p1" {
  display_name = "Telemetry gateway pod down — no ingress (P1)"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "ERROR"

  conditions {
    display_name = "no gateway container reporting uptime > 10 min"
    condition_absent {
      filter   = "resource.type=\"k8s_container\" AND resource.labels.cluster_name=\"booster-ai-telemetry\" AND resource.labels.namespace_name=\"telemetry\" AND resource.labels.container_name=\"gateway\" AND metric.type=\"kubernetes.io/container/uptime\""
      duration = "600s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
        # Colapsar pod_name → "cuántos pods del gateway reportan". Sobrevive
        # rolling restarts (el pod nuevo entra al mismo grupo); ausente sólo
        # cuando NO hay ningún pod del gateway.
        cross_series_reducer = "REDUCE_COUNT"
        group_by_fields = [
          "resource.label.cluster_name",
          "resource.label.namespace_name",
          "resource.label.container_name",
        ]
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = "El pod del gateway de telemetría no reporta hace >10min — no hay capacidad de ingreso (devices Teltonika no pueden conectar). Revisar pod (kubectl get pods -n telemetry), evicción/OOM, LB/DNS, cert TLS. Runbook: docs/runbooks/oncall-telemetry-incidents.md#telemetry-ingress-stopped"
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
  project = google_project.booster_ai.project_id

  # GCP normaliza/reordena el JSON del dashboard → diff perpetuo en cada plan
  # (#412). Ignorado para que el drift check no salga en rojo por ruido. Trade-off:
  # terraform deja de gestionar el contenido del dashboard (se edita en consola).
  lifecycle {
    ignore_changes = [dashboard_json]
  }

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
                    filter = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.device_records_per_minute.name}\""
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

# ──────────────────────────────────────────────────────────────────────────
# P1-A (audit 2026-06-14) — Backlog/stall de las 4 subscriptions Wave 2.
#
# Contexto (P0-G): notification-service, matching-engine y trip-state-machine
# son hoy servicios skeleton; sus subscriptions Wave 2 están creadas y
# acumulan mensajes sin consumidor. `oldest_unacked_message_age` es el detector
# PRIMARIO de "consumer detenido": sube +60s/min apenas el consumer deja de
# ack-ear, INDEPENDIENTE del volumen (a diferencia del conteo de backlog, que
# de noche tarda horas en cruzar un umbral y enmascara un consumer caído).
# Mismo patrón que `telemetry_consumer_stalled_p1`.
#
# Sin estas alertas, un consumer caído (o el skeleton que nunca consume) pasa
# desapercibido hasta que los mensajes mueren por retención (hasta 7 días en
# safety-p0). Umbrales diferenciados por criticidad del stream.
#
# NOTA safety-p0: la DETECCIÓN del evento panic (crash/unplug/jamming) ya la
# cubren crash_event_p0 / unplug_event_p0 / gnss_jamming_p0. Esta alerta es
# complementaria: detecta que el FAN-OUT al transportista (SMS/push/WhatsApp)
# no se está entregando.
locals {
  wave2_stall_alerts = {
    safety_p0 = {
      subscription_id = "telemetry-events-safety-p0-notification-sub"
      threshold_s     = 600 # 10 min — fan-out de eventos panic, debe ackear en <30s
      severity        = "CRITICAL"
      consumer        = "notification-service"
      detail          = "El fan-out de eventos panic (crash/unplug/jamming) al transportista (SMS/push/WhatsApp) está detenido. La detección del evento en sí ya la cubre crash_event_p0/unplug_event_p0/gnss_jamming_p0; esta alerta es que la NOTIFICACIÓN no se entrega."
    }
    security_p1 = {
      subscription_id = "telemetry-events-security-p1-notification-sub"
      threshold_s     = 1800 # 30 min
      severity        = "ERROR"
      consumer        = "notification-service"
      detail          = "El consumer de eventos de seguridad P1 no está ackeando."
    }
    eco_score = {
      subscription_id = "telemetry-events-eco-score-matching-sub"
      threshold_s     = 3600 # 1 h — agregación batch, ack relajado (120s), retención 1 día
      severity        = "WARNING"
      consumer        = "matching-engine"
      detail          = "El consumer de eco-score (agregación batch para matching) no está ackeando."
    }
    trip_transitions = {
      subscription_id = "telemetry-events-trip-transitions-sub"
      threshold_s     = 1800 # 30 min
      severity        = "ERROR"
      consumer        = "trip-state-machine"
      detail          = "El consumer de trip-transitions no está ackeando."
    }
  }
}

resource "google_monitoring_alert_policy" "wave2_consumer_stalled" {
  for_each = local.wave2_stall_alerts

  display_name = "Wave2 ${each.key} consumer stalled — oldest unacked > ${floor(each.value.threshold_s / 60)}min (${each.value.severity})"
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = each.value.severity

  conditions {
    display_name = "oldest unacked message age > ${floor(each.value.threshold_s / 60)} min"
    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND resource.labels.subscription_id=\"${each.value.subscription_id}\" AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold_s

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = "${each.value.detail} Consumer: ${each.value.consumer} (subscription ${each.value.subscription_id}). oldest_unacked_message_age sube +60s/min al morir el consumer, independiente del volumen. Mismo patrón que telemetry_consumer_stalled_p1. Contexto: audit 2026-06-14 P0-G/P1-A (servicios Wave 2 skeleton). Runbook: docs/runbooks/oncall-telemetry-incidents.md#telemetry-consumer-stalled"
    mime_type = "text/markdown"
  }
}
