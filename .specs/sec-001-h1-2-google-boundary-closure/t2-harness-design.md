# T2 — Diseño del harness default-deny (SC-G1b) — checkpoint

- **Spec**: [`spec.md`](./spec.md) SC-G1b · **Plan**: [`plan.md`](./plan.md) T2 · **Branch**: `feat/sec-001-boundary-closure`
- **Estado**: **diseño + enumeración COMPLETOS**; falta codear `check-route-default-deny.ts` + test (chunk autónomo).

## Diseño (resuelve la objeción P1-1 del DA R2)
El check de referencia `check-is-demo-wire-completeness.ts` solo escanea `app.use(...)` (line-based) → no ve `app.route()` ni `<router>.route()` sub-mounts. **Decisión**: clasificar **por factory `create*Routes`** — cada módulo de ruta se monta vía `.route('<path>', createXxx(...))`, clave **única y estable**. El harness:
1. Lee `server.ts` como string (regex **multi-línea**, no line-based — grep perdía ~14 mounts).
2. Enumera todo `\.route\(\s*'…'\s*,\s*(create[A-Za-z]+|[a-z]\w*Router)\b`.
3. Default-deny: **cada factory enumerado DEBE estar en `ROUTE_CLASSIFICATION`**; si aparece uno nuevo sin clasificar → **exit 1** (falla el build). Esto fuerza a clasificar cada mount nuevo (incl. sub-mounts) — la invariante durable que reemplaza el backstop creation-time.
4. Router-vars (`meRouter`, `assignmentsRouter`, `chatRouter`) se mapean a su prefijo (`app.route('/me', meRouter)`) y sus `.route()` internos se resuelven al prefijo.

## ROUTE_CLASSIFICATION (36 factories + 3 router-mounts) — del audit T1
**ENFORCED** (userContext precede el mount): `createMePushSubscriptionRoutes`, `createCobraHoyMeRoutes`, `createMeLiquidacionesRoutes`, `createOfferRoutes` (/offers), trip-requests-v2, `createAdminCobraHoyRoutes`, `createAdminStakeholderOrgsRoutes`, `createAdminSignupRequestsRoutes`, `createAdminLiquidacionesRoutes`, `createAdminMatchingBacktestRoutes`, `createAdminObservabilityRoutes`, `createAdminDispositivosRoutes`, `createSiteSettingsRoutes`, `createAdminSeedRoutes`, `createVehiculosRoutes`, `createConductoresRoutes`, `createSucursalesRoutes`, `createDocumentosRoutes`, `createCumplimientoRoutes`, `createCobraHoyAssignmentsRoutes`, `assignmentsRouter`+`chatRouter` (bajo /assignments userContext).

**GATED-CLOSED** (bare firebaseAuth, gate in-handler): `meRouter`/`createMeRoutes` (root; firebase_uid + allowlist), `createMeConsentsRoutes`, `createMeClaveNumericaRoutes`, `createEmpresaRoutes` (flag self-serve OFF).

**INTENTIONAL-OPEN** (público por diseño): `createHealthRouter`, `createHealthSignupFlowRouter`, `createFeatureFlagsRoutes`, `createSignupRequestRoutes`, `createPublicSiteSettingsRoutes`, `createPublicTrackingRoutes`, `createWebpushPublicRoutes` (vapid público), `createAuthUniversalRoutes`/`createDriverAuthRoutes`/`createDemoLoginRoutes`/`createDemoCacheWarmRoutes` (login/demo — **VERIFICAR mount exacto al codear**, son emisores de auth o demo).

**MIXED**: `createCertificatesRoutes` (mount con userContext en `:477` + skip-auth para `/verify` público — ADR-015). Clasificar MIXED con rationale: el `/verify` público es read-only por diseño.

**INTERNAL** (SA/cron): `createTripRequestsRoutes` (OIDC SA `authMiddleware`), `createAdminJobsRoutes` (cronAuth).

> ⚠️ Al codear: **verificar el mount exacto** de los 6 marcados (auth-universal, driver-auth, demo-login, demo-cache-warm, public-tracking, webpush-public) — clasificados INTENTIONAL-OPEN por evidencia (login/demo/público) pero no auditados línea-a-línea en T1 (que fue group-level). No asumir; confirmar middleware chain.

## Implementado (✅ DONE 2026-06-04)
1. ✅ `apps/api/scripts/check-route-default-deny.ts`: enumeración multi-línea (`enumerateRouteMounts`) + `ROUTE_CLASSIFICATION` (40 entradas) + `evaluateRoutes` (agregación pura) + exit 1 en no-clasificados/stale/sin-rationale. Funciones puras exportadas.
2. ✅ Test `check-route-default-deny.test.ts` (24 casos): (a) server.ts real → 0 sin clasificar / 0 stale; (b) factory ficticio + sub-mount `<router>.route()` ficticio → flagged (T15); (c) los 6 mounts marcados = INTENTIONAL-OPEN. Funciones puras 100% cubiertas.
3. ✅ Wire en `.github/workflows/security.yml` job `route-default-deny` (espejo de `is-demo-wire-completeness`).
4. ✅ SC-G9: las funciones puras están 100% cubiertas; `main()` (CLI glue) queda fuera del gate `coverage.include: ['src/**/*.ts']` — `scripts/` no se mide, igual que `check-is-demo-wire-completeness.ts` y `src/jobs/**`.

**Conteo final**: 40 mounts (no 39: el design estimó "36 factories + 3 router-mounts"; el código vivo tiene 37 factories directos en `.route()` + 3 router-vars `meRouter`/`assignmentsRouter`/`chatRouter`). Enumeración contra código vivo es la fuente de verdad.
