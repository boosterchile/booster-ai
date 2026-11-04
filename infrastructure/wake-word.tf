# -----------------------------------------------------------------------------
# ADR-036 / T10-22 — wake-word "Oye Booster" con Picovoice Porcupine.
# Solo declara el secreto de la AccessKey: sin IAM. El SA runtime del api ya
# tiene secretAccessor sobre los secretos del proyecto (security.tf). Las URLs
# de los modelos son variables de compute.tf (wake_word_keyword_url y
# wake_word_model_url); el flag es wake_word_voice_activated.
# -----------------------------------------------------------------------------

# AccessKey de Picovoice Console. Mientras siga el placeholder, GET
# /me/wake-word responde `disponible: false, motivo: sin_access_key`. Cargar el
# valor real con:
#   echo -n "<access-key>" | gcloud secrets versions add picovoice-access-key --data-file=-
resource "google_secret_manager_secret" "picovoice_access_key" {
  secret_id = "picovoice-access-key"
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

resource "google_secret_manager_secret_version" "picovoice_access_key_placeholder" {
  secret      = google_secret_manager_secret.picovoice_access_key.id
  secret_data = "ROTATE_ME_PICOVOICE_ACCESS_KEY_PLACEHOLDER"

  lifecycle {
    # Rotado el valor real, Terraform no debe sobrescribirlo.
    ignore_changes = [secret_data, enabled]
  }
}
