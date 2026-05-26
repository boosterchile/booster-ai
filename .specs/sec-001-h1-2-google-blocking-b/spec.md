# Spec: sec-001-h1-2-google-blocking-b (Sprint 2c-B — deployment + wire + 7d watch + ADR Accepted)

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-26 (sub-spec post-split per G-14)
- **Status**: Draft
- **Scope**: Sub-sprint B. Deployment of 2c-A handler + Identity Platform wire + smoke E2E + ghost inventory execution + 7-day watch + ADR-NNN Status flip. **Prod impact via terraform apply**.

## Relationship to umbrella spec + Sprint 2c-A

This sub-spec depends on Sprint 2c-A merged + inherits shared context from umbrella:

- [`.specs/sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md) — umbrella (Approved v2 split).
- [`.specs/sec-001-h1-2-google-blocking/oq-research.md`](../sec-001-h1-2-google-blocking/oq-research.md) — empirical research.
- [`.specs/sec-001-h1-2-google-blocking/plan-review.md`](../sec-001-h1-2-google-blocking/plan-review.md) — DA findings to address.
- [`.specs/sec-001-h1-2-google-blocking-a/spec.md`](../sec-001-h1-2-google-blocking-a/spec.md) — Sprint 2c-A (handler implementation; **prerequisite**).

## 1. Objective (sub-sprint scope)

Deploy the Cloud Function Gen 1 handler shipped en Sprint 2c-A to production GCP project `booster-ai-494222`. Wire `blocking_functions.triggers.beforeCreate` en Identity Platform. Execute ghost user inventory + record PO cleanup decision. Smoke E2E manual con cuentas de prueba ad-hoc + corporate. Monitor 7 days. Flip ADR-NNN Status Proposed → Accepted. Transition parent `sec-001-cierre/spec.md` §3 SC-1.2.2 amendment A3 `TRACKED_RESIDUAL` → `MET`. **End of SEC-001 H1.2 closure**.

## 2. Why now (delta from umbrella §2)

Same drivers as umbrella §2 + Sprint 2c-A delivered + ADR-052 Status flip Accepted means email/password leg stable + deploy window viable.

## 3. Success criteria (sub-sprint scope)

Subset of umbrella §3 SCs reachable via deployment + verification:

- [ ] **SC-2C.B.1** (umbrella SC-2C.1): Identity Platform config prod tiene `blocking_functions.triggers.beforeCreate` apuntando a deployed Cloud Function Gen 1. Verificable via `curl Admin API config | jq '.blockingFunctions'`.
- [ ] **SC-2C.B.2** (umbrella SC-2C.2): Negative smoke E2E — cuenta Google ad-hoc sin matching aprobado → `signInWithPopup` fails con `auth/internal-error` + UI muestra mensaje traducido.
- [ ] **SC-2C.B.3** (umbrella SC-2C.3): Positive smoke E2E — cuenta Google **corporate Booster-domain** (per DA v2 G-06 finding: NO `@gmail.com` ad-hoc para positive case to avoid permanent PII en audit logs) con matching aprobado → signup succeeds.
- [ ] **SC-2C.B.4** (umbrella SC-2C.9): Ghost user inventory script EXECUTED contra prod Firebase Auth tenant → CSV generated → PO cleanup decision recorded en `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/po-cleanup-decision.md`.
- [ ] **SC-2C.B.5** (umbrella SC-2C.4 + DA v2 G-04 fix): Baseline measurement p95 < 1500 ms over **first 10 real invocations OR 7-day window post-`T-WIRE-PROD-APPLY`, whichever comes first** (preserves umbrella SC-2C.4 OR-clause that plan v2 dropped). At Booster's expected < 10 Google signups/month, 7-day window is typically the binding constraint.
- [ ] **SC-2C.B.6** (umbrella SC-2C.6): Numeric baseline established for `signup.blocked.google` rate post-launch. Alert threshold reajusta a `media + 3-sigma` documented en runbook.
- [ ] **SC-2C.B.7** (umbrella SC-2C.8): 7-day watch passed with `< 1 blocked Google signup/day promedio + 0 alert firings`. Parent spec SC-1.2.2 amendment A3 transitions `TRACKED_RESIDUAL` → `MET`. ADR-NNN Status flip Proposed → Accepted.
- [ ] **SC-2C.B.8** (NEW per DA v2 G-02 mechanical enforcement): CI gate `scripts/check-adr-status-accepted.ts` from 2c-A IS WIRED to Sprint 2c-B paths in branch protection. Gate fires on PRs that touch `apps/auth-blocking-functions/scripts/` deployment-related changes, `infrastructure/auth-blocking-functions.tf`, `infrastructure/identity-platform.tf` `blocking_functions` block, OR `cloudbuild.production.yaml` blocking-function deploy steps.
- [ ] **SC-2C.B.9** (NEW per DA v2 G-10 mechanical verification): Identity Platform SA email empirically verified via `gcloud iam service-accounts list` BEFORE `infrastructure/auth-blocking-functions.tf` apply. Result documented en `sprint-2c-b-evidence/sa-email-verification.txt`.
- [ ] **SC-2C.B.10** (NEW per DA v2 G-03 deploy gap): Cloud Build deploy step `deploy-auth-blocking` has explicit rollback documented if step fails post-terraform-apply. Includes `gcloud functions describe` verification step que asserts `sourceArchiveUrl` non-empty before allowing IdP wire.

## 4. User-visible behaviour delta

Post-Sprint-2c-B wire (NOT before):

- Cuenta Google nueva sin matching aprobado → error UI traducido.
- Cuenta Google aprobada → first signup succeeds.
- Cuenta Google existing pre-2c-B → unaffected (beforeCreate only fires on creation per umbrella OQ-2C-6 resolution).

## 5. Out of scope (Sprint 2c-B)

Everything listed in umbrella §5. Plus items handled in Sprint 2c-A:

- Handler code + tests (Sprint 2c-A).
- Ghost user inventory script implementation (2c-A); 2c-B handles execution.
- Mechanical CI gate script implementation (2c-A); 2c-B handles wiring path-filter to 2c-B paths.
- Firebase emulator integration test setup (2c-A).

## 6. Constraints (delta from umbrella §6)

Same as umbrella C1-C14 with these clarifications:

- **C13** (ADR-052 Accepted pre-condition): **ENFORCED FOR Sprint 2c-B**. The mechanical CI gate (C14) MUST fire on Sprint 2c-B PRs. Branch protection requires-check rule applied to Sprint 2c-B paths.
- **C14** (mechanical CI gate): path-filter targets Sprint 2c-B paths specifically:
  - `infrastructure/auth-blocking-functions.tf`
  - `infrastructure/identity-platform.tf` (when `blocking_functions` block touched)
  - `cloudbuild.production.yaml` (when blocking-function deploy steps touched)
  - `apps/auth-blocking-functions/scripts/` (when inventory execution scripts run)
- **C15** (NEW per DA v2 G-10): Identity Platform SA email empirically verified pre-T6 apply.

## 7. Approach (sub-sprint scope)

Inherit umbrella §7.1 architecture diagram + §7.2 components subset 3, 4, 5, 7, 8, 9:

- Component 3 (`infrastructure/auth-blocking-functions.tf`) — function infra Terraform.
- Component 4 (`infrastructure/identity-platform.tf` modify) — wire.
- Component 5 (`cloudbuild.production.yaml` modify) — deploy steps with explicit rollback per DA v2 G-03.
- Component 7 (`apps/web/src/lib/api-errors.ts`) — translateAuthError extension.
- Component 8 (`docs/adr/NNN-google-blocking-function-signup-gate.md`) — ADR.
- Component 9 (`docs/qa/google-blocking-function-runbook.md`) — runbook.

**Atomic deploy pattern** (DA v2 G-03 fix): Terraform apply + Cloud Build deploy executed as sequential operations within single deployment window with explicit `gcloud functions describe` verification gate between them. If verification fails, automated rollback step destroys the function before IdP wire proceeds.

## 8. Alternatives considered (delta)

Same as umbrella §8 + sub-sprint-specific:

- **2c-B-Alt-I**: Ship 2c-B en single mega-PR including infra + wire + docs + runbook → **Rejected**: violates atomic vertical slices (~500+ LOC); Sprint 2b precedent of 7-step canary cloudbuild + Identity Platform apply demonstrates split is feasible.
- **2c-B-Alt-II**: Deploy function en staging first then promote → **Rejected**: Booster lacks staging GCP project (tracked separately as `#STAGING-ENV` backlog). Until staging exists, 2c-B is direct-to-prod with rollback documented.

## 9. Risks (delta from umbrella §9)

Same as umbrella R-2C-1..13 + 2c-B-specific:

- **R-2C-B-1** (per DA v2 G-03): Cloud Build deploy step fails after terraform apply → function exists in state without `sourceArchiveUrl`. **Mitigation**: SC-2C.B.10 mechanical verification + auto-rollback documented en runbook.
- **R-2C-B-2** (per DA v2 G-11): T9 emulator integration test honor-system CI coverage gap. **Mitigation**: 2c-B runbook requires PR author confirm emulator test ran locally before merge.
- **R-2C-B-3** (per DA v2 G-09): 7-day watch clock reset semantics — what if PO re-applies terraform between T7 and T14 → clock resets vs continues. **Mitigation**: `T-WIRE-PROD-APPLY` timestamp recorded once at first apply; subsequent re-applies don't reset clock unless explicit "rollback + re-wire" event documented. Documented en runbook §7d-watch-semantics.

## 10. Test list (sub-sprint scope)

Subset of umbrella §10 reachable in 2c-B:

- **T9 (umbrella)**: Identity Platform config gate post-apply curl verification.
- **T11 (umbrella)**: Production perf smoke (first 10 invocations OR 7-day window).
- **Smoke E2E manual**: negative + positive cases per SC-2C.B.2 + SC-2C.B.3.
- **SA email verification**: empirical gcloud call per SC-2C.B.9.
- **Atomic deploy verification**: `gcloud functions describe` post-terraform-apply + pre-IdP-wire.
- **CI gate path-filter test**: PR fixture toca solo 2c-B paths → check-adr-status-accepted fires + fails con Status: Proposed; flip Status: Accepted → passes. PR fixture toca solo 2c-A paths → gate NOT fires.

## 11. Rollout (sub-sprint scope)

- **Feature-flagged?**: No code-level flag. Wire/unwire via Identity Platform Admin API config (operational toggle).
- **Migration needed?**: SC-2C.B.4 ghost user inventory + PO cleanup decision pre-wire.
- **Rollback plan** (DA v2 G-03 + G-11 fixes):
  - **Step 1 (5-min undo)**: Identity Platform Admin API `PATCH /v2/projects/.../config` con `updateMask=blockingFunctions` body `{}`.
  - **Step 2 (Terraform revert)**: revert wire commit + apply.
  - **Step 3 (Function destroy)**: `terraform destroy -target=google_cloudfunctions_function.enforce_signup_approval`.
  - **Step 4 (Ghost user cleanup revert)**: if option (a) disable applied, restore via `auth.updateUser(uid, {disabled: false})` per CSV row.
- **Monitoring** (post-deploy 7 días):
  - Cloud Monitoring metric p95 alert.
  - Cloud Logging `signup.blocked.google` counter.
  - Anomaly 3-sigma alert.
  - Manual review 24h post-deploy.
  - 7-day post-launch metrics review for SC-2C.B.7 closure.
- **Gate explícito para `/build` Sprint 2c-B**:
  - 2c-A merged.
  - ADR-052 Status flip Accepted.
  - Mechanical CI gate operational (2c-A SC-2C.A.5 + 2c-B SC-2C.B.8).
  - Ghost user inventory script ready (2c-A SC-2C.A.4).
  - SA email empirically verified (2c-B SC-2C.B.9).
  - SIGNUP_REQUEST_FLOW_ACTIVATED flag flipped ON in staging.

## 12. Open questions

Inherited from umbrella OQ-2C-1..9 resolved (see `oq-research.md`). Plus 2c-B-specific:

- **OQ-2C-B-1**: ¿Qué Booster-domain cuenta corporate usar para positive smoke (SC-2C.B.3)? PO test cuenta `dev@boosterchile.com`? Verify availability + create matching `solicitudes_registro.aprobado` row pre-smoke.
- **OQ-2C-B-2**: ¿Cloud Functions Gen 1 `min_instances=0` vs `=1` decision post-baseline? Depend on T9 baseline measurement results del Sprint 2c-A.
- **OQ-2C-B-3**: ¿Identity Platform SA email exact pattern? Empirical verification via `gcloud iam service-accounts list --project=booster-ai-494222 | grep -i identitytoolkit` pre-T6 apply (SC-2C.B.9).

## 13. Decision log

- **2026-05-26 23:55Z** — Sprint 2c-B spec created post-split per G-14 PO decision. Inherits umbrella context + addresses DA v2 P0 findings (G-02 mechanical enforcement, G-03 atomic deploy, G-04 OR-clause restored, G-09 clock-reset semantics, G-10 SA empirical verification). Status: Draft awaiting Sprint 2c-A merge + plan + approval.
