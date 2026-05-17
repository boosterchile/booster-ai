# Plan — Test integration infrastructure para `apps/api`

- **Spec**: [`docs/specs/2026-05-17-test-integration-infra-apps-api.md`](../specs/2026-05-17-test-integration-infra-apps-api.md) (Status: Approved 2026-05-17 ~08:35 UTC)
- **Devils-advocate review de la spec**: [`docs/specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md)
- **Devils-advocate review de este plan**: [`./2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](./2026-05-17-test-integration-infra-apps-api-devils-advocate.md) (7 P0 + 6 P1 + 5 P2 abordados en v2)
- **ADR**: 043 (a crear en T5a)
- **Created**: 2026-05-17 ~08:45 UTC
- **Revised v2**: 2026-05-17 ~09:00 UTC (post devils-advocate del plan v1)
- **Owner**: Felipe Vicencio (PO) + Claude
- **Status**: **Approved** (PO, 2026-05-17 ~09:05 UTC — plan v2 post devils-advocate)

---

## Cambios respecto a v1

Tras devils-advocate review del plan v1 (18 objeciones), v2 incorpora:

- **+T0** (nuevo, prototipo medido) — bloquea D1-D6 hasta tener evidencia de tiempos + idempotencia de `runMigrations` × 2.
- **T1↔T2 fusionadas y reordenadas** — T1 nueva es vertical slice real (config + script + test ref con `SELECT 1`, sin migrations). T1b agrega migrations runner.
- **T5 splittear** en T5a (ADR-043, ~100 LOC), T5b (README integration, ~80 LOC), T5c (skill `integration-test-writing.md`, ~80 LOC — sale de out-of-band).
- **T6 con DoD numérico** — coverage del CI ≥80/75/80 post-merge, medido. Budget LOC 50 con waiver hasta 80 si requiere agregar tests.
- **D3 con válvula de salida** — schema-per-worker (N=4) cuando suite supere 60s sostenidos.
- **D2 con DROP SCHEMA antes de runMigrations** en globalSetup (resuelve idempotencia P0-1).
- **T1 acceptance enumera routes residuales** (P0-6).
- **T4 con job separado paralelo** `test-integration` (P1-2).
- **`sequence.concurrent: false` + lint rule** en vitest.integration.config.ts (P0-3).
- **Watch mode declarado fuera de scope** en README (P1-6).

---

## Decisiones arquitectónicas (D1-D6, post devils-advocate)

### D1 — Motor de DB en test: **Postgres real**

CI: `services.postgres` con `postgres:16-alpine`. Local: dev provee Postgres (Docker, Postgres.app o brew). Tres caminos documentados en README integration. Sin dependencia adicional npm.

Descartadas explícitamente:
- **pglite (Alt E)**: postergada con criterio concreto — si en 3 meses el setup local de Postgres frena onboarding de >1 dev, prototipar pglite como overlay opcional.
- **testcontainers-node**: agrega dependencia que duplica funcionalidad del service container CI; el setup local con `docker run` directo es equivalente sin la dependencia.

### D2 — Migration runner: **`runMigrations` real, invocado en `globalSetup` con DB pre-limpia**

Resuelve P0-1 (idempotencia bajo segunda corrida) **y** P0-2 fidelidad. Pasos del globalSetup:

```ts
// pseudo
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
  await client.query('CREATE SCHEMA public;');
  await client.query(`GRANT ALL ON SCHEMA public TO ${user};`);
  // Re-instalar extensiones explícitas que las migrations no crean si ya existen.
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
} finally {
  client.release();
}
await runMigrations(pool, logger);
```

El `DROP SCHEMA` + `CREATE SCHEMA` garantiza estado inicial limpio cada run. `runMigrations` corre solo en globalSetup (UNA vez por proceso vitest) → su advisory lock no afecta suites paralelas.

Validable en T0 con medición real.

### D3 — Aislamiento entre tests: **TRUNCATE selectivo + `singleFork: true` con válvula de salida**

Inicial:
- Schema único `public` (no schema-per-suite — incompatible con `pgTable()` sin `pgSchema()`).
- Cada test integration `TRUNCATE` las tablas que toca en `beforeEach` vía helper `cleanupTables`.
- Vitest `pool: 'forks'`, `poolOptions.forks.singleFork: true`, `sequence.concurrent: false` (enforce serial).
- Biome lint rule contra `.concurrent` en `test/integration/**`.

**Válvula de salida** (P0-2): cuando la suite integration supere **60s sostenidos** en 3 corridas CI consecutivas, migrar a **schema-per-worker** (N=4 workers vitest):
- `globalSetup` crea N schemas `test_w0`..`test_w3`, aplica migrations en cada uno.
- `createTestDb(workerId)` retorna db con `SET search_path TO test_w<id>, public`.
- Limitación: requiere refactor menor de `seed.ts` para parametrizar el workerId.

La válvula entra al spec/plan separado cuando se dispara el criterio. Hoy no se implementa — sólo se documenta como camino conocido.

Alternativas descartadas:
- **BEGIN/ROLLBACK por test (Alt F del DA spec)**: incompatible con endpoints que abren transacciones internas (`db.transaction()`).
- **DROP+CREATE schema por suite**: requiere `SET search_path` en cada conexión, invasivo.

### D4 — Inyección DB en routes

Resuelve P0-4 (DA spec) + P0-6 (DA plan). Verificación detallada va en T1 acceptance:

- 29/33 routes ya usan factory pattern (`createXxxRoutes({ db, logger })`).
- Las 4 residuales **deben enumerarse** en T1 con `grep -L "createXxxRoutes\\|opts\\.db\\|{ db }" apps/api/src/routes/*.ts`.
- Las routes que importan `createDb` directamente quedan como **bloqueo blando**: si entran en grafo de imports de un test integration, requieren refactor antes.

### D5 — Coverage exclude cleanup

Quitar de `vitest.config.ts` exclude: `src/db/client.ts`, `src/db/migrator.ts`. Mantienen exclude: `src/main.ts`, `src/jobs/**`, `src/server.ts`, `src/db/schema.ts`, `src/**/*.d.ts`, `src/**/index.ts`.

T6 mide antes/después y agrega tests si coverage cae bajo threshold del CI (`lines=80, branches=75, functions=80`).

### D6 — Orden de PRs

Bloque infra (T0-T6) **antes** de re-abrir D11 v2 T8. Confirma decisión PO 2026-05-17 ~08:20.

---

## Módulos tocados

| Módulo / archivo | Tipo de cambio | Tareas |
|---|---|---|
| `apps/api/scripts/prototype-test-db.ts` | nuevo (one-shot script, no committed final) | T0 |
| `apps/api/vitest.integration.config.ts` | nuevo | T1 |
| `apps/api/test/setup.integration.ts` | nuevo | T1 |
| `apps/api/test/integration/setup-global.ts` | nuevo | T1b |
| `apps/api/test/helpers/test-db.ts` | nuevo | T1, T1b |
| `apps/api/test/helpers/seed.ts` | nuevo | T3 |
| `apps/api/test/helpers/cleanup.ts` | nuevo | T3 |
| `apps/api/test/integration/health-db.integration.test.ts` | nuevo | T1 |
| `apps/api/test/integration/migrations.integration.test.ts` | nuevo | T1b |
| `apps/api/test/integration/seed.integration.test.ts` | nuevo | T3 |
| `apps/api/test/integration/migrator-coverage.integration.test.ts` | nuevo (T6 si requiere) | T6 |
| `apps/api/vitest.config.ts` | modificar | T1, T6 |
| `apps/api/package.json` | modificar | T1 |
| `.github/workflows/ci.yml` | modificar | T4 |
| `apps/api/biome.json` o root `biome.json` | modificar (lint rule integration) | T1 |
| `apps/api/test/integration/README.md` | nuevo | T5b |
| `docs/adr/043-integration-testing-infrastructure-apps-api.md` | nuevo | T5a |
| `skills/core-engineering/integration-test-writing.md` | nuevo | T5c |

Total: **13 archivos nuevos, 4 modificados**. Cerca del techo de 10 módulos del skill — justificable por la naturaleza de infra que toca config + helpers + tests + docs simultáneamente.

---

## Tasks

### T0: Prototipo medido (bloquea D1-D6) [DONE 2026-05-17 — PR [#268](https://github.com/boosterchile/booster-ai/pull/268)]

- **Files**:
  - `apps/api/scripts/prototype-test-db.ts` (nuevo, **NO se mergea** — sirve para medir y validar; se descarta tras T1b).
- **LOC estimate**: ~70 (script standalone).
- **Depends on**: nada.
- **Acceptance**:
  - Script arranca `postgres:16-alpine` en Docker local con `docker run --rm -d ...` o asume Postgres local existente.
  - `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `runMigrations` × 2 (segunda corrida debe ser no-op via hash idempotencia de Drizzle).
  - Reporta a stdout: tiempo de primera corrida, tiempo de segunda (no-op), tiempo del DROP+CREATE.
  - Reporta cualquier error en segunda corrida (especialmente `applyOutOfOrderPending` con `CREATE TYPE` colisionando — si pasa, D2 cambia).
  - Captura del output queda pegado en el PR de T1 como evidencia.
- **Rollback**: no aplica — el script no se mergea. Si las mediciones invalidan D2/D3, abrir `/plan` v3.
- **Success criterion para arrancar T1**: primera corrida <30s en local, segunda <5s, sin errores.

### T1: `vitest.integration.config.ts` + scripts + setup.integration + helper test-db + test ref `SELECT 1` [DONE 2026-05-17 — PR [#269](https://github.com/boosterchile/booster-ai/pull/269)]

- **Files**:
  - `apps/api/vitest.integration.config.ts` (nuevo) — config con `globalSetup` placeholder (vacío en T1, real en T1b), `setupFiles=['./test/setup.integration.ts']`, `include=['test/integration/**']`, `pool='forks'`, `poolOptions.forks.singleFork=true`, `sequence.concurrent=false`.
  - `apps/api/test/setup.integration.ts` (nuevo) — versión paralela a `setup.ts`: stubea env vars excepto DATABASE_URL/TEST_DATABASE_URL (los lee del shell), mantiene mock de `google-auth-library`.
  - `apps/api/test/helpers/test-db.ts` (nuevo) — `createTestDb()` retorna `{ pool, db }` apuntando a `TEST_DATABASE_URL`. Rechaza si URL contiene `prod`/`staging`.
  - `apps/api/test/integration/health-db.integration.test.ts` (nuevo) — `SELECT 1` (NO migrations en T1; eso es T1b).
  - `apps/api/vitest.config.ts` (modificar) — agregar `'test/integration/**'` al `exclude` del default run.
  - `apps/api/package.json` (modificar) — scripts `test:integration`, `test:all`.
  - Root `biome.json` o `apps/api/biome.json` (modificar) — lint rule contra `.concurrent` en `test/integration/**`.
- **LOC estimate**: ~95 (40 config + 25 setup + 20 helper + 10 test + 5 lint).
- **Depends on**: T0 (validación previa).
- **Acceptance**:
  - `pnpm --filter @booster-ai/api test` corre solo unit (sin integration), sin cambio de tiempo perceptible.
  - `pnpm --filter @booster-ai/api test:integration` corre `health-db.integration.test.ts` y pasa en <3s local contra `TEST_DATABASE_URL`.
  - Test rojo si `TEST_DATABASE_URL` contiene `prod`/`staging`.
  - Lint rule **falla** si un test usa `.concurrent`.
  - **Enumerar routes residuales**: comando en commit body: `grep -L "createXxxRoutes\\|opts\\.db" apps/api/src/routes/*.ts`. Output documentado. Si hay >0 routes que importan `createDb` directamente, listarlas en commit body como riesgo conocido para T1b/T8 re-open.
- **Rollback**: revertir commit. Suite unit no se afecta.

### T1b: Migration runner integrado en globalSetup [DONE 2026-05-17]

- **Files**:
  - `apps/api/test/integration/setup-global.ts` (nuevo) — globalSetup: `DROP SCHEMA + CREATE SCHEMA + runMigrations`.
  - `apps/api/test/integration/migrations.integration.test.ts` (nuevo) — verifica que tabla `usuarios` existe + count(`drizzle.__drizzle_migrations`) == journal entries count.
  - `apps/api/vitest.integration.config.ts` (modificar) — apuntar `globalSetup` al nuevo archivo.
- **LOC estimate**: ~85 (50 globalSetup + 30 test + 5 config edit).
- **Depends on**: T1, T0.
- **Acceptance**:
  - `pnpm test:integration` corre globalSetup + 2 tests (health + migrations) en <15s local.
  - Re-correr `pnpm test:integration` SEGUNDA vez consecutiva pasa (DROP+CREATE + runMigrations idempotente).
  - Count de migrations aplicadas == count de archivos `.sql` (37 al 2026-05-17).
  - Si `applyOutOfOrderPending` dispara, log warning visible.
- **Rollback**: revertir commit. T1 sigue funcionando (sin migrations).

### T3: Helper `seed()` + `cleanupTables()` + test ref

- **Files**:
  - `apps/api/test/helpers/seed.ts` (nuevo) — primitivas para `usuarios`, `empresas`, `viajes`, `zonas_stakeholder`, `metricas_viaje`. Keys = nombres SQL en español, defaults válidos por FK.
  - `apps/api/test/helpers/cleanup.ts` (nuevo) — `cleanupTables(db, tables)` con `TRUNCATE ... RESTART IDENTITY CASCADE`. Warnea (`logger.warn`) si detecta que CASCADE va a tirar tablas no listadas (consulta `pg_constraint`).
  - `apps/api/test/integration/seed.integration.test.ts` (nuevo) — verifica conteo + FK + cleanup CASCADE warning.
- **LOC estimate**: ~100 (60 seed + 25 cleanup + 15 test). Exacto al límite.
- **Depends on**: T1, T1b.
- **Acceptance**:
  - `seed(db, { usuarios: 2 })` retorna `{ usuarios: [{ id, ... }, ...] }` con FK válidos.
  - `cleanupTables(db, ['usuarios'])` log warn listando `memberships` (FK → usuarios) como tabla colateral.
  - `pnpm test:integration` pasa con 3 tests.
- **Rollback**: revertir commit.

### T4: GitHub Actions job separado `test-integration` (paralelo a `test`)

- **Files**:
  - `.github/workflows/ci.yml` (modificar) — agregar job `test-integration` con `services.postgres`, `needs: [setup]`, `env.TEST_DATABASE_URL`, step `pnpm --filter @booster-ai/api test:integration`. `build` job actualizado a `needs: [lint, typecheck, test, test-integration]`.
- **LOC estimate**: ~40 (block YAML del job).
- **Depends on**: T1, T1b, T3 (sin T3 el job corre con solo 2 tests).
- **Acceptance**:
  - CI verde en PR de T4.
  - Job `test-integration` corre paralelo a `test` (no en serie).
  - Wall-clock CI total NO sube más de 2 min (medido antes/después).
  - Si test integration falla, `build` no corre (verificable introduciendo test rojo y revirtiendo).
- **Rollback**: revertir commit. Otros jobs siguen funcionando.

### T5a: ADR-043

- **Files**: `docs/adr/043-integration-testing-infrastructure-apps-api.md` (nuevo).
- **LOC estimate**: ~100.
- **Depends on**: T1, T1b, T3, T4 (necesita hechos verificables).
- **Acceptance**:
  - Secciones: Context, Decision, Consequences, Alternatives (B, E, F del DA spec), Status.
  - Cita números medidos en T0/T1b (tiempo runMigrations, idempotencia verificada).
  - Documenta válvula de salida `singleFork → schema-per-worker`.
- **Rollback**: revertir commit. La infra funciona, queda sin ADR explícito (riesgo doc).

### T5b: README `apps/api/test/integration/`

- **Files**: `apps/api/test/integration/README.md` (nuevo).
- **LOC estimate**: ~80.
- **Depends on**: T1, T1b, T3.
- **Acceptance**:
  - Cubre 3 caminos de setup local (Docker, Postgres.app, brew).
  - Template para escribir un nuevo integration test.
  - Sección "Watch mode" declarando **fuera de scope** (P1-6 DA plan).
  - Sección "TRUNCATE CASCADE semantics" (P1-5 DA plan) con ejemplo.
  - 5 troubleshooting comunes.
- **Rollback**: revertir commit.

### T5c: Skill `integration-test-writing.md`

- **Files**: `skills/core-engineering/integration-test-writing.md` (nuevo).
- **LOC estimate**: ~80.
- **Depends on**: T5b (README es contenido referencial).
- **Acceptance**:
  - Estructura per CLAUDE.md §3: When to use, Core process (5-7 pasos), Anti-rationalizations, Exit criteria.
  - Referencia explícita a README integration y ADR-043.
- **Rollback**: revertir commit.

### T6: Coverage exclude cleanup (con DoD numérico)

- **Files**:
  - `apps/api/vitest.config.ts` (modificar) — quitar `'src/db/client.ts'` y `'src/db/migrator.ts'` del exclude.
  - `apps/api/test/integration/migrator-coverage.integration.test.ts` (nuevo, opcional según medición).
- **LOC estimate**: ~50 baseline (5 config + 45 tests si requiere). **Waiver hasta 80** si la medición exige más tests.
- **Depends on**: T1b, T3.
- **Acceptance — DoD numérico**:
  - Antes del PR: capturar `pnpm --filter @booster-ai/api test --coverage --reporter=json-summary` → registrar `lines/branches/functions/statements`.
  - Después del PR: capturar las mismas métricas.
  - **Si cualquier métrica baja >2 puntos porcentuales** o **cae bajo el threshold del CI** (`lines=80, branches=75, functions=80`), agregar tests específicos hasta restaurar.
  - Output del coverage report **pegado en el PR body** (sección Evidencia).
- **Rollback**: revertir commit; exclude vuelve al estado previo.

---

## Out-of-band tasks

- **Actualizar `docs/handoff/CURRENT.md`** tras cada merge de T0-T6.
- **Actualizar `apps/api/test/setup.ts`** comentario explicando que `DATABASE_URL` stubea aquí es para unit (integration usa `TEST_DATABASE_URL` vía `setup.integration.ts`).
- **Re-abrir D11 v2 T8** una vez T1b+T3+T4 estén merged (resto opcional pero recomendado antes).

---

## Open questions

Todas las P0/P1 críticas resueltas en §"Decisiones arquitectónicas" arriba o en task acceptance. Quedan estos residuales:

1. **P1-4 (DA plan)**: `concurrency.cancel-in-progress: true` del workflow puede dejar containers Postgres huérfanos en cancelaciones. Mitigación: documentar en T4 que GH se encarga del cleanup; medir post-merge.
2. **Skill `integration-test-writing.md`** ya está en T5c — no más open.
3. **Tiempo real de la suite** será medido en T0 y T1b, no es open question sino acceptance.

---

## Verificación del plan (skill checklist)

- [x] T0-T6 son vertical slices reales (T1 corre `SELECT 1` end-to-end sin migrations; T1b agrega migrations; T3 agrega seed; T4 lleva al CI; T5a/b/c documentan; T6 cierra coverage).
- [x] Todas las tasks ≤ 100 LOC estimate (T0=70, T1=95, T1b=85, T3=100, T4=40, T5a=100, T5b=80, T5c=80, T6=50/80).
- [x] T5 splittear (no waiver inflado).
- [x] Acceptance traza a spec §3 (CR-1..CR-10) para cada task.
- [x] Rollback explícito para cada task.
- [x] Devils-advocate output captured en archivo adjunto.
- [ ] Aprobación PO explícita — pendiente.

---

## Estimación total

- 9 tasks (T0 + T1 + T1b + T3 + T4 + T5a + T5b + T5c + T6) × ~80 LOC promedio = **~620 LOC netas**.
- 8 PRs encadenados (T0 no produce PR — sus mediciones se documentan en T1 PR body).
- Tiempo estimado: 4-6 horas focado distribuidas en 2-3 sesiones.

## Solo-developer adaptation

- Cooling-off 30 min entre cada task.
- Devils-advocate sobre PR de T0/T1, T1b, T5a (las decisiones cerradas).
- Cada task se mergea + mide CI antes de la siguiente.
