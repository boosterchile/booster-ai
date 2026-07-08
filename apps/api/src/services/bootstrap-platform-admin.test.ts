import type { Auth } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  type BootstrapPlatformAdminInput,
  FirebaseUidConflictError,
  InvalidBootstrapInputError,
  NotInAllowlistError,
  RutConflictError,
  RutImmutableError,
  bootstrapPlatformAdmin,
} from './bootstrap-platform-admin.js';
import { verifyClaveNumerica } from './clave-numerica.js';

/**
 * Unit del service de bootstrap (Gap A). Cubre las ramas de validación,
 * allowlist y reconciliación con stubs chainables de Drizzle (mismo patrón
 * de `test/unit/auth-universal.test.ts`). El comportamiento contra Postgres
 * real + las rutas reales (login-rut → requirePlatformAdmin → approve) vive
 * en `test/integration/bootstrap-platform-admin.integration.test.ts`.
 */

type ServiceOpts = Parameters<typeof bootstrapPlatformAdmin>[0];

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as ServiceOpts['logger'];

const ALLOWLIST = ['admin@boosterchile.com'];

const INPUT: BootstrapPlatformAdminInput = {
  email: 'admin@boosterchile.com',
  fullName: 'Admin Test',
  rut: '11.111.111-1',
  clave: '654321',
};

interface Row {
  [key: string]: unknown;
}

/**
 * Stub del tx de Drizzle. Los `select` se resuelven por orden de llamada
 * (el service hace: 1º dueño-del-rut, 2º fila-por-email, 3º dueño-del-uid).
 */
function makeDbStub(opts: {
  rutOwner?: Row[];
  existing?: Row[];
  uidOwner?: Row[];
  insertReturns?: Row[];
}) {
  const selectQueue: Row[][] = [opts.rutOwner ?? [], opts.existing ?? [], opts.uidOwner ?? []];
  const limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(() => Promise.resolve(opts.insertReturns ?? [{ id: 'user-id-1' }]));
  // Args tipados a propósito: sin ellos, `mock.calls` tipa tupla vacía y el
  // acceso a la patch/values en las aserciones no compila (TS2493).
  const values = vi.fn((_v: Row) => ({ returning }));
  const insert = vi.fn(() => ({ values }));

  const updateWhere = vi.fn(() => Promise.resolve(undefined));
  const set = vi.fn((_patch: Row) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  const tx = { select, insert, update };
  const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

  return {
    db: { transaction } as unknown as ServiceOpts['db'],
    spies: { select, insert, values, update, set, transaction },
  };
}

function makeAuthStub(opts: { existingUid?: string } = {}) {
  const getUserByEmail = opts.existingUid
    ? vi.fn().mockResolvedValue({ uid: opts.existingUid })
    : vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('not found'), { code: 'auth/user-not-found' }));
  const createUser = vi.fn().mockResolvedValue({ uid: 'fb-uid-new' });
  return {
    auth: { getUserByEmail, createUser } as unknown as Auth,
    spies: { getUserByEmail, createUser },
  };
}

function baseOpts(overrides: Partial<ServiceOpts> = {}): ServiceOpts {
  const { db } = makeDbStub({});
  const { auth } = makeAuthStub();
  return {
    db,
    firebaseAuth: auth,
    logger: noopLogger,
    allowlist: ALLOWLIST,
    input: INPUT,
    ...overrides,
  };
}

describe('bootstrapPlatformAdmin — validación de entradas', () => {
  it('rechaza RUT con dígito verificador inválido', async () => {
    await expect(
      bootstrapPlatformAdmin(baseOpts({ input: { ...INPUT, rut: '11.111.111-2' } })),
    ).rejects.toThrow(InvalidBootstrapInputError);
  });

  it('rechaza clave que no sea exactamente 6 dígitos', async () => {
    await expect(
      bootstrapPlatformAdmin(baseOpts({ input: { ...INPUT, clave: '12345' } })),
    ).rejects.toThrow(InvalidBootstrapInputError);
  });

  it('rechaza fullName vacío', async () => {
    await expect(
      bootstrapPlatformAdmin(baseOpts({ input: { ...INPUT, fullName: '   ' } })),
    ).rejects.toThrow(InvalidBootstrapInputError);
  });

  it('rechaza email fuera de la allowlist ANTES de tocar Firebase', async () => {
    const { auth, spies } = makeAuthStub();
    await expect(
      bootstrapPlatformAdmin(
        baseOpts({ firebaseAuth: auth, input: { ...INPUT, email: 'intruso@example.com' } }),
      ),
    ).rejects.toThrow(NotInAllowlistError);
    expect(spies.getUserByEmail).not.toHaveBeenCalled();
    expect(spies.createUser).not.toHaveBeenCalled();
  });

  it('normaliza email a lowercase para el match de allowlist', async () => {
    const { db } = makeDbStub({});
    const result = await bootstrapPlatformAdmin(
      baseOpts({ db, input: { ...INPUT, email: 'ADMIN@boosterchile.com' } }),
    );
    expect(result.user).toBe('created');
  });
});

describe('bootstrapPlatformAdmin — Firebase', () => {
  it('reutiliza la cuenta Firebase existente sin createUser', async () => {
    const { auth, spies } = makeAuthStub({ existingUid: 'fb-uid-existente' });
    const result = await bootstrapPlatformAdmin(baseOpts({ firebaseAuth: auth }));
    expect(result.firebase).toBe('existing');
    expect(result.firebaseUid).toBe('fb-uid-existente');
    expect(spies.createUser).not.toHaveBeenCalled();
  });

  it('propaga errores de Firebase que no sean user-not-found', async () => {
    const getUserByEmail = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('perm'), { code: 'auth/insufficient-permission' }),
      );
    await expect(
      bootstrapPlatformAdmin(baseOpts({ firebaseAuth: { getUserByEmail } as unknown as Auth })),
    ).rejects.toThrow('perm');
  });
});

describe('bootstrapPlatformAdmin — reconciliación de la fila usuarios', () => {
  const EXISTING_BASE: Row = {
    id: 'user-id-1',
    firebaseUid: 'fb-uid-new',
    email: INPUT.email,
    fullName: INPUT.fullName,
    rut: '11111111-1',
    claveNumericaHash: 'hash-existente',
    isPlatformAdmin: true,
    status: 'activo',
  };

  it('crea la fila con el INSERT completo cuando no existe', async () => {
    const { db, spies } = makeDbStub({});
    const result = await bootstrapPlatformAdmin(baseOpts({ db }));
    expect(result.user).toBe('created');
    expect(result.userId).toBe('user-id-1');
    const insertedValues = spies.values.mock.calls[0]?.[0] as Row;
    expect(insertedValues.rut).toBe('11111111-1');
    expect(insertedValues.isPlatformAdmin).toBe(true);
    expect(insertedValues.status).toBe('activo');
    expect(verifyClaveNumerica(INPUT.clave, insertedValues.claveNumericaHash as string)).toBe(true);
  });

  it('fila idéntica → unchanged sin UPDATE', async () => {
    const { db, spies } = makeDbStub({ existing: [EXISTING_BASE] });
    const result = await bootstrapPlatformAdmin(baseOpts({ db }));
    expect(result.user).toBe('unchanged');
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('repara rut NULL + clave NULL + is_platform_admin false + status en un solo UPDATE', async () => {
    const { db, spies } = makeDbStub({
      existing: [
        {
          ...EXISTING_BASE,
          rut: null,
          claveNumericaHash: null,
          isPlatformAdmin: false,
          status: 'pendiente_verificacion',
        },
      ],
    });
    const result = await bootstrapPlatformAdmin(baseOpts({ db }));
    expect(result.user).toBe('reconciled');
    const patch = spies.set.mock.calls[0]?.[0] as Row;
    expect(patch.rut).toBe('11111111-1');
    expect(verifyClaveNumerica(INPUT.clave, patch.claveNumericaHash as string)).toBe(true);
    expect(patch.isPlatformAdmin).toBe(true);
    expect(patch.status).toBe('activo');
  });

  it('clave existente se conserva sin rotateClave y se rota con rotateClave', async () => {
    const noRotate = makeDbStub({ existing: [EXISTING_BASE] });
    await bootstrapPlatformAdmin(baseOpts({ db: noRotate.db }));
    expect(noRotate.spies.update).not.toHaveBeenCalled();

    const rotate = makeDbStub({ existing: [EXISTING_BASE] });
    const result = await bootstrapPlatformAdmin(
      baseOpts({ db: rotate.db, input: { ...INPUT, rotateClave: true } }),
    );
    expect(result.user).toBe('reconciled');
    const patch = rotate.spies.set.mock.calls[0]?.[0] as Row;
    expect(verifyClaveNumerica(INPUT.clave, patch.claveNumericaHash as string)).toBe(true);
  });

  it('aborta con RutConflictError si el rut pertenece a otro usuario', async () => {
    const { db, spies } = makeDbStub({ rutOwner: [{ id: 'otro', email: 'otro@x.com' }] });
    await expect(bootstrapPlatformAdmin(baseOpts({ db }))).rejects.toThrow(RutConflictError);
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('aborta con RutImmutableError si la fila declara otro rut', async () => {
    const { db, spies } = makeDbStub({ existing: [{ ...EXISTING_BASE, rut: '12345678-5' }] });
    await expect(bootstrapPlatformAdmin(baseOpts({ db }))).rejects.toThrow(RutImmutableError);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('aborta con FirebaseUidConflictError si el uid vive en la fila de otro email', async () => {
    const { db } = makeDbStub({
      existing: [],
      uidOwner: [{ email: 'otro@x.com' }],
    });
    await expect(bootstrapPlatformAdmin(baseOpts({ db }))).rejects.toThrow(
      FirebaseUidConflictError,
    );
  });

  it('lanza si el INSERT no retorna fila (fail-loud, sin éxito silencioso)', async () => {
    const { db } = makeDbStub({ insertReturns: [] });
    await expect(bootstrapPlatformAdmin(baseOpts({ db }))).rejects.toThrow(
      'INSERT usuarios no retornó fila',
    );
  });
});

describe('bootstrapPlatformAdmin — dry-run', () => {
  it('no llama createUser ni escribe filas; reporta acciones prefijadas', async () => {
    const { db, spies } = makeDbStub({});
    const { auth, spies: authSpies } = makeAuthStub();
    const result = await bootstrapPlatformAdmin(
      baseOpts({ db, firebaseAuth: auth, input: { ...INPUT, dryRun: true } }),
    );
    expect(result.dryRun).toBe(true);
    expect(result.firebaseUid).toBe('dry-run-pending');
    expect(result.userId).toBeNull();
    expect(authSpies.createUser).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(result.actions.every((a) => a.startsWith('dry-run: '))).toBe(true);
  });

  it('dry-run sobre fila existente reconciliable no ejecuta el UPDATE', async () => {
    const { db, spies } = makeDbStub({
      existing: [
        {
          id: 'user-id-1',
          firebaseUid: 'fb-uid-new',
          email: INPUT.email,
          fullName: INPUT.fullName,
          rut: null,
          claveNumericaHash: null,
          isPlatformAdmin: false,
          status: 'pendiente_verificacion',
        },
      ],
    });
    const { auth } = makeAuthStub({ existingUid: 'fb-uid-new' });
    const result = await bootstrapPlatformAdmin(
      baseOpts({ db, firebaseAuth: auth, input: { ...INPUT, dryRun: true } }),
    );
    expect(result.user).toBe('reconciled');
    expect(spies.update).not.toHaveBeenCalled();
  });
});
