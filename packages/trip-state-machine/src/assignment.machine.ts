/**
 * State machine canónica del workflow de una asignación (`asignaciones`).
 *
 * Estados matchean `assignmentStatusEnum` en `apps/api/src/db/schema.ts:152-157`.
 *
 * Una asignación se crea en estado `asignado` cuando una oferta es
 * aceptada por el carrier (es decir, en el momento que `trip` transita
 * `ofertas_enviadas → asignado`). De ahí en adelante:
 *
 * ```
 *   ┌──────────┐
 *   │ asignado │
 *   └────┬─────┘
 *    PICKUP_CONFIRMED
 *        ▼
 *   ┌──────────┐
 *   │ recogido │
 *   └────┬─────┘
 *    DELIVERY_CONFIRMED
 *        ▼
 *   ┌────────────┐  (terminal)
 *   │ entregado  │
 *   └────────────┘
 *
 *   asignado / recogido  ── CANCEL ──→  cancelado (terminal)
 * ```
 *
 * Sincronización con el trip (NO implementada en esta SM por separación
 * de concerns):
 *   - assignment `asignado` ↔ trip `asignado`
 *   - assignment `recogido` ↔ trip `en_proceso`
 *   - assignment `entregado` ↔ trip `entregado`
 *   - assignment `cancelado` ↔ trip `cancelado`
 *
 * El service que confirma una transición debe orquestar AMBAS machines
 * en una transacción Drizzle. Pendiente: helper `syncTripAndAssignment`
 * que tome ambos estados y devuelva los próximos estados consistentes.
 * Por ahora cada service lo hace explícito (fuerza el patrón visible).
 */

import { createMachine } from 'xstate';

export type AssignmentStatus = 'asignado' | 'recogido' | 'entregado' | 'cancelado';

export type AssignmentEvent =
  | { type: 'PICKUP_CONFIRMED' }
  | { type: 'DELIVERY_CONFIRMED' }
  | { type: 'CANCEL' };

export interface AssignmentContext {
  assignmentId: string;
  tripId: string;
}

export const assignmentMachine = createMachine({
  id: 'assignment',
  initial: 'asignado',
  types: {} as {
    context: AssignmentContext;
    events: AssignmentEvent;
  },
  context: { assignmentId: '', tripId: '' },
  states: {
    asignado: {
      on: {
        PICKUP_CONFIRMED: 'recogido',
        CANCEL: 'cancelado',
      },
    },
    recogido: {
      on: {
        DELIVERY_CONFIRMED: 'entregado',
        CANCEL: 'cancelado',
      },
    },
    entregado: {
      type: 'final',
    },
    cancelado: {
      type: 'final',
    },
  },
});
