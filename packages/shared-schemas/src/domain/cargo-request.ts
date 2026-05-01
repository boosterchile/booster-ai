import { z } from 'zod';
import { addressSchema } from '../primitives/geo.js';
import { cargoRequestIdSchema, generadorCargaIdSchema } from '../primitives/ids.js';
import { vehicleTypeSchema } from './vehicle.js';

/**
 * Tipos de carga (canónico). Valores en español snake_case sin tildes para
 * coincidir 1:1 con el enum SQL `tipo_carga`.
 */
export const cargoTypeSchema = z.enum([
  'carga_seca',
  'perecible',
  'refrigerada',
  'congelada',
  'fragil',
  'peligrosa',
  'liquida',
  'construccion',
  'agricola',
  'ganado',
  'otra',
]);
export type CargoType = z.infer<typeof cargoTypeSchema>;

export const cargoRequestStatusSchema = z.enum([
  'borrador',
  'abierta',
  'emparejando',
  'emparejada',
  'cancelada',
  'expirada',
]);
export type CargoRequestStatus = z.infer<typeof cargoRequestStatusSchema>;

export const cargoRequestSchema = z.object({
  id: cargoRequestIdSchema,
  generador_carga_id: generadorCargaIdSchema,
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
