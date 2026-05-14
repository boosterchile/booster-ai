# Spec — Dashboard de observabilidad de costos y operación

**Fecha**: 2026-05-13
**Autor**: Claude (Opus 4.7) + Felipe Vicencio
**Tipo**: feature nueva, multi-archivo (~15 archivos), cambia contrato de API (nuevos endpoints `/admin/observability/*`)
**ADR referenciado**: encaja en el modelo existente de platform-admin (`apps/api/src/routes/admin-*`, `apps/web/src/routes/platform-admin-*`). No requiere ADR nuevo.

---

## Problema

Hoy no existe una vista consolidada del estado operacional + financiero de Booster. Para responder "¿cuánto gastamos en GCP este mes?", "¿qué servicio está bajo más carga?", "¿quedan tokens Gemini para terminar el mes?", "¿Twilio está funcionando OK?", el PO tiene que abrir manualmente:

- Cloud Console → Billing → Reports (con filtros por SKU + project)
- Cloud Monitoring → Dashboards (latencia, RPS, errores)
- Twilio Console → Usage (mensajes WhatsApp + SMS enviados + saldo)
- BigQuery → queries manuales sobre `billing_export`
- Logs → grep manual de errores

**Evidencia del dolor**:
- Sesión 2026-05-13 (auditoría profunda): el PO descubrió que Booster 2.0 (`big-cabinet-482101-s3`) seguía generando ~$80-150/mes durante meses sin detectar. Sin dashboard, el costo de duplicación pasó inadvertido.
- La auditoría profunda manual tomó ~3 horas. Con dashboard, sería 2 clicks.
- Banner GCP "unrestricted API keys" salió 2 veces sin ningún sistema interno que lo alertara.
- Tras el deploy DR, el log ingest pasó de 2 GB/mes a 149 GB/mes; nadie lo detectó por una semana (solo se vio cuando Claude revisó manualmente).

El sistema necesita que costo + uso + salud sean **visibles continuamente al PO**, no solo cuando alguien pregunta.

---

## Solución propuesta

Nueva sección `/app/platform-admin/observability` (rol: `BOOSTER_PLATFORM_ADMIN_EMAILS` allowlist, mismo patrón que `/app/platform-admin/cobra-hoy` y `/app/platform-admin/matching`) con **5 tabs**:

1. **Costos**: KPIs del mes en curso + trend 90d + top SKUs + breakdown por servicio GCP + costo Twilio.
2. **Salud**: uptime checks status, p95 latency `api/web/marketing`, error rate, BD CPU/RAM, Redis memory, Cloud SQL conexiones activas.
3. **Uso**: Cloud Run RPS por servicio, Pub/Sub messages/lag, Vertex AI Gemini tokens consumidos hoy/mes, Twilio mensajes enviados.
4. **Capacity**: uso real vs límites configurados (RAM Cloud SQL, instances Cloud Run, quota Routes API, etc.) — semáforo verde/amarillo/rojo.
5. **Forecast + Alertas**: extrapolación lineal del costo del mes en curso + lista de Cloud Monitoring alerts activas.

**Backend** (`apps/api`): nuevo router `/admin/observability/*` con 9 endpoints; nuevo package `@booster-ai/observability-providers` con clientes BigQuery (billing GCP), Cloud Monitoring (métricas), Twilio (usage), Google Workspace Admin SDK (seats + license info), FX (tipo de cambio dinámico CLP via mindicador.cl).

**Frontend** (`apps/web`): nueva ruta `/app/platform-admin/observability` + 5 tabs + componentes reusables (`KpiCard`, `TrendChart`, `HealthIndicator`).

**Cache**: TTL 5min en backend para queries BigQuery (caro) + 1min para Cloud Monitoring (barato). Redis-backed.

---

## Criterios de aceptación

Cada criterio es verificable con evidencia objetiva.

### Tab Costos

1. **Cards superior** mostrando:
   - Costo total mes en curso (CLP) con delta vs mes anterior (%) — suma GCP + Twilio + Google Workspace
   - Costo total últimos 30 días (CLP)
   - Top 3 servicios GCP por costo (mes en curso)
   - Costo Twilio mes en curso (USD → CLP convertido a tipo de cambio del día)
   - Costo Google Workspace mes en curso (USD → CLP) — seats activos × plan price/seat
   - Tipo de cambio CLP/USD visible (con fecha del fix vía mindicador.cl)
   **Evidencia**: screenshot de la página con valores ≠ "0" cuando billing_export tenga datos (post 24-48h habilitación).

2. **Gráfico de línea** de costo diario últimos 90 días, agrupable por servicio.
   **Evidencia**: query BQ subyacente retorna data; gráfico renderiza sin errores.

3. **Tabla drilldown** top 20 SKUs ordenado por costo descendente con: SKU, servicio, costo CLP, % del total.
   **Evidencia**: paginable, ordenable por columna.

4. **Comparativa Booster AI vs Booster 2.0** durante el período de duplicación (post-sunset desaparece).
   **Evidencia**: filtro `project.id IN (booster-ai-494222, big-cabinet-482101-s3)` con barras separadas hasta 2026-06-12 (project delete).

### Tab Salud

5. **Status grid** con 8 checks de uptime:
   - api.boosterchile.com/health
   - app.boosterchile.com
   - boosterchile.com (apex)
   - marketing.boosterchile.com (si LB lo sirve)
   - demo.boosterchile.com
   - telemetry-tls.boosterchile.com:5061
   - telemetry-dr.boosterchile.com:5061
   - Cloud SQL connection probe
   Cada uno: 🟢 OK / 🟡 degraded (>p95 baseline) / 🔴 down. Última verificación timestamp.
   **Evidencia**: las URLs reales se chequean via Cloud Monitoring uptime_check resources; status reflejará el último check.

6. **Métricas Cloud SQL** (instancia `booster-ai-pg-07d9e939`):
   - CPU % última hora (línea)
   - RAM % última hora (línea)
   - Conexiones activas
   - Storage GB usado / total (50 GB)
   **Evidencia**: queries a Cloud Monitoring API con metric.type `cloudsql.googleapis.com/database/...`.

7. **Métricas Redis**:
   - Memory usage %
   - Hits/misses ratio
   **Evidencia**: queries `redis.googleapis.com/stats/...`.

### Tab Uso

8. **Cloud Run** por servicio:
   - RPS últimos 60 min
   - p50/p95 latency
   - error rate (5xx)
   - instances actives
   **Evidencia**: cards por servicio (api/web/marketing/whatsapp-bot/etc).

9. **Pub/Sub** topics activos:
   - Mensajes publicados últimas 24h por topic
   - Backlog (mensajes unacked)
   **Evidencia**: tabla con todos los topics + métricas.

10. **Vertex AI Gemini**:
    - Tokens input consumidos hoy + mes
    - Tokens output consumidos hoy + mes
    - Costo estimado mes (USD → CLP)
    **Evidencia**: `aiplatform.googleapis.com/publisher/online_serving/token_count` desde Cloud Monitoring.

11. **Twilio**:
    - Mensajes WhatsApp enviados hoy + mes
    - Mensajes SMS enviados hoy + mes
    - Costo estimado mes
    - Saldo actual de la cuenta
    **Evidencia**: Twilio REST API `Usage.Records` + `Account.Balance`.

11b. **Google Workspace**:
    - Seats activos (por plan): Business Starter / Standard / Plus / Enterprise
    - Cost/seat según plan (configurable env vars `GOOGLE_WORKSPACE_PRICE_PER_SEAT_*`)
    - Costo mensual total estimado USD + CLP
    - Last sync timestamp (Admin SDK)
    **Evidencia**: Google Workspace Admin SDK `subscriptions.list` para licencias activas; pricing por plan en config (Workspace API no expone costo).

### Tab Capacity

12. **Headroom semáforo**:
    - Cloud SQL CPU p99 7d / threshold 70%
    - Cloud SQL RAM p99 7d / threshold 75%
    - Cloud SQL Storage / 80% del disk_size
    - Cloud Run instances max alcanzado / max_instances configurado
    - Vertex AI Gemini quota usage / quota límite
    - Twilio mensajes/día / quota Meta WhatsApp aprobada
    - Routes API requests/día / quota configurada
    Cada uno: 🟢 < 60% / 🟡 60-80% / 🔴 > 80%.
    **Evidencia**: cards con valor + threshold visible + color.

### Tab Forecast + Alertas

13. **Forecast costo mes**: extrapolación lineal del costo running × (días totales / días transcurridos). Mostrar también histórico de los 3 meses previos para sanity check.
    **Evidencia**: número estimado con disclaimer del método (lineal, no ML).

14. **Cloud Monitoring alerts activas**: lista con: nombre, severity, condition, when fired, current value.
    **Evidencia**: API `monitoring.googleapis.com/v3/projects/.../alertPolicies` filtrada por `enabled=true` + estado.

15. **Budget status**: progreso del mes vs `var.monthly_budget_usd` (default $500 según `variables.tf`). Barra de progreso + color.

### Cross-cutting

16. **Auth**: el endpoint y la página rechazan acceso de usuarios NO en `BOOSTER_PLATFORM_ADMIN_EMAILS` con 401/403, mismo patrón que `admin-cobra-hoy.ts:90`.
    **Evidencia**: test unit que verifica el rechazo.

17. **Cache**: queries BigQuery se cachean 5 min en Redis (compartido entre instances Cloud Run); Cloud Monitoring queries se cachean 1 min.
    **Evidencia**: log de hit/miss rate accesible vía métricas custom.

18. **Performance**: la página inicial carga en < 3s con cache caliente.
    **Evidencia**: smoke test Playwright timing.

19. **i18n**: todo el texto en español (CLAUDE.md regla de UI). Números formateados con thousands separator `.` (Chile).
    **Evidencia**: code review + visual.

20. **Mobile responsive**: la página funciona en pantalla 375px ancho (iPhone SE).
    **Evidencia**: Playwright snapshot a 375px width.

---

## No goals (scope creep prevention)

Lo que esta spec **NO** cubre:

- **Cost attribution per-tenant (empresa)**: requiere labeling de Cloud Run revisions por empresa, no factible sin re-arquitectura. Follow-up.
- **Forecasting con ML/ARIMA**: solo extrapolación lineal del mes en curso. Más sofisticado puede venir cuando haya 6+ meses de billing data.
- **Alertas configurables por usuario**: solo se muestran las alerts que ya existen en Cloud Monitoring (configuradas via Terraform `monitoring.tf`). Configurar nuevas alerts desde la UI es follow-up.
- **Export PDF/Excel del dashboard**: solo vista web, no descargas. Si se necesita exportar, captura screenshot manual.
- **Histórico previo a 2026-05-13**: BigQuery billing_export se habilitó en esa fecha. Datos previos no están disponibles. La comparativa de Booster 2.0 vs AI solo cubre el período disponible.
- **Cobertura de servicios fuera de GCP+Twilio+Workspace**: no incluye AWS, GitHub, etc. Booster opera solo en GCP+Twilio+Workspace per inventario actual.
- **Workspace usage breakdown por usuario individual**: solo seats agregados por plan. Atribución usuario-a-usuario es PII innecesaria para vista financiera.
- **Workspace billing 100% automatizado**: Workspace API NO expone precios productivos. El cost/seat va por env var configurable. Si Google cambia precios, el PO actualiza el env. Trade-off aceptado.
- **Notificaciones push/email del dashboard**: las alertas ya tienen `email_alerts` notification channel; el dashboard solo lee, no crea alerts ni notifica.

---

## Riesgos + mitigaciones

| Riesgo | Mitigación |
|---|---|
| Queries BigQuery costosas si se llaman sin filtro temporal | Backend obliga `from/to` parameter; default últimos 30d; cache 5min Redis |
| Twilio API rate limits (100 req/s con account credentials) | Cache 5min de `Usage.Records`; `Account.Balance` cache 15min |
| Cloud Monitoring API quotas (6k queries/min por project) | Cache 1min agregado; coalesce dashboards multi-widget en N queries paralelas |
| Datos faltantes los primeros 24-48h (billing_export aún no popula) | UI muestra "datos aún propagando" state; no error |
| BOOSTER_PLATFORM_ADMIN_EMAILS comprometido = ve toda la financiera | Allowlist en var (no cambia sin TF apply); audit log de cada acceso al dashboard (Cloud Audit Logs) |
| Forecast lineal sesga al alza si hay spike inicial del mes | Disclaimer visible "extrapolación lineal" + comparar con histórico |
| Dashboard rompe si Twilio API down | Tab Uso muestra error específico, no crashea toda la página |

---

## Plan de testing

### Unit tests (`apps/api/test/unit/observability/`)

- `costs-service.test.ts`: query builder + parser de BQ response. Mock fetch. ~10 tests.
- `monitoring-service.test.ts`: Cloud Monitoring API parser. Mock fetch. ~8 tests.
- `twilio-usage-service.test.ts`: Twilio API parser + balance formatter. Mock fetch. ~5 tests.
- `forecast-service.test.ts`: extrapolación lineal con edge cases (mes en día 1, mes en día 31, NaN). ~6 tests.
- `cache.test.ts`: Redis cache wrapper TTL. ~4 tests.
- `auth-middleware.test.ts`: rechazo a no-admins. ~3 tests.

Total: ~36 unit tests, coverage >85% del módulo.

### Integration tests

- `observability-routes.test.ts` (apps/api/test/integration/): cada endpoint responde 200 con auth válida, 401 sin auth, 403 con auth de no-admin.

### E2E (Playwright)

- `observability-dashboard.spec.ts`:
  - Login con admin → la sección aparece en sidebar
  - Tab "Costos" renderiza cards sin errors en consola
  - Tab "Salud" todos los indicadores se cargan en <5s
  - Login con NO admin → la sección NO aparece (o aparece deshabilitada)

### Smoke production

- Health check del nuevo endpoint `/admin/observability/health` debe responder 200 al SA admin.

---

## Rollout

1. **Feature flag**: `OBSERVABILITY_DASHBOARD_ACTIVATED` (default `true` en `variables.tf`, decision PO 2026-05-13).
2. **Sprint W1**: implementación completa + smoke tests + activación inmediata al merge.
3. **Acceso**: solo `BOOSTER_PLATFORM_ADMIN_EMAILS` (Felipe + futuros admins). El resto de usuarios ni ve el link en sidebar.
4. **Rollback**: flag a `false` en 1 commit + apply. Page redirige a `/app` con toast "feature deshabilitada".
5. **Monitoring del propio dashboard**: agregar uptime check para `/admin/observability/health` + alerta si responde 5xx >5min.

---

## Estimación de esfuerzo

| Componente | Días |
|---|---|
| Package `@booster-ai/observability-providers` (5 clientes: BQ + Monitoring + Twilio + Workspace + FX + cache) | 2.5 |
| Backend routes `/admin/observability/*` (9 endpoints) | 2 |
| Frontend route + 5 tabs + componentes reusables | 3 |
| Tests unit + integration + E2E | 1.5 |
| Documentación + smoke tests prod | 0.5 |
| **Total** | **~9.5 días** |

Cabe dentro de un sprint de 2 semanas (10 días hábiles) con buffer del 5%.

**Decisiones PO 2026-05-13** aprobadas:
- ✅ Agregar Google Workspace (Admin SDK + cost/seat config)
- ✅ FX dinámico (mindicador.cl, cache 1h, dólar observado Chile)
- ✅ Feature flag default `true` (activación día 1)
- ✅ Budget BQ <1% free tier OK

---

## Aprobación

- [ ] Felipe Vicencio (PO): aprueba scope + criterios de aceptación
- [ ] Tras aprobación: continuar con `/plan` para producir plan técnico detallado.
