# Devils-advocate review — plan test-integration-infra-apps-api

**Plan target**: [`./2026-05-17-test-integration-infra-apps-api.md`](./2026-05-17-test-integration-infra-apps-api.md)
**Reviewer**: `agent-rigor:devils-advocate` (auto-invocado por skill `20-planning-and-task-breakdown` §Step 7)
**Date**: 2026-05-17 ~08:55 UTC

---

## Resumen ejecutivo

> El plan **no es mergeable as-is**. Tiene 7 P0 que mayoritariamente son **decisiones de arquitectura que el plan declara cerradas (D1-D6) pero que no están probadas con evidencia medida**. La spec §8 dijo "decisión final con prototipo medido" y el plan saltó esa parte.

7 P0 + 6 P1 + 5 P2 = 18 objeciones.

## Tabla de hallazgos críticos verificables

| ID | Hallazgo | Acción tomada en plan v2 |
|---|---|---|
| P0-1 | `runMigrations` no idempotente bajo segunda corrida (`applyOutOfOrderPending` hace INSERT raw + `CREATE TYPE` sin `IF NOT EXISTS`) | T1.5 (nuevo) — globalSetup hace `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` antes de `runMigrations`. Verifica idempotencia mediendo. |
| P0-2 | `singleFork=true` no escala 6 meses (~125s en 250 tests sin paralelismo) | D3 documenta tradeoff y agrega §"Válvula de salida": migrar a schema-per-worker (N=4) cuando suite supere 60s sostenidos. Decisión deferida con criterio explícito. |
| P0-3 | Vitest `concurrent` dentro de file rompe TRUNCATE aislamiento | T2 agrega `sequence.concurrent: false` global + biome lint rule contra `*.concurrent` en `test/integration/**`. |
| P0-4 | T1 es horizontal slice (entrega código no ejecutable sin T2) | T1↔T2 reordenadas: T1 entrega config + scripts + test ref con `SELECT 1` (sin migrations todavía). T1b entrega migrations runner. T2 (anterior) absorbida. |
| P0-5 | T6 DoD circular ("agregar tests si baja") | T6 con DoD numérico: medir `lines/branches/functions` antes y después; si cualquier métrica baja >2 pp, agregar tests; budget LOC 50 con waiver hasta 80. |
| P0-6 | Plan dice "29/33 routes usan DI" sin enumerar las 4 residuales | T1 acceptance amplía: enumerar las routes que importan `createDb` o `db` global; verificar que ninguna entra en grafo de import de tests integration de T8. |
| P0-7 | Falta T0 (prototipo medido) — D1-D6 declaradas sin evidencia | T0 (nuevo) — script `scripts/prototype-test-db.ts` que mide `runMigrations` × 2 contra Postgres-16-alpine vacío. Reporta tiempo + idempotencia. Bloquea T1. |

## P1 abordadas en plan v2

| ID | Hallazgo | Acción |
|---|---|---|
| P1-1 | T5 180 LOC waiver sospechoso (README + ADR son artefactos distintos) | T5 splittear en T5a (ADR-043, ~100 LOC) + T5b (README integration, ~80 LOC) + T5c (skill `integration-test-writing.md`, ~80 LOC — saca de out-of-band). |
| P1-2 | CI job integrado sube wall-time a ~8-9min | T4 decide hoy: job separado paralelo `test-integration` con su propio `services.postgres`. |
| P1-3 | T4 depende de T3 también (sin seed, suite integration es 1 test) | T4 dependencies actualizada: T1, T1b, T2, T3. |
| P1-5 | `TRUNCATE … CASCADE` puede tirar tablas no listadas | README integration documenta semantics CASCADE + helper `cleanupTables` warnea si detecta CASCADE implicit (no enforce). |
| P1-6 | Watch mode roto sin mención | README integration declara: **no hay `test:integration:watch`**. Para iterar en un test, correr el archivo: `vitest run test/integration/foo.test.ts --config vitest.integration.config.ts`. |

## P1 residuales (aceptadas)

- **P1-4** (concurrency group del CI): no crítico, no bloquea. Documentado como residual.

## P2 (drift signals)

- **P2-1** "recalibrable tras T1" — drift vocabulary. Reformulado en plan v2 como "medición concreta tras T0".
- **P2-2** pglite (Alt E) postergada sin razón fuerte — plan v2 agrega criterio de re-evaluación: si en 3 meses el setup local de Docker/Postgres frena onboarding de >1 dev, prototipar pglite.
- **P2-3** testcontainers descartado con razonamiento débil — plan v2 agrega referencia a la decisión D1 con justificación clara.
- **P2-4** falta devils-advocate sobre primer PR T0/T1 — plan v2 documenta que cada PR significativo (T0, T1b, T5a) recibe devils-advocate pre-merge.
- **P2-5** skill `integration-test-writing.md` movido a T5c (P1-1).

---

## Output completo del devils-advocate

> No te voy a felicitar. El plan es **mejor que el promedio** pero tiene huecos lógicos cruciales que la spec no podía cerrar y el plan tampoco cierra. Reporte brutal abajo. 7 P0, 6 P1, 5 P2.
>
> ---
>
> ## P0 — Bloqueantes (deben resolverse antes de `/build`)
>
> ### P0-1. D3 (TRUNCATE selectivo + singleFork) tiene un edge case que rompe la fidelidad con prod: **CREATE TYPE / CREATE EXTENSION son state global del schema/DB, no se "truncan"**
>
> Verificado en el repo: las migrations crean **>15 enum types** (`actor_cancelacion`, `estado_viaje`, `estado_oferta`, …) y al menos una `CREATE EXTENSION`. Estos viven a nivel de schema/DB, no de tabla. `TRUNCATE table RESTART IDENTITY CASCADE` **no los toca**.
>
> Esto es benigno para el aislamiento de datos, pero el plan vende D3 como "aislamiento entre tests" sin explicitar que **el orden de migrations queda parcial-aplicado entre runs locales sucesivos si el dev re-corre migrations** (ej. cambia una migration, vitest watch re-arranca, y el `CREATE TYPE foo` colisiona con el ya existente porque `runMigrations` no es idempotente sobre tipos sin `IF NOT EXISTS`).
>
> Mitigación que el plan omite: en `globalSetup` necesitas decidir entre **(a)** wipe completo (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` antes de `runMigrations`), o **(b)** detectar "DB ya migrada con journal hash actual" y hacer no-op. El plan dice "runMigrations real" pero no dice qué pasa cuando ya corrió antes. **Lee de nuevo `migrator.ts:75-105`** — `migrate()` de Drizzle es idempotente vía hash en `drizzle.__drizzle_migrations`, OK, pero `applyOutOfOrderPending` lee `_journal.json` y aplica raw SQL en transacción **sin `IF NOT EXISTS`**. Una segunda corrida con la misma DB **fallará** en el INSERT del marker (constraint hash) o en algún `CREATE TYPE` si recovery dispara.
>
> **Acción**: el plan debe especificar el estado inicial de la DB del CI/local cada run, no asumirlo.
>
> ### P0-2. **`singleFork: true` invalida CR-3 a 6 meses vista y el plan lo trata como un "tradeoff aceptable"**
>
> Hoy hay 0 integration tests. Plan dice "recalibrable tras T1". Eso es punteo defensivo. Hagamos el cálculo:
>
> - `runMigrations` con 37 SQL files + recovery + advisory lock: medible solo después de T1, pero típico Postgres-16 local con 37 migrations modestas: **3-8s solo el setup**.
> - Cada test integration que hace seed + assert + cleanup: **150-400ms realistas**.
> - T8 D11 solo abre 8-12 tests integration sobre `/stakeholder/zonas`.
> - 50 tests × 250ms promedio + setup global = **15-20s**. OK.
> - Pero D11 v2 T9-T12 + features futuras → fácilmente **150-300 integration tests en 6 meses**.
> - 250 × 300ms + setup = **75s + 8s = 83s**. Sin paralelismo. Roza el budget.
> - 250 × 500ms (algunos tocan múltiples tablas) = **125s + setup → CR-3 violado**.
>
> El plan **acepta** este escenario sin diseñar una válvula. Decir "particionar tests" es punteo: ¿particionar cómo, si las tablas son las mismas? `pool: 'threads'` no funciona porque el código de las routes asume su pool, que es proceso-local.
>
> **Acción**: el plan necesita definir hoy el **mecanismo de salida** de singleFork. Una alternativa real, hoy verificable: schema-per-worker con `SET search_path TO test_w<N>, public` por conexión en `createTestDb()`. Eso requiere DB-per-worker o schema-per-worker con DDL replicada. El plan descarta schema-per-suite por invasivo, pero **no analiza schema-per-worker** (N=4 workers vitest, no N=numFiles). Esa alternativa no aparece. Hueco real.
>
> ### P0-3. **D3 (TRUNCATE) no aísla tests dentro del mismo file que se ejecutan en paralelo**
>
> Vitest, incluso con `singleFork: true`, **paraleliza tests dentro de un mismo file** vía `test.concurrent` o cuando el usuario llama `describe.concurrent`. `singleFork` solo serializa archivos.
>
> Más importante: vitest 1.x ejecuta `it()` dentro de un `describe` **secuencialmente por default**, pero el plan no documenta esa asunción ni la enforcea. Si en 3 meses alguien agrega `describe.concurrent('...')` para acelerar la suite local, **TRUNCATE entre tests dejará de aislar** y los tests pisarán datos del otro.
>
> **Acción**: enforcear el modo secuencial vía `sequence.concurrent: false` global en `vitest.integration.config.ts` y un ESLint/biome rule contra `*.concurrent` en `test/integration/**`. El plan no lo menciona.
>
> ### P0-4. **T1 NO es vertical slice, es 3 horizontal slices empaquetadas**
>
> T1 entrega:
> 1. `setup-global.ts` (vitest globalSetup)
> 2. `test-db.ts` (factory `createTestDb()`)
> 3. `health-db.integration.test.ts` (test ref)
>
> Pero T1 no tiene un script funcional `pnpm test:integration` corriendo todavía — eso es T2. Entonces T1 entrega código que **no puede ejecutarse por nadie**: si T1 se mergea sin T2, ese test no corre en CI, no corre local (no hay script), y el coverage gate ni siquiera lo ve. Eso es **horizontal slice** (capas, no end-to-end). Viola el criterio que el propio plan se aplica en el checklist L189.
>
> **Acción**: invertir T1↔T2 o fusionarlos. La vertical slice mínima es: `vitest.integration.config.ts` + script + `setup-global.ts` + un test que corre y prueba `SELECT 1` sin migrations todavía (~80 LOC). Migration runner integrado en una T1b.
>
> ### P0-5. **T6 (coverage exclude cleanup) tiene Definition of Done circular y peligrosa**
>
> T6 dice: "quitar exclude → si coverage baja, agregar tests específicos en este mismo PR".
>
> ¿Cuántos tests? ¿Qué porcentaje hay que recuperar? ¿Y si `client.ts` tiene un branch que solo se ejerce con un pool exhausted (timeout) — agregamos un test que provoca timeout real?
>
> `vitest.config.ts:34-39` muestra thresholds **75%/75%/80%/80%** (functions=75 no 80; coverage gate del CI espera **80% en functions** según `ci.yml:23`). Hay **drift documentado en la spec CR-7** y T6 no lo aborda. Si T6 quita los excludes, el denominator sube → el porcentaje baja → posiblemente el CI rojo. El plan dice "agregar tests específicos" como si fuera mecánico, pero **el alcance real de T6 es indeterminado**: 30 LOC del test del migrator + ¿cuánto más?
>
> **Acción**: T6 necesita un budget de LOC con waiver explícito y una métrica concreta ("coverage del CI ≥ 80%/75%/80% post-merge, mide con `pnpm test:coverage` antes de PR"). Sin eso, T6 es un cheque en blanco.
>
> ### P0-6. **El plan asume `TEST_DATABASE_URL` pero `setup.ts:32` ya stubea `DATABASE_URL` con valor falso, y los routes importan `client.ts` que llama `createDb()` sobre `process.env.DATABASE_URL`**
>
> Verificado en código: `apps/api/test/setup.ts:32` hace `process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test'`. Eso es para unit. Si `setup.integration.ts` no stubea DATABASE_URL y `runMigrations` recibe el pool del helper (OK), **pero los routes bajo test importan `createDb` indirectamente vía `main.ts` chain o el `server.ts` arranca`, ¿pasa qué?**
>
> Verificado: 19 routes (`admin-cobra-hoy.ts`, `admin-dispositivos.ts`, `admin-jobs.ts`, …, `auth-driver.ts`, `auth-universal.ts`, …) están marcadas como "SUSPECT" por mi grep — pueden estar importando `createDb` directamente o llamando al pool al primer import. **El plan declara "29/33 routes ya usan DI" pero no nombra las 4 residuales ni verifica el resto**.
>
> Si una de esas routes entra en el grafo de imports de un integration test (vía el server full o vía el handler chain), va a abrir un segundo pool con `process.env.DATABASE_URL` apuntando a `localhost:5432/test` o lo que sea. Eso **no es lo que el test quiere**.
>
> **Acción**: el plan necesita listar **explícitamente** las 4 routes residuales (D11 v2 ya verificó parte de esto) y los routes en `apps/api/src/routes/admin-*` que el grep sospecha. Hasta que el plan no enumere, "29/33" es una estadística sin trazabilidad.
>
> ### P0-7. **Falta T0 — pre-flight de validación de assumptions**
>
> El plan asume:
> - 37 migrations corren limpio contra Postgres-16-alpine vacío en <30s.
> - `runMigrations` es idempotente bajo segunda llamada (no lo es, ver P0-1).
> - `applyOutOfOrderPending` no re-ejecuta DDL nunca (asume pero no verifica).
> - Las 37 SQLs no tienen DDL que GH service container Postgres-16-alpine no soporte (extensiones específicas, `CREATE EXTENSION pgcrypto`).
>
> Ninguna de estas asunciones está validada con un prototipo medido. La spec §8 alternativa B/E/F dice literalmente "decisión final entre B/E/F la toma `/plan` con **prototipo medido**". El plan declara D1-D6 **sin prototipo**.
>
> **Acción**: T0 (no opcional) — script ad-hoc que arranca `postgres:16-alpine` en Docker local, corre `runMigrations` dos veces seguidas, mide tiempo, verifica idempotencia. Si T0 falla, D2 o D3 cambian. Plan actual saltearía T0 y descubriría el problema en T4 cuando CI esté rojo.
>
> ---
>
> ## P1 — Riesgos serios (deben quedar registrados, addressing recomendado)
>
> ### P1-1. **T5 con 180 LOC de doc + ADR cohesivo es trampa de waiver**
>
> El skill establece 100 LOC budget. T5 lo dobla con "doc cohesiva, no scope creep". Pero el contenido es **README (80 LOC) + ADR (100 LOC)** — dos artefactos **distintos**, distintos lectores, distintos ciclos de vida. El ADR es decisión, vive en `docs/adr/`, supersede pattern. El README es operativo, vive en `apps/api/test/integration/`, cambia con cada nuevo template de test. **Splittealos**: T5a (ADR-043, ~100 LOC) y T5b (README, ~80 LOC). Cada uno cabe en budget. El "waiver" es punteo.
>
> ### P1-2. **Tiempo CI subestimado en la open question #2**
>
> Plan dice "si wall-time del job sube de ~5min hoy a >8min, separar". Pero:
> - `setup` job (install deps): ~1.5min en cache hit.
> - Postgres service container startup: 30-60s adicionales **solo en el job test**.
> - `runMigrations` 37 archivos con recovery validation: 5-15s.
> - 50-100 integration tests × 200-400ms + 10s coverage report: 30-50s.
>
> Realista: el job `test` actual de ~3min se va a ~5-6min con integration. **El umbral "8min" del plan ya está al borde**. Pero más importante: agregando integration al job test **secuencialmente**, bloquea el job `build` (que tiene `needs: [lint, typecheck, test]` en `ci.yml:145`). El wall-clock total del CI sube de **~5min a ~8-9min**.
>
> **Acción**: job separado paralelo `test-integration:` ES la respuesta correcta hoy, no "esperar y ver". El plan debería decidirlo.
>
> ### P1-3. **Dependencias entre tasks subestimadas: T4 depende de T3 también**
>
> T4 (CI step) "depende de T1+T2" per el plan. Pero si T3 (seed) no existe, **¿qué tests integration corren en CI?** Solo `health-db.integration.test.ts` de T1. Eso degrada `pnpm test:integration` en CI a una vanity check de 1 test. Si la idea es validar el patrón completo en CI, T4 también debe esperar T3.
>
> **Acción**: T4 → depends on T1, T2, T3. Reordenar o aceptar que T4 ship temprano con cobertura mínima y se "engorda" en T5.
>
> ### P1-4. **El plan no menciona el `concurrency` group del CI**
>
> `ci.yml:13` tiene `concurrency: cancel-in-progress: true` en el workflow. Si Postgres service container está corriendo y el job se cancela mid-test, **el siguiente push** levanta un nuevo container limpio (OK) pero el patrón de uso del runner cambia. No crítico pero **no fue revisado**.
>
> ### P1-5. **`TRUNCATE … CASCADE` puede romper FK que el dev no esperaba**
>
> D3 lista "TRUNCATE table1, table2, ... RESTART IDENTITY CASCADE". `CASCADE` propaga a TODAS las tablas con FK hacia las truncadas, **incluyendo las que no listaste**. Si un test toca `usuarios` y olvida listar `memberships` (FK → usuarios), `TRUNCATE usuarios CASCADE` va a vaciar memberships también — esperado, pero ¿el test sabe? Si el siguiente test asume "memberships pobladas en seed previo", se rompe.
>
> **Acción**: el helper `cleanupTables` debería **detectar CASCADE implicit** y warnear, o forzar al dev a listar el conjunto cerrado completo. Plan no lo aborda.
>
> ### P1-6. **Watch mode (`pnpm test:watch`) explícitamente roto sin mención**
>
> `runMigrations` corre en `globalSetup`. En vitest watch, `globalSetup` corre **una vez** por watch session. Si el dev cambia una migration SQL y re-corre, `globalSetup` no re-evalúa. Tampoco se hace `TRUNCATE` entre runs del watch — depende del cleanup del test.
>
> Más grave: en `pnpm test:integration:watch` (que el plan no menciona pero existirá), un dev que edita una migration y guarda, **no ve el cambio aplicado a la DB de test** hasta matar el watch.
>
> **Acción**: plan debe documentar que **no hay watch para integration** o explicar mecanismo de reload. Open question.
>
> ---
>
> ## P2 — Drift signals y misc
>
> ### P2-1. **"recalibrable tras T1" aparece 2 veces** (L41, L181)
> Drift vocabulary del agent-rigor. "Recalibrable" es eufemismo de "no decidí esto, lo verás en CI". L41 sobre CR-3 y L181 abiertamente. Aceptable porque está en sección "open questions" la segunda, pero la primera es decisión D3 — sospechosa.
>
> ### P2-2. **"si excede, particionar tests o evaluar pglite como overlay opcional"** (L181)
> "Evaluar pglite como overlay opcional" es **literalmente posponer la decisión de Alt E** que la spec §8 listó como "A evaluar en `/plan`". El plan no la evaluó. La declaró postergada (L23: "postergada — si el dev local sufre fricción"). Pero el devils-advocate review de la spec presumiblemente la pedía como prototype-or-discard. El plan no la prototyped, no la discardea con razón fuerte; la pone en cola.
>
> ### P2-3. **"No aporta sobre el approach elegido"** (L24, sobre testcontainers)
> Razonamiento débil. Testcontainers `withReuse()` resuelve EXACTAMENTE el problema de "Postgres local no disponible para dev". El plan lo descarta con una línea. Sin demostrar trade-offs medidos.
>
> ### P2-4. **El plan menciona "30 min cooling-off" pero no menciona el devils-advocate previo a `/build`**
> CLAUDE.md §3 / agent-rigor habla de devils-advocate sobre plan después de redactarlo, **antes de build** (L209). Es este review. OK. Pero falta menciónar **otra ronda de devils-advocate sobre el primer PR (T1) post-build** — patrón estándar.
>
> ### P2-5. **Skill `integration-test-writing.md` queda como "out-of-band"**
> CLAUDE.md §3: "Si una tarea no tiene un skill definido y es repetible, Claude propone crear el skill **antes** de ejecutar". El plan lo trata como follow-up. ¿Por qué? Si la infra es para que los siguientes 100 integration tests sigan un patrón, el skill **es** el patrón. Debería ser T5c, no out-of-band.

---

## Conclusión

Plan v2 (próxima edición del documento principal) aborda los 7 P0 + 5 P1 listados arriba. P1-4 queda como residual documentado. P2 son drift signals corregidos.
