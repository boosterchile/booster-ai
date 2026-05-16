import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Baseline floor 2026-05-16. Levantar a 80/80/80/80 en
      // chore/coverage-whatsapp-client-2026-05-16.
      thresholds: {
        lines: 70,
        functions: 53,
        branches: 77,
        statements: 70,
      },
    },
  },
});
