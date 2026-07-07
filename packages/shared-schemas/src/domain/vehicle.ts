import { z } from 'zod';
import { chileanPlateSchema } from '../primitives/chile.js';
import { transportistaIdSchema, vehicleIdSchema } from '../primitives/ids.js';

export const vehicleTypeSchema = z.enum([
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
  'refrigerado',
  'tanque',
]);

export const fuelTypeSchema = z.enum([
  'diesel',
  'gasolina',
  'gas_glp',
  'gas_gnc',
  'electrico',
  'hibrido_diesel',
  'hibrido_gasolina',
  'hidrogeno',
]);

export const vehicleStatusSchema = z.enum(['activo', 'mantenimiento', 'retirado']);

/**
 * IMEI Teltonika: exactamente 15 dígitos (estándar GSM IMEI, incl. Luhn a
 * nivel de fabricante pero no validado acá — el gateway ya solo autoriza
 * IMEIs reales que efectivamente conectan). Usado en el PATCH de
 * auto-asociación de dispositivo (W2 self-service, hito 2 CORFO) para que
 * cliente (web) y servidor (apps/api) compartan la misma regla de
 * formato — antes solo vivía como comentario/regex ad-hoc en el backend.
 */
export const teltonikaImeiSchema = z
  .string()
  .regex(/^\d{15}$/, 'IMEI debe tener exactamente 15 dígitos');

export const vehicleSchema = z.object({
  id: vehicleIdSchema,
  transportista_id: transportistaIdSchema,
  plate: chileanPlateSchema,
  type: vehicleTypeSchema,
  capacity_kg: z.number().int().positive(),
  capacity_m3: z.number().positive(),
  fuel_type: fuelTypeSchema,
  year: z.number().int().min(1990).max(2100),
  brand: z.string().min(1),
  model: z.string().min(1),
  /**
   * Peso en vacío (curb weight) del vehículo en kg. Insumo del
   * carbon-calculator para estimar consumo bajo carga vs base.
   */
  curb_weight_kg: z.number().int().positive(),
  /**
   * Consumo base en litros cada 100 km a carga normal. Base para los
   * cálculos GLEC v3.0 cuando no hay telemetría real (CANbus). Null si
   * el carrier todavía no lo declaró.
   */
  consumption_l_per_100km_baseline: z.number().positive().nullable(),
  teltonika_imei: z.string().optional(),
  last_inspection_at: z.string().datetime().optional(),
  inspection_expires_at: z.string().datetime().optional(),
  status: vehicleStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Vehicle = z.infer<typeof vehicleSchema>;
export type VehicleType = z.infer<typeof vehicleTypeSchema>;
export type FuelType = z.infer<typeof fuelTypeSchema>;
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>;
