# Plan: sec-001-h1-2-google-blocking-a (Sprint 2c-A — handler implementation)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec post-split per umbrella G-14)
- **Created**: 2026-05-27 (v4)
- **Status**: **Approved** (PO 2026-05-27 post-DA v3 convergence + H-A1 + H-A2 mechanical fixes)
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history v1+v2+v3 of THIS plan: [`./plan-review.md`](./plan-review.md) (v1: F-A1..F-A14 4P0+5P1+5P2; v2: G-A1..G-A9 4P0+3P1+2P2; v3: H-A1+H-A2 0P0+2P1 ACCEPT WITH RESIDUAL).
  - Plan v1 (INVALIDATED): [`./plan-v1.md`](./plan-v1.md).
  - Plan v2 (INVALIDATED): [`./plan-v2.md`](./plan-v2.md).
  - Plan v3 (INVALIDATED): [`./plan-v3.md`](./plan-v3.md).
  - Umbrella DA history: [`../sec-001-h1-2-google-blocking/plan-review.md`](../sec-001-h1-2-google-blocking/plan-review.md).
  - Sibling: [`../sec-001-h1-2-google-blocking-b/spec.md`](../sec-001-h1-2-google-blocking-b/spec.md).
  - OQ resolution: [`../sec-001-h1-2-google-blocking/oq-research.md`](../sec-001-h1-2-google-blocking/oq-research.md).
  - Castellanizar followup (bidirectional cross-ref): [`../../_followups/castellanizar-adr-headers.md`](../../_followups/castellanizar-adr-headers.md).

## What changed v3 → v4

| Finding | Fix in v4 |
|---|---|
| H-A1 memory file out-of-tree | T1 deliverables **change**: memory file moves to **`docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`** (in-tree). PR diff visible to GitHub reviewers. Removes out-of-tree honor-system gap. Out-of-tree Claude memory store NOT updated by this plan (Felipe can sync to `~/.claude/.../memory/` manually if desired; not a deliverable). |
| H-A2 transient coverage gate honor-system | T4 ships **full handler skeleton with `// istanbul ignore next` blocks on un-implemented branches**. T5/T6/T7 each **remove** an istanbul-ignore comment + add the test covering that branch. **Coverage gate stays green on every PR**; transient-fail option (b) eliminated. ~+10 LOC scaffolding to T4. |

## Pre-conditions a `/build`

Sprint 2c-A `/build` gated por:

1. **Plan v4 approved** (this document — **Approved** in §header).
2. **DA convergence reached** (3 passes; final verdict ACCEPT WITH RESIDUAL → H-A1+H-A2 fixes applied → all residuals eliminated mechanically).
3. **OQ-PLAN status enumerated**:
   - OQ-PLAN-1 (Firebase emulator CI overhead) — **soft-waived**.
   - OQ-PLAN-2 (pnpm-workspace wildcard) — **resolved**.
   - OQ-PLAN-3 (Identity Platform SA email) — **2c-B scope**.
   - OQ-PLAN-4 (Admin SDK trigger empirical) — **addressed** via T10b.

**NOT gated** por ADR-052 Status flip Accepted.

## Tasks

### T1: ADR-054 draft + in-tree lessons-learned (atomic) — Google Blocking Function signup gate

- **Files**:
  - `docs/adr/054-google-blocking-function-signup-gate.md` (NEW, ~100 LOC).
  - `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md` (NEW, ~30 LOC) — **in-tree** per H-A1 fix.
- **LOC estimate**: ~130 (**marginal +30**, justified: lessons-learned bundled atomically with ADR; both load-bearing for future contributors).
- **Depends on**: ninguno.
- **Acceptance**:
  - **ADR-054** Status format: exactly `- **Status**: Proposed (2026-MM-DD; Sprint 2c-A T1)`. Numbering = ADR-054 definitively.
  - Sections completas: Context, Decision (Cloud Function Gen 1 + gcip-cloud-functions + handler design + 2c-A vs 2c-B split + `BLOCKED_SIGNUP_PENDING_APPROVAL` literal in handler.ts per F-A4 option (a)), Consequences, Alternatives, Notes for future-self.
  - **Lessons-learned in-tree** (`docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`) content:
    - Gen 1 vs Gen 2 architectural distinction (Identity Platform Blocking Functions support Gen 1 ONLY per `docs.cloud.google.com/identity-platform/docs/blocking-functions`).
    - SDK choice: `gcip-cloud-functions` NOT `firebase-functions/v2/identity`.
    - Empirical verification pattern: spike via WebFetch antes de /build cuando spec touches GCP service-specific runtime constraints.
    - Cross-reference to ADR-054.
  - **PR diff verification**: both files appear in `git diff main...HEAD` for T1's PR. Reviewer sees ADR + lessons-learned in "Files changed" view. **Mechanical, not self-attestation.**
- **SC trace**: umbrella §6 C12 + 2c-A SC-2C.A.1 foundation; out-of-band lessons-learned promoted to in-tree.
- **Rollback**: revert both files.

### T2a: Mechanical CI gate script — `check-adr-status-accepted.ts` + tests + bidirectional castellanizar cross-ref

- **Files**:
  - `apps/api/scripts/check-adr-status-accepted.ts` (NEW, ~40 LOC).
  - `apps/api/scripts/check-adr-status-accepted.test.ts` (NEW, ~50 LOC).
  - `.specs/_followups/castellanizar-adr-headers.md` (MODIFY, +~10 LOC) — exclusion clause for ADR-052/053/054.
- **LOC estimate**: ~100.
- **Depends on**: ninguno (ADR-052 already in `main`).
- **Acceptance**: narrow regex `^- \*\*Status\*\*: Accepted`; 5 fixtures (a)-(e) covering target line + ADR-014 colon-inside-bold exclusion + actual-file integration test; bidirectional cross-ref via followup MODIFY in same PR.
- **SC trace**: 2c-A SC-2C.A.5 partial.

### T2b: Mechanical CI gate workflow + branch protection docs

- **Files**: `.github/workflows/sprint-2c-build-gate.yml` (NEW, ~35 LOC).
- **LOC estimate**: ~35.
- **Depends on**: T2a merged.
- **Acceptance**: path-filter Sprint 2c-B paths; escape-hatch via `workflow_dispatch force=true`; branch protection rule added via `gh` command documented in PR description.
- **SC trace**: 2c-A SC-2C.A.5 complete.

### T3: apps/auth-blocking-functions bootstrap + coverage thresholds at workspace level

- **Files**:
  - `apps/auth-blocking-functions/package.json` (NEW, ~35 LOC) — deps **exact pin** `gcip-cloud-functions: "0.2.0"` + `firebase-admin: "^13.7.0"` + `firebase-functions: "^3.x"` + `pg: "^8.13.1"` + `@booster-ai/logger` + `@booster-ai/shared-schemas`. Scripts: `test:coverage` running `vitest --coverage` emitting `coverage/coverage-summary.json`.
  - `apps/auth-blocking-functions/tsconfig.json` (NEW, ~15 LOC) — module commonjs (Gen 1 runtime).
  - `apps/auth-blocking-functions/vitest.config.ts` (NEW, ~20 LOC) — `coverage.provider='v8'` + `thresholds={lines:80,branches:75,functions:80}` + `reporter=['text','json-summary']`.
  - `apps/auth-blocking-functions/.gitignore` (NEW, ~5 LOC).
- **LOC estimate**: ~75.
- **Depends on**: T2a + T2b merged.
- **Acceptance**:
  - `pnpm install --frozen-lockfile` succeeds.
  - Empty src/ at this point.
  - **No ci.yml change** — workspace picked up automatically by existing `find -name coverage-summary.json` (ci.yml line 112).
- **SC trace**: 2c-A §7 component 1 setup.

### T4: handler **full skeleton** with `istanbul ignore next` blocks + T4 test only

- **Files**:
  - `apps/auth-blocking-functions/src/index.ts` (NEW, ~20 LOC).
  - `apps/auth-blocking-functions/src/handler.ts` (NEW, ~50 LOC) — **full skeleton with all branches scaffolded** + `// istanbul ignore next` on un-implemented blocks per H-A2 fix. Structure:

    ```typescript
    export const handler = gcipCloudFunctions.AuthFunction.beforeCreateHandler(async (user, ctx) => {
      // T4: provider check (active)
      const isGoogle = user.providerData?.some(p => p.providerId === 'google.com');
      if (!isGoogle) return; // active in T4

      // T5: email normalize (un-implemented in T4; removed in T5 PR)
      // istanbul ignore next 3
      const email = user.email ?? throwHttpsError('invalid-argument', 'email required');
      const normalized = await import('./email-normalize').then(m => m.normalizeEmail(email));

      // T6: DB pool + T7: query + fail-closed (un-implemented in T4; removed in T7 PR)
      // istanbul ignore next 10
      try {
        const pool = await import('./db').then(m => m.getDbPool());
        const result = await pool.query(
          "SELECT estado FROM solicitudes_registro WHERE LOWER(email)=$1 AND estado='aprobado' LIMIT 1",
          [normalized],
        );
        if (result.rowCount === 0) {
          const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;
          throw new functions.auth.HttpsError('permission-denied', BLOCKED_CODE);
        }
      } catch (err) {
        // structured log + fail-closed
      }
    });
    ```

  - `apps/auth-blocking-functions/src/handler.test.ts` (NEW, ~40 LOC) — test T4 (`providerData !== google.com` early-return) + structure smoke.
- **LOC estimate**: ~110 (**marginal +10 over cap**, justified per H-A2 fix: bundling istanbul-scaffolding into T4 eliminates transient coverage-fail anti-pattern across T4/T5/T6 PRs).
- **Depends on**: T3 merged.
- **Acceptance** (per H-A2 fix):
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test:coverage` → T4 + structure tests pass; coverage on handler.ts ≥ 80/75/80 (un-implemented branches istanbul-ignored, counted as 100% covered). **Coverage gate stays green on this PR**.
  - Code comment at top of handler.ts documents the istanbul-ignore strategy: "Branches are istanbul-ignored until their implementing PR (T5/T6/T7) removes the ignore comment + adds covering test. This is a transient code-coverage pattern, not a runtime exception path."
- **SC trace**: 2c-A §10 T4. 2c-A SC-2C.A.3 partial.

### T5: email normalization + R-2C-9 tests + **remove T5 istanbul-ignore from handler.ts**

- **Files**:
  - `apps/auth-blocking-functions/src/email-normalize.ts` (NEW, ~30 LOC).
  - `apps/auth-blocking-functions/src/email-normalize.test.ts` (NEW, ~50 LOC) — 20+ variantes per R-2C-9.
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, +~5 LOC) — remove `// istanbul ignore next 3` on T5 block + activate the dynamic import as a static import.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +~10 LOC) — add test T6 (email missing → invalid-argument).
- **LOC estimate**: ~95.
- **Depends on**: T4 merged.
- **Acceptance**:
  - `normalizeEmail(input)` applies: lowercase + trim + NFC unicode + punycode decode. NO gmail alias collapsing.
  - 20+ variantes per R-2C-9.
  - 80/75/80 coverage en email-normalize.ts + handler.ts (T4 block + T5 block covered; T6/T7 blocks still istanbul-ignored).
  - **Coverage gate green** on this PR.
- **SC trace**: 2c-A §3 SC-2C.A.2; umbrella R-2C-9; 2c-A §10 T5 + T6.

### T6: DB pool + logger instance + **remove T6 istanbul-ignore from handler.ts (DB lookup branch only)**

- **Files**:
  - `apps/auth-blocking-functions/src/db.ts` (NEW, ~50 LOC).
  - `apps/auth-blocking-functions/src/logger.ts` (NEW, ~15 LOC).
  - `apps/auth-blocking-functions/src/db.test.ts` (NEW, ~20 LOC).
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, +~5 LOC) — partial: activate `getDbPool()` static import + keep the `solicitudes_registro` query istanbul-ignored until T7.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +~5 LOC) — mock DB pool ensure path is invoked.
- **LOC estimate**: ~95.
- **Depends on**: T5 merged.
- **Acceptance**:
  - `getDbPool()` returns lazily-initialized singleton.
  - Tests verify lazy init + reuse + 3s timeout.
  - handler.ts now invokes `getDbPool()` reachable code (covered); the query+rowCount check still istanbul-ignored (T7 territory).
  - **Coverage gate green**.
- **SC trace**: 2c-A §3 SC-2C.A.2 partial.

### T7: handler DB lookup complete + BLOCKED constant + 2c-B spec edit + tests T1+T2+T3+T7 + **remove final istanbul-ignore**

- **Files**:
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~10 LOC) — **remove final `// istanbul ignore next 10`** + finalize query + fail-closed catch + structured log con email-hashed.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +60 LOC) — tests T1 (DB empty → permission-denied), T2 (DB row aprobado → no throw), T3 (DB throw → HttpsError internal), T7 (estado != aprobado → permission-denied).
  - **`.specs/sec-001-h1-2-google-blocking-b/spec.md` (MODIFY, +~5 LOC)** per G-A2 fix — add §10 Test list bullet "T-LITERALS: integration test ensuring `apps/auth-blocking-functions/src/handler.ts` BLOCKED_CODE literal value MUST equal `apps/web/src/utils/translate-auth-error.ts` mapped string (path estimated; verify before locking)".
- **LOC estimate**: ~80.
- **Depends on**: T6 merged.
- **Acceptance**:
  - Handler complete flow active: provider check → email normalize → DB query → if 0 rows throw HttpsError permission-denied with `code='BLOCKED_SIGNUP_PENDING_APPROVAL'` → if row present return + structured log.
  - **BLOCKED constant** per F-A4 option (a): `const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;` inline; **2c-B spec edited in same PR** per G-A2 fix adding T-LITERALS obligation; **2c-B target path note** per G-A9 fix (estimated).
  - All 4 new tests pass.
  - Structured log: `event: 'signup.blocked.google'` + `correlationId` + `ipAddress` + `emailHashed`. NO email plaintext.
  - **No remaining istanbul-ignore in handler.ts**. Coverage SC-2C.A.2 ≥ 80/75/80 fully achieved on real code paths.
- **SC trace**: 2c-A §3 SC-2C.A.1, SC-2C.A.2; §10 T1+T2+T3+T7. Cross-plan obligation lands en mismo PR.

### T8: Ghost user inventory script + tests (read-only) — marginal waiver +10 LOC

- **Files**:
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.test.ts` (NEW, ~30 LOC).
- **LOC estimate**: ~110 (**marginal +10 LOC**).
- **Depends on**: T6 merged.
- **Acceptance**:
  - Lista Firebase users con `providerData.find(p => p.providerId === 'google.com')`.
  - Cross-reference contra `solicitudes_registro WHERE email=lower(user.email) AND estado='aprobado'`.
  - Output CSV `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-<ISO-timestamp>.csv`.
  - Read-only. Tests con mocks. Execution context documented (3 modes).
- **SC trace**: 2c-A §3 SC-2C.A.4; §10 T14.

### T9a: Firebase emulator + firebase.json + emulator integration test

- **Files**:
  - `apps/auth-blocking-functions/test/integration/firebase-emulator.test.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/firebase.json` (NEW, ~15 LOC).
- **LOC estimate**: ~95.
- **Depends on**: T7 merged.
- **Acceptance**: emulator arranca con auth+functions; seed approved row → Firebase user created; seed no row → user NOT created + `auth/internal-error`. Manual pre-merge corrida (OQ-PLAN-1 soft-waiver).
- **SC trace**: 2c-A §3 SC-2C.A.6 partial; §10 T8.

### T9b: Baseline measurement script + first measurement (NO emulator pass/fail)

- **Files**:
  - `apps/auth-blocking-functions/scripts/baseline-measure.ts` (NEW, ~30 LOC).
  - `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-2c-a-<commit-sha>.json` (NEW, ~5 LOC committed evidence).
  - `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-2c-a.latest.json` symlink.
- **LOC estimate**: ~40.
- **Depends on**: T9a merged.
- **Acceptance**: 10 invocations via emulator; output p50/p95/p99; **NO pass/fail bar** (per F-A7). Production p95 deferred 2c-B.
- **SC trace**: 2c-A §3 SC-2C.A.6 complete.

### T10a: Race-documents-invariant integration test

- **Files**: `apps/auth-blocking-functions/test/integration/race-documents-invariant.test.ts` (NEW, ~60 LOC).
- **LOC estimate**: ~60.
- **Depends on**: T9a merged.
- **Acceptance**: 3 sub-scenarios documenting commit-order MVCC invariant.
- **SC trace**: 2c-A §3 SC-2C.A.3 partial; §10 T10 + T12.

### T10b: Admin SDK no-impact integration test (empirically resolves OQ-2C-8)

- **Files**: `apps/auth-blocking-functions/test/integration/admin-sdk-no-impact.test.ts` (NEW, ~50 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T10a merged.
- **Acceptance**: invocar `approveSignupRequest` from apps/api; verify Admin SDK `createUser` succeeds + row updated + NO blocking-function log. Empirically resolves OQ-2C-8.
- **SC trace**: 2c-A §3 SC-2C.A.3 complete; §10 T13.

### T11: Handler-completeness smoke check (NOT a semantic gate)

- **Files**:
  - `apps/api/scripts/check-handler-completeness.ts` (NEW, ~40 LOC).
  - `apps/api/scripts/check-handler-completeness.test.ts` (NEW, ~40 LOC).
  - `.github/workflows/sprint-2c-handler-completeness.yml` (NEW, ~25 LOC).
- **LOC estimate**: ~105 (**marginal +5 LOC**).
- **Depends on**: T7 merged.
- **Acceptance** (per G-A1 honest framing): script greps for `solicitudes_registro` AND `BLOCKED_SIGNUP_PENDING_APPROVAL` literals; workflow YAML comment + script doc-comment explicitly state **smoke-not-gate** framing + cite T7+T10a+T10b as semantic verification surface; path-filter Sprint 2c-B deploy paths; escape-hatch `workflow_dispatch force=true`.
- **SC trace**: G-02 mechanical smoke; semantic correctness lives in T7/T10a/T10b.

## Out-of-band tasks (post-H-A1 fix)

- **`.specs/_followups/sprint-2c-google-blocking-function.md` cleanup**: mark "EXECUTED" or move to `.specs/_archive/`. **Owner**: Felipe (PO). **Trigger**: post-2c-A + 2c-B completion.
- **Optional Claude memory sync** (NOT a deliverable): if Felipe wants the `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md` content also available in Claude auto-memory, sync manually post-merge by creating `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/feedback_sprint_2c_pattern.md` + MEMORY.md index. Optional, no gate.

## Open questions

- **OQ-2C-A-1**: Firebase emulator CI overhead < 30s? **Soft-waived**: NO CI integration; manual pre-merge corrida.

## Alternatives considered (plan-level)

### Alt-2c-A-Plan-I: Combine T1+T2a

**Rejected**: T1 docs + lessons-learned; T2a code + followup. Conventional Commits separates.

### Alt-2c-A-Plan-II: Defer T2a/T2b to 2c-B

**Rejected**: gate must exist before 2c-B deploys.

### Alt-2c-A-Plan-III: Use exported constant from shared-schemas

**Rejected** (per G-A2 mitigation present in T7 acceptance via 2c-B spec edit): package work avoided.

### Alt-2c-A-Plan-IV: Single mega-PR (T3..T7)

**Rejected**: violates atomic vertical slices. (Note: H-A2 fix via istanbul-ignore scaffolding makes this option moot anyway — coverage gate stays green per-PR without needing fat PR.)

### Alt-2c-A-Plan-V: Skip T8 inventory en 2c-A

**Rejected**: 2c-B T12 (execution) depends on script existing.

### Alt-2c-A-Plan-VI: Broad regex T2a

**Rejected**: robustness theater.

### Alt-2c-A-Plan-VII: AST-based T11 upgrade

**Rejected**: T7+T10a+T10b semantic surface stronger than single AST scan.

### Alt-2c-A-Plan-VIII: Drop T11

**Rejected**: T11 still catches T4-state-shipping regression.

### Alt-2c-A-Plan-IX (NEW in v4): Memory file in `~/.claude/.../memory/` (per H-A1 option (c))

**Rejected** (PO 2026-05-27): out-of-tree means PR-reviewer cannot verify via "Files changed" tab. In-tree `docs/lessons-learned/` chosen for mechanical strength. Trade-off: Claude auto-memory system NOT auto-populated; manual sync available as optional out-of-band.

### Alt-2c-A-Plan-X (NEW in v4): Transient coverage waiver via PR description (v3 option (b))

**Rejected** (PO 2026-05-27 per H-A2 fix): same anti-pattern as v3 rejected option (c) ("disable thresholds = drift, but waiver each merge = OK" is sophistic). Istanbul-ignore scaffolding in T4 (option (d)) chosen — keeps coverage gate green every PR mechanically.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices; T1 bundles 2 in-tree files atomically.
- [x] All tasks ≤ 100 LOC OR waiver logged with genuine justification: T1 (130 marginal+30 lessons-learned bundle), T4 (110 marginal+10 istanbul-scaffolding), T8 (110 marginal+10 inventory), T11 (105 marginal+5 smoke check). 4 marginal waivers, all justified inline.
- [x] Acceptance traces to 2c-A spec §3 SC or §10 test per task.
- [x] Rollback plan for each task (revert files; no prod impact en 2c-A).
- [x] DA v1 findings F-A1..F-A14 fixed mechanically.
- [x] DA v2 findings G-A1..G-A9 fixed mechanically.
- [x] DA v3 findings H-A1+H-A2 fixed mechanically (memory in-tree + istanbul-scaffolding).
- [x] User approval: **Approved 2026-05-27** (PO Felipe Vicencio post-DA v3 convergence + both H-A1+H-A2 mitigations applied).
- [ ] phase_exit + ledger event: PENDING (next step).
- [ ] Branch + commit + PR: PENDING (next step).

## Total estimate v4

| Métrica | Valor |
|---|---|
| Tareas | **14** (T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11) |
| LOC total estimate | ~1110 cross-stack (apps/api + new app + ADR + lessons-learned + 2 workflows + 2c-B spec edit) |
| Tareas con waiver >100 LOC | 4 marginal (T1=130, T4=110, T8=110, T11=105) |
| **Wall-clock PO active** | ~2 días (14 tasks incremental shipping) |
| **Pre-condition para T1+ ship** | ✅ Plan v4 Approved |

**G-14 threshold**: 14 < 15 threshold; non-issue. Explicit waiver retained for transparency.

## Decision log

- **2026-05-26 23:37Z** — /plan 2c-A phase entered post-split.
- **2026-05-26 23:50Z** — DA v1: REVISE (4 P0 + 5 P1 + 5 P2 F-A1..F-A14).
- **2026-05-26 23:55Z** — Plan v2; DA v2: REVISE (4 P0 + 3 P1 + 2 P2 G-A1..G-A9).
- **2026-05-27 00:10Z** — Plan v3; DA v3: ACCEPT WITH RESIDUAL (0 P0 + 2 P1 H-A1+H-A2). Convergence reached.
- **2026-05-27 00:25Z** — PO chose option 2 (apply BOTH H-A1 + H-A2 fixes). Plan v4 drafted: memory file → `docs/lessons-learned/` in-tree; T4 ships istanbul-ignored scaffolding; transient coverage anti-pattern eliminated. Status: **Approved**. Next: phase_exit ledger + branch + commit + PR.
