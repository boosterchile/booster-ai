import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom no implementa ResizeObserver, requerido por @tremor/react /
// recharts (LineChart, BarChart, DonutChart, ProgressBar). Stub minimal
// para evitar "ReferenceError: ResizeObserver is not defined" cuando los
// componentes intentan medirse al montar.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe(): void {
      // noop
    }
    unobserve(): void {
      // noop
    }
    disconnect(): void {
      // noop
    }
  } as unknown as typeof ResizeObserver;
}

// Stub VITE_* env vars antes que cualquier test importe `src/lib/env.ts`
// (env.ts hace parse zod at-import; sin stub, lanza al cargar el módulo).
// Los tests que necesitan valores específicos pueden sobreescribir vía
// vi.stubEnv().
vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'booster-ai-test');
vi.stubEnv('VITE_FIREBASE_APP_ID', '1:000:web:abc');
vi.stubEnv('VITE_API_URL', 'https://api.test.boosterchile.com');

afterEach(() => {
  cleanup();
});
