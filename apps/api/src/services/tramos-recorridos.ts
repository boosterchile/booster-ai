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
    // Recogida y entrega en el mismo instante: un tramo sin duración.
    tramos.push({ desde: new Date(desdeMs), hasta: new Date(hastaMs), cargaKg: aBordo });
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
