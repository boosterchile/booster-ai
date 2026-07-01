import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // Entrypoints e I/O adapters: wiring de Pub/Sub, pg pool, GCS, OTel y el
        // bundle del consumer. La lógica de dominio vive en
        // process-document-uploaded.ts + document-store.ts (capa SQL de
        // retención, dominio crítico O-3) + @booster-ai/transport-documents
        // (todos cubiertos por unit tests). Probar main/gcs requeriría
        // broker/DB/GCS reales (integración), fuera del unit-coverage.
        'src/main.ts',
        'src/instrumentation.ts',
        'src/gcs-downloader.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
