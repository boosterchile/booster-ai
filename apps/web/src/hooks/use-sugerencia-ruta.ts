import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client.js';

/** Sugerencia vigente de eco-routing (T10-23), tal como la expone el api. */
export interface SugerenciaRuta {
  id: string;
  motivo: 'emisiones' | 'tiempo';
  polyline_alternativa: string;
  ahorro_segundos: number;
  ahorro_kgco2e: number | null;
  detectada_en: string;
  texto: string;
}

export interface SugerenciaRutaActivaResponse {
  sugerencia: SugerenciaRuta | null;
}

/**
 * Sondea la sugerencia activa mientras el viaje está en ruta. Es el respaldo
 * del Web Push: si el push no llega (sin suscripción, SO lo descarta), la
 * tarjeta aparece igual en ≤ 20 s.
 */
export function useSugerenciaRutaActiva(assignmentId: string, opts: { enabled: boolean }) {
  return useQuery<SugerenciaRutaActivaResponse>({
    queryKey: ['sugerencia-ruta-activa', assignmentId],
    queryFn: () =>
      api.get<SugerenciaRutaActivaResponse>(`/assignments/${assignmentId}/sugerencias-ruta/activa`),
    enabled: opts.enabled,
    refetchInterval: 20_000,
    retry: 1,
  });
}

export function useResponderSugerenciaRuta(assignmentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { sugerenciaId: string; respuesta: 'aceptada' | 'rechazada' }) =>
      api.post<{ ok: true }>(
        `/assignments/${assignmentId}/sugerencias-ruta/${v.sugerenciaId}/respuesta`,
        { respuesta: v.respuesta },
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ['sugerencia-ruta-activa', assignmentId] }),
  });
}
