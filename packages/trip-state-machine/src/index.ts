/**
 * @booster-ai/trip-state-machine
 *
 * State machines canónicas (XState v5) para los workflows de viaje y
 * asignación. Son la fuente de verdad de qué transiciones son legales
 * sobre `tripStatusEnum` y `assignmentStatusEnum` (`apps/api/src/db/schema.ts`).
 *
 * Use-cases:
 *   1. **Validación pre-UPDATE en services**: antes de hacer
 *      `db.update(trips).set({ status: nextStatus })`, llamar
 *      `assertTripTransition(currentStatus, event)`. Si la transición
 *      no es legal, throws `InvalidTransitionError`.
 *   2. **Documentación visualizable**: la machine genera el grafo de
 *      estados navegable en https://stately.ai/viz.
 *   3. **UI gating**: el frontend puede consultar
 *      `getValidEventsForTripStatus(currentStatus)` para mostrar/ocultar
 *      botones contextualmente (ej. "Cancelar" no aparece si ya está
 *      `entregado`).
 *
 * Invariantes que la SM garantiza:
 *   - No se puede saltar de `ofertas_enviadas` directo a `entregado` sin
 *     pasar por `asignado` y `en_proceso`.
 *   - `entregado` y `cancelado` son TERMINALES — ningún evento los saca.
 *   - `expirado` puede reintentarse via `RETRY` → `esperando_match`.
 *   - Cancelación posible desde cualquier estado activo, no desde
 *     terminales.
 *
 * Ver ADRs:
 *   - ADR-004 (Uber-like model) — define el flujo conceptual.
 *   - HANDOFF.md §5 — bloqueante "trip-state-machine XState canónica".
 */

export {
  tripMachine,
  type TripContext,
  type TripStatus,
  type TripEvent,
} from './trip.machine.js';

export {
  assignmentMachine,
  type AssignmentContext,
  type AssignmentStatus,
  type AssignmentEvent,
} from './assignment.machine.js';

export {
  InvalidTransitionError,
  canTripTransition,
  getNextTripStatus,
  getValidEventsForTripStatus,
  assertTripTransition,
  canAssignmentTransition,
  getNextAssignmentStatus,
  getValidEventsForAssignmentStatus,
  assertAssignmentTransition,
  isTerminalTripStatus,
  isTerminalAssignmentStatus,
} from './helpers.js';
