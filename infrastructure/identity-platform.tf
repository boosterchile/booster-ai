# SEC-001 Sprint 2b H1.2 — Identity Platform email/password self-signup OFF (T11).
#
# Spec: .specs/sec-001-cierre/spec.md §3 H1.2 SC-1.2.2 (amendment A3 v3.4):
#   - Email/password leg (Sprint 2b): "Allow new accounts to sign up" = OFF.
#   - Google leg (TRACKED_RESIDUAL Sprint 2c): requires Firebase Auth
#     Blocking Function `beforeCreate`. NO managed aquí.
#
# ADR: docs/adr/052-signup-migration-admin-sdk-gate.md (Proposed; Status flip
# Accepted en T13 post-canary success).
#
# Doc operacional: docs/qa/identity-platform-config.md (verification curl +
# manual import steps + Google leg residual tracking).
#
# Project: booster-ai-494222 (via var.project_id).

resource "google_identity_platform_config" "default" {
  project = google_project.booster_ai.project_id

  # Email/password sign-IN (login de users existing) permanece ENABLED. Lo
  # único que cambia es el "Allow new accounts to sign up" toggle via
  # client.permissions.disabled_user_signup abajo.
  sign_in {
    email {
      enabled           = true
      password_required = true
    }
    # Defensa adicional: prevenir cuentas con email duplicado entre providers
    # (e.g., dos users con misma direccion pero diferente provider).
    allow_duplicate_emails = false
    # Declarado para matchear el estado del API (phone auth OFF) y eliminar el
    # diff perpetuo que reportaba el plan (#412). Sin cambio de comportamiento.
    phone_number {
      enabled = false
    }
  }

  # Multi-tenancy OFF (single-tenant). Declarado para matchear el API y eliminar
  # el diff perpetuo del plan (#412). Sin cambio de comportamiento.
  multi_tenant {
    allow_tenants = false
  }

  # ★ T11 SC-1.2.2 (email/password leg) ★ — disable client-side new-user
  # signup project-wide.
  #
  # Per Identity Platform API (cloud.google.com/identity-platform/docs/
  # reference/rest/v2/Config#ClientPermissionConfig):
  #
  #   "When true, end users cannot sign up for a new account on the
  #   associated project through any of the means supported by the project
  #   (Email/Password, IdPs, Anonymous, Phone)."
  #
  # **Important scope**: this disables CLIENT-SIDE signup (Firebase Auth
  # SDK via web/mobile). Admin SDK `auth.createUser({email, displayName})`
  # invoked from server-side (apps/api/src/services/signup-request.ts T10
  # approveSignupRequest) is NOT affected — service account auth bypasses
  # `clientPermissionConfig`. Verified via API docs + Sprint 2a precedent
  # `harden-demo-accounts.ts` which uses `auth.createUser` from Admin SDK.
  #
  # **Google residual**: while this flag covers email/password client signup,
  # Google `signInWithPopup` still creates new Firebase users on first sign-in
  # because Google OAuth is a federated provider where account creation is
  # implicit. The fix is Firebase Auth Blocking Function `beforeCreate`,
  # deferred to Sprint 2c (.specs/_followups/sprint-2c-google-blocking-
  # function.md). Documented as TRACKED_RESIDUAL in spec amendment A3.
  client {
    permissions {
      disabled_user_signup   = true
      disabled_user_deletion = false # users can still self-delete (UX OK)
    }
  }

  # SEC-001 boundary-closure T10 (SC-G7) — blocking function DECOMISADA
  # (ADR-057 supersede ADR-054). El bloque `blocking_functions` se removió:
  # la dirección Gen 1 quedó abandonada (deprecada) y Gen 2 no se verificó.
  # El leg Google se cierra por el boundary ADR-001 + harness CI default-deny
  # (SC-G1b) + reaper de higiene — no por un gate de creación.
  #
  # `blocking_functions` se deja FUERA de `ignore_changes` a propósito: así
  # terraform converge a "sin trigger beforeCreate" en CADA entorno y remueve
  # cualquier drift per-entorno (la wire pudo aplicarse en un entorno y no en
  # otro). Si estuviera en ignore_changes, un trigger driftado quedaría sin
  # remover. Ver análisis state-rm-vs-destroy en
  # `.specs/sec-001-h1-2-google-boundary-closure/t10-decommission-analysis.md`.

  lifecycle {
    # No managed aquí:
    #   - authorized_domains: gestionado manualmente (incluye boosterchile.com
    #     y demo.boosterchile.com via console + DNS).
    ignore_changes = [
      authorized_domains,
    ]
  }
}
