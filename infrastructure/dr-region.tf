# Wave 3 D4 — DR backup region.
#
# Segundo gateway en otra región GCP (default: us-central1) al que el
# device hace failover si el primary (southamerica-west1) falla. Pub/Sub
# es global → ambos gateways publican al mismo topic, processor único
# en primary. Postgres queda regional por ahora; replica read en otra
# región es out of scope de Wave 3 (el primary sigue siendo source of
# truth).
#
# Configuración del device (Wave 3, brief D4):
#   GPRS tab → Server Mode (backup) = Backup
#   Backup Domain = telemetry-dr.boosterchile.com
#   Backup Port = 5061 (TLS)
#   Trigger: 5 timeouts consecutivos al primary → switchover.
#
# SLA: contratos B2B grandes piden 99.9% uptime. Sin DR, una caída de
# southamerica-west1 (hubo 1 en 2024 y 1 en 2025) tira el producto.
# Con DR, la caída es transparente.

# =============================================================================
# GKE AUTOPILOT en DR region
# =============================================================================
# Mismo template que el primary (compute.tf), distinta región. La
# subnet de la VPC ya está provisionada en var.region — necesitamos
# una subnet adicional en var.dr_region.

resource "google_compute_subnetwork" "dr_private" {
  name    = "booster-ai-dr-private"
  project = google_project.booster_ai.project_id
  region  = var.dr_region
  network = google_compute_network.vpc.id
  # 10.20.0.0/20 colisionaba con la subnet primary booster-ai-private en
  # southamerica-west1 (la VPC es global, los CIDRs no pueden repetirse
  # entre subnets aunque vivan en regiones distintas).
  # Movido a 10.30.0.0/20 + secondaries 10.31.0.0/16 y 10.32.0.0/20.
  ip_cidr_range = "10.30.0.0/20"

  secondary_ip_range {
    range_name    = "gke-pods-dr"
    ip_cidr_range = "10.31.0.0/16"
  }
  secondary_ip_range {
    range_name    = "gke-services-dr"
    ip_cidr_range = "10.32.0.0/20"
  }

  private_ip_google_access = true
}

resource "google_container_cluster" "telemetry_dr" {
  name     = "booster-ai-telemetry-dr"
  project  = google_project.booster_ai.project_id
  location = var.dr_region

  enable_autopilot    = true
  deletion_protection = true

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.dr_private.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods-dr"
    services_secondary_range_name = "gke-services-dr"
  }

  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "10.30.0.0/20"
      display_name = "booster-ai-dr-private-subnet"
    }
    cidr_blocks {
      cidr_block   = "0.0.0.0/0"
      display_name = "any-authenticated"
    }
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.17.0.0/28"
  }

  release_channel {
    channel = "STABLE"
  }

  workload_identity_config {
    workload_pool = "${google_project.booster_ai.project_id}.svc.id.goog"
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  resource_labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "telemetry-tcp-gateway-dr"
    role       = "disaster-recovery"
  }

  depends_on = [google_project_service.apis]
}

# IP estática externa regional para el Network LB del DR.
resource "google_compute_address" "telemetry_dr_lb" {
  name         = "booster-ai-telemetry-dr-lb"
  project      = google_project.booster_ai.project_id
  region       = var.dr_region
  address_type = "EXTERNAL"

  description = "IP estática del LB TCP del telemetry-tcp-gateway DR (us-central1)"
}

# =============================================================================
# DNS — telemetry-dr.boosterchile.com → IP DR
# =============================================================================
# El device usa este nombre como Backup Domain. Necesita TLS válido
# para que el handshake pase — el cert de cert-manager debe incluir
# este SAN además del primary.

resource "google_dns_record_set" "telemetry_dr" {
  name         = "telemetry-dr.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300

  rrdatas = [google_compute_address.telemetry_dr_lb.address]
}

# =============================================================================
# OUTPUTS
# =============================================================================

output "dr_cluster_name" {
  description = "Nombre del GKE cluster DR (us-central1)"
  value       = google_container_cluster.telemetry_dr.name
}

output "dr_lb_ip" {
  description = "IP estática del Network LB del gateway DR. Usar en cert-manager Certificate y device config."
  value       = google_compute_address.telemetry_dr_lb.address
}

output "dr_telemetry_domain" {
  description = "Domain DNS resolvible para el backup gateway."
  value       = "telemetry-dr.${var.domain}"
}
