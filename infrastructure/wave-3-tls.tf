# Wave 3 D3 — TLS dual endpoint + cert-manager IAM.
#
# Capa Terraform que sostiene `infrastructure/k8s/cert-manager.yaml`:
#
#   - IP estática externa para el Network LB del Service
#     `telemetry-tcp-gateway-tls` (puerto 5061).
#   - DNS A record `telemetry-tls.boosterchile.com` → esa IP.
#   - SA `cert-manager-cloud-dns` con `roles/dns.admin` sobre la zona DNS
#     para que cert-manager pueda crear el TXT record _acme-challenge
#     durante el DNS-01 challenge de Let's Encrypt.
#   - Workload Identity binding: el K8s SA `cert-manager` del namespace
#     `cert-manager` impersona al GCP SA. Sin esto cert-manager no puede
#     llamar a Cloud DNS API.
#   - DR mirror: la zona DR (`telemetry-dr.boosterchile.com`) ya está en
#     dr-region.tf y reutiliza la misma SA — un solo binding sirve para
#     ambos clusters porque cert-manager corre en namespace cert-manager
#     en cada cluster con el mismo nombre de K8s SA.

# =============================================================================
# IP estática externa para el TLS endpoint primary
# =============================================================================

resource "google_compute_address" "telemetry_tls_lb" {
  name         = "booster-telemetry-tls-lb-ip"
  project      = google_project.booster_ai.project_id
  region       = var.region
  address_type = "EXTERNAL"

  description = "IP pública estática del Network LB TCP del telemetry-tcp-gateway TLS endpoint (puerto 5061). DNS apunta acá: telemetry-tls.boosterchile.com."

  depends_on = [google_project_service.apis]
}

# =============================================================================
# DNS — telemetry-tls.boosterchile.com → IP TLS primary
# =============================================================================

resource "google_dns_record_set" "telemetry_tls" {
  name         = "telemetry-tls.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300

  rrdatas = [google_compute_address.telemetry_tls_lb.address]
}

# =============================================================================
# SA cert-manager-cloud-dns — DNS-01 challenge de Let's Encrypt
# =============================================================================

resource "google_service_account" "cert_manager_cloud_dns" {
  account_id   = "cert-manager-cloud-dns"
  display_name = "cert-manager Cloud DNS solver"
  description  = "Service account que cert-manager usa para resolver el DNS-01 challenge de Let's Encrypt. Necesita roles/dns.admin sobre la zona principal."
  project      = google_project.booster_ai.project_id
}

# Permiso necesario: crear/borrar el TXT record `_acme-challenge.{domain}`
# durante el ACME challenge. Scope limitado a la zona DNS, no al proyecto.
resource "google_dns_managed_zone_iam_member" "cert_manager_dns_admin" {
  managed_zone = google_dns_managed_zone.main.name
  project      = google_project.booster_ai.project_id
  role         = "roles/dns.admin"
  member       = "serviceAccount:${google_service_account.cert_manager_cloud_dns.email}"
}

# `roles/dns.reader` a nivel de proyecto para que cert-manager pueda
# listar zonas y resolverlas por nombre. Sin esto, el SDK del Cloud DNS
# tira `403 Forbidden` en `dns.managedZones.list` antes de poder crear
# el TXT record. Es read-only a nivel project — el control real está
# en el binding `dns.admin` por zona de arriba.
resource "google_project_iam_member" "cert_manager_dns_reader" {
  project = google_project.booster_ai.project_id
  role    = "roles/dns.reader"
  member  = "serviceAccount:${google_service_account.cert_manager_cloud_dns.email}"
}

# =============================================================================
# Workload Identity — K8s SA cert-manager (en cada cluster) ↔ GCP SA
# =============================================================================
# El K8s SA `cert-manager` se crea cuando hacemos `helm install cert-manager`.
# Este binding permite que ese K8s SA impersone al GCP SA. La anotación
# en el K8s SA (`iam.gke.io/gcp-service-account`) cierra el círculo —
# se aplica vía kubectl post-helm-install (ver wave-3-deploy.md).
#
# Nota: el binding apunta solo a SA del namespace cert-manager. Si querés
# permitir más namespaces, agregá más members.

resource "google_service_account_iam_member" "cert_manager_workload_identity_primary" {
  service_account_id = google_service_account.cert_manager_cloud_dns.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${google_project.booster_ai.project_id}.svc.id.goog[cert-manager/cert-manager]"
}

# =============================================================================
# Cloud NAT — egress a internet desde clusters GKE privados
# =============================================================================
# GKE Autopilot usa nodes en VPC privada (sin IP pública). cert-manager
# necesita pullear imágenes de quay.io/jetstack y Helm necesita acceso
# a charts.jetstack.io — ambos públicos en internet, no en Google APIs.
# Sin Cloud NAT, los pods quedan en ImagePullBackOff con `i/o timeout`.
#
# Una sola NAT por región. Reusa la red VPC del cluster (compute.tf
# google_compute_network.vpc).

resource "google_compute_router" "primary_nat" {
  name    = "booster-ai-nat-router-primary"
  project = google_project.booster_ai.project_id
  region  = var.region
  network = google_compute_network.vpc.id

  description = "Router para Cloud NAT en la región primary. Habilita egress de pods GKE a internet (quay.io, charts, etc.)."
}

resource "google_compute_router_nat" "primary_nat" {
  name                               = "booster-ai-nat-primary"
  project                            = google_project.booster_ai.project_id
  router                             = google_compute_router.primary_nat.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = false
    filter = "ERRORS_ONLY"
  }
}

# ADR-035: router/NAT DR eliminados junto con dr-region.tf. Reactivar
# cuando exista deployment productivo del TCP gateway en us-central1.

# =============================================================================
# OUTPUTS
# =============================================================================

output "telemetry_tls_lb_ip" {
  description = "IP estática del Network LB TCP del gateway TLS endpoint (primary, puerto 5061). Usar en loadBalancerIP del Service K8s."
  value       = google_compute_address.telemetry_tls_lb.address
}

output "telemetry_tls_domain" {
  description = "Domain DNS resolvible para el TLS endpoint primary. Usado en Server Address (primary) de la cfg Wave 3 + commonName del Certificate."
  value       = "telemetry-tls.${var.domain}"
}

output "cert_manager_gcp_sa_email" {
  description = "Email del GCP SA que cert-manager debe impersonar via Workload Identity. Setear en la anotación del K8s SA: iam.gke.io/gcp-service-account=<este valor>."
  value       = google_service_account.cert_manager_cloud_dns.email
}
