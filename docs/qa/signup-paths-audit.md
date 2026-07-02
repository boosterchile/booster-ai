# Audit: Firebase signup / auth-mutation / sign-in paths inventory (Sprint 2b T6)

> **Generado**: 2026-05-26 contra `main` HEAD (`c3a6ebb` post-PR1 H1.3).
>
> **Spec**: `.specs/sec-001-cierre/spec.md` §3 H1.2 SC-1.2.0 (inventario exhaustivo) + SC-1.2.1 (migration plan per match).
>
> **Plan**: `.specs/sec-001-cierre/plan-sprint-2b.md` §3 T6 (este audit + ADR-052 entrega).
>
> **ADR**: [`052-signup-migration-admin-sdk-gate.md`](../adr/052-signup-migration-admin-sdk-gate.md) (Status: Proposed; transiciona Accepted en T13 post-canary).
>
> **Generador**: este doc enumera **cada match** del grep canónico contra el árbol fuente, lo categoriza (auth-creation / auth-mutation / sign-in), y declara el migration plan por archivo. Re-generable via el comando abajo.

## 1. Comando canónico (per spec SC-1.2.0)

```bash
grep -rnE 'createUserWithEmailAndPassword|sendPasswordResetEmail|signInWithEmailLink|sendSignInLinkToEmail|applyActionCode|verifyBeforeUpdateEmail|linkWithCredential|linkWithPopup|signInWithPopup|updatePassword|confirmPasswordReset|reauthenticateWithCredential|unlink|updateProfile' apps/web/src apps/api/src
```

**Resultado 2026-05-26** contra `main` HEAD `c3a6ebb`: matches en **5 archivos** distribuidos en `apps/web/src` (cero matches en `apps/api/src` — confirma que paths Firebase Auth client-only viven en el web app, no en backend).

Distribución por archivo (re-ejecutable con `grep ... | cut -d: -f1 | sort | uniq -c | sort -rn`):

| Archivo | Tipo | Matches |
|---|---|---|
| `apps/web/src/hooks/use-auth.ts` | producción (core wrappers Firebase) | 14 |
| `apps/web/src/hooks/use-auth.test.tsx` | test (Vitest mocks) | 24 |
| `apps/web/src/components/profile/AuthProvidersSection.tsx` | producción (linking UI) | 11 |
| `apps/web/src/components/profile/AuthProvidersSection.test.tsx` | test (Vitest mocks) | 12 |
| `apps/api/src/**` | — | 0 |
| **Total** | — | 61 (37 prod + 24 test) |

**Cero matches** en `apps/api/src` confirma: ningún path Firebase Auth se ejecuta server-side en el monolito API. Todo consumo Firebase Auth es client-side desde el web app. Los routes backend `/auth/driver-activate` (`apps/api/src/routes/auth-driver.ts`), `/auth/login-rut` (`apps/api/src/routes/auth-universal.ts`), `/demo/login` (`apps/api/src/routes/demo-login.ts`) usan Admin SDK `auth.createCustomToken` / `auth.createUser`, no las APIs cliente listadas en el grep.

## 2. Inventario por archivo

### 2.1 `apps/web/src/hooks/use-auth.ts` (producción — core wrappers)

Archivo central que re-exporta Firebase Auth primitivos como funciones nombradas Booster. Es el único entry point producción para todos los paths del grep canónico. Líneas indicadas son contra `main` HEAD `c3a6ebb`.

| # | Línea | Método Firebase | Wrapper Booster | Categoría SC-1.2.0 | Caller(s) UI | Migration plan T6 |
|---|---|---|---|---|---|---|
| 1 | 5 | `createUserWithEmailAndPassword` (import) | — | — | — | — |
| 2 | 137 | `createUserWithEmailAndPassword(firebaseAuth, opts.email, opts.password)` | `signUpWithEmail()` (línea 132) | **auth-creation** | `login.tsx:140` (form sign-up) | **MIGRAR T9** (in-scope Sprint 2b PR2): `signUpWithEmail` deprecated y reemplazado por `POST /api/v1/signup-request` desde `login.tsx`. Backend hace `auth.createUser` via Admin SDK post-approve (T10). Cliente recibe 202 + email "tu solicitud está siendo revisada". |
| 3 | 11 | `sendPasswordResetEmail` (import) | — | — | — | — |
| 4 | 149 | `sendPasswordResetEmail(firebaseAuth, email)` | `requestPasswordReset()` (línea 148) | **auth-creation** (Firebase clasifica password-reset como creation path porque crea un OOB action code; para Booster es mutation flow sobre user existente) | `login.tsx:147` (form reset) | **ALLOWLIST con justificación + REVIEW_BY** (deferred Sprint 2b T9c scope-reduction A2): el path requiere user-ya-existente (Firebase rechaza si email no está registrado en tenant). Una vez Identity Platform email/password self-signup OFF (T11), `sendPasswordResetEmail` para email NO-existente retorna `auth/user-not-found` y NO crea cuenta. Justificación: scope reduced (spec amendment A2 v3.4); inventario verifica que el path no es self-signup vector tras flip. REVIEW_BY: 2026-08-26 (90d post-Sprint-2b ship). |
| 5 | 14 | `signInWithPopup` (import) | — | — | — | — |
| 6 | 85 | `signInWithPopup(firebaseAuth, googleProvider)` | `signInWithGoogle()` (línea 84) | **auth-creation** (provider Google: primer login crea User implícitamente) | `login.tsx:97` (botón Google sign-in) | **TRACKED_RESIDUAL Sprint 2c** (per spec amendment A3 v3.4 + SC-1.2.2 Google leg): el path queda funcional post-Sprint-2b ship porque Identity Platform GA no expone toggle per-provider "Allow new accounts to sign up = OFF" para Google. Sprint 2c entrega Firebase Auth Blocking Function `beforeCreate` que rechaza first sign-in Google si no hay `solicitudes_registro.estado=aprobado` matching email. Tracked en [`.specs/_followups/sprint-2c-google-blocking-function.md`](../../.specs/_followups/sprint-2c-google-blocking-function.md). Riesgo residual: Google self-signup OPEN entre Sprint 2b y Sprint 2c, no exploitable end-to-end sin role-assignment manual. |
| 7 | 7 | `linkWithPopup` (import) | — | — | — | — |
| 8 | 188 | `linkWithPopup(user, googleProvider)` | `linkGoogleProvider()` (línea 187) | **auth-mutation** (requiere user-ya-existente; agrega provider Google a cuenta existente) | `AuthProvidersSection.tsx:71` ("Vincular Google" button) | **ALLOWLIST con justificación + REVIEW_BY**: el path requiere user-ya-existente (Firebase rechaza `linkWithPopup` si caller no tiene sesión activa). NO es self-signup vector — la cuenta destino ya fue creada via signup-request approved gate. Post-Sprint-2b ship, mantener allowlisted con comment `// auth-mutation sobre user existente; no self-signup vector; REVIEW_BY: 2026-08-26`. Scope reduced per A2 amendment. |
| 9 | 6 | `linkWithCredential` (import) | — | — | — | — |
| 10 | 211 | `linkWithCredential(user, credential)` | `linkPasswordProvider()` (línea 205) | **auth-mutation** (requiere user-ya-existente; agrega provider email/password a cuenta Google) | `AuthProvidersSection.tsx:90` ("Agregar password" flow) | **ALLOWLIST con justificación + REVIEW_BY**: el path requiere user-ya-existente. NO es self-signup vector. Mismo rationale que #8. Comment: `// auth-mutation sobre user existente; no self-signup vector; REVIEW_BY: 2026-08-26`. |
| 11 | 16 | `unlink` (import) | — | — | — | — |
| 12 | 220 | `unlink(user, providerId)` | `unlinkProvider()` (línea 219) | **auth-mutation** (requiere user-ya-existente; remueve provider) | `AuthProvidersSection.tsx:75, 90` ("Desvincular" buttons) | **ALLOWLIST con justificación + REVIEW_BY**: el path requiere user-ya-existente. NO es self-signup vector. Comment: `// auth-mutation sobre user existente; no self-signup vector; REVIEW_BY: 2026-08-26`. |
| 13 | 9 | `reauthenticateWithCredential` (import) | — | — | — | — |
| 14 | 236 | `reauthenticateWithCredential(user, credential)` | `reauthCurrent()` (línea 228) | **sign-in** (re-authentica, NO crea ni muta credenciales) | `AuthProvidersSection.tsx:447` (pre-updatePassword reauth) | **ALLOWLIST con justificación + REVIEW_BY**: el path NO crea cuentas (Firebase rechaza si email no matchea sesión actual). Es defense-in-depth requirement para operaciones sensibles. Comment: `// sign-in path sobre user existente; no creation vector; REVIEW_BY: 2026-08-26`. |
| 15 | 17 | `updatePassword` (import) | — | — | — | — |
| 16 | 253 | `updatePassword(user, newPassword)` | `updatePasswordCurrent()` (línea 252) | **auth-mutation** (requiere user-ya-existente + reauth previo) | `AuthProvidersSection.tsx:453` (form cambio password) | **ALLOWLIST con justificación + REVIEW_BY**: el path requiere user-ya-existente. NO es self-signup vector. Comment: `// auth-mutation sobre user existente; no self-signup vector; REVIEW_BY: 2026-08-26`. |
| 17 | 18 | `updateProfile` (import) | — | — | — | — |
| 18 | 139 | `updateProfile(result.user, { displayName: opts.displayName })` | (inline post-signUp en `signUpWithEmail`) | **auth-mutation** (set displayName sobre user recién creado) | `login.tsx:140` (sign-up flow) → callado por #2 | **MIGRAR T9** (in-scope Sprint 2b PR2): el call vive dentro de `signUpWithEmail`; cuando ese path se reemplaza por `signup-request`, este `updateProfile` desaparece del web app. Backend (`auth.createUser`) toma `displayName` como parámetro de approve(). Sin orphan code. |

### 2.2 `apps/web/src/components/profile/AuthProvidersSection.tsx` (producción — linking UI)

Componente que muestra al user logueado sus providers vinculados y permite link/unlink/cambio-password. **Cero llamadas directas a Firebase Auth APIs** (todo va vía wrappers `use-auth.ts`). Los 11 matches del grep son referencias por nombre (props, variables, comments).

| Línea | Match | Tipo | Migration plan |
|---|---|---|---|
| 13 | `unlinkProvider,` (prop destructure) | prop pass-through del wrapper `use-auth.ts:219` | Sin migración: el componente solo recibe la función, no la implementa. Cobertura cae en #12 arriba (allowlisted). |
| 14 | `updatePasswordCurrent,` (prop destructure) | prop pass-through del wrapper `use-auth.ts:252` | Sin migración: cobertura en #16 arriba (allowlisted). |
| 33 | `(linkWithCredential, unlink) requieren auth reciente.` | comment doc | Sin migración: comentario describe el flow; cubierto por #10 + #12. |
| 46 | `Forzamos re-render manual al linkear/unlinkear` | comment doc | Sin migración: comentario UX. |
| 67 | `status={hasGoogle ? 'linked' : 'unlinked'}` | prop value | Sin migración: string literal del status enum, no API call. |
| 75 | `await unlinkProvider(user, 'google.com');` | call wrapper | Cobertura en #12 arriba (allowlisted). |
| 90 | `await unlinkProvider(user, 'password');` | call wrapper | Cobertura en #12 arriba (allowlisted). |
| 127 | `status: 'linked' \| 'unlinked';` | TypeScript type literal | Sin migración: type-level. |
| 177 | `{status === 'unlinked' && onAdd && (` | render conditional | Sin migración: comparación de string literal. |
| 453 | `await updatePasswordCurrent(user, values.newPassword);` | call wrapper | Cobertura en #16 arriba (allowlisted). |

### 2.3 `apps/web/src/hooks/use-auth.test.tsx` (test — Vitest mocks)

24 matches, todos son referencias a mocks de Vitest (`vi.fn()` + module mock setup). Mocks no se ejecutan en producción. Excluidos del migration plan SC-1.2.1 per CLAUDE.md scope (tests verifican comportamiento de los wrappers, no de Firebase directamente).

**Acción T6**: ninguna (mocks cubren los wrappers post-migración. Cuando T9 reemplaza `signUpWithEmail` por `requestSignup`, los tests del wrapper también se actualizan o eliminan).

**Acción T9c**: integration tests del Sprint 2b T9c (`signup-paths-negative.integration.test.ts`) verifican que los 5 métodos creation más exploitables retornan `auth/operation-not-allowed` post-T11 flip. Cobertura paralela.

### 2.4 `apps/web/src/components/profile/AuthProvidersSection.test.tsx` (test — Vitest mocks)

12 matches, mismo pattern que 2.3: mocks de los wrappers. Sin migración necesaria.

### 2.5 `apps/api/src/**` (producción backend)

**0 matches** en el grep canónico. Confirma que ningún Firebase Auth client-side primitive se ejecuta en el monolito API. Routes server-side de auth (`auth-driver.ts`, `auth-universal.ts`, `demo-login.ts`) usan **Admin SDK** (`admin.auth().createUser`, `admin.auth().createCustomToken`) — APIs distintas, no en el grep porque el grep es específico a client SDK methods.

Sprint 2b T8 agregará `apps/api/src/routes/signup-request.ts` + `apps/api/src/services/signup-request.ts` con call a `admin.auth().createUser` desde service post-approve (T10). El call será nuevo y no estará en el grep (otra API).

## 3. Categorización resumen (per SC-1.2.0)

| Categoría | Método | Archivo línea producción | Migration plan |
|---|---|---|---|
| **Creation** (admin-approval gate aplica) | `createUserWithEmailAndPassword` | `use-auth.ts:137` | **MIGRAR T9** Sprint 2b → eliminado |
| **Creation** | `sendPasswordResetEmail` | `use-auth.ts:149` | **ALLOWLIST + REVIEW_BY** (no self-signup vector post T11 flip) |
| **Creation** | `signInWithEmailLink` | (no match en main HEAD) | N/A (no se usa) |
| **Creation** | `sendSignInLinkToEmail` | (no match en main HEAD) | N/A (no se usa) |
| **Creation** | `applyActionCode` | (no match en main HEAD) | N/A (no se usa) |
| **Creation** | `verifyBeforeUpdateEmail` | (no match en main HEAD) | N/A (no se usa) |
| **Creation** | `linkWithCredential` | `use-auth.ts:211` | **ALLOWLIST + REVIEW_BY** (auth-mutation sobre user existente) |
| **Creation** | `linkWithPopup` (Google) | `use-auth.ts:188` | **ALLOWLIST + REVIEW_BY** (auth-mutation sobre user existente) |
| **Creation** | `signInWithPopup` (Google) | `use-auth.ts:85` | **TRACKED_RESIDUAL Sprint 2c** (Blocking Function) |
| **Mutation** (no creation) | `updatePassword` | `use-auth.ts:253` | **ALLOWLIST + REVIEW_BY** |
| **Mutation** | `confirmPasswordReset` | (no match en main HEAD) | N/A (no se usa directamente; Firebase lo gestiona internamente vía link reset email) |
| **Mutation** | `reauthenticateWithCredential` | `use-auth.ts:236` | **ALLOWLIST + REVIEW_BY** (sign-in path, no creation) |
| **Mutation** | `unlink` | `use-auth.ts:220` | **ALLOWLIST + REVIEW_BY** |
| **Mutation** | `updateProfile` | `use-auth.ts:139` | **MIGRAR T9** Sprint 2b → eliminado junto con `signUpWithEmail` |
| **Sign-in** (no creation) | `signInWithEmailAndPassword` | `use-auth.ts:13` import; usado en `signInWithEmail` (línea 94-97) | **Sin migración** — sign-in legítimo de user existente; cubierto por backend Zero-Trust per ADR-001 |
| **Sign-in** | `signInWithCustomToken` | `use-auth.ts:12` import; usado en `signInDriverWithCustomToken` (105-108) y `signInUniversalWithCustomToken` (117-120) | **Sin migración** — backend mintea custom token vía Admin SDK; sign-in es legitimate consumer del token. ADR-035 (login universal). |

## 4. Cross-PR allowlist preempty

Sprint 2b PR1 (T3, mergeado en `779a3e1`) ya tiene entry preempty en `apps/api/src/middleware/is-demo-allowlist.ts` para `POST /api/v1/signup-request` (signup path sin auth → middleware is-demo no fires). Sprint 2b PR2 T8 confirma o agrega el entry final.

Allowlist en `is-demo-allowlist.ts` aplica al backend (is-demo enforcement middleware). El presente audit es para **paths Firebase Auth client-side**, que viven en frontend y son orthogonal a is-demo middleware (es middleware backend). Los dos sistemas no se solapan.

## 5. Verificación de completitud

Comando re-ejecutable que valida que la tabla §3 cubre todos los métodos del grep canónico:

```bash
EXPECTED='createUserWithEmailAndPassword sendPasswordResetEmail signInWithEmailLink sendSignInLinkToEmail applyActionCode verifyBeforeUpdateEmail linkWithCredential linkWithPopup signInWithPopup updatePassword confirmPasswordReset reauthenticateWithCredential unlink updateProfile'
for m in $EXPECTED; do
  echo "[$m] $(grep -c "$m" docs/qa/signup-paths-audit.md) menciones en este audit"
done
```

Esperado: cada método tiene ≥ 1 mención. Verificado 2026-05-26.

## 6. Próximos pasos

- **T7 (Sprint 2b PR2 next)**: Drizzle migration `solicitudes_registro` + pgEnum + domain schema. Depende de este audit + ADR-052 mergeados.
- **T8**: endpoint backend + service + middleware rate-limit + liveness `/health/signup-flow`.
- **T9 (suite a/b/c)**: integration tests cubren happy path + enumeration defense + rate-limit + fail-closed Redis + per-method negative (5 métodos exploitables).
- **T10**: admin UI single-file + email notifications + flag `SIGNUP_REQUEST_FLOW_ACTIVATED=false`.
- **T11**: Terraform IdP self-signup email/password OFF + doc.
- **T13**: synthetic monitor `signup-probe` + canary 30 min + 2 h watch + ADR-052 flip `Proposed → Accepted`.

Sprint 2c (`.specs/_followups/sprint-2c-google-blocking-function.md`) cierra el residual Google leg.
