# ADR-066 — Estrategia de rollback de migraciones de base de datos (expand/contract + PITR)

**Estado**: Accepted
**Fecha**: 2026-06-17
**Decider**: Felipe Vicencio (Product Owner)
**Related**: `apps/api/src/db/migrator.ts`, `apps/api/drizzle/`, [ADR-058](./058-cost-optimization-precomercial.md) (Cloud SQL ZONAL + PITR), `docs/runbooks/db-migration-rollback.md`, auditoría 2026-06-14 (P1-H)

---

## Contexto

La auditoría 2026-06-14 marcó **P1-H**: `apps/api/drizzle/` tiene 41 migraciones **forward-only**, sin down-migrations, y no hay procedimiento de rollback documentado → ante una migración errónea el recovery es manual e improvisado en prod.

Cuatro hechos del setup actual condicionan la decisión:

1. **Las migraciones se aplican al STARTUP del servicio** (`runMigrationsGated` en `apps/api/src/main.ts` → `apps/api/src/db/migrator.ts`), bajo advisory lock, con un path de recuperación de pendientes out-of-order. Es decir: cuando una nueva revisión de Cloud Run arranca, **migra la BD antes de servir tráfico**.
2. **Drizzle es forward-only por diseño**: `drizzle-kit generate` no produce down-migrations. Implementarlas sería tooling propio.
3. **PITR ya está habilitado** en Cloud SQL (`infrastructure/data.tf`: `point_in_time_recovery_enabled = true`, `transaction_log_retention_days = 7`) + backups retenidos. El undo de un DDL a nivel infra **ya existe**.
4. **Consecuencia del punto 1**: revertir la revisión de Cloud Run (rollback de código) **NO revierte el esquema**. El código viejo queda corriendo contra un esquema nuevo.

Por el punto 1, los **down-migrations literales aplicados automáticamente son un anti-patrón** en este setup: un down ejecutado durante un rollback puede **perder datos** (revertir un `ADD COLUMN` dropea la columna con su contenido) y, con canary, dejar el esquema en un estado intermedio inconsistente. La causa raíz de P1-H no es "faltan 41 reverse files" — es la **ausencia de procedimiento y de disciplina preventiva**.

## Decisión

Se adopta una estrategia de **tres capas**, de preventiva a correctiva, en vez de down-migrations auto-aplicadas:

### 1. Convención expand/contract (preventiva, primaria)

Toda migración debe ser **backward-compatible** dentro del mismo deploy que el código que la consume. En un solo deploy solo se permiten cambios **aditivos**:

- `ADD COLUMN` nullable o con `DEFAULT`.
- `CREATE TABLE`, `CREATE INDEX` (preferir `CONCURRENTLY` para tablas grandes), `ADD CONSTRAINT ... NOT VALID` + `VALIDATE` posterior.

Los cambios **destructivos** (DROP/RENAME de columna o tabla, `SET NOT NULL` sin default backfilled, narrowing de tipo, `DROP CONSTRAINT`, `TRUNCATE`) se parten en **≥2 deploys**:

1. **Expand**: agregar lo nuevo (columna nueva, tabla nueva) sin tocar lo viejo. El código pasa a escribir en ambos / leer del nuevo.
2. **Backfill**: migrar datos del viejo al nuevo.
3. **Contract**: eliminar lo viejo **recién cuando ninguna revisión que lo usa sigue viva**.

Con esto, **el rollback de código siempre es seguro**: cualquier revisión anterior encuentra un esquema que aún soporta lo que esperaba.

### 2. PITR / clone (correctiva, emergencia)

El undo real de un DDL catastrófico (corrupción, drop accidental con datos) es **restaurar o clonar Cloud SQL a un punto previo** vía PITR — no un down-migration. Procedimiento en el runbook.

### 3. Reverse-SQL manual (último recurso)

Para reversiones limpias y data-safe se permite escribir un archivo `apps/api/drizzle/down/NNNN_name.down.sql`, aplicado por **procedimiento psql manual documentado** (vía bastion), **NUNCA** por el auto-migrator. El migrator (`migrator.ts`) sigue siendo forward-only y no lee `down/`.

### Enforcement

Un guard de CI bloqueante (`scripts/repo-checks/check-migration-safety.mjs`, job `migration-safety` en `ci.yml`) falla si una migración **nueva** trae DDL destructivo, salvo que el archivo declare que es la fase contract planificada con el marcador:

```sql
-- contract-phase: ADR-066   (o issue#/ref que documente el expand previo)
```

El guard opera solo sobre los `.sql` **añadidos** en el diff vs la base — nunca sobre las 41 migraciones ya aplicadas (inmutables).

## Consecuencias

**Positivas**:
- El rollback de código vuelve a ser una operación segura y trivial (revertir la revisión), que es el caso de rollback más común.
- Se aprovecha PITR (ya pagado) como red real para lo catastrófico, sin construir ni mantener un motor de down-migrations frágil.
- El guard convierte la disciplina en contrato verificable (coherente con "cero deuda day 0").

**Negativas / trade-offs aceptados**:
- Los cambios destructivos cuestan ≥2 PRs/deploys (expand/contract). Es intencional: es el costo de poder hacer rollback sin perder datos.
- El reverse-SQL manual no está automatizado; requiere un humano + bastion. Aceptable porque es último recurso y las primeras dos capas cubren el caso común.
- El guard puede tener falsos positivos (un `DROP` legítimo de fase contract); se resuelven con el marcador `-- contract-phase:` (override explícito y auditable), no desactivando el guard.

## Criterios de validación

1. `check-adr-numbering` valida que 066 no colisiona.
2. El guard falla (exit 1) ante una migración nueva con `DROP COLUMN` sin marcador y pasa (exit 0) con `-- contract-phase: …`; no marca las migraciones existentes.
3. El runbook (`docs/runbooks/db-migration-rollback.md`) cubre los tres caminos con comandos concretos.

## Alternativas descartadas

- **Down-migrations auto-aplicadas (tipo Rails/Knex)**: anti-patrón con startup-migrate + canary (pérdida de datos en rollback, estado intermedio). Descartada.
- **Solo runbook de PITR, sin convención ni guard**: deja la disciplina preventiva sin codificar; el problema reaparece. Descartada (el PO eligió la opción con ADR + guard).
