import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Contrato del mensaje: ÚNICA definición en @booster-ai/shared-schemas
 * (events/telemetry-record.ts) — el espejo local duplicado fue eliminado
 * (auditoría 2026-06-09, riesgo alto: drift = descarte silencioso).
 * Re-export para compat de los consumidores internos (main, tests).
 */
import type { TelemetryRecordMessage as RecordMessage } from '@booster-ai/shared-schemas';
export { telemetryRecordMessageSchema as recordMessageSchema } from '@booster-ai/shared-schemas';
export type { TelemetryRecordMessage as RecordMessage } from '@booster-ai/shared-schemas';

export interface PersistResult {
  /** True si insertó, false si fue duplicado (ON CONFLICT DO NOTHING). */
  inserted: boolean;
  /** True si fue el primer punto del vehículo (trigger evento). */
  isFirstPointForVehicle: boolean;
}

/**
 * Persiste un AVL record en `telemetria_puntos` con dedup natural via
 * UNIQUE (imei, timestamp_device).
 *
 * Si vehicleId es null intentamos resolverlo acá por IMEI contra
 * `vehiculos.teltonika_imei`: el sms-fallback-gateway publica SIEMPRE
 * vehicleId null (no tiene conexión a DB por diseño) y sin este lookup
 * cada evento panic que entra por SMS se perdía en silencio
 * (auditoría 2026-06-09). Si el IMEI tampoco está registrado (device
 * pendiente de aprobación), descartamos con warn: el admin verá el
 * device en el panel y al asociar, las próximas telemetrías persisten.
 */
export async function persistRecord(opts: {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  msg: RecordMessage;
}): Promise<PersistResult> {
  const { db, logger, msg } = opts;

  let vehicleId = msg.vehicleId;
  if (!vehicleId) {
    const lookup = await db.execute<{ id: string }>(sql`
      SELECT id FROM vehiculos WHERE teltonika_imei = ${msg.imei} LIMIT 1
    `);
    vehicleId = lookup.rows[0]?.id ?? null;
    if (vehicleId) {
      logger.info(
        { imei: msg.imei, vehicleId, timestampMs: msg.record.timestampMs },
        'vehicleId resuelto por lookup IMEI en processor (publisher sin resolución, ej. sms-fallback)',
      );
    } else {
      logger.warn(
        { imei: msg.imei, timestampMs: msg.record.timestampMs },
        'record sin vehicleId e IMEI no registrado en vehiculos, descartando',
      );
      return { inserted: false, isFirstPointForVehicle: false };
    }
  }

  // Construir el dict { id: value } para io_data desde entries.
  const ioData: Record<string, number | string> = {};
  for (const e of msg.record.io.entries) {
    ioData[String(e.id)] = e.value;
  }

  // Convertir timestamp ms a Date (Postgres timestamptz acepta).
  const tsDate = new Date(Number(msg.record.timestampMs));

  // INSERT con ON CONFLICT DO NOTHING para dedup natural.
  // RETURNING devuelve el id si insertó, vacío si duplicado.
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO telemetria_puntos (
      vehiculo_id, imei, timestamp_device, prioridad,
      longitud, latitud, altitud_m, rumbo_deg, satelites, velocidad_kmh,
      event_io_id, io_data
    ) VALUES (
      ${vehicleId}::uuid,
      ${msg.imei},
      ${tsDate.toISOString()}::timestamptz,
      ${msg.record.priority},
      ${msg.record.gps.longitude},
      ${msg.record.gps.latitude},
      ${msg.record.gps.altitude},
      ${msg.record.gps.angle},
      ${msg.record.gps.satellites},
      ${msg.record.gps.speedKmh},
      ${msg.record.io.eventIoId},
      ${JSON.stringify(ioData)}::jsonb
    )
    ON CONFLICT (imei, timestamp_device) DO NOTHING
    RETURNING id
  `);

  const inserted = (result.rows?.length ?? 0) > 0;

  if (!inserted) {
    return { inserted: false, isFirstPointForVehicle: false };
  }

  // Chequear si fue el primer punto del vehículo. LIMIT 2 en vez de
  // COUNT(*): el COUNT recorría TODO el histórico indexado del vehículo
  // en cada insert (O(n) por insert, agregado cuadrático sin purga —
  // auditoría 2026-06-09). Con LIMIT 2 leemos máximo 2 entradas del
  // índice: exactamente 1 fila ⇒ la recién insertada es la primera.
  const firstCheck = await db.execute<{ ok: number }>(sql`
    SELECT 1 as ok FROM telemetria_puntos
    WHERE vehiculo_id = ${vehicleId}::uuid
    LIMIT 2
  `);
  const isFirstPointForVehicle = (firstCheck.rows?.length ?? 0) === 1;

  return { inserted: true, isFirstPointForVehicle };
}
