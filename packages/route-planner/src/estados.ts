import type { EstadoRuta, Ruta } from './tipos.js';

/** Transiciones de la ruta (spec ruta-parada-servicio §4.3). */
export const TRANSICIONES_RUTA: Readonly<Record<EstadoRuta, readonly EstadoRuta[]>> = {
  planificada: ['en_curso', 'cancelada'],
  en_curso: ['cerrada'],
  cerrada: [],
  cancelada: [],
};

export function puedeTransicionarRuta(desde: EstadoRuta, hacia: EstadoRuta): boolean {
  return TRANSICIONES_RUTA[desde].includes(hacia);
}

/**
 * El estado que le corresponde a la ruta según sus paradas y servicios. Si
 * difiere de `ruta.estado`, quien llama persiste la transición.
 *
 * - `planificada` pasa a `en_curso` con la primera recogida confirmada, y a
 *   `cancelada` cuando no le quedan servicios vigentes.
 * - `en_curso` pasa a `cerrada` cuando toda parada está resuelta o es de un
 *   servicio cancelado.
 */
export function estadoQueCorresponde(ruta: Ruta): EstadoRuta {
  if (ruta.estado === 'cerrada' || ruta.estado === 'cancelada') {
    return ruta.estado;
  }
  const cancelados = new Set(ruta.servicios.filter((s) => s.cancelado).map((s) => s.servicioId));
  if (ruta.estado === 'planificada') {
    if (ruta.paradas.some((p) => p.tipo === 'recogida' && p.resuelta)) {
      return 'en_curso';
    }
    return ruta.servicios.some((s) => !s.cancelado) ? 'planificada' : 'cancelada';
  }
  const pendiente = ruta.paradas.some((p) => !p.resuelta && !cancelados.has(p.servicioId));
  return pendiente ? 'en_curso' : 'cerrada';
}
