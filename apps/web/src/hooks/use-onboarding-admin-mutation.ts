import type { EmpresaOnboardingInput } from '@booster-ai/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError, api, setActiveEmpresaId } from '../lib/api-client.js';
import type { OnboardingResponse } from './use-onboarding-mutation.js';

/**
 * Mutación de `POST /empresas/onboarding-admin` — alta gateada por admin
 * (W1.3, hito CORFO). Mismo body (`EmpresaOnboardingInput`) y misma forma de
 * respuesta 201 (`OnboardingResponse`) que `useOnboardingMutation`, pero:
 *
 *   - Endpoint distinto (`/empresas/onboarding-admin` vs `/empresas/onboarding`).
 *   - El token de onboarding va en el header `x-onboarding-token` (nunca
 *     query param ni body — contrato del backend, `apps/api/src/routes/
 *     empresas.ts`). El user consume el token una sola vez.
 *
 * `onSuccess` replica el side-effect de `useOnboardingMutation` (setea la
 * empresa activa + invalida `/me`) para que el post-éxito sea idéntico al
 * flujo viejo de onboarding.
 */
export function useOnboardingAdminMutation(token: string) {
  const queryClient = useQueryClient();

  return useMutation<OnboardingResponse, ApiError, EmpresaOnboardingInput>({
    mutationFn: async (input) => {
      return api.post<OnboardingResponse>('/empresas/onboarding-admin', input, {
        headers: { 'x-onboarding-token': token },
      });
    },
    onSuccess: (data) => {
      setActiveEmpresaId(data.empresa.id);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
