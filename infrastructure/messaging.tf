# Pub/Sub topics + dead-letter queues.
# Ver ADR-005 (telemetría), ADR-004 (trip events), ADR-006 (whatsapp inbound).

locals {
  # Cada topic se acompaña de su DLQ para mensajes que fallan al procesarse.
  pubsub_topics = [
    "telemetry-events",                  # Teltonika + PWA driver → processor
    "trip-events",                       # trip lifecycle state changes
    "whatsapp-inbound-events",           # mensajes Meta WhatsApp
    "notification-events",               # fan-out notificaciones
    "vehicle-availability-events",       # vehículos disponibles para matching
    "traffic-condition-events",          # congestión detectada → eco-routing
    "document-events",                   # emisiones DTE, OCR requests
    "telemetry-events-safety-p0",        # Wave 2: Crash/Unplug/GNSS Jamming → notification
    "telemetry-events-security-p1",      # Wave 2: Tow/Auto Geofence → notification
    "telemetry-events-eco-score",        # Wave 2: Idling/Green/Speed → matching-algorithm
    "telemetry-events-trip-transitions", # Wave 2: Trip start-end/Geofence → trip-state-machine
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

# Chat shipper↔transportista (P3.b). Cada vez que se inserta un mensaje
# en la tabla mensajes_chat, el api publica acá con atributo
# `assignment_id`. Los SSE consumers (HTTP long-poll en GET
# /assignments/:id/messages/stream) crean una subscription efímera con
# filtro `attributes.assignment_id = "..."` y cuando el cliente
# desconecta, la subscription se elimina.
#
# Retention corto (1h): si nadie está suscrito en ese momento (ningún tab
# abierto), el mensaje se pierde — el cliente igual se va a enterar al
# próximo GET listado (que va al DB, no al topic). El topic es solo el
# canal de "push instantáneo a tabs vivos".
resource "google_pubsub_topic" "chat_messages" {
  name    = "chat-messages"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
  }
  message_retention_duration = "3600s" # 1h
  depends_on                 = [google_project_service.apis]
}

# =============================================================================
# Wave 2 — Eventos AVL eventuales (Track B2)
# =============================================================================
# Los AVL IDs Panic/High Priority del FMC150 (Crash, Unplug, GNSS Jamming,
# Tow, Auto Geofence, Idling, Green Driving, Over Speeding, Trip,
# Geofence Zone) se rutean a 4 topics dedicados según su channel.
#
# El gateway (`apps/telemetry-tcp-gateway`) usa
# `routeEvent()` del package `@booster-ai/shared-schemas/avl-ids` para
# decidir el topic de cada evento detectado en un AVL packet. Mantener
# sincronizado: si agregás un channel nuevo en `event-router.ts`,
# agregalo acá también.

resource "google_pubsub_topic" "telemetry_events_safety_p0" {
  name    = "telemetry-events-safety-p0"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
    priority   = "panic"
  }
  # 7 días: eventos críticos no se pueden perder si el consumer está caído.
  message_retention_duration = "604800s"
  depends_on                 = [google_project_service.apis]
}

resource "google_pubsub_topic" "telemetry_events_security_p1" {
  name    = "telemetry-events-security-p1"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
    priority   = "high"
  }
  message_retention_duration = "604800s"
  depends_on                 = [google_project_service.apis]
}

resource "google_pubsub_topic" "telemetry_events_eco_score" {
  name    = "telemetry-events-eco-score"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
    purpose    = "eco-score-aggregation"
  }
  # Eco Score es agregación offline; 24h es suficiente.
  message_retention_duration = "86400s"
  depends_on                 = [google_project_service.apis]
}

resource "google_pubsub_topic" "telemetry_events_trip_transitions" {
  name    = "telemetry-events-trip-transitions"
  project = google_project.booster_ai.project_id
  labels = {
    env        = var.environment
    managed_by = "terraform"
    wave       = "2"
    consumer   = "trip-state-machine"
  }
  message_retention_duration = "86400s"
  depends_on                 = [google_project_service.apis]
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

# =============================================================================
# SUBSCRIPTIONS — pull-based (Cloud Run consumers)
# =============================================================================
# Cada Cloud Run service que consume Pub/Sub define su propia subscription.
# Sin esto el cliente recibe StatusError "Resource not found" al startup y se
# queda en backoff sin procesar ningún mensaje. Caso real: 2026-05-03
# telemetry-processor consumiendo telemetry-events sin subscription creada
# → 0 escrituras a telemetria_puntos por ~10h.

resource "google_pubsub_subscription" "telemetry_events_processor" {
  name    = "telemetry-events-processor-sub"
  topic   = google_pubsub_topic.telemetry_events.name
  project = google_project.booster_ai.project_id

  # 60s permite procesar 1 packet (parse + insert) con margen.
  ack_deadline_seconds = 60

  # 7 días de retención en el broker para tolerar downtime del processor.
  message_retention_duration = "604800s"

  # Subscription perpetua — el processor no debería borrarse sin update aquí.
  expiration_policy {
    ttl = ""
  }

  # DLQ: tras 5 nack/timeout, el packet va a pubsub-dead-letter.
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = 5
  }

  # Retry exponencial entre 10s y 600s.
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    consumer   = "telemetry-processor"
  }
}

# Wave 2 — Subscriptions para los 4 topics de eventos AVL eventuales.
# Pull-based: el consumer (notification-service / matching-engine /
# trip-state-machine) crea conexión streaming pull al startup.

resource "google_pubsub_subscription" "telemetry_events_safety_p0_notification" {
  name    = "telemetry-events-safety-p0-notification-sub"
  topic   = google_pubsub_topic.telemetry_events_safety_p0.name
  project = google_project.booster_ai.project_id

  # 30s — eventos panic deben acknowledgearse rápido. SMS + push + WhatsApp
  # deberían disparar en < 5s, ack en < 30s con margen.
  ack_deadline_seconds = 30

  # 7 días: si el notification-service está caído, no perdemos eventos
  # críticos por retención corta.
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    # Retry agresivo en eventos panic: empezar a reintentar en 5s.
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    consumer   = "notification-service"
    wave       = "2"
    priority   = "panic"
  }
}

resource "google_pubsub_subscription" "telemetry_events_security_p1_notification" {
  name    = "telemetry-events-security-p1-notification-sub"
  topic   = google_pubsub_topic.telemetry_events_security_p1.name
  project = google_project.booster_ai.project_id

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = ""
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    consumer   = "notification-service"
    wave       = "2"
    priority   = "high"
  }
}

resource "google_pubsub_subscription" "telemetry_events_eco_score_matching" {
  name    = "telemetry-events-eco-score-matching-sub"
  topic   = google_pubsub_topic.telemetry_events_eco_score.name
  project = google_project.booster_ai.project_id

  # Eco Score es agregación batch — ack más relajado.
  ack_deadline_seconds       = 120
  message_retention_duration = "86400s"

  expiration_policy {
    ttl = ""
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = 3
  }

  retry_policy {
    minimum_backoff = "30s"
    maximum_backoff = "600s"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    consumer   = "matching-engine"
    wave       = "2"
    purpose    = "eco-score-aggregation"
  }
}

resource "google_pubsub_subscription" "telemetry_events_trip_transitions" {
  name    = "telemetry-events-trip-transitions-sub"
  topic   = google_pubsub_topic.telemetry_events_trip_transitions.name
  project = google_project.booster_ai.project_id

  ack_deadline_seconds       = 60
  message_retention_duration = "86400s"

  expiration_policy {
    ttl = ""
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
    consumer   = "trip-state-machine"
    wave       = "2"
  }
}
