# Migraciones de la API (Drizzle)

Migraciones SQL generadas desde `apps/api/src/db/schema.ts` con `drizzle-kit`.

```
pnpm --filter @booster-ai/api exec drizzle-kit generate
```

Se aplican **automáticamente al startup del servicio** (`src/db/migrator.ts` vía
`runMigrationsGated` en `src/main.ts`), bajo advisory lock, forward-only. **No**
correr `drizzle-kit migrate` a mano en prod.

## Regla de oro: backward-compatible (expand/contract)

Cada migración debe ser **backward-compatible** con la revisión de código anterior,
porque migra el esquema **antes** de servir tráfico y el rollback de una revisión
Cloud Run **no revierte el esquema**. Ver [ADR-066](../../../docs/adr/066-db-migration-rollback-strategy.md).

En un solo deploy → **solo cambios aditivos**:

- ✅ `ADD COLUMN` nullable o con `DEFAULT`.
- ✅ `CREATE TABLE`, `CREATE INDEX` (preferí `CONCURRENTLY` en tablas grandes).
- ✅ `ADD CONSTRAINT ... NOT VALID` y un `VALIDATE CONSTRAINT` posterior.

Los cambios **destructivos** se parten en **≥2 deploys** (expand → backfill → contract):

| En vez de… (1 deploy) | Hacé… (en fases) |
|---|---|
| `DROP COLUMN vieja` | Deploy 1: dejá de usarla en código. Deploy posterior: el `DROP` como fase **contract**. |
| `RENAME COLUMN a → b` | Expand: `ADD COLUMN b` + escribir en ambas. Backfill. Contract: `DROP COLUMN a`. |
| `SET NOT NULL` | Expand: agregá con default / backfilleá. Contract: `SET NOT NULL` cuando no haya NULLs ni código viejo. |
| `ALTER COLUMN TYPE` (narrowing) | Columna nueva del tipo correcto + backfill + contract. |

Así **el rollback de código siempre es seguro**.

## Guard de CI

`scripts/repo-checks/check-migration-safety.mjs` (job `migration-safety` en
`.github/workflows/ci.yml`) **bloquea** una migración nueva con DDL destructivo
(`DROP TABLE/COLUMN/CONSTRAINT`, `RENAME`, `SET NOT NULL`, `ALTER COLUMN TYPE`,
`TRUNCATE`).

Si **esta** migración es la fase **contract** planificada de un expand/contract
(el expand ya se desplegó antes), declaralo con una línea en el `.sql`:

```sql
-- contract-phase: ADR-066   (o el issue/PR del expand previo)
```

Eso es un override **explícito y auditable**, no desactiva el guard.

## Rollback

No hay down-migrations auto-aplicadas (anti-patrón con startup-migrate; ver ADR-066).
Para revertir: **docs/runbooks/db-migration-rollback.md** (rollback de código si fue
aditiva → forward-fix → PITR clone para lo catastrófico). El reverse-SQL manual de
último recurso vive en `down/` (no lo trackea el migrator).
