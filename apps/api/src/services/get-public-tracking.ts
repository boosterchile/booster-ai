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
import { haversineKm } from './calcular-cobertura-telemetria.js';

/**
 * Centroides aproximados (capital regional) para las 16 regiones de
 * Chile. Lat/lng en decimal grados. Usados solo para estimar ETA en
 * tracking público — no son precisos al destino exacto, pero dan una
 * señal direccional aceptable para la UX "cuánto falta".
 *
 * Source: Wikipedia / OpenStreetMap (capital de cada región).
 *
 * Trade-off explícito: ETA basado en haversine a centroide regional
 * tiene error ±20-30% vs Routes API real. Ventaja: cero costo
 * runtime, cero schema change, ETA disponible para el 100% de los
 * trips. Cuando el negocio justifique precisión, agregamos Routes
 * API on-demand con cache (PR-L2c).
 */
export const REGION_CENTROIDS_LAT_LNG: Record<string, { lat: number; lng: number }> = {
  XV: { lat: -18.4783, lng: -70.3126 }, // Arica
  I: { lat: -20.2208, lng: -70.1431 }, // Iquique
  II: { lat: -23.6509, lng: -70.3975 }, // Antofagasta
  III: { lat: -27.3668, lng: -70.3322 }, // Copiapó
  IV: { lat: -29.9027, lng: -71.2519 }, // La Serena
  V: { lat: -33.0472, lng: -71.6127 }, // Valparaíso
  XIII: { lat: -33.4489, lng: -70.6693 }, // Santiago (RM)
  VI: { lat: -34.1708, lng: -70.7444 }, // Rancagua
  VII: { lat: -35.4264, lng: -71.6553 }, // Talca
  XVI: { lat: -36.6063, lng: -72.1034 }, // Chillán
  VIII: { lat: -36.8201, lng: -73.0444 }, // Concepción
  IX: { lat: -38.7359, lng: -72.5904 }, // Temuco
  XIV: { lat: -39.8142, lng: -73.2459 }, // Valdivia
  X: { lat: -41.4717, lng: -72.9367 }, // Puerto Montt
  XI: { lat: -45.5712, lng: -72.0686 }, // Coyhaique
  XII: { lat: -53.1638, lng: -70.9171 }, // Punta Arenas
};

/**
 * Factor de ajuste haversine → distancia por carretera.
 * Empíricamente: la red vial chilena suele agregar ~30% sobre la
 * distancia great-circle (montaña + desviaciones). Aplicado al
 * haversine para obtener una estimación de km reales.
 */
const ROAD_DISTANCE_FACTOR = 1.3;

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
  /**
   * ETA en minutos al centroide de la región destino (PR-L2b).
   * Computado de haversine(currentPos → regionCentroid) × 1.3 / avgSpeed.
   * Null si:
   *   - Sin posición reciente
   *   - avgSpeed null o 0 (vehículo parado)
   *   - Region destino sin centroide mapeado (códigos legacy)
   *   - Trip status ya entregado / cancelado (no aplica ETA)
   */
  eta_minutes: number | null;
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
      destRegionCode: trips.destinationRegionCode,
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

  // Phase 5 PR-L2b — ETA al centroide regional. Solo cuando el trip
  // está activo (no entregado/cancelado), hay posición + avg_speed
  // confiable, y el código de región está mapeado.
  const etaMinutes = computeEtaMinutes({
    currentLat: position?.latitude ?? null,
    currentLng: position?.longitude ?? null,
    destRegionCode: row.destRegionCode,
    avgSpeedKmh: progress.avg_speed_kmh_last_15min,
    tripStatus: row.tripStatus,
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
    eta_minutes: etaMinutes,
  };
}

/**
 * Estados del trip donde el ETA NO aplica — el viaje ya cerró o no
 * empezó, exponer "X minutos" sería confuso.
 */
const NO_ETA_STATUSES = new Set(['entregado', 'cancelado', 'expirado', 'esperando_match']);

/**
 * Calcula ETA en minutos al centroide de la región destino (Phase 5 PR-L2b).
 *
 * **Pure function** — sin I/O. Recibe ya:
 *   - currentLat/currentLng: última posición conocida (null si stale)
 *   - destRegionCode: código de región (null si trip viejo sin captura)
 *   - avgSpeedKmh: promedio de últimos 15 min (null si <2 pings o avg=0)
 *   - tripStatus: para early-return en estados terminales
 *
 * Fórmula: `ROAD_DISTANCE_FACTOR × haversine(current → centroid) / avgSpeed × 60`
 *
 * Devuelve null si NO se puede estimar (cualquier input crítico null).
 * El cliente muestra "—" o "calculando" en vez de "N/A" — el campo
 * siempre presente en el response shape, valor opcional.
 *
 * **Trade-off documentado**: ETA al centroide regional ≠ ETA al destino
 * exacto. Para Santiago→Coquimbo, el centroide es La Serena (capital
 * IV), pero el destino podría ser Vicuña, Ovalle, etc. — error
 * potencial ±50-100 km. Aceptable para señal direccional ("aún ~3
 * horas") pero NO para SLA contractual de horario de entrega. PR-L2c
 * agregará Routes API on-demand cuando justifique el costo.
 */
export function computeEtaMinutes(opts: {
  currentLat: number | null;
  currentLng: number | null;
  destRegionCode: string | null;
  avgSpeedKmh: number | null;
  tripStatus: string;
}): number | null {
  const { currentLat, currentLng, destRegionCode, avgSpeedKmh, tripStatus } = opts;

  // Trip cerrado / no empezado → no ETA.
  if (NO_ETA_STATUSES.has(tripStatus)) {
    return null;
  }
  if (currentLat === null || currentLng === null) {
    return null;
  }
  if (destRegionCode === null) {
    return null;
  }
  if (avgSpeedKmh === null || avgSpeedKmh <= 0) {
    return null;
  }

  const centroid = REGION_CENTROIDS_LAT_LNG[destRegionCode];
  if (!centroid) {
    // Código no mapeado (legacy o typo). Sin centroide, no ETA.
    return null;
  }

  const haversineDistKm = haversineKm(currentLat, currentLng, centroid.lat, centroid.lng);
  const roadDistKm = haversineDistKm * ROAD_DISTANCE_FACTOR;
  const etaHours = roadDistKm / avgSpeedKmh;
  const etaMins = etaHours * 60;

  // Si el ETA computado es <1 min, redondeamos a 1 (UX: "1 min" tiene
  // sentido; "0 min" sugiere "ya llegó" que es confuso si el vehículo
  // está aún a 500m).
  return Math.max(1, Math.round(etaMins));
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
