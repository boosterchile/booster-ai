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

  # Sprint 2c-B T5 — wire `beforeCreate` blocking function (Google leg
  # admin-approval gate). Per ADR-054 + plan v4 §T5 acceptance +
  # F-B3 critical fix (removed `blocking_functions` from
  # ignore_changes BEFORE adding this block — without that removal,
  # terraform would silently no-op the new block).
  #
  # `function_uri` references the Cloud Function created in T4
  # (auth-blocking-functions.tf). The function is deployed via Cloud
  # Build (T3 cloudbuild step) AFTER the resource shell is created
  # by terraform apply -target=google_cloudfunctions_function.before_create.
  # T7b CI workflow enforces deploy-before-wire ordering.
  blocking_functions {
    triggers {
      event_type   = "beforeCreate"
      function_uri = google_cloudfunctions_function.before_create.https_trigger_url
    }
  }

  lifecycle {
    # No managed aquí:
    #   - authorized_domains: gestionado manualmente (incluye boosterchile.com
    #     y demo.boosterchile.com via console + DNS).
    # NOTE: `blocking_functions` REMOVED from ignore_changes per Sprint
    # 2c-B T5 F-B3 fix — terraform now manages the trigger declaration
    # above; gcloud functions deploy only manages the function source
    # artifact (T4 lifecycle.ignore_changes covers that).
    ignore_changes = [
      authorized_domains,
    ]
  }
}
