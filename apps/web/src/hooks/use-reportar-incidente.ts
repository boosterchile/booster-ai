import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError, api } from '../lib/api-client.js';

/**
 * Reporta un incidente operacional durante un viaje (Phase 4 PR-K6b).
 *
 * Consume el endpoint:
 *   POST /assignments/:id/incidents
 *   Body: { incident_type, description? }
 *
 * Lifecycle: persiste como `tripEvent` audit-only (server-side
 * reportar-incidente.ts). NO bloquea ni cancela el viaje.
 *
 * Side effects post-success:
 *   - Invalida queries de assignment-detail para que aparezca el
 *     evento en el timeline del trip cuando el shipper lo abra.
 */

export const INCIDENT_TYPES = [
  'accidente',
  'demora',
  'falla_mecanica',
  'problema_carga',
  'otro',
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** Labels legibles en español para mostrar en UI. */
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  accidente: 'Accidente',
  demora: 'Demora',
  falla_mecanica: 'Falla mecánica',
  problema_carga: 'Problema con la carga',
  otro: 'Otro',
};

export interface ReportarIncidenteResponse {
  ok: true;
  trip_event_id: string;
  recorded_at: string;
}

export function useReportarIncidenteMutation(): UseMutationResult<
  ReportarIncidenteResponse,
  ApiError,
  { assignmentId: string; incidentType: IncidentType; description?: string }
> {
  const queryClient = useQueryClient();
  return useMutation<
    ReportarIncidenteResponse,
    ApiError,
    { assignmentId: string; incidentType: IncidentType; description?: string }
  >({
    mutationFn: ({ assignmentId, incidentType, description }) =>
      api.post<ReportarIncidenteResponse>(`/assignments/${assignmentId}/incidents`, {
        incident_type: incidentType,
        ...(description ? { description } : {}),
      }),
    onSuccess: (_data, { assignmentId }) => {
      void queryClient.invalidateQueries({
        queryKey: ['assignment-detail', assignmentId],
      });
    },
  });
}
