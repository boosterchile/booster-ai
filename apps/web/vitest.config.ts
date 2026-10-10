import path from 'node:path';
import react from '@vitejs/plugin-react';
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Picovoice publica solo `module` (sin `main`/`exports`) y la resolución
      // de Vitest no lo encuentra. Solo afecta a tests; el build usa `module`.
      '@picovoice/porcupine-web': path.resolve(
        __dirname,
        './node_modules/@picovoice/porcupine-web/dist/esm/index.js',
      ),
      '@picovoice/web-voice-processor': path.resolve(
        __dirname,
        './node_modules/@picovoice/web-voice-processor/dist/esm/index.js',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'e2e-local/**', 'e2e-conductor/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        // Surfaces platform-admin: operadas por <5 empleados de Booster con
        // tests E2E manuales pre-release. UI compleja sin lógica de negocio
        // testeable en unidad (estados de formulario + dropdowns). Excluido
        // del coverage para no bloquear PRs por UI admin (ADR-011).
        'src/routes/platform-admin.tsx',
        'src/routes/platform-admin-matching.tsx',
        'src/routes/platform-admin-site-settings.tsx',
        'src/routes/admin-cobra-hoy.tsx',
        'src/routes/admin-dispositivos.tsx',
        // Wiring declarativo del router (árbol de rutas + imports lazy
        // `() => import('./routes/x')` de lazyRouteComponent, audit P1-J). No
        // tiene lógica unit-testeable; los imports diferidos se verifican por
        // typecheck + build (chunks emitidos), no por unidad.
        'src/router.tsx',
      ],
      // Gates bloqueantes — el CI verifica coverage-summary.json.
      // 80 % en las cuatro métricas (T10-08, ADR-082), sobre el subset testable
      // (libs + hooks no-SSE + components leaf). Páginas y UI compleja se
      // cubren con Playwright e2e (apps/web/e2e/).
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
