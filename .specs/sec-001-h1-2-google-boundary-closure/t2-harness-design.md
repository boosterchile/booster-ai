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

## Falta (chunk autónomo para implementar T2)
1. `apps/api/scripts/check-route-default-deny.ts`: enumeración multi-línea + `ROUTE_CLASSIFICATION` (arriba) + exit 1 en no-clasificados. Exportar funciones puras.
2. Test (spec **T15**): (a) `server.ts` actual → pasa (todos clasificados); (b) un factory ficticio montado sin clasificar → falla. + verificar los 6 mounts pendientes.
3. Wire en CI (`.github/workflows/ci.yml` o el job de checks).
4. Coverage ≥80% en las funciones puras (SC-G9).

Estimación: ~100-120 LOC harness + ~50 test. ≤2 commits.
