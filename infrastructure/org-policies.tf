# =============================================================================
# Organization Policy overrides aplicados a nivel proyecto
# =============================================================================
#
# La organización boosterchile.com tiene `iam.allowedPolicyMemberDomains`
# configurada como Domain Restricted Sharing — solo permite agregar miembros
# del propio Workspace a IAM policies. Eso bloquea:
#   - allUsers (acceso público) — necesario para el webhook Twilio del bot
#   - allAuthenticatedUsers
#
# Override a nivel proyecto: este project SÍ permite cualquier miembro IAM
# (incluyendo allUsers). Los otros proyectos de la org siguen restringidos.
#
# Antes de Terraform: este override se hizo manualmente en Cloud Console por
# el org admin (contacto@boosterchile.com). Ahora está codificado para
# evitar drift.

resource "google_org_policy_policy" "allow_public_iam" {
  name   = "projects/${google_project.booster_ai.project_id}/policies/iam.allowedPolicyMemberDomains"
  parent = "projects/${google_project.booster_ai.project_id}"

  spec {
    rules {
      allow_all = "TRUE"
    }
  }

  # Requiere orgpolicy API habilitada (ver project.tf).
  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Excepción a `iam.disableServiceAccountKeyCreation` (spec acceso-gcp-sesiones-nube)
# -----------------------------------------------------------------------------
# La org la aplica (enforce: true) y bloquea toda llave de SA. Este proyecto la
# apaga para poder crear UNA llave: la del SA de solo lectura
# `claude-cloud-readonly` (iam.tf), que vive como Network secret en el proxy de
# Anthropic y nunca entra al contenedor ni al repo. Los otros proyectos de la
# org siguen bloqueados.
#
# Excepción deliberada a la lección SEC-2026-04-01 (ADR-001: nunca descargar SA
# keys), aceptada por el PO en la spec §6. Las demás llaves del proyecto no se
# crean: CI sigue por WIF y los SA de runtime por identidad nativa.
resource "google_org_policy_policy" "allow_sa_keys" {
  name   = "projects/${google_project.booster_ai.project_id}/policies/iam.disableServiceAccountKeyCreation"
  parent = "projects/${google_project.booster_ai.project_id}"

  spec {
    rules {
      enforce = "FALSE"
    }
  }

  # Requiere orgpolicy API habilitada (ver project.tf).
  depends_on = [google_project_service.apis]
}
