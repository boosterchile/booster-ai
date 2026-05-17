# ADR-045 — Agent query helper (bastion + ADC headless wrapper)

**Fecha**: 2026-05-17
**Estado**: Proposed (promueve a Accepted en commit post-merge)
**Refs**:
- [`docs/specs/2026-05-17-agent-query-helper.md`](../specs/2026-05-17-agent-query-helper.md) (Approved 2026-05-17 ~20:55 UTC)
- [`docs/plans/2026-05-17-agent-query-helper.md`](../plans/2026-05-17-agent-query-helper.md)
- [`docs/runbooks/agent-query-prod.md`](../runbooks/agent-query-prod.md)
- [`scripts/db/agent-query.sh`](../../scripts/db/agent-query.sh)
- ADR-013 (database access pattern — 3-layer model, esta ADR abre Capa 4)
- PR [#275](https://github.com/boosterchile/booster-ai/pull/275) (spec C descartado tras devils-advocate)
- Memoria persistente del agente: `~/.claude/projects/<proj>/memory/reference_prod_db_headless_query.md` (patrón verificado para futuras sesiones)

## Contexto

G1 del plan `migration-journal-integrity-guard` (2026-05-17) reveló que el agente Claude/SDK no podía ejecutar queries SELECT contra Cloud SQL prod desde shell headless. Costo observado: ~11 min de coordinación humana (Cloud SQL Studio web UI + paste manual) para una query trivial.

Primer intento de solución (spec C, PR #275): Cloud Run service custom con AST parser, audit log dual, VPC connector, rate limit token bucket. Estimate 15-17h, 500+ LOC.

Devils-advocate v2 sobre spec C identificó 3 P0 nuevos:

- **P0-NEW-1**: `@booster-ai/logger` NO expone `redactPII(text)`. La spec asumía API inexistente.
- **P0-NEW-2**: la afirmación "IAP tunneling requiere user OAuth interactivo" era factualmente incorrecta. IAP acepta cualquier IAM principal (user o SA) con `roles/iap.tunnelResourceAccessor`.
- **P0-NEW-3**: el CLI helper enviaba access token (OAuth) donde Cloud Run IAM requiere ID token (audience-bound). El flow propuesto no funcionaría.

### Evidencia empírica del bug que motiva existir como script paralelo a `connect.sh`

Sesión 2026-05-17 ejecutó múltiples comandos gcloud headless. Output literal:

```
$ gcloud auth print-access-token
ERROR: (gcloud.auth.print-access-token) There was a problem refreshing
your current auth tokens: Reauthentication failed. cannot prompt during
non-interactive execution.

$ gcloud auth application-default print-access-token
ya29.a0AQvPyINS...  # ← funciona
```

`connect.sh` línea 117 ejecuta `gcloud auth print-access-token` para el IAM mode, y `gcloud secrets versions access` (que también usa user OAuth) en password mode. Ambos modos caen en el mismo bug headless.

`agent-query.sh` usa exclusivamente `gcloud auth application-default print-access-token` (ADC) + `gcloud --access-token-file=<path>` para todas las invocaciones gcloud. No comparte el path del bug.

### Verificación empírica del approach minimal

Verificación empírica 2026-05-17 ~20:50 UTC reveló que **una alternativa ~80% más barata existe usando infraestructura ya deployada**:

```bash
gcloud auth application-default print-access-token > /tmp/gcloud-adc-token
gcloud --access-token-file=/tmp/gcloud-adc-token compute start-iap-tunnel \
  db-bastion 5432 --local-host-port=127.0.0.1:5436 \
  --zone=southamerica-west1-a --project=booster-ai-494222 &
psql "postgresql://booster_app:***@localhost:5436/booster_ai" -c "SELECT ..."
# → query exitosa, headless, ~30s setup
```

Setup total: ~30 segundos. Cero infraestructura nueva. Reutiliza Capa 1 de ADR-013 (bastion ya RUNNING) + Secret Manager (ya existente) + ADC del laptop del PO.

## Decisión

Crear `scripts/db/agent-query.sh`, wrapper bash de ~150 LOC sobre el patrón verificado:

1. **Auth headless via ADC + `--access-token-file`**: bypasea el bug de `gcloud auth print-access-token` cuando el user OAuth expira en shell no-interactiva.
2. **Capa 1 de ADR-013 (bastion + IAP)**: reutiliza al 100% — `db-bastion` ya está RUNNING en southamerica-west1-a, cloud-sql-proxy corre como systemd service.
3. **Rol DB `booster_app`** (existente): el script conecta como `booster_app` via Secret Manager. NO se crea un `booster_query_tool` read-only por defecto — movido a v1.1 si patrón se vuelve frecuente.
4. **Soft warning para keywords DML/DDL**: el script imprime warning + pide confirmación interactiva si detecta `UPDATE|DELETE|INSERT|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE`. Aborta si stdin no es TTY y no se pasó `-y`. Es advisory, no perimeter — el agente sigue siendo responsable.
5. **Statement timeout 30s default** (overridable via env). Previene queries colgadas.
6. **Audit existente (capacidad real, NO aspiracional)**:
   - **Cloud Audit Logs (IAP)** capturan por-invocador IAM con timestamp + email + IP.
   - **Cloud SQL `log_statement=ddl`** loggea DDLs solamente (verificable en `infrastructure/data.tf:141`). NO loggea SELECT/DML.
   - **Query Insights** (`insights_config.query_insights_enabled=true`) captura SQL con literales placeholderizados (no valores), accesible via GCP Console (retención ~30d).
   - **`cloudsql.enable_pgaudit` NO está habilitado** en la instance (verificable). Si forensia futura requiere SQL crudo con valores, hay que encenderlo (trade-off: ~10x cost en Cloud Logging).
   - Gap "audit per-invocador real en SQL" se cierra cuando ADR-013 Capa 2 (IAM database auth) se ejecute.

## Consecuencias

### Positivas

- **Cero overhead operacional adicional**: reuso 100% de infra. No hay servicio nuevo que monitorear, parchar, rotar credenciales, ajustar quotas.
- **Cero superficie de ataque permanente**: no se expone endpoint nuevo. El bastion ya tenía el mismo perfil de exposición.
- **Cumplimiento CLAUDE.md §1**: cero deuda, cero infra manual (todo el bastion ya está en Terraform).
- **Cumplimiento CLAUDE.md §7**: ADC + OAuth, cero SA key descargada.
- **Setup time ~30s**: vs ~11 min flujo manual previo.
- **Reversible**: `rm scripts/db/agent-query.sh && rm docs/runbooks/agent-query-prod.md && rm docs/adr/045-agent-query-helper.md` y volvemos al estado previo. Sin side-effects en infra.

### Negativas

- **Por-invocador audit es indirecto**: pg_audit captura como `booster_app`. Para identificar QUIÉN corrió la query, hay que cruzar con Cloud Audit Logs IAP. Gap conocido, cerrado por ADR-013 Capa 2 cuando se ejecute.
- **Confianza en el agente para no mutar**: soft warning DML no es perimeter. Si un agente runaway corre UPDATE con `-y` flag, mutación se ejecuta. Mitigación: confiamos en LLM responsibility + humano review pre-merge de prompts del agente; si confianza se rompe, escalar a `booster_query_tool` rol read-only via Terraform.
- **Cero rate limit explícito**: uso esperado es bajo (5-10 queries/sprint friction events). Si subimos, evaluar agregar rate limit a nivel script o rol DB.
- **Cicatriz: bash script en `scripts/db/`** queda en el repo. Pero ya hay precedente (`connect.sh`), no es deuda nueva.

### Out of scope (movido a v1.1+ si patrón frecuente)

- `booster_query_tool` rol DB read-only via Terraform (defense in depth).
- IAM database auth (ADR-013 Capa 2) para audit por-invocador real.
- Rate limit explícito.
- Pre-baked stored procedures (`SECURITY DEFINER`) para queries comunes.
- Wrapper TS si script crece >150 LOC.

## Alternativas consideradas

### A. Cloud Run service custom (spec C, PR #275 descartado)

- **Pros teóricos**: AST parser bloquea mutations, audit dedicado, rate limit explícito, rol DB read-only.
- **Cons reales**: 15-17h vs 2-2.5h. 500+ LOC de servicio + Terraform + tests vs ~150 LOC bash. Superficie de ataque nueva permanente. Cost ~$10/mes VPC connector + Cloud Run compute. ID token flow complejo (requirió impersonation flow no-trivial).
- **Verdict**: descartado tras verificación empírica que mostró que el approach minimal cubre el caso de uso al 100%. Los "pros teóricos" no valen 12+ horas de overhead.

### B. Stored procedures pre-aprobadas (`SECURITY DEFINER`)

- **Pros**: cero superficie SQL libre. Funciones revisadas humanamente y limitadas.
- **Cons**: cubre <50% de queries ad-hoc del agente. Cada caso nuevo requiere migration + revisión.
- **Verdict**: opcional v2 complemento si el patrón se vuelve estructurado.

### C. `booster_query_tool` rol DB read-only desde v1

- **Pros**: defense in depth. Imposible mutar incluso si el agente lo intenta.
- **Cons**: complejidad extra en v1 sin evidencia de necesidad. `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_catalog` puede romper SELECT mismo si no se hace allowlist explícita post-revoke.
- **Verdict**: v1.1 si patrón frecuente. v1 mantiene simplicidad con `booster_app`.

### D. TypeScript wrapper en `packages/` o `apps/`

- **Pros**: type-safe, integrable con tests vitest.
- **Cons**: overkill para ~150 LOC. Alineado con `connect.sh` existente (también bash) mantiene consistencia.
- **Verdict**: considerar si crece >150 LOC o si se necesita API programática (no CLI).

### F. `gcloud sql connect --user=booster_app`

- **Pros**: comando nativo Google, no requiere bastion intermedio.
- **Cons**: usa `gcloud auth print-access-token` internamente (mismo bug headless que `connect.sh`). Verificado en sesión 2026-05-17 — mismo error `Reauthentication failed. cannot prompt during non-interactive execution`. Además, requiere que la instance Cloud SQL acepte conexiones del IP de gcloud cloud-sql-proxy efímero, lo cual no aplica con private-IP-only.
- **Verdict**: descartado, mismo blocker que el path original.

### E. Status quo (Cloud SQL Studio web UI manual)

- **Pros**: cero código nuevo. Humano-en-el-loop garantiza review.
- **Cons**: 11 min/friction event × 5-10 events/sprint = 1-2h/sprint de coordinación. No escala con scope del proyecto.
- **Verdict**: complemento, no reemplazo. Sigue siendo apropiado para casos exploratorios complejos donde humano necesita ver schema en UI.

## Status

Accepted. Implementado en commit del PR de esta ADR. Verificación empírica documentada en sección Contexto.

## Notas operacionales (gap ADR-013 detectado)

Durante la verificación se descubrió que `docs/adr/013-database-access-pattern.md` (línea ~235) dice *"Capa 1 — bastion + IAP: módulo `iap-bastion` escrito pero **no instanciado**"*. Esto está **desactualizado**: el bastion `db-bastion` está RUNNING en `southamerica-west1-a`. Una task out-of-band debería actualizar el status section de ADR-013 con la fecha de instanciación real (data point disponible en `gcloud compute instances describe db-bastion --format='value(creationTimestamp)'`).
