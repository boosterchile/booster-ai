# Plan — Agent query helper

- **Spec**: [`docs/specs/2026-05-17-agent-query-helper.md`](../specs/2026-05-17-agent-query-helper.md) (Status: Approved 2026-05-17 ~20:55 UTC)
- **ADR a crear**: `045-agent-query-helper.md`
- **Created**: 2026-05-17 ~20:55 UTC
- **Owner**: Felipe Vicencio (PO) + Claude
- **Status**: **Draft** — pendiente PO approval

---

## Decisiones cerradas en spec (no re-litigar)

- Bash script (no TS package).
- `booster_app` rol DB (no `booster_query_tool` read-only) en v1; v1.1 si pattern frecuente.
- Soft warning para keywords DML/DDL (no AST parser).
- pg_audit + Cloud Audit Logs (no audit dedicado).
- Cero infraestructura nueva.

---

## Módulos tocados

| Archivo | Tipo | Tarea |
|---|---|---|
| `scripts/db/agent-query.sh` | nuevo, ejecutable | H1 |
| `docs/runbooks/agent-query-prod.md` | nuevo | H2 |
| `docs/adr/045-agent-query-helper.md` | nuevo | H3 |

3 archivos nuevos. Cero modificaciones a infra/Terraform/aplicaciones.

---

## Tasks

### H1: `scripts/db/agent-query.sh` (script wrapper)

- **Files**: `scripts/db/agent-query.sh` (nuevo, +x).
- **LOC estimate**: ~60 (basado en estructura de `scripts/db/connect.sh` existente: precondition checks + tunnel background + cleanup trap + invocation).
- **Depends on**: nada.
- **Acceptance**:
  - Invocación inline: `scripts/db/agent-query.sh -c "SELECT 1"` retorna `?column? = 1` en stdout, exit 0.
  - Invocación file: `scripts/db/agent-query.sh -f script.sql` ejecuta y retorna resultado.
  - Sin SQL: error claro `Uso: agent-query.sh -c <sql> | -f <file>`, exit 1.
  - ADC inválido o expirado: error `No hay credenciales ADC válidas. Corré: gcloud auth application-default login`, exit 1.
  - `psql` no instalado: auto-install via brew (alineado con `connect.sh:53-55`) o error claro si brew no está.
  - Tunnel hangs >30s: timeout + error claro + cleanup, exit 1.
  - SIGINT/SIGTERM/EXIT: trap kills tunnel cleanly. `lsof -iTCP:5436` no muestra proceso huérfano post-script.
  - Soft warning si detecta `\b(UPDATE|DELETE|INSERT|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE)\b` en SQL: imprime warning + pide confirmación interactiva (skip con `-y` flag).
  - `STATEMENT_TIMEOUT_S` env var override (default 30).
  - `LOCAL_PORT` env var override (default 5436 para no chocar con `connect.sh` default 5433).
- **Rollback**: rm del archivo. Cero side-effects en infra.

### H2: Runbook `docs/runbooks/agent-query-prod.md`

- **Files**: `docs/runbooks/agent-query-prod.md` (nuevo).
- **LOC estimate**: ~80.
- **Depends on**: H1 (para incluir ejemplos exactos).
- **Acceptance** — secciones obligatorias:
  - **Quick start**: 3 líneas que el agente puede copiar y correr.
  - **Cuándo usar**: 4 use cases del spec §2.
  - **Cuándo NO usar**: 3 anti-patterns (mutations, queries >MB, loops).
  - **Pre-requisites**: ADC activo, `psql` instalado, dev@boosterchile.com como Owner (Truchequea con `gcloud projects get-iam-policy`).
  - **Troubleshooting**: 5 errores comunes con fix:
    - ADC expirado → `gcloud auth application-default login`
    - Tunnel timeout → check `db-bastion` status en GCP Console
    - `psql: command not found` → `brew install libpq && brew link --force libpq`
    - Permission denied al DB → verificar role en `database-url` secret
    - Port already in use → set `LOCAL_PORT=5440` (o cualquier libre)
  - **Comparación con `scripts/db/connect.sh`**: cuándo usar uno vs otro.
  - **Audit trail**: cómo verificar las queries en Cloud Audit Logs + pg_audit.
- **Rollback**: rm. Cero impacto.

### H3: ADR-045

- **Files**: `docs/adr/045-agent-query-helper.md` (nuevo).
- **LOC estimate**: ~90.
- **Depends on**: H1, H2 (para referenciar archivos creados).
- **Acceptance** — secciones standard ADR:
  - **Context**: friction G1 + descubrimiento del bastion+ADC pattern + descarte de spec C #275.
  - **Decision**:
    1. Helper script bash sobre infra existente.
    2. `booster_app` rol en v1 (read-only role solo si patrón frecuente).
    3. Soft warning DML, no AST parser.
    4. Cero infraestructura nueva.
  - **Alternatives** (con verdict empírico):
    - Spec C Cloud Run service (descartado, link a PR #275 cerrado).
    - Stored procedures pre-aprobadas (v2 si necesario).
    - `booster_query_tool` read-only role (v1.1 si patrón frecuente).
    - TS package en lieu of bash (overkill para ~60 LOC).
  - **Consequences**:
    - Positivas: cero overhead, cero superficie nueva, reuso de Capa 1 ADR-013.
    - Negativas: pg_audit captura como `booster_app` no per-invocador (gap conocido, ADR-013 Capa 2 lo cierra).
    - Out of scope: rate limit, audit log dedicado.
  - **Status**: Accepted.
  - **References**: ADR-013 (database access pattern), PR #275 cerrado, memory `reference_prod_db_headless_query.md`.
- **Rollback**: rm. Sin ADR queda doc gap pero script funciona.

### H4: Devils-advocate del PR + fixes

- **Files**: solo modificar archivos H1/H2/H3 según objeciones.
- **LOC estimate**: variable.
- **Depends on**: H1, H2, H3.
- **Acceptance**:
  - Invocar `agent-rigor:devils-advocate` con contexto cold del PR.
  - Cero P0 residuales antes de merge.
  - Cualquier P1 sin abordar tiene justificación explícita en PR body.

---

## Out-of-band tasks

- Actualizar `docs/handoff/CURRENT.md` post-merge.
- Considerar actualizar `docs/adr/013-database-access-pattern.md` status section (dice bastion no instanciado pero sí lo está) — separada porque modifica ADR ya merged.

---

## Estimación total

- H1: 30 min
- H2: 30 min
- H3: 30 min
- H4: 30 min (mínimo, puede crecer si devils-advocate encuentra P0)
- Total: **~2-2.5h** en 1 sesión

vs 15-17h del spec C descartado.

---

## Solo-developer adaptation

- Cooling-off 30 min entre BUILD y REVIEW.
- Devils-advocate sub-agent obligatorio sobre PR.
- Tests manuales (T1-T6 del spec §5) ejecutados antes de merge — output pegado en PR body como evidencia.

---

## Verificación del plan (skill checklist)

- [x] H1-H4 son vertical slices (script, runbook, ADR, review).
- [x] Todas las tasks ≤ 100 LOC estimate (max=H3=90).
- [x] Acceptance verificable por test/output/file existente.
- [x] Rollback explícito por task.
- [x] Spec aprobado antes de plan.
- [ ] Devils-advocate del plan — skip per simplicidad del scope (3 archivos docs+script + ADR). Si PO discrepa, invocar.
- [ ] PO approval — pendiente.

---

## Orden de implementación

1. **H1**: script. Tests manuales T1-T6.
2. **H2**: runbook con ejemplos reales del H1.
3. **H3**: ADR-045 con file paths verificados.
4. **H4**: devils-advocate sobre el PR completo. Fixes.
5. Cooling-off 30 min.
6. /review formal (code-reviewer + devils-advocate).
7. Merge.
