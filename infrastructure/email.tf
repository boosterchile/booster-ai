# =============================================================================
# Correo saliente (Resend) — T10-04, ADR-082
# =============================================================================
# El api envía por correo el PIN del conductor y el código de activación del
# dueño (apps/api/src/services/notifications/*-activacion-email.ts). Sin
# RESEND_API_KEY cae al LoggingEmailSender y el correo NO sale.
#
# Apply en dos pasos, igual que los content-sid (INC-2026-06-19):
#   1. Este bloque crea el secreto con un placeholder. No se monta.
#   2. El PO carga la key real:
#        echo -n "re_..." | gcloud secrets versions add resend-api-key --data-file=-
#      verifica el dominio en Resend y pone `resend_api_key_ready = true`.
# Montar el placeholder no tumba el arranque (config.ts solo exige min 8), pero
# haría que cada alta intente enviar con una key inválida.
#
# Sin IAM nuevo: el runtime SA del api ya tiene
# roles/secretmanager.secretAccessor a nivel proyecto (security.tf).

resource "google_secret_manager_secret" "resend_api_key" {
  secret_id = "resend-api-key"
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

resource "google_secret_manager_secret_version" "resend_api_key_placeholder" {
  secret      = google_secret_manager_secret.resend_api_key.id
  secret_data = "ROTATE_ME_RESEND_API_KEY_PLACEHOLDER"

  lifecycle {
    # La key real la carga el PO; Terraform no debe sobrescribirla.
    ignore_changes = [secret_data, enabled]
  }
}
