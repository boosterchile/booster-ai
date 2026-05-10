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

variable "dr_region" {
  description = <<-EOT
    Región GCP de disaster recovery (Wave 3 D4). Default us-central1
    para latency LATAM (~150ms desde Santiago vs ~200ms us-east1) y
    disponibilidad de servicios (us-central1 es el primer-class GCP
    region). El device FMC150 hace failover al backup tras 5 timeouts
    consecutivos al primary.
  EOT
  type        = string
  default     = "us-central1"
  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.dr_region))
    error_message = "dr_region debe ser un nombre válido de región GCP."
  }
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
# Identidad humana — Workspace groups (ADR-010 + Trivy IaC AVD-GCP-0008)
# -----------------------------------------------------------------------------
# Migracion 2026-05-09: bindings IAM a nivel proyecto se asignan a grupos
# Workspace en lugar de users individuales. Beneficios:
# - Trivy "IAM granted directly to user" cierra (best practice de scaling)
# - Onboarding/offboarding de un dev = agregar/quitar miembro del grupo,
#   sin terraform apply
# - Audit trail de membresia centralizado en Workspace Admin
#
# CREATE-FIRST: los grupos deben existir en Workspace ANTES del terraform
# apply (sino apply falla con "principalNotFound"). Crearlos con:
#
#   gcloud identity groups create admins@boosterchile.com \
#     --organization=$ORG_ID \
#     --display-name="Booster AI - Admins"
#
#   gcloud identity groups create engineers@boosterchile.com \
#     --organization=$ORG_ID \
#     --display-name="Booster AI - Engineers"
#
# Luego agregar miembros via Workspace Admin UI o:
#   gcloud identity groups memberships add \
#     --group-email=admins@boosterchile.com \
#     --member-email=dev@boosterchile.com

variable "admins_group" {
  description = <<-EOT
    Workspace group con rol Owner del proyecto.
    Miembros tipicos: founders / org admins / business owners.
    Default: admins@boosterchile.com (incluye dev@ + contacto@).
  EOT
  type        = string
  default     = "admins@boosterchile.com"
}

variable "engineers_group" {
  description = <<-EOT
    Workspace group con acceso operacional: Cloud SQL (cloudsql.client +
    instanceUser) y bastion IAP (iap.tunnelResourceAccessor + osLogin).
    Miembros tipicos: developers, SREs, on-call.
    Default: engineers@boosterchile.com (inicialmente solo dev@).
  EOT
  type        = string
  default     = "engineers@boosterchile.com"
}

# Mantenido como variable por compatibilidad — pero el default ahora apunta
# al grupo. Si se quiere bindings extra (ej. user:freelance@... temporal)
# se puede agregar en tfvars.local sin tocar este default.
variable "human_owners" {
  description = "IAM members con rol Owner. Default usa group:admins@... (Trivy AVD-GCP-0008)."
  type        = set(string)
  default = [
    "group:admins@boosterchile.com",
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

variable "sms_fallback_webhook_url" {
  description = <<-EOT
    URL pública canónica del webhook del sms-fallback-gateway tal como
    Twilio la conoce (Wave 2 B4). Necesario para validar la firma
    HMAC-SHA1 del webhook (Twilio incluye la URL en el HMAC).

    Ejemplos:
      - dev: https://booster-ai-sms-fallback-gateway-<projno>.<region>.run.app/webhook
      - prod: https://sms-fallback.boosterchile.com/webhook (si configuramos LB)

    Default vacío deshabilita la validación de firma (NUNCA en prod).
    Setear con override:
      sms_fallback_webhook_url = "https://..."
    Después de provisionar el número Twilio y configurar el webhook
    en su Console.
  EOT
  type        = string
  default     = ""
}

# NOTA: las variables `content_sid_offer_new` y `content_sid_chat_unread`
# se eliminaron en el refactor 2026-05-07. Los Content SIDs de Twilio
# ahora viven en Secret Manager (`content-sid-offer-new` y
# `content-sid-chat-unread`) y se montan como secret env vars en
# el Cloud Run del api (ver compute.tf > module.service_api > secrets).
#
# Razón: cuando vivían como variables Terraform con default vacío, un
# apply sin override en tfvars.local blanqueaba el live value, rompiendo
# el dispatcher WhatsApp. Con Secret Manager el valor persiste entre
# applies independiente de tfvars.
#
# Para cargar/rotar los valores ver docs/runbooks/load-content-sids.md.

# ---------------------------------------------------------------------------
# GKE master_authorized_networks operadores (Trivy IaC #17, #30)
# ---------------------------------------------------------------------------
# IPs adicionales de operadores que necesitan kubectl directo al control
# plane GKE (sin pasar por IAP). Default empty — populate en tfvars.local
# o tfvars.$ENV.
#
# Cloud Build private pool y IAP TCP CIDR ya estan whitelisted por default
# en compute.tf y dr-region.tf. Esta variable es para excepciones puntuales
# (ej. ingenieros con IP estatica que prefieren no usar IAP).
#
# Ejemplo terraform.tfvars:
#   gke_operator_authorized_cidrs = [
#     { cidr = "192.0.2.42/32",  name = "office-static" },
#     { cidr = "203.0.113.0/24", name = "vpn-egress" },
#   ]
variable "gke_operator_authorized_cidrs" {
  description = "CIDRs de operadores con kubectl directo al GKE master (sin IAP). Cada item: {cidr, name}."
  type = list(object({
    cidr = string
    name = string
  }))
  default = []
}
