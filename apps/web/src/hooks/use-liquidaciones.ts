import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Hook de liquidaciones del carrier activo (ADR-031 §4.1).
 *
 * GET /me/liquidaciones devuelve la lista paginada (LIMIT 100). Si el
 * flag está off (503), la UI muestra mensaje específico. Si la empresa
 * activa no es transportista (403), la página avisa "sin permisos".
 */

export type LiquidacionStatus =
  | 'pending_consent'
  | 'lista_para_dte'
  | 'dte_emitido'
  | 'pagada_al_carrier'
  | 'disputa';

export type DteStatusValue = 'en_proceso' | 'aceptado' | 'rechazado' | 'reparable' | 'anulado';

export interface LiquidacionRow {
  liquidacion_id: string;
  asignacion_id: string;
  tracking_code: string;
  monto_bruto_clp: number;
  comision_pct: number;
  comision_clp: number;
  iva_comision_clp: number;
  monto_neto_carrier_clp: number;
  total_factura_booster_clp: number;
  pricing_methodology_version: string;
  status: LiquidacionStatus;
  dte_folio: string | null;
  dte_emitido_en: string | null;
  dte_status: DteStatusValue | null;
  dte_pdf_url: string | null;
  dte_provider: string | null;
  creado_en: string;
}

export function useLiquidaciones(opts: { enabled?: boolean } = {}) {
  return useQuery<{ liquidaciones: LiquidacionRow[] }>({
    queryKey: ['liquidaciones'],
    queryFn: () => api.get<{ liquidaciones: LiquidacionRow[] }>('/me/liquidaciones'),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 503 || error.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
