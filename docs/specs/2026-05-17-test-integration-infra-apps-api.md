# Spec — Test integration infrastructure para `apps/api`

- **Author**: Felipe Vicencio (PO) + Claude (agent-rigor)
- **Date**: 2026-05-17
- **Status**: Draft
- **Linked**: D11 v2 plan T8-T12 bloqueadas por ausencia de esta infra
- **ADR a crear**: `043-integration-testing-infrastructure-apps-api.md`

---

## 1. Objetivo

Establecer la infraestructura de **integration testing con base de datos real** en `apps/api`: un mecanismo que arranca Postgres aislado por suite, aplica todas las migrations Drizzle (`apps/api/drizzle/*.sql`) contra ese Postgres, expone helpers de seed reusables y permite a cada test ejercer queries reales del code under test sin mockear el query builder. El propósito es desbloquear D11 v2 (T8-T12) y futuras features cuyo correctness depende del SQL ejecutado, no de la lógica in-memory.

## 2. Why now

Auditoría 2026-05-17 sobre `apps/api/test/`: el repo no tiene **ninguna** prueba de integración con DB real. El único acceso a DB es `health.test.ts` (ping). El plan v2 D11 §192 exige *"Tests integration NO mocked-Drizzle — usar test DB real (per spec §10)"* y el handoff D11 v2 lección #3 lo refuerza, pero la implementación de T8 quedó forzada a unit-mocked (`vi.fn()` sobre el query builder) porque no existe el patrón. Resultado: el SQL del endpoint `/stakeholder/zonas` (`LEFT JOIN`, `ANY(comuna_codes)`, `now() - interval '30 days'`, `WHERE is_active`) nunca se ejerce en CI. Si se merge así, T9-T12 heredan el patrón y D11 entera ship con cero evidencia de correctness del SQL — violación directa de CLAUDE.md §2 ("Evidence over assumption"). El bloqueo es pre-requisito de D11 v2.

## 3. Success criteria

Cada criterio verificable por test, output o file existente.

- [ ] **CR-1**: Existe un helper `createTestDb()` en `apps/api/test/helpers/test-db.ts` que retorna `{ db: Db, cleanup: () => Promise<void> }`. La instancia es Postgres real (no mock, no pg-mem) y aislada por suite (schema dedicado o database dedicada).
- [ ] **CR-2**: El helper aplica automáticamente **todas** las migrations Drizzle antes de retornar la `db`. Criterio verificable: tras invocar el helper, `SELECT COUNT(*) FROM drizzle.__drizzle_migrations` debe coincidir con el conteo de entries en `apps/api/drizzle/meta/_journal.json` y con `ls apps/api/drizzle/*.sql | wc -l` (al 2026-05-17: 37 archivos `.sql`, incluyendo colisión `0009_*` doble — ver open question §12 sobre estrategia de runner).
- [ ] **CR-3**: Existe `apps/api/test/integration/` con al menos **un** test de referencia (ej. `health-db.integration.test.ts`) que: arranca DB, aplica migrations, hace un INSERT + SELECT real, valida resultado, limpia. Tiempo total <30s en local, <90s en CI.
- [ ] **CR-4**: `vitest.config.ts` distingue **suites unit vs integration** vía glob (`include`/`exclude`) o tag. `pnpm test` corre unit (rápido, default). `pnpm test:integration` corre integration explícitamente. CI corre **ambos** y reporta cobertura unificada.
- [ ] **CR-5**: Helper `seed(db, fixtures)` con primitivas para insertar `usuarios`, `empresas`, `viajes`, `zonas_stakeholder`, `trip_metrics` con valores válidos por defecto (cumpliendo NOT NULL constraints) y overrides parcial por test.
- [ ] **CR-6**: Postgres en CI provisto vía **GitHub Actions service container** (`services.postgres`) con imagen `postgres:16-alpine` (alineado con prod GCP Cloud SQL). En local, opciones documentadas: (a) Docker Desktop, (b) `pg.app`/Postgres.app, (c) `pg-ext` instalado. Documentación en `apps/api/test/integration/README.md`.
- [ ] **CR-7**: Coverage gate del CI **no se relaja** por la nueva suite. Thresholds reales del CI (`.github/workflows/ci.yml`): `lines=80, branches=75, functions=80`. Hay drift conocido con `apps/api/vitest.config.ts` (functions=75 vs CI 80) — esta spec **no resuelve** el drift; sólo exige que el threshold efectivo del CI se mantenga. Tests integration cuentan en coverage; mocks unit existentes no se borran (coexisten — ver P2-5 del devils-advocate review para criterio futuro de retiro).
- [ ] **CR-8**: `apps/api/test/integration/README.md` documenta: cómo correr local, cómo correr en CI, cómo escribir un test integration (template), troubleshooting de errores comunes (puerto ocupado, role no existe, schema not found).
- [ ] **CR-9**: `ADR-043` registra: decisión (Postgres real vs pg-mem vs testcontainers JS), trade-offs, qué tests **deben** ser integration (regla: cualquier ruta que ejecute SQL no trivial) vs unit (lógica pura).
- [ ] **CR-10**: Migration runner usado en test es el **mismo** que producción (`apps/api/src/db/migrator.ts` o equivalente). Cualquier divergencia (skip de migrations, orden distinto) prohibida y verificable en review.

## 4. User-visible behaviour

Cero usuarios finales afectados — esto es infra de testing. Cambios visibles para el desarrollador:

- **BEFORE**: `pnpm test` corre solo unit-mocked. Imposible verificar SQL real sin desplegar a staging.
- **AFTER**:
  - `pnpm test` corre unit (sin cambio de tiempo perceptible).
  - `pnpm test:integration` corre suite integration con DB real.
  - `pnpm test:all` corre ambos.
  - CI corre ambos y falla si cualquiera falla.
  - Nuevo template documentado para escribir un integration test.

## 5. Out of scope

Explícitamente **NO** cubre:

- **Migrar tests unit-mocked existentes a integration**. Esta spec crea la infra; la migración progresiva es trabajo de cada feature subsecuente.
- **Tests E2E con frontend** (Playwright/Cypress). Esos son otra capa y otra spec.
- **Test data factory (Factory Bot / Faker patterns)**. Helpers de seed primitivos son suficientes; framework de factories puede emerger después si hay demanda.
- **Performance tests** (`apps/api/test/perf/`). T12 D11 los necesita pero es scope separado.
- **DB testing para apps no-api** (`apps/web`, `apps/matching-engine`, etc.). Cada app decide su estrategia; esta spec aplica solo a `apps/api`.
- **Sustituir Postgres por base distinta**. Cloud SQL Postgres es el target prod; test usa mismo motor.
- **Reset/rollback intra-test** vía savepoints. Cleanup por suite (drop schema) es suficiente; savepoints introducen complejidad sin beneficio demostrado todavía.

## 6. Constraints

- **Performance**: integration suite total ≤90s en CI. Si excede, particionar por dominio o usar schema-per-suite + paralelismo.
- **Reproducibilidad**: tests deterministas. Sin `now()` no-mockeado en assertions; cualquier dato dependiente de tiempo usa `INSERT` con timestamp explícito o el test fija el reloj.
- **Aislamiento**: ningún test integration debe leer/escribir estado dejado por otro test. Schema-per-suite o DROP+CREATE entre suites.
- **Compatibilidad**: pg `16-alpine` mismo major que prod Cloud SQL. Si prod cambia, test sigue.
- **Costos CI**: GH Actions service container Postgres es gratis dentro del runner. Sin costos extra.
- **Seguridad**: tests **nunca** apuntan a DBs reales (staging, prod). El connection string viene de un env var dedicado (`TEST_DATABASE_URL`) y el helper falla si detecta `staging`/`prod` en el host.
- **Compliance**: tests no procesan datos reales de usuarios. Fixtures son sintéticos.

## 7. Approach

Dos decisiones técnicas centrales que el ADR-043 documentará:

**Decisión A — Motor de DB en test**: Postgres real (vía service container en CI, Docker/Postgres.app en local), no `pg-mem` ni `testcontainers-node`. Razón: paridad con prod. `pg-mem` no soporta `ANY(array)`, intervals complejos ni varios features de Postgres 16 que el código de Booster AI usa. `testcontainers-node` añade dependencia, complejidad de lifecycle y requiere Docker tanto en local como CI (ya tenemos Docker en CI, pero local sería fricción).

**Decisión B — Aislamiento por suite**: cada suite (file) recibe un **schema** dedicado (`test_<random>`) dentro de la misma DB, no una DB nueva. Razón: crear DB es lento (>2s); crear schema es <100ms. Cleanup vía `DROP SCHEMA ... CASCADE` al final de la suite. Esto permite paralelismo seguro y mantiene la suite <90s.

**Files que se tocan**:

- `apps/api/package.json` — scripts `test:integration`, `test:all`, dependency `pg` ya existe.
- `apps/api/vitest.config.ts` — `exclude` para integration en el run default + `vitest.integration.config.ts` separado.
- `apps/api/test/helpers/test-db.ts` (nuevo) — helper `createTestDb()`.
- `apps/api/test/helpers/seed.ts` (nuevo) — primitivas de seed.
- `apps/api/test/integration/README.md` (nuevo) — documentación.
- `apps/api/test/integration/health-db.integration.test.ts` (nuevo) — test de referencia.
- `.github/workflows/ci.yml` — agregar service `postgres` + step `pnpm test:integration`.
- `docs/adr/043-integration-testing-infrastructure-apps-api.md` (nuevo) — ADR de decisión.

## 8. Alternatives considered

- **A. `pg-mem` (in-memory pure JS Postgres-compatible)** — Rechazada: no implementa `ANY(array)` con types como `text[]`, no soporta `interval`, no honra el resto de extensiones que las migrations usan (`pgcrypto`, etc.). Sería un mock-elaborado que aceptaría queries falsas como válidas — el mismo problema que motivó esta spec.
- **B. `testcontainers-node` con imagen Postgres** — Rechazada **con razón débil** (devils-advocate P1-1): `testcontainers-node` tiene `withReuse()` que arranca un solo container por test session, así que el overhead no es por-suite. Razones reales para no usarlo: agrega una dependencia más, primera latencia de pull, y dependencia de Docker en local que ya tendría que estar disponible. Decisión a confirmar en `/plan` después de pesar `pglite` (Alternativa E) — testcontainers podría volver a estar en juego.
- **C. SQLite en memoria con drizzle-kit `sqlite` driver** — Rechazada: cambiar de dialecto rompe el SQL del producto (Drizzle genera SQL distinto, `serial` vs `autoincrement`, sin `interval`, sin enums Postgres). Es una pérdida de paridad inadmisible.
- **D. Tests integration corren **solo** en CI, no en local** — Rechazada: rompe el ciclo de feedback corto del desarrollador. Solo-developer mode (CLAUDE.md §6) requiere poder iterar local antes de push.
- **E. `electric-sql/pglite` (WASM Postgres real, in-process)** — **A evaluar en `/plan`**: WASM build del Postgres real, arranque <1s, mismo dialecto, soporta `ANY(array)`, intervals, extensiones (`pgcrypto`, `uuid-ossp`). Sin Docker en local. Limitaciones reportadas: extensiones que requieren shared libs nativos, paralelismo limitado (proceso único), foreign data wrappers. Si el conjunto de features que Booster AI usa cabe dentro de pglite, sería la opción de menor fricción para dev local. Pendiente verificación con el set real de migrations.
- **F. Shared DB + transacción por test con `BEGIN`/`ROLLBACK`** — **A evaluar en `/plan`**: patrón industrial (Rails, Django, knex test helpers). UNA DB, cada test envuelve su trabajo en `BEGIN ... ROLLBACK`, sin DROP entre tests. Ventajas: 5-10x más rápido que schema-per-suite, no requiere coordinación de paralelismo. Desventajas: rompe con código que abre sus propias transacciones; el endpoint de Booster AI probablemente abre transacciones internas (vía Drizzle `db.transaction`), lo cual entra en conflicto con la transacción externa del test. Verificable solo midiendo. La decisión final entre B/E/F la toma `/plan` con prototipo medido.

## 9. Risks and mitigations

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Tests integration flaky por timing/orden | Media | Alto (CI rojo intermitente) | Schema-per-suite + cleanup obligatorio + sin paralelismo intra-suite; assertions deterministas (timestamps explícitos). |
| Postgres local no disponible para dev nuevos | Alta | Medio (fricción onboarding) | README con tres caminos (Docker, Postgres.app, brew install postgresql@16); script `pnpm test:integration:setup` que valida y guía. |
| Suite integration crece sin control y excede 90s CI | Media | Medio (CI lento) | Budget explícito en CR-1 (90s). Si excede, ADR-043 §evolución obliga particionar. |
| Drift entre migration runner test vs prod | Baja | Alto (test verde, prod rojo) | CR-10: mismo runner. Test que valida lista de migrations aplicadas == lista en `apps/api/drizzle/*.sql`. |
| Dependencias adicionales (Docker, pg client) crean fricción | Media | Bajo | Documentación + script setup. Si dev no tiene Docker, Postgres.app cubre el caso. |
| Tests integration usados como "todo es integration" → erosionan unit suite | Baja | Medio | ADR-043 fija la regla: unit para lógica pura, integration para rutas/queries. Code review aplica. |
| **Extensiones Postgres colisionan entre suites paralelas** (devils-advocate P1-4) | Media | Alto (CI rojo intermitente difícil de debuggear) | Las migrations existentes hacen `CREATE EXTENSION IF NOT EXISTS` y `CREATE TYPE`. Schemas aislados no aíslan extensiones (son a nivel de DB). Mitigación: precrear extensiones en el container Postgres antes del primer test (init script en GH service `volumes`); secuenciar `CREATE TYPE` con `IF NOT EXISTS` o try/catch. Validable con T-INFRA-3 (paralelismo). |
| **Migration runner hereda bug de 0009 duplicado** (devils-advocate P1-5) | Alta (ya existe en main) | Medio | `apps/api/drizzle/0009_*.sql` tiene dos archivos con mismo prefijo; `migrator.ts` ya implementa recovery out-of-order vía hash. La infra de test heredará el mismo path: o usa `runMigrations` (advisory lock + recovery, fidelidad pero serializa) o `drizzle-orm/postgres-js/migrator` directo (rápido pero no fideliza el bug-recovery). Decisión a tomar en `/plan` y registrar en ADR-043. |
| **Pool exhaustion bajo paralelismo** (devils-advocate P1-6) | Media | Medio | Cálculo: 4 workers vitest × 5 conexiones (`DATABASE_POOL_MAX=5`) = 20 conns vs `max_connections=100` Postgres default. Margen amplio. Pero el advisory lock del migrator serializa de facto si se invoca por suite. Reducir `DATABASE_POOL_MAX=2` en test, o consolidar migrations en setup global single-shot. |
| **Service container Postgres añade ~30-90s de startup CI** (devils-advocate P1-7) | Alta (cada job) | Bajo (predecible) | El budget de 90s de CR-3 cubre el wall-time de **la suite**, no el startup del job. Documentar en ADR-043 que el wall-clock total del job es ~5min y eso es aceptable (la suite unit añade ~2min hoy). |

## 10. Test list

- **T-INFRA-1**: `health-db.integration.test.ts` arranca DB, aplica migrations, hace `SELECT 1`, cleanup. Pasa en <5s local.
- **T-INFRA-2**: `seed.integration.test.ts` invoca `seed(db, { usuarios: 2, empresas: 1, viajes: 3 })`, verifica conteo y FK integridad.
- **T-INFRA-3**: Helper `createTestDb()` con TWO concurrent suites (paralelismo vitest) no se pisan — cada una ve solo su schema.
- **T-INFRA-4**: Helper rechaza connection string con `prod`/`staging` en host (test de seguridad).
- **T-INFRA-5**: Migration runner aplica `0001` a `00XX` (todas las que existan al momento) sin errores.
- **T-INFRA-6**: CI workflow `.github/workflows/ci.yml` ejecuta `pnpm test:integration` y falla si test integration falla (verificado introduciendo un test rojo a propósito y revirtiendo).

## 11. Rollout

- **Feature-flagged?** No. Infra de test es código que solo corre en CI/local, no afecta runtime.
- **Migration needed?** No (las migrations existen ya; este trabajo las aplica en test, no las modifica).
- **Rollback plan**: si la infra introduce flaky o lentitud CI inaceptable, revertir el PR. Los tests unit existentes siguen pasando porque coexisten. Sin pérdida de cobertura.
- **Monitoring**: tiempo total CI antes/después del merge. Si excede 5min global, abrir issue de optimización. % de tests integration vs unit semanal.

## 12. Open questions

Bloqueantes (deben resolverse en `/plan` antes de `/build`):

1. **P0-2 — CR-2 vs CR-10 (fidelidad vs paralelismo)**: usar `runMigrations` de `migrator.ts` (real-prod, advisory lock `938472561` que serializa todas las suites) o `migrate()` de `drizzle-orm/postgres-js/migrator` (rápido, sin advisory lock, pierde el recovery custom de 0009-duplicate). Decisión cierra `/plan` y se documenta en ADR-043.
2. **P0-3 — Aislamiento real con tablas en `public`**: las tablas Drizzle usan `pgTable('usuarios', ...)` sin `pgSchema()`, todas caen en `public`. Schema-per-suite (Decisión B §7) **no funciona** sin: (a) wrapper que setea `SET search_path TO test_<random>, public` por conexión, (b) reescribir todo `schema.ts` con `pgSchema()` (cambio invasivo), o (c) caer a DB-per-suite (más caro). `/plan` decide cuál y prototipea.
3. **P0-4 — Inyección de DB en el code-under-test**: `src/db/client.ts` inicializa `pg.Pool` a nivel de módulo al primer import. Para que el test integration use un schema dedicado, el endpoint debe **aceptar `db` por parámetro** (la route `createStakeholderRoutes({ db, logger })` ya lo hace — bien) o vitest debe correr cada suite en proceso separado (`pool: 'forks'`, costoso). Validar que **todas** las routes futuras siguen el patrón de inyección.
4. **P0-6 — Quitar `migrator.ts`/`client.ts` del coverage exclude**: hoy `vitest.config.ts` los excluye con justificación "cubierto vía integration tests" (excluído pero no realmente cubierto). Cuando esta infra exista, el exclude pierde justificación y se debería quitar. Pero hacerlo sube el denominador y posiblemente tira el threshold. `/plan` decide si se quita en este sprint (con tests adicionales que compensen) o se difiere.
5. **Posición en el orden de PRs**: la spec asume "infra primero, T8 después". Confirmado por el bloqueo formal de T8-T12 en plan v2 D11. No es realmente abierto — registrarlo como decisión explícita en `/plan`.

No bloqueantes (se pueden cerrar durante `/plan` o quedar como residuales):

6. **Coverage de la infra misma**: ¿gate explícito (ej. 90% del helper) o se confía en que se usa por todos los tests integration? Default propuesto: gate normal del package.
7. **`setup.ts` único o split unit/integration** (devils-advocate P1-10): el current stubea env vars y mockea `google-auth-library`. Integration necesita NO stubear `DATABASE_URL`. Probable: dos setup files (`setup.ts` para unit, `setup.integration.ts` para integration) que comparten el mock de google-auth-library.
8. **Skill formal para escribir tests integration** (devils-advocate P2-6): CLAUDE.md §3 obliga si la tarea es repetible. Crear `skills/core-engineering/integration-test-writing.md` como parte de esta spec o como follow-up.
9. **ADR-043 número libre**: verificar que 043 es el siguiente disponible (último ADR identificado en el repo: 042). Confirmar antes de redactar el ADR.

## 13. Decision log

- 2026-05-17 — Initial draft (Claude bajo agent-rigor) tras auditoría que reveló ausencia de infra integration en `apps/api` durante intento de cerrar D11 v2 T8.
- 2026-05-17 — Devils-advocate review pasado vía sub-agente `agent-rigor:devils-advocate`. Output completo en [`./2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](./2026-05-17-test-integration-infra-apps-api-devils-advocate.md). Hallazgos verificados de hecho: 37 migrations (no 36+ ni 35); colisión `0009_*` confirmada; drift coverage CI/vitest confirmado. Spec actualizada: CR-2 reformulado, CR-7 reformulado con threshold real del CI, §8 alternativas E y F agregadas, §9 riesgos P1-4..P1-7 agregados, §12 open questions P0-2/3/4/6 agregadas como bloqueantes de `/plan`. P2 quedan para conversación PO.
