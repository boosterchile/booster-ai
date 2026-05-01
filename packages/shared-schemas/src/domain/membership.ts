import { z } from 'zod';
import { empresaIdSchema, membershipIdSchema, userIdSchema } from '../primitives/ids.js';

/**
 * Membership = un User pertenece a una Empresa con un role específico.
 *
 * Un mismo User puede tener múltiples Memberships (típico: alguien que
 * trabaja en su empresa de logística personal + es admin de un cliente
 * institucional). El cliente web pide al user que elija qué empresa
 * usar al hacer login si tiene múltiples memberships activas.
 *
 * Roles dentro de una empresa (naming canónico en español):
 *   - dueno: dueño legal (1 por empresa, no se puede eliminar)
 *   - admin: gestiona usuarios, planes, vehículos, ve todo
 *   - despachador: opera matching, ve ofertas (transportista) o crea
 *     cargas (generador de carga)
 *   - conductor: ve sus asignaciones, reporta status (solo transportista)
 *   - visualizador: read-only, dashboards y reportes
 *   - stakeholder_sostenibilidad: acceso ESG con consent grants
 *
 * No confundir con `User.is_platform_admin` — ese es admin de Booster
 * (staff interno), no de una empresa cliente.
 */
export const membershipRoleSchema = z.enum([
  'dueno',
  'admin',
  'despachador',
  'conductor',
  'visualizador',
  'stakeholder_sostenibilidad',
]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const membershipStatusSchema = z.enum([
  'pendiente_invitacion',
  'activa',
  'suspendida',
  'removida',
]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const membershipSchema = z.object({
  id: membershipIdSchema,
  user_id: userIdSchema,
  empresa_id: empresaIdSchema,
  role: membershipRoleSchema,
  status: membershipStatusSchema,
  /** UserId del que invitó. Null si es el owner inicial al crear empresa. */
  invited_by_user_id: userIdSchema.nullable(),
  invited_at: z.string().datetime(),
  joined_at: z.string().datetime().nullable(),
  removed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Membership = z.infer<typeof membershipSchema>;
