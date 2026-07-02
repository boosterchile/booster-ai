# DA pass — plan-a.md v1 (Sprint 2c-A)

**Date**: 2026-05-26
**Reviewer**: agent-rigor:devils-advocate
**Plan under review**: `.specs/sec-001-h1-2-google-blocking-a/plan.md` v1 (10 tasks T1–T10, post-G-14 split)
**Prior DA history**: `.specs/sec-001-h1-2-google-blocking/plan-review.md` (umbrella; F-01..F-19 v1 + G-01..G-16 v2)
**Sibling**: `.specs/sec-001-h1-2-google-blocking-b/spec.md` exists; **plan-b.md does NOT yet exist**.

---

## Verdict

**REVISE** — 4 P0 findings block /build. Most critical: T2 regex enumeration is empirically wrong (≥ 6 Status formats exist, plan claims 3), and the T2→T1 dependency is backwards-pointing to the wrong ADR.

---

## P0 findings (must fix before approval)

### F-A1 [P0] T2 regex format enumeration is empirically wrong. ≥ 6 formats exist, plan claims 3.

**Vector**: G-01 fix verification (user item #1).

Plan T2 acceptance (line 47-50) claims to cover "**3 coexisting Status formats**":
1. `^- \*\*Status\*\*:\s*Accepted` (ADR-052 current).
2. `^\*\*Status\*\*:\s*Accepted` (ADR-035 format sin leading dash).
3. `^- \*\*Estado\*\*:\s*Aceptado` (post-castellanizar).

I ran `grep -hE '^- \*\*Sta|^\*\*Sta|^- \*\*Est|^\*\*Est' docs/adr/*.md | sort | uniq -c | sort -rn` over the actual corpus (52 ADR files). I observed **at least 6 distinct head-of-file Status formats currently in use**:

| Format | Count | Example ADR |
|---|---|---|
| `**Status**: Accepted` (no leading `-`) | ~24 | ADR-001, 004-012, 020-033 |
| `**Estado**: Accepted` (no leading `-`, mixed lang) | ~8 | ADR-040, 042-053 |
| `- **Estado**: Accepted` (with leading `-`, mixed lang) | 6 | ADR-013, 015-019 |
| `**Estado**: Aceptado` (no leading `-`, fully Spanish) | 5 | ADR-034 gcp-cost, ADR-035 trl10, ADR-037, ADR-038, ADR-039 |
| `- **Status**: Proposed/Accepted` (with leading `-`) | 2 | ADR-052, ADR-053 |
| `**Estado:** Aceptado` (colon **inside** the bold, not outside) | 1 | ADR-014 |

That is **6 formats, not 3**. Worse, ADR-014's `**Estado:** Aceptado` (note the `:` is inside the `**`) breaks ALL regexes that look for `\*\*Estado\*\*:` — it would be missed by every alternation T2 enumerates.

**Why critical**:
- The plan claims "3-format-robust" as its G-01 fix. If the script ships with 3 alternations against a corpus that has 6+, the gate is brittle by construction. Any future ADR author who picks a variant other than the 3 enumerated will silently re-block PRs.
- More urgently: the script's *only target* in 2c-B is ADR-052 (line 116 of ADR-052 specifies the post-canary commit text). Plan T2's regex needs only to match the **post-flip ADR-052 form**, which is `- **Status**: Accepted` (alternation 1 in T2). The other two alternations are speculative future-proofing that does not match observed corpus diversity.
- The "robustness" framing is theater. Either commit to **only** matching ADR-052's exact line and document the brittleness, OR build a regex set against the **observed** corpus.

**Fix proposed**:
- Replace "3 formats" with "observed corpus: 6 formats" in T2 acceptance.
- Either (a) narrow scope: regex matches ONLY the literal form ADR-052 will use post-flip (`- **Status**: Accepted` anchored to lines 1-10), and document that the gate is ADR-052-specific not corpus-general, OR (b) expand alternations to cover all 6 observed forms.
- Add test fixture (g'): copy ADR-014's `**Estado:** Aceptado` literally (colon-inside-bold) and assert the regex does NOT match — to confirm the script knows its scope limits.

### F-A2 [P0] T2 depends-on-T1 is backwards. T1 creates a NEW ADR (ADR-054/055); T2 checks ADR-**052** which already exists.

**Vector**: dependency-graph correctness (user item: T2 depends-on-T1 claim).

Plan T2 (line 46): "Depends on: T1 merged (ADR-052 file existing y referenced)."

This is factually wrong on two layers:

1. ADR-052 (`docs/adr/052-signup-migration-admin-sdk-gate.md`) **already exists in main** — I read it directly; it is the Sprint 2b admin-approval ADR, Status `Proposed`, awaiting Sprint 2b T13 canary flip. It has nothing to do with T1.
2. T1 of this plan (line 23-36) creates a **new ADR-NNN** (estimated ADR-054 or ADR-055) for the **Google Blocking Function**. T1 does NOT touch ADR-052. So T2's dependency on T1 is creating a false coupling.

The real dependency for T2 (mechanical CI gate checking ADR-052 Status) is: **nothing in this plan**. ADR-052 file already exists. T2 could ship in parallel with T1 — or even before T1.

The conflated claim "ADR-052 file existing y referenced" suggests the plan author confused two ADRs: the **target** of the CI gate (ADR-052, exists) and the **subject** of T1 (new ADR-NNN for Blocking Function, does not exist).

**Why critical**:
- Building T2 on a wrong dependency means the plan critical path is artificially serialized. T2 could land in parallel with T1, shaving wall-clock.
- It signals the plan author did not trace the actual file paths to verify the dependency. If this is wrong, what other dependencies are wrong? (See F-A4.)

**Fix proposed**:
- T2 Depends on: **none** (plan approved is the only requirement).
- Remove the "ADR-052 file existing y referenced" justification. ADR-052 exists independently of this plan.
- Re-state dependency graph: T1, T2 parallel ; T3 depends on T2 (gate must precede new app code, per existing C14 redefined contract) OR confirm T3 depends on neither (since the gate path-filters to 2c-B paths only).

### F-A3 [P0] Castellanizar cross-reference is one-directional. The followup does NOT mention ADR-052 or this gate.

**Vector**: cross-reference verification (user explicit ask).

Plan T2 acceptance (line 51): "Cross-reference castellanizar followup: script doc-comment cita `.specs/_followups/castellanizar-adr-headers.md` con instrucción de actualizar regex si esa migración ejecuta."

I read the followup file in full. It does **NOT** mention:
- ADR-052
- ADR-053
- Sprint 2c
- Sprint 2c-A
- Sprint 2c-B
- The CI gate script
- Any handling of "ADRs whose Status flip is in-flight"

The followup's "Procedimiento" (line 27-35) is a blanket `sed -i ''` script over **all** 28 historical ADRs with no exclusion list. If executed today, it would rename ADR-052's `- **Status**:` line to `- **Estado**:`, which silently breaks the T2 gate.

The plan's "cross-reference" is therefore **one-directional**: T2 script comments mention the followup, but the followup has zero mention of T2 or any ADR exclusion. A future PO executing the followup will not know to update T2 unless they happen to read T2's script source.

**Why critical**:
- The mitigation is honor-system + one-way pointer. Probability of breakage on castellanization day: high.
- The plan's "G-01 fixed" claim relied partly on this cross-reference. The fix is paper, not enforcement.

**Fix proposed**:
- T2 acceptance must include: **modify** `.specs/_followups/castellanizar-adr-headers.md` to add an exclusion clause: "ADR-052 and ADR-053 castellanization must be done AFTER Sprint 2c-B CERRADO + T2 gate regex updated to also match `- **Estado**: Aceptado` (or coordinated atomic batch)."
- The cross-reference must be **bidirectional** (both files reference each other) and the followup must encode the constraint, not just be informed by it.

### F-A4 [P0] T11 frontend translateAuthError task is silently missing from this plan; 2c-A spec §7 references it but plan never delivers it.

**Vector**: scope leak / completeness.

Spec 2c-A §7 component 1 + §10 lists Components 1, 2, 6 as in-scope and mentions `apps/web translateAuthError extension` as deferred to 2c-B (spec line 50, out-of-scope).

But: the umbrella plan-review.md G-05 finding — which this DA pass must respect — argued that **T11 frontend translation has no dependency on T7 wire** and can ship in parallel with T1. That argument was made in v2 of the umbrella plan when T11 was a critical-path task.

Plan 2c-A v1 implicitly accepts the spec §5 deferral and ships **0 frontend work**. That is internally consistent with the spec. But three problems:

1. The 2c-B spec is a stub (11.5KB, only `spec.md`, no plan yet). If T11 lands in 2c-B, it's blocked on 2c-B planning happening, which is blocked on 2c-A approving — adding wall-clock not budgeted.
2. The plan never says explicitly "T11 (frontend translateAuthError) is in 2c-B, not here". A reader looking at this plan + the spec §3 SCs (which include SC-2C.A.1..A.6 with no UX SC) might think frontend mapping is forgotten.
3. The G-05 v2 lesson was that the constant `BLOCKED_SIGNUP_PENDING_APPROVAL` lives in `handler.ts` as a string literal, not in `shared-schemas`. If 2c-A ships handler.ts with that literal, 2c-B's T11 must duplicate the literal or refactor. The plan does not document either choice.

**Why critical**:
- Sets up 2c-B for a hidden refactor task ("export the constant from shared") that nobody budgeted.
- If the constant is the bridge between handler.ts and translateAuthError, deciding its location is a 2c-A architecture decision, not a 2c-B one.

**Fix proposed**:
- T7 acceptance must specify exactly where `'BLOCKED_SIGNUP_PENDING_APPROVAL'` lives. Two options:
  - (a) String literal in handler.ts; 2c-B T11 duplicates the literal in `apps/web/src/utils/translate-auth-error.ts`. Document the contract (commit-level constant duplication, no exported constant).
  - (b) Exported constant from `packages/shared-schemas/src/auth/signup-errors.ts`; this requires adding a sub-task to 2c-A (T7b or new T11) to create the package export.
- Make the choice explicit in 2c-A plan + acceptance. Do not push the decision into 2c-B.

---

## P1 findings (strong recommendations)

### F-A5 [P1] LOC waivers >100 are not genuinely justified; T2 (135), T9 (125), T10 (110) split cleanly.

**Vector**: user item — LOC waivers genuine justification.

Per skill 20-planning-and-task-breakdown §43, splits should be attempted before waiving. The plan waives 4 tasks. Per-task scrutiny:

**T2 (135 LOC)**: 50 script + 50 tests + 35 workflow YAML. The workflow file is YAML, not code; it ships independently. Split: T2a = script + tests (~100 LOC, at cap) → T2b = workflow + branch protection docs (~35 LOC, well under cap). Justification "interlinked + 3-format-robust regex + cross-reference followup" is descriptive of acceptance, not of why-the-files-must-land-together. **Plan does not argue why T2 cannot split**.

**T8 (110 LOC)**: 80 script + 30 tests = ~110. Marginal, +10 LOC. Per umbrella F-06 v1 verdict ("concede as marginal waiver") this is acceptable but should be **explicitly labeled** "marginal waiver, +10 LOC over cap". Plan calls it "marginal +10 LOC; script + tests interlinked" — close enough.

**T9 (125 LOC)**: 80 emulator test + 15 firebase.json + 30 baseline-measure script. The baseline-measure.ts is a separate concern from the emulator test. Split: T9a = emulator test + firebase.json (~95 LOC) → T9b = baseline-measure.ts + first invocation (~30 LOC). The justification "atomic per F-04 fix from plan v2: emulator test + baseline script validate SC-2C.4 strategy together" assumes they must be co-tested. But T9b can land **after** T9a is in main; emulator setup is reusable from T9a. **Forced split**.

**T10 (110 LOC)**: 60 race + 50 admin-sdk-no-impact integration tests. These tests are conceptually different (one is MVCC invariant, the other is OQ-2C-8 empirical resolution). They share emulator setup from T9. Splittable: T10a = race-documents-invariant (~60 LOC) → T10b = admin-sdk-no-impact (~50 LOC, well under cap). Justification "2 integration tests interlinked + emulator setup overhead shared from T9" — the overhead is shared via T9, not via co-shipping T10a+T10b. **Forced split**.

**Why critical (P1, not P0)**:
- Larger PRs are harder to review under solo-dev fatigue. The 4-PRs-with-waivers pattern is exactly what the agent-rigor skill warns against.
- Each waiver is a small concession; together they signal not-attacking-hard-enough.

**Fix proposed**:
- T2 → T2a (script + tests) + T2b (workflow + branch protection).
- T8 → keep but label "marginal waiver".
- T9 → T9a (emulator + firebase.json) + T9b (baseline-measure + first measurement).
- T10 → T10a (race-documents-invariant) + T10b (admin-sdk-no-impact).
- Plan becomes 14 tasks (10 + 4 splits) instead of 10 with 4 waivers.

### F-A6 [P1] T7 "happy path test" honor-system enforcement (G-02 v2 lesson not applied here).

**Vector**: honor-system enforcement claims.

The umbrella plan-review G-02 (P0 in v2) flagged: "dependency chain between T3b/T5b/T7 is documented in prose but not gated by CI or path-based protection. ... If T7 wire happens in this window, every Google signup attempt early-returns without any DB check, defeating the entire Sprint 2c objective."

2c-A plan v1 does not address this. The dependency chain T3→T4→T5→T6→T7 (current numbering) is honor-system. Same failure scenario applies:

- T6 (DB pool) lands in main.
- T7 (handler with DB lookup) PR opens with flaky test.
- T8 (ghost user inventory) PR is ready and green.
- PO under pressure merges T8 first thinking "the inventory script is independent".

T8 IS independent code-wise, but if T8 ships and someone in 2c-B subsequently wires the function while T7 is still un-merged, the handler in main is the **T4 skeleton** with provider-check + no DB code → defeats the gate.

The 2c-A plan + 2c-A spec §C14 redefined says "Sprint 2c-A paths NOT gated by mechanical CI". So nothing protects against this out-of-order merge.

**Why critical**:
- The G-02 v2 lesson was: the mechanical gate should also verify handler completeness (grep `solicitudes_registro` returns ≥ 1 occurrence) before allowing 2c-B deploy.
- 2c-A plan v1 explicitly opts out of this mechanism. So the lesson is forgotten.

**Fix proposed**:
- Either: add a **second** mechanical CI workflow `sprint-2c-handler-completeness.yml` (path-filtered to 2c-B deploy paths) that fails if `apps/auth-blocking-functions/src/handler.ts` does not contain `solicitudes_registro`. This adds 1 task in 2c-A but is the genuine G-02 fix.
- Or: explicitly document in plan §"Pre-conditions a /build" that "T7 (DB-complete handler) must land in main BEFORE any 2c-B deploy PR opens. Sprint 2c-B plan T-WIRE must list this as a pre-condition explicitly."

### F-A7 [P1] T9 baseline measurement bar (p95 < 1500 ms) is unfounded against emulator timing.

**Vector**: evidence quality.

T9 acceptance (line 184): "baseline-measure.ts runs 10 invocations via emulator → output p50/p95/p99 → **assert p95 < 1500 ms in initial measurement** (per 2c-A SC-2C.A.6)."

Firebase emulator runs in-process JVM/Node with no IdP token validation, no real GCP network hop, no Cloud Function cold-start, no real PostgreSQL connection (per T6 setup most likely mocked/local). The emulator measurement is **at best** a measure of the handler's pure JS/TS execution time. It tells you almost nothing about production p95.

Production p95 will be dominated by:
- IdP JWT validation (~10-50ms),
- gcip-cloud-functions SDK overhead,
- Cold-start (Gen 1 cold start ~1-3s observed in other Booster functions),
- DB connection round-trip via Cloud SQL Auth Proxy unix socket (~5-20ms).

None of these are present in emulator. The 1500ms bar against emulator timing is therefore either (a) trivially passed (emulator handler likely runs in <50ms), making the assertion meaningless, or (b) measuring the wrong thing.

Recall umbrella F-04: production p95 measurement is meant to be the load-bearing metric. T9 emulator measurement was meant to be a sanity check. But here T9 acceptance treats the emulator as the bar for SC-2C.A.6.

**Why critical**:
- Plan v2 introduced T9 partly as the F-04 fix (replacing curl-baseline with emulator-baseline). But emulator-baseline ≠ prod-baseline.
- If T9 asserts "p95 < 1500ms" and it passes trivially in emulator (likely), the team is falsely confident about prod. The first real prod measurement could be 2-3x higher.

**Fix proposed**:
- Either: drop the assertion. T9 acceptance becomes "measure + record baseline; no pass/fail threshold against emulator". Production baseline lands in 2c-B.
- Or: document the limitation explicitly. "Emulator p95 < 1500ms is a *floor* check (handler JS execution time must be reasonable). Production p95 will be 5-20x higher; bar verified post-T-WIRE-PROD-APPLY in 2c-B."
- The current acceptance text reads as if 1500ms is THE bar; correct to "floor sanity check ≤ 1500ms, not the SC-2C.A.6 final bar".

### F-A8 [P1] T1 ADR Status format choice is undeclared — which of the 6 corpus formats will it use?

**Vector**: consistency / future-self.

T1 (line 30-32): "Status: `Proposed (2026-MM-DD; T1 Sprint 2c-A)`."

But that omits the format. Will it be:
- `- **Status**: Proposed (...)` (ADR-052/053 form, with leading `-`)? Plan implies yes (line 31 says "Sigue pattern ADR-052 + ADR-053").
- `**Estado**: Proposed` (no leading `-`, Spanish key — current Booster post-ADR-049 convention)?

If T1 ships with `- **Status**:` to match the regex T2 enumerates, that's fine for T2. But it goes against the post-ADR-049 norm of Spanish headers (`**Estado**`).

The plan does not declare this. A reviewer of T1 will not know which to choose. If T1 ships with `**Estado**:` (Spanish header, no leading dash), then **the regex T2 enumerates does NOT match it** — and on 2c-B Status flip, the gate refuses to recognize the ADR as Accepted.

This is the exact failure mode F-A1 warned about, but at a different ADR (the new ADR-NNN T1 creates, not ADR-052).

**Why critical**:
- The new ADR-NNN is the one whose Status will flip in 2c-B (post-7d-watch). If its Status format does not match the T2 regex, the gate cannot enforce. T2 is therefore tied to the new ADR-NNN, not just ADR-052.
- The plan claims T2 is about ADR-052. But by 2c-B closure, T2 will need to recognize the new ADR-NNN too.

**Fix proposed**:
- T1 acceptance must declare: "Use exact format `- **Status**: Proposed (...)` matching ADR-052/053 lineage so T2 mechanical gate matches without alternation. Document this format choice in ADR-NNN §Notes-for-future-self and link to T2 regex."
- Alternative: switch T2 to check the **new** ADR-NNN file (not ADR-052) for Status Accepted. This is more semantically correct: the gate that protects 2c-B deploy paths should check the ADR that describes the deploy, not the unrelated Sprint 2b admin-approval ADR.
- The plan has T2 checking ADR-052; this is left over from when "umbrella" and "this sprint" were the same. Now that the umbrella split, T2 should check ADR-NNN (T1's ADR), not ADR-052.

### F-A9 [P1] Out-of-band tasks have no merge gate (G-08 v2 verdict not applied).

**Vector**: drift signal.

Plan §"Out-of-band tasks" (lines 209-212) lists 3 items:
1. Memory file `feedback_sprint_2c_pattern.md` documenting Gen 1 vs Gen 2 lesson. Owner Claude, trigger post-T1 merged.
2. `_followups/sprint-2c-google-blocking-function.md` cleanup. Owner Felipe (PO).
3. Castellanizar followup coordination.

Umbrella G-08 v2 verdict (Conclusion of v2 findings): "out-of-band items #1, #2, #4 should be promoted into the task list with explicit acceptance criteria and merge gates. They will be forgotten otherwise."

2c-A plan v1 keeps these out-of-band with the same "Owner + Trigger" framing. There is no merge gate. There is no acceptance check. The lesson-learned memory file is the most valuable item (per umbrella analysis) and remains unenforced.

**Fix proposed**:
- Promote item #1 (memory file) to T_n in the task list with hard merge gate: 2c-A `/ship` cannot complete without the memory file in place.
- Item #2 (followup cleanup) → leave out-of-band (PO maintenance).
- Item #3 (castellanizar coordination) → already P0'd in F-A3; merge follows F-A3 fix.

---

## P2 findings (nits)

### F-A10 [P2] T7 "Coverage SC-2C.A.2 ≥ 80% / 75% branches en handler.ts" — coverage gate not enforced by CI on 2c-A paths.

Plan T7 acceptance line 145: "Coverage SC-2C.A.2 ≥ 80 % / 75 % branches en handler.ts."

CLAUDE.md §Testing says "Coverage 80%+ en código nuevo. CI bloquea si baja." But:
- The new app `apps/auth-blocking-functions/` is NOT in any existing CI workflow's coverage gate (verify by reading `.github/workflows/ci.yml`).
- T3 acceptance line 81 says `pnpm --filter @booster-ai/auth-blocking-functions typecheck` succeeds, but does not wire coverage to CI.

Without explicit wiring (adding the new workspace to `ci.yml` coverage matrix or `turbo` coverage step), coverage is honor-system at PR time.

**Fix proposed**: T3 acceptance must include "add `apps/auth-blocking-functions` to CI coverage matrix in `.github/workflows/ci.yml` (or equivalent turbo config). Verify by re-running CI on T3 PR."

### F-A11 [P2] T9 baseline output filename ISO timestamp is unstable evidence.

Plan T9 acceptance (line 178): "output `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-<ISO>.json`."

If T9 runs N times during 2c-A development, N JSON files accumulate. Which one is the "blessed" baseline? The plan does not say.

**Fix proposed**: T9 acceptance "single committed baseline file `baseline-perf-2c-a-<commit-sha>.json`; re-runs overwrite a `.latest` symlink".

### F-A12 [P2] T1 ADR numbering "estimated ADR-054 o ADR-055" — same vibe-estimate as v1 F-05 bonus.

Plan T1 (line 28): "Numbering: assigned via `pnpm exec scripts/check-adr-numbering.ts` pre-merge (estimated ADR-054 o ADR-055)."

Last ADR in main is ADR-053. Next ADR is **ADR-054**, period. Unless there is a known parallel ADR being drafted somewhere (none identified), the number is deterministic, not estimated.

**Fix proposed**: T1 says "ADR-054" definitively. If pre-merge a conflict appears, resolve then; do not pre-hedge.

### F-A13 [P2] T2 escape-hatch documented "en T1 ADR" — but T1 is a different ADR scope.

Plan T2 acceptance (line 66): "Escape-hatch documented en T1 ADR: if gate has bug requiring fix that touches 2c-B paths, override via `workflow_dispatch` admin trigger."

T1's ADR is about the Google Blocking Function architecture. T2's escape-hatch is about the CI gate. These are different topics. Documenting the escape-hatch inside T1's ADR forces the ADR to cover two concerns.

**Fix proposed**: Escape-hatch documented in T2's workflow YAML comment + (when T13 runbook lands in 2c-B) the runbook. Do not pollute the T1 ADR.

### F-A14 [P2] §"Pre-conditions a /build" enumerates only "Plan v1 approved + DA pass-through"; no mention of OQ-PLAN-2/3/4 resolution status.

Plan line 14-18: pre-conditions list omits the OQ-PLAN-1..4 resolutions that umbrella G-15 v2 raised as pre-build asks.

OQ-PLAN-2 (pnpm-workspace wildcard) the plan now claims "confirmed `apps/*` wildcard catches" (T3 line 81). Good, but not in pre-conditions.

OQ-PLAN-3 (Identity Platform SA email for invoker binding) is 2c-B scope, fine.

OQ-PLAN-4 (Admin SDK trigger spike) the plan addresses via T10 (admin-sdk-no-impact integration test). Good.

OQ-PLAN-1 (Firebase emulator CI overhead) the plan resolves to "NO CI integration; manual corrida pre-merge" (line 218). This is the G-13 v2 "soft-waiver" pattern that the umbrella DA flagged as P2 unresolved. Same problem persists.

**Fix proposed**: Add to plan §"Pre-conditions" a bullet "OQ-PLAN-1..4 status: enumerated and either resolved or explicitly accepted as residual".

---

## What was done well (max 4)

- **Honest spec inheritance**: §"Relationship to umbrella spec" of spec.md correctly enumerates which umbrella sections still apply; sub-spec format is genuinely sub-spec, not duplicated context.
- **G-04 fix applied correctly**: T7 baseline is removed from this plan entirely; production p95 measurement is correctly deferred to 2c-B. The plan does not repeat the curl-baseline mistake.
- **G-05 (T11 dependency error) avoided**: 2c-A correctly drops T11 frontend work from scope (deferred to 2c-B per spec §5). The wrong-task dependency from v2 G-05 does not recur in this plan.
- **G-07 race-test acknowledgment**: T10 acceptance "race-documents-invariant" explicitly names the test as documenting an invariant, with optional pg_sleep fault-injection. The honesty addresses G-07.

---

## Recommended next step

**REDRAFT v2** — 4 P0 findings (F-A1 regex enumeration wrong, F-A2 dep direction wrong, F-A3 cross-ref one-directional, F-A4 BLOCKED constant location undeclared) require redraft. P1 findings (F-A5..F-A9) require disposition either as additional tasks (forced splits) or explicit waiver-with-reason.

Estimated redraft time: ~45min. The redraft does not change task count materially (it splits T2/T9/T10 and may add 1 task for handler-completeness CI), so wall-clock budget remains comparable.

After v2 redraft, a second DA pass (~20 min) should confirm fixes are mechanically present and not just textually present (per G-01..G-05 v2 anti-pattern of "fixed in prose, not in enforcement").

---

## Evidence appendix

### A. Grep output: Status format diversity in `docs/adr/*.md`

Command:
```
grep -hE '^- \*\*Sta|^\*\*Sta|^- \*\*Est|^\*\*Est' docs/adr/*.md | sort | uniq -c | sort -rn
```

Result (head):
```
  24 **Status**: Accepted
   8 **Estado**: Accepted
   6 - **Estado**: Accepted
   5 **Estado**: Aceptado
   1 - **Status**: Proposed (...)         ← ADR-052
   1 - **Status**: Accepted (...)         ← ADR-053
   1 **Estado:** Aceptado                 ← ADR-014 (colon-inside-bold; ALL regexes miss this)
```

Plus single-occurrence variants in ADR-001, ADR-004, ADR-005 (parenthetical amendments).

Total distinct head-of-file formats observed: **≥ 6**, vs T2 plan's claimed 3.

### B. Castellanizar followup verification

File: `/Volumes/Pendrive128GB/Booster-AI/.specs/_followups/castellanizar-adr-headers.md` (71 lines, read in full).

Grep verification:
```
grep -Ei 'ADR-052|ADR-053|Sprint 2c|google-blocking|signup' .specs/_followups/castellanizar-adr-headers.md
```
Result: **zero matches**. Followup has no awareness of Sprint 2c, ADR-052, or the gate. F-A3 confirmed.

### C. Sibling 2c-B spec status

`ls .specs/sec-001-h1-2-google-blocking-b/`:
```
spec.md (only; 11.5KB)
```
No plan-b.md, no oq-research, no review yet. F-A4 risk (2c-B planning is downstream and not budgeted in 2c-A wall-clock) is real.

### D. ADR-052 Status line (verbatim, line 3)

```
- **Status**: Proposed (2026-05-26; T6 Sprint 2b H1.2 PR2). Transición a `Accepted` agendada en T13 post-canary 30 min success + 2 h watch.
```

Format = `- **Status**:` with leading dash, English key. Matches T2 alternation #1.

### E. ADR-052 acceptance line for post-flip

ADR-052 §"Acceptance criterion para transition Proposed → Accepted" line 116:
> "T13 emite **separate post-merge commit** `docs(adr-052): Accepted post-canary success cloudbuild run <ID>` que actualiza línea 3 de este file de `Proposed` a `Accepted`"

This means post-flip line 3 will read: `- **Status**: Accepted (post-canary success cloudbuild run <ID>)` — still leading-dash + `Status` (English). The plan's T2 alternation #1 will match this. Good — but the plan should add a synthetic fixture for this **exact** post-flip line, not the generic `Accepted` token, to verify the "real upcoming form" matches.

---

**End of v1 DA pass — plan-a.md Sprint 2c-A.**

---

## v2 DA pass (2026-05-26)

**Reviewer**: agent-rigor:devils-advocate (second pass)
**Plan under review**: `.specs/sec-001-h1-2-google-blocking-a/plan.md` v2 (15 tasks T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11, T12)
**Prior**: v1 DA pass above (4 P0 + 5 P1 + 5 P2 findings F-A1..F-A14)

**Verdict**: **REVISE** — 12/14 v1 fixes mechanically present, but 2 remain prose-only (F-A6 second-workflow path-filter scope, F-A9 `/ship` merge-gate is honor-system), and v2 introduces 4 new P0 / 3 new P1 / 2 new P2 concerns. Most critical new finding: T3 acceptance "add to coverage matrix" misdescribes the actual `ci.yml` structure (there is no matrix — the existing test job is workspace-wide). The plan promises a CI modification that, as written, would be a no-op.

### Fix-by-fix verification table

| Finding | v2 claim | Mechanically present? | Verdict |
|---|---|---|---|
| **F-A1** regex enumeration wrong | T2a narrowed to `^- \*\*Status\*\*: Accepted` (alternation #1 only), 6+ formats acknowledged in plan §"What changed" + script doc-comment; fixture (e) opens actual ADR-052 file; fixture (c) ADR-014 `**Estado:** Aceptado` → exit 1 deliberately not matched | **YES** — plan.md lines 73-81 enumerate fixtures (a)-(e); narrow regex literally matches the verbatim ADR-052 post-flip line per evidence E of v1 pass | **OK** |
| **F-A2** T2 dep on T1 backwards | plan.md line 71: "Depends on: ninguno (ADR-052 already exists in `main`; T1 NOT a dependency per F-A2 fix). Can ship parallel to T1 + T2b." | **YES** — explicit text + §"What changed" line 20 reaffirms parallel | **OK** |
| **F-A3** castellanizar one-directional | plan.md lines 69 + 82-84: T2a includes `MODIFY .specs/_followups/castellanizar-adr-headers.md` with exclusion-clause text proposed verbatim ("ADR-052, ADR-053 y ADR-054 castellanization MUST be done AFTER Sprint 2c-B CERRADO + T2a gate regex updated") | **PARTIAL** — file modification is enforced as a deliverable in the same PR; verdict text is enforceable in code-review. But: castellanizar followup remains a "Draft (stub, no ejecutar todavía)" file with no automation; if a future PO ignores the new clause and runs the sed batch anyway, no CI catches the broken regex. Mitigation: T2a's fixture (e) opens actual ADR-052 → on castellanization day, T2a fails → forces coordinator to update. Acceptable. | **OK** (with residual risk noted) |
| **F-A4** BLOCKED constant undeclared | plan.md line 173: handler.ts inlines `const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;`; option (a) string-literal-in-handler chosen; 2c-B T11 duplicates literal; "2 source-of-truth locations, mitigated by code comments + 2c-B test that calls handler integration ensuring code matches" | **PARTIAL** — choice mechanically made (literal in handler) and traceable, but the "2c-B integration test asserting both copies match" is a **promise about a plan that does not yet exist** (`.specs/sec-001-h1-2-google-blocking-b/` contains only `spec.md`). The mitigation is **prose-only** until 2c-B plan is drafted with that test as an explicit acceptance bullet. 2c-A cannot verify the safety net it depends on. | **PARTIAL FAIL** (see new finding **G-A2**) |
| **F-A5** LOC waivers split | T2 → T2a (~100) + T2b (~35); T9 → T9a (~95) + T9b (~40); T10 → T10a (~60) + T10b (~50); T8 keeps marginal +10 waiver; T11 marginal +5 waiver | **YES** — all 4 splits applied; only 2 marginal waivers remain | **OK** |
| **F-A6** G-02 honor-system | New T11 "Handler-completeness mechanical CI gate" with `apps/api/scripts/check-handler-completeness.ts` + `.github/workflows/sprint-2c-handler-completeness.yml` path-filtered to Sprint 2c-B paths; grep checks for `solicitudes_registro` AND `BLOCKED_SIGNUP_PENDING_APPROVAL` literals | **YES (script + workflow) but defeatable** — see new finding **G-A1**: grep on `solicitudes_registro` matches a hypothetical refactor that uses `const TABLE='solicitudes_registro'` even if the actual query is broken (e.g., `pool.query('SELECT ...')` with no reference to the table). Gate enforces literal-presence, not call-site-correctness. This is theater of the F-A6 fix. | **PARTIAL FAIL** |
| **F-A7** T9 p95 < 1500ms unfounded | T9b dropped pass/fail threshold; plan.md line 222-223: "NO pass/fail threshold against emulator … Production p95 will be 5-20x higher" | **YES** — acceptance text explicit | **OK** |
| **F-A8** ADR Status format undeclared | T1 acceptance line 58: "Status format … exactly `- **Status**: Proposed (2026-MM-DD; Sprint 2c-A T1)` — leading dash + English key. Documented choice in §Notes-for-future-self con rationale: matches ADR-052/053 lineage; T2a regex targets this lineage." | **YES** — format declared verbatim + rationale tied to T2a regex | **OK** |
| **F-A9** out-of-band memory file unforced | T12 promoted to task list, line 279: "**Merge gate**: 2c-A `/ship` does NOT complete without this file in place" | **NO — prose-only** — see new finding **G-A3**: `/ship` command (read at `~/.claude/plugins/marketplaces/agent-rigor/commands/ship.md`) is a Claude-walked 12-point checklist with **zero mechanical enforcement**. Items are marked ✓ or `[waiver: <reason>]` by Claude during the session. Nothing prevents a future session from skipping the memory-file step. The "hard merge gate" claim is **prose**, not enforcement. | **FAIL** |
| **F-A10** P2 coverage gate honor-system | T3 acceptance line 111: "add `apps/auth-blocking-functions` to CI coverage matrix in `.github/workflows/ci.yml` (or turbo coverage config)" | **NO — describes nonexistent mechanism** — see new finding **G-A4**: `.github/workflows/ci.yml` has **no per-app matrix**. The existing `test` job (lines 90-138) runs `pnpm test:coverage` workspace-wide and scans `find . -name coverage-summary.json` so any workspace emitting coverage is automatically gated at ≥80/75/80. Therefore the v2 "modify ci.yml" claim either (a) is a no-op (workspace gets coverage gated automatically once `pnpm test:coverage` runs there), or (b) misunderstands the existing structure. Either way the acceptance criterion as written is not actionable. | **FAIL (mischaracterized)** |
| **F-A11** baseline filename unstable | T9b acceptance: `baseline-perf-2c-a-<commit-sha>.json` + `.latest` symlink | **YES** — committed evidence + stable pointer | **OK** |
| **F-A12** ADR-054 deterministic | plan §"What changed" + T1 acceptance line 60: "ADR-054 definitively" | **YES** | **OK** |
| **F-A13** escape-hatch wrong location | T2b acceptance line 100: escape-hatch in workflow YAML comment, NOT in T1 ADR | **YES** — moved to T2b YAML comment | **OK** |
| **F-A14** OQ-PLAN status incomplete | §Pre-conditions lines 41-44 enumerate OQ-PLAN-1..4 with soft-waiver / resolved / out-of-scope labels | **YES** — explicit enumeration | **OK** |

**Mechanically confirmed**: 10/14 fully OK + 2/14 OK with documented residual = **12/14 OK**. **2/14 FAIL** on enforcement (F-A6 partial — grep theater; F-A9 — prose-only merge gate; F-A10 — describes nonexistent matrix).

(Note: count above lists F-A6 as PARTIAL FAIL, F-A9 as FAIL, F-A10 as FAIL → so strictly **11/14 OK + 3/14 FAIL** counting F-A6 in the fail column. Per skill convention "PARTIAL FAIL" = unfixed in enforcement → counted as FAIL.)

**Strict counting: 11/14 mechanically present.**

### NEW P0 findings (introduced in v2)

#### G-A1 [P0] T11 handler-completeness gate is grep-defeatable — "literal presence" ≠ "call-site correctness"

**Vector**: F-A6 fix scrutiny (user item #3).

T11 (plan.md line 254) script returns exit 0 if `apps/auth-blocking-functions/src/handler.ts` contains the **literals** `solicitudes_registro` AND `BLOCKED_SIGNUP_PENDING_APPROVAL`. The script is `grep`-based per script name + acceptance.

Defeat scenarios (all of which a 2c-B deployer might commit while the gate stays green):
1. **Refactor to constant**: handler.ts adds `const TABLE_NAME = 'solicitudes_registro' as const; const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;` but the actual DB query is `pool.query('SELECT 1 FROM dual')` (broken refactor). Grep passes; handler does nothing.
2. **Commented-out code**: a developer comments out the query block but leaves the table name in a `// TODO: re-enable query against solicitudes_registro` line. Grep passes; handler returns without checking.
3. **Wrong column / wrong condition**: query references `solicitudes_registro` but with `WHERE estado='pendiente'` (inverted gate) — gate would allow all approvals incorrectly. Grep passes; semantic gate is inverted.
4. **Dead code path**: query is in a function `verifySolicitud` that is exported but **never called** from the handler's main flow. Grep passes; handler never executes the check.

**Why critical**:
- The umbrella G-02 v2 lesson was about enforcing handler-completeness against a partial/skeleton T4-state handler. The grep-based T11 catches the T4-state (no `solicitudes_registro` anywhere) but does **not** catch a malicious or buggy regression. It is the **weakest possible** mechanical gate.
- Plan §"Alternatives considered" Alt-2c-A-Plan-III rejects shared-schemas export to keep 2c-A small; that decision compounds here because there is no Type-system-level link between handler and the table either.

**Fix proposed**:
- Either accept that T11 is a **smoke-not-a-gate** and document it as such in T11 acceptance ("gate prevents skeleton-state-shipping but does NOT verify semantic correctness; semantic correctness verified by T7 unit tests + T10a integration test"). 
- Or replace grep with AST-based check (e.g., `ts-morph` scan that confirms `handler.ts` exports `beforeCreateHandler` and that the export's body's reachable code includes a `pool.query` call whose first argument is a string containing `FROM solicitudes_registro`). +30 LOC, significantly higher signal.
- Or: drop T11 entirely and rely on the T2b path-gate + the 2c-B plan's pre-condition "handler T7 lands in main before any deploy PR" (honor-system but smaller surface than grep theater).

#### G-A2 [P0] F-A4 fix's "mitigation" depends on a plan that does not yet exist

**Vector**: cross-plan promise verification (user item #2).

Plan.md line 173 + Alt-2c-A-Plan-III line 304: "risk = drift if literals diverge; mitigated by **2c-B integration test asserting both copies match**."

Verification: `ls .specs/sec-001-h1-2-google-blocking-b/` returns only `spec.md`. No plan-b, no test enumerated. The 2c-B integration-test promise is **vapor**: it does not exist anywhere mechanically; it can be forgotten between this plan's approval and 2c-B planning.

The 2c-B spec (read in v1 evidence section) lists "translateAuthError extension" as in-scope for 2c-B but does not enumerate the specific "literals match" test. So even the 2c-B spec, which exists, does not yet capture the obligation that plan-a v2 is leaning on.

**Why critical**:
- The F-A4 decision (option (a) inline literal) is **only acceptable** if the mitigation (2c-B test) is mechanically guaranteed. As stated, it is a memo to the future.
- This is exactly the "prose-only fix" anti-pattern the user asked the second DA pass to hunt.

**Fix proposed**:
- T7 acceptance must include: "**adds a stub entry to `.specs/sec-001-h1-2-google-blocking-b/spec.md` §Test list** (or adds a new bullet under §10 if it has Test list) requiring 'literals-match integration test (handler.ts BLOCKED_CODE vs apps/web/src/utils/translate-auth-error.ts)'." This makes the obligation file-visible **before** 2c-A merges.
- Alternative: revert to Alt-2c-A-Plan-III (exported constant from shared-schemas). Yes, it adds ~20 LOC to 2c-A. Pay the price now rather than promise-the-future-pay-later.

#### G-A3 [P0] T12 "merge gate" claim relies on a `/ship` command with no mechanical enforcement

**Vector**: F-A9 fix scrutiny (user item #4).

T12 acceptance (plan.md line 279): "**Merge gate**: 2c-A `/ship` does NOT complete without this file in place (per F-A9 promote-with-merge-gate fix)."

I read `/ship` skill (`~/.claude/plugins/marketplaces/agent-rigor/commands/ship.md`). The command:
- Is a **Claude-walked checklist** (lines 17-46).
- Has **12 numbered points**, each marked `✓ or [waiver: <reason>]` by Claude during the session (line 19).
- Has **no script invocation, no file-existence check, no CI hook** that would block completion if a memory file is missing.
- The "ledger" step (line 41-45) appends an event but does not gate anything.

The agent-rigor enforcement model is **PreToolUse hooks for the build phase**, not for `/ship`. There is no `ship-precheck.sh` or equivalent. The skill is honor-system + Claude-self-policing.

**Therefore**: a future session running `/ship sec-001-h1-2-google-blocking-a` with the memory file **absent** can complete `/ship` successfully — Claude would either notice and mark `[waiver: forgot to create memory file]` or, more likely, not notice at all. The "merge gate" claim is paper.

**Why critical**:
- Same anti-pattern as F-A9 v1: the lesson-learned memory file is the highest-leverage out-of-band deliverable (Gen 1 vs Gen 2 verification pattern, transferable to other GCP features). Forgetting it = losing the lesson.
- The v2 plan explicitly cites "F-A9 promote-with-merge-gate fix" but the merge gate is non-existent.

**Fix proposed**:
- Add a **pre-`/ship` script** to T12 acceptance: `apps/api/scripts/check-memory-file-exists.ts` that, when run, verifies the memory file path exists and exits 1 otherwise. Wire into a new `.github/workflows/sprint-2c-a-merge-gate.yml` workflow path-filtered to `.specs/sec-001-h1-2-google-blocking-a/**` that runs only on the **final ship PR** for 2c-A.
- Or weaker: add the memory file as an explicit **acceptance bullet on T1** (not T12), so T1's PR cannot merge without the memory file present. This makes the memory file a hard prerequisite for ADR-054 landing, which forces it early.
- Or weakest acceptable: document in plan §Verification "this checkpoint is honor-system; Claude-walked-during-/ship" — at least make the honesty explicit and stop calling it a "merge gate".

#### G-A4 [P0] T3 "add to CI coverage matrix" describes a mechanism that does not exist in ci.yml

**Vector**: F-A10 fix scrutiny (user item #7).

Plan T3 acceptance line 111: "`.github/workflows/ci.yml` (MODIFY, ~5 LOC) — add `apps/auth-blocking-functions` to coverage matrix per F-A10 fix."

I read `.github/workflows/ci.yml` in full. There is **no matrix strategy** in the `test` job. The job structure:
- `test` job (lines 90-138) runs `pnpm test:coverage` (a workspace-wide script).
- After tests, it `find . -name coverage-summary.json -not -path './node_modules/*'` and validates each via inline node script against env-vars `COVERAGE_MIN_LINES=80`, `BRANCHES=75`, `FUNCTIONS=80`.

Therefore, any workspace emitting `coverage-summary.json` is **automatically gated** — no per-workspace matrix entry exists nor is needed. To bring `apps/auth-blocking-functions` into the gate, the **only** needed change is to ensure its `vitest.config.ts` / `package.json` emits coverage when `pnpm test:coverage` runs.

The plan's "~5 LOC modification to ci.yml" is **describing a change that has no place to go**. Either:
1. The plan author didn't read ci.yml (anti-pattern: prescribing a fix without reading the artifact).
2. The author meant to modify `turbo.json` pipeline (mentioned as "or turbo coverage config" — but that's also vague; turbo orchestrates `pnpm` scripts and the coverage script needs to exist in the new app's package.json).

**Why critical**:
- The F-A10 v1 finding asked for mechanical enforcement of coverage on the new app. The v2 fix names a file (`ci.yml`) and a number (`~5 LOC`), creating the **appearance** of a mechanical fix.
- A reviewer who doesn't read ci.yml will assume coverage is gated. A reviewer who does will spot the mismatch.

**Fix proposed**:
- T3 acceptance must enumerate: "`apps/auth-blocking-functions/package.json` includes `test:coverage` script that runs `vitest --coverage`, emitting `coverage/coverage-summary.json`. `apps/auth-blocking-functions/vitest.config.ts` sets `coverage.thresholds.lines=80, branches=75, functions=80`. **No ci.yml change needed** — the existing `find . -name coverage-summary.json` (ci.yml line 112) will gate the new workspace automatically."
- Drop the `ci.yml` modify claim. Or, if a per-workspace exemption/inclusion list is desired, restructure ci.yml first (out-of-scope).

### NEW P1 findings (introduced in v2)

#### G-A5 [P1] Task count 15 is at G-14 split threshold but plan does not invoke split rule

Per umbrella G-14 ("≥ 15 tasks triggers sub-sprint split"), plan v2 has 15 tasks (T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11, T12). Plan §"Total estimate v2" line 354-356 acknowledges this and argues: "this is post-split sub-sprint with handler-only scope; granular vertical slicing yields 15 atomic PRs which is preferred over fewer fatter PRs."

This argument is **plausible but unverified**. The G-14 threshold was umbrella-set after the original umbrella plan reached 15 tasks; the rationale was reviewer-fatigue and integration risk. Both apply equally to a sub-sprint:
- 15 PRs is 1 PR every ~4 hours over 2.5 days. Sustained-merge cadence with no buffer.
- Solo-dev fatigue is identical regardless of whether the 15 PRs are labeled "umbrella" or "sub-sprint A".

Counter-argument: G-14 was about scope-as-whole, and sub-sprint A is already-scoped-down from a larger thing. So "splitting again" leaves only T1 and T2a meaningfully splittable, and both are at-cap (~100 LOC each).

**Verdict on G-A5**: P1, not P0. The plan's defense is honest enough. But should be **explicitly waived in §"Total estimate v2"** with a sentence: "G-14 threshold consciously not invoked because (a) sub-sprint scope is already minimal, (b) further splitting would produce sub-50-LOC PRs which are noisier than helpful." Currently the plan claims "15 atomic PRs is preferred" without justifying against G-14.

**Fix proposed**: 2-line explicit waiver in §"Total estimate v2" or in a new pre-conditions bullet. No structural change.

#### G-A6 [P1] T11 LOC count is wrong — script+test+workflow=~105 but split-trivially is 80+25

T11 (plan.md line 257): "LOC estimate: ~105 (**marginal waiver, +5 LOC** over cap — script + tests + workflow tightly coupled in single G-02 mechanical fix)."

Per F-A5 v1 logic (the v2 plan author applied to T2/T9/T10): script + tests (~80 LOC) is one PR, workflow YAML (~25 LOC) is another PR. The "tight coupling" argument is the same one rejected for T2 in v1. T11 could split → T11a (script + tests, ~80 LOC) + T11b (workflow YAML + branch protection docs, ~25 LOC).

The same F-A5 standard the plan applies to T2/T9/T10 should apply to T11. The marginal waiver is fine, but the rationale "tightly coupled" is the rationale v1 rejected for T2.

**Why P1**: marginal +5 LOC is genuinely marginal; not worth the redraft. But the inconsistency in standard-of-justification is a process-quality concern (the plan claims F-A5 fix is applied but uses the same rejected rationale for T11).

**Fix proposed**: relabel T11 waiver justification: "marginal +5 LOC over cap; split (T11a/T11b) considered but rejected because YAML workflow file (~25 LOC) is below the meaningful-PR threshold and would generate a low-signal PR. Marginal waiver accepted." Honest framing.

#### G-A7 [P1] T12 task numbering is non-monotonic with body — listed last but depends only on T1

Plan §Tasks ordering: T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11, T12 (line 50-280). T12 depends-on `T1 merged` (line 271). All other Tn-after-T1 depend on the previous Tn-1 (T4→T3, T5→T4, etc.).

T12 is therefore an **out-of-band-like task disguised as the last sequential task**. It can ship after T1; nothing else gates it. Listing it at position 15 implies serial dependency; in reality it could ship at position 2 (immediately after T1).

This is a minor planning-clarity issue but matters for wall-clock budgeting and parallelism. If T12 is documentation work suitable for a "filler PR while waiting for T7 integration tests to stabilize", flagging that explicitly in §"Total estimate v2 wall-clock" would help.

**Fix proposed**: Add to T12 acceptance "Schedule note: can ship at any point post-T1 merged; placed at position 15 for narrative clarity (lessons-learned naturally distills after main work)."

### NEW P2 findings

#### G-A8 [P2] Plan §"Total estimate v2" task count text contradicts itself

Plan line 332: "Tareas | **13** (T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11, T12) — actually **15** counting T2a/T2b/T9a/T9b/T10a/T10b as separate"

The "13" is wrong on its face — the listed enumeration has **15** items. The "13" comes from… counting T2{a,b} as one, T9{a,b} as one, T10{a,b} as one? That gives 12 (T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12). Or 13 if T11 added back. Or 15 actual.

The §Correction block (lines 338-353) re-numerates manually and confirms **15**. The §Total table line 332 should be updated to remove the "13" claim entirely. Minor sloppiness; signals the plan was edited iteratively without consolidating the totals.

**Fix proposed**: change "Tareas | **13** … — actually **15**" to "Tareas | **15**" + delete the parenthetical "actually 15 counting…".

#### G-A9 [P2] Plan does not state which apps/web file 2c-B T11 modifies; the F-A4 mitigation has unspecified target

Plan line 173: "2c-B T11 will duplicate this literal in `apps/web/src/utils/translate-auth-error.ts`". 

This path is plausible but is **not verified to exist** in the current repo. If `apps/web/src/utils/translate-auth-error.ts` does not exist, then the 2c-B T11 task is "create the file + add the mapping" rather than "extend an existing file" — different LOC budgets.

The plan doesn't need to verify this for 2c-A approval, but it should label the path as "estimated; verify before 2c-B plan-b draft".

**Fix proposed**: 1-line annotation on plan.md line 173: "(path estimated; 2c-B plan-a draft must verify before locking)."

### Verdict summary

- **Mechanically-present fixes**: **11/14** strict (or 12/14 if F-A3's documented residual risk is accepted).
- **Prose-only / failed enforcement**: **3** — F-A6 (grep theater per G-A1), F-A9 (`/ship` not a real merge gate per G-A3), F-A10 (ci.yml has no matrix per G-A4).
- **NEW P0 findings**: **4** (G-A1 grep gate defeatable, G-A2 future-plan promise vapor, G-A3 `/ship` not enforceable, G-A4 ci.yml description wrong).
- **NEW P1 findings**: **3** (G-A5 task count vs G-14 unjustified, G-A6 T11 split inconsistency, G-A7 T12 dependency clarity).
- **NEW P2 findings**: **2** (G-A8 task count typo, G-A9 unverified path).

### Recommended next step

**REDRAFT v3** — focused redraft on 4 new P0 findings only. Estimated effort: ~30 min.

Required changes for v3:
1. **G-A1 fix**: T11 acceptance honest about grep-not-AST scope OR upgrade to AST-based check OR drop T11 and rely on T2b path-gate.
2. **G-A2 fix**: T7 acceptance must edit `.specs/sec-001-h1-2-google-blocking-b/spec.md` to add the "literals-match" test bullet, OR revert F-A4 to option (b) shared-schemas export.
3. **G-A3 fix**: T12 acceptance either (a) ships a real check script wired to a workflow path-filtered to 2c-A merge, OR (b) moves memory-file creation to T1's acceptance (so T1 PR cannot merge without it), OR (c) honestly labels the "merge gate" as Claude-walked-honor-system.
4. **G-A4 fix**: T3 acceptance must enumerate `package.json` + `vitest.config.ts` thresholds for the new app; drop the "modify ci.yml ~5 LOC" claim.

P1 findings G-A5, G-A6, G-A7 should be addressed inline during v3 redraft but do not individually block approval. P2 findings G-A8, G-A9 can be fixed in v3 or accepted as nits.

After v3 redraft, a **third DA pass (~15 min)** confirms the new P0 fixes are mechanically present. If a third pass discovers no new substantive failures, the plan is approvable.

**Anti-pattern observed**: The "fixed in prose, not in enforcement" pattern that v1 DA flagged repeatedly **persists in v2** for 3/14 fixes. The recurring failure mode is: v1 says "add a gate"; v2 says "we added a gate-in-name"; v2 gate is grep / honor-system / nonexistent-matrix. The user's instruction to "hunt the prose-only fix anti-pattern" was correct: it is the dominant failure mode in this feature's plan history.

---

**End of v2 DA pass — plan-a.md Sprint 2c-A.**

---

## v3 DA pass (2026-05-27)

**Reviewer**: agent-rigor:devils-advocate (third pass — convergence check)
**Plan under review**: `.specs/sec-001-h1-2-google-blocking-a/plan.md` v3 (14 tasks: T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11; T12 deleted)
**Prior**: v1 DA pass (F-A1..F-A14) + v2 DA pass (G-A1..G-A9) above.

**Verdict**: **ACCEPT WITH RESIDUAL** — all 9 v2 G-A findings mechanically addressed; 2 NEW P1 concerns introduced (H-A1 T1 memory file lives outside repo, undiffable by PR reviewers; H-A2 T4-T6 transient-coverage-fail handling is honor-system option (b) rebranded). Neither blocks ship if PO accepts them as documented residual risks. Convergence reached: further redrafts likely yield diminishing returns.

### Fix-by-fix verification (v2 G-A1..G-A9)

| Finding | v3 claim | Mechanically present? | Verdict |
|---|---|---|---|
| **G-A1** T11 grep theater | T11 acceptance (line 252) explicitly states "**This is a smoke check, NOT a semantic gate**. Prevents shipping handler skeleton (T4-state) to prod. Does NOT verify call-site correctness … semantic correctness verified by T7 unit tests + T10a + T10b". Workflow YAML comment + script doc-comment both carry the framing. Alt-2c-A-Plan-VII (AST upgrade) considered + rejected with cited rationale. Alt-2c-A-Plan-VIII (drop T11) considered + rejected. | **YES** — verbatim honest framing in both doc-comment + workflow comment; alternatives table makes the trade-off auditable. A reviewer cannot mistake T11 for semantic verification given the explicit text. | **OK (honest framing)** |
| **G-A2** F-A4 mitigation vapor | T7 acceptance (line 166) lists **`.specs/sec-001-h1-2-google-blocking-b/spec.md` (MODIFY, +~5 LOC)** as a deliverable file in T7's PR. Acceptance text mandates adding "T-LITERALS: integration test ensuring handler.ts BLOCKED_CODE literal value MUST equal apps/web/src/utils/translate-auth-error.ts mapped string". File-visible obligation lands with T7 PR. | **YES** — file modification is in the deliverable list, not just a side-promise. T7's PR diff will show the edit; if absent, PR fails review mechanically. | **OK** |
| **G-A3** `/ship` not enforceable | T12 deleted entirely. Memory file (`feedback_sprint_2c_pattern.md`) + MEMORY.md index entry absorbed into T1 acceptance (lines 50-51, 58-59). T1 acceptance line 59: "all 3 files in **single PR**; reviewer checklist explicit on PR description". | **PARTIAL** — see new finding **H-A1**: the memory file path `/Users/fvicencio/.claude/projects/.../memory/feedback_sprint_2c_pattern.md` is **outside the repo working tree**. GitHub PR diffs only show files inside the repo. A reviewer looking at T1's PR sees the ADR diff + nothing else; the memory file existence cannot be verified by clicking "Files changed". The reviewer must manually `ls` the path on their local machine (assuming they even have the same `~/.claude/` topology as the author). Bundling into T1 absolutely removes the `/ship` anti-pattern from G-A3, but replaces it with a different honor-system: PR-reviewer-self-attestation about an out-of-tree file. | **PARTIAL OK — anti-pattern shifted, not eliminated** |
| **G-A4** T3 ci.yml has no matrix | T3 acceptance (line 110): "**No ci.yml change needed**" — relies on existing `find . -name coverage-summary.json` (ci.yml line 112). Verified against actual ci.yml: lines 105-131 confirm workspace-wide `pnpm test:coverage` + `find` scan + per-summary threshold check. Any new workspace emitting `coverage/coverage-summary.json` is automatically gated. | **YES** — verified empirically against ci.yml lines 105-131. The mechanism is exactly as v3 describes. No ci.yml modification required. | **OK** |
| **G-A5** G-14 task count waiver | §"Total estimate v3" line 320: explicit 2-line waiver invoking (a) sub-sprint already minimal, (b) further splitting yields sub-50-LOC noisier-than-helpful PRs. Task count = **14** (below G-14 threshold of ≥15). | **YES** — task count = 14 verified by enumeration; waiver text present. Note: at 14 tasks the G-14 threshold is technically not even triggered (15 is the threshold), so the waiver is belt-and-suspenders — fine. | **OK** |
| **G-A6** T11 split inconsistency | T11 LOC waiver (line 248) relabeled: "marginal +5 LOC; split T11a/T11b considered but YAML workflow (~25 LOC) is below meaningful-PR threshold". Honest framing. | **YES** — wording matches the G-A6 fix proposal verbatim; same standard now applied as to T2/T9/T10. | **OK** |
| **G-A7** T12 ordering | T12 deleted entirely (per G-A3 fix). N/A. | **YES** (vacuously) | **OK** |
| **G-A8** task count contradiction | §"Total estimate v3" line 314: "Tareas | **14**" — cleanly enumerated, no contradictory parenthetical. | **YES** — single number, no "actually X" hedging. | **OK** |
| **G-A9** apps/web path unverified | T7 acceptance line 172: "**2c-B target path note** (per G-A9 fix): '2c-B plan-b draft must verify `apps/web/src/utils/translate-auth-error.ts` exists before locking; if file absent, T-LITERALS becomes "create + add mapping" rather than "extend existing".'" | **YES** — path annotated as estimated with explicit fallback if absent. | **OK** |

**Strict mechanical-presence count v3: 8/9 fully OK + 1/9 PARTIAL OK (G-A3 anti-pattern shifted) = 8.5/9.**

### NEW concerns (introduced in v3)

#### H-A1 [P1] T1 memory file lives outside the repo — PR diff cannot verify its existence

**Vector**: G-A3 fix scrutiny (convergence-check).

T1 acceptance (lines 50-51 + 58-59) bundles 3 files into a single PR:
1. `docs/adr/054-google-blocking-function-signup-gate.md` (in-repo, ~100 LOC).
2. `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/feedback_sprint_2c_pattern.md` (**outside repo**, ~30 LOC).
3. `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/MEMORY.md` (**outside repo**, +1 line index entry).

GitHub PR diffs only show files **inside the repo's working tree**. The two `~/.claude/projects/...` files are in the user's Claude Code memory store, not in `git ls-files`. Therefore:

- A PR reviewer who clicks "Files changed" sees only the ADR diff.
- The "reviewer checklist explicit on PR description: 'memory file + MEMORY.md entry verified present'" (line 59) requires the reviewer to manually run `ls /Users/fvicencio/.claude/projects/.../memory/feedback_sprint_2c_pattern.md` on their own machine.
- In solo-dev mode, Felipe IS both author and reviewer; the checklist becomes self-attestation by the same person who created (or forgot to create) the file. Self-review of an invisible artifact is exactly the G-A3 anti-pattern, re-skinned.
- An out-of-band reviewer (any future co-developer, or Claude in a different session) would not have the same `~/.claude/` topology; the file path on their machine differs.

This is **better than G-A3's `/ship` honor-system** because:
- The file existence is checked at T1 PR time, not at `/ship` time (earlier checkpoint).
- The reviewer is explicitly prompted to verify (per PR description checklist).
- The bundling makes "forgetting" require active willful skip, not passive omission.

But it is still honor-system: nothing mechanical fails if the memory file is absent.

**Acceptable mitigations (any of, in decreasing strength)**:
- (a) Move the memory file inside the repo, e.g., `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`. Then it appears in the PR diff. Loses the Claude-memory-system integration (Claude wouldn't auto-pull it into MEMORY context) but gains reviewability. **Recommended for highest mechanical strength.**
- (b) Add a CI check in T1's PR that fails if `docs/adr/054-*.md` references a memory-file path that doesn't exist. Requires building a script.
- (c) Accept the residual: document in T1 acceptance "memory file is reviewer-self-attestation; mechanical verification deferred since solo-dev sole author/reviewer makes it tractable, and the cost-of-forgetting (losing the Gen 1 vs Gen 2 lesson for future GCP work) is bounded".

**Verdict**: P1, not P0. The bundling materially reduces the G-A3 surface (single-PR atomicity), and Felipe-as-sole-PO can make the trade-off knowingly. But the plan currently calls this a "Merge guarantee (replaces G-A3 fix)" (line 59) which is **stronger language than the mechanism warrants**.

#### H-A2 [P1] T4-T6 transient-coverage-fail handling option (b) is honor-system rebranded

**Vector**: drift signal + convergence-check anti-pattern hunt.

T4 acceptance (lines 127-131) introduces "Coverage gate handling for T4-T6 transient states" with three options:
- (a) fat PR (rejected).
- (b) **Selected**: "each PR T4, T5, T6 documents 'transient coverage gate fail; threshold met on T7 PR' in description; reviewer approves with explicit waiver in PR description. T7 PR closes coverage gate cleanly."
- (c) disable thresholds temporarily (rejected — drift vocabulary).

Option (b) requires the **CI coverage gate to actually fail** on T4, T5, T6 PRs but be **merged anyway with reviewer override**. This requires either:
- Bypassing branch protection (admin override on each of T4/T5/T6) — possible, but each override is a click-through with no audit trail captured automatically.
- Configuring the coverage workflow as "not required" — defeats the gate.
- Merging via `gh pr merge --admin` — leaves a trace but is honor-system on the "reviewer approves with explicit waiver" step.

**This is precisely the G-A3 anti-pattern recurring**: "reviewer approves with explicit waiver in PR description" = `/ship`-style honor-system enforcement. The verdict v2 G-A3 reached ("merge gate is non-existent; the 'merge gate' claim is paper") applies identically to this option (b).

**Worse**: the plan rejects option (c) "disable thresholds temporarily" citing **drift vocabulary**, but option (b) IS effectively disabling thresholds temporarily, just at the PR-merge layer instead of the vitest-config layer. The framing is "disable thresholds = drift, but waiver each merge = OK". This is sophistic.

**Acceptable mitigations**:
- (d) **Restructure**: T4 ships handler.ts with a `// istanbul ignore next` block on the un-implemented branches OR ships the full handler skeleton with throwing stubs that the T5/T6/T7 tests progressively cover. This way coverage gate stays green on every PR; tests grow to cover real code as T5/T6/T7 land. Adds ~10 LOC scaffolding.
- (e) Combine T4+T5+T6+T7 into a single PR (the rejected option (a)). Yes, ~355 LOC violates the ≤100 cap; but the plan already takes 3 marginal LOC waivers, so a 4th for an integration PR is honest about cost.
- (f) Accept the residual: T4/T5/T6 are explicitly admin-merge with audit-trail in `git log --grep="transient coverage waiver"`.

**Verdict**: P1. The plan's own anti-drift stance (rejecting (c)) is undermined by selecting (b) which has the same outcome via a different mechanism. Either (d)/(e) for full mechanical enforcement, or (f) with self-aware framing.

### Convergence assessment

**Is this plan ready to ship as-is, with the understanding that some residual risks are accepted as PO judgment?**

**Yes, with two documented residuals**:
- **H-A1**: T1 memory file is out-of-tree; reviewer self-attestation accepted because Felipe is sole reviewer in solo-dev mode and the cost of forgetting is bounded (loss of an out-of-band lesson, not a security/correctness regression).
- **H-A2**: T4-T6 transient coverage-fail handling is honor-system option (b); accepted because the alternative (forced fat PR option (a) at ~355 LOC) violates atomic-vertical-slice principle and the alternative (d) scaffolding-stubs adds work without commensurate value at sub-sprint-A scope.

**Diminishing returns observed**: v1 had 4 P0 + 5 P1; v2 had 4 P0 + 3 P1; v3 has 0 P0 + 2 P1. Each iteration halves the finding count, and the remaining concerns are **about anti-patterns inherent to solo-dev honor-system workflows**, not about plan-text errors. Further redraft v4 would either invent compensating CI mechanisms (high-cost) or restate the same residuals (no value).

**Convergence reached.** The plan is approvable. Whether to address H-A1 / H-A2 mechanically or accept as residual is a PO judgment call, not a DA gate.

### Recommended next step

**ACCEPT WITH RESIDUAL** — APPROVE v3 for /build with the following two residuals explicitly logged in §Decision log + CURRENT.md:

1. **H-A1 residual**: Memory file existence is reviewer-self-attestation in T1's PR description. Cost-of-failure = loss of Gen 1 vs Gen 2 lesson; bounded impact. PO accepts.
2. **H-A2 residual**: T4-T6 PRs require admin-merge with coverage gate intentionally failing on each; T7 PR closes the gate cleanly. PO accepts the 3 admin-merges + commits to documenting the waiver in each PR description with `transient coverage waiver` literal grep-recoverable for future audit.

**Optional pre-/build follow-up** (PO discretion, not blocking):
- If H-A1 mechanical strength matters: move memory file to `docs/lessons-learned/` (in-tree) before T1's PR opens. ~5 minutes redraft.
- If H-A2 mechanical strength matters: restructure T4 to ship istanbul-ignored stubs OR combine T4+T5+T6+T7 with documented marginal waiver. ~30 minutes redraft.

If neither follow-up is taken, the plan ships v3 as-is with both residuals documented. Either path is defensible.

**Anti-pattern note**: The "prose-only fix" anti-pattern that dominated v1→v2→v3 history has materially diminished in v3 (8.5/9 G-A findings have mechanical artifacts in T1-T11 acceptance text, not just prose claims). The remaining honor-system residuals (H-A1, H-A2) are about **boundaries of mechanical enforcement in solo-dev mode**, not about hidden plan-author errors. This is the convergence signal.

---

**End of v3 DA pass — plan-a.md Sprint 2c-A. Convergence reached.**
