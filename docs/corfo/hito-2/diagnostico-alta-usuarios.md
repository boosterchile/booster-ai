# Diagnóstico de raíz — flujo de creación de usuarios en producción

**Fecha**: 2026-07-07 · **Alcance**: auditoría READ-ONLY del código en `main` (HEAD `62453ae`, post-batch W1-W4a) · **Método**: 3 investigadores paralelos (self-service, admin+bootstrap, cobertura de tests) con evidencia `file:line`, más la evidencia de datos ya verificada por REST/BD durante el smoke.

> **Motivación**: el smoke E2E del hito reveló que no se puede completar el alta de un usuario end-to-end. El PO pidió el diagnóstico profesional completo — por qué el alta no está operativa — antes de cualquier parche. Este documento traza el flujo real, marca el punto de ruptura, clasifica cada gap (código / config / datos) y nombra qué falta. **No propone parches** (siguiente fase).

---

## Resumen ejecutivo (TL;DR)

El backend del alta admin-provisioned **está implementado y es correcto** (signup-request → approve → token one-shot → onboarding-admin). El flujo **no es operable end-to-end en prod por tres gaps de DISEÑO encadenados**, ninguno de datos:

1. **No hay bootstrap del primer platform admin.** Ningún seed/script/migración/ruta crea la cuenta que aprueba. El sistema asume que ya existe fuera de banda. → **el aprobador no tiene un camino reproducible para existir/autenticarse.**
2. **El único login desplegado (LoginUniversal, RUT+clave) es incompatible con el rol admin y con cuentas sin RUT.** El admin (y cualquier dueño que omitió el RUT opcional) no tiene surface de UI para obtener una sesión de su email real. → **el aprobador no puede iniciar sesión por la app.**
3. **Ningún test ejercita la cadena con auth real** — todo verde es unidad con el auth mockeado. → **por eso el gap nunca se detectó en CI.**

Consecuencia: la función crítica "crear un usuario" depende de un actor (el platform admin) que el propio sistema no sabe crear ni autenticar. Es un **gap de diseño real**, no un `UPDATE` de datos.

---

## 1. Flujo self-service (usuario real, sin admin)

**Veredicto: no existe ningún camino self-service vivo. El diseño OBLIGA a que todo transportista/generador pase por approve admin.**

Trazado del código (los 3 flags de prod: `SIGNUP_REQUEST_FLOW_ACTIVATED=true`, `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true`, `EMPRESA_SELF_ONBOARDING_ENABLED=false`):

- **`/login` → role-picker**: `LoginUniversal.tsx` (desplegado por `auth_universal_v1_activated=true`, `variables.tf:354-363`). Las 5 tarjetas (`LoginUniversal.tsx:76-107`) — incluidas las 4 no-Booster — llevan **todas al mismo `FormView` RUT+clave** (`:132-139`). **No hay pantalla de registro**; el único submit es `POST /auth/login-rut` (`:150-215`), que es **solo login**.
- **`POST /auth/login-rut`** (`auth-universal.ts:71-89`): `SELECT ... WHERE rut = :rut`; si el RUT no existe → **401** (`:86-89`). **Nunca auto-crea** una fila `usuarios`. Solo activa placeholders `pending-rut:` pre-existentes (`:122-169`).
- **Registro legacy** (botón "Crea una", `login.tsx:333-345`, alcanzable solo vía `?legacy=1`): `signUpWithEmail` → `createUserWithEmailAndPassword` (`use-auth.ts:132-142`) crea **solo cuenta Firebase**, sin fila en BD → `/me` devuelve `needs_onboarding` → `/onboarding` → `POST /empresas/onboarding` → **403 dead-end** (ver abajo). Documentado en `.specs/_followups/login-retiro-boton-crea-una-legacy.md`.
- **`POST /empresas/onboarding`** (self-service) **muerto**: gate `if (!selfOnboardingEnabled) return 403` (`empresas.ts:86-100`) + defensa en profundidad en el service (`onboarding.ts:141-143`), gateado por `EMPRESA_SELF_ONBOARDING_ENABLED=false` **permanente** (SC3, `config.ts:520-541`: "vector de auto-promoción a dueño verificado; estado seguro = OFF").
- **`auth-driver.ts`** (conductor RUT+PIN) es el patrón de referencia y confirma el diseño: el conductor **nunca se auto-provisiona** — un dueño autenticado lo crea vía `POST /conductores` (`requireWriteRole`, `conductores.ts:259-285`); el endpoint self-service solo **activa** un placeholder, no crea.

**Único write-site de `usuarios`+`empresas`+`memberships` en todo el alta**: `onboardEmpresa` (`onboarding.ts:150-309`), con dos callers — `/onboarding` (self-service, muerto) y `/onboarding-admin` (admin-provisioned, vivo pero requiere token que solo un admin emite). **No hay tercer camino.**

**Clasificación**: esto es **por diseño** (SC3/SEC-001), correcto y deliberado. No es el gap — es el contexto que hace que TODO dependa del approve admin.

---

## 2. Flujo admin-provisioned (el que intentamos)

**Veredicto: los eslabones de backend están implementados y testeados (a nivel unidad). El gap es el actor que dispara el primero — el platform admin.**

| Eslabón | Estado | Evidencia |
|---|---|---|
| `POST /api/v1/signup-request` | ✅ implementado, testeado (integration real) | `signup-request.ts:35-51`; solo INSERT en `solicitudes_registro`, 202 anti-enumeración. **Verificado vivo hoy**: piloto-smoke encoló con 202. |
| `POST /admin/signup-requests/:id/approve` | ✅ implementado, ⚠️ testeado con auth **mockeado** | `admin-signup-requests.ts:99-113` (`requirePlatformAdmin` valida `userContext.user.email` vs allowlist), `signup-request.ts:228-232` (`createUser` Admin SDK), token one-shot + `onboarding_link` en la respuesta (`:212-221`). |
| `/onboarding-admin?token=` → `POST /empresas/onboarding-admin` | ✅ implementado | `empresas.ts:146-264`, gates fail-closed en orden, consumo atómico del token (`onboarding.ts:158-182`). |
| Entrega del link | ⚠️ solo vía respuesta del approve (email = Fase 2 stub) | desviación 8, ya declarada. |

**El approve requiere un platform admin autenticado** (`requirePlatformAdmin` compara `userContext.user.email` contra `BOOSTER_PLATFORM_ADMIN_EMAILS`). Estado real de esa autenticación, verificado por REST/BD durante el smoke:

- Allowlist en prod = **`dev@boosterchile.com`** (solo).
- Firebase: `dev@boosterchile.com` — providers `google.com`+`password`, `emailVerified=true`. `contacto@boosterchile.com` — solo `password`, `emailVerified=false`, **NO en la allowlist** (aunque tiene RUT `76653720-0` + clave numérica).
- `signInWithPassword` con dev@ + la clave del PO → `INVALID_LOGIN_CREDENTIALS` (password mismatch — la cuenta tiene passwordHash, pero no coincide).

**¿Datos o diseño?** → **DISEÑO** (ver §3-4). La cuenta Firebase del admin no está rota (providers presentes, verificada); el código de login legacy es funcional. Lo que falta es un camino de UI estable hacia una sesión de email real para el admin.

---

## 3. La pregunta de fondo — ¿hay un camino coherente y completo para crear el primer usuario desde cero?

**No.** Los dos gaps de diseño que lo rompen:

### Gap A — No existe bootstrap del primer platform admin (huevo y gallina)

**Ningún seed, script, migración o ruta en el repo crea la cuenta Firebase del primer admin.** Evidencia de descarte (todo PROTEGE al admin, nada lo CREA):
- `admin-seed.ts` exige `requirePlatformAdmin` — usa el privilegio ya autenticado, no lo crea.
- `me.ts:89-124` auto-provisiona la **fila `usuarios`** (`isPlatformAdmin:true`) para cualquier email en la allowlist — **pero solo si la persona ya trae un idToken Firebase válido de ese email**. Resuelve la fila DB, NO la cuenta Firebase.
- `classify-google-idp-accounts.ts:265`, `reap-inert-idp-accounts.ts:287`: **leen** la allowlist para **excluir** esas cuentas del reaper, nunca para crearlas.
- **ADR-052** (`docs/adr/052-*.md:65,72,100`) trata la allowlist como hecho consumado ("solo Felipe en `BOOSTER_PLATFORM_ADMIN_EMAILS`") — **nunca discute cómo Felipe obtuvo su cuenta**.
- `.specs/onboarding-flow-redesign/` (base de todo #428/#565): grep de `bootstrap`/`primer admin` → **cero**.

**Lectura más consistente con la evidencia**: `dev@boosterchile.com` se creó por **auto-registro ordinario** (Google o email+password) **antes** de que SEC-001 cerrara el self-signup (flip `2026-05-13`), y la allowlist + `/me` auto-provisioning la "adoptaron" retroactivamente como admin. **Nadie escribió nunca un flujo de bootstrap.** Si hoy hubiera que crear un admin desde cero (Firebase reseteado, rotación del email admin, segundo admin), **no hay procedimiento reproducible en el repo** — habría que crear la cuenta a mano en la consola Firebase, paso no documentado en ningún runbook.

**Clasificación**: **provisioning manual/histórico asumido — gap de diseño (no un bug de código)**. El sistema de aprobación se diseñó completo para dueños de empresa, y omitió que su propio aprobador es un actor que también nace y se autentica.

### Gap B — El login desplegado no da al admin (ni a cuentas sin RUT) una sesión de email real

- Prod corre `LoginUniversal` (RUT+clave) por default (`variables.tf:354-363`). Ese flujo autentica contra un **email sintético** `users+<rut>@boosterchile.invalid` (`auth-universal.ts`), **nunca** `dev@boosterchile.com`. Una sesión así **falla la allowlist** (que valida el email real).
- El único camino de código hacia el login de email real (Google / email+password, `login.tsx:130-182`, funcional, no stub) es el escape-hatch **`?legacy=1`** (`login.tsx:61`). Pero:
  - **Ningún link de la UI lleva ahí.** El propio "¿Admin de plataforma? Ir al panel admin" (`login.tsx:383-392`) → `/app/platform-admin` → `ProtectedRoute` redirige a `/login?redirect=...` **sin `legacy=1`** (`ProtectedRoute.tsx:65-72`) → cae en LoginUniversal. `?legacy=1` solo se alcanza tecleándolo a mano.
  - En el intento real del PO, `?legacy=1` **no funcionó** en prod. Revisión estática (router `parseSearch`, nginx `try_files`, ausencia de intercept) **no encontró bug de código** que lo explique. Causas no descartadas (incertidumbre declarada, no hallazgo cerrado): **caché del service-worker/PWA** sirviendo un bundle anterior al fix de redirect B1, o interacción del consent de Google OAuth fuera de este repo.
- `?legacy=1` fue diseñado para un caso distinto ("usuario legacy rota su clave numérica", `login.tsx:37-39`), no para "el admin inicia sesión". El caso simétrico (usuario de onboarding perdiendo `?redirect=` bajo LoginUniversal) ya está documentado en `.specs/_followups/login-universal-redirect-param.md`; **el caso del admin es el mismo patrón sin su follow-up**.

**Clasificación**: **gap de diseño (superficie de login) + posible componente de deploy/caché no cerrado**. No es datos.

### Gap C (relacionado) — La trampa del RUT opcional

Aun cuando el approve funcione y un dueño complete el onboarding, `OnboardingForm.tsx:306` etiqueta el RUT **"(opcional)"** y `onboardEmpresa` (`onboarding.ts:222-234`) lo inserta **solo si se proveyó**. **No existe ningún endpoint que setee `rut` después** (grep exhaustivo). Un dueño que omitió el RUT queda con `rut=NULL` para siempre → `LoginUniversal` (`WHERE rut=:rut`, `auth-universal.ts:82`) **nunca lo encuentra → 401 permanente**, aunque tenga clave numérica. Queda dependiente para siempre del legacy `?legacy=1` (Gap B). **Es el mismo gap del admin, generalizado a cualquier usuario sin RUT.**

**Clasificación**: **gap de diseño (dato requerido tratado como opcional, sin reparación posterior)**.

---

## 4. Evidencia de tests

**Veredicto: NO existe E2E ni ningún test —de ningún nivel— que ejercite la cadena completa con autenticación real. Toda la cobertura verde es unidad con el auth mockeado.**

- `apps/web/e2e/` tiene **3 specs** (perfil, redis-ratelimit, fixtures de login legacy) — **cero** de solicitar-acceso / approve / onboarding-admin / LoginUniversal.
- Integration real (Postgres+Redis testcontainers): solo `POST /signup-request` (sin auth) + SQL crudo del token. **Nunca el approve con auth ni un handler HTTP autenticado.**
- `admin-signup-requests.test.ts` (approve): inyecta `userContext` a mano en un middleware fake — **nunca pasa por `firebaseAuthMiddleware`/`verifyIdToken`**.
- `firebase-auth.test.ts` (el test del propio middleware de auth): **stubea `verifyIdToken`** — ni ahí se valida un JWT real.
- Frontend: `LoginUniversal.test.tsx` reemplaza `fetch` global por spy; `platform-admin-signup-requests.test.tsx` **mockea `ProtectedRoute` (el guard de auth) a passthrough**.

**Consecuencia crítica**: 121 unit api + 17 web verdes, pero **ningún test recorre el camino que un usuario/admin real recorre, incluida la autenticación**. Por eso los Gaps A/B/C — que solo aparecen al autenticarse de verdad en prod — **nunca fueron atrapados por CI verde**. Los tests validan cada ladrillo aislado; **nadie prueba que la pared se sostiene**.

---

## 5. Clasificación consolidada de los gaps

| # | Gap | Clase | Punto exacto de ruptura |
|---|---|---|---|
| A | No hay bootstrap del primer platform admin | **Diseño** (provisioning manual asumido) | Ausencia total; ADR-052 lo da por precondición |
| B | El login desplegado (RUT+clave) no da sesión de email real al admin | **Diseño** (superficie de login) + posible **deploy/caché** (`?legacy=1` no funcionó, causa no cerrada) | `login.tsx:61` + `ProtectedRoute.tsx:65-72` (redirect sin `legacy=1`) |
| C | RUT "opcional" sin reparación → 401 permanente en LoginUniversal | **Diseño** (dato requerido tratado como opcional) | `OnboardingForm.tsx:306` + `onboarding.ts:230` + ausencia de endpoint de update de `rut` |
| — | Cobertura de tests no ejercita auth real | **Código faltante (tests)** | `apps/web/e2e/` sin specs del alta; approve testeado con auth mockeado |
| — | `signInWithPassword` dev@ falla | **Datos** (password mismatch — recuperable con reset) | secundario, NO es la causa raíz |

**El único ítem de clase "datos"** (el password de dev@) es secundario: aun reseteándolo, los Gaps A/B/C siguen. La causa raíz es **diseño**.

---

## 6. Qué se necesita para que el alta funcione end-to-end (sin proponer implementación aún)

Nombrar lo que falta, para la decisión de producto posterior:

1. **Un mecanismo de bootstrap del platform admin** reproducible y versionado (seed idempotente, o runbook explícito de provisioning en consola Firebase + verificación) — hoy no existe.
2. **Una superficie de login estable y descubrible para el email real del admin** bajo `auth_universal_v1_activated=true`: decidir entre (a) botón Google siempre visible para la allowlist, (b) dar RUT+clave también al admin, o (c) exponer `?legacy=1` como link permanente. Y **cerrar la incertidumbre de por qué `?legacy=1` no funcionó en prod** (verificar bundle/SW desplegado).
3. **Cierre del Gap C**: hacer el RUT requerido en onboarding, o proveer un endpoint/flujo de reparación de `rut` post-onboarding.
4. **Un test E2E real** (Playwright + auth real, o integration con idToken real) que recorra signup-request → approve → onboarding → login, para que este tipo de gap no vuelva a pasar CI verde.

**Para el hito CORFO / informe**: el backend del alta (Meta 1, CRUD+auth) está implementado y verificado a nivel de sus piezas; el flujo end-to-end **no es operable en prod hoy** por el gap de diseño del bootstrap+login del platform admin. Esto se declara como **desviación de diseño** (no de datos), con este documento como evidencia trazada.

---

*Fuentes: `scratchpad/audit-selfservice.md`, `audit-admin-bootstrap.md`, `audit-tests.md` (3 auditorías paralelas read-only, 2026-07-07) + evidencia REST/BD del smoke (`.specs/hito-2-corfo-mes-8/decisiones.md`, secciones de auth admin y evidencia protegida).*
