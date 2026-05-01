import type { ProfileUpdateInput } from '@booster-ai/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError, api } from '../lib/api-client.js';
import type { MeUser } from './use-me.js';

interface ProfileUpdateResponse {
  user: MeUser;
}

/**
 * Hook que envía un PATCH /me/profile con los campos editados. Tras éxito
 * invalida la query `['me']` para refrescar el contexto del usuario.
 *
 * Errores tipados (ApiError.code):
 *   - 'rut_immutable' (409): el RUT ya estaba declarado y no se puede cambiar
 *   - 'user_not_found' (404): user en Firebase pero no en DB (debería ir a onboarding)
 */
export function useProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation<ProfileUpdateResponse, ApiError, ProfileUpdateInput>({
    mutationFn: (input) => api.patch<ProfileUpdateResponse>('/me/profile', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
