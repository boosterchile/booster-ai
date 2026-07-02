# Followup: Onboarding flow redesign (approved→dueño path + prospect strategy)

**Status**: Stub — NOT started. Deferred from the SEC-001 onboarding-gate hotfix (2026-05-29).
**Priority**: P1 — the hotfix (`.specs/sec-001-empresa-onboarding-gate-hotfix/`) closed the self-promotion vector by disabling self-service onboarding (`EMPRESA_SELF_ONBOARDING_ENABLED=false`). Until this redesign ships, **new owner onboarding is closed** and pilots are provisioned manually. This is the path back to a working, gated self-serve onboarding.

## Why this exists

The hotfix shut the door (`POST /empresas/onboarding` → 403 when the flag is off). The flag's ON-state is unsafe until a *gated* path exists. This followup builds that gated path.

## Scope (the things the hotfix deliberately did NOT touch)

1. **The 409 approve↔onboarding conflict.** `approveSignupRequest` (`apps/api/src/services/signup-request.ts`) creates a `users` row with `status='pendiente_verificacion'` but no empresa/membership; `onboardEmpresa` (`apps/api/src/services/onboarding.ts`) throws `UserAlreadyExistsError` (409) if a `users` row already exists. So an approved user **cannot** become a `dueño` — the two flows are mutually exclusive. Resolve: either approval should NOT pre-create the `users` row, OR `onboardEmpresa` must accept a pre-created `pendiente_verificacion` row and just add empresa+membership (using `authorizedBy='admin_provisioned'`, the arg the hotfix added).
2. **Real email notification.** `LoggingSignupRequestNotifier` only logs — approved users get no actual email/login link. Wire a real notifier.
3. **The `SIGNUP_REQUEST_FLOW_ACTIVATED` flip** (currently false → admin endpoints 503) and the `EMPRESA_SELF_ONBOARDING_ENABLED` posture — once a gated path exists, decide how onboarding is authorized (admin-provisioned vs gated self-serve) and what each flag means.
4. **Prospect strategy — `demo.boosterchile.com` / `app.boosterchile.com`.** Separate *"conocer Booster"* (exploratory — should land on demo or a minimal-permission account) from *"ser dueño operativo de una empresa en prod"* (requires approval). These are different journeys and must not collapse into the same ungated onboarding endpoint (which is how the vector existed). This is a product + architecture decision with its own design.

## Verified facts to carry in (2026-05-29 forensics + audit)

- `onboardEmpresa` has exactly one non-test caller (the route); all other dueño-creating paths (`seedDemo`, admin-seed, admin-approve via Admin SDK) are platform-admin/demo-gated.
- `onboardEmpresa` now requires `authorizedBy: 'self_service' | 'admin_provisioned'` + `selfServiceEnabled` (hotfix). The redesign's approved→dueño caller passes `'admin_provisioned'`.
- The API boundary (`user-context.ts`) returns 404 `user_not_registered` for tokens with no `users` row — but `/empresas/onboarding` is intentionally outside `userContext` (the user doesn't exist yet), which is why the in-handler/service gate is required.
- No exploitation of the vector to date (all 7 prod dueños are PO/pilot/demo, pre-approval-flow).

## Trigger

When the PO prioritizes restoring self-serve onboarding, or before any pilot needs the self-serve path. Full agent-rigor cycle (own spec → plan → build → review → ship).
