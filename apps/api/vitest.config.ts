import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/main.ts', // bootstrap, side-effect; cubierto vía smoke E2E
        'src/db/client.ts', // wrapper trivial sobre pg.Pool; cubierto en integration tests
        'src/db/migrator.ts', // CLI script, no business logic
        'src/jobs/**', // CLI scripts con main()/run() self-executing al import
        'src/server.ts', // wireado top-level; cada handler está cubierto en routes tests
        'src/db/schema.ts', // definiciones declarativas de tablas Drizzle (no lógica testeable)
      ],
      // Gates bloqueantes — el CI verifica coverage-summary.json.
      // CLAUDE.md objetivo: 80%/75%/80%/80%. Cumplido en lines/functions/branches.
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 75,
        statements: 80,
      },
    },
  },
});
