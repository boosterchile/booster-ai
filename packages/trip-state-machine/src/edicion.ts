import type { EstadoViaje } from './estados.js';
import { aceptaDatosLibres, aceptaSolicitudCambio, esEditablePreMatch } from './transiciones.js';

/**
 * Edición de una carga (spec editar-anular-cargas §4–5): qué campo se puede
 * cambiar en qué estado, y cómo. Función pura; es la ÚNICA fuente de esa
 * regla y la usan la API y la web. Los Zod schemas de la propuesta y de los
 * eventos viven en `@booster-ai/shared-schemas` (`cambio-carga`).
 */

/** Se editan sin aceptación del transportista, en todo estado no terminal. */
export const CAMPOS_LIBRES = ['consignee', 'notes', 'reference'] as const;

/**
 * Después del match requieren que el transportista acepte; antes del match
 * son materiales: cambiarlos invalida las ofertas y vuelve a ofertar.
 * Comuna, región y lat/lng van dentro de origen y destino.
 */
export const CAMPOS_CON_ACEPTACION = [
  'origin',
  'destination',
  'cargo_type',
  'weight_kg',
  'volume_m3',
  'description',
  'pickup_window',
  'proposed_price_clp',
  'modalidad_carga',
] as const;

/** Subconjunto que recalcula precio acordado y comisión (§7). */
export const CAMPOS_COMERCIALES = ['proposed_price_clp', 'modalidad_carga'] as const;

export type CampoLibre = (typeof CAMPOS_LIBRES)[number];
export type CampoConAceptacion = (typeof CAMPOS_CON_ACEPTACION)[number];
export type CampoComercial = (typeof CAMPOS_COMERCIALES)[number];

/** Los campos editables de una carga, con la forma del contrato público. */
export interface CargaEditable {
  origin: unknown;
  destination: unknown;
  cargo_type: string;
  weight_kg: number;
  volume_m3: number | null;
  description: string | null;
  pickup_window: unknown;
  proposed_price_clp: number | null;
  modalidad_carga: string;
  consignee: unknown;
  notes: string | null;
  reference: string | null;
}

export type PermisoEdicion = 'directo' | 'rematch' | 'requiere_aceptacion' | 'prohibido';

export interface ClasificacionEdicion {
  libres: CampoLibre[];
  materiales: CampoConAceptacion[];
  comerciales: CampoComercial[];
  permitido: PermisoEdicion;
}

/** Igualdad por valor, independiente del orden de las claves. */
function mismoValor(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) {
    return false;
  }
  return ka.every((k) =>
    mismoValor((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function cambiados<C extends keyof CargaEditable>(
  campos: readonly C[],
  antes: CargaEditable,
  despues: CargaEditable,
): C[] {
  return campos.filter((c) => !mismoValor(antes[c], despues[c]));
}

/**
 * Clasifica una edición:
 *   - `directo`: se aplica de inmediato (solo datos libres, o nada cambió).
 *   - `rematch`: antes del match con un cambio material; invalida ofertas.
 *   - `requiere_aceptacion`: después del match con un cambio material; va
 *     como solicitud de cambio.
 *   - `prohibido`: el estado no admite esa edición (terminal, en proceso,
 *     o con el matching en curso).
 */
export function clasificarEdicion(
  estado: EstadoViaje,
  antes: CargaEditable,
  despues: CargaEditable,
): ClasificacionEdicion {
  const libres = cambiados(CAMPOS_LIBRES, antes, despues);
  const materiales = cambiados(CAMPOS_CON_ACEPTACION, antes, despues);
  const comerciales = materiales.filter((c): c is CampoComercial =>
    (CAMPOS_COMERCIALES as readonly string[]).includes(c),
  );

  let permitido: PermisoEdicion;
  if (libres.length > 0 && !aceptaDatosLibres(estado)) {
    permitido = 'prohibido';
  } else if (materiales.length === 0) {
    permitido = 'directo';
  } else if (esEditablePreMatch(estado)) {
    permitido = 'rematch';
  } else if (aceptaSolicitudCambio(estado)) {
    permitido = 'requiere_aceptacion';
  } else {
    permitido = 'prohibido';
  }
  return { libres, materiales, comerciales, permitido };
}

/** Ciclo de vida de una solicitud de cambio. No vence sola (§12-P7). */
export const ESTADOS_SOLICITUD_CAMBIO = [
  'pendiente',
  'aceptada',
  'rechazada',
  'retirada',
  'invalidada',
] as const;

export type EstadoSolicitudCambio = (typeof ESTADOS_SOLICITUD_CAMBIO)[number];

export const TRANSICIONES_SOLICITUD: Readonly<
  Record<EstadoSolicitudCambio, readonly EstadoSolicitudCambio[]>
> = {
  pendiente: ['aceptada', 'rechazada', 'retirada', 'invalidada'],
  aceptada: [],
  rechazada: [],
  retirada: [],
  invalidada: [],
};

export function puedeTransicionarSolicitud(
  desde: EstadoSolicitudCambio,
  hacia: EstadoSolicitudCambio,
): boolean {
  return TRANSICIONES_SOLICITUD[desde].includes(hacia);
}
