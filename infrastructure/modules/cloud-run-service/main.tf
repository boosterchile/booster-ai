resource "google_cloud_run_v2_service" "service" {
  name     = var.service_name
  project  = var.project_id
  location = var.region

  deletion_protection = var.deletion_protection

  template {
    service_account = var.service_account_email
    timeout         = "${var.timeout_seconds}s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    dynamic "vpc_access" {
      for_each = var.vpc_connector != null ? [1] : []
      content {
        connector = var.vpc_connector
        egress    = var.vpc_egress
      }
    }

    containers {
      image = var.container_image

      ports {
        container_port = var.port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secrets
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      # Startup probe: espera a que el container esté listo antes de ruutear
      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 10
        timeout_seconds       = 2
      }

      # Liveness probe: reinicia si se cuelga
      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 30
        failure_threshold = 3
        timeout_seconds   = 2
      }
    }

    labels = merge(
      {
        managed_by = "terraform"
        service    = var.service_name
      },
      var.labels,
    )

    annotations = {
      "run.googleapis.com/execution-environment" = "gen2"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      # Dejar que Cloud Build gestione las revisions/traffic después del primer apply
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  # Forzar orden: secrets con versiones antes del service.
  # `terraform_data.wait_for_secret_versions` encapsula var.secret_versions_ready,
  # así que dependiendo de él propagamos el orden al recurso Cloud Run.
  depends_on = [
    terraform_data.wait_for_secret_versions,
  ]
}

# Null resource que fuerza que los secret versions estén creados antes del service.
# Usamos su output como depends_on del Cloud Run para propagar el orden.
resource "terraform_data" "wait_for_secret_versions" {
  input = var.secret_versions_ready
}

# Acceso público o autenticado
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  count    = var.public ? 1 : 0
  project  = var.project_id
  location = google_cloud_run_v2_service.service.location
  name     = google_cloud_run_v2_service.service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "url" {
  value = google_cloud_run_v2_service.service.uri
}

output "name" {
  value = google_cloud_run_v2_service.service.name
}
