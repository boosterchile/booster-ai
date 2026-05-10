import {
  type GreenDrivingEvent,
  type GreenDrivingEventType,
  extractGreenDrivingEvents,
} from '@booster-ai/codec8-parser';
import type { Logger } from '@booster-ai/logger';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RecordMessage } from './persist.js';

/**
 * Persistencia de eventos de conducción (Phase 2 PR-I2).
 *
 * El processor recibe records uno-a-uno via PubSub. Para cada record:
 *   1. extractGreenDrivingEvents lo escanea y extrae 0..2 eventos
 *      (harsh accel/brake/cornering + over_speed pueden coexistir).
 *   2. Cada evento se inserta en `eventos_conduccion_verde` con
 *      ON CONFLICT DO NOTHING — dedup natural por
 *      (vehiculo_id, timestamp_device, tipo).
 *
 * Por qué inserción individual (no bulk):
 *   - Eventos por record son 0-2 en el caso normal. Bulk con
 *     jsonb_to_recordset agrega complejidad sin ganancia perceptible.
 *   - Falla parcial (un evento OK, otro corrupto) no bloquea al otro:
 *     cada INSERT es independiente.
 *
 * Idempotencia: si un AVL packet llega dos veces (retry de Pub/Sub),
 * los eventos son los mismos por (vehículo, timestamp_device, tipo) →
 * el ON CONFLICT los descarta. result.rowCount cuenta cuántos
 * efectivamente entraron por primera vez.
 */

/**
 * Mapeo del tipo del codec8-parser (inglés) al enum de DB (español).
 * Espejo de `tipoEventoConduccionEnum` en apps/api/src/db/schema.ts
 * (PR-I2). Si cambia un lado, actualizar el otro.
 */
const TYPE_TO_DB: Record<GreenDrivingEventType, string> = {
  harsh_acceleration: 'aceleracion_brusca',
  harsh_braking: 'frenado_brusco',
  harsh_cornering: 'curva_brusca',
  over_speed: 'exceso_velocidad',
};

export interface PersistGreenDrivingResult {
  /** Total de eventos extraídos del record (0..2 típico). */
  extractedCount: number;
  /** Cuántos efectivamente entraron por primera vez (dedup ON CONFLICT). */
  insertedCount: number;
}

/**
 * Extrae y persiste eventos de green-driving del record. Si el record
 * no tiene los IO IDs relevantes (253/255), retorna 0/0 sin tocar la DB.
 *
 * Si `vehicleId === null` (device pendiente de aprobación), retorna 0/0
 * silently — sin vehicleId la FK no es válida y persistir es imposible.
 *
 * Errores de DB se propagan al caller (handler de PubSub) que decide
 * ack/nack. Eventos corruptos individuales no bloquean al record
 * completo: cada INSERT es independiente; si uno falla, el siguiente
 * sigue.
 */
export async function persistGreenDrivingFromRecord(opts: {
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  msg: RecordMessage;
}): Promise<PersistGreenDrivingResult> {
  const { db, logger, msg } = opts;

  if (!msg.vehicleId) {
    return { extractedCount: 0, insertedCount: 0 };
  }

  // Convertir RecordMessage (wire format) → AvlRecord (codec8-parser
  // shape). La diferencia clave es `value`: en el wire es number|string,
  // en AvlRecord es number|bigint|Buffer. Para los IDs de green-driving
  // (253/254/255) los values son siempre uint8/uint16 → number plain,
  // así que la conversión es trivial. Defensivamente convertimos string
  // a number por si llegan IDs grandes (no debería para estos IDs, pero
  // protege ante futuros cambios del wire format).
  const ioEntries = msg.record.io.entries.map((e) => ({
    id: e.id,
    value: typeof e.value === 'string' ? Number(e.value) : e.value,
    byteSize: e.byteSize,
  }));

  const events: GreenDrivingEvent[] = extractGreenDrivingEvents({
    timestampMs: BigInt(msg.record.timestampMs),
    priority: msg.record.priority,
    gps: msg.record.gps,
    io: {
      eventIoId: msg.record.io.eventIoId,
      totalIo: msg.record.io.totalIo,
      entries: ioEntries,
    },
  });

  if (events.length === 0) {
    return { extractedCount: 0, insertedCount: 0 };
  }

  let insertedCount = 0;
  for (const event of events) {
    const tsDate = new Date(Number(event.timestampMs));
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO eventos_conduccion_verde (
        vehiculo_id, imei, timestamp_device, tipo, severidad, unidad,
        latitud, longitud, velocidad_kmh
      ) VALUES (
        ${msg.vehicleId}::uuid,
        ${msg.imei},
        ${tsDate.toISOString()}::timestamptz,
        ${TYPE_TO_DB[event.type]}::tipo_evento_conduccion,
        ${event.severity.toFixed(2)},
        ${event.unit},
        ${event.gps.latitude},
        ${event.gps.longitude},
        ${event.gps.speedKmh}
      )
      ON CONFLICT ON CONSTRAINT uq_eventos_conduccion_vehiculo_ts_tipo
      DO NOTHING
      RETURNING id
    `);
    if ((result.rows?.length ?? 0) > 0) {
      insertedCount += 1;
    }
  }

  if (insertedCount > 0) {
    logger.info(
      {
        vehicleId: msg.vehicleId,
        imei: msg.imei,
        timestampMs: msg.record.timestampMs,
        extractedCount: events.length,
        insertedCount,
        types: events.map((e) => e.type),
      },
      'green-driving events persistidos',
    );
  }

  return { extractedCount: events.length, insertedCount };
}
