import {
  type ParametrosCoaching,
  type ResultadoCoaching,
  generarCoachingConduccion,
} from '@booster-ai/coaching-generator';
import type { Logger } from '@booster-ai/logger';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripMetrics, trips } from '../db/schema.js';
import { createGeminiGenFn } from './gemini-client.js';

/**
 * Genera y persiste el coaching post-entrega de un trip (Phase 3 PR-J2).
 *
 * Flow:
 *   1. Cargar metricas_viaje del trip — necesitamos behavior_score y
 *      breakdown ya computados (PR-I4) como input al coaching.
 *   2. Construir ParametrosCoaching con los datos del trip + breakdown.
 *   3. Llamar a generarCoachingConduccion con Gemini wrapper (si hay
 *      GEMINI_API_KEY) o sin él (fallback plantilla).
 *   4. Persistir coaching en metricas_viaje (mensaje + foco + fuente +
 *      modelo + timestamp).
 *
 * Disparo: post-cálculo de score (calcularScoreConduccionViaje en
 * confirmar-entrega-viaje.ts) y ANTES de emitir cert.
 *
 * **Idempotente**: re-ejecuciones sobrescriben con nuevo cálculo. Si
 * el carrier abre el detalle del trip y la query ve el mensaje
 * persistido, no se re-paga Gemini.
 *
 * Si no hay score persistido (trip sin Teltonika), skip silencioso —
 * sin breakdown no hay coaching.
 */

export class TripNotFoundForCoachingError extends Error {
  constructor(public readonly tripId: string) {
    super(`Trip ${tripId} not found`);
    this.name = 'TripNotFoundForCoachingError';
  }
}

export interface GenerarCoachingResult {
  /** True si se generó y persistió. False si no había score (skip). */
  computed: boolean;
  fuente?: 'gemini' | 'plantilla';
  focoPrincipal?: string;
}

export async function generarCoachingViaje(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  /**
   * GEMINI_API_KEY del config. Si está presente, se usa Gemini API.
   * Si no, fallback a plantilla determinística (sin AI). Optional —
   * el caller decide si la pasa según config.
   */
  geminiApiKey?: string | undefined;
}): Promise<GenerarCoachingResult> {
  const { db, logger, tripId, geminiApiKey } = opts;

  // Cargar trip + metricas + assignment para construir el contexto.
  const tripRows = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  const trip = tripRows[0];
  if (!trip) {
    throw new TripNotFoundForCoachingError(tripId);
  }

  const metricsRows = await db
    .select({
      score: tripMetrics.behaviorScore,
      nivel: tripMetrics.behaviorScoreNivel,
      breakdown: tripMetrics.behaviorScoreBreakdown,
      distanceKm: tripMetrics.distanceKmActual,
      distanceKmEst: tripMetrics.distanceKmEstimated,
    })
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  const metrics = metricsRows[0];

  if (!metrics?.score || !metrics.nivel || !metrics.breakdown) {
    logger.info(
      { tripId, hasMetrics: !!metrics },
      'generarCoachingViaje: skip (sin behavior score persistido)',
    );
    return { computed: false };
  }

  const assignmentRows = await db
    .select({ deliveredAt: assignments.deliveredAt })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = assignmentRows[0];

  // Duración: deliveredAt − pickupWindowStart. Si falta uno, asumimos
  // 0 (la plantilla lo maneja como NaN en eventosPorHora — el
  // package validó esto).
  const pickupAt = trip.pickupWindowStart ?? trip.createdAt;
  const tripDurationMinutes =
    assignment?.deliveredAt && pickupAt
      ? Math.max(0, (assignment.deliveredAt.getTime() - pickupAt.getTime()) / 60_000)
      : 0;

  const distanciaKm = Number(metrics.distanceKm ?? metrics.distanceKmEst ?? 0);

  // El breakdown viene como JSONB (any). Cast defensivo + lectura
  // explícita de campos esperados.
  const breakdown = metrics.breakdown as Record<string, unknown>;
  const params: ParametrosCoaching = {
    score: Number(metrics.score),
    nivel: metrics.nivel as ParametrosCoaching['nivel'],
    desglose: {
      aceleracionesBruscas: Number(breakdown.aceleracionesBruscas ?? 0),
      frenadosBruscos: Number(breakdown.frenadosBruscos ?? 0),
      curvasBruscas: Number(breakdown.curvasBruscas ?? 0),
      excesosVelocidad: Number(breakdown.excesosVelocidad ?? 0),
      eventosPorHora: Number(breakdown.eventosPorHora ?? 0),
    },
    trip: {
      distanciaKm,
      duracionMinutos: tripDurationMinutes,
      tipoCarga: trip.cargoType,
    },
  };

  // Construir genFn solo si hay API key. Sin key → undefined → el
  // package va directo a plantilla.
  const genFn = geminiApiKey ? createGeminiGenFn({ apiKey: geminiApiKey, logger }) : undefined;

  const result: ResultadoCoaching = await generarCoachingConduccion(params, {
    ...(genFn ? { genFn } : {}),
  });

  await db
    .update(tripMetrics)
    .set({
      coachingMensaje: result.mensaje,
      coachingFoco: result.focoPrincipal,
      coachingFuente: result.fuente,
      coachingModelo: result.modelo ?? null,
      coachingGeneradoEn: new Date(),
      updatedAt: sql`now()`,
    })
    .where(eq(tripMetrics.tripId, tripId));

  logger.info(
    {
      tripId,
      foco: result.focoPrincipal,
      fuente: result.fuente,
      modelo: result.modelo,
      mensajeChars: result.mensaje.length,
    },
    'coaching persistido',
  );

  return {
    computed: true,
    fuente: result.fuente,
    focoPrincipal: result.focoPrincipal,
  };
}
