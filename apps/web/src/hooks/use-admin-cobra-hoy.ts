import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Hooks de admin "Booster Cobra Hoy" (ADR-029 v1 / ADR-032).
 *
 * Endpoint backend protegido por allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`.
 * Si el usuario no está en la allowlist, los hooks devuelven 403 y la UI
 * muestra mensaje claro.
 */

export type AdelantoStatus =
  | 'solicitado'
  | 'aprobado'
  | 'desembolsado'
  | 'cobrado_a_shipper'
  | 'mora'
  | 'cancelado'
  | 'rechazado';

export interface AdelantoAdminRow {
  id: string;
  asignacion_id: string;
  liquidacion_id: string | null;
  empresa_carrier_id: string;
  empresa_shipper_id: string;
  monto_neto_clp: number;
  plazo_dias_shipper: number;
  tarifa_pct: number;
  tarifa_clp: number;
  monto_adelantado_clp: number;
  status: AdelantoStatus;
  factoring_methodology_version: string;
  desembolsado_en: string | null;
  cobrado_a_shipper_en: string | null;
  notas_admin: string | null;
  creado_en: string;
}

export interface AdminAdelantosFilters {
  status?: AdelantoStatus;
  empresaCarrierId?: string;
  empresaShipperId?: string;
}

export function useAdminAdelantos(
  filters: AdminAdelantosFilters,
  opts: { enabled?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.empresaCarrierId) {
    params.set('empresa_carrier_id', filters.empresaCarrierId);
  }
  if (filters.empresaShipperId) {
    params.set('empresa_shipper_id', filters.empresaShipperId);
  }
  const qs = params.toString();
  return useQuery<{ adelantos: AdelantoAdminRow[] }>({
    queryKey: ['admin-cobra-hoy', 'adelantos', filters],
    queryFn: () =>
      api.get<{ adelantos: AdelantoAdminRow[] }>(`/admin/cobra-hoy/adelantos${qs ? `?${qs}` : ''}`),
    enabled: opts.enabled ?? true,
    staleTime: 15_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 503 || error.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

export type TargetTransicion =
  | 'aprobado'
  | 'desembolsado'
  | 'cobrado_a_shipper'
  | 'mora'
  | 'cancelado'
  | 'rechazado';

export interface TransicionarResponse {
  ok: boolean;
  adelanto_id: string;
  status: AdelantoStatus;
  desembolsado_en: string | null;
  cobrado_a_shipper_en: string | null;
}

export interface TransicionarInput {
  adelantoId: string;
  targetStatus: TargetTransicion;
  notas?: string;
}

export function useTransicionarAdelantoMutation() {
  const qc = useQueryClient();
  return useMutation<TransicionarResponse, Error, TransicionarInput>({
    mutationFn: ({ adelantoId, targetStatus, notas }) =>
      api.post<TransicionarResponse>(
        `/admin/cobra-hoy/adelantos/${adelantoId}/transicionar`,
        notas ? { target_status: targetStatus, notas } : { target_status: targetStatus },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-cobra-hoy'] });
      // También invalida el historial del carrier para que vea el nuevo status.
      void qc.invalidateQueries({ queryKey: ['cobra-hoy'] });
    },
  });
}
