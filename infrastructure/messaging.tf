# Pub/Sub topics + dead-letter queues.
# Ver ADR-005 (telemetría), ADR-004 (trip events), ADR-006 (whatsapp inbound).

locals {
  # Cada topic se acompaña de su DLQ para mensajes que fallan al procesarse.
  pubsub_topics = [
    "telemetry-events",         # Teltonika + PWA driver → processor
    "trip-events",              # trip lifecycle state changes
    "whatsapp-inbound-events",  # mensajes Meta WhatsApp
    "notification-events",      # fan-out notificaciones
    "vehicle-availability-events", # vehículos disponibles para matching
    "traffic-condition-events", # congestión detectada → eco-routing
    "document-events",          # emisiones DTE, OCR requests
  ]
}

# Topics principales
resource "google_pubsub_topic" "telemetry_events" {
  name    = "telemetry-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  message_retention_duration = "86400s" # 24h
  depends_on                 = [google_project_service.apis]
}

resource "google_pubsub_topic" "trip_events" {
  name    = "trip-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "whatsapp_inbound" {
  name    = "whatsapp-inbound-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "notification_events" {
  name    = "notification-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "vehicle_availability" {
  name    = "vehicle-availability-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "traffic_condition" {
  name    = "traffic-condition-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "document_events" {
  name    = "document-events"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  depends_on = [google_project_service.apis]
}

# Dead-letter topics (uno global, DLQ separada por subscription)
resource "google_pubsub_topic" "dlq" {
  name    = "pubsub-dead-letter"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "dead-letter"
  }
  message_retention_duration = "2592000s" # 30 días
  depends_on                 = [google_project_service.apis]
}
