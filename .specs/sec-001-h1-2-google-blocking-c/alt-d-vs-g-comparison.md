# Alternative D vs G — should Sprint 2c migrate at all?

> ## ⚠️ SECURITY CORRECTION (2026-05-29, post devils-advocate on the G spec)
> **§2's premise below — "an unauthorized Google account that self-creates is already inert / the boundary already enforces admission" — is FALSE, and the gap is a live production vulnerability.**
> `POST /empresas/onboarding` (`apps/api/src/routes/empresas.ts` → `services/onboarding.ts:67-202`) runs on `firebaseAuthMiddleware` **without** `userContext` (by design — the user row doesn't exist yet) and has **no allowlist check**: it inserts `users.status='activo'` + `empresas` + `memberships role='dueno' status='activa'` for any authenticated token. Google `signInWithPopup` is live and IdP `disabled_user_signup=true` only blocks email/password. The blocking function (the only would-be gate) was never deployed (T8). **Therefore, today, anyone can sign in with any Google account and self-promote to an active company `dueño` with no admin approval.**
> **Consequences for this comparison**: (1) the blocking function's marginal value was NOT merely "prevent an inert record" — it prevented **self-provisioning to dueño**. (2) G is NOT "~zero new code / already enforced"; its essential deliverable is **adding an allowlist gate at onboarding** (and auditing every bare-`firebaseAuth` route). (3) This fix is required **regardless of D vs G** — D (removing Google) does not close it, because any existing inert account or future provider hitting onboarding self-promotes. The corrected analysis still favors G (boundary gate + reaper) over Gen2/D, but the "near-zero" framing is withdrawn. See `.specs/sec-001-h1-2-google-boundary-closure/review.md` Round 1 (P0-1).

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-29
- **Status**: Decision input — **blocks any Gen2 migration spec approval** (PO directive 2026-05-29). §2 premise corrected by the security note above.
- **Trigger**: PO insight — `apps/auth-blocking-functions/src/handler.ts` is a **pure admission gate** (deny-only, no provisioning), so its invariant can live at the existing JWT Zero-Trust boundary (ADR-001) instead of in a Cloud Function. If true, D or G closes Sprint 2c with **no migration**, which is the best zero-tech-debt outcome.

## 1. Handler verification (done — premise confirmed)

`handler.ts` has exactly three throw-exits and two `return {}` (passthrough/allow). The only data access is a **read**: `pool.query("SELECT 1 FROM solicitudes_registro WHERE LOWER(email)=$1 AND estado='aprobado' LIMIT 1")`.

- **No** `setCustomUserClaims`, **no** `customClaims` in the return, **no** INSERT/UPDATE/DELETE, **no** `createUser`/`updateUser` anywhere in `src/`. (All write-verbs found by scan live in `test/integration/` fixtures.)
- `handler.test.ts` allow-path asserts `result).toEqual({})` — the handler never mutates the user record.
- `admin-sdk-no-impact.test.ts` confirms provisioning lives elsewhere: `approveSignupRequest → auth.createUser` (which bypasses the blocking function entirely).
- `check-handler-completeness.ts` is a smoke check that the handler merely *references* the allowlist table + emits the deny code.

**Conclusion**: the function is an **admission gate, not a provisioner**. Moving it carries no "created-in-IdP vs registered-in-system" consistency risk, because it writes no state. Premise holds.

## 2. What the blocking function actually buys (over what's already shipped)

The authorization invariant Booster cares about — *"a non-allowlisted user gets no access"* — is **already enforced at the API boundary**:

> `apps/api/src/middleware/user-context.ts:51-56`: a verified Firebase token whose `uid` has **no `users` row** → **404 `user_not_registered`**. Every business route behind `userContext` (cobra-hoy, admin-*, etc.) already fail-closes on unprovisioned users. (`/me` deliberately skips it — it's the onboarding-status probe.)

So an unauthorized Google account that self-creates today is **already inert**: valid Firebase JWT, zero access, blocked at every protected route. The blocking function's **only marginal value** is preventing the inert IdP record from *existing in the tenant at all*. That is the entire stake of Sprint 2c.

## 3. The two alternatives — semantic distinction

| | **D — Remove Google provider** | **G — Post-OAuth boundary gate (rely on ADR-001)** |
|---|---|---|
| Unauthorized account | **Never created** in IdP (no Google self-signup path exists) | **Created but inert** in IdP; zero access until allowlisted |
| Mechanism | Remove `signInWithPopup` from web + disable `google.com` provider in IdP (Terraform) | Keep Google sign-in; the existing `user-context` 404 already blocks; (optional) reaper cron deletes inert accounts |
| New code | Web: remove Google from login/link/reauth (`use-auth.ts` 3 call-sites) + Terraform provider disable | **~Zero** for the gate (already shipped). Optional: inert-account reaper + route-coverage audit |
| Blast radius | **All** Google users (authorized included) | **Only** unauthorized users (inert); authorized unaffected |
| IdP tenant hygiene | Pristine — no unauthorized accounts exist | Inert unauthorized accounts accumulate unless reaped |

**Both D and G delete Sprint 2c in full**: no Cloud Function, no Gen1/Gen2 problem, no deploy-and-observe prod mutation, no v2-wrapper substring risk, no unproven Gen2 path, no ADR-054 migration. Authorization consolidates into the single ADR-001 boundary layer — the zero-tech-debt ideal.

## 4. Grounded costs

### D — Remove Google provider
- **Locks out 5 existing Google accounts** (ghost-users-dry-run.csv), **including the PO's own `dev@boosterchile.com`**, plus `fvicencio@gmail.com`, `pensando@fueradelacaja.co`, and two external `@gmail.com`. They can no longer log in via Google → require email/password migration (set-password / account-linking flow) before D ships, or they're locked out.
- Removes working UX woven through `use-auth.ts`: `signInWithPopup` (login), `linkWithPopup` (profile linking), `reauthenticateWithPopup` (reauth). Profile `AuthProvidersSection` also assumes `google.com` as a provider.
- B2B admin-approved onboarding with <10 Google signups/month → the *future* UX loss is small, but the *existing-user* migration is real and includes the PO.
- **Strongest where**: compliance/hygiene posture is "an unauthorized account must not EXIST, period" — D removes the vector at the source.

### G — Boundary gate (already shipped) + optional reaper
- The gate is **already enforced** (`user-context` 404). Confirming it's complete needs only an **audit**: every protected route resolves `userContext` (no bare-JWT business route). `/me` skipping it is correct (onboarding).
- Keeps all 5 existing Google users + the PO working; no migration, no UX loss.
- **Residual**: inert unauthorized Firebase users pile up in the tenant → bloat + audit-log noise (the exact objection ADR-054 Alt-B raised). **Closed cheaply** by a reaper cron: delete IdP users with no matching `users` row after N days — a scheduled job (pattern already exists: `demo-account-ttl-alert` cron), **no blocking function, no Gen2**.
- **Strongest where**: inert accounts are tolerable (or reaped), and preserving Google UX + avoiding a 5-user migration matters.

## 5. The deciding question (PO call)

> **Is it acceptable for unauthorized, inert Google accounts to exist in Booster's Identity Platform tenant (optionally reaped after N days)?**

- **NO — no unauthorized account may exist** → **D** (remove the provider; never create them). Accept the 5-existing-user migration (incl. PO) + Google UX removal.
- **YES — inert accounts are tolerable / reapable** → **G** (boundary already enforces; add a reaper for hygiene). No migration, no UX loss, near-zero code.

## 6. Recommendation

**G + reaper cron**, unless compliance demands D. Rationale:
1. The authorization invariant is **already enforced** at the ADR-001 boundary (`user-context` 404) — G is consolidation onto existing, proven code, not new surface.
2. D imposes a real migration on 5 live Google users **including the PO** and strips working login/link/reauth UX, to buy a hygiene property a cheap reaper delivers anyway.
3. A reaper cron (delete inert IdP users with no `users` row after N days) gives D's "no lingering unauthorized accounts" outcome **without** any Cloud Function, Gen2 migration, or prod-mutating spike.
4. Both kill Sprint 2c; G is the lower-cost, lower-risk kill.

**If G is chosen**, Sprint 2c-A/2c-B/2c-C all close as *superseded*; the work product becomes: (a) a short ADR (supersede/annotate ADR-054) recording that the gate moved to the boundary; (b) a route-coverage audit; (c) the inert-account reaper; (d) decommission the Gen 1 tainted state + `apps/auth-blocking-functions` (or archive it). The Google-leg residual in `sec-001-cierre` §3 SC-1.2.2 transitions `TRACKED_RESIDUAL → MET` via boundary enforcement, not a blocking function.

**If D is chosen**, scope is: web Google removal + IdP provider disable (Terraform) + a migration path for the 5 existing Google users (incl. PO) before cutover.

## 7. Verification appendix (evidence consulted)

- `apps/auth-blocking-functions/src/handler.ts` (deny-pure, read-only) + `handler.test.ts` (allow → `{}`) + `check-handler-completeness.ts` (smoke only).
- State-write scan: zero writes in `src/`; all write-verbs in `test/integration/`.
- `apps/api/src/middleware/user-context.ts:51-56` — boundary 404 `user_not_registered` already enforced.
- `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-dry-run.csv` — 5 existing Google accounts incl. PO.
- `apps/web/src/hooks/use-auth.ts` — Google surface: `signInWithPopup` / `linkWithPopup` / `reauthenticateWithPopup`.
- `infrastructure/identity-platform.tf` — email/password self-signup already OFF; Google residual noted.

## 8. Decision

> _Pending PO. Per directive, no Gen2 migration spec is written or approved until this comparison is decided._
