# -----------------------------------------------------------------------------
# ADR-079 §4 — valor UF del día para facturar suscripciones en UF.
# Fuente CMF (API v3, requiere clave) con respaldo SII (decisión PO 2026-10-08).
# Este archivo solo declara un secreto y un job de Scheduler: sin IAM. El SA
# runtime del api ya tiene secretAccessor a nivel proyecto (iam.tf) y el job
# reusa el SA `internal_cron_invoker` (scheduling.tf).
# -----------------------------------------------------------------------------

# Clave de la API de la CMF (https://api.cmfchile.cl). Mientras siga el
# placeholder, el api la trata como ausente (config.ts: prefijo ROTATE_ME_) y
# toma el valor UF solo del SII. Cargar el valor real con:
#   echo -n "<clave>" | gcloud secrets versions add cmf-api-key --data-file=-
resource "google_secret_manager_secret" "cmf_api_key" {
  secret_id = "cmf-api-key"
  project   = google_project.booster_ai.project_id

  replication {
    auto {}
  }

  labels = {
    managed_by = "terraform"
    env        = var.environment
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "cmf_api_key_placeholder" {
  secret      = google_secret_manager_secret.cmf_api_key.id
  secret_data = "ROTATE_ME_CMF_API_KEY_PLACEHOLDER"

  lifecycle {
    # Rotado el valor real, Terraform no debe sobrescribirlo.
    ignore_changes = [secret_data, enabled]
  }
}

# Tick diario 07:15 America/Santiago: guarda el valor UF del día en
# `valores_uf` (caché auditada con su fuente). El cobro mensual lo vuelve a
# pedir si falta, así que este job es la red para tener el valor antes del
# día 1. Responde 503 si ninguna fuente responde → Scheduler reintenta.
# Solo lee fuentes públicas y escribe una fila: no mueve dinero, no se pausa.
resource "google_cloud_scheduler_job" "valor_uf_diario" {
  name        = "valor-uf-diario"
  description = "Diario 07:15 Santiago: guarda el valor UF del día (CMF con respaldo SII). ADR-079 §4."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "15 7 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "300s"
    max_backoff_duration = "1800s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/valor-uf"
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
