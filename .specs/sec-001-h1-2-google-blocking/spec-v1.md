# Spec: sec-001-h1-2-google-blocking

- **Author**: Felipe Vicencio (with agent-rigor)
- **Date**: 2026-05-26
- **Status**: **Draft v1 — INVALIDATED PENDING v2 REDRAFT** (post devils-advocate review + empirical spike 2026-05-26; ver `review.md` + §13 decision log).
- **Linked**:
  - Parent spec: [`.specs/sec-001-cierre/spec.md`](../sec-001-cierre/spec.md) §3 H1.2 SC-1.2.2 amendment A3 v3.4 (Google leg TRACKED_RESIDUAL).
  - Predecessor ADR: [`docs/adr/052-signup-migration-admin-sdk-gate.md`](../../docs/adr/052-signup-migration-admin-sdk-gate.md) (Status: Proposed; transición a Accepted post-T13 canary success + 2 h watch).
  - Stub original: [`.specs/_followups/sprint-2c-google-blocking-function.md`](../_followups/sprint-2c-google-blocking-function.md).
  - Sprint precedent: Sprint 2b PR2 (12 PRs `dcfb588`..`0a6fd1f` shipped 2026-05-26).
  - External docs: [Firebase Auth Blocking Functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions), [Identity Platform Admin API §Config.blocking_functions](https://cloud.google.com/identity-platform/docs/reference/rest/v2/Config#blockingfunctionsconfig).

## 1. Objective

Cerrar el residual `signInWithPopup(firebaseAuth, googleProvider)` self-signup que permaneció OPEN tras Sprint 2b T11 apply, implementando una Firebase Auth Blocking Function (`beforeUserCreated`) que rechaza la creación de un Firebase user vía OAuth federated (inicialmente Google) si no existe una matching `solicitudes_registro.estado=aprobado` para ese email. Restaura el invariante de SC-1.2.2 ("Identity Platform sign-up disabled, todos los providers") cumpliendo el patrón admin-approval gate establecido por ADR-052 también para el camino Google.

## 2. Why now

- **Riesgo residual aceptado en Sprint 2b ahora cierra**: ADR-052 §Riesgo residual R-DA-GOOGLE-OPEN documentó esto como deuda explícita; el spec hermano (este) es el cierre planificado.
- **Defense-in-depth Zero-Trust**: Booster aplica admin-approval gate en email/password (Sprint 2b); dejar Google como bypass crea una asymmetric attack surface — un atacante con cuenta Google nueva crea Firebase user "huérfano" (sin role) que pollutea el tenant + audit log.
- **Pre-requisito completado**: Sprint 2b PR2 ✅ shipped 2026-05-26 (12 PRs + 3 terraform apply + drift resuelto). ADR-052 está en `Proposed` y se espera flip a `Accepted` post-canary success — sin embargo este spec puede DEFINIR-se ahora (no ejecutar BUILD hasta que ADR-052 esté Accepted, gate documentado en §11 Rollout).

## 3. Success criteria

- [ ] **SC-2C.1**: Identity Platform config production tiene `blocking_functions.triggers.beforeCreate` apuntando al Cloud Function (Gen 2) que implementa el handler. Verificable vía `curl -s "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.blockingFunctions'`.

- [ ] **SC-2C.2**: Cuando un visitante anónimo invoca `signInWithPopup(firebaseAuth, googleProvider)` con cuenta Google **nueva** (no presente en `usuarios`), el flow OAuth completa contra Google pero `signInWithPopup` retorna error con `code: 'auth/internal-error'` (o sub-error específico de Blocking Function rejection per Firebase docs); **NO** se crea row en Identity Platform tenant. Verificable vía smoke E2E manual + integration test contra Firebase emulator.

- [ ] **SC-2C.3**: Cuando un visitante anónimo invoca `signInWithPopup(firebaseAuth, googleProvider)` con cuenta Google que tiene matching `solicitudes_registro.estado='aprobado'` para el mismo email, el flow OAuth completa y el Firebase user se crea normalmente. Sign-in subsequent vía Google funciona. Verificable vía smoke E2E manual con cuenta aprobada de prueba.

- [ ] **SC-2C.4**: Blocking Function completa la decisión (lookup DB → return allow|deny) en **p95 < 1500 ms, p99 < 3000 ms** sobre las primeras 100 invocaciones reales post-deploy. Threshold inferior al SLA Firebase 7s; budget para cold-start + DB query + network. Verificable vía Cloud Monitoring metric `cloudfunctions.googleapis.com/function/execution_times`.

- [ ] **SC-2C.5**: Si la Blocking Function arroja error inesperado (DB unreachable, timeout, exception no-catched), la implementación retorna `HttpsError('internal', '...')` lo que Firebase Auth interpreta como **fail-closed** (sign-up bloqueado). NO fail-open. Verificable vía integration test con DB mockeada arrojando.

- [ ] **SC-2C.6**: Identity Platform audit log emite entry `cloudaudit.googleapis.com/data_access` con `methodName="google.cloud.identitytoolkit.v1.AuthenticationService.SignUp"` + `status.code != 0` para cada intento de signup Google bloqueado. Permite alerting Cloud Monitoring sobre rate de blocked Google signups (señal de attack o UX confusion). Verificable post-deploy via filter en Cloud Logging.

- [ ] **SC-2C.7**: Cobertura de tests del handler ≥ 80 % lines / 75 % branches per CLAUDE.md booster-stack-conventions. Cubre: happy approved, rejected not-found, rejected wrong-estado, DB throw fail-closed, non-Google provider passthrough.

- [ ] **SC-2C.8**: Spec hermano `sec-001-cierre/spec.md` §3 SC-1.2.2 amendment A3 transiciona de `TRACKED_RESIDUAL` a `MET` mediante separate commit post-Sprint-2c ship + 7-day watch sin matches en `signup.blocked.google` alert que indiquen attacker probing. SC-2C.8 closeable en Sprint 2c+7d, NO el día del ship.

## 4. User-visible behaviour

### BEFORE Sprint 2c

- Visitante con cuenta Google nueva → `signInWithPopup` succeeds → Firebase user creado → app frontend redirige a `/app` → backend `/me` retorna `needs_onboarding=true` (user no tiene membership) → UI muestra onboarding.
- Visitante con cuenta Google que matchea email de `solicitudes_registro.aprobado` → mismo path; user ID creado en Firebase es DISTINTO al user ID creado por Admin SDK approve flow (T10) si ambos sucedieron.
- **Bug visible**: dual-creación de Firebase users con mismo email por diferentes providers (Google vía implicit signup + Admin SDK explicit createUser) — Firebase trata como distintos UIDs.

### AFTER Sprint 2c

- Visitante con cuenta Google **nueva** (sin matching aprobado en `solicitudes_registro`) → `signInWithPopup` fails → frontend catch handler muestra error UI traducido ("No pudimos completar el registro. Si crees que es un error, contacta al admin.").
- Visitante con cuenta Google **aprobada** → `signInWithPopup` succeeds en primer intento; Firebase user creado con UID estable; subsequent sign-ins vía Google reusan el mismo UID.
- Web app `apps/web/src/routes/login.tsx` que ya usa `signInWithGoogle()` no requiere cambios funcionales — el catch handler `translateAuthError` se extiende con caso explícito `auth/internal-error` + sub-error `BLOCKED_SIGNUP_PENDING_APPROVAL` (o similar; depende de cómo Firebase propaga el HttpsError code).

### Impacto en spec O-1 / SC-1.2.1 flow signup-request

Sin cambios al flow `POST /api/v1/signup-request` (T8 shipped). Continúa siendo el único path para que un visitante "pida cuenta". La diferencia post-Sprint-2c: si el visitante usa cuenta Google + ya tiene approved row, el primer sign-in vía Google completa sin rebote.

## 5. Out of scope

Lo siguiente NO se implementa en Sprint 2c (deferred o explícitamente OOS):

1. **`beforeSignIn` Blocking Function** (per-sign-in vs per-creation): Sprint 2c implementa solo `beforeCreate`. Sign-in subsequent con user ya-existente NO pasa por la Blocking Function en cada login. Si se requiere session-level enforcement (e.g., disable user mid-session via deactivation flow), agregar `beforeSignIn` es otro spec.
2. **Apple SSO, Microsoft SSO, otros federated providers**: Booster no soporta SSO no-Google a 2026-05-26. Si se agrega Apple en versiones próximas, el mismo handler aplica con condición `provider === 'apple.com'`; OOS para extender ahora.
3. **Email-link sign-in via `sendSignInLinkToEmail` / `signInWithEmailLink`**: NO usados en main HEAD (verificado T6 audit). Si se introducen, el patrón se extiende pero está fuera de scope Sprint 2c.
4. **Phone sign-in**: deshabilitado en Identity Platform (Sprint 2b T11); irrelevant.
5. **Anonymous sign-in**: deshabilitado por `disabled_user_signup=true`; irrelevant.
6. **Rate-limit del Blocking Function**: el rate-limit estructural ya existe upstream (Cloud Armor 1000/min/IP + en endpoint `/api/v1/signup-request` 5/15min/IP cuando el user trata flow alternativo). La Blocking Function NO agrega rate-limit propio; OOS para Sprint 2c.
7. **Custom error messages localized**: el `HttpsError` retornado por la function puede tener detail strings. Localización al español queda en el frontend `translateAuthError` (apps/web). Backend retorna detail en inglés keyed por code.
8. **Audit log retention beyond default 30 days**: si Sprint 2c necesita 90+d retention para `signup.blocked.google` events, configurar Cloud Logging sink a BigQuery. OOS para Sprint 2c; tracked como follow-up si compliance Chile (Ley 19.628) lo exige en un sprint posterior.
9. **Multi-tenant Identity Platform** (`tenants` API): Booster usa single-tenant config. OOS.
10. **Deploy via Firebase CLI** (`firebase deploy --only functions`): Cloud Function Gen 2 se deploya via Terraform (`google_cloudfunctions2_function` resource) + Cloud Build trigger. OOS la integración Firebase CLI workflow.

## 6. Constraints

- **C1 — Firebase Blocking Function SLA**: 7 s hard timeout por Firebase Auth runtime. Decisiones del handler que excedan se interpretan como fail. Budget operativo: p95 ≤ 1500 ms (SC-2C.4). Cualquier syscall externo (DB query) tiene timeout interno ≤ 3 s. Cold-start mitigación: `min_instance_count = 1`.
- **C2 — Cloud Function Gen 2 region**: debe ser `southamerica-west1` (Santiago) para minimizar latency vs Cloud SQL prod (también en `southamerica-west1`). Booster region invariant per ADR-001.
- **C3 — Identity Platform Admin API requires Firebase Functions framework**: Blocking Functions sólo aceptan funciones deployadas vía `firebase-functions` SDK (verificado en docs Identity Platform). HTTP arbitrary endpoint NO soportado. Esto implica nueva dep monorepo (`firebase-functions`) + nueva app `apps/auth-blocking-functions`.
- **C4 — VPC connector**: la function necesita acceso a Cloud SQL prod (private IP `172.25.1.2` post-Sprint-2b T11/T13 drift revert). Reusa `google_vpc_access_connector.serverless` existing.
- **C5 — DB connection pattern**: usar Cloud SQL Auth Proxy sidecar (mismo pattern que apps/api). Esto implica el connection pool init dentro del handler — Cloud Functions Gen 2 keeps state across invocations dentro del mismo container instance.
- **C6 — Secret management**: la function necesita `DATABASE_URL` para conectar. Reusa el secret `database-url` ya en Secret Manager + IAM grant al SA del Cloud Function.
- **C7 — Zero-Trust auth**: el handler runtime SA NO tiene credentials para impersonate users; sólo lee `solicitudes_registro` table.
- **C8 — Booster naming bilingüe (CLAUDE.md)**: variables/funciones en camelCase EN; tabla SQL `solicitudes_registro` ya español. App folder `apps/auth-blocking-functions` (EN per convention).
- **C9 — Test coverage ≥ 80 % / 75 % branches**: per CLAUDE.md booster-stack-conventions.
- **C10 — Zero `any` / Zero `@ts-ignore`**: per CLAUDE.md type safety.
- **C11 — Structured logging via `@booster-ai/logger`**: handler logs en JSON con `correlationId` propagado desde Firebase event metadata (si disponible).
- **C12 — Spec/ADR before code**: ADR-053-equivalente nuevo (suggested numbering ADR-054 — verificar `check-adr-numbering` pre-merge) que documenta la decisión Blocking Function antes del code commit.
- **C13 — Pre-condition Sprint 2c ship**: ADR-052 debe estar en `Accepted` (post-Sprint-2b T13 canary success + 2 h watch). Gate documentado en §11 Rollout — `/plan` puede empezar ahora pero `/build` queda gated.

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
│     function_uri = $cloudFunctionGen2_url                       │
└─────────────────┬───────────────────────────────────────────────┘
                  │ HTTPS POST + JWT signed by Firebase
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ apps/auth-blocking-functions/ (Cloud Function Gen 2)            │
│   src/index.ts                                                  │
│     exports.enforceSignupApproval = beforeUserCreated(handler)  │
│   handler:                                                      │
│     1. extract email, provider del event.data                   │
│     2. if (provider !== 'google.com') return  // allow          │
│     3. lookup solicitudes_registro WHERE email=email AND        │
│        estado='aprobado' LIMIT 1                                │
│     4. if (rows.length === 0) throw HttpsError('permission-     │
│        denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')              │
│     5. structured log signup.blocked.google {emailHashed, ...}  │
│     6. return  // allow user creation                           │
└─────────────────┬───────────────────────────────────────────────┘
                  │ Cloud SQL Auth Proxy (private IP via VPC connector)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Cloud SQL Postgres (booster-ai-pg-07d9e939, southamerica-west1) │
│   solicitudes_registro (migration 0039 from Sprint 2b T7)       │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2. Components

1. **Nueva app `apps/auth-blocking-functions/`** (~150-200 LOC est.):
   - `package.json` — deps `firebase-functions@^5.0.0` + `pg@^8.13.1` + `@booster-ai/logger` + `@booster-ai/shared-schemas`.
   - `tsconfig.json` — extends `../../tsconfig.base.json` con `module: "node18"`.
   - `src/index.ts` — `exports.enforceSignupApproval = beforeUserCreated(handler)`.
   - `src/handler.ts` — pure async function que toma `BlockingEvent` + DB pool, retorna `void | throws HttpsError`. Testable.
   - `src/db.ts` — singleton DB pool init lazy con Cloud SQL Auth Proxy unix socket pattern.
   - `src/logger.ts` — instancia de `@booster-ai/logger` configurada para el service.
   - `test/handler.test.ts` — unit tests del handler con mock DB + mock event.
   - `Dockerfile` — NOT needed; Cloud Functions Gen 2 usa buildpacks por default.

2. **`infrastructure/auth-blocking-functions.tf`** (nuevo, ~80 LOC):
   - `google_cloudfunctions2_function.enforce_signup_approval` — Cloud Function Gen 2 con `min_instance_count = 1`, `region = "southamerica-west1"`, runtime nodejs20.
   - `google_service_account.blocking_function_runtime` — SA dedicado.
   - IAM bindings: `roles/cloudsql.client` + `roles/secretmanager.secretAccessor` (para `database-url`) + `roles/vpcaccess.user`.
   - Cloud Build trigger configuration (deployment via cloudbuild.production.yaml).

3. **`infrastructure/identity-platform.tf`** (modify, ~10 LOC delta):
   - Remover `blocking_functions` del `lifecycle.ignore_changes` list.
   - Agregar `blocking_functions.triggers.beforeCreate.function_uri = google_cloudfunctions2_function.enforce_signup_approval.url`.

4. **`cloudbuild.production.yaml`** (modify, ~20 LOC delta):
   - Build step `build-auth-blocking` (Cloud Build script para Function Gen 2 source upload).
   - Deploy step `deploy-auth-blocking` (gcloud functions deploy + apply Terraform IdP config si cambió).

5. **`apps/web/src/lib/api-errors.ts` o similar** (~10 LOC delta):
   - Extender `translateAuthError` para mapear `code: 'auth/internal-error'` + sub-error `BLOCKED_SIGNUP_PENDING_APPROVAL` a mensaje user-friendly español.

6. **`docs/adr/054-google-blocking-function-signup-gate.md`** (nuevo, ~100 LOC):
   - Mismo pattern ADR-052 + ADR-053. Documenta Decision (Blocking Function vs alternatives), Consequences, Alternatives considered (3+: HTTP arbitrary endpoint rejected per C3, downstream membership check rejected per ADR-052 Alt-B, eliminate Google provider rejected per ADR-052 Alt-1), Acceptance criterion para flip Proposed→Accepted post-Sprint-2c-ship + 7d watch.

7. **`docs/qa/google-blocking-function-runbook.md`** (nuevo, ~80 LOC):
   - Smoke E2E manual instructions (Google account + cuenta aprobada vs Google account + sin matching).
   - Rollback fast-path (UNSET `blocking_functions.triggers.beforeCreate` vía Identity Platform Admin API o Terraform revert).
   - Decision criteria para flip Proposed → Accepted en ADR-054.

### 7.3. Database lookup design

```sql
SELECT 1
FROM solicitudes_registro
WHERE email = $1
  AND estado = 'aprobado'
LIMIT 1;
```

Indexes: `solicitudes_registro` actualmente tiene PK sobre `id` (uuid). Email no es PK ni unique. La query LIMIT 1 sobre tabla pequeña (~10-50 rows/mes esperado per ADR-052) es fast incluso sin index — table scan tarda <1ms. Si crece a >10k rows, agregar `CREATE INDEX idx_solicitudes_email_estado ON solicitudes_registro (email, estado);` — tracked como follow-up post-launch si volumen lo requiere.

### 7.4. Failure modes y semantics

- **DB unreachable**: `pg.Client.query` throws. Handler catch + `throw new HttpsError('internal', 'database-unreachable')` → Firebase rechaza sign-up con `auth/internal-error`. Fail-closed. Cold-start del proxy <2 s normalmente; recovery rápido.
- **DB query timeout** (>3 s internal threshold): mismo path. Estructurado log con `correlationId` + email hashed.
- **Provider !== 'google.com'**: handler retorna inmediatamente (allow). Sin DB query. Cubre casos edge donde `disabled_user_signup=true` permite Admin SDK creates que también pasan por Blocking Functions teóricamente — return early defense.
- **Event data missing email**: `data.email` undefined → throw `HttpsError('invalid-argument', ...)`. Fail-closed.

## 8. Alternatives considered

### A. HTTPS endpoint arbitrary en apps/api (no Firebase Functions framework)

**Rejected** per C3: Identity Platform Blocking Functions sólo aceptan funciones deployadas vía Firebase Functions SDK (`google_identity_platform_config.blocking_functions.triggers.beforeCreate.function_uri` espera Cloud Functions resource URI con metadata Firebase). El stub original (`_followups/sprint-2c-google-blocking-function.md`) sugería esto pero verifiqué docs Identity Platform 2026-05-26: sin Firebase Functions framework, el config rejected. Si Google relaja esta restricción en versiones futuras del Admin API, re-evaluar.

### B. Eliminar Google provider completamente (`apps/web/src/hooks/use-auth.ts:84` remove `signInWithGoogle`)

**Rejected** per ADR-052 Alt-1 ya considerado y rechazado. Razones siguen válidas: clientes B2B logística en Chile mezclan @gmail.com personales con @empresa.cl, forzar email-only signup recorta TAM. Mantener Google como provider es product call PO confirmado.

### C. Downstream membership-creation gate sin Blocking Function (post-sign-in check en `/me`)

**Rejected** per ADR-052 Alt-B ya considerado y rechazado. El Firebase user "huérfano" (creado sin role) sigue popolando el Identity Platform tenant + audit log noise. Spec O-1 estableció defense estructural at the boundary, no downstream cleanup.

### D. Custom OAuth callback (interceptar Google OAuth flow antes de que llegue a Identity Platform)

**Rejected**: alto costo de mantención (reimplementar Google OAuth state machine, redirect URI handling, PKCE), saca a Booster del pattern Firebase Auth idiomático. Identity Platform Blocking Functions es la primitive correcta provista por Google para este use case.

### E. Diferir indefinidamente (mantener residual como aceptable forever)

**Rejected**: spec sec-001-cierre §3 SC-1.2.2 amendment A3 documentó esto como `TRACKED_RESIDUAL` con cierre planificado Sprint 2c. Dejarlo abierto contradice CLAUDE.md "Cero deuda técnica day 0" + crea diff asymmetric posture defense-in-depth entre los dos legs (email/password tightened, Google open). Closing dentro de 1-2 sprints es la línea aceptable.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **R-2C-1**: Blocking Function exceeds 7s SLA → sign-in fails opaque para users aprobados legítimos | M | H | `min_instance_count = 1` elimina cold-start; DB pool init lazy + connection reuse; query timeout 3s explícito; SC-2C.4 p95 ≤ 1500 ms gate + alert |
| **R-2C-2**: Cold-start cuando min_instance_count=1 instance reboot scheduled by Google | L | M | Cloud Functions Gen 2 garantiza warm replacement antes de teardown. Aceptable. |
| **R-2C-3**: DB unreachable → todos los signups Google fallan fail-closed (incluso aprobados) | L | H | Mismo failure mode que apps/api endpoints; Cloud SQL HA already covered Sprint 1 T1. Alert Cloud Monitoring sobre rate de blocked signups > expected baseline |
| **R-2C-4**: Cost increase from min_instance_count=1 | M | L | Cost estimate <$15/mo (Cloud Functions Gen 2 pricing). Monitorear post-launch. |
| **R-2C-5**: Loop con cron cleanup `solicitudes_registro` borra `aprobado` rows post-N-days; user existing Google try to re-sign-in → blocked | L | M | Cron design (futuro) borra solo `rechazado` rows. Documentar invariant en cron spec cuando se cree. |
| **R-2C-6**: Identity Platform admin override (Felipe via console enables un user manually) crea state divergence con `solicitudes_registro` | L | L | Audit log captures admin actions; ADR-054 documenta convención que manual admin actions deben mirror via signup-request approve flow (T10 Sprint 2b). Risk aceptado low. |
| **R-2C-7**: Sprint 2c ship interactúa mal con ADR-052 Status flip pending — si T13 canary falla post-Sprint-2c-ship, rollback complejo | M | M | Gate explícito §11 Rollout: NO empezar /build Sprint 2c hasta ADR-052 Accepted. Rollback de Sprint 2c también UNSETs blocking_function trigger; doesn't affect email/password leg state. |
| **R-2C-8**: First-deploy timing window — entre `blocking_functions.beforeCreate` apply y first Google signup post-deploy hay ~30s donde behavior es inconsistent | L | L | Smoke E2E manual immediately post-deploy. Window aceptable dada baja rate de signups Google esperada per minuto. |
| **R-2C-9**: Email casing mismatch (`solicitudes_registro.email` lowercase stored T8; Firebase event `data.email` raw) → false negative match → legitimate user blocked | M | M | Handler normaliza `event.data.email.toLowerCase().trim()` antes de query. Mismo pattern que T8 service. Unit test cubre. |
| **R-2C-10**: Firebase event schema cambia en future SDK version | L | M | `firebase-functions` SDK pinned a major version compatible con runtime; renovate-bot lifecycle + manual review on bumps. |

## 10. Test list

Cada SC en §3 mapea a tests aquí. Cubre integration + unit.

- **T1** (SC-2C.2 happy negative): unit test handler con event `{email: 'new@x.cl', providerData: [{providerId: 'google.com'}]}` + DB mock returning empty rows → expect throw `HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`.
- **T2** (SC-2C.3 happy positive): unit test handler con mismo event + DB mock returning 1 row `{estado: 'aprobado'}` → expect no throw, return void.
- **T3** (SC-2C.5 fail-closed): unit test handler con DB mock throwing `new Error('ECONNREFUSED')` → expect throw `HttpsError('internal', ...)` (NOT pass-through).
- **T4** (provider passthrough): unit test handler con `providerData: [{providerId: 'password'}]` → expect return immediately sin DB query.
- **T5** (email casing): unit test handler con event email `'MiXeD@Case.CL'` + DB mock returning row `{estado: 'aprobado', email: 'mixed@case.cl'}` → expect normalized query + no throw.
- **T6** (email missing): unit test handler con `event.data.email = undefined` → expect throw `HttpsError('invalid-argument', ...)`.
- **T7** (estado != aprobado): unit test handler con DB mock returning row `{estado: 'pendiente_aprobacion'}` → expect throw permission-denied (mismo path que T1).
- **T8** (integration deferred): integration test contra Firebase emulator (`firebase emulators:start --only auth,functions`) con seeded `solicitudes_registro` row. Verify end-to-end con mock Google OAuth. Stretch goal; si emulator setup es complejo, smoke E2E manual cubre per SC-2C.2 + SC-2C.3.
- **T9** (Identity Platform config gate): post-apply de Terraform, curl Admin API `config | jq '.blockingFunctions'` → expect non-null `triggers.beforeCreate.function_uri` matching Cloud Function URL. (SC-2C.1)
- **T10** (performance smoke): post-launch, 100 invocations medidos via Cloud Monitoring → assert p95 < 1500 ms, p99 < 3000 ms. (SC-2C.4)
- **T11** (audit log emission): trigger blocked signup; verificar Cloud Logging entry con `status.code != 0`. (SC-2C.6)

## 11. Rollout

- **Feature-flagged?**: No al nivel de Booster code (la Blocking Function es estructuralmente all-or-nothing). PERO el deploy de la function + el wiring en Identity Platform son commits separados:
  1. Deploy Cloud Function (Build + Deploy steps cloudbuild) — function existe pero NO está wired como Blocking Function en Identity Platform.
  2. Apply Terraform IdP config con `blocking_functions.triggers.beforeCreate` — wiring efectivo.
  Esto permite "soft launch" (smoke E2E manual contra function endpoint directo via curl) antes del wire al runtime auth flow.

- **Migration needed?**: No DB migration. Sólo nueva app + nuevo infra + 1 line config en Identity Platform.

- **Rollback plan**:
  - **Step 1 (5-min undo)**: Identity Platform Admin API `PATCH /v2/projects/.../config` con `updateMask=blockingFunctions` y body `{}` → desactiva la Blocking Function. Subsequent Google signups vuelven a flow pre-Sprint-2c (residual abierto). NO requiere code rollback.
  - **Step 2 (full undo)**: Terraform revert del commit que agregó `blocking_functions.triggers` → re-apply restaura `blocking_functions` al estado anterior (un-managed via `ignore_changes`). Combined con Step 1.
  - **Step 3 (eliminar la function entirely)**: `terraform destroy -target=google_cloudfunctions2_function.enforce_signup_approval`. Solo si la function tiene un bug que afecta otros features.

- **Monitoring** (post-deploy 7 días):
  - Cloud Monitoring custom metric `cloudfunctions.googleapis.com/function/execution_times` → alert p95 > 1500 ms sostenido 5 min.
  - Cloud Logging filter `logName=...identitytoolkit AND status.code != 0 AND methodName=...SignUp` → counter `signup.blocked.google` per hour.
  - Alert anomaly 3-sigma sobre rate de blocked Google signups (señal de attacker probing o UX confusion).
  - Manual review de log entries 24h post-deploy.

- **Gate explícito para iniciar `/build`**:
  Sprint 2c `/plan` puede iniciar tras user approve de este spec. PERO `/build` NO inicia hasta:
  1. ADR-052 está en `Accepted` (separate commit en main per signup-canary-rollback.md §7).
  2. T13 canary success + 2h watch en prod completado.
  3. SIGNUP_REQUEST_FLOW_ACTIVATED flag flipped to `true` en prod (al menos en staging).

  Si cualquier gate falla, Sprint 2c hold hasta resolver. Documentado in §11 + decision log §13.

## 12. Open questions

- **OQ-2C-1**: ¿Qué specific error code retorna Firebase Web SDK cuando el Blocking Function throws `HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`? ¿`auth/internal-error` con detail accesible? ¿O `auth/popup-closed-by-user`? Necesario para `translateAuthError` mapping en apps/web. Verify en `/plan` con test contra Firebase emulator.

- **OQ-2C-2**: ¿Cloud Functions Gen 2 con `min_instance_count = 1` cuenta como "always allocated 1 instance" que dispara billing 24/7 incluso sin invocaciones? Verify pricing model exacto en `/plan` antes de commit (impacto cost ~$5/mo vs ~$15/mo).

- **OQ-2C-3**: ¿Identity Platform Blocking Functions soportan multiple regions? Si la function deployada en `southamerica-west1` falla, ¿Identity Platform routes a una secondary region automatically, o el sign-up fails outright? Verify en docs o test.

- **OQ-2C-4**: ¿Cómo Identity Platform propaga `HttpsError.message` al frontend? El detail `BLOCKED_SIGNUP_PENDING_APPROVAL` requiere ser visible al user para que el frontend pueda mostrar mensaje específico. Si Firebase oculta el message, usar el code como signal en su lugar.

- **OQ-2C-5**: ¿Audit log entries de Blocking Function rejection llevan suficiente context (email solicitante, IP origen) para forensia útil, o el log está sanitizado por Firebase? Importante para SC-2C.6.

- **OQ-2C-6**: ¿Existing user (ya creado pre-Sprint-2c con Google signin antes de la Blocking Function wire) puede seguir haciendo sign-in normalmente? La Blocking Function `beforeCreate` solo fires en first-time creation, no en subsequent sign-ins. Confirmar zero impact a existing users.

Resolver OQ-2C-1 a OQ-2C-6 antes de cerrar `/plan` Sprint 2c.

## 13. Decision log

- **2026-05-26 21:14Z** — Initial draft v1 tras Path A del start-sprint-2c decision (DEFINE only, BUILD gated por ADR-052 Accepted). Stub `_followups/sprint-2c-google-blocking-function.md` rephrased + expanded en este spec con success criteria measurable + test list + alternatives matrix + risks tabulated + 6 open questions for `/plan` resolution.

- **2026-05-26 21:20Z** — Devils-advocate review identifica **3 P0 + 5 P1 + 7 P2** findings (ver `review.md`). Crítico:
  - **P0-1 + P0-2 confirmados empíricamente vía WebFetch a docs.cloud.google.com + GitHub iap-gcip-web-toolkit#258**: Identity Platform Blocking Functions soportan **Gen 1 only**, NO Gen 2. SDK requerido es `gcip-cloud-functions@^0.2.0`, NO `firebase-functions/v2/identity`. Architecture en v1 §7.2 (Cloud Function Gen 2 + firebase-functions framework) es **invalida**.
  - **P0-3** Admin SDK `auth.createUser` interaction sigue **inconclusive desde docs**; requiere spike empírico contra IdP sandbox o defer a /plan early phase.
  - **P1-1..P1-5 + P2-1..P2-7** todos válidos, requieren reformulation en v2.

  Conclusión: v1 retired como "INVALIDATED PENDING v2 REDRAFT". Spec re-draft v2 deferred a sesión próxima:
  - §7.2 reescribir con Gen 1 + `google_cloudfunctions_function` Terraform resource + `gcip-cloud-functions` SDK.
  - §8 separar Alt-A en A1 (arbitrary HTTP, rejected) vs A2 (gcip-cloud-functions Gen 1, ADOPTED).
  - §8 nuevo Alt-F: "accept residual permanently" con cost/severity calc.
  - §3 SC-2C.4 reformular threshold testable a low-volume (e.g., "first 10 invocations OR 7 days, whichever first").
  - §3 SC-2C.8 numeric baseline para "blocked rate signal".
  - §10 elevar T8 Firebase emulator de stretch a required.
  - §10 nuevo T12 race condition test (concurrent signups same email).
  - §11 nuevo mechanical CI gate que grep ADR-052 `Status: Accepted` antes de allow /build.
  - §11 nuevo step migration: inventory + cleanup pre-Sprint-2c Google Firebase users sin matching `solicitudes_registro.aprobado`.
  - C13 + §11 gates reformular como mechanical, no contractual.
  - R-2C-9 extender a IDN/punycode/aliases/whitespace.
  - §12 OQ-2C-1..6 marcadas formal blockers explícitos.
  - C12 ADR-054 numbering: defer commitment a /plan post-`check-adr-numbering`.

  v1 spec.md preserved as historical reference. NO `/plan` Sprint 2c hasta v2 approve.
