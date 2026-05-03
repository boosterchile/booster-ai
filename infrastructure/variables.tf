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

variable "content_sid_offer_new" {
  description = <<-EOT
    Twilio Content SID del template aprobado para notificar al carrier que
    llegó una nueva oferta (B.8). Formato: HX seguido de 32 hex chars.
    El template se crea en Twilio Console > Content Editor con el friendly
    name `offer_new_v1` y categoria Utility, y queda aprobado por Meta en
    24-48h tras submit.

    Variables esperadas (1-based):
      {{1}} → tracking_code, ej. BOO-ABC123
      {{2}} → ruta "Origen → Destino", ej. "Metropolitana → Biobío"
      {{3}} → precio CLP formateado, ej. "$ 850.000 CLP"
      {{4}} → URL al dashboard del carrier (https://app.boosterchile.com/app/ofertas)

    Default vacío para no bloquear el primer apply tras agregar la var. Mientras
    esté vacío, el dispatcher de notificaciones del api loguea warn y skipea
    sin enviar mensaje (las offers se siguen creando en DB y aparecen en el
    dashboard via poll). Setear con un override:
      content_sid_offer_new = "HX1234567890abcdef1234567890abcd"
    una vez que Meta aprueba el template.
  EOT
  type        = string
  default     = ""
  validation {
    condition     = var.content_sid_offer_new == "" || can(regex("^HX[a-fA-F0-9]+$", var.content_sid_offer_new))
    error_message = "content_sid_offer_new debe ser vacío o empezar con HX seguido de hex chars."
  }
}

variable "content_sid_chat_unread" {
  description = <<-EOT
    Twilio Content SID del template aprobado para el fallback WhatsApp del
    chat (P3.d). Formato HX + hex. Submit en Twilio Console > Content Editor
    con friendly name `chat_unread_v1`, categoría Utility.

    Variables esperadas (1-based):
      {{1}} → tracking_code, ej. BOO-ABC123
      {{2}} → sender_name, ej. "Juan Pérez (Transportes Andino)"
      {{3}} → message_preview, hasta ~80 chars o "📷 Foto adjunta"/"📍 Ubicación compartida"
      {{4}} → URL deep-link al chat, ej. "https://app.boosterchile.com/app/chat/UUID"

    Default vacío para no bloquear apply previo a aprobación Meta. Mientras
    esté vacío el cron loggea warn y skipea — los push notifs (P3.c) y SSE
    (P3.b) cubren el caso real-time. Setear con override una vez aprobado.
  EOT
  type        = string
  default     = ""
  validation {
    condition     = var.content_sid_chat_unread == "" || can(regex("^HX[a-fA-F0-9]+$", var.content_sid_chat_unread))
    error_message = "content_sid_chat_unread debe ser vacío o empezar con HX seguido de hex chars."
  }
}
