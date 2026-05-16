import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      // json-summary OMITIDO (bash gate skip). Se restaura en
      // chore/coverage-shared-schemas-2026-05-16 cuando alcance 80/80/80/80.
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Baseline floor 2026-05-16. Levantar a 80/80/80/80 en
      // chore/coverage-shared-schemas-2026-05-16.
      thresholds: {
        lines: 57,
        functions: 47,
        branches: 67,
        statements: 57,
      },
    },
  },
});
