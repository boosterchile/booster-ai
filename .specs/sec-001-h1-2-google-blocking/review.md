# Devils-advocate review — sec-001-h1-2-google-blocking — 2026-05-26T00:00:00Z

Reviewer: devils-advocate sub-agent (agent-rigor 0.2.0+).
Artifact reviewed: `.specs/sec-001-h1-2-google-blocking/spec.md` (Draft, 288 LOC, 2026-05-26).
Posture: assume wrong until each load-bearing claim survives challenge. No "looks good" verdict.

---

## Premise

- **Assumed**: that "Identity Platform Blocking Functions only accept Firebase Functions SDK Gen 2" (C3 + Alt-A rejection). The spec says this was "verified en docs Identity Platform 2026-05-26". I challenged this assumption against the actual Google docs and the result is the **opposite of what the spec asserts**.
  - Identity Platform Blocking Functions historically use the `gcip-cloud-functions` SDK as an **arbitrary HTTP endpoint** (npm package `gcip-cloud-functions`, official Identity Platform reference docs `cloud.google.com/identity-platform/docs/reference/gcip-cloud-functions`). HTTP arbitrary endpoint is the **idiomatic** Identity Platform path — NOT the Firebase Functions path.
  - There is a documented, open compatibility issue: **Identity Platform officially supports Gen 1 Cloud Functions only as blocking functions**. Gen 2 functions can be wired by URI in Terraform but Identity Platform UI / runtime reports "function deleted or no longer exists" errors (`GoogleCloudPlatform/iap-gcip-web-toolkit#258`).
  - This means C3 is **inverted**. The spec's load-bearing constraint that justifies a NEW app + NEW framework dep + NEW Cloud Function points 180° in the wrong direction.

- **Most painful if false**: this one. The architecture choice (Gen 2 `firebase-functions/v2/identity`) is built on a misread of the Identity Platform docs. If the team builds the Gen 2 function, deploys it, wires it via `function_uri` in `google_identity_platform_config.blocking_functions.triggers.beforeCreate`, and Identity Platform refuses to invoke it (or invokes it sometimes), the whole sprint ships a broken gate with **fail-open semantics** in the wedge case — exactly the residual we're trying to close. This is a **P0** finding.

- **Other assumptions taken for granted**:
  - That `event.data.providerData[0].providerId === 'google.com'` is reliable. For `beforeUserCreated` the **eventType** signals provider (e.g., `providers/cloud.auth.ui/eventTypes/user.beforeCreate:google`), not necessarily `providerData[0]`. Pseudocode in §7.2 step 2 relies on `providerData` array shape that may be empty on certain federation paths. **Untested.**
  - That `solicitudes_registro.email` is **stored** lowercase post-T8. Spec says "mismo pattern que T8 service" but T8 service code is not cited; if T8 only normalizes on input but trust-stores raw, R-2C-9 mitigation is broken at rest.
  - That Identity Platform Admin SDK `createUser` from T10 approve flow **does NOT** trigger `beforeUserCreated`. §7.4 says "Provider !== 'google.com' return early defense" — but this assumes Admin SDK calls fire the trigger with a non-google providerId. Per Firebase docs, Admin SDK `createUser` **does fire blocking functions** unless explicitly bypassed. If Admin SDK creates with no providerData, the handler will hit DB lookup and may reject T10-approved users. **Not validated.**

## Scope and second-order effects

- **Existing pre-Sprint-2c Google-signed-up users**: OQ-2C-6 raises this as an open question but does not block. The spec assumes `beforeUserCreated` only fires on creation, not subsequent sign-in. True per docs — BUT: any pre-existing Firebase user whose `solicitudes_registro` was never created (because they signed up Google directly pre-Sprint-2c) now lives in a "ghost" state. The spec says nothing about **cleanup of those ghosts**. They retain UIDs in Identity Platform that have no membership and no `solicitudes_registro` row → audit log noise persists indefinitely. The very thing §2 (Why now) calls "user huérfano que pollutea el tenant" is **already polluted** and Sprint 2c does not clean.

- **Admin SDK `createUser` from T10 approve flow**: see assumption above. If Admin SDK creates **do** trigger `beforeUserCreated`, then approve flow may race against the trigger and either (a) self-reject in a circular dependency (the approve service has inserted `estado=aprobado` row → handler allows; OK) or (b) timing window where approve service has not yet committed the row → handler rejects approve flow's own user creation. **No serialization guarantee documented.**

- **Web app `translateAuthError` extension** (Component 5): spec assumes Firebase Web SDK exposes the `HttpsError.message` "BLOCKED_SIGNUP_PENDING_APPROVAL" to the client. OQ-2C-4 acknowledges this is unknown. If Firebase sanitizes the message (it does, in some versions, returning only the code), the entire frontend UX of "muestra mensaje específico" collapses to a generic `auth/internal-error` — confusing legitimate approved users who hit an unrelated transient error. The spec does not enumerate an A/B contingency.

- **Cloud Run / Cloud Functions Gen 2 split-brain**: spec mixes terminology. §7.2 says "Cloud Functions Gen 2 uses buildpacks", §6 C2/C3/C4 use both `cloudfunctions2_function` and "Cloud Function Gen 2". Gen 2 functions on GCP are **actually Cloud Run services under the hood** with a thin Functions API. This matters because IAM, networking, and billing all flow through Cloud Run primitives. The spec collapses two abstraction layers and may surprise an operator looking for `gcloud functions describe` output.

- **VPC connector capacity**: §6 C4 "Reusa `google_vpc_access_connector.serverless` existing". Adding another consumer to the existing connector raises egress baseline. No estimate of how many concurrent Blocking Function invocations the connector tolerates vs current consumers (apps/api, telemetry-processor, etc.). Hyrum's-Law-adjacent: someone already depends on the connector's idle headroom.

## Alternatives discarded

- **Considered (in spec §8)**: A (HTTP arbitrary), B (eliminate Google), C (downstream membership), D (custom OAuth), E (defer indefinitely).

- **Not considered (should have been)**:
  - **Gen 1 Cloud Function with `gcip-cloud-functions` SDK** — this is the documented, supported path per Identity Platform reference docs. Spec dismisses HTTP arbitrary (Alt-A) **without distinguishing** between "arbitrary HTTP server" (clearly unsupported) and "Cloud Function Gen 1 HTTP trigger using `gcip-cloud-functions` library" (supported and idiomatic). This is a category error.
  - **`beforeSignIn` + lazy provisioning** (instead of `beforeCreate`): allow Firebase to create the user, then on first sign-in check `solicitudes_registro` and either claim-assign or delete the user. Trade-off: persists ghost users in tenant temporarily but solves the SLA pressure (sign-in path is not bottlenecked by DB lookup at creation time; deletion happens asynchronously). Spec dismisses `beforeSignIn` in §5 OOS-1 without trade-off analysis.
  - **Identity Platform Custom Claims gate at SDK initialization** (apps/web checks claim before showing app shell, blocks unauthorized UID with frontend logout-on-mount). Trade-off: client-side enforceable only, but kills the audit-log-noise concern stated in §2.
  - **DNS / Cloud Armor blocklist of Google OAuth callback** at edge: rejected on its face but worth a sentence.

## Failure modes

- **F1 — Gen 2 incompatibility (P0)**: detection = Identity Platform UI shows "function deleted" warning + `beforeUserCreated` never invoked → fail-open Google signup. Recovery = rollback to `ignore_changes` state, residual reopens. Cost = sprint wasted, ADR-054 superseded by ADR-055 (Gen 1 redo), 5+ days of human work redone. **No mention of this failure mode in §9.**

- **F2 — DB lookup non-deterministic visibility (flake)**: detection = SC-2C.4 p95 metric doesn't trip but individual blocked legitimate users complain. Recovery = none; user gets retry-loop with `auth/internal-error`. Cost = legitimate approved users blocked silently. Root cause = same MVCC visibility pattern as the flaky `signup-request-fail-closed-test.md` (PR #361). T10 approve flow's `INSERT INTO solicitudes_registro` COMMIT may not be visible to a `SELECT 1` in another connection of the Blocking Function's pool depending on transaction isolation + connection state. **§9 does not enumerate this and §10 does not test for it.**

- **F3 — 7s SLA breached at scale**: detection = Cloud Monitoring p95 alert. Recovery = Identity Platform returns generic "internal-error" → fail-closed user-blocked. Cost = legitimate signup attempts fail; user retries; metric spike, alert fatigue. Mitigation `min_instance_count = 1` covers **cold-start of the function** but does NOT cover **cold-start of the Cloud SQL Auth Proxy sidecar inside the instance** (C5 says "lazy init within handler"). First invocation on a freshly-warm instance pays proxy connection setup. **§9 R-2C-1 hand-waves this as "connection pool warm".**

- **F4 — Function deploy fails between IdP config apply and function GA**: §11 says deploy in two commits (function first, IdP wire second). If IdP config commit lands while function is in failed/rolling state, IdP routes to non-existent function → **all Google signups fail** (including approved users) until recovery. No deploy interlock specified.

- **F5 — IAM permission gap on runtime SA**: §6 C7 lists "lee `solicitudes_registro` table" but Cloud SQL access via Auth Proxy requires `roles/cloudsql.client` AND the SA must exist in the cluster firewall rules of the connector. If Terraform `google_service_account.blocking_function_runtime` creation races against IAM binding, function deploys but cannot connect → fail-closed for all signups. Not in §9.

- **F6 — Identity Platform quota exhaustion**: signed projects have soft and hard quotas on auth ops. Blocking function invocation counts against quotas. Spec does not enumerate quota or alert threshold. If `signup.blocked.google` spikes (e.g., bot probing), quota may exhaust and block legitimate ops elsewhere in the project. Not in §9.

## Reversibility

- **Cost to undo in 30 days**: spec claims 5-min undo via Admin API patch (§11 Step 1). This is **partially true**: the trigger can be removed, but the Cloud Function, SA, IAM bindings, Terraform resources, ADR-054, runbook, `translateAuthError` mapping all remain. To "undo" fully → 1-2 day cleanup + a follow-up ADR superseding ADR-054. The spec materially understates revert cost.

- **Reversal mechanism**: Admin API PATCH (Step 1) is acceptable as a *circuit breaker* but is NOT a clean revert — it leaves the function running idle (paying min_instance_count billing for nothing). Spec does not address.

- **The Sprint 2c+7d watch (§3 SC-2C.8)**: closeable only after 7 days, but no defined criteria for what counts as "matches in `signup.blocked.google` alert that indicate attacker probing". If 100 blocked signups/day is normal (Booster doesn't know yet → no baseline), how does the operator distinguish noise from attack? This is a **measurability gap that defers the decision** to a vibes-based judgement at +7d.

## Drift signals

- **Triggers found**:
  - "Mismo pattern que T8 service. Unit test cubre." (R-2C-9 mitigation) — `mismo pattern` is shorthand for "I haven't verified". The flake followup confirms the T8 pattern itself has unresolved MVCC issues. **Unjustified.**
  - "Cost estimate <$15/mo (Cloud Functions Gen 2 pricing). Monitorear post-launch." (R-2C-4) — no calculation shown. Cloud Run idle billing for `min_instance_count=1` 24/7 in southamerica-west1 needs explicit computation. **Unjustified.**
  - "Aceptable" (R-2C-2 cold-start during reboot) — handwave. Cloud Functions Gen 2 *does not* guarantee zero-gap replacement for `min_instance_count=1`; brief unavailability windows during scale-in/scale-out are documented. **Unjustified.**
  - "Stretch goal; si emulator setup es complejo, smoke E2E manual cubre" (T8) — classic deferral. The hardest integration test (end-to-end Firebase emulator) is downgraded to optional. **Unjustified.**
  - "table scan tarda <1ms" (§7.3) — assertion without benchmark, on a prod DB at unknown load. **Unjustified.**
  - "Cubre casos edge donde `disabled_user_signup=true` permite Admin SDK creates que también pasan por Blocking Functions teóricamente" (§7.4) — "teóricamente" = "I don't know". **Unjustified.**

- **Justified drift**: §3 SC-2C.8 closure deferred to +7d is explicit and tracked. Fine.

## Evidence quality

| Claim | Evidence | Verdict |
|---|---|---|
| C3 "Identity Platform Admin API requires Firebase Functions framework" | "verificado en docs Identity Platform" (no citation, no link, no fetched snippet) | **Absent and CONTRADICTED**: docs show HTTP via `gcip-cloud-functions` is supported; Gen 2 is officially Gen 1 territory per issue #258. P0. |
| §7.3 "query LIMIT 1 sobre tabla pequeña ... <1ms" | None | **Absent** |
| R-2C-4 "Cost estimate <$15/mo" | None; no calc | **Absent** |
| SC-2C.4 "p95 < 1500 ms on first 100 invocations" | None | **Weak** (threshold seems plausible but "first 100" is operationally meaningless at sub-1/day rates) |
| §7.2 "`firebase-functions@^5.0.0`" pin | None | **Weak** — current major may be 6.x as of 2026-05-26 |
| OQ-2C-2 "$5-15/mo billing" | Acknowledged as open | **Weak but at least flagged** |
| R-2C-9 "mismo pattern que T8 service" | T8 service not cited | **Weak** |
| §11 "5-min undo" via Admin API PATCH | Plausible — Admin API supports updateMask | **Sufficient** (mechanism), Weak (consequences) |
| Alt-A rejection | "verifiqué docs Identity Platform 2026-05-26" | **Absent** — verifiable docs show the opposite |

Critical-mass verdict: **the most load-bearing technical claim of the entire spec (C3 / Alt-A) is not supported by external evidence and likely false.**

## Verdict

### Strong objections (must address before /plan can start)

- **P0-1 — Gen 2 vs Gen 1 incompatibility**: spec mandates Cloud Function Gen 2 (`google_cloudfunctions2_function`, `firebase-functions/v2/identity`). External evidence (`GoogleCloudPlatform/iap-gcip-web-toolkit#258`, `gcip-cloud-functions` SDK reference) indicates Identity Platform Blocking Functions officially support Gen 1 only, and Gen 2 wiring is known-broken in some configurations. **Reformulation guidance**: before /plan, run a 30-minute spike that wires a trivial `beforeUserCreated` Gen 2 function in a sandbox GCP project and verifies the trigger fires end-to-end. If it does not fire reliably, rewrite the spec to use Gen 1 + `gcip-cloud-functions` SDK. C3 must be replaced with the actual verified constraint, with link to the docs/issue cited.

- **P0-2 — C3 / Alt-A category error**: spec dismisses "HTTP arbitrary endpoint" without distinguishing arbitrary HTTP server (unsupported) from Gen 1 Cloud Function HTTP trigger using `gcip-cloud-functions` (supported, idiomatic). **Reformulation guidance**: split Alt-A into A1 (arbitrary HTTP — reject with citation) and A2 (Gen 1 `gcip-cloud-functions` — evaluate with trade-offs). Spec must demonstrate awareness of the official Identity Platform SDK before discarding it.

- **P0-3 — Admin SDK createUser interaction unverified**: §7.4 hand-waves the case where T10 approve flow's Admin SDK `createUser` may itself trigger `beforeUserCreated`. **Reformulation guidance**: before /plan, validate via Firebase docs + emulator whether Admin SDK creates trigger `beforeUserCreated`, and if so, design serialization (insert `solicitudes_registro.estado='aprobado'` BEFORE calling `createUser` in T10 service, with explicit COMMIT). Otherwise the very flow ADR-052 ships will collide with Sprint 2c.

- **P1-1 — MVCC / connection-pool visibility risk**: same root cause as the flaky `signup-request-fail-closed-test.md`. Sprint 2c integration tests must be designed to expose, not paper over, this pattern. **Reformulation guidance**: add T12 (race) — concurrent invocations of approve-flow + sign-in for the same email. Add explicit `READ COMMITTED` or higher isolation guarantee in §7.3. Document the pool's `idle_in_transaction_session_timeout` posture.

- **P1-2 — Ghost user cleanup omitted from scope**: spec closes the future leak but ignores the existing inventory of Google-signed-up users pre-Sprint-2c. **Reformulation guidance**: either (a) add to OOS-11 with link to a separate followup, or (b) add an explicit migration task (audit Identity Platform tenant, list orphans, decide policy). Currently §2 motivates with "audit log noise" but ignores existing noise.

- **P1-3 — SC-2C.4 measurability**: "first 100 invocations" is meaningless if Booster gets <1 Google signup/day in early prod. Threshold may not be testable in finite time. **Reformulation guidance**: rewrite to "p95 over a 7-day rolling window AND ≥100 invocations OR synthetic load test of 1000 invocations from a CI smoke."

- **P1-4 — SC-2C.6 ambiguous baseline**: SC-2C.8 closure ("no matches indicating attacker probing") needs a numerical baseline or it becomes a vibes-call at +7d. **Reformulation guidance**: define a concrete threshold (e.g., "≤ N blocked signups/day for unique IPs" or "no IP with >M blocked signups").

- **P1-5 — §11 rollout gate is contract-only, not mechanical**: "no /build until ADR-052 Accepted" is enforced by the human reading §11. In solo-dev mode this is exactly the gate the agent rationalizes around. **Reformulation guidance**: add a CI check or pre-commit hook in `apps/auth-blocking-functions/` build that greps `docs/adr/052-*.md` for `Status: Accepted` and fails the build otherwise. Mechanical > contractual.

- **P2-1 — ADR-054 numbering pre-commit**: spec commits to "ADR-054" inline. If another concurrent spec lands first, this is wrong. **Reformulation guidance**: either reserve ADR-054 *now* by creating a `Reserved` stub file in `docs/adr/054-...md` with status `Reserved`, or strip the number from the spec and resolve at /plan time. The current "suggested numbering ADR-054 — verificar pre-merge" is sloppy non-commitment.

- **P2-2 — R-2C-9 incomplete**: email casing is mentioned, but **not** punycode-encoded IDN domains (e.g., `user@münchen.de` → `user@xn--mnchen-3ya.de`), gmail+aliases (`a+filter@gmail.com` matches `a@gmail.com` per Gmail semantics but NOT per byte equality), leading/trailing whitespace from OAuth payload, NFC vs NFD Unicode normalization. **Reformulation guidance**: enumerate the canonicalization function explicitly (lowercase, trim, NFC, no `+` stripping unless documented). Document Gmail+alias as known false-negative with rationale.

- **P2-3 — Cost claim "<$15/mo"**: no calculation. southamerica-west1 has different pricing than us-central1; idle CPU pricing for Cloud Run-backed functions is non-trivial. **Reformulation guidance**: compute explicitly: `(1 vCPU × 0.5 GiB × 730h × idle-rate-samerica-west1) + (invocation × $X)`. If >$15/mo, reconsider min_instance_count=1 vs accepting cold-start fallback to fail-open vs fail-closed.

- **P2-4 — `min_instance_count = 1` overkill question**: at <10 Google signups/month (per ADR-052 estimate ~10-50 `solicitudes_registro` rows/month, with Google a subset), warming a permanent instance for cold-start avoidance has poor ROI. **Reformulation guidance**: model the false dichotomy explicitly: (a) `min_instance_count=0`, accept p99 spike on cold-start, fail-closed if >7s, document expected user-facing UX of "retry login" message; (b) `min_instance_count=1` for steady state. Pick based on cost x UX.

- **P2-5 — OQ-2C-1 to OQ-2C-6 should block /plan**: these are not nice-to-have. OQ-2C-1 (Firebase error code propagation) is required for `translateAuthError`. OQ-2C-3 (regional failover) is required for SC-2C.5 fail-closed correctness. **Reformulation guidance**: refuse to enter /plan until each OQ is resolved or downgraded to "intentional unknown, accept risk Y." Spec line 284 ("Resolver OQ-2C-1 a OQ-2C-6 antes de cerrar /plan") is the right instinct but the gate is informal — make it formal.

- **P2-6 — Firebase emulator stretch goal is wrong tradeoff**: §10 T8 says "stretch goal; si emulator setup es complejo, smoke E2E manual cubre". Smoke E2E manual is **not** equivalent — it doesn't catch the MVCC issue flagged in P1-1, and it can't be run on every PR. **Reformulation guidance**: promote T8 to required. If emulator setup is hard, that's a one-time cost; not building it leaves Sprint 2c with the same regression posture as the flaky T9b test.

- **P2-7 — Cost & complexity vs residual severity**: ADR-052 itself says the residual is "non-exploitable end-to-end without role-assignment" because roles live in `users` + memberships. Spec §2 motivates with "tenant pollution + audit log noise." Is one new app + 1 framework + 1 Cloud Function + Terraform module + ADR + runbook + integration tests **proportionate** to "audit log noise"? **Reformulation guidance**: spec must include a section "Why not accept the residual permanently?" with explicit cost-benefit. Either the residual is genuinely material (in which case the ROI case must be made) or it isn't (in which case Alt-E is the right choice). The current spec implicitly assumes "of course we close it" without a number.

### Residual risks (accept and document)

- R-2C-2 (cold-start during instance reboot) is genuinely low-probability and the cost (one user retries sign-in) is minor. Acceptable to accept and not over-engineer.
- R-2C-10 (Firebase SDK schema change) is generic supply-chain risk, mitigated by renovate-bot + tests. Acceptable.
- The pre-existing-user ghost cleanup (P1-2) can be deferred *if* explicitly written down as deferred, with a follow-up stub created.

### Out of scope for this review

- The actual implementation correctness of the handler pseudocode is not reviewed — that is a /plan + /build review concern (code-reviewer sub-agent).
- The ADR-052 Status flip mechanics (Proposed → Accepted) — that's a separate spec.
- Booster's product decision to keep Google provider at all — settled by ADR-052 Alt-1.

---

**Closing posture**: I did not find this spec defensible as-drafted. The architecture choice rests on a constraint (C3) that the spec authors claim to have verified but external evidence contradicts. Until P0-1, P0-2, P0-3 are resolved with citations, /plan should not start. The spec should be re-issued as Draft v2 with a verified architecture section, an explicit cost-benefit for closing the residual at all, and mechanical gates (not contractual gates) for the /build phase.

I am not the gatekeeper. The human decides. But the human should be informed: this spec has an inverted load-bearing claim and should not proceed without empirical verification.
