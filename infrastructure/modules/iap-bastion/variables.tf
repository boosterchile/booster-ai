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

variable "service_account_email" {
  type        = string
  description = <<-EOT
    SA del bastion. Solo necesita logging.logWriter y monitoring.metricWriter.
    NO debe tener cloudsql.client ni nada que toque DB — el bastion es solo
    forwarder de paquetes. La auth a Cloud SQL la hace el cloud-sql-proxy en
    la laptop del operador con su token IAM.
  EOT
}

variable "iap_users" {
  type        = list(string)
  description = <<-EOT
    Lista de emails (sin prefijo "user:") con permiso de tunelar via IAP.
    Cada uno necesita: roles/iap.tunnelResourceAccessor sobre el proyecto y
    roles/compute.instanceAdmin.v1 (o más restrictivo: osLogin) sobre la VM.
  EOT
  default     = []
}

variable "labels" {
  type    = map(string)
  default = {}
}
