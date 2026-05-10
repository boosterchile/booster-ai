/**
 * Lookup público del estado de un trip por `tracking_token_publico`
 * (Phase 5 PR-L1).
 *
 * Sin auth — el endpoint que llama esto NO requiere login. La defensa
 * es la opacidad del token (UUID v4, 122 bits de entropía no
 * enumerable) + la **mínima exposición de datos**: solo lo necesario
 * para que el shipper o consignee sepa "dónde está mi carga", nunca
 * datos del transportista (RUT, plate completa) ni precios.
 *
 * **Datos expuestos por design**:
 *   - Trip: tracking_code, status, origen / destino (texto), tipo de carga
 *   - Vehículo: tipo + plate parcial (últimos 4 chars) + posición
 *     reciente (lat/lng + speed) si <30 min vieja
 *   - ETA: placeholder en este PR — algoritmo viene en PR-L2
 *
 * **Datos NO expuestos**:
 *   - Plate completa, RUT del transportista, precio acordado
 *   - Driver name (privacy del conductor; el chat se hará con role abstracto)
 *   - Telemetría histórica más vieja que 30min
 */

import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, telemetryPoints, trips, vehicles } from '../db/schema.js';

export interface PublicTrackingPosition {
  /** ISO 8601 cuando el GPS lo emitió. */
  timestamp: string;
  /** Latitud decimal. */
  latitude: number;
  /** Longitud decimal. */
  longitude: number;
  /** Velocidad estimada en km/h. */
  speed_kmh: number | null;
}

export interface PublicTrackingResponse {
  status: 'found';
  trip: {
    tracking_code: string;
    status: string;
    origin_address: string;
    destination_address: string;
    cargo_type: string;
  };
  vehicle: {
    /** Tipo del vehículo (e.g. 'camion_3_4'). */
    type: string;
    /** Últimos 4 chars de la plate, formato `**** XX12`. Privacy. */
    plate_partial: string;
  };
  /** Posición reciente del vehículo. null si no hay lectura <30min. */
  position: PublicTrackingPosition | null;
  /** ETA placeholder. PR-L2. */
  eta_minutes: null;
}

export type PublicTrackingResult = PublicTrackingResponse | { status: 'not_found' };

/** Threshold de "telemetría reciente". Las posiciones más viejas no se exponen. */
const POSITION_FRESH_MINUTES = 30;

export async function getPublicTracking(opts: {
  db: Db;
  logger: Logger;
  token: string;
}): Promise<PublicTrackingResult> {
  const { db, logger, token } = opts;

  // Validar formato UUID antes de query — si no parece UUID, no
  // pegamos la DB (defensa contra scanning).
  if (!isUuidLike(token)) {
    return { status: 'not_found' };
  }

  // Lookup por token. Index UNIQUE garantiza O(log n).
  const rows = await db
    .select({
      assignmentId: assignments.id,
      tripStatus: trips.status,
      trackingCode: trips.trackingCode,
      originAddr: trips.originAddressRaw,
      destAddr: trips.destinationAddressRaw,
      cargoType: trips.cargoType,
      vehicleId: vehicles.id,
      vehicleType: vehicles.vehicleType,
      vehiclePlate: vehicles.plate,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .where(eq(assignments.publicTrackingToken, token))
    .limit(1);

  const row = rows[0];
  if (!row) {
    logger.info({ token: token.slice(0, 8) }, 'public tracking: token not found');
    return { status: 'not_found' };
  }

  // Last position dentro del threshold.
  const cutoff = new Date(Date.now() - POSITION_FRESH_MINUTES * 60_000);
  const posRows = await db
    .select({
      timestamp: telemetryPoints.timestampDevice,
      latitude: telemetryPoints.latitude,
      longitude: telemetryPoints.longitude,
      speedKmh: telemetryPoints.speedKmh,
    })
    .from(telemetryPoints)
    .where(
      and(
        eq(telemetryPoints.vehicleId, row.vehicleId),
        isNotNull(telemetryPoints.latitude),
        isNotNull(telemetryPoints.longitude),
        gte(telemetryPoints.timestampDevice, cutoff),
      ),
    )
    .orderBy(desc(telemetryPoints.timestampDevice))
    .limit(1);

  const posRow = posRows[0];
  const position: PublicTrackingPosition | null =
    posRow && posRow.latitude !== null && posRow.longitude !== null
      ? {
          timestamp: posRow.timestamp.toISOString(),
          latitude: Number(posRow.latitude),
          longitude: Number(posRow.longitude),
          speed_kmh: posRow.speedKmh,
        }
      : null;

  return {
    status: 'found',
    trip: {
      tracking_code: row.trackingCode,
      status: row.tripStatus,
      origin_address: row.originAddr,
      destination_address: row.destAddr,
      cargo_type: row.cargoType,
    },
    vehicle: {
      type: row.vehicleType,
      plate_partial: maskPlate(row.vehiclePlate),
    },
    position,
    eta_minutes: null,
  };
}

/**
 * Devuelve la plate enmascarada — solo los últimos 4 chars visibles,
 * el resto reemplazado por `*`. Privacy: el consignee no necesita
 * la plate completa, solo identificar visualmente al vehículo cuando
 * llegue ("la mía es la que termina en KZ12").
 */
export function maskPlate(plate: string): string {
  const trimmed = plate.replace(/\s+/g, '').toUpperCase();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  const visible = trimmed.slice(-4);
  const masked = '*'.repeat(trimmed.length - 4);
  return `${masked}${visible}`;
}

/**
 * Validación lightweight de formato UUID (8-4-4-4-12 hex). No usamos
 * el package `uuid` por evitar la dep — el regex es suficiente para
 * descartar tokens malformados antes de query.
 */
export function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
