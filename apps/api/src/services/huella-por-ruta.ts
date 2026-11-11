import {
  type ParametrosPorDefecto,
  type ParametrosRuta,
  type PerfilVehiculo,
  type ResultadoEmisiones,
  type ResultadoEmisionesRuta,
  VERSION_METODO_REPARTO,
  calcularEmisionesRuta,
  repartirPorActividad,
} from '@booster-ai/carbon-calculator';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type NewMetricasRutaRow, assignments, metricasRuta, tripMetrics } from '../db/schema.js';

/**
 * La huella de un servicio sale de su ruta (ADR-089, spec huella-consolidada
 * parte 3).
 *
 * El cálculo es siempre el mismo: emisión de la ruta por tramos
 * (`calcularEmisionesRuta`) y reparto entre sus servicios por
 * toneladas-kilómetro (`repartirPorActividad`). Mientras toda ruta tenga un
 * solo servicio, la ruta es un tramo y el servicio se lleva el 100 %: las
 * cifras son las del cálculo por viaje que había antes. No queda un segundo
 * camino para la carga que viaja sola.
 *
 * El reparto entre varios servicios y la emisión al cerrar la ruta son la
 * parte 4 de la spec.
 */

/** Insumos del cálculo de un servicio que viaja solo en su ruta. */
export type ParametrosServicioSolo =
  | {
      readonly metodo: 'exacto_canbus';
      readonly distanciaKm: number;
      readonly cargaKg: number;
      readonly combustibleConsumido: number;
      readonly vehiculo: PerfilVehiculo;
    }
  | {
      readonly metodo: 'modelado';
      readonly distanciaKm: number;
      readonly cargaKg: number;
      readonly vehiculo: PerfilVehiculo;
    }
  | {
      readonly metodo: 'por_defecto';
      readonly distanciaKm: number;
      readonly cargaKg: number;
      readonly tipoVehiculo: ParametrosPorDefecto['tipoVehiculo'];
    };

export interface RepartoDeServicio {
  /** Toneladas × km de distancia directa del servicio. */
  readonly actividadTkm: number;
  /** Participación en la huella de la ruta, porcentaje con 2 decimales. */
  readonly participacionPct: number;
  readonly versionMetodo: string;
}

export interface HuellaDeServicio {
  /** La parte del servicio, con la forma que ya consume el resto del cálculo. */
  readonly emisiones: ResultadoEmisiones;
  /** La huella de la ruta completa. */
  readonly ruta: ResultadoEmisionesRuta;
  readonly reparto: RepartoDeServicio;
}

function comoRuta(params: ParametrosServicioSolo): ParametrosRuta {
  const tramos = [{ distanciaKm: params.distanciaKm, cargaKg: params.cargaKg }];
  switch (params.metodo) {
    case 'exacto_canbus':
      return {
        metodo: 'exacto_canbus',
        tramos,
        combustibleConsumido: params.combustibleConsumido,
        vehiculo: params.vehiculo,
      };
    case 'modelado':
      return { metodo: 'modelado', tramos, vehiculo: params.vehiculo };
    case 'por_defecto':
      return { metodo: 'por_defecto', tramos, tipoVehiculo: params.tipoVehiculo };
  }
}

/**
 * Huella de un servicio que viaja solo: una ruta de un tramo y el reparto de
 * su emisión entre un único servicio.
 */
export function calcularHuellaDeServicioSolo(
  servicioId: string,
  params: ParametrosServicioSolo,
): HuellaDeServicio {
  const ruta = calcularEmisionesRuta(comoRuta(params));
  const [parte] = repartirPorActividad({
    totales: {
      wtw: ruta.emisionesKgco2eWtw,
      ttw: ruta.emisionesKgco2eTtw,
      wtt: ruta.emisionesKgco2eWtt,
    },
    servicios: [{ servicioId, masaKg: params.cargaKg, distanciaDirectaKm: params.distanciaKm }],
  });
  if (!parte) {
    throw new Error(`el reparto no devolvió la parte del servicio ${servicioId}`);
  }
  return {
    emisiones: {
      emisionesKgco2eWtw: parte.partes.wtw,
      emisionesKgco2eTtw: parte.partes.ttw,
      emisionesKgco2eWtt: parte.partes.wtt,
      combustibleConsumido: ruta.combustibleConsumido,
      unidadCombustible: ruta.unidadCombustible,
      distanciaKm: ruta.distanciaKm,
      intensidadGco2ePorTonKm: ruta.intensidadGco2ePorTonKm,
      metodoPrecision: ruta.metodoPrecision,
      factorEmisionUsado: ruta.factorEmisionUsado,
      versionGlec: ruta.versionGlec,
      fuenteFactores: ruta.fuenteFactores,
    },
    ruta,
    reparto: {
      actividadTkm: parte.actividadTkm,
      participacionPct: parte.participacionPct,
      versionMetodo: VERSION_METODO_REPARTO,
    },
  };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * - `estimado`: al asignar, con la distancia planificada.
 * - `real`: al cierre, cuando el viaje mide su huella. Sin huella medida las
 *   cifras reales quedan en null.
 * - `nivel`: al cierre, cuando el viaje no mide huella: solo cambian la
 *   distancia real, la fuente, la cobertura y el nivel.
 */
export type MomentoDelCalculo = 'estimado' | 'real' | 'nivel';

export interface NivelCalculado {
  readonly routeDataSource: NonNullable<NewMetricasRutaRow['routeDataSource']>;
  readonly coveragePct: number;
  readonly certificationLevel: NonNullable<NewMetricasRutaRow['certificationLevel']>;
  readonly uncertaintyFactor: number;
}

function columnasDeLaRuta(
  momento: MomentoDelCalculo,
  huella: HuellaDeServicio | null,
  nivel: NivelCalculado,
  distanciaKmReal: number | null | undefined,
): Omit<NewMetricasRutaRow, 'rutaId'> {
  const delNivel = {
    routeDataSource: nivel.routeDataSource,
    coveragePct: nivel.coveragePct.toString(),
    certificationLevel: nivel.certificationLevel,
    uncertaintyFactor: nivel.uncertaintyFactor.toString(),
    calculatedAt: new Date(),
  };
  if (momento === 'nivel') {
    return {
      ...delNivel,
      distanceKmActual: distanciaKmReal == null ? null : distanciaKmReal.toString(),
    };
  }
  if (momento === 'real') {
    // Sin huella real (cobertura bajo el umbral, peso ausente) las cifras
    // reales y el desglose quedan en null, igual que en `metricas_viaje`: el
    // desglose no puede venir de un cálculo que ya no respalda el total.
    return {
      ...delNivel,
      distanceKmActual: distanciaKmReal == null ? null : distanciaKmReal.toString(),
      carbonEmissionsKgco2eActual: huella ? huella.ruta.emisionesKgco2eWtw.toString() : null,
      fuelConsumedLActual:
        huella && huella.ruta.unidadCombustible === 'L'
          ? huella.ruta.combustibleConsumido.toString()
          : null,
      emisionesKgco2eTtw: huella ? huella.ruta.emisionesKgco2eTtw.toString() : null,
      emisionesKgco2eWtt: huella ? huella.ruta.emisionesKgco2eWtt.toString() : null,
      intensidadGco2ePorTkm:
        huella && huella.ruta.intensidadGco2ePorTonKm > 0
          ? huella.ruta.intensidadGco2ePorTonKm.toString()
          : null,
      ...(huella
        ? {
            actividadTkm: huella.ruta.actividadTkm.toString(),
            precisionMethod: huella.ruta.metodoPrecision,
            glecVersion: huella.ruta.versionGlec,
            emissionFactorUsed: huella.ruta.factorEmisionUsado.toString(),
            factoresFuente: huella.ruta.fuenteFactores,
            versionMetodoReparto: huella.reparto.versionMetodo,
          }
        : {}),
    };
  }
  if (!huella) {
    throw new Error('el cálculo estimado de una ruta siempre tiene huella');
  }
  const { ruta } = huella;
  return {
    ...delNivel,
    distanceKmEstimated: ruta.distanciaKm.toString(),
    actividadTkm: ruta.actividadTkm.toString(),
    carbonEmissionsKgco2eEstimated: ruta.emisionesKgco2eWtw.toString(),
    emisionesKgco2eTtw: ruta.emisionesKgco2eTtw.toString(),
    emisionesKgco2eWtt: ruta.emisionesKgco2eWtt.toString(),
    intensidadGco2ePorTkm:
      ruta.intensidadGco2ePorTonKm > 0 ? ruta.intensidadGco2ePorTonKm.toString() : null,
    fuelConsumedLEstimated:
      ruta.unidadCombustible === 'L' ? ruta.combustibleConsumido.toString() : null,
    precisionMethod: ruta.metodoPrecision,
    glecVersion: ruta.versionGlec,
    emissionFactorUsed: ruta.factorEmisionUsado.toString(),
    factoresFuente: ruta.fuenteFactores,
    versionMetodoReparto: huella.reparto.versionMetodo,
  };
}

/**
 * Guarda la huella de la ruta del viaje y deja en `metricas_viaje` de qué ruta
 * sale la parte del servicio, su actividad y su participación. Va en la misma
 * transacción que la escritura de `metricas_viaje`.
 *
 * Un viaje cuya asignación todavía no tiene ruta (anterior a la migración
 * 0078, antes del relleno) no escribe nada aquí: devuelve `null`. Sus cifras
 * salen igual del cálculo por ruta; solo falta dónde colgarlas.
 */
export async function guardarMetricasDeRuta(
  tx: Tx | Db,
  opts: {
    readonly tripId: string;
    readonly momento: MomentoDelCalculo;
    /** `null` en el momento `nivel`, y en `real` cuando no hubo huella medida. */
    readonly huella: HuellaDeServicio | null;
    readonly nivel: NivelCalculado;
    readonly distanciaKmReal?: number | null;
  },
): Promise<{ rutaId: string } | null> {
  const { tripId, momento, huella, nivel } = opts;
  // rls-allowlist: asignación del viaje ya validado por quien llama al cálculo (tripId)
  const [asignacion] = await tx
    .select({ rutaId: assignments.rutaId })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const rutaId = asignacion?.rutaId ?? null;
  if (rutaId === null) {
    return null;
  }

  const columnas = columnasDeLaRuta(momento, huella, nivel, opts.distanciaKmReal);
  await tx
    .insert(metricasRuta)
    .values({ rutaId, ...columnas })
    .onConflictDoUpdate({
      target: metricasRuta.rutaId,
      set: { ...columnas, updatedAt: sql`now()` },
    });

  await tx
    .update(tripMetrics)
    .set({
      rutaId,
      ...(huella
        ? {
            actividadTkm: huella.reparto.actividadTkm.toString(),
            participacion: huella.reparto.participacionPct.toString(),
            versionMetodoReparto: huella.reparto.versionMetodo,
          }
        : {}),
    })
    .where(eq(tripMetrics.tripId, tripId));

  return { rutaId };
}
