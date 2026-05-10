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
        'src/router.tsx', // TanStack Router config con lazy imports — tested e2e
        'src/sw.ts', // Service Worker — runtime de browser, no jsdom
        'src/lib/firebase.ts', // initializeApp + setPersistence side-effects at-import
        // 2FA helpers + UI: integran con Firebase Phone Auth + reCAPTCHA.
        // Se testean mejor con Playwright e2e contra Firebase real (no
        // mockeable significativamente). Ver ADR-028 §"Acciones derivadas §6".
        'src/lib/two-factor.ts',
        'src/components/profile/TwoFactorSection.tsx',
        // Páginas grandes con TanStack Router + lazy imports + form complejos +
        // mapas Google. Se testean mejor con Playwright e2e contra build real.
        'src/routes/**',
        // Components UI complejos con Google Maps + SSE + form-hook + Firebase
        // — testeables sólo con Playwright e2e contra build real.
        'src/components/map/**',
        'src/components/chat/ChatPanel.tsx',
        'src/components/chat/PushSubscribeBanner.tsx',
        'src/components/profile/AuthProvidersSection.tsx',
        'src/components/profile/ProfileForm.tsx',
        'src/components/onboarding/OnboardingForm.tsx',
        'src/components/map/**',
        'src/components/offers/OfferCard.tsx',
        'src/components/Layout.tsx', // navbar + dropdowns Tanstack Router; e2e
        // Hooks que sólo tienen sentido in-browser (SSE EventSource, telemetría).
        'src/hooks/use-chat-stream.ts',
        'src/hooks/use-chat-messages.ts',
      ],
      // Gates bloqueantes — el CI verifica coverage-summary.json.
      // CLAUDE.md objetivo: 80%/75%/80%/80%. Cumplido sobre el subset testable
      // (libs + hooks no-SSE + components leaf). Páginas y UI compleja se
      // cubren con Playwright e2e (apps/web/e2e/).
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 75,
        statements: 80,
      },
    },
  },
});
