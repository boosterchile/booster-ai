import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { initAccent } from './hooks/use-accent-preset.js';
import { initErrorReporting, reportError } from './lib/error-reporting.js';
import { router } from './router.js';
import './styles.css';

// Aplica el acento guardado (registro producto, D1) antes del primer render
// para evitar el flash del acento default.
initAccent();

// ADR-074: sink de errores client-side. Sin VITE_SENTRY_DSN es no-op.
// Los listeners cubren lo que React NO atrapa (async/promesas fuera del
// árbol); los errores de render/effect van por defaultOnCatch del router.
initErrorReporting();
window.addEventListener('error', (e) => reportError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

const queryClient = new QueryClient({
  // ADR-074: fallos de red/API que hoy mueren silenciosos en el cache.
  queryCache: new QueryCache({ onError: (error) => reportError(error) }),
  mutationCache: new MutationCache({ onError: (error) => reportError(error) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount) => failureCount < 3,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
