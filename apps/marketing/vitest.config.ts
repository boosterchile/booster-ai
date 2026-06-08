import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest para apps/marketing. Tests de componentes/libs en jsdom.
 *
 * `coverage.include` acotado a `src/**` con exclusiones deliberadas:
 *   - `layout.tsx` raíz: renderiza <html>/<body>, no es unit-testeable en
 *     jsdom; se cubre con e2e (staging).
 *   - `*.d.ts` e `index.ts` (barrels): sin lógica.
 * Las páginas (`app/**\/page.tsx`) SÍ se incluyen y se cubren con render +
 * metadata tests (cada ruta trae su test). Umbrales del repo (CLAUDE.md):
 * 80% lines/statements, 75% functions/branches.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/app/layout.tsx'],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 75,
        statements: 80,
      },
    },
  },
});
