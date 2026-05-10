import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiError, api } from '../lib/api-client.js';

/**
 * Confirma la entrega de un assignment (Phase 4 PR-K4).
 *
 * Consume el endpoint canónico carrier-side:
 *   PATCH /assignments/:id/confirmar-entrega
 *
 * Lifecycle post-success (server-side, ver
 * apps/api/src/services/confirmar-entrega-viaje.ts):
 *   1. trip.status → 'entregado'
 *   2. assignment.status → 'entregado', delivered_at = now()
 *   3. INSERT trip_events('entrega_confirmada')
 *   4. Re-derive cert level (ADR-028) + score + coaching IA + cert PDF
 *      (todo fire-and-forget transparente para el cliente)
 *
 * Idempotente — si el trip ya estaba 'entregado', responde
 * `already_delivered=true` con el deliveredAt actual sin re-disparar.
 */

export interface ConfirmarEntregaResponse {
  ok: true;
  already_delivered: boolean;
  delivered_at: string; // ISO 8601
}

export type ConfirmarEntregaErrorCode =
  | 'trip_not_found'
  | 'assignment_not_found'
  | 'no_assignment'
  | 'forbidden_owner_mismatch'
  | 'invalid_status';

export interface ConfirmarEntregaErrorBody {
  error: ConfirmarEntregaErrorCode;
  code: ConfirmarEntregaErrorCode;
  current_status?: string;
}

export function useConfirmarEntregaMutation(): UseMutationResult<
  ConfirmarEntregaResponse,
  ApiError,
  { assignmentId: string }
> {
  const queryClient = useQueryClient();
  return useMutation<ConfirmarEntregaResponse, ApiError, { assignmentId: string }>({
    mutationFn: ({ assignmentId }) =>
      api.patch<ConfirmarEntregaResponse>(`/assignments/${assignmentId}/confirmar-entrega`),
    onSuccess: (_data, { assignmentId }) => {
      // Invalidar TODO lo relacionado al assignment + sus surfaces.
      // Coaching y behavior-score recién pasarán a 'disponible' después
      // del fire-and-forget server-side (~5-10s post-confirm), pero la
      // invalidation arranca el polling para que la UI lo muestre apenas
      // esté listo.
      void queryClient.invalidateQueries({
        queryKey: ['assignment-detail', assignmentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['assignment', 'behavior-score', assignmentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['assignment', 'coaching', assignmentId],
      });
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
    },
  });
}
