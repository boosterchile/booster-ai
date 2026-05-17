# Devils-advocate review — test-integration-infra-apps-api

**Spec target**: [`2026-05-17-test-integration-infra-apps-api.md`](./2026-05-17-test-integration-infra-apps-api.md)
**Reviewer**: `agent-rigor:devils-advocate` (auto-invocado por skill `11-spec-driven-development` §Step 4)
**Date**: 2026-05-17

---

## Verificaciones de hecho independientes (post-review)

| Claim del devils-advocate | Verificación | Conclusión |
|---|---|---|
| Migrations son 35 | `ls apps/api/drizzle/*.sql \| wc -l` → **37** | DA equivocado por 2; CR-2 con "≥36" técnicamente cumple pero criterio frágil. |
| Colisión 0009 | `ls apps/api/drizzle/0009*.sql` → 2 archivos | **Confirmado**. `0009_metricas_viaje_dual_source_adr028.sql` y `0009_stakeholder_access_log.sql`. |
| Coverage CI vs vitest divergente | CI: `lines=80 branches=75 functions=80`. vitest: `lines=80 functions=75 branches=75 statements=80` | **Confirmado drift**: functions threshold no coincide (CI=80, vitest=75). |
| `migrator.ts` toma advisory lock | Verificable en `apps/api/src/db/migrator.ts` | Pendiente lectura directa en /plan. |
| `pgTable()` sin `pgSchema()` | Verificable en `apps/api/src/db/schema.ts` | Pendiente lectura directa en /plan. |
| `src/db/client.ts` inicializa pool a nivel módulo | Verificable en `apps/api/src/db/client.ts` | Pendiente lectura directa en /plan. |

---

## Output del devils-advocate

> Tengo munición concreta. Hechos cruzados que la spec contradice o pasa por alto:
>
> - Migrations reales son **35** archivos (no 36+ como dice CR-2). Hay además un **colisión 0009** (`0009_metricas_viaje_dual_source_adr028.sql` y `0009_stakeholder_access_log.sql`) — ya hay un bug real con orden out-of-order documentado en `migrator.ts`.
> - `migrator.ts` toma un `pg.Pool` y un `Logger` (no es trivial de invocar desde un test), corre un advisory lock, lee `meta/_journal.json` y aplica recovery — **mucho más complejo que aplicar `*.sql` en orden**. CR-2 simplifica esto a "aplica todas las migrations en `apps/api/drizzle/*.sql`", que es semánticamente distinto a lo que hace prod (que usa journal, hash y advisory lock).
> - `pg.app` no existe como tal (es Postgres.app). Detalle, pero la spec menciona "`pg.app`/Postgres.app" como dos cosas.
> - CI workflow trabaja con `pnpm test` global (no por package). No hay forma trivial de "solo correr integration en api" sin pensar en Turbo filters.
> - Coverage gate del root es `lines 80 / branches 75 / functions 80`. La spec dice `80/75/75/80` en CR-7 — **no coincide con el CI real** (functions es 80, no 75).
> - `vitest.config.ts` excluye `src/db/migrator.ts` y `src/db/client.ts` de coverage. Si ahora ambos se ejercitan vía integration tests, hay incentivo perverso a borrar la exclusión, lo cual sube el denominador y puede tirar el coverage gate por debajo del threshold. La spec no menciona esto.
>
> Ahora ataco.
>
> ---
>
> ### 1) Objeciones críticas (P0) — rompen la spec
>
> **P0-1. Hay error de hecho en CR-2: son 35 migrations, no "≥36"**
> `ls apps/api/drizzle/*.sql | wc -l` da **35** hoy (no 36). El umbral elegido (≥36) está mal calibrado y al merge ya estás violando tu propio success criterion. Peor: usar conteo de archivos como criterio es frágil (rebases, merges, etc.). Usá `journal.entries.length === migrations_count_on_disk` o el hash del journal. Cambia el criterio a algo semánticamente significativo o quítalo.
>
> **P0-2. CR-2 y CR-10 son contradictorios entre sí**
> - CR-2 dice "el helper aplica automáticamente todas las migrations en `apps/api/drizzle/*.sql`".
> - CR-10 dice "Migration runner usado en test es el **mismo** que producción (`apps/api/src/db/migrator.ts` o equivalente)".
>
> Pero `runMigrations(pool, logger)` de `migrator.ts` (a) toma un advisory lock `938472561` (en CI multi-suite paralelo va a **serializar todas las suites**, matando el paralelismo de la decisión B), (b) lee `meta/_journal.json` y hace recovery out-of-order via hash, (c) requiere un `Logger` de `@booster-ai/logger`. Si la spec quiere fidelidad (CR-10), la decisión B (schema-per-suite con paralelismo) **no funciona** porque el advisory lock es a nivel de sesión Postgres → todas las suites se serializan. O renuncias a paralelismo, o renuncias a fidelidad. Hoy CR-2/CR-10 quieren ambos. Resolvé esto antes de plan.
>
> **P0-3. Schema-per-suite no soporta el código actual: las tablas Drizzle no usan `pgSchema()`**
> El código de producción usa `pgTable('usuarios', …)` sin schema explícito → cae en `public`. Si en test creas un schema dedicado `test_<random>` y le aplicas las migrations ahí, **el code-under-test no las va a encontrar** a menos que cambies el `search_path` por conexión, o que reescribas todas las migrations para que sean schema-aware, o que el helper rebale `db` con un wrapper que setee `SET search_path` por cada query. La spec no menciona ninguna de las tres. Lo más probable es que termines con DB-per-suite (pesado, 2-3s cada uno × N suites) o con prefijo de tabla (rompe todas las migrations). Decisión B está descrita en una línea sin tocar este punto. Es la objeción técnica más grave.
>
> **P0-4. La conexión a DB se inicializa a nivel de módulo en `src/db/client.ts`**
> Si el endpoint bajo test importa `db` (cliente real) desde `@/db/client`, el pool se crea **una sola vez al primer import** del proceso vitest. Schema-per-suite implica que cada suite necesita su propia conexión apuntada a su propio search_path. O bien (a) el helper devuelve una `db` que se **inyecta** al code-under-test (entonces hay que refactorizar todas las routes para aceptar `db` por parámetro/DI — trabajo enorme no contemplado), o (b) cada suite arranca un proceso vitest nuevo (`--isolate` o `pool: 'forks'`), lo que dispara el costo total. La spec asume (sin decirlo) que existe un mecanismo de inyección que **no existe en el repo**. Si vas a inyectar, eso es trabajo aguas arriba con scope mayor que la propia infra de tests.
>
> **P0-5. CR-7: el threshold del CI no es 80/75/75/80, es 80/75/80**
> El CI ya define `COVERAGE_MIN_LINES=80`, `COVERAGE_MIN_BRANCHES=75`, `COVERAGE_MIN_FUNCTIONS=80`. El `vitest.config.ts` declara `lines 80 / functions 75 / branches 75 / statements 80`. Hay **divergencia ya existente** entre CI y vitest.config (functions: 80 vs 75). La spec cita "80/75/75/80" como si fuera la verdad, pero no lo es. CR-7 obliga a mantener un threshold que no está consistente hoy → criterio inverificable.
>
> **P0-6. `migrator.ts` y `db/client.ts` están actualmente excluidos del coverage**
> `vitest.config.ts` línea 27-28: excluidos por "cubierto vía integration tests" y "wrapper trivial". Cuando esta infra exista, esa justificación cae. Si los **incluyes** en coverage (correcto), el denominador crece y el numerador podría no crecer al mismo ritmo → coverage real cae. La spec no anticipa esto. Mínimo: CR-7 debe especificar **qué archivos van a salir del exclude** y qué impacto numérico esperan.
>
> ---
>
> ### 2) Objeciones materiales (P1) — debilitan la spec sustantivamente
>
> **P1-1. Decisión A descarta `testcontainers-node` por argumento débil**
> "Cada suite arranca su propio container (~3-5s)" — falso. `testcontainers-node` tiene patrón de **reuse** vía `withReuse()` que arranca **un solo container** por test session. El "overhead operacional" es exactamente lo mismo que tener Docker para el dev local (que igual vas a exigirle). La razón real para no usar testcontainers podría ser: agrega una dependencia más, latencia de pull la primera vez, y semantics de cleanup. Pero los argumentos dados son cosméticos. Alternativa B descartada con razonamiento débil.
>
> **P1-2. No considera Alternativa E: el `pg` embebido (`@embedded-postgres/postgres`) o `electric-sql/pglite`**
> - **pglite** (WASM Postgres real, mismo binario en proceso): arranque <1s, fork del Postgres real, soporta `ANY(array)`, intervals, JSON, pgcrypto. No requiere Docker en local. Sería un cambio dramático en facilidad de onboarding. La spec lo ignora.
> - **embedded-postgres** (node package que descarga el binario Postgres y lo levanta en un puerto): no requiere Docker pero da Postgres real.
>
> No tienen que ser la elegida, pero el ADR-043 va a salir débil si no se mencionan y se rechazan con razón explícita. Alternativas C (SQLite) está bien rechazada; A y B no agotan el espacio.
>
> **P1-3. No considera Alternativa F: shared DB, transacción por test con rollback**
> Patrón común (Rails, Django, knex, jest-fixtures): UNA DB, UNA conexión por test, todo dentro de `BEGIN`/`ROLLBACK`. No requiere schema-per-suite. No requiere drop. Limitaciones reales (no funciona con código que abre su propia transacción, dificulta paralelismo de tests dentro del mismo file), pero rendimiento es muy superior. La spec no lo discute. Esto es la alternativa Industrial-Standard que más gente usa y la spec la omite.
>
> **P1-4. Riesgo ausente: orden de tests cambia comportamiento aunque schemas estén aislados**
> Si dos suites paralelas hablan con el **mismo Postgres** (Decisión B), comparten cache de planner, advisory locks (¡como el del migrator!), `pg_stat_statements`, y secuencias globales. Si una migration usa `CREATE SEQUENCE` global o `CREATE EXTENSION pgcrypto IF NOT EXISTS` (que dice en migrations existentes), la segunda suite puede colisionar al instalar extensiones. La spec no menciona extensiones ni `CREATE TYPE` (que el migrator.ts mismo cita como fuente de duplicate-key races).
>
> **P1-5. Riesgo ausente: migrations no idempotentes**
> El comentario gigante del `migrator.ts` describe explícitamente que ya **hay bugs reales** con migraciones out-of-order (0009 duplicado en el repo, dos archivos con prefijo 0009). El helper que aplica migrations en test **va a heredar ese bug**. Si CR-10 demanda usar el mismo runner, vas a heredar la recovery path y el advisory lock. Si NO usas el mismo runner, hay un riesgo de divergencia (que CR-10 prohíbe). La doble naturaleza del migrator (Drizzle + recovery custom) no está reflejada en la spec.
>
> **P1-6. Riesgo ausente: pool exhaustion**
> `DATABASE_POOL_MAX=5` en `test/setup.ts`. Si schema-per-suite + paralelismo, cada suite abre su propio pool. Vitest por defecto usa N workers = N cores (en GH runner ubuntu-latest, 4 cores). 4 suites × 5 conexiones = 20 conexiones simultáneas al Postgres del service container. Postgres default `max_connections=100`. Probable que funcione, pero el budget no está calculado en la spec. Más grave: si una suite hace migrations (pool client #1) y otra hace seed (pool client #2..N), el advisory lock del migrator va a serializarlas → no es paralelismo real.
>
> **P1-7. CR-6 promete "GitHub Actions service container Postgres es gratis"**
> Verificá. Es gratis en runners hosted, sí, pero **agrega 30-90s al startup del job** (pull image, start postgres, healthcheck). El budget de "≤90s integration suite" no incluye este overhead. El gate real es ~5min wall-clock. Debería estar explícito.
>
> **P1-8. Open question #2 ("orden de PRs") debería ser una decisión, no una pregunta**
> Si T8-T12 están bloqueadas hasta que esta infra exista, la respuesta es obvia: infra primero, T8 después. Mantener esto como "open question" implica que el plan v2 va a quedar en negociación de nuevo. Definí en spec: "infra mergea standalone, T8 abre PR encadenado".
>
> **P1-9. Falta criterio sobre `seed.ts` que respete las reglas de naming bilingüe (CLAUDE.md)**
> CR-5 menciona `usuarios, empresas, viajes, zonas_stakeholder, trip_metrics`. Pero `trip_metrics` violaría la regla bilingüe (la tabla real es `metricas_viaje` según las migrations 0008/0009/0011/0012). La spec mezcla snake_case español con inglés sin justificación. Si el seed helper expone keys en inglés y SQL en español → es un buen patrón pero hay que decidir y documentarlo. Si el seed expone los nombres SQL como están → CLAUDE.md está siendo respetado pero la spec usa nombres incorrectos.
>
> **P1-10. La spec no dice qué hace con `setup.ts` actual**
> `apps/api/test/setup.ts` stubea env vars y mockea `google-auth-library` global. La infra de integration va a necesitar **no** stubear `DATABASE_URL` (porque ahora va a uno real), pero va a seguir necesitando el mock de google-auth-library. ¿Hay dos `setup.ts` (uno para unit, uno para integration)? CR-4 menciona `vitest.integration.config.ts` separado, pero no dice si comparte setup o no. Detalle, pero crítico para que funcione.
>
> **P1-11. No hay criterio sobre lo que pasa cuando se rompe el helper en main**
> Si alguien commitea una migration que rompe la infra de testing (ej. nueva extensión Postgres que el service container no tiene), ¿cómo se detecta? CR-6 no exige una "smoke test" que valide que el helper sigue funcionando independiente del resto.
>
> ---
>
> ### 3) Cuestionamientos (P2) — el PO debería saber pero no bloquean
>
> **P2-1. Supuesto implícito: esta spec desbloquea D11 v2 T8. ¿Y si no?**
> Esta spec da infra. T8 sigue requiriendo (a) escribir el endpoint, (b) escribir el test integration usando esta infra. Si el endpoint mismo tiene problemas de diseño (LEFT JOIN ineficiente, opt-in cookie no resuelto, kanonimización de stakeholder), la infra de tests **no los soluciona**. La spec implícitamente vende "haz esto y D11 desbloquea". En realidad: hace esto y T8 puede ser implementado correctamente. T9-T12 cada uno trae sus propios riesgos no relacionados. No vendas más de lo que entrega.
>
> **P2-2. Costo de oportunidad: ¿es esto lo siguiente correcto?**
> Argumentos en contra:
> - 35 migrations sin test integration significa que **todas las features previas** (Wave 1, 2, 3 de telemetría; pricing v2; factoring; sucursales; conductores; demo seed) shippearon sin esta infra. Es decir, el negocio sigue funcionando hoy. La urgencia para esta semana es D11; D11 podría aterrizarse **con migración progresiva** (un primer integration test específico para `/stakeholder/zonas`, y la infra reusable emerge inductivamente).
> - Otras urgencias más demostrables podrían ser: (a) staging real con seed datos al día (ya parcialmente cubierto por T6), (b) auditoría completa T-SEC-* siguiendo la racha de commits recientes, (c) Wave 3 v2 secuencia documentada como skill.
>
> Argumentos a favor (que la spec da bien):
> - Sin esta infra, T8-T12 ship con cero evidencia de SQL correctness.
>
> Pero el PO debería decidir explícitamente. La spec asume que está claro.
>
> **P2-3. ADR-043 número**
> Verificá que 043 es el siguiente libre. La spec dice "ADR a crear: 043" sin validar.
>
> **P2-4. CR-3 dice "tiempo total <30s local, <90s CI"**
> Los 90s incluyen startup del Postgres container (~30s). El test mismo tiene 60s. ¿Realista para una suite de 6 tests? Probablemente sí; verificable solo midiendo. Hoy es un guess. Marcalo como "objetivo, a recalibrar tras T-INFRA-1".
>
> **P2-5. Mantener tests unit-mocked existentes (CR-7) crea drift**
> La spec dice "mocks unit existentes no se borran (coexisten)". Esto significa que `routes/*.test.ts` que ya están sobre `vi.fn()` se quedan ahí, y nuevos `routes/*.integration.test.ts` se agregan. Termina con dos suites paralelas testeando lo mismo, con un mock-suite que mente. Es una decisión válida (gradualismo) pero la spec debería decir cuándo se purga el unit-mock: ¿cuando la integration cubre el mismo path? ¿cuándo la cobertura del integration test supera X%? Sin regla, esto se va a quedar para siempre.
>
> **P2-6. Skill / playbook ausente**
> CLAUDE.md §3 ("Process over knowledge") obliga a crear skill si la tarea es repetible. "Escribir un test integration con DB real" es repetible, futura, y cada feature en el repo va a usarlo. La spec menciona "template documentado para escribir un integration test" en §4 pero no exige que sea un skill en `skills/core-engineering/` con la estructura When/Process/Anti-rationalizations/Exit. Sin skill, el primer dev que tope con la infra va a hacerla mal.
>
> **P2-7. Open question #3 (coverage de la infra)**
> Cobertura del helper de test es metainfra; tratar como código normal es razonable, pero merece criterio explícito.
>
> ---
>
> ### Verdict
>
> - **Strong objections (must address)**: P0-1 (CR-2 error fáctico de conteo), P0-2 (CR-2/CR-10 contradictorios sobre fidelidad del runner), P0-3 (schema-per-suite incompatible con tablas sin `pgSchema()`), P0-4 (cliente DB se inicializa a nivel módulo, no hay DI), P0-5 (umbral de coverage citado mal), P0-6 (coverage exclusion de `migrator.ts`/`client.ts` no anticipada).
> - **Residual risks (accept and document)**: testcontainers/pglite rechazados sin razón fuerte (P1-1, P1-2); patrón rollback-por-test no considerado (P1-3); extensiones Postgres pueden colisionar entre suites paralelas (P1-4); migration runner es buggy upstream y la infra lo hereda (P1-5); pool exhaustion bajo paralelismo no calculado (P1-6); 90s budget no incluye startup del service container (P1-7); coverage de `migrator.ts`/`client.ts` puede tirar el gate al incluirlos (P0-6 también).
> - **Out of scope for this review**: si T8-T12 tienen otros problemas además de tests (P2-1); decisión de orden con otros work-items urgentes (P2-2); skill formal para escribir tests integration (P2-6).
>
> **Conclusión sin diplomacia**: la spec va por el camino correcto pero **tiene al menos 6 P0 que no son cosméticos**. El más grave es P0-3 (schema-per-suite no funciona con el código actual sin refactor) y P0-2 (CR-2/CR-10 piden cosas mutuamente excluyentes). Si se mergea así, en /build descubrís el problema cuando ya invertiste 3 horas. Resolvelo en /plan antes: define explícitamente si CR-10 cede (usás `migrate` de drizzle directo, no `runMigrations` con su advisory lock) o si CR-paralelismo cede (Decisión B baja a "una DB compartida, tests seriales, schema único"). No se pueden tener ambos.

---

## Acción tomada en la spec tras este review

- CR-2 corregido para usar criterio semánticamente significativo (no conteo de archivos).
- CR-7 corregido para reflejar los thresholds reales del CI (80/75/80) y mencionar el drift con `vitest.config.ts`.
- §9 expandida con P1-4, P1-5, P1-6, P1-7.
- §12 expandida con P0-2, P0-3, P0-4, P0-6 como open questions de bloqueo a resolver en `/plan`.
- §8 expandida con Alternativas E (`pglite`/`embedded-postgres`) y F (transaction-rollback per test).
- §13 referencia este archivo.

P2 dejadas para discusión PO en el momento de aprobar la spec.
