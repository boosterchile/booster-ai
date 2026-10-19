# T10-21 — matching-engine: acceso del api y observabilidad del corte
# (.specs/matching-engine-t10-21/spec.md).
#
# IAM: el api (SA runtime) es el único invocador de matching-engine. El
# servicio además verifica el ID token (aud + email) en la app. Cambio de IAM
# autorizado por el PO en T10-21 ("todos los cambios necesarios", "listas
# para producción"), declarado en el PR.
#
# Ingress: el PO (2026-10-19) dejó el servicio INTERNAL_ONLY, en contra del
# INGRESS_TRAFFIC_ALL de la spec §Seguridad. La spec asumía que el api no
# puede llegar a un run.app interno con egress PRIVATE_RANGES_ONLY. La zona
# DNS de abajo cierra ese hueco sin abrir el ingress ni cambiar el egress
# del api: dentro de la VPC el hostname de MATCHING_ENGINE_URL resuelve a
# private.googleapis.com (199.36.153.8/30), rango que PRIVATE_RANGES_ONLY sí
# manda por el connector. Private Google Access del connector viene
# habilitado por defecto.
locals {
  matching_run_app_host     = trimsuffix(trimprefix(local.cloud_run_matching_url, "https://"), "/")
  matching_run_app_dns_name = "${local.matching_run_app_host}."
}

resource "google_dns_managed_zone" "matching_run_app" {
  name        = "booster-matching-run-app"
  project     = google_project.booster_ai.project_id
  dns_name    = local.matching_run_app_dns_name
  description = "Hostname *.run.app de matching-engine → private.googleapis.com, solo dentro de la VPC. Así el api lo alcanza con ingress INTERNAL_ONLY."
  visibility  = "private"

  private_visibility_config {
    networks {
      network_url = google_compute_network.vpc.id
    }
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }

  depends_on = [google_project_service.apis]
}

resource "google_dns_record_set" "matching_run_app" {
  name         = local.matching_run_app_dns_name
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.matching_run_app.name
  type         = "A"
  ttl          = 300
  rrdatas = [
    "199.36.153.8",
    "199.36.153.9",
    "199.36.153.10",
    "199.36.153.11",
  ]
}

resource "google_cloud_run_v2_service_iam_member" "matching_engine_invoker_api" {
  project  = google_project.booster_ai.project_id
  location = var.region
  name     = module.service_matching_engine.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# Métricas sobre los logs del api (Pino messageKey='message'). Los filtros
# no admiten comentarios `#` dentro del heredoc.
locals {
  matching_log_metrics = {
    matching_shadow_divergencias = {
      mensaje     = "matching sombra diverge"
      descripcion = "Rankings en sombra donde matching-engine difiere del api (bloquea el corte)."
    }
    matching_shadow_coincidencias = {
      mensaje     = "matching sombra coincide"
      descripcion = "Rankings en sombra idénticos entre api y matching-engine."
    }
    matching_shadow_errores = {
      mensaje     = "matching sombra error"
      descripcion = "Llamadas en sombra a matching-engine que fallaron (red, auth, 5xx, contrato)."
    }
    matching_remoto_fallback = {
      mensaje     = "matching remoto fallo, fallback local"
      descripcion = "Con el corte activo, rankings que cayeron al cálculo local del api."
    }
  }
}

resource "google_logging_metric" "matching" {
  for_each    = local.matching_log_metrics
  name        = each.key
  project     = google_project.booster_ai.project_id
  description = each.value.descripcion

  filter = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="booster-ai-api"
    jsonPayload.message="${each.value.mensaje}"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

resource "google_monitoring_alert_policy" "matching" {
  for_each = {
    matching_shadow_divergencias = "matching-engine: divergencia en sombra (bloquea el corte)"
    matching_remoto_fallback     = "matching-engine: el api cayó al ranking local"
  }

  display_name = each.value
  project      = google_project.booster_ai.project_id
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = "algún evento en 5 min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.matching[each.key].name}\" AND resource.type=\"cloud_run_revision\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = local.alert_channel_ids

  documentation {
    content   = <<-EOT
      Ver docs/runbooks/service-matching-engine.md.

      - Divergencia: el ranking remoto difiere del local con la misma
        solicitud. Mismo algoritmo en ambos lados → causa típica: versión
        distinta de @booster-ai/matching-algorithm desplegada (release a
        medias). El usuario no se ve afectado en sombra.
      - Fallback: con el corte activo, matching-engine no respondió en 3 s,
        rechazó el token o violó el contrato; el api usó su cálculo local
        (el viaje igual recibió ofertas). Si persiste, apagar
        matching_via_microservice.
    EOT
    mime_type = "text/markdown"
  }
}
