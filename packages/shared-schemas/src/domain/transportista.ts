import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { addressSchema } from '../primitives/geo.js';
import { transportistaIdSchema, userIdSchema } from '../primitives/ids.js';

/**
 * Transportista (antes Carrier) — empresa cuyo modelo de negocio es mover
 * carga en vehículos propios o subcontratados.
 *
 * Schema canónico precede al modelo multi-tenant (empresa-centric); en el
 * repo actual el modelo operacional vive en `empresa.ts` con flag
 * `es_transportista`. `transportista.ts` se mantiene para compat con el
 * MVP heredado y como proyección de la empresa-transportista.
 */
export const transportistaStatusSchema = z.enum(['pendiente_verificacion', 'activa', 'suspendida']);
export type TransportistaStatus = z.infer<typeof transportistaStatusSchema>;

export const transportistaSchema = z.object({
  id: transportistaIdSchema,
  owner_user_id: userIdSchema,
  legal_name: z.string().min(1),
  rut: rutSchema,
  address: addressSchema,
  phone: z.string().min(1),
  status: transportistaStatusSchema,
  rating: z.number().min(0).max(5).default(0),
  ratings_count: z.number().int().nonnegative().default(0),
  /** Transportista unipersonal: owner es también conductor. */
  is_solo_operator: z.boolean().default(false),
  dte_provider_account_id: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Transportista = z.infer<typeof transportistaSchema>;
