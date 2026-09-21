import { useEffect } from 'react';

/**
 * Vuelve a pedir datos cuando la página pasa a primer plano.
 *
 * TanStack Query escucha `visibilitychange` en `window` (fase bubble) y el
 * evento no burbujea: en Safari móvil, volver de segundo plano no dispara
 * el refetch del `QueryClient`. Este listener va en `document`, que es donde
 * el browser dispara el evento. El `refetchInterval` tampoco corre mientras
 * iOS tiene la pestaña congelada; al despertar, esto cubre el hueco.
 */
export function useRefetchWhenVisible(refetch: () => unknown, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return;
    }
    const onChange = (): void => {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [enabled, refetch]);
}
