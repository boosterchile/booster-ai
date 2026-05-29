# Spec: sec-001-empresa-onboarding-gate-hotfix (close the self-promotion-to-dueño vector)

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-29
- **Status**: Approved (2026-05-29, PO) — split into PR-1 (gate + service guard + tests, urgent) + PR-2 (audit doc + forensic evidence + web check)
- **Class**: Security hotfix (live production privilege-escalation vector)
- **Linked**:
  - Finding: devils-advocate Round 1 on [`.specs/sec-001-h1-2-google-boundary-closure/review.md`](../sec-001-h1-2-google-boundary-closure/review.md) (P0-1)
  - Forensics: [`.specs/sec-001-empresa-onboarding-gate-hotfix/evidence/forensic-blast-radius.md`](./evidence/forensic-blast-radius.md) (to be written with PR)
  - Parent: [`.specs/sec-001-cierre/spec.md`](../sec-001-cierre/spec.md) §3 H1.2
  - Follow-up (the redesign this hotfix deliberately does NOT do): [`.specs/_followups/onboarding-flow-redesign.md`](../_followups/onboarding-flow-redesign.md)

## 1. Objective

Close the live vector by which **any authenticated Firebase user can self-promote to an active company `dueño`** via `POST /empresas/onboarding` with no approval gate. Add a flag (`EMPRESA_SELF_ONBOARDING_ENABLED`, default `false`) that disables self-service onboarding, and a CI harness that prevents a new ungated self-provisioning route from ever reappearing. Single responsibility: **shut the door.** Nothing else.

## 2. Why now

`onboardEmpresa` (`apps/api/src/services/onboarding.ts:67-202`) has no allowlist check — only uniqueness — and inserts `users.status='activo'` + `empresas` + `memberships role='dueno' status='activa'`. The route (`/empresas/*`, `server.ts:322-328`) runs on `firebaseAuthMiddleware` without `userContext`. Google `signInWithPopup` is live; IdP `disabled_user_signup=true` covers only email/password; the blocking function never deployed. **Net: an unauthorized Google account can become an active dueño today.** Forensics (the dueño-vs-account join, NOT the solicitudes count — onboarding bypasses solicitudes entirely, P1-5) found **no exploitation to date**: all 7 active dueños were classified PO-owned / pilot (Van Oosterwyk) / external-but-legitimate (Barvan, Nova Qualitas — PO confirmed keep) / demo, all created 2026-05-02→05-12 (before the approval flow shipped ~05-26), with no anomalous post-flow self-onboard. But the hole is open. The signup-approval flow is **not ready** to gate it (see §5), so the correct immediate action is to close self-service onboarding, decoupled from that flow.

## 3. Success criteria

- [ ] **SC-1**: `EMPRESA_SELF_ONBOARDING_ENABLED` env flag, Zod-validated in `apps/api/src/config.ts` (`booleanFlag(false)` — default closed).
- [ ] **SC-2 (route gate)**: `POST /empresas/onboarding` returns **403 `onboarding_disabled`** (clear message: self-service onboarding closed pending redesign) when the flag is off, **before any DB write**. When the flag is on, behaviour is unchanged. Gate lives in the route handler (`apps/api/src/routes/empresas.ts`); the flag is **injected** into `createEmpresaRoutes` (not module-imported) for testability (P1-3). Structured `@booster-ai/logger` line incl. correlation id + hashed email (no plaintext).
- [ ] **SC-2b (service-layer authorization — defense in depth, P0-2)**: `onboardEmpresa` gains a **required explicit authorization argument** (e.g. `authorizedBy: 'self_service' | 'admin_provisioned'`) and refuses to provision a `self_service` onboarding unless self-service is enabled. This makes authorization a service-layer invariant, so the future approve→dueño caller (redesign) cannot self-provision implicitly by bypassing the route check. Relaxes C-1 (see §6). ~5 LOC.
- [ ] **SC-3 (one-time route audit DOC, honestly labeled)**: A route-boundary audit doc enumerates every `app.use`/`app.route` mount in `server.ts` AND each `/me` **sub-route individually** (P1-4: `me-consents.ts` reads role data under bare firebaseAuth — audit it, don't stamp the group) with its middleware chain + verdict (ENFORCED / INTENTIONAL-OPEN / GAP-GATED). Records: `/empresas/onboarding` = GAP-GATED (this hotfix); `/trip-requests/*` v1 = SA-OIDC machine-to-machine (verified, not user self-provision); `/me/*` sub-routes = each verified self-scoped/allowlist-gated. INTENTIONAL-OPEN := *serves no cross-tenant data and grants no privilege absent an in-handler allowlist/approval check.* **This doc is a point-in-time audit, NOT a CI semantic gate** (see SC-4).
- [ ] **SC-4 (durable backstop = behavioural test, P0-1)**: The regression guard is a **behavioural integration test** asserting `POST /empresas/onboarding` returns 403 + writes nothing when the flag is off. If a future PR deletes the gate, this test fails — that is the real backstop. *A static `server.ts` route-wiring parser is explicitly REJECTED as the backstop*: it would flag `/empresas/*` only as "needs an allowlist entry," which the next hole-introducer satisfies with a truthful rationale ("user pre-onboarding"), and it cannot see the in-handler gate at all — i.e. it would be exactly the "documented but not verified" theater this spec rejects in Alternative B. (Optional, honest add-on: a `check-handler-completeness.ts`-style **smoke check** that the gate literal exists in `empresas.ts`, explicitly labeled "smoke, not semantic gate" — not load-bearing.)
- [ ] **SC-5**: Tests — (a) flag off → `POST /empresas/onboarding` returns 403, **no rows written** (usuarios/empresas/membresias counts unchanged); (b) flag on → onboarding succeeds (existing happy-path green); (c) existing user + flag on → still 409 (the 7 dueños can't double-onboard); (d) `onboardEmpresa` called with `authorizedBy:'self_service'` while disabled → throws (SC-2b service invariant). Coverage ≥80% on changed code.
- [ ] **SC-6**: PR includes the mandatory `## Evidencia` section: route-audit output, test output, `pnpm ci` green.

## 4. User-visible behaviour

- **Existing dueños (the 7, incl. PO accounts + pilots Barvan/Nova Qualitas + demo)**: **no change** — they have `users` rows + memberships and never re-onboard.
- **New self-service onboarding attempt** (e.g., a fresh Google sign-in hitting `/empresas/onboarding`): **403 `onboarding_disabled`** with a message directing them to request access (no company is created).
- **Pilots, during the closed window**: provisioned manually (operational; the proper self-serve path is the follow-up redesign).

## 5. Out of scope (deliberate — these belong to the follow-up redesign, NOT this hotfix)

- The **409 conflict** between `approveSignupRequest` (creates the `users` row) and `onboardEmpresa` (refuses existing users) — approval and onboarding are currently mutually exclusive; there is no working approved→dueño path. Real fix = redesign.
- Real email notification (currently logging-only).
- Flipping `SIGNUP_REQUEST_FLOW_ACTIVATED`.
- The **demo.boosterchile.com / app.boosterchile.com prospect strategy** — separating *"conocer Booster"* (exploratory → demo / minimal-permission account) from *"ser dueño operativo en prod"* (requires approval). Distinct concern, own cycle.
- The inert-account reaper, blocking-function decommission, Gen2, Alternative D/G — all parked.

All of the above → [`.specs/_followups/onboarding-flow-redesign.md`](../_followups/onboarding-flow-redesign.md).

## 6. Constraints

- **C-1 (relaxed per P0-2)**: Zero behaviour change other than the gate **and** a minimal `onboardEmpresa` signature addition (the required `authorizedBy` argument, SC-2b) — no change to its provisioning *logic*, the schema, or any other route. The service-layer invariant is in-scope precisely because a route-only gate is bypassable by the future redesign caller.
- **C-2**: Flag default `false` (closed). Zod-validated env (booster-stack-conventions).
- **C-3**: Gate denies *before* any DB write (fail-closed at the boundary).
- **C-4**: `@booster-ai/logger` structured log, hashed email (Ley 19.628), no `console.*`.
- **C-5**: Conventional commit `fix(empresas): ...`; PR with `## Evidencia`.
- **C-6**: Solo-dev REVIEW/SHIP cooling-off applies.

## 7. Approach

1. **`config.ts`** — add `EMPRESA_SELF_ONBOARDING_ENABLED: booleanFlag(false)` (confirm `booleanFlag` helper exists + defaults false safely).
2. **`routes/empresas.ts`** — inject the flag value into `createEmpresaRoutes(opts)` (P1-3, testability). At the top of the `/onboarding` handler (after `firebaseClaims`, before `onboardEmpresa`), if disabled → structured log + `return c.json({ error: 'onboarding_disabled', code: 'onboarding_disabled', message: '...' }, 403)`.
3. **`services/onboarding.ts`** — add required `authorizedBy: 'self_service' | 'admin_provisioned'` arg to `onboardEmpresa`; throw if `'self_service'` while self-service disabled (SC-2b). The route passes `'self_service'`. Existing tests updated for the new arg.
4. **Behavioural backstop test** — integration test: flag off → 403 + no writes (the durable guard, SC-4). NO static route-wiring CI parser (rejected as theater, P0-1).
5. **Route audit doc** — `evidence/route-boundary-audit.md` with the full mount table incl. per-`/me`-sub-route rows; labeled point-in-time audit.
6. **Forensic evidence** — `evidence/forensic-blast-radius.md` capturing the dueño-join queries already run (7 dueños classified, no post-flow exploitation).
7. **Tests** — `routes/empresas.test.ts` (flag on/off) + `services/onboarding.test.ts` (authorizedBy invariant).
8. **Follow-up stub** — `.specs/_followups/onboarding-flow-redesign.md`: 409 approve↔onboarding conflict, real email, flag flip, **and** the demo/app prospect strategy (*conocer Booster* exploratory/minimal-perms vs *dueño operativo* requires approval).
9. **Web check (P2-6)** — verify `use-onboarding-mutation.ts` call site + e2e specs don't brick pre-onboarding users against a flag-false backend (handle the 403 gracefully in the UI if needed; if UI work is non-trivial, scope it explicitly).

**Deploy note**: shipping with the flag default `false` closes self-service onboarding in prod immediately on deploy. Existing dueños unaffected. Acceptable per PO (interim manual pilot provisioning).

## 8. Alternatives considered

- **A — `EMPRESA_SELF_ONBOARDING_ENABLED` flag (chosen)**: honest closure, decoupled from the broken approval flow, reopened by flag when the integrated flow ships.
- **B — gate on `solicitudes_registro.estado='aprobado'`**: rejected by PO — closes the same as A today (empty allowlist) but couples the hotfix to a non-functional flow (the 409 conflict means even an approved user can't onboard) and *looks* like a definitive gate without being one — the "documented but not verified" anti-pattern.
- **C — fix the approve↔onboarding integration now**: rejected for the hotfix — it's a redesign (own spec), not a door-close; mixing it in violates single-responsibility and delays closing a live vector.

## 9. Risks and mitigations

| Risk | L | I | Mitigation |
|---|---|---|---|
| **R-1**: Flag default-false closes ALL new self-service onboarding → no new dueño until reopened/manual | H (intended) | M | Accepted by PO (interim alta manual/cerrada); 0 pending signups (empty solicitudes); existing 7 unaffected; follow-up redesign restores a proper path. |
| **R-2**: Gate placed after a partial write → inconsistent state | L | H | Gate at handler top, before `onboardEmpresa` is called (C-3); test asserts no rows written when flag off. |
| **R-3**: Harness allowlist wrong (false pass hides a real gap, or false fail blocks CI) | M | M | Allowlist entries require explicit rationale; harness tested on a violating fixture + the real tree; reviewed in PR. |
| **R-4**: A legitimate pilot needs onboarding during the closed window | M | M | Manual provisioning (operational); follow-up redesign delivers the self-serve path. Document the manual interim procedure in the PR. |
| **R-5**: Existing dueño accidentally blocked | L | H | They never re-onboard (409 on existing user); SC-5(c) asserts via the existing test. |

## 10. Test list

- **T1**: flag off → `POST /empresas/onboarding` → 403 `onboarding_disabled`; assert no INSERT (usuarios/empresas/membresias counts unchanged).
- **T2**: flag on → onboarding happy path succeeds (existing test green).
- **T3**: existing user (row present) + flag on → still 409 `UserAlreadyExists` (unchanged behaviour; the 7 dueños can't double-onboard).
- **T4**: harness — fixture route on `firebaseAuthMiddleware` w/o `userContext` and not allowlisted → exit 1; real `server.ts` tree → exit 0.
- **T5**: structured log on the 403 path contains correlation id + hashed email, no plaintext email.

## 11. Rollout

- **This is a KILL SWITCH, not a reversible toggle (P2-7).** Its safe state is **OFF**. Flag-ON is **unsafe in prod** until the redesign provides a real gated path — turning it on reopens the privilege-escalation hole. The flag exists so the redesign can flip it deliberately, not for routine ops.
- **Feature-flagged?**: Yes — `EMPRESA_SELF_ONBOARDING_ENABLED` (default false).
- **Migration?**: None.
- **Rollback**: for a *bug in the gate itself* → **revert the PR** (NOT flag-on — flag-on restores the vuln). For *a blocked legitimate pilot* → **manual provisioning** (OQ-1), NOT flag-on. There is no operational scenario where flag-on is the correct prod response before the redesign ships.
- **Monitoring**: count of `onboarding_disabled` 403s (signal of attempted self-onboards / a real prospect blocked).
- **Deploy**: standard Cloud Build staging→prod; the flag ships false. Post-deploy: confirm `/empresas/onboarding` returns 403 in prod (smoke) + existing dueño login unaffected.

## 12. Open questions

- **OQ-1**: Exact interim manual pilot-provisioning procedure (Admin SDK createUser + direct membership insert, or a one-off admin script?) — document in the PR; not blocking the gate.
- **OQ-2**: Should the harness live as its own workflow or a job in `ci.yml`? Default: a job in `ci.yml` (fewer moving parts). Decide at /plan.

## 13. Decision log

- **2026-05-29** — Proposal drafted (Option A) after PO decision. Forensics: no exploitation; signup-approval flow verified PARTIAL (approve↔onboarding 409 conflict, logging-only email, flag off). `/trip-requests/*` v1 confirmed SA-OIDC (not a second self-provision path); `/empresas/onboarding` is the sole gap. Scope held to single responsibility.
- **2026-05-29** — Devils-advocate Round 1: **APPROVE_WITH_RESERVATIONS**. Independently confirmed `onboardEmpresa` has exactly one non-test caller (the route) and all other dueño-creating paths are platform-admin/demo-gated → the route gate closes the only unprivileged path. Reservations folded into the spec: **P0-1** — replaced the static route-wiring "harness" (theater: a future hole becomes a one-line allowlist edit; can't see the in-handler gate) with a **behavioural regression test** as the durable backstop (SC-4); **P0-2** — added a service-layer authorization invariant to `onboardEmpresa` + relaxed C-1 (SC-2b), so the future redesign caller can't self-provision implicitly; **P1-5** — corrected the no-exploitation evidence to cite the dueño-join (not the meaningless solicitudes count); **P1-3** — flag injected for testability; **P1-4** — audit each `/me` sub-route individually; **P2-7** — reframed §11 as a kill switch (flag-ON is the unsafe state; rollback ≠ flag-on). Status: revised proposal awaiting PO approval before code.
