import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { addressSchema } from '../primitives/geo.js';
import { carrierIdSchema, userIdSchema } from '../primitives/ids.js';

export const carrierStatusSchema = z.enum(['pending_verification', 'active', 'suspended']);

export const carrierSchema = z.object({
  id: carrierIdSchema,
  owner_user_id: userIdSchema,
  legal_name: z.string().min(1),
  rut: rutSchema,
  address: addressSchema,
  phone: z.string().min(1),
  status: carrierStatusSchema,
  rating: z.number().min(0).max(5).default(0),
  ratings_count: z.number().int().nonnegative().default(0),
  /** Carrier unipersonal: owner es también driver */
  is_solo_operator: z.boolean().default(false),
  dte_provider_account_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Carrier = z.infer<typeof carrierSchema>;
