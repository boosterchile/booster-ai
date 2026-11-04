import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client.js';

/**
 * Feature flags expuestos por el backend (`GET /feature-flags`).
 *
 * El endpoint es público (sin auth) porque el cliente lo necesita ANTES
 * del login para decidir qué UI renderizar (selector RUT+clave vs
 * email/password legacy).
 */
export interface FeatureFlags {
  auth_universal_v1_activated: boolean;
  wake_word_voice_activated: boolean;
  matching_algorithm_v2_activated: boolean;
}

const FEATURE_FLAGS_QUERY_KEY = ['feature-flags'] as const;

/**
 * Hook que carga los feature flags del backend. Se cachea agresivamente
 * (staleTime 5 min) porque los flags rara vez cambian — un usuario
 * raramente verá la transición; los activos se cambian via Secret
 * Manager + Cloud Run restart.
 *
 * En boot:
 *   - Render inicial muestra `flags = undefined` (loading).
 *   - Componentes que dependan del flag pueden mostrar fallback neutro.
 *   - Tras ~50ms el flag se resuelve y la UI se re-renderea.
 *
 * Si el endpoint falla (network down, backend caído), devolvemos
 * defaults conservadores (todos false) para que la UI siga funcionando
 * con el flow legacy.
 */
export function useFeatureFlags(): {
  flags: FeatureFlags;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: FEATURE_FLAGS_QUERY_KEY,
    queryFn: async () => {
      return api.get<FeatureFlags>('/feature-flags');
    },
    staleTime: 5 * 60 * 1000, // 5 min
    gcTime: 30 * 60 * 1000, // 30 min
    retry: 1, // si falla la 1ra vez, 1 retry; después fallback a defaults
  });

  const flags: FeatureFlags = query.data ?? {
    auth_universal_v1_activated: false,
    wake_word_voice_activated: false,
    matching_algorithm_v2_activated: false,
  };

  return {
    flags,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
