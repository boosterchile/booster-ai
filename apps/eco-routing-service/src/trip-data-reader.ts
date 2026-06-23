/**
 * trip-data-reader: Lectura de datos de viaje desde DB usando SQL raw (drizzle-orm).
 *
 * Patrón: SQL raw via drizzle-orm `sql` template tag, siguiendo el patrón
 * de telemetry-processor (NodePgDatabase). Best-effort: si la DB falla,
 * se loguea y se retorna null.
 */

import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

export interface TripData {
  destinoAddressRaw: string;
  ecoRoutePolylineEncoded: string | null;
  estado: string;
  fuelType: string | null;
}

// Zod schema for DB row validation
const tripDataRowSchema = z.object({
  destino_direccion_raw: z.string(),
  eco_route_polyline_encoded: z.string().nullable(),
  estado: z.string(),
  tipo_combustible: z.string().nullable(),
});

export async function readTripData(opts: {
  db: NodePgDatabase<Record<string, unknown>>;
  viajeId: string;
  logger: Logger;
}): Promise<TripData | null> {
  const { db, viajeId, logger } = opts;

  try {
    const result = await db.execute<{
      destino_direccion_raw: string;
      eco_route_polyline_encoded: string | null;
      estado: string;
      tipo_combustible: string | null;
    }>(sql`
      SELECT
        v.destino_direccion_raw,
        a.eco_route_polyline_encoded,
        v.estado,
        veh.tipo_combustible
      FROM viajes v
      LEFT JOIN asignaciones a ON a.viaje_id = v.id
      LEFT JOIN vehiculos veh ON veh.id = a.vehiculo_id
      WHERE v.id = ${viajeId}
      LIMIT 1
    `);

    const rows = result.rows;
    if (!rows || rows.length === 0) {
      logger.debug({ viajeId }, 'trip-data-reader: viaje no encontrado');
      return null;
    }

    const row = rows[0];
    const parsed = tripDataRowSchema.safeParse(row);
    if (!parsed.success) {
      logger.error(
        { viajeId, zodErrors: parsed.error.issues, row },
        'trip-data-reader: validacion Zod fallo en row',
      );
      return null;
    }

    const data = parsed.data;
    return {
      destinoAddressRaw: data.destino_direccion_raw,
      ecoRoutePolylineEncoded: data.eco_route_polyline_encoded,
      estado: data.estado,
      fuelType: data.tipo_combustible,
    };
  } catch (err) {
    logger.error({ err, viajeId }, 'trip-data-reader: DB error (best-effort), retornando null');
    return null;
  }
}
