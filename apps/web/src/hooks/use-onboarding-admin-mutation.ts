import type { EmpresaOnboardingInput } from '@booster-ai/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signInWithCustomToken } from 'firebase/auth';
import { type ApiError, api, setActiveEmpresaId } from '../lib/api-client.js';
import { firebaseAuth } from '../lib/firebase.js';
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
/** Respuesta del alta autocontenida: suma el custom token de sesión. */
interface OnboardingAdminResponse extends OnboardingResponse {
  /**
   * alta-cliente-autocontenida SC1 — con esto la persona queda logueada al
   * terminar, sin pasar por ninguna pantalla de login. Ausente si el minteo
   * falló: el alta igual se completó y puede entrar con su RUT + la clave que
   * acaba de elegir.
   */
  custom_token?: string;
}

export function useOnboardingAdminMutation(token: string) {
  const queryClient = useQueryClient();

  return useMutation<OnboardingAdminResponse, ApiError, EmpresaOnboardingInput>({
    mutationFn: async (input) => {
      return api.post<OnboardingAdminResponse>('/empresas/onboarding-admin', input, {
        headers: { 'x-onboarding-token': token },
      });
    },
    onSuccess: async (data) => {
      setActiveEmpresaId(data.empresa.id);
      // Firmar ANTES de invalidar `/me`: el refetch necesita el ID token de la
      // sesión nueva. Sin esto la persona terminaría el alta y rebotaría al
      // login, que es exactamente el callejón que esta spec vino a cerrar.
      if (data.custom_token) {
        await signInWithCustomToken(firebaseAuth, data.custom_token);
      }
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
