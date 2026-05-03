# Outputs — valores que el CI/CD (GitHub Actions) y humanos necesitan consultar.

output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

# WIF — configurados como GitHub Variables en Settings → Actions
output "wif_provider" {
  description = "Workload Identity Provider path (setear como WIF_PROVIDER en GitHub)"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "wif_service_account_deploy" {
  description = "SA email del deployer (setear como WIF_SERVICE_ACCOUNT_DEPLOY en GitHub)"
  value       = google_service_account.github_deployer.email
}

output "cloud_run_runtime_sa" {
  description = "SA que usan los Cloud Run services en runtime"
  value       = google_service_account.cloud_run_runtime.email
}

output "cloudsql_instance_connection_name" {
  description = "Connection name para usar con Cloud SQL Proxy o Cloud Run direct connect"
  value       = google_sql_database_instance.main.connection_name
}

output "cloudsql_private_ip" {
  description = "IP privada de Cloud SQL (accesible desde VPC)"
  value       = google_sql_database_instance.main.private_ip_address
  sensitive   = true
}

output "redis_host" {
  description = "Host Memorystore Redis"
  value       = google_redis_instance.main.host
  sensitive   = true
}

output "redis_port" {
  value = google_redis_instance.main.port
}

output "artifact_registry_url" {
  description = "URL del repo Docker. Base para imágenes: <url>/<service>:<tag>"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "documents_bucket" {
  value = google_storage_bucket.documents.name
}

# KMS key id para firmas de certificados de huella de carbono. Se inyecta
# en apps/api como CERTIFICATE_SIGNING_KEY_ID para que el servicio
# emitirCertificadoViaje sepa qué key usar al firmar.
output "certificate_signing_key_id" {
  description = "Resource ID de la KMS key (sin :versions) para firmar certificados de carbono"
  value       = google_kms_crypto_key.certificate_carbono_signing.id
}

output "telemetry_dataset" {
  value = google_bigquery_dataset.telemetry.dataset_id
}

output "pubsub_topics" {
  value = {
    telemetry_events         = google_pubsub_topic.telemetry_events.name
    trip_events              = google_pubsub_topic.trip_events.name
    whatsapp_inbound         = google_pubsub_topic.whatsapp_inbound.name
    notification_events      = google_pubsub_topic.notification_events.name
    vehicle_availability     = google_pubsub_topic.vehicle_availability.name
    traffic_condition_events = google_pubsub_topic.traffic_condition.name
    chat_messages            = google_pubsub_topic.chat_messages.name
  }
}

output "gke_telemetry_cluster_name" {
  value = google_container_cluster.telemetry.name
}

output "gke_telemetry_endpoint" {
  value     = google_container_cluster.telemetry.endpoint
  sensitive = true
}

output "dns_zone_name_servers" {
  description = "Nameservers a configurar en el registrar del dominio boosterchile.com"
  value       = google_dns_managed_zone.main.name_servers
}
