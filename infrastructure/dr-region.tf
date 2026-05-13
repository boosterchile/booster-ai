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

  # Trivy IaC: VPC Flow Logs habilitados (#31). Mismos parametros que la
  # subnet primary para consistencia (10-min agg + 0.5 sampling).
  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
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

    # Cloud Build pool en south-west via cross-region peering (la VPC es
    # global). NOTA: en la práctica este peering NO logra TCP handshake al
    # master DR (verificado 2026-05-13 — i/o timeout). Mantenido por compat
    # pero el deploy real usa el pool DR de abajo.
    cidr_blocks {
      cidr_block   = "${google_compute_global_address.cloudbuild_pool_range.address}/${google_compute_global_address.cloudbuild_pool_range.prefix_length}"
      display_name = "cloudbuild-private-pool-saw1"
    }

    # Cloud Build pool DR (us-central1, MISMA region que el cluster) —
    # solución definitiva al bloqueo de deploy DR (issue #194). Pool
    # us-central1 alcanza el master DR sin cross-region peering issues.
    cidr_blocks {
      cidr_block   = "${google_compute_global_address.cloudbuild_pool_range_dr.address}/${google_compute_global_address.cloudbuild_pool_range_dr.prefix_length}"
      display_name = "cloudbuild-private-pool-us-central1"
    }

    # IAP TCP forwarding para operadores accediendo al DR.
    cidr_blocks {
      cidr_block   = "35.235.240.0/20"
      display_name = "iap-tcp-forwarding"
    }

    # IPs operadores (variable compartida con primary cluster).
    dynamic "cidr_blocks" {
      for_each = var.gke_operator_authorized_cidrs
      content {
        cidr_block   = cidr_blocks.value.cidr
        display_name = cidr_blocks.value.name
      }
    }
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.17.0.0/28"

    # Master global access habilitado para que Cloud Build pool (en south-west)
    # alcance el master DR cross-region via VPC peering. NOTA 2026-05-13: en
    # la práctica NO funcionó — el peering al control plane Autopilot no se
    # establece. Resuelto vía DNS endpoint (control_plane_endpoints_config
    # abajo) — kubectl alcanza el cluster via DNS + IAM auth sin peering.
    master_global_access_config {
      enabled = true
    }
  }

  # DNS endpoint del control plane GKE — habilitado 2026-05-13 para resolver
  # el bloqueo de deploy DR (issue #194). kubectl puede ahora alcanzar el
  # cluster DR desde cualquier red (laptop, Cloud Build pool de cualquier
  # region, Cloud Run jobs) sin requerir VPC peering — auth queda via IAM
  # (roles/container.developer). El DNS endpoint es ~$0/mes.
  #
  # https://cloud.google.com/kubernetes-engine/docs/concepts/network-overview#dns-based-endpoint
  control_plane_endpoints_config {
    dns_endpoint_config {
      allow_external_traffic = true
    }
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
