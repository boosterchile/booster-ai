import { defineConfig } from 'vitest/config';

/**
 * Config separada para tests integration. Corre con `pnpm test:integration`,
 * no participa del `pnpm test` default (que cubre solo unit con BD stubbeada).
 *
 * Decisiones del plan v2 `2026-05-17-test-integration-infra-apps-api.md` §D2/D3:
 *   - `pool: 'forks'` + `poolOptions.forks.singleFork: true` — un único worker
 *     vitest para que las suites compartan globalSetup (que se introduce en
 *     T1b) y no compitan por advisory locks de Drizzle.
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
    // Vitest 4: poolOptions se movieron a top-level. `pool: 'forks'` +
    // `forks.singleFork: true` garantiza un único worker para serializar
    // el acceso a la BD compartida.
    pool: 'forks',
    forks: {
      singleFork: true,
    },
    sequence: {
      concurrent: false,
    },
    testTimeout: 30_000,
  },
});
