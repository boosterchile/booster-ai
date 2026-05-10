import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Hook que consume el endpoint público de tracking del consignee/shipper
 * (Phase 5 PR-L4).
 *
 * El endpoint NO requiere auth — el `api` client igual injecta
 * Authorization si el usuario está logueado, pero el handler server-side
 * no lo lee. La defensa es la opacidad del token UUID v4.
 *
 * Auto-poll: cuando el trip está activo (asignado | en_proceso) la
 * posición se actualiza cada ~30s. Browser respeta `Cache-Control:
 * max-age=30` del response, así que polls intermedios pueden venir del
 * cache. Cuando el trip está cerrado (entregado | cancelado) bajamos
 * el polling a 5min — la posición ya no cambia.
 */

/** Espejo del shape del response server-side (apps/api/src/services/get-public-tracking.ts). */
export type PublicTrackingPosition = {
  timestamp: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
};

/** Phase 5 PR-L2 — opcional hasta que #121 merge en main; type-safe via optional. */
export interface PublicTrackingProgress {
  avg_speed_kmh_last_15min: number | null;
  last_position_age_seconds: number | null;
}

export interface PublicTrackingFoundResponse {
  status: 'found';
  trip: {
    tracking_code: string;
    status: string;
    origin_address: string;
    destination_address: string;
    cargo_type: string;
  };
  vehicle: {
    type: string;
    plate_partial: string;
  };
  position: PublicTrackingPosition | null;
  /** Opcional — disponible cuando #121 merge. */
  progress?: PublicTrackingProgress;
  eta_minutes: number | null;
}

const ACTIVE_TRIP_STATUSES = new Set(['asignado', 'en_proceso']);

/** 30s para trips activos (alineado con Cache-Control del endpoint). */
const POLL_ACTIVE_MS = 30_000;
/** 5min para trips cerrados — la posición no cambia. */
const POLL_CLOSED_MS = 300_000;

export function usePublicTracking(token: string, opts: { enabled?: boolean } = {}) {
  return useQuery<PublicTrackingFoundResponse>({
    queryKey: ['public-tracking', token],
    queryFn: () => api.get<PublicTrackingFoundResponse>(`/public/tracking/${token}`),
    enabled: opts.enabled !== false && token.length > 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) {
        return POLL_ACTIVE_MS;
      }
      return ACTIVE_TRIP_STATUSES.has(data.trip.status) ? POLL_ACTIVE_MS : POLL_CLOSED_MS;
    },
    retry: (failureCount, error) => {
      // 404 = token no existe / formato inválido. No retry.
      if (error instanceof ApiError && error.status === 404) {
        return false;
      }
      return failureCount < 2;
    },
    // staleTime corto (alineado con el polling) — al volver a focus,
    // se refetch automáticamente.
    staleTime: 15_000,
  });
}
