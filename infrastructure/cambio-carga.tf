# -----------------------------------------------------------------------------
# editar-anular-cargas §6.14 — recordatorio de solicitudes de cambio de carga.
# Declara solo un job de Scheduler, sin IAM: reutiliza el SA
# `internal_cron_invoker` (scheduling.tf), igual que el resto de
# /admin/jobs/*. Va en su propio archivo porque scheduling.tf declara IAM y
# service accounts (archivo protegido por CLAUDE.md). El `terraform apply` en
# producción lo hace el PO.
# -----------------------------------------------------------------------------

# Cada 15 min el api toma las solicitudes pendientes cuyo último aviso supera
# CAMBIO_RECORDATORIO_INTERVALO_MIN (default 60) y le recuerda a la oficina de
# la transportista que responda: la recogida queda bloqueada hasta entonces.
# Idempotente: FOR UPDATE SKIP LOCKED y marca de último aviso en la misma tx.
# Sin VAPID configurado el endpoint responde 200 skipped.
resource "google_cloud_scheduler_job" "solicitudes_cambio_recordatorio" {
  name        = "solicitudes-cambio-recordatorio"
  description = "Cada 15 min: recuerda a la transportista las solicitudes de cambio de carga sin responder (editar-anular-cargas §6.14)."
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
    uri         = "${local.cloud_run_api_url}/admin/jobs/solicitudes-cambio-recordatorio"
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
