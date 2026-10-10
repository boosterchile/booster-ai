# -----------------------------------------------------------------------------
# T10-21 — document-service (worker TED): reconciliación periódica.
# Solo declara un job de Scheduler: sin IAM. Reutiliza el SA
# `internal_cron_invoker` (scheduling.tf), igual que el resto de
# /admin/jobs/*. Va en su propio archivo porque scheduling.tf declara IAM y
# service accounts (archivo protegido por CLAUDE.md).
# -----------------------------------------------------------------------------

# T10-21 — reconciliación de `documentos_transporte` con el worker TED
# (`apps/document-service`): libera `procesando` abandonados (> 30 min) a
# `fallido` y republica a `document.uploaded` los `pendiente` sin tocar por
# > 10 min (documentos subidos antes de cablear el topic o con publish
# fallido). Idempotente: el claim condicional del worker descarta duplicados.
resource "google_cloud_scheduler_job" "documentos_pendientes" {
  name        = "documentos-pendientes"
  description = "Cada 15 min: reconcilia documentos_transporte pendientes/atascados con el worker TED (T10-21)."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "*/15 * * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 1
    min_backoff_duration = "60s"
    max_backoff_duration = "120s"
    max_doublings        = 1
  }

  depends_on = [google_project_service.apis, module.service_api]

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/documentos-pendientes"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }
}
