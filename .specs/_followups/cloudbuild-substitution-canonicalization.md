# Followup: Cloud Build substitution canonicalization + plan-amendment exception note

**Created**: 2026-05-28 (Sprint 2c-B T3-fix DA v5 residual)
**Owner**: PO (Felipe Vicencio)
**Priority**: **P1** (escalated 2026-05-28 by Sprint 2b T13-fix DA v1 P1 finding — second plan amendment in 48h triggered the escalation clause below)

## Escalation log

- 2026-05-28 — Sprint 2c-B T3-fix DA v5: original creation as P2 residual.
- 2026-05-28 — Sprint 2b T13-fix DA v1: detected second amendment in same 48h window; T13-fix violates the ≤1-file rule (touches 2 files after option-B refactor; touched 4 in initial draft). Escalated to **P1**. Per §"Item 2" exception clause, the **third amendment is now blocked** until a process ADR is produced.

## Two unrelated items tracked in one stub

### Item 1 — `_AUTH_BLOCKING_DEPLOY` strict-match brittleness (DA v5 P1-3 residual)

`cloudbuild.production.yaml` T3-fix gates the auth-blocking lane on the literal string `"true"` (lowercase, exact). Operators who pass `True`, `TRUE`, `1`, `yes`, or any non-exact form will silently SKIP all 3 auth-blocking steps. Cloud Build returns green; the operator believes the lane ran.

Current mitigations:
- Inline yaml comment: "default 'false', exact-match lowercase 'true' required".
- T6 runbook `docs/qa/google-blocking-function-runbook.md` §2 Step 2 example uses canonical `_AUTH_BLOCKING_DEPLOY=true`.
- Each `echo SKIP ...` line prints the received value verbatim (loud failure mode in logs).

What's still missing:
- No CI-side assertion that prevents operators from passing canonicalized variants by mistake.
- The post-deploy `verify-auth-blocking-deployed` step also SKIPs on the same gate. A typo in the substitution skips both deploy AND verify, so no signal differentiates "deploy ran + succeeded" from "deploy silently skipped".

### Proposed resolution

Pick one in a future plan cycle:
- **Option A — accept tokens**: case statement `case "${_AUTH_BLOCKING_DEPLOY,,}" in true|1|yes|on) ;; *) echo SKIP; exit 0;; esac`. Liberal-accept Postel approach. Lower-bar for operator memory.
- **Option B — split the substitution**: deploy step gate stays `_AUTH_BLOCKING_DEPLOY=true`; verify step gate becomes independent `_AUTH_BLOCKING_VERIFY=true` so a typo on one doesn't silently skip the other. Forces operators to be intentional twice.
- **Option C — add a "deploy summary" step at end** that checks whether the auth-blocking lane was supposed to run (by inspecting both substitutions) and FAILs if the lane was supposed to run but produced SKIPs. Loud signal post-hoc.

Recommendation: B (cheap, surfaces the issue) + add the followup runbook check.

### Item 2 — Plan-amendment-vs-sub-spec exception note (DA v5 P2-7 residual)

T3-fix was tracked as an amendment to `.specs/sec-001-h1-2-google-blocking-b/plan.md` instead of a fresh `.specs/sec-001-h1-2-google-blocking-b-hotfix/` sub-spec.

**Rationale recorded at decision time**: ~20 LOC repairing a defect introduced 24h earlier in the same sub-spec; new sub-spec would scatter the incident record.

**Why this is a soft-skip-cycle smell**:
- The amendment does not have its own `verify.md` + `review.md`. The agent-rigor spec/plan/verify/review/ship cycle is half-executed.
- Future grep for "T3-fix" finds the amendment, but the lifecycle metadata (when verified, when reviewed by whom) lives inline in plan.md rather than in dedicated artifacts.

**Decision (documented as exception, not precedent)**:
- T3-fix specifically — accepted as outage-hotfix exception.
- Any future "amendment to existing plan" use case must either (a) be ≤10 LOC AND ≤1 file, OR (b) open a sub-spec with full cycle artifacts.

If/when a third amendment is contemplated in any active spec, escalate this followup to a P1 and convert to a process ADR.
