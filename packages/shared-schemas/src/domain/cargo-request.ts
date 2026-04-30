import { z } from 'zod';
import { addressSchema } from '../primitives/geo.js';
import { cargoRequestIdSchema, shipperIdSchema } from '../primitives/ids.js';
import { vehicleTypeSchema } from './vehicle.js';

export const cargoTypeSchema = z.enum([
  'dry_goods',
  'perishable',
  'refrigerated',
  'frozen',
  'fragile',
  'dangerous',
  'liquid',
  'construction',
  'agricultural',
  'livestock',
  'other',
]);
export type CargoType = z.infer<typeof cargoTypeSchema>;

export const cargoRequestStatusSchema = z.enum([
  'draft',
  'open',
  'matching',
  'matched',
  'cancelled',
  'expired',
]);

export const cargoRequestSchema = z.object({
  id: cargoRequestIdSchema,
  shipper_id: shipperIdSchema,
  origin: addressSchema,
  destination: addressSchema,
  cargo_type: cargoTypeSchema,
  cargo_description: z.string().min(1),
  weight_kg: z.number().positive(),
  volume_m3: z.number().positive().optional(),
  required_vehicle_type: vehicleTypeSchema,
  pickup_earliest_at: z.string().datetime(),
  pickup_latest_at: z.string().datetime(),
  deliver_by_at: z.string().datetime(),
  budget_clp: z.number().int().positive().optional(),
  special_instructions: z.string().optional(),
  status: cargoRequestStatusSchema,
  origin_channel: z.enum(['web', 'whatsapp', 'api']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CargoRequest = z.infer<typeof cargoRequestSchema>;
