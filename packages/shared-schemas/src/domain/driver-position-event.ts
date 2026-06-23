import { z } from 'zod';
import { latitudeSchema, longitudeSchema } from '../primitives/geo.js';
import { uuidSchema } from '../primitives/ids.js';

/**
 * DriverPositionEvent = payload canónico del topic Pub/Sub `driver-positions`.
 *
 * Productores: apps/api (endpoint POST /driver-position, Task 4).
 * Consumidores: eco-routing-service (Task 5), y potencialmente telemetry-processor.
 *
 * Extiende los primitivos geo (latitudeSchema/longitudeSchema de WGS84)
 * con los IDs de negocio (viajeId, vehiculoId) y el timestamp de registro.
 *
 * lat ∈ [-90, 90]; lng ∈ [-180, 180].
 *
 * Naming bilingüe (ver CLAUDE.md): los campos son camelCase en TS;
 * los atributos Pub/Sub se convierten a snake_case en el publisher.
 */
export const driverPositionEventSchema = z.object({
  /** UUID del viaje activo al que pertenece esta posición. */
  viajeId: uuidSchema,
  /** UUID del vehículo que reporta la posición. */
  vehiculoId: uuidSchema,
  /** Latitud WGS84 — rango válido: [-90, 90]. */
  lat: latitudeSchema,
  /** Longitud WGS84 — rango válido: [-180, 180]. */
  lng: longitudeSchema,
  /** Timestamp ISO 8601 del momento en que se registró la posición. */
  registradoEn: z.string().datetime(),
});

export type DriverPositionEvent = z.infer<typeof driverPositionEventSchema>;
