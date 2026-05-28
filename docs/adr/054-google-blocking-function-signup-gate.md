# ADR-054: Google federated signup admin-approval gate via Identity Platform Blocking Function (Cloud Function Gen 1 + gcip-cloud-functions)

- **Status**: Proposed (2026-05-27; Sprint 2c-A T1). Transición a `Accepted` agendada al cierre Sprint 2c-B post-launch + 7 días watch sin regressions (per acceptance criterion §6).
- **Date**: 2026-05-27
- **Deciders**: Felipe Vicencio (PO)
- **Linked**:
  - Umbrella spec: `.specs/sec-001-h1-2-google-blocking/spec.md` (Approved v2 + split into 2c-A/2c-B per G-14)
  - Sub-spec 2c-A: `.specs/sec-001-h1-2-google-blocking-a/spec.md` (handler implementation Draft)
  - Sub-spec 2c-B: `.specs/sec-001-h1-2-google-blocking-b/spec.md` (deployment Draft)
  - Plan 2c-A: `.specs/sec-001-h1-2-google-blocking-a/plan.md` v4 (Approved post-DA convergence)
  - DA history: `.specs/sec-001-h1-2-google-blocking-a/plan-review.md` (v1+v2+v3 cumulative)
  - OQ resolution: `.specs/sec-001-h1-2-google-blocking/oq-research.md` (7 fully + 2 partial resolved)
  - Lessons-learned: `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md` (Gen 1 vs Gen 2 empirical verification pattern; this PR)
  - Precedent: ADR-052 (signup admin-approval Admin SDK leg, Status Proposed). ADR-053 (post-disclosure account replacement, Status Accepted).
  - References: Identity Platform Blocking Functions [docs.cloud.google.com/identity-platform/docs/blocking-functions](https://docs.cloud.google.com/identity-platform/docs/blocking-functions); gcip-cloud-functions SDK npm package; GitHub iap-gcip-web-toolkit#258 (Gen 1 confirmation).

## Context

Spec sec-001-cierre §3 H1.2 (SC-1.2.0..SC-1.2.5) cubre la migración del signup público a admin-approval gate. **ADR-052** cerró el leg email/password vía Admin SDK + Identity Platform self-signup `disabled_user_signup=true`. Ese flag bloquea email/password client-side signup pero **NO bloquea Google federated signup** — el OAuth-redirect path no pasa por la knob de IdP.

Sprint 2c reabre el residual `TRACKED_RESIDUAL: SC-1.2.2 Google leg` documentado en `.specs/_followups/sprint-2c-google-blocking-function.md`. El usuario aún puede crear cuenta via "Sign in with Google" sin pasar por el flujo admin-approval; **rompe la invariante de Sprint 2b** (toda creación de cuenta requiere aprobación previa por admin con review en cola).

La spec umbrella resolvió 9 open questions vía WebFetch research (`oq-research.md`); 4 P0 findings cumulative across 3 DA passes en plan v4 dejaron el plan en estado mecánicamente convergente; H-A1/H-A2 residuales fueron resueltos por elección PO en v4.

## Decision

Implementar el gate via **Identity Platform Blocking Function** (trigger `beforeCreate`) con la siguiente arquitectura **empíricamente verificada via WebFetch**:

### Plataforma de ejecución

- **Cloud Function Generation 1** (NOT Gen 2). Identity Platform Blocking Functions support **Gen 1 only** as of 2026-05. Verificado vs `docs.cloud.google.com/identity-platform/docs/blocking-functions` + GitHub `iap-gcip-web-toolkit#258`. Gen 2 migration tracked en §"Notes for future-self" cuando IdP agregue soporte.
- **Runtime**: Node.js 20 (Booster monorepo standard).
- **Region**: `us-east1` (consistencia con Cloud SQL + Cloud Run).

### SDK choice

- **`gcip-cloud-functions`** (exact pin `0.2.0` per plan T3). **NOT** `firebase-functions/v2/identity` (Gen 2 only — incompatible with IdP Blocking Functions). Empíricamente verificado vs docs.cloud.google.com + package npm.
- **Firebase Admin SDK** `firebase-admin@^13.7.0` para list ghost users (T8 inventory script).
- **Firebase Functions** `firebase-functions@^3.x` (Gen 1 compatible).

### Handler design (Sprint 2c-A T7)

```typescript
export const handler = gcipCloudFunctions.AuthFunction.beforeCreateHandler(async (user, ctx) => {
  // 1. Provider check — passthrough non-Google
  const isGoogle = user.providerData?.some(p => p.providerId === 'google.com');
  if (!isGoogle) return;

  // 2. Email normalize (Sprint 2c-A T5)
  const email = user.email ?? throwHttpsError('invalid-argument', 'email required');
  const normalized = normalizeEmail(email); // lowercase + trim + NFC + punycode; NO gmail alias collapse

  // 3. DB lookup against admin-approved solicitudes
  const pool = getDbPool();
  const result = await pool.query(
    "SELECT estado FROM solicitudes_registro WHERE LOWER(email)=$1 AND estado='aprobado' LIMIT 1",
    [normalized],
  );

  // 4. Fail-closed gate
  if (result.rowCount === 0) {
    const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;
    log.warn({ event: 'signup.blocked.google', correlationId, ipAddress: ctx.ipAddress, emailHashed: hashEmail(normalized) });
    throw new functions.auth.HttpsError('permission-denied', BLOCKED_CODE);
  }
});
```

### Sprint split rationale (2c-A vs 2c-B)

Umbrella plan v2 alcanzó 5 P0 + 6 P1 + 5 P2 findings en DA. Plan threshold G-14 (≥15 tasks) triggered split:

- **Sprint 2c-A** (handler-implementation only, no prod impact): 14 atomic vertical slices T1-T11 (con sub-splits T2a/T2b/T9a/T9b/T10a/T10b). Ships handler + tests + emulator integration + ghost user inventory script + 2 mechanical CI gates (ADR-052 Status + handler-completeness smoke) to `main`.
- **Sprint 2c-B** (deployment + IdP wire + 7d watch + Status flip Accepted): infra Terraform + Cloud Build deploy steps + IdP `blocking_functions.triggers.beforeCreate` wire + apps/web `translateAuthError` extension + ghost user inventory CSV generation + smoke E2E + 7d watch + ADR-054 Status flip Proposed → Accepted.

### `BLOCKED_SIGNUP_PENDING_APPROVAL` constant location

**Decision**: option (a) — string literal in handler.ts. **NOT** exported from `packages/shared-schemas`.

**Rationale** (per plan v4 Alt-2c-A-Plan-III rejection + G-A2 mitigation):
- Avoids adding package work to Sprint 2c-A scope (handler-only).
- 2c-B `apps/web/src/lib/translate-auth-error.ts` duplicates the literal with cross-reference code comment.
- Sprint 2c-B T-LITERALS integration test (file-visible obligation added to 2c-B spec by Sprint 2c-A T7) ensures both copies match.

Trade-off accepted: 2 source-of-truth locations, mitigated by test + file-visible cross-plan obligation.

### Mechanical CI gates (Sprint 2c-A T2a/T2b + T11)

Two path-filtered workflows guard Sprint 2c-B deploy paths:

1. **`sprint-2c-build-gate.yml`** (T2a script + T2b workflow): requires `docs/adr/052-signup-migration-admin-sdk-gate.md` Status to be `Accepted` (regex `^- \*\*Status\*\*: Accepted`). Sprint 2c-B deploy paths cannot merge until ADR-052 flips (post-Sprint-2b T13 canary success).
2. **`sprint-2c-handler-completeness.yml`** (T11): smoke check that `apps/auth-blocking-functions/src/handler.ts` contains both `solicitudes_registro` AND `BLOCKED_SIGNUP_PENDING_APPROVAL` literals. **NOT a semantic gate** — semantic correctness lives in T7 unit + T10a race-documents-invariant + T10b Admin SDK no-impact tests.

Sprint 2c-A paths are **outside** both gates' path-filters (per C13 redefined in 2c-A spec).

## Consequences

### Positive

- **Google leg gate cerrado**: post-Sprint 2c-B launch, `SC-1.2.2 Google leg` invariante restaurada (toda creación de cuenta pasa por admin-approval, sin escape via OAuth-redirect).
- **Defense-in-depth**: blocking function corre **antes** del `auth.createUser` server-side, garantizando que ningún signup federado se complete sin row `aprobado` en `solicitudes_registro`. Falla-cerrado por design (DB error → permission-denied).
- **Race-documents-invariant**: T10a integration test documenta que el handler ve únicamente estado MVCC committed (commit-order matters; pre-commit signup attempts fail, post-commit allowed).
- **Empirically validated architecture**: WebFetch-confirmed Gen 1 + gcip-cloud-functions choice before /build prevents architectural rework (avoided por DA on spec v1 — original spec mandated `firebase-functions/v2/identity` which is Gen 2 only).
- **Mechanical CI gating**: 2 path-filtered workflows prevent 2c-B deploy PRs from shipping antes de pre-conditions cumplidas (ADR-052 Accepted + handler-completeness).

### Negative

- **Cloud Function Gen 1 cold-start**: ~1-3s observed in other Booster Gen 1 functions. Cada primer signup Google post-idle paga el cold-start. Mitigación: min-instances=1 deployment config (Sprint 2c-B). Baseline p95 measurement deferred a 2c-B post-deploy (per F-A7 fix — emulator p95 is floor sanity check, no pass/fail bar against emulator).
- **Gen 2 migration debt**: cuando IdP agregue soporte Gen 2 + gcip-cloud-functions 1.0 SDK upgrade, requiere refactor. Tracked en §"Notes for future-self".
- **`BLOCKED_SIGNUP_PENDING_APPROVAL` 2-source-of-truth**: handler.ts inline literal + apps/web translateAuthError duplicate. Mitigado por 2c-B T-LITERALS integration test + cross-reference code comments en ambos sitios.
- **Ghost user inventory operational task**: pre-launch Sprint 2c-B requiere correr inventory script + revisar CSV de usuarios Google ya creados antes del wire (sin deletion automática per acceptance — read-only). PO decision required sobre cada ghost.
- **Castellanizar followup coordinated dependency**: ADR-052, ADR-053, ADR-054 castellanization deferida hasta post-Sprint-2c-B CERRADO + T2a regex update (bidirectional cross-ref en `.specs/_followups/castellanizar-adr-headers.md` per Sprint 2c-A T2a).

### Neutral

- **2 mechanical CI workflows added**: small operational overhead (path-filter scope precise; escape-hatches documented).
- **`docs/lessons-learned/` directory bootstrapped** en este PR (T1). First entry: Gen 1 vs Gen 2 empirical verification pattern.

## Alternatives considered

### Alt-I: Sign in with Google completely disabled

**Rejected** (per umbrella spec §8): Booster business priority es retener Google federated signup como UX preferida para shippers. Disabling rompe onboarding funnel.

### Alt-II: Post-creation cleanup (delete Google users sin solicitud aprobada via scheduled job)

**Rejected**: window-of-vulnerability post-creation pre-cleanup permite acceso al sistema. Defense-in-depth (gate antes de creation) preferida.

### Alt-III: `firebase-functions/v2/identity` Gen 2 trigger

**Rejected empirically** (caught by DA on spec v1): Identity Platform Blocking Functions **do NOT support Gen 2** as of 2026-05. Verificación WebFetch a docs.cloud.google.com + GitHub `iap-gcip-web-toolkit#258`. Lesson documented en `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md` para evitar repetición.

### Alt-IV: Use `shared-schemas` export for `BLOCKED_SIGNUP_PENDING_APPROVAL` constant

**Rejected** (per plan v4 Alt-2c-A-Plan-III): adds package work + barrel + tsconfig refs across consumers; Sprint 2c-A scope is handler-only. 2-source-of-truth duplication mitigated by 2c-B T-LITERALS integration test (file-visible cross-plan obligation added to 2c-B spec by T7).

### Alt-V: Combine Sprint 2c into single sprint (no split)

**Rejected** (per umbrella G-14): plan v2 reached 15 tasks at fat-PR risk + multiple anti-patterns. Split into 2c-A (code-only, no prod impact) + 2c-B (deploy + watch + Status flip) recommended by DA loop convergence analysis.

## Acceptance criterion para transition Proposed → Accepted

ADR-054 flips Proposed → Accepted bajo **TODAS** las siguientes condiciones:

1. **Sprint 2c-A SHIPPED**: all 14 tasks T1-T11 (con sub-splits) merged to `main`. Handler + 2 CI gates + ghost user inventory script + emulator integration tests + race-documents-invariant + Admin SDK no-impact tests verified green.
2. **ADR-052 Status Accepted** pre-requisite: Sprint-2b T13 canary deploy 30 min success + 2 h watch sin regressions. ADR-052 Status flipped via separate post-merge commit.
3. **Sprint 2c-B SHIPPED**: Cloud Function deployed via `gcloud functions deploy` (Cloud Build step in `cloudbuild.production.yaml`); IdP `blocking_functions.triggers.beforeCreate` wired via `terraform apply` on `infrastructure/identity-platform.tf`; apps/web `translateAuthError` extension live; ghost user inventory CSV generated + PO-reviewed; smoke E2E manual test passed.
4. **7-day watch** post-Sprint 2c-B launch sin regressions: zero `signup.blocked.google` log entries con anomalous patterns; production p95 < 5000 ms (real bar, not emulator); Admin SDK no-impact verified live (no impact on `approveSignupRequest` flow from `apps/api`).
5. **Status flip commit** separado, sigue pattern ADR-052 §"Acceptance criterion": `docs(adr-054): Accepted post-7d-watch cloudbuild run <ID>` que actualiza línea 3 de este file de `Proposed (2026-05-27; Sprint 2c-A T1)` a `Accepted (post-7d-watch cloudbuild run <ID>)`.

## Notes for future-self

- **Gen 2 migration trigger**: cuando IdP agregue soporte Gen 2 + gcip-cloud-functions 1.0 SDK upgrade, evaluar refactor a `firebase-functions/v2/identity`. Beneficios: cold-start ~10x más rápido, mejor concurrency model, structured config. Watch: docs.cloud.google.com/identity-platform/docs/blocking-functions release notes + `gcip-cloud-functions` npm release page.
- **Status format choice**: ADR-054 usa `- **Status**: Proposed (...)` con leading dash + EN key per lineage ADR-052/053 explícitamente targeted by Sprint 2c-A T2a CI gate regex. NOT castellanizar este file (`**Estado**: Aceptado`) hasta post-Sprint-2c-B CERRADO + T2a regex update. Coordinación: `.specs/_followups/castellanizar-adr-headers.md` §"Exclusiones / coordinación con Sprint 2c" (added by 2c-A T2a).
- **Lessons-learned cross-ref**: empirical verification pattern (Gen 1 vs Gen 2) documented en `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`. Aplicable a cualquier nueva Cloud Function targeting Google service-specific runtime constraints — spike via WebFetch antes de `/build` para evitar architectural mismatch.
- **DA loop pattern**: this feature spec went through 3 DA passes (spec v1 INVALIDATED for Gen 2 mistake → v2 Approved). Plan went through 3 DA passes (v1 4P0 → v2 4P0 same anti-pattern → v3 0P0+2P1 ACCEPT-WITH-RESIDUAL → v4 0P0+0P1 APPROVED). Each DA pass should be **mechanical-not-prose-verification**; the "prose-only fix" anti-pattern was the dominant failure mode catched in v2.
- **Memory file out-of-tree alternative**: Felipe puede manualmente sincronizar el content de `docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md` a `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/feedback_sprint_2c_pattern.md` + actualizar `MEMORY.md` index si quiere disponibilidad en Claude auto-memory cross-session. Opcional, no es deliverable de Sprint 2c-A.
