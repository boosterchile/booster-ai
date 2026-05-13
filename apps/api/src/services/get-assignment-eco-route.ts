/**
 * Eco-route polyline para una assignment (Phase 1 PR-H5).
 *
 * Cierra el loop entre la decisión carrier-side y la ejecución
 * driver-side: el carrier ya veía el mapa de la ruta sugerida antes
 * de aceptar (PR-H4 EcoRouteMapPreview). Post-accept, el driver
 * entra a `/app/asignaciones/:id` y también debe poder ver esa misma
 * ruta para navegarla con consciencia de huella de carbono.
 *
 * **Diseño**:
 *   - Endpoint dedicado para assignments (NO reutiliza
 *     `/offers/:id/eco-preview`) porque:
 *       a) Post-accept la oferta puede pasar de pendiente → aceptada
 *          → cancelada; el contrato semántico de "preview pre-decisión"
 *          ya no aplica.
 *       b) Aquí el caller es el conductor (no necesariamente el mismo
 *          user que aceptó la oferta); el chequeo de ownership es por
 *          empresa, no por offer status.
 *       c) Reduce cantidad de datos en la respuesta — el driver solo
 *          necesita la ruta visual, no las emisiones detalladas (esas
 *          ya están persistidas en `metricas_viaje` al cierre).
 *
 *   - Solo expone `polyline_encoded` + `distance_km` + `duration_s`.
 *     NO recalcula emisiones ni intensidad (esos viven en metricas_viaje
 *     y se sirven via behavior-score endpoint).
 *
 *   - Sin cache propio: confiamos en el cache de Routes API (CDN HTTP
 *     cache) + el cliente cachea con TanStack Query staleTime 30min.
 *     A diferencia de tracking público (PR-L2c) que poll cada 30s, el
 *     driver visita la assignment una pocas veces por viaje, así que
 *     el costo bruto es bajo.
 *
 * **Fallback**: si Routes API falla o no hay API key configurada,
 * devolvemos polyline=null pero NO 4xx/5xx — la página del driver
 * sigue funcionando con resto de su contenido (chat, behavior score,
 * cards de confirmación/incidente). Ver code 'eco_route_unavailable'.
 */

import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, trips } from '../db/schema.js';
import { RoutesApiError, computeRoutes } from './routes-api.js';

export interface AssignmentEcoRoute {
  /** Polyline encoded de Routes API. null cuando no se pudo obtener (sin key, API failure, etc). */
  polylineEncoded: string | null;
  /** Distancia por carretera en km. null cuando polyline=null o servida desde cache DB. */
  distanceKm: number | null;
  /** Duración estimada en segundos. null cuando polyline=null o servida desde cache DB. */
  durationS: number | null;
  /**
   * Code legible para el UI cuando no hay polyline:
   *   - 'ok': polyline presente (live Routes API call)
   *   - 'ok_cached': polyline presente, servida desde DB (Phase 1 PR-H5b)
   *   - 'no_routes_api_key': API key no configurada en el entorno
   *   - 'routes_api_failed': Routes API rechazó o falló
   *   - 'route_empty': Routes API no encontró ruta
   */
  status: 'ok' | 'ok_cached' | 'no_routes_api_key' | 'routes_api_failed' | 'route_empty';
}

export type GetAssignmentEcoRouteResult =
  | { kind: 'ok'; data: AssignmentEcoRoute }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export async function getAssignmentEcoRoute(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  empresaId: string;
  /** GCP project ID — header X-Goog-User-Project para Routes API (ADR-038). */
  routesProjectId?: string | undefined;
}): Promise<GetAssignmentEcoRouteResult> {
  const { db, logger, assignmentId, empresaId, routesProjectId } = opts;

  // Cargar assignment + trip en una query (origin/destination addresses
  // + polyline cacheada PR-H5b).
  const rows = await db
    .select({
      assignmentId: assignments.id,
      assignmentEmpresaId: assignments.empresaId,
      originAddress: trips.originAddressRaw,
      destinationAddress: trips.destinationAddressRaw,
      ecoRoutePolylineEncoded: assignments.ecoRoutePolylineEncoded,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { kind: 'not_found' };
  }
  if (row.assignmentEmpresaId !== empresaId) {
    return { kind: 'forbidden' };
  }

  // Phase 1 PR-H5b — fast path: si la polyline ya fue capturada al
  // momento de aceptar la oferta (offer-actions.ts post-commit), la
  // servimos directo desde DB sin tocar Routes API. distance/duration
  // no se persistieron (esos vienen sólo del call live) — el cliente
  // las usa para info opcional, no son críticas.
  if (row.ecoRoutePolylineEncoded) {
    return {
      kind: 'ok',
      data: {
        polylineEncoded: row.ecoRoutePolylineEncoded,
        distanceKm: null,
        durationS: null,
        status: 'ok_cached',
      },
    };
  }

  if (!routesProjectId) {
    return {
      kind: 'ok',
      data: {
        polylineEncoded: null,
        distanceKm: null,
        durationS: null,
        status: 'no_routes_api_key',
      },
    };
  }

  try {
    const routes = await computeRoutes({
      projectId: routesProjectId,
      origin: row.originAddress,
      destination: row.destinationAddress,
      computeAlternatives: false,
      logger,
    });
    const top = routes[0];
    if (!top || top.distanceKm <= 0 || !top.polylineEncoded) {
      logger.warn(
        { assignmentId, origin: row.originAddress, destination: row.destinationAddress },
        'Routes API returned no usable route for assignment eco-route',
      );
      return {
        kind: 'ok',
        data: {
          polylineEncoded: null,
          distanceKm: null,
          durationS: null,
          status: 'route_empty',
        },
      };
    }
    return {
      kind: 'ok',
      data: {
        polylineEncoded: top.polylineEncoded,
        distanceKm: top.distanceKm,
        durationS: top.durationS,
        status: 'ok',
      },
    };
  } catch (err) {
    if (err instanceof RoutesApiError) {
      logger.warn(
        { assignmentId, code: err.code, httpStatus: err.httpStatus },
        'Routes API error fetching assignment eco-route',
      );
    } else {
      logger.error({ err, assignmentId }, 'Unexpected error fetching assignment eco-route');
    }
    return {
      kind: 'ok',
      data: {
        polylineEncoded: null,
        distanceKm: null,
        durationS: null,
        status: 'routes_api_failed',
      },
    };
  }
}
