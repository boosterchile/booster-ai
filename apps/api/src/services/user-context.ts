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
  /** Todas las memberships activas del user (estado = 'activa'). */
  memberships: MembershipWithEmpresa[];
  /**
   * Membership "activa" para esta request. El cliente la elige vía
   * header `X-Empresa-Id`. Si solo tiene 1 membership, esa es la
   * default. Si tiene 0 memberships, este valor es null.
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

export async function resolveUserContext(opts: {
  db: Db;
  firebaseUid: string;
  requestedEmpresaId: string | undefined;
}): Promise<UserContext> {
  const { db, firebaseUid, requestedEmpresaId } = opts;

  const userRows = await db.select().from(users).where(eq(users.firebaseUid, firebaseUid)).limit(1);
  const user = userRows[0];
  if (!user) {
    throw new UserNotFoundError(firebaseUid);
  }

  const rows = await db
    .select({ membership: memberships, empresa: empresas })
    .from(memberships)
    .innerJoin(empresas, eq(memberships.empresaId, empresas.id))
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'activa')));

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
    activeMembership = memberships_[0] ?? null;
  }

  return {
    user,
    memberships: memberships_,
    activeMembership,
  };
}
