import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // Entrypoints: wiring de Pub/Sub, Twilio, health HTTP y OTel. La lógica
        // vive en procesar-evento.ts, consumer.ts y config.ts (unit tests).
        // Mismo criterio que apps/document-service.
        'src/main.ts',
        'src/instrumentation.ts',
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
