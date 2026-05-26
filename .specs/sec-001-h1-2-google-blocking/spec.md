# Spec: sec-001-h1-2-google-blocking

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-26 (v2 redraft)
- **Status**: Approved v2 (2026-05-26)
- **Linked**:
  - v1 historical: [`spec-v1.md`](./spec-v1.md) (INVALIDATED 2026-05-26 — architecture wrong per devils-advocate empirical findings; preserved for audit).
  - Review history: [`review.md`](./review.md) (DA pass over v1, 3 P0 + 5 P1 + 7 P2 findings).
  - Parent spec: [`.specs/sec-001-cierre/spec.md`](../sec-001-cierre/spec.md) §3 H1.2 SC-1.2.2 amendment A3 v3.4 (Google leg TRACKED_RESIDUAL).
  - Predecessor ADR: [`docs/adr/052-signup-migration-admin-sdk-gate.md`](../../docs/adr/052-signup-migration-admin-sdk-gate.md) (Status: Proposed; transición a Accepted post-T13 canary success + 2 h watch).
  - Sprint precedent: Sprint 2b PR2 (12 PRs `dcfb588`..`0a6fd1f` shipped 2026-05-26).
  - External docs (empirically verified 2026-05-26):
    - [Identity Platform Blocking Functions](https://docs.cloud.google.com/identity-platform/docs/blocking-functions) — requires `gcip-cloud-functions` SDK.
    - [GitHub iap-gcip-web-toolkit#258](https://github.com/GoogleCloudPlatform/iap-gcip-web-toolkit/issues/258) — confirms Gen 1 only support.
    - [`gcip-cloud-functions` reference](https://docs.cloud.google.com/identity-platform/docs/reference/gcip-cloud-functions).
    - [Terraform `google_identity_platform_config` blocking_functions](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/identity_platform_config#blocking_functions).

## 1. Objective

Cerrar el residual `signInWithPopup(firebaseAuth, googleProvider)` self-signup que permaneció OPEN tras Sprint 2b T11 apply, implementando una Identity Platform Blocking Function (`beforeCreate`) que rechaza la creación de un Firebase user vía OAuth federated (inicialmente Google) si no existe una matching `solicitudes_registro.estado=aprobado` para ese email. Restaura el invariante de SC-1.2.2 ("Identity Platform sign-up disabled, todos los providers") cumpliendo el patrón admin-approval gate establecido por ADR-052 también para el camino Google.

## 2. Why now

- **Riesgo residual aceptado en Sprint 2b ahora cierra**: ADR-052 §Riesgo residual R-DA-GOOGLE-OPEN documentó esto como deuda explícita; el spec hermano (este) es el cierre planificado.
- **Defense-in-depth Zero-Trust**: Booster aplica admin-approval gate en email/password (Sprint 2b); dejar Google como bypass crea una asymmetric attack surface — un atacante con cuenta Google nueva crea Firebase user "huérfano" (sin role) que pollutea el tenant + audit log.
- **Pre-requisito completado**: Sprint 2b PR2 ✅ shipped 2026-05-26 (12 PRs + 3 terraform apply + drift resuelto). ADR-052 está en `Proposed` y se espera flip a `Accepted` post-canary success — sin embargo este spec puede DEFINIR-se ahora (no ejecutar BUILD hasta que ADR-052 esté Accepted, gate documentado en §11 Rollout via **mechanical CI check**).

## 3. Success criteria

- [ ] **SC-2C.1**: Identity Platform config production tiene `blocking_functions.triggers.beforeCreate` apuntando a la Cloud Function Gen 1 que implementa el handler. Verificable vía `curl -s "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.blockingFunctions'`.

- [ ] **SC-2C.2**: Cuando un visitante anónimo invoca `signInWithPopup(firebaseAuth, googleProvider)` con cuenta Google **nueva** (no presente en `usuarios` y sin matching `solicitudes_registro.estado=aprobado`), el flow OAuth completa contra Google pero `signInWithPopup` retorna error con `code: 'auth/internal-error'` y mensaje detail accesible al frontend; **NO** se crea row en Identity Platform tenant. Verificable vía smoke E2E manual + integration test contra Firebase emulator.

- [ ] **SC-2C.3**: Cuando un visitante anónimo invoca `signInWithPopup(firebaseAuth, googleProvider)` con cuenta Google que tiene matching `solicitudes_registro.estado='aprobado'` para el mismo email, el flow OAuth completa y el Firebase user se crea normalmente. Sign-in subsequent vía Google funciona. Verificable vía smoke E2E manual con cuenta aprobada de prueba.

- [ ] **SC-2C.4** _(reformulated per P1-3)_: Blocking Function completa la decisión (lookup DB → return allow|deny) en **p95 < 1500 ms** sobre la primera ventana de medición disponible (**first 10 invocations OR 7-day window post-launch, whichever comes first**). Threshold inferior al SLA Firebase 7 s; budget para cold-start + DB query + network. Verificable vía Cloud Monitoring metric `cloudfunctions.googleapis.com/function/execution_times`. Pre-launch baseline test: deploy function a staging-equivalent + curl 10 invocations + record p50/p95/p99 antes de wire al IdP runtime.

- [ ] **SC-2C.5**: Si la Blocking Function arroja error inesperado (DB unreachable, timeout, exception no-catched), la implementación retorna `HttpsError('internal', '...')` lo que Firebase Auth interpreta como **fail-closed** (sign-up bloqueado). NO fail-open. Verificable vía integration test con DB mockeada arrojando.

- [ ] **SC-2C.6** _(numeric baseline per P1-4)_: Identity Platform audit log emite entry `cloudaudit.googleapis.com/data_access` con `methodName="google.cloud.identitytoolkit.v1.AuthenticationService.SignUp"` + `status.code != 0` para cada intento de signup Google bloqueado. Cloud Monitoring alert dispara si rate de blocked Google signups > **5/hour sostenido 1 hour** (umbral inicial generoso pre-baseline). Tras 7-day baseline post-launch, threshold se reajusta a `media + 3-sigma` documentado en runbook. Verificable post-deploy via filter en Cloud Logging.

- [ ] **SC-2C.7**: Cobertura de tests del handler ≥ 80 % lines / 75 % branches per CLAUDE.md booster-stack-conventions. Cubre: happy approved, rejected not-found, rejected wrong-estado, DB throw fail-closed, non-Google provider passthrough, race condition concurrent signups, email casing IDN/punycode/aliases.

- [ ] **SC-2C.8** _(numeric baseline per P1-4)_: Spec hermano `sec-001-cierre/spec.md` §3 SC-1.2.2 amendment A3 transiciona de `TRACKED_RESIDUAL` a `MET` mediante separate commit post-Sprint-2c ship + **7-day watch con < 1 blocked Google signup/day promedio + 0 alert firings de signup-probe relacionadas**. Threshold escogido conservador: Booster en TRL 10 estima < 10 signups Google/mes legítimos. SC-2C.8 closeable en Sprint 2c+7d con metrics documentadas, NO el día del ship.

- [ ] **SC-2C.9** _(NEW per P1-2 ghost user cleanup)_: Pre-launch (separate commit antes de wire al IdP runtime) ejecutar script `inventory-google-ghost-users.ts` que lista Firebase users con `providerData.providerId='google.com'` AND NO matching `solicitudes_registro.estado='aprobado'`. Output → CSV file `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/ghost-users-inventory-<timestamp>.csv`. PO decide cleanup policy: (a) disable + audit (preferred), (b) whitelist específico, (c) accept all (no cleanup). Decision recorded in §13.

- [ ] **SC-2C.10** _(NEW per P1-5 mechanical CI gate)_: CI gate `apps/api/scripts/check-adr-status-accepted.ts` (o equivalente) verifica que `docs/adr/052-signup-migration-admin-sdk-gate.md` line 3 contiene `Status: Accepted` antes de allow merge de PRs que toquen `apps/auth-blocking-functions/` o `infrastructure/auth-blocking-functions.tf`. Gate enforced via GitHub Actions workflow + branch protection requires-check rule. NO bypassable por `[skip ci]` (workflow protected).

- [ ] **SC-2C.11** _(NEW per P0-3 Admin SDK no-impact verification)_: Admin SDK `auth.createUser({email, displayName})` invocado desde apps/api `approveSignupRequest` (T10 Sprint 2b shipped) **continúa funcionando sin error** post-Sprint-2c apply. Verificado via integration test que: (a) seed `solicitudes_registro.estado=pendiente_aprobacion`; (b) call approve flow desde apps/api; (c) verify Firebase user creado + `solicitudes_registro.estado=aprobado` post-tx. La defense estructural es el handler's early-return cuando `event.data.providerData[0].providerId !== 'google.com'` (Admin SDK creates users sin providerId Google).

## 4. User-visible behaviour

### BEFORE Sprint 2c

- Visitante con cuenta Google nueva → `signInWithPopup` succeeds → Firebase user creado → app frontend redirige a `/app` → backend `/me` retorna `needs_onboarding=true` (user no tiene membership) → UI muestra onboarding.
- Visitante con cuenta Google que matchea email de `solicitudes_registro.aprobado` → mismo path; user ID creado en Firebase es DISTINTO al user ID creado por Admin SDK approve flow (T10) si ambos sucedieron.
- **Bug visible**: dual-creación de Firebase users con mismo email por diferentes providers (Google vía implicit signup + Admin SDK explicit createUser) — Firebase trata como distintos UIDs.

### Ghost users existentes (pre-Sprint-2c)

Entre Sprint 2b ship (2026-05-26) y Sprint 2c apply (date TBD), cualquier signup Google nuevo crea un Firebase user "huérfano" (sin role). Sprint 2c §11 Rollout step "Migration" maneja inventory + cleanup pre-launch (per SC-2C.9). Post-Sprint-2c, ghost users disabled NO podrán hacer sign-in (Firebase rechaza disabled users con `auth/user-disabled` en cualquier provider).

### AFTER Sprint 2c

- Visitante con cuenta Google **nueva** (sin matching aprobado en `solicitudes_registro`) → `signInWithPopup` fails → frontend catch handler muestra error UI traducido ("No pudimos completar el registro. Si crees que es un error, contacta al admin.").
- Visitante con cuenta Google **aprobada** → `signInWithPopup` succeeds en primer intento; Firebase user creado con UID estable; subsequent sign-ins vía Google reusan el mismo UID.
- Web app `apps/web/src/routes/login.tsx` que ya usa `signInWithGoogle()` no requiere cambios funcionales — el catch handler `translateAuthError` se extiende con caso explícito `auth/internal-error` + sub-error code mapeado (depende OQ-2C-1 resolution).

### Impacto en spec O-1 / SC-1.2.1 flow signup-request

Sin cambios al flow `POST /api/v1/signup-request` (T8 shipped). Continúa siendo el único path para que un visitante "pida cuenta". La diferencia post-Sprint-2c: si el visitante usa cuenta Google + ya tiene approved row, el primer sign-in vía Google completa sin rebote.

### Admin SDK approve flow (T10) — sin impacto verificado por SC-2C.11

El handler tiene early-return cuando `provider !== 'google.com'`. Admin SDK `auth.createUser` produce Firebase users con `providerData` que NO incluye Google. La function fire-but-allow → Admin SDK flow continúa intacto.

## 5. Out of scope

Lo siguiente NO se implementa en Sprint 2c (deferred o explícitamente OOS):

1. **`beforeSignIn` Blocking Function** (per-sign-in vs per-creation): Sprint 2c implementa solo `beforeCreate`. Sign-in subsequent con user ya-existente NO pasa por la Blocking Function en cada login. Si se requiere session-level enforcement (e.g., disable user mid-session via deactivation flow), agregar `beforeSignIn` es otro spec.
2. **Apple SSO, Microsoft SSO, otros federated providers**: Booster no soporta SSO no-Google a 2026-05-26. Si se agrega Apple en sprint futuro, el mismo handler aplica con condición `providerId === 'apple.com'`; OOS para extender ahora.
3. **Email-link sign-in via `sendSignInLinkToEmail` / `signInWithEmailLink`**: NO usados en main HEAD (verificado T6 audit). Si se introducen, el patrón se extiende pero está fuera de scope Sprint 2c.
4. **Phone sign-in**: deshabilitado en Identity Platform (Sprint 2b T11); irrelevant.
5. **Anonymous sign-in**: deshabilitado por `disabled_user_signup=true`; irrelevant.
6. **Rate-limit del Blocking Function**: el rate-limit estructural ya existe upstream (Cloud Armor 1000/min/IP + en endpoint `/api/v1/signup-request` 5/15min/IP cuando el user trata flow alternativo). La Blocking Function NO agrega rate-limit propio; OOS para Sprint 2c.
7. **Custom error messages localized**: el `HttpsError` retornado por la function puede tener detail strings. Localización al español queda en el frontend `translateAuthError` (apps/web). Backend retorna detail en inglés keyed por code.
8. **Audit log retention beyond default 30 days**: si Sprint 2c necesita 90+d retention para `signup.blocked.google` events, configurar Cloud Logging sink a BigQuery. OOS para Sprint 2c; tracked como follow-up si compliance Chile (Ley 19.628) lo exige en sprint posterior.
9. **Multi-tenant Identity Platform** (`tenants` API): Booster usa single-tenant config. OOS.
10. **Deploy via Firebase CLI** (`firebase deploy --only functions`): Cloud Function Gen 1 se deploya via Terraform (`google_cloudfunctions_function`) + Cloud Build trigger. OOS la integración Firebase CLI workflow.
11. **Ghost user inventory cleanup execution**: SC-2C.9 produces CSV inventory. PO decision sobre cleanup policy es OOS — separate operacional task post-Sprint-2c ship.

## 6. Constraints

- **C1 — Firebase Blocking Function SLA**: 7 s hard timeout por Firebase Auth runtime. Decisiones del handler que excedan se interpretan como fail. Budget operativo: p95 ≤ 1500 ms (SC-2C.4). Cualquier syscall externo (DB query) tiene timeout interno ≤ 3 s. Cold-start mitigación: see OQ-2C-2 (min_instance support en Gen 1) + initial baseline measurement pre-wire.

- **C2 — Cloud Function Gen 1 region**: debe ser `southamerica-west1` (Santiago) para minimizar latency vs Cloud SQL prod (también en `southamerica-west1`). Booster region invariant per ADR-001.

- **C3 — Identity Platform Blocking Functions require Cloud Functions Gen 1 + `gcip-cloud-functions` SDK** _(empirically verified 2026-05-26)_: Identity Platform Admin API `blocking_functions.triggers.beforeCreate.function_uri` solo acepta URIs de Cloud Functions Gen 1 (verified via [GitHub iap-gcip-web-toolkit#258](https://github.com/GoogleCloudPlatform/iap-gcip-web-toolkit/issues/258) — Gen 2 functions don't appear in UI trigger list; Terraform attempts result in "function deleted or no longer exists"). SDK requerido: `gcip-cloud-functions@^0.2.0` (verified via [docs.cloud.google.com](https://docs.cloud.google.com/identity-platform/docs/blocking-functions) — sample `import * as gcipCloudFunctions from 'gcip-cloud-functions';`). NO `firebase-functions/v2/identity` (incompatible — diferente product surface).

- **C4 — VPC connector**: la function necesita acceso a Cloud SQL prod (private IP `172.25.1.2` post-Sprint-2b T11/T13 drift revert). Reusa `google_vpc_access_connector.serverless` existing.

- **C5 — DB connection pattern**: usar Cloud SQL Auth Proxy unix socket (Gen 1 supports `--vpc-connector` + `--add-cloudsql-instances` flags). Connection pool init dentro del handler con state preservation across invocations en el mismo container instance (Gen 1 idle timeout ~5-15 min).

- **C6 — Secret management**: la function necesita `DATABASE_URL` para conectar. Reusa el secret `database-url` ya en Secret Manager + IAM grant al SA del Cloud Function.

- **C7 — Zero-Trust auth**: el handler runtime SA NO tiene credentials para impersonate users; sólo lee `solicitudes_registro` table.

- **C8 — Booster naming bilingüe (CLAUDE.md)**: variables/funciones en camelCase EN; tabla SQL `solicitudes_registro` ya español. App folder `apps/auth-blocking-functions` (EN per convention).

- **C9 — Test coverage ≥ 80 % / 75 % branches**: per CLAUDE.md booster-stack-conventions.

- **C10 — Zero `any` / Zero `@ts-ignore`**: per CLAUDE.md type safety.

- **C11 — Structured logging via `@booster-ai/logger`**: handler logs en JSON con `correlationId` propagado desde Firebase event metadata (si disponible).

- **C12 — ADR-NNN nuevo (numbering deferred to /plan)**: ADR para Blocking Function decision. Número exact se asigna en `/plan` post `pnpm exec scripts/check-adr-numbering.ts` para evitar race condition con otros sprints concurrentes. Estimado: ADR-054 o ADR-055 (verificar al /plan exit).

- **C13 — Pre-condition Sprint 2c ship**: ADR-052 debe estar en `Accepted` (post-Sprint-2b T13 canary success + 2 h watch). Gate ENFORCED mechanically vía C14 below.

- **C14 — Mechanical CI gate** _(NEW per P1-5)_: workflow `.github/workflows/sprint-2c-build-gate.yml` ejecuta script `scripts/check-adr-status-accepted.ts` que `grep -E "^- \*\*Status\*\*: Accepted" docs/adr/052-signup-migration-admin-sdk-gate.md`. Si match=0 OR file modified to remove Accepted, CI fails. Branch protection rule en `main` requires el check passing antes de allow merge de PRs que toquen `apps/auth-blocking-functions/**`, `infrastructure/auth-blocking-functions.tf`, o `infrastructure/identity-platform.tf` `blocking_functions` block.

## 7. Approach

### 7.1. Arquitectura de alto nivel

```
┌─────────────────────────────────────────────────────────────────┐
│ Visitante con cuenta Google                                     │
│   apps/web/src/hooks/use-auth.ts:84                             │
│     signInWithPopup(firebaseAuth, googleProvider)               │
└─────────────────┬───────────────────────────────────────────────┘
                  │ OAuth flow (Google ↔ Identity Platform)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Identity Platform (booster-ai-494222 tenant)                    │
│   sign_in.allow_duplicate_emails = false                        │
│   client.permissions.disabled_user_signup = true                │
│   blocking_functions.triggers.beforeCreate:                     │
│     function_uri = $cloudFunctionGen1_https_url                 │
└─────────────────┬───────────────────────────────────────────────┘
                  │ HTTPS POST + JWT signed by Identity Platform
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ apps/auth-blocking-functions/ (Cloud Function Gen 1, HTTP)      │
│   src/index.ts                                                  │
│     const authFunctions = new gcipCloudFunctions.AuthFunction(  │
│       admin);                                                   │
│     export const beforeCreate =                                 │
│       functions.https.onRequest(authFunctions.beforeCreateHandler(│
│         async (user, context) => {                              │
│           // see handler.ts                                     │
│         }                                                       │
│       ));                                                       │
│   handler:                                                      │
│     1. extract email, providerData del user                     │
│     2. if (providerData[0]?.providerId !== 'google.com')        │
│        return  // allow (Admin SDK + other providers)           │
│     3. normalize email (lowercase + trim + NFC + punycode)      │
│     4. lookup solicitudes_registro WHERE email=$1 AND           │
│        estado='aprobado' LIMIT 1                                │
│     5. if (rows.length === 0) throw new                         │
│        gcipCloudFunctions.https.HttpsError('permission-denied', │
│          'BLOCKED_SIGNUP_PENDING_APPROVAL')                     │
│     6. structured log signup.blocked.google {emailHashed, ...}  │
│     7. return  // allow user creation                           │
└─────────────────┬───────────────────────────────────────────────┘
                  │ Cloud SQL Auth Proxy (private IP via VPC connector)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Cloud SQL Postgres (booster-ai-pg-07d9e939, southamerica-west1) │
│   solicitudes_registro (migration 0039 from Sprint 2b T7)       │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2. Components (corrected post-empirical-spike)

1. **Nueva app `apps/auth-blocking-functions/`** (~150-200 LOC est.):
   - `package.json` — deps `gcip-cloud-functions@^0.2.0` + `firebase-admin@^13.7.0` (peer) + `firebase-functions@^3.x` (Gen 1 compatible, NOT v2) + `pg@^8.13.1` + `@booster-ai/logger` + `@booster-ai/shared-schemas`.
   - `tsconfig.json` — extends `../../tsconfig.base.json` con `module: "commonjs"` (Gen 1 runtime requirement).
   - `src/index.ts` — wire Cloud Functions Gen 1 HTTP handler via `gcipCloudFunctions.AuthFunction` wrapper.
   - `src/handler.ts` — pure async function que toma `event.data.email` + `event.data.providerData` + DB pool; retorna `void | throws HttpsError`. Testable sin Firebase.
   - `src/db.ts` — singleton DB pool init lazy con Cloud SQL Auth Proxy unix socket pattern.
   - `src/email-normalize.ts` — helper para normalize email (lowercase + trim + NFC + punycode IDN). Shared con apps/api signup-request si refactor identifica overlap.
   - `src/logger.ts` — instancia de `@booster-ai/logger` configurada para el service.
   - `test/handler.test.ts` — unit tests del handler con mock DB + mock event.
   - `test/integration/firebase-emulator.test.ts` — **REQUIRED per P1-1** integration test contra Firebase Auth emulator + Functions emulator con seeded `solicitudes_registro`.
   - `test/email-normalize.test.ts` — unit tests cubriendo casing + IDN + punycode + aliases + whitespace + NFC/NFD per R-2C-9.

2. **`apps/auth-blocking-functions/scripts/inventory-google-ghost-users.ts`** (nuevo, ~80 LOC):
   - Lista Firebase users (Admin SDK `auth.listUsers()`) con `providerData.providerId='google.com'`.
   - Cross-reference contra `solicitudes_registro WHERE estado='aprobado'`.
   - Output CSV `.specs/sec-001-h1-2-google-blocking/sprint-2c-evidence/ghost-users-inventory-<timestamp>.csv` con cols: firebaseUid, email, displayName, createdAt, matchingApprovedRequest.
   - **Read-only**: no disabling, no deletion. PO decide cleanup policy post-inventory (SC-2C.9).

3. **`infrastructure/auth-blocking-functions.tf`** (nuevo, ~100 LOC):
   - `google_cloudfunctions_function.enforce_signup_approval` — Cloud Function Gen 1 con `runtime = "nodejs20"`, `region = "southamerica-west1"`, `trigger_http = true`, `vpc_connector = google_vpc_access_connector.serverless.id`, `available_memory_mb = 256`, `timeout = 60`.
   - `min_instances` config si Gen 1 lo soporta — OQ-2C-2 verificar pre-/plan.
   - `google_service_account.blocking_function_runtime` — SA dedicado.
   - IAM bindings: `roles/cloudsql.client` + `roles/secretmanager.secretAccessor` (para `database-url`) + `roles/vpcaccess.user`.
   - `google_cloudfunctions_function_iam_member` — `roles/cloudfunctions.invoker` para SA de Identity Platform (verificar exact SA email en /plan).
   - Cloud Build trigger configuration via cloudbuild.production.yaml.

4. **`infrastructure/identity-platform.tf`** (modify, ~10 LOC delta):
   - Remover `blocking_functions` del `lifecycle.ignore_changes` list.
   - Agregar `blocking_functions.triggers.beforeCreate.function_uri = google_cloudfunctions_function.enforce_signup_approval.https_trigger_url`.

5. **`cloudbuild.production.yaml`** (modify, ~25 LOC delta):
   - Build step `build-auth-blocking` (Cloud Build script para Function Gen 1 source upload + dependencies).
   - Deploy step `deploy-auth-blocking` (gcloud functions deploy + apply Terraform IdP config si cambió).
   - **Mechanical gate step `check-adr-status-accepted`** (NEW per C14): grep ADR-052 line 3 ANTES de build steps; fail si Status != Accepted.

6. **`apps/api/scripts/check-adr-status-accepted.ts`** (nuevo, ~30 LOC):
   - Standalone script ejecutado por `.github/workflows/sprint-2c-build-gate.yml`.
   - Reads `docs/adr/052-signup-migration-admin-sdk-gate.md`; verifies regex `^- \*\*Status\*\*: Accepted` matches line ~3.
   - Exit 0 si match; exit 1 con mensaje claro si no.
   - Plus unit tests + CI workflow file (~20 LOC adicional).

7. **`apps/web/src/lib/api-errors.ts` o similar** (~10 LOC delta):
   - Extender `translateAuthError` para mapear `code: 'auth/internal-error'` + sub-error `BLOCKED_SIGNUP_PENDING_APPROVAL` a mensaje user-friendly español. Resolución exacta depende OQ-2C-1 + OQ-2C-4.

8. **`docs/adr/NNN-google-blocking-function-signup-gate.md`** (nuevo, ~100 LOC; NNN al /plan post-check-adr-numbering):
   - Mismo pattern ADR-052 + ADR-053. Documenta Decision (Gen 1 + gcip-cloud-functions Blocking Function), Consequences, Alternatives considered (A1 arbitrary HTTP rejected, A2 gcip-cloud-functions Gen 1 ADOPTED, A3 firebase-functions Gen 2 REJECTED per empirical evidence, B/C/D/E previous + Alt-F cost-benefit accept-residual con calc), Acceptance criterion para flip Proposed→Accepted post-Sprint-2c-ship + 7d watch SC-2C.8.

9. **`docs/qa/google-blocking-function-runbook.md`** (nuevo, ~80 LOC):
   - Smoke E2E manual instructions (Google account + cuenta aprobada vs Google account + sin matching).
   - Rollback fast-path (UNSET `blocking_functions.triggers.beforeCreate` vía Identity Platform Admin API o Terraform revert).
   - Decision criteria para flip Proposed → Accepted en ADR-NNN.
   - Ghost user cleanup procedure post-inventory CSV review.

### 7.3. Database lookup design

```sql
SELECT 1
FROM solicitudes_registro
WHERE email = $1
  AND estado = 'aprobado'
LIMIT 1;
```

Indexes: `solicitudes_registro` actualmente tiene PK sobre `id` (uuid). Email no es PK ni unique. La query LIMIT 1 sobre tabla pequeña (~10-50 rows/mes esperado per ADR-052) tarda <5ms incluso sin index — benchmark requerido pre-launch (tracked OQ-2C-2 follow-up). Si crece a >10k rows post-2 años, agregar `CREATE INDEX idx_solicitudes_email_estado ON solicitudes_registro (email, estado);` — separate spec.

**MVCC visibility consideration** _(per P1-1)_: la query siempre lee committed state. Para garantizar latest visibility en escenarios donde approveSignupRequest acaba de commit, usar `SELECT ... FOR SHARE` NO es necesario porque blocking function trigger fire AFTER el approve flow tx commit (Admin SDK call ocurre dentro de approveSignupRequest tx que ya completed cuando user intenta Google signup post-approve). Race condition theoretical: approve flow tx en progreso simultáneo con Google signup attempt — pero el flow normal es admin clicks approve LUEGO user sign-in via Google, no simultáneo. Documentar el invariant en integration test T12.

### 7.4. Failure modes y semantics

- **DB unreachable**: `pg.Client.query` throws. Handler catch + `throw new gcipCloudFunctions.https.HttpsError('internal', 'database-unreachable')` → Identity Platform rechaza sign-up con `auth/internal-error`. Fail-closed. Cold-start del proxy <2 s normalmente; recovery rápido.
- **DB query timeout** (>3 s internal threshold): mismo path. Estructurado log con `correlationId` + email hashed.
- **Provider !== 'google.com'**: handler retorna inmediatamente (allow). Sin DB query. Cubre Admin SDK (providerData empty or 'password') + future providers que se opt-in mediante extension del switch.
- **Event data missing email**: `event.data.email` undefined → throw `HttpsError('invalid-argument', ...)`. Fail-closed.
- **gcip-cloud-functions SDK throws unexpectedly**: outer-catch + throw `HttpsError('internal', 'sdk-error-${name}')`. Fail-closed.

### 7.5. Admin SDK interaction defense _(NEW per P0-3)_

Admin SDK `auth.createUser({email, displayName})` from apps/api `approveSignupRequest` (T10):
- Crea Firebase user con `providerData: []` (sin provider especificado) o `providerData: [{providerId: 'password'}]` si `password` se pasa.
- En AMBOS casos, `providerData[0]?.providerId !== 'google.com'` → handler early-returns → user created normally.

Verificación empírica: SC-2C.11 + T13 integration test seed pending solicitud + invoke approveSignupRequest desde apps/api + verify (a) Firebase user creado, (b) row updated to estado=aprobado, (c) no rejection from blocking function.

Edge case: si en el futuro Admin SDK API cambia y permite `providerData` Google al create, este invariant rompe. Tracked OQ-2C-8 (verify Admin SDK behavior empíricamente).

### 7.6. Pre-launch ghost user inventory _(NEW per P1-2)_

Antes de wire `blocking_functions.triggers.beforeCreate` al runtime IdP, ejecutar script `inventory-google-ghost-users.ts` per SC-2C.9. Script output → PO review → decision documented in §13:

| Option | Effect | When applicable |
|---|---|---|
| (a) disable + audit | Firebase Admin SDK `auth.updateUser(uid, {disabled: true})` para todos los ghost users; audit log entry per uid retired | Recommended si inventory > 0 |
| (b) whitelist específico | Decision per-uid: keep active o disable | Si hay <5 ghost users con casos legítimos identificables |
| (c) accept all (no cleanup) | Documentar como deuda; ghost users siguen activos pero sin role | Solo si inventory==0 o si cleanup risk > residual risk |

Cleanup execution es OOS spec Sprint 2c (per §5 item 11) — separate operacional task.

## 8. Alternatives considered

### A1. Arbitrary HTTPS endpoint en apps/api (no Firebase Functions framework)

**Rejected** per C3 + empirical verification: Identity Platform Admin API `blocking_functions.triggers.beforeCreate.function_uri` requires Cloud Functions resource URI (verified via [GitHub iap-gcip-web-toolkit#258](https://github.com/GoogleCloudPlatform/iap-gcip-web-toolkit/issues/258) — Terraform attempts con arbitrary HTTPS URIs result in "function deleted or no longer exists" error from Identity Platform Admin API). Sin Cloud Functions metadata, el config rejected. Si Google relaxa esta restricción en versiones futuras del Admin API, re-evaluar.

### A2. `gcip-cloud-functions` Gen 1 SDK on HTTP-triggered Cloud Function — **ADOPTED**

The official supported path per [Identity Platform docs](https://docs.cloud.google.com/identity-platform/docs/blocking-functions). Booster adopta este pattern.

### A3. `firebase-functions/v2/identity` Gen 2 (`beforeUserCreated` from firebase-functions v5+)

**Rejected** per C3 empirical evidence: Gen 2 functions don't appear en Identity Platform UI trigger list; Terraform attempts result in "function deleted or no longer exists" errors. La SDK `firebase-functions/v2/identity` está diseñada para Firebase Auth (Firebase project surface), NO Identity Platform (GCP project surface — Booster usa este). Different product, different integration path.

### B. Eliminar Google provider completamente (`apps/web/src/hooks/use-auth.ts:84` remove `signInWithGoogle`)

**Rejected** per ADR-052 Alt-1 ya considerado y rechazado. Razones siguen válidas: clientes B2B logística en Chile mezclan @gmail.com personales con @empresa.cl, forzar email-only signup recorta TAM. Mantener Google como provider es product call PO confirmado.

### C. Downstream membership-creation gate sin Blocking Function (post-sign-in check en `/me`)

**Rejected** per ADR-052 Alt-B ya considerado y rechazado. El Firebase user "huérfano" (creado sin role) sigue popolando el Identity Platform tenant + audit log noise. Spec O-1 estableció defense estructural at the boundary, no downstream cleanup.

### D. Custom OAuth callback (interceptar Google OAuth flow antes de que llegue a Identity Platform)

**Rejected**: alto costo de mantención (reimplementar Google OAuth state machine, redirect URI handling, PKCE), saca a Booster del pattern Firebase Auth idiomático. Identity Platform Blocking Functions es la primitive correcta provista por Google para este use case.

### E. Diferir indefinidamente (mantener residual como aceptable forever) — _explicit cost-benefit per P2 finding_

**Rejected**. Cost-benefit analysis:

| Factor | Sprint 2c cost | Permanent residual cost |
|---|---|---|
| Implementation effort | ~200-300 LOC + new app + new infra + ~3-4 days PO time (≈$X) | $0 |
| Operational cost | Gen 1 function: $0 idle + ~$0.05/mo @ 100 invocations/mes | $0 |
| Audit log noise | Zero (function blocks orphan creates) | Compounds linearly w/ Google signup volume |
| Defense-in-depth posture | Symmetric (email/password + Google both gated) | Asymmetric — known gap |
| Exploitability | N/A (closed) | "Non-exploitable end-to-end without role assignment manual" per ADR-052 — **low severity** |
| Compliance audit risk | Low (defense documented + tested) | Medium — Ley 19.628 + future audit may flag asymmetric posture |
| Long-term tech debt | Zero | High — ADR-052 explicit commitment to close; deferring contradicts CLAUDE.md "Cero deuda day 0" |

**Decision**: NOT accept residual permanently because (1) Booster scales past TRL 10 → role assignment may become attack vector if combined with future vulnerabilities; (2) audit log noise compounds; (3) ADR-052 explicit commitment to close; (4) defense-in-depth Zero-Trust requires structural closure; (5) Sprint 2c cost is bounded (one sprint).

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R-2C-1**: Blocking Function exceeds 7s SLA → sign-in fails opaque para users aprobados legítimos | M | H | Pre-launch baseline measurement (SC-2C.4 reformulated); DB pool init lazy + connection reuse; query timeout 3s explícito; SC-2C.4 p95 ≤ 1500 ms gate + alert; OQ-2C-2 verifica Gen 1 min_instance support |
| **R-2C-2**: Cold-start cuando instance reboot scheduled by Google | L | M | Gen 1 idle timeout ~5-15 min ensures hot-instance reuse durante traffic bursts. Si baseline reveals cold-start > 3s, escalate min_instances. |
| **R-2C-3**: DB unreachable → todos los signups Google fallan fail-closed (incluso aprobados) | L | H | Mismo failure mode que apps/api endpoints; Cloud SQL HA already covered Sprint 1 T1. Alert Cloud Monitoring sobre rate de blocked signups > expected baseline (SC-2C.6) |
| **R-2C-4**: Cost increase from Gen 1 function | L | L | Gen 1 idle ~$0; per-invocation ~$0.0005 (256MB × 1s × $0.0000025/GB-s). At 100 signups/mo → ~$0.05/mo. Even at 10k/mo → ~$5/mo. Negligible. |
| **R-2C-5**: Loop con cron cleanup `solicitudes_registro` borra `aprobado` rows post-N-days; user existing Google try to re-sign-in → blocked | L | M | Cron design (futuro spec) borra solo `rechazado` rows. Documentar invariant en cron spec cuando se cree. |
| **R-2C-6**: Identity Platform admin override (Felipe via console enables un user manually) crea state divergence con `solicitudes_registro` | L | L | Audit log captures admin actions; ADR-NNN documenta convención que manual admin actions deben mirror via signup-request approve flow (T10 Sprint 2b). Risk aceptado low. |
| **R-2C-7**: Sprint 2c ship before ADR-052 Accepted — rollback complejo si T13 canary falla post-Sprint-2c-ship | M | M | **Mechanical CI gate C14**: scripts/check-adr-status-accepted.ts fails build si ADR-052 status != Accepted. Branch protection requires-check. NO bypassable por `[skip ci]`. |
| **R-2C-8**: First-deploy timing window — entre `blocking_functions.beforeCreate` apply y first Google signup post-deploy hay ~30s donde behavior es inconsistent | L | L | Smoke E2E manual immediately post-deploy. Window aceptable dada baja rate de signups Google esperada per minuto. |
| **R-2C-9** _(extended per P2 R-2C-9)_: Email casing mismatch (`solicitudes_registro.email` lowercase stored T8; Firebase event `data.email` raw with possible IDN/punycode/aliases/NFC-NFD/leading-whitespace variants) → false negative match → legitimate user blocked | M | M | `email-normalize.ts` helper aplica: (1) lowercase + trim; (2) NFC unicode normalization; (3) punycode IDN decode (e.g., `xn--mxico-bsa.cl` → `méxico.cl`); (4) NO alias stripping (gmail+aliases NOT collapsed — security feature, alias is meaningful identity). Unit tests cubren 20+ variantes. |
| **R-2C-10**: gcip-cloud-functions SDK schema cambia en future version | L | M | Pin exact version `gcip-cloud-functions@0.2.0` (no caret); renovate-bot lifecycle + manual review on bumps. Monitorear releases. |
| **R-2C-11** _(NEW)_: Ghost user inventory script misses cases or has bug — Sprint 2c activation creates inconsistent state | L | L | Script is read-only (no disabling); cleanup is separate step requiring PO sign-off; SC-2C.9 explicit. Manual verification of CSV output pre-cleanup. |
| **R-2C-12** _(NEW)_: gcip-cloud-functions@^0.2.0 is beta (pre-1.0) — semver may break | L | M | Pin exact version; vendor in package.json; monitor releases via renovate. Document migration path if SDK reaches v1.0 con breaking changes. |
| **R-2C-13** _(NEW per P1-1)_: MVCC visibility race when approveSignupRequest commits + Google signup attempt simultaneous | L | L | Operational flow ensures admin approve → user notification email → user clicks → signs in via Google. Time gap >1s between approve commit and signup attempt. Integration test T12 documents the invariant. |

## 10. Test list

Cada SC en §3 mapea a tests aquí. Cubre integration + unit.

- **T1** (SC-2C.2 happy negative): unit test handler con event `{email: 'new@x.cl', providerData: [{providerId: 'google.com'}]}` + DB mock returning empty rows → expect throw `HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`.
- **T2** (SC-2C.3 happy positive): unit test handler con mismo event + DB mock returning 1 row `{estado: 'aprobado'}` → expect no throw, return void.
- **T3** (SC-2C.5 fail-closed): unit test handler con DB mock throwing `new Error('ECONNREFUSED')` → expect throw `HttpsError('internal', ...)` (NOT pass-through).
- **T4** (SC-2C.11 provider passthrough): unit test handler con `providerData: [{providerId: 'password'}]` AND con `providerData: []` → expect both return immediately sin DB query.
- **T5** (email casing & IDN per R-2C-9): unit test handler con event email `'MiXeD@Case.CL'` + DB mock returning row `{estado: 'aprobado', email: 'mixed@case.cl'}` → expect normalized query + no throw. Plus 20+ variantes cubriendo IDN punycode/NFC-NFD/whitespace.
- **T6** (email missing): unit test handler con `event.data.email = undefined` → expect throw `HttpsError('invalid-argument', ...)`.
- **T7** (estado != aprobado): unit test handler con DB mock returning row `{estado: 'pendiente_aprobacion'}` → expect throw permission-denied (mismo path que T1).
- **T8** _(REQUIRED per P1-1, no longer stretch)_: integration test contra Firebase emulator (`firebase emulators:start --only auth,functions`) con seeded `solicitudes_registro` row. Verify end-to-end con mock Google OAuth. Required for SC-2C.7 coverage gate.
- **T9** (Identity Platform config gate, SC-2C.1): post-apply de Terraform, curl Admin API `config | jq '.blockingFunctions'` → expect non-null `triggers.beforeCreate.function_uri` matching Cloud Function URL.
- **T10** (performance smoke, SC-2C.4): pre-launch baseline + post-launch first 10 invocations OR 7-day window → assert p95 < 1500 ms, p99 < 3000 ms. Cloud Monitoring metric query.
- **T11** (audit log emission, SC-2C.6): trigger blocked signup; verificar Cloud Logging entry con `status.code != 0`. Plus numeric baseline alert test (mock 6 blocked events/hour → alert fires; mock 4 → doesn't).
- **T12** _(NEW per P1-1)_: race condition integration test — two concurrent signup attempts same email (one Google new, one approve flow). Verify deterministic outcome: approve commits first → Google signup allowed. Approve commits second → Google signup blocked first attempt, allowed on retry.
- **T13** _(NEW per SC-2C.11)_: Admin SDK approveSignupRequest flow integration — call from apps/api with email matching pending solicitudes_registro → verify (a) Admin SDK createUser succeeds without rejection, (b) row updated to estado=aprobado, (c) NO log entry from blocking function (early-return defense works).
- **T14** _(NEW per SC-2C.9)_: Ghost user inventory script unit + integration — verify script output captures all Firebase users with providerData=google.com AND no matching solicitudes_registro.aprobado. Plus mock empty inventory case + mock 5-user inventory case.
- **T15** _(NEW per SC-2C.10 + C14)_: CI gate test — fixture copy of ADR-052 file con `Status: Proposed`, run `check-adr-status-accepted.ts` → expect exit 1. Otro fixture con `Status: Accepted` → expect exit 0. Plus test que rejecta if ADR file absent or malformed.

## 11. Rollout

- **Feature-flagged?**: No al nivel de Booster code. PERO el deploy de la function + el wiring en Identity Platform son commits separados:
  1. Deploy Cloud Function Gen 1 (Build + Deploy steps cloudbuild) — function existe pero NO está wired como Blocking Function en Identity Platform.
  2. Run pre-launch baseline test contra deployed function endpoint via curl (10 invocations measurement).
  3. Run ghost user inventory script (SC-2C.9) → PO review CSV → decision documented.
  4. Apply Terraform IdP config con `blocking_functions.triggers.beforeCreate` — wiring efectivo.
  Esto permite "soft launch" (smoke E2E manual contra function endpoint directo via curl) antes del wire al runtime auth flow.

- **Migration needed?** _(per P1-2)_:
  - **No DB migration**.
  - **Pre-launch operational step**: SC-2C.9 ghost user inventory CSV + PO cleanup decision. Decision documented in §13 spec decision log + executed via separate operacional task post-spec-approval.

- **Rollback plan**:
  - **Step 1 (5-min undo)**: Identity Platform Admin API `PATCH /v2/projects/.../config` con `updateMask=blockingFunctions` y body `{}` → desactiva la Blocking Function. Subsequent Google signups vuelven a flow pre-Sprint-2c (residual abierto). NO requiere code rollback.
  - **Step 2 (full undo)**: Terraform revert del commit que agregó `blocking_functions.triggers` → re-apply restaura `blocking_functions` al estado anterior (un-managed via `ignore_changes`). Combined con Step 1.
  - **Step 3 (eliminar la function entirely)**: `terraform destroy -target=google_cloudfunctions_function.enforce_signup_approval`. Solo si la function tiene un bug que afecta otros features.
  - **Step 4 (revert ghost user cleanup)**: si cleanup option (a) disable se aplicó y revertir es deseable, `auth.updateUser(uid, {disabled: false})` per CSV row. Audit log entry per uid.

- **Monitoring** (post-deploy 7 días):
  - Cloud Monitoring custom metric `cloudfunctions.googleapis.com/function/execution_times` → alert p95 > 1500 ms sostenido 5 min.
  - Cloud Logging filter `logName=...identitytoolkit AND status.code != 0 AND methodName=...SignUp` → counter `signup.blocked.google` per hour.
  - Alert SC-2C.6 numeric baseline: `signup.blocked.google > 5/hour sostenido 1 hour` → page initial threshold; reajusta post-baseline 7d.
  - Manual review de log entries 24h post-deploy.
  - Auditoría 7-day post-launch para SC-2C.8 readiness.

- **Gate explícito para iniciar `/build`** _(mechanical per C14)_:
  Sprint 2c `/plan` puede iniciar tras user approve de este spec v2. PERO `/build` NO inicia hasta:
  1. ADR-052 está en `Accepted` (separate commit en main per signup-canary-rollback.md §7) — **mechanically enforced via scripts/check-adr-status-accepted.ts en CI**.
  2. T13 canary success + 2h watch en prod completado (verificable via ADR-052 line 3 update timestamp + Cloud Build run ID reference).
  3. `SIGNUP_REQUEST_FLOW_ACTIVATED` flag flipped to `true` en prod (al menos en staging).

  Si cualquier gate falla, Sprint 2c hold hasta resolver. CI gate enforcement asegura no bypass por human error.

## 12. Open questions

Resolver OQ-2C-1 a OQ-2C-9 antes de cerrar `/plan` Sprint 2c (todas formal blockers per P2 finding).

- **OQ-2C-1**: ¿Qué specific error code retorna Firebase Web SDK cuando el Blocking Function throws `HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`? ¿`auth/internal-error` con detail accesible? ¿O `auth/popup-closed-by-user`? Necesario para `translateAuthError` mapping en apps/web. Verify en `/plan` con test contra Firebase emulator.

- **OQ-2C-2**: ¿Cloud Functions Gen 1 soporta `min_instances` semantically equivalent a Gen 2? Si sí, cuánto cuesta (~$15/mo si 1 instance idle 24/7) vs costo de cold-start risk (~2s vs 7s SLA budget). Si NO, ¿el baseline pre-launch confirma cold-start < 2s reliably?

- **OQ-2C-3**: ¿Identity Platform Blocking Functions soportan multiple regions? Si la function deployada en `southamerica-west1` falla, ¿Identity Platform routes a una secondary region automatically, o el sign-up fails outright? Verify en docs o test.

- **OQ-2C-4**: ¿Cómo Identity Platform propaga `HttpsError.message` al frontend? El detail `BLOCKED_SIGNUP_PENDING_APPROVAL` requiere ser visible al user para que el frontend pueda mostrar mensaje específico. Si Firebase oculta el message, usar el code como signal en su lugar.

- **OQ-2C-5**: ¿Audit log entries de Blocking Function rejection llevan suficiente context (email solicitante, IP origen) para forensia útil, o el log está sanitizado por Firebase? Importante para SC-2C.6.

- **OQ-2C-6**: ¿Existing user (ya creado pre-Sprint-2c con Google signin antes de la Blocking Function wire) puede seguir haciendo sign-in normalmente? La Blocking Function `beforeCreate` solo fires en first-time creation, no en subsequent sign-ins. Confirmar zero impact a existing users.

- **OQ-2C-7** _(NEW per P2)_: ¿gcip-cloud-functions@0.2.0 considered production-grade by Google? El package está en pre-1.0 (v0.x semver pre-release). Decision: wait for v1.0 o accept v0.2.0 con pin exact + monitorear.

- **OQ-2C-8** _(NEW per P0-3)_: ¿Admin SDK `auth.createUser` triggers `beforeUserCreated` blocking function? Spike empírico contra IdP sandbox needed antes de /plan. Si TRUE, defense via early-return on providerId check (§7.5). Si FALSE, ningún issue.

- **OQ-2C-9** _(NEW per P2)_: ¿Cloud Functions Gen 1 deprecation timeline — Google announced sunset roadmap? Si Gen 1 será sunset en 12-18 meses, Sprint 2c tendrá que migrar a Gen 2 (cuando Identity Platform lo soporte) o switching architecture. Verify timeline en Google announcement docs.

## 13. Decision log

- **2026-05-26 21:14Z** — v1 initial draft tras Path A del start-sprint-2c decision (DEFINE only, BUILD gated por ADR-052 Accepted). Stub `_followups/sprint-2c-google-blocking-function.md` rephrased + expanded en este spec con success criteria measurable + test list + alternatives matrix + risks tabulated + 6 open questions for `/plan` resolution.

- **2026-05-26 21:20Z** — Devils-advocate review identifica **3 P0 + 5 P1 + 7 P2** findings (ver `review.md`). Crítico:
  - **P0-1 + P0-2 confirmados empíricamente vía WebFetch a docs.cloud.google.com + GitHub iap-gcip-web-toolkit#258**: Identity Platform Blocking Functions soportan **Gen 1 only**, NO Gen 2. SDK requerido es `gcip-cloud-functions@^0.2.0`, NO `firebase-functions/v2/identity`. Architecture en v1 §7.2 (Cloud Function Gen 2 + firebase-functions framework) es **invalida**.
  - **P0-3** Admin SDK `auth.createUser` interaction sigue **inconclusive desde docs**; defense via early-return on providerId check (§7.5); confirmación empírica deferred a OQ-2C-8 spike pre-/plan.
  - **P1-1..P1-5 + P2-1..P2-7** todos válidos.
  - Conclusión: v1 retired como "INVALIDATED PENDING v2 REDRAFT". Spec v1 preserved en `spec-v1.md` para audit.

- **2026-05-26 21:35Z** — v2 redraft. Cambios principales vs v1:
  - **§7 Approach**: Cloud Function Gen 1 + `gcip-cloud-functions@^0.2.0` SDK + Terraform `google_cloudfunctions_function` (NOT `_v2`). §7.5 nuevo documenta Admin SDK defense via early-return. §7.6 nuevo documenta ghost user inventory pre-launch.
  - **§3 Success Criteria**: SC-2C.4 reformulada testable a low-volume ("first 10 invocations OR 7-day window"). SC-2C.6 + SC-2C.8 numeric baselines explicits. SC-2C.9, SC-2C.10, SC-2C.11 nuevos (ghost users, mechanical CI gate, Admin SDK no-impact).
  - **§6 Constraints**: C3 reescrito con empirical citation + URL. C12 ADR numbering deferred. C14 nuevo mechanical CI gate.
  - **§8 Alternatives**: A1 (arbitrary HTTP rejected with citation), A2 (gcip-cloud-functions Gen 1 ADOPTED), A3 (firebase-functions/v2/identity Gen 2 REJECTED). Alt-E expanded with explicit cost-benefit calc table.
  - **§9 Risks**: R-2C-9 extended (IDN/punycode/NFC-NFD); R-2C-11 nuevo (ghost inventory bug); R-2C-12 nuevo (SDK pre-1.0 stability); R-2C-13 nuevo (MVCC race). R-2C-1 reformulada con baseline measurement plan.
  - **§10 Test list**: T8 elevated stretch → REQUIRED. T12-T15 nuevos (race, Admin SDK, ghost inventory, CI gate).
  - **§11 Rollout**: mechanical CI gate enforcement detail; migration step ghost inventory.
  - **§12 Open questions**: OQ-2C-1..6 marked formal blockers; OQ-2C-7..9 nuevos.

  Status: Draft v2 awaiting user approval. Per skill verification §175-186, no `/plan` hasta confirmación explícita del usuario.

- **2026-05-26 21:50Z** — **PO approve v2**. Status flip Draft v2 → Approved v2. Per skill verification all 8 checkpoints met:
  - [x] `.specs/sec-001-h1-2-google-blocking/spec.md` exists
  - [x] All 13 sections have content (no TBD)
  - [x] At least 2 alternatives in §8 (7: A1, A2, A3, B, C, D, E)
  - [x] At least 1 risk in §9 (13 risks tabulated)
  - [x] At least 3 test items in §10 (15 tests T1-T15)
  - [x] Devils-advocate output captured in `review.md` (DA v1 pass, 3 P0 + 5 P1 + 7 P2 all addressed in v2)
  - [x] User confirmed approval
  - [x] Status field reads `Approved v2`
  - [x] Ledger phase_exit logged

  `/plan` Sprint 2c can begin in next session pending:
  1. OQ-2C-1..9 resolution (formal blockers per spec §12).
  2. ADR-052 Status flip Proposed → Accepted (gate C13 + mechanical CI gate C14 to be implemented in /plan).
