# T0 — Output del prototipo medido (test-integration-infra-apps-api)

- **Plan**: [`docs/plans/2026-05-17-test-integration-infra-apps-api.md`](../plans/2026-05-17-test-integration-infra-apps-api.md) §T0
- **Spec**: [`docs/specs/2026-05-17-test-integration-infra-apps-api.md`](../specs/2026-05-17-test-integration-infra-apps-api.md)
- **Ejecutado**: 2026-05-17 ~09:06 UTC
- **Owner**: Claude / Felipe Vicencio
- **Script**: `apps/api/scripts/prototype-test-db.ts` (NO mergeado — se descarta tras T1b por diseño del plan T0)
- **Postgres usado**: `postgresql@16` (Homebrew, `postgresql 16.14` aarch64-apple-darwin25.4.0), trust auth local, DB `booster_test_prototype`.

---

## Setup ejecutado

```bash
brew install postgresql@16
initdb -D /opt/homebrew/var/postgresql@16 -E UTF8 --locale=C
brew services start postgresql@16
createdb booster_test_prototype
cd apps/api
PROTOTYPE_DATABASE_URL=postgresql://fvicencio@localhost:5432/booster_test_prototype \
  npx tsx scripts/prototype-test-db.ts
```

El script ejecuta tres runs en una sola invocación:

1. **RUN 1 (cold)**: `DROP SCHEMA public CASCADE` + `DROP SCHEMA drizzle CASCADE` + `CREATE SCHEMA public` + `CREATE EXTENSION pgcrypto` + `runMigrations()`.
2. **RUN 2 (full reset)**: lo mismo que RUN 1, sobre la misma DB (simula la segunda corrida de `pnpm test:integration`).
3. **RUN 3 (in-place)**: `runMigrations()` sin DROP — verifica idempotencia del migrator solo.

`runMigrations` es la función real de `apps/api/src/db/migrator.ts` (NO un mock), incluyendo `migrate()` de Drizzle + `applyOutOfOrderPending`.

---

## Mediciones

| Run | DROP+CREATE schema | runMigrations | Drizzle migrate() interno | __drizzle_migrations rows |
|---|---:|---:|---:|---:|
| 1 (cold) | 316 ms | 156 ms | 145 ms | 36 |
| 2 (full reset) | 20 ms | 95 ms | 90 ms | 36 |
| 3 (in-place, sin DROP) | — | 4 ms | 3 ms | 36 |

Drizzle no realiza I/O cuando todas las migrations ya están en `__drizzle_migrations` (run 3 = 4 ms total), confirmando idempotencia.

---

## Acceptance criteria del plan §T0

| Criterio | Valor objetivo | Valor medido | Resultado |
|---|---|---|---|
| Run 1 (DROP+CREATE+migrate cold) | < 30 s local | 472 ms | **PASS** |
| Run 3 (in-place sin DROP) | < 5 s | 4 ms | **PASS** |
| Sin errores en ninguna corrida | — | sin errores | **PASS** |
| Counts consistentes runs 1/2/3 | igualdad | 36 / 36 / 36 | **PASS** |
| `applyOutOfOrderPending` no falla en segunda corrida | — | no warn de recovery | **PASS** |

**Veredicto**: `>>> T0 PASS — proceed to T1`.

---

## Hallazgo colateral (NO bloquea T1, fuera de scope T0)

**Migration huérfana detectada**: `apps/api/drizzle/0009_stakeholder_access_log.sql` existe en disco pero NO está registrada en `apps/api/drizzle/meta/_journal.json`. Conteo: 37 archivos `.sql`, 36 entradas en journal.

Consecuencias:

- Ni `drizzle migrate()` ni `applyOutOfOrderPending` la consideran — ambos iteran sobre el journal.
- La tabla `stakeholderAccessLog` está declarada en `apps/api/src/db/schema.ts:1406`. En producción no existe la tabla; cualquier endpoint que la lea/escriba devolvería 500 (`relation "stakeholder_access_log" does not exist`).
- Origen: commit `488c931` ("chore: hardening post-auditoría — ADRs + console.* migration + lint + 3 ADRs + coverage gate + 716 tests"). El `.sql` se commiteó sin actualizar el journal.

Se abrió task separada para investigar contra Cloud SQL prod y decidir entre renumerar (`0037_*`) o re-insertar entrada en el journal con timestamp original. Este hallazgo justifica retroactivamente la decisión del PO de exigir T0 antes de T1: un test de integración con migrations reales hubiera expuesto esto al primer fixture de stakeholder.

---

## Decisión arquitectónica validada

§D2 del plan se confirma viable sin cambios:

- `DROP SCHEMA public CASCADE` + `DROP SCHEMA drizzle CASCADE` + `CREATE SCHEMA public` + `CREATE EXTENSION pgcrypto` + `runMigrations(pool, logger)` en `globalSetup` es:
  - **Rápido**: ~500 ms cold, ~100 ms warm. Bajo umbral del plan (≤ 5 s objetivo para globalSetup de integration suite).
  - **Idempotente**: tres corridas consecutivas convergen al mismo estado, sin errores, sin recovery path activado.
  - **Fiel a prod**: usa la función real `runMigrations` con advisory lock + `applyOutOfOrderPending`, no una re-implementación.

§D2 entra a T1b sin modificaciones. **Una sola diferencia con la pseudo-code del plan**: agregar también `DROP SCHEMA IF EXISTS drizzle CASCADE` (no estaba explícito en el plan §D2). Sin ese DROP, runs sucesivos heredan `__drizzle_migrations` con hashes viejos y la próxima corrida del migrator pierde la oportunidad de re-aplicar migrations en orden si el journal cambió.

---

## Output literal del script

```
=== T0 prototype-test-db ===
DB: postgresql:***@localhost:5432/booster_test_prototype

--- RUN 1 (DROP+CREATE+migrate, cold) ---
DROP+CREATE schema: 316ms
runMigrations: 156ms  (Drizzle migrate() interno: 145ms)
__drizzle_migrations rows: 36

--- RUN 2 (DROP+CREATE+migrate, full reset) ---
DROP+CREATE schema: 20ms
runMigrations: 95ms   (Drizzle migrate() interno: 90ms)
__drizzle_migrations rows: 36

--- RUN 3 (migrate again WITHOUT DROP, in-place idempotency) ---
runMigrations: 4ms    (Drizzle migrate() interno: 3ms)
__drizzle_migrations rows: 36

=== VERDICT ===
[T0 acceptance] Run 1 <30s:                                PASS (156ms)
[T0 acceptance] Run 3 (in-place) <5s:                      PASS (4ms)
[T0 acceptance] No errors:                                 PASS
[T0 acceptance] Migration counts match across runs:        PASS (36/36/36)

>>> T0 PASS — proceed to T1
```

(Logs de Pino del `runMigrations` interno omitidos por brevedad; el output crudo queda en `/tmp/t0-output.log` de la sesión local.)

---

## Próximo paso

**T1** del plan: `vitest.integration.config.ts` + scripts + setup.integration + helper test-db + test ref `SELECT 1`. Sin bloqueos derivados de T0. El script `prototype-test-db.ts` queda en el working tree (untracked) hasta T1b; se borra cuando `globalSetup` real lo reemplace.

Pegado de esta evidencia en el PR body de T1.
