# -----------------------------------------------------------------------------
# matching-desde-la-carga §3.9 / §11-3 — recordatorio de vehículo pendiente.
# Declara solo un job de Scheduler, sin IAM: reutiliza el SA
# `internal_cron_invoker` (scheduling.tf), igual que el resto de
# /admin/jobs/*. Va en su propio archivo porque scheduling.tf declara IAM y
# service accounts (archivo protegido por CLAUDE.md). El `terraform apply` en
# producción lo hace el PO.
# -----------------------------------------------------------------------------

# Cada 15 min el api toma asignaciones sin vehículo cuya ventana de recogida
# está a 24 h / 2 h o ya empezó, y avisa a la oficina o al generador.
# Idempotente: FOR UPDATE SKIP LOCKED y marca por etapa en la misma tx.
# Sin VAPID configurado el endpoint responde 200 skipped.
resource "google_cloud_scheduler_job" "vehiculo_pendiente_recordatorio" {
  name        = "vehiculo-pendiente-recordatorio"
  description = "Cada 15 min: recuerda declarar el vehículo 24 h / 2 h antes de la ventana, y avisa al generador si ya empezó (matching-desde-la-carga §3.9)."
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
    uri         = "${local.cloud_run_api_url}/admin/jobs/vehiculo-pendiente-recordatorio"
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
