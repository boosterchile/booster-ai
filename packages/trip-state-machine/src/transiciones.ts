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
 *   - cancel shipper: cualquier estado pre-asignación → cancelado (anular).
 *   - editar-anular-cargas: asignado → cancelado (cancelar después del
 *     match) y ofertas_enviadas → esperando_match (volver a ofertar tras una
 *     edición material). en_proceso → cancelado NO existe (§12-P2).
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
  ofertas_enviadas: ['asignado', 'cancelado', 'expirado', 'esperando_match'],
  asignado: ['en_proceso', 'entregado', 'cancelado'],
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

/**
 * Estados antes del match: todavía no hay asignación. `emparejando` nunca se
 * ve commiteado (el matching corre en una sola transacción), pero cuenta.
 */
export const ESTADOS_PRE_MATCH = [
  'borrador',
  'esperando_match',
  'emparejando',
  'ofertas_enviadas',
] as const satisfies readonly EstadoViaje[];

export function esPreMatch(estado: EstadoViaje): boolean {
  return (ESTADOS_PRE_MATCH as readonly EstadoViaje[]).includes(estado);
}

/**
 * Anular (el generador elimina la carga antes del match). Reemplaza a
 * `esCancelablePorShipper`: con `asignado → cancelado` en la tabla, «puede
 * pasar a cancelado» ya no significa «sin asignación».
 */
export function esAnulablePorGenerador(estado: EstadoViaje): boolean {
  return esPreMatch(estado) && puedeTransicionar(estado, 'cancelado');
}

/** Cancelar después del match, con aviso al transportista (solo asignado). */
export function esCancelablePostMatch(estado: EstadoViaje): boolean {
  return !esPreMatch(estado) && puedeTransicionar(estado, 'cancelado');
}

/**
 * Editar todo antes del match (con re-matching si el cambio es material).
 * Sin `emparejando`: mientras el matching corre no se edita.
 */
export function esEditablePreMatch(estado: EstadoViaje): boolean {
  return esPreMatch(estado) && estado !== 'emparejando';
}

/** Datos libres (contacto, notas, referencia): todo estado no terminal. */
export function aceptaDatosLibres(estado: EstadoViaje): boolean {
  return !esTerminal(estado);
}

/** Solicitud de cambio que el transportista debe aceptar: solo asignado. */
export function aceptaSolicitudCambio(estado: EstadoViaje): boolean {
  return estado === 'asignado';
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

/**
 * Confirmar recogida (pickup) es válido solo desde asignado: abre la ventana
 * pickedUpAt → deliveredAt sobre la que se mide la huella (spec
 * medicion-huella-segmento). Guard consultable que NO lanza — pensado para
 * que la UI decida si ofrecer la acción; el service sigue validando con
 * `assertTransicion(estado, 'en_proceso')`.
 */
export function esConfirmableRecogida(estado: EstadoViaje): boolean {
  return puedeTransicionar(estado, 'en_proceso');
}

export { esTerminal };
