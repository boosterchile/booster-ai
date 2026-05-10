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
      // Camino a 80%: services + routes principales están a 73%+. Los
      // gaps restantes son src/jobs/* (backfill jobs), src/services/firebase.ts
      // (admin SDK init), y wiring completo de server.ts. Estos requieren
      // setup de integración más complejo (jobs son CLI con env vars
      // específicas).
      thresholds: {
        lines: 72,
        functions: 60,
        branches: 68,
        statements: 72,
      },
    },
  },
});
