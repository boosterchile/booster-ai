# Plan: sec-001-h1-2-google-blocking-a (Sprint 2c-A — handler implementation)

- **Spec**: [`./spec.md`](./spec.md) (Draft sub-spec post-split per umbrella G-14)
- **Created**: 2026-05-26
- **Status**: Draft
- **Linked**:
  - Umbrella: [`../sec-001-h1-2-google-blocking/spec.md`](../sec-001-h1-2-google-blocking/spec.md).
  - DA history: [`../sec-001-h1-2-google-blocking/plan-review.md`](../sec-001-h1-2-google-blocking/plan-review.md) (cumulative findings from pre-split plan v1+v2).
  - Sibling: [`../sec-001-h1-2-google-blocking-b/spec.md`](../sec-001-h1-2-google-blocking-b/spec.md) (Sprint 2c-B deploy).
  - OQ resolution: [`../sec-001-h1-2-google-blocking/oq-research.md`](../sec-001-h1-2-google-blocking/oq-research.md).

## Pre-conditions a `/build`

Sprint 2c-A `/build` gated por SOLO:

1. **Plan v1 approved** (this document).
2. **DA pass-through** (next step after draft).

**NOT gated** por ADR-052 Status flip Accepted — Sprint 2c-A paths (`apps/auth-blocking-functions/src/**`, `test/**`, `scripts/**`) están **fuera del path-filter** del mechanical CI gate (gate solo aplica a Sprint 2c-B deploy paths per spec C14 redefined).

## Tasks

### T1: ADR-NNN draft — Google Blocking Function signup gate (Proposed) — covers 2c-A + 2c-B architectures

- **Files**:
  - `docs/adr/NNN-google-blocking-function-signup-gate.md` (NEW, ~100 LOC).
  - Numbering: assigned via `pnpm exec scripts/check-adr-numbering.ts` pre-merge (estimated ADR-054 o ADR-055).
- **LOC estimate**: ~100.
- **Depends on**: ninguno (plan approved es único requirement). Per Booster pattern "ADR antes de código" (umbrella §6 C12).
- **Acceptance**:
  - Sigue pattern ADR-052 + ADR-053 (Context / Decision / Consequences / Alternatives / Acceptance criterion).
  - Status: `Proposed (2026-MM-DD; T1 Sprint 2c-A)`. Transición a `Accepted` agendada al Sprint 2c-B post-launch + 7d watch.
  - Sections completas: Context (parent spec §1+§2 + umbrella sub-split rationale), Decision (Cloud Function Gen 1 + gcip-cloud-functions + handler design + 2c-A code-only vs 2c-B deploy split), Consequences, Alternatives considered (per umbrella §8), Notes for future-self (Gen 2 migration when IdP supports + 1.0 SDK upgrade), Acceptance criterion para flip Proposed→Accepted (Sprint 2c-B closure post 7d watch).
- **SC trace**: umbrella §6 C12 + 2c-A SC-2C.A.1 foundation.
- **Rollback**: revert ADR file.
- **Spec trace**: umbrella §6 C12 + §8.

### T2: Mechanical CI gate — `check-adr-status-accepted.ts` + workflow + tests + **3-format regex robustness**

- **Files**:
  - `apps/api/scripts/check-adr-status-accepted.ts` (NEW, ~50 LOC) — standalone script with **robust regex covering 3 coexisting Status formats** (per DA v2 G-01 finding).
  - `apps/api/scripts/check-adr-status-accepted.test.ts` (NEW, ~50 LOC) — unit tests + integration-fixture test contra actual ADR-052 file.
  - `.github/workflows/sprint-2c-build-gate.yml` (NEW, ~35 LOC) — path-filtered job targeting **Sprint 2c-B paths only** (NOT 2c-A paths).
- **LOC estimate**: ~135 (waiver vs ≤100 — justificado per G-01 fix: script + workflow + comprehensive tests including 3-format-robust regex + cross-reference castellanizar-adr-headers followup all interlinked).
- **Depends on**: T1 merged (ADR-052 file existing y referenced).
- **Acceptance**:
  - **Regex robust** (per G-01): pattern matches **3 coexisting Status formats**:
    1. `^- \*\*Status\*\*:\s*Accepted` (ADR-052 current format).
    2. `^\*\*Status\*\*:\s*Accepted` (ADR-035 format sin leading dash).
    3. `^- \*\*Estado\*\*:\s*Aceptado` (post-castellanizar-adr-headers future format).
  - **Cross-reference castellanizar followup**: script doc-comment cita `.specs/_followups/castellanizar-adr-headers.md` con instrucción de actualizar regex si esa migración ejecuta.
  - Exit 0 si CUALQUIERA de los 3 patterns matches; exit 1 si NONE match.
  - Workflow corre on `pull_request` con **path-filter Sprint 2c-B paths**:
    - `infrastructure/auth-blocking-functions.tf`
    - `infrastructure/identity-platform.tf`
    - `cloudbuild.production.yaml` (blocking-function-deploy-related diffs)
  - Tests fixtures:
    - (a) fixture con `- **Status**: Proposed` → exit 1.
    - (b) fixture con `- **Status**: Accepted` → exit 0.
    - (c) fixture con `**Status**: Accepted` (ADR-035 format) → exit 0.
    - (d) fixture con `- **Estado**: Aceptado` (post-castellanizar) → exit 0.
    - (e) ADR file ausente → exit 1.
    - (f) malformed (no Status line) → exit 1.
    - **(g) integration test**: opens actual `docs/adr/052-signup-migration-admin-sdk-gate.md` from filesystem → expect exit 1 (current state Proposed). Per F-01 v1 fix retained.
  - Branch protection rule `main` adds workflow as required check for Sprint 2c-B paths (configuration manual post-merge, documented en 2c-B runbook).
  - **Escape-hatch documented en T1 ADR**: if gate has bug requiring fix that touches 2c-B paths, override via `workflow_dispatch` admin trigger.
- **SC trace**: 2c-A SC-2C.A.5; 2c-B SC-2C.B.8 foundation.
- **Rollback**: revertir 3 archivos + remove from branch protection rules manually.
- **Spec trace**: 2c-A §6 C14 + 2c-A §3 SC-2C.A.5.

### T3: apps/auth-blocking-functions bootstrap (package.json + tsconfig + workspace)

- **Files**:
  - `apps/auth-blocking-functions/package.json` (NEW, ~30 LOC) — deps **exact pin** `gcip-cloud-functions: "0.2.0"` + `firebase-admin: "^13.7.0"` + `firebase-functions: "^3.x"` (Gen 1 compatible) + `pg: "^8.13.1"` + `@booster-ai/logger` + `@booster-ai/shared-schemas`.
  - `apps/auth-blocking-functions/tsconfig.json` (NEW, ~15 LOC) — extends base, module commonjs (Gen 1 runtime).
  - `apps/auth-blocking-functions/.gitignore` (NEW, ~5 LOC) — node_modules, dist, .env.
- **LOC estimate**: ~50.
- **Depends on**: T2 merged (mechanical gate in place; 2c-A paths NOT gated por design).
- **Acceptance**:
  - `pnpm install --frozen-lockfile` succeeds; new workspace recognized (umbrella OQ-PLAN-2 confirmed `apps/*` wildcard catches).
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors (handler.ts NOT exists yet; typecheck no-op succeeds via tsconfig validation).
  - Empty src/; tests no yet.
- **SC trace**: 2c-A §7 component 1 setup.
- **Rollback**: delete dir + pnpm-workspace.yaml entry if added.
- **Spec trace**: 2c-A §7 component 1.

### T4: handler skeleton + provider check + T4 test only

- **Files**:
  - `apps/auth-blocking-functions/src/index.ts` (NEW, ~20 LOC) — wire `gcipCloudFunctions.AuthFunction.beforeCreateHandler` import scaffold.
  - `apps/auth-blocking-functions/src/handler.ts` (NEW, ~30 LOC) — provider check + structured return (no DB code yet).
  - `apps/auth-blocking-functions/src/handler.test.ts` (NEW, ~40 LOC) — test T4 (`providerData !== google.com` early-return) + structure smoke tests. **NO T1/T2 yet** (per umbrella F-02 fix) — those require DB code, moved to T7.
- **LOC estimate**: ~90.
- **Depends on**: T3 merged.
- **Acceptance**:
  - `pnpm --filter @booster-ai/auth-blocking-functions typecheck` → 0 errors.
  - `pnpm --filter @booster-ai/auth-blocking-functions test` → tests T4 + structure pass.
  - Coverage % en handler.ts limitado (más cobertura llega en T7).
- **SC trace**: 2c-A §10 T4 (provider passthrough). 2c-A SC-2C.A.3 partial (defense early-return).
- **Rollback**: revert files.
- **Spec trace**: 2c-A §7 component 1 + §10 T4.

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
- **Rollback**: revert files.
- **Spec trace**: 2c-A §7 + umbrella §9 R-2C-9.

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
- **Rollback**: revert files.
- **Spec trace**: 2c-A §7 component 1 + umbrella §6 C5+C6.

### T7: handler DB lookup complete + fail-closed + structured logging + tests T1+T2+T3+T6+T7

- **Files**:
  - `apps/auth-blocking-functions/src/handler.ts` (MODIFY, ~35 LOC) — call `normalizeEmail` (T5) → call `getDbPool()` (T6) → query `solicitudes_registro` → fail-closed catch + structured log con `event.ipAddress` + email-hashed.
  - `apps/auth-blocking-functions/src/handler.test.ts` (MODIFY, +60 LOC) — tests T1 (DB empty → permission-denied), T2 (DB row aprobado → no throw), T3 (DB throw → HttpsError internal), T6 (email missing → invalid-argument), T7 (estado != aprobado → permission-denied).
- **LOC estimate**: ~95.
- **Depends on**: T6 merged.
- **Acceptance**:
  - Handler completo: extract email + provider → if non-google return (T4 early-return remains) → normalize email (T5) → DB query (T6 pool) → if no rows throw permission-denied → if row exists return + structured log.
  - All 5 new tests pass.
  - Structured log entry: `event: 'signup.blocked.google'` + `correlationId` + `ipAddress` + `emailHashed`. NO email plaintext.
  - Coverage SC-2C.A.2 ≥ 80 % / 75 % branches en handler.ts.
- **SC trace**: 2c-A §3 SC-2C.A.1, SC-2C.A.2; §10 T1+T2+T3+T6+T7.
- **Rollback**: revert handler.ts changes; T4 stub remains.
- **Spec trace**: 2c-A §7 component 1 complete + umbrella §7.4 failure modes + §10 T1+T2+T3+T6+T7.

### T8: Ghost user inventory script + tests (read-only)

- **Files**:
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/scripts/inventory-google-ghost-users.test.ts` (NEW, ~30 LOC).
- **LOC estimate**: ~110 (waiver vs ≤100 — marginal +10 LOC; script + tests interlinked).
- **Depends on**: T6 merged (DB pool reusable from same app).
- **Acceptance**:
  - Script lista Firebase users (`auth.listUsers()` paginado) con `providerData.find(p => p.providerId === 'google.com')`.
  - Cross-reference cada user contra `solicitudes_registro WHERE email=lower(user.email) AND estado='aprobado'`.
  - Output CSV `.specs/sec-001-h1-2-google-blocking-b/sprint-2c-b-evidence/ghost-users-inventory-<ISO-timestamp>.csv` con cols: firebaseUid, email, displayName, createdAt, matchingApprovedRequest.
  - **Read-only**: NO disabling, NO deletion.
  - Tests con mock Admin SDK + mock DB.
  - **Execution context** (per umbrella F-08 fix): script puede correr en 3 modos:
    1. **Local laptop**: `gcloud auth application-default login` + IAP tunnel a `db-bastion` per memory `reference_prod_db_headless_query.md` → `pnpm tsx scripts/inventory-google-ghost-users.ts`.
    2. **Cloud Run job** (preferred): `gcloud run jobs deploy inventory-google-ghost-users` (deferred a Sprint 2c-B per scope split).
    3. **Cloud Build trigger** one-shot manual.
  - 2c-A delivers script + tests. Execution + CSV generation es Sprint 2c-B T12.
- **SC trace**: 2c-A §3 SC-2C.A.4; §10 T14.
- **Rollback**: revert files (script no-op desde view).
- **Spec trace**: 2c-A §7 component 2 + §3 SC-2C.A.4.

### T9: Firebase emulator integration test + baseline measurement (REQUIRED)

- **Files**:
  - `apps/auth-blocking-functions/test/integration/firebase-emulator.test.ts` (NEW, ~80 LOC).
  - `apps/auth-blocking-functions/firebase.json` (NEW, ~15 LOC) — Firebase emulator config (auth + functions).
  - `apps/auth-blocking-functions/scripts/baseline-measure.ts` (NEW, ~30 LOC) — script que invokes handler via emulator 10x + measures p50/p95/p99 → output `.specs/sec-001-h1-2-google-blocking-a/sprint-2c-a-evidence/baseline-perf-<ISO>.json`.
- **LOC estimate**: ~125 (waiver vs ≤100 — atomic per F-04 fix from plan v2: emulator test + baseline script validate SC-2C.4 strategy together).
- **Depends on**: T7 merged (handler complete).
- **Acceptance**:
  - `firebase emulators:start --only auth,functions` arranca local emulator.
  - Test setup: seed `solicitudes_registro` row con estado=aprobado para email X; trigger emulator signup with Google provider stub email X → expect Firebase user created.
  - Test setup: trigger emulator signup with email Y (no matching) → expect Firebase user NOT created + error `auth/internal-error`.
  - `baseline-measure.ts` runs 10 invocations via emulator → output p50/p95/p99 → assert p95 < 1500 ms in initial measurement (per 2c-A SC-2C.A.6).
  - CI integration: optional (per umbrella OQ-PLAN-1 resolution — manual corrida pre-merge documented en 2c-B runbook).
- **SC trace**: 2c-A §3 SC-2C.A.2 partial + SC-2C.A.6; §10 T8.
- **Rollback**: revert files.
- **Spec trace**: 2c-A §10 T8 (REQUIRED, NOT stretch).

### T10: Race-documents-invariant + Admin SDK no-impact integration tests

- **Files**:
  - `apps/auth-blocking-functions/test/integration/race-documents-invariant.test.ts` (NEW, ~60 LOC) — documents invariant per umbrella F-07 fix.
  - `apps/auth-blocking-functions/test/integration/admin-sdk-no-impact.test.ts` (NEW, ~50 LOC) — empirically resolves OQ-2C-8 per umbrella F-08 fix.
- **LOC estimate**: ~110 (waiver vs ≤100 — 2 integration tests interlinked + emulator setup overhead shared from T9).
- **Depends on**: T9 merged (Firebase emulator setup reusable).
- **Acceptance**:
  - **race-documents-invariant**:
    - Test 1 (commit-order-A): approve commits first → Google signup attempt allowed.
    - Test 2 (commit-order-B): Google signup attempt first → permission-denied; subsequent approve commits → retry signup allowed.
    - Test 3 (fault-injection optional): `BEGIN; pg_sleep(2); UPDATE solicitudes_registro SET estado='aprobado'; COMMIT` en background; concurrent Google signup → permission-denied (snapshot pre-commit); post-commit signup → allowed.
    - **Documents** the invariant que blocking function sees committed state only.
  - **admin-sdk-no-impact**: invocar approveSignupRequest desde apps/api con email matching pending solicitudes_registro → verify (a) Admin SDK createUser succeeds without rejection (handler early-returns por providerId !== 'google.com'), (b) row updated to estado=aprobado, (c) NO log entry from blocking function indicating rejection. **EMPIRICALLY RESOLVES OQ-2C-8**.
- **SC trace**: 2c-A §3 SC-2C.A.3; §10 T10 + T12 + T13.
- **Rollback**: revert files.
- **Spec trace**: 2c-A §7 Admin SDK defense + §3 SC-2C.A.3 + §10 T10+T12+T13.

## Out-of-band tasks

- **Memory file update**: agregar `feedback_sprint_2c_pattern.md` documentando lesson learned del Gen 1 vs Gen 2 architectural empirical verification. **Owner**: Claude (next session post-T1 ADR draft). **Trigger**: post-T1 merged. **Why hard-task-not**: pure documentation, can ship as out-of-band parallel to any task.
- **`.specs/_followups/sprint-2c-google-blocking-function.md` cleanup**: mark "EXECUTED in 2c-A + 2c-B" or move to `.specs/_archive/`. **Owner**: Felipe (PO). **Trigger**: post-2c-A + 2c-B completion.
- **Castellanizar ADR followup**: when `.specs/_followups/castellanizar-adr-headers.md` executes, update T2 regex script to ensure compatibility. **Owner**: whoever ejecuta castellanizar PR. **Trigger**: castellanizar PR opens.

## Open questions

Inherited from umbrella OQ-2C-1..9 resolved. Plus 2c-A-specific:

- **OQ-2C-A-1** _(inherited from 2c-A spec)_: Firebase emulator setup overhead en CI < 30s? Resolved here: **NO CI integration; manual corrida pre-merge** documented en 2c-B runbook. T9 acceptance includes "optional CI integration deferred".

## Alternatives considered (plan-level)

### Alt-2c-A-Plan-I: Combine T1+T2 (ADR + CI gate) into single PR

**Rejected** per umbrella plan v2 reasoning: T1 is pure docs; T2 is code. Conventional Commits convention separates scopes. Plus T2 has integration test against T1 file content (real-ADR fixture).

### Alt-2c-A-Plan-II: Defer T2 mechanical CI gate to 2c-B

**Rejected**: gate must exist BEFORE 2c-B starts deploying. Mechanical gate is foundational infra; ship en 2c-A even though it path-filters to 2c-B paths.

### Alt-2c-A-Plan-III: Ship handler en single mega-PR (T3..T7)

**Rejected**: violates atomic vertical slices ≤100 LOC. Per agent-rigor §39 horizontal slicing simpler-to-write pero expensivo en debug.

### Alt-2c-A-Plan-IV: Skip T8 ghost user inventory script en 2c-A (defer entire to 2c-B)

**Rejected**: 2c-B operational task (T12) depends on script existing. Splitting script implementation across 2c-A/2c-B adds coordination overhead. Cleanest: script lands in 2c-A (read-only, no harm), execution lands in 2c-B.

## Verification (skill planning-and-task-breakdown §110-116)

- [x] All tasks vertical slices (compile + test + mergeable independently): cada T_n produces working state.
- [x] All tasks ≤ 100 LOC estimate OR waiver logged: T2 (135), T8 (110), T9 (125), T10 (110) — cada waiver justified inline.
- [x] Acceptance traces to 2c-A spec §3 SC o §10 test per task.
- [x] Rollback plan for each task (all rollback = revert files since no prod impact en 2c-A).
- [ ] Devils-advocate output captured: PENDING T86.
- [ ] User approval: PENDING T87.

## Total estimate

| Métrica | Valor |
|---|---|
| Tareas | 10 (T1-T10) |
| LOC total estimate | ~940 cross-stack (apps/api + new app + ADR + workflow) |
| Tareas con waiver >100 LOC | 4 (T2=135, T8=110, T9=125, T10=110) |
| **Wall-clock PO active** | ~2 días (T1-T10 incremental shipping) |
| **Pre-condition para T1+ ship** | Plan approved (no other gate; ADR-052 NOT required for 2c-A scope) |

## Decision log

- **2026-05-26 23:37Z** — /plan 2c-A phase entered post-split. Skill 20-planning-and-task-breakdown re-read. 10 tasks drafted. Status: Draft v1 awaiting DA pass + user approval.
