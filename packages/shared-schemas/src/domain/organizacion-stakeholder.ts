import { z } from 'zod';

/**
 * @booster-ai/shared-schemas — Organización stakeholder (ADR-034).
 *
 * Entidad de pertenencia para usuarios con rol `stakeholder_sostenibilidad`.
 * Paralela a `empresas` (no hija). Capturada como entidad separada para
 * que el modelo de `empresas` se mantenga limpio (entidades comerciales
 * del marketplace) y para que el routing de datos agregados pueda
 * scope-arse por región/sector declarado en la organización.
 *
 * NO confundir con el schema `stakeholder.ts` legacy, que modela un
 * stakeholder individual (persona) más los consents granulares. Ese
 * sigue siendo válido para datos individuales; este es para la
 * entidad de pertenencia de la persona.
 */

/**
 * Tipos de organización stakeholder. Determinan el contexto del scope
 * por defecto (e.g. un regulador estatal típicamente tiene
 * `region_ambito` nacional; un observatorio académico puede ser
 * regional).
 */
export const stakeholderOrgTypeSchema = z.enum([
  'regulador',
  'gremio',
  'observatorio_academico',
  'ong',
  'corporativo_esg',
]);
export type StakeholderOrgType = z.infer<typeof stakeholderOrgTypeSchema>;

/**
 * Ámbito geográfico. ISO 3166-2:CL (e.g. `CL-RM`, `CL-VS`) o NULL = nacional.
 * Determina el filtro de datos agregados que ve la organización.
 */
export const regionAmbitoSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^CL-[A-Z]{2,3}$/, 'Código ISO 3166-2:CL inválido (e.g. CL-RM)')
  .nullable();

/**
 * Ámbito sectorial. Slug libre (e.g. `transporte-carga`, `manufactura`)
 * o NULL = todos los sectores.
 */
export const sectorAmbitoSchema = z
  .string()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9-]+$/, 'Slug en minúsculas y guiones (e.g. transporte-carga)')
  .nullable();

/**
 * Organización stakeholder canónica.
 */
export const organizacionStakeholderSchema = z.object({
  id: z.string().uuid(),
  nombre_legal: z.string().min(3).max(200),
  tipo: stakeholderOrgTypeSchema,
  region_ambito: regionAmbitoSchema,
  sector_ambito: sectorAmbitoSchema,
  creado_por_admin_id: z.string().uuid().nullable(),
  creado_en: z.string().datetime(),
  actualizado_en: z.string().datetime(),
  eliminado_en: z.string().datetime().nullable(),
});
export type OrganizacionStakeholder = z.infer<typeof organizacionStakeholderSchema>;

/**
 * Payload para crear una organización stakeholder. Solo platform-admin.
 */
export const crearOrganizacionStakeholderSchema = z.object({
  nombre_legal: z.string().min(3).max(200),
  tipo: stakeholderOrgTypeSchema,
  region_ambito: regionAmbitoSchema.optional(),
  sector_ambito: sectorAmbitoSchema.optional(),
});
export type CrearOrganizacionStakeholderInput = z.infer<typeof crearOrganizacionStakeholderSchema>;

/**
 * Payload para invitar un miembro a una org stakeholder. El backend crea
 * un usuario placeholder + una membership pending si el RUT no existe;
 * si existe, agrega la membership directamente.
 */
export const invitarMiembroOrgStakeholderSchema = z.object({
  rut: z.string().min(8).max(12),
  email: z.string().email(),
  full_name: z.string().min(2).max(200),
});
export type InvitarMiembroOrgStakeholderInput = z.infer<typeof invitarMiembroOrgStakeholderSchema>;

/**
 * Etiquetas humanas para UI. Mantenidas acá (no en el cliente) para que
 * shared y consistente entre frontend y backend (logs, emails, etc.).
 */
export const STAKEHOLDER_ORG_TYPE_LABEL: Record<StakeholderOrgType, string> = {
  regulador: 'Regulador estatal',
  gremio: 'Gremio / asociación',
  observatorio_academico: 'Observatorio académico',
  ong: 'ONG ambiental',
  corporativo_esg: 'Corporativo ESG',
};
