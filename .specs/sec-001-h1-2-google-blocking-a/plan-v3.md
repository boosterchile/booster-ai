# Plan: sec-001-h1-2-google-blocking-a (Sprint 2c-A — handler implementation)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec post-split per umbrella G-14)
- **Created**: 2026-05-26 (v3)
- **Status**: Draft v3
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history v1+v2 of THIS plan: [`./plan-review.md`](./plan-review.md) (v1: 4 P0 + 5 P1 + 5 P2 F-A1..F-A14; v2: 4 P0 + 3 P1 + 2 P2 G-A1..G-A9).
  - Plan v1 (INVALIDATED): [`./plan-v1.md`](./plan-v1.md).
  - Plan v2 (INVALIDATED): [`./plan-v2.md`](./plan-v2.md).
  - Umbrella DA history: [`../sec-001-h1-2-google-blocking/plan-review.md`](../sec-001-h1-2-google-blocking/plan-review.md).
  - Sibling: [`../sec-001-h1-2-google-blocking-b/spec.md`](../sec-001-h1-2-google-blocking-b/spec.md).
  - OQ resolution: [`../sec-001-h1-2-google-blocking/oq-research.md`](../sec-001-h1-2-google-blocking/oq-research.md).
  - Castellanizar followup (bidirectional cross-ref per F-A3 fix): [`../../_followups/castellanizar-adr-headers.md`](../../_followups/castellanizar-adr-headers.md).

## What changed v2 → v3

| Finding | Fix in v3 |
|---|---|
| G-A1 T11 grep-defeatable | T11 acceptance **honestly labeled as smoke-not-gate**: "prevents skeleton-state shipping but does NOT verify semantic correctness; semantic correctness verified by T7 unit tests + T10a integration test (handler invariant) + T10b integration test (Admin SDK no-impact)". Grep theater acknowledged; gate retained for the specific narrow purpose of catching T4-state regression. |
| G-A2 F-A4 mitigation is plan-vapor | T7 acceptance includes **editing `.specs/sec-001-h1-2-google-blocking-b/spec.md`** in the same PR to add a §"Test list" bullet: "literals-match integration test (handler.ts BLOCKED_CODE constant value MUST equal apps/web/src/utils/translate-auth-error.ts mapped string)". File-visible obligation before 2c-A merges. |
| G-A3 `/ship` not enforceable | **T12 deleted**. Memory file `feedback_sprint_2c_pattern.md` absorbed into T1 acceptance as a hard prerequisite — T1 PR cannot merge without the memory file present. Reviewer/CI checklist (manual) enforces; reframed as "T1 lands ADR-054 + lessons-learned memory atomically". |
| G-A4 T3 ci.yml has no matrix | T3 acceptance enumerates `apps/auth-blocking-functions/package.json` `test:coverage` script + `apps/auth-blocking-functions/vitest.config.ts` `coverage.thresholds={lines:80,branches:75,functions:80}`. **No ci.yml change** — existing `find -name coverage-summary.json` gate (ci.yml line 112) automatically picks up the new workspace. |
| G-A5 G-14 task count threshold | §"Total estimate v3" includes explicit 2-line waiver: "G-14 threshold consciously not invoked because (a) sub-sprint scope already minimal, (b) further splitting yields sub-50-LOC PRs noisier than helpful". v3 task count = **14** (deleted T12). |
| G-A6 T11 inconsistent split rationale | T11 waiver relabeled: "marginal +5 LOC; split T11a/T11b considered but YAML workflow (~25 LOC) is below meaningful-PR threshold". Honest framing. |
| G-A7 T12 ordering | N/A (T12 deleted per G-A3 fix). |
| G-A8 task count contradiction | §"Total estimate v3" cleanly states 14 (no contradictory parenthetical). |
| G-A9 apps/web path unverified | T7 acceptance annotates path as "estimated; 2c-B plan-b draft must verify before locking". |

## Pre-conditions a `/build`

Sprint 2c-A `/build` gated por SOLO:

1. **Plan v3 approved** (this document).
2. **DA v3 pass-through** (third pass per DA loop convergence).
3. **OQ-PLAN status enumerated**:
   - OQ-PLAN-1 (Firebase emulator CI overhead) — **soft-waived**: NO CI integration en 2c-A; manual corrida pre-merge documented en 2c-B runbook.
   - OQ-PLAN-2 (pnpm-workspace wildcard) — **resolved** via `pnpm-workspace.yaml` line 2 `- 'apps/*'`.
   - OQ-PLAN-3 (Identity Platform SA email) — **2c-B scope**.
   - OQ-PLAN-4 (Admin SDK trigger empirical) — **addressed** via T10b.

**NOT gated** por ADR-052 Status flip Accepted — Sprint 2c-A paths fuera del path-filter del mechanical CI gate.

## Tasks

### T1: ADR-054 draft + lessons-learned memory file (atomic) — Google Blocking Function signup gate

- **Files**:
  - `docs/adr/054-google-blocking-function-signup-gate.md` (NEW, ~100 LOC).
  - `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/feedback_sprint_2c_pattern.md` (NEW, ~30 LOC) — Gen 1 vs Gen 2 verification pattern.
  - `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/MEMORY.md` (MODIFY, +1 line index entry).
- **LOC estimate**: ~130 (combined ADR + memory; **marginal +30 over cap** but justified: the lessons-learned is the highest-leverage out-of-band item per umbrella DA G-08; bundling with the ADR makes it land atomically and removes the `/ship` honor-system gap per G-A3).
- **Depends on**: ninguno.
- **Acceptance**:
  - **ADR-054** Status format: exactly `- **Status**: Proposed (2026-MM-DD; Sprint 2c-A T1)` (per F-A8 fix). Numbering = ADR-054 definitively (last in main is ADR-053).
  - Sections completas: Context, Decision (Cloud Function Gen 1 + gcip-cloud-functions + handler design + 2c-A vs 2c-B split + `BLOCKED_SIGNUP_PENDING_APPROVAL` literal in handler.ts per F-A4 option (a)), Consequences, Alternatives, Notes for future-self (Gen 2 migration when IdP supports + 1.0 SDK upgrade + post-7d-watch flip to Accepted), Acceptance criterion para flip.
  - **Memory file** content: covers Gen 1 vs Gen 2 architectural distinction; SDK choice `gcip-cloud-functions` NOT `firebase-functions/v2/identity`; empirical verification pattern (WebFetch spike before /build) when spec touches GCP service-specific runtime constraints; cross-reference to ADR-054.
  - **MEMORY.md index entry**: `- [Gen 1 vs Gen 2 verification pattern](feedback_sprint_2c_pattern.md) — Spike empirically antes de /build cuando spec toca constraints de GCP service-specific runtime.`
  - **Merge guarantee** (replaces G-A3 fix): all 3 files in **single PR**; reviewer checklist explicit on PR description "memory file + MEMORY.md entry verified present" before merge. T1 PR cannot merge without all 3.
- **SC trace**: umbrella §6 C12 + 2c-A SC-2C.A.1 foundation; out-of-band lessons-learned promoted.
- **Rollback**: revert all 3 files.

### T2a: Mechanical CI gate script — `check-adr-status-accepted.ts` + tests + bidirectional castellanizar cross-ref

- **Files**:
  - `apps/api/scripts/check-adr-status-accepted.ts` (NEW, ~40 LOC).
  - `apps/api/scripts/check-adr-status-accepted.test.ts` (NEW, ~50 LOC).
  - `.specs/_followups/castellanizar-adr-headers.md` (MODIFY, +~10 LOC) — exclusion clause.
- **LOC estimate**: ~100.
- **Depends on**: ninguno (ADR-052 already in `main`; parallel with T1 + T2b).
- **Acceptance**:
  - **Narrow regex**: `^- \*\*Status\*\*: Accepted` targeting ADR-052 exact post-flip form (per ADR-052 §"Acceptance criterion" verbatim line 116).
  - Script doc-comment documents 6+ format diversity acknowledged + scope explicit (ADR-052-only).
  - **Fixtures**:
    - (a) ADR-052 with `- **Status**: Proposed (...)` → exit 1.
    - (b) ADR-052 with `- **Status**: Accepted (post-canary success cloudbuild run <ID>)` → exit 0.
    - (c) ADR-014 `**Estado:** Aceptado` (colon-inside-bold) → exit 1 (deliberately out-of-scope).
    - (d) ADR-052 absent / malformed → exit 1.
    - (e) integration test opens actual `docs/adr/052-signup-migration-admin-sdk-gate.md` → exit 1 (current Proposed state).
  - **Bidirectional cross-ref**:
    - Script doc-comment cites castellanizar followup.
    - **AND** castellanizar followup MODIFIED en este PR para agregar §"Exclusiones / coordinación con Sprint 2c": "ADR-052, ADR-053, ADR-054 castellanization MUST be done AFTER Sprint 2c-B CERRADO + T2a gate regex updated to también match `- **Estado**: Aceptado` (o ejecutar batch atómico mismo PR)."
- **SC trace**: 2c-A SC-2C.A.5 partial; 2c-B SC-2C.B.8 foundation.

### T2b: Mechanical CI gate workflow + branch protection docs

- **Files**:
  - `.github/workflows/sprint-2c-build-gate.yml` (NEW, ~35 LOC).
- **LOC estimate**: ~35.
- **Depends on**: T2a merged.
- **Acceptance**:
  - Path-filter Sprint 2c-B paths: `infrastructure/auth-blocking-functions.tf`, `infrastructure/identity-platform.tf` (sections matching `blocking_functions`), `cloudbuild.production.yaml` (blocking-function-deploy steps).
  - YAML comment documents escape-hatch: "If gate has bug requiring fix that touches 2c-B paths, override via `workflow_dispatch` admin trigger with `force=true`."
  - Branch protection rule `main`: add workflow as required check; documented in T2b PR description con `gh` command for transparency.
- **SC trace**: 2c-A SC-2C.A.5 complete.

### T3: apps/auth-blocking-functions bootstrap + coverage thresholds at workspace level

- **Files**:
  - `apps/auth-blocking-functions/package.json` (NEW, ~35 LOC) — deps **exact pin** `gcip-cloud-functions: "0.2.0"` + `firebase-admin: "^13.7.0"` + `firebase-functions: "^3.x"` + `pg: "^8.13.1"` + `@booster-ai/logger` + `@booster-ai/shared-schemas`. **Scripts**: `test:coverage` running `vitest --coverage` emitting `coverage/coverage-summary.json` (matches existing ci.yml line 112 `find -name coverage-summary.json` pattern).
  - `apps/auth-blocking-functions/tsconfig.json` (NEW, ~15 LOC) — extends base, module commonjs (Gen 1 runtime).
  - `apps/auth-blocking-functions/vitest.config.ts` (NEW, ~20 LOC) — sets `test.coverage.provider='v8'` + `thresholds={lines:80,branches:75,functions:80}` + `reporter=['text','json-summary']` so json-summary lands at `coverage/coverage-summary.json`.
  - `apps/auth-blocking-functions/.gitignore` (NEW, ~5 LOC).
- **LOC estimate**: ~75.
- **Depends on**: T2a + T2b merged (mechanical gate in place; 2c-A paths NOT gated by design).
- **Acceptance** (per G-A4 fix):
  - `pnpm install --frozen-lockfile` succeeds; new workspace recognized via `apps/*` wildcard.
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test:coverage` runs (no-op succeeds since no tests yet, but emits `coverage/coverage-summary.json`).
  - **Coverage gate verification**: open T3 PR with empty src/ → CI `test` job's `find . -name coverage-summary.json` step picks up new workspace's summary → since 0/0 coverage, the json's `pct` field is `Infinity` (vitest behavior) or absent; verify CI passes (no LOC = no enforcement) for empty workspace, then **fails as expected** once T4 adds untested code. **No ci.yml change needed.**
  - Empty src/.
- **SC trace**: 2c-A §7 component 1 setup + F-A10 coverage gate wiring (mechanical via existing CI infrastructure).
- **Rollback**: delete dir.

### T4: handler skeleton + provider check + T4 test only

- **Files**:
  - `apps/auth-blocking-functions/src/index.ts` (NEW, ~20 LOC) — wire `gcipCloudFunctions.AuthFunction.beforeCreateHandler` import scaffold.
  - `apps/auth-blocking-functions/src/handler.ts` (NEW, ~30 LOC) — provider check + structured early-return (no DB code yet).
  - `apps/auth-blocking-functions/src/handler.test.ts` (NEW, ~40 LOC) — test T4 (`providerData !== google.com` early-return) + structure smoke tests.
- **LOC estimate**: ~90.
- **Depends on**: T3 merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test:coverage` → tests T4 + structure pass; coverage on handler.ts < 80 % (only T4 path covered). **CI coverage gate fails on this PR until T7 lands full coverage** — expected behavior per "T4 skeleton acceptable transient state". Document in T4 PR description that gate-fail is expected.

  **Coverage gate handling for T4-T6 transient states**: PRs T4, T5, T6 individually do not hit 80/75/80 thresholds on handler.ts. Three options:
    - (a) Land T4-T7 as a sequence in a single integration PR (rejected — fat PR).
    - (b) **Selected**: each PR T4, T5, T6 documents "transient coverage gate fail; threshold met on T7 PR" in description; reviewer approves with explicit waiver in PR description. T7 PR closes coverage gate cleanly.
    - (c) Disable coverage thresholds in vitest.config.ts temporarily (rejected — drift vocabulary).
- **SC trace**: 2c-A §10 T4 (provider passthrough). 2c-A SC-2C.A.3 partial.

### T5: email normalization + R-2C-9 tests (IDN/punycode/casing)

- **Files**:
  - `apps/auth-blocking-functions/src/email-normalize.ts` (NEW, ~30 LOC).
  - `apps/auth-blocking-functions/src/email-normalize.test.ts` (NEW, ~50 LOC) — 20+ variantes per R-2C-9.
- **LOC estimate**: ~80.
- **Depends on**: T4 merged.
- **Acceptance**:
  - `normalizeEmail(input)` applies: lowercase + trim + NFC unicode + punycode decode. NO gmail alias collapsing.
  - Tests cubren: 20+ variantes per R-2C-9.
  - 80 % lines / 75 % branches coverage en email-normalize.ts (full coverage achievable here; transient handler.ts gap remains).
- **SC trace**: 2c-A §3 SC-2C.A.2; umbrella R-2C-9; 2c-A §10 T5.

### T6: DB pool singleton + logger instance

- **Files**:
  - `apps/auth-blocking-functions/src/db.ts` (NEW, ~50 LOC).
  - `apps/auth-blocking-functions/src/logger.ts` (NEW, ~15 LOC).
  - `apps/auth-blocking-functions/src/db.test.ts` (NEW, ~20 LOC).
- **LOC estimate**: ~85.
- **Depends on**: T5 merged.
- **Acceptance**:
  - `getDbPool()` returns lazily-initialized singleton; subsequent calls reuse same instance.
  - Config read from `DATABASE_URL` env var.
  - Tests verify lazy init + reuse + timeout config (3s).
  - Coverage targets met for db.ts + logger.ts (full coverage achievable).
- **SC trace**: 2c-A §3 SC-2C.A.2 partial.

### T7: handler DB lookup complete + BLOCKED constant + 2c-B spec edit + tests T1+T2+T3+T6+T7

- **Files**:
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~35 LOC) — call `normalizeEmail` (T5) → `getDbPool()` (T6) → query `solicitudes_registro` → fail-closed + structured log.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +60 LOC) — tests T1, T2, T3, T6, T7.
  - **`.specs/sec-001-h1-2-google-blocking-b/spec.md` (MODIFY, +~5 LOC)** — per G-A2 fix, add §10 (Test list, create section if missing) bullet: "T-LITERALS: integration test ensuring `apps/auth-blocking-functions/src/handler.ts`'s `BLOCKED_CODE` literal value MUST equal `apps/web/src/utils/translate-auth-error.ts` mapped string. If file paths differ from estimate, 2c-B plan-b draft must update before locking."
- **LOC estimate**: ~100.
- **Depends on**: T6 merged.
- **Acceptance**:
  - Handler complete flow: provider check (T4 retained) → email normalize (T5) → DB query (T6) → if 0 rows throw HttpsError permission-denied with `code='BLOCKED_SIGNUP_PENDING_APPROVAL'` → if row present, return + structured log success.
  - **BLOCKED constant** (per F-A4 option (a)): handler.ts inlines `const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;` — string literal. **Cross-source-of-truth contract obligation enforced via 2c-B spec edit in same PR** (per G-A2 fix): 2c-B spec gains a T-LITERALS test bullet documenting the constraint that handler.ts BLOCKED_CODE === apps/web translateAuthError mapped string. File-visible obligation lands with T7.
  - **2c-B target path note** (per G-A9 fix): "2c-B plan-b draft must verify `apps/web/src/utils/translate-auth-error.ts` exists before locking; if file absent, T-LITERALS becomes 'create + add mapping' rather than 'extend existing'."
  - All 5 new tests pass.
  - Structured log entry: `event: 'signup.blocked.google'` + `correlationId` + `ipAddress` + `emailHashed`. NO email plaintext.
  - Coverage SC-2C.A.2 ≥ 80 % / 75 % branches en handler.ts — **closes transient T4-T6 gate-fail per coverage gate handling note in T4**.
- **SC trace**: 2c-A §3 SC-2C.A.1, SC-2C.A.2; §10 T1+T2+T3+T6+T7. Cross-plan: 2c-B spec gains T-LITERALS obligation in same PR.

### T8: Ghost user inventory script + tests (read-only) — marginal waiver +10 LOC

- **Files**:
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.test.ts` (NEW, ~30 LOC).
- **LOC estimate**: ~110 (**marginal waiver, +10 LOC**, per umbrella F-06 v1 verdict).
- **Depends on**: T6 merged.
- **Acceptance**:
  - Script lista Firebase users con `providerData.find(p => p.providerId === 'google.com')`.
  - Cross-reference cada user contra `solicitudes_registro WHERE email=lower(user.email) AND estado='aprobado'`.
  - Output CSV `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-<ISO-timestamp>.csv`.
  - **Read-only**: NO disabling, NO deletion.
  - Tests con mock Admin SDK + mock DB.
  - Execution context (per umbrella F-08 v1 fix): 3 modes documented; 2c-A delivers script + tests only.
- **SC trace**: 2c-A §3 SC-2C.A.4; §10 T14.

### T9a: Firebase emulator + firebase.json + emulator integration test

- **Files**:
  - `apps/auth-blocking-functions/test/integration/firebase-emulator.test.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/firebase.json` (NEW, ~15 LOC).
- **LOC estimate**: ~95.
- **Depends on**: T7 merged.
- **Acceptance**:
  - `firebase emulators:start --only auth,functions` arranca local emulator.
  - Seed approved row → trigger Google signup → expect Firebase user created.
  - Seed no row → trigger Google signup → expect Firebase user NOT created + error `auth/internal-error`.
  - CI integration: optional (manual corrida pre-merge documented in 2c-B runbook per OQ-PLAN-1 soft-waiver).
- **SC trace**: 2c-A §3 SC-2C.A.6 partial; §10 T8.

### T9b: Baseline measurement script + first measurement (NO emulator pass/fail)

- **Files**:
  - `apps/auth-blocking-functions/scripts/baseline-measure.ts` (NEW, ~30 LOC).
  - `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-2c-a-<commit-sha>.json` (NEW, ~5 LOC committed evidence).
  - `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-2c-a.latest.json` symlink.
- **LOC estimate**: ~40.
- **Depends on**: T9a merged.
- **Acceptance**:
  - Script runs 10 invocations via T9a's emulator → output p50/p95/p99 → write JSON to versioned file + update `.latest` symlink.
  - **NO pass/fail threshold against emulator** (per F-A7 fix). Production p95 bar applies in 2c-B post-deploy.
  - JSON file committed as evidence.
- **SC trace**: 2c-A §3 SC-2C.A.6 complete (emulator measurement captured; prod measurement deferred 2c-B).

### T10a: Race-documents-invariant integration test

- **Files**:
  - `apps/auth-blocking-functions/test/integration/race-documents-invariant.test.ts` (NEW, ~60 LOC).
- **LOC estimate**: ~60.
- **Depends on**: T9a merged.
- **Acceptance**: 3 sub-scenarios documenting commit-order MVCC invariant.
- **SC trace**: 2c-A §3 SC-2C.A.3 partial; §10 T10 + T12.

### T10b: Admin SDK no-impact integration test (empirically resolves OQ-2C-8)

- **Files**:
  - `apps/auth-blocking-functions/test/integration/admin-sdk-no-impact.test.ts` (NEW, ~50 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T10a merged.
- **Acceptance**:
  - Invocar `approveSignupRequest` desde apps/api con email matching pending solicitudes_registro → verify Admin SDK `createUser` succeeds + row updated estado=aprobado + NO log entry from blocking function rejecting.
  - **Empirically resolves OQ-2C-8** (umbrella).
- **SC trace**: 2c-A §3 SC-2C.A.3 complete; §10 T13.

### T11: Handler-completeness smoke check (NOT a semantic gate)

- **Files**:
  - `apps/api/scripts/check-handler-completeness.ts` (NEW, ~40 LOC) — grep for `solicitudes_registro` AND `BLOCKED_SIGNUP_PENDING_APPROVAL` literals in handler.ts.
  - `apps/api/scripts/check-handler-completeness.test.ts` (NEW, ~40 LOC) — fixture tests.
  - `.github/workflows/sprint-2c-handler-completeness.yml` (NEW, ~25 LOC) — path-filtered to Sprint 2c-B deploy paths.
- **LOC estimate**: ~105 (**marginal waiver, +5 LOC**, per G-A6 honest framing: split T11a/T11b considered but YAML workflow (~25 LOC) is below meaningful-PR threshold).
- **Depends on**: T7 merged.
- **Acceptance** (per G-A1 honest framing):
  - Script returns exit 0 only if BOTH greps succeed.
  - Workflow YAML comment + script doc-comment explicitly state: "**This is a smoke check, NOT a semantic gate**. Prevents shipping handler skeleton (T4-state) to prod. Does NOT verify call-site correctness (e.g., refactored constants without active query) — semantic correctness verified by T7 unit tests + T10a race-documents-invariant + T10b Admin SDK no-impact integration tests. Acceptable defeat scenarios: refactor-to-constant, commented-out code, dead-code path. These are caught by code review, not by this script."
  - Branch protection rule adds workflow as required check (manual config post-merge).
  - Escape-hatch: `workflow_dispatch` admin trigger with `force=true`.
- **SC trace**: G-02 mechanical smoke; semantic correctness lives in T7/T10a/T10b.

## Out-of-band tasks (post-G-A3 fix: memory file moved to T1)

- **`.specs/_followups/sprint-2c-google-blocking-function.md` cleanup**: mark "EXECUTED" or move to `.specs/_archive/`. **Owner**: Felipe (PO). **Trigger**: post-2c-A + 2c-B completion.

## Open questions

- **OQ-2C-A-1**: Firebase emulator CI overhead < 30s? Soft-waived: NO CI integration; manual pre-merge corrida.

## Alternatives considered (plan-level)

### Alt-2c-A-Plan-I: Combine T1+T2a (ADR + CI gate script) into single PR

**Rejected**: T1 is docs + memory; T2a is code + bidirectional followup. Conventional Commits separates scopes.

### Alt-2c-A-Plan-II: Defer T2a/T2b mechanical CI gate to 2c-B

**Rejected**: gate must exist BEFORE 2c-B deploys.

### Alt-2c-A-Plan-III: Use exported constant from `packages/shared-schemas/src/auth/signup-errors.ts`

**Considered seriously per G-A2 review**: adds ~20 LOC to 2c-A (new file in shared-schemas + barrel + tsconfig refs). **Rejected with stronger justification**: option (a) string-literal-in-handler retained because G-A2 fix (T7 edits 2c-B spec adding T-LITERALS) gives file-visible cross-source-of-truth obligation before 2c-A merges, mitigating the "vapor mitigation" concern. Package work avoided.

### Alt-2c-A-Plan-IV: Ship single mega-PR (T3..T7)

**Rejected**: violates atomic vertical slices.

### Alt-2c-A-Plan-V: Skip T8 inventory in 2c-A

**Rejected**: 2c-B T12 (execution) depends on script existing.

### Alt-2c-A-Plan-VI: Make T2a regex broad to catch all 6 corpus formats

**Rejected**: "robustness theater"; narrow + documented is more honest.

### Alt-2c-A-Plan-VII: Upgrade T11 to AST-based check (`ts-morph` semantic verification)

**Considered seriously per G-A1**: AST scan would verify `pool.query` call-site references `FROM solicitudes_registro` in reachable handler code. +30 LOC, significantly higher signal. **Rejected**: T7 unit tests + T10a integration test + T10b Admin SDK no-impact test together provide stronger semantic verification than a single AST scan. T11 retained as honest smoke check; combined verification surface meets G-02 lesson without grep theater.

### Alt-2c-A-Plan-VIII: Drop T11 entirely

**Rejected**: T11 still catches the T4-state-shipping regression (the original G-02 failure mode). The grep gate is weak but non-zero signal; T7/T10a/T10b cover the semantic gaps. Keeping T11 as smoke check is cheap (105 LOC) and explicit-about-its-limits.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices (compile + test + mergeable independently); T1 bundles 3-files atomically.
- [x] All tasks ≤ 100 LOC OR waiver logged with genuine justification: T1 (130 marginal+30, justified bundling lessons-learned), T8 (110 marginal+10), T11 (105 marginal+5). 3 waivers, all marginal, all justified.
- [x] Acceptance traces to 2c-A spec §3 SC or §10 test per task.
- [x] Rollback plan for each task (revert files; no prod impact en 2c-A).
- [x] DA v1 findings F-A1..F-A14 fixed mechanically (per §"What changed v1 → v2" in v2 + retained in v3).
- [x] DA v2 findings G-A1..G-A9 fixed mechanically (per §"What changed v2 → v3" above).
- [ ] DA v3 pass output captured: PENDING T89.
- [ ] User approval: PENDING T87.

## Total estimate v3

| Métrica | Valor |
|---|---|
| Tareas | **14** (T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11) |
| LOC total estimate | ~1100 cross-stack (apps/api + new app + ADR + 2 workflows + memory file bundled into T1) |
| Tareas con waiver >100 LOC | 3 marginal (T1=130 lessons-learned bundle, T8=110, T11=105) |
| **Wall-clock PO active** | ~2 días (14 tasks incremental shipping) |
| **Pre-condition para T1+ ship** | Plan v3 approved + DA v3 pass-through |

**G-14 threshold explicit waiver** (per G-A5 fix): Task count = 14, below the G-14 threshold of ≥15. Even if it were at 15, the consciously chosen granularity is: sub-sprint scope already minimal (handler-only); further splitting yields sub-50-LOC PRs noisier than helpful. 14 atomic vertical slices is the right cadence here.

## Decision log

- **2026-05-26 23:37Z** — /plan 2c-A phase entered post-split.
- **2026-05-26 23:50Z** — DA v1 pass: REVISE (4 P0 + 5 P1 + 5 P2 F-A1..F-A14). Plan v1 preserved.
- **2026-05-26 23:55Z** — Plan v2 drafted; DA v2 pass: REVISE (4 P0 + 3 P1 + 2 P2 G-A1..G-A9). Plan v2 preserved.
- **2026-05-27 00:10Z** — Plan v3 drafted addressing all G-A1..G-A9 findings. Memory file absorbed into T1 (G-A3 fix); T12 deleted; task count 14. Status: Draft v3 awaiting DA v3 pass + user approval.
