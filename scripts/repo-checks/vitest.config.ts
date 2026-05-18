import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['check-adr-numbering.mjs', 'drift-inventory.mjs', 'spec-canonical-drift.mjs'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        'spec-canonical-drift.mjs': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
  },
});
