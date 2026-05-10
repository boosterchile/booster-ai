import path from 'node:path';
import react from '@vitejs/plugin-react';
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/main.tsx',
        // 2FA helpers: integran con Firebase Phone Auth + reCAPTCHA. Se
        // testean mejor con Playwright e2e contra Firebase real (no
        // mockeable significativamente). Ver ADR-028 §"Acciones derivadas §6".
        'src/lib/two-factor.ts',
      ],
      // Gates bloqueantes — el CI verifica coverage-summary.json.
      // CLAUDE.md objetivo: 80%/75%/80%/80%. Los thresholds actuales son
      // baseline observado al 2026-05-10 (escala incremental). Subir
      // conforme se cubran routes/* y components/* críticos. Cada PR que
      // añada código sin tests baja el % y rompe el gate.
      thresholds: {
        lines: 7,
        functions: 6,
        branches: 4,
        statements: 7,
      },
    },
  },
});
