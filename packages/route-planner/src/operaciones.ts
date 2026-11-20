import { cargaCabeEnCarrocerias } from '@booster-ai/matching-algorithm';
import { estadoQueCorresponde } from './estados.js';
import { validarRuta } from './invariantes.js';
import type {
  Configuracion,
  Parada,
  Resultado,
  ResultadoDeMover,
  ResultadoDeSeparar,
  Ruta,
  ServicioDeRuta,
  Violacion,
} from './tipos.js';

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

/** La carrocería de alguna unidad que carga le sirve al servicio (decisión D3). */
function cabeEnCarroceria(configuracion: Configuracion | null, servicio: ServicioDeRuta): boolean {
  return (
    configuracion === null || cargaCabeEnCarrocerias(servicio.tipoCarga, configuracion.carrocerias)
  );
}

/**
 * La ruta planificada de dos paradas de un servicio que viaja solo (spec
 * §4.1). `rutaDe` da la configuración y el conductor con que nace.
 */
export function rutaDeUnServicio(
  servicio: ServicioDeRuta,
  rutaDe: { readonly configuracion: Configuracion | null; readonly tieneConductor: boolean },
): Ruta {
  const { servicioId } = servicio;
  return {
    empresaId: servicio.empresaId,
    estado: 'planificada',
    configuracion: rutaDe.configuracion,
    tieneConductor: rutaDe.tieneConductor,
    paradas: [
      { servicioId, tipo: 'recogida', resuelta: false },
      { servicioId, tipo: 'entrega', resuelta: false },
    ],
    servicios: [servicio],
  };
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
  if (!cabeEnCarroceria(ruta.configuracion, servicio)) {
    return rechazo({ motivo: 'carroceria_incompatible', servicioId });
  }
  const paradas = [...ruta.paradas];
  paradas.splice(recogida, 0, { servicioId, tipo: 'recogida', resuelta: false });
  paradas.splice(entrega, 0, { servicioId, tipo: 'entrega', resuelta: false });
  return validada({ ...ruta, paradas, servicios: [...ruta.servicios, servicio] });
}

/**
 * Quita un servicio que todavía no se recoge, con sus dos paradas. Sacar
 * carga no puede romper un invariante, así que no revalida la ruta: una
 * violación que ya tenía (otro servicio con sobrepeso) no impide aliviarla.
 */
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
  return {
    ok: true,
    ruta: {
      ...ruta,
      paradas: ruta.paradas.filter((p) => p.servicioId !== servicioId),
      servicios: ruta.servicios.filter((s) => s.servicioId !== servicioId),
    },
  };
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
 * Mueve un servicio de su ruta a otra de la misma empresa (agrupar, spec
 * §4.2). La ruta de origen que queda sin servicios pasa a `cancelada`.
 * `posicion` se lee como en `agregarServicio`, sobre la ruta de destino.
 */
export function moverServicio(
  origen: Ruta,
  destino: Ruta,
  servicioId: string,
  posicion: { readonly recogida: number; readonly entrega: number },
): ResultadoDeMover {
  if (origen.empresaId !== destino.empresaId) {
    return { ok: false, en: 'destino', violaciones: [{ motivo: 'rutas_de_distinta_empresa' }] };
  }
  const servicio = origen.servicios.find((s) => s.servicioId === servicioId);
  const sinServicio = quitarServicio(origen, servicioId);
  if (!sinServicio.ok || !servicio) {
    return {
      ok: false,
      en: 'origen',
      violaciones: sinServicio.ok
        ? [{ motivo: 'servicio_no_esta_en_la_ruta', servicioId }]
        : sinServicio.violaciones,
    };
  }
  if (servicio.cancelado) {
    return { ok: false, en: 'origen', violaciones: [{ motivo: 'servicio_cancelado', servicioId }] };
  }
  const conServicio = agregarServicio(destino, servicio, posicion);
  if (!conServicio.ok) {
    return { ok: false, en: 'destino', violaciones: conServicio.violaciones };
  }
  return {
    ok: true,
    origen: { ...sinServicio.ruta, estado: estadoQueCorresponde(sinServicio.ruta) },
    destino: conServicio.ruta,
  };
}

/**
 * Saca un servicio que todavía no se recoge y lo deja en una ruta propia de
 * dos paradas, con el vehículo y el conductor de la ruta de la que sale
 * (spec §4.5, decisión D4). El único servicio de una ruta no se separa: ya
 * viaja solo.
 */
export function separarServicio(ruta: Ruta, servicioId: string): ResultadoDeSeparar {
  const servicio = ruta.servicios.find((s) => s.servicioId === servicioId);
  const sinServicio = quitarServicio(ruta, servicioId);
  if (!sinServicio.ok || !servicio) {
    return {
      ok: false,
      violaciones: sinServicio.ok
        ? [{ motivo: 'servicio_no_esta_en_la_ruta', servicioId }]
        : sinServicio.violaciones,
    };
  }
  if (servicio.cancelado) {
    return { ok: false, violaciones: [{ motivo: 'servicio_cancelado', servicioId }] };
  }
  if (servicio.empresaId !== ruta.empresaId) {
    return { ok: false, violaciones: [{ motivo: 'servicio_de_otra_empresa', servicioId }] };
  }
  if (ruta.servicios.filter((s) => !s.cancelado).length === 1) {
    return { ok: false, violaciones: [{ motivo: 'servicio_unico_de_la_ruta', servicioId }] };
  }
  // La ruta propia hereda el vehículo: si el servicio no cabe solo en él, no nace.
  const propia = validada(rutaDeUnServicio(servicio, ruta));
  if (!propia.ok) {
    return { ok: false, violaciones: propia.violaciones };
  }
  return {
    ok: true,
    ruta: { ...sinServicio.ruta, estado: estadoQueCorresponde(sinServicio.ruta) },
    propia: propia.ruta,
  };
}

/**
 * Declara o cambia el vehículo (motriz y arrastre). Después de una recogida
 * no se cambia: sería un transbordo (ADR-090 §8). Se rechaza si no alcanza el
 * peso de algún tramo o si su carrocería no le sirve a un servicio vigente.
 *
 * Con una recogida resuelta se rechaza siempre, también si la configuración
 * es la misma: quien llama no la invoca cuando el vehículo no cambia.
 */
export function declararConfiguracion(ruta: Ruta, configuracion: Configuracion): Resultado {
  if (!esEditable(ruta)) {
    return rechazo({ motivo: 'ruta_no_editable' });
  }
  if (ruta.paradas.some((p) => p.tipo === 'recogida' && p.resuelta)) {
    return rechazo({ motivo: 'vehiculo_con_carga_recogida' });
  }
  const sinCarroceria = ruta.servicios.filter(
    (s) => !s.cancelado && !cabeEnCarroceria(configuracion, s),
  );
  if (sinCarroceria.length > 0) {
    return rechazo(
      ...sinCarroceria.map(
        ({ servicioId }): Violacion => ({ motivo: 'carroceria_incompatible', servicioId }),
      ),
    );
  }
  return validada({ ...ruta, configuracion });
}

/**
 * Declara, cambia o quita el conductor. Se puede relevar con la ruta en
 * curso (decisión D1), pero una ruta en curso no queda sin conductor. Solo
 * comprueba eso: un problema ajeno al conductor no impide el relevo.
 */
export function declararConductor(ruta: Ruta, tieneConductor: boolean): Resultado {
  if (!esEditable(ruta)) {
    return rechazo({ motivo: 'ruta_no_editable' });
  }
  if (ruta.estado === 'en_curso' && !tieneConductor) {
    return rechazo({ motivo: 'en_curso_sin_conductor' });
  }
  return { ok: true, ruta: { ...ruta, tieneConductor } };
}
