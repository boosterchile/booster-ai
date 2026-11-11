import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, paradasRuta, trips } from '../db/schema.js';
import { haversineKm } from './calcular-cobertura-telemetria.js';

/**
 * Lo que el seguimiento de un servicio necesita saber de su ruta (spec
 * ruta-parada-servicio §4.7): si la comparte con otras cargas y qué paradas
 * quedan antes de su entrega.
 *
 * De la ruta solo salen hechos del propio servicio y coordenadas para sumar
 * tiempo. Nada de esto se entrega al público: ni cuántas cargas hay, ni de
 * quién son, ni dónde paran.
 */

export interface Coordenada {
  readonly lat: number;
  readonly lng: number;
}

export interface ContextoDeRuta {
  /** La ruta lleva más de una carga vigente. */
  readonly compartida: boolean;
  /** Asignaciones vigentes de la ruta: el mismo camión reporta por cualquiera. */
  readonly asignacionIds: readonly string[];
  /**
   * Paradas sin resolver de las otras cargas vigentes que van antes de la
   * entrega de este servicio, en orden. `null` si la parada no tiene
   * coordenadas guardadas.
   */
  readonly paradasIntermedias: readonly (Coordenada | null)[];
}

/** Detención estimada en cada parada intermedia: llegar, cargar o descargar y salir. */
export const MINUTOS_POR_PARADA_INTERMEDIA = 15;

/** Mismo factor que el seguimiento usa para pasar de línea recta a carretera. */
const FACTOR_CARRETERA = 1.3;

const coordenada = (lat: string | null, lng: string | null): Coordenada | null => {
  const a = lat === null ? Number.NaN : Number(lat);
  const b = lng === null ? Number.NaN : Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null;
};

export async function contextoDeRuta(
  db: Pick<Db, 'select'>,
  opts: { readonly rutaId: string; readonly tripId: string },
): Promise<ContextoDeRuta> {
  const filas = await db
    .select({
      orden: paradasRuta.orden,
      tipo: paradasRuta.tipo,
      tripId: paradasRuta.tripId,
      resolvedAt: paradasRuta.resolvedAt,
      asignacionId: assignments.id,
      estado: assignments.status,
      origenLat: trips.originLatitude,
      origenLng: trips.originLongitude,
      destinoLat: trips.destinationLatitude,
      destinoLng: trips.destinationLongitude,
    })
    // rls-allowlist: paradas de la ruta de una asignación ya autorizada (token público o dueño del viaje)
    .from(paradasRuta)
    .innerJoin(trips, eq(trips.id, paradasRuta.tripId))
    .innerJoin(assignments, eq(assignments.tripId, paradasRuta.tripId))
    .where(eq(paradasRuta.rutaId, opts.rutaId))
    .orderBy(asc(paradasRuta.orden));

  const vigentes = filas.filter((f) => f.estado !== 'cancelado');
  const asignacionIds = [...new Set(vigentes.map((f) => f.asignacionId))];
  const entrega = vigentes.find((f) => f.tripId === opts.tripId && f.tipo === 'entrega');
  const compartida = asignacionIds.length > 1;
  return {
    compartida,
    asignacionIds,
    paradasIntermedias:
      compartida && entrega
        ? vigentes
            .filter(
              (f) => f.tripId !== opts.tripId && f.resolvedAt === null && f.orden < entrega.orden,
            )
            .map((f) =>
              f.tipo === 'recogida'
                ? coordenada(f.origenLat, f.origenLng)
                : coordenada(f.destinoLat, f.destinoLng),
            )
        : [],
  };
}

/**
 * Minutos que las paradas intermedias agregan a la hora estimada de llegada:
 * una detención por parada, más el desvío de pasar por ellas en vez de ir
 * directo. Si falta una coordenada o la velocidad, suma solo las detenciones.
 */
export function minutosPorParadasIntermedias(opts: {
  readonly posicion: Coordenada | null;
  readonly destino: Coordenada | null;
  readonly paradas: readonly (Coordenada | null)[];
  readonly avgSpeedKmh: number | null;
}): number {
  const { posicion, destino, paradas, avgSpeedKmh } = opts;
  const detenciones = paradas.length * MINUTOS_POR_PARADA_INTERMEDIA;
  const conocidas = paradas.filter((p): p is Coordenada => p !== null);
  if (
    paradas.length === 0 ||
    posicion === null ||
    destino === null ||
    conocidas.length !== paradas.length ||
    avgSpeedKmh === null ||
    avgSpeedKmh <= 0
  ) {
    return detenciones;
  }
  const km = (a: Coordenada, b: Coordenada) => haversineKm(a.lat, a.lng, b.lat, b.lng);
  const puntos = [posicion, ...conocidas, destino];
  const porParadas = puntos.slice(1).reduce((suma, p, i) => {
    const anterior = puntos[i];
    return anterior ? suma + km(anterior, p) : suma;
  }, 0);
  const desvioKm = Math.max(0, porParadas - km(posicion, destino)) * FACTOR_CARRETERA;
  return detenciones + Math.round((desvioKm / avgSpeedKmh) * 60);
}
