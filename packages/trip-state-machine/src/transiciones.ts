import { type EstadoViaje, esTerminal } from './estados.js';

/**
 * Tabla de transiciones del lifecycle de viaje — ÚNICA fuente de verdad
 * (spec arch-trip-state-machine-refactor §SC-2, ADR-061).
 *
 * Derivada de los call-sites REALES verificados 2026-06-11 (no del
 * diseño aspiracional de ADR-004):
 *   - creación: INSERT directo en 'borrador' o 'esperando_match' (estado
 *     inicial, no es transición).
 *   - matching: esperando_match → emparejando → ofertas_enviadas|expirado.
 *   - accept oferta: ofertas_enviadas → asignado.
 *   - cancel shipper: cualquier estado pre-asignación → cancelado.
 *   - pickup (PoD-geofence, MODELADO pero aún sin flujo que lo dispare):
 *     asignado → en_proceso.
 *   - entrega: asignado|en_proceso → entregado.
 *
 * Los services orquestan (transacción, FOR UPDATE, CAS en el WHERE) y
 * delegan acá la LEGALIDAD de la transición — separación del CLAUDE.md.
 */
export const TRANSICIONES: Readonly<Record<EstadoViaje, readonly EstadoViaje[]>> = {
  borrador: ['esperando_match', 'cancelado'],
  esperando_match: ['emparejando', 'cancelado'],
  emparejando: ['ofertas_enviadas', 'expirado', 'cancelado'],
  ofertas_enviadas: ['asignado', 'cancelado', 'expirado'],
  asignado: ['en_proceso', 'entregado'],
  en_proceso: ['entregado'],
  entregado: [],
  cancelado: [],
  expirado: [],
};

export function puedeTransicionar(desde: EstadoViaje, hacia: EstadoViaje): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export class TransicionViajeInvalidaError extends Error {
  constructor(
    public readonly desde: EstadoViaje,
    public readonly hacia: EstadoViaje,
    public readonly permitidas: readonly EstadoViaje[],
  ) {
    super(
      `Transición de viaje inválida: ${desde} → ${hacia} (permitidas desde ${desde}: ${permitidas.length ? permitidas.join(', ') : 'ninguna — estado terminal'})`,
    );
    this.name = 'TransicionViajeInvalidaError';
  }
}

export function assertTransicion(desde: EstadoViaje, hacia: EstadoViaje): void {
  if (!puedeTransicionar(desde, hacia)) {
    throw new TransicionViajeInvalidaError(desde, hacia, TRANSICIONES[desde]);
  }
}

// ---------------------------------------------------------------------------
// Guards semánticos: las preguntas de negocio que los services hacían con
// Sets locales dispersos (CANCELLABLE_STATUSES, STATUS_CONFIRMABLE, el
// check del accept). Derivados de la tabla — no listas paralelas.
// ---------------------------------------------------------------------------

/** Cancel del shipper pre-asignación (PATCH /:id/cancelar). */
export function esCancelablePorShipper(estado: EstadoViaje): boolean {
  return puedeTransicionar(estado, 'cancelado');
}

/** Una oferta solo es aceptable cuando el trip está ofertas_enviadas. */
export function esAceptableOferta(estado: EstadoViaje): boolean {
  return puedeTransicionar(estado, 'asignado');
}

/**
 * Confirmar entrega es válido desde asignado o en_proceso. (Si ya está
 * 'entregado', el service lo trata como idempotente — esa decisión es de
 * orquestación, no de la tabla.)
 */
export function esConfirmableEntrega(estado: EstadoViaje): boolean {
  return puedeTransicionar(estado, 'entregado');
}

export { esTerminal };
