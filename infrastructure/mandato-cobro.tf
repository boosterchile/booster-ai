# -----------------------------------------------------------------------------
# ADR-080 — mandato de cobro: conciliación diaria.
# Solo declara un job de Scheduler: sin IAM. Reutiliza el SA
# `internal_cron_invoker` (scheduling.tf), igual que valor-uf-diario.
# Con MANDATO_COBRO_ACTIVATED = false el endpoint responde 200 sin tocar la
# base (`skipped: mandato_cobro_desactivado`), así que el job puede existir
# antes de activar el flujo.
# -----------------------------------------------------------------------------

# Diario 06:20 America/Santiago: registra la mora de los cobros vencidos y
# publica los gauges de caja (float de terceros, mora del mes, anticipos del
# mes, liberaciones vencidas). Registra eventos, no mueve dinero.
resource "google_cloud_scheduler_job" "mandato_cobro_conciliacion" {
  name        = "mandato-cobro-conciliacion"
  description = "Diario 06:20 Santiago: mora de cobros vencidos y métricas de caja del mandato de cobro. ADR-080."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "20 6 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "300s"
    max_backoff_duration = "1800s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/mandato-cobro-conciliacion"
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
