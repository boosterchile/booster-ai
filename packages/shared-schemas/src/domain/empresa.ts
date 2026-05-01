import { z } from 'zod';
import { chileanPhoneSchema, rutSchema } from '../primitives/chile.js';
import { addressSchema } from '../primitives/geo.js';
import { empresaIdSchema, planIdSchema } from '../primitives/ids.js';
import { reportingStandardSchema } from './stakeholder.js';

/**
 * Empresa = tenant raíz del modelo multi-tenant.
 *
 * Una Empresa puede operar simultáneamente como GENERADOR DE CARGA (genera
 * cargas) y/o TRANSPORTISTA (transporta cargas). Los flags
 * `is_generador_carga` / `is_transportista` controlan qué capacidades del
 * producto le aparecen.
 *
 * Ejemplos en Chile:
 *   - Empresa retail (Falabella) → is_generador_carga=true, is_transportista=false
 *   - Transportista puro (López y López) → is_generador_carga=false, is_transportista=true
 *   - Empresa con flota propia que también contrata terceros → ambos true
 *
 * Auth: cada User pertenece a 1+ empresas vía Membership con un role
 * dentro de esa empresa (dueno | admin | despachador | conductor |
 * visualizador | stakeholder_sostenibilidad).
 *
 * Billing: la empresa tiene un Plan asignado (gratis | estandar | pro |
 * enterprise). Para piloto se asignan manualmente desde admin sin Stripe.
 *
 * Perfil ESG: las empresas con compromisos de descarbonización declaran
 * meta de reducción y los estándares de reporte que requieren para
 * compliance (GLEC v3.0, GHG Protocol, ISO 14064, GRI, SASB, CDP).
 */
export const empresaStatusSchema = z.enum(['pendiente_verificacion', 'activa', 'suspendida']);
export type EmpresaStatus = z.infer<typeof empresaStatusSchema>;

export const empresaSchema = z.object({
  id: empresaIdSchema,
  legal_name: z.string().min(1).max(200),
  rut: rutSchema,
  contact_email: z.string().email(),
  contact_phone: chileanPhoneSchema,
  address: addressSchema,
  /** True si la empresa puede crear cargas (generador de carga). */
  is_generador_carga: z.boolean(),
  /** True si la empresa puede aceptar/transportar cargas (transportista). */
  is_transportista: z.boolean(),
  plan_id: planIdSchema,
  status: empresaStatusSchema,
  /** Timezone para mostrar fechas/horas. Default America/Santiago. */
  timezone: z.string().default('America/Santiago'),
  /**
   * Override manual del límite de offers paralelas que el matching engine
   * envía a esta empresa transportista. Null = usar default del plan.
   */
  max_concurrent_offers_override: z.number().int().positive().nullable().default(null),
  /**
   * Meta declarada de reducción de huella de carbono (porcentaje vs
   * baseline propio o industria). Insumo del observatorio ESG.
   */
  carbon_reduction_target_pct: z.number().min(0).max(100).nullable().default(null),
  /** Año objetivo de la meta declarada (ej. 2030, 2040, 2050). */
  carbon_reduction_target_year: z.number().int().nullable().default(null),
  /**
   * Lista libre de certificaciones previas (ISO 14001, B Corp, etc.) que la
   * empresa declara. No se valida contra catálogo cerrado en B0.
   */
  prior_certifications: z.array(z.string()).default([]),
  /**
   * Estándares de reporte que la empresa requiere ver en sus dashboards
   * ESG (GLEC v3.0, GHG Protocol, ISO 14064, GRI, SASB, CDP).
   */
  required_reporting_standards: z.array(reportingStandardSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Empresa = z.infer<typeof empresaSchema>;

/** Input para crear empresa nueva (sin id, sin timestamps). */
export const empresaCreateSchema = empresaSchema
  .omit({ id: true, created_at: true, updated_at: true, status: true })
  .extend({
    /** Status inicial siempre `pendiente_verificacion` salvo override admin. */
    status: empresaStatusSchema.default('pendiente_verificacion'),
  });
export type EmpresaCreate = z.infer<typeof empresaCreateSchema>;
