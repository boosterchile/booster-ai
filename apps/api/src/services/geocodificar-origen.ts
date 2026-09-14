/**
 * Geocodifica el origen de un viaje recién creado y persiste lat/lng en
 * `trips.origin_latitude/origin_longitude` (Task 4, plan
 * medicion-huella-segmento). Es el ancla del geofence de recogida (Task 8) que
 * abre la ventana pickedUpAt → deliveredAt sobre la que se mide la huella.
 *
 * Diseño:
 *   - Reusa `computeRoutes` (Routes API vía ADC): el origen textual se
 *     geocodifica dentro del mismo request que ya sabe rutear origen→destino y
 *     sale como `legs[0].startLocation` — sin un servicio de geocoding aparte
 *     ni una segunda credencial. 1 llamada por viaje creado (~$0.005 USD).
 *   - Se llama DESPUÉS del INSERT del viaje y fuera de cualquier transacción:
 *     un servicio externo jamás bloquea la creación. Espera acotada por
 *     `ROUTES_API_TIMEOUT_MS` (10 s) del cliente.
 *   - Degradación explícita, nunca silenciosa: cualquier fallo (sin project
 *     id, Routes API caída/timeout/cuota, ruta vacía, sin startLocation,
 *     coordenadas inválidas, error inesperado) devuelve `null`, deja las
 *     columnas en NULL (nunca 0/0), loguea con `tripId` + motivo y emite la
 *     métrica data-quality `viaje_origen_geocodificacion_total{resultado,motivo}`.
 *     Esta función NO lanza: el caller no necesita try/catch para proteger la
 *     creación (igual lo tiene, defensa en profundidad).
 *   - Validez de coordenadas: `esCoordenadaGpsValida` (finitas y fuera del
 *     null island 0,0) + rango WGS84. Routes API devolviendo basura no se
 *     persiste como si fuera un origen real.
 *   - Span OTel `trip.geocodificar_origen` con atributos NO sensibles
 *     (trip_id, persistido, motivo). Las direcciones son PII: van solo al log
 *     estructurado cuando aportan diagnóstico, nunca al span.
 *
 * Supuestos:
 *   - `routesProjectId` ausente = entorno sin GCP (dev/test): se degrada con
 *     motivo `sin_project_id` en vez de fallar el arranque.
 *   - El UPDATE es idempotente: reintentar sobre el mismo viaje reescribe el
 *     mismo valor mientras `origen_direccion_raw` no cambie.
 */

import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { trips } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { esCoordenadaGpsValida } from './coordenada-gps.js';
import { RoutesApiError, computeRoutes } from './routes-api.js';

/** Escala de `numeric(10,7)` de las columnas destino. */
const LATLNG_DECIMALS = 7;

const geocodificacionCounter = getBusinessCounter('viaje_origen_geocodificacion_total');

export interface OrigenLatLng {
  lat: number;
  lng: number;
}

/**
 * Motivos de degradación. Los `RoutesApiError['code']` se propagan tal cual
 * (`timeout`, `quota_exceeded`, `auth_error`, `network_error`,
 * `invalid_request`, `unknown`) para que la métrica distinga cuota de caída.
 */
export type MotivoDegradacionGeocodificacion =
  | 'sin_project_id'
  | 'ruta_vacia'
  | 'sin_start_location'
  | 'coordenadas_invalidas'
  | 'error_inesperado'
  | RoutesApiError['code'];

export interface GeocodificarOrigenOptions {
  db: Db;
  logger: Logger;
  tripId: string;
  originAddress: string;
  destinationAddress: string;
  /** GCP project para X-Goog-User-Project (ADR-038). Ausente → degrada. */
  routesProjectId?: string | undefined;
}

/**
 * Devuelve `{ lat, lng }` si geocodificó Y persistió; `null` en cualquier
 * degradación. Nunca lanza.
 */
export async function geocodificarOrigen(
  opts: GeocodificarOrigenOptions,
): Promise<OrigenLatLng | null> {
  return await withBusinessSpan(
    { name: 'trip.geocodificar_origen', attributes: { 'booster.trip_id': opts.tripId } },
    async (span) => {
      const outcome = await geocodificarOrigenInner(opts);
      setResultAttributes(span, {
        'booster.geocode.persistido': outcome.ok,
        'booster.geocode.motivo': outcome.ok ? undefined : outcome.motivo,
      });
      if (outcome.ok) {
        geocodificacionCounter.add(1, { resultado: 'ok' });
        return outcome.origen;
      }
      geocodificacionCounter.add(1, { resultado: 'degradado', motivo: outcome.motivo });
      return null;
    },
  );
}

type Outcome =
  | { ok: true; origen: OrigenLatLng }
  | { ok: false; motivo: MotivoDegradacionGeocodificacion };

async function geocodificarOrigenInner(opts: GeocodificarOrigenOptions): Promise<Outcome> {
  const { db, logger, tripId, originAddress, destinationAddress, routesProjectId } = opts;

  if (!routesProjectId) {
    logger.info(
      { tripId, motivo: 'sin_project_id' },
      'geocodificarOrigen: omitido (sin GCP project)',
    );
    return { ok: false, motivo: 'sin_project_id' };
  }

  try {
    const routes = await computeRoutes({
      projectId: routesProjectId,
      origin: originAddress,
      destination: destinationAddress,
      computeAlternatives: false,
      logger,
    });

    const top = routes[0];
    if (!top) {
      logger.warn(
        { tripId, originAddress, destinationAddress },
        'geocodificarOrigen: Routes API sin rutas',
      );
      return { ok: false, motivo: 'ruta_vacia' };
    }
    if (!top.startLocation) {
      logger.warn({ tripId, originAddress }, 'geocodificarOrigen: ruta sin startLocation');
      return { ok: false, motivo: 'sin_start_location' };
    }

    const { lat, lng } = top.startLocation;
    if (!esCoordenadaGpsValida(lat, lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      logger.warn(
        { tripId, lat, lng },
        'geocodificarOrigen: coordenadas inválidas, no se persisten',
      );
      return { ok: false, motivo: 'coordenadas_invalidas' };
    }

    // rls-allowlist: scoped por tripId recién insertado por el generador autenticado en POST /trip-requests-v2
    await db
      .update(trips)
      .set({
        originLatitude: lat.toFixed(LATLNG_DECIMALS),
        originLongitude: lng.toFixed(LATLNG_DECIMALS),
        updatedAt: new Date(),
      })
      .where(eq(trips.id, tripId));

    logger.info({ tripId, lat, lng }, 'geocodificarOrigen: origen persistido');
    return { ok: true, origen: { lat, lng } };
  } catch (err) {
    if (err instanceof RoutesApiError) {
      logger.warn(
        { tripId, code: err.code, httpStatus: err.httpStatus },
        'geocodificarOrigen: Routes API error, origen queda sin geocodificar',
      );
      return { ok: false, motivo: err.code };
    }
    logger.error(
      { err, tripId },
      'geocodificarOrigen: error inesperado, origen queda sin geocodificar',
    );
    return { ok: false, motivo: 'error_inesperado' };
  }
}
