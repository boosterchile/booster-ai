import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vitest para apps/marketing. Tests de componentes/libs en jsdom.
 *
 * `coverage.include` acotado a `src/**` con exclusiones deliberadas:
 *   - `layout.tsx` raíz: renderiza <html>/<body>, no es unit-testeable en
 *     jsdom; se cubre con e2e (staging).
 *   - `*.d.ts` e `index.ts` (barrels): sin lógica.
 * `src/app/**` (rutas/layouts/SSR) NO se mide con unit coverage: el render de
 * cada página lo garantiza `next build` (prerender SSG, gate de CI) y los tests
 * de ruta (gate de /signup, redirect de /ingresar, metadata). La lógica
 * testeable vive en `src/lib/**` y `src/components/**`. Umbrales (CLAUDE.md):
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
      // `src/app/**` (rutas, layouts, route handlers) es la capa de
      // routing/SSR/contenido de Next: se cubre con e2e (staging), no con unit
      // coverage. La lógica testeable vive en `src/lib/**` y `src/components/**`.
      exclude: ['src/**/*.d.ts', 'src/**/index.ts', 'src/app/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
