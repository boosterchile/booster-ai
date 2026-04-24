import { z } from 'zod';
import { positionSchema } from '../primitives/geo.js';
import { tripIdSchema, vehicleIdSchema } from '../primitives/ids.js';

export const telemetrySourceSchema = z.enum(['teltonika', 'pwa']);

/**
 * Evento canónico de telemetría. Ver ADR-005.
 * Producido por: telemetry-tcp-gateway (Teltonika) o apps/api (PWA).
 * Consumido por: telemetry-processor.
 */
export const telemetryEventSchema = z.object({
  event_id: z.string().uuid(),
  source: telemetrySourceSchema,
  source_device_id: z.string().min(1),
  vehicle_id: vehicleIdSchema,
  trip_id: tripIdSchema.optional(),
  timestamp_device: z.string().datetime(),
  timestamp_ingested: z.string().datetime(),
  position: positionSchema,
  sensors: z
    .object({
      fuel_level_pct: z.number().min(0).max(100).optional(),
      rpm: z.number().int().nonnegative().optional(),
      engine_temp_c: z.number().optional(),
      odometer_km: z.number().nonnegative().optional(),
      ignition: z.boolean().optional(),
    })
    .optional(),
  battery: z
    .object({
      voltage_v: z.number().nonnegative().optional(),
      external_power: z.boolean().optional(),
    })
    .optional(),
  is_anomalous: z.boolean().default(false),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
