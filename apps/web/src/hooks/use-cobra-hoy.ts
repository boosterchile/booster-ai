import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ApiError, api } from '../lib/api-client.js';
import { useEmpresaScope } from '../lib/empresa-activa.js';

/**
 * Hooks de "Booster Cobra Hoy" (ADR-029 + ADR-032).
 *
 * `useCotizacionCobraHoy(asignacionId)`: preview de tarifa (sin escribir).
 * `useSolicitarCobraHoyMutation(asignacionId)`: solicita el adelanto.
 * `useHistorialCobraHoy()`: lista de adelantos del carrier activo.
 *
 * Con el flag apagado los GET responden 200 `{enabled:false, items:[]}`.
 * El POST responde 403 `feature_disabled`. La UI muestra el aviso.
 */

const cobraHoyApagadoSchema = z.object({
  enabled: z.literal(false),
  items: z.array(z.unknown()),
});

export type CobraHoyApagado = z.infer<typeof cobraHoyApagadoSchema>;

export function esCobraHoyApagado(data: unknown): data is CobraHoyApagado {
  return cobraHoyApagadoSchema.safeParse(data).success;
}

export interface CotizacionResponse {
  monto_neto_clp: number;
  plazo_dias_shipper: number;
  tarifa_pct: number;
  tarifa_clp: number;
  monto_adelantado_clp: number;
}

const cotizacionSchema = z.object({
  monto_neto_clp: z.number(),
  plazo_dias_shipper: z.number(),
  tarifa_pct: z.number(),
  tarifa_clp: z.number(),
  monto_adelantado_clp: z.number(),
});

export type CotizacionCobraHoy = CotizacionResponse | CobraHoyApagado;

export function useCotizacionCobraHoy(asignacionId: string, opts: { enabled?: boolean } = {}) {
  return useQuery<CotizacionCobraHoy>({
    queryKey: ['cobra-hoy', 'cotizacion', asignacionId],
    queryFn: async () => {
      const raw = await api.get<unknown>(`/assignments/${asignacionId}/cobra-hoy/cotizacion`);
      const apagado = cobraHoyApagadoSchema.safeParse(raw);
      if (apagado.success) {
        return apagado.data;
      }
      const cotizacion = cotizacionSchema.safeParse(raw);
      if (!cotizacion.success) {
        throw new Error('cotización de pronto pago inválida');
      }
      return cotizacion.data;
    },
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
  /**
   * Mensaje del admin visible al carrier. Solo presente para estados
   * `rechazado`, `cancelado` o `mora` (privacidad operativa). Para otros
   * estados es `null` aunque el admin haya dejado notas internas.
   */
  nota_visible: string | null;
}

const adelantoSchema = z.object({
  id: z.string(),
  asignacion_id: z.string(),
  monto_neto_clp: z.number(),
  plazo_dias_shipper: z.number(),
  tarifa_pct: z.number(),
  tarifa_clp: z.number(),
  monto_adelantado_clp: z.number(),
  status: z.enum([
    'solicitado',
    'aprobado',
    'desembolsado',
    'cobrado_a_shipper',
    'mora',
    'cancelado',
    'rechazado',
  ]),
  desembolsado_en: z.string().nullable(),
  creado_en: z.string(),
  nota_visible: z.string().nullable(),
});

export type HistorialCobraHoy = { adelantos: AdelantoHistorial[] } | CobraHoyApagado;

export function useHistorialCobraHoy(opts: { enabled?: boolean } = {}) {
  const scope = useEmpresaScope();
  return useQuery<HistorialCobraHoy>({
    queryKey: scope.key('cobra-hoy', 'historial'),
    queryFn: async () => {
      const raw = await api.get<unknown>('/me/cobra-hoy/historial', scope.init);
      const apagado = cobraHoyApagadoSchema.safeParse(raw);
      if (apagado.success) {
        return apagado.data;
      }
      const lista = z.object({ adelantos: z.array(adelantoSchema) }).safeParse(raw);
      if (!lista.success) {
        throw new Error('historial de pronto pago inválido');
      }
      return lista.data;
    },
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
