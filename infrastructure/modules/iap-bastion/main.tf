# IAP Bastion — Capa 1 del ADR-013 (acceso humano a Cloud SQL privada).
#
# Patron:
#   laptop ──► gcloud compute start-iap-tunnel ──► Google IAP frontend
#                                                          │
#                                                          ▼
#                                                    bastion VM (private IP)
#                                                          │
#                                                          ▼  cloud-sql-proxy
#                                                          │  (systemd service)
#                                                          ▼
#                                                    Cloud SQL private IP
#
# El bastion corre cloud-sql-proxy como systemd service. El proxy NO usa
# --auto-iam-authn — solo termina TLS hacia Cloud SQL. La autenticacion del
# operador al rol Postgres la hace cada laptop pasando su access token como
# password (libpq IAM auth manual). Eso preserva audit per-usuario en
# pg_audit, sin que el proxy unifique sesiones bajo el SA del bastion.

locals {
  # Startup script: instala cloud-sql-proxy v2 + systemd service.
  # Se ejecuta en cada boot — idempotente (chequea binario, recrea unit
  # solo si cambia).
  startup_script = <<-EOT
    #!/bin/bash
    set -euxo pipefail

    PROXY_VERSION="v2.13.0"
    PROXY_BIN=/usr/local/bin/cloud-sql-proxy

    # Detectar arquitectura
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64) PROXY_ARCH=amd64 ;;
      aarch64) PROXY_ARCH=arm64 ;;
      *) echo "unsupported arch: $ARCH"; exit 1 ;;
    esac

    # Instalar/actualizar binario
    if [ ! -x "$PROXY_BIN" ] || ! "$PROXY_BIN" --version 2>/dev/null | grep -q "$PROXY_VERSION"; then
      curl -sSLo "$PROXY_BIN" \
        "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/$PROXY_VERSION/cloud-sql-proxy.linux.$PROXY_ARCH"
      chmod +x "$PROXY_BIN"
    fi

    # Usuario unprivileged
    id cloud-sql-proxy >/dev/null 2>&1 || useradd -r -s /sbin/nologin cloud-sql-proxy

    # Systemd unit
    cat <<UNIT > /etc/systemd/system/cloud-sql-proxy.service
    [Unit]
    Description=Cloud SQL Auth Proxy
    After=network-online.target
    Wants=network-online.target

    [Service]
    Type=simple
    User=cloud-sql-proxy
    ExecStart=$PROXY_BIN --address=0.0.0.0 --port=5432 --private-ip ${var.cloudsql_instance_connection_name}
    Restart=always
    RestartSec=5
    StandardOutput=journal
    StandardError=journal

    [Install]
    WantedBy=multi-user.target
    UNIT

    systemctl daemon-reload
    systemctl enable cloud-sql-proxy.service
    systemctl restart cloud-sql-proxy.service
  EOT
}

resource "google_compute_instance" "bastion" {
  name         = var.name
  project      = var.project_id
  zone         = var.zone
  machine_type = var.machine_type

  # Sin IP publica. Acceso solo via IAP TCP forwarding.
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

    # Trivy IaC AVD-GCP-0040: CMEK para boot disk si se pasa la key. Usar
    # disk_encryption_key (Customer-Managed via KMS) en lugar de
    # disk_encryption_key_raw (Customer-Supplied que requiere manejar la
    # key material en el cliente — operacionalmente caro).
    dynamic "disk_encryption_key" {
      for_each = var.disk_encryption_kms_key_self_link != null ? [var.disk_encryption_kms_key_self_link] : []
      content {
        kms_key_self_link = disk_encryption_key.value
      }
    }
  }

  # OS Login para auth via IAM en lugar de SSH keys gestionadas en metadata.
  # Trivy IaC AVD-GCP-0030: bloquear project-wide SSH keys aplicadas a esta
  # instancia (#63). El bastion solo acepta IAP tunnel + IAM-OAuth (OS Login),
  # nunca SSH keys del proyecto. Defense-in-depth si alguien agrega project keys.
  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
  }

  metadata_startup_script = local.startup_script

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

  tags = ["iap-bastion"]

  lifecycle {
    # Re-aplicar startup script (vía recreate) solo si la version del proxy
    # o el connection name cambian. Otros cambios cosmeticos son ignorados.
    ignore_changes = [
      metadata["ssh-keys"],
    ]
  }
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

# Firewall: permite que IAP forwardée también el puerto 5432 (proxy) hacia
# el bastion. Sin esto, el tunnel a port 5432 muere antes de llegar.
resource "google_compute_firewall" "iap_postgres" {
  name    = "${var.name}-iap-postgres"
  project = var.project_id
  network = var.network

  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["iap-bastion"]

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
}

# Egress to Cloud SQL: GCP VPC default allow-all egress es suficiente, pero
# documentamos la dependencia explicita aca para que sea visible que el
# bastion necesita ver Cloud SQL en su rango de VPC peering.
# (No se crea regla — la default cubre.)

# IAM: principals (users/groups) pueden tunelar via IAP a este bastion.
# Trivy AVD-GCP-0008: var.iap_principals acepta full IAM members con
# prefijo (user:..., group:..., serviceAccount:...) — caller en data.tf
# pasa group:engineers@boosterchile.com en lugar de user emails sueltos.
resource "google_iap_tunnel_instance_iam_member" "operators" {
  for_each = toset(var.iap_principals)

  project  = var.project_id
  zone     = var.zone
  instance = google_compute_instance.bastion.name

  role   = "roles/iap.tunnelResourceAccessor"
  member = each.value
}

# OS Login: principals (users/groups) pueden iniciar sesion SSH (necesario
# aunque solo tunelemos TCP — IAP usa el canal SSH como transporte).
resource "google_project_iam_member" "os_login_users" {
  for_each = toset(var.iap_principals)

  project = var.project_id
  role    = "roles/compute.osLogin"
  member  = each.value
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
