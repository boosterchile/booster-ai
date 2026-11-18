/**
 * Corrección de una huella guardada cuya distancia medida no era plausible
 * (`.specs/reemision-distancia-no-plausible/` §3.1, paso 1).
 *
 * La regla de `distancia-medida-plausible` (2026-11-16) hace que los cierres
 * descarten una distancia medida menor que `PLAUSIBILIDAD_MIN_PCT` de la
 * referencia del recorrido. Los viajes cerrados antes conservan cifras «reales»
 * calculadas sobre esa distancia. Este servicio deja la huella guardada como la
 * dejaría hoy el cierre cuando la medición no cuenta: cifras reales en null,
 * `maps_directions`, cobertura 0, nivel e incertidumbre recalculados y la
 * decisión de fuente registrada. No recalcula nada: la estimación ya está.
 *
 * La unidad es la que midió el cierre: la ruta cuando el viaje la compartió
 * con otros servicios, el viaje cuando fue solo. Todo o nada, con guarda sobre
 * los valores leídos. Un viaje por corrida; una ruta corrige todas sus cargas
 * recogidas. Reemitir los certificados es el paso 2 (`reemitir-certificado.ts`).
 */

import {
  type NivelCertificacion,
  calcularFactorIncertidumbre,
  derivarNivelCertificacion,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, metricasRuta, tripEvents, tripMetrics, trips, users } from '../db/schema.js';
import {
  DECISION_VERSION,
  PLAUSIBILIDAD_MIN_PCT,
  esDistanciaPlausible,
} from '../domain/decidir-fuente-huella.js';
import { rutaCompartidaDelViaje } from './ruta-compartida.js';

/** El motivo con que después se reemite el certificado (lista cerrada del generador). */
export const MOTIVO_CORRECCION = 'distancia_medida_no_plausible';
/** El motivo de fallback que deja la decisión de fuente (`MOTIVOS_FALLBACK`). */
export const MOTIVO_FALLBACK_CORRECCION = 'distancia_no_plausible';

export type CodigoNoCorregido =
  | 'trip_not_found'
  | 'trip_not_delivered'
  | 'metrics_missing'
  | 'ruta_no_cerrada'
  | 'ruta_sin_metricas'
  /** La unidad no tiene distancia medida: ya corregida, o nunca midió. */
  | 'sin_distancia_medida'
  /** La distancia medida cubre el recorrido: no hay nada que corregir. */
  | 'distancia_plausible'
  /** Sin emisiones estimadas no habría cifra que publicar. */
  | 'sin_estimacion'
  | 'solicitante_no_existe';

export interface ViajeDelPlan {
  readonly tripId: string;
  readonly trackingCode: string;
  readonly certificadoEmitido: boolean;
  readonly emisionesKgco2eReales: number | null;
  readonly emisionesKgco2eEstimadas: number;
}

/** Lo que la corrección va a escribir, ya comprobado. */
export interface PlanCorreccion {
  readonly unidad: 'viaje' | 'ruta';
  readonly rutaId: string | null;
  readonly distanciaMedidaKm: number;
  readonly distanciaReferenciaKm: number | null;
  readonly minimoPct: number;
  readonly fuenteAnterior: string | null;
  readonly nivel: NivelCertificacion;
  readonly incertidumbre: number;
  readonly viajes: readonly ViajeDelPlan[];
}

export type ResultadoCorreccion =
  | { readonly ok: true; readonly plan: PlanCorreccion }
  | { readonly ok: false; readonly code: CodigoNoCorregido; readonly detalle?: string };

/** Una fila ya no estaba como se leyó: no se escribió nada. */
export class CorreccionConcurrenteError extends Error {}

type TripRow = typeof trips.$inferSelect;
type MetricsRow = typeof tripMetrics.$inferSelect;

const numOrNull = (v: string | null | undefined): number | null => {
  if (v == null) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface ViajePreparado {
  readonly tripId: string;
  readonly fuenteAnterior: MetricsRow['routeDataSource'];
  readonly realesTexto: string | null;
}

interface Preparacion {
  readonly plan: PlanCorreccion;
  /** La distancia medida de la ruta tal como se leyó, para la guarda. */
  readonly rutaMedidaTexto: string | null;
  readonly viajes: readonly ViajePreparado[];
}

interface ParametrosCorreccion {
  readonly db: Db;
  readonly logger: Logger;
  readonly tripId: string;
}

const noCorregidoCon =
  (logger: Logger, tripId: string) =>
  (code: CodigoNoCorregido, detalle?: string): Extract<ResultadoCorreccion, { ok: false }> => {
    logger.warn({ tripId, code, detalle }, 'corrección de distancia no plausible no realizada');
    return { ok: false, code, ...(detalle ? { detalle } : {}) };
  };

async function preparar(
  opts: ParametrosCorreccion,
): Promise<
  { readonly ok: true; readonly prep: Preparacion } | Extract<ResultadoCorreccion, { ok: false }>
> {
  const { db, logger, tripId } = opts;
  const noCorregido = noCorregidoCon(logger, tripId);

  // rls-allowlist: corrección de plataforma scoped por tripId (job manual del PO)
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) {
    return noCorregido('trip_not_found');
  }
  if (trip.status !== 'entregado') {
    return noCorregido('trip_not_delivered');
  }
  // rls-allowlist: métricas del viaje ya leído por tripId
  const [metrics] = await db
    .select()
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  if (!metrics) {
    return noCorregido('metrics_missing');
  }

  const compartida = await rutaCompartidaDelViaje(db, tripId);
  let unidad: PlanCorreccion['unidad'] = 'viaje';
  let rutaId: string | null = null;
  let medidaTexto: string | null;
  let referenciaTexto: string | null;
  let fuenteAnterior: string | null;
  let precision: MetricsRow['precisionMethod'];
  let filas: ReadonlyArray<{ readonly trip: TripRow; readonly metrics: MetricsRow }>;
  if (compartida) {
    if (!compartida.cerrada) {
      return noCorregido('ruta_no_cerrada');
    }
    unidad = 'ruta';
    rutaId = compartida.rutaId;
    // rls-allowlist: huella de la ruta del viaje ya leído (corrección de plataforma)
    const [ruta] = await db
      .select()
      .from(metricasRuta)
      .where(eq(metricasRuta.rutaId, rutaId))
      .limit(1);
    if (!ruta) {
      return noCorregido('ruta_sin_metricas');
    }
    medidaTexto = ruta.distanceKmActual;
    referenciaTexto = ruta.distanceKmEstimated;
    fuenteAnterior = ruta.routeDataSource;
    precision = ruta.precisionMethod;
    // Las cargas que midió el cierre: las recogidas de la ruta, en el orden en
    // que se crearon.
    // rls-allowlist: servicios de la ruta de un viaje ya leído (corrección de plataforma)
    const servicios = await db
      .select({ trip: trips, metrics: tripMetrics, pickedUpAt: assignments.pickedUpAt })
      .from(assignments)
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .innerJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(eq(assignments.rutaId, rutaId))
      .orderBy(trips.createdAt, trips.id);
    filas = servicios.filter((s) => s.pickedUpAt !== null);
  } else {
    medidaTexto = metrics.distanceKmActual;
    referenciaTexto = metrics.distanceKmEstimated;
    fuenteAnterior = metrics.routeDataSource;
    precision = metrics.precisionMethod;
    filas = [{ trip, metrics }];
  }

  const distanciaMedidaKm = numOrNull(medidaTexto);
  if (medidaTexto === null || distanciaMedidaKm === null) {
    return noCorregido('sin_distancia_medida');
  }
  const distanciaReferenciaKm = numOrNull(referenciaTexto);
  if (esDistanciaPlausible(distanciaMedidaKm, distanciaReferenciaKm)) {
    return noCorregido(
      'distancia_plausible',
      `${distanciaMedidaKm} km es al menos el ${PLAUSIBILIDAD_MIN_PCT} % de ${distanciaReferenciaKm} km`,
    );
  }
  const viajes: ViajeDelPlan[] = [];
  const preparados: ViajePreparado[] = [];
  for (const f of filas) {
    const estimadas = numOrNull(f.metrics.carbonEmissionsKgco2eEstimated);
    if (estimadas === null) {
      return noCorregido('sin_estimacion', `${f.trip.trackingCode} no tiene emisiones estimadas`);
    }
    viajes.push({
      tripId: f.trip.id,
      trackingCode: f.trip.trackingCode,
      certificadoEmitido: f.metrics.certificateIssuedAt !== null,
      emisionesKgco2eReales: numOrNull(f.metrics.carbonEmissionsKgco2eActual),
      emisionesKgco2eEstimadas: estimadas,
    });
    preparados.push({
      tripId: f.trip.id,
      fuenteAnterior: f.metrics.routeDataSource,
      realesTexto: f.metrics.carbonEmissionsKgco2eActual,
    });
  }

  // El mismo nivel e incertidumbre que deja el cierre cuando la medición no cuenta.
  const nivel = derivarNivelCertificacion({
    precisionMethod: precision ?? 'por_defecto',
    routeDataSource: 'maps_directions',
    coveragePct: 0,
  });
  const incertidumbre = calcularFactorIncertidumbre({
    nivelCertificacion: nivel,
    coveragePct: 0,
    vehicleTypeMatchesRoutesApi: true,
  });

  return {
    ok: true,
    prep: {
      plan: {
        unidad,
        rutaId,
        distanciaMedidaKm,
        distanciaReferenciaKm,
        minimoPct: PLAUSIBILIDAD_MIN_PCT,
        fuenteAnterior,
        nivel,
        incertidumbre,
        viajes,
      },
      rutaMedidaTexto: unidad === 'ruta' ? medidaTexto : null,
      viajes: preparados,
    },
  };
}

/** Todas las comprobaciones y lo que se escribiría. Solo lee. */
export async function prepararCorreccion(opts: ParametrosCorreccion): Promise<ResultadoCorreccion> {
  const preparada = await preparar(opts);
  return preparada.ok ? { ok: true, plan: preparada.prep.plan } : preparada;
}

/**
 * Corrige la huella guardada de la unidad del viaje (spec §3.1, paso 1):
 * `metricas_ruta` si la ruta es compartida, `metricas_viaje` de cada carga
 * recogida y un evento `carbono_calculado` por carga. Todo o nada.
 */
export async function corregirDistanciaNoPlausible(
  opts: ParametrosCorreccion & { readonly solicitadoPorUserId: string | null },
): Promise<ResultadoCorreccion> {
  const { db, logger, tripId, solicitadoPorUserId } = opts;
  const preparada = await preparar(opts);
  if (!preparada.ok) {
    return preparada;
  }
  // El solicitante queda en los eventos (FK a usuarios): se comprueba antes de abrir la transacción.
  if (solicitadoPorUserId !== null) {
    // rls-allowlist: usuario solicitante por id (job manual del PO)
    const [solicitante] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, solicitadoPorUserId))
      .limit(1);
    if (!solicitante) {
      return noCorregidoCon(logger, tripId)(
        'solicitante_no_existe',
        `no hay un usuario con id ${solicitadoPorUserId}`,
      );
    }
  }
  const { plan, rutaMedidaTexto, viajes } = preparada.prep;

  // Lo que escribe hoy el cierre cuando la medición no cuenta (reconstruida=false).
  const nivelCols = {
    routeDataSource: 'maps_directions' as const,
    coveragePct: '0',
    certificationLevel: plan.nivel,
    uncertaintyFactor: plan.incertidumbre.toString(),
  };
  const sinMedicion = {
    distanceKmActual: null,
    carbonEmissionsKgco2eActual: null,
    fuelConsumedLActual: null,
    emisionesKgco2eTtw: null,
    emisionesKgco2eWtt: null,
    intensidadGco2ePorTkm: null,
  };
  const viajeDelPlan = new Map(plan.viajes.map((v) => [v.tripId, v]));

  await db.transaction(async (tx) => {
    if (plan.unidad === 'ruta' && plan.rutaId !== null && rutaMedidaTexto !== null) {
      // rls-allowlist: huella de la ruta ya leída; guarda sobre la distancia medida leída
      const corregidas = await tx
        .update(metricasRuta)
        .set({ ...nivelCols, ...sinMedicion, calculatedAt: new Date(), updatedAt: sql`now()` })
        .where(
          and(
            eq(metricasRuta.rutaId, plan.rutaId),
            eq(metricasRuta.distanceKmActual, rutaMedidaTexto),
          ),
        )
        .returning({ rutaId: metricasRuta.rutaId });
      if (corregidas.length !== 1) {
        throw new CorreccionConcurrenteError(
          `metricas_ruta de ${plan.rutaId} cambió mientras se preparaba la corrección`,
        );
      }
    }
    for (const v of viajes) {
      // rls-allowlist: métricas de un viaje ya leído; guarda sobre fuente y cifra real leídas
      const corregidas = await tx
        .update(tripMetrics)
        .set({
          ...nivelCols,
          ...sinMedicion,
          fuenteDistancia: 'routes_estimada',
          motivoFallback: MOTIVO_FALLBACK_CORRECCION,
          decisionVersion: DECISION_VERSION,
          decididoEn: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(tripMetrics.tripId, v.tripId),
            v.fuenteAnterior === null
              ? isNull(tripMetrics.routeDataSource)
              : eq(tripMetrics.routeDataSource, v.fuenteAnterior),
            v.realesTexto === null
              ? isNull(tripMetrics.carbonEmissionsKgco2eActual)
              : eq(tripMetrics.carbonEmissionsKgco2eActual, v.realesTexto),
          ),
        )
        .returning({ tripId: tripMetrics.tripId });
      if (corregidas.length !== 1) {
        throw new CorreccionConcurrenteError(
          `metricas_viaje de ${v.tripId} cambió mientras se preparaba la corrección`,
        );
      }
      const delPlan = viajeDelPlan.get(v.tripId);
      await tx.insert(tripEvents).values({
        tripId: v.tripId,
        eventType: 'carbono_calculado',
        source: 'sistema',
        recordedByUserId: solicitadoPorUserId,
        payload: {
          correccion: MOTIVO_CORRECCION,
          motivo_fallback: MOTIVO_FALLBACK_CORRECCION,
          unidad: plan.unidad,
          ruta_id: plan.rutaId,
          distancia_medida_km: plan.distanciaMedidaKm,
          distancia_referencia_km: plan.distanciaReferenciaKm,
          minimo_pct: plan.minimoPct,
          fuente_distancia_anterior: v.fuenteAnterior,
          emisiones_kgco2e_reales_anterior: delPlan?.emisionesKgco2eReales ?? null,
          emisiones_kgco2e_estimadas: delPlan?.emisionesKgco2eEstimadas ?? null,
          certificado_emitido: delPlan?.certificadoEmitido ?? false,
          decision_version: DECISION_VERSION,
        },
      });
    }
  });

  logger.info(
    {
      tripId,
      unidad: plan.unidad,
      rutaId: plan.rutaId,
      distanciaMedidaKm: plan.distanciaMedidaKm,
      distanciaReferenciaKm: plan.distanciaReferenciaKm,
      viajes: plan.viajes.map((v) => v.trackingCode),
    },
    'huella corregida: la distancia medida no era plausible; publica la estimación',
  );
  return { ok: true, plan };
}
