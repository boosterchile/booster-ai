# IAP Bastion — Capa 1 del ADR-013 (acceso humano a Cloud SQL privada).
#
# Patrón:
#   laptop ──► gcloud compute start-iap-tunnel ──► Google IAP frontend
#                                                          │
#                                                          ▼
#                                                    bastion VM (private IP)
#                                                          │  forwardea TCP
#                                                          ▼
#                                                    Cloud SQL private IP
#
# El bastion NO tiene IP pública. Tampoco corre cloud-sql-proxy ni nada que
# toque la DB — actúa como puente TCP. La auth a Cloud SQL la hace el
# cloud-sql-proxy en la laptop del operador, con el OAuth token de gcloud
# auth login (ver `cloudsql.iam_authentication = on` en data.tf).
#
# Para usar: instanciar este módulo en data.tf una vez Felipe apruebe el costo
# (~USD 5/mes e2-micro) y ejecutar `bash scripts/db/connect.sh` actualizado.

resource "google_compute_instance" "bastion" {
  name         = var.name
  project      = var.project_id
  zone         = var.zone
  machine_type = var.machine_type

  # Sin IP pública. Acceso solo via IAP TCP forwarding.
  network_interface {
    network    = var.network
    subnetwork = var.subnet
    # No access_config block → no public IP
  }

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  # OS Login para auth via IAM en lugar de SSH keys gestionadas en metadata.
  metadata = {
    enable-oslogin = "TRUE"
  }

  service_account {
    email  = var.service_account_email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  labels = merge(
    {
      managed_by = "terraform"
      role       = "db-bastion"
    },
    var.labels,
  )

  # IAP requires the bastion to have IAP-allowed firewall rule (puerto 22 desde
  # 35.235.240.0/20 que es el rango oficial de IAP frontends). Se crea abajo.
  tags = ["iap-bastion"]
}

# Firewall: permite SSH solo desde el rango oficial de IAP frontends.
# Sin esto, gcloud start-iap-tunnel falla con "connection refused".
resource "google_compute_firewall" "iap_ssh" {
  name    = "${var.name}-iap-ssh"
  project = var.project_id
  network = var.network

  direction = "INGRESS"
  source_ranges = [
    "35.235.240.0/20", # rango fijo documentado de IAP TCP forwarding
  ]
  target_tags = ["iap-bastion"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# Permite que el bastion forwardée TCP hacia Cloud SQL en la VPC privada.
# Cloud SQL escucha en su IP privada por el puerto 5432.
resource "google_compute_firewall" "bastion_to_cloudsql" {
  name    = "${var.name}-to-cloudsql"
  project = var.project_id
  network = var.network

  direction          = "EGRESS"
  destination_ranges = ["10.0.0.0/8"] # rango privado donde vive Cloud SQL via VPC peering

  target_tags = ["iap-bastion"]

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

# IAM: cada operador puede tunelar via IAP a este bastion.
resource "google_iap_tunnel_instance_iam_member" "operators" {
  for_each = toset(var.iap_users)

  project  = var.project_id
  zone     = var.zone
  instance = google_compute_instance.bastion.name

  role   = "roles/iap.tunnelResourceAccessor"
  member = "user:${each.value}"
}

# OS Login: cada operador puede iniciar sesión SSH (necesario aunque solo
# tunelemos TCP — IAP usa el canal SSH como transporte).
resource "google_project_iam_member" "os_login_users" {
  for_each = toset(var.iap_users)

  project = var.project_id
  role    = "roles/compute.osLogin"
  member  = "user:${each.value}"
}

output "name" {
  value = google_compute_instance.bastion.name
}

output "zone" {
  value = google_compute_instance.bastion.zone
}

output "instance_id" {
  value = google_compute_instance.bastion.instance_id
}
