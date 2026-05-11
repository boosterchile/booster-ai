import {
  type ResultadoEmisiones,
  type TipoCombustible,
  calcularEmisionesViaje,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { offers, trips, vehicles } from '../db/schema.js';
import { estimarDistanciaKm } from './estimar-distancia.js';
import { type RouteSuggestion, type VehicleEmissionType, computeRoutes } from './routes-api.js';

/**
 * Eco-route preview (Phase 1 PR-H3) — computa la huella de carbono
 * estimada de una oferta ANTES de que el transportista la acepte.
 *
 * Diseño:
 *   - Endpoint on-demand. NO persiste nada (no toca metricas_viaje, que
 *     es exclusivo del flujo post-accept).
 *   - Dos paths:
 *     a) Si hay GOOGLE_ROUTES_API_KEY + vehicle.fuelType → Routes API
 *        con FUEL_CONSUMPTION → datos más precisos para mostrar al
 *        carrier.
 *     b) Fallback: estimarDistanciaKm + calcularEmisionesViaje en modo
 *        modelado/por_defecto.
 *   - Idempotente: misma input → misma output (modulo cambios de
 *     tráfico en Routes API).
 *
 * Uso desde la UI: cuando el carrier abre el detalle de una oferta
 * pendiente, el front llama a este endpoint para mostrar:
 *   - "Si aceptas, generarás ~X kg CO2e en este viaje"
 *   - Distancia y duración estimadas
 *   - Diferencial vs flota promedio (cuando agreguemos la comparación
 *     en una iteración futura)
 */

export type DataSourcePreview = 'routes_api' | 'tabla_chile';

export interface EcoRoutePreview {
  tripId: string;
  suggestedVehicleId: string | null;
  distanceKm: number;
  durationS: number | null;
  fuelLitersEstimated: number | null;
  emisionesKgco2eWtw: number;
  emisionesKgco2eTtw: number;
  emisionesKgco2eWtt: number;
  intensidadGco2ePorTonKm: number;
  precisionMethod: ResultadoEmisiones['metodoPrecision'];
  dataSource: DataSourcePreview;
  /**
   * Phase 1 PR-H4 — polyline encoded (Google's Encoded Polyline Algorithm
   * Format) de la ruta sugerida por Routes API. Permite al cliente
   * mostrar visualmente al carrier la ruta exacta sobre la que se calculó
   * el preview de emisiones — cierra el loop "AI sugiere la mejor ruta
   * para reducir huella" haciendo que la ruta sea inspeccionable, no
   * solo un número.
   *
   * `null` cuando `dataSource === 'tabla_chile'` (no hubo llamada a
   * Routes API). Cuando `dataSource === 'routes_api'`, normalmente
   * presente; puede ser string vacío si la API no devolvió polyline
   * (caso raro pero defensivo).
   */
  polylineEncoded: string | null;
  glecVersion: string;
  generatedAt: Date;
}

export class OfferNotFoundForPreviewError extends Error {
  constructor(public readonly offerId: string) {
    super(`Offer ${offerId} not found`);
    this.name = 'OfferNotFoundForPreviewError';
  }
}

export class OfferForbiddenForPreviewError extends Error {
  constructor(
    public readonly offerId: string,
    public readonly empresaId: string,
  ) {
    super(`Offer ${offerId} does not belong to empresa ${empresaId}`);
    this.name = 'OfferForbiddenForPreviewError';
  }
}

/**
 * Mapeo TipoCombustible → VehicleEmissionType (espejo del que vive en
 * calcular-metricas-viaje.ts; duplicado a propósito porque ambos
 * servicios deben funcionar independientes y un helper compartido
 * agregaría dependency cycle entre dos services del mismo nivel).
 */
function mapFuelToEmissionType(combustible: string): VehicleEmissionType | undefined {
  switch (combustible) {
    case 'diesel':
      return 'DIESEL';
    case 'gasolina':
    case 'gas_glp':
    case 'gas_gnc':
      return 'GASOLINE';
    case 'electrico':
    case 'hidrogeno':
      return 'ELECTRIC';
    case 'hibrido_diesel':
    case 'hibrido_gasolina':
      return 'HYBRID';
    default:
      return undefined;
  }
}

/**
 * Genera el preview de huella de carbono de una oferta.
 *
 * Retorna el preview o throwea si la oferta no existe o no pertenece
 * al carrier. El caller (route handler) mapea a HTTP status apropiado.
 *
 * Si Routes API falla, cae al fallback transparente — siempre retorna
 * un preview válido con dataSource explícito para que la UI sepa qué
 * está mostrando.
 */
export async function generarEcoPreview(opts: {
  db: Db;
  logger: Logger;
  offerId: string;
  /** Empresa del carrier que está pidiendo el preview (validación de ownership). */
  empresaId: string;
  routesApiKey?: string | undefined;
}): Promise<EcoRoutePreview> {
  const { db, logger, offerId, empresaId, routesApiKey } = opts;

  // (1) Cargar offer + trip + vehicle en una sola query con joins.
  const rows = await db
    .select({
      offer: offers,
      trip: trips,
      vehicle: vehicles,
    })
    .from(offers)
    .innerJoin(trips, eq(offers.tripId, trips.id))
    .leftJoin(vehicles, eq(offers.suggestedVehicleId, vehicles.id))
    .where(eq(offers.id, offerId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new OfferNotFoundForPreviewError(offerId);
  }
  if (row.offer.empresaId !== empresaId) {
    throw new OfferForbiddenForPreviewError(offerId, empresaId);
  }

  const { trip, vehicle: veh } = row;
  const cargaKg = trip.cargoWeightKg ?? 0;

  // (2) Resolver distancia + (opcional) fuel via Routes API.
  let distanceKm = 0;
  let durationS: number | null = null;
  let fuelLitersEstimated: number | null = null;
  let dataSource: DataSourcePreview = 'tabla_chile';
  let polylineEncoded: string | null = null;

  if (routesApiKey) {
    try {
      const emissionType = veh?.fuelType ? mapFuelToEmissionType(veh.fuelType) : undefined;
      const routes = await computeRoutes({
        apiKey: routesApiKey,
        origin: trip.originAddressRaw,
        destination: trip.destinationAddressRaw,
        emissionType,
      });
      const best: RouteSuggestion | undefined = routes[0];
      if (best && best.distanceKm > 0) {
        distanceKm = best.distanceKm;
        durationS = best.durationS;
        fuelLitersEstimated = best.fuelL;
        dataSource = 'routes_api';
        // PR-H4: capturar la polyline para que el cliente la muestre.
        // String vacío si Routes API no la devolvió (defensivo — no
        // queremos crashear render por un edge case).
        polylineEncoded = best.polylineEncoded || null;
      }
    } catch (err) {
      logger.warn(
        { err, offerId, origenDireccion: trip.originAddressRaw },
        'Routes API falló en eco-preview, fallback a estimarDistanciaKm',
      );
    }
  }

  if (distanceKm === 0) {
    distanceKm = estimarDistanciaKm(trip.originRegionCode, trip.destinationRegionCode);
  }

  // (3) Compute emisiones via carbon-calculator (puro, GLEC v3.0).
  let emisiones: ResultadoEmisiones;
  if (veh) {
    const consumoBase = veh.consumptionLPer100kmBaseline
      ? Number(veh.consumptionLPer100kmBaseline)
      : null;

    if (veh.fuelType && consumoBase != null) {
      emisiones = calcularEmisionesViaje({
        metodo: 'modelado',
        distanciaKm: distanceKm,
        cargaKg,
        vehiculo: {
          combustible: veh.fuelType as TipoCombustible,
          consumoBasePor100km: consumoBase,
          pesoVacioKg: veh.curbWeightKg,
          capacidadKg: veh.capacityKg,
        },
      });
    } else {
      emisiones = calcularEmisionesViaje({
        metodo: 'por_defecto',
        distanciaKm: distanceKm,
        cargaKg,
        tipoVehiculo: veh.vehicleType,
      });
    }
  } else {
    emisiones = calcularEmisionesViaje({
      metodo: 'por_defecto',
      distanciaKm: distanceKm,
      cargaKg,
      tipoVehiculo: 'camion_mediano',
    });
  }

  return {
    tripId: trip.id,
    suggestedVehicleId: row.offer.suggestedVehicleId ?? null,
    distanceKm,
    durationS,
    fuelLitersEstimated,
    emisionesKgco2eWtw: emisiones.emisionesKgco2eWtw,
    emisionesKgco2eTtw: emisiones.emisionesKgco2eTtw,
    emisionesKgco2eWtt: emisiones.emisionesKgco2eWtt,
    intensidadGco2ePorTonKm: emisiones.intensidadGco2ePorTonKm,
    precisionMethod: emisiones.metodoPrecision,
    dataSource,
    polylineEncoded,
    glecVersion: emisiones.versionGlec,
    generatedAt: new Date(),
  };
}
