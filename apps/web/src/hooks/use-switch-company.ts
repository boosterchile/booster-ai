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
 * El active membership en Booster se resuelve por request via header
 * `X-Empresa-Id`, no por columna en la tabla `users`. El cliente lo
 * persiste en `localStorage.booster.activeEmpresaId` y el backend lo
 * lee en `/me` para devolver el `active_membership` correspondiente.
 *
 * Para hacer el switch:
 *   1. Actualiza localStorage con el nuevo empresaId.
 *   2. Invalida TODAS las queries de TanStack Query — `/me` (active
 *      membership), las queries de listas que dependen del empresa
 *      activa (cargas, vehículos, ofertas, certificados...). Sin esto
 *      se mostraría data de la empresa anterior hasta el siguiente
 *      refetch natural.
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
        setActiveEmpresaId(empresaId);
        await queryClient.invalidateQueries();
      } finally {
        setIsPending(false);
      }
    },
    [queryClient],
  );

  return { switchTo, isPending };
}
