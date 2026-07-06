import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RateLimiter } from './rate-limiter.js';

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
  /**
   * Rate limiter del enrollment (P1-L). Solo se consulta cuando el IMEI es
   * DESCONOCIDO (a punto de enrollar) — los devices autorizados nunca se
   * limitan. Si rechaza, se omite el upsert (no se escribe en
   * `dispositivos_pendientes`): acota el crecimiento de la tabla ante un flood
   * de IMEIs falsos. Opcional para backwards-compat / tests.
   */
  enrollmentLimiter?: RateLimiter;
}): Promise<ImeiResolution> {
  const { db, logger, imei, sourceIp, enrollmentLimiter } = opts;

  // 1. Lookup en vehículos.
  const vehMatch = await db.execute<{ id: string }>(
    sql`SELECT id FROM vehiculos WHERE teltonika_imei = ${imei} LIMIT 1`,
  );
  if (vehMatch.rows[0]) {
    logger.debug({ imei, vehicleId: vehMatch.rows[0].id }, 'imei autorizado');
    return { vehicleId: vehMatch.rows[0].id, pendingDeviceId: null };
  }

  // 1b. Rate limit del open enrollment (P1-L): si se excede la tasa de IMEIs
  // nuevos, NO escribimos en dispositivos_pendientes (evita que un flood infle
  // la tabla). El device autorizado ya retornó arriba, así que esto solo afecta
  // a IMEIs desconocidos.
  if (enrollmentLimiter && !enrollmentLimiter.tryConsume()) {
    logger.warn(
      { imei, sourceIp },
      'enrollment rate limit excedido — IMEI desconocido descartado sin upsert (P1-L)',
    );
    return { vehicleId: null, pendingDeviceId: null };
  }

  // 2. Upsert en dispositivos_pendientes.
  //
  // D3b (.specs/hito-2-corfo-mes-8/decisiones.md D3.b) — un device
  // DESASOCIADO (PATCH self-service W2 pone su row en 'reemplazado') que
  // sigue transmitiendo debe reaparecer en la bandeja de pendientes al
  // reconectar, para que un admin lo reasocie. Antes de esto el UPSERT
  // nunca tocaba `estado`: un row 'reemplazado' quedaba terminal y el
  // device jamás volvía a `pendiente` solo, aunque siguiera enviando
  // datos (el PATCH quedaba como único rescate manual).
  //
  // 'rechazado' NO se reabre acá — el rechazo debe sobrevivir reconexiones
  // (D2): reabrirlo automáticamente anularía la decisión explícita del
  // admin. 'aprobado' tampoco se toca (y en la práctica no debería llegar
  // a este UPSERT mientras siga vigente: el lookup de vehículo del paso 1
  // ya habría matcheado y retornado antes).
  const upserted = await db.execute<{ id: string }>(sql`
    INSERT INTO dispositivos_pendientes (imei, ultima_ip_origen, cantidad_conexiones)
    VALUES (${imei}, ${sourceIp ?? null}::inet, 1)
    ON CONFLICT (imei) DO UPDATE SET
      ultima_conexion_en = now(),
      ultima_ip_origen = EXCLUDED.ultima_ip_origen,
      cantidad_conexiones = dispositivos_pendientes.cantidad_conexiones + 1,
      actualizado_en = now(),
      estado = CASE
        WHEN dispositivos_pendientes.estado = 'reemplazado' THEN 'pendiente'
        ELSE dispositivos_pendientes.estado
      END
    RETURNING id
  `);
  const pendingId = upserted.rows[0]?.id ?? null;
  logger.warn(
    { imei, sourceIp, pendingDeviceId: pendingId },
    'imei desconocido — registrado en dispositivos_pendientes (open enrollment)',
  );
  return { vehicleId: null, pendingDeviceId: pendingId };
}
