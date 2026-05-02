variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "job_name" {
  type        = string
  description = "Nombre del Cloud Run Job (ej. merge-duplicate-users, backfill-trip-metrics)"
}

variable "service_account_email" {
  type        = string
  description = "SA con la que corre cada task del job. Default: misma SA que los Cloud Run services."
}

variable "container_image" {
  type        = string
  description = "URL completa de la imagen Docker en Artifact Registry"
}

variable "command" {
  type        = list(string)
  description = "Override del ENTRYPOINT del container (ej. [\"node\"])"
  default     = []
}

variable "args" {
  type        = list(string)
  description = "Override del CMD del container (ej. [\"dist/jobs/merge-duplicate-users.js\"])"
  default     = []
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "task_timeout_seconds" {
  type        = number
  description = "Timeout máximo por task del job. Cloud Run Jobs admite hasta 86400s (24h)."
  default     = 600
}

variable "max_retries" {
  type        = number
  description = <<-EOT
    Cantidad de retries automáticos por task fallido. Para jobs de mutación
    de datos, default 0 — el operador debe re-ejecutar manualmente tras
    revisar logs. Para jobs idempotentes de read/derive, puede ser >0.
  EOT
  default     = 0
}

variable "parallelism" {
  type        = number
  description = "Cantidad de tasks que pueden correr en paralelo dentro de una execution."
  default     = 1
}

variable "task_count" {
  type        = number
  description = "Cantidad total de tasks por execution. Para one-off jobs = 1."
  default     = 1
}

variable "env_vars" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  description = "Map de env var name → secret name en Secret Manager"
  type        = map(string)
  default     = {}
}

variable "vpc_connector" {
  type        = string
  description = "VPC connector para que el job pueda llegar a Cloud SQL/Memorystore privados."
  default     = null
}

variable "vpc_egress" {
  type    = string
  default = "PRIVATE_RANGES_ONLY"
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "secret_versions_ready" {
  description = <<-EOT
    Lista de IDs de google_secret_manager_secret_version que deben existir
    antes de crear el job. Mismo patrón que cloud-run-service.
  EOT
  type        = list(string)
  default     = []
}
