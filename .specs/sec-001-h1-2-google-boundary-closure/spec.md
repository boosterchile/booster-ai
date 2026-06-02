# Spec: sec-001-h1-2-google-boundary-closure (close the Google self-signup residual at the API boundary + inert-account reaper)

> ## ⚠️ Draft premise corrected — devils-advocate Round 1 (DO_NOT_APPROVE), 2026-05-29
> The drafted premise ("the ADR-001 boundary ALREADY enforces admission; G is ~zero new code") is **false and revealed a live vulnerability**: `POST /empresas/onboarding` → `onboardEmpresa` (`services/onboarding.ts:67-202`) self-provisions an active `dueño` with **no allowlist check**, reachable today via Google `signInWithPopup`. The essential deliverable is therefore **adding an admission gate at onboarding** (+ a structural default-deny audit), not "auditing that it's already enforced." The reaper is secondary hygiene. §0/§1/§3 (SC-G1)/§8/§9 are being re-centered pending PO priority decision (hotfix-now vs fold-in). Reaper hardening (P0-2: email+uid dual guard, shared normalization, IdP pagination, disable-before-delete, lastSignInTime guard) + a default-deny CI harness (P1-1) are required. See `review.md` Round 1.

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-29
- **Status**: Draft — **NOT approvable as drafted** (DA Round 1 DO_NOT_APPROVE; live security finding; awaiting PO priority decision)
- **Linked**:
  - Parent: [`.specs/sec-001-cierre/spec.md`](../sec-001-cierre/spec.md) §3 SC-1.2.2 (Google leg = `TRACKED_RESIDUAL` → this spec drives it to `MET`)
  - Decision input: [`.specs/sec-001-h1-2-google-blocking-c/alt-d-vs-g-comparison.md`](../sec-001-h1-2-google-blocking-c/alt-d-vs-g-comparison.md) (PO chose Alternative G + reaper, 2026-05-29)
  - Superseded approach: [`.specs/sec-001-h1-2-google-blocking/`](../sec-001-h1-2-google-blocking/) umbrella + `-a` (handler) + `-b` (deploy, BLOCKED at T8) + `-c` (Gen 2 migration, SUPERSEDED) — the entire blocking-function direction
  - ADR to supersede/annotate: [`docs/adr/054-google-blocking-function-signup-gate.md`](../../docs/adr/054-google-blocking-function-signup-gate.md) (Proposed)
  - Boundary already enforcing: `apps/api/src/middleware/user-context.ts:51-56` (404 `user_not_registered`)

## 0. Context — why this replaces the blocking-function approach

Sprint 2c built an Identity Platform `beforeCreate` blocking function to stop unauthorized Google self-signups. It is **blocked and abandoned**: Gen 1 builds are dead (deprecation), and the Gen 2 path requires an unverified, production-mutating spike (`google-blocking-c/oq-research.md`). During the D-vs-G evaluation the handler was **verified deny-pure** (admission gate, zero provisioning, read-only), and the ADR-001 Zero-Trust boundary was found to **already enforce the same admission invariant**: a verified Firebase token with no `users` row receives **404 `user_not_registered`** (`user-context.ts`). The blocking function's only marginal value was preventing the *inert* IdP record from existing. The PO chose to consolidate authorization onto the single boundary layer (Alternative G) and add a reaper cron for IdP-tenant hygiene — closing the residual with no Cloud Function, no Gen2 risk, and no migration of the 5 existing Google users (incl. the PO).

## 1. Objective

Close the SEC-001 H1.2 Google self-signup residual by (a) **auditing and, where needed, hardening** the API boundary so every protected route denies access to any authenticated-but-unprovisioned user, and (b) adding a **fail-safe reaper cron** that removes inert Identity Platform accounts (no `users` row, not pending/approved, aged past a grace period) for tenant hygiene. Then **decommission** the abandoned blocking-function artifacts and transition the parent residual `TRACKED_RESIDUAL → MET`.

## 2. Why now

Same drivers as the umbrella: the Google leg is the last open vector of SEC-001 H1.2. The blocking-function path is dead/unverified; the boundary already enforces the invariant; the PO has decided G + reaper (2026-05-29). Doing it now closes SEC-001 H1.2 without carrying an unproven Gen 2 path as tech debt.

## 3. Success criteria

- [ ] **SC-G1 (boundary audit)**: An enumerated audit of every route group in `apps/api/src/server.ts` confirms each route that exposes business data/actions requires a resolved `users` row (via `userContextMiddleware` or an explicit membership/role check). Any route on bare `firebaseAuthMiddleware` without a `users`-row requirement is either (a) justified onboarding/public-status (`/me` is intentional) and documented, or (b) fixed. Deliverable: `route-boundary-audit.md` listing every group, its middleware chain, and verdict (ENFORCED / INTENTIONAL-OPEN / GAP-FIXED).
- [ ] **SC-G2 (existing-account classification)**: The 5 existing Google IdP accounts (ghost-users-dry-run.csv) are cross-referenced against `users` + `solicitudes_registro` and classified LEGITIMATE / PENDING / INERT. The PO records a decision per INERT account. No LEGITIMATE account (incl. `dev@boosterchile.com`) is ever in scope for reaping. Deliverable: `existing-google-accounts-classification.md`.
- [ ] **SC-G3 (reaper correctness)**: A reaper service identifies an IdP account as reapable **only if** ALL hold: (1) no matching `users` row by `firebase_uid`; (2) no `solicitudes_registro` row with `estado IN ('pendiente_aprobacion','aprobado')` by normalized email; (3) account `creationTime` older than `REAPER_GRACE_DAYS`. Verified by unit tests covering: legitimate-not-reaped, pending-not-reaped, approved-not-reaped, inert-aged-reaped, inert-within-grace-not-reaped.
- [ ] **SC-G4 (reaper fail-safe)**: The reaper defaults to **dry-run** (lists candidates, writes no changes); destructive mode requires an explicit flag; it emits structured logs (`signup.reaper.candidate` / `signup.reaper.disabled`) + a Cloud Monitoring counter; and it **hard-refuses** to act on any account with a `users` row even if other conditions match (defense in depth). First production run is dry-run with PO sign-off before destructive enablement.
- [ ] **SC-G5 (scheduling)**: The reaper is wired via Cloud Scheduler + Terraform (pattern: `demo-account-ttl-alerter`), cadence documented; no manual invocation required for steady state.
- [ ] **SC-G6 (ADR)**: ADR-054 is superseded/annotated by a new ADR recording: blocking function abandoned (Gen 1 dead, Gen 2 unverified), admission enforced at the ADR-001 boundary, reaper for hygiene. The Gen1-vs-Gen2 lessons-learned doc is cross-referenced.
- [ ] **SC-G7 (decommission)**: The abandoned blocking-function artifacts are removed/archived with zero collateral and a clean `terraform plan`: `apps/auth-blocking-functions/` (archive or delete), the `cloudbuild.production.yaml` auth-blocking deploy lane + `_AUTH_BLOCKING_DEPLOY` gate, the `infrastructure/auth-blocking-functions.tf` resources (incl. the Gen1 tainted state + placeholder bucket + IAM grants), the `infrastructure/identity-platform.tf` `blocking_functions` wire (never applied), and the related monitoring infra that only served the blocking function. Each removal verified against live references before deletion.
- [ ] **SC-G8 (residual closure)**: `sec-001-cierre/spec.md` §3 SC-1.2.2 Google leg transitions `TRACKED_RESIDUAL → MET` (enforced via boundary + reaper, not a blocking function); decision log updated; the `sprint-2c-google-blocking-function.md` followup is closed with a pointer here.
- [ ] **SC-G9 (coverage)**: ≥80% coverage (lines/branches/functions) on new reaper code per CLAUDE.md; `@booster-ai/logger` + Zod boundaries + OTel per booster-stack-conventions.

## 4. User-visible behaviour

- **Authorized Google user** (has `users` row): unchanged — logs in via Google, full access. (Includes the 5 existing accounts that classify LEGITIMATE.)
- **Unauthorized Google user** (no `users` row): can still complete `signInWithPopup` (an inert Firebase account is created), but **every protected route returns 404 `user_not_registered`** — zero access. After `REAPER_GRACE_DAYS` with no approval, the inert account is removed. No user-facing change from today's behaviour except the eventual cleanup.
- **Pending-approval user**: unaffected during the approval window (reaper excludes `pendiente_aprobacion`).
- No change to the email/password leg (self-signup already OFF, Sprint 2b).

## 5. Out of scope

- The blocking function / Gen 1 / Gen 2 migration — abandoned (this spec decommissions it).
- The email/password leg (done Sprint 2b).
- SEC-001 H1.5 (forensics) and H1.6 (demo reactivation).
- Migrating existing Google users to email/password (that was Alternative D, not chosen).
- Any change to `approveSignupRequest` / Admin SDK `createUser` provisioning (the legitimate onboarding path).
- Redesigning `solicitudes_registro` schema or the signup-request flow.

## 6. Constraints

- **C-G1**: ADR-001 JWT Zero-Trust is the single authorization layer; this spec consolidates onto it, introduces no parallel auth mechanism.
- **C-G2 (destructive-op safety)**: the reaper deletes/disables **production** IdP accounts. It MUST be fail-safe: dry-run default, `users`-row hard-guard, grace period, structured audit trail, reversible first (disable before delete — see OQ-G2), PO sign-off before first destructive run.
- **C-G3 (grace ≥ approval SLA)**: `REAPER_GRACE_DAYS` must exceed the maximum realistic admin-approval turnaround so a legitimately-pending user is never reaped (cross-check the signup-request approval SLA).
- **C-G4 (IaC)**: scheduler + decommission via Terraform (100% IaC); no out-of-band console changes.
- **C-G5 (PII)**: reaper logs use hashed email (SHA-256) per Ley 19.628 + the existing handler precedent; no plaintext email in logs.
- **C-G6 (cooling-off)**: solo-dev REVIEW/SHIP cooling-off applies; no pre-authorised waiver.

## 7. Approach

1. **Boundary audit (read-only, first)** — enumerate every `app.use(...)` route group in `server.ts`; for each, record the middleware chain and whether a `users` row is required before business data is served. Produce `route-boundary-audit.md`. Fix any GAP (a business route reachable with a bare Firebase token) by adding `userContextMiddleware` or a membership check. This is what makes G's enforcement claim true rather than assumed.
2. **Existing-account classification** — cross-ref the 5 Google IdP accounts against `users` + `solicitudes_registro`; PO decision per INERT account; produce `existing-google-accounts-classification.md`. Gate the reaper's first destructive run on this.
3. **Reaper service** — a provider-agnostic inert-account reaper (the predicate naturally covers Google since email/password self-signup is OFF, so Google is the only self-created provider). Reuse the `demo-account-ttl-alerter` structure: list IdP users (Admin SDK), cross-ref `users` + `solicitudes_registro`, apply the SC-G3 predicate, dry-run by default. Unit-tested against the SC-G3 scenarios.
4. **Scheduling** — Cloud Scheduler + Terraform, mirroring `demo-account-ttl`.
5. **ADR** — supersede/annotate ADR-054 (SC-G6).
6. **Decommission** — remove the blocking-function artifacts (SC-G7) in a dependency-safe order, each verified against live references; clean `terraform plan`.
7. **Residual closure** — transition the parent SC-1.2.2 + close the followup (SC-G8).

**Sequencing for `/plan`**: audit (1) and classification (2) are read-only and gate everything; the reaper (3-4) is the core new code; decommission (6) is independent and can run in parallel once the reaper covers hygiene. ADR (5) before reaper code per "ADR before code".

## 8. Alternatives considered

- **G + reaper (this spec)** — **Chosen by PO** (2026-05-29). Consolidates onto the existing boundary; near-zero new auth code; reaper closes the hygiene gap; no Cloud Function/Gen2.
- **D — remove Google provider** — Rejected by PO: locks out 5 existing Google users incl. the PO, strips working login/link/reauth UX, for a hygiene property the reaper delivers anyway. (Full analysis in `alt-d-vs-g-comparison.md`.)
- **G without reaper** — Rejected: leaves inert unauthorized accounts in the tenant indefinitely (bloat + audit-log noise).
- **Gen 2 blocking-function migration** — Rejected: unverified, production-mutating spike required; adds an unproven Gen2 path as tech debt to gate something the boundary already enforces.
- **Keep Gen 1 / GCP support ticket** — Rejected: Gen 1 deprecation is a permanent dead-end.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R-G1**: Reaper deletes a LEGITIMATE account (e.g., the PO) | L | **Critical** | `users`-row hard-guard (SC-G4) + dry-run default + SC-G2 classification gate + PO sign-off on first destructive run + audit log + reversible disable-before-delete (OQ-G2). |
| **R-G2**: Boundary audit misses a route that serves data on a bare Firebase token | M | H | Systematic enumeration of ALL `app.use` groups in `server.ts` (SC-G1) + a test asserting an unprovisioned token gets 404 on a representative protected route per group. |
| **R-G3**: A legitimately-pending user is reaped mid-approval | L | H | Predicate excludes `estado IN ('pendiente_aprobacion','aprobado')` + `REAPER_GRACE_DAYS` > max approval SLA (C-G3). |
| **R-G4**: Decommission removes something still referenced (breaks build/deploy) | M | M | Grep live references before each removal; archive-not-delete option for `apps/auth-blocking-functions`; clean `terraform plan` gate (SC-G7). |
| **R-G5**: The 2 external `@gmail.com` accounts are real prospects, not test users | M | M | SC-G2 PO classification before any reaping; default to LEGITIMATE/PENDING if uncertain (fail-safe). |
| **R-G6**: Inert-account creation is itself an abuse vector (mass Google signups bloating the tenant) | L | M | Reaper bounds accumulation; the existing rate-limit + Cloud Armor on signup paths bounds creation rate; monitor reaper volume (alert on spikes). |

## 10. Test list

- **T1**: Reaper — INERT + aged + no users row + no pending/approved → reaped (dry-run lists it).
- **T2**: Reaper — has `users` row → NEVER reaped (even if other conditions match — hard-guard).
- **T3**: Reaper — `solicitudes_registro.estado='pendiente_aprobacion'` → not reaped.
- **T4**: Reaper — `estado='aprobado'` but `users` row not yet created (transitional) → not reaped.
- **T5**: Reaper — inert but within `REAPER_GRACE_DAYS` → not reaped.
- **T6**: Reaper — dry-run default writes nothing; destructive flag required to act.
- **T7**: Reaper — logs use hashed email, no plaintext (PII regression).
- **T8**: Boundary — an unprovisioned (valid token, no `users` row) request to a representative protected route per group → 404 `user_not_registered` (or 403). One per route group from the audit.
- **T9**: Terraform `plan` after decommission → no unexpected destroys beyond the intended blocking-function resources.
- **T10**: ADR + parent residual transition present and consistent (doc check).

## 11. Rollout

- **Feature-flagged?**: Reaper destructive mode behind an explicit flag/arg; dry-run is the safe default.
- **Migration needed?**: None (no user migration — that was D). Decommission is infra/code removal.
- **Rollback plan**: disable the Cloud Scheduler job (reaper stops); decommission is a normal revert if a removed artifact is unexpectedly needed; disabled accounts (if disable-before-delete chosen) are restorable via `auth.updateUser(uid,{disabled:false})`.
- **Monitoring**: reaper counter + a Cloud Monitoring alert on anomalous reap volume (a spike could mean a predicate bug or an attack); 24h manual review after first destructive run.
- **Gate for `/build`**: boundary audit (SC-G1) complete; existing-account classification (SC-G2) + PO decision recorded; ADR written.
- **Gate for first destructive reaper run**: dry-run output reviewed + PO sign-off (C-G2).

## 12. Open questions

- **OQ-G1**: `REAPER_GRACE_DAYS` value? Needs the max admin-approval SLA from the signup-request flow (C-G3). Default proposal: 30 days.
- **OQ-G2**: Reaper action — **disable** (reversible, `auth.updateUser disabled:true`) then delete after a second grace, vs **hard-delete**? Reversible-first is safer for R-G1; decide at /plan.
- **OQ-G3**: Reaper scope — provider-agnostic (any inert IdP account) vs Google-only filter? Provider-agnostic is cleaner (email/password self-signup is OFF so Google is the only self-created provider anyway), but confirm no other provider (SAML, phone) legitimately creates accounts without a `users` row.
- **OQ-G4**: Are the 2 external `@gmail.com` accounts (gobe00, edio.pinilla) real prospects or test artifacts? (Resolved by SC-G2 PO classification.)
- **OQ-G5**: `apps/auth-blocking-functions` — archive (keep as audit/history under `docs/archive/` or a tag) or delete outright? PO preference.

## 13. Decision log

- **2026-05-29** — Spec created after PO chose Alternative G + reaper (`alt-d-vs-g-comparison.md`) over the Gen 2 blocking-function migration. Premise verified: handler is deny-pure (no provisioning); ADR-001 boundary already returns 404 `user_not_registered` for unprovisioned tokens; 5 existing Google accounts (incl. PO) make Alternative D costly. This spec consolidates admission onto the boundary, adds a fail-safe reaper for hygiene, and decommissions the blocking-function artifacts. Status: Draft awaiting devils-advocate pass + PO approval.
