import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

/**
 * Schema del mensaje publicado por el gateway. Espejo de RecordMessage
 * en apps/telemetry-tcp-gateway/src/pubsub-publisher.ts.
 *
 * Validación con zod al consumir (defensa en depth: si por bug del
 * gateway llega data malformada, ack OK + log + skip vs corromper la DB).
 */
export const recordMessageSchema = z.object({
  imei: z.string().min(8).max(20),
  vehicleId: z.string().uuid().nullable(),
  record: z.object({
    timestampMs: z.string(), // BigInt serializado como string
    priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    gps: z.object({
      longitude: z.number(),
      latitude: z.number(),
      altitude: z.number(),
      angle: z.number(),
      satellites: z.number(),
      speedKmh: z.number(),
    }),
    io: z.object({
      eventIoId: z.number(),
      totalIo: z.number(),
      entries: z.array(
        z.object({
          id: z.number(),
          value: z.union([z.number(), z.string()]),
          byteSize: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.null()]),
        }),
      ),
    }),
  }),
});

export type RecordMessage = z.infer<typeof recordMessageSchema>;

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
 * Si vehicleId es null (device pendiente de aprobación), igual loggeamos
 * el evento pero NO insertamos en telemetria_puntos (no hay FK válido).
 * El admin verá el device en el panel y al asociar, las próximas
 * telemetrías se persisten.
 */
export async function persistRecord(opts: {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  msg: RecordMessage;
}): Promise<PersistResult> {
  const { db, logger, msg } = opts;

  if (!msg.vehicleId) {
    logger.debug(
      { imei: msg.imei, timestampMs: msg.record.timestampMs },
      'record sin vehicleId (device pendiente), descartando',
    );
    return { inserted: false, isFirstPointForVehicle: false };
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
      ${msg.vehicleId}::uuid,
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

  // Chequear si fue el primer punto (count = 1 ahora).
  const countRes = await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text as count FROM telemetria_puntos
    WHERE vehiculo_id = ${msg.vehicleId}::uuid
  `);
  const isFirstPointForVehicle = countRes.rows[0]?.count === '1';

  return { inserted: true, isFirstPointForVehicle };
}
