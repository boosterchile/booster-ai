# Plan: sec-001-cierre — Sprint 2b

- **Spec base**: `.specs/sec-001-cierre/spec.md` (Approved v3.2 + v3.3 amendment 2026-05-25)
- **Plan Sprint 2 META**: `.specs/sec-001-cierre/plan-sprint-2.md`
- **Plan Sprint 2a**: `.specs/sec-001-cierre/plan-sprint-2a.md` (CERRADO 12/12 2026-05-25)
- **Created**: 2026-05-25
- **Status**: **READY FOR /build** (v4, post devils-advocate round 4 APPROVE_WITH_RESERVATIONS_FINAL). 4 rondas convergencia. Trayectoria P0: 7→2→1→0. 15 tasks, 2 PRs, ~58h.

## 1. Scope Sprint 2b

PO decisión 2026-05-25 (post-Sprint-2a-close): scope = stub recommended.

| Sub-fase | SCs | Status pre-build |
|---|---|---|
| **H1.3** is-demo middleware enforcement | SC-1.3.1..1.3.8 | Sprint 2a shipped — 4 UIDs `is_demo:true` activas en prod target enforcement |
| **H1.2** Signup migration a Admin SDK + IdP self-signup OFF (email/password) | SC-1.2.0..1.2.5 _(con SC-1.2.2 partial-cierre — ver §1.1)_ | Sprint 2a shipped + ADR-052 Proposed pre-T7 |

**Fuera de scope Sprint 2b** (diferido a Sprint 2c / spec hermano):

- **D-T16** custom metric `rate_limit_pin_blocked_total` + dashboard — deferred por P1-4 sizing (15 tasks ya en límite SKILL ≤15).
- **D-T18** CodeQL custom queries auth-driver — deferred mismo motivo.
- **SC-1.2.2 Google provider gap close** (backend fallback) — deferred por P0-2: no existe `auth-google-callback.ts` en el repo (Google sign-in es 100% client-side via `signInWithPopup` en `apps/web/src/hooks/use-auth.ts:85`); implementarlo requiere Firebase Auth Blocking Function (Cloud Function separada) cuyo design merece spec/ADR propio. Sprint 2b cubre **email/password OFF** y documenta **residual Google self-signup** como deuda explícita Sprint 2c.
- H1.5 forensia + H1.6 reactivación demo + H3 spec hermano — diferidos a Sprint 2c+.

### 1.1 SC-1.2.2 partial-cierre rationale (devils-advocate P0-2)

Spec SC-1.2.2 originalmente requirió `Identity Platform sign-up disabled para AMBOS providers email/password Y Google`. Verificación 2026-05-25 contra repo:

- Google sign-in solo client-side (`signInWithPopup(firebaseAuth, googleProvider)`); no backend OAuth callback.
- Identity Platform GA Terraform NO expone toggle per-provider "allow new accounts to sign up" para Google.
- Backend gate require: (a) Firebase Auth Blocking Function `beforeCreate` (Cloud Function), o (b) intercept on first `/me` request → cross-check `solicitudes_registro.estado=aprobado`.

**Sprint 2b decisión**: cerrar leg email/password (alta confianza, contained scope) + documentar leg Google como residual con tracking. Sprint 2c spec dedicada al Google blocking function. Aceptación corregida: **SC-1.2.2 email/password = MET; SC-1.2.2 Google = TRACKED_RESIDUAL**. Permite mergear Sprint 2b sin gap mid-flight (interrupt protocol §6 sigue safe).

## 2. Orden PRs

1. **PR1 H1.3** (defense-in-depth global enforcement) — 6 tasks
2. **PR2 H1.2** (signup migration email/password + admin gate + canary) — 9 tasks

PR3 discoveries deferred a Sprint 2c.

## 3. Tasks

### T1: middleware `is-demo-enforcement` con 3 modos + unit tests [DONE 2026-05-25]

- **Files**: `apps/api/src/middleware/is-demo-enforcement.ts` (nuevo), `apps/api/src/middleware/is-demo-enforcement.test.ts` (nuevo)
- **LOC estimate**: ~140 (waiver vs ≤100 — justificado: precedente `demo-expires.ts` 240 LOC, 3 modos + factory + 5 escenarios tests es realista 130-150 LOC. Re-split a T1a+T1b solo agrega ceremony sin valor; ambas mitad serían triviales separadas)
- **Wall-clock**: ~3h
- **Depends on**: Sprint 2a shipped (UIDs con `is_demo:true` para target manual)
- **Acceptance**:
  - 3 modos exportados via factory `createIsDemoEnforcementMiddleware({mode, allowlist?, logger})`: `requireNotDemo` / `requireNotDemoOrSandbox` / `explicitAllow`.
  - Lee `firebaseClaims` Hono context key (Sprint 2a T5 pattern); claim ausente → passthrough (middleware no es de auth, es de authorization).
  - Si `firebaseClaims.is_demo === true`:
    - `requireNotDemo`: 403 `{error:'forbidden_demo', code:'forbidden_demo'}` para TODOS los métodos no idempotent-safe (POST/PUT/PATCH/DELETE) Y GET en allowlist negative-pattern. Default: 403.
    - `requireNotDemoOrSandbox`: passthrough si persona `stakeholder` (read-only por contrato), else 403.
    - `explicitAllow`: pasthrough si `c.req.path` matches allowlist entry; else 403.
  - Unit tests T1 (spec §10): claim ausente, `is_demo:true`+requireNotDemo, `is_demo:true`+requireNotDemoOrSandbox+stakeholder, `explicitAllow`+path matches, `explicitAllow`+path no-match, `is_demo:false`.
  - SC trace: **SC-1.3.1**.
- **Rollback**: revertir commit; middleware no wired aún (T3) → 0 impacto runtime.
- **Spec trace**: §3 SC-1.3.1.

### T2a: `is-demo-allowlist` scaffolding + audit doc inventory [DONE 2026-05-26]

- **Files**: `apps/api/src/middleware/is-demo-allowlist.ts` (nuevo), `docs/qa/is-demo-enforcement-audit.md` (nuevo)
- **LOC estimate**: ~60
- **Wall-clock**: ~1.5h
- **Depends on**: T1
- **Acceptance**:
  - `is-demo-allowlist.ts`: export const `ALLOWLISTED_PATHS: AllowlistEntry[]` con type `{path: string, methods: HttpMethod[], rationale: string, reviewBy: string}`. Array vacío inicial (populated en T3).
  - `is-demo-enforcement-audit.md`: tabla generada via comando exacto `grep -rE "app\\.(post|put|patch|delete)" apps/api/src/routes/ | wc -l` + inventory de cada route group mount point identificado en server.ts. Columna `aplicación middleware` = `requireNotDemo (default)` / `explicitAllow (path-X)` / `bypass (allowlisted con rationale)`. Audit re-ejecutado contra main 2026-05-25.
  - SC trace: **SC-1.3.3**, **SC-1.3.4**.
- **Rollback**: revertir ambos archivos.
- **Spec trace**: §3 SC-1.3.3, SC-1.3.4.

### T2b: CI lint scripts T6c (comment lint) + T6d (PR-modifies-allowlist guard) [DONE 2026-05-26]

- **Files**: `apps/api/scripts/check-is-demo-allowlist-comments.ts` (nuevo), `apps/api/scripts/check-allowlist-pr-guard.ts` (nuevo), `.github/workflows/security.yml` (modify — 2 jobs)
- **LOC estimate**: ~80
- **Wall-clock**: ~2h
- **Depends on**: T2a
- **Acceptance**:
  - T6c script: parsea `is-demo-allowlist.ts`, valida cada entry tiene `rationale` non-empty + `reviewBy` ISO date format en futuro. Exit 1 si falla. Output structured con paths offenders.
  - T6d script: en CI, si el PR-diff modifica `is-demo-allowlist.ts`, el commit DEBE añadir nueva entry con justificación inline o el cambio matchea pattern existente (regex de entry shape). Falla si nueva entry sin `rationale`. Lee `git diff` HEAD~1 vs HEAD (CI env `GITHUB_BASE_REF`).
  - Workflow `security.yml`: 2 nuevos jobs `is-demo-allowlist-comments` (T6c) + `is-demo-allowlist-pr-guard` (T6d). Sin `[skip ci]` (branch protection guard).
  - SC trace: **SC-1.3.6** parts 2 + 3 (lint comment + PR-modifies guard). Part 1 (integration test) en T3.
- **Rollback**: revertir workflow jobs + remover scripts.
- **Spec trace**: §3 SC-1.3.6.

### T3: wire per-group en `server.ts` + allowlist populated + integration tests T6 + T6b + audit-completeness CI gate [DONE 2026-05-26]

- **Files**: `apps/api/src/server.ts` (modify — agregar `isDemoEnforcementMiddleware` en cada chain `firebaseAuthMiddleware + demoExpiresMiddleware`), `apps/api/src/middleware/is-demo-allowlist.ts` (modify — populate), `apps/api/test/integration/is-demo-enforcement-sample.integration.test.ts` (nuevo), `apps/api/test/integration/is-demo-default-deny.integration.test.ts` (nuevo, fixture-pattern), `apps/api/scripts/check-is-demo-wire-completeness.ts` (nuevo — CI gate), `.github/workflows/security.yml` (modify — agregar job)
- **LOC estimate**: ~150 (waiver vs ≤100 justificado: completeness gate + ~20 mount points wire + integration tests)
- **Wall-clock**: ~4h
- **Depends on**: T2a, T2b
- **Acceptance**:
  - **Wire CORRECTO**: en `server.ts` agregar `isDemoEnforcementMiddleware` ANTES de cada `app.route(...)` que mountee endpoints con `firebaseAuthMiddleware` ya aplicado. Mount points completos (audit T2a output = ~20 grupos verificados contra server.ts:226-580): `/me`, `/me/*`, `/me/push-subscription[/*]`, `/me/cobra-hoy/*`, `/me/liquidaciones`, `/empresas/*`, `/trip-requests-v2/*`, `/offers/*`, `/assignments/*`, `/certificates/*`, `/admin/dispositivos-pendientes/*`, `/admin/cobra-hoy/*`, `/admin/stakeholder-orgs/*`, `/admin/site-settings/*`, `/admin/liquidaciones/*`, `/admin/seed/*`, `/admin/matching/*`, `/admin/observability/*`, `/vehiculos[/*]`, `/conductores[/*]`, `/sucursales[/*]`, `/documentos/*`, `/cumplimiento[/*]`. (T2a audit produce lista CANÓNICA; este task wire-instruments cada uno.)
  - **NO** intentar `app.use('*', ...)` global. Spec SC-1.3.2 amendment v3.4: "wire per-group post-firebase-auth en `server.ts`".
  - **Audit-completeness CI gate** (NEW per round 2 P0-2 fix): script `check-is-demo-wire-completeness.ts` lee audit T2a output canónico + parsea server.ts → falla si existe mount point auth-required SIN `isDemoEnforcementMiddleware` aplicado. Workflow `security.yml` job nuevo. **Esto previene incomplete coverage shipping en future PRs**.
  - Allowlist populated: `POST /demo/login`, `POST /demo/cache-warm/:persona`, `GET /feature-flags`, `POST /api/v1/signup-request` (preempty para T8), cada uno rationale + REVIEW_BY (90d future).
  - Integration T6: muestrea **≥1 endpoint por grupo enumerado** (no 8-10 total). Sesión demo → 403; no-demo → 200.
  - Integration T6b: fixture `app.post('/test-unallowed', handler)` sin allowlist → 403.
  - SC trace: **SC-1.3.2** (amendment topology + completeness gate), **SC-1.3.5**, **SC-1.3.6** part 1.
- **Rollback**: revertir cambios en server.ts (N-líneas de `isDemoEnforcementMiddleware` apply por grupo). Middleware file + allowlist + scripts permanecen safe.
- **Spec trace**: §3 SC-1.3.2 _(con amendment)_, SC-1.3.5, SC-1.3.6 part 1, §10 T6 + T6b.

### T4: observability `auth.is_demo.blocked` log-based metric + alert (conditional-counter pattern Sprint 2a) [DONE 2026-05-26]

- **Files**: `apps/api/src/middleware/is-demo-enforcement.ts` (modify — agregar structured log on block), `infrastructure/monitoring.tf` (modify — log-based metric + alert)
- **LOC estimate**: ~80
- **Wall-clock**: ~2h
- **Depends on**: T3 merged + 2h watch (need wire activo para baseline)
- **Acceptance**:
  - Middleware: cada bloqueo emite `logger.warn({event:"auth.is_demo.blocked", correlationId, uid, path, method, mode})`. `uid` incluido (Firebase UID no es Ley 19.628 PII per spec §H4). Sin body, sin persona (devils-advocate P2-1: persona logging riesgo edge-case admin role leak), sin email.
  - Log-based metric `sec001/auth_is_demo_blocked` counter DELTA. **Conditional-counter pattern** alineado con Sprint 2a T6a `demo_uid_retired`: emit solo cuando bloqueo ocurre (no en passthrough).
  - Alert policy `auth_is_demo_blocked_anomaly`: **`count(metric) > 0 sustained 5min`** (NO 3σ — sin baseline día-0, mismo pattern Sprint 2a). Notification `email_alerts`. Auto-close 25h. Follow-up tracked para upgrade a 3σ después de 1-2 semanas baseline.
  - SC trace: **SC-1.3.7**.
- **Rollback**: revertir middleware log + `terraform destroy -target=google_logging_metric.auth_is_demo_blocked -target=google_monitoring_alert_policy.auth_is_demo_blocked_anomaly`.
- **Spec trace**: §3 SC-1.3.7.

### T5: `is-demo + rate-limit` interaction integration test T7b [DONE 2026-05-26]

- **Files**: `apps/api/test/integration/is-demo-rate-limit-interaction.integration.test.ts` (nuevo)
- **LOC estimate**: ~40
- **Wall-clock**: ~1h
- **Depends on**: T3 merged
- **Acceptance**:
  - Test: sesión demo (`is_demo:true`) hace `POST /auth/driver-activate` valid → 403 (is-demo fires FIRST).
  - Verificación: Redis counter `rl:pin-activate:<rutNorm>` NO incrementa (redis.get directo retorna null o counter pre-existente unchanged).
  - SC trace: **SC-1.3.8** + spec §10 T7b.
- **Rollback**: revertir test file.
- **Spec trace**: §3 SC-1.3.8, §10 T7b.

> **PR1 H1.3 ships post-T5** — defense-in-depth global activo. 2h watch antes de iniciar PR2.

---

### T6: ADR-052 (signup migration Admin SDK) Proposed + `signup-paths-audit.md` inventory [DONE 2026-05-26]

- **Files**: `docs/adr/052-signup-migration-admin-sdk-gate.md` (nuevo, Status: Proposed), `docs/qa/signup-paths-audit.md` (nuevo)
- **LOC estimate**: ~100
- **Wall-clock**: ~2.5h
- **Depends on**: PR1 H1.3 shipped + 2h watch
- **Acceptance**:
  - ADR-052 Proposed con secciones explícitas (mismo pattern Sprint 2a ADR-053):
    - **Context**: SEC-001 H1.2 + spec O-1 expansión + signup-paths-audit results.
    - **Decision**: signup público (email/password) → admin-approval gate via `POST /api/v1/signup-request` + Admin SDK `auth.createUser` desde backend con approver email. IdP self-signup email/password OFF via Terraform. **Google leg: tracked residual, deferred to Sprint 2c con Firebase Auth Blocking Function**.
    - **Consequences positivas**: cero self-signup customer-facing fraud surface; admin approval audit trail; email enumeration defense.
    - **Consequences negativas**: UX delay (sign-up immediato → email approval delay); admin manual workload; falta Google leg (residual).
    - **Alternatives consideradas** (3 explícitas):
      - **Alt-1: OAuth-only (Google/Apple)** — rejected: Google self-signup gap sin Blocking Function deja gap; mismo problema.
      - **Alt-2: Email-verification-only sin admin approval** — rejected: no satisface O-1 decisión PO + no defense contra signup fraud automated.
      - **Alt-3: Status quo (IdP self-signup ON)** — rejected: vulnerabilidad SEC-001 H1.2 open.
    - **Status transitions**: Proposed (T6) → Accepted (T13 post-canary 30min success + 2h watch).
  - `signup-paths-audit.md`: tabla per spec SC-1.2.0 (auth-creation + auth-mutation + sign-in paths) generada via comando exacto: `grep -rnE 'createUserWithEmailAndPassword|sendPasswordResetEmail|signInWithEmailLink|sendSignInLinkToEmail|applyActionCode|verifyBeforeUpdateEmail|linkWithCredential|linkWithPopup|signInWithPopup|updatePassword|confirmPasswordReset|reauthenticateWithCredential|unlink|updateProfile' apps/web/src apps/api/src`. Por cada match: categoría + migration plan.
  - SC trace: **SC-1.2.0**.
- **Rollback**: revertir ambos archivos.
- **Spec trace**: §3 SC-1.2.0.

### T7: Drizzle migration `solicitudes_registro` + pgEnum + domain schema [DONE 2026-05-26]

- **Files**: `apps/api/src/db/schema.ts` (modify — agregar `estadoSolicitudRegistroEnum` pgEnum + `solicitudesRegistro` pgTable), `apps/api/drizzle/0039_solicitudes_registro.sql` (nuevo via `drizzle-kit generate`), `packages/shared-schemas/src/domain/signup-request.ts` (nuevo domain canónico)
- **LOC estimate**: ~80
- **Wall-clock**: ~2h
- **Depends on**: T6 merged (ADR-052 Proposed antes de DB schema per CLAUDE.md "ADR before code")
- **Acceptance**:
  - Domain canónico: `signupRequestSchema` Zod con campos `id` (uuid), `email`, `nombreCompleto`, `estado` enum (`pendiente_aprobacion` | `aprobado` | `rechazado`), `requestedAt`, `approvedBy` (email nullable), `approvedAt` (nullable).
  - **pgEnum** (Sprint 2a precedent): `export const estadoSolicitudRegistroEnum = pgEnum('estado_solicitud_registro', ['pendiente_aprobacion', 'aprobado', 'rechazado']);`. Spanish snake_case per CLAUDE.md naming bilingüe.
  - pgTable `solicitudes_registro` con columnas `id`, `email`, `nombre_completo`, `estado` (usa enum), `solicitado_en`, `aprobado_por` (text nullable), `aprobado_en` (timestamp nullable).
  - Migration generada via `pnpm --filter @booster-ai/api db:generate` → output a `apps/api/drizzle/0039_solicitudes_registro.sql`. NO `apps/api/src/db/migrations/` (path verificado contra Sprint 2a 0038).
  - Integration test mínimo en `seed-demo-cuentas-idempotency.integration.test.ts` pattern: insert + select roundtrip con domain validation.
  - SC trace: **SC-1.2.1** foundation, §11 migración DB.
- **Rollback**: drizzle migration `down` (reverse SQL) + revertir schema.ts y domain file.
- **Spec trace**: §3 SC-1.2.1.

### T8: POST `/api/v1/signup-request` route + service + `rate-limit-signup` middleware + `/health/signup-flow` liveness + wire `server.ts` + unit tests [DONE 2026-05-26]

- **Files**: `apps/api/src/routes/signup-request.ts` (nuevo), `apps/api/src/services/signup-request.ts` (nuevo), `apps/api/src/middleware/rate-limit-signup.ts` (nuevo — reuse pattern rate-limit-pin con scope `rl:signup-request:<ip>`), `apps/api/src/routes/health-signup-flow.ts` (nuevo — GET liveness endpoint para T13 uptime check fallback), `apps/api/src/server.ts` (modify — wire route + liveness + allowlist comment), `apps/api/src/routes/signup-request.test.ts` (nuevo unit), `apps/api/src/middleware/rate-limit-signup.test.ts` (nuevo unit)
- **LOC estimate**: ~200 (waiver vs ≤100 — justificado: middleware clone (~80 LOC base rate-limit-pin.ts) + endpoint + service + liveness + 2 test files; precedent Sprint 2a T4 = 100 LOC fue solo service file, este incluye 4 source files + 2 test files)
- **Wall-clock**: ~3.5h
- **Depends on**: T7 merged
- **Acceptance**:
  - Endpoint: `app.route('/api/v1/signup-request', signupRequestRouter)` mountado en `server.ts` (NO `main.ts` — verificado).
  - zValidator body con `email` + `nombreCompleto`. Valid → 202 `{ok:true}`. Invalid → 422.
  - Service: insert row con `estado=pendiente_aprobacion`. **Email enumeration defense**: response identical 202 si email ya existe en `users` table (sin DB write, solo log structured).
  - Rate-limit middleware: 5/15min/IP scope `rl:signup-request:<ip>`. Fail-closed 503 + `Retry-After: 30` (mismo pattern Sprint 2a rate-limit-pin).
  - Wire en `server.ts`: `app.use('/api/v1/signup-request', rateLimitSignup); app.route('/api/v1/signup-request', signupRequestRouter);` — orden importa (rate-limit primero).
  - **Cross-PR allowlist note**: `is-demo-allowlist.ts` (shipped en PR1 T3) ya tiene entry preempty para `POST /api/v1/signup-request` (signup es sin auth → middleware no fires). Si T3 NO incluyó preempty entry, T8 lo agrega con justificación "signup-request es path sin auth, no aplica is_demo enforcement // REVIEW_BY: <date+90d>". CI lint T6c/T6d acepta el add.
  - Unit tests: valid + invalid + rate-limit happy path; coverage 80%+.
  - SC trace: **SC-1.2.1** route surface, **SC-1.2.5** rate-limit + enumeration defense.
- **Rollback**: revertir wire en `server.ts` (route 404); files permanecen para próximo intento.
- **Spec trace**: §3 SC-1.2.1, SC-1.2.5.

### T9a: integration tests `signup-request` happy path + enumeration + rate-limit [DONE 2026-05-26]

- **Files**: `apps/api/test/integration/signup-request.integration.test.ts` (nuevo)
- **LOC estimate**: ~50
- **Wall-clock**: ~1.5h
- **Depends on**: T8 merged
- **Acceptance**:
  - Test 1 (happy): POST valid → 202 + row en DB `estado=pendiente_aprobacion`.
  - Test 2 (enumeration defense): POST email ya en `users` table → 202 (response idéntico, NO row insertado en `solicitudes_registro`).
  - Test 3 (rate-limit): 6 requests mismo IP → 6º 429 + `Retry-After: 900`.
  - SC trace: **SC-1.2.4** partial, **SC-1.2.5** partial.
- **Rollback**: revertir test file.
- **Spec trace**: §10 T-SIGNUP-1 happy path.

### T9b: integration test `signup-request` fail-closed Redis + cloud-armor cascade (testcontainers) [DONE 2026-05-26]

- **Files**: `apps/api/test/integration/signup-request-fail-closed.integration.test.ts` (nuevo)
- **LOC estimate**: ~70
- **Wall-clock**: ~2h
- **Depends on**: T9a, Sprint 2a T8 testcontainers harness disponible
- **Acceptance**:
  - Test 1 (Redis fail-closed): testcontainers Redis up → request OK; container stop → request → 503 + `Retry-After: 30`. Mismo pattern Sprint 2a T8 escenarios 1+2.
  - Test 2 (cloud-armor cascade): mock header `X-Cloud-Armor-Banned: true` → expected behavior documentado en `docs/qa/rate-limit-cascade.md` §"signup-request layer" (signup-request layer no incrementa Redis counter, propaga 429 cloud-armor).
  - SC trace: **SC-1.2.5** fail-closed + cascade completion.
- **Rollback**: revertir test file.
- **Spec trace**: §3 SC-1.2.5, §10 T-SIGNUP-1 fail-closed.

### T9c: integration test matrix — per-method negative tests (SC-1.2.4)

- **Files**: `apps/api/test/integration/signup-paths-negative.integration.test.ts` (nuevo)
- **LOC estimate**: ~80
- **Wall-clock**: ~2.5h
- **Depends on**: T11 merged (IdP self-signup OFF live for the matrix to fire)
- **Acceptance**:
  - Parametrized test sobre los 5 métodos creation MÁS exploitables del inventario SC-1.2.0: `createUserWithEmailAndPassword`, `sendSignInLinkToEmail`, `signInWithEmailLink`, `sendPasswordResetEmail`, `applyActionCode`. **Scope reducido del SC-1.2.4 v3.2 original** (12 métodos) → 5 métodos. Justificación: mutation paths (`updatePassword`, `confirmPasswordReset`, etc.) requieren ya-existir user; sign-in paths no son self-signup vectors; los 5 elegidos son los únicos que pueden CREAR un new user sin gate previo. Spec amendment v3.4 propuesto.
  - Por cada método: invocar via Firebase Web SDK client mock → assert `auth/operation-not-allowed` error code returned.
  - Test setup: mock Identity Platform config OFF state.
  - SC trace: **SC-1.2.4** completion _(con scope-reduction amendment)_.
- **Rollback**: revertir test file. Si spec amendment v3.4 no aprobado por PO, este task fail spec gate.
- **Spec trace**: §3 SC-1.2.4 _(con amendment proposed)_.

### T10: admin signup-requests page + admin route + email notifications + feature flag

- **Files**: `apps/web/src/routes/platform-admin-signup-requests.tsx` (nuevo single-file pattern), `apps/api/src/routes/admin-signup-requests.ts` (nuevo — list + approve + reject), `apps/api/src/services/signup-request.ts` (modify — agregar `approve()` + `reject()` con Admin SDK `auth.createUser`), `apps/api/src/services/notifications/signup-request-email.ts` (nuevo), `apps/api/src/server.ts` (modify — wire admin route), `apps/api/src/config.ts` (modify — agregar `SIGNUP_REQUEST_FLOW_ACTIVATED` via `booleanFlag(false)` helper + `BOOSTER_PLATFORM_ADMIN_EMAILS` string list)
- **LOC estimate**: ~400 (waiver vs ≤100 EXPLICIT — justificado por precedent: `apps/web/src/routes/platform-admin-matching.tsx` = 1043 LOC para single admin UI page; este task ~30% density vs precedent + backend extension. PO decisión 2026-05-25: mantener monolítico vs split, UI pages son inherentemente bundled; waiver no escapa scope creep — es realidad arquitectónica del frontend Booster)
- **Wall-clock**: ~3.5h
- **Depends on**: T9a merged (endpoint live para testing approval)
- **Acceptance**:
  - Env `SIGNUP_REQUEST_FLOW_ACTIVATED` boolean (default `false`). Spec §7.5 feature flag pattern.
  - UI page lista pending requests + accept/reject buttons gated por flag (UI muestra "Coming soon" si flag OFF). Auth via admin role check (reusa pattern `platform-admin-*.tsx`).
  - Admin routes:
    - `GET /admin/signup-requests` → list (admin role required).
    - `POST /admin/signup-requests/:id/approve` → `service.approve(id, approverEmail)` → Admin SDK `auth.createUser({email, displayName})` + crea row en `users` + actualiza `solicitudes_registro.estado=aprobado`.
    - `POST /admin/signup-requests/:id/reject` → `service.reject(id, reason)` → actualiza estado=`rechazado`.
  - Email notifications:
    - On signup-request submit → email a addresses in `BOOSTER_PLATFORM_ADMIN_EMAILS` env con link al admin page.
    - On approve → email a user con login link.
  - Allowlist entries en `is-demo-allowlist.ts` para `POST /admin/signup-requests/:id/approve` + `/reject` con rationale "admin-only mutation; role check upstream garantiza no-demo".
  - Wire en `server.ts`: `app.use('/admin/*', firebaseAuthMiddleware, adminRoleMiddleware); app.route('/admin/signup-requests', adminSignupRequestsRouter);`
  - Integration test: approve flow → Admin SDK mock called → user created → emails sent (mock).
  - **Rollback updated**: flip flag `SIGNUP_REQUEST_FLOW_ACTIVATED=false` (UI muestra coming-soon; admin routes return 503 service_unavailable con structured log). Files permanecen mergeados. Per spec §7.5.
  - SC trace: **SC-1.2.1** completion.
- **Rollback**: feature flag flip; no code revert necesario.
- **Spec trace**: §3 SC-1.2.1, §7.5 rollback feature flag.

### T11: Terraform `google_identity_platform_config` email/password OFF + IdP config doc

- **Files**: `infrastructure/identity-platform.tf` (nuevo o modify si existe), `docs/qa/identity-platform-config.md` (nuevo)
- **LOC estimate**: ~40
- **Wall-clock**: ~1.5h
- **Depends on**: T10 merged + flag flipped ON in staging + admin approval flow curl-verified
- **Acceptance**:
  - Terraform: `google_identity_platform_config.default` con `sign_in.email.enabled = true, sign_in.email.password_required = true, sign_in.allow_duplicate_emails = false` PLUS provider-level config (si soportado GA): `google_identity_platform_default_supported_idp_config` para email/password con `enabled = true` pero **NEW SIGNUPS disabled vía Terraform property si existe; si NO existe en GA, documented manual change**.
  - Verificación post-apply: `curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: booster-ai-494222" "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.signIn.email'` retorna esperado (config exact verificable).
  - `identity-platform-config.md` documenta:
    - Estado final email/password OFF tras T11.
    - **Residual Google provider**: tracked tarea Sprint 2c con Firebase Auth Blocking Function. Mientras tanto: Google self-signup OPEN (riesgo documentado, no exploitable end-to-end sin role assignment manual).
    - Cualquier change manual residual + TODO IaC ref Sprint 2c.
  - SC trace: **SC-1.2.2 email/password = MET**; **SC-1.2.2 Google = TRACKED_RESIDUAL** (per §1.1 partial-cierre).
- **Rollback**: revertir Terraform → re-apply restaura email/password self-signup ON. **NO opens Google gap (Google ya OPEN; rollback no afecta el residual)**.
- **Spec trace**: §3 SC-1.2.2 _(email/password leg only; Google deferred Sprint 2c)_.

### T13: synthetic monitor `signup-probe` + canary via `services update --image` + Terraform `traffic` ignore_changes

- **Files**: `infrastructure/modules/cloud-run-service/main.tf` (modify — agregar `var.traffic_managed_externally` boolean + dynamic `ignore_changes` para `traffic`), `infrastructure/modules/cloud-run-service/variables.tf` (modify — declarar variable), `infrastructure/compute.tf` (modify — pasar `traffic_managed_externally=true` SOLO al `service_api`, defaults false a los otros 8 servicios), `infrastructure/monitoring/signup-probe.tf` (nuevo o ext), `cloudbuild.production.yaml` (modify — **REEMPLAZAR** `deploy-api` step lines 153-165 con 6-step canary sequence preservando `id: deploy-api` en step final), `docs/qa/signup-canary-rollback.md` (nuevo)
- **LOC estimate**: ~150 (Terraform module + variable ~20 + compute.tf prop pass ~5 + uptime check ~30 + cloudbuild canary 6-step ~60 + runbook ~35)
- **Wall-clock**: ~4h
- **Depends on**: T11 merged + T9a + T9b + T9c all passed
- **Acceptance**:
  - **Terraform module variable scoping** (NEW v4 per round 3 P0-1 fix): nueva variable `traffic_managed_externally` (default `false`) en `cloud-run-service/variables.tf`. `main.tf` usa `dynamic "lifecycle"` o conditional `ignore_changes` con merge: si `var.traffic_managed_externally`, añade `traffic` al `ignore_changes` list; else default. En `compute.tf` SOLO el `service_api` pasa `traffic_managed_externally = true`. Los 8 servicios restantes (web, matching-engine, telemetry-processor, notification, sms-fallback, whatsapp-bot, document, etc.) preservan default false → Terraform sigue managing traffic para ellos.
  - **Cloud Build canary step replacement** (NEW v4 per round 3 P1-1 fix): `cloudbuild.production.yaml:153-165` (`deploy-api` step actual) **REEMPLAZAR** con 6-step canary sequence. Step final preserva `id: deploy-api` para que `waitFor: [deploy-api]` downstream (line ~298 watch-deploy) siga resolviendo. Secuencia:
    1. `id: deploy-canary` — `gcloud run services update booster-ai-api --image=${_REGISTRY}/api:${_COMMIT_SHA} --tag=canary-signup-${_COMMIT_SHA} --no-traffic --update-labels=commit=${_COMMIT_SHA}`. `waitFor: [push-api]`.
    2. `id: route-canary` — `gcloud run services update-traffic booster-ai-api --to-tags=canary-signup-${_COMMIT_SHA}=1`. `waitFor: [deploy-canary]`.
    3. `id: canary-sleep` — `entrypoint: bash; args: ["-c", "sleep 1800"]` (30min). `waitFor: [route-canary]`.
    4. `id: canary-verify` — script que query monitoring API `error_rate < 1%` AND `p95_latency < 500ms` sobre la tag. Exit 1 si falla. `waitFor: [canary-sleep]`.
    5. `id: deploy-api` (PRESERVA EL id ORIGINAL para downstream waitFor) — `gcloud run services update-traffic booster-ai-api --to-latest`. `waitFor: [canary-verify]`.
    6. Rollback path (siempre disponible manual): `gcloud run services update-traffic --to-revisions=PREVIOUS=100`.
  - Runbook `signup-canary-rollback.md` con cmds exactos paso 5/6 + decision criteria + escalation + comandos rollback fast-path (~1 LOC manual).
  - **Synthetic monitor**: `google_monitoring_uptime_check_config.signup_probe` GET sobre `/health/signup-flow` (endpoint nuevo en T8). Probe cada 60s. Page on 2 consecutive failures.
  - **ADR-052 Status flip Proposed → Accepted**: **SEPARATE post-merge commit** (round 2 P1-5 fix). Comando: `git commit -m "docs(adr-052): Accepted post-canary success cloudbuild run <ID>"`. Out-of-band task §4.
  - SC trace: **SC-1.2.3** synthetic + canary respect Terraform ownership scoped a service_api solo.
- **Rollback**: `gcloud run services update-traffic --to-revisions=PREVIOUS=100` (1 cmd). Revertir 4 cambios: (a) cloudbuild.yaml canary steps → restaurar `deploy-api` original, (b) Terraform module variable + dynamic ignore_changes, (c) compute.tf prop service_api, (d) signup-probe.tf.
- **Spec trace**: §3 SC-1.2.3, §14.2 canary not-interruptible.

> **PR2 H1.2 ships post-T13** (canary 30min + 2h watch). ADR-052 Accepted flip = separate follow-up commit. Sprint 2b CERRADO.

## 4. Out-of-band tasks Sprint 2b

- **ADR-052 Status flip Proposed → Accepted** post-T13 canary success + 2h watch — SEPARATE commit (~2 LOC) per round 2 P1-5 fix.
- **Update CURRENT.md** post-Sprint-2b con tabla PRs + evidencia operacional + dimensiones cubiertas (pattern Sprint 2a).
- **`signup_request` cleanup cron** (90d auto-purge de `rechazado` rows) → tracked en `_followups/`.
- **Silent-window guard alert para `auth_is_demo_blocked`** después de 1-semana datos (baseline establecido) → tracked en `_followups/`.
- **Crear stub `_followups/sprint-2c-google-blocking-function.md`** PRE-build T6 (round 2 P0-2 follow-up file no existe aún).

## 5. Tasks deferred a Sprint 2c (post-devils-advocate round 1)

- **SC-1.2.2 Google provider gap close** — spec dedicada Sprint 2c con Firebase Auth Blocking Function `beforeCreate` (Cloud Function separada). Tracked en `.specs/_followups/sprint-2c-google-blocking-function.md`.
- **D-T16 custom metric `rate_limit_pin_blocked_total`** + dashboard panel — deferred por P1-4 sizing (Sprint 2b ya en límite ≤15 tasks).
- **D-T18 CodeQL custom queries auth-driver** — deferred mismo motivo.
- **H1.5 forensia + H1.6 reactivación + H3 spec hermano** — diferidos a Sprint 2c+.

## 6. Estimación Sprint 2b (post-v3)

| PR | Sub-fase | Tasks | LOC | Wall-clock build |
|---|---|---|---|---|
| PR1 | H1.3 | T1, T2a, T2b, T3, T4, T5 | ~550 | ~13h |
| PR2 | H1.2 | T6, T7, T8, T9a, T9b, T9c, T10, T11, T13 | ~1170 | ~26h |
| **Total exec puro** | | **15 tasks** | **~1720 LOC** | **~39h** |
| Cooling-off (15 × 30min) | | | | ~7.5h |
| Review (2 PRs × 30min) | | | | ~1h |
| Ship (2 PRs × 15min) | | | | ~0.5h |
| Out-of-band (5 items: ADR flip + stub + CURRENT + cleanup cron + silent-window) | | | | ~3h |
| Canary watch PR2 (30min canary + 2h post) | | | | ~2.5h |
| Post-deploy 2h watch ×2 PRs | | | | ~4h |
| **Total wall-clock estimate** | | | | **~58h** |

**~58h / 4h/día = ~14-16 días hábiles realistic.** **15 tasks EXACTLY en SKILL §Red Flags ≤15 threshold**. LOC waivers EXPLICIT pre-planning: T1 (~140), T3 (~150, completeness gate), T8 (~200), T10 (~400, monolítico per PO decision precedent `platform-admin-matching.tsx` 1043 LOC).

## 7. Sprint 2b interrupt points (post-v2)

| Punto | Interruptible? | Razón |
|---|---|---|
| Post-T1 (middleware scaffolding, sin wire) | **SÍ** | middleware existe, allowlist vacía, sin wire. No-op runtime. |
| Post-T2a (allowlist + audit doc, sin lint scripts) | **SÍ** | docs + scaffolding. |
| Post-T2b (CI lint scripts) | **SÍ** | scripts y workflow live; lint runs en próximos PRs pero sin impacto runtime. |
| Post-T3 (wire per-group + integration tests) | **SÍ** | enforcement activo; demo bloqueado writes; safe pause. |
| Post-T4 (obs metric + alert) | **SÍ** | observability live, sin impacto runtime adicional. |
| Post-T5 (interaction test) | **SÍ** | PR1 ready to ship. |
| Pre-PR1 ship | **SÍ** | mergeable atomic. |
| Post-PR1 ship + 2h watch | **SÍ** | defense-in-depth deployed. |
| Pre-T6 (ADR + audit doc) | **SÍ** | docs-only. |
| Post-T7 (DB migration solo) | **SÍ** | tabla nueva vacía, sin endpoint = sin uso. |
| Post-T8 endpoint (sin admin UI ni IdP OFF) | **SÍ** | endpoint accepts requests; `solicitudes_registro` acumula; admin no puede approve aún (T10 no shipped); flag `SIGNUP_REQUEST_FLOW_ACTIVATED` default OFF gate la UI también. |
| Post-T9a + T9b + T9c (tests, sin admin UI) | **SÍ** | tests passing; runtime sin cambio. |
| Post-T10 admin UI (sin IdP OFF) | **SÍ** | admin approval flow live con flag OFF — coming-soon UI; IdP self-signup aún ON (paths coexisten); admin can flag ON staging para test. |
| Post-T11 IdP email/password OFF (sin canary) | **SÍ** | email/password self-signup blocked; admin gate live; ADR-052 Proposed sigue. Customer-affecting cambio aplicado. **2h watch recomendado antes de continuar T13**. |
| Mid-T13 canary 1% (post-flip-traffic) | **NO** | per spec §14.2 "post-canary mid-flight no interrumpible". Full rollout o full rollback explícito. |
| Post-T13 canary full + 2h watch + ADR-052 Accepted | **SÍ** | Sprint 2b cerrado. |

## 8. Pre-build checklist Sprint 2b

- [ ] Sprint 2a PR #346 + #347 mergeados — **CONFIRMADO 2026-05-25**.
- [ ] 4 UIDs nuevas activas Firebase con `is_demo:true` para target T3/T5 enforcement — **CONFIRMADO**.
- [ ] **T6 ADR-052 DEBE mergear ANTES de T7 DB migration build** per agent-rigor "ADR before code".
- [ ] T11 NO ejecutado hasta T10 admin UI live + flag ON staging + curl-verified approve flow end-to-end.
- [ ] **T11 no genera Google self-signup gap mid-flight** (Google leg already OPEN; T11 cierra solo email/password leg). Tracked como TRACKED_RESIDUAL §1.1.
- [ ] T13 canary NO iniciado Friday después 12:00 Santiago (canary 30min + 2h watch + posible rollback = excede ventana 16:00).
- [ ] Spec amendment v3.4 PROPUESTO pre-/build: (a) SC-1.3.2 wire "global en main.ts" → "per-group en server.ts post-firebase-auth"; (b) SC-1.2.4 scope reducción "12 métodos" → "5 métodos creation MÁS exploitables"; (c) SC-1.2.2 partial-cierre Google leg TRACKED_RESIDUAL Sprint 2c.
- [ ] `dependency-auditor` sub-agent run programado para T7 (Drizzle new table).
- [ ] `security-scanner` sub-agent run programado para /review (Sprint 2b toca auth/signup/middleware surface masivamente).
- [ ] LOC waivers documentados pre-build: T1 (~140), T3 (~150 completeness gate), T8 (~200), T10 (~400 UI page mon per PO decision). Si surge >X*1.3 LOC en build, parar y re-split (donde X = waiver explícito).
- [ ] **Pre-build verify Terraform provider `google_identity_platform_default_supported_idp_config` GA support** para `allow_signup` per-provider property (round 2 P2-2) — `terraform providers schema` lookup.
- [ ] **Crear `_followups/sprint-2c-google-blocking-function.md`** stub PRE-T6 build (referenced en plan §1.1 + §5).

## 9. Splits aplicados Sprint 2b (post-devils-advocate round 1)

| Task original v1 | Split v2 | Justificación |
|---|---|---|
| **T2** (middleware allowlist + audit doc + lint scripts + workflow) | **T2a** (allowlist + audit doc) + **T2b** (lint scripts + workflow) | P0-5: 4-archivo bundle en 3 surfaces (api, scripts, CI) tracing 3 SCs distintas |
| **T9** (3 tests bundled) | **T9a** (happy + enum + rate-limit) + **T9b** (fail-closed Redis testcontainers) + **T9c** (per-method negative matrix) | P0-6 + P0-7: separate concerns + dependency timing (T9b needs T9a baseline; T9c needs T11 OFF state) |
| **T12** (backend Google fallback en route inexistente) | **REMOVED** (deferred Sprint 2c) | P0-2: `auth-google-callback.ts` no existe; require Cloud Function Blocking Function design separate spec |
| **T13** (canary en compute.tf) | **T13** (canary en `release.yml` GitHub Actions + runbook + ADR flip) | P0-3: compute.tf traffic bajo `ignore_changes` (Cloud Build managed); Terraform canary impossible |
| **T6c+T6d** (originalmente fold en T2) | **T2b separado** (T6c lint comment + T6d PR-modifies-guard) | P2 SC-1.3.6 explicit 2 separate CI guards per spec §SC-1.3.6 bullets 2+3 |

## 10. ADRs Sprint 2b

- **ADR-052** — Signup migration a Admin SDK + Identity Platform email/password self-signup OFF + Google leg deferred Sprint 2c. Status `Proposed` (T6) → `Accepted` (T13 post-canary success + 2h watch).

## 11. Spec amendment v3.4 propuesto pre-/build

Sprint 2b devils-advocate round 1 reveló 3 amendments necesarios al spec v3.3 antes de iniciar /build:

| Amendment | SC | Cambio | Razón |
|---|---|---|---|
| A1 | SC-1.3.2 | "wire global en `main.ts`" → "wire per-group en `server.ts` post-firebase-auth middleware chain" | Codebase reality: firebase-auth no es global; `main.ts` solo bootstrap |
| A2 | SC-1.2.4 | "por cada método inventariado en SC-1.2.0 (~12 métodos)" → "por los 5 métodos creation MÁS exploitables (`createUserWithEmailAndPassword`, `sendSignInLinkToEmail`, `signInWithEmailLink`, `sendPasswordResetEmail`, `applyActionCode`); mutation + sign-in paths OUT of scope" | Reduction: mutation paths requiren ya-existir user; sign-in paths no son self-signup vectors |
| A3 | SC-1.2.2 | "ambos providers email/password Y Google" → "email/password leg = MET via Sprint 2b T11; Google leg = TRACKED_RESIDUAL deferred Sprint 2c con Firebase Auth Blocking Function" | Realidad arquitectónica: Google sign-in cliente-side only; backend gate require Cloud Function diferente design |

**Aprobación PO requerida ANTES de T1 build** vía edit directo a `spec.md` + Status amendment v3.4 + decision log entry.

## 12. Open questions

(Todas cerradas pre-v2.)

## 13. Decision log Sprint 2b

- 2026-05-25 — Sprint 2a CERRADO 12/12.
- 2026-05-25 — PO decisión scope stub Sprint 2b (H1.3 + H1.2 + discoveries; sin H1.5).
- 2026-05-25 — PO decisión orden PR1 H1.3 → PR2 H1.2 → PR3 discoveries.
- 2026-05-25 — PO decisión timing inmediato (sin gap 24h).
- 2026-05-25 — Plan v1 producido (15 tasks, 3 PRs).
- 2026-05-25 — Devils-advocate round 1 sobre v1. Verdict DO_NOT_APPROVE. 7 P0 + 5 P1 + 2 P2. Output completo §14 inline + agent ID `a63fad0e84dd0a8ea`.
- 2026-05-25 — Plan v2 producido: 7 P0 round 1 todos resueltos. Spec amendment v3.4 propuesto pre-build.
- 2026-05-25 — Devils-advocate round 2 sobre v2. Verdict APPROVE_WITH_RESERVATIONS. 2 P0 partial (P0-1 wire incomplete, P0-3 canary mechanics) + 2 NEW P0 (T13 deploy command violation, T3 enumeration gap) + 5 NEW P1 (T10 path wrong, T10 LOC understated, T8 LOC tight, T13 POST uptime unverified, T13 ADR causality reversed) + 4 P2. Agent ID `a6a4ea5bb04b437b0`.
- 2026-05-25 — PO decisiones post-round-2: (a) Plan v3 + round 3 verification; (b) T13 canary mechanics via `gcloud run services update --image` + tag API + Terraform `traffic` ignore_changes; (c) T10 mantener monolítico con waiver 350-450 LOC.
- 2026-05-25 — Plan v3 producido: round 2 issues resueltos. Pending: round 3.
- 2026-05-25 — Devils-advocate round 3 sobre v3. Verdict APPROVE_WITH_RESERVATIONS_FINAL. 5/7 round-2 FIXED clean + 1 PARTIAL (T13 canary mechanics — module-wide ignore_changes leak afecta 8 servicios) + 1 NEW P0 + 3 NEW P1. Agent ID `a7db1c03204d2fd71`. Plan ships si P0-1 module variable + P1-1 cloudbuild replace especificados.
- 2026-05-25 — Plan v4 producido: round 3 P0-1 + P1-1 fixes aplicados; residuales aceptados.
- 2026-05-25 — Devils-advocate round 4 sobre v4. Verdict APPROVE_WITH_RESERVATIONS_FINAL. **Convergencia alcanzada**: ambos round-3 critical fixes verificados clean, 3 residuals aceptados explícitamente, 0 NEW P0, 0 material NEW P1 (2 hygiene observations no bloqueantes: T13 canary-verify script no enumerado en Files + "8 servicios" enum mild precision). Agent ID `a174ff7f8d158fd8f`. **Plan v4 = FINAL, ready para /build T1 post PO approval**.

## 14. Devils-advocate round 1 output (capturado completo)

**Verdict**: DO_NOT_APPROVE. Sub-agent agent ID `a63fad0e84dd0a8ea`.

**7 P0** (todos resueltos v2):
- P0-1: Wire target wrong (main.ts → server.ts) — resuelto T3.
- P0-2: `auth-google-callback.ts` inexistente — resuelto deferring Google leg.
- P0-3: Terraform compute.tf canary impossible — resuelto T13 to release.yml.
- P0-4: Drizzle migration path wrong + missing pgEnum — resuelto T7.
- P0-5: T2 4-task bundle — resuelto T2a + T2b.
- P0-6: SC-1.2.5 fail-closed Redis test missing — resuelto T9b.
- P0-7: SC-1.2.4 per-method negative tests uncovered — resuelto T9c con spec amendment v3.4 scope-reduction.

**5 P1** (todos resueltos v2):
- P1-1: ADR-052 underspecified — resuelto T6 expanded sections.
- P1-2: T10 rollback fail-soft inadequate — resuelto feature flag pattern.
- P1-3: T13 canary baseline impossible — resuelto acceptance reduced.
- P1-4: Sizing 15 tasks + likely splits → 18+ — resuelto deferring T14+T15 a Sprint 2c.
- P1-5: T11+T12 order backwards — resuelto deferring T12 entirely.

**2 P2** (aceptados):
- P2-1: T4 3σ alert sin baseline → cambiado a count>0 (mismo pattern Sprint 2a).
- P2-2: T14 + T15 acceptance criteria hand-wavy — N/A (tasks deferred).

## Referencias

- Spec: [`spec.md`](spec.md) §3 H1.3 + H1.2 + §10 test list + §13 deuda + §14 execution.
- Plan Sprint 2 META: [`plan-sprint-2.md`](plan-sprint-2.md).
- Plan Sprint 2a (patterns ref): [`plan-sprint-2a.md`](plan-sprint-2a.md).
- ADR-053 (Sprint 2a pattern ADR lifecycle): [`docs/adr/053-post-disclosure-account-replacement.md`](../../docs/adr/053-post-disclosure-account-replacement.md).
- Conditional-counter pattern Sprint 2a T6a: [`infrastructure/monitoring.tf`](../../infrastructure/monitoring.tf) §"T6a SEC-001".
- Wire location verificado: `apps/api/src/server.ts:91-580`.
- Drizzle migrations location: `apps/api/drizzle/`.
- Cloud Run traffic ignore_changes: `infrastructure/modules/cloud-run-service/main.tf:97-110`.
- Sprint 2c Google Blocking Function follow-up: [`.specs/_followups/sprint-2c-google-blocking-function.md`](../_followups/sprint-2c-google-blocking-function.md) _(crear en pre-build)_.
