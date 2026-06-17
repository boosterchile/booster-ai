# Spec — Estrategia de rollback de migraciones de BD (audit P1-H)

**Estado**: Approved (diseño aprobado por el PO 2026-06-17)
**Origen**: auditoría 2026-06-14, hallazgo **P1-H** (`apps/api/drizzle/`, 41 migraciones forward-only sin down-migrations → recovery DDL manual en prod).
**ADR**: [ADR-066](../../docs/adr/066-db-migration-rollback-strategy.md)

## Problema

Las migraciones se aplican **al startup del servicio** (`apps/api/src/db/migrator.ts` vía `runMigrationsGated` en `main.ts`), son **forward-only** (Drizzle no genera down-migrations) y no hay procedimiento ni convención de rollback. Consecuencia: un deploy que aplica un DDL malo deja el esquema migrado **aunque se revierta la revisión Cloud Run** — el código viejo queda corriendo contra un esquema nuevo, sin red de seguridad documentada.

Drizzle es forward-only por diseño. Los "down migrations" literales (reverse SQL aplicado automáticamente) son **parcialmente un anti-patrón** en este setup (startup-migrate + canary): un down ejecutado durante un rollback puede **perder datos** (p.ej. revertir un `ADD COLUMN` dropea la columna con sus datos). La causa raíz no es "faltan 41 reverse files" sino la **ausencia de procedimiento y de disciplina preventiva**.

## Decisión (Opción A, aprobada)

Tres capas, de preventiva a correctiva:

1. **Convención expand/contract (preventiva, primaria)**: toda migración debe ser **backward-compatible** dentro del mismo deploy que el código que la usa — solo cambios aditivos (ADD COLUMN nullable / con default, CREATE TABLE/INDEX). Los cambios destructivos (DROP/RENAME columna o tabla, SET NOT NULL sin default, narrowing de tipo, DROP CONSTRAINT, TRUNCATE) se parten en **≥2 deploys**: expand → backfill → **contract** (recién cuando el código viejo ya no corre). Con esto, **el rollback de código siempre es seguro**.

2. **PITR / clone (correctiva, emergencia)**: el undo real de un DDL catastrófico es restaurar/clonar Cloud SQL a un punto previo (`point_in_time_recovery_enabled = true`, ya activo, 7 días de logs) — **no** down-migrations.

3. **Reverse-SQL manual (último recurso)**: para reversiones limpias y data-safe se permite un archivo `NNNN_name.down.sql`, aplicado por **procedimiento psql documentado** (vía bastion), NUNCA por el auto-migrator.

## Entregables

1. **ADR-066** `docs/adr/066-db-migration-rollback-strategy.md` — contexto (4 puntos: startup-migrate, forward-only, PITR ya activo, por qué down-auto es anti-patrón), decisión (las 3 capas), consecuencias, criterios de validación. Status Accepted.

2. **Runbook** `docs/runbooks/db-migration-rollback.md` — árbol de decisión + procedimientos paso a paso:
   - Gotcha: revertir la revisión Cloud Run NO revierte el esquema.
   - Árbol: (a) ¿cambio backward-compatible? → rollback de código, listo. (b) ¿DDL/data malos con datos a preservar? → **forward-fix** (migración correctiva, preferido). (c) ¿catastrófico/corrupción? → **PITR clone** a timestamp pre-deploy + promover.
   - Procedimiento `gcloud sql instances clone --point-in-time` concreto (instancia, región southamerica-west1).
   - Procedimiento reverse-SQL manual vía bastion (`scripts/db` / bastion existente).

3. **`apps/api/drizzle/README.md`** — convención para autores de migraciones: checklist expand/contract, cómo hacer un cambio destructivo en fases, ubicación del template, punteros a ADR-066 + runbook + el guard de CI.

4. **Template** `apps/api/drizzle/down/_TEMPLATE.down.sql` — convención de nombres + header "manual-apply-only, no lo trackea el migrator".

5. **Guard de CI bloqueante** `scripts/repo-checks/check-migration-safety.mjs` (+ `.test.mjs` con `node:test`):
   - Funciones puras `findDestructiveStatements(sql)` y `hasContractMarker(sql)`.
   - Detecta en migraciones **nuevas** (no las 41 existentes): DROP TABLE, DROP COLUMN, RENAME (TO/COLUMN), ALTER COLUMN ... (SET NOT NULL | TYPE | SET DATA TYPE), DROP CONSTRAINT, TRUNCATE. Ignora `--` comentarios (evita FP por la palabra "drop" en prosa).
   - **Override**: un archivo con una línea `-- contract-phase: <ref no vacía>` queda exento (es la fase contract planificada de un expand/contract).
   - Exit codes: 0 OK, 1 destructivo sin marcador, 2 error de uso.
   - Nuevo job en `.github/workflows/ci.yml` (`migration-safety`): corre el test del guard (`node --test`) + el guard contra los `.sql` **añadidos** en el diff vs la base (`git diff --diff-filter=A`). En push a main sin base, no-op.

## Fuera de scope

- No se escriben reverse-SQL para las 41 migraciones existentes (ya aplicadas; inmutables).
- No se cambia el runtime del migrator (`migrator.ts`) — su lógica de advisory lock + recovery out-of-order se conserva intacta.
- No se cambia `STRICT_MIGRATION_ORDERING`.

## Criterios de aceptación

- SC-1: ADR-066 Accepted, número validado por `check-adr-numbering`.
- SC-2: runbook con los 3 caminos + comandos concretos de PITR clone y reverse-SQL manual.
- SC-3: README de drizzle con el checklist expand/contract y punteros.
- SC-4: guard falla (exit 1) ante una migración nueva con `DROP COLUMN` sin marcador; pasa (exit 0) si lleva `-- contract-phase: ADR-XXX`; NO marca las 41 existentes (solo opera sobre archivos pasados como argumento = los añadidos en el diff).
- SC-5: test del guard (`node --test`) verde, cubriendo cada patrón destructivo + el override + el comment-stripping.
- SC-6: job `migration-safety` en ci.yml; `pnpm ci` (lint/typecheck/test/build) verde.
