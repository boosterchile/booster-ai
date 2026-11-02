import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // HC-004: cada PDF embebe Inter en subset (fontkit); bajo coverage y con
    // 31 paquetes en paralelo en CI un PDF tardó >5 s. Local: ~0,6 s.
    testTimeout: 30_000,
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
        branches: 80,
        statements: 80,
      },
    },
  },
});
