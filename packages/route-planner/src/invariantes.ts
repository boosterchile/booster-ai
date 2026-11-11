import type { Ruta, Violacion } from './tipos.js';
import { calcularTramos } from './tramos.js';

/** Cada servicio con una recogida y una entrega, en ese orden. */
function violacionesDeParadas(ruta: Ruta): Violacion[] {
  const violaciones: Violacion[] = [];
  const conocidos = new Set(ruta.servicios.map((s) => s.servicioId));
  const ajenos = new Set<string>();
  for (const parada of ruta.paradas) {
    if (!conocidos.has(parada.servicioId)) {
      ajenos.add(parada.servicioId);
    }
  }
  for (const servicioId of ajenos) {
    violaciones.push({ motivo: 'paradas_del_servicio_invalidas', servicioId });
  }
  for (const { servicioId } of ruta.servicios) {
    const recogidas: number[] = [];
    const entregas: number[] = [];
    ruta.paradas.forEach((parada, indice) => {
      if (parada.servicioId === servicioId) {
        (parada.tipo === 'recogida' ? recogidas : entregas).push(indice);
      }
    });
    const [recogida] = recogidas;
    const [entrega] = entregas;
    if (
      recogidas.length !== 1 ||
      entregas.length !== 1 ||
      recogida === undefined ||
      entrega === undefined
    ) {
      violaciones.push({ motivo: 'paradas_del_servicio_invalidas', servicioId });
    } else if (entrega < recogida) {
      violaciones.push({ motivo: 'entrega_antes_de_recogida', servicioId });
    }
  }
  return violaciones;
}

function violacionesDeServicios(ruta: Ruta): Violacion[] {
  const violaciones: Violacion[] = [];
  for (const servicio of ruta.servicios) {
    if (servicio.empresaId !== ruta.empresaId) {
      violaciones.push({ motivo: 'servicio_de_otra_empresa', servicioId: servicio.servicioId });
    }
  }
  const vigentes = ruta.servicios.filter((s) => !s.cancelado);
  if (vigentes.length > 1) {
    for (const servicio of vigentes) {
      if (servicio.pesoKg === null) {
        violaciones.push({
          motivo: 'servicio_sin_peso_en_ruta_consolidada',
          servicioId: servicio.servicioId,
        });
      }
    }
  }
  return violaciones;
}

function violacionesDeCapacidad(ruta: Ruta): Violacion[] {
  const { configuracion } = ruta;
  if (configuracion === null) {
    return [];
  }
  const violaciones: Violacion[] = [];
  for (const tramo of calcularTramos(ruta)) {
    if (tramo.masaKg > configuracion.capacidadKg) {
      violaciones.push({ motivo: 'capacidad_peso_excedida', tramo: tramo.desde });
    }
    if (
      configuracion.capacidadM3 !== null &&
      tramo.volumenM3 !== null &&
      tramo.volumenM3 > configuracion.capacidadM3
    ) {
      violaciones.push({ motivo: 'capacidad_volumen_excedida', tramo: tramo.desde });
    }
  }
  return violaciones;
}

/**
 * Invariantes de una ruta (spec ruta-parada-servicio §4.4). Devuelve todas
 * las violaciones; una lista vacía es una ruta válida.
 *
 * La capacidad solo se evalúa sobre paradas bien formadas y con vehículo
 * declarado. El volumen, además, solo donde el vehículo y todos los servicios
 * a bordo lo declaran.
 */
export function validarRuta(ruta: Ruta): Violacion[] {
  const violaciones: Violacion[] = [];
  if (ruta.estado === 'en_curso') {
    if (ruta.configuracion === null) {
      violaciones.push({ motivo: 'en_curso_sin_vehiculo' });
    }
    if (!ruta.tieneConductor) {
      violaciones.push({ motivo: 'en_curso_sin_conductor' });
    }
  }
  const deParadas = violacionesDeParadas(ruta);
  violaciones.push(...deParadas, ...violacionesDeServicios(ruta));
  if (deParadas.length === 0) {
    violaciones.push(...violacionesDeCapacidad(ruta));
  }
  return violaciones;
}

/**
 * Servicios que aparecen en más de una ruta no cancelada (§4.4-3). Es un
 * invariante entre rutas: quien llama entrega las rutas a comparar.
 */
export function serviciosEnMasDeUnaRuta(rutas: readonly Ruta[]): string[] {
  const veces = new Map<string, number>();
  for (const ruta of rutas) {
    if (ruta.estado === 'cancelada') {
      continue;
    }
    for (const { servicioId } of ruta.servicios) {
      veces.set(servicioId, (veces.get(servicioId) ?? 0) + 1);
    }
  }
  return [...veces].filter(([, n]) => n > 1).map(([servicioId]) => servicioId);
}
