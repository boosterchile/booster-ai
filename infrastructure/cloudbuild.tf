# Cloud Build private worker pool — Trivy IaC #17, #30 (GKE Control Plane public).
#
# Antes: master_authorized_networks_config incluia 0.0.0.0/0 porque
# Cloud Build default pool no tiene IPs estables y necesita acceso al
# control plane GKE para `kubectl set image deployment/telemetry-tcp-gateway`.
# El default pool usa IPs efimeras de Google's serverless infra.
#
# Despues: private worker pool con VPC peering. Workers viven en una
# subnet privada de NUESTRO VPC (range 10.x.0.0/24 reservado) y pueden
# alcanzar el GKE control plane via authorized network.
#
# Costo aproximado:
#   - e2-standard-2 (2 vCPU, 8GB) en southamerica-west1
#   - $0.080/hr * uso real ~ 50hr/mo (asumiendo 100min/dia builds)
#   - ~$5-10/mo
#
# Tradeoff: builds dentro del pool tienen acceso al VPC interno (Cloud SQL
# privada, Redis, Pub/Sub) — ya no necesitan VPC connector aparte para tests
# de integracion en CI. Bonus.

resource "google_cloudbuild_worker_pool" "production" {
  name     = "booster-production-pool"
  project  = google_project.booster_ai.project_id
  location = var.region

  worker_config {
    # e2-standard-2 (2 vCPU, 8GB) — sweet spot para docker builds del repo.
    # Mas chico (e2-medium 1 vCPU 4GB) seria ~50% mas lento en api/web builds.
    # Mas grande (e2-standard-4) inneecsario; los builds no son CPU-bound.
    machine_type = "e2-standard-2"

    # Disk default 100GB es suficiente para cache + intermediate layers de
    # los 6 servicios buildeados en paralelo en cloudbuild.production.yaml.
    disk_size_gb = 100

    # External IP via NAT controlado por Google. Necesario para que workers
    # pull-een images base de docker.io / nginx-unprivileged hub. Si en el
    # futuro mirroreamos todo a Artifact Registry, podemos setear true para
    # full air-gap.
    no_external_ip = false
  }

  network_config {
    peered_network = google_compute_network.vpc.id
    # Sub-range dentro del peering /24 — Google asigna /29 por default a los
    # workers individuales. Dejarlo en default para balancear con el pool size.
  }

  depends_on = [
    google_service_networking_connection.private_vpc,
    google_project_service.apis,
  ]
}

# Output convenience — usado en cloudbuild.production.yaml options.pool.name
# y referenciado en cualquier futuro flag --worker-pool de gcloud builds submit.
output "cloudbuild_worker_pool_name" {
  description = "Resource name del Cloud Build private worker pool. Pasar a `gcloud builds submit --worker-pool` o setear en options.pool.name del cloudbuild.yaml."
  value       = google_cloudbuild_worker_pool.production.id
}
