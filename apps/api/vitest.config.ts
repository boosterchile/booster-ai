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
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/main.ts', // bootstrap, side-effect; cubierto vía smoke E2E
        'src/db/client.ts', // wrapper trivial sobre pg.Pool; cubierto en integration tests
        'src/db/migrator.ts', // CLI script, no business logic
      ],
      // Gates bloqueantes — el CI verifica coverage-summary.json.
      // CLAUDE.md objetivo: 80%/75%/80%/80%. Los thresholds actuales son
      // baseline observado al 2026-05-10 (escala incremental). Subir
      // conforme se cubran services/*, routes/* críticos. Cada PR que
      // añada código sin tests baja el % y rompe el gate, forzando
      // disciplina de testing en nuevo código.
      //
      // Camino a 80%: pendiente cubrir matching.ts, offer-actions.ts,
      // emitir-certificado-viaje.ts, web-push.ts, chat-whatsapp-fallback.ts,
      // confirmar-entrega-viaje.ts (~1500 LOC sin cubrir hoy). Cada uno
      // requiere mocks de DB transactions + GCP SDK (KMS/GCS/Pub/Sub).
      thresholds: {
        lines: 39,
        functions: 33,
        branches: 35,
        statements: 39,
      },
    },
  },
});
