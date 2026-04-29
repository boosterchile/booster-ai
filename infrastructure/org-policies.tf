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
