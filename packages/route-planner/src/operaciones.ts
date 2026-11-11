import { validarRuta } from './invariantes.js';
import type { Configuracion, Parada, Resultado, Ruta, ServicioDeRuta, Violacion } from './tipos.js';

function rechazo(...violaciones: Violacion[]): Resultado {
  return { ok: false, violaciones };
}

function esEditable(ruta: Ruta): boolean {
  return ruta.estado === 'planificada' || ruta.estado === 'en_curso';
}

/** Devuelve la ruta si cumple los invariantes; si no, sus violaciones. */
function validada(ruta: Ruta): Resultado {
  const violaciones = validarRuta(ruta);
  return violaciones.length === 0 ? { ok: true, ruta } : { ok: false, violaciones };
}

function ultimaResuelta(paradas: readonly Parada[]): number {
  return paradas.findLastIndex((p) => p.resuelta);
}

function fueRecogido(ruta: Ruta, servicioId: string): boolean {
  return ruta.paradas.some(
    (p) => p.servicioId === servicioId && p.tipo === 'recogida' && p.resuelta,
  );
}

/**
 * Agrega un servicio. `recogida` es la posición de su parada de recogida en
 * las paradas actuales; `entrega`, la posición de su parada de entrega una
 * vez insertada la recogida. Con la ruta en curso, la recogida va después de
 * la última parada resuelta (spec §4.5).
 */
export function agregarServicio(
  ruta: Ruta,
  servicio: ServicioDeRuta,
  posicion: { readonly recogida: number; readonly entrega: number },
): Resultado {
  if (!esEditable(ruta)) {
    return rechazo({ motivo: 'ruta_no_editable' });
  }
  const { servicioId } = servicio;
  if (ruta.servicios.some((s) => s.servicioId === servicioId)) {
    return rechazo({ motivo: 'servicio_ya_en_la_ruta', servicioId });
  }
  const { recogida, entrega } = posicion;
  const largo = ruta.paradas.length;
  if (
    !Number.isInteger(recogida) ||
    !Number.isInteger(entrega) ||
    recogida < 0 ||
    recogida > largo
  ) {
    return rechazo({ motivo: 'posicion_invalida' });
  }
  if (entrega <= recogida) {
    return rechazo({ motivo: 'entrega_antes_de_recogida', servicioId });
  }
  if (entrega > largo + 1) {
    return rechazo({ motivo: 'posicion_invalida' });
  }
  if (recogida <= ultimaResuelta(ruta.paradas)) {
    return rechazo({ motivo: 'recogida_antes_de_parada_resuelta', servicioId });
  }
  const paradas = [...ruta.paradas];
  paradas.splice(recogida, 0, { servicioId, tipo: 'recogida', resuelta: false });
  paradas.splice(entrega, 0, { servicioId, tipo: 'entrega', resuelta: false });
  return validada({ ...ruta, paradas, servicios: [...ruta.servicios, servicio] });
}

/** Quita un servicio que todavía no se recoge, con sus dos paradas. */
export function quitarServicio(ruta: Ruta, servicioId: string): Resultado {
  if (!esEditable(ruta)) {
    return rechazo({ motivo: 'ruta_no_editable' });
  }
  if (!ruta.servicios.some((s) => s.servicioId === servicioId)) {
    return rechazo({ motivo: 'servicio_no_esta_en_la_ruta', servicioId });
  }
  if (fueRecogido(ruta, servicioId)) {
    return rechazo({ motivo: 'servicio_ya_recogido', servicioId });
  }
  return validada({
    ...ruta,
    paradas: ruta.paradas.filter((p) => p.servicioId !== servicioId),
    servicios: ruta.servicios.filter((s) => s.servicioId !== servicioId),
  });
}

/**
 * Reordena las paradas. `orden[i]` es el índice actual de la parada que pasa
 * a la posición `i`. Las paradas resueltas conservan su posición.
 */
export function reordenarParadas(ruta: Ruta, orden: readonly number[]): Resultado {
  if (!esEditable(ruta)) {
    return rechazo({ motivo: 'ruta_no_editable' });
  }
  const largo = ruta.paradas.length;
  const esPermutacion =
    orden.length === largo &&
    new Set(orden).size === largo &&
    orden.every((i) => Number.isInteger(i) && i >= 0 && i < largo);
  if (!esPermutacion) {
    return rechazo({ motivo: 'orden_invalido' });
  }
  if (ruta.paradas.some((p, i) => p.resuelta && orden[i] !== i)) {
    return rechazo({ motivo: 'parada_resuelta_movida' });
  }
  const paradas = orden.flatMap((i) => {
    const parada = ruta.paradas[i];
    return parada ? [parada] : [];
  });
  return validada({ ...ruta, paradas });
}

/**
 * Declara o cambia el vehículo y el conductor. Después de una recogida no se
 * cambia: sería un transbordo (ADR-090 §8).
 */
export function declararConfiguracion(
  ruta: Ruta,
  declaracion: { readonly configuracion: Configuracion; readonly tieneConductor: boolean },
): Resultado {
  if (!esEditable(ruta)) {
    return rechazo({ motivo: 'ruta_no_editable' });
  }
  if (ruta.paradas.some((p) => p.tipo === 'recogida' && p.resuelta)) {
    return rechazo({ motivo: 'servicio_ya_recogido' });
  }
  return validada({
    ...ruta,
    configuracion: declaracion.configuracion,
    tieneConductor: declaracion.tieneConductor,
  });
}
