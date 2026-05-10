import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client.js';

/**
 * Estado de aceptación de T&Cs v2 del carrier activo (ADR-031 §4).
 *
 * El backend evalúa por `X-Empresa-Id` (header inyectado por api-client
 * desde el localStorage). Si la empresa activa NO es carrier, devuelve
 * `accepted=true, reason='not_a_carrier'` para que el banner no se
 * muestre a generadores de carga.
 */
export interface ConsentTermsV2Response {
  accepted: boolean;
  accepted_at?: string;
  reason?: 'no_active_empresa' | 'not_a_carrier' | 'pending';
}

export function useConsentTermsV2(opts: { enabled?: boolean } = {}) {
  return useQuery<ConsentTermsV2Response>({
    queryKey: ['consent', 'terms-v2'],
    queryFn: () => api.get<ConsentTermsV2Response>('/me/consent/terms-v2'),
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60 * 1000, // 5 min — no cambia con frecuencia
    retry: (failureCount) => failureCount < 2,
  });
}

export interface AcceptTermsV2Response {
  ok: true;
  accepted_at: string;
  already_accepted: boolean;
}

export function useAcceptTermsV2Mutation() {
  const qc = useQueryClient();
  return useMutation<AcceptTermsV2Response, Error>({
    mutationFn: () => api.post<AcceptTermsV2Response>('/me/consent/terms-v2', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consent', 'terms-v2'] });
    },
  });
}
