import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

/** Shape de GET /marketplace/viajes-abiertos (BARH-23). */
export interface ViajeAbiertoPayload {
  id: string;
  tracking_code: string;
  status: string;
  origin_address_raw: string;
  origin_region_code: string | null;
  destination_address_raw: string;
  destination_region_code: string | null;
  cargo_type: string;
  cargo_weight_kg: number | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
}

interface ViajesAbiertosResponse {
  viajes: ViajeAbiertoPayload[];
}

interface ReclamarResponse {
  origen: 'reclamo';
  offer: { id: string; status: string; responded_at: string | null };
  assignment: {
    id: string;
    trip_request_id: string;
    status: string;
    agreed_price_clp: number;
    accepted_at: string;
  };
  superseded_offer_ids: string[];
}

export function useViajesAbiertos(opts: { enabled?: boolean } = {}) {
  const scope = useEmpresaScope();
  return useQuery<ViajesAbiertosResponse>({
    queryKey: scope.key('offers', 'viajes-abiertos'),
    queryFn: () => api.get<ViajesAbiertosResponse>('/marketplace/viajes-abiertos', scope.init),
    enabled: opts.enabled ?? true,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return failureCount < 3;
    },
  });
}

export function useReclamarViajeMutation() {
  const queryClient = useQueryClient();
  const scope = useEmpresaScope();
  return useMutation<ReclamarResponse, ApiError, { viajeId: string }>({
    mutationFn: ({ viajeId }) =>
      api.post<ReclamarResponse>(`/marketplace/viajes/${viajeId}/reclamar`, {}, scope.init),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}
