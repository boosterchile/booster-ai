import { z } from 'zod';
import {
  cargoRequestIdSchema,
  driverIdSchema,
  generadorCargaIdSchema,
  transportistaIdSchema,
  tripIdSchema,
  vehicleIdSchema,
} from '../primitives/ids.js';

/**
 * Estados del Trip lifecycle. Ver ADR-004 "Trip lifecycle como máquina de
 * estados". Las métricas ESG (huella, distancia, combustible) NO viven
 * acá — viven en `trip-metrics.ts` (1:1 con trip).
 */
export const tripStateSchema = z.enum([
  'requested',
  'offered_to_carrier',
  'accepted',
  'driver_assigned',
  'driver_en_route',
  'pickup_completed',
  'in_transit',
  'delivered',
  'confirmed_by_shipper',
  'completed_rated',
  // Excepciones
  'carrier_rejected',
  'carrier_timed_out',
  'driver_rejected',
  'cancelled_by_shipper',
  'cancelled_by_carrier',
  'failed',
  'disputed',
]);

export type TripState = z.infer<typeof tripStateSchema>;

export const tripSchema = z.object({
  id: tripIdSchema,
  cargo_request_id: cargoRequestIdSchema,
  generador_carga_id: generadorCargaIdSchema,
  transportista_id: transportistaIdSchema.nullable(),
  driver_id: driverIdSchema.nullable(),
  vehicle_id: vehicleIdSchema.nullable(),
  state: tripStateSchema,
  price_clp: z.number().int().positive().nullable(),
  // Timestamps de cada transición
  requested_at: z.string().datetime(),
  offered_at: z.string().datetime().nullable(),
  accepted_at: z.string().datetime().nullable(),
  driver_assigned_at: z.string().datetime().nullable(),
  pickup_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  confirmed_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  // Ratings
  shipper_rating_for_carrier: z.number().int().min(1).max(5).nullable(),
  carrier_rating_for_shipper: z.number().int().min(1).max(5).nullable(),
  driver_rating_for_shipper: z.number().int().min(1).max(5).nullable(),
  shipper_rating_for_driver: z.number().int().min(1).max(5).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Trip = z.infer<typeof tripSchema>;
