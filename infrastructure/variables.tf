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
  # ADR-034 (2026-05-13): right-sized desde db-custom-2-7680 → db-custom-1-6144
  # tras auditoría que mostró uso real 30d: CPU avg 3.9% (max 23.7%), RAM avg
  # 47.6% (max 48.4% ≈ 3.7 GB). Nuevo tier deja headroom 47% CPU y 38% RAM.
  # Mantiene REGIONAL HA. Cuando entren clientes con tráfico productivo, subir
  # primero a db-custom-2-8192 y luego escalar con monitoring real.
  default = "db-custom-1-6144" # 1 vCPU, 6 GB RAM
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

# ---------------------------------------------------------------------------
# Matching engine v2 — feature flag + pesos custom (ADR-033)
# ---------------------------------------------------------------------------
# Activación del scoring multifactor con backhaul awareness. Cuando es
# `false` (default), el matching usa v1 capacity-only — el path actual,
# bit-exacto. Cuando es `true`, el orchestrator hace lookups extras
# (trips activos del carrier, histórico 7d, ofertas 90d, tier) y aplica
# `scoreCandidateV2`.
#
# Rollout plan:
#   1. Mantener `false` en main mientras se evalúa con backtest UI
#      (/app/platform-admin/matching).
#   2. Si las corridas muestran delta favorable, override a `true` en
#      `tfvars.prod` o `terraform.tfvars.local` y aplicar.
#   3. Monitorear 7d con métricas habituales (offer acceptance rate,
#      time-to-match, distribución de empresas con offer).
#   4. Si métricas estables, mantener; sino, revertir el flag (`false`
#      en variables.tf o tfvars).
#
# Flip es reversible sin redeploy de código — solo cambia env var via
# `terraform apply` (Cloud Run respawneará la revision en segundos).
variable "matching_algorithm_v2_activated" {
  description = "Activa el scoring multifactor v2 con backhaul awareness (ADR-033). false = v1 capacity-only."
  type        = bool
  # Activado en prod desde 2026-05-07 (operación validada con backtest).
  # Durante 2026-05-13 el valor parecía "true" por bug en config.ts
  # (`z.coerce.boolean("false") === true`). Tras fix del booleanFlag, el
  # valor real era `false` y la lógica server colapsó al v1.
  # Restauro a `true` explícito para mantener producción en V2.
  default = true
}

# Pesos custom JSON para los componentes del scoring v2. Empty string →
# usa `DEFAULT_WEIGHTS_V2` del package matching-algorithm
# (0.40 capacidad / 0.35 backhaul / 0.15 reputacion / 0.10 tier). Útil
# para A/B testing post-launch sin redeploy de código.
#
# Shape esperado:
#   {"capacidad":0.4,"backhaul":0.35,"reputacion":0.15,"tier":0.1}
# Suma debe ser ≈ 1.0; el api hace validateWeights() runtime y cae a
# defaults con WARN log si parsing falla.
variable "matching_v2_weights_json" {
  description = "JSON con pesos custom para scoring v2 (ADR-033). Empty → DEFAULT_WEIGHTS_V2 hardcoded."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# ADR-035 Wave 4 — Auth universal RUT + clave numérica
# ---------------------------------------------------------------------------
# Cuando `true`, `/login` muestra selector de tipo usuario + form RUT +
# clave numérica para todos los roles. Default `false` mantiene el flow
# legacy (Google + email/password + reset).
#
# Rollout staged:
#   1. PR 1 (foundation backend): flag=false default. Endpoint
#      /auth/login-rut vivo pero sin uso del UI.
#   2. PR 2 (UI selector): flag=false default. Activar en staging para
#      smoke E2E. Si OK, activar en prod.
#   3. PR 3 (migración 30d): forzar rotación al login siguiente de
#      usuarios con email/password legacy.
#
# Flip es reversible sin redeploy de código.
variable "auth_universal_v1_activated" {
  description = "Activa el flow universal RUT + clave numérica (ADR-035). false = legacy email/password."
  type        = bool
  # Activado por Felipe (PO) 2026-05-13 tras merge de Waves 4 PR 1-3.
  # El cambio enciende el selector RUT+clave + modal forzado de rotación
  # para usuarios legacy en su próximo login. Flip reversible sin
  # redeploy de código — setear a `false` y `terraform apply` revierte
  # al flow legacy en segundos.
  default = true
}

# ---------------------------------------------------------------------------
# ADR-036 Wave 5 — Wake-word "Oye Booster"
# ---------------------------------------------------------------------------
# Cuando `true`, la card "Activación por voz" en
# /app/conductor/configuracion es activa (toggle real, no
# "próximamente"). El conductor debe además opt-in para que la PWA
# escuche el wake-word "Oye Booster".
#
# Mantener `false` en prod hasta que el modelo custom `oye-booster-cl.ppn`
# esté entrenado con voces chilenas vía Picovoice Console (Wave 5 PR 2).
variable "wake_word_voice_activated" {
  description = "Activa wake-word \"Oye Booster\" en /app/conductor (ADR-036)."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Modo demo (subdominio demo.boosterchile.com)
# ---------------------------------------------------------------------------
# Cuando ON, el api habilita el endpoint POST /demo/login (mintea custom
# tokens Firebase para las 4 personas demo: shipper, carrier, conductor,
# stakeholder) y corre auto-seed-demo en startup si no existen las
# entidades demo. La PWA detecta el host header demo.* y muestra UI de
# selector de persona en lugar del flow /login normal.
#
# Default true para demo Corfo (2026-05-18). Se apaga post-evento si
# Felipe decide retirar el subdominio.
variable "demo_mode_activated" {
  description = "Activa modo demo: endpoint /demo/login + auto-seed on startup + UI demo en subdominio demo.boosterchile.com."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Platform admin allowlist
# ---------------------------------------------------------------------------
# Emails (CSV) que pueden acceder a /app/platform-admin/* en la PWA y a
# /admin/* en el API. Operadores internos de Booster — NUNCA shippers,
# carriers ni stakeholders.
#
# Hasta acá la variable no estaba declarada en Terraform, así que el env
# var nunca llegaba a Cloud Run y el código defaulteaba a `''` (array
# vacío) → ningún email era admin → 403 al entrar a la UI. Bug en infra
# detectado durante UX review post-stack ADR-033.
#
# Para agregar/quitar admins: editar tfvars.local o tfvars.prod y aplicar.
variable "booster_platform_admin_emails" {
  description = "CSV de emails con acceso a las rutas /admin/* del API y la sección /app/platform-admin/* de la PWA."
  type        = string
  default     = "dev@boosterchile.com"
}
