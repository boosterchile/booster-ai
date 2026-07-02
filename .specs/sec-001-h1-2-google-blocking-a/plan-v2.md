# Plan: sec-001-h1-2-google-blocking-a (Sprint 2c-A — handler implementation)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec post-split per umbrella G-14)
- **Created**: 2026-05-26 (v2)
- **Status**: Draft v2
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history v1 of THIS plan: [`./plan-review.md`](./plan-review.md) (4 P0 + 5 P1 findings F-A1..F-A14).
  - Plan v1 (INVALIDATED post-DA): [`./plan-v1.md`](./plan-v1.md).
  - Umbrella DA history: [`../sec-001-h1-2-google-blocking/plan-review.md`](../sec-001-h1-2-google-blocking/plan-review.md).
  - Sibling: [`../sec-001-h1-2-google-blocking-b/spec.md`](../sec-001-h1-2-google-blocking-b/spec.md) (Sprint 2c-B deploy; plan-b TBD next session).
  - OQ resolution: [`../sec-001-h1-2-google-blocking/oq-research.md`](../sec-001-h1-2-google-blocking/oq-research.md).
  - Castellanizar followup (bidirectional cross-ref per F-A3 fix): [`../../_followups/castellanizar-adr-headers.md`](../../_followups/castellanizar-adr-headers.md).

## What changed v1 → v2

| Finding | Fix in v2 |
|---|---|
| F-A1 regex enumeration wrong (6+ formats, plan said 3) | T2a regex **narrowed** to ADR-052 exact post-flip line, with fixture for that literal line. NO speculative alternation. Format diversity acknowledged in T2a §rationale. |
| F-A2 T2 depends-on-T1 backwards | T2a/T2b have **no dependency on T1**. ADR-052 already exists in `main`. T1, T2a, T2b can ship in parallel. |
| F-A3 castellanizar cross-ref one-directional | T2a acceptance includes **modifying** `.specs/_followups/castellanizar-adr-headers.md` to add exclusion clause for ADR-052/053 + new ADR-054 until Sprint 2c-B CERRADO. Cross-ref is bidirectional. |
| F-A4 BLOCKED constant location undeclared | **Decision option (a)**: constant `BLOCKED_SIGNUP_PENDING_APPROVAL` lives as string literal in handler.ts. 2c-B T11 duplicates literal in `apps/web/src/utils/translate-auth-error.ts`. Documented in T7 acceptance + a note in T1 ADR §Notes-for-future-self. |
| F-A5 LOC waivers split cleanly | T2 → T2a + T2b. T9 → T9a + T9b. T10 → T10a + T10b. T8 keeps marginal-waiver label. |
| F-A6 G-02 honor-system enforcement recurs | New T11: second mechanical CI workflow `sprint-2c-handler-completeness.yml` (path-filtered Sprint 2c-B deploy paths) that fails if `apps/auth-blocking-functions/src/handler.ts` does not contain `solicitudes_registro` literal. |
| F-A7 T9 emulator p95 < 1500ms unfounded | T9b dropped pass/fail threshold. Acceptance: "measure + record baseline; pass/fail bar applies only to **production** measurement in Sprint 2c-B post-deploy." |
| F-A8 T1 ADR Status format undeclared | T1 acceptance mandates `- **Status**: Proposed (...)` (leading dash, English key) matching ADR-052/053 lineage. Documented to enable post-7d-watch flip mechanism. |
| F-A9 out-of-band memory file unforced | T12 (memory file feedback_sprint_2c_pattern.md) promoted to task list with hard merge gate: 2c-A `/ship` cannot complete without it. |
| F-A10 P2 coverage gate honor-system | T3 acceptance extended: "add `apps/auth-blocking-functions` to CI coverage matrix in `.github/workflows/ci.yml` (or turbo coverage config)". |
| F-A11 P2 baseline filename unstable | T9b acceptance: single committed `baseline-perf-2c-a-<commit-sha>.json` + `.latest` symlink. |
| F-A12 P2 ADR-054 deterministic | T1 says ADR-054 definitively. Plan removes "estimated 054 o 055". |
| F-A13 P2 escape-hatch wrong location | Escape-hatch documented in T2b workflow YAML comment, NOT in T1 ADR. |
| F-A14 P2 OQ-PLAN status incomplete | §Pre-conditions enumerates OQ-PLAN-1..4 status. |

## Pre-conditions a `/build`

Sprint 2c-A `/build` gated por SOLO:

1. **Plan v2 approved** (this document).
2. **DA pass-through on v2** (second pass per skill recommended next step).
3. **OQ-PLAN status enumerated** (per F-A14 fix):
   - OQ-PLAN-1 (Firebase emulator CI overhead) — **soft-waived**: NO CI integration en 2c-A; manual corrida pre-merge documented en 2c-B runbook. Residual risk accepted.
   - OQ-PLAN-2 (pnpm-workspace wildcard catches `apps/*`) — **resolved**: confirmed via `pnpm-workspace.yaml` line 2 `- 'apps/*'` (`grep` evidence in oq-research).
   - OQ-PLAN-3 (Identity Platform SA email for invoker binding) — **2c-B scope**, NOT pre-condition for 2c-A.
   - OQ-PLAN-4 (Admin SDK trigger empirical) — **addressed** via T10b integration test (admin-sdk-no-impact).

**NOT gated** por ADR-052 Status flip Accepted — Sprint 2c-A paths (`apps/auth-blocking-functions/src/**`, `test/**`, `scripts/**`) están **fuera del path-filter** del mechanical CI gate (gate solo aplica a Sprint 2c-B deploy paths per spec C14 redefined).

## Tasks

### T1: ADR-054 draft — Google Blocking Function signup gate (Proposed) — covers 2c-A + 2c-B architectures

- **Files**:
  - `docs/adr/054-google-blocking-function-signup-gate.md` (NEW, ~100 LOC).
- **LOC estimate**: ~100.
- **Depends on**: ninguno (plan approved es único requirement).
- **Acceptance**:
  - Sigue pattern ADR-052 + ADR-053 (Context / Decision / Consequences / Alternatives / Acceptance criterion).
  - **Status format** (per F-A8 fix): exactly `- **Status**: Proposed (2026-MM-DD; Sprint 2c-A T1)` — leading dash + English key. Documented choice in §Notes-for-future-self con rationale: matches ADR-052/053 lineage; T2a regex targets this lineage.
  - Sections completas: Context (parent spec §1+§2 + umbrella sub-split rationale), Decision (Cloud Function Gen 1 + gcip-cloud-functions + handler design + 2c-A code-only vs 2c-B deploy split + `BLOCKED_SIGNUP_PENDING_APPROVAL` constant location = handler.ts string literal per F-A4 option (a)), Consequences, Alternatives (per umbrella §8), Notes for future-self (Gen 2 migration when IdP supports + 1.0 SDK upgrade + 2c-B post-7d-watch flip to Accepted), Acceptance criterion para flip Proposed → Accepted (Sprint 2c-B closure post 7d watch).
  - Numbering: **ADR-054** definitively (last ADR in main is ADR-053; deterministic next number per F-A12 fix).
- **SC trace**: umbrella §6 C12 + 2c-A SC-2C.A.1 foundation.
- **Rollback**: revert ADR file.

### T2a: Mechanical CI gate script — `check-adr-status-accepted.ts` + tests + **bidirectional castellanizar cross-ref**

- **Files**:
  - `apps/api/scripts/check-adr-status-accepted.ts` (NEW, ~40 LOC) — standalone script with **narrow regex** targeting ADR-052's exact post-flip Status line.
  - `apps/api/scripts/check-adr-status-accepted.test.ts` (NEW, ~50 LOC) — unit tests + integration fixture test contra actual ADR-052 file content.
  - `.specs/_followups/castellanizar-adr-headers.md` (MODIFY, +~10 LOC) — add exclusion clause per F-A3 fix.
- **LOC estimate**: ~100.
- **Depends on**: ninguno (ADR-052 already exists in `main`; T1 NOT a dependency per F-A2 fix). Can ship parallel to T1 + T2b.
- **Acceptance**:
  - **Narrow regex** (per F-A1 fix): pattern targets **ADR-052 exact post-flip form** only:
    - `^- \*\*Status\*\*: Accepted` (leading dash + English `Status` + colon-after-bold + Accepted, anchored to ADR-052 line 3-10 search window).
  - **Format diversity acknowledged**: script doc-comment documents that `docs/adr/*.md` corpus contains **6+ Status formats** (citing the `grep` evidence in plan-review.md §A). Gate is **ADR-052-specific by design**, not corpus-general. This is a deliberate scope choice, not an oversight.
  - **Fixtures**:
    - (a) ADR-052 file with `- **Status**: Proposed (...)` → exit 1.
    - (b) ADR-052 file with `- **Status**: Accepted (post-canary success cloudbuild run <ID>)` → exit 0. **This is the literal post-flip line** per ADR-052 §"Acceptance criterion para transition Proposed → Accepted".
    - (c) ADR-014 `**Estado:** Aceptado` (colon-inside-bold) → exit 1 (deliberately not matched; out-of-scope per design).
    - (d) ADR-052 absent / malformed → exit 1.
    - **(e) integration test**: opens actual `docs/adr/052-signup-migration-admin-sdk-gate.md` from filesystem → expect exit 1 (current state Proposed).
  - **Bidirectional castellanizar cross-ref** (per F-A3 fix):
    - Script doc-comment cites `.specs/_followups/castellanizar-adr-headers.md` con instrucción de coordinar regex update si la migración ejecuta.
    - **AND** `.specs/_followups/castellanizar-adr-headers.md` MODIFIED en este PR para agregar §"Exclusiones / coordinación con Sprint 2c": "ADR-052, ADR-053 y ADR-054 castellanization MUST be done AFTER Sprint 2c-B CERRADO + T2a gate regex updated to también match `- **Estado**: Aceptado` (o ejecutar batch atómico que actualice ambos en mismo PR)."
  - Branch protection rule `main` adds workflow as required check for Sprint 2c-B paths (configuration manual post-T2b merge, documented en T2b acceptance).
- **SC trace**: 2c-A SC-2C.A.5 partial; 2c-B SC-2C.B.8 foundation.
- **Rollback**: revert 3 archivos (script + tests + followup modify).

### T2b: Mechanical CI gate workflow + branch protection docs

- **Files**:
  - `.github/workflows/sprint-2c-build-gate.yml` (NEW, ~35 LOC) — path-filtered job targeting **Sprint 2c-B paths only**.
- **LOC estimate**: ~35.
- **Depends on**: T2a merged (workflow invokes the script).
- **Acceptance**:
  - Workflow corre on `pull_request` con **path-filter Sprint 2c-B paths**:
    - `infrastructure/auth-blocking-functions.tf`
    - `infrastructure/identity-platform.tf` (only sections matching `blocking_functions` per regex)
    - `cloudbuild.production.yaml` (only diffs touching blocking-function-deploy steps)
  - Workflow YAML comment documents escape-hatch (per F-A13 fix): "If gate has bug requiring fix that touches 2c-B paths, override via `workflow_dispatch` admin trigger with `force=true` input."
  - Branch protection rule `main`: add workflow as required check (manual config post-merge; documented en T2b PR description con `gh` command for transparency).
- **SC trace**: 2c-A SC-2C.A.5 complete; 2c-B SC-2C.B.8 foundation.
- **Rollback**: revert YAML + remove from branch protection rules manually.

### T3: apps/auth-blocking-functions bootstrap + CI coverage matrix entry

- **Files**:
  - `apps/auth-blocking-functions/package.json` (NEW, ~30 LOC) — deps **exact pin** `gcip-cloud-functions: "0.2.0"` + `firebase-admin: "^13.7.0"` + `firebase-functions: "^3.x"` (Gen 1 compatible) + `pg: "^8.13.1"` + `@booster-ai/logger` + `@booster-ai/shared-schemas`.
  - `apps/auth-blocking-functions/tsconfig.json` (NEW, ~15 LOC) — extends base, module commonjs (Gen 1 runtime).
  - `apps/auth-blocking-functions/.gitignore` (NEW, ~5 LOC).
  - `.github/workflows/ci.yml` (MODIFY, ~5 LOC) — add `apps/auth-blocking-functions` to coverage matrix per F-A10 fix.
  - `turbo.json` (MODIFY if needed, ~3 LOC) — ensure coverage pipeline catches new app.
- **LOC estimate**: ~60.
- **Depends on**: T2a + T2b merged (mechanical gate in place; 2c-A paths NOT gated por design but coverage matrix ready).
- **Acceptance**:
  - `pnpm install --frozen-lockfile` succeeds; new workspace recognized (OQ-PLAN-2 confirmed `apps/*` wildcard catches).
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - CI workflow `ci.yml` runs `pnpm --filter @booster-ai/auth-blocking-functions test --coverage` per matrix entry (no-op succeeds since no tests yet; smoke verifies matrix wiring).
  - Empty src/; tests no yet.
- **SC trace**: 2c-A §7 component 1 setup + F-A10 coverage gate wiring.
- **Rollback**: delete dir + revert ci.yml + turbo.json + pnpm-workspace.yaml if added.

### T4: handler skeleton + provider check + T4 test only

- **Files**:
  - `apps/auth-blocking-functions/src/index.ts` (NEW, ~20 LOC) — wire `gcipCloudFunctions.AuthFunction.beforeCreateHandler` import scaffold.
  - `apps/auth-blocking-functions/src/handler.ts` (NEW, ~30 LOC) — provider check + structured early-return (no DB code yet).
  - `apps/auth-blocking-functions/src/handler.test.ts` (NEW, ~40 LOC) — test T4 (`providerData !== google.com` early-return) + structure smoke tests. **NO T1/T2 yet** (per F-02 v1 fix from umbrella) — those require DB code, moved to T7.
- **LOC estimate**: ~90.
- **Depends on**: T3 merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test` → tests T4 + structure pass.
  - Coverage % en handler.ts limitado (más cobertura llega en T7); CI matrix runs but doesn't enforce threshold yet (full threshold enforced post-T7 lands).
- **SC trace**: 2c-A §10 T4 (provider passthrough). 2c-A SC-2C.A.3 partial.

### T5: email normalization + R-2C-9 tests (IDN/punycode/casing)

- **Files**:
  - `apps/auth-blocking-functions/src/email-normalize.ts` (NEW, ~30 LOC).
  - `apps/auth-blocking-functions/src/email-normalize.test.ts` (NEW, ~50 LOC) — 20+ variantes per R-2C-9.
- **LOC estimate**: ~80.
- **Depends on**: T4 merged.
- **Acceptance**:
  - `normalizeEmail(input)` applies: lowercase + trim + NFC unicode + punycode decode. NO gmail alias collapsing.
  - Tests cubren: 20+ variantes per R-2C-9 (casing/IDN/punycode/whitespace/NFD vs NFC equivalence).
  - 80 % lines / 75 % branches coverage en email-normalize.ts.
- **SC trace**: 2c-A §3 SC-2C.A.2; umbrella R-2C-9; 2c-A §10 T5.

### T6: DB pool singleton + logger instance

- **Files**:
  - `apps/auth-blocking-functions/src/db.ts` (NEW, ~50 LOC) — singleton DB pool con Cloud SQL Auth Proxy unix socket; lazy init; pg.Pool con timeouts internos 3s.
  - `apps/auth-blocking-functions/src/logger.ts` (NEW, ~15 LOC) — `@booster-ai/logger` instance configured.
  - `apps/auth-blocking-functions/src/db.test.ts` (NEW, ~20 LOC) — basic lazy init + reuse test con mock pg.
- **LOC estimate**: ~85.
- **Depends on**: T5 merged.
- **Acceptance**:
  - `getDbPool()` returns lazily-initialized singleton; subsequent calls reuse same instance.
  - Config read from `DATABASE_URL` env var.
  - Tests verify lazy init + reuse + timeout config.
- **SC trace**: 2c-A §3 SC-2C.A.2 partial.

### T7: handler DB lookup complete + fail-closed + structured logging + BLOCKED constant + tests T1+T2+T3+T6+T7

- **Files**:
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~35 LOC) — call `normalizeEmail` (T5) → call `getDbPool()` (T6) → query `solicitudes_registro` → fail-closed catch + structured log con `event.ipAddress` + email-hashed.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +60 LOC) — tests T1 (DB empty → permission-denied), T2 (DB row aprobado → no throw), T3 (DB throw → HttpsError internal), T6 (email missing → invalid-argument), T7 (estado != aprobado → permission-denied).
- **LOC estimate**: ~95.
- **Depends on**: T6 merged.
- **Acceptance**:
  - Handler completo: extract email + provider → if non-google return (T4 early-return remains) → normalize email (T5) → DB query (T6 pool) → if no rows throw permission-denied + `code='BLOCKED_SIGNUP_PENDING_APPROVAL'` → if row exists return + structured log.
  - **BLOCKED constant decision** (per F-A4 fix, option (a)): handler.ts inlines `const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;` — string literal. **2c-B T11 will duplicate** this literal in `apps/web/src/utils/translate-auth-error.ts` with a code comment cross-referencing handler.ts. Both copies must agree; manual coordination via 2c-B plan T11 acceptance. **NO shared-schemas export** — adding an export adds package work to 2c-A which is out-of-scope. Trade-off accepted: 2 source-of-truth locations, mitigated by code comments + 2c-B test that calls handler integration ensuring code matches.
  - All 5 new tests pass.
  - Structured log entry: `event: 'signup.blocked.google'` + `correlationId` + `ipAddress` + `emailHashed`. NO email plaintext.
  - Coverage SC-2C.A.2 ≥ 80 % / 75 % branches en handler.ts. **CI matrix (from T3) enforces threshold from this PR forward**.
- **SC trace**: 2c-A §3 SC-2C.A.1, SC-2C.A.2; §10 T1+T2+T3+T6+T7.

### T8: Ghost user inventory script + tests (read-only) — marginal waiver +10 LOC

- **Files**:
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.test.ts` (NEW, ~30 LOC).
- **LOC estimate**: ~110 (**marginal waiver, +10 LOC** over cap — script + tests interlinked, per umbrella F-06 v1 verdict).
- **Depends on**: T6 merged (DB pool reusable from same app).
- **Acceptance**:
  - Script lista Firebase users (`auth.listUsers()` paginado) con `providerData.find(p => p.providerId === 'google.com')`.
  - Cross-reference cada user contra `solicitudes_registro WHERE email=lower(user.email) AND estado='aprobado'`.
  - Output CSV `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-<ISO-timestamp>.csv` con cols: firebaseUid, email, displayName, createdAt, matchingApprovedRequest.
  - **Read-only**: NO disabling, NO deletion.
  - Tests con mock Admin SDK + mock DB.
  - **Execution context** (per umbrella F-08 v1 fix): script puede correr en 3 modos:
    1. **Local laptop**: `gcloud auth application-default login` + IAP tunnel a `db-bastion` per memory `reference_prod_db_headless_query.md` → `pnpm tsx scripts/inventory-google-ghost-users.ts`.
    2. **Cloud Run job** (preferred): `gcloud run jobs deploy inventory-google-ghost-users` (deferred a Sprint 2c-B per scope split).
    3. **Cloud Build trigger** one-shot manual.
  - 2c-A delivers script + tests. Execution + CSV generation es Sprint 2c-B T12.
- **SC trace**: 2c-A §3 SC-2C.A.4; §10 T14.

### T9a: Firebase emulator + firebase.json + emulator integration test

- **Files**:
  - `apps/auth-blocking-functions/test/integration/firebase-emulator.test.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/firebase.json` (NEW, ~15 LOC) — Firebase emulator config (auth + functions).
- **LOC estimate**: ~95.
- **Depends on**: T7 merged (handler complete).
- **Acceptance**:
  - `firebase emulators:start --only auth,functions` arranca local emulator.
  - Test setup: seed `solicitudes_registro` row con estado=aprobado para email X; trigger emulator signup with Google provider stub email X → expect Firebase user created.
  - Test setup: trigger emulator signup with email Y (no matching) → expect Firebase user NOT created + error `auth/internal-error`.
  - CI integration: optional (per OQ-PLAN-1 resolution — manual corrida pre-merge documented en 2c-B runbook).
- **SC trace**: 2c-A §3 SC-2C.A.6 partial; §10 T8.

### T9b: Baseline measurement script + first measurement (NO pass/fail threshold)

- **Files**:
  - `apps/auth-blocking-functions/scripts/baseline-measure.ts` (NEW, ~30 LOC).
  - `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-2c-a-<commit-sha>.json` (NEW, ~5 LOC measurement output committed as evidence).
  - `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-2c-a.latest.json` symlink (NEW).
- **LOC estimate**: ~40.
- **Depends on**: T9a merged.
- **Acceptance**:
  - `baseline-measure.ts` runs 10 invocations via T9a's emulator → output p50/p95/p99 → write JSON to `baseline-perf-2c-a-<commit-sha>.json` + update `.latest` symlink.
  - **NO pass/fail threshold against emulator** (per F-A7 fix). Acceptance text explicit: "Emulator measurement is a **floor sanity check** — handler JS execution time must be reasonable (<200ms locally is typical). Production p95 will be 5-20x higher due to IdP JWT validation + cold-start + Cloud SQL Auth Proxy round-trip. The **production** p95 bar applies in 2c-B post-deploy."
  - JSON file committed as evidence; demonstrates the script works + baseline frozen at this commit.
- **SC trace**: 2c-A §3 SC-2C.A.6 complete (emulator measurement captured, prod measurement deferred 2c-B).

### T10a: Race-documents-invariant integration test

- **Files**:
  - `apps/auth-blocking-functions/test/integration/race-documents-invariant.test.ts` (NEW, ~60 LOC).
- **LOC estimate**: ~60.
- **Depends on**: T9a merged (Firebase emulator setup reusable).
- **Acceptance**:
  - Test 1 (commit-order-A): approve commits first → Google signup attempt allowed.
  - Test 2 (commit-order-B): Google signup attempt first → permission-denied; subsequent approve commits → retry signup allowed.
  - Test 3 (fault-injection optional): `BEGIN; pg_sleep(2); UPDATE solicitudes_registro SET estado='aprobado'; COMMIT` en background; concurrent Google signup → permission-denied (snapshot pre-commit); post-commit signup → allowed.
  - **Documents** the invariant que blocking function sees committed state only.
- **SC trace**: 2c-A §3 SC-2C.A.3 partial; §10 T10 + T12.

### T10b: Admin SDK no-impact integration test (empirically resolves OQ-2C-8)

- **Files**:
  - `apps/auth-blocking-functions/test/integration/admin-sdk-no-impact.test.ts` (NEW, ~50 LOC).
- **LOC estimate**: ~50.
- **Depends on**: T10a merged.
- **Acceptance**:
  - Invocar `approveSignupRequest` desde apps/api con email matching pending solicitudes_registro → verify (a) Admin SDK `createUser` succeeds without rejection (handler early-returns por providerId !== 'google.com'), (b) row updated to estado=aprobado, (c) NO log entry from blocking function indicating rejection.
  - **Empirically resolves OQ-2C-8** (umbrella).
- **SC trace**: 2c-A §3 SC-2C.A.3 complete; §10 T13.

### T11: Handler-completeness mechanical CI gate (G-02 fix — second workflow)

- **Files**:
  - `apps/api/scripts/check-handler-completeness.ts` (NEW, ~40 LOC) — fails if `apps/auth-blocking-functions/src/handler.ts` does not contain `solicitudes_registro` literal + `BLOCKED_SIGNUP_PENDING_APPROVAL` literal.
  - `apps/api/scripts/check-handler-completeness.test.ts` (NEW, ~40 LOC) — fixture tests covering: (a) handler.ts complete → exit 0; (b) handler.ts skeleton-only → exit 1; (c) handler.ts file missing → exit 1.
  - `.github/workflows/sprint-2c-handler-completeness.yml` (NEW, ~25 LOC) — path-filtered job targeting **Sprint 2c-B deploy paths only** (same path-filter as T2b).
- **LOC estimate**: ~105 (**marginal waiver, +5 LOC** over cap — script + tests + workflow tightly coupled in single G-02 mechanical fix).
- **Depends on**: T7 merged (handler complete content present).
- **Acceptance**:
  - Script returns exit 0 only if BOTH grep matches succeed on handler.ts.
  - Workflow YAML comment documents: "Fires on Sprint 2c-B deploy PRs. Prevents shipping handler skeleton (T4-state) to prod. Path-filter identical to `sprint-2c-build-gate.yml` (T2b). Escape-hatch: `workflow_dispatch` admin trigger with `force=true`."
  - Branch protection rule adds workflow as required check (manual config post-merge; documented in PR description con `gh` command).
- **SC trace**: G-02 mechanical enforcement; complements T2a/T2b path-gate.

### T12: Lessons-learned memory file (Gen 1 vs Gen 2 architectural verification)

- **Files**:
  - `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/feedback_sprint_2c_pattern.md` (NEW, ~30 LOC).
  - Update to `MEMORY.md` index (1 line).
- **LOC estimate**: ~31 (memory + index entry).
- **Depends on**: T1 merged (ADR-054 in place; lesson documented post-ADR for traceability).
- **Acceptance**:
  - Memory file content covers:
    - Gen 1 vs Gen 2 architectural distinction (Identity Platform Blocking Functions support Gen 1 ONLY per docs.cloud.google.com).
    - SDK choice: `gcip-cloud-functions` NOT `firebase-functions/v2/identity`.
    - Empirical verification pattern: spike via WebFetch before /build to catch architectural mismatches.
    - When this pattern applies: any new Cloud Function targeting a Google service with documented Gen-1-only requirement.
  - Index entry added to MEMORY.md per the auto memory rules: `- [Gen 1 vs Gen 2 verification pattern](feedback_sprint_2c_pattern.md) — Spike empirically before /build cuando spec touches GCP service-specific runtime constraints.`
  - **Merge gate**: 2c-A `/ship` does NOT complete without this file in place (per F-A9 promote-with-merge-gate fix).
- **SC trace**: out-of-band promoted; cross-references plan-review.md DA loop lesson.

## Out-of-band tasks (remaining post-F-A9 promote)

- **`.specs/_followups/sprint-2c-google-blocking-function.md` cleanup**: mark "EXECUTED in 2c-A + 2c-B" or move to `.specs/_archive/`. **Owner**: Felipe (PO). **Trigger**: post-2c-A + 2c-B completion.

## Open questions

Inherited from umbrella OQ-2C-1..9 resolved. Plus 2c-A-specific:

- **OQ-2C-A-1** _(inherited from 2c-A spec)_: Firebase emulator setup overhead en CI < 30s? Resolved here: **NO CI integration; manual corrida pre-merge** documented en 2c-B runbook. T9a acceptance includes "optional CI integration deferred". Soft-waived per F-A14.

## Alternatives considered (plan-level)

### Alt-2c-A-Plan-I: Combine T1+T2a (ADR + CI gate script) into single PR

**Rejected**: T1 is pure docs; T2a is code + bidirectional followup modify. Conventional Commits convention separates scopes. Plus T2a depends on nothing (per F-A2 fix); enforced parallel-ability is a feature.

### Alt-2c-A-Plan-II: Defer T2a+T2b mechanical CI gate to 2c-B

**Rejected**: gate must exist BEFORE 2c-B starts deploying. Mechanical gate is foundational infra; ship en 2c-A even though it path-filters to 2c-B paths.

### Alt-2c-A-Plan-III: Use exported constant from `packages/shared-schemas/src/auth/signup-errors.ts` for `BLOCKED_SIGNUP_PENDING_APPROVAL`

**Rejected** (per F-A4 trade-off): adds package work to 2c-A (new file in shared-schemas + barrel export + tsconfig refs across consumers). 2c-A scope is handler-only. Option (a) string literal in handler.ts + 2c-B T11 duplicates accepted; risk = drift if literals diverge; mitigated by 2c-B integration test asserting both copies match.

### Alt-2c-A-Plan-IV: Ship single mega-PR (T3..T7)

**Rejected**: violates atomic vertical slices ≤100 LOC. Per agent-rigor §39 horizontal slicing simpler-to-write pero expensivo en debug.

### Alt-2c-A-Plan-V: Skip T8 ghost user inventory script en 2c-A (defer entire to 2c-B)

**Rejected**: 2c-B operational task (T12) depends on script existing. Splitting script implementation across 2c-A/2c-B adds coordination overhead. Cleanest: script lands in 2c-A (read-only, no harm), execution lands in 2c-B.

### Alt-2c-A-Plan-VI: Make T2a regex broad to catch all 6 corpus formats

**Rejected** (per F-A1 trade-off): broad regex is "robustness theater". The gate's target is ADR-052's exact post-flip line per ADR-052 §"Acceptance criterion"; expanding to match 6 formats adds maintenance burden + makes script harder to reason about. Narrow + documented is more honest.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices (compile + test + mergeable independently).
- [x] All tasks ≤ 100 LOC estimate OR waiver logged with genuine justification: only T8 (marginal +10) + T11 (marginal +5) waived; rest at-or-under cap.
- [x] Acceptance traces to 2c-A spec §3 SC o §10 test per task.
- [x] Rollback plan for each task (all rollback = revert files since no prod impact en 2c-A).
- [x] DA v1 findings F-A1..F-A14 each have explicit fix in v2 (per §"What changed v1 → v2" table).
- [ ] Devils-advocate v2 pass output captured: PENDING T89.
- [ ] User approval: PENDING T87.

## Total estimate v2

| Métrica | Valor |
|---|---|
| Tareas | **13** (T1, T2a, T2b, T3, T4, T5, T6, T7, T8, T9a, T9b, T10a, T10b, T11, T12) — actually **15** counting T2a/T2b/T9a/T9b/T10a/T10b as separate |
| LOC total estimate | ~1075 cross-stack (apps/api + new app + ADR + 2 workflows + memory file) |
| Tareas con waiver >100 LOC | 2 (T8=110 marginal, T11=105 marginal) — down from 4 in v1 |
| **Wall-clock PO active** | ~2.5 días (15 tasks incremental shipping) |
| **Pre-condition para T1+ ship** | Plan v2 approved + DA v2 pass-through |

Correction: counting tasks:
1. T1
2. T2a
3. T2b
4. T3
5. T4
6. T5
7. T6
8. T7
9. T8
10. T9a
11. T9b
12. T10a
13. T10b
14. T11
15. T12

**15 tasks total**. AT G-14 umbrella threshold (≥15 split). But this is post-split sub-sprint with handler-only scope; granular vertical slicing yields 15 atomic PRs which is preferred over fewer fatter PRs (per skill §39 vertical slicing).

## Decision log

- **2026-05-26 23:37Z** — /plan 2c-A phase entered post-split. Skill 20-planning-and-task-breakdown re-read. Plan v1 drafted with 10 tasks.
- **2026-05-26 23:50Z** — DA pass on v1: REVISE (4 P0 + 5 P1 findings). Plan v1 preserved as `plan-v1.md`.
- **2026-05-26 23:55Z** — Plan v2 drafted addressing all 14 findings per §"What changed v1 → v2" table. Status: Draft v2 awaiting DA v2 pass + user approval.
