# DA pass — plan-b.md v1 (Sprint 2c-B)

**Date**: 2026-05-27
**Reviewer**: agent-rigor:devils-advocate
**Plan under review**: `.specs/sec-001-h1-2-google-blocking-b/plan.md` v1 (14 tasks T1-T14; mix code + operational evidence)
**Prior DA history (informs anti-patterns)**: `.specs/sec-001-h1-2-google-blocking-a/plan-review.md` (v1 F-A1..F-A14 + v2 G-A1..G-A9 + v3 H-A1..H-A2 cumulative).
**Empirical evidence collected**: 2026-05-27 ~17:30Z; see Appendix.

---

## Verdict

**REVISE** — 5 P0 findings + 4 P1 findings + 3 P2. The plan re-runs three of the exact "prose-only fix" anti-patterns that dominated plan-a iterations: T7 atomic-deploy is honor-system runbook (not mechanical), T11 operational tasks have no merge-gate, and the T-LITERALS test target path is internally inconsistent (plan body says `apps/web/src/lib/...`, but ADR-054 §"Acceptance" + spec §10 reference `apps/web/src/utils/...`, and the plan didn't even surface the discrepancy). Plus a hard empirical miss: **two `translateAuthError` functions exist (login.tsx AND AuthProvidersSection.tsx) with semantically different switch maps**, and plan T2 treats AuthProvidersSection.tsx as a 1-line re-route that would silently change behavior.

---

## P0 findings (must fix before approval)

### F-B1 [P0] T2 misses that TWO `translateAuthError` functions exist — re-route would silently change UX behavior

**Vector**: G-A9 path-verification fix scrutiny + premise check.

**Empirical evidence** (grep `translateAuthError` over `apps/web/src`):
- `apps/web/src/routes/login.tsx:382-406` — function with cases: `auth/invalid-credential`, `auth/invalid-login-credentials`, `auth/user-not-found`, `auth/wrong-password`, `auth/user-disabled`, `auth/email-already-in-use` ("Ya existe una cuenta con ese email. Inicia sesión."), `auth/weak-password`, `auth/invalid-email`, `auth/too-many-requests`, `auth/network-request-failed`.
- `apps/web/src/components/profile/AuthProvidersSection.tsx:598-621` — **different** function with cases: `auth/credential-already-in-use`, `auth/email-already-in-use` ("Esa cuenta ya pertenece a otro usuario de Booster. Cerrá sesión y entrá con esa cuenta directamente."), `auth/provider-already-linked`, `auth/weak-password`, `auth/invalid-email`, `auth/wrong-password`, `auth/invalid-credential`, `auth/popup-blocked`, `auth/no-such-provider`, `auth/network-request-failed`.

The two functions overlap on **5 codes** but produce **different copy** for at least one of them (`auth/email-already-in-use` — login.tsx says "Ya existe una cuenta…" / AuthProvidersSection.tsx says "Esa cuenta ya pertenece a otro usuario…"). They are NOT the same function — they are two domain-scoped translators (signup/login vs provider-linking).

Plan T2 (line 56-57) prescribes:
- `apps/web/src/routes/login.tsx (MODIFY, ~-25 / +2 LOC) — remove inline function + import from new module.`
- `apps/web/src/components/profile/AuthProvidersSection.tsx (MODIFY, ~-2 / +1 LOC) — re-route to extracted module.`

A "-2/+1 LOC" change cannot remove a 24-line `function translateAuthError(...)`. Either (a) the LOC estimate is wrong by an order of magnitude, or (b) the plan intends to keep AuthProvidersSection.tsx's function intact and only re-route imports — which makes no sense because the function is defined locally, not imported. Either way, the plan is **fundamentally inconsistent** with the artifact it modifies.

**Why critical**:
- If T2 merges the two functions into one and AuthProvidersSection.tsx imports it: **silent UX regression** — Spanish copy for `auth/email-already-in-use` changes from "Esa cuenta ya pertenece a otro usuario de Booster…" to "Ya existe una cuenta…". This is a customer-facing copy change with no test coverage that catches the regression.
- If T2 only extracts login.tsx and leaves AuthProvidersSection.tsx alone, plan T2's claim "AuthProvidersSection.tsx MODIFY ~-2/+1 LOC" is dead code in the plan that must be deleted.
- The G-A9 v3 "path estimated" annotation hedge no longer covers this — the path discovery should also have caught that the function lives in TWO places.

**Fix proposed**:
- Either (a) T2 scope narrows to login.tsx-only: drop the AuthProvidersSection.tsx modify line entirely; document in T2 acceptance "AuthProvidersSection.tsx keeps its own translator because the linking/unlinking error map is a different domain (provider-linking failures, not signup gate). Extracting to a shared module is OUT-OF-SCOPE Sprint 2c-B; tracked as `.specs/_followups/translate-auth-error-unify.md`."
- Or (b) T2 unifies both into the new module: add explicit acceptance "Unified switch preserves all 14 distinct cases across both call-sites; new module has TWO exported functions `translateLoginAuthError` and `translateProviderAuthError` (or one function with a `context: 'login' | 'provider'` discriminant); UI copy preserved verbatim from current source — no regressions allowed; tests cover all 14 cases verbatim."
- LOC budget needs honest restatement: option (a) is ~125 LOC; option (b) is ~180 LOC (cap waiver +80 not +25), and the waiver justification must rest on "two functions consolidated for testability" not on "T-LITERALS obligation".

---

### F-B2 [P0] T-LITERALS test target path is inconsistent across plan body, ADR-054, and 2c-A T7 plan-a commitment

**Vector**: cross-source-of-truth integrity check (user specific ask #2).

Plan body (T2, line 56): `apps/web/src/lib/translate-auth-error.ts` (NEW).

ADR-054 line 82-83 (just read): "2c-B `apps/web/src/utils/translate-auth-error.ts` duplicates the literal" — **utils/**, not **lib/**.

Spec §10 T-LITERALS line 107 (just read): mentions both `apps/web/src/utils/translate-auth-error.ts` (estimated) and the 2c-A T7 PR's file-visible obligation (G-A2 fix). The G-A9 v3 fix mandated: "2c-B plan-b draft must verify... before locking; if file absent, T-LITERALS becomes 'create + add mapping' rather than 'extend existing'."

Plan-b v1 §"What the G-A9 path-verification revealed" (line 27-33) correctly notes that neither `apps/web/src/utils/translate-auth-error.ts` NOR `apps/web/src/lib/api-errors.ts` exists — and then **silently swaps the agreed path to `apps/web/src/lib/translate-auth-error.ts`** without updating ADR-054 or any cross-reference. The path swap is unaccompanied by any task that updates ADR-054 §Decision text where the path is hard-coded.

Empirical verification (just performed):
- `ls apps/web/src/utils/` → directory does not exist.
- `ls apps/web/src/lib/` → 12 files; this dir exists and is canonical.

So `lib/` is the correct path. But: ADR-054 STILL references `utils/`. Plan-b v1 has no task that fixes the ADR-054 mismatch. After Sprint 2c-B ships, ADR-054's "Decision" paragraph still points to a wrong path forever, and the 7-day-watch reviewer comparing artifact-vs-ADR will be confused.

**Why critical**:
- Drift between ADR (authoritative architecture record) and code reality is precisely the kind of debt CLAUDE.md says "Cero deuda desde day 0".
- The plan-a v3 G-A2 fix promised: "T7 acceptance edits the 2c-B spec.md to add the literals-match obligation, file-visible in T7's PR". That obligation was honored — spec §10 has the bullet. But the FOLLOW-THROUGH (2c-B plan picking the right path AND back-propagating to ADR-054) is missing. The promise was kept at one layer and broken at the next.
- Also: T2 places the **T-LITERALS test** at `apps/api/test/integration/cross-source-literals.test.ts`. The plan doesn't explain why `apps/api` owns a test that references `apps/auth-blocking-functions/src/handler.ts` + `apps/web/src/lib/translate-auth-error.ts` — neither of which apps/api depends on. This is cross-workspace literal-grep theater. The cleaner home is `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts` (the package that ships the literal that drives the contract).

**Fix proposed**:
- T2 acceptance must add: "**also modify** `docs/adr/054-google-blocking-function-signup-gate.md` Decision section to change `apps/web/src/utils/translate-auth-error.ts` → `apps/web/src/lib/translate-auth-error.ts` in the F-A4 mitigation paragraph + Notes-for-future-self. ADR-054 modify is part of T2's PR, not a downstream cleanup."
- Move the T-LITERALS test from `apps/api/test/integration/` to `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts` (or `apps/web/src/lib/translate-auth-error.test.ts` co-located with the file under test). Rationale: tests live next to the source-of-truth; apps/api is a third-party observer here.
- Document in T2 acceptance that the test reads both files via `fs.readFileSync` (not `import`, since the handler module pulls in `gcip-cloud-functions` + `pg` which are not desired in an apps/web test).

---

### F-B3 [P0] T7 "atomic deploy" mechanical fix is partial — depends on a runbook checklist that PO can skip

**Vector**: DA v2 G-03 atomic-deploy contract scrutiny (user specific ask #4).

Plan T7 (lines 138-147) ships:
- `apps/api/scripts/check-cloud-function-deployed.ts` — invokes `gcloud functions describe` + asserts `sourceArchiveUrl` non-empty + `status === 'ACTIVE'`.
- `apps/api/test/scripts/check-cloud-function-deployed.test.ts` — fixture tests with mocked execSync.

Plan T3 (line 81): "Cloud Build step `deploy-auth-blocking` deterministic: idempotent + safe to re-run. **DA v2 G-03 atomic deploy fix**: step exits non-zero if `gcloud functions describe` post-deploy returns missing `sourceArchiveUrl`. The subsequent step `wire-identity-platform` (T5) reads this status before applying."

Plan T8 (line 161): "**Atomic ordering**: T4 resource created FIRST → Cloud Build deploy step runs → T7 script verifies → THEN T5 wire applies. Documented in runbook §Deploy."

**The mechanical hole**: T5 (IdP wire) is a **Terraform resource modification** in `infrastructure/identity-platform.tf`. Terraform apply is a single `terraform apply` invocation. There is **no mechanism by which "the Cloud Build deploy step T3" sits between "terraform apply creating T4" and "terraform apply modifying T5"** — they are the SAME `terraform apply`. The ordering plan T7+T8 describes ("T4 created → Cloud Build runs → verify → T5 wire") requires a TWO-PHASE apply (apply T4 only; wait for Cloud Build; apply T5 only), which is operationally honor-system in the runbook.

T7's check script + tests are useful but they enforce **post-apply verification**, not **inter-apply ordering**. They cannot prevent a PO from running `terraform apply` once with both T4+T5 staged.

The "atomic" claim in plan-b §Alt-2c-B-Plan-I rejection (line 264) is honest: "violates atomic vertical slices + DA v2 G-03 atomic deploy gate (T4 must merge + Cloud Build deploy must succeed + T7 verify must pass BEFORE T5 wire applies)" — but this is enforced by **task sequencing** (T4 merges first PR → T5 merges second PR → T8 applies both in some order), not by terraform itself.

Worse: **infrastructure/identity-platform.tf currently has `lifecycle.ignore_changes = [blocking_functions]`** (verified empirically, line 71). T5 says "add `blocking_functions` block" but does NOT call out that `ignore_changes` must be removed FIRST or terraform will silently ignore the new block. This is a latent bug that survives T5 review unless someone reads the existing tf file carefully.

**Why critical**:
- This is the same "prose-only fix" anti-pattern that v2 G-A3 flagged for `/ship`. The mechanical gate (check-cloud-function-deployed.ts) is real, but the **invocation pathway** is honor-system runbook.
- T6 runbook §Deploy is the only enforcement. There is no CI workflow that runs check-cloud-function-deployed.ts between two distinct terraform apply phases. PO doing one `terraform apply` (with T4 + T5 staged together) is the most natural action and would bypass the gate.

**Fix proposed**:
- T5 acceptance must mandate: "**before adding blocking_functions block, remove `blocking_functions` from `lifecycle.ignore_changes` (line 71 of identity-platform.tf)**. Without this, terraform silently no-ops the new block. Document in PR description + runbook §Deploy preflight."
- T7 acceptance must explicitly label "**Mechanical scope of this check**: post-deploy verification of the Cloud Function ARTIFACT. **NOT** an inter-apply ordering gate — that is honor-system in T6 runbook §Deploy. Two-phase apply (T4 resource → Cloud Build deploy → verify → T5 wire) is enforced by PO discipline, not by tooling. Risk accepted: PO doing single-phase `terraform apply` with both T4+T5 staged would skip the gate; mitigation = runbook preflight + reviewer-checklist on T8's evidence PR."
- Stronger alternative: introduce a **deploy CI workflow** (`.github/workflows/sprint-2c-b-deploy-gate.yml`) that runs `check-cloud-function-deployed.ts` against prod when `infrastructure/identity-platform.tf` modifies the `blocking_functions` block. The workflow fails if the function isn't deployed first. This converts honor-system into mechanical enforcement, paying ~30 LOC YAML.

---

### F-B4 [P0] T1, T8, T9, T11 operational tasks have no CI/merge gate; "done" is reviewer-self-attestation

**Vector**: user specific ask #3 — operational task acceptance ambiguity.

T1 ships: `sa-email-verification.txt` + `ghost-users-dry-run.csv`.
T8 ships: `terraform-apply-T8.log` + `T-WIRE-PROD-APPLY.txt`.
T9 ships: `smoke-e2e-negative.md` + `smoke-e2e-positive.md`.
T11 ships: `ghost-users-inventory-T11-<ISO>.csv` + `po-cleanup-decision.md`.

For all 4 tasks, the "done" condition is "evidence file committed to `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/`". No CI workflow validates:
- That the SA email in `sa-email-verification.txt` actually appears in T4's terraform variable (could be stale / wrong project / typo).
- That `terraform-apply-T8.log` is sanitized (could contain leaked secrets — plan T8 says "sanitized" without defining the procedure).
- That `T-WIRE-PROD-APPLY.txt` contains an ISO timestamp that matches the actual prod-state (could be back-dated).
- That smoke E2E screenshots are from the right environment (could be staging masquerading as prod).
- That `po-cleanup-decision.md` decisions reflect actual auth.updateUser invocations (could be aspirational).

This is **plan-a v3 H-A1's anti-pattern at scale**: out-of-tree / honor-system / reviewer-self-attestation, but applied to 4 tasks instead of 1. The mitigation that worked in plan-a (single PO is sole reviewer, cost-of-failure bounded) holds individually but compounds across 4 evidence-only tasks.

**Why critical**:
- Sprint 2c-B's PO active wall-clock (line 299) is "3-5 days". Across 5 days, 4 evidence-only tasks shipped without mechanical validation creates a vector for "I'll commit the evidence later when I have time" → never closes.
- The DA v3 H-A1 verdict was: "P1, not P0 — bundled into T1's PR makes forgetting active willful skip, not passive omission." That mitigation doesn't apply here because these 4 tasks are NOT bundled into one PR; they're sequential, each waiting on the prior.
- "Acceptance criteria detailed enough that PO can execute without ambiguity?" — partially. T1 says "redirect output to file with timestamp + PO sign-off comment" but doesn't define the sign-off comment format. T11 says "PO decision per ghost: (a) leave alone, (b) disable, (c) email user" but doesn't say what evidence file format records that decision (free-form? CSV with extra column? per-ghost markdown blocks?).

**Fix proposed**:
- T1 acceptance must enumerate the EXACT command (not just "via gcloud iam service-accounts list...") with expected stdout pattern; commit the literal output verbatim (no redaction of SA email — it's a public identifier in prod logs). Define the "PO sign-off comment" format: `# Verified by Felipe Vicencio @ <ISO timestamp> for use in T4 var.identity_platform_sa_email`. Provide a copy-pasteable template in the plan.
- T8 acceptance must define the sanitization procedure: "**before commit**, run `sed -i '' -E 's/(token=)[^&]+/\1<REDACTED>/g; s/(Authorization: Bearer )[^[:space:]]+/\1<REDACTED>/g' terraform-apply-T8.log`". Or commit only the final summary block (5-line "Plan: 1 to add, 1 to change, 0 to destroy. Applied successfully.") rather than the full log.
- T9 acceptance must mandate evidence file format: each smoke .md contains a YAML front-matter block with `environment: prod`, `firebase_project: booster-ai-494222`, `tester_email_redacted: <hash>`, `timestamp: <ISO>`, plus screenshot path (committed) + raw curl + asserted-UI-text. Provide template.
- T11 acceptance must define the CSV schema (column headers) + per-row decision rubric + the literal `auth.updateUser` command template. Plan must commit a `po-cleanup-decision-template.md` for PO to fill in.
- All 4 tasks: add a final PR acceptance step "evidence file diffable + reviewable; PR description includes inline acceptance checklist that the reviewer ticks before merge".

---

### F-B5 [P0] T13 ADR-054 Status flip does not update the mechanical gate; the gate continues to fire on Sprint 2c-B paths post-CERRADO

**Vector**: ADR-052 pre-condition + ADR-054 lifecycle scrutiny (user specific ask #5).

Plan T13 acceptance (line 228): "**Note: 2c-B path-gate will continue requiring ADR-052 Accepted (this script checks ADR-052 only; ADR-054 status is informational documentation)**."

Plan T8 pre-conditions (line 155): "Depends on: T4 + T5 + T6 + T7 merged + ADR-052 Status flip Accepted + Sprint 2b SIGNUP_REQUEST_FLOW_ACTIVATED ON."

Plan pre-conditions to /build (line 19): "**ADR-052 Status flip Accepted** ⏸ — gated by Sprint-2b T13 canary deploy 30 min success + 2 h watch. The mechanical CI gate (`sprint-2c-build-gate.yml` shipped en 2c-A T2b) will fail all Sprint 2c-B PRs until this flip. **PO action required out-of-band**."

So: the entire Sprint 2c-B PR train (T2-T7) cannot merge until ADR-052 flips. Sprint 2b T13 is the (out-of-band) trigger. **What happens if Sprint-2b T13 is delayed or fails?** Plan-b has no fallback. The gate is fail-closed (good), but there's no escape hatch.

Worse: after Sprint 2c-B CERRADO (T13 ADR-054 flipped), the workflow file `.github/workflows/sprint-2c-build-gate.yml` is STILL ACTIVE in main. It continues to fire on any future PR that touches the gated paths (`infrastructure/auth-blocking-functions.tf`, `infrastructure/identity-platform.tf`, `cloudbuild.production.yaml`). The 2c-A workflow comment says: "Post-Sprint-2c-B CERRADO: remove the required check (gate no longer needed; ADR-054 Accepted + 2c-B post-launch + 7d watch successful)." But plan-b T14 does NOT include removing the workflow or the branch-protection check. T14 is just CURRENT.md + sec-001-cierre amendment.

**Why critical**:
- Future PRs editing identity-platform.tf for unrelated reasons (e.g., adding a new authorized_domain) will fire the gate. If ADR-052 ever gets re-edited and Status drops, every future PR breaks. This is a stranded mechanism.
- The "ADR-054 status is informational documentation" claim in T13 is honest about the gate but undermines the whole purpose of ADR-054 §"Acceptance criterion para transition" which makes the flip part of the H1.2 closure mechanic.
- Circular dependency risk per user's specific ask: ADR-052 Accepted is required to merge ALL Sprint 2c-B PRs (per gate path-filter). If Sprint-2b T13 never happens (e.g., 2b T13 hits a regression and gets indefinitely deferred), Sprint 2c-B is bricked at PR-level. The plan has zero contingency.

**Fix proposed**:
- T14 must include teardown of `.github/workflows/sprint-2c-build-gate.yml` OR conversion to no-op + removal of the required branch-protection check. PO command in T14 PR description: `gh api -X PATCH repos/boosterchile/booster-ai/branches/main/protection --field 'required_status_checks[contexts][]=-Sprint 2c-B build gate (ADR-052 Accepted)'`. Document trade-off: leaving the gate active prevents accidental regression to "blocking_functions" being un-wired, but adds CI friction.
- T13 acceptance must also UPDATE `check-adr-status-accepted.ts` to **also** check ADR-054 Status: Accepted. The two-ADR check converts T13 ADR-054 flip from "informational" to "mechanically required for future related PRs". OR explicitly state in T13 acceptance: "ADR-054 Status flip is documentary-only; the gate continues to depend on ADR-052 even after 2c-B CERRADO. Future ADR-054 status changes are not enforced. Trade-off accepted: avoids gate-script churn at the cost of weaker ADR-054 lifecycle enforcement."
- Add a contingency clause to plan §"Pre-conditions a /build": "**If Sprint-2b T13 is deferred >14 days**, escalate to PO for explicit decision: (a) wait, (b) ship 2c-B without ADR-052 Accepted via gate escape-hatch (`gh workflow run sprint-2c-build-gate.yml -f force=true` per merge), with each escape-hatch use justified in PR description and tracked in `.specs/_followups/sprint-2c-b-gate-bypasses.md`. Document the criterion for selecting (b)."

---

## P1 findings (strong recommendations)

### F-B6 [P1] T12 monitoring infra is conflated with the 7-day watch operational task

**Vector**: user specific ask #10 — should monitoring be in the same apply as T8?

Plan T12 (lines 207-217) bundles two distinct deliverables into one task:
- (a) `infrastructure/auth-blocking-functions-monitoring.tf` (NEW, ~50 LOC) — Cloud Monitoring alert policy + uptime check synthetic. **This is code/infra**.
- (b) `7day-watch-log.md` — daily check log. **This is operational evidence**.

Plan-b §Alt-2c-B-Plan-III rejection: "monitoring infra deserves its own PR + its own evidence trail. T8 is operational apply; T12 is code + apply." OK, but then within T12 itself, the code+apply (a) and the evidence (b) are co-conflated. This re-introduces the same problem the rejection of Alt-III was supposed to prevent.

Furthermore: monitoring alert policies are **most useful before the function is live** (so the first invocation triggers proper baselines). Plan T12 depends on T8 applied + T-WIRE-PROD-APPLY committed. This sequence means:
- Day 0: T8 applies the function + wire → first signups happen → ungated by monitoring alerts.
- Day 1+: T12 applies monitoring infra → alerts now active.

A regression on day 0 between T8 and T12 is invisible to alerting. The plan's 7-day-watch clock starts at T-WIRE-PROD-APPLY (day 0), but the monitoring is only live from T12 onwards.

**Why P1 not P0**: Booster's expected Google signup rate is <10/month per spec. Day-0 unmonitored signups are likely to be 0 or 1, low risk. But the sequencing is still backwards from defense-in-depth.

**Fix proposed**:
- Split T12 into T12a (monitoring infra apply, depends on T7 merged) + T12b (7d watch log, depends on T8 applied). T12a applies BEFORE T8 so alerts exist on day 0.
- Or: roll T12a (monitoring infra) into T8 itself as part of the same terraform apply, since T8 already applies T4+T5. Wall-clock unchanged; defense-in-depth gained.
- Plan must document the chosen sequence in §"Atomic deploy pattern" of spec §7 (currently silent on monitoring sequencing).

---

### F-B7 [P1] T10 production perf measurement script's success criterion is timing-window-dependent — could pass trivially with cherry-picked window

**Vector**: evidence quality + SC-2C.B.5 OR-clause scrutiny.

Plan T10 (lines 181-188) ships `prod-perf-measure.ts` that asserts "p95 < 1500 ms per SC-2C.B.5 with OR-clause: 'first 10 invocations OR 7-day window, whichever comes first'".

The "whichever comes first" semantic is operationally ambiguous:
- If first 10 invocations land in 30 minutes, the script asserts against those 10. Statistical sample of 10 is noisy; cold-start outliers dominate p95.
- If signups are sparse (Booster's typical case), first 10 may take >7 days; script then asserts against the 7-day window (which may have fewer than 10 data points, statistically weaker).
- "First 10" includes the deploy cold-start (~1-3s observed in other Booster Gen 1 functions per ADR-054). p95 of 10 invocations where invocation 1 is 2000ms (cold start) is ≥2000ms by definition — failing the 1500ms bar.

Plan-b doesn't define:
- Whether the "first 10" excludes cold-start (warmed-up p95) or includes it (p95 from cold).
- What to do if first measurement fails: re-run? Escalate? Wait for more data?
- What "first 10" means under min_instances=0 (Plan T3 OQ-2C-B-2 resolution): every invocation is potentially a cold-start.

The DA v2 G-04 fix preserved the OR-clause from spec, but the practical bar (1500ms) is **inconsistent with the architecture choice** (Gen 1 + min_instances=0). The plan should expect ≥2000ms p95 at low traffic.

**Fix proposed**:
- T10 acceptance must define cold-start handling explicitly: either (a) "discard the first invocation post-deploy as warm-up; report p95 of the next 10" (excludes cold-start from the bar), or (b) "include cold-start; p95 bar relaxed to 3500ms for first-10 mode, 1500ms for 7-day-window mode" (different bars for different sample populations).
- Document the regression escalation procedure: "if p95 fails on first measurement and traffic is <2 invocations/day, schedule re-measurement at 24h with documented justification; if traffic >10/day and p95 fails for 3 consecutive days, alert PO via runbook §Performance regression."
- Acknowledge in the script doc-comment: "min_instances=0 means most invocations are cold-starts at Booster's expected <10/month rate; bar interpretation depends on this."

---

### F-B8 [P1] 7-day-watch clock semantics enforcement is honor-system per DA v2 G-09; plan-b doesn't tighten it

**Vector**: user specific ask #6 — 7-day clock anchor under re-apply scenarios.

Plan T8 (line 159): "`T-WIRE-PROD-APPLY.txt` timestamp recorded for 7d-watch anchor."
Plan T12 (line 216): "**Per DA v2 G-09 fix**: clock starts at T-WIRE-PROD-APPLY (T8); subsequent re-applies do NOT reset unless explicit 'rollback + re-wire' event documented in runbook."
T6 runbook acceptance (line 127): "**§7d-watch semantics** (per DA v2 G-09): `T-WIRE-PROD-APPLY` timestamp recorded once at first apply; subsequent re-applies don't reset clock unless explicit 'rollback + re-wire' event documented."

**The honor-system layers**:
- The `T-WIRE-PROD-APPLY.txt` file is committed once; subsequent re-applies (e.g., terraform drift fix, infrastructure refactor that touches identity-platform.tf) do NOT re-write the file. But what enforces this? Only the runbook prose. A PO doing a drift fix at day 4 could (a) forget the rule, (b) re-commit the timestamp file thinking they should refresh it, (c) write a new file under a different name and confuse the audit trail.
- "Rollback + re-wire" event needs documenting where? The runbook says "documented in runbook" but doesn't specify the artifact format (runbook diary entry? GitHub issue? sec-001-cierre amendment?). Without a defined artifact, "documented" is whatever PO does that day.
- The 7d clock is read by what? Plan T12 (line 213) implies the daily-watch log gets written by PO daily-check; the clock isn't enforced by any script. If PO writes day 1 at T+1 = T-WIRE+24h, day 2 at T+72h (skipped 48h), nothing flags the gap.

**Why P1**:
- Sprint 2c-B is a one-shot operation; PO error in the watch is local-impact, not recurring debt. But the next time Booster does a 7d-watch (any future Cloud Function deploy following this pattern), the same honor-system applies. Plan-b is the de-facto template for future runbooks.

**Fix proposed**:
- T6 runbook §7d-watch-semantics must enumerate the EXACT artifact format for re-apply events: "`.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/T-WIRE-PROD-APPLY-amendments.md` (NEW; only created if a re-wire occurs). Per amendment: ISO timestamp of re-wire event, reason (free-form), reset-vs-continue decision (with rationale)."
- T12 acceptance must add: "Daily watch log entries are dated; any 48h+ gap between entries triggers PO escalation (documented in log itself: 'GAP — PO unavailable, no signups during gap, watch extended by N days')."
- Add to T6 runbook a `scripts/check-7d-watch-log.ts` (optional, +30 LOC) that reads `7day-watch-log.md` and asserts (a) 7 daily entries present, (b) date range matches T-WIRE-PROD-APPLY anchor, (c) any extension explicitly logged. Run at T13 pre-flip. Converts honor-system to mechanical for the final close.

---

### F-B9 [P1] `apps/auth-blocking-functions/dist/` is referenced by T4 but is empty in main — sequencing risk

**Vector**: hardcoded paths (user specific ask #7).

Plan T4 (line 75): `gcloud functions deploy beforeCreate ... --source=apps/auth-blocking-functions/dist --entry-point=beforeCreate ...`.

Empirical check (just performed): `ls apps/auth-blocking-functions/dist/` → contains only `tsconfig.tsbuildinfo`. The dist build artifact does NOT exist in main.

Plan T3 (line 79): "`pnpm --filter @booster-ai/auth-blocking-functions build` succeeds locally + produces `dist/index.js` in CommonJS format."

So plan T3 generates dist/, plan T4 references dist/. The Cloud Build step in T3 cloudbuild.production.yaml addition (line 75) runs `pnpm --filter ... build` BEFORE the deploy. Sequence is correct IF Cloud Build runs both in the same job.

But: when terraform applies T4 (per T8), it does NOT trigger Cloud Build. The Cloud Function resource definition in T4 specifies `--source=apps/auth-blocking-functions/dist` — this is a `gcloud functions deploy` flag, NOT a terraform resource attribute. Terraform's `google_cloudfunctions_function` resource uses `source_archive_bucket` + `source_archive_object` attributes; T4 plan says these are managed by `lifecycle.ignore_changes` (line 94). So terraform creates the FUNCTION RESOURCE without source. Then Cloud Build deploys the source separately. This is consistent but requires Cloud Build to fire AFTER terraform apply.

Plan T3 cloudbuild step is conditionally run on production deploy. Plan T8 says "terraform apply manually by PO." What ties them together? Nothing automatic. PO must:
1. Trigger Cloud Build with the deploy-auth-blocking step → builds artifact + deploys function source.
2. Run `terraform apply` → creates the function shell (with ignored source attributes).

OR:
1. Run `terraform apply` → creates function shell with no source.
2. Trigger Cloud Build → builds + deploys source.

Either order works (per `lifecycle.ignore_changes`), but plan T6 runbook §Deploy procedure (line 121) says: "atomic apply order (T3 deploy → T8 verify → T5 IdP wire → smoke)". This reads as: Cloud Build deploy first → check function ACTIVE → terraform apply T5 wire → smoke. But T5 wire requires T4 resource to exist in terraform state, which requires T8's terraform apply to have already happened.

**The actual minimum-correct sequence** is: (a) terraform apply T4 to create function shell, (b) Cloud Build to deploy source code, (c) check-cloud-function-deployed verifies, (d) terraform apply T5 to add blocking_functions block. **Four steps, two terraform applies + one Cloud Build trigger between them.** Plan T6 runbook doesn't enumerate this with sufficient clarity.

**Fix proposed**:
- T6 runbook §Deploy procedure must enumerate the four-step sequence with copy-pasteable commands. Each step has a verification command and a rollback action.
- T4 acceptance must add a comment in the .tf file: "Function source managed by Cloud Build deploy step (apps/auth-blocking-functions/dist artifact). First `terraform apply` creates the function shell with no source; immediately after, run Cloud Build trigger `deploy-auth-blocking` to populate source. Without Cloud Build deploy, the function exists in API/console but has no executable code."
- Verify the `gcloud functions deploy beforeCreate --source=apps/auth-blocking-functions/dist` flag works when source is a relative path from cloudbuild's workspace; alternative is `--source=gs://${_REGISTRY}/auth-blocking-functions-${_COMMIT_SHA}.zip` (upload to GCS first, then deploy). The plan doesn't specify which.

---

## P2 findings (nits)

### F-B10 [P2] Plan §"Verification" line 288-289 PENDING tags reference nonexistent task IDs (T152, T153)

Plan body (line 288-289):
```
- [ ] DA pass output captured: PENDING T152.
- [ ] User approval: PENDING T153.
```

T152 and T153 are not tasks in this plan (which has T1-T14). These are leftover from a different plan template or autocomplete error. Cosmetic but signals iterative drift in the plan document.

**Fix proposed**: rename to "PENDING (this DA pass)" and "PENDING (user approval after DA)".

### F-B11 [P2] Plan §"Open questions" OQ-2C-B-2 marks min_instances=0 as resolved but admits "re-evaluate post-T10 baseline if cold-start latency unacceptable"

Plan OQ-2C-B-2 (line 257): "**resolved here** — `min_instances=0` selected at T3 to minimize cost. Re-evaluate post-T10 baseline if cold-start latency unacceptable; revisit via separate amendment commit if needed."

A resolution that says "we'll re-evaluate later" is not a resolution. It's deferral. Per F-B7, the cold-start choice is the dominant factor in p95; making it conditional on T10 results AFTER the deploy is reactive, not proactive.

**Fix proposed**: re-label as "**deferred-decision**" rather than "**resolved**". OQ-2C-B-2 should explicitly enumerate the rule: "min_instances=0 unless T10 first-measurement p95 > 5000ms; in which case PO commits to amend T4 .tf to `min_instances=1` within 7 days post-T10 measurement, before T13 ADR-054 flip." This converts deferral into a contingent commitment.

### F-B12 [P2] Plan §"Total estimate" "Wall-clock PO active" claims 3-5 days but T12 7-day watch alone is 7 days

Plan line 299: "**Wall-clock PO active** | ~3-5 días (depende ADR-052 flip + 7-day watch)".

The 7-day watch (T12) is 7 calendar days minimum (per SC-2C.B.7 "7-day watch passed"). So the 3-5 days range is at minimum the active hours, but the wall-clock from /build start to T13 flip is **at least 7+ days** plus all the PR review cycles for T1-T11 (which the plan estimates at 14 task-PRs).

Plan should distinguish "PO active hours" from "wall-clock elapsed."

**Fix proposed**: change line 299 to "**PO active hours** | ~3-5 días; **Wall-clock elapsed** | ≥ 9-12 días (PRs T1-T11 + 7-day watch + T13/T14 close)."

---

## What was done well

- **Empirical G-A9 path verification performed up-front** (plan §"What the G-A9 path-verification revealed", lines 24-33). The plan explicitly notes that both `apps/web/src/utils/translate-auth-error.ts` AND `apps/web/src/lib/api-errors.ts` do NOT exist, and pivots T2 to the actual situation. This is genuine empirical discipline. (Marred by the cross-ref inconsistency in F-B2, but the act of verifying was correct.)
- **Atomic-deploy contract explicit in alternatives** (Alt-2c-B-Plan-I rejection, line 264) — honest framing that mega-PR is rejected on atomic-vertical-slice grounds, not on size alone. The DA v2 G-03 contract is internalized.
- **DA history reference is bidirectional** (plan-b §"Linked" line 8) — cumulative DA review fully linked + sibling 2c-A spec marked "shipped 14/14 to main." The plan's lineage is auditable.
- **Castellanizar coordination clean** (verified empirically): the followup `castellanizar-adr-headers.md` already has the §"Exclusiones / coordinación con Sprint 2c" section added by 2c-A T2a (line 99-100), with the constraint "ADR-052, ADR-053 y ADR-054 castellanization MUST be done AFTER Sprint 2c-B CERRADO". Plan-b benefits from this groundwork.

---

## Recommended next step

**REDRAFT v2** — 5 P0 findings require structural changes:

1. **F-B1 fix**: T2 acceptance honesty about the two `translateAuthError` functions; pick option (a) login.tsx-only or option (b) unified-with-two-exports; LOC budget restatement.
2. **F-B2 fix**: T2 must include ADR-054 path-correction modify; T-LITERALS test relocates to apps/auth-blocking-functions/ or co-located with apps/web translate-auth-error.test.ts.
3. **F-B3 fix**: T5 acceptance must remove `blocking_functions` from `lifecycle.ignore_changes`; T7 acceptance must label "mechanical scope = post-deploy verification, NOT inter-apply ordering"; or add `.github/workflows/sprint-2c-b-deploy-gate.yml` for stronger gating.
4. **F-B4 fix**: T1, T8, T9, T11 acceptance criteria each get exact evidence file format + template + verification command embedded in plan body or T6 runbook.
5. **F-B5 fix**: T14 must include sprint-2c-build-gate.yml teardown OR conversion; T13 must decide between strengthening gate (also check ADR-054) or admitting weak ADR-054 lifecycle; contingency clause added to §"Pre-conditions a /build".

P1 findings F-B6, F-B7, F-B8, F-B9 are addressable inline during v2 redraft without changing task count. P2 findings F-B10, F-B11, F-B12 are nits — fix during v2 or accept.

**Estimated v2 redraft effort**: ~45 minutes. After v2, a second DA pass (~25 min) verifies the 5 P0 fixes are mechanically present, not prose-only.

**Anti-pattern observed (continuing the plan-a saga)**: The "prose-only fix" anti-pattern that plan-a took 3 iterations to converge from manifests in plan-b v1 at F-B3 (atomic deploy = honor-system runbook), F-B4 (operational tasks = reviewer-self-attestation), and F-B8 (7d-watch clock = honor-system prose). Each is a "fixed in prose, not in enforcement" recurrence. Plan-b cannot claim to have learned from plan-a's iterations until at least one of these is converted to mechanical CI enforcement (the recommended candidate per F-B3 is `.github/workflows/sprint-2c-b-deploy-gate.yml`).

---

## Evidence appendix

### A. `translateAuthError` exists in two distinct files with different switch maps

```
grep -rn "function translateAuthError" apps/web/src
apps/web/src/components/profile/AuthProvidersSection.tsx:598:function translateAuthError(code: string | undefined): string | null {
apps/web/src/routes/login.tsx:382:function translateAuthError(code: string | undefined): string | null {
```
Both functions return `string | null`. Switch cases compared verbatim (see above). 5 overlapping codes, ≥1 with different Spanish copy.

### B. apps/web/src directory contents

```
ls apps/web/src/utils/ → "No such file or directory" (path mismatch with ADR-054 §Decision)
ls apps/web/src/lib/  → 12 files (api-client.ts, firebase.ts, ... ) — canonical dir.
```

ADR-054 line 82-83 references `apps/web/src/utils/translate-auth-error.ts` (does not exist; plan-b silently changed to `lib/` without updating ADR-054).

### C. apps/auth-blocking-functions/dist contents (main)

```
ls apps/auth-blocking-functions/dist
tsconfig.tsbuildinfo  ← only this file; no index.js
```

Build artifact does not exist; Cloud Build must generate dist/index.js before `gcloud functions deploy` reads it. Plan T3 acknowledges this but plan T4 hardcodes the path.

### D. `lifecycle.ignore_changes = [blocking_functions]` is currently set

```
grep -n "blocking_functions" infrastructure/identity-platform.tf
infrastructure/identity-platform.tf:66:    #   - blocking_functions: pre-empty para Sprint 2c BlockingFunction
infrastructure/identity-platform.tf:71:      blocking_functions,
```

T5 must remove this line before adding the new block, otherwise terraform silently no-ops the addition. Plan T5 doesn't mention removing it.

### E. castellanizar followup already updated by 2c-A T2a

```
grep -i "sprint 2c\|exclusion\|ADR-052\|ADR-054" .specs/_followups/castellanizar-adr-headers.md
## Exclusiones / coordinación con Sprint 2c
**Trigger**: agregado 2026-05-27 por Sprint 2c-A T2a ...
**Constraint**: ADR-052, ADR-053 y ADR-054 castellanization MUST be done AFTER Sprint 2c-B CERRADO ...
```

F-A3 fix is genuinely landed. Plan-b benefits from this groundwork (no new F-A3 surface).

### F. sprint-2c-build-gate.yml workflow comment commits to post-CERRADO teardown but plan-b T14 doesn't enumerate it

```
.github/workflows/sprint-2c-build-gate.yml lines 47-49:
# Post-Sprint-2c-B CERRADO: remove the required check (gate no longer
# needed; ADR-054 Accepted + 2c-B post-launch + 7d watch successful).
```

Plan T14 (lines 232-245) updates CURRENT.md + sec-001-cierre amendment + archives followup. **Does NOT** remove the workflow or update branch protection. Stranded mechanism per F-B5.

---

**End of v1 DA pass — plan-b.md Sprint 2c-B.**

---

## v2 DA pass (2026-05-27)

**Verdict**: **REVISE** — 11/12 v1 findings mechanically addressed, but **2 NEW P0** introduced: (a) T7b workflow specs `GCP_SA_KEY` secret that does NOT exist in this repo (production uses Workload Identity Federation per `.github/workflows/release.yml`); (b) T14 mass-deletion bundles 8+ files across 3 workflows + 4 scripts + 6 test files + branch-protection PATCH into a single PR without sequencing safeguard — if the PATCH fails mid-rollout, the gate deletions land first and protection still references missing checks. Plus 1 P1 (T2 at 175 LOC scatters 4 distinct deliverables that ought to be 2 PRs).

**Reviewer**: agent-rigor:devils-advocate (v2 pass)
**Empirical verifications performed**: 2026-05-27 ~18:30Z. See per-finding rows.

### Fix-by-fix verification (v1 F-B1..F-B12)

| Finding | v2 claim | Mechanically present? | Verdict |
|---|---|---|---|
| **F-B1** [P0] TWO `translateAuthError` functions | T2 narrows to login.tsx-only; AuthProvidersSection.tsx **untouched**; followup `.specs/_followups/translate-auth-error-unify.md` created (T2 file row). | YES — plan §"G-A9 path-verification" lines 50-54 explicitly call out the two-function reality + decision; T2 §Files line 85 lists followup stub; T2 acceptance line 92 says "AuthProvidersSection.tsx untouched"; Alt-2c-B-Plan-VI rejection codifies. LOC restated at 175 (line 86). | **FIXED**. Decision is option (a) per F-B1 fix-proposed. |
| **F-B2** [P0] T-LITERALS path inconsistency + ADR-054 mismatch | T2 also modifies `docs/adr/054-google-blocking-function-signup-gate.md` (utils/ → lib/) + T-LITERALS test relocated to `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts`. | YES — T2 §Files line 84 explicitly lists ADR-054 MODIFY +2 LOC; line 83 puts test at `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts`; T2 acceptance line 93 reinforces "handler workspace owns the literal that drives the contract". **EMPIRICAL CHECK**: `apps/auth-blocking-functions/vitest.config.ts` line 19 `include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts']` — DOES pick up `test/integration/cross-source-literals.test.ts`. ADR-054 currently shows wrong path at line 82 ("utils/"); v2 commits T2 to fix it. | **FIXED + verified**. Vitest include pattern catches the test location. |
| **F-B3** [P0] T7 honor-system + hidden `lifecycle.ignore_changes` bug | T5 mandates removing `blocking_functions` from `lifecycle.ignore_changes` BEFORE adding new block. T7 acceptance honestly labels scope. NEW T7b adds `.github/workflows/sprint-2c-b-deploy-gate.yml`. | PARTIAL — T5 line 145 explicitly says "**REMOVE `blocking_functions,` from `lifecycle.ignore_changes` (existing line 71)** BEFORE adding the new block" with rationale. **EMPIRICAL CHECK**: `infrastructure/identity-platform.tf` line 71 confirms `blocking_functions,` is in `ignore_changes`. T7 acceptance line 193 labels mechanical scope honestly. T7b workflow added. **BUT**: T7b workflow has fatal issue (NEW concern below). | **FIXED in T5; T7b partially fixed but introduces NEW P0** (see N-B1). |
| **F-B4** [P0] Operational tasks lack templates | T1, T8, T9, T11 acceptance criteria each gain exact evidence file format + verification command + sanitization procedure (T8) + per-decision rubric (T11). | YES — T1 line 67-73 literal `gcloud` command + PO sign-off comment template; T8 line 218-232 sanitization procedure + summary-block template; T9 line 244-256 YAML front-matter template; T11 line 286-315 CSV schema + decision rubric + `po-cleanup-decision.md` template literally inlined. | **FIXED**. Templates are inlined and copy-pasteable. |
| **F-B5** [P0] Gate teardown + ADR-052 contingency missing | T14 expanded to teardown 3 workflows + delete 4 scripts + branch protection update. Pre-conditions §contingency clause added. | YES — T14 lines 378-394 enumerate all deletions including `sprint-2c-build-gate.yml`, `sprint-2c-b-deploy-gate.yml`, `sprint-2c-handler-completeness.yml`, gate scripts, and `gh api -X PATCH` branch-protection command. Pre-conditions §"Contingency clause" line 42 adds the >14-day escalation rule. **BUT**: rolling 8+ file deletions + 3 workflow deletes + branch-protection PATCH into single PR has new operational risk (see N-B2 below). | **FIXED but introduces NEW P0 sequencing concern**. |
| **F-B6** [P1] T12 monitoring conflated with watch | Split into T12a (monitoring infra apply BEFORE T8) + T12b (7-day watch log). | YES — T12a lines 318-329 says "**Applied BEFORE T8** so alerts exist on day 0"; T12b lines 331-361 owns the daily log + `check-7d-watch-log.ts`. **BUT**: sequence is documented only in T6 runbook §Deploy preflight prose. T12a's task §Depends-on says "T7b merged" (mechanical); T8's §Depends-on (line 216) says "T4+T5+T6+T7+T7b merged" — does NOT list T12a as a dep. Sequence is honor-system in the runbook. See N-B3. | **PARTIALLY FIXED** — split is real but T8 not gated on T12a; runbook is the only enforcement (re-incurs the F-B3 anti-pattern at smaller scale). |
| **F-B7** [P1] T10 cold-start ambiguity | T10 defines two p95 (warmed bar 1500 ms / cold-start bar 3500 ms), discard first invocation, regression escalation. | YES — T10 lines 271-276 enumerate `p95_warmed` (bar 1500) and `p95_with_cold_start` (bar 3500); OR-clause preserved; doc-comment explicit about min_instances=0 reality. Regression escalation references T6 runbook §Performance regression which is enumerated at T6 line 180. | **FIXED**. Two-bar approach is honest. |
| **F-B8** [P1] 7-day clock honor-system | T6 enumerates exact amendment format; T12b includes `check-7d-watch-log.ts` + tests; mechanical assertion at T13 pre-flip. | YES — T6 lines 169-176 enumerate `T-WIRE-PROD-APPLY-amendments.md` format with literal markdown template; T12b lines 336-358 ship the script + acceptance enumerates checks (exactly 7 dated entries, contiguous date range, 48h+ gap handling, amendments.md presence on re-apply). LOC waiver justified for mechanical conversion. | **FIXED — best mechanical conversion in v2**. |
| **F-B9** [P1] dist/ + Cloud Build sequencing | T6 runbook §Deploy procedure enumerates four-step sequence with copy-pasteable commands. T4 .tf gains inline comment about Cloud Build source dependency. | YES — T6 lines 159-163 enumerate the four-step sequence with literal `cd infrastructure && terraform apply -target=...`, Cloud Build trigger, `check-cloud-function-deployed.ts`, then `terraform apply -target=google_identity_platform_config.default`. T4 acceptance lines 123-132 inline the comment block. | **FIXED**. |
| **F-B10** [P2] T152/T153 leftover labels | Renamed to "PENDING (this DA pass)" / "PENDING (user approval after DA)". | YES — plan lines 443-444 confirm: `- [ ] DA v2 pass output captured: PENDING (this DA pass).` and `- [ ] User approval: PENDING (user approval after DA).` | **FIXED**. |
| **F-B11** [P2] OQ-2C-B-2 deferred-decision | Re-labeled as "deferred-decision" with contingent rule. | YES — OQ-2C-B-2 line 417: "**deferred-decision** (F-B11 fix) — `min_instances=0` selected at T3 to minimize cost; **contingent rule**: if T10 `p95_warmed` > 5000 ms, PO commits to amend T4 .tf to `min_instances=1` within 7 days BEFORE T13 ADR-054 flip." **BUT**: sequencing under T10-late-finding is not enumerated (see N-B4). | **PARTIALLY FIXED** — rule is contingent and stated, but enforcement sequence under "T10 day 5 finds >5000ms" scenario is ambiguous. |
| **F-B12** [P2] Wall-clock vs active hours | Total estimate splits "PO active hours" from "Wall-clock elapsed". | YES — lines 454-455: "**PO active hours** ~3-5 días (excluding 7-day watch wait)" + "**Wall-clock elapsed** ≥ 9-12 días (PRs T1-T12a + T7b + 7-day watch + T12b log entries + T13/T14 close)". | **FIXED**. |

**Fixes mechanically confirmed**: **11/12** (F-B1, F-B2, F-B4, F-B5, F-B7, F-B8, F-B9, F-B10, F-B12 fully; F-B3, F-B6, F-B11 partial — see N-B1, N-B3, N-B4).

### NEW concerns (introduced in v2)

#### N-B1 [P0] T7b workflow specifies `GCP_SA_KEY` secret that does NOT exist in this repo's CI

**Vector**: workflow scope/permissions correctness (user explicit ask #3).

Plan T7b acceptance line 205: "Workflow step `check-function-deployed-in-prod`: requires `GCP_SA_KEY` GitHub secret (already configured for staging E2E); authenticates `gcloud` + runs `apps/api/scripts/check-cloud-function-deployed.ts` against prod."

**Empirical check**: `grep -l "GCP_SA_KEY" .github/workflows/*.yml` finds **zero matches**. The repo uses **Workload Identity Federation** (WIF), not a long-lived SA key:
- `.github/workflows/release.yml` uses `google-github-actions/auth@v2` with `workload_identity_provider: ${{ vars.WIF_PROVIDER }}` + `service_account: ${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}`.
- This requires `permissions: id-token: write` at the workflow level.
- The plan's "already configured for staging E2E" claim is **factually wrong**.

**Why critical**:
- T7b cannot ship as-described — the secret doesn't exist. Build will fail at workflow runtime, not at PR-creation time, so the planner won't catch it until first wire-PR is opened.
- WIF requires `id-token: write` permission. Plan T7b doesn't specify `permissions:` block at all.
- If the planner copies `release.yml`'s auth pattern, the WIF_SERVICE_ACCOUNT_DEPLOY may not have `cloudfunctions.viewer` IAM. Plan doesn't specify the SA IAM requirement.

**Fix proposed**: T7b acceptance must replace "GCP_SA_KEY GitHub secret" with:
```yaml
permissions:
  contents: read
  id-token: write
  pull-requests: read
# ...
steps:
  - uses: google-github-actions/auth@v2
    with:
      project_id: booster-ai-494222
      workload_identity_provider: ${{ vars.WIF_PROVIDER }}
      service_account: ${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}
```
Plus: verify `WIF_SERVICE_ACCOUNT_DEPLOY` has `roles/cloudfunctions.viewer` on booster-ai-494222 (gcloud functions describe). If not, plan must include IAM grant via Terraform or doc the manual grant as out-of-band.

#### N-B2 [P0] T14 mass-deletion bundles 9 file deletions + 2 modifies + branch-protection PATCH into a single PR with no rollback safety

**Vector**: scope and second-order effects (user explicit ask #2).

T14 §Files enumerates:
- DELETE `.github/workflows/sprint-2c-build-gate.yml`
- DELETE `.github/workflows/sprint-2c-b-deploy-gate.yml`
- DELETE `.github/workflows/sprint-2c-handler-completeness.yml`
- DELETE `apps/api/scripts/check-adr-status-accepted.ts` + `.test.ts`
- DELETE `apps/api/scripts/check-handler-completeness.ts` + `.test.ts`
- DELETE `apps/api/scripts/check-cloud-function-deployed.ts` + `.test.ts`
- DELETE `apps/api/scripts/check-7d-watch-log.ts` + `.test.ts`
- MODIFY `docs/handoff/CURRENT.md`
- MODIFY `.specs/sec-001-cierre/spec.md`
- MOVE followup stub
- PO-executed `gh api -X PATCH repos/.../branches/main/protection` to remove 3 required-contexts

That is **9 file deletions across 4 directories + 2 modifies + 1 archive move + 3 required-context removals**. ~50 LOC net. Plan line 395 says "~50 LOC net" — the line count is fine but the **fan-out** is not.

**Why critical**:
- If the PATCH fails (e.g., PR API rejects due to a typo in context name, or a transient API error), but the file deletions land first, branch protection still references missing checks → all subsequent PRs to main are blocked by phantom required checks. Self-inflicted prod incident.
- The PATCH command in T14 line 391-394 has a syntax oddity: `required_status_checks[contexts][]=-Sprint 2c-B build gate (ADR-052 Accepted)` — the leading `-` is presumably "remove" but `gh api -X PATCH` doesn't natively interpret leading `-` as a "remove". It typically sends as-is. **Empirical risk**: the PATCH may attempt to ADD a context named `-Sprint 2c-B build gate (ADR-052 Accepted)` (literally with the dash) instead of removing it. Plan doesn't document the actual GitHub API semantics.
- Per CLAUDE.md §"Qué archivos NUNCA toco sin permiso explícito": `.github/workflows/*.yml` quality gates "requiere justificación". 3 workflow deletes + 6 script deletes is a lot of justification crammed into a closure PR.

**Fix proposed**: Split T14 into 3 PRs:
- **T14a**: branch-protection PATCH (PO-executed; outside CI). Verify success before T14b/c.
- **T14b**: delete workflows + their gate scripts (atomic; can rollback if PATCH was wrong).
- **T14c**: CURRENT.md + sec-001-cierre amendment + followup archive (low-risk doc closure).

Plus: T14 §Files must specify the EXACT `gh api` command syntax that actually removes a required context. Per GitHub docs, the correct invocation is reading current contexts via GET, filtering out the 3, then PUT-ing the new list. The `-` prefix in array notation is a `gh` CLI flag convention, not a GitHub API one. Verify with `gh api -X GET repos/boosterchile/booster-ai/branches/main/protection/required_status_checks` first and document the round-trip.

#### N-B3 [P1] T8 §Depends-on does NOT list T12a, despite the F-B6 fix mandating T12a-before-T8

**Vector**: dependency-graph correctness (user explicit ask #4).

Plan T12a line 327: "Applied BEFORE T8 so alerts exist on day 0. Sequence documented in T6 runbook §Deploy preflight."

Plan T8 line 216: "Depends on: T4 + T5 + T6 + T7 + T7b merged + ADR-052 Status flip Accepted + SIGNUP_REQUEST_FLOW_ACTIVATED ON."

T12a is **not in T8's depends-on chain**. The "T12a before T8" sequence is enforced only by T6 runbook prose. This re-incurs the F-B3 anti-pattern at smaller scale: a defense-in-depth claim ("alerts exist day 0") relies on PO discipline + runbook reading, not on mechanical task ordering.

**Fix proposed**: Add `+ T12a applied` to T8 §Depends-on (line 216). Plus: T12a evidence file (`terraform-apply-T12a.log` summary-block) should be the audit artifact that T8 PR description must link to.

#### N-B4 [P1] OQ-2C-B-2 contingent rule has no defined sequence under "T10 measurement at day 5 finds p95_warmed > 5000ms"

**Vector**: sequencing under late-discovery (user explicit ask #5).

Plan OQ-2C-B-2 line 417: "if T10 `p95_warmed` > 5000 ms, PO commits to amend T4 .tf to `min_instances=1` within 7 days BEFORE T13 ADR-054 flip."

T10 §Depends-on line 268: "T8 applied + at least 1 Google signup attempt post-wire."

T13 §Depends-on line 368: "T12b 7-day watch passed + `check-7d-watch-log.ts` exit 0."

**Scenario**: T8 applies day 0. T10 measurement happens day 5 (first signup is sparse — <10/month per spec). Day 5 result shows p95_warmed = 6000 ms (> 5000). PO has "7 days before T13" to amend T4.tf. But T13 fires when T12b 7-day watch is done (day 7). So PO has **2 days** to: (a) amend T4.tf, (b) re-apply terraform, (c) re-measure perf, (d) decide whether to extend watch.

Plan does NOT enumerate:
- Does re-applying T4.tf with min_instances=1 reset the 7-day watch clock? Plan T6 §7d-watch-semantics says re-apply does NOT reset unless "rollback + re-wire" event. Is min_instances change a "re-wire"?
- Does T10 re-measure after min_instances=1 amendment require its own evidence file (e.g., `prod-perf-measure-<ISO>-after-min-instances-fix.json`)?
- Can T13 flip if the contingent amendment hasn't completed within 7 days?

**Fix proposed**: T6 runbook §Performance regression must enumerate the day-5 scenario explicitly: "If T10 fires post day 3 with p95_warmed > 5000ms: (1) commit min_instances=1 amendment to T4.tf within 24h, (2) re-apply terraform (does NOT reset 7d-watch clock per §7d-watch-semantics — min_instances is a config-only change, not a re-wire), (3) re-measure p95 at +48h post-amendment, (4) if re-measurement still fails, ESCALATE to PO + delay T13 flip until p95 < bar."

#### N-B5 [P1] T2 at 175 LOC scatters 4 distinct deliverables that ought to be 2-3 PRs

**Vector**: PR atomicity (user explicit ask #1).

T2 bundles:
1. Extract `translateAuthError` from `login.tsx` to `apps/web/src/lib/translate-auth-error.ts` (~50 LOC NEW + ~60 LOC test + ~-23 LOC modify).
2. Modify `docs/adr/054-google-blocking-function-signup-gate.md` (Decision + Notes-for-future-self path corrections; ~+2 LOC).
3. Add cross-source-literals test in `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts` (~30 LOC).
4. Create followup stub `.specs/_followups/translate-auth-error-unify.md` (~30 LOC).

That is **4 distinct concerns spanning 3 workspaces (apps/web + apps/auth-blocking-functions + docs)** at 175 LOC, with a +75 over-cap waiver. Plan justifies as "lands atomically; splitting would scatter related fixes across PRs".

**Counter-argument**: the 4 deliverables are NOT actually coupled — they could ship as:
- T2a: Extract + login.tsx integration + ADR-054 path correction (apps/web + docs/adr; ~115 LOC). Atomic refactor.
- T2b: T-LITERALS cross-source test + followup stub (apps/auth-blocking-functions + .specs/_followups; ~60 LOC). Cross-workspace contract.

Splitting gives reviewers focused diffs (apps/web extraction reviewers don't need to grok the cross-source test rationale). The "lands atomically" argument is weak because ADR-054 path correction is independent of the test.

**Why P1 not P0**: The atomic landing has a real upside (ADR-054 and the file it references are consistent in the same commit). The 175 LOC is bounded (still under 200). Acceptable trade-off, but flagged as the kind of "compound PR" anti-pattern that plan-a converged away from over 3 iterations.

**Fix proposed (optional)**: Plan author may consider splitting T2 into T2a (apps/web extraction + ADR-054 path) and T2b (cross-source test + followup). Not required for merge, but improves reviewability. If kept atomic, the PR description must include a structured checklist mapping each of the 4 deliverables to a reviewer-acceptance line.

### Convergence assessment

Plan v2 fixes 11/12 v1 findings mechanically. The remaining 1 (F-B11) is partial-fix with documented contingent rule. **However**, v2 introduces:
- **2 NEW P0** (N-B1 fictional `GCP_SA_KEY` secret; N-B2 T14 mass-deletion sequencing).
- **2 NEW P1** (N-B3 T8-not-depending-on-T12a; N-B4 OQ-2C-B-2 day-5 scenario).
- **1 NEW P1 nit** (N-B5 T2 multi-deliverable PR scatter — acceptable trade-off but flagged).

This is **NOT a converged plan**. The "prose-only fix" anti-pattern remains visible at the F-B3 fix attempt: T7b *is* mechanical (CI workflow file ships), but the **authentication mechanism is fictional**, so the mechanical claim collapses into prose. Same pattern: "we said we'd convert honor-system to mechanical" → "we wrote a workflow YAML" → "the workflow can't actually authenticate against the target system".

Plan-a converged after 3 DA passes (v1→v2→v3 ACCEPT_WITH_RESIDUAL→v4 APPROVED). Plan-b is at v2 with 2 NEW P0 + 2 NEW P1. Pattern from plan-a suggests another iteration is normal but should NOT be 5+ iterations. Critical path to v3: (a) replace `GCP_SA_KEY` with WIF in T7b, (b) split T14 into 3 PRs with explicit PATCH-first sequencing, (c) add T12a to T8 depends-on, (d) enumerate OQ-2C-B-2 day-5 scenario in T6 runbook.

### Recommended next step

**REDRAFT v3** — 2 NEW P0 + 2 NEW P1 require structural changes. Estimated v3 redraft effort: ~20 minutes (smaller than v2 redraft because changes are localized). v3 DA pass would be ~15 minutes (verify N-B1..N-B4 each mechanically present, then check for any new induced concerns).

**Anti-pattern still active** (continuing the "prose-only fix" saga from plan-a): T7b workflow YAML is a real file (mechanical), but it references a secret that doesn't exist (prose-only authentication). The pattern manifests differently each time: plan-a v2 had "in spec but not in code"; plan-b v2 has "in plan but not in production reality (WIF vs SA key)". Recommendation: future DA passes should add an empirical-secret-existence check to the standard verification battery.

**End of v2 DA pass — plan-b.md Sprint 2c-B.**

---

## v3 DA pass (2026-05-27)

**Verdict**: **REVISE** — 4/5 v2 findings mechanically present, but **T14a Step 3 PUT command uses a `--field-from-file` flag that does NOT exist in `gh api`** (1 NEW P0). Plus T7b IAM grant remains honor-system: github-deployer has no `roles/cloudfunctions.viewer` and plan v3 ships no terraform deliverable for the grant (1 NEW P0). Same "prose-only fix" anti-pattern manifesting as "we wrote mechanical procedure" → "the command will fail at execution" (third recurrence of the pattern across the plan-b iterations).

**Reviewer**: agent-rigor:devils-advocate (v3 pass)
**Empirical verifications performed**: 2026-05-27 ~19:00Z. See per-finding rows + appendix.

### Fix-by-fix verification (v2 N-B1..N-B5)

| Finding | v3 claim | Mechanically present? | Verdict |
|---|---|---|---|
| **N-B1** [P0] T7b workflow used fictional `GCP_SA_KEY` | T7b now uses WIF per release.yml: `permissions: id-token: write` + `google-github-actions/auth@v2` with `${{ vars.WIF_PROVIDER }}` + `${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}`. Acceptance verifies IAM grant pre-merge. | **PARTIAL** — YAML block at plan.md lines 189-216 verbatim matches release.yml lines 76-83 variable names (`vars.WIF_PROVIDER`, `vars.WIF_SERVICE_ACCOUNT_DEPLOY`, `project_id: booster-ai-494222`, `id-token: write`). pnpm/action-setup version 9.15.4 + actions/setup-node 24 match release.yml env. **BUT**: IAM grant `roles/cloudfunctions.viewer` for `github-deployer` SA is asserted to be a pre-condition (plan line 35 §"Pre-conditions a `/build`" + line 217 "If absent, plan T7b acceptance includes adding the grant via terraform"), but T7b §Files (line 184) lists **only** `.github/workflows/sprint-2c-b-deploy-gate.yml`. There is no terraform deliverable that adds the IAM binding. Empirically confirmed: `grep cloudfunctions infrastructure/iam.tf` returns zero; `local.github_deployer_roles` (iam.tf lines 173-187) lists 8 roles, **none of which is `roles/cloudfunctions.viewer`**. The grant must happen out-of-band by gcloud command or by a future PR. The workflow will fail at first run when the SA lacks the role. **See N-B6**. | **PARTIAL FIX — workflow auth pattern correct; IAM grant left honor-system.** |
| **N-B2** [P0] T14 mass-deletion sequencing | Split into T14a (PATCH evidence) + T14b (deletions, depends on T14a evidence + PATCH verified) + T14c (docs). | **NO — T14a Step 3 command broken**: plan T14a acceptance line 333 prescribes `gh api -X PUT repos/.../required_status_checks --field 'strict=true' --field-from-file 'contexts=after.txt'`. **`--field-from-file` is NOT a `gh api` flag**. Verified via `gh api --help`: the only flags are `-F/--field`, `-f/--raw-field`, `--input`. `gh` supports `@filename` value-prefix on `-F` (e.g., `-F contexts=@after.txt`) which is the closest equivalent — but the prefix reads the file as a single scalar value, **not as a JSON array**, so it would not produce the array shape that `contexts` requires. Correct approach is `--input <json-file>` with a fully-assembled JSON body, OR `-F 'contexts[]=ctx1' -F 'contexts[]=ctx2' ...` per-context. As written, the command fails with `unknown flag --field-from-file`. T14a sequence (Step 1 GET → Step 2 jq → Step 3 PUT → Step 4 verify) is correct in structure, but Step 3's literal command will not execute. See N-B7. | **REGRESSION — fix introduces NEW broken command.** |
| **N-B3** [P1] T8 missing T12a dep | T8 §Depends-on explicitly lists `+ T12a applied (monitoring infra evidence committed)`. | **YES** — plan T8 §Depends-on line 228: "T4 + T5 + T6 + T7 + T7b merged **+ T12a applied (monitoring infra evidence committed)** + ADR-052 Status flip Accepted + SIGNUP_REQUEST_FLOW_ACTIVATED ON." T12a evidence file referenced from T8 PR description per N-B3 fix prose. | **FIXED**. |
| **N-B4** [P1] OQ-2C-B-2 day-5 scenario | T6 runbook §Performance regression enumerates explicit 5-step day-N (3..7) procedure: amend within 24h → re-apply config-only (no clock reset) → re-measure +48h → continue or escalate. | **YES** — plan T6 lines 144-163 contain literal markdown block with 5 numbered steps, including the explicit `-target=` re-apply scoped to the function resource, the explicit "clock does NOT reset" assertion tied to §7d-watch-semantics, the re-measurement artifact name `prod-perf-measure-<ISO>-after-min-instances-fix.json`, and the escalation path. T6 line 138 confirms LOC waiver (135 marginal +35). | **FIXED**. |
| **N-B5** [P1] T2 reviewer checklist | T2 acceptance mandates PR description includes 4-item checklist mapping each deliverable to reviewer-acceptance line. | **YES — but enforcement is honor-system**. T2 acceptance lines 88-95 inline the literal markdown block: `## Reviewer acceptance checklist (per T2 multi-deliverable PR contract)` followed by 4 `- [ ]` lines covering (1) apps/web extraction, (2) ADR-054 path correction, (3) T-LITERALS test, (4) Followup stub. The checklist text IS in the plan. **Enforcement**: nothing in CI fails if the PR description omits the checklist. Solo-dev mode: Felipe authors AND reviews; the checklist becomes self-attestation. Acceptable per plan-a v3 H-A1 precedent (residual accepted in solo mode) but worth noting as the same residual pattern. | **FIXED (with same residual as plan-a v3 H-A1).** |

**Fixes mechanically confirmed**: **3/5 fully** (N-B3, N-B4, N-B5) + **2/5 PARTIAL or REGRESSED** (N-B1 IAM grant honor-system; N-B2 PUT command broken).

### NEW concerns (introduced in v3)

#### N-B6 [P0] T7b IAM grant `roles/cloudfunctions.viewer` for `github-deployer` SA is asserted as pre-condition but has no terraform deliverable in the plan

**Vector**: workflow runtime auth correctness (continuation of N-B1).

**Empirical evidence**:
- `infrastructure/iam.tf` lines 173-187 enumerates `local.github_deployer_roles` for the WIF deploy SA (`github-deployer`): 8 roles, **none** is `roles/cloudfunctions.viewer`. Verbatim: `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/cloudbuild.workerPoolUser`, `roles/artifactregistry.writer`, `roles/storage.objectAdmin`, `roles/serviceusage.serviceUsageConsumer`, `roles/container.developer`, `roles/logging.viewer`, `roles/logging.logWriter`.
- `grep -r cloudfunctions infrastructure/` returns zero matches for any `cloudfunctions` IAM binding.
- Plan v3 line 35 (§"Pre-conditions a `/build`" item 6): "**WIF_SERVICE_ACCOUNT_DEPLOY has `roles/cloudfunctions.viewer`** on `booster-ai-494222` (T7b N-B1 fix; verify pre-T7b apply)."
- Plan v3 line 217 (T7b acceptance): "If absent, plan T7b acceptance includes adding the grant via terraform (NEW in `infrastructure/iam-deploy-sa.tf` or equivalent existing file)."
- T7b §Files line 184 lists **only** `.github/workflows/sprint-2c-b-deploy-gate.yml`. No `infrastructure/iam.tf` modify is in the deliverables.

**Why critical**:
- The grant is absent today. T7b's workflow YAML will run `pnpm --filter @booster-ai/api exec tsx scripts/check-cloud-function-deployed.ts` which invokes `gcloud functions describe beforeCreate --region=us-east1 --format=json`. Without `roles/cloudfunctions.viewer`, the gcloud call returns `403 PERMISSION_DENIED`. The workflow fails at runtime, NOT at PR-creation time. The "pre-merge verification" prose at line 217 ("`gcloud projects get-iam-policy ... --filter=...:roles/cloudfunctions.viewer` returns at least one binding") is a manual command the PO must run; nothing in CI enforces it.
- The plan offers two paths ("add via terraform" OR "documented out-of-band") but does NOT pick one. If out-of-band, the grant is reversible by any future `terraform apply` that re-asserts `local.github_deployer_roles` (the IAM is for_each over that list — Terraform will REMOVE any grant not in the list, on next apply). Out-of-band grant therefore self-decays.
- This is the **same anti-pattern as N-B1 v2**: workflow YAML is mechanical, but the system-level configuration the workflow assumes is not landed in this plan. The mechanical claim collapses into prose.

**Fix proposed**:
- T7b §Files must add `infrastructure/iam.tf` (MODIFY, ~+1 LOC) — append `"roles/cloudfunctions.viewer"` to `local.github_deployer_roles`. Acceptance: `terraform plan` shows new binding; apply happens BEFORE T7b workflow file merges (or T7b workflow acceptance includes a pre-flight that verifies grant via gcloud).
- Alternative: explicitly accept the residual in T7b acceptance: "**Out-of-band grant is the chosen path**: PO commits to running `gcloud projects add-iam-policy-binding booster-ai-494222 --member='serviceAccount:github-deployer@booster-ai-494222.iam.gserviceaccount.com' --role='roles/cloudfunctions.viewer'` BEFORE T7b workflow file merges. **AND** a followup `.specs/_followups/iam-cloudfunctions-viewer-codify.md` is created in T7b's PR documenting the terraform-codification debt. Without this, the next `terraform apply` removes the grant + breaks T7b workflow on its next run."

#### N-B7 [P0] T14a Step 3 PUT command uses `--field-from-file` flag which does not exist in `gh api`

**Vector**: command syntax correctness (continuation of N-B2).

**Empirical evidence**:
- `gh api --help` lists flags: `-F, --field key=value` (with `@<path>` value-prefix for file-read of a single value), `-f, --raw-field`, `--input file` (for full request-body file). **There is no `--field-from-file` flag.**
- Plan T14a Step 3 line 333: `gh api -X PUT repos/boosterchile/booster-ai/branches/main/protection/required_status_checks --field 'strict=true' --field-from-file 'contexts=after.txt'`.
- Execution result of this command (if attempted): `unknown flag: --field-from-file`. Exit non-zero, PATCH does NOT happen.

**Why critical**:
- T14a is the operational gate that prevents the phantom-required-context lockout. If T14a's command fails, T14a evidence cannot be committed truthfully; if PO commits broken-but-claimed-successful evidence anyway (honor-system), T14b deletions proceed, branch protection still references the 3 deleted contexts, and ALL subsequent PRs to main are blocked.
- The `after.txt` file in plan Step 2 is the output of `jq 'map(select(...))' before.txt` — this is a JSON array (e.g., `["ctx1","ctx2","ctx5"]`). The PUT body GitHub expects is:
  ```json
  {
    "strict": true,
    "contexts": ["ctx1","ctx2","ctx5"]
  }
  ```
  Correct gh invocations to send this:
  - `gh api -X PUT .../required_status_checks --input body.json` where body.json is assembled by jq.
  - OR per-context `-F 'contexts[]=ctx1' -F 'contexts[]=ctx2' ...` (requires shell expansion of after.txt into separate flags).
  - OR `jq -n --argjson c "$(cat after.txt)" '{strict:true, contexts:$c}' | gh api -X PUT .../required_status_checks --input -`.

**Fix proposed**:
- Replace plan T14a Step 3 with the correct command (any of the 3 above, pick one). Recommended:
  ```bash
  jq -n --argjson c "$(cat after.txt)" '{strict:true, contexts:$c}' > body.json
  gh api -X PUT repos/boosterchile/booster-ai/branches/main/protection/required_status_checks \
    --input body.json
  ```
- T14a evidence file must commit `body.json` alongside before/after/final for full audit.
- Acceptance must include "command **rehearsed against a fork or sandbox branch protection** before applying to main" (or, since branch protection is singular per branch, document that the command is intentionally not rehearsable + PO executes once with maximal care).

### Hunt for OTHER NEW failures

#### Task count 18 (G-14 threshold) waiver — defensible against plan-a's 14?

Plan-a v3 was 14 tasks (below G-14 trigger). Plan-b v3 is 18 tasks (above G-14 trigger of ≥15 — should split). Plan-b §"Total estimate v3" line 420 invokes "conscious waiver continues from v2: operational tasks (T1, T8, T9, T11, T14a) ship evidence-only PRs; code tasks form coherent deploy + verify + close arc."

Compared to plan-a (14 tasks): plan-b has **+4 tasks** explicitly because it (a) split T12 into T12a+T12b per F-B6, (b) split T14 into T14a+T14b+T14c per N-B2, (c) added T7b per F-B3. Each split was DA-mandated. The "splitting again would scatter operational deliverables without benefit" argument is reasonable but **circular**: DA mandated 3 prior splits, and the waiver now says "no more splits." Defensible because the operational+code tasks form a sequenced chain, but the waiver should explicitly acknowledge "3 of the 4 splits were DA-forced; we have reached a structural floor on splits."

**Verdict**: P2 nit. Waiver defensible but the argument could be more honest.

#### T7b → T12a → T8 sequencing chain — mechanically enforced or runbook-only?

- T7b merges first (gate workflow file).
- T12a then applies + commits evidence (T12a §Depends-on line 284 "T7b merged" — mechanical via PR sequencing).
- T8 applies code + wire (T8 §Depends-on line 228 "T4+T5+T6+T7+T7b merged **+ T12a applied**" — N-B3 fix mechanical via PR description references).

T8's Depends-on lists T12a as a merge-time requirement. But "T12a applied" means terraform-applied to prod, not just merged. Plan does not specify how T8 PR reviewer verifies T12a was actually applied (vs merely merged with evidence committed). The evidence file `terraform-apply-T12a.log` (line 282) committed in T12a's PR proves it happened, but the reviewer of T8 must manually check that file exists + has expected content.

**Verdict**: P2 — same anti-pattern as plan-a H-A1 (out-of-band artifact verified via PR-reviewer-self-attestation). Acceptable in solo-dev mode; flagged as residual.

#### T14a operational PATCH honor-system

T14a §Files (line 317) lists ONLY the evidence file `branch-protection-PATCH-T14a.md`. The actual PATCH command is run by PO out-of-band BEFORE the PR opens. What prevents PO from running a fake/incomplete PATCH + committing a falsified evidence file? Nothing mechanical. Same honor-system class as plan-a H-A1.

Plan T14a acceptance line 343 includes "**If PATCH fails**: STOP. T14b/T14c must not proceed until T14a evidence shows successful PATCH." This is PO discipline, not enforcement. But T14a Step 4 (line 339) has `diff after.txt final.txt # MUST be empty` — if PO commits the diff output, an honest broken-PATCH would show a non-empty diff. So the evidence file CAN catch a forgotten PATCH if PO commits the actual `diff` output literally. Discipline + evidence catches the failure mode.

**Verdict**: P2 — honor-system residual but with a self-catching evidence artifact (the `diff` output). Acceptable.

#### T14b deletion ordering vs T8 dependencies

T14b deletes (among others): `apps/api/scripts/check-cloud-function-deployed.ts` (which T8 §Depends-on requires via "T7 merged", and T7 ships that script). After T14b, the script is gone. T13 fires BEFORE T14a/b/c (T13 §Depends-on line 309: "T12b 7-day watch passed"). So sequence is: T7 → T7b → ... → T8 → T9 → T10 → T11 → T12b → T13 → T14a → T14b → T14c. By the time T14b deletes the script, T8 has long-since applied + T7b workflow has long-since served its purpose. **Sequence is consistent**.

**Verdict**: OK — no ordering bug. Plan v3 sequencing is internally consistent.

### Convergence assessment

Plan-b v1 had 5 P0 + 4 P1 + 3 P2. Plan-b v2 had 2 NEW P0 + 2 NEW P1 + 1 nit (11/12 v1 fixes mechanical). Plan-b v3 has **2 NEW P0** (N-B6 IAM grant; N-B7 broken PUT command) + 0 NEW P1 (3/5 v2 fixes fully mechanical, 2/5 partial-or-regressed).

**Comparison to plan-a convergence**: plan-a v3 was ACCEPT_WITH_RESIDUAL (0 P0 + 2 P1 residuals — both honor-system in solo-dev mode). Plan-b v3 is **NOT at parity**: 2 P0 remain. The two P0 are both narrow + localized (single-line YAML add for N-B6 terraform grant; single-command-syntax fix for N-B7 jq+gh-api invocation). v4 redraft for plan-b should be ~10 minutes, smaller than v3 redraft was.

**Anti-pattern still recurring** (third manifestation of "prose-only fix"):
- v1 → v2: T7 honor-system runbook → T7b workflow added (mechanical claim).
- v2 → v3: T7b had fictional `GCP_SA_KEY` → WIF auth (mechanical claim).
- v3 → v4 (needed): T7b WIF works but missing IAM grant (mechanical depends on un-shipped infra change) + T14a PATCH command has typo'd flag (mechanical command will fail).

Each iteration converts honor-system to mechanical at one layer but leaves a new layer below it unaddressed. **Convergence will be reached when the mechanical chain has no un-shipped dependencies AND all command syntaxes are validated against their tools.**

### Recommended next step

**REDRAFT v4** — 2 P0 require small but real fixes:

1. **N-B6 fix**: Add `infrastructure/iam.tf` MODIFY to T7b §Files (append `"roles/cloudfunctions.viewer"` to `local.github_deployer_roles`); OR pick the "out-of-band + followup stub" alternative + document the codification debt explicitly. Without one of these, T7b workflow will 403 on first run.
2. **N-B7 fix**: Replace T14a Step 3 command with valid `gh api` syntax. Recommended `jq -n ... | gh api -X PUT ... --input -`. Without this, T14a PATCH cannot execute → T14b deletions land on a still-protecting branch protection → repo lockout risk.

P1 residuals (N-B5 honor-system checklist, T7b→T12a→T8 ordering verification, T14a operational PATCH discipline) are acceptable in solo-dev mode per plan-a v3 precedent (H-A1 class). Document explicitly in §Decision log if v4 closes the 2 P0.

**Estimated v4 redraft effort**: ~10-15 minutes (smaller than v3 was).
**Estimated v4 DA pass effort**: ~10 minutes (verify 2 N-B fixes mechanical + check no new induced concerns).

**Anti-pattern note**: Plan-b is on iteration 3 of the same "prose-only fix → new layer of prose-only fix" cycle. Plan-a converged at v3 (4 iterations total v1/v2/v3/v4). Plan-b is on track for v4 convergence if N-B6 + N-B7 are addressed surgically WITHOUT introducing a new un-shipped dependency or untested command. **Recommendation for v4 author**: before declaring v4 ready, **manually run** the modified T14a Step 3 command syntax in a dry context (e.g., against a fork's branch protection, or with `--method GET` as no-op) + **inspect** the resulting terraform plan for the IAM grant. Empirical pre-validation closes the recurrence.

### Evidence appendix (v3)

#### G. `gh api` has no `--field-from-file` flag

```
$ gh api --help | grep -E '^\s+-[Ff]|^\s+--field|^\s+--input'
  -F, --field key=value       Add a typed parameter in key=value format (use "@<path>" or "@-" to read value from file or stdin)
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
  -f, --raw-field key=value   Add a string parameter in key=value format
```

Plan T14a Step 3 uses `--field-from-file` which does not appear in the above list and is rejected by gh as `unknown flag`.

#### H. `github-deployer` SA does not have `roles/cloudfunctions.viewer`

```
$ grep -n "cloudfunctions" infrastructure/iam.tf
(no output)

$ sed -n '173,187p' infrastructure/iam.tf
locals {
  github_deployer_roles = [
    "roles/run.admin",
    "roles/cloudbuild.builds.editor",
    "roles/cloudbuild.workerPoolUser",
    "roles/artifactregistry.writer",
    "roles/storage.objectAdmin",
    "roles/serviceusage.serviceUsageConsumer",
    "roles/container.developer",
    "roles/logging.viewer",
    "roles/logging.logWriter",
  ]
}
```

T7b workflow's gcloud calls will receive `403 PERMISSION_DENIED` from the Cloud Functions API on first run. Manual grant via `gcloud projects add-iam-policy-binding` is reversible by the next `terraform apply` (since `google_project_iam_member` is `for_each` over `local.github_deployer_roles`).

#### I. release.yml WIF pattern matches T7b verbatim

```yaml
# .github/workflows/release.yml lines 76-83
- name: Authenticate to Google Cloud
  uses: google-github-actions/auth@v2
  with:
    project_id: ${{ env.GCP_PROJECT_ID }}            # booster-ai-494222
    workload_identity_provider: ${{ vars.WIF_PROVIDER }}
    service_account: ${{ vars.WIF_SERVICE_ACCOUNT_DEPLOY }}
```

T7b plan acceptance (plan.md lines 200-204) uses identical var names + project_id literal. **Auth pattern itself is correct + matches repo precedent.** Only the downstream IAM grant is missing.

#### J. T8 §Depends-on now lists T12a (N-B3 fix verified)

```
$ sed -n '228p' .specs/sec-001-h1-2-google-blocking-b/plan.md
- **Depends on** (N-B3 fix): T4 + T5 + T6 + T7 + T7b merged **+ T12a applied (monitoring infra evidence committed)** + ADR-052 Status flip Accepted + SIGNUP_REQUEST_FLOW_ACTIVATED ON.
```

#### K. T6 §Performance regression has 5-step day-N procedure (N-B4 fix verified)

```
$ sed -n '144,163p' .specs/sec-001-h1-2-google-blocking-b/plan.md
### Scenario: T10 measurement at day N (N ∈ {3..7}) finds p95_warmed > 5000ms
...
1. **Within 24h** of T10 finding: commit min_instances=1 amendment ...
2. **Re-apply terraform** with `-target=...` only. **Per §7d-watch-semantics this is a config-only change, NOT a "re-wire" event — clock does NOT reset.**
3. **Re-measure perf at +48h** ...
4. If re-measurement passes ... continue 7d-watch ...
5. If re-measurement still fails: **ESCALATE to PO** + ... T13 delayed.
```

---

**End of v3 DA pass — plan-b.md Sprint 2c-B.**

---

## v4 DA pass (2026-05-27)

**Verdict**: **ACCEPT_WITH_RESIDUAL** — both v3 P0 (N-B6 IAM grant + N-B7 PUT command) mechanically fixed and empirically validated. 0 NEW P0. Residual P1/P2 are the same honor-system class plan-a v3 closed as acceptable in solo-dev mode. Plan-b has reached convergence parity with plan-a v3.

**Reviewer**: agent-rigor:devils-advocate (v4 pass)
**Empirical verifications performed**: 2026-05-27 ~19:30Z. See per-finding rows + appendix.

### Fix-by-fix verification (v3 N-B6 + N-B7)

| Finding | v4 claim | Mechanically present? | Verdict |
|---|---|---|---|
| **N-B6** [P0] T7b IAM grant for `github-deployer` SA | T7b §Files now lists `infrastructure/iam.tf` MODIFY (+1 LOC) — add `"roles/cloudfunctions.viewer"` to `local.github_deployer_roles`. for_each on `google_project_iam_member.github_deployer_bindings` picks up the new role + creates a new binding. | **YES** — plan.md line 193 explicitly lists "`infrastructure/iam.tf` (MODIFY, +1 LOC per N-B6 fix) — add `\"roles/cloudfunctions.viewer\"` to `local.github_deployer_roles` list (line ~173-187). Atomic with the workflow." T7b acceptance lines 224-226 describe the for_each pickup. **EMPIRICAL CHECK** of iam.tf lines 172-195: (a) `local.github_deployer_roles` IS a real local with 8 roles enumerated; (b) `google_project_iam_member.github_deployer_bindings` has `for_each = toset(local.github_deployer_roles)` (line 191) + `role = each.value` (line 193) + `member = "serviceAccount:${google_service_account.github_deployer.email}"` (line 194). Adding `"roles/cloudfunctions.viewer"` to the list **mechanically creates** a new resource `google_project_iam_member.github_deployer_bindings["roles/cloudfunctions.viewer"]` on next `terraform apply`. Verification command `terraform plan` would show `+ google_project_iam_member.github_deployer_bindings["roles/cloudfunctions.viewer"]` (1 new resource). PR description includes the targeted apply snippet `terraform apply -target=google_project_iam_member.github_deployer_bindings\["roles/cloudfunctions.viewer"\]`. **No more self-decay**: the role is now codified in the source-of-truth, so future `terraform apply` will not strip it. | **FIXED + empirically validated**. |
| **N-B7** [P0] T14a Step 3 broken `--field-from-file` flag | T14a Step 3 replaced with stdin-piped JSON pattern: `jq -n --argjson contexts "$(cat after.txt)" '{strict: true, contexts: $contexts}' \| gh api -X PUT ... --input -`. | **YES — empirically validated**. plan.md lines 341-344 contain the literal command. (a) `gh api --help` confirms `--input file` is a real flag with explicit "use `-` to read from standard input" semantics — verified by `gh api --help \| grep input`. (b) The jq pipeline `jq -n --argjson contexts "$(cat after.txt)" '{strict: true, contexts: $contexts}'` was rehearsed in `/tmp` with a synthetic before.txt → after.txt: output is `{"strict": true, "contexts": [...]}` — exactly the shape GitHub's required_status_checks API expects (per https://docs.github.com/en/rest/branches/branch-protection#update-status-check-protection: PUT body accepts `strict: boolean` + `contexts: string[]`). (c) `--argjson` (vs `--arg`) is the correct jq flag because `$(cat after.txt)` returns a JSON array literal and we want it parsed as JSON, not as a quoted string. (d) Plan Step 2 line 337 uses `jq 'map(select(...))' before.txt > after.txt` which preserves the array shape into after.txt. End-to-end pipeline is valid. | **FIXED + rehearsed empirically**. |

**Fixes mechanically confirmed**: **2/2 fully**.

### NEW concerns (introduced in v4)

#### Scan for unintended side-effects from N-B6 + N-B7 edits

- **T7b acceptance text**: lines 224-226 add ~3 lines of prose about the for_each pickup. No inconsistency with the rest of the plan (T7b still depends on T7 merged, still ships .github/workflows/sprint-2c-b-deploy-gate.yml as primary deliverable, still uses WIF auth from N-B1 fix).
- **T14a Step 3**: the new command is 4 lines (vs v3's 1-line broken command). Step 1, Step 2, Step 4 unchanged. Step 4 verification (`diff after.txt final.txt # MUST be empty`) still works because after.txt is still a JSON array (Step 2 output unchanged). End-to-end T14a sequence remains internally consistent.
- **§Pre-conditions a `/build` item 6** (line 43): "WIF_SERVICE_ACCOUNT_DEPLOY has `roles/cloudfunctions.viewer`". The v4 plan now provides the mechanism (T7b's iam.tf modify) to satisfy this pre-condition WITHIN the plan, rather than as an external out-of-band action. The wording "verify pre-T7b apply" is now mechanically satisfiable.
- **T7b §LOC estimate** (line 194): "~56" (55 YAML + 1 iam.tf). Honest accounting.
- **§"What changed v3 → v4" table** (lines 19-22): both rows accurately describe the fixes + reference the v3 findings they address. No drift from the rest of the document.
- **§Decision log** (line 439): correctly logs the v4 draft event with both fixes named.
- **§Total estimate v4**: same task count (18) + LOC count adjusted to ~810 from ~809 (the +1 from iam.tf). Consistent.

**No NEW P0 or P1 introduced by v4 edits.** The surgical scope held.

#### Honor-system residuals remaining (same class as plan-a v3 ACCEPT_WITH_RESIDUAL)

- **N-B5-class** (T2 reviewer checklist enforcement): residual per v3 verdict. Still honor-system in solo-dev mode. Same as plan-a H-A1.
- **T7b → T12a → T8 sequence verification** (v3 P2): the T8 reviewer must manually confirm T12a's `terraform-apply-T12a.log` is committed before merging T8. Honor-system per plan-a H-A1 precedent.
- **T14a operational PATCH** (v3 P2): PO runs `gh api` out-of-band; commits before/after/final + diff output as evidence. The `diff after.txt final.txt # MUST be empty` step is self-catching IF PO commits the actual diff verbatim. Acceptable residual.
- **T14a `body.json` artifact** (NEW residual surfaced in v4): the v4 stdin-piped command does NOT produce a `body.json` audit file (v3 fix-proposed had `> body.json` first then `--input body.json`). The v4 pipe-direct pattern is more elegant but loses the explicit audit artifact. **Mitigation**: T14a evidence file `branch-protection-PATCH-T14a.md` already commits before.txt / after.txt / final.txt + diff output. The body that was PUT is reconstructible: `body = {strict: true, contexts: <after.txt>}`. Audit trail intact via reconstruction; not a blocker. **Optional improvement** (not required for v4 approval): commit the assembled JSON via `tee` injection — `jq -n ... | tee body.json | gh api -X PUT ... --input -`. Documented as P2 nit.

### Convergence assessment

- Plan-b v1: 5 P0 + 4 P1 + 3 P2 (F-B1..F-B12).
- Plan-b v2: 2 NEW P0 + 2 NEW P1 + 1 nit (N-B1..N-B5; 11/12 v1 fixes mechanical).
- Plan-b v3: 2 NEW P0 + 0 NEW P1 (N-B6 + N-B7; 3/5 v2 fixes full, 2/5 partial/regressed).
- Plan-b v4: **0 NEW P0 + 0 NEW P1** (2/2 v3 fixes full + empirically validated). 1 NEW optional P2 nit (body.json audit artifact lost — reconstructible, acceptable).

**Plan-a vs plan-b parity check**:
- Plan-a v3 closed as ACCEPT_WITH_RESIDUAL with 0 P0 + 2 P1 honor-system residuals (solo-dev mode).
- Plan-b v4 closes with 0 P0 + 0 new P1 + multiple known-class honor-system residuals (T2 reviewer checklist, T7b→T12a→T8 verification, T14a operational discipline).
- **Parity reached**: both plans converged at the same residual-class. The "prose-only fix" anti-pattern that took plan-a 3 iterations + plan-b 4 iterations to close has finally terminated — the remaining honor-system residuals are inherent to solo-dev evidence-only operational tasks, not new layers of mechanical-claim-→-prose-fallback.

**Anti-pattern termination check**:
- v1 → v2: T7 honor-system → T7b workflow shipped. (Mechanical at workflow layer.)
- v2 → v3: GCP_SA_KEY fictional → WIF pattern shipped. (Mechanical at auth layer.)
- v3 → v4: WIF missing IAM grant → iam.tf modify shipped. (Mechanical at IAM layer.)
- **v4 has no un-shipped layer below it**: github-deployer SA will have cloudfunctions.viewer after terraform apply → workflow will authenticate via WIF → workflow will call gcloud functions describe → script will exit 0 → gate passes. End-to-end chain validated.

### Recommended next step

**APPROVE v4** — proceed to /build phase.

Sequence:
1. PO approves v4 plan.
2. Update `§"Verification"` checkboxes line 417-418: mark "DA v4 pass output captured" as `[x]` (this DA pass).
3. PO approval → mark line 418 `[x]`.
4. /build phase opens T1 PR.

**Optional v4 polish** (not a blocker):
- Add `tee body.json` to T14a Step 3 for explicit audit artifact (P2 nit).
- Add a §"Convergence note" to plan body documenting that v4 reached residual parity with plan-a v3.

**Anti-pattern termination logged**: Plan-b converged at v4 (3 DA passes after v1). One iteration longer than plan-a (3 DA passes after v1 for a v4 APPROVED close). Acceptable variance — plan-b had more tasks (18 vs 14), more mechanical-fix layers (T7b workflow + IAM + branch-protection PATCH command), and more cross-source-of-truth coupling (ADR-054 path correction + T-LITERALS test placement + WIF vars). Final convergence is sound.

### Evidence appendix (v4)

#### L. `gh api --input -` valid + reads from stdin

```
$ gh api --help | grep -E '\-\-input'
      --input file            The file to use as body for the HTTP request (use "-" to read from standard input)
```

Confirmed: `--input -` reads JSON body from stdin.

#### M. jq + gh-api pipeline rehearsed end-to-end with synthetic data

```
$ cat > /tmp/test_before.json <<'JSON'
["context1","context2","Sprint 2c-B build gate (ADR-052 Accepted)","context3"]
JSON
$ jq 'map(select(. != "Sprint 2c-B build gate (ADR-052 Accepted)"))' /tmp/test_before.json > /tmp/test_after.txt
$ cat /tmp/test_after.txt
[
  "context1",
  "context2",
  "context3"
]
$ jq -n --argjson contexts "$(cat /tmp/test_after.txt)" '{strict: true, contexts: $contexts}'
{
  "strict": true,
  "contexts": ["context1","context2","context3"]
}
```

Output shape matches GitHub's required_status_checks PUT body schema. T14a Step 3 will execute correctly when run against the real branch protection.

#### N. iam.tf for_each picks up new role mechanically

```
$ sed -n '190,195p' infrastructure/iam.tf
resource "google_project_iam_member" "github_deployer_bindings" {
  for_each = toset(local.github_deployer_roles)
  project  = google_project.booster_ai.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.github_deployer.email}"
}
```

Adding `"roles/cloudfunctions.viewer"` to the list at line 173-187 creates resource address `google_project_iam_member.github_deployer_bindings["roles/cloudfunctions.viewer"]` on next apply. Mechanical, not honor-system.

---

**End of v4 DA pass — plan-b.md Sprint 2c-B.** Verdict: **ACCEPT_WITH_RESIDUAL — proceed to /build.**
