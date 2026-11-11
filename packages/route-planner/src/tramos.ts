import type { Ruta, ServicioDeRuta, Tramo } from './tipos.js';

interface Estadia {
  readonly servicio: ServicioDeRuta;
  readonly recogida: number;
  readonly entrega: number;
}

/**
 * Entre qué paradas va a bordo cada servicio. Un servicio cancelado antes de
 * su recogida no sube; uno cancelado después de recogido sigue a bordo hasta
 * su parada de entrega.
 */
function estadias(ruta: Ruta): Estadia[] {
  const resultado: Estadia[] = [];
  for (const servicio of ruta.servicios) {
    const recogida = ruta.paradas.findIndex(
      (p) => p.servicioId === servicio.servicioId && p.tipo === 'recogida',
    );
    if (recogida === -1) {
      continue;
    }
    if (servicio.cancelado && ruta.paradas[recogida]?.resuelta !== true) {
      continue;
    }
    const entrega = ruta.paradas.findIndex(
      (p) => p.servicioId === servicio.servicioId && p.tipo === 'entrega',
    );
    resultado.push({
      servicio,
      recogida,
      entrega: entrega === -1 ? ruta.paradas.length : entrega,
    });
  }
  return resultado;
}

/**
 * Un tramo por cada par de paradas consecutivas, con la masa y el volumen de
 * los servicios que van a bordo en él (ADR-088 §2).
 */
export function calcularTramos(ruta: Ruta): Tramo[] {
  const aBordo = estadias(ruta);
  const tramos: Tramo[] = [];
  for (let i = 0; i < ruta.paradas.length - 1; i += 1) {
    const servicios = aBordo.filter((e) => e.recogida <= i && i < e.entrega).map((e) => e.servicio);
    const sinVolumen = servicios.some((s) => s.volumenM3 === null);
    tramos.push({
      desde: i,
      hasta: i + 1,
      masaKg: servicios.reduce((suma, s) => suma + (s.pesoKg ?? 0), 0),
      volumenM3: sinVolumen ? null : servicios.reduce((suma, s) => suma + (s.volumenM3 ?? 0), 0),
      serviciosABordo: servicios.map((s) => s.servicioId),
      vacio: servicios.length === 0,
    });
  }
  return tramos;
}
