# =============================================================================
# Security hotfixes 2026-05-14 — T2 (Provisión de 7 secrets en Secret Manager)
# =============================================================================
# Spec: .specs/security-blocking-hotfixes-2026-05-14/spec.md (Approved 2026-05-14T21:45Z)
# Plan: .specs/security-blocking-hotfixes-2026-05-14/plan.md T2 (v3.1)
# ADRs: docs/adr/032-git-history-password-compromise-opcion-c.md
#       docs/adr/033-identity-platform-self-signup-manual-gap-provider.md
#
# Bloque separado del `security.tf` principal para llevar labels específicos
# (feature, phase) y annotations descriptivos del hotfix sin contaminar el
# resto del estado.

locals {
  # Mapping: secret_id → { purpose, placeholder? }.
  # `placeholder=true` indica que la version 1 inicial es placeholder
  # operacional rotado posteriormente en OPS-1 (4 demo passwords + seed
  # password + sre-webhook). `placeholder=false` indica que el secret
  # recibe valor real desde Terraform (pepper, generado random).
  hotfix_2026_05_14_secrets = {
    "demo-account-password-shipper" = {
      purpose     = "Password rotado de la cuenta demo demo-shipper@boosterchile.com (UID nQSqGqVCHGUn8yrU21uFtnLvaCK2). Reemplaza literal compromised. Spec §3 H1.1, OPS-1, ADR-032."
      placeholder = true
    }
    "demo-account-password-carrier" = {
      purpose     = "Password rotado de la cuenta demo demo-carrier@boosterchile.com (UID s1qSYAUJZcUtjGu4Pg2wjcjgd2o1). Spec §3 H1.1, OPS-1, ADR-032."
      placeholder = true
    }
    "demo-account-password-stakeholder" = {
      purpose     = "Password rotado de la cuenta demo demo-stakeholder@boosterchile.com (UID Uxa37UZPAEPWPYEhjjG772ELOiI2). Spec §3 H1.1, OPS-1, ADR-032."
      placeholder = true
    }
    "demo-account-password-conductor" = {
      purpose     = "Password rotado de la cuenta demo drivers+123456785@boosterchile.invalid (conductor, UID Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3). Spec §3 H1.1, PF-5.1, OPS-1, ADR-032."
      placeholder = true
    }
    "demo-seed-password" = {
      purpose     = "Password leído por seed-demo*.ts cuando DEMO_MODE_ACTIVATED=true. Reemplaza literal hardcoded BoosterDemo2026! en seed-demo.ts:86 y seed-demo-startup.ts:142. Spec §3 H1.4, T6, ADR-032."
      placeholder = true
    }
    "pin-rate-limit-hmac-pepper" = {
      purpose     = "HMAC-SHA256 pepper para hashear RUTs en labels de métrica auth.pin.lockout (devils-advocate v2 #10). Generado random 64 chars hex desde Terraform. Spec §3 H2."
      placeholder = false
    }
    "sre-notification-webhook" = {
      purpose     = "Slack webhook URL para alertas SRE: T-TTL-WARN, OPS-Y password-spray match, rate_limiter.fallback_active, identity_platform_config drift. Spec §3 H1 + H2."
      placeholder = true
    }
  }
}

# Pepper criptográficamente random — 64 chars hex (32 bytes equivalente).
resource "random_password" "pin_rate_limit_hmac_pepper" {
  length  = 64
  special = false
  upper   = true
  lower   = true
  numeric = true

  # No regenerar en cada apply — la regeneración invalida labels históricos
  # de métricas auth.pin.lockout. Rotación manual vía addVersion del secret.
  lifecycle {
    ignore_changes = all
  }
}

# Secrets en Secret Manager con replicación automática.
resource "google_secret_manager_secret" "hotfix_2026_05_14" {
  for_each = local.hotfix_2026_05_14_secrets

  secret_id = each.key
  project   = google_project.booster_ai.project_id

  replication {
    auto {}
  }

  labels = {
    managed_by = "terraform"
    env        = var.environment
    feature    = "security-hotfix-2026-05-14"
    phase      = "a"
  }

  # GCP Secret resource no expone `description` top-level; usamos annotations
  # (consultable vía `gcloud secrets describe <name>`).
  annotations = {
    purpose    = each.value.purpose
    hotfix-ref = "spec-security-blocking-hotfixes-2026-05-14"
  }

  depends_on = [google_project_service.apis]
}

# Version placeholder para los 6 secrets que se rotan en OPS-1 / OPS-Y.
# `REPLACE_ME_BEFORE_DEPLOY` es la convención de placeholder del hotfix
# (per plan T2 acceptance). El sentinel es detectable vía:
#   gcloud secrets versions access latest --secret=<name>
# Si retorna el sentinel exacto → secret aún no rotado.
resource "google_secret_manager_secret_version" "hotfix_2026_05_14_placeholder" {
  for_each = {
    for k, v in local.hotfix_2026_05_14_secrets : k => v if v.placeholder
  }

  secret      = google_secret_manager_secret.hotfix_2026_05_14[each.key].id
  secret_data = "REPLACE_ME_BEFORE_DEPLOY"

  lifecycle {
    # Una vez rotado (OPS-1 adds version 2+), Terraform no debe sobrescribir.
    ignore_changes = [secret_data, enabled]
  }
}

# Pepper recibe valor real desde el random_password.
resource "google_secret_manager_secret_version" "pin_rate_limit_hmac_pepper" {
  secret      = google_secret_manager_secret.hotfix_2026_05_14["pin-rate-limit-hmac-pepper"].id
  secret_data = random_password.pin_rate_limit_hmac_pepper.result

  lifecycle {
    ignore_changes = [secret_data, enabled]
  }
}

# IAM: Cloud Run runtime SA del API — read-only (secretAccessor).
# El SA `booster-cloudrun-sa` ya tiene `roles/secretmanager.secretAccessor`
# a nivel proyecto (security.tf comment línea 302), pero añadimos bindings
# per-secret para defense-in-depth + audit trail granular en Cloud Logging.
resource "google_secret_manager_secret_iam_member" "hotfix_2026_05_14_api_accessor" {
  for_each = google_secret_manager_secret.hotfix_2026_05_14

  project   = each.value.project
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# IAM: Felipe (dev@boosterchile.com) — admin (owner) para acceso operacional
# emergencia, rotación manual de versions, y debugging.
resource "google_secret_manager_secret_iam_member" "hotfix_2026_05_14_felipe_admin" {
  for_each = google_secret_manager_secret.hotfix_2026_05_14

  project   = each.value.project
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.admin"
  member    = "user:dev@boosterchile.com"
}
