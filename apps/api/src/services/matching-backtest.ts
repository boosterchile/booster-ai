import type { Logger } from '@booster-ai/logger';
import {
  DEFAULT_WEIGHTS_V2,
  MATCHING_CONFIG,
  type ScoredCandidate,
  type ScoredCandidateV2,
  type WeightsV2,
  scoreCandidate,
  scoreCandidateV2,
  scoreToInt,
  scoreToIntV2,
  selectTopNCandidates,
  selectTopNCandidatesV2,
  validateWeights,
} from '@booster-ai/matching-algorithm';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas, matchingBacktestRuns, trips, vehicles, zones } from '../db/schema.js';
import { buildCandidateV2, lookupCarriersForV2 } from './matching-v2-lookups.js';

/**
 * Servicio de backtest del matching engine v2 (ADR-033 §8).
 *
 * Replay del scoring algorithm sobre trips históricos para comparar
 * distribuciones v1 vs v2 ANTES de activar el flag en producción.
 *
 * Concepto clave: no re-creamos offers ni mutamos estado. Sólo
 * computamos qué ofertas se HABRÍAN creado bajo cada algoritmo, las
 * comparamos, y persistimos métricas + detalle en
 * `matching_backtest_runs`.
 *
 * Limitaciones del MVP del backtest:
 *   - Las señales de v2 (trips activos, histórico 7d, reputación 90d,
 *     tier) usan el ESTADO ACTUAL de la BD, no el point-in-time del
 *     trip original. Es aproximación: para una validación rigurosa
 *     habría que reconstruir el contexto histórico, que requiere
 *     snapshots de las tablas y agrega complejidad significativa.
 *   - Para los trips muy antiguos esto puede sesgar la backhaul signal
 *     (carriers tienen más historial ahora que entonces). Se documenta
 *     en la UI y se usa para evaluación direccional, no estadística.
 *   - El usecase principal es "evaluar cómo se vería el matching HOY
 *     bajo distintos pesos" — exactamente lo que necesita el operador
 *     antes de activar el flag.
 *
 * **Idempotente**: dos corridas sobre el mismo set de trips con los
 * mismos pesos producen el mismo resultado (modulo cambios de estado
 * en la BD entre corridas).
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface RunBacktestInput {
  db: Db;
  logger: Logger;
  /** Email del operador que dispara la corrida. Auditabilidad. */
  createdByEmail: string;
  /** Rango temporal del muestreo. Si NULL → todos los trips terminales. */
  tripsDesde?: Date | null;
  tripsHasta?: Date | null;
  /** Cap de trips a procesar. Default 500, hard-cap 5000 (SQL CHECK). */
  tripsLimit?: number;
  /** Pesos custom. Si undefined → DEFAULT_WEIGHTS_V2. */
  pesos?: WeightsV2 | undefined;
}

export interface ResultadoTripBacktest {
  tripId: string;
  originRegionCode: string;
  cargoWeightKg: number;
  candidatosTotal: number;
  /** Ofertas que v1 habría creado (top-N por score capacity-only). */
  ofertasV1: Array<{ empresaId: string; vehicleId: string; scoreInt: number }>;
  /** Ofertas que v2 habría creado (top-N por score multifactor). */
  ofertasV2: Array<{ empresaId: string; vehicleId: string; scoreInt: number }>;
  /** Cardinalidad de la intersección empresa-id entre v1 y v2 (top-N). */
  overlapEmpresas: number;
  /** Delta promedio scoreV2 - scoreV1 (mismo carrier, escala 0..1). */
  deltaScorePromedio: number;
  /** ¿v2 detectó al menos un carrier con tripActivoDestinoRegionMatch? */
  backhaulHit: boolean;
}

export interface MetricasResumen {
  tripsProcesados: number;
  tripsConCandidatosV1: number;
  tripsConCandidatosV2: number;
  /** % de ofertas v2 cuyo empresaId también figura en top-N v1. */
  topNOverlapPct: number;
  /** Delta avg signed entre score v2 y v1 sobre el mismo (trip, carrier). */
  scoreDeltaAvg: number;
  /** % de trips donde v2 encontró ≥1 carrier con backhaul match. */
  backhaulHitRatePct: number;
  /** Top-3 empresas que más ganaron oferta-slots al pasar de v1 a v2. */
  empresasFavorecidas: Array<{ empresaId: string; delta: number }>;
  /** Top-3 empresas que más perdieron slots. */
  empresasPerjudicadas: Array<{ empresaId: string; delta: number }>;
  /** Histogram de scores v2 en buckets de 200 (0-200, 200-400, ..., 800-1000). */
  distribucionScoresV2: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class BacktestRunNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Backtest run ${id} not found`);
    this.name = 'BacktestRunNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Dispara una corrida de backtest. Persiste estado=pendiente → ejecutando
 * → completada|fallida. Devuelve el id para que el caller pueda
 * polear el resultado.
 *
 * Diseño síncrono en MVP: para sets típicos (100-500 trips) corre en
 * <30s. Si crece, mover a job queue (job dispatcher genérico ya existe
 * para cron de cobranza).
 */
export async function runBacktest(input: RunBacktestInput): Promise<{
  id: string;
  resumen: MetricasResumen;
}> {
  const {
    db,
    logger,
    createdByEmail,
    tripsDesde = null,
    tripsHasta = null,
    tripsLimit = 500,
    pesos,
  } = input;

  const pesosToUse = pesos ?? DEFAULT_WEIGHTS_V2;
  validateWeights(pesosToUse); // throw si inválidos

  // 1. Insert fila pendiente, status=ejecutando.
  const [created] = await db
    .insert(matchingBacktestRuns)
    .values({
      createdByEmail,
      tripsDesde,
      tripsHasta,
      tripsLimit,
      pesosUsados: pesosToUse,
      estado: 'ejecutando',
    })
    .returning({ id: matchingBacktestRuns.id });

  if (!created) {
    throw new Error('failed to insert backtest run row');
  }
  const runId = created.id;

  logger.info({ runId, createdByEmail, tripsLimit }, 'backtest: started');

  try {
    // 2. Cargar trips del rango (solo terminales que tienen contexto completo).
    const tripFilters = [
      inArray(trips.status, [
        'ofertas_enviadas',
        'asignado',
        'en_proceso',
        'entregado',
        'expirado',
      ]),
    ];
    if (tripsDesde) {
      tripFilters.push(gte(trips.createdAt, tripsDesde));
    }
    if (tripsHasta) {
      tripFilters.push(lte(trips.createdAt, tripsHasta));
    }
    const tripRows = await db
      .select()
      .from(trips)
      .where(and(...tripFilters))
      .orderBy(desc(trips.createdAt))
      .limit(tripsLimit);

    if (tripRows.length === 0) {
      const resumen = makeEmptyResumen();
      await markCompleted(db, runId, resumen, []);
      logger.warn({ runId }, 'backtest: 0 trips matched filter');
      return { id: runId, resumen };
    }

    // 3. Por trip, replay del scoring.
    const resultados: ResultadoTripBacktest[] = [];
    for (const trip of tripRows) {
      if (!trip.originRegionCode) {
        continue;
      }
      const resultado = await backtestSingleTrip({
        db,
        logger,
        trip: {
          id: trip.id,
          originRegionCode: trip.originRegionCode,
          cargoWeightKg: trip.cargoWeightKg ?? 0,
        },
        pesos: pesosToUse,
      });
      if (resultado) {
        resultados.push(resultado);
      }
    }

    // 4. Agregar métricas resumen.
    const resumen = computeResumen(resultados);

    // 5. Persistir resultado final.
    await markCompleted(db, runId, resumen, resultados);
    logger.info({ runId, tripsProcesados: resumen.tripsProcesados }, 'backtest: completed');

    return { id: runId, resumen };
  } catch (err) {
    const message = (err as Error).message;
    await db
      .update(matchingBacktestRuns)
      .set({
        estado: 'fallida',
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(matchingBacktestRuns.id, runId));
    logger.error({ runId, err: message }, 'backtest: failed');
    throw err;
  }
}

/**
 * Lista corridas paginadas (más recientes primero).
 */
export async function listBacktestRuns(opts: {
  db: Db;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    createdAt: Date;
    createdByEmail: string;
    estado: string;
    tripsProcesados: number;
    resumenPreview: Pick<MetricasResumen, 'topNOverlapPct' | 'scoreDeltaAvg'> | null;
  }>
> {
  const { db, limit = 25 } = opts;
  const rows = await db
    .select({
      id: matchingBacktestRuns.id,
      createdAt: matchingBacktestRuns.createdAt,
      createdByEmail: matchingBacktestRuns.createdByEmail,
      estado: matchingBacktestRuns.estado,
      tripsProcesados: matchingBacktestRuns.tripsProcesados,
      metricasResumen: matchingBacktestRuns.metricasResumen,
    })
    .from(matchingBacktestRuns)
    .orderBy(desc(matchingBacktestRuns.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const resumen = r.metricasResumen as MetricasResumen | null;
    return {
      id: r.id,
      createdAt: r.createdAt,
      createdByEmail: r.createdByEmail,
      estado: r.estado,
      tripsProcesados: r.tripsProcesados,
      resumenPreview: resumen
        ? {
            topNOverlapPct: resumen.topNOverlapPct,
            scoreDeltaAvg: resumen.scoreDeltaAvg,
          }
        : null,
    };
  });
}

/**
 * Lee una corrida completa con todos sus resultados.
 */
export async function getBacktestRun(opts: {
  db: Db;
  id: string;
}): Promise<{
  id: string;
  createdAt: Date;
  completedAt: Date | null;
  createdByEmail: string;
  estado: string;
  tripsProcesados: number;
  tripsConCandidatosV1: number;
  tripsConCandidatosV2: number;
  pesosUsados: WeightsV2 | null;
  metricasResumen: MetricasResumen | null;
  resultados: ResultadoTripBacktest[] | null;
  errorMessage: string | null;
}> {
  const { db, id } = opts;
  const rows = await db
    .select()
    .from(matchingBacktestRuns)
    .where(eq(matchingBacktestRuns.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new BacktestRunNotFoundError(id);
  }
  return {
    id: row.id,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    createdByEmail: row.createdByEmail,
    estado: row.estado,
    tripsProcesados: row.tripsProcesados,
    tripsConCandidatosV1: row.tripsConCandidatosV1,
    tripsConCandidatosV2: row.tripsConCandidatosV2,
    pesosUsados: row.pesosUsados as WeightsV2 | null,
    metricasResumen: row.metricasResumen as MetricasResumen | null,
    resultados: row.resultados as ResultadoTripBacktest[] | null,
    errorMessage: row.errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface BacktestSingleTripInput {
  db: Db;
  logger: Logger;
  trip: {
    id: string;
    originRegionCode: string;
    cargoWeightKg: number;
  };
  pesos: WeightsV2;
}

/**
 * Replay del candidate selection para un trip individual. Replica la
 * lógica del orchestrator (matching.ts) pero SIN persistir nada.
 */
async function backtestSingleTrip(
  input: BacktestSingleTripInput,
): Promise<ResultadoTripBacktest | null> {
  const { db, trip, pesos } = input;

  // 1. Empresas candidatas por zona (igual que el orchestrator).
  const candidateZones = await db
    .select({ empresaId: zones.empresaId })
    .from(zones)
    .where(
      and(
        eq(zones.regionCode, trip.originRegionCode),
        inArray(zones.zoneType, ['recogida', 'ambos']),
        eq(zones.isActive, true),
      ),
    );
  const candidateEmpresaIds = [...new Set(candidateZones.map((z) => z.empresaId))];
  if (candidateEmpresaIds.length === 0) {
    return null;
  }

  const candidateEmpresas = await db
    .select()
    .from(empresas)
    .where(
      and(
        inArray(empresas.id, candidateEmpresaIds),
        eq(empresas.isTransportista, true),
        eq(empresas.status, 'activa'),
      ),
    );
  if (candidateEmpresas.length === 0) {
    return null;
  }

  // 2. Lookups v2 (compartidos por todas las empresas, una sola query batch).
  const lookups = await lookupCarriersForV2({
    db,
    logger: input.logger,
    empresaIds: candidateEmpresas.map((e) => e.id),
    originRegionCode: trip.originRegionCode,
  });

  // 3. Por empresa, mejor vehículo + scoring v1 y v2 en paralelo.
  const candidatesV1: ScoredCandidate[] = [];
  const candidatesV2: ScoredCandidateV2[] = [];
  for (const emp of candidateEmpresas) {
    const vehs = await db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.empresaId, emp.id),
          eq(vehicles.vehicleStatus, 'activo'),
          gte(vehicles.capacityKg, trip.cargoWeightKg),
        ),
      )
      .orderBy(vehicles.capacityKg)
      .limit(1);
    const veh = vehs[0];
    if (!veh) {
      continue;
    }

    const vehicleCapacityKg = veh.capacityKg;
    const baseCandidate = { empresaId: emp.id, vehicleId: veh.id, vehicleCapacityKg };

    // V1: capacity-only.
    const scoreV1 = scoreCandidate(baseCandidate, trip.cargoWeightKg);
    candidatesV1.push({ ...baseCandidate, score: scoreV1 });

    // V2: multifactor.
    const lookup = lookups.get(emp.id);
    if (!lookup) {
      continue;
    }
    const candV2 = buildCandidateV2({
      empresaId: emp.id,
      vehicleId: veh.id,
      vehicleCapacityKg,
      lookup,
    });
    const scoredV2 = scoreCandidateV2(
      candV2,
      { cargoWeightKg: trip.cargoWeightKg, originRegionCode: trip.originRegionCode },
      pesos,
    );
    candidatesV2.push(scoredV2);
  }

  if (candidatesV1.length === 0 && candidatesV2.length === 0) {
    return null;
  }

  // 4. Top-N para cada algoritmo.
  const topV1 = selectTopNCandidates(candidatesV1, MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST);
  const topV2 = selectTopNCandidatesV2(candidatesV2, MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST);

  // 5. Overlap empresas top-N.
  const empresasV1 = new Set(topV1.map((c) => c.empresaId));
  const empresasV2 = new Set(topV2.map((c) => c.empresaId));
  const overlapEmpresas = [...empresasV1].filter((id) => empresasV2.has(id)).length;

  // 6. Delta scores: same-carrier comparison.
  const scoresV1ByEmpresa = new Map(candidatesV1.map((c) => [c.empresaId, c.score]));
  const scoresV2ByEmpresa = new Map(candidatesV2.map((c) => [c.empresaId, c.score]));
  let deltaSum = 0;
  let deltaCount = 0;
  for (const [empresaId, scoreV2] of scoresV2ByEmpresa) {
    const scoreV1 = scoresV1ByEmpresa.get(empresaId);
    if (scoreV1 !== undefined) {
      deltaSum += scoreV2 - scoreV1;
      deltaCount++;
    }
  }
  const deltaScorePromedio = deltaCount > 0 ? deltaSum / deltaCount : 0;

  // 7. Backhaul hit: ¿al menos 1 candidato v2 con señal de backhaul?
  const backhaulHit = candidatesV2.some(
    (c) => c.backhaulSignal === 'active_trip_match' || c.backhaulSignal === 'recent_history_match',
  );

  return {
    tripId: trip.id,
    originRegionCode: trip.originRegionCode,
    cargoWeightKg: trip.cargoWeightKg,
    candidatosTotal: Math.max(candidatesV1.length, candidatesV2.length),
    ofertasV1: topV1.map((c) => ({
      empresaId: c.empresaId,
      vehicleId: c.vehicleId,
      scoreInt: scoreToInt(c.score),
    })),
    ofertasV2: topV2.map((c) => ({
      empresaId: c.empresaId,
      vehicleId: c.vehicleId,
      scoreInt: scoreToIntV2(c.score),
    })),
    overlapEmpresas,
    deltaScorePromedio,
    backhaulHit,
  };
}

/**
 * Función pura. Computa el resumen agregado dado el set de resultados.
 * Testeable sin DB.
 */
export function computeResumen(resultados: ResultadoTripBacktest[]): MetricasResumen {
  if (resultados.length === 0) {
    return makeEmptyResumen();
  }

  const tripsConCandidatosV1 = resultados.filter((r) => r.ofertasV1.length > 0).length;
  const tripsConCandidatosV2 = resultados.filter((r) => r.ofertasV2.length > 0).length;

  // Top-N overlap: media ponderada por trip.
  let overlapNum = 0;
  let overlapDenom = 0;
  for (const r of resultados) {
    if (r.ofertasV2.length === 0) {
      continue;
    }
    overlapNum += r.overlapEmpresas;
    overlapDenom += r.ofertasV2.length;
  }
  const topNOverlapPct =
    overlapDenom > 0 ? Math.round((overlapNum / overlapDenom) * 10000) / 100 : 0;

  // Score delta avg: ponderada por trip (no carriers — para que un trip
  // grande no sesgue).
  const tripsConDelta = resultados.filter((r) => r.deltaScorePromedio !== 0);
  const scoreDeltaAvg =
    tripsConDelta.length > 0
      ? Math.round(
          (tripsConDelta.reduce((acc, r) => acc + r.deltaScorePromedio, 0) / tripsConDelta.length) *
            10000,
        ) / 10000
      : 0;

  // Backhaul hit rate.
  const backhaulHits = resultados.filter((r) => r.backhaulHit).length;
  const backhaulHitRatePct = Math.round((backhaulHits / resultados.length) * 10000) / 100;

  // Empresas favorecidas / perjudicadas: count(slots v2) - count(slots v1).
  const slotsV1: Record<string, number> = {};
  const slotsV2: Record<string, number> = {};
  for (const r of resultados) {
    for (const o of r.ofertasV1) {
      slotsV1[o.empresaId] = (slotsV1[o.empresaId] ?? 0) + 1;
    }
    for (const o of r.ofertasV2) {
      slotsV2[o.empresaId] = (slotsV2[o.empresaId] ?? 0) + 1;
    }
  }
  const allEmpresas = new Set([...Object.keys(slotsV1), ...Object.keys(slotsV2)]);
  const deltas = [...allEmpresas].map((empresaId) => ({
    empresaId,
    delta: (slotsV2[empresaId] ?? 0) - (slotsV1[empresaId] ?? 0),
  }));
  const empresasFavorecidas = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const empresasPerjudicadas = deltas
    .filter((d) => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);

  // Distribución scores v2 (buckets de 200).
  const distribucionScoresV2: Record<string, number> = {
    '0-200': 0,
    '200-400': 0,
    '400-600': 0,
    '600-800': 0,
    '800-1000': 0,
  };
  for (const r of resultados) {
    for (const o of r.ofertasV2) {
      const bucket = bucketize(o.scoreInt);
      distribucionScoresV2[bucket] = (distribucionScoresV2[bucket] ?? 0) + 1;
    }
  }

  return {
    tripsProcesados: resultados.length,
    tripsConCandidatosV1,
    tripsConCandidatosV2,
    topNOverlapPct,
    scoreDeltaAvg,
    backhaulHitRatePct,
    empresasFavorecidas,
    empresasPerjudicadas,
    distribucionScoresV2,
  };
}

function bucketize(scoreInt: number): string {
  if (scoreInt < 200) {
    return '0-200';
  }
  if (scoreInt < 400) {
    return '200-400';
  }
  if (scoreInt < 600) {
    return '400-600';
  }
  if (scoreInt < 800) {
    return '600-800';
  }
  return '800-1000';
}

function makeEmptyResumen(): MetricasResumen {
  return {
    tripsProcesados: 0,
    tripsConCandidatosV1: 0,
    tripsConCandidatosV2: 0,
    topNOverlapPct: 0,
    scoreDeltaAvg: 0,
    backhaulHitRatePct: 0,
    empresasFavorecidas: [],
    empresasPerjudicadas: [],
    distribucionScoresV2: {
      '0-200': 0,
      '200-400': 0,
      '400-600': 0,
      '600-800': 0,
      '800-1000': 0,
    },
  };
}

async function markCompleted(
  db: Db,
  runId: string,
  resumen: MetricasResumen,
  resultados: ResultadoTripBacktest[],
): Promise<void> {
  await db
    .update(matchingBacktestRuns)
    .set({
      estado: 'completada',
      completedAt: new Date(),
      tripsProcesados: resumen.tripsProcesados,
      tripsConCandidatosV1: resumen.tripsConCandidatosV1,
      tripsConCandidatosV2: resumen.tripsConCandidatosV2,
      metricasResumen: resumen,
      resultados: resultados,
    })
    .where(eq(matchingBacktestRuns.id, runId));
}

// Touch `sql` para suppress unused linter (importado por si se requiere
// en queries con expresiones SQL raw en futuras métricas).
void sql;
