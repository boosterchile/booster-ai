# =============================================================================
# CUENTAS INTERNAS DE SERVICIOS (service agents)
# =============================================================================
# Algunos servicios de Google usan una cuenta propia por proyecto
# (`service-<número>@gcp-sa-<servicio>.iam.gserviceaccount.com`). En un
# proyecto nuevo esa cuenta no existe hasta que se la pide, y un binding que la
# nombra falla con «Service account ... does not exist».
#
# Pasó en el primer apply de staging (2026-11-24) con el agente de Pub/Sub, que
# hubo que crear a mano. Declararlo aquí lo deja reproducible para cualquier
# entorno levantado desde cero, incluida una reconstrucción de prod (T10-20).
# En un proyecto donde ya existe, crear este recurso no cambia nada en GCP.

resource "google_project_service_identity" "pubsub" {
  provider = google-beta

  project = google_project.booster_ai.project_id
  service = "pubsub.googleapis.com"

  depends_on = [google_project_service.apis]
}
