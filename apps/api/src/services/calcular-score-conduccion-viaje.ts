import {
  type EventoConduccion,
  type TipoEvento,
  calcularScoreConduccion,
} from '@booster-ai/driver-scoring';
import type { Logger } from '@booster-ai/logger';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, greenDrivingEvents, tripMetrics, trips } from '../db/schema.js';

/**
 * Calcular y persistir el behavior score de un trip (Phase 2 PR-I4).
 *
 * Flow:
 *   1. Cargar eventos de `eventos_conduccion_verde` filtrados por
 *      vehículo + ventana del trip (pickupAt → deliveredAt).
 *   2. Calcular score puro vía @booster-ai/driver-scoring.
 *   3. Persistir score + nivel + breakdown en `metricas_viaje`.
 *
 * Disparo: post-entrega, llamado por confirmar-entrega-viaje.ts
 * (mismo flujo que recalcularNivelPostEntrega de ADR-028 PR-G).
 *
 * Si el trip no tiene Teltonika asociado, no hay eventos → score
 * sigue NULL en BD. La UI del transportista debe distinguir
 * "sin score = no aplica" vs "score 0 = malo extremo".
 *
 * Idempotente: si ya hay un score persistido, este se sobrescribe
 * con el cálculo nuevo (cuya entrada de eventos no debería cambiar
 * post-entrega salvo retries del processor).
 */

export class TripNotFoundForScoreError extends Error {
  constructor(public readonly tripId: string) {
    super(`Trip ${tripId} not found`);
    this.name = 'TripNotFoundForScoreError';
  }
}

export interface CalcularScoreResult {
  /** True si hay eventos y se persistió score; false si no había eventos. */
  computed: boolean;
  score?: number;
  nivel?: 'excelente' | 'bueno' | 'regular' | 'malo';
  eventCount?: number;
}

export async function calcularScoreConduccionViaje(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
}): Promise<CalcularScoreResult> {
  const { db, logger, tripId } = opts;

  // Cargar trip + assignment para obtener vehículo + ventana del trip.
  const tripRows = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  const trip = tripRows[0];
  if (!trip) {
    throw new TripNotFoundForScoreError(tripId);
  }

  const assignmentRows = await db
    .select({
      vehicleId: assignments.vehicleId,
      deliveredAt: assignments.deliveredAt,
    })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = assignmentRows[0];

  if (!assignment?.vehicleId || !assignment.deliveredAt) {
    logger.info(
      { tripId, hasAssignment: !!assignment },
      'calcularScoreConduccionViaje: skip (sin assignment con vehicle + deliveredAt)',
    );
    return { computed: false };
  }

  // Ventana del trip: desde pickup_window_start (o created_at como
  // fallback conservador) hasta deliveredAt. Cualquier evento del
  // vehículo en esa ventana se considera de este trip.
  const pickupAt = trip.pickupWindowStart ?? trip.createdAt;
  const deliveredAt = assignment.deliveredAt;

  const eventRows = await db
    .select({
      type: greenDrivingEvents.type,
      severity: greenDrivingEvents.severity,
      timestampDevice: greenDrivingEvents.timestampDevice,
    })
    .from(greenDrivingEvents)
    .where(
      and(
        eq(greenDrivingEvents.vehicleId, assignment.vehicleId),
        gte(greenDrivingEvents.timestampDevice, pickupAt),
        lte(greenDrivingEvents.timestampDevice, deliveredAt),
      ),
    );

  const events: EventoConduccion[] = eventRows.map((row) => ({
    type: row.type as TipoEvento,
    severity: Number(row.severity),
    timestampMs: row.timestampDevice.getTime(),
  }));

  // Duración del trip en minutos (para eventos/hora del breakdown).
  const tripDurationMinutes = Math.max(0, (deliveredAt.getTime() - pickupAt.getTime()) / 60_000);

  const result = calcularScoreConduccion({ events, tripDurationMinutes });

  // Persistir incluso si events.length === 0: en ese caso el score
  // = 100 (excelente, sin eventos). El transportista lo merece.
  await db
    .update(tripMetrics)
    .set({
      behaviorScore: result.score.toFixed(2),
      behaviorScoreNivel: result.nivel,
      behaviorScoreBreakdown: result.desglose,
      updatedAt: sql`now()`,
    })
    .where(eq(tripMetrics.tripId, tripId));

  logger.info(
    {
      tripId,
      vehicleId: assignment.vehicleId,
      eventCount: events.length,
      score: result.score,
      nivel: result.nivel,
      tripDurationMinutes,
    },
    'behavior score persistido',
  );

  return {
    computed: true,
    score: result.score,
    nivel: result.nivel,
    eventCount: events.length,
  };
}
