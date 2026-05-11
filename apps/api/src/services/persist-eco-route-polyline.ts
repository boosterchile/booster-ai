/**
 * Captura y persiste la polyline eco-ruta para una assignment recién
 * aceptada (Phase 1 PR-H5b). Fire-and-forget post-commit.
 *
 * **Por qué post-commit y no dentro de la transacción de accept**:
 * el INSERT del assignment NO debe bloquearse por un servicio externo
 * (Routes API puede fallar, quota exceeded, network timeout). Si la
 * captura falla, la asignación queda con `eco_route_polyline_encoded =
 * null` y el endpoint `GET /assignments/:id/eco-route` hace fallback
 * a Routes API on-demand al primer pedido del driver (mismo
 * comportamiento que pre-PR-H5b).
 *
 * **Idempotente**: re-llamar este service con el mismo assignment NO
 * causa problemas — el UPDATE escribe el mismo valor (la ruta es
 * idéntica trip-tras-trip mientras origen/destino no cambien). Útil
 * para retry manual desde admin o cron de backfill futuro.
 *
 * **Costo**: 1 Routes API call por accept (~$0.005 USD). Previene
 * que GET /assignments/:id/eco-route hagan N calls posteriores (driver
 * visita la página varias veces durante el viaje). Net ahorro
 * proporcional a N (visitas por viaje).
 */

import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, trips } from '../db/schema.js';
import { RoutesApiError, computeRoutes } from './routes-api.js';

export interface PersistEcoRoutePolylineResult {
  /** Si la operación intentó algo (false = no había key configurada o assignment missing). */
  attempted: boolean;
  /** Si terminó persistiendo polyline. */
  persisted: boolean;
  /** Razón si no se persistió. */
  reason?: 'no_routes_api_key' | 'assignment_not_found' | 'routes_api_failed' | 'route_empty';
}

export async function persistEcoRoutePolyline(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  routesApiKey?: string | undefined;
}): Promise<PersistEcoRoutePolylineResult> {
  const { db, logger, assignmentId, routesApiKey } = opts;

  if (!routesApiKey) {
    return { attempted: false, persisted: false, reason: 'no_routes_api_key' };
  }

  // Lookup origin/destination via join. No optimizamos con select específico
  // de columnas en services hot — Drizzle es eficiente con shape inferencia
  // y el query plan es idéntico.
  const rows = await db
    .select({
      assignmentId: assignments.id,
      originAddress: trips.originAddressRaw,
      destinationAddress: trips.destinationAddressRaw,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    logger.warn({ assignmentId }, 'persistEcoRoutePolyline: assignment not found');
    return { attempted: true, persisted: false, reason: 'assignment_not_found' };
  }

  let polylineEncoded: string | null = null;
  try {
    const routes = await computeRoutes({
      apiKey: routesApiKey,
      origin: row.originAddress,
      destination: row.destinationAddress,
      computeAlternatives: false,
      logger,
    });
    const top = routes[0];
    if (!top || top.distanceKm <= 0 || !top.polylineEncoded) {
      logger.warn(
        { assignmentId, origin: row.originAddress, destination: row.destinationAddress },
        'persistEcoRoutePolyline: Routes API returned no usable route',
      );
      return { attempted: true, persisted: false, reason: 'route_empty' };
    }
    polylineEncoded = top.polylineEncoded;
  } catch (err) {
    if (err instanceof RoutesApiError) {
      logger.warn(
        { assignmentId, code: err.code, httpStatus: err.httpStatus },
        'persistEcoRoutePolyline: Routes API error',
      );
    } else {
      logger.error({ err, assignmentId }, 'persistEcoRoutePolyline: unexpected error');
    }
    return { attempted: true, persisted: false, reason: 'routes_api_failed' };
  }

  await db
    .update(assignments)
    .set({ ecoRoutePolylineEncoded: polylineEncoded, updatedAt: new Date() })
    .where(eq(assignments.id, assignmentId));

  logger.info(
    { assignmentId, polylineLen: polylineEncoded.length },
    'eco route polyline persisted on accept',
  );

  return { attempted: true, persisted: true };
}
