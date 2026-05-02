# Cloud Run Job — Capa 3 del ADR-013 (acceso a DB para ops one-off).
#
# Diferencias vs cloud-run-service:
#   - sin port, probes, scaling, traffic split (un job termina, no sirve tráfico)
#   - timeout largo (default 600s, hasta 86400s)
#   - max_retries explícito (default 0 — para mutaciones de datos)
#   - se ejecuta con `gcloud run jobs execute <name>` o Cloud Scheduler

resource "google_cloud_run_v2_job" "job" {
  name     = var.job_name
  project  = var.project_id
  location = var.region

  template {
    parallelism = var.parallelism
    task_count  = var.task_count

    template {
      service_account = var.service_account_email
      timeout         = "${var.task_timeout_seconds}s"
      max_retries     = var.max_retries

      dynamic "vpc_access" {
        for_each = var.vpc_connector != null ? [1] : []
        content {
          connector = var.vpc_connector
          egress    = var.vpc_egress
        }
      }

      containers {
        image   = var.container_image
        command = length(var.command) > 0 ? var.command : null
        args    = length(var.args) > 0 ? var.args : null

        resources {
          limits = {
            cpu    = var.cpu
            memory = var.memory
          }
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
      }
    }
  }

  labels = merge(
    {
      managed_by = "terraform"
      job        = var.job_name
    },
    var.labels,
  )

  lifecycle {
    ignore_changes = [
      # Cloud Build deploys actualizan la imagen fuera de TF.
      template[0].template[0].containers[0].image,
      # GCP auto-injecta labels/annotations durante operaciones.
      labels,
      client,
      client_version,
    ]
  }

  depends_on = [
    terraform_data.wait_for_secret_versions,
  ]
}

resource "terraform_data" "wait_for_secret_versions" {
  input = var.secret_versions_ready
}

output "name" {
  value = google_cloud_run_v2_job.job.name
}

output "id" {
  value = google_cloud_run_v2_job.job.id
}
