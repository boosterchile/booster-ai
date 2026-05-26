# Spec: sec-001-h1-2-google-blocking-a (Sprint 2c-A — handler implementation)

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-26 (sub-spec post-split per G-14)
- **Status**: Draft
- **Scope**: Sub-sprint A. Handler implementation **only** (code + tests + emulator integration). **No prod impact**.

## Relationship to umbrella spec

This sub-spec inherits **shared context** from the umbrella:

- [`.specs/sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md) — umbrella spec (Approved v2 + split into 2c-A/2c-B). Read §1 Objective, §2 Why now, §4 User-visible behaviour, §6 Constraints C1-C14, §7 Approach overview, §8 Alternatives, §9 Risks R-2C-1..13, §12 Open questions OQ-2C-1..9 resolution.
- [`.specs/sec-001-h1-2-google-blocking/oq-research.md`](../sec-001-h1-2-google-blocking/oq-research.md) — empirical research backing architecture decisions.
- [`.specs/sec-001-h1-2-google-blocking/review.md`](../sec-001-h1-2-google-blocking/review.md) — DA pass on spec v1.
- [`.specs/sec-001-h1-2-google-blocking/plan-review.md`](../sec-001-h1-2-google-blocking/plan-review.md) — DA passes on plan v1+v2 (5 P0 + 6 P1 + 5 P2 latest); informs split.

**Companion sub-spec**: [`.specs/sec-001-h1-2-google-blocking-b/spec.md`](../sec-001-h1-2-google-blocking-b/spec.md) — Sprint 2c-B (deployment + wire + 7d watch + ADR Accepted).

## 1. Objective (sub-sprint scope)

Build the Cloud Function Gen 1 handler that implements the admin-approval gate logic for Google federated sign-up. Includes: handler code, email normalization, DB pool, structured logging, ghost user inventory script (read-only), Firebase emulator integration test, race-documents-invariant test, Admin SDK no-impact test. Output: shipped to `main` with full test coverage. **Function NOT yet deployed to prod**; deployment + IdP wire is Sprint 2c-B.

## 2. Why now (delta from umbrella §2)

Same drivers as umbrella §2 (cierre residual SC-1.2.2 Google leg). 2c-A is the code-only portion that can ship **without prod impact** and **without waiting for ADR-052 Accepted** (gate aplica to deploy, not code-in-main).

## 3. Success criteria (sub-sprint scope)

Subset of umbrella §3 SCs reachable purely via code-in-main (no deploy):

- [ ] **SC-2C.A.1**: `apps/auth-blocking-functions/` exists en `main` con full handler + tests. `pnpm --filter @booster-ai/auth-blocking-functions test` 100 % pass.
- [ ] **SC-2C.A.2** (sub-derives umbrella SC-2C.7): coverage ≥ 80 % lines / 75 % branches per CLAUDE.md booster-stack-conventions. Cubre: happy approved, rejected not-found, rejected wrong-estado, DB throw fail-closed, non-Google provider passthrough, race-documents-invariant, email IDN/punycode.
- [ ] **SC-2C.A.3** (sub-derives umbrella SC-2C.11): Admin SDK `auth.createUser` no-impact verified via integration test (apps/api approveSignupRequest flow). Empirically resolves OQ-2C-8.
- [ ] **SC-2C.A.4**: Ghost user inventory script (`apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts`) exists con unit tests. **Read-only** (NO disabling/deletion). Execution (CSV generation) is Sprint 2c-B SC-2C.B.4.
- [ ] **SC-2C.A.5** (sub-derives umbrella SC-2C.10): Mechanical CI gate `scripts/check-adr-status-accepted.ts` exists con tests including integration-fixture test contra actual `docs/adr/052-signup-migration-admin-sdk-gate.md` content. **Robust to 3 coexisting Status formats** (per DA v2 G-01 finding — `**Status**:`, `- **Status**:`, `**Estado**:`). Gate WIRED to GitHub Actions workflow with path-filter targeting Sprint 2c-B paths (NOT 2c-A paths). 2c-A code lands without ADR-052 Accepted dependency.
- [ ] **SC-2C.A.6**: Firebase emulator integration test (`firebase emulators:start --only auth,functions`) suite passes end-to-end + baseline measurement script outputs p50/p95/p99 metrics with p95 < 1500 ms in initial measurement. Per DA v2 G-04 + umbrella OQ-2C-2 resolution.

## 4. User-visible behaviour delta

Sprint 2c-A is code-only. **Zero user-visible change** to web app or API runtime behaviour. Handler ships to `main` but is not deployed; Identity Platform sigue config actual sin `blocking_functions.triggers.beforeCreate`. End users behavior unchanged.

## 5. Out of scope (Sprint 2c-A)

Everything listed in umbrella §5 PLUS the following items deferred to Sprint 2c-B:

- Cloud Function Gen 1 Terraform infra deployment (`infrastructure/auth-blocking-functions.tf`).
- Cloud Build deploy steps (`cloudbuild.production.yaml` modifications).
- Identity Platform `blocking_functions.triggers.beforeCreate` wire (`infrastructure/identity-platform.tf` modify).
- apps/web `translateAuthError` extension (depends on real Firebase SDK response which only exists post-wire).
- Ghost user inventory CSV generation (script exists in 2c-A; execution is 2c-B operational task).
- Smoke E2E manual testing (requires deployed function).
- 7-day watch + SC-2C.8 closure (post-wire monitoring).
- ADR-NNN Status flip Proposed → Accepted (post-7d-watch).

## 6. Constraints (delta from umbrella §6)

Same as umbrella C1-C14 EXCEPT:

- **C13** (ADR-052 Accepted pre-condition): **NOT applicable a Sprint 2c-A** since 2c-A no toca paths que el CI gate guarda (`infrastructure/auth-blocking-functions.tf`, `infrastructure/identity-platform.tf` blocking_functions, `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` deploy). The CI gate path-filter applies **only to Sprint 2c-B paths**.
- **C14 redefined**: mechanical CI gate fires on PRs touching Sprint 2c-B paths specifically (Cloud Function infra + IdP wire). Sprint 2c-A paths (`apps/auth-blocking-functions/src/**`, `apps/auth-blocking-functions/test/**`) are NOT gated.

## 7. Approach (sub-sprint scope)

Inherit umbrella §7.1 architecture diagram + §7.2 components subset 1, 2, 6:

- Component 1 (apps/auth-blocking-functions/) — full implementation.
- Component 2 (inventory-google-ghost-users.ts) — script + tests; no execution.
- Component 6 (check-adr-status-accepted.ts + workflow) — implementation + tests + path-filter wiring.

**NOT in 2c-A**: components 3, 4, 5, 7, 8, 9 (deploy infra, IdP wire, Cloud Build, apps/web, ADR-NNN, runbook).

## 8. Alternatives considered (delta)

Same as umbrella §8 + sub-sprint-specific:

- **2c-A-Alt-I**: Skip handler tests + ship infrastructure-first → **Rejected**: 2c-B prod deploy of an untested handler violates CLAUDE.md "Cero deuda day 0" + spec §6 C9 coverage.
- **2c-A-Alt-II**: Merge all handler files in single mega-PR → **Rejected**: violates agent-rigor "atomic vertical slices ≤100 LOC" + Sprint 2b precedent of 9-12 small PRs.

## 9. Risks (delta from umbrella §9)

Same as umbrella R-2C-1..13, with 2c-A-specific risk:

- **R-2C-A-1**: Sprint 2c-A ships handler to main but 2c-B may be delayed indefinitely (ADR-052 Accepted timeline depends on Sprint-2b T13 canary deploy + user availability). Handler code in main is **idle technical debt** during the gap. **Likelihood M, Impact L**. Mitigation: handler is pure additive (new app, no consumers); no harm en main. Document in CURRENT.md that handler is "shipped but not deployed".

## 10. Test list (sub-sprint scope)

Subset of umbrella §10 reachable in 2c-A:

- **T1**: SC-2C.2 happy negative (unit, mock DB empty).
- **T2**: SC-2C.3 happy positive (unit, mock DB approved).
- **T3**: SC-2C.5 fail-closed (unit, mock DB throw).
- **T4**: provider passthrough (unit).
- **T5**: email normalize 20+ variants (unit).
- **T6**: email missing fail-closed (unit).
- **T7**: estado != aprobado (unit).
- **T8**: Firebase emulator integration (REQUIRED, NOT stretch).
- **T10**: race-documents-invariant + Admin SDK no-impact (integration).
- **T12**: race-documents-invariant detailed (3 sub-scenarios incl. pg_sleep fault-injection optional).
- **T13**: Admin SDK approveSignupRequest no-impact (integration).
- **T14**: Ghost user inventory script unit + integration tests.
- **T15**: CI gate fixture tests (including integration test contra actual ADR-052 file).

**NOT in 2c-A**: T9 (Identity Platform config curl post-apply), T11 (production perf smoke).

## 11. Rollout (sub-sprint scope)

- **Feature-flagged?**: No. Sprint 2c-A is pure code-in-main; no runtime activation.
- **Migration needed?**: No. Function not yet wired to IdP.
- **Rollback plan**: revert PR(s). Zero prod impact.
- **Monitoring**: standard CI/test signals. No production monitoring needed (function not deployed).
- **Gate explícito para `/build`**:
  - 2c-A spec approved.
  - 2c-A plan drafted + DA-passed + user-approved.
  - **NO** dependency on ADR-052 Accepted (per C13 redefined).

## 12. Open questions

Inherited from umbrella OQ-2C-1..9 resolved (see `oq-research.md`). Plus 2c-A-specific:

- **OQ-2C-A-1**: ¿Firebase emulator setup overhead en CI < 30s? Resolución affects T8 CI integration vs manual pre-merge corrida.

## 13. Decision log

- **2026-05-26 23:50Z** — Sprint 2c-A spec created post-split per G-14 PO decision. Inherits umbrella context; enumerates code-only scope. Status: Draft awaiting plan + approval next session.
