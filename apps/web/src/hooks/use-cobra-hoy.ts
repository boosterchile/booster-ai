import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Hooks de "Booster Cobra Hoy" (ADR-029 + ADR-032).
 *
 * `useCotizacionCobraHoy(asignacionId)`: preview de tarifa (sin escribir).
 * `useSolicitarCobraHoyMutation(asignacionId)`: solicita el adelanto.
 * `useHistorialCobraHoy()`: lista de adelantos del carrier activo.
 *
 * Si la feature está disabled (flag off en backend), todos los hooks
 * devuelven 503 — el componente que los consume debe esconder la UI.
 */

export interface CotizacionResponse {
  monto_neto_clp: number;
  plazo_dias_shipper: number;
  tarifa_pct: number;
  tarifa_clp: number;
  monto_adelantado_clp: number;
}

export function useCotizacionCobraHoy(asignacionId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<CotizacionResponse>({
    queryKey: ['cobra-hoy', 'cotizacion', asignacionId],
    queryFn: () => api.get<CotizacionResponse>(`/assignments/${asignacionId}/cobra-hoy/cotizacion`),
    enabled: opts.enabled ?? false,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (
        error instanceof ApiError &&
        (error.status === 503 || error.status === 403 || error.status === 409)
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

export interface SolicitarCobraHoyResponse {
  ok: boolean;
  already_requested: boolean;
  adelanto_id: string;
  tarifa_pct?: number;
  tarifa_clp?: number;
  monto_adelantado_clp?: number;
}

export function useSolicitarCobraHoyMutation(asignacionId: string) {
  const qc = useQueryClient();
  return useMutation<SolicitarCobraHoyResponse, Error>({
    mutationFn: () =>
      api.post<SolicitarCobraHoyResponse>(`/assignments/${asignacionId}/cobra-hoy`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cobra-hoy'] });
    },
  });
}

export interface AdelantoHistorial {
  id: string;
  asignacion_id: string;
  monto_neto_clp: number;
  plazo_dias_shipper: number;
  tarifa_pct: number;
  tarifa_clp: number;
  monto_adelantado_clp: number;
  status:
    | 'solicitado'
    | 'aprobado'
    | 'desembolsado'
    | 'cobrado_a_shipper'
    | 'mora'
    | 'cancelado'
    | 'rechazado';
  desembolsado_en: string | null;
  creado_en: string;
}

export function useHistorialCobraHoy(opts: { enabled?: boolean } = {}) {
  return useQuery<{ adelantos: AdelantoHistorial[] }>({
    queryKey: ['cobra-hoy', 'historial'],
    queryFn: () => api.get<{ adelantos: AdelantoHistorial[] }>('/me/cobra-hoy/historial'),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 503) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
