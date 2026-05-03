/**
 * Helpers de validación de transiciones — la API que los services del api
 * deben usar antes de cualquier UPDATE de status.
 *
 * Patrón de uso esperado:
 *
 * ```ts
 * // En apps/api/src/services/confirmar-entrega-viaje.ts
 * import { assertTripTransition } from '@booster-ai/trip-state-machine';
 *
 * const trip = await db.query.trips.findFirst({ where: eq(trips.id, tripId) });
 * if (!trip) throw new NotFoundError();
 *
 * // Throws InvalidTransitionError si trip.status no permite DELIVERY_CONFIRMED.
 * assertTripTransition(trip.status, { type: 'DELIVERY_CONFIRMED' });
 *
 * await db.update(trips).set({ status: 'entregado' }).where(eq(trips.id, tripId));
 * ```
 *
 * Esto reemplaza el patrón actual de "asumir que el caller manda algo
 * coherente". Cierra el bloqueante de HANDOFF.md §5 — sin SM canónica,
 * cualquier service puede romper invariantes (ej. saltar de `borrador`
 * a `entregado`, o resucitar un viaje cancelado).
 *
 * Implementación: leemos `config.on` de cada state node directamente. Las
 * machines XState son la **fuente de verdad** de qué transiciones existen;
 * estos helpers son lookup puro sin runtime de actor. Eso evita acoplarse
 * a APIs internas de XState (que cambian entre versiones) y mantiene los
 * helpers triviales de testear.
 */

import {
  type AssignmentEvent,
  type AssignmentStatus,
  assignmentMachine,
} from './assignment.machine.js';
import { type TripEvent, type TripStatus, tripMachine } from './trip.machine.js';

/**
 * Error que se throwea cuando se intenta una transición ilegal. El service
 * debe rebotar a HTTP 409 Conflict (semánticamente correcto: el estado
 * actual del recurso no permite la operación pedida).
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly entity: 'trip' | 'assignment',
    public readonly fromStatus: string,
    public readonly event: string,
  ) {
    super(`Invalid ${entity} transition: status='${fromStatus}' no acepta evento '${event}'.`);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Lee el target de una transición desde la config del state node de XState.
 * El target en XState v5 puede ser:
 *   - string                   → target directo
 *   - { target: string, ... }  → objeto con guards/actions (no usamos guards en estas SMs)
 *   - Array<...>               → no usamos branching transitions
 */
function resolveTransitionTarget(transitionConfig: unknown): string | null {
  if (typeof transitionConfig === 'string') {
    return transitionConfig;
  }
  if (
    typeof transitionConfig === 'object' &&
    transitionConfig !== null &&
    'target' in transitionConfig &&
    typeof (transitionConfig as { target: unknown }).target === 'string'
  ) {
    return (transitionConfig as { target: string }).target;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trip helpers
// ---------------------------------------------------------------------------

/** `true` si la transición es legal — sin throwear. */
export function canTripTransition(fromStatus: TripStatus, event: TripEvent): boolean {
  return getNextTripStatus(fromStatus, event) !== null;
}

/**
 * Devuelve el `TripStatus` resultante de aplicar el evento, o `null` si
 * la transición no es legal.
 */
export function getNextTripStatus(fromStatus: TripStatus, event: TripEvent): TripStatus | null {
  const stateNode = tripMachine.states[fromStatus];
  if (!stateNode) {
    return null;
  }
  const onConfig = stateNode.config.on as Record<string, unknown> | undefined;
  const transitionConfig = onConfig?.[event.type];
  return resolveTransitionTarget(transitionConfig) as TripStatus | null;
}

/**
 * Lista los eventos que se pueden disparar desde el estado actual.
 * Útil para que la UI muestre/oculte botones contextualmente.
 */
export function getValidEventsForTripStatus(fromStatus: TripStatus): TripEvent['type'][] {
  const stateNode = tripMachine.states[fromStatus];
  if (!stateNode) {
    return [];
  }
  const onConfig = stateNode.config.on as Record<string, unknown> | undefined;
  return Object.keys(onConfig ?? {}) as TripEvent['type'][];
}

/**
 * Throws `InvalidTransitionError` si la transición no es legal. Patrón
 * estándar para invocar antes de un `UPDATE` en Drizzle.
 */
export function assertTripTransition(fromStatus: TripStatus, event: TripEvent): void {
  if (!canTripTransition(fromStatus, event)) {
    throw new InvalidTransitionError('trip', fromStatus, event.type);
  }
}

/** `true` si el estado es terminal (`entregado` o `cancelado`). */
export function isTerminalTripStatus(status: TripStatus): boolean {
  return status === 'entregado' || status === 'cancelado';
}

// ---------------------------------------------------------------------------
// Assignment helpers
// ---------------------------------------------------------------------------

export function canAssignmentTransition(
  fromStatus: AssignmentStatus,
  event: AssignmentEvent,
): boolean {
  return getNextAssignmentStatus(fromStatus, event) !== null;
}

export function getNextAssignmentStatus(
  fromStatus: AssignmentStatus,
  event: AssignmentEvent,
): AssignmentStatus | null {
  const stateNode = assignmentMachine.states[fromStatus];
  if (!stateNode) {
    return null;
  }
  const onConfig = stateNode.config.on as Record<string, unknown> | undefined;
  const transitionConfig = onConfig?.[event.type];
  return resolveTransitionTarget(transitionConfig) as AssignmentStatus | null;
}

export function getValidEventsForAssignmentStatus(
  fromStatus: AssignmentStatus,
): AssignmentEvent['type'][] {
  const stateNode = assignmentMachine.states[fromStatus];
  if (!stateNode) {
    return [];
  }
  const onConfig = stateNode.config.on as Record<string, unknown> | undefined;
  return Object.keys(onConfig ?? {}) as AssignmentEvent['type'][];
}

export function assertAssignmentTransition(
  fromStatus: AssignmentStatus,
  event: AssignmentEvent,
): void {
  if (!canAssignmentTransition(fromStatus, event)) {
    throw new InvalidTransitionError('assignment', fromStatus, event.type);
  }
}

export function isTerminalAssignmentStatus(status: AssignmentStatus): boolean {
  return status === 'entregado' || status === 'cancelado';
}
