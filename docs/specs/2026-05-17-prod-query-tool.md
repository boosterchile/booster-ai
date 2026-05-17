# Spec — Prod query tool (agent-accessible read-only SQL contra Cloud SQL prod)

- **Author**: Felipe Vicencio (PO) + Claude (agent-rigor)
- **Date**: 2026-05-17
- **Status**: **Draft** — pendiente PO approval
- **Linked**: friction encontrada en G1 del plan `migration-journal-integrity-guard`
- **ADR a crear**: `045-prod-query-tool.md`

---

## 1. Objetivo

Tener una herramienta que permita ejecutar **queries SELECT read-only** contra Cloud SQL prod desde cualquier shell headless del agente, sin requerir intervención humana ni acceso interactivo a Cloud SQL Studio web UI. Eliminar el bloqueo que vimos hoy en G1 (verificar si una tabla existía en prod tomó coordinación humana + UI manual).

## 2. Why now

Sesión 2026-05-17 expuso el costo del flujo manual:

| Paso | Tiempo real | Costo |
|---|---|---|
| Identificar instancia Cloud SQL via REST API | 1 min | OK (ADC funciona) |
| Intentar `gcloud sql connect` | 2 min | FALLA (user auth expirado, requiere interactive re-login) |
| Intentar cloud-sql-proxy local | 3 min | FALLA (private IP no enrutable desde fuera VPC) |
| Intentar `gcloud cloud-shell ssh` | 1 min | FALLA (mismo user auth) |
| Coordinación + setup Cloud SQL Studio web UI | 4 min | OK pero requiere humano + click |
| **Total** | **~11 min** | Para 1 query trivial |

Si esto fuera recurrente (5-10 veces/sprint), el costo agregado es prohibitivo. Hay varias categorías de verificaciones que necesitamos rutinariamente contra prod:

- "¿Existe la tabla/columna X tras migration?"
- "¿Cuántos registros con condición Y?"
- "¿Cuáles son los últimos N timestamps de tabla Z?" (debugging incidentes)
- "¿Está aplicada la migration ABC en `__drizzle_migrations`?"

Hoy 0 de estas se pueden hacer sin coordinación humana. La privacidad del data (PII conductores, shippers) **no** justifica el bloqueo — el control debe ser por permisos (IAM read-only + audit log), no por friction operacional.

## 3. Success criteria

- [ ] **CR-1**: Existe un servicio Cloud Run privado `prod-query-tool` con endpoint `POST /query` que acepta `{ "sql": "...", "params": [...] }` y retorna `{ "rows": [...], "rowCount": N, "durationMs": M }`.
- [ ] **CR-2**: El servicio rechaza con HTTP 400 cualquier SQL que NO sea `SELECT`/`WITH`/`EXPLAIN` (parsing AST básico; no string-match heurístico). DML, DDL, FUNCTION calls con side-effects bloqueados.
- [ ] **CR-3**: El servicio conecta a Cloud SQL prod con un DB user dedicado `booster_query_tool` que tiene **solo** GRANT SELECT en `public.*` y `drizzle.*`. NO tiene GRANT INSERT/UPDATE/DELETE/TRUNCATE/ALTER. Defense in depth: si CR-2 falla, el DB rechaza igualmente.
- [ ] **CR-4**: El servicio requiere autenticación IAM Cloud Run (`run.invoker` role). Solo dos principals autorizados: (a) `dev@boosterchile.com` (PO), (b) un service account dedicado `agent-query-invoker@booster-ai-494222.iam.gserviceaccount.com` cuyo key vive en `~/.config/gcloud/application_default_credentials.json` del laptop del PO (ya existente via ADC).
- [ ] **CR-5**: Cada query genera **dos** entries de log estructurado: (a) en Cloud Logging del servicio (con `traceId`, principal, SQL hash, rowCount, durationMs); (b) en una tabla nueva `auditoria_query_tool` en Cloud SQL prod (append-only, retención 90d, PII redacted en el SQL almacenado). Compliance: este uso queda trazable retroactivamente.
- [ ] **CR-6**: Rate limit: máx 60 queries/min por principal. Query timeout: 30s (Cloud Run + statement_timeout en pg session). Retornos >10 MB rechazados (LIMIT enforcement client-side).
- [ ] **CR-7**: Helper CLI local `pnpm prod-query "SELECT ..."` que envuelve la llamada (fetch ADC token + POST + parse + print). El agente lo invoca como Bash command.
- [ ] **CR-8**: Service deployed a Cloud Run con VPC connector apuntando al mismo subnet que `apps/api` (acceso a la private IP de Cloud SQL).
- [ ] **CR-9**: Infraestructura via Terraform en `infrastructure/modules/prod-query-tool/`. Cero recursos creados manualmente. ADR-045 documenta la decisión.
- [ ] **CR-10**: Existe `apps/prod-query-tool/test/integration/query.integration.test.ts` que verifica: (a) SELECT pasa, (b) UPDATE rechazado con 400, (c) DROP rechazado con 400, (d) rate limit funciona tras 61 calls.

## 4. Diseño técnico (sketch)

### Stack

- Cloud Run service (mínima imagen Node.js).
- Backend: Hono (consistente con `apps/api`).
- DB driver: `pg` directo (sin Drizzle — el servicio NO necesita el ORM, solo executes raw SQL del request).
- SQL parsing: `pg-query-parser-wasm` (o equivalente) para AST-level validation que el statement es SELECT.

### Flujo de un request

```
[agente local]
   pnpm prod-query "SELECT to_regclass('public.X')"
   ↓
   gcloud auth application-default print-access-token
   ↓
   POST https://prod-query-tool-xxx.a.run.app/query
   Authorization: Bearer <token>
   { "sql": "SELECT to_regclass('public.X')", "params": [] }
   ↓
[Cloud Run service]
   IAM check (run.invoker) → 401 si falla
   Rate limit check → 429 si excedido
   Parse SQL → 400 si no es SELECT-like
   Connect to Cloud SQL (private IP via VPC connector)
   pg.query(sql, params) con statement_timeout=30s
   Audit log → Cloud Logging + auditoria_query_tool table
   Return JSON
   ↓
[agente local]
   Print formatted result
```

### IAM model

- DB user `booster_query_tool` con `GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO booster_query_tool;` + `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO booster_query_tool;` (futuras tablas también).
- Service account `prod-query-tool@booster-ai-494222.iam.gserviceaccount.com` (runtime de Cloud Run) con `roles/cloudsql.client` solamente.
- IAM Conditions sobre Cloud Run service: solo permite invoker desde `dev@boosterchile.com` o `agent-query-invoker@`.

## 5. Out of scope

- **No** ejecutar DML/DDL/maintenance commands. Migrations siguen siendo el único path para schema changes.
- **No** queries de larga duración (background, materialized views). 30s hard limit.
- **No** Spanner, AlloyDB, BigQuery. Solo Cloud SQL Postgres prod.
- **No** abrir el servicio a non-Booster principals. Es una herramienta interna del equipo, no para clientes ni stakeholders.
- **No** UI web custom. Cloud SQL Studio sigue siendo opción para casos exploratorios complejos.
- **No** caching de query results. Cada call hits DB.
- **No** acceso a otros environments (dev, staging). Solo prod. Para dev usar `booster_test_prototype` local.

## 6. Risks + mitigations

| Riesgo | Mitigación |
|---|---|
| SQL injection si el agente construye queries con concat de strings de input externo | El agente es el único caller; las queries son curated por él. Aún así: usar parameterized queries (`$1, $2`) siempre; el servicio expone `params: []` para forzar el patrón. |
| Agent runaway: hace 1000s de queries en un loop | Rate limit 60/min + alerta Cloud Monitoring si excede 100/hora |
| Service account key leak | No hay key — usamos ADC del laptop del PO. La autenticación es identity-bound, no key-bound |
| Auditoría query muestra PII en SQL almacenado | Pre-storage hook redacta patrones conocidos (emails, RUTs, números > 8 dígitos consecutivos). Filtros documentados en spec |
| Cloud SQL gets DDOS via query tool | statement_timeout + connection limit per service (5 connections max al pool); el servicio Cloud Run scaleará a max 1 instance |
| Bypass del read-only via funcciones (`pg_read_binary_file()`, etc.) | DB user no tiene EXECUTE en funciones peligrosas. Lista de funciones permitidas explícita en `booster_query_tool` GRANT |

## 7. Test list

| # | Test | Tipo |
|---|---|---|
| 1 | SELECT pasa | integration |
| 2 | UPDATE rechazado con 400 + mensaje claro | integration |
| 3 | DROP TABLE rechazado con 400 | integration |
| 4 | Statement con `CREATE FUNCTION` rechazado | integration |
| 5 | Rate limit dispara 429 tras 61 calls/min | integration |
| 6 | Timeout dispara 504 tras 30s | integration (LONG) |
| 7 | Unauth (sin Bearer) → 401 | integration |
| 8 | Auth pero principal no autorizado → 403 | integration |
| 9 | SQL injection patterns en `params` (no en `sql`) → tratado como string literal | integration |
| 10 | Audit row creada en `auditoria_query_tool` por cada call | integration |
| 11 | PII redaction en audit row (email + RUT redactados) | unit |
| 12 | Helper CLI `pnpm prod-query` retorna JSON parseado | integration (local + service deployed) |

## 8. Estimación de esfuerzo

- Spec + plan: 1 sesión (~1h).
- Build: 3-5 sesiones (~4-6h):
  - Service skeleton + SQL parsing.
  - Auth + rate limit.
  - VPC connector + DB user provisioning via Terraform.
  - Audit table + redaction.
  - CLI helper.
  - Tests.
- Verify + ship: 1 sesión (~1h).
- **Total**: ~6-8h focado distribuidas en 1 semana.

## 9. Open questions

1. **Service account naming**: `agent-query-invoker` vs `prod-query-tool-invoker`. Default propuesto: `prod-query-tool-invoker`.
2. **Audit table location**: misma DB que app (`booster_ai`) en schema `auditoria` separado, vs DB dedicada para audit. Default: schema separado en misma DB (menos infra).
3. **CLI helper path**: `apps/prod-query-tool/cli` package o `scripts/prod-query.mjs` en root. Default: package separado dentro de `apps/prod-query-tool/`.
4. **Retención audit**: 90d (propuesto) vs 1 año (compliance Ley 19.628). Default a confirmar con compliance lead.
5. **Cobertura sobre Drizzle schema**: ¿el servicio expone también un endpoint `/schema` que retorna info_schema dumps para introspection sin tener que escribir SQL? Probablemente sí en v2. Out of scope v1.

## 10. Alternativas consideradas

| Alternativa | Por qué se descarta |
|---|---|
| **Cloud SQL Studio web** | Ya existe — pero requiere humano y UI. No resuelve el problema operacional |
| **Cloud Run job per query** | Cada query = un job deploy + execute + log read. ~30s overhead vs ~500ms del servicio. Prohibitivo |
| **VPN del laptop al VPC** | Setup complejo, costo de mantenimiento, sigue siendo solo el laptop del PO |
| **IAP TCP tunneling** | Posible pero Cloud SQL no expone IAP nativamente. Requiere bastion + custom setup |
| **REST API de Cloud SQL Admin** | No tiene endpoint para arbitrary queries. Solo metadata + import/export |
| **Database Migration Service / Datastream** | Para data pipelines, no para queries ad-hoc |
| **Connector library (Cloud SQL Node connector)** | Requiere correr cliente desde laptop con VPC routing — mismo bloqueo |
| **Edge Function (Cloud Functions Gen2)** | Equivalente a Cloud Run service pero con cold starts más largos. C1 wins |
| **Postgrest expuesto** | Demasiado powerful (full REST CRUD). Bloquearlo a read-only es complicado |

## 11. Devils-advocate scope

Recomendado: invocar antes de aprobar plan. Esta spec introduce nueva superficie de ataque (servicio Cloud Run con acceso a prod DB) y debe revisarse adversarially. Concerns esperados:

- ¿El parser SQL es realmente seguro o tiene bypass conocidos?
- ¿La rate limit es enforced server-side o solo en CLI?
- ¿El audit log es realmente append-only o se puede manipular?
- ¿El service account key del invoker está adecuadamente rotado?
- ¿La PII redaction maneja todos los patrones realistas?
- ¿VPC connector cuesta vs valor obtenido (~$10/mes adicionales)?
- ¿Hay un caso donde el flujo manual sigue siendo preferible (queries exploratorias largas, joins complejos)?

## 12. Próximos pasos post-approval

1. `/plan` → produce plan con tareas H1-H10 atómicas.
2. Devils-advocate sobre el plan.
3. `/build` task por task.
4. Devils-advocate + code-reviewer sobre el PR final antes de merge.
5. ADR-045 documenta la decisión.
6. Update CLAUDE.md memoria con la nueva capacidad disponible.
