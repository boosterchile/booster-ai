import { defineConfig } from 'vitest/config';

/**
 * Sprint 2c-A T3 — vitest config for apps/auth-blocking-functions.
 *
 * Coverage thresholds 80/75/80/80 per CLAUDE.md booster-stack-conventions
 * + plan v4 H-A2 fix (T4 ships istanbul-ignore-next scaffolding so the
 * gate stays green every PR through T7).
 *
 * `coverage-summary.json` is picked up automatically by the
 * `Test + Coverage` job in `.github/workflows/ci.yml` (line 112:
 * `find . -name coverage-summary.json`). NO ci.yml change needed per
 * G-A4 plan v4 fix.
 */
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
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
