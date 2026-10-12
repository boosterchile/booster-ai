import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api-client.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

/**
 * Hook de liquidaciones del carrier activo (ADR-031 §4.1).
 *
 * GET /me/liquidaciones devuelve la lista paginada (LIMIT 100). Si el
 * flag está off (503), la UI muestra mensaje específico. Si la empresa
 * activa no es transportista (403), la página avisa "sin permisos".
 */

// `lista_para_dte` y `dte_emitido` se conservan como valores legacy del enum
// (ADR-069: Booster dejó de emitir DTE). El flujo nuevo no transiciona a
// `dte_emitido`, pero filas históricas pueden tenerlo.
export type LiquidacionStatus =
  | 'pending_consent'
  | 'lista_para_dte'
  | 'dte_emitido'
  | 'pagada_al_carrier'
  | 'disputa';

/**
 * Las filas v2 traen el desglose de comisión (se descontaba al transportista).
 * Las v3 (ADR-079 §5) no: la comisión la paga el generador y el
 * transportista ve solo `precio_transportista_clp`, que recibe íntegro.
 */
export interface LiquidacionRow {
  liquidacion_id: string;
  asignacion_id: string;
  tracking_code: string;
  monto_bruto_clp: number;
  comision_pct?: number;
  comision_clp?: number;
  iva_comision_clp?: number;
  monto_neto_carrier_clp: number;
  total_factura_booster_clp?: number;
  precio_transportista_clp?: number;
  pricing_methodology_version: string;
  status: LiquidacionStatus;
  creado_en: string;
  /** ADR-080 §5 — régimen con que se paga (ausente en respuestas previas a 0061). */
  modo_flujo?: 'conector' | 'mandato_cobro';
  /** ADR-080 — bajo mandato de cobro, cuándo y cómo se libera el pago al transportista. */
  liberacion?: {
    estado:
      | 'sin_recepcion'
      | 'pendiente'
      | 'disputa'
      | 'liberado_por_booster'
      | 'anticipado_por_operador';
    en: string | null;
    monto_clp: number | null;
    vence_en: string | null;
  };
}

export function useLiquidaciones(opts: { enabled?: boolean } = {}) {
  const scope = useEmpresaScope();
  return useQuery<{ liquidaciones: LiquidacionRow[] }>({
    queryKey: scope.key('liquidaciones'),
    queryFn: () => api.get<{ liquidaciones: LiquidacionRow[] }>('/me/liquidaciones', scope.init),
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
