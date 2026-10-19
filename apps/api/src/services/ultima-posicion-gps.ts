import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { telemetryPoints } from '../db/schema.js';
import { coordenadaGpsValidaSql } from './coordenada-gps.js';

/**
 * Última coordenada válida de un vehículo.
 *
 * El índice general `(vehiculo_id, timestamp_device)` también indexa los
 * pings sin fix (null o 0,0). Un `ORDER BY timestamp_device DESC LIMIT 1`
 * con el filtro de coordenada camina esas filas y lee `io_data` del heap
 * hasta encontrar un fix: con horas sin GPS son decenas de segundos; con
 * el último ping válido, una lectura.
 *
 * Estos dos índices parciales solo contienen filas que pasan
 * `coordenadaGpsValidaSql`. El `LIMIT 1` es un salto al más nuevo, no un
 * barrido. El predicado del índice (migración 0066) tiene que ser el mismo
 * que el WHERE: si se afloja, el planner deja de usarlo.
 */
export const INDICE_GPS_VALIDO_VEHICULO = 'idx_telemetria_vehiculo_gps_valido';
export const INDICE_GPS_VALIDO_IMEI = 'idx_telemetria_imei_gps_valido';

const columnasUltimaPosicion = {
  timestamp_device: telemetryPoints.timestampDevice,
  timestamp_received_at: telemetryPoints.timestampReceivedAt,
  longitude: telemetryPoints.longitude,
  latitude: telemetryPoints.latitude,
  altitude_m: telemetryPoints.altitudeM,
  angle_deg: telemetryPoints.angleDeg,
  satellites: telemetryPoints.satellites,
  speed_kmh: telemetryPoints.speedKmh,
  priority: telemetryPoints.priority,
  io_data: telemetryPoints.ioData,
};

export function queryUltimaPosicionGpsValida(
  db: Db,
  clave: { vehiculoId: string } | { imei: string },
) {
  const identidad =
    'vehiculoId' in clave
      ? eq(telemetryPoints.vehicleId, clave.vehiculoId)
      : eq(telemetryPoints.imei, clave.imei);
  return db
    .select(columnasUltimaPosicion)
    .from(telemetryPoints)
    .where(
      and(identidad, coordenadaGpsValidaSql(telemetryPoints.latitude, telemetryPoints.longitude)),
    )
    .orderBy(desc(telemetryPoints.timestampDevice))
    .limit(1);
}
