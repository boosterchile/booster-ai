import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { driverIdSchema, transportistaIdSchema, userIdSchema } from '../primitives/ids.js';

export const licenseClassSchema = z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E', 'F']);

export const driverStatusSchema = z.enum(['activo', 'suspendido', 'en_viaje', 'fuera_servicio']);
export type DriverStatus = z.infer<typeof driverStatusSchema>;

export const driverSchema = z.object({
  id: driverIdSchema,
  user_id: userIdSchema,
  transportista_id: transportistaIdSchema,
  rut: rutSchema,
  full_name: z.string().min(1),
  license_class: licenseClassSchema,
  license_number: z.string().min(1),
  license_expiry: z.string().datetime(),
  rating: z.number().min(0).max(5).default(0),
  ratings_count: z.number().int().nonnegative().default(0),
  status: driverStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Driver = z.infer<typeof driverSchema>;
