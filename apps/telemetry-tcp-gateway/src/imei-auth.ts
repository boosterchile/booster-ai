import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Resolución de IMEI → vehículo, con open enrollment fallback.
 *
 * Flow:
 *   1. Lookup vehiculos.teltonika_imei = IMEI.
 *      - Match → device autorizado, devolvemos vehicleId.
 *   2. Sin match: upsert en dispositivos_pendientes (incrementar
 *      cantidad_conexiones, actualizar ultima_conexion + IP).
 *      - Devolvemos null vehicleId pero NO cerramos conexión: el
 *        device queda enviando datos que se descartan en el processor
 *        (porque sin vehicleId no se persiste). Esto da señal al admin
 *        de "este device está activo, asociar".
 *
 * Política alternativa más estricta: rechazar la conexión si IMEI
 * no está autorizado. Decisión: open enrollment es preferible para el
 * piloto porque facilita instalaciones nuevas (instalador llega, prende
 * el device, lo ve aparecer en panel). En producción a escala se puede
 * cambiar a strict-mode con un flag de config.
 */

export interface ImeiResolution {
  /** Si está autorizado, el UUID del vehículo. Null si está pendiente. */
  vehicleId: string | null;
  /** Si pending, el ID del row en dispositivos_pendientes (para tracking). */
  pendingDeviceId: string | null;
}

export async function resolveImei(opts: {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  imei: string;
  sourceIp: string | null;
}): Promise<ImeiResolution> {
  const { db, logger, imei, sourceIp } = opts;

  // 1. Lookup en vehículos.
  const vehMatch = await db.execute<{ id: string }>(
    sql`SELECT id FROM vehiculos WHERE teltonika_imei = ${imei} LIMIT 1`,
  );
  if (vehMatch.rows[0]) {
    logger.debug({ imei, vehicleId: vehMatch.rows[0].id }, 'imei autorizado');
    return { vehicleId: vehMatch.rows[0].id, pendingDeviceId: null };
  }

  // 2. Upsert en dispositivos_pendientes.
  const upserted = await db.execute<{ id: string }>(sql`
    INSERT INTO dispositivos_pendientes (imei, ultima_ip_origen, cantidad_conexiones)
    VALUES (${imei}, ${sourceIp ?? null}::inet, 1)
    ON CONFLICT (imei) DO UPDATE SET
      ultima_conexion_en = now(),
      ultima_ip_origen = EXCLUDED.ultima_ip_origen,
      cantidad_conexiones = dispositivos_pendientes.cantidad_conexiones + 1,
      actualizado_en = now()
    RETURNING id
  `);
  const pendingId = upserted.rows[0]?.id ?? null;
  logger.warn(
    { imei, sourceIp, pendingDeviceId: pendingId },
    'imei desconocido — registrado en dispositivos_pendientes (open enrollment)',
  );
  return { vehicleId: null, pendingDeviceId: pendingId };
}
