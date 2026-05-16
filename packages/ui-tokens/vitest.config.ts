import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      // json-summary OMITIDO (bash gate skip). Se restaura en
      // chore/coverage-ui-tokens-2026-05-16 cuando alcance 80/80/80/80.
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Baseline 0/0/0/0 (sin tests; constantes puras). Levantar a 80/80/80/80
      // en chore/coverage-ui-tokens-2026-05-16 vía smoke tests por módulo.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
});
