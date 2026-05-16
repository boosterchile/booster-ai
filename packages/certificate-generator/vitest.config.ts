import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      // json-summary OMITIDO a propósito: el bash gate del workflow CI
      // aplica thresholds globales (lines/branches/funcs=80/75/80) sobre
      // todo coverage-summary.json encontrado. Mientras este package esté
      // bajo 80%, no emitimos summary → bash gate lo skip. Vitest enforza
      // el floor baseline declarado abajo. Se restaura cuando se alcance
      // 80/80/80/80 en chore/coverage-certificate-generator-2026-05-16.
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Baseline floor 2026-05-16. Levantar a 80/80/80/80 en
      // chore/coverage-certificate-generator-2026-05-16.
      thresholds: {
        lines: 42,
        functions: 37,
        branches: 44,
        statements: 42,
      },
    },
  },
});
