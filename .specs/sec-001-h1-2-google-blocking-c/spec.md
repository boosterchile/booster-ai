# Spec: sec-001-h1-2-google-blocking-c (Sprint 2c-C — Gen 1 → Gen 2 migration of the auth-blocking-function)

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-29
- **Status**: **SUPERSEDED (2026-05-29)** by [`.specs/sec-001-h1-2-google-boundary-closure/spec.md`](../sec-001-h1-2-google-boundary-closure/spec.md). PO chose Alternative G (API-boundary enforcement + inert-account reaper) over the Gen 2 blocking-function migration, after the handler was verified deny-pure and the ADR-001 boundary was found to already enforce the admission invariant (404 `user_not_registered`). See [`alt-d-vs-g-comparison.md`](./alt-d-vs-g-comparison.md). This Gen 2 migration is NOT pursued; retained as audit trail.
- **Linked**:
  - Umbrella spec: [`.specs/sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md) (Approved v2 split)
  - Sub-spec 2c-A: [`.specs/sec-001-h1-2-google-blocking-a/spec.md`](../sec-001-h1-2-google-blocking-a/spec.md) (handler — **superseded by this spec for the Gen 2 surface**)
  - Sub-spec 2c-B: [`.specs/sec-001-h1-2-google-blocking-b/spec.md`](../sec-001-h1-2-google-blocking-b/spec.md) (deployment — **BLOCKED at T8**; resumes on Gen 2 after this migration)
  - ADR-054: [`docs/adr/054-google-blocking-function-signup-gate.md`](../../docs/adr/054-google-blocking-function-signup-gate.md) (Proposed; **requires amendment**, see §7)
  - Parent: [`.specs/sec-001-cierre/spec.md`](../sec-001-cierre/spec.md) §3 SC-1.2.2 Google leg = `TRACKED_RESIDUAL`
  - Blocker evidence: [`.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T8-step1-gen1-builds-blocked.md`](../sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T8-step1-gen1-builds-blocked.md)
  - **DEFINE-phase spike**: [`oq-research.md`](./oq-research.md) (resolves the Gen 2 wiring question before approval)
  - Prior research: [`docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`](../../docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md) (**conclusion corrected by this spike — see oq-research.md OQ-2C-C-1**)

## Relationship to prior sub-sprints

Sprint 2c-A shipped the handler (`apps/auth-blocking-functions/`) and Sprint 2c-B shipped the deployment infra (`infrastructure/auth-blocking-functions.tf`, cloudbuild steps, IdP wire, monitoring) — **both architected for Cloud Function Gen 1** via `gcip-cloud-functions` + Terraform `function_uri`. Sprint 2c-B T8 (the production deploy) is **BLOCKED**: Gen 1 builds fail systemically (6 attempts, `code=13` "Build error details not available") because Cloud Functions Gen 1 is in active deprecation (Node.js 20 runtime deprecated for Gen 1 as of 2026-04-30). The PO chose Option A (Gen 2 migration) in the T8 blocker evidence doc.

This sub-spec converts the handler + infra from Gen 1 to Gen 2, **preserving the existing Terraform `function_uri` wiring mechanism and the `auth/internal-error` web error contract** (both empirically confirmed compatible with Gen 2 — see `oq-research.md`). After 2c-C ships, Sprint 2c-B's remaining tasks (deploy verification, smoke E2E, 7-day watch, ADR Status flip) resume **on the Gen 2 artifact**.

## 1. Objective

Migrate the `beforeCreate` Identity Platform blocking function from Cloud Functions **Gen 1** (`gcip-cloud-functions` library) to **Gen 2** (`firebase-functions/v2/identity` `beforeUserCreated`, deployed as a `google_cloudfunctions2_function` and wired via the existing Terraform `function_uri` field), preserving the admin-approval gate behaviour and the client error contract exactly. This unblocks production deployment of the Google federated-signup gate — otherwise dead on a deprecated runtime — and lets SEC-001 H1.2 SC-1.2.2 (Google leg) progress from `TRACKED_RESIDUAL` toward `MET`.

## 2. Why now

Sprint 2c-B T8 surfaced (2026-05-29) that Cloud Functions Gen 1 builds fail unconditionally in `booster-ai-494222`/`us-east1` — bare hello-world source fails identically to real source, confirming a project/service-level cause consistent with Gen 1 deprecation, not a content bug. The Google self-signup residual stays OPEN until this gate is live in prod. Gen 1 is a permanent dead-end (deprecation is not reversible), so a support ticket or retry (Options B/C) only delay an inevitable migration. The DEFINE-phase spike (`oq-research.md`, 2026-05-29) **empirically confirmed** that a Gen 2 function wires into Identity Platform through the same Terraform `function_uri` field already in use (`function_uri = google_cloudfunctions2_function.…service_config[0].uri`, working example dated 2026-02), and that the v2 error contract is **identical** to Gen 1 (`auth/internal-error` + message substring). The migration therefore preserves IaC discipline and the web error path, and is smaller than initially feared.

## 3. Success criteria

- [ ] **SC-2C.C.1**: Handler (`apps/auth-blocking-functions/src/handler.ts` + `src/index.ts`) imports `firebase-functions/v2/identity` `beforeUserCreated` and no longer references `gcip-cloud-functions`; the package is removed from `package.json`.
- [ ] **SC-2C.C.2**: The admin-approval **gate decision** is invariant — for identical inputs, the allow/block outcome is unchanged: non-Google provider → passthrough; missing email → reject; `solicitudes_registro` lookup `LOWER(email)=$1 AND estado='aprobado'`; DB error → fail-closed reject; `rowCount===0` → blocked; `rowCount>=1` → allowed. PII redaction (SHA-256 `emailHashed`, no plaintext email in logs) unchanged. The v1→v2 input remap (`user`→`event.data`, `context.eventId`→`event.eventId`, `context.ipAddress`→`event.ipAddress`) is the only handler change. Verified by the existing unit tests adapted to the v2 event shape, all passing.
- [ ] **SC-2C.C.3**: `BLOCKED_SIGNUP_PENDING_APPROVAL` literal preserved and the T-LITERALS cross-source test (handler ↔ `apps/web/.../translate-auth-error.ts`) passes **unchanged** (the v2 error contract is preserved per `oq-research.md` OQ-2C-C-6).
- [ ] **SC-2C.C.4**: Coverage on changed `apps/auth-blocking-functions` code ≥ 80% (lines, branches, functions) per CLAUDE.md.
- [ ] **SC-2C.C.5**: The Gen 2 function deploys to `booster-ai-494222` and the IdP blocking trigger is registered AND **demonstrably fires in a non-emulator environment** — verified by a post-deploy config read (`curl Admin API config | jq '.blockingFunctions'` shows the Gen 2 `service_config` URI) PLUS at least one real `beforeUserCreated` invocation observed in logs (the smoke E2E of SC-2C.C.9 satisfies this). The Firebase-emulator integration test is a floor, not the bar.
- [ ] **SC-2C.C.6**: The v2 client error contract is **confirmed equal** to Gen 1 (`auth/internal-error` + `BLOCKED_SIGNUP_PENDING_APPROVAL` substring) by observing the actual `signInWithPopup` rejection in the negative smoke E2E; result recorded in `sprint-2c-c-evidence/error-contract.md`. If — contrary to `oq-research.md` — the contract differs, `translate-auth-error.ts` is updated and the deviation documented.
- [ ] **SC-2C.C.7**: IaC ownership is **preserved** — the Gen 2 function and its IdP `function_uri` wire are Terraform-owned (`google_cloudfunctions2_function` + `google_identity_platform_config.blocking_functions`). If `/plan`'s implementation spike (OQ residual in `oq-research.md`) finds the chosen handler wrapper cannot be Terraform-wired, that is a **hard stop → escalate to PO** (do not silently move to `firebase deploy`).
- [ ] **SC-2C.C.8**: ADR-054 is amended (not superseded — still `Proposed`) to record the Gen 1 → Gen 2 reversal, citing the T8 build-failure evidence + the `oq-research.md` re-verification. `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md` is corrected (Gen-2 viable via Terraform `function_uri`; the prior "Gen 1 only" was over-broad).
- [ ] **SC-2C.C.9**: Smoke E2E executed — negative (unapproved Google account → blocked, translated message) + positive (approved Booster-domain corporate account → succeeds), per 2c-B SC-2C.B.2/B.3 (corporate domain, not `@gmail.com`, to avoid permanent PII in audit logs).
- [ ] **SC-2C.C.10**: Gen 1 tainted Terraform state (`google_cloudfunctions_function.before_create`) + the partial GCP function + the Gen 1 placeholder artifact are cleaned up with zero collateral destroys, verified by `terraform plan` showing no unexpected deletions.
- [ ] **SC-2C.C.11**: `cloudbuild.production.yaml` auth-blocking deploy lane is updated for Gen 2 (`--gen2`), preserving the `_AUTH_BLOCKING_DEPLOY` gate (default `false`) and the post-deploy `describe`/verify gate from T3-fix. (Opportunistic: resolve the `_AUTH_BLOCKING_DEPLOY` strict-match brittleness — `.specs/_followups/cloudbuild-substitution-canonicalization.md` Item 1 — while this lane is open; Option B recommended there. In-scope only if it stays within the lane edit; otherwise track forward.)

## 4. User-visible behaviour

No change relative to the behaviour Sprint 2c-B intended (none of which is live yet — deploy is blocked). After 2c-C ships and the trigger is wired:

- **BEFORE** (current prod): no gate. A new Google account can self-signup and create a Firebase user (residual OPEN; bounded by downstream membership checks).
- **AFTER**: new Google account with no matching `solicitudes_registro.estado='aprobado'` → `signInWithPopup` fails as `auth/internal-error`; the web UI shows the translated `BLOCKED_SIGNUP_PENDING_APPROVAL` message (same contract as Gen 1). Approved Google account → signup succeeds. Existing pre-migration users → unaffected (`beforeUserCreated` fires only on creation).

## 5. Out of scope

- The Sprint 2c-B 7-day watch and ADR-054 `Accepted` flip — those **resume** on the Gen 2 artifact after this migration; 2c-C delivers a deployable+wired Gen 2 function, not the post-launch close.
- Ghost-user inventory execution (already done in 2c-A/2c-B; CSV in `sprint-2c-b-evidence/`).
- Any change to the admin-approval gate *logic* or the `solicitudes_registro` schema.
- The email/password leg (already OFF via Sprint 2b Terraform `disabled_user_signup=true`).
- SEC-001 H1.5 (forensics) and H1.6 (demo reactivation).
- Migrating any *other* Cloud Function to Gen 2 (none exist; this is the only blocking function).

## 6. Constraints

Inherits umbrella C1–C15 with these deltas:

- **C-2C-C-1** (behaviour preservation): runtime/wiring change only. Gate decision logic, fail-closed semantics, PII redaction, and the client error contract MUST NOT change. Any observable change beyond the SDK import + event-field remap is a defect.
- **C-2C-C-2** (region): Gen 2 blocking function deploys to a region IdP accepts for blocking triggers; default `us-east1` (rest of Booster prod) unless the `/plan` region check (OQ-2C-C-3) forbids it.
- **C-2C-C-3** (error contract preserved): the web error translation relies on `auth/internal-error` + message substring; `oq-research.md` confirms v2 preserves this. SC-2C.C.6 re-confirms empirically; no rewrite expected.
- **C-2C-C-4** (IaC discipline): CLAUDE.md mandates "infrastructure/ Terraform 100% IaC". The Gen 2 trigger MUST stay Terraform-owned (confirmed feasible via `function_uri` = Gen 2 `service_config[0].uri`). Moving registration out of Terraform is **not permitted without explicit PO escalation** (SC-2C.C.7).
- **C-2C-C-5** (blocking SLA): IdP blocking call < 7s or signup fails opaquely. DB connection-pool warm + internal timeout + fail-closed log preserved from 2c-A.
- **C-2C-C-6** (mechanical CI gate): the `_AUTH_BLOCKING_DEPLOY` gate + ADR-status gate path-filters update to the Gen 2 paths, not silently dropped.
- **C-2C-C-7** (cooling-off): solo-dev REVIEW/SHIP cooling-off applies; no waiver pre-authorised.

## 7. Approach

Re-use umbrella §7 architecture; the delta is generation + SDK, with wiring mechanism and error contract **unchanged**.

1. **Handler (`src/handler.ts`, `src/index.ts`)** — replace `gcip-cloud-functions` `auth.functions().beforeCreateHandler(cb)` with `firebase-functions/v2/identity` `beforeUserCreated((event) => …)`. Remap inputs per `oq-research.md` OQ-2C-C-2: `user`→`event.data`, `context.eventId`→`event.eventId`, `context.ipAddress`→`event.ipAddress`. Throw `HttpsError` from the v2 module. Preserve `BLOCKED_SIGNUP_PENDING_APPROVAL`, the DB query, fail-closed branches, and SHA-256 PII hashing verbatim.
2. **package.json** — drop `gcip-cloud-functions`; keep `firebase-functions@^6.6.0` (already installed) + `firebase-admin`. Adjust build/bundling for the Gen 2 deploy.
3. **Infra (`infrastructure/auth-blocking-functions.tf`)** — replace `google_cloudfunctions_function.before_create` with `google_cloudfunctions2_function`; carry the SA invoker IAM + the `gcf-sources` storage.objectViewer grant (Gen 2 build SA needs equivalent — verify exact SA at /plan). Preserve the placeholder-source-then-Cloud-Build-deploy lifecycle pattern.
4. **Wire (`infrastructure/identity-platform.tf`)** — change `function_uri = google_cloudfunctions_function.before_create.https_trigger_url` → `google_cloudfunctions2_function.before_create.service_config[0].uri`. Keep the `blocking_functions` block Terraform-owned (per `oq-research.md` OQ-2C-C-1). Update the inline comment that currently asserts "Gen 1 only".
5. **cloudbuild.production.yaml** — convert `deploy-auth-blocking` from `gcloud functions deploy --no-gen2` to `--gen2`, keeping the `_AUTH_BLOCKING_DEPLOY` gate + the `describe`/verify gate. Update the "Gen 1 only" comments.
6. **Web error translation** — expected unchanged (contract preserved); SC-2C.C.6 confirms.
7. **ADR-054 amendment** + lessons-learned correction (SC-2C.C.8).
8. **Tainted-state cleanup** (SC-2C.C.10) — `terraform state rm` + gcloud delete of the partial Gen 1 function, sequenced so no other resource is destroyed.
9. **Tests** — adapt `handler.test.ts` + `firebase-emulator.test.ts` to the v2 shape; keep T-LITERALS + admin-sdk-no-impact regressions.

**Atomic deploy** (inherits 2c-B DA G-03 fix): deploy + verify (function exists Gen 2 + trigger registered) as a gated sequence; rollback documented if verification fails.

**Task sequencing for `/plan`** (per DA P1-4): the handler+package+tests rewrite (steps 1-2, 9) is independent of and lower-risk than the infra/wiring/cloudbuild work, has no prod impact, and is mergeable immediately (mirrors the 2c-A code-only pattern). `/plan` SHOULD make it the first task(s) and gate the infra/wire/deploy tasks behind it. Whether to split 2c-C into two sub-specs is deferred to `/plan`; the spike having resolved the architecture removes the fragility that would otherwise force a split.

## 8. Alternatives considered

- **A. Migrate to Gen 2 via `firebase-functions/v2/identity`, Terraform-wired** — **Chosen.** Only forward path on a supported runtime; empirically re-verified viable with IaC + error contract preserved (`oq-research.md`).
- **B. GCP support ticket to fix Gen 1 builds** — Rejected: even if restored short-term, Gen 1 + Node 20 is deprecated; buys weeks and re-incurs the migration. Unknown ETA blocks the residual indefinitely.
- **C. Wait + retry Gen 1** — Rejected: failure is consistent across bare hello-world and real source over 6 attempts; deprecation is not transient.
- **D. Remove the Google provider entirely (`signInWithPopup` out of the web app)** — Rejected as primary: a product decision forcing Google-account users onto email/password, discarding working UX. Retained as contingency only if SC-2C.C.7's hard stop trips.
- **E. Keep the Gen 1 handler, swap only Terraform to `google_cloudfunctions2_function`** — Rejected: `gcip-cloud-functions` is Gen-1-only; the SDK import has no v2 runtime path. Handler must change.
- **F. Pin Gen 1 to a different runtime (Node 22)** — Rejected (per DA P2-1): the T8 evidence shows bare hello-world Gen 1 also failed `code=13`, pointing to a service/generation-level cause, not a Node-20-specific one; and Node 22 on Gen 1 remains on the Gen 1 deprecation track, so it is a dead-end even if it built. (If trivially cheap to confirm during the /plan spike, do so to close the door explicitly.)
- **G. Non-blocking-function gate — server-side post-OAuth check at the `apps/api` boundary before issuing the app session** (mirroring the email/password Admin SDK leg, ADR-052) — Rejected: it does not prevent Identity Platform from creating the Firebase user on first Google login, leaving tenant bloat + audit-log noise (the same structural objection as ADR-054 Alt-B/custom-claims-only). A blocking function is the only path that stops creation pre-persistence. Documented here for completeness.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R-2C-C-1**: The `firebase-functions/v2/identity` wrapper, deployed via gcloud/Cloud Build (not `firebase deploy`), does not register/fire when wired via `function_uri` | L–M | M | `oq-research.md` confirms the `function_uri`+Gen2 path works; residual is the wrapper-vs-raw-handler detail. /plan spike confirms before infra; fallback = raw Gen 2 HTTP handler validating the IdP JWT (still Terraform-wired). |
| **R-2C-C-2**: Region constraint differs from Gen 1 `us-east1`; wrong region → trigger never fires | L | M | OQ-2C-C-3 region check at /plan before infra; SC-2C.C.5 non-emulator verification catches a silent miss before prod close. |
| **R-2C-C-3**: Tainted Gen 1 state cleanup destroys collateral (bucket, IAM, SA) | L | H | Targeted `state rm` + reviewed `terraform plan`; SC-2C.C.10 asserts no unexpected deletes. |
| **R-2C-C-4**: Gen 2 cold-start > 7s blocking SLA at `min_instances=0` → opaque signup failures | M | M | Carry 2c-B contingency (bump `min_instances=1` post-baseline); baseline measured before close. |
| **R-2C-C-5**: Gen 2 build SA differs from the Gen 1 `compute@` SA already granted `storage.objectViewer`; build fails on permissions | M | M | Verify the Gen 2 build SA at /plan; grant the equivalent role in Terraform; the T8 evidence already shows the Gen 1 `gcf-sources` pattern to mirror. |
| **R-2C-C-6**: `db.ts` `pg` pool + `DATABASE_URL` secret init differs under the Gen 2 Cloud Run runtime | L | M | OQ-2C-C-5 confirm at /plan; the pool is plain `pg` over a secret env var — runtime-agnostic, low risk. |

(R-2C-C-1 and the IaC-deviation/error-contract risks from spec v1 were **resolved** by the DEFINE spike and downgraded; see `oq-research.md`. The amendment-escalation concern is resolved: 2c-C is a **new sub-spec with full cycle artifacts**, the path explicitly endorsed by `.specs/_followups/cloudbuild-substitution-canonicalization.md` Item 2(b); the "third amendment blocked" rule governs plan-amendments, which this is not.)

## 10. Test list

- **T1**: Handler unit — non-Google provider → `{}` passthrough (v2 event shape).
- **T2**: Handler unit — Google + missing email → `HttpsError invalid-argument`.
- **T3**: Handler unit — Google + approved row → allowed, logs `signup.allowed.google`, no plaintext email.
- **T4**: Handler unit — Google + no approved row → `HttpsError permission-denied` + `signup.blocked.google`.
- **T5**: Handler unit — DB throws → fail-closed `HttpsError internal` + `signup.gate.db_error`.
- **T6**: Email normalize + SHA-256 hash unchanged (regression on existing `email-normalize.test.ts`).
- **T7**: T-LITERALS cross-source — handler literal == `translate-auth-error.ts` literal (unchanged under v2).
- **T8**: Firebase emulator integration — `beforeUserCreated` v2 trigger fires and blocks/allows correctly.
- **T9**: Admin-SDK-no-impact regression — server-side `createUser` still bypasses the blocking function under v2.
- **T10**: Terraform `plan` — Gen 1→Gen 2 resource swap + tainted cleanup shows no unexpected destroys (SC-2C.C.10).
- **T11**: Post-deploy verification — function exists as Gen 2 + trigger registered (Admin API config read, SC-2C.C.5).
- **T12**: Error-contract confirmation — negative smoke E2E observes `auth/internal-error` + substring; record in evidence (SC-2C.C.6).
- **T13**: Smoke E2E manual — negative + positive per SC-2C.C.9.

## 11. Rollout

- **Feature-flagged?**: No code-level flag. Trigger wire/unwire (Terraform `blocking_functions` block) is the operational toggle.
- **Migration needed?**: Terraform Gen 1 → Gen 2 resource swap + tainted-state cleanup (SC-2C.C.10). No DB migration.
- **Rollback plan**:
  1. Unwire trigger: Admin API `PATCH config` with empty `blockingFunctions` (5-min undo).
  2. Revert the wire commit + apply.
  3. `terraform destroy -target` the Gen 2 function.
  4. Residual returns to its pre-2c-C OPEN-but-bounded state (downstream membership checks still gate role assignment) — no worse than today.
- **Monitoring**: reuse the Sprint 2c-B monitoring infra (p95 alert, `signup.blocked.google` counter, 3-sigma anomaly). The 7-day watch + ADR-054 `Accepted` flip happen in the resumed 2c-B close, not here.
- **Gate for `/build`**: OQ-2C-C-3/C-5 resolved at /plan (region + Gen 2 build SA); ADR-052 already `Accepted` (email/password leg stable); handler-first sequencing decided in /plan.

## 12. Open questions

- **OQ-2C-C-1 (BLOCKING — architecture not yet proven)** — Does the Terraform `function_uri` field accept a Gen 2 `service_config[0].uri` for `event_type=beforeCreate` AND does the function actually fire when deployed via Booster's Cloud Build `--gen2` path? `oq-research.md` (post DA round 2) downgrades this to **PLAUSIBLE / leans-YES / UNVERIFIED**: issue #258 practitioners report Gen 2 blocking functions DO fire (the console-listing is the only confirmed-broken part), but nobody has confirmed `beforeCreate` + the Cloud Build deploy path, and the original "function deleted/no longer exists" failure mode exists in the record. **Dispositive test = deploy + wire + observe one real invocation** (mutates prod IdP config; no staging project). This must be settled before the migration scope is committed.
- **OQ-2C-C-6 (BLOCKING-adjacent)** — Does the v2 wrapper propagate the `BLOCKED_SIGNUP_PENDING_APPROVAL` substring verbatim in the client `message`? CODE (`auth/internal-error`) confirmed; substring survival UNVERIFIED → silent-break risk in `translate-auth-error.ts:44` if it differs. Pin in the same spike, before prod wire.
- **OQ-2C-C-2** — v2 event field mapping — **RESOLVED** (`oq-research.md`): `event.data` / `event.eventId` / `event.ipAddress`.
- **OQ-2C-C-3** (open, /plan): exact Gen 2 region(s) IdP blocking accepts; default `us-east1`.
- **OQ-2C-C-4** (open, /plan): `min_instances` `0` vs `1` post-baseline under Gen 2.
- **OQ-2C-C-5** (open, /plan): `pg` pool + `DATABASE_URL` secret init under the Gen 2 runtime; the Gen 2 build SA for the `storage.objectViewer` grant (R-2C-C-5).

## 13. Decision log

- **2026-05-29** — Initial draft (v1). Created as a new sub-spec (2c-C) per PO decision 2026-05-29 (rather than amending 2c-B), because the migration re-opens handler code 2c-B placed out of scope.
- **2026-05-29** — Devils-advocate pass on v1: **DO_NOT_APPROVE** with 3 P0 (false Gen2-wiring dichotomy; decisive question deferred to post-approval; "byte-for-byte" ⨯ error-contract-change contradiction). Response: ran an empirical spike **in DEFINE** → `oq-research.md`; spec rewritten to v2 (removed dichotomy, reworded SC-2C.C.2, non-emulator verification, IaC hard-stop, Alternatives F+G, escalation-clause citation, handler-first sequencing).
- **2026-05-29** — Devils-advocate pass on v2: **DO_NOT_APPROVE** (2 P0). Caught that the v1-spike over-claimed: re-pull of the primary source (issue #258) shows the Gen2-via-`function_uri` evidence is mixed and the "RESOLVED: YES" was the mirror of the "documented but not verified" failure mode. `oq-research.md` corrected — OQ-2C-C-1 downgraded to **PLAUSIBLE/leans-YES/UNVERIFIED**; the real load-bearing unknowns (`beforeCreate` event + Cloud Build `--gen2` deploy firing through `function_uri`; v2 message-substring survival) require a **deploy-and-observe spike that mutates prod IdP config**. Also pinned the actual web match key (`translate-auth-error.ts:44` keys on the custom `BLOCKED_SIGNUP_PENDING_APPROVAL` substring, not `"Cloud Function"`). **Status: Draft — NOT ready for approval.** Decision escalated to PO: (a) approve as a gated spike-first spec with the deploy-proof as task 1 and Alternative D co-primary until it fires, or (b) run the prod deploy-spike now with explicit authorization. Pending PO direction.
