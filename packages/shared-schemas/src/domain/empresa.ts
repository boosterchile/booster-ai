import { z } from 'zod';
import { chileanPhoneSchema, rutSchema } from '../primitives/chile.js';
import { addressSchema } from '../primitives/geo.js';
import { empresaIdSchema, planIdSchema } from '../primitives/ids.js';

/**
 * Empresa = tenant raíz del modelo multi-tenant.
 *
 * Una Empresa puede operar simultáneamente como SHIPPER (genera carga) y/o
 * CARRIER (transporta carga). Los flags `is_shipper` / `is_carrier` controlan
 * qué capacidades del producto le aparecen.
 *
 * Ejemplos en Chile:
 *   - Empresa retail (Falabella) → is_shipper=true, is_carrier=false
 *   - Transportista puro (López y López) → is_shipper=false, is_carrier=true
 *   - Empresa con flota propia que también contrata terceros → ambos true
 *
 * Auth: cada User pertenece a 1+ empresas vía Membership con un role
 * dentro de esa empresa (owner | admin | dispatcher | driver | viewer).
 *
 * Billing: la empresa tiene un Plan asignado (free | standard | pro).
 * Para el lunes piloto se asignan manualmente desde admin sin Stripe.
 */
export const empresaStatusSchema = z.enum([
  'pending_verification', // Recién creada, falta validación admin (RUT, contrato)
  'active', // Operando normalmente
  'suspended', // Suspendida por admin (impago, fraude, etc.)
]);
export type EmpresaStatus = z.infer<typeof empresaStatusSchema>;

export const empresaSchema = z.object({
  id: empresaIdSchema,
  legal_name: z.string().min(1).max(200),
  rut: rutSchema,
  contact_email: z.string().email(),
  contact_phone: chileanPhoneSchema,
  address: addressSchema,
  /** True si la empresa puede crear cargas (shipper). */
  is_shipper: z.boolean(),
  /** True si la empresa puede aceptar/transportar cargas (carrier). */
  is_carrier: z.boolean(),
  plan_id: planIdSchema,
  status: empresaStatusSchema,
  /** Timezone para mostrar fechas/horas. Default America/Santiago. */
  timezone: z.string().default('America/Santiago'),
  /**
   * Override manual del límite de offers paralelas que el matching engine
   * envía a esta empresa carrier. Null = usar default del plan.
   */
  max_concurrent_offers_override: z.number().int().positive().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Empresa = z.infer<typeof empresaSchema>;

/** Input para crear empresa nueva (sin id, sin timestamps). */
export const empresaCreateSchema = empresaSchema
  .omit({ id: true, created_at: true, updated_at: true, status: true })
  .extend({
    /** Status inicial siempre `pending_verification` salvo override admin. */
    status: empresaStatusSchema.default('pending_verification'),
  });
export type EmpresaCreate = z.infer<typeof empresaCreateSchema>;
