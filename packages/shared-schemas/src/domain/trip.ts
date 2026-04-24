import { z } from 'zod';
import {
  cargoRequestIdSchema,
  carrierIdSchema,
  driverIdSchema,
  shipperIdSchema,
  tripIdSchema,
  vehicleIdSchema,
} from '../primitives/ids.js';

/**
 * Estados del Trip lifecycle. Ver ADR-004 "Trip lifecycle como máquina de estados".
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
  shipper_id: shipperIdSchema,
  carrier_id: carrierIdSchema.nullable(),
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
  // Métricas ESG
  carbon_emissions_kgco2e: z.number().nonnegative().nullable(),
  distance_km: z.number().nonnegative().nullable(),
  fuel_consumed_l: z.number().nonnegative().nullable(),
  precision_method: z.enum(['EXACT_CANBUS', 'MODELED', 'DEFAULT']).nullable(),
  // Ratings
  shipper_rating_for_carrier: z.number().int().min(1).max(5).nullable(),
  carrier_rating_for_shipper: z.number().int().min(1).max(5).nullable(),
  driver_rating_for_shipper: z.number().int().min(1).max(5).nullable(),
  shipper_rating_for_driver: z.number().int().min(1).max(5).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Trip = z.infer<typeof tripSchema>;
