# -----------------------------------------------------------------------------
# T10-24 / ADR-012 Capa 2 — Observatorio urbano (piloto Coquimbo).
#
# El api exporta cada hora la foto de viajes entregados a `observatory.viajes`
# (load job WRITE_TRUNCATE, POST /admin/jobs/observatorio-export). Las vistas
# materializadas `urban_flow_metrics_*` agregan esa tabla y aplican k ≥ 10
# vehículos distintos por bucket (ADR-012 §Privacidad).
#
# Sin IAM: el SA runtime de Cloud Run ya tiene bigquery.dataEditor y
# bigquery.jobUser a nivel proyecto (iam.tf) y el job reusa
# `internal_cron_invoker` (scheduling.tf). Desviación declarada en
# .specs/observatorio-coquimbo/spec.md: vistas materializadas en lugar de
# Dataform.
# -----------------------------------------------------------------------------

locals {
  observatorio_tabla_viajes = "${google_project.booster_ai.project_id}.${google_bigquery_dataset.observatory.dataset_id}.${google_bigquery_table.observatorio_viajes.table_id}"

  # Vistas no incrementales (COUNT DISTINCT + HAVING): BigQuery exige
  # max_staleness y las refresca cada hora.
  observatorio_vistas = {
    franjas   = <<-SQL
      SELECT
        origen_region AS region,
        origen_comuna AS comuna,
        mes,
        tipo_dia,
        franja,
        clase_vehiculo,
        COUNT(*) AS viajes,
        COUNT(DISTINCT vehiculo_id) AS vehiculos
      FROM `${local.observatorio_tabla_viajes}`
      GROUP BY region, comuna, mes, tipo_dia, franja, clase_vehiculo
      HAVING COUNT(DISTINCT vehiculo_id) >= 10
    SQL
    emisiones = <<-SQL
      SELECT
        origen_region AS region,
        origen_comuna AS comuna,
        mes,
        clase_vehiculo,
        SUM(kgco2e) AS kgco2e,
        SUM(kgco2e_evitado) AS kgco2e_evitado,
        COUNT(*) AS viajes,
        COUNT(DISTINCT vehiculo_id) AS vehiculos
      FROM `${local.observatorio_tabla_viajes}`
      GROUP BY region, comuna, mes, clase_vehiculo
      HAVING COUNT(DISTINCT vehiculo_id) >= 10
    SQL
    od        = <<-SQL
      SELECT
        mes,
        origen_region,
        origen_comuna,
        destino_region,
        destino_comuna,
        COUNT(*) AS viajes,
        COUNT(DISTINCT vehiculo_id) AS vehiculos
      FROM `${local.observatorio_tabla_viajes}`
      GROUP BY mes, origen_region, origen_comuna, destino_region, destino_comuna
      HAVING COUNT(DISTINCT vehiculo_id) >= 10
    SQL
    activos   = <<-SQL
      SELECT
        origen_region AS region,
        origen_comuna AS comuna,
        mes,
        COUNT(*) AS viajes,
        COUNT(DISTINCT vehiculo_id) AS vehiculos
      FROM `${local.observatorio_tabla_viajes}`
      GROUP BY region, comuna, mes
      HAVING COUNT(DISTINCT vehiculo_id) >= 10
    SQL
  }
}

# Foto de viajes entregados (una fila por viaje). Reemplazada completa en cada
# export: se puede recrear sin pérdida.
resource "google_bigquery_table" "observatorio_viajes" {
  dataset_id          = google_bigquery_dataset.observatory.dataset_id
  table_id            = "viajes"
  project             = google_project.booster_ai.project_id
  description         = "Viajes entregados para el observatorio urbano (ADR-012). Uso interno: solo salen agregados k >= 10."
  deletion_protection = false

  schema = jsonencode([
    { name = "viaje_id", type = "STRING", mode = "REQUIRED" },
    { name = "vehiculo_id", type = "STRING", mode = "REQUIRED" },
    { name = "origen_region", type = "STRING", mode = "REQUIRED" },
    { name = "origen_comuna", type = "STRING", mode = "REQUIRED" },
    { name = "destino_region", type = "STRING", mode = "REQUIRED" },
    { name = "destino_comuna", type = "STRING", mode = "REQUIRED" },
    { name = "mes", type = "STRING", mode = "REQUIRED" },
    { name = "tipo_dia", type = "STRING", mode = "REQUIRED" },
    { name = "franja", type = "STRING", mode = "REQUIRED" },
    { name = "clase_vehiculo", type = "STRING", mode = "REQUIRED" },
    { name = "recogido_en", type = "TIMESTAMP", mode = "NULLABLE" },
    { name = "entregado_en", type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "distancia_km", type = "FLOAT64", mode = "NULLABLE" },
    { name = "kgco2e", type = "FLOAT64", mode = "REQUIRED" },
    { name = "kgco2e_evitado", type = "FLOAT64", mode = "REQUIRED" },
  ])

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

resource "google_bigquery_table" "urban_flow_metrics" {
  for_each = local.observatorio_vistas

  dataset_id          = google_bigquery_dataset.observatory.dataset_id
  table_id            = "urban_flow_metrics_${each.key}"
  project             = google_project.booster_ai.project_id
  description         = "Observatorio urbano (ADR-012): ${each.key}, buckets con k >= 10 vehículos."
  deletion_protection = false
  max_staleness       = "0-0 0 1:0:0"

  materialized_view {
    query                            = each.value
    enable_refresh                   = true
    refresh_interval_ms              = 3600000
    allow_non_incremental_definition = true
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
}

# Tick horario del export (minuto 7, fuera del pico de los :00).
resource "google_cloud_scheduler_job" "observatorio_export" {
  name        = "observatorio-export"
  description = "Cada hora: exporta viajes entregados a BigQuery observatory.viajes (T10-24, ADR-012 Capa 2)."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "7 * * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 2
    min_backoff_duration = "60s"
    max_backoff_duration = "600s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/observatorio-export"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}
