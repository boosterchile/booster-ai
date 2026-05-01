import { z } from 'zod';
import { chileanPhoneSchema, rutSchema } from '../primitives/chile.js';
import { userIdSchema } from '../primitives/ids.js';

/**
 * Roles de plataforma a alto nivel. Independiente del role dentro de una
 * empresa (ver `membershipRoleSchema`). Un mismo user puede tener
 * múltiples roles a este nivel — ej. un usuario que es shipper en una
 * empresa y stakeholder ESG en otra.
 */
export const roleSchema = z.enum([
  'generador_carga',
  'transportista',
  'conductor',
  'admin',
  'stakeholder_sostenibilidad',
]);
export type Role = z.infer<typeof roleSchema>;

export const userStatusSchema = z.enum([
  'pendiente_verificacion',
  'activo',
  'suspendido',
  'eliminado',
]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userSchema = z.object({
  id: userIdSchema,
  email: z.string().email(),
  phone: chileanPhoneSchema.optional(),
  whatsapp_e164: chileanPhoneSchema.optional(),
  rut: rutSchema.optional(),
  fullName: z.string().min(1),
  roles: z.array(roleSchema).min(1),
  status: userStatusSchema,
  firebase_uid: z.string().min(1),
  is_platform_admin: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_login_at: z.string().datetime().optional(),
});

export type User = z.infer<typeof userSchema>;
