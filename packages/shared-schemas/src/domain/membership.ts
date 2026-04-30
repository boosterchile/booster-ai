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
 * Roles dentro de una empresa:
 *   - owner: dueño legal (1 por empresa, no se puede eliminar)
 *   - admin: gestiona usuarios, planes, vehículos, ve todo
 *   - dispatcher: opera matching, ve ofertas, asigna cargas (carrier-side)
 *     o crea cargas y ve historial (shipper-side)
 *   - driver: conductor, ve sus asignaciones, reporta status (solo carrier)
 *   - viewer: read-only, dashboards y reportes
 *
 * No confundir con `User.is_platform_admin` — ese es admin de Booster
 * (staff interno), no de una empresa cliente.
 */
export const membershipRoleSchema = z.enum(['owner', 'admin', 'dispatcher', 'driver', 'viewer']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const membershipStatusSchema = z.enum([
  'pending_invitation', // Invitado pero aún no aceptó
  'active', // Pertenece y puede operar
  'suspended', // Empresa o admin lo suspendió
  'removed', // Salió de la empresa (preservamos historial)
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
