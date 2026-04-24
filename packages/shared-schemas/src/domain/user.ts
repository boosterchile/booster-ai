import { z } from 'zod';
import { chileanPhoneSchema, rutSchema } from '../primitives/chile.js';
import { userIdSchema } from '../primitives/ids.js';

export const roleSchema = z.enum([
  'shipper',
  'carrier',
  'driver',
  'admin',
  'sustainability_stakeholder',
]);
export type Role = z.infer<typeof roleSchema>;

export const userStatusSchema = z.enum(['pending_verification', 'active', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userSchema = z.object({
  id: userIdSchema,
  email: z.string().email(),
  phone: chileanPhoneSchema.optional(),
  rut: rutSchema.optional(),
  fullName: z.string().min(1),
  roles: z.array(roleSchema).min(1),
  status: userStatusSchema,
  firebase_uid: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_login_at: z.string().datetime().optional(),
});

export type User = z.infer<typeof userSchema>;
