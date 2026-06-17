import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Purga de retención de `posiciones_movil_conductor` (GPS de browser,
 * ~1 punto/10s por conductor activo; spec feat-retencion-posiciones-movil).
 *
 * PRESERVA SIEMPRE la última posición por vehículo: /flota usa esta
 * tabla como fallback para vehículos sin Teltonika — un vehículo
 * inactivo >30d debe seguir mostrando su última posición conocida.
 * Invocado por Cloud Scheduler vía POST /admin/jobs/purgar-posiciones-movil.
 */
export async function purgarPosicionesMovil(opts: {
  db: Db;
  logger: Logger;
  retentionDays?: number;
}): Promise<{ deleted: number; retentionDays: number }> {
  const { db, logger } = opts;
  const retentionDays = opts.retentionDays ?? 30;

  const result = await db.execute(sql`
    DELETE FROM posiciones_movil_conductor
    WHERE timestamp_device < now() - make_interval(days => ${retentionDays})
      AND id NOT IN (
        SELECT DISTINCT ON (vehiculo_id) id
        FROM posiciones_movil_conductor
        ORDER BY vehiculo_id, timestamp_device DESC
      )
  `);

  const deleted = result.rowCount ?? 0;
  logger.info(
    { deleted, retentionDays },
    'purga de posiciones_movil_conductor completada (última posición por vehículo preservada)',
  );
  return { deleted, retentionDays };
}
