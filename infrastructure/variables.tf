variable "project_id" {
  description = "GCP project ID (con sufijo numérico si el nombre base ya estaba tomado)"
  type        = string
  default     = "booster-ai-494222"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{5,29}$", var.project_id))
    error_message = "project_id debe ser 6-30 chars, lowercase, alfanumérico + guiones."
  }
}

variable "billing_account" {
  description = "Billing Account ID (formato: XXXXXX-XXXXXX-XXXXXX)"
  type        = string
  sensitive   = false
}

variable "organization_id" {
  description = <<-EOT
    GCP Organization ID. El proyecto booster-ai-494222 está bajo la organization
    de boosterchile.com (435506363892). Mantener seteado para evitar que
    terraform intente desvincular el proyecto del org en cada plan (drift).
  EOT
  type        = string
  default     = "435506363892"
}

variable "region" {
  description = "Región GCP principal (todos los recursos regionales aquí)"
  type        = string
  default     = "southamerica-west1" # Santiago, Chile
}

variable "zone" {
  description = "Zona por defecto (para recursos zonales puntuales)"
  type        = string
  default     = "southamerica-west1-a"
}

variable "environment" {
  description = "Environment label (prod/staging/dev). Controla ciertos sizing."
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment debe ser uno de: prod, staging, dev."
  }
}

variable "domain" {
  description = "Dominio principal del producto"
  type        = string
  default     = "boosterchile.com"
}

# -----------------------------------------------------------------------------
# Identidad humana — owners del proyecto (ADR-010 Booster 2.0: IAM via IaC)
# -----------------------------------------------------------------------------
variable "human_owners" {
  description = "Cuentas humanas con rol Owner. Cambios requieren PR."
  type        = set(string)
  default = [
    "user:dev@boosterchile.com",
  ]
}

# -----------------------------------------------------------------------------
# GitHub repo — para Workload Identity Federation
# -----------------------------------------------------------------------------
variable "github_repository" {
  description = "Repo GitHub en formato owner/repo (para WIF subject matching)"
  type        = string
  default     = "boosterchile/booster-ai"
}

# -----------------------------------------------------------------------------
# Cloud SQL
# -----------------------------------------------------------------------------
variable "cloudsql_tier" {
  description = "Cloud SQL machine tier (db-custom-N-M formato)"
  type        = string
  default     = "db-custom-2-7680" # 2 vCPU, 7.5 GB RAM. Punto de partida comercial; escalar con demanda real.
}

variable "cloudsql_backup_retention_days" {
  description = "Días de retención de backups automáticos"
  type        = number
  default     = 30
}

# -----------------------------------------------------------------------------
# Memorystore Redis
# -----------------------------------------------------------------------------
variable "redis_tier" {
  description = "Redis tier: BASIC (single node) o STANDARD_HA (con failover)"
  type        = string
  default     = "STANDARD_HA"
}

variable "redis_memory_gb" {
  description = "Memoria Redis en GB"
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# Budget alert
# -----------------------------------------------------------------------------
variable "monthly_budget_usd" {
  description = "Límite de budget mensual en USD. Alertas a 50/75/90/100%."
  type        = number
  default     = 500
}

variable "alert_email" {
  description = "Email para alertas de billing + monitoring"
  type        = string
  default     = "dev@boosterchile.com"
}

# -----------------------------------------------------------------------------
# WhatsApp / Twilio
# -----------------------------------------------------------------------------
variable "twilio_from_number" {
  description = <<-EOT
    Twilio WhatsApp From number (E.164 con +). Producción usa +19383365293
    (Booster AI sender registrado 2026-04-29 via Embedded Sign-Up con WABA
    874993441667738, Meta Business 7158708094223068). El sandbox compartido
    +14155238886 queda como fallback documental — cambiar acá si hay que
    rollbackear el sender real (ver docs/runbooks/twilio-sender-registration.md).
  EOT
  type        = string
  default     = "+19383365293"
  validation {
    condition     = can(regex("^\\+\\d+$", var.twilio_from_number))
    error_message = "twilio_from_number debe estar en formato E.164 con +."
  }
}
