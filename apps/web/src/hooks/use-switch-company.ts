import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { setActiveEmpresaId } from '../lib/api-client.js';

interface UseSwitchCompanyResult {
  switchTo: (empresaId: string) => Promise<void>;
  isPending: boolean;
}

/**
 * Cambia la empresa activa del usuario logueado.
 *
 * El active membership en Booster se resuelve por request vía header
 * `X-Empresa-Id`, no por columna en la tabla `users`. El cliente lo
 * persiste en `localStorage.booster.activeEmpresaId` y el backend lo
 * lee en `/me` para devolver el `active_membership` correspondiente.
 *
 * Orden del switch, y por qué (plan multi-tenant §2.D):
 *   1. `cancelQueries()`: ninguna respuesta de la empresa anterior que
 *      siga en vuelo puede aterrizar en la caché.
 *   2. `setActiveEmpresaId`: cambia el header y notifica a
 *      `useActiveEmpresaId`, así las claves `[dominio, empresaId, ...]`
 *      pasan a la empresa nueva en el próximo render.
 *   3. `removeQueries` de todo lo que no sea `['me']`: la caché de la
 *      empresa anterior no se muestra como placeholder mientras llega la
 *      nueva. No se usa `invalidateQueries()` global porque refetchearía
 *      las claves viejas con el header nuevo.
 *   4. `invalidateQueries(['me'])`: el active membership se vuelve a pedir.
 *
 * Nota: a diferencia de `signOutUser`, no se borra otro estado del
 * cliente. La empresa nueva es del mismo usuario; lo único que cambia
 * es qué tenant ve.
 */
export function useSwitchCompany(): UseSwitchCompanyResult {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  const switchTo = useCallback(
    async (empresaId: string) => {
      setIsPending(true);
      try {
        await queryClient.cancelQueries();
        setActiveEmpresaId(empresaId);
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      } finally {
        setIsPending(false);
      }
    },
    [queryClient],
  );

  return { switchTo, isPending };
}
