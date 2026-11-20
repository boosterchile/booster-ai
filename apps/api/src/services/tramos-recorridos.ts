import { haversineKm } from './calcular-cobertura-telemetria.js';

/**
 * Los tramos que el camión recorrió en una ruta, con la carga que llevaba en
 * cada uno (ADR-089, spec huella-consolidada §3.1).
 *
 * Salen de lo que pasó, no de lo planificado: cada recogida y cada entrega
 * confirmada es un instante, y un tramo es lo que hay entre dos instantes
 * seguidos. Si el conductor confirma las paradas en otro orden que el de la
 * ruta, los tramos siguen ese otro orden.
 */

export interface ServicioRecorrido {
  readonly tripId: string;
  /** Peso declarado, en kg. */
  readonly masaKg: number;
  readonly recogidoEn: Date;
  /** `null`: se recogió y no se entregó (cancelado después de la recogida). */
  readonly entregadoEn: Date | null;
}

export interface TramoRecorrido {
  readonly desde: Date;
  readonly hasta: Date;
  /** Masa total a bordo en el tramo. 0 = tramo vacío. */
  readonly cargaKg: number;
}

export interface RecorridoDeRuta {
  /** La primera recogida. */
  readonly desde: Date;
  /** La última entrega, o el cierre de la ruta si no hubo ninguna. */
  readonly hasta: Date;
  readonly tramos: readonly TramoRecorrido[];
}

/**
 * Una carga recogida que nunca se entregó sigue a bordo hasta el final: el
 * camión la movió y no se sabe dónde quedó (§3.7).
 */
export function tramosRecorridos(
  servicios: readonly ServicioRecorrido[],
  cierre: Date,
): RecorridoDeRuta {
  if (servicios.length === 0) {
    throw new Error('una ruta recorrida necesita al menos un servicio recogido');
  }
  const cambios = new Map<number, number>();
  const anotar = (cuando: Date, masaKg: number) =>
    cambios.set(cuando.getTime(), (cambios.get(cuando.getTime()) ?? 0) + masaKg);
  for (const s of servicios) {
    if (s.entregadoEn !== null && s.entregadoEn.getTime() < s.recogidoEn.getTime()) {
      throw new Error(`el servicio ${s.tripId} figura entregado antes de recogerse`);
    }
    anotar(s.recogidoEn, s.masaKg);
    if (s.entregadoEn !== null) {
      anotar(s.entregadoEn, -s.masaKg);
    }
  }

  const entregas = servicios.flatMap((s) => (s.entregadoEn ? [s.entregadoEn.getTime()] : []));
  const desdeMs = Math.min(...servicios.map((s) => s.recogidoEn.getTime()));
  const hastaMs = Math.max(desdeMs, entregas.length > 0 ? Math.max(...entregas) : cierre.getTime());
  cambios.set(hastaMs, cambios.get(hastaMs) ?? 0);

  const instantes = [...cambios.keys()].filter((ms) => ms <= hastaMs).sort((a, b) => a - b);
  const tramos: TramoRecorrido[] = [];
  let aBordo = 0;
  for (const [i, ms] of instantes.entries()) {
    aBordo += cambios.get(ms) ?? 0;
    const siguiente = instantes[i + 1];
    if (siguiente !== undefined) {
      tramos.push({
        desde: new Date(ms),
        hasta: new Date(siguiente),
        cargaKg: Math.max(0, aBordo),
      });
    }
  }
  if (tramos.length === 0) {
    // Todo ocurrió en el mismo instante: un tramo sin duración con lo que se movió.
    tramos.push({
      desde: new Date(desdeMs),
      hasta: new Date(hastaMs),
      cargaKg: servicios.reduce((suma, s) => suma + s.masaKg, 0),
    });
  }
  return { desde: new Date(desdeMs), hasta: new Date(hastaMs), tramos };
}

interface Posicion {
  readonly tMs: number;
  readonly lat: number;
  readonly lng: number;
}

/**
 * Reparte la distancia medida de la ruta entre sus tramos, según lo que el
 * camión avanzó en cada uno. El total se conserva: la distancia de la ruta se
 * mide una sola vez, sobre toda la ventana, y aquí solo se asigna.
 *
 * Sin avance observado en ningún tramo, se reparte por duración.
 */
export function repartirDistanciaEnTramos(
  tramos: readonly TramoRecorrido[],
  pings: readonly Posicion[],
  distanciaTotalKm: number,
): { distanciaKm: number; cargaKg: number }[] {
  const avance = tramos.map(() => 0);
  for (let i = 1; i < pings.length; i += 1) {
    const a = pings[i - 1];
    const b = pings[i];
    if (!a || !b) {
      continue;
    }
    const medio = (a.tMs + b.tMs) / 2;
    const indice = tramos.findIndex(
      (t, k) =>
        medio >= t.desde.getTime() &&
        (medio < t.hasta.getTime() || (k === tramos.length - 1 && medio <= t.hasta.getTime())),
    );
    if (indice >= 0) {
      avance[indice] = (avance[indice] ?? 0) + haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
  }
  let pesos = avance;
  if (pesos.every((p) => p === 0)) {
    pesos = tramos.map((t) => t.hasta.getTime() - t.desde.getTime());
  }
  if (pesos.every((p) => p === 0)) {
    pesos = tramos.map(() => 1);
  }
  const suma = pesos.reduce((x, y) => x + y, 0);
  return tramos.map((t, i) => ({
    distanciaKm: (distanciaTotalKm * (pesos[i] ?? 0)) / suma,
    cargaKg: t.cargaKg,
  }));
}

/**
 * Los tramos de una ruta según su plan: la carga a bordo entre cada par de
 * paradas seguidas, en el orden de la ruta. Sirve para la estimación mientras
 * la ruta está planificada o en curso (spec huella-consolidada §3.9).
 *
 * Un servicio sin peso declarado cuenta como 0, igual que en la estimación de
 * un viaje solo.
 */
export function tramosPlanificados(
  paradas: readonly { readonly tripId: string; readonly tipo: 'recogida' | 'entrega' }[],
  pesoKgDe: ReadonlyMap<string, number>,
  distanciasKm: readonly number[],
): { distanciaKm: number; cargaKg: number }[] {
  if (paradas.length < 2) {
    throw new Error('una ruta planificada necesita al menos dos paradas');
  }
  if (distanciasKm.length !== paradas.length - 1) {
    throw new Error(
      `se necesita una distancia por tramo: ${paradas.length - 1} tramos y ${distanciasKm.length} distancias`,
    );
  }
  let aBordo = 0;
  return distanciasKm.map((distanciaKm, i) => {
    const parada = paradas[i];
    const peso = parada ? (pesoKgDe.get(parada.tripId) ?? 0) : 0;
    aBordo += parada?.tipo === 'recogida' ? peso : -peso;
    return { distanciaKm, cargaKg: Math.max(0, aBordo) };
  });
}
