import type { Logger } from '@booster-ai/logger';
import type { CambioPropuesto } from '@booster-ai/shared-schemas';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { trips } from '../db/schema.js';
import { esCoordenadaGpsValida } from './coordenada-gps.js';
import { type RouteLatLng, computeRoutes } from './routes-api.js';

/**
 * Coordenadas del origen y el destino propuestos, ANTES de la transacción de
 * la solicitud (editar-anular-cargas §6.3): la propuesta guarda el punto que el
 * transportista acepta, y no se llama a Routes bajo lock.
 *
 *   - Lo que trae el cliente (pin o sugerencia) se respeta.
 *   - La misma dirección que la actual, sin coordenadas, hereda las actuales:
 *     no cuenta como cambio ni borra el punto del viaje.
 *   - Una dirección nueva sin coordenadas se geocodifica con una sola llamada
 *     a Routes (origen → destino, con el otro extremo actual si no cambia).
 *   - Si Routes falla o no hay proyecto, la propuesta sigue sin coordenadas y
 *     al aceptarla el viaje queda sin punto en ese extremo, igual que una
 *     carga creada sin geocodificar.
 */

type Lugar = NonNullable<CambioPropuesto['origin']>;

interface ExtremoActual {
  address: string;
  region: string | null;
  comuna: string | null;
  lat: string | null;
  lng: string | null;
}

function tieneCoordenadas(l: Lugar): boolean {
  return l.latitude !== undefined && l.longitude !== undefined;
}

function mismaDireccion(l: Lugar, actual: ExtremoActual): boolean {
  return (
    l.address_raw === actual.address &&
    l.region_code === actual.region &&
    (l.comuna_code ?? null) === actual.comuna
  );
}

function heredar(l: Lugar, actual: ExtremoActual): Lugar {
  if (tieneCoordenadas(l) || !mismaDireccion(l, actual) || !actual.lat || !actual.lng) {
    return l;
  }
  return { ...l, latitude: Number(actual.lat), longitude: Number(actual.lng) };
}

function conPunto(l: Lugar, punto: RouteLatLng | null): Lugar {
  if (!punto || !esCoordenadaGpsValida(punto.lat, punto.lng)) {
    return l;
  }
  return {
    ...l,
    latitude: Number(punto.lat.toFixed(7)),
    longitude: Number(punto.lng.toFixed(7)),
  };
}

export async function completarCoordenadasPropuesta(
  deps: { db: Db; logger: Logger; routesProjectId?: string | undefined },
  opts: { tripId: string; empresaId: string; cambios: CambioPropuesto },
): Promise<CambioPropuesto> {
  const { db, logger, routesProjectId } = deps;
  const { tripId, empresaId, cambios } = opts;
  if (!cambios.origin && !cambios.destination) {
    return cambios;
  }
  const [viaje] = await db
    .select({
      originAddressRaw: trips.originAddressRaw,
      originRegionCode: trips.originRegionCode,
      originComunaCode: trips.originComunaCode,
      originLatitude: trips.originLatitude,
      originLongitude: trips.originLongitude,
      destinationAddressRaw: trips.destinationAddressRaw,
      destinationRegionCode: trips.destinationRegionCode,
      destinationComunaCode: trips.destinationComunaCode,
      destinationLatitude: trips.destinationLatitude,
      destinationLongitude: trips.destinationLongitude,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
    .limit(1);
  if (!viaje) {
    // El servicio de la solicitud responde trip_not_found.
    return cambios;
  }
  const origenActual: ExtremoActual = {
    address: viaje.originAddressRaw,
    region: viaje.originRegionCode,
    comuna: viaje.originComunaCode,
    lat: viaje.originLatitude,
    lng: viaje.originLongitude,
  };
  const destinoActual: ExtremoActual = {
    address: viaje.destinationAddressRaw,
    region: viaje.destinationRegionCode,
    comuna: viaje.destinationComunaCode,
    lat: viaje.destinationLatitude,
    lng: viaje.destinationLongitude,
  };

  let origin = cambios.origin ? heredar(cambios.origin, origenActual) : undefined;
  let destination = cambios.destination ? heredar(cambios.destination, destinoActual) : undefined;

  const faltaOrigen = origin !== undefined && !tieneCoordenadas(origin);
  const faltaDestino = destination !== undefined && !tieneCoordenadas(destination);
  if ((faltaOrigen || faltaDestino) && routesProjectId) {
    try {
      const [ruta] = await computeRoutes({
        projectId: routesProjectId,
        origin: origin?.address_raw ?? origenActual.address,
        destination: destination?.address_raw ?? destinoActual.address,
        computeAlternatives: false,
        logger,
      });
      if (origin && faltaOrigen) {
        origin = conPunto(origin, ruta?.startLocation ?? null);
      }
      if (destination && faltaDestino) {
        destination = conPunto(destination, ruta?.endLocation ?? null);
      }
    } catch (err) {
      logger.warn(
        { err, tripId },
        'geocodificar la propuesta de cambio falló; queda sin coordenadas',
      );
    }
  }

  return {
    ...cambios,
    ...(origin ? { origin } : {}),
    ...(destination ? { destination } : {}),
  };
}
