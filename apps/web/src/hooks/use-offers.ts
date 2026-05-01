import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Tipos espejados del shape que devuelve el api en GET /offers/mine.
 * Slice futuro: generar desde shared-schemas para evitar duplicación.
 */
export interface OfferTripRequestPayload {
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

export interface OfferPayload {
  id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded';
  /** Score 0-1 (de-normalizado del entero ×1000 que guarda el DB). */
  score: number;
  proposed_price_clp: number;
  suggested_vehicle_id: string | null;
  sent_at: string;
  expires_at: string;
  responded_at: string | null;
  rejection_reason: string | null;
  trip_request: OfferTripRequestPayload;
}

interface OffersListResponse {
  offers: OfferPayload[];
}

interface AcceptResponse {
  offer: { id: string; status: string; responded_at: string };
  assignment: {
    id: string;
    trip_request_id: string;
    status: string;
    agreed_price_clp: number;
    accepted_at: string;
  };
  superseded_offer_ids: string[];
}

interface RejectResponse {
  offer: {
    id: string;
    status: string;
    responded_at: string;
    rejection_reason: string | null;
  };
}

/**
 * Hook que carga ofertas del carrier activo. Refetch cada 30s para que
 * ofertas nuevas aparezcan sin recargar la página.
 *
 * staleTime=15s — entre refetch automáticos, evita re-fetches innecesarios
 * en navegación rápida.
 */
export function useOffersMine(
  opts: {
    status?: 'pending' | 'accepted' | 'rejected' | 'expired' | 'superseded';
    enabled?: boolean;
  } = {},
) {
  const status = opts.status ?? 'pending';
  return useQuery<OffersListResponse>({
    queryKey: ['offers', 'mine', status],
    queryFn: () => api.get<OffersListResponse>(`/offers/mine?status=${status}`),
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

/**
 * Acepta una oferta. Tras éxito invalida `['offers', 'mine']` para que la
 * lista se actualice (la oferta accepted desaparece de pending).
 */
export function useAcceptOfferMutation() {
  const queryClient = useQueryClient();
  return useMutation<AcceptResponse, ApiError, { offerId: string }>({
    mutationFn: ({ offerId }) => api.post<AcceptResponse>(`/offers/${offerId}/accept`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}

/**
 * Rechaza una oferta con razón opcional. Mismo invalidate.
 */
export function useRejectOfferMutation() {
  const queryClient = useQueryClient();
  return useMutation<RejectResponse, ApiError, { offerId: string; reason?: string }>({
    mutationFn: ({ offerId, reason }) =>
      api.post<RejectResponse>(`/offers/${offerId}/reject`, reason ? { reason } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}
