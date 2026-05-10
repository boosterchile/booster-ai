import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmpresaNotInMembershipsError,
  UserNotFoundError,
  resolveUserContext,
} from '../../src/services/user-context.js';

interface DbStub {
  select: ReturnType<typeof vi.fn>;
}

function makeDb(opts: { selects: unknown[][] }): DbStub {
  const queue = [...opts.selects];

  const buildChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => queue.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      return Promise.resolve(resolve(queue.shift() ?? []));
    };
    return chain;
  };

  return { select: vi.fn(() => buildChain()) };
}

const FB_UID = 'fb-uid-123';
const USER_ROW = {
  id: 'user-uuid',
  firebaseUid: FB_UID,
  email: 'a@b.c',
  status: 'activo',
};

const EMPRESA_A = { id: 'emp-a', razonSocial: 'Empresa A', status: 'activa' };
const EMPRESA_B = { id: 'emp-b', razonSocial: 'Empresa B', status: 'activa' };
const MEMBERSHIP_A = {
  membership: { id: 'mem-a', userId: USER_ROW.id, empresaId: EMPRESA_A.id, role: 'admin' },
  empresa: EMPRESA_A,
};
const MEMBERSHIP_B = {
  membership: { id: 'mem-b', userId: USER_ROW.id, empresaId: EMPRESA_B.id, role: 'conductor' },
  empresa: EMPRESA_B,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveUserContext', () => {
  it('throw UserNotFoundError si firebase_uid no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      resolveUserContext({
        db: db as never,
        firebaseUid: FB_UID,
        requestedEmpresaId: undefined,
      }),
    ).rejects.toThrow(UserNotFoundError);
  });

  it('user con 0 memberships → activeMembership=null', async () => {
    const db = makeDb({
      selects: [
        [USER_ROW], // SELECT user
        [], // SELECT memberships (vacío)
      ],
    });
    const ctx = await resolveUserContext({
      db: db as never,
      firebaseUid: FB_UID,
      requestedEmpresaId: undefined,
    });
    expect(ctx.user).toBe(USER_ROW);
    expect(ctx.memberships).toEqual([]);
    expect(ctx.activeMembership).toBeNull();
  });

  it('user con 1 membership y sin requestedEmpresaId → default a esa', async () => {
    const db = makeDb({
      selects: [[USER_ROW], [MEMBERSHIP_A]],
    });
    const ctx = await resolveUserContext({
      db: db as never,
      firebaseUid: FB_UID,
      requestedEmpresaId: undefined,
    });
    expect(ctx.activeMembership?.empresa.id).toBe(EMPRESA_A.id);
  });

  it('user con N memberships y sin requestedEmpresaId → primera de la lista', async () => {
    const db = makeDb({
      selects: [[USER_ROW], [MEMBERSHIP_A, MEMBERSHIP_B]],
    });
    const ctx = await resolveUserContext({
      db: db as never,
      firebaseUid: FB_UID,
      requestedEmpresaId: undefined,
    });
    expect(ctx.memberships).toHaveLength(2);
    expect(ctx.activeMembership?.empresa.id).toBe(EMPRESA_A.id);
  });

  it('user con N memberships + requestedEmpresaId match → activa esa específica', async () => {
    const db = makeDb({
      selects: [[USER_ROW], [MEMBERSHIP_A, MEMBERSHIP_B]],
    });
    const ctx = await resolveUserContext({
      db: db as never,
      firebaseUid: FB_UID,
      requestedEmpresaId: EMPRESA_B.id,
    });
    expect(ctx.activeMembership?.empresa.id).toBe(EMPRESA_B.id);
  });

  it('requestedEmpresaId que NO está en memberships → throw EmpresaNotInMembershipsError', async () => {
    const db = makeDb({
      selects: [[USER_ROW], [MEMBERSHIP_A]],
    });
    await expect(
      resolveUserContext({
        db: db as never,
        firebaseUid: FB_UID,
        requestedEmpresaId: 'emp-FOREIGN',
      }),
    ).rejects.toThrow(EmpresaNotInMembershipsError);
  });
});
