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
    status: 'pendiente_verificacion' | 'activo' | 'suspendido' | 'eliminado';
  };
  empresa: {
    id: string;
    legal_name: string;
    rut: string;
    is_generador_carga: boolean;
    is_transportista: boolean;
    status: 'pendiente_verificacion' | 'activa' | 'suspendida';
  };
  membership: {
    id: string;
    role:
      | 'dueno'
      | 'admin'
      | 'despachador'
      | 'conductor'
      | 'visualizador'
      | 'stakeholder_sostenibilidad';
    status: 'pendiente_invitacion' | 'activa' | 'suspendida' | 'removida';
  };
}

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
