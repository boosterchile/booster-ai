import { z } from 'zod';
import { carrierIdSchema, vehicleIdSchema } from '../primitives/ids.js';

export const vehicleTypeSchema = z.enum([
  'pickup',
  'van_small', // 1/4 camión
  'van_medium', // 3/4 camión
  'truck_small',
  'truck_medium',
  'truck_heavy',
  'semi_trailer',
  'refrigerated',
  'tanker',
]);

export const fuelTypeSchema = z.enum([
  'diesel',
  'gasoline',
  'gas_lpg',
  'gas_cng',
  'electric',
  'hybrid_diesel',
  'hybrid_gasoline',
  'hydrogen',
]);

export const vehicleSchema = z.object({
  id: vehicleIdSchema,
  carrier_id: carrierIdSchema,
  plate: z
    .string()
    .regex(/^[A-Z]{2}[-·]?[A-Z]{2}[-·]?\d{2}$|^[A-Z]{4}[-·]?\d{2}$/, 'Patente Chile inválida'),
  type: vehicleTypeSchema,
  capacity_kg: z.number().int().positive(),
  capacity_m3: z.number().positive(),
  fuel_type: fuelTypeSchema,
  year: z.number().int().min(1990).max(2100),
  brand: z.string().min(1),
  model: z.string().min(1),
  teltonika_imei: z.string().optional(),
  last_inspection_at: z.string().datetime().optional(),
  inspection_expires_at: z.string().datetime().optional(),
  status: z.enum(['active', 'maintenance', 'retired']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;
export type VehicleType = z.infer<typeof vehicleTypeSchema>;
export type FuelType = z.infer<typeof fuelTypeSchema>;
