# Devils-advocate review --- sec-001-h1-2-google-blocking plan.md --- 2026-05-26T23:20:00Z

> Adversarial pass on the 14-task breakdown (T1-T14, T6a/b sub-split). I assume the plan is wrong until each load-bearing claim survives. **I found 19 substantive objections** across the 12 requested vectors plus the 7-axis frame. No congratulations, no approval.

---

## Findings index

- **P0** (blocks /build - must fix before T1 ships): F-01, F-02, F-03, F-04
- **P1** (high risk to Sprint 2c success - strong objections): F-05, F-06, F-07, F-08, F-09, F-10, F-11
- **P2** (residual risks worth documenting / cheap to address): F-12 ... F-19

---

## F-01 [P0] T1 is self-locking. The first task is its own gate, with no escape hatch.

**Vector**: critical-path-risk (user item #4).

The plan asserts (line 16-18) that T1 may execute immediately post-plan-approval and that T2+ wait for ADR-052 Accepted. That is technically true but operationally false under failure:

- The branch protection rule that makes the gate enforceable is "configuration manual post-merge, documented en runbook" (line 35). Until T1 is merged, the rule does not exist on main.
- The gate fires on pull_request with paths apps/auth-blocking-functions/** etc. T1 own PR does NOT touch those paths, so T1 merges without the gate vetting T1.
- Therefore: the moment T1 lands and the human adds the required-check rule, any bug in T1 cannot be patched without disabling the rule manually, OR by submitting a fix PR that does not touch the gated paths (which the fix would, transitively, since the gate logic is in apps/api/scripts/).
- Scenario: regex matches too strict. T1 only specifies 4 fixture cases (line 34: Proposed/Accepted/missing/malformed). It does NOT test against the actual production ADR-052 content.

**Demanded evidence absent**: T1 acceptance does not require running the script against the real docs/adr/052-signup-migration-admin-sdk-gate.md and asserting exit 0 once ADR-052 is Accepted. That is the single check that matters.

**Reformulation**:
- Add acceptance T1.5: "Run check-adr-status-accepted.ts against the actual repo file in a CI dry-run job that does NOT fail the build, capture output as evidence. PO reviews before flipping ADR-052 to Accepted."
- Add acceptance T1.6: "Document escape-hatch in runbook (T13): how to bypass the gate if the script itself is buggy --- revert the workflow file (which is not in gated paths), then fix script, then re-add workflow."
- Add a fifth fixture: a real ADR-052 snapshot copied verbatim, asserting the regex matches.

---

## F-02 [P0] T3 stub is fake-vertical. Tests T1+T2+T4 cannot meaningfully pass against a DB-less skeleton.

**Vector**: vertical-slice-validity (user item #1).

The plan says T3 ships handler.ts (NEW, ~40 LOC, stub with provider check + DB-less skeleton) and that this enables tests T1, T2, T4 from spec section 10.

- Spec T1 (line 340): DB mock returning empty rows -> expect throw HttpsError permission-denied BLOCKED_SIGNUP_PENDING_APPROVAL.
- Spec T2 (line 341): DB mock returning 1 row {estado: aprobado} -> expect no throw.
- Spec T4 (line 343): provider !== google.com passthrough.

T4 is the ONLY one that a DB-less handler can actually exercise (early-return on provider check). T1 and T2 REQUIRE DB code in the handler. Otherwise the DB mock is mocking a function that does not exist; the test would be mocking a placeholder, asserting against placeholder behavior, proving nothing about eventual behavior.

This is a horizontal slice dressed as a vertical slice. T3 lands tests-that-do-not-test; T5 lands the real behavior + a separate test file modification that replaces or augments T3 stub tests.

**Concrete failure**: when T5 ships and the DB code lands, T3 tests will need to be rewritten (the mock contract changes from "mock a placeholder" to "mock a real DB call"). T3 acceptance criteria were never load-bearing --- they pass trivially regardless of correctness.

**Reformulation**: either
- (a) Move T1/T2 from T3 acceptance to T5 acceptance. T3 acceptance is ONLY T4 (provider passthrough) + skeleton compiles. State this explicitly: T3 is a structural slice; behavioral tests T1/T2 land in T5. Justify in waiver text.
- (b) Land T3 with the DB stub (interface only, no real connection) and a fake DB layer in tests, so T1/T2 exercise the real handler control-flow. But then DB-less skeleton in line 60 is a lie; rename it DB-interface-stubbed skeleton and ship the interface as part of T3. This bumps T3 LOC higher.

Either way, the current T3 description is incoherent --- it claims tests pass without the code that the tests test.

---

## F-03 [P0] T6a applied -> T6b unapplied is a broken-state window, not "independently mergeable".

**Vector**: vertical-slice-validity (user item #1).

Plan line 121-127: T6a Terraform applies function infra (service account, IAM, cloudfunctions resource) but explicitly defers apply and the source_archive_object to T6b. T6b is the Cloud Build deploy step.

- If a human or automation does terraform apply after T6a merges but before T6b merges, the function resource exists with no code archive. gcloud functions describe enforce_signup_approval returns a deployed function with sourceArchiveUrl empty or default. Any invocation = error. The IdP wire (T7) would fail upon first signup attempt.
- The plan has no instruction "do not apply T6a until T6b is merged and the build is green." A reasonable operator reading the runbook will apply T6a immediately. Operator-error waiting to happen.
- Worse: the plan rollback for T6a is terraform destroy (line 126), implying apply was expected.

**Reformulation**:
- Either merge T6a and T6b as a single PR (waive LOC if needed --- ~110 LOC, comparable to T8). The two-PRs framing creates the broken window.
- Or: T6a acceptance must include NOTE: "Do NOT apply this Terraform until T6b lands and its Cloud Build run has produced a source_archive_object. T6a merge alone = state only, no infra change."
- Add T6a smoke test: post-apply (which happens in T6b operational step), verify gcloud functions describe returns a function with a non-empty source URL.

---

## F-04 [P0] T6b "baseline test: 10 curl invocations" cannot work as written. The function expects IdP JWT-signed event bodies; bare curl will 401/400, never reaching the handler.

**Vector**: empirical-verification-gaps (user item #7).

Plan line 138-139: "Function endpoint reachable via curl con fake event payload (not yet wired to IdP). Pre-launch baseline test: 10 curl invocations measured -> assert p95 < 1500 ms."

This is the textbook "trusting docs without spike" mistake the plan itself warns against in out-of-band tasks (line 272: lesson learned from Gen 1 vs Gen 2 empirical verification).

- gcip-cloud-functions blocking-function handlers receive an event object that the SDK validates as a signed JWT from Identity Platform. The AuthFunction.beforeCreate wrapper rejects bare requests before the handler runs. Exact behavior depends on SDK validator: could reject with 401 (no token), 403 (invalid issuer), or even crash.
- Even if the wrapper allowed unauthenticated calls, the handler reads event.data.email, event.data.providerData, event.ipAddress --- all from a typed event. A fake JSON {"email":"x"} would either parse-fail or take a different code path than the real signup flow.
- Therefore the p95 measurement is measuring rejection latency, not decision latency. The baseline number is not comparable to runtime behavior.

OQ-research did not address this. The plan inherited the gap.

**Reformulation**:
- Replace "10 curl invocations" with one of:
  - Option A: Local invocation via Firebase Auth emulator (which T9 already sets up) --- measure handler execution time directly via emulator logs. This is what the T9 integration test essentially does. Reuse it for baseline.
  - Option B: Wire to a staging IdP tenant (does Booster have one? --- see F-09), execute 10 real OAuth signups end-to-end, measure Cloud Monitoring metric.
  - Option C: Defer baseline to post-wire in production. T6b acceptance becomes "deployed cleanly, endpoint reachable for IdP". Baseline measurement moves to T7 acceptance ("first 10 real-traffic invocations post-wire measured").
- Whichever path is taken, document it explicitly. The current curl-invocations line is empirically meaningless.

---

## F-05 [P1] ADR-NNN drafted AFTER mechanical-gate code lands violates "ADR before code" --- except the plan never argues why this is an exception.

**Vector**: dependencies (user item #3).

CLAUDE.md project contract: an ADR is required when changing a pattern that applies to multiple modules. T1 introduces a new CI pattern: ADR-status mechanical gates over path-filtered files. T1 is BEFORE T2 (the ADR draft).

The plan defense is implicit: T1 = defensive infra, not code -> no ADR needed. But the plan never says that. It just orders T1 before T2 silently.

- If T1 regex-vs-grep design choice (line 31) needs to be reconsidered later, there will be no ADR rationalizing why regex-on-line-3 was chosen vs. parsing the ADR frontmatter, vs. using gh API to check an approved label, vs. a sealed git tag. Future-self reads T1 and asks "why this and not X?" --- no answer.
- Worse precedent: ADR-049 (plugin system adoption) was written before the plugin migration code. ADR-052 was written before the signup migration. The pattern in this codebase is ADR-first. T1->T2 reverses it without acknowledgment.

**Reformulation**:
- Either (a) swap order: T2 ADR-NNN first (Proposed), then T1 implements it. The ADR can be drafted today; it does not depend on code existing. The dependency chain in line 46 (T2 Depends on T1 merged) is wrong-way-round.
- Or (b) explicitly waive in the plan: add a one-liner in T1 acceptance "ADR exemption justified: T1 is mechanical defensive infra, not architectural pattern; ADR-NNN documents the broader signup-gate design and references T1 as implementation detail." Either is acceptable, but the silence is not.

**Bonus**: T2 acceptance (line 49) says "Numbering: estimated ADR-054 o ADR-055." Estimated. Why? ADR-049 through ADR-053 are documented references; ADR-054 should be the next number. If not, what conflict resolution? Say ADR-054 definitively or document the script behavior.

---

## F-06 [P1] Waivers over 100 LOC are listed but the empirical-100 justification is hand-waved. T3 in particular splits cleanly.

**Vector**: waivers (user item #2).

Skill section 43 says split. The plan waives 4 tasks (T3=165, T5=135, T8=110, T13=110) with one-line justifications. Per-task attack:

T3 (165 LOC). Stated justification: "package.json + tsconfig + skeleton + handler stub + tests must land together". Counter: splittable as T3a = workspace bootstrap (package.json + tsconfig + index.ts skeleton + empty handler --- ~70 LOC) -> T3b = handler stub + provider-check + tests (~95 LOC). T3a compiles and a smoke "function loads" test passes; T3b adds behavior. Textbook vertical-slice split. The must-land-together claim is unsubstantiated.

T5 (135 LOC). Stated justification: "DB connection + logger + handler complete logic + tests interlinked". Partially agree. db.ts singleton + logger.ts could land as T5a (~55 LOC), handler.ts MODIFY + handler.test.ts MODIFY as T5b (~80 LOC). Worth at least attempting. If T5b actually exceeds, waiver justified there.

T8 (110 LOC). Stated justification: "script + tests must land together; script depends on shared-schemas types". 80 LOC script + 30 LOC tests = 110, ~10 over. Performative waiver. Could land script (80 LOC, with one-line smoke test) then follow-up T8b for full suite. But honestly this is so close to 100 that the fight is not worth it. **Concede but document as "marginal waiver"**.

T13 (110 LOC). Stated justification: "2 docs interdependent that reference each other". Counter: runbook (~80 LOC) lands first; CURRENT.md delta (~30 LOC) lands as a separate PR after the 7-day watch. The two docs are sequential, not co-required. Splitting them lets the runbook be in place for the 7-day watch start, and CURRENT.md update happens at ship-time.

**Reformulation**:
- T3 -> split into T3a (bootstrap) + T3b (handler stub).
- T5 -> attempt split into T5a (DB + logger) + T5b (handler + tests).
- T8 -> keep but explicitly label "marginal waiver, +10 LOC over cap".
- T13 -> split into T13a (runbook) + T13b (CURRENT.md update at ship).

Four waivers in a 14-task plan is a smell of not splitting hard enough.

---

## F-07 [P1] T10 race-condition test "documents the invariant" --- that is documentation labeled as a test. Spec section 10 T12 expected a real test.

**Vector**: user item #8.

Plan line 199-200 says T12 (race) test: "two concurrent signup attempts mismo email (one Google new, one approve flow). Verify deterministic outcome dado serial commit order. Documents OQ-2C resolution + R-2C-13 invariant."

Read carefully: "Verify deterministic outcome given serial commit order." The test is asserting that if commits are serialized, behavior is deterministic. That is a tautology. PostgreSQL with default isolation level guarantees serializable-equivalent for single-row reads/writes. The test will pass by virtue of how MVCC works, not because the handler did anything correct.

The actual race the spec worries about is the MVCC visibility window: approveSignupRequest tx commits at T0, blocking function tx at T0+epsilon reads with a slightly-stale snapshot. The spec dismisses this as "Operational flow ensures admin approve -> user notification email -> user clicks -> signs in via Google. Time gap >1s". So the spec admits the race exists but argues operational latency masks it.

**T10 as-described does not test the race**. It tests serialized two-statement behavior, which is not the failure mode at risk. To test the actual race you would need:
- Approve tx that takes longer than snapshot-staleness to commit.
- Blocking function tx that started during the approve-tx-in-progress window.
- That requires fault injection (pg_sleep inside approve tx, then async blocking-function call within the sleep window).

**Reformulation**: Either
- (a) Rename T10 race test to "T10 race-window documentation test" and be honest: it documents the invariant via a passing test that does NOT actually exercise the race. Add acceptance "test name explicitly contains documents-invariant so future-readers understand the limitation." Reference R-2C-13 mitigation explicitly.
- (b) Build a real MVCC fault-injection test (longer, ~70 LOC, harder), and accept higher LOC in T10.

The current framing --- claiming to test what is actually being documented --- is a drift signal (see F-12).

---

## F-08 [P1] T12 ghost-user inventory execution depends on prod Firebase Admin SDK access from local dev. Plan does not specify where the script runs.

**Vector**: user item #9.

Plan line 222-228: T12 says "Script ejecutado contra prod Firebase Auth tenant -> CSV generated". No mention of:
- Where the script runs (Felipe laptop? Cloud Run job? Cloud Build trigger?).
- How Admin SDK creds are obtained (gcloud auth application-default flow? Service account JSON? Workload Identity from where?).
- How the script reaches Cloud SQL prod (private IP 172.25.1.2 per spec C4) --- IAP tunnel? db-bastion? The memory file reference_prod_db_headless_query.md documents the canonical approach but T12 does not reference it.

**Concrete pain**: Felipe is not currently configured with Admin SDK service-account-impersonation in a way that is documented. The signup-request approve flow runs in apps/api (Cloud Run) --- it has the SA bound. A local script needs either (a) workload-identity-federation from laptop, (b) gcloud impersonation, or (c) deploy as Cloud Run job.

If T12 is meant to run from laptop, expect 30-60 min of auth-setup friction. If from Cloud Build, T12 needs an additional task: a one-shot Cloud Build pipeline.

**Reformulation**:
- T12 acceptance must include "Execution path documented: (a) gcloud auth application-default login --impersonate-service-account=SA, (b) script uses ADC + firebase-admin, (c) DB access via IAP tunnel per reference_prod_db_headless_query.md pattern."
- If laptop-friction is unacceptable, add a sub-task T12.5 --- one-shot Cloud Build pipeline that runs the script in CI with right SA, dumps CSV to GCS, pulls locally for PO review.
- The plan treats T12 as a 30-LOC data file. It is actually a 0-LOC plan dependency hiding 30-60 min of operational setup. **Estimate is wrong**.

---

## F-09 [P1] T14 status-flip depends on 7-day watch --- clock-start is undefined.

**Vector**: user item #12.

Plan line 256-265: T14 fires "post-7-day watch post-launch with metrics passing SC-2C.8 thresholds." But post-launch can mean:
1. Post-T6a apply (function deployed, no IdP wire --- no real traffic).
2. Post-T6b deploy (function actively running with archive, no IdP wire --- still no real traffic).
3. Post-T7 wire (function receiving real signup attempts --- real traffic, real clock).
4. Post-T11 frontend translation merged (user-visible flow complete --- real UX clock).
5. Post-T13 runbook landed (monitoring docs available --- operational clock).
6. Post-T12 PO cleanup decision (ghost users dealt with --- full-state clock).

The plan does not specify which one. SC-2C.8 says "< 1 blocked Google signup/day promedio + 0 alert firings" --- that only makes sense from option 3 (real traffic) at the earliest.

If clock starts at #3 but runbook (T13) lags, the 7d watch could elapse with no docs. Conversely if clock starts at #5, then T13 must merge before T11+T12 finish, but T11 depends on T7 which depends on T6b. The dependency graph is OK but the clock-start point is ambiguous, and the wall-clock budget (3-4 days) depends critically on which start point is chosen.

**Reformulation**:
- Define explicitly: 7d watch clock starts at T-WIRE-PROD-APPLY: the moment terraform apply of T7 succeeds and blocking_functions.triggers.beforeCreate.function_uri is set in prod IdP config. Add this to T7 acceptance as evidence (record timestamp of apply for clock-start).
- T14 acceptance: at least 7x24h elapsed since T-WIRE-PROD-APPLY timestamp recorded in T7.
- T13 (runbook) must merge BEFORE T-WIRE-PROD-APPLY, not after. Currently T13 depends on T7 merged + T11 merged --- that puts the runbook after wire. The 2h watch in spec section 11 requires a runbook to exist at wire-time. Re-order T13 before T7.

---

## F-10 [P1] Wall-clock estimate 3-4 days is unsupported. Sprint 2b shipped 12 PRs in 1 day. Is Sprint 2c 4x harder?

**Vector**: user item #10.

Plan line 303: Wall-clock estimate: ~3-4 days PO time (T1-T11 ~2.5 days; T12-T14 ~1 day post-7d-watch).

This is a vibes estimate. No evidence cited. Decomposition:

- Sprint 2b had 12 mostly-mechanical PRs (drift fixes, terraform applies, audits). 1 day.
- Sprint 2c has 14 tasks but only ~6 are mechanically simple (T1, T2 ADR, T4, T6a, T7, T11). The rest are non-trivial: T3 (new workspace), T5 (DB pool + handler), T6b (Cloud Build), T8 (script), T9 (emulator), T10 (race + Admin SDK).

The 7d watch is wall-clock, not PO-time. If T14 is "post-7-day watch", the calendar minimum is 7 days + the time to ship T1-T13. The plan conflates PO-active time with calendar time.

**Reformulation**:
- Two separate numbers: **PO active time** ~ 2.5-3 days for T1-T13. **Calendar time to T14 ship** = max(PO active) + 7 days watch = ~10 days.
- Specify in plan: "Sprint 2c CERRADO at T14 ship ~ ship-day-of-T1 + 10 calendar days, assuming no rework. If T7 deploys 2026-05-29, T14 lands earliest 2026-06-05."
- Without this, the team will expect Sprint 2c done in 4 days and be surprised at day 5 when the 7d watch is still running. PO communication risk.

---

## F-11 [P1] T7 rollback time-to-undo "5min per spec section 11" is optimistic. Mid-OAuth-flow rollback has no defined user-visible behavior.

**Vector**: user item #6.

Plan line 155 says rollback via "Identity Platform Admin API PATCH config blockingFunctions={} (5-min undo per spec section 11) OR terraform apply previous commit."

Two problems:

**Problem A --- 5min is the API call latency, not the propagation latency.**

Identity Platform config changes do not necessarily propagate instantly to all auth backends. Google docs do not specify config-cache invalidation time. In other GCP products (Cloud Armor policy update, IAM binding) propagation is typically 60-90 seconds, sometimes longer. The 5min claim covers the API call but not the actual "all signup attempts now go through new config" state. There is no source cited in spec section 11 for the 5min number.

**Problem B --- user mid-flow.**

If a user is in the middle of signInWithPopup (Google OAuth window open, user about to click Continue) when the rollback PATCH lands, what happens?
- The OAuth dance with Google is independent of IdP blocking-function config. The user clicks Continue, Google returns a token, Firebase Web SDK sends it to IdP. At that moment, IdP either still has the old blocking-function config (and fires the function, which is now disconnected from code or deleted), or has the new (empty) config (and creates the user without gating).
- The user sees:
  - Scenario A (function still wired, code deleted): auth/internal-error --- function URL returns 404. User retries, gets the same error. Frustrating but safe (fail-closed).
  - Scenario B (function unwired post-rollback, mid-flow): user is created successfully without gating. The ghost-user category grows by one. Then T12-style inventory has to re-run.

The spec/plan does not document either scenario.

**Reformulation**:
- Add to spec section 11 (or runbook T13) explicit user-mid-flow behavior section.
- Replace "5-min undo" with empirical evidence: rollback PATCH API call completes in <30s; full config propagation latency is unverified --- measure during T7 smoke test.
- Add T7 acceptance: post-apply, immediately re-PATCH the config to remove blocking_functions, measure time-to-restore-original-behavior via re-running smoke E2E. Record real propagation latency.

---

## F-12 [P2] Drift vocabulary scan flags 5 occurrences. Two are unjustified.

**Vector**: drift signals (axis 6 of seven-axis attack).

Plan was scanned for the canonical agent-rigor drift vocabulary set. Findings:

| Line | Phrase | Justified? |
|---|---|---|
| 186 | "Si CI complexity es alto, skip CI mode + corrida manual pre-merge" | Unjustified --- see F-13. This is "we will integrate later" hidden in T9. |
| 270-273 | "Out-of-band tasks ... no estan en la critical path" | Unjustified --- see F-14. |
| 199-200 | T10 "documents OQ-2C-13 invariant" | Unjustified --- see F-07. |
| 285 | "OQ-PLAN-1..4 ... Resolverse en /build T1-T10 execution" | Marginal --- see F-15. |
| 124 | T6a "apply queda como evidencia operacional post-merge" | Justified in context (Terraform plan-without-apply is a Booster pattern), but F-03 still applies regarding the broken window. |

Plus: the word "stub" appears 3 times (T3, T3, T3). Every occurrence implies "we will finish this later" without an explicit ledger entry. The plan should declare in T3 waiver text: the term stub is used; subsequent tasks T4, T5 complete the handler. Coverage gate not enforced on T3-state.

---

## F-13 [P2] T9 "if CI complexity is high, skip CI mode" is a soft waiver written into acceptance.

**Vector**: drift / evidence quality.

Plan line 186: T9 Firebase emulator integration test acceptance --- "CI integration: optional Cloud Build step that spins up emulator + runs test. Si CI complexity es alto, skip CI mode + corrida manual pre-merge (documentado en runbook)."

This is a built-in waiver, decided BEFORE anyone tries to integrate. Skill 64-shipping-and-launch and booster-stack-conventions require "tests existen ANTES del commit del feature, no despues" + "Coverage 80%+ en codigo nuevo. CI bloquea si baja."

If T9 ships as manual-pre-merge-only, then T5-T7 PRs do not have CI coverage of the integration path. The manual run is unverifiable --- was it run? Against what state? No artifact lands.

**Reformulation**:
- Pre-commit to CI integration. Spike T9 Cloud Build emulator setup as a separate Sprint-2c-T0 task (~2h investigation). Land result as either:
  - (a) CI integration successful --- Cloud Build step test-blocking-function-emulator runs on every PR touching apps/auth-blocking-functions/.
  - (b) CI integration deferred --- documented in .specs/_followups/blocking-function-emulator-ci-integration.md with explicit reason (e.g., emulator boot time >5min in Cloud Build, exceeds 10min PR-CI budget). Manual run is documented in runbook with verification checklist Felipe signs at PR-merge time.

The current "if X then skip" is a license to skip without doing the X check.

---

## F-14 [P2] Out-of-band tasks have no owner, no dependency, no merge gate. They will be forgotten.

**Vector**: user item #11.

Plan line 267-274 lists 4 items as trackearan but with no explicit task ID, no acceptance criterion, no merge gate:

1. Sprint 2c followup stub cleanup (mark EXECUTED or move to archive).
2. Memory file update (lesson learned about Gen 1 vs Gen 2).
3. PEP review (booster-skills plugin update if patterns are reusable).
4. Ghost user cleanup execution (depends on PO decision in T12).

For each:
- **#1** --- straightforward maintenance. Should be T13.5 (one-liner doc edit, ~5 LOC, prerequisites T14 Sprint 2c CERRADO).
- **#2** --- this is the MOST VALUABLE of the four: documenting the empirical-spike-over-doc-trust pattern. The plan itself was rewritten v1->v2 because of this exact failure. If it is "out-of-band" it will be forgotten in 2 weeks. Should be a T13-companion task (~30 LOC memory file), with a hard merge gate: no /ship without memory file in place.
- **#3** --- fair to leave out-of-band; this is plugin-roadmap.
- **#4** --- operational task with potential security impact. If PO chooses option (a) disable + audit, this could disable real users by mistake. Should be its own task with dry-run + manual confirm, e.g., T15-ghost-cleanup-execute.md. Cannot be tracked-separately --- it touches prod users.

**Reformulation**:
- Move #1, #2 into the task list as T13.5 + T13.6 (small tasks gated to T14 prerequisites).
- Move #4 into the task list as conditional T15 (only fires if T12 PO decision = option (a)). Document non-fire path.
- Leave #3 as out-of-band.

---

## F-15 [P2] OQ-PLAN-1..4 should be resolved before /build, not "during /build T1-T10 execution".

**Vector**: user item #5.

Plan line 285: OQ-PLAN-1..4 sobre /plan craft are smaller scope que OQ-2C-1..9 spec-level. Resolverse en /build T1-T10 execution.

Looking at the four:
- **OQ-PLAN-1** --- Firebase emulator CI overhead. This is exactly F-13. Decide BEFORE T9, not during. 30-min investigation.
- **OQ-PLAN-2** --- pnpm-workspace.yaml wildcard for new workspace. This is a 5-minute file read (pnpm-workspace.yaml exists in repo root). Resolve now, not during T3.
- **OQ-PLAN-3** --- Identity Platform SA email for invoker binding. This needs a GCP API call: gcloud iam service-accounts list --filter=displayName:Identity Platform --project=booster-ai-494222. ~2 min. Resolve before T6a, not during.
- **OQ-PLAN-4** --- Sandbox spike for OQ-2C-8 (Admin SDK trigger). The OQ-research punted this to /plan T0 sandbox spike (oq-research.md line 139). The plan re-punts to "during /build". This is the second time the empirical spike is being deferred. Spec section 7.5 mitigates structurally (early-return), so technically safe --- but the lesson from v1->v2 is that empirical confirmation matters. If OQ-2C-8 truly is safe under both Case A and Case B (per OQ-research), then the spike adds no information; if it is not, deferring means defects ship.

**Reformulation**:
- OQ-PLAN-1: resolved before T9 starts. Add as pre-T9 30-min spike.
- OQ-PLAN-2: 5-minute pre-T3 file read. Resolve and document in T3 acceptance.
- OQ-PLAN-3: 2-minute pre-T6a gcloud call. Resolve and document in T6a acceptance.
- OQ-PLAN-4: two options ---
  - (a) Execute the OQ-2C-8 spike now (does Booster have a staging IdP tenant? --- research dep). If yes, ~30min. If no, document why deferred and accept the structural defense (early-return) is the load-bearing safety net. Make the trade-off explicit.
  - (b) Re-affirm safe under both interpretations and DROP the spike. Do not keep it as a phantom obligation that never resolves.

The current resolverse-en-build-T1-T10-execution is unactionable.

---

## F-16 [P2] T11 (frontend translateAuthError) depends on T7 wire --- but the substring-match pattern (per OQ-2C-1) can be unit-tested without any backend. T11 can land much earlier.

**Vector**: scope / dependency-graph optimization.

Plan line 211: T11 Depends on: T7 merged (smoke E2E manual confirms error reaches frontend with expected message format).

The substring-search pattern is documented in oq-research.md line 60-74 with exact Firebase SDK behavior. T11 translateAuthError extension can be implemented and unit-tested with FirebaseError mocks today, no backend required. The smoke-E2E-confirms requirement is a validation step, not a blocking dependency.

**Why this matters**: T11 is on the critical path to user-visible behavior. Front-loading it removes risk that the error-mapping needs rework after T7 wire (the most ops-risky task).

**Reformulation**:
- T11 dependencies: T2 merged (ADR-NNN finalizes the substring-match pattern). Remove T7 dependency.
- T11 acceptance: keep tests con FirebaseError mocks as primary. Move smoke-E2E-confirms to T7 acceptance (smoke E2E confirms frontend message matches translateAuthError output).

This gets T11 mergeable in parallel with T3-T5, reducing critical path.

---

## F-17 [P2] No alternatives section in the plan. What alternatives to the task breakdown were rejected?

**Vector**: alternatives discarded (axis 3 of seven-axis attack).

The plan presents 14 tasks as the truth. No mention of:
- **Alt-breakdown-1**: monolithic 3-task plan (T1=infra+code, T2=deploy+wire, T3=docs). Rejected because too coarse.
- **Alt-breakdown-2**: feature-flag-protected single-task ship (deploy disabled function, feature-flag flip post-ship). Rejected because IdP does not have a feature-flag layer.
- **Alt-breakdown-3**: skip ghost-user inventory (SC-2C.9) and accept all -> simpler plan, T8/T12 deleted. Rejected because security risk.

Without this section, future-self reads the plan and asks "why 14 tasks and not 8?" --- no answer.

**Reformulation**: add Alternatives considered section, even brief.

---

## F-18 [P2] T7 smoke E2E uses "cuenta de prueba sin matching solicitudes_registro.aprobado". What test account? Is it in seed data?

**Vector**: evidence quality / scope.

Plan line 153: smoke E2E acceptance asks for cuenta de prueba sin matching solicitudes_registro.aprobado. Where does this test Google account come from?
- A real Google account belonging to a Booster team member. If so, after smoke test fails, that account becomes a ghost (per F-11 mid-flow concern).
- A test Google Workspace account (test+sprint2c@boosterchile.com?). Does not exist yet; needs creation.
- An incognito session with a personal Google account. Then the team member personal account is now in IdP failed-signup logs.

The plan does not specify. The runbook (T13) must.

**Reformulation**: T7 acceptance includes "test Google account: documented-account@boosterchile.com created pre-T7 with no solicitudes_registro row." Add to T0 setup (or to T6b deploy step) the account creation as evidence.

Also need a positive test account (with matching solicitudes_registro.aprobado). Two accounts, both documented, both in seed data, both reusable for future smoke tests.

---

## F-19 [P2] Reversibility analysis: cost-to-undo in 30 days is not quantified per task. Aggregate claim "5-min undo per spec section 11" does not survive scrutiny.

**Vector**: reversibility (axis 5 of seven-axis attack).

Each task has a Rollback line, but few quantify cost. Per-task spot check:

| Task | Rollback line | Time-to-undo if discovered wrong at day 30 |
|---|---|---|
| T1 | revertir 3 archivos + remove from branch protection rules manually | ~30min --- branch protection edit is GitHub admin, plus rebase/revert PR. Reasonable. |
| T2 ADR | revert ADR file | ~5min. But "wrong ADR at day 30" means the design decision is wrong, which means T3-T7 are based on a wrong premise. Rollback = revert all of Sprint 2c. Real cost: 1-2 days of unwinding. |
| T6a/T6b/T7 (deployed infra) | various | F-11 covers T7. T6a/T6b destroy = ~15min Terraform. Real impact: if removed at day 30, ghost-user count grows during the window between removal and replacement design. |
| T12 PO decision option (a) disable+audit | data file (immutable). Cleanup execution separate. | If at day 30 the PO regrets disabling N users -> re-enabling is auth.updateUser(uid, disabled=false) x N. ~5min x N. But: any disabled user who tried to sign in during the disabled-window has Firebase Auth telling them account disabled --- UX scar, not rollback-able. Real cost: customer trust if any legitimate user was caught. |

**Reformulation**: For T7, T12, add explicit cost-to-undo at day 30 lines with the customer-impact dimension, not just the technical-revert cost.

---

# Seven-axis attack summary

| Axis | Result |
|---|---|
| 1. Premise | F-04 (curl baseline assumption broken); F-07 (T10 race-test premise tautological); F-11 (5min-undo premise unsubstantiated) |
| 2. Scope and second-order effects | F-03 (T6a/T6b broken-state window); F-08 (T12 runtime env undefined); F-18 (smoke E2E test account undefined) |
| 3. Alternatives discarded | F-17 (no alternatives section at all) |
| 4. Failure modes | F-01 (T1 self-locking); F-04 (baseline measures wrong thing); F-11 (mid-OAuth-flow rollback undefined); F-19 (customer-trust scar from T12 option (a)) |
| 5. Reversibility | F-19 (cost-to-undo not quantified); F-11 (propagation latency unmeasured) |
| 6. Drift signals | F-12 (5 occurrences flagged); F-13 (T9 built-in waiver); F-14 (out-of-band drift); F-15 (OQ-PLAN deferral drift) |
| 7. Evidence quality | F-04 (no evidence curl works); F-05 (silent ordering choice); F-06 (waivers hand-waved); F-08 (no evidence Admin SDK access ready); F-10 (vibes estimate); F-15 (OQ-PLAN-4 evidence punted twice) |

No axis is "no objection found". This plan has surface area worth attacking on every vector.

---

# Verdict

## Strong objections (must address before /build)
- **F-01**: T1 self-locking --- add escape-hatch + real-ADR-052 fixture test.
- **F-02**: T3 stub is fake-vertical --- move T1/T2 tests to T5 OR ship DB-interface in T3.
- **F-03**: T6a/T6b broken-state window --- merge as one PR OR add explicit no-apply-until-T6b gate.
- **F-04**: T6b curl baseline measures the wrong thing --- replace with emulator-based or post-wire measurement.

## High-priority (strongly recommended before /build)
- **F-05**: ADR-NNN ordering --- swap T1/T2 OR document exemption.
- **F-06**: Split T3, T5, T13 waivers. Concede T8 as marginal.
- **F-07**: T10 race test is documentation --- rename or build fault-injection.
- **F-08**: T12 runtime env (laptop vs Cloud Build) --- specify.
- **F-09**: T14 7d-watch clock-start point --- define as T-WIRE-PROD-APPLY.
- **F-10**: Wall-clock estimate --- separate PO-active time from calendar time (~10 days end-to-end).
- **F-11**: T7 rollback --- measure real propagation latency; document mid-flow UX.

## Residual risks (accept and document)
- **F-12**: Drift vocabulary occurrences --- annotate each with justification.
- **F-13**: T9 CI integration --- pre-decide, do not soft-waiver.
- **F-14**: Out-of-band tasks --- promote #1, #2, #4 into critical path.
- **F-15**: OQ-PLAN-1..4 --- resolve pre-build, not "during".
- **F-16**: T11 dependency optimization --- unblock from T7.
- **F-17**: No alternatives section --- add even brief.
- **F-18**: Smoke E2E test accounts --- document.
- **F-19**: Cost-to-undo at day 30 --- quantify customer-impact dimension.

## Out of scope for this review
- The spec itself (v2 Approved --- DA review already passed).
- ADR-052 Status flip mechanics (gated by Sprint-2b T13 canary).
- OQ-2C-1..9 resolutions (covered in oq-research.md DA-equivalent process).

---

**Conclusion**: I could not find a "no objection" on any of the 7 axes nor any of the 12 user-listed vectors. The plan has structural integrity at the 14-task level but multiple sub-task framings are either fake-vertical-slices, missing-evidence, or carrying soft-waivers labeled as acceptance criteria. The 3-4 day estimate is the most misleading number --- calendar reality is closer to 10 days because T14 cannot ship faster than the 7-day watch elapses.

Reformulate F-01..F-04 mandatorily. Reformulate F-05..F-11 strongly recommended. The remaining F-12..F-19 are documentation hygiene.

I do NOT approve the plan. I have raised substantive objections across all seven axes and across all 12 vectors the user named. Strong-objection count: **4 P0 + 7 P1 = 11**. Residual risks to accept: **8 P2**.

---

# Devils-advocate review v2 --- sec-001-h1-2-google-blocking plan.md --- 2026-05-26T23:55:00Z

> Adversarial pass on plan v2 (16 tasks). The v2 redraft addresses the 19 v1 findings with documentation. My job: verify the fixes are mechanically correct, not just textually present, and surface new issues the redraft introduced. I assume each fix is wrong until each load-bearing claim has been challenged and survived. Strong-objection count target: ≥ 1 per axis or one per user-listed vector.

---

## V2 Findings index

- **P0** (block /build): G-01, G-02, G-03, G-04, G-05
- **P1** (high risk): G-06, G-07, G-08, G-09, G-10, G-11
- **P2** (residual / hygiene): G-12, G-13, G-14, G-15, G-16

I find **5 P0 + 6 P1 + 5 P2 = 16 substantive new objections**. F-01..F-19 each get a verdict (Fixed / Partially Fixed / Not Fixed / Regression).

---

## G-01 [P0] F-01 NOT fixed: T2 test (e) is observationally vacuous, plus regex is brittle against the post-flip format and the pending ADR-castellanization followup.

**Vector**: user item #1 (F-01 fix verification).

Three independent flaws in T2.

### 1.1 Test (e) proves the wrong thing

T2 acceptance (e) is: "integration test que abre actual `docs/adr/052-signup-migration-admin-sdk-gate.md` from filesystem → expect exit 1 (current state Proposed)".

T2 runs at PR time, **before** ADR-052 ever flips to Accepted. The test asserts "current ADR-052 is Proposed → exit 1". This is **circular**: it only proves "current state matches expected current state". It does not prove the regex matches the future Accepted format. The actual fragile failure mode (regex too strict to match the post-flip format) **remains untested**.

A reviewer reading test (e) will believe the script is verified against real-world content. It is not. Test (e) is theater.

**Reformulation**: add test (f): a synthetic fixture cloned from ADR-053's actual Accepted format line — `- **Status**: Accepted (post-canary success cloudbuild run <ID>)` — assert exit 0. **Plus** add a snapshot from ADR-052 §"Acceptance criterion" line 116 ("docs(adr-052): Accepted post-canary success cloudbuild run <ID>") so the commit-message-derived line that will replace line 3 is the exact synthetic fixture.

### 1.2 Regex is anchored to `- **Status**:` but Booster ADRs use ≥ 3 formats

I checked the actual ADR corpus:

| File | Line 3 form |
|---|---|
| ADR-035 | `**Status**: Accepted` (no leading `-`) |
| ADR-051 | `**Estado**: Accepted` (Spanish, no `-`) |
| ADR-052 | `- **Status**: Proposed (2026-05-26; T6...)` |
| ADR-053 | `- **Status**: Accepted (2026-05-25; T4 one-shot...)` |

The T2 regex `^- \*\*Status\*\*:\s*Accepted` over lines 1–10 will match ADR-052/053 only. That is sufficient for T2's narrow scope (the script reads ADR-052 by hardcoded path), but the script's hardcoded path + hardcoded regex is brittle in two ways the plan does not acknowledge:

- If someone amends ADR-052 to add `## Status history` markdown above line 3 (per ADR-046 supersession pattern), line 3 shifts → script falsely reports Proposed.
- The `lines 1–10` window is arbitrary and breaks silently if header changes.

### 1.3 Pending followup `castellanizar-adr-headers` is a permanent landmine

`.specs/_followups/castellanizar-adr-headers.md` is a pending PO-approved followup that will rename `Status` → `Estado` and `Date` → `Fecha` across 28 historical ADRs. If this followup ships **at any point during or after Sprint 2c**, the regex `^- \*\*Status\*\*:\s*Accepted` permanently stops matching ADR-052 — silently re-blocking all PRs touching `apps/auth-blocking-functions/**`.

The plan does not mention this followup. Either:
- (i) the script must also match `^- \*\*Estado\*\*:\s*Accepted` (alternation in regex), OR
- (ii) `castellanizar-adr-headers` followup must declare an explicit exclusion for ADR-052 until Sprint 2c is closed, OR
- (iii) T2 acceptance must include a defensive test that asserts both `Status` and `Estado` are recognized.

None is done. Sprint 2c will silently break the day castellanization ships.

### 1.4 Verdict

F-01 is **NOT fixed**. T2 test (e) is observationally vacuous; the regex is brittle against ≥ 2 known future events (post-flip format, castellanization); the escape-hatch in runbook (T13) is documented but T13 ships **after** the gate is active, so any T1+T2 bug found in the window between T2 merge and T13 merge has no documented bypass.

---

## G-02 [P0] F-02 NOT mechanically enforced: dependency chain between T3b/T5b/T7 is documented in prose but not gated by CI or path-based protection.

**Vector**: user item #2.

T3b ships `handler.ts` with provider check + early-return + **no DB code**. T5b adds DB lookup + fail-closed. T7 wires the function to Identity Platform `blocking_functions.triggers.beforeCreate`.

Between T3b merge and T5b merge, `handler.ts` in `main` has: `if (providerData !== google.com) return; // else: nothing`. If T7 wire happens in this window (e.g., PO accidentally cherry-picks T7 PR or rebases out of order), every Google signup attempt early-returns **without any DB check**, defeating the entire Sprint 2c objective. The bug fails open.

The plan says (line 175): `T6 Depends on: T5b merged (handler complete)`. That is documented but not enforced. The mechanical CI gate (T2) checks **only ADR-052 Status**, not the dependency order T3a→T3b→T4→T5a→T5b→T6→T7. Nothing in the plan prevents an out-of-order merge if the PO operates under pressure.

**Concrete failure scenario**: T5b PR is open with a flaky test. T6 PR is open and green. PO merges T6 first thinking "infra is independent, handler tests can land separately". Apply happens. T7 PR also green. PO merges T7. Production now has the function deployed and wired, but with the T3b stub handler (no DB code), every Google signup attempt early-returns (allow). Sprint 2c shipped but does nothing.

**Reformulation**:
- Add to T6 acceptance: "`handler.ts` line count > 70 AND grep `solicitudes_registro` returns ≥ 1 occurrence" mechanical check in workflow.
- Add a workflow `sprint-2c-handler-completeness.yml` that runs on PRs touching `infrastructure/auth-blocking-functions.tf` or `infrastructure/identity-platform.tf` and fails unless `apps/auth-blocking-functions/src/handler.ts` contains the DB query call.
- Or simpler: explicitly delay T6 PR creation until T5b is merged to main, and document this in the runbook with a checklist.

The current plan dependency is honor-system. Honor-system fails under solo-developer fatigue.

### Verdict

F-02 is **partially fixed at the documentation layer, NOT fixed at the enforcement layer**. The fake-vertical-slice is gone (T3b's tests are scoped only to T4 provider check, which is honest). But the cross-task dependency that the redraft created (T3b → T5b → T6 → T7) introduces a new failure mode that v1 did not have: a partially-shipped handler reaching prod via mis-ordered merges.

---

## G-03 [P0] F-03 NOT fully fixed: T6 single-PR merge eliminates the broken-PR window but creates a worse broken-APPLY window with no rollback for the deploy half.

**Vector**: user item #3.

T6 merges (a) Terraform infra and (b) Cloud Build deploy step into one PR. Plan claims this is atomic. It is not.

**Apply has 2 sequential operations**:
1. `terraform apply` creates `google_cloudfunctions_function.enforce_signup_approval` resource with `source_archive_object` (likely pointing to a fresh upload of build output).
2. Cloud Build `deploy-auth-blocking` step runs `gcloud functions deploy`.

If step 1 succeeds and step 2 fails (compile error in handler.ts surfacing only in `gcloud functions deploy` runtime checks, or transient Cloud Build infra failure), the GCP API state has a function record with either:
- A `sourceArchiveUrl` pointing to an empty/stale archive (broken function), OR
- No sourceArchive at all if `lifecycle.ignore_changes = [source_archive_object]` is honored before Cloud Build runs.

T6 acceptance line 179 says: "Apply ejecutado post-merge + Cloud Build trigger ejecutado → `gcloud functions describe` retorna non-empty sourceArchiveUrl + status ACTIVE + non-empty httpsTrigger.url". This is a **check**, not a **guarantee**. If the check fails, the plan provides no rollback path for step-2 failure — the rollback (line 182) is `terraform destroy -target=...`, which destroys the resource entirely, leaving no function endpoint for T7 to wire to.

**Worse**: T6 acceptance does not specify which of the two operations (terraform apply OR Cloud Build) is the source of truth for "the function is shipped". If terraform applies but Cloud Build silently fails (no notification configured?), T6 looks shipped but is broken. T7 then tries to wire to an endpoint that exists in TF state but is functionally broken.

**Reformulation**:
- T6 acceptance must include: a post-apply smoke `curl -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$FUNCTION_URI"` that exercises the function with a stub event and asserts it returns 200 (or expected HTTP-level response). Without this, "ACTIVE" status only means the GCP API thinks the function exists, not that the deployed archive contains valid code.
- Document the rollback for "terraform applied but deploy failed": (a) re-run Cloud Build trigger, OR (b) `gcloud functions deploy --source=...` manually with last-known-good archive.

### Verdict

F-03 is **partially fixed at the merge layer, NOT fixed at the apply layer**. Single PR merge eliminates the gap-in-source-tree problem v1 had. It does not eliminate the gap-in-deployed-state problem. The broken state moved from "two PRs merged out of order" to "one PR merged, but the second of two apply operations failed silently".

---

## G-04 [P0] F-04 NOT fixed: T7 baseline strategy contradicts spec SC-2C.4 (drops the OR-clause) and is structurally impossible to satisfy at Booster's signup volume.

**Vector**: user item #4.

Spec SC-2C.4 (line 36 of spec.md, verbatim):

> Verificable vía Cloud Monitoring metric `cloudfunctions.googleapis.com/function/execution_times`. **first 10 invocations OR 7-day window post-launch, whichever comes first**.

T7 plan acceptance line 198 (verbatim):

> "post-Smoke E2E, query Cloud Monitoring metric `cloudfunctions.googleapis.com/function/execution_times` over **first 10 real invocations** → assert p95 < 1500 ms (SC-2C.4)."

The plan **drops the 7-day window OR-clause**. This is not a minor wording slip — it inverts the SC.

At Booster TRL 10 volume (spec line 44 implies < 10 Google signups/month legitimate), waiting for **10 real invocations** could take 30+ days. T14 closure waits for 7-day post-`T-WIRE-PROD-APPLY`; if the baseline metric is "first 10 real invocations" and only 2 invocations happen in the 7-day window, **SC-2C.4 cannot be verified at T14 closure time**.

Additionally: T7's smoke E2E (Account A negative + Account B positive) generates **2 invocations** on production. After T7 apply, those 2 are the entire production sample. The remaining 8 invocations must come from real-user traffic, at < 1/day. T14 ships before the baseline is statistically meaningful.

**Worse for fail-closed**: if a smoke E2E user is the *first* Google signup post-wire, the baseline measurement includes a cold-start invocation, biasing p95 upward.

**Reformulation**:
- Align T7 acceptance to spec SC-2C.4 exactly: `OR 7-day window`. State explicitly what happens if < 10 invocations occur in 7 days (e.g., "if n < 10 by T-WIRE-PROD-APPLY + 7d, document n + observed p95 + extend baseline window to 14d with PO sign-off").
- Acknowledge in T7 that the smoke E2E invocations count toward the 10 (or document explicitly that they do not).
- If invocations are too sparse, fall back to T9 emulator baseline as the load-bearing metric and use prod measurement as advisory only.

### Verdict

F-04 is **NOT fixed**. The v1 problem (curl baseline measures rejection latency, not handler perf) is replaced with a different problem (insufficient real-world sample to compute p95 in the spec-allowed window). T9 Firebase emulator baseline is good and addresses one half of F-04. T7 production baseline contradicts the spec and is impractical.

---

## G-05 [P0] NEW issue surfaced by v2 redraft: T11 dependency claim is factually wrong.

**Vector**: user item #5.

T11 plan acceptance line 272 says T11 depends on "T4 merged (just for `'BLOCKED_SIGNUP_PENDING_APPROVAL'` constant export from shared)".

This is wrong on two counts:

### 5.1 T4 does not contain that constant

T4 scope (line 116) is `email-normalize.ts` + `email-normalize.test.ts` + a `handler.ts` modify that imports `normalizeEmail`. The throw site is in **T5b** (line 148: `if no rows throw permission-denied`). The constant `BLOCKED_SIGNUP_PENDING_APPROVAL` is referenced in spec §10 T1 (line 340 of spec.md: `throw HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`), which lands in T5b, not T4.

### 5.2 The constant probably lives in handler.ts, not in shared-schemas

The plan claims the constant is exported "from shared" (i.e., `packages/shared-schemas`). But the spec only references it as the second argument to `HttpsError`. There is no plan task that creates this constant in shared-schemas. Neither T4 nor T5b mention `packages/shared-schemas` modification.

So T11 dependency on "T4 merged for the constant" is wrong on three layers: (i) wrong task (should be T5b), (ii) wrong location (handler.ts internal string literal, not exported from shared), (iii) the spec text suggests the constant is an HttpsError message string, not a typed exported constant.

### 5.3 Consequence for parallelism

The F-16 v1 fix said "T11 doesn't depend on T7". Plan v2 reinstates a different dependency on T4. If T11 is genuinely independent (string-match on FirebaseError message), it depends on **nothing in the function side at all** — it could ship in parallel with T2 even. Conversely, if T11 must use a typed constant that is created in T5b, then T11 depends on T5b being merged first.

The plan got both the dependency direction and the source task wrong. T11 cannot be merged in parallel with T5b "for the constant" — the constant doesn't exist at that point.

**Reformulation**:
- Decide: is the string `'BLOCKED_SIGNUP_PENDING_APPROVAL'` a literal duplicated between handler.ts and api-errors.ts (acceptable; document the contract), OR an exported constant from a shared package (add a T5b sub-step to export it)?
- Re-state T11 dependency correctly. If literal duplication is chosen, T11 depends on nothing in this plan and ships in parallel with T1.

### Verdict

This is a **new P0** introduced by the redraft. v1 had T11 incorrectly chained on T7; v2 corrected that, then attached T11 to a task (T4) that has nothing to do with the constant. The fix is broken.

---

## G-06 [P1] F-04 production smoke E2E has a PII / compliance side effect not addressed.

**Vector**: scope and second-order effects.

T7 acceptance Account A (line 196) says: "cuenta Google de prueba creada ad-hoc (e.g., `test-sprint-2c-negative@gmail.com`)". This means PO creates a real Google account at gmail.com for testing.

Issues:
- Booster compliance: Ley 19.628 (Chile privacy law) does not regulate gmail.com accounts directly, but the audit log entries from the negative smoke test will record a `gmail.com` external email in `cloudaudit.googleapis.com/data_access` permanently (GCP audit log retention 400 days). The negative-case email becomes part of Booster's compliance audit trail despite being a test artifact.
- Cleanup: "ad-hoc Google account deleted manually by PO" — but Google does not delete email addresses; the account is disabled, not destroyed. If a future bug ever causes the email to be reused, conflicts with the existing audit trail.
- More importantly: the spec says Identity Platform tenant **does not** create the Firebase user when blocking function denies (SC-2C.2). So the negative smoke produces no row in Identity Platform tenant. But it **does** produce an Identity Platform audit log entry with the external email. Is this expected/acceptable?

**Reformulation**:
- Use a Booster-owned domain test account (e.g., `qa-sprint-2c-negative@boosterchile.com`) instead of `@gmail.com`. PO already controls the domain; cleanup is trivial; no external-PII residue in audit logs.
- Or use a Google Workspace dedicated to QA (which presumably already exists for IT testing).

### Verdict: addresses scope/second-order effects vector.

---

## G-07 [P1] F-08 T8 LOC waiver understated; Cloud Run job documentation missing from acceptance.

**Vector**: user item #6.

T8 (line 208) claims ~110 LOC = 80 script + 30 test, "marginal +10 LOC". But T8 acceptance line 222-225 enumerates 3 execution modes (local laptop, Cloud Run job, Cloud Build trigger), each with non-trivial operational documentation:

- Cloud Run job: deploy command + IAM (SA needs `roles/cloudsql.client` + Secret Manager access) + execution semantics + log retrieval.
- Cloud Build trigger: build config + cloudbuild.yaml step + trigger invocation.

None of this is in the T8 file list. T8 ships the script + test only. The Cloud Run job deployment is mentioned in T12 dependencies (line 286: "Cloud Run job created (per T8 execution context option 2)") but T8 does not create the Cloud Run job — only documents how to.

So either:
- T8 underspecifies operational artifacts (Cloud Run job IaC / deploy command is missing from T8 files), OR
- T12 silently requires non-T8 work to ship a Cloud Run job before T12 can execute.

If the Cloud Run job is created ad-hoc (gcloud one-shot, not in TF), then there is a deployment artifact in production with no IaC representation — that violates Booster's "100% IaC" principle.

**Reformulation**:
- Add to T8 files: a `infrastructure/cloud-run-jobs.tf` entry (or whatever the Booster convention is) defining the inventory job as IaC.
- Or accept the gcloud one-shot pattern with explicit waiver to the IaC rule, documented in runbook.
- Update T8 LOC estimate to reflect actual scope (~140-150 LOC including IaC).

### Verdict: confirms user's concern. Waiver understated by ~30-40 LOC.

---

## G-08 [P1] Out-of-band #2 (memory file) is unreliable as designed.

**Vector**: user item #7.

OOB #2 (line 340): "Memory file update: ... feedback_sprint_2c_pattern.md ... Owner: Claude (next session). Trigger: Post-T7 successful apply."

Problems:
- Claude (this session) writes the OOB. Claude (next session) reads `MEMORY.md` index and would only know about this task if it was already added to the index. The OOB does not specify who adds the index entry.
- "Post-T7 successful apply" trigger — no calendar reminder, no PR check, no ledger entry pinned. If the next session doesn't proactively look at OOB lists, the memory file is never written.
- The session that DOES write the memory file is unknown — could be next session, could be 5 sessions later.

This is the same "honor-system" problem as G-02. Solo-developer mode means there is no second human to remind PO/Claude to do the OOB. Memory files are how the system itself remembers across sessions; relying on memory-file creation as an OOB is circular.

**Reformulation**:
- Convert OOB #2 to a hard task (e.g., T15) with explicit acceptance: "create `~/.claude/projects/.../memory/sprint_2c_pattern.md` + append entry to MEMORY.md index".
- OR delete OOB #2 entirely with explicit waiver "lesson-learned capture deemed not load-bearing".

### Verdict: confirms user's concern. OOB #2 should be either a real task or removed.

---

## G-09 [P1] F-09 7-day clock-start has no protection against reset scenarios.

**Vector**: user item #11.

T14 clock-start (line 325): "`T-WIRE-PROD-APPLY` = timestamp recorded en T7 `sprint-2c-evidence/t-wire-prod-apply.txt`."

The plan does not address:
- **Re-apply scenario**: PO runs `terraform apply` a second time between T7 and T14 (e.g., for an unrelated infrastructure change that touches identity-platform.tf). Does the clock reset? Best practice: yes, because the wire was re-applied even if value unchanged. Plan: silent.
- **Rollback-and-re-wire scenario**: a Cloud Monitoring alert fires day 3 of 7. PO executes T7 rollback Step 1 (admin API PATCH `blockingFunctions: {}`). Issue fixed by day 5. PO re-applies. New 7-day clock or continuation of original? Plan: silent.
- **Clock-start file mutability**: `t-wire-prod-apply.txt` is in `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/`. Nothing prevents PO from accidentally editing it. The file is also not signed/checksummed.

**Reformulation**:
- Add to T14 acceptance: "clock-start file is immutable; if re-apply happens, new file `t-wire-prod-apply-v2.txt` is created with new timestamp; T14 considers MAX(timestamp) of all `t-wire-prod-apply-*.txt` files".
- Document the rollback-and-re-wire semantics explicitly: reset clock or continue, with PO sign-off rationale.

### Verdict: F-09 fix is incomplete. Clock-start defined but reset rules not.

---

## G-10 [P1] OQ-PLAN-3 Identity Platform SA email is a CONJECTURE, not verified.

**Vector**: user item #8.

Plan line 349 claims the SA email is verified: `service-469283083998@gcp-sa-identitytoolkit.iam.gserviceaccount.com`.

But the only verification mentioned is: `gcloud projects describe booster-ai-494222 --format='value(projectNumber)'` returns 469283083998. That confirms the project number, not the SA email format.

The exact SA pattern `service-{PROJECT_NUMBER}@gcp-sa-identitytoolkit.iam.gserviceaccount.com` is **typical** of Google-managed service agents. But Identity Platform (vs Firebase Auth, vs Google Cloud Identity Toolkit) has historically had several naming patterns:

- `firebase-auth-blocking-prod@system.gserviceaccount.com` (Firebase docs older)
- `service-{PROJECT_NUMBER}@gcp-sa-identitytoolkit.iam.gserviceaccount.com` (current GCP convention)
- `service-{PROJECT_NUMBER}@gcp-sa-firebaseauth.iam.gserviceaccount.com` (alternative observed pattern)

Without running `gcloud iam service-accounts list --filter="email~identitytoolkit" --project=booster-ai-494222` against the live project, the SA email is a guess. T6 apply will fail at the IAM binding step if the actual SA differs.

OOB #5 (line 343) does mention "OQ-PLAN-3 SA email exact verification: post-T6 init confirm". But "post-T6 init" is too late — T6 init means terraform plan with the wrong SA reference, which **silently passes plan** (Terraform does not validate SA existence until apply). The validation must happen **pre-T6 PR creation**, not post-T6 init.

**Reformulation**:
- Pre-T6 PR creation, run `gcloud iam service-accounts list --filter="email:*identitytoolkit*" --project=booster-ai-494222 --format='value(email)'` and record exact email in `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/idp-sa-email.txt`.
- T6 references that file's content, not a conjectured pattern.

### Verdict: confirms user's concern. OQ-PLAN-3 is unresolved per the plan's own evidence standard.

---

## G-11 [P1] OQ-PLAN-1 CI-gate gap accepted silently; T9 manual corrida pre-merge bypassable.

**Vector**: user item #9.

OQ-PLAN-1 resolved (line 347): "manual corrida pre-merge documented en runbook." T9 acceptance (line 243): "if emulator startup < 30s, integrate CI; else corrida manual pre-merge documented en runbook."

This means:
- Future PRs touching `apps/auth-blocking-functions/src/handler.ts` may merge without T9 emulator tests running, as long as PO claims "I ran them manually."
- There is no CI check that confirms emulator tests actually ran. PO honor system again.
- T9 acceptance line 243 is conditional ("if emulator startup < 30s") but the OQ-PLAN-1 resolution preempts the conditional with "manual corrida" anyway. The conditional is dead code.

For a function whose entire purpose is fail-closed signup blocking, accepting no CI gate on the integration tests is risk-asymmetric. Future regressions (e.g., DB query removed, or normalization regression) ship to prod without CI catching them.

**Reformulation**:
- Accept the manual-corrida pattern with explicit waiver + commit hook: every PR touching `apps/auth-blocking-functions/**` requires a commit trailer `Manual-emulator-tests-run: <timestamp>` validated by a workflow.
- Or invest the 1-2 minute CI cost (per OQ-PLAN-1 cost estimate) and integrate emulator tests in CI; the cost is bounded.

### Verdict: confirms user's concern. Coverage gap accepted without explicit waiver.

---

## G-12 [P2] F-07 T10 "race-documents-invariant" rename is partially cosmetic.

**Vector**: user item #10.

T10 race-documents-invariant test (line 251) has 3 sub-tests:
- Test 1 commit-order-A: approve commits first → signup allowed.
- Test 2 commit-order-B: signup first → denied; subsequent approve → retry allowed.
- Test 3 (optional fault-injection): `pg_sleep(2)` to demonstrate MVCC.

Tests 1 and 2 are assertions on **behavior** (the test fails if commit-order-A allows the wrong thing). Calling them "documents the invariant" is rhetorical. They are tests. The plan's distinction between "test" and "documentation" is not load-bearing.

Test 3 (pg_sleep fault-injection) is explicitly "optional" and a stronger form of documentation. But marking it optional means it may not ship → the invariant relies on tests 1+2 which test outcome not race.

**Reformulation**:
- Drop the "documents the invariant" framing. Call it `race-condition-resolution.test.ts` and keep the 3 tests.
- Or if the goal is documentation, separate: a `RACE-CONDITIONS.md` doc that explains the invariant, plus a focused test file that asserts MVCC behavior.

### Verdict: cosmetic. Not a P0/P1 risk but should be cleaned up.

---

## G-13 [P2] Alt-E naming collision between plan §Alternatives and spec §8.

**Vector**: user item #12.

Confirmed: spec §8 Alt-E rejects "accept residual permanently". Plan §Alternatives Alt-E rejects "Defer T8 ghost inventory + T12 execution to post-ship".

Different decisions, same letter. Confusing for any reader cross-referencing spec and plan during /review or /ship.

**Reformulation**: rename plan alternatives to Alt-P1..P5 (plan-prefix) or use descriptive labels (Alt-Defer-Inventory, Alt-Merge-T1T2, etc.).

### Verdict: hygiene. Quick fix.

---

## G-14 [P2] 16 tasks exceeds skill §107 threshold; "breadth of components" is not a refutation, it's a description.

**Vector**: user item #13.

Skill §107 (planning-and-task-breakdown): "15+ tasks means feature too big". v2 has 16. Plan line 387 acknowledges this but justifies as "16 tasks reflect breadth of components".

That is restating the count, not refuting the rule. The rule exists because a 16-task feature has more failure modes than a 7-task feature: more dependency edges (16!/((16-2)!*2!) = 120 possible pair dependencies vs 21 for 7 tasks), more PR review fatigue, more merge windows.

The natural split per the user's hint:
- **Sprint 2c-A** (5-6 tasks): T1+T2 (ADR + gate) + T3a+T3b+T4+T5a+T5b (handler complete). End state: handler module exists in repo, tested, not deployed.
- **Sprint 2c-B** (8-10 tasks): T6+T7+T8+T9+T10+T11+T12+T13+T14. End state: deployed, wired, monitored, ADR Accepted.

The Sprint 2c-A → Sprint 2c-B split has a natural boundary (handler-built vs handler-deployed) that mirrors the ADR-052 (build) → ADR-053 (deploy) Sprint 2b precedent.

**Reformulation**: explicit decision required. Either accept the 16-task plan with risk-acknowledgment (calendar slip risk, dependency-edge complexity) or split.

### Verdict: user is correct. The "breadth" justification is non-refutation. Decision should be revisited.

---

## G-15 [P2] T11 substring-match pattern has Firebase SDK version drift risk.

**Vector**: failure modes.

T11 uses `error.message.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')` to detect the blocking-function rejection. Firebase Auth SDK's error message format for `auth/internal-error` is not part of the stable public API. SDK upgrades may change message format (e.g., wrap in additional JSON, strip the custom string, add prefixes like `[code: BLOCKED_SIGNUP_PENDING_APPROVAL]`).

If SDK changes message format, T11 silently regresses to the generic Spanish fallback — users get a generic error instead of "Tu cuenta está pendiente de aprobación". Hard to detect: no log signal because the substring just doesn't match.

**Reformulation**:
- Pin firebase JS SDK exact version in apps/web (likely already pinned per Booster conventions).
- Add a contract test: on every firebase SDK upgrade PR, T11 test must run with mocked Firebase emulator error to confirm substring-match still works.
- Document the SDK-version coupling in the runbook.

### Verdict: F-16 v1 fix focused on parallel-ok; this is a separate residual risk.

---

## G-16 [P2] Plan v2 lacks an explicit definition of "Sprint 2c shipped".

**Vector**: premise.

Looking across T7 (function wired), T13 (docs), T14 (ADR flip 7d later), what is "Sprint 2c ship"? Three candidate definitions:

- (a) T7 apply ejecutado (function live in prod, blocking signups).
- (b) T13 docs merged (runbook complete, CURRENT.md updated).
- (c) T14 ADR flipped to Accepted (7-day watch passed).

The plan uses "ship" ambiguously. CURRENT.md update in T13 implies (b); "Sprint 2c CERRADO" in T14 implies (c); F-10 wall-clock calc uses (c).

For PO communication and for the SC-1.2.2 amendment transition (TRACKED_RESIDUAL → MET), this matters. If a stakeholder asks "is Sprint 2c shipped" at day T7+1, the answer differs by which definition.

**Reformulation**: add a §Definitions block to plan v2 specifying "Sprint 2c ship = T7 apply + T13 docs merged (operational ship). Sprint 2c CERRADO = T14 ADR flipped + amendment A3 MET (formal closure)."

### Verdict: hygiene. Sprint 2b made this distinction explicit via "H1.2 CERRADO" pattern.

---

## Findings ledger (v2)

| ID | Pri | Vector | F-XX-v1 link | Verdict on prior fix |
|---|---|---|---|---|
| G-01 | P0 | F-01 verification | F-01 | NOT fixed (3 sub-issues: vacuous test, brittle regex, castellanization landmine) |
| G-02 | P0 | F-02 verification | F-02 | Doc-only; enforcement gap |
| G-03 | P0 | F-03 verification | F-03 | Merge-window closed; apply-window open |
| G-04 | P0 | F-04 verification | F-04 | Drops spec OR-clause; impractical sample size |
| G-05 | P0 | T11 dep | F-16 | Wrong task; regression from v1 |
| G-06 | P1 | scope/2nd-order | — (new) | gmail.com PII in audit |
| G-07 | P1 | LOC waiver | F-06+F-08 | T8 understated ~30-40 LOC |
| G-08 | P1 | OOB reliability | F-14 | OOB #2 unreliable |
| G-09 | P1 | clock-start | F-09 | Reset rules undefined |
| G-10 | P1 | OQ-PLAN-3 | F-15 | SA email is conjecture |
| G-11 | P1 | OQ-PLAN-1 | F-15 | CI gap accepted silently |
| G-12 | P2 | T10 framing | F-07 | Partially cosmetic |
| G-13 | P2 | Alt-E naming | F-17 | Letter collision |
| G-14 | P2 | task count | §107 | Should split |
| G-15 | P2 | SDK drift | new | Firebase SDK format coupling |
| G-16 | P2 | ship definition | new | "shipped" ambiguous |

Total: **5 P0 + 6 P1 + 5 P2 = 16 strong objections + residual risks**.

---

## 7-axis frame (v2)

### 1. Premise
The plan assumes (i) the 16-task atomic-vertical-slice pattern scales without losing dependency safety, (ii) "honor-system" dependency ordering is sufficient in solo-dev mode, (iii) the SA email naming pattern is empirically known. Each assumption has at least one failure mode (G-02, G-10). Most painful if false: SA email conjecture (G-10) — fails terraform apply at T6.

### 2. Scope and second-order effects
T7 negative-smoke account leaks gmail.com PII into audit logs (G-06). T6 Cloud Run job for T8 is not in IaC (G-07). castellanizar-adr-headers followup permanently breaks the T2 gate (G-01.3). None of these is acknowledged in plan v2.

### 3. Alternatives discarded
Plan v2 added §Alternatives. Alt-A..E covers reasonable rejection set. But Alt-Split-Sprint-2c-A-2c-B (per skill §107) is not considered (G-14). Alt-merge-T1+T2 rejection valid; Alt-D rejection valid.

### 4. Failure modes
- F1 (G-02): out-of-order merge T6/T7 before T5b ships handler DB code → silent fail-open.
- F2 (G-03): terraform apply succeeds, Cloud Build deploy fails → function exists with broken/missing archive.
- F3 (G-04): production sample insufficient for SC-2C.4 verification within 7-day T14 window.
- F4 (G-10): T6 apply fails at IAM binding step (wrong SA email).
- F5 (G-01.3): castellanization followup silently breaks gate.
- Each has a documented mitigation gap.

### 5. Reversibility
T7 rollback (5 min Admin API) is well-documented. T8 ghost cleanup (T12) day-30 undo cost is documented (F-19 fix accepted, see G-no objection). T14 ADR flip rollback documented. **Gap**: re-apply / re-wire semantics for clock-start (G-09).

### 6. Drift signals
Scanned plan v2 for: "for now", "MVP", "later", "quick fix", "good enough", TODO/FIXME. Found:
- "default per Sprint 2a precedent" (line 226) — fine, references precedent.
- "raise post-baseline if needed per OQ-2C-2 resolution" (line 165) — soft commitment, but has explicit trigger (OQ-2C-2 resolution).
- "complexity > value for Sprint 2c critical path" (line 347) — soft drift in OQ-PLAN-1 (G-11).
- No `TODO` / `FIXME` strings found.
- Overall: cleaner than v1 on this axis.

### 7. Evidence quality
| Claim | Evidence | Verdict |
|---|---|---|
| Regex `^- \*\*Status\*\*:\s*Accepted` matches future format | Synthetic fixtures (a)-(d) + test (e) of current state | Weak; test (e) is vacuous (G-01.1) |
| SA email format verified | gcloud projectNumber only | Absent; conjecture (G-10) |
| Single PR atomic deploy avoids broken state | Sprint 2b T8 precedent | Sufficient for merge, weak for apply (G-03) |
| 10-invocation baseline measurable in 7-day window | None | Absent; structurally impossible at Booster volume (G-04) |
| pnpm-workspace pattern catches new dir | Verified in plan OQ-PLAN-2 + I confirmed via `cat pnpm-workspace.yaml` | Sufficient |
| Firebase emulator < 30s startup is acceptable for CI integration | Conditional in T9 acceptance, preempted by OQ-PLAN-1 resolution | Inconsistent (G-11) |

---

## Verdict (v2)

Strong objections that must be addressed before /build:

- **G-01** (T2 test theater + castellanization landmine + regex brittleness).
- **G-02** (T3b→T5b→T6→T7 dependency not mechanically enforced; fail-open risk).
- **G-03** (terraform apply / Cloud Build deploy split with no rollback for deploy-half).
- **G-04** (T7 SC-2C.4 baseline strategy drops spec OR-clause and is impractical at volume).
- **G-05** (T11 dependency on T4 is factually wrong; constant lives elsewhere or doesn't exist).

Strongly recommended before /build:

- **G-06** through **G-11** (gmail PII, T8 LOC understated + missing IaC, OOB memory file unreliable, clock-start reset undefined, SA email conjecture, CI gap accepted silently).

Residual risks (accept and document explicitly):

- **G-12** (T10 framing cosmetic).
- **G-13** (Alt-E naming collision).
- **G-14** (16 tasks should consider 2c-A/2c-B split).
- **G-15** (Firebase SDK message format drift coupling).
- **G-16** (ship definition ambiguous).

Out of scope for this review:

- Spec-level objections (handled in v1 spec review).
- Booster-platform-level concerns (workspace recognition, Biome rules) — verified empirically OK.

**Conclusion**: Plan v2 is better than v1 on documentation, alternatives consideration, and waiver justification. But **3 of the 4 P0 findings (F-01, F-02, F-04) are not fully fixed** — they are addressed at the documentation layer but not the enforcement / mechanical-verification layer. **F-03 is partially fixed**. **F-16 v1 fix introduced a new P0 (G-05)**. The 16-task structure is at the skill §107 limit and the "breadth" justification does not refute the rule. I cannot approve plan v2.

Recommended next step: address G-01, G-02, G-03, G-04, G-05 (the 5 P0) in plan v3 before /build. The redraft cycle does not converge unless mechanical-enforcement is added; documentation-only fixes will continue to surface honor-system failure modes.

I do NOT approve plan v2. **Strong-objection count: 5 P0 + 6 P1 = 11. Residual: 5 P2. Total objections: 16.**

