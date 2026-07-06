# Auditoría de cierre — Fase 1 `onboarding-flow-redesign` (T1.1–T1.8) vs código vivo

- **Fecha**: 2026-07-06
- **Rama auditada**: `feat/onboarding-usuarios-operativo` (= `main` + 1 commit de docs)
- **Alcance**: READ-ONLY. Ningún archivo de código fue modificado.
- **Fuentes**: `.specs/onboarding-flow-redesign/{spec,plan,review}.md`, código vivo en `apps/api` (routes/services/db/schema/drizzle), `packages/shared-schemas`, `infrastructure/`, `apps/web`, `docs/adr/057-*.md`.
- **Propósito**: gate previo a W1.2–W1.5 del plan `.specs/hito-2-corfo-mes-8/plan.md` (construir la UI faltante + activar con seguridad).

## Tabla resumen de veredictos

| # | Check | Veredicto | Nota de una línea |
|---|---|---|---|
| 1 | Consumo atómico del token | ✅ (mecanismo) / ⚠️ (HTTP status) | `UPDATE...WHERE consumido_en IS NULL` es atómico y probado con concurrencia real; pero el segundo consumo NO devuelve 409 — devuelve 403 `onboarding_token_invalid` colapsado a propósito (anti-oráculo) |
| 2 | TTL inyectado (OQ1) | ✅ (mecanismo) / ⚠️ (gate) | `ONBOARDING_TOKEN_TTL_HOURS` es env-configurable, default 72h; pero la "ratificación" formal de OQ1 + sign-off security-auditor sigue listada como condición pendiente, no como hecho cerrado |
| 3 | Camino Google en `/me` (T1.8) | ✅ | `/me` nunca auto-provisiona; aprobado-Google sin fila cae en `needs_onboarding=true` sin insert/update; test 3/3 verde |
| 4 | Reaper agendado | ❌ | El job T1.7 (`reap-orphan-onboarding-firebase.ts`) existe con tests, pero es un script `tsx` manual — **no está en `infrastructure/scheduling.tf`**; ningún Cloud Scheduler lo dispara |
| 5 | Fail-closed admin-provisioned | ✅ | Flag OFF→403; flag ON sin secreto→503 (en el route Y en el approve admin); secreto débil→503; todos con test |
| 6 | Anti-enumeración signup-request | ✅ | 202 `{ok:true}` idéntico exista o no el email; rate-limit 5/15min/IP wireado, fail-closed 503 si Redis cae |
| 7 | Estado de los 3 flags | ✅ | Los 3 flags existen en `config.ts`, Zod-validados (`booleanFlag`), default `false`, wireados 1:1 en `server.ts` |
| 8 | T1.x incompletas/divergentes | ⚠️ | T1.1–T1.6 y T1.8 verificadas completas en código; T1.7 completo como código pero **no desplegado** (higiene manual, riesgo abierto por diseño); las 4 "condiciones ANTES del flip" del propio plan NO están marcadas como cumplidas (2 de 4 confirmadas incumplidas: scheduler y secret en Secret Manager) |

**Bloqueante de activación segura**: los checks 4 y (parcialmente) 2/8 significan que **2 de las 4 "condiciones go-with-fixes ANTES del flip"** que el propio plan exige (plan.md, sección "Cierre Fase 1") están confirmadas como NO cumplidas hoy: (1) Cloud Scheduler para T1.7, y (2) `ONBOARDING_TOKEN_SIGNING_SECRET` en Secret Manager/Terraform (no aparece en `infrastructure/` bajo ningún nombre). El flip de `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true` no debería ejecutarse hasta cerrar esas dos.

---

## 1. Consumo atómico del token

**Mecanismo (✅)**: `apps/api/src/services/onboarding.ts:160-181` — dentro de la transacción de `onboardEmpresa`, paso 0:

```sql
UPDATE solicitudes_registro
   SET consumido_en = now()
 WHERE id = ? AND estado = 'aprobado' AND token_hash = ?
   AND consumido_en IS NULL AND expira_en > now()
 RETURNING id
```

0 filas ⇒ `OnboardingTokenNotConsumableError` ⇒ rollback total (no se crea user/empresa/membership). Probado contra Postgres real con concurrencia real en `apps/api/test/integration/onboarding-token-consume.integration.test.ts:84-104` ("doble consumo concurrente → exactamente uno gana", vía `Promise.all` de dos `UPDATE` concurrentes) y `:106-112` ("segundo consumo del mismo token → 0 filas").

**Discrepancia de HTTP status (⚠️)**: el checklist de esta auditoría pedía verificar que un segundo consumo "devuelve 409". El código **no** hace eso por diseño deliberado: `apps/api/src/routes/empresas.ts:232-240` captura `OnboardingTokenNotConsumableError` y responde `403 onboarding_token_invalid` — **la misma respuesta** que un token inválido, con firma incorrecta, o expirado (`empresas.ts:205-213`, `:597-606`, `:658-673` en el test). Esto está documentado explícitamente en `plan.md` T1.5b ("COLAPSO sin oráculo... misma 403") y en `review.md` P1-2/T1.2 como requisito de la postura anti-enumeration de SEC-001: si "ya consumido" devolviera 409 distinto de "inválido/expirado", un atacante podría usar el status code como oráculo para saber si un token existió/fue válido alguna vez. **No es un bug** — es una decisión de seguridad documentada — pero contradice la expectativa literal del checklist de esta tarea. Los implementadores de UI deben tratar TODO 403 `onboarding_token_invalid` como un estado genérico "tu link ya no es válido", sin distinguir "ya usado" de "expirado" de "nunca existió".

## 2. TTL inyectado (OQ1)

**Mecanismo (✅)**: `apps/api/src/config.ts:583` — `ONBOARDING_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72)`. Se lee en `apps/api/src/routes/admin-signup-requests.ts:150` (`ttlMs: appConfig.ONBOARDING_TOKEN_TTL_HOURS * 60 * 60 * 1000`) y se pasa a `createOnboardingToken` — nunca hardcoded en la lib (`onboarding-token.ts:117-122` recibe `ttlMs` como parámetro obligatorio).

**Gate pendiente (⚠️)**: `plan.md` sección "Cierre Fase 1", condición #3 dice "TTL (OQ1) ratificado (default actual 72h)" como una de las 4 condiciones que deben cumplirse **antes** del flip — fraseada como pendiente-de-confirmar, no como hecho consumado con fecha/firma. No encontré un artefacto separado (ledger, ADR, comentario fechado) que registre el sign-off explícito del security-auditor sobre el valor de 72h, a diferencia de T1.1–T1.8 que sí tienen evidencia con fecha `[DONE 2026-06-08]`. Recomendación: antes de flip, obtener y registrar esa ratificación explícita (aunque sea "72h confirmado, sin cambios" con fecha).

## 3. Camino Google en `/me` (T1.8)

**✅ Confirmado.** `apps/api/src/routes/me.ts:63-87`: el account-linking automático SOLO re-vincula una fila `users` existente cuando `claims.emailVerified=true`; nunca crea una fila. Si no hay fila por `firebase_uid` ni por `email`, cae directo a `needs_onboarding: true` (`me.ts:126-137`) sin ningún insert/update.

Test dedicado `apps/api/test/unit/me-onboarding-google-path.test.ts` (3/3):
- Aprobado-Google sin fila `users` → `needs_onboarding=true`, `insertCalls.length===0`, `updateCalls.length===0` (línea 125-146).
- `emailVerified=false` → no linkea aunque exista fila por email (anti-hijack, línea 148-168).
- Fila existente + Google verificado → re-vincula (`needs_onboarding=false`, 1 update, 0 insert) — linking ≠ provisioning (línea 170-203).

## 4. Reaper agendado

**❌ No agendado.** El job `apps/api/src/jobs/reap-orphan-onboarding-firebase.ts` tiene lógica completa + tests unitarios (8/8) + el predicado probado contra Postgres real (`onboarding-token-consume.integration.test.ts:135-163`), pero:

- El propio código lo documenta sin ambigüedad (líneas 26-30): *"Trigger: hoy es un script `tsx` MANUAL (no Cloud Run Job todavía). Por tanto NO es una mitigación de seguridad automática — es higiene operacional. El riesgo 'huérfano Firebase' del spec §9 queda ABIERTO hasta cablear un Cloud Scheduler; ese cableado es gate del flip."*
- Grep en `infrastructure/scheduling.tf` confirma: hay 6 `google_cloud_scheduler_job` (`chat-whatsapp-fallback`, `cobra-hoy-cobranza`, `demo-account-ttl-alert`, `reap-inert-idp-accounts`, `cobrar-memberships-mensual`, `purgar-posiciones-movil`) — **ninguno invoca `reap-orphan-onboarding-firebase`**. El reaper genérico de cuentas IdP inertes (`reap-inert-idp-accounts`, ADR-057) SÍ está agendado (diario 04:00 America/Santiago) pero es un job **distinto**: protege explícitamente las solicitudes `aprobado` (`reaper-predicate.ts`), por lo que no cubre el huérfano de onboarding-token.
- No hay ruta HTTP `/admin/jobs/reap-orphan-onboarding-firebase` expuesta (el job corre standalone vía `main()`/`tsx`, no vía Cloud Run Job invocado por Scheduler con OIDC como los demás).

Esta es la Condición #1 de "go-with-fixes ANTES del flip" (`plan.md`, sección Cierre Fase 1) y está confirmada como **incumplida**.

## 5. Fail-closed del camino admin-provisioned

**✅ Confirmado en ambos extremos del flujo:**

- **Route de consumo** (`apps/api/src/routes/empresas.ts:156-199`): Gate 1 flag OFF → `403 onboarding_disabled` (antes de leer el token); Gate 1b flag ON sin `onboardingTokenSecret` → `503 onboarding_misconfigured`; `verifyOnboardingToken` en try/catch — secreto débil (`assertStrongSecret` lanza) → `503` (no la respuesta anti-enumeration).
- **Approve admin** (`apps/api/src/routes/admin-signup-requests.ts:136-145`): mismo patrón fail-closed — `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true` sin `ONBOARDING_TOKEN_SIGNING_SECRET` → `503 onboarding_misconfigured` **antes** de aprobar (no cae silenciosamente al modo viejo de precrear).
- Tests: `apps/api/test/unit/empresas-onboarding.test.ts:542-619` (flag OFF, flag ON sin secreto, secreto débil) y `apps/api/test/unit/admin-provisioned-onboarding-flag.test.ts` (4/4 default OFF + toggles + independencia de `EMPRESA_SELF_ONBOARDING_ENABLED`).

## 6. Anti-enumeración en `POST /api/v1/signup-request`

**✅ Confirmado.** `apps/api/src/routes/signup-request.ts:38-53`: la ruta responde `202 {ok:true}` **siempre** que pasa Zod, sin importar el `outcome` (`submitted` vs `shadowed`) que retorna `submitSignupRequest` (`services/signup-request.ts:62-94`) — el shadow-path (email ya en `users`) no hace INSERT ni cambia el status/body. Rate limiting: `createRateLimitSignupMiddleware` montado en `server.ts:233-238` sobre `/api/v1/signup-request`; `apps/api/src/middleware/rate-limit-signup.ts` implementa 5 intentos/15min por IP (`DEFAULT_WINDOW_SECONDS`=900, confirmado en test línea 84: `expireCalled[0][1]===900`), **fail-closed 503** si Redis está caído (comentario línea 58: "bloqueamos el endpoint en lugar de pasar todo").

## 7. Estado real de los 3 flags

Los tres viven en `apps/api/src/config.ts`, todos `booleanFlag(false)` (helper Zod-preprocess en `config.ts:24-35`: `"true"/"1"→true`, `"false"/"0"/""→false`, cualquier otro valor→default):

| Flag | Línea | Default | Dónde se lee |
|---|---|---|---|
| `SIGNUP_REQUEST_FLOW_ACTIVATED` | `config.ts:518` | `false` | `admin-signup-requests.ts:81` (`requireFlowActivated`) — gatea GET list + approve + reject del admin; **NO** gatea el POST público de signup-request |
| `EMPRESA_SELF_ONBOARDING_ENABLED` | `config.ts:541` | `false` | `server.ts:388` → `createEmpresaRoutes({selfOnboardingEnabled})` → gatea `POST /empresas/onboarding` (self-service, dead-end permanente por SC3) |
| `ADMIN_PROVISIONED_ONBOARDING_ENABLED` | `config.ts:564` | `false` | `server.ts:389` → `createEmpresaRoutes({adminProvisionedOnboardingEnabled})` → gatea `POST /empresas/onboarding-admin`; también leído directo en `admin-signup-requests.ts:137` para decidir si `approve` emite token |

`ONBOARDING_TOKEN_SIGNING_SECRET` (`config.ts:574`, `z.string().min(32).optional()`) wireado en `server.ts:390`. **No aparece en ningún archivo de `infrastructure/`** (grep sin resultados) — no está provisionado en Secret Manager ni referenciado en Cloud Run env vars vía Terraform todavía. Coincide con Condición #2 de "go-with-fixes ANTES del flip", también incumplida.

## 8. Divergencias / incompletitud de T1.x

- **T1.1–T1.6, T1.8**: verificadas completas y coincidentes con el código vivo (migración 0047 con las 4 columnas nullable + índice único parcial exactamente como describe el plan; `db/schema.ts:2336-2349` matchea 1:1 la migración; `check-route-default-deny.ts` clasifica `/empresas` con rationale que menciona explícitamente `onboarding-admin`, y `security.yml:269` corre el harness en CI).
- **Detalle menor de numeración**: el plan referencia `drizzle/0040_solicitudes_onboarding_token.sql`; el archivo real es `drizzle/0047_solicitudes_onboarding_token.sql` (`_journal.json` idx 47). Es solo drift de numeración por migraciones posteriores insertadas entre la escritura del plan y hoy — el contenido es idéntico a lo descrito, no es un problema funcional.
- **T1.7**: código + tests completos, pero **no desplegado como job agendado** (ver check 4) — el propio plan lo declara honestamente como higiene manual, no mitigación de seguridad.
- **Las 4 "Condiciones go-with-fixes ANTES del flip"** (plan.md, sección Cierre Fase 1) — a diferencia de T1.1-T1.8, ninguna lleva marca `[DONE]`:
  1. T1.7 con Cloud Scheduler — ❌ incumplida (check 4).
  2. `ONBOARDING_TOKEN_SIGNING_SECRET` en Secret Manager + Cloud Run vía Terraform — ❌ incumplida (check 7).
  3. TTL (OQ1) ratificado — ⚠️ el valor existe y es correcto (72h) pero no hay artefacto de ratificación formal (check 2).
  4. Sign-off del security-auditor sobre el modelo bearer-token — no encontrado ningún artefacto de este sign-off en `.specs/onboarding-flow-redesign/` ni en `docs/`.

**Ninguna de las 4 condiciones de flip está confirmada como cumplida hoy.** Esto es consistente con el diagnóstico de `.specs/hito-2-corfo-mes-8/plan.md` §1(c): "camino nuevo admin-provisioned shippeado en prod (#428, migración 0047) pero dormido".

---

## Contexto para implementadores de UI

### a. Contrato de `POST /api/v1/signup-request`

- **Archivo**: `apps/api/src/routes/signup-request.ts`
- **Body (Zod)**: `{ email: z.string().email().max(320), nombreCompleto: z.string().min(1).max(200) }`
- **Auth**: ninguna (endpoint público, sin Firebase).
- **Rate limit**: middleware `createRateLimitSignupMiddleware` (`apps/api/src/middleware/rate-limit-signup.ts`), 5 requests / 15 min por IP (ventana 900s), key `rl:signup-request:<ip>`. Al excederse → `429`. Si Redis está caído → `503` fail-closed (no pasa la request).
- **Respuestas**:
  - `202 { ok: true }` — SIEMPRE, tanto si el email es nuevo como si ya existe en `users` (anti-enumeración; no hay forma de distinguir desde la respuesta).
  - `422` — body inválido (zValidator, p.ej. email mal formado o campos ausentes).
  - `429` — rate limit excedido.
  - `503 { error: 'service_unavailable', code: 'service_unavailable' }` — Redis caído (middleware) o excepción en el service/DB (route catch).
- **UI**: mostrar siempre el mismo mensaje de éxito tras un 202 ("revisa tu correo"), sin importar si el email ya estaba registrado — replicar la postura anti-enumeración en el copy.

### b. Contrato de `POST /empresas/onboarding-admin` (consumo admin-provisioned, T1.5b)

- **Archivo**: `apps/api/src/routes/empresas.ts` (dentro de `createEmpresaRoutes`)
- **Auth**: Firebase Bearer token (middleware `firebaseAuth`, NO `userContext` — el user todavía no existe en la DB).
- **Header del token**: `x-onboarding-token: <token>` — **NO es un query param `?token=`**. El link que recibirá el usuario por email (cuando Fase 2 exista) tendrá el token en algún formato de URL (aún no implementado — hoy el `LoggingSignupRequestNotifier` solo loguea `onboardingTokenIssued: boolean`, nunca embebe el token en un link real; ver hallazgo en §c). **La UI web debe extraer el token de donde venga en la URL (ej. `?token=` en el link de onboarding-admin que hay que construir) y reenviarlo como header `x-onboarding-token` al llamar al API** — el backend NO acepta el token como query param ni en el body.
- **Body**: mismo `empresaOnboardingInputSchema` que `/empresas/onboarding` (ver `packages/shared-schemas/src/onboarding.ts`): `{ user: {full_name, phone, whatsapp_e164, rut?}, empresa: {legal_name, rut, contact_email, contact_phone, address, is_generador_carga, is_transportista}, plan_slug }`, con refine que exige `is_generador_carga || is_transportista`.
- **Gates en orden (todos fail-closed)**:
  1. Sin `firebaseClaims` → `500`.
  2. Sin `claims.email` → `400 firebase_email_missing`.
  3. Flag `ADMIN_PROVISIONED_ONBOARDING_ENABLED=false` → `403 onboarding_disabled`.
  4. Flag ON pero sin `ONBOARDING_TOKEN_SIGNING_SECRET` configurado → `503 onboarding_misconfigured`.
  5. `claims.emailVerified=false` → `403 email_not_verified`.
  6. Sin header `x-onboarding-token` → `401 onboarding_token_required`.
  7. Token con firma inválida / expirado / secreto del server débil → `403 onboarding_token_invalid` (firma inválida/expirado colapsan en la misma respuesta) o `503 onboarding_misconfigured` (si el secreto del servidor es débil — error de configuración, no del usuario).
  8. Token válido pero ya consumido / no encontrado / hash no coincide → **también** `403 onboarding_token_invalid` (mismo código que #7 — sin oráculo, ver §1 de esta auditoría).
  9. Éxito → `201` con el mismo shape que `/empresas/onboarding` (`{user, empresa, membership}`, ver `onboardingResponseBody` en `empresas.ts:20-45`).
  10. Conflictos de datos post-token (RUT/email duplicado) → `409` (`user_already_registered`, `email_in_use`, `rut_already_registered`) o `400 invalid_plan`.
- **Para la UI**: solo dos estados de error distinguibles por código: `401 onboarding_token_required` (falta el token — no debería pasar si la UI arma bien el link) vs `403 onboarding_token_invalid` (link roto/usado/expirado — mensaje genérico tipo "este link ya no es válido, pide uno nuevo") vs `503` (error de configuración del servidor, no del usuario). No hay manera de decirle al usuario "tu link ya fue usado" vs "expiró" — es deliberado.

### c. `POST /admin/signup-requests/:id/approve` (admin-signup-requests.ts)

- **Archivo**: `apps/api/src/routes/admin-signup-requests.ts`
- **Ruta**: `POST /admin/signup-requests/:id/approve`, gate `requirePlatformAdmin` (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`) + `requireFlowActivated` (`SIGNUP_REQUEST_FLOW_ACTIVATED`, si OFF → `503 signup_flow_disabled`).
- **Body**: `{ loginLinkUrl?: string }` (opcional, default `https://app.boosterchile.com/login`).
- **Respuesta de éxito**: `200 { ok: true, outcome: 'approved', firebase_uid: string, user_id: string | null }`.
- **HALLAZGO IMPORTANTE para UI**: **el `onboardingToken` NUNCA se devuelve en esta respuesta** (`admin-signup-requests.ts:171-179` solo expone `firebase_uid`/`user_id`) — es deliberado por seguridad (`signup-request.ts:149` comenta "NUNCA exponerlo al admin"). Además, el `LoggingSignupRequestNotifier` actual (`services/notifications/signup-request-email.ts:87-107`) **no embebe el token en ningún link real** — solo loguea `onboardingTokenIssued: boolean` de forma redactada. Es decir: **hoy, con el flag ON, no existe NINGÚN mecanismo operativo para que el aprobado reciba su token** (ni por API, ni por email real — Fase 2 no está implementada). Esto confirma el diagnóstico de `hito-2-corfo-mes-8/plan.md` W1.4 ("Dashboard admin: link de onboarding copiable al aprobar... fuera de hoy → desviación 8"): **es trabajo de UI/backend pendiente, no solo de frontend** — se necesita, como mínimo, que el approve exponga (a un admin autenticado, nunca a un tercero) un link/token copiable para pegarlo manualmente al aprobado mientras Fase 2 (email real) no exista.
- **Página admin actual** (`apps/web/src/routes/platform-admin-signup-requests.tsx`): `handleApprove` llama `POST /admin/signup-requests/${id}/approve` con body `{}` (sin `loginLinkUrl` custom) y no muestra ningún link/token tras aprobar — coherente con el gap de arriba.
- **Reject**: `POST /admin/signup-requests/:id/reject`, body `{ reason?: string }`, respuesta `200 { ok: true, outcome: 'rejected' }`.

### d. apps/web: routing, `OnboardingForm`, página `/onboarding`, patrón de páginas públicas, y `platform-admin-signup-requests`

- **Router**: `apps/web/src/router.tsx` — TanStack Router programático (sin file-based codegen), un `createRoute` por ruta, todas hijas de `rootRoute`, registradas en el array `routeTree = rootRoute.addChildren([...])` al final del archivo. Rutas "eager" (sin code-split, primer paint público: index/login/login-conductor/public-tracking) se importan arriba directo; el resto usa `lazyRouteComponent(() => import('./routes/X.js'), 'XRoute')`.
  - **No existe hoy** ninguna ruta para "solicitar-acceso" (página pública de signup-request) ni para consumir `/empresas/onboarding-admin` — hay que agregar dos `createRoute` nuevas y añadirlas al `addChildren([...])`.
  - La ruta `/onboarding` (`onboardingRoute`, línea 69-73) apunta a `routes/onboarding.tsx` — es el flujo VIEJO self-service, dead-end permanente (SC3, `EMPRESA_SELF_ONBOARDING_ENABLED` nunca se enciende). No reusar esa ruta para el flujo nuevo; hay que crear una ruta distinta (p.ej. `/onboarding-admin`).
- **`OnboardingForm`**: `apps/web/src/components/onboarding/OnboardingForm.tsx` — componente reusable de 4 pasos (datos del user → empresa+dirección → tipo de operación → plan+confirmación), usa `react-hook-form` + `zodResolver(empresaOnboardingInputSchema)`. Props: `{ firebaseEmail: string; firebaseName: string | undefined }`. Internamente usa el hook `useOnboardingMutation()` (`apps/web/src/hooks/use-onboarding-mutation.ts`) que hace `api.post('/empresas/onboarding', input)` — **hardcodeado a la ruta vieja**. Para reusar este form en la página nueva hace falta: (1) un nuevo hook (o parametrizar el existente) que postee a `/empresas/onboarding-admin` con el header `x-onboarding-token`, y (2) manejar los estados de error específicos del nuevo endpoint (401/403/503 de §b) en vez de solo los de `/empresas/onboarding` (`translateApiError` en `OnboardingForm.tsx:691-709` solo mapea los códigos del endpoint viejo).
- **Página `/onboarding` actual** (`routes/onboarding.tsx`): usa `<ProtectedRoute meRequirement="allow-pre-onboarding">`, extrae `me.firebase.{name,email}` del contexto y renderiza `<OnboardingForm firebaseEmail=... firebaseName=... />` dentro de un layout simple (header con logo + card centrada). Es el patrón de referencia para la página nueva, pero la nueva necesita leer el token de la URL (`useSearch`) en vez de depender solo de `/me`.
- **Patrón de páginas públicas** (sin sesión Firebase): ver `routes/login.tsx` — no usa `ProtectedRoute`; chequea `useAuth()` y hace `<Navigate to="/app">` si ya hay sesión; usa `useSearch({strict:false})` para leer query params (ej. `?legacy=1`). También `routes/public-tracking.tsx` (montada directo en `rootRoute`, sin `/app` prefix, sin `ProtectedRoute`) es el patrón para rutas 100% públicas con token en la URL (`/tracking/$token`, path param en vez de query — revisar cuál conviene para el link de onboarding-admin, aunque el token de onboarding NO es un path param en el backend sino un header, así que la página deberá leerlo de `?token=` y reenviarlo como header al backend).
- **`platform-admin-signup-requests.tsx`** (`apps/web/src/routes/platform-admin-signup-requests.tsx`): patrón single-file, `<ProtectedRoute meRequirement="skip">`, estado `LoadState` discriminado (`idle|loading|loaded|coming_soon|forbidden|error`) mapeado desde `ApiError.status/code` (503+`signup_flow_disabled`→coming_soon, 403→forbidden). Tabla con botones Aprobar/Rechazar que usan `confirm()`/`prompt()` nativos (no modales custom). **No muestra ningún link/token tras aprobar** — ver hallazgo en §c, es el punto de extensión natural para exponer el link copiable.

### e. ADR-057 — clasificación boundary SC-G1b y su enforcement en CI

- **Archivo**: `docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md`
- **Exige** (decisión #2): un harness CI que enumera **cada mount** de rutas en `apps/api/src/server.ts` (tanto `app.use()`/`app.route()` como sub-mounts `<router>.route()`) y falla el build si un mount nuevo no está clasificado en una de 5 categorías: `ENFORCED` (precedido por `userContext`, no requiere rationale), `GATED-CLOSED` (auth básica pero el handler niega/no-opera para un token no-provisionado — requiere rationale), `INTENTIONAL-OPEN`, `INTERNAL`, `MIXED` (estas 3 también requieren rationale no vacío).
- **Script**: `apps/api/scripts/check-route-default-deny.ts`. La tabla `ROUTE_CLASSIFICATION` (objeto exportado) es el registro central; el check valida 3 invariantes: (1) default-deny (mount nuevo sin clasificar → falla), (2) no-stale (entrada clasificada que ya no está montada → falla), (3) rationale obligatorio en toda entrada NO-`ENFORCED`.
- **Para rutas nuevas de esta iniciativa** (página pública `solicitar-acceso` es solo frontend, no toca `server.ts`; pero si se agrega algún endpoint API nuevo, p.ej. para exponer el link de onboarding al admin) hay que añadir su entrada a `ROUTE_CLASSIFICATION` con `category` + `rationale` no vacío o el CI falla.
- **Enforcement en CI**: `.github/workflows/security.yml:269` — `pnpm --filter @booster-ai/api exec tsx scripts/check-route-default-deny.ts`. Ya corre hoy; el mount `/empresas` (factory `createEmpresaRoutes`) está clasificado `GATED-CLOSED` con rationale que menciona explícitamente ambas sub-rutas (`onboarding` y `onboarding-admin`) — es decir, T1.6 (clasificación boundary de la Fase 1) está correctamente cerrado, no es trabajo pendiente.
