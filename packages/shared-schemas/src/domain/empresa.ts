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

/**
 * Roles asignables al invitar a alguien a una empresa EXISTENTE.
 *
 * Excluye dos del enum de `membresias.rol`:
 *   - `conductor` — tiene su propio alta (`POST /conductores`), que además
 *     crea la ficha de conductor con licencia y vencimientos.
 *   - `stakeholder_sostenibilidad` — pertenece a organizaciones stakeholder
 *     (ADR-034), no a empresas; el CHECK XOR de la BD lo impide.
 */
export const rolInvitacionEmpresaSchema = z.enum(['dueno', 'admin', 'despachador', 'visualizador']);
export type RolInvitacionEmpresa = z.infer<typeof rolInvitacionEmpresaSchema>;

/**
 * Payload para sumar una persona a una empresa que YA existe.
 *
 * Existe porque el onboarding solo sabe crear empresa + dueño de cero: con el
 * RUT ya registrado devuelve 409 `rut_already_registered`, así que no había
 * forma de darle acceso a la segunda persona de un cliente. El backend crea la
 * cuenta Firebase (si el email es nuevo), la fila `usuarios` y la membresía, y
 * devuelve el link de acceso para que la persona fije su contraseña.
 */
export const invitarMiembroEmpresaSchema = z.object({
  email: z.string().email().max(320),
  full_name: z.string().min(2).max(200),
  rol: rolInvitacionEmpresaSchema,
});
export type InvitarMiembroEmpresaInput = z.infer<typeof invitarMiembroEmpresaSchema>;

/**
 * PATCH de `empresas.estado` (platform-admin). Los tres valores del enum
 * son alcanzables entre sí; no hay transición ilegal. Idempotente si el
 * valor pedido es el actual.
 */
export const empresaEstadoPatchSchema = z.object({
  estado: empresaStatusSchema,
});
export type EmpresaEstadoPatch = z.infer<typeof empresaEstadoPatchSchema>;

/**
 * PATCH de `empresas.carbon_measurement_enabled` (dueño/admin de la
 * empresa activa). El `empresa_id` NO viaja en el body: sale de la
 * membresía activa. Idempotente si el valor pedido es el actual.
 */
export const empresaCarbonMeasurementPatchSchema = z.object({
  carbon_measurement_enabled: z.boolean(),
});
export type EmpresaCarbonMeasurementPatch = z.infer<typeof empresaCarbonMeasurementPatchSchema>;

/**
 * Golpe único: litros mínimos que el dueño|admin puede fijar para toda la
 * flota. Por debajo de 5 L el sensor hace ruido y no se ofrece.
 * Null en la columna = default de dominio (8 L).
 */
export const UMBRAL_ROBO_GOLPE_MIN_L = 5;
export const UMBRAL_ROBO_GOLPE_MAX_L = 20;
export const UMBRAL_ROBO_GOLPE_DEFAULT_L = 8;

/**
 * Hormiga: suma de episodios. Rango de configuración 8–30 L. Null = 10 L.
 */
export const UMBRAL_ROBO_HORMIGA_MIN_L = 8;
export const UMBRAL_ROBO_HORMIGA_MAX_L = 30;
export const UMBRAL_ROBO_HORMIGA_DEFAULT_L = 10;

/** Piso de capacidad de estanque para el golpe único (2 %). */
export const PORCENTAJE_ESTANQUE_ROBO = 0.02;

const umbralGolpeSchema = z
  .number()
  .int()
  .min(UMBRAL_ROBO_GOLPE_MIN_L)
  .max(UMBRAL_ROBO_GOLPE_MAX_L)
  .nullable();

const umbralHormigaSchema = z
  .number()
  .int()
  .min(UMBRAL_ROBO_HORMIGA_MIN_L)
  .max(UMBRAL_ROBO_HORMIGA_MAX_L)
  .nullable();

/**
 * PATCH de los umbrales de aviso de combustible de la empresa activa.
 * `null` vuelve al default. Al menos un campo. El `empresa_id` no viaja
 * en el body: sale de la membresía.
 */
export const empresaUmbralesRoboCombustiblePatchSchema = z
  .object({
    umbral_robo_golpe_l: umbralGolpeSchema.optional(),
    umbral_robo_hormiga_l: umbralHormigaSchema.optional(),
  })
  .refine(
    (valor) => valor.umbral_robo_golpe_l !== undefined || valor.umbral_robo_hormiga_l !== undefined,
    { message: 'indicá al menos un umbral' },
  );
export type EmpresaUmbralesRoboCombustiblePatch = z.infer<
  typeof empresaUmbralesRoboCombustiblePatchSchema
>;
