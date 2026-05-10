/**
 * Lookup público del estado de un trip por `tracking_token_publico`
 * (Phase 5 PR-L1 + L2).
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
 *   - Progress (PR-L2): avg_speed_kmh_last_15min + last_position_age_seconds
 *     para que el consignee pueda interpretar el progreso ("se está
 *     moviendo", "lleva 5 min sin reportar")
 *   - ETA: aún null — la fórmula real necesita coords de destino que el
 *     trips schema NO tiene (solo address text). Difiere a PR-L2b: o
 *     geocodificar y guardar lat/lng al crear el trip, o llamar Routes
 *     API on-demand con caché 60s.
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

/**
 * Señales de progreso del viaje calculadas a partir del historial
 * reciente de telemetría (Phase 5 PR-L2). El frontend las usa para
 * interpretar el contexto: "se está moviendo a buen ritmo" vs "está
 * detenido hace mucho" vs "perdió señal hace 5 min".
 */
export interface PublicTrackingProgress {
  /**
   * Velocidad promedio en los últimos 15 min (km/h). Null si hay <2
   * lecturas en la ventana o si todas reportan 0 (vehículo parado).
   *
   * Útil para detectar "lleva 30 min sin moverse" vs "va a 70 km/h
   * sostenido". Más estable que `position.speed_kmh` que es la lectura
   * instantánea (puede ser 0 en un semáforo aunque el viaje esté en
   * ritmo normal).
   */
  avg_speed_kmh_last_15min: number | null;
  /**
   * Edad de la última posición en segundos. 0 = recién llegó, 600 = 10 min.
   * El frontend muestra "actualizado hace X min" para que el consignee
   * tenga confianza calibrada en la posición. Null si no hay posición
   * (ningún ping <30min).
   */
  last_position_age_seconds: number | null;
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
  /** Señales de progreso (PR-L2). */
  progress: PublicTrackingProgress;
  /** ETA placeholder hasta PR-L2b (geocoding o Routes API on-demand). */
  eta_minutes: null;
}

export type PublicTrackingResult = PublicTrackingResponse | { status: 'not_found' };

/** Threshold de "telemetría reciente". Las posiciones más viejas no se exponen. */
const POSITION_FRESH_MINUTES = 30;
/** Ventana para calcular avg_speed_kmh_last_15min. */
const AVG_SPEED_WINDOW_MINUTES = 15;

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

  // Cargamos los pings de la ventana de avg_speed (15min) — más amplia
  // que la de fresh-position (30min) sería innecesario; necesitamos solo
  // pings de los últimos 15 min para el promedio. La última posición
  // viene del primer elemento (orderBy DESC), y avg_speed agrega TODA
  // la lista.
  //
  // POSITION_FRESH_MINUTES (30) > AVG_SPEED_WINDOW_MINUTES (15): si hay
  // un ping a 20min, lo mostramos como posición "vieja" pero NO lo
  // metemos al avg de 15min.
  const now = Date.now();
  const positionCutoff = new Date(now - POSITION_FRESH_MINUTES * 60_000);
  const pings = await db
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
        gte(telemetryPoints.timestampDevice, positionCutoff),
      ),
    )
    .orderBy(desc(telemetryPoints.timestampDevice))
    .limit(200); // cap defensivo: 200 pings cubre ~30min a 1Hz

  const latest = pings[0];
  const position: PublicTrackingPosition | null =
    latest && latest.latitude !== null && latest.longitude !== null
      ? {
          timestamp: latest.timestamp.toISOString(),
          latitude: Number(latest.latitude),
          longitude: Number(latest.longitude),
          speed_kmh: latest.speedKmh,
        }
      : null;

  const progress = computeProgress({
    pings: pings.map((p) => ({ timestamp: p.timestamp, speedKmh: p.speedKmh })),
    nowMs: now,
  });

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
    progress,
    eta_minutes: null,
  };
}

/**
 * Calcula las señales de progreso a partir del historial reciente de
 * telemetría. **Pure function** — recibe los pings ya filtrados por la
 * caller, no toca la DB.
 *
 * Reglas:
 *   - `avg_speed_kmh_last_15min` = promedio de speedKmh sobre pings con
 *     timestamp dentro de 15min. Excluye speedKmh=null. Devuelve null si
 *     hay <2 pings en la ventana O si todos los speeds son 0 (vehículo
 *     parado — exponer "0 km/h" puede ser confuso, mejor null).
 *   - `last_position_age_seconds` = (now - latest.timestamp) en segundos.
 *     Null si no hay pings.
 *
 * El cap defensivo de pings en la query (200) garantiza que esta función
 * corre en O(N) pequeño aún en viajes largos con muchos pings.
 */
export function computeProgress(opts: {
  pings: Array<{ timestamp: Date; speedKmh: number | null }>;
  nowMs: number;
}): PublicTrackingProgress {
  const { pings, nowMs } = opts;

  if (pings.length === 0) {
    return { avg_speed_kmh_last_15min: null, last_position_age_seconds: null };
  }

  const latest = pings[0]; // pings vienen orderBy DESC
  const lastPositionAgeSeconds = latest
    ? Math.max(0, Math.floor((nowMs - latest.timestamp.getTime()) / 1000))
    : null;

  const avgSpeedCutoff = nowMs - AVG_SPEED_WINDOW_MINUTES * 60_000;
  const speedsInWindow = pings
    .filter((p) => p.timestamp.getTime() >= avgSpeedCutoff && p.speedKmh !== null)
    .map((p) => p.speedKmh as number);

  let avgSpeed: number | null = null;
  if (speedsInWindow.length >= 2) {
    const sum = speedsInWindow.reduce((acc, s) => acc + s, 0);
    const avg = sum / speedsInWindow.length;
    // Si el avg es 0 (todas las lecturas en cero), devolver null —
    // ambiguo entre "vehículo detenido legítimamente" y "GPS roto".
    // El UI prefiere mostrar nada vs un "0 km/h" que confunde.
    avgSpeed = avg > 0 ? Number(avg.toFixed(1)) : null;
  }

  return {
    avg_speed_kmh_last_15min: avgSpeed,
    last_position_age_seconds: lastPositionAgeSeconds,
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
