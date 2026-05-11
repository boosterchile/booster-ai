import { z } from 'zod';
import { driverIdSchema, transportistaIdSchema, userIdSchema } from '../primitives/ids.js';

/**
 * Clases de licencia chilena (DS Nº 170 Ley Tránsito).
 *
 * - A1-A5: profesionales (taxi, transporte público, camiones). A5 es la
 *   única que habilita camión articulado >3500 kg + remolque.
 * - B: particulares hasta 9 pasajeros / 3500 kg.
 * - C: motocicletas.
 * - D: maquinaria automotriz no agrícola.
 * - E: tracción animal (rural histórico).
 * - F: vehículos institucionales (carabineros, FFAA).
 */
export const licenseClassSchema = z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E', 'F']);
export type LicenseClass = z.infer<typeof licenseClassSchema>;

export const driverStatusSchema = z.enum(['activo', 'suspendido', 'en_viaje', 'fuera_servicio']);
export type DriverStatus = z.infer<typeof driverStatusSchema>;

/**
 * Schema del row `conductores` tal como lo devuelve el API.
 *
 * Notas:
 * - El RUT y el nombre completo viven en `users` (que es la identidad
 *   Firebase). Acá solo está el `user_id`. Los endpoints típicamente hacen
 *   join y exponen `user` anidado en la respuesta de lectura.
 * - Sin `vehiculo_principal_id`: la asignación conductor↔vehículo vive en
 *   `asignaciones` (ver memoria project_identity_model_decisions.md).
 */
export const driverSchema = z.object({
  id: driverIdSchema,
  user_id: userIdSchema,
  empresa_id: transportistaIdSchema,
  license_class: licenseClassSchema,
  license_number: z.string().min(1).max(50),
  /** Fecha (sin hora) de vencimiento. ISO `YYYY-MM-DD`. */
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'license_expiry debe ser ISO YYYY-MM-DD'),
  /**
   * `true` si el conductor no es chileno residente. Algunos puertos y
   * plantas industriales bloquean conductores extranjeros — la validación
   * ocurre al crear la asignación, no en este schema.
   */
  is_extranjero: z.boolean().default(false),
  status: driverStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** ISO datetime si soft-deleted, null si activo. */
  deleted_at: z.string().datetime().nullable(),
});

export type Driver = z.infer<typeof driverSchema>;

/**
 * Body para crear un conductor desde la interfaz transportista. El RUT del
 * conductor se recibe acá (no en `users`) porque la creación primero hace
 * `lookup` y si el user existe, lo enlaza; si no, crea user + envía invite.
 */
export const createDriverBodySchema = z.object({
  rut: z.string().min(1),
  full_name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  license_class: licenseClassSchema,
  license_number: z.string().min(1).max(50),
  license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_extranjero: z.boolean().default(false),
});

export type CreateDriverBody = z.infer<typeof createDriverBodySchema>;

export const updateDriverBodySchema = z.object({
  license_class: licenseClassSchema.optional(),
  license_number: z.string().min(1).max(50).optional(),
  license_expiry: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  is_extranjero: z.boolean().optional(),
  status: driverStatusSchema.optional(),
});

export type UpdateDriverBody = z.infer<typeof updateDriverBodySchema>;
