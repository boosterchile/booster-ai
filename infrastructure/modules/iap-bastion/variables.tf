variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "zone" {
  type        = string
  description = "Zone para la VM bastion (típicamente {region}-a)"
}

variable "name" {
  type        = string
  description = "Nombre de la VM bastion. Default: db-bastion."
  default     = "db-bastion"
}

variable "network" {
  type        = string
  description = "Self-link de la VPC donde vive el bastion. Debe peer-ear con Cloud SQL."
}

variable "subnet" {
  type        = string
  description = "Self-link del subnet privado donde se crea la VM."
}

variable "machine_type" {
  type        = string
  description = "e2-micro es suficiente para forwardear conexiones; el tunnel IAP no requiere CPU."
  default     = "e2-micro"
}

variable "disk_encryption_kms_key_self_link" {
  type        = string
  description = <<-EOT
    Self-link de la KMS crypto key para CMEK del boot disk del bastion.
    Trivy IaC AVD-GCP-0040 ("VM disks should be encrypted with CMEK").
    El SA de servicio de Compute Engine (service-PROJECT_NUMBER@compute-system.iam)
    debe tener roles/cloudkms.cryptoKeyEncrypterDecrypter sobre esta key.
    Pasar null para usar default Google-managed encryption.
  EOT
  default     = null
}

variable "service_account_email" {
  type        = string
  description = <<-EOT
    SA del bastion. Necesita roles/cloudsql.client (para que cloud-sql-proxy
    en la VM pueda llamar a la Admin API y establecer el tunel TLS) +
    logging.logWriter + monitoring.metricWriter.

    NO necesita cloudsql.instanceUser — la auth de IAM database al rol
    Postgres la hace cada operador en su laptop, pasando su access token
    como password en el connection string al proxy. El proxy solo
    establece el canal TLS, no autentica al usuario.
  EOT
}

variable "cloudsql_instance_connection_name" {
  type        = string
  description = <<-EOT
    Connection name de la instancia Cloud SQL en el formato
    "<project>:<region>:<instance>". El startup script del bastion lanza
    cloud-sql-proxy apuntando a este connection name, listening en :5432
    de la red interna del VPC.
  EOT
}

variable "iap_principals" {
  type        = list(string)
  description = <<-EOT
    Lista de IAM members (con prefijo) con permiso de tunelar via IAP.
    Acepta:
      - "user:operator@example.com"
      - "group:engineers@example.com"   (preferido — Trivy AVD-GCP-0008)
      - "serviceAccount:sa@project.iam.gserviceaccount.com"

    Cada principal recibe: roles/iap.tunnelResourceAccessor sobre la VM y
    roles/compute.osLogin sobre el proyecto.

    Migracion 2026-05-09: variable renombrada de `iap_users` (que asumia
    prefijo user:) a `iap_principals` para soportar grupos.
  EOT
  default     = []
}

variable "labels" {
  type    = map(string)
  default = {}
}
