# Route boundary audit (T1 / SC-G1)

- **Spec**: [`spec.md`](./spec.md) SC-G1 · **Plan**: [`plan.md`](./plan.md) T1
- **Date**: 2026-06-04 · **Branch**: `chore/working-tree-hygiene` (doc; código de T2+ en rama feat)
- **Método**: enumeración de TODOS los mounts en `apps/api/src/server.ts` (`app.use` + `app.route` + `<router>.route` sub-mounts) + su cadena de middleware, leída del código (no muestreo). Verificado contra el código vivo 2026-06-04.

## Vocabulario (SC-G1, definiciones estrictas)
- **ENFORCED**: exige fila `users` resuelta vía `userContextMiddleware` (o membership/role) antes de servir datos/acción.
- **GATED-CLOSED**: bare `firebaseAuth` (sin userContext) PERO el handler/servicio niega/no-opera para un token no-provisionado (resolución por `firebase_uid` → 404, allowlist, o flag). No sirve datos ni otorga privilegio sin ese gate.
- **INTENTIONAL-OPEN**: público por diseño; no sirve datos sensibles ni otorga privilegio.
- **INTERNAL**: auth de servicio (OIDC SA) o cron (no end-user).
- **GAP**: ruta de negocio en bare token sin gate → a corregir.

## Tabla de auditoría

| Mount | Middleware chain | Veredicto | Nota |
|---|---|---|---|
| `/` (health) `:156` | ninguno | INTENTIONAL-OPEN | liveness |
| `/health/*` `:162` | ninguno | INTENTIONAL-OPEN | signup-flow health |
| `/feature-flags` `:179` | ninguno | INTENTIONAL-OPEN | flags públicos |
| `/api/v1/signup-request` `:225-226` | rateLimitSignup | INTENTIONAL-OPEN | submission pública, 202 anti-enumeration; no otorga nada |
| `/trip-requests` `:253-254` | `authMiddleware` (OIDC SA, `ALLOWED_CALLER_SA`) | INTERNAL | service-to-service |
| `/me` (root) `:290,317` | firebaseAuth + demo + is-demo | **GATED-CLOSED** | `createMeRoutes` resuelve por `firebase_uid`; **escribe** (account-link `me.ts:79-83`; auto-provision platform-admin `me.ts:102-123` **gateado por allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`** `config.ts:611` default-vacío). NO read-only (corrección DA R2). |
| `/me/push-subscription` `:298-301` | + userContext | ENFORCED | |
| `/me/consents` `:304` | firebaseAuth (sub-mount) | **GATED-CLOSED** | resuelve userId por `firebase_uid` (`me-consents.ts:118` → 404 si no hay fila) |
| `/me/clave-numerica` `:309` | firebaseAuth (sub-mount) | **GATED-CLOSED** | resuelve por `firebase_uid` (`me-clave-numerica.ts:68-74` → 404) |
| `/me/cobra-hoy/*` `:311-312` | + userContext | ENFORCED | |
| `/me/liquidaciones` `:315-316` | + userContext | ENFORCED | |
| `/empresas/*` `:322-335` | firebaseAuth + demo + is-demo (sin userContext) | **GATED-CLOSED** | self-serve **OFF**: flag `EMPRESA_SELF_ONBOARDING_ENABLED` default-false unset en prod → `empresas.ts:53` 403 + invariante servicio `SelfOnboardingDisabledError`. Único caller usa `authorizedBy='self_service'`; NO existe path `admin_provisioned` reachable. |
| `/trip-requests-v2` `:354-361` | + userContext | ENFORCED | |
| `/offers` `:373-380` | + userContext | ENFORCED | |
| `/admin/jobs` `:399-400` | `cronAuthMiddleware` | INTERNAL | Cloud Scheduler OIDC |
| `/assignments` (+chat, cobra-hoy) `:425-453` | + userContext | ENFORCED | |
| `/certificates/*` `:467-489` | custom: `/verify` skip-auth (público), resto userContext | INTENTIONAL-OPEN (`/verify`) + ENFORCED (resto) | verify de certificados read-only por diseño (ADR-015). Nota preexistente: `demoExpires` no está en este chain (`:485` comment) — fuera de scope. |
| `/admin/dispositivos-pendientes` `:492-499` | + userContext | ENFORCED | |
| `/admin/cobra-hoy` `:507-514` | + userContext | ENFORCED | |
| `/admin/stakeholder-orgs` `:518-525` | + userContext | ENFORCED | |
| `/admin/signup-requests` `:533-548` | + userContext (+ allowlist downstream) | ENFORCED | flag SIGNUP_REQUEST_FLOW_ACTIVATED in-handler |
| `/admin/site-settings` `:553-567` | + userContext | ENFORCED | |
| `/public` (site-settings) `:569` | ninguno | INTENTIONAL-OPEN | versión publicada, read-only, cache |
| `/admin/liquidaciones` `:574-581` | + userContext (+ allowlist) | ENFORCED | |
| `/admin/seed` `:584-...` | + userContext (+ platform-admin allowlist) | ENFORCED | |
| `/admin/matching` `:~605` | + userContext (+ allowlist) | ENFORCED | |
| `/admin/observability` `:~640` | + userContext (+ allowlist) | ENFORCED | |
| `/vehiculos` `:~656` | + userContext | ENFORCED | |
| `/conductores` `:~675` | + userContext | ENFORCED | |

## Veredicto (SC-G1)

**Cero GAP sin mitigar.** Toda ruta de negocio/admin es **ENFORCED** (userContext) o **GATED-CLOSED** (gate in-handler por `firebase_uid`/allowlist/flag). Las únicas bare-firebaseAuth-sin-userContext son el set deliberado `/me` (root + consents + clave-numerica) y `/empresas`, todas fail-closed/no-op para un token no-provisionado. Públicas (`/`, `/health`, `/feature-flags`, `/api/v1/signup-request`, `/public`, `/certificates/:t/verify`) no sirven datos sensibles ni otorgan privilegio. Internas (`/trip-requests`, `/admin/jobs`) son SA/cron.

→ **SC-G1 satisfecho: no se requiere fix de GAP.** Confirma el hallazgo del DA R2 (el boundary se sostiene post-hotfix).

## Durabilidad (→ T2 / SC-G1b)
Esta auditoría es un snapshot. La invariante se hace **durable** con el harness CI default-deny (T2), que debe enumerar `app.use` + `app.route()` + `<router>.route()` sub-mounts (los GATED-CLOSED viven en sub-mounts `meRouter.route()`) y exigir que todo mount nuevo sea userContext-wired O esté en `ONBOARDING_OR_PUBLIC_ALLOWLIST` con rationale. La allowlist inicial = las filas GATED-CLOSED + INTENTIONAL-OPEN + INTERNAL de esta tabla.

## Mapea a tests del spec
- **T8** (spec): un token no-provisionado → 404 en una ruta representativa por grupo ENFORCED.
- **T15** (spec): el harness (T2) falla el build ante un mount nuevo sin clasificar.
