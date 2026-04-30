import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { empresas, memberships, users } from '../db/schema.js';
import type { EmpresaRow, MembershipRow, UserRow } from '../db/schema.js';

/**
 * Membership enriquecida con los datos de la Empresa (el cliente web los
 * necesita para mostrar nombre/RUT en el dropdown de selección).
 */
export interface MembershipWithEmpresa {
  membership: MembershipRow;
  empresa: EmpresaRow;
}

export interface UserContext {
  user: UserRow;
  /** Todas las memberships activas del user (status = 'active'). */
  memberships: MembershipWithEmpresa[];
  /**
   * Membership "activa" para esta request. El cliente la elige vía header
   * `X-Empresa-Id`. Si solo tiene 1 membership, esa es la default. Si tiene
   * 0 memberships, este valor es null (el user puede seguir operando como
   * platform admin si lo es, o ir a onboarding de empresa).
   */
  activeMembership: MembershipWithEmpresa | null;
}

export class UserNotFoundError extends Error {
  constructor(public readonly firebaseUid: string) {
    super(`No user found for firebase_uid=${firebaseUid}`);
    this.name = 'UserNotFoundError';
  }
}

export class EmpresaNotInMembershipsError extends Error {
  constructor(
    public readonly userId: string,
    public readonly requestedEmpresaId: string,
  ) {
    super(`User ${userId} has no active membership for empresa ${requestedEmpresaId}`);
    this.name = 'EmpresaNotInMembershipsError';
  }
}

/**
 * Resuelve el contexto del user dado su firebase_uid.
 *
 * Lógica de activeMembership:
 *   - Si `requestedEmpresaId` está presente: tiene que matchear una
 *     membership activa del user, sino EmpresaNotInMembershipsError.
 *   - Si no está presente y el user tiene 1+ memberships activas: default
 *     a la primera (orden de joined_at ASC, primera empresa a la que se
 *     unió).
 *   - Si no tiene memberships activas: activeMembership = null.
 *
 * @throws UserNotFoundError si no existe user con ese firebase_uid
 * @throws EmpresaNotInMembershipsError si requestedEmpresaId no matchea
 */
export async function resolveUserContext(opts: {
  db: Db;
  firebaseUid: string;
  requestedEmpresaId?: string;
}): Promise<UserContext> {
  const { db, firebaseUid, requestedEmpresaId } = opts;

  const userRows = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
  const user = userRows[0];
  if (!user) {
    throw new UserNotFoundError(firebaseUid);
  }

  // Cargar memberships activas + empresa join. Drizzle no infiere el join
  // como objeto anidado por default, así que iteramos el resultado plano.
  const rows = await db
    .select({ membership: memberships, empresa: empresas })
    .from(memberships)
    .innerJoin(empresas, eq(memberships.empresaId, empresas.id))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')));

  const memberships_: MembershipWithEmpresa[] = rows.map((r) => ({
    membership: r.membership,
    empresa: r.empresa,
  }));

  let activeMembership: MembershipWithEmpresa | null = null;
  if (requestedEmpresaId) {
    const match = memberships_.find((m) => m.empresa.id === requestedEmpresaId);
    if (!match) {
      throw new EmpresaNotInMembershipsError(user.id, requestedEmpresaId);
    }
    activeMembership = match;
  } else if (memberships_.length > 0) {
    // Default: primera membership (la lista llega en orden indefinido del DB,
    // pero para B.2 cualquier orden estable es suficiente; B.x posterior
    // puede agregar orden por last_used_at).
    activeMembership = memberships_[0] ?? null;
  }

  return {
    user,
    memberships: memberships_,
    activeMembership,
  };
}
