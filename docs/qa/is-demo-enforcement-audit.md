# Audit: is-demo enforcement coverage (Sprint 2b T2a)

> **Generado**: 2026-05-26 contra `main` HEAD (`aed2572` feat(api) T1 commit + amendments).
>
> **Spec**: `.specs/sec-001-cierre/spec.md` §3 H1.3 SC-1.3.1..1.3.8 (v3.4 amendment 2026-05-25).
>
> **Plan**: `.specs/sec-001-cierre/plan-sprint-2b.md` §3 T2a + T3.
>
> **Generador**: este doc enumera los mount points auth-required de `apps/api/src/server.ts` para que **T3** wire `isDemoEnforcementMiddleware` en cada uno con el modo correcto. Re-generable via los comandos abajo.

## 1. Inventario de mutations (grep canónico)

Comando canónico (per spec SC-1.3.4):

```bash
grep -rE "app\.(post|put|patch|delete)" apps/api/src/routes/ | wc -l
```

Resultado **2026-05-26** contra `main` HEAD: **59 declaraciones** de mutation handlers (POST/PUT/PATCH/DELETE) distribuidas en 26 archivos.

Top archivos (re-ejecutable con `grep -rE "app\.(post|put|patch|delete)" apps/api/src/routes/ -c | sort -t: -k2 -n -r`):

| Archivo | Mutations |
|---|---|
| `routes/documentos.ts` | 6 |
| `routes/site-settings.ts` | 4 |
| `routes/chat.ts` | 4 |
| `routes/assignments.ts` | 4 |
| `routes/admin-jobs.ts` | 4 |
| `routes/vehiculos.ts` | 3 |
| `routes/trip-requests-v2.ts` | 3 |
| `routes/sucursales.ts` | 3 |
| `routes/conductores.ts` | 3 |
| `routes/admin-stakeholder-orgs.ts` | 3 |
| `routes/webpush.ts`, `routes/offers.ts`, `routes/me.ts`, `routes/me-consents.ts`, `routes/admin-seed.ts`, `routes/admin-dispositivos.ts` | 2 cada uno |
| `routes/trip-requests.ts`, `routes/me-clave-numerica.ts`, `routes/empresas.ts`, `routes/demo-login.ts`, `routes/cobra-hoy.ts`, `routes/auth-universal.ts`, `routes/auth-driver.ts`, `routes/admin-matching-backtest.ts`, `routes/admin-liquidaciones.ts`, `routes/admin-cobra-hoy.ts` | 1 cada uno |

## 2. Matrix de coverage por mount point

Cada fila representa un `app.route(...)` o `app.use(...)` registrado en `server.ts`. **Total auth-required (Firebase): 22 mount points.** T3 wireará `isDemoEnforcementMiddleware` en cada uno.

**Convenciones columna "Aplicación middleware T3"**:

- `requireNotDemo (default)` — block POST/PUT/PATCH/DELETE; allow GET/HEAD/OPTIONS.
- `requireNotDemoOrSandbox` — passthrough si `persona=stakeholder`; else `requireNotDemo` semantics. Para endpoints que demo-stakeholder consume read-only por contrato (ADR-034).
- `explicitAllow (path-X)` — passthrough solo si `(path, method)` está en `ALLOWLISTED_PATHS`. Default-deny. Para endpoints demo-by-design.
- `bypass (sin auth)` — no aplica: el path es público o usa OIDC SA-to-SA (Firebase claim ausente → middleware passthrough by design).

### 2.1 Mount points públicos (sin firebase-auth — bypass natural)

| Path | server.ts | Auth tipo | Aplicación middleware T3 |
|---|---|---|---|
| `/` (health/ready) | 149 | público | bypass (sin claim is_demo) |
| `/webpush/vapid-public-key` | 153-160 | público | bypass (sin claim is_demo) |
| `/feature-flags` | 166 | público | bypass + entry `explicitAllow` preempty para GET (per T3 acceptance, en caso futuro de wire-global) |
| `/demo/login` (POST) | 176-179 | público + flag DEMO_MODE | entry `explicitAllow (POST /demo/login)` per T3 acceptance |
| `/api/v1/demo/cache-warm/:persona` | 184-192 | público IP rate-limit | entry `explicitAllow (POST /api/v1/demo/cache-warm/:persona)` per T3 acceptance |
| `/public/tracking` | 204-211 | público (UUID v4) | bypass (sin claim is_demo) |
| `/public/site-settings` | 441 | público | bypass (sin claim is_demo) |
| `/api/v1/signup-request` | (Sprint 2b T8) | público IP rate-limit | entry `explicitAllow (POST /api/v1/signup-request)` preempty per T3 acceptance |
| `/trip-requests` (legacy v1, OIDC SA) | 220-221 | OIDC SA-to-SA | bypass (caller es SA, sin claim is_demo) |
| `/admin/jobs` (OIDC SA cron) | 329-342 | OIDC SA-to-SA | bypass (caller es SA, sin claim is_demo) |
| `/auth/driver-activate` (POST) | 531-539 | público RUT rate-limit | bypass (sin firebase token al llamar) |
| `/auth/login-rut` (POST) | 546-549 | público clave numérica | bypass (sin firebase token al llamar) |
| `/certificates/:id/verify` (GET) | 392-403 (conditional skip) | público (verify by UUID) | bypass (skip explícito firebaseAuth en handler) |

### 2.2 Mount points auth-required Firebase (firebase-auth + demo-expires applied) — **T3 target**

| # | Path | server.ts | Aplicación middleware T3 (propuesta) | Rationale |
|---|---|---|---|---|
| 1 | `/me` | 242 | `requireNotDemo` | GET /me read-only OK; POST/PATCH bloquean profile mutations en demo. |
| 2 | `/me/*` | 243 | `requireNotDemo` | hereda. |
| 3 | `/me/push-subscription` + `/*` | 250-251 | `requireNotDemo` | POST subscribe es write; bloquear en demo. |
| 4 | `/me/cobra-hoy/*` | 263 | `requireNotDemo` | adelantos financieros — write bloqueado en demo. |
| 5 | `/me/liquidaciones` | 267 | `requireNotDemo` | read-only GET aplica passthrough; sin writes activos. |
| 6 | `/empresas/*` | 274 | `requireNotDemo` | onboarding/CRUD empresa — write bloqueado en demo. |
| 7 | `/trip-requests-v2/*` | 294-295 | `requireNotDemoOrSandbox` | demo-stakeholder lee trip data read-only; demo-shipper/carrier no mutan. |
| 8 | `/offers/*` | 308-309 | `requireNotDemo` | accept/reject offer es write crítico de negocio; bloquear demo. |
| 9 | `/assignments/*` | 355-356 | `requireNotDemoOrSandbox` | demo-stakeholder lee asignaciones read-only; demo-carrier no muta. |
| 10 | `/certificates/*` (excluye `/:id/verify` GET) | 392-403 | `requireNotDemoOrSandbox` | demo-stakeholder lee certificados ESG; sin mutations en demo. |
| 11 | `/admin/dispositivos-pendientes/*` | 407-408 | `requireNotDemo` | admin device approval — demo no debe ver/modificar prod inventory. |
| 12 | `/admin/cobra-hoy/*` | 417-418 | `requireNotDemo` | platform-admin pagos financieros — demo bloqueado. |
| 13 | `/admin/stakeholder-orgs/*` | 423-424 | `requireNotDemoOrSandbox` | demo-stakeholder lee sus propios orgs; no mutates. |
| 14 | `/admin/site-settings/*` | 430-431 | `requireNotDemo` | admin marca + copy — demo no debe modificar site config. |
| 15 | `/admin/liquidaciones/*` | 446-447 | `requireNotDemo` | re-emisión DTE — demo bloqueado. |
| 16 | `/admin/seed/*` | 451-452 | `requireNotDemo` | seed/wipe demo — paradójico permitir desde sesión demo. |
| 17 | `/admin/matching/*` | 459-460 | `requireNotDemo` | backtest matching — read-heavy pero bloquea writes accidentales. |
| 18 | `/admin/observability/*` | 490-491 | `requireNotDemoOrSandbox` | dashboards read-only para stakeholders sandbox; no writes en demo. |
| 19 | `/vehiculos` + `/*` | 501-504 | `requireNotDemo` | CRUD vehículos — write bloqueado en demo (read GET pasa). |
| 20 | `/conductores` + `/*` | 510-513 | `requireNotDemo` | CRUD conductores — write bloqueado en demo. |
| 21 | `/sucursales` + `/*` | 552-555 | `requireNotDemo` | CRUD sucursales — write bloqueado en demo. |
| 22 | `/documentos/*` | 559-560 | `requireNotDemo` | docs compliance — write bloqueado en demo. |
| 23 | `/cumplimiento` + `/*` | 562-565 | `requireNotDemoOrSandbox` | dashboards compliance read-only para stakeholders sandbox. |

**Conteo final**: 22 grupos auth-required Firebase (T3 plan dijo "~20"; el 22 actual está dentro del rango ~20 ±2). **0 grupos sin cobertura propuesta**.

### 2.3 Allowlist inicial T3 (entries propuestas)

Estas entries deben aparecer en `apps/api/src/middleware/is-demo-allowlist.ts` post-T3:

| Path | Methods | Rationale | REVIEW_BY |
|---|---|---|---|
| `/demo/login` | POST | demo login endpoint mintea token por diseño; demo session válida solo post-login | 2026-08-25 |
| `/api/v1/demo/cache-warm/:persona` | POST | pre-warm cache fire-and-forget desde landing demo (Sprint 2a T5) | 2026-08-25 |
| `/feature-flags` | GET | flags fetch read-only boot path para decidir UI; safe en cualquier sesión | 2026-08-25 |
| `/api/v1/signup-request` | POST | signup público sin auth — no aplica is_demo; entry preempty para evitar 403 si wire global aplica | 2026-08-25 |

## 3. Re-ejecución de este audit

Para re-generar contra el `main` actual:

```bash
# Conteo total mutations
grep -rE "app\.(post|put|patch|delete)" apps/api/src/routes/ | wc -l

# Per-file count
grep -rE "app\.(post|put|patch|delete)" apps/api/src/routes/ -c | sort -t: -k2 -n -r

# Mount points en server.ts
grep -nE "app\.route\(|app\.use\('/" apps/api/src/server.ts
```

Si el conteo difiere de **59 / 22 auth-required** o aparecen nuevos mount points sin cobertura: T3 audit-completeness CI gate (`apps/api/scripts/check-is-demo-wire-completeness.ts`) lo flaggea automáticamente. Re-generar este doc antes de hacer merge.

## 4. SC trace

- **SC-1.3.3**: allowlist exists con shape correcto (`apps/api/src/middleware/is-demo-allowlist.ts` T2a + populated T3).
- **SC-1.3.4**: este audit doc, con tabla `path → método → cubierto por`. Inventario re-ejecutado contra main 2026-05-26.
