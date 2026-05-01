import type { EmpresaOnboardingInput } from '@booster-ai/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError, api, setActiveEmpresaId } from '../lib/api-client.js';

/**
 * Forma de la respuesta exitosa de POST /empresas/onboarding.
 */
export interface OnboardingResponse {
  user: {
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
    rut: string | null;
    is_platform_admin: boolean;
    status: 'pending_verification' | 'active' | 'suspended' | 'deleted';
  };
  empresa: {
    id: string;
    legal_name: string;
    rut: string;
    is_shipper: boolean;
    is_carrier: boolean;
    status: 'pending_verification' | 'active' | 'suspended';
  };
  membership: {
    id: string;
    role: 'owner' | 'admin' | 'dispatcher' | 'driver' | 'viewer';
    status: 'pending_invitation' | 'active' | 'suspended' | 'removed';
  };
}

/**
 * Hook que envía el form de onboarding al api. Tras éxito:
 *   1. Setea la empresa nueva como activa en localStorage (para los headers
 *      X-Empresa-Id de requests siguientes).
 *   2. Invalida la query `['me']` — la próxima query trae el contexto
 *      onboardeado completo.
 *   3. El consumidor (página /onboarding) hace navigate('/app') que pasa
 *      por ProtectedRoute, gatilla useMe(), trae el contexto, y aterriza
 *      al user en su dashboard.
 *
 * Errores tipados (ApiError.code):
 *   - 'user_already_registered' (409): user ya tiene empresa registrada
 *   - 'email_in_use' (409): email ya usado por otro firebase_uid
 *   - 'rut_already_registered' (409): RUT empresa duplicado
 *   - 'invalid_plan' (400): plan_slug no existe
 *   - 'firebase_email_missing' (400): edge case, Firebase user sin email
 */
export function useOnboardingMutation() {
  const queryClient = useQueryClient();

  return useMutation<OnboardingResponse, ApiError, EmpresaOnboardingInput>({
    mutationFn: async (input) => {
      return api.post<OnboardingResponse>('/empresas/onboarding', input);
    },
    onSuccess: (data) => {
      setActiveEmpresaId(data.empresa.id);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
