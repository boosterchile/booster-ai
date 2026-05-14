# Plan técnico — Dashboard observabilidad

**Fecha**: 2026-05-13
**Spec**: [`docs/specs/2026-05-13-observability-dashboard.md`](2026-05-13-observability-dashboard.md)
**Esfuerzo**: ~9.5 días, 1 PR grande con 6 commits atómicos

---

## Arquitectura

```
┌──────────────────────────────────────────────────────┐
│  apps/web  /app/platform-admin/observability         │
│  ├─ Tabs: Costos | Salud | Uso | Capacity | Forecast │
│  ├─ Componentes reusables: KpiCard, TrendChart, HealthIndicator │
│  └─ @tremor/react (UI library admin-grade)           │
└──────────────────────────────────────────────────────┘
                           │
                  HTTPS + Firebase Auth
                           ↓
┌──────────────────────────────────────────────────────┐
│  apps/api  /admin/observability/*  (9 endpoints)     │
│  ├─ requirePlatformAdmin middleware                  │
│  ├─ Redis cache wrapper (TTL configurable)           │
│  └─ services/observability/* (6 clientes)            │
└──────────────────────────────────────────────────────┘
                           ↓
┌──────────────────────────────────────────────────────┐
│  Clientes externos                                   │
│  ├─ BigQuery billing_export    (ADC, fetch directo)  │
│  ├─ Cloud Monitoring API       (ADC, fetch directo)  │
│  ├─ Twilio Usage API           (Account credentials) │
│  ├─ Google Workspace Admin SDK (googleapis + DWD)    │
│  └─ mindicador.cl              (no auth, FX CLP)     │
└──────────────────────────────────────────────────────┘
```

## Archivos a crear/modificar

### Backend (`apps/api`)

| Archivo | Cambio | LOC est. |
|---|---|---|
| `src/middleware/require-platform-admin.ts` | **NEW**: middleware extraído (DRY desde admin-cobra-hoy.ts) | ~30 |
| `src/services/observability/cache.ts` | **NEW**: Redis cache wrapper TTL configurable | ~60 |
| `src/services/observability/fx-rate-service.ts` | **NEW**: mindicador.cl client + cache 1h + fallback 940 | ~70 |
| `src/services/observability/costs-service.ts` | **NEW**: BigQuery client + parsers (top SKUs, by-service, trend, by-project) | ~250 |
| `src/services/observability/monitoring-service.ts` | **NEW**: Cloud Monitoring API client (uptime, latency, CPU, RAM, RPS) | ~200 |
| `src/services/observability/twilio-usage-service.ts` | **NEW**: Twilio Usage Records + Account Balance | ~120 |
| `src/services/observability/workspace-service.ts` | **NEW**: Admin SDK subscriptions + license assignments | ~150 |
| `src/services/observability/forecast-service.ts` | **NEW**: extrapolación lineal + edge cases | ~80 |
| `src/services/observability/health-checks-service.ts` | **NEW**: composite que orquesta uptime checks → semáforo | ~100 |
| `src/routes/admin-observability.ts` | **NEW**: 9 endpoints | ~300 |
| `src/server.ts` | **EDIT**: registrar router | +5 |
| `src/config.ts` | **EDIT**: 5 env vars nuevas | +30 |
| `package.json` | **EDIT**: agregar `googleapis` | +1 dep |

**Tests** (`apps/api/test/unit/observability/`):

| Archivo | Tests | LOC |
|---|---|---|
| `costs-service.test.ts` | 10 (mock fetch BQ + parse) | ~250 |
| `monitoring-service.test.ts` | 8 (mock fetch + parse time series) | ~200 |
| `twilio-usage-service.test.ts` | 5 (mock fetch + balance formatter) | ~120 |
| `workspace-service.test.ts` | 5 (mock googleapis SDK) | ~150 |
| `forecast-service.test.ts` | 6 (edge cases: día 1, día 31, NaN) | ~120 |
| `cache.test.ts` | 4 (TTL, miss, hit, error) | ~100 |
| `fx-rate-service.test.ts` | 4 (success, cache hit, API down → fallback) | ~80 |
| `require-platform-admin.test.ts` | 3 (admin ok, no admin 403, no auth 401) | ~70 |

`apps/api/test/integration/admin-observability.test.ts`: 9 endpoints × 3 escenarios (auth, no-auth, admin allowlist) = ~27 tests.

### Frontend (`apps/web`)

| Archivo | Cambio | LOC est. |
|---|---|---|
| `src/routes/platform-admin-observability.tsx` | **NEW**: main route + tabs orchestration | ~250 |
| `src/components/observability/CostsTab.tsx` | **NEW** | ~250 |
| `src/components/observability/HealthTab.tsx` | **NEW** | ~200 |
| `src/components/observability/UsageTab.tsx` | **NEW** | ~250 |
| `src/components/observability/CapacityTab.tsx` | **NEW** | ~200 |
| `src/components/observability/ForecastTab.tsx` | **NEW** | ~150 |
| `src/components/observability/KpiCard.tsx` | **NEW**: reusable card con value + delta | ~80 |
| `src/components/observability/TrendChart.tsx` | **NEW**: wrapper recharts/tremor LineChart | ~100 |
| `src/components/observability/HealthIndicator.tsx` | **NEW**: dot 🟢🟡🔴 + tooltip | ~50 |
| `src/components/observability/CurrencyValue.tsx` | **NEW**: format CLP con thousands + delta% color | ~50 |
| `src/hooks/use-observability-costs.ts` | **NEW**: TanStack Query hooks (5) | ~150 |
| `src/hooks/use-observability-monitoring.ts` | **NEW** | ~120 |
| `src/routes/platform-admin.tsx` | **EDIT**: agregar card "Observabilidad" en grid de admin | +20 |
| `src/router.tsx` o `src/main.tsx` | **EDIT**: registrar route | +5 |
| `package.json` | **EDIT**: agregar `@tremor/react` + `recharts` (dep transitiva) | +2 deps |

**Tests**:

| Archivo | Tests | LOC |
|---|---|---|
| `src/routes/platform-admin-observability.test.tsx` | 6 (renders, tabs switching, error states, auth required) | ~250 |
| `src/components/observability/*.test.tsx` (4 archivos) | 4×3 tests cada uno (renders, deltas, empty state) | ~120 ea |

### Infra (`infrastructure/`)

| Archivo | Cambio |
|---|---|
| `variables.tf` | Add `observability_dashboard_activated` (default true), `google_workspace_domain`, `google_workspace_price_per_seat_usd_standard/plus/enterprise` |
| `compute.tf` (module `service_api`) | Inject env vars + secret `google-workspace-admin-credentials` |
| `iam.tf` | Grant `roles/bigquery.dataViewer` al SA `cloud_run_runtime` sobre dataset `billing_export` (scoped, no project-wide) |
| `security.tf` | Add secret `google-workspace-admin-credentials` para domain-wide delegation JSON |

### Documentation

| Archivo | Cambio |
|---|---|
| `docs/specs/2026-05-13-observability-dashboard.md` | (existe) |
| `docs/specs/2026-05-13-observability-dashboard-plan.md` | (este) |
| `apps/api/src/services/observability/README.md` | **NEW**: arquitectura + caching + adding nuevo provider |
| `docs/runbooks/2026-05-13-workspace-admin-sdk-setup.md` | **NEW**: paso a paso config Google Workspace Domain-Wide Delegation (acción manual del PO) |

---

## Orden de commits

Cada commit compila + tests pass. 1 PR con 6 commits secuenciales.

### C1: deps + env vars (~30 min, foundation)

- `apps/web/package.json`: `@tremor/react`
- `apps/api/package.json`: `googleapis`
- `apps/api/src/config.ts`: 5 env vars nuevas (zod schema)
- `infrastructure/variables.tf`: variables nuevas con defaults seguros
- `infrastructure/compute.tf`: inject env vars al service_api
- `pnpm install`, `pnpm typecheck` — debe pasar
- Commit: `chore(observability): scaffold deps + env vars`

### C2: middleware + cache + fx + tests (~1 día)

- `src/middleware/require-platform-admin.ts` + test (extract de admin-cobra-hoy)
- `src/services/observability/cache.ts` + test (Redis TTL wrapper)
- `src/services/observability/fx-rate-service.ts` + test
- Commit: `feat(observability): admin middleware + cache + FX client`

### C3: providers GCP + Twilio + Workspace + tests (~2 días)

- `costs-service.ts` + test (BigQuery)
- `monitoring-service.ts` + test (Cloud Monitoring)
- `twilio-usage-service.ts` + test
- `workspace-service.ts` + test (googleapis Admin SDK)
- `forecast-service.ts` + test
- `health-checks-service.ts` + test
- Commit: `feat(observability): clientes BigQuery + Monitoring + Twilio + Workspace + forecast`

### C4: router + 9 endpoints + integration tests (~1 día)

- `src/routes/admin-observability.ts` (9 endpoints)
- `src/server.ts`: registrar router
- `infrastructure/iam.tf`: BigQuery role al SA
- `test/integration/admin-observability.test.ts`
- Commit: `feat(observability): router /admin/observability/* con 9 endpoints`

### C5: frontend componentes + hooks (~1 día)

- Componentes reusables (`KpiCard`, `TrendChart`, `HealthIndicator`, `CurrencyValue`)
- Hooks `use-observability-*` (TanStack Query)
- Skeleton de route `platform-admin-observability.tsx` con 5 tabs vacíos
- Tests unitarios de los componentes
- Commit: `feat(observability): UI components + hooks TanStack Query`

### C6: 5 tabs implementados + E2E + activation (~2 días)

- CostsTab, HealthTab, UsageTab, CapacityTab, ForecastTab
- Update `platform-admin.tsx` (sidebar/cards link)
- E2E Playwright: navegar como admin, validar carga
- Smoke test prod post-deploy
- Commit: `feat(observability): 5 tabs Costos+Salud+Uso+Capacity+Forecast`

**Total commits**: 6 · **PR único** con título `feat(observability): dashboard platform-admin con costos+uso+salud+forecast`

---

## Riesgos técnicos + mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Google Workspace Admin SDK requiere Domain-Wide Delegation** (config manual en Workspace Admin Console por el PO) | Alta | Bloquea Workspace tab si no se configura | Runbook detallado + fallback a "Workspace data unavailable" graceful en UI |
| **BigQuery query sin filtro temporal scan completo** | Media | Costo $5+/query | Validación zod obligatoria de `from/to` en endpoints; max range 90d |
| **mindicador.cl down** | Baja | FX stale o roto | Fallback hardcoded a 940 + cache 24h del último valor exitoso |
| **Cloud Monitoring quota (6k qpm)** | Baja | 429 errors | Cache 1min + coalesce widgets multi-query en paralelo controlado |
| **Twilio API auth complica si no usa env vars existentes** | Baja | No carga tab Uso/Twilio | Reusar `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` ya configurados |
| **@tremor/react CSS conflicta con design system actual** | Baja | UI fea | Scoping CSS via wrapper component + override de colors Booster (verde) |
| **TanStack Query refetch al re-focus tab → tormenta de queries** | Media | Hits a BQ caros | `staleTime: 5min` + `refetchOnWindowFocus: false` para queries pesadas |
| **`googleapis` package pesa ~10MB en deps** | Baja | apps/api Docker image más grande | Aceptable; ya tenemos `@google-cloud/*` similares en deps |
| **CC Booster en Workspace billing API es 0% automático** | Alta | Precios hardcoded por env var (PO actualiza si cambian) | Configurable via env vars, documentado en runbook |

---

## Dependencias nuevas

### `@tremor/react` (apps/web) — ~150kb minified gzipped

**Justificación**:
- Componentes admin-grade out-of-box: `Card`, `Metric`, `LineChart`, `BarChart`, `Badge`, `Tab`, `Table`, `ProgressBar`
- Ahorra ~3 días de dev vs construir cards/charts custom
- Solo se carga en `/app/platform-admin/observability` (admin-only route, raras visitas)
- Sin alternativa nativa de Booster — no existe lib charts en el repo

**Alternativa descartada**: `recharts` solo (~80kb) requiere construir KPI cards + tables + badges custom (~3 días extra).

### `googleapis` (apps/api) — ~10MB unpacked

**Justificación**:
- Admin SDK requiere OAuth Domain-Wide Delegation con JWT signing
- Reimplementar manualmente requires google-auth-library (ya tenemos) + JWT signing + retries + manejo errores → 2 días dev
- `googleapis` lo da out-of-box con un import: `google.admin('directory_v1').users.list()`
- Otros packages del repo usan `@google-cloud/*` específicos (kms, pubsub, storage) — `googleapis` es el "directory" missing.

**Alternativa descartada**: implementación manual del SDK Admin Directory v1 con `google-auth-library` (2 días extra, propensa a bugs).

---

## Migraciones BD

**NINGUNA**. El dashboard solo lee de fuentes externas (BQ, Monitoring API, Twilio, Workspace) + cache Redis volátil. No tiene state propio.

---

## Feature flag rollout

- Variable: `OBSERVABILITY_DASHBOARD_ACTIVATED` en `apps/api/src/config.ts` zod schema + `infrastructure/variables.tf`
- Default: `true` (decisión PO 2026-05-13)
- Backend: endpoints retornan 503 con `{ error: 'feature_disabled' }` si flag=false
- Frontend: hook lee `/feature-flags` endpoint (ya existe) — si false, sidebar oculta el link y route redirige a `/app`
- Rollback: cambiar `var.observability_dashboard_activated = false` en `terraform.tfvars` + `terraform apply` (~30s)

---

## Smoke test plan post-deploy

```bash
# 1. health check del nuevo endpoint
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://api.boosterchile.com/admin/observability/health
# Expected: 200

# 2. costs overview (con admin auth)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.boosterchile.com/admin/observability/costs/overview \
  | jq '.cost_clp_month_to_date'
# Expected: número ≠ null si billing_export tiene datos

# 3. UI carga
playwright test apps/web/test/e2e/observability-dashboard.spec.ts
```

---

## Aprobación

- [ ] Felipe Vicencio (PO): aprueba archivos a crear + orden de commits + dependencias nuevas
- [ ] Tras aprobación: ejecutar `/build` con el primer commit (C1).

---

## Pre-condiciones manual del PO antes de C4

(Estas las realiza el PO ANTES de que el deploy del C4 sea funcional. El código tolera el estado de "no configurado" con graceful degradation.)

1. **Google Workspace Admin Console**:
   - Crear Service Account dedicada: `observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com`
   - Habilitar Domain-Wide Delegation
   - En `admin.google.com` → Security → API Controls → Domain-wide Delegation → agregar Client ID con scope `https://www.googleapis.com/auth/admin.directory.subscription.readonly` + `https://www.googleapis.com/auth/admin.directory.user.readonly`
   - Descargar JSON key → subir a Secret Manager con `gcloud secrets versions add google-workspace-admin-credentials --data-file=key.json`
   - Runbook detallado en `docs/runbooks/2026-05-13-workspace-admin-sdk-setup.md`

2. **Twilio** (ya configurado): los secrets `twilio-account-sid` + `twilio-auth-token` ya existen + el SA `cloud_run_runtime` ya tiene acceso. Sin acción adicional.

3. **BigQuery billing_export** (ya creado en sesión 2026-05-13): dataset `booster-ai-494222.billing_export` con los 3 toggles habilitados desde Cloud Console. Datos empezaron a propagar a partir de 2026-05-13 ~13:00 CLT.
