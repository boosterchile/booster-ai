variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "service_name" {
  type        = string
  description = "Nombre del Cloud Run service (ej. booster-ai-api)"
}

variable "service_account_email" {
  type        = string
  description = "SA de runtime del service"
}

variable "container_image" {
  type        = string
  description = "URL completa de la imagen Docker en Artifact Registry"
  default     = "gcr.io/cloudrun/placeholder" # placeholder hasta primer deploy real
}

variable "port" {
  type    = number
  default = 8080
}

variable "min_instances" {
  type    = number
  default = 0
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "concurrency" {
  type    = number
  default = 80
}

variable "timeout_seconds" {
  type    = number
  default = 300
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
  type    = string
  default = null
}

variable "vpc_egress" {
  type    = string
  default = "PRIVATE_RANGES_ONLY" # enum API valores: ALL_TRAFFIC | PRIVATE_RANGES_ONLY
}

variable "public" {
  description = "Si true, el servicio es invocable sin autenticación"
  type        = bool
  default     = false
}

variable "labels" {
  type    = map(string)
  default = {}
}

variable "deletion_protection" {
  description = <<-EOT
    Protección contra destroy del Cloud Run service.
    Default false: Cloud Run es stateless, recrearlo con mismo nombre es seguro.
    La protección real de datos vive en Cloud SQL, Firestore y Cloud Storage (que sí tienen prevent_destroy).
    Si alguna vez se quiere proteger un service específico (ej. api con revisiones históricas importantes),
    pasar true explícitamente desde el módulo consumer.
  EOT
  type        = bool
  default     = false
}

variable "secret_versions_ready" {
  description = <<-EOT
    Lista de IDs de google_secret_manager_secret_version que deben existir antes de crear el service.
    Sin esto, Terraform puede intentar crear el Cloud Run antes de que los secrets referenciados
    tengan al menos una version, y la API falla con "Secret <x>/versions/latest was not found".
    Pasar `[for v in values(google_secret_manager_secret_version.placeholder) : v.id]` desde el consumer.
  EOT
  type        = list(string)
  default     = []
}
