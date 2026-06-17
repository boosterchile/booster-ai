import { defineConfig } from 'vitest/config';

/**
 * Config separada para tests integration. Corre con `pnpm test:integration`,
 * no participa del `pnpm test` default (que cubre solo unit con BD stubbeada).
 *
 * Decisiones del plan v2 `2026-05-17-test-integration-infra-apps-api.md` §D2/D3:
 *   - `fileParallelism: false` — un único worker vitest, archivos uno-a-uno,
 *     para que las suites compartan globalSetup, no compitan por advisory
 *     locks de Drizzle y no se pisen los DELETE de `beforeEach` sobre la BD
 *     compartida. (En Vitest 4 reemplaza al difunto `poolOptions.forks.
 *     singleFork`; ver nota en el bloque `test` abajo.)
 *   - `sequence.concurrent: false` — refuerza serial; un test que use
 *     `test.concurrent` rompería el aislamiento de la BD compartida.
 *   - `include: ['test/integration/**']` — no toca `src/` ni `test/unit/`.
 *   - `globalSetup` queda vacío en T1 (no hay migrations todavía); T1b lo
 *     apunta a `test/integration/setup-global.ts`.
 *
 * Coverage stays out of this config — integration coverage se mide por
 * separado si T6 lo requiere; por defecto los integration tests son
 * "smoke" sobre paths reales, no apuntan a cubrir lógica.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.integration.ts'],
    globalSetup: ['./test/integration/setup-global.ts'],
    include: ['test/integration/**/*.{test,spec}.ts'],
    // Serializa la ejecución a un único worker, archivos uno-a-uno. Es
    // IMPRESCINDIBLE: todas las suites integration comparten UNA Postgres
    // (TEST_DATABASE_URL) y varios `beforeEach` hacen DELETE global sobre
    // tablas compartidas (p.ej. `DELETE FROM solicitudes_registro`). Con
    // archivos en paralelo, el `beforeEach` de un archivo borra filas recién
    // insertadas por otro → flaky (count=0). Ver el caso real en
    // signup-request-fail-closed > Scenario 1.
    //
    // OJO Vitest 4: `poolOptions.forks.singleFork` YA NO EXISTE (poolOptions se
    // eliminó). La key `forks: { singleFork: true }` se ignora en silencio. El
    // control correcto de serialización entre archivos es `fileParallelism:
    // false` (fuerza maxWorkers=1 → un solo worker). `pool: 'forks'` es el
    // default; se deja explícito por claridad (forks aísla mejor el driver pg).
    pool: 'forks',
    fileParallelism: false,
    sequence: {
      // Refuerza serial DENTRO de cada archivo (no entre archivos: eso lo da
      // fileParallelism). Un `test.concurrent` rompería el aislamiento de la
      // BD compartida.
      concurrent: false,
    },
    testTimeout: 30_000,
  },
});
