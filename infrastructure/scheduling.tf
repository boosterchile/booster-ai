# Cloud Scheduler jobs — crones internos disparados desde GCP (P3.d y futuros).
#
# Patrón:
#   - SA dedicado (chat-cron-invoker@) con permission roles/run.invoker SOLO
#     sobre el endpoint que ataca. Esto limita el blast radius si la creden
#     del scheduler se filtra (no podría invocar otros endpoints).
#   - Cloud Scheduler firma OIDC con audience = URL del endpoint y email del
#     SA del scheduler.
#   - El api valida claims.email == config.INTERNAL_CRON_CALLER_SA via
#     createAuthMiddleware. Sin este wire el endpoint /admin/jobs/* responde 401.

# -----------------------------------------------------------------------------
# Service Account dedicado para Cloud Scheduler crons internos
# -----------------------------------------------------------------------------
resource "google_service_account" "internal_cron_invoker" {
  account_id   = "internal-cron-invoker"
  display_name = "Internal Cron Scheduler Invoker"
  description  = "SA usado por Cloud Scheduler para invocar /admin/jobs/* en booster-ai-api con OIDC. Limitado a roles/run.invoker SOLO sobre booster-ai-api (no otros services). Ver P3.d."
  project      = google_project.booster_ai.project_id
  depends_on   = [google_project_service.apis]
}

# Permitir que este SA invoque booster-ai-api. Aunque el service está
# como public=true (allUsers run.invoker para CORS preflight), este
# binding explícito documenta la intención y sirve si en el futuro
# revertimos el public.
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker_api" {
  project  = google_project.booster_ai.project_id
  location = var.region
  name     = "booster-ai-api"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.internal_cron_invoker.email}"
  depends_on = [
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# P3.d — Cloud Scheduler para fallback WhatsApp del chat
# -----------------------------------------------------------------------------
# Cada 1 minuto, POST /admin/jobs/chat-whatsapp-fallback. El handler
# query-ea mensajes de chat sin leer > 5 min sin notif WhatsApp enviada
# y manda template Twilio al dueño activo de la empresa contraria.
#
# Schedule: cada 1 min (* * * * *) — agresivo pero el handler skipea
# fast si no hay candidatos (1 SELECT corto).
#
# Retry: si el handler falla (5xx o timeout), Cloud Scheduler reintenta
# hasta 3 veces con backoff exponencial.
resource "google_cloud_scheduler_job" "chat_whatsapp_fallback" {
  name        = "chat-whatsapp-fallback"
  description = "Cada 1 min: manda WhatsApp template a destinatarios de mensajes de chat no leídos > 5 min."
  project     = google_project.booster_ai.project_id
  region      = var.region
  schedule    = "* * * * *"
  time_zone   = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/chat-whatsapp-fallback"
    # Body vacío — el handler no necesita input.
    body = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      # Audience = URL del Cloud Run (sin path) — Google la valida contra
      # claims.aud en el JWT. Tiene que ser exactamente la URL base.
      audience = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}
