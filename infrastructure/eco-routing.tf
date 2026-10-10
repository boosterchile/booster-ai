# -----------------------------------------------------------------------------
# T10-23 (ADR-012 Capa 1) — eco-routing en tiempo real.
# Solo declara un job de Scheduler: sin IAM. Reutiliza el SA
# `internal_cron_invoker` (scheduling.tf), igual que el resto de
# /admin/jobs/*. Va en su propio archivo porque scheduling.tf declara IAM y
# service accounts (archivo protegido por CLAUDE.md).
# -----------------------------------------------------------------------------

# Barrido para viajes con Teltonika. Con equipo en el camión la PWA no reporta
# posición, así que el disparo desde POST /assignments/:id/driver-position no
# corre: este job evalúa cada minuto las asignaciones `recogido` con IMEI.
# Pausado mientras el flag esté OFF; el handler además responde
# `skipped: flag_off` si el api no tiene el flag.
resource "google_cloud_scheduler_job" "eco_routing_barrido" {
  name        = "eco-routing-barrido"
  description = "Cada 1 min: evalúa congestión y sugerencias de ruta en viajes con Teltonika (T10-23)."
  project     = google_project.booster_ai.project_id

  paused = !var.eco_routing_realtime_activated

  region    = "southamerica-east1"
  schedule  = "* * * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 0
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 1
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/eco-routing-barrido"
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
