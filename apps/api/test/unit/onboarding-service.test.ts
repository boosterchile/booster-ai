import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailAlreadyInUseError,
  EmpresaRutDuplicateError,
  PlanNotFoundError,
  UserAlreadyExistsError,
  onboardEmpresa,
} from '../../src/services/onboarding.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => inserts.shift() ?? []),
    })),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
  };

  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  };
}

const FB_UID = 'fb-uid-1';
const FB_EMAIL = 'felipe@boosterchile.com';

const VALID_INPUT = {
  user: {
    full_name: 'Felipe Vicencio',
    phone: '+56912345678',
    whatsapp_e164: '+56912345678',
    rut: '11.111.111-1',
  },
  empresa: {
    legal_name: 'Booster SpA',
    rut: '76.000.000-0',
    contact_email: 'contacto@boosterchile.com',
    contact_phone: '+56912345678',
    address: {
      street: 'Av. Apoquindo',
      number: '4501',
      city: 'Las Condes',
      region: 'RM',
      postalCode: '7550000',
    },
    is_generador_carga: true,
    is_transportista: false,
  },
  plan_slug: 'gratis' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('onboardEmpresa', () => {
  it('happy path: crea user + empresa + membership', async () => {
    const db = makeDb({
      selects: [
        [], // user by firebase_uid → no existe
        [], // user by email → no existe
        [], // empresa by rut → no existe
        [{ id: 'plan-uuid', slug: 'gratis', isActive: true }], // plan
      ],
      inserts: [
        [{ id: 'user-uuid', email: FB_EMAIL }], // INSERT user
        [{ id: 'empresa-uuid', rut: '76.000.000-0', isGeneradorCarga: true }], // INSERT empresa
        [{ id: 'membership-uuid', role: 'dueno', status: 'activa' }], // INSERT membership
      ],
    });

    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      input: VALID_INPUT,
    });

    expect(result.user.id).toBe('user-uuid');
    expect(result.empresa.id).toBe('empresa-uuid');
    expect(result.membership.id).toBe('membership-uuid');
  });

  it('throw UserAlreadyExistsError si el firebase_uid ya tiene cuenta', async () => {
    const db = makeDb({
      selects: [[{ id: 'existing-user' }]], // primer SELECT retorna user existente
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(UserAlreadyExistsError);
  });

  it('throw EmailAlreadyInUseError si el email ya está usado por otro user', async () => {
    const db = makeDb({
      selects: [
        [], // por firebase_uid → no existe
        [{ id: 'other-user' }], // por email → existe
      ],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(EmailAlreadyInUseError);
  });

  it('throw EmpresaRutDuplicateError si el RUT ya existe', async () => {
    const db = makeDb({
      selects: [
        [], // por firebase_uid
        [], // por email
        [{ id: 'existing-empresa' }], // por rut → existe
      ],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(EmpresaRutDuplicateError);
  });

  it('throw PlanNotFoundError si el plan_slug no existe', async () => {
    const db = makeDb({
      selects: [
        [], // por firebase_uid
        [], // por email
        [], // por rut
        [], // plan no existe
      ],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(PlanNotFoundError);
  });

  it('throw PlanNotFoundError si el plan existe pero está inactivo', async () => {
    const db = makeDb({
      selects: [
        [],
        [],
        [],
        [{ id: 'plan-uuid', slug: 'gratis', isActive: false }], // plan inactivo
      ],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(PlanNotFoundError);
  });

  it('rut del usuario opcional (null) — INSERT no incluye campo rut', async () => {
    const db = makeDb({
      selects: [[], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[{ id: 'user-uuid' }], [{ id: 'empresa-uuid' }], [{ id: 'membership-uuid' }]],
    });

    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      input: { ...VALID_INPUT, user: { ...VALID_INPUT.user, rut: null } },
    });

    expect(result.user.id).toBe('user-uuid');
  });

  it('addressNumber opcional (null) — concatena solo street', async () => {
    const db = makeDb({
      selects: [[], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[{ id: 'u' }], [{ id: 'e' }], [{ id: 'm' }]],
    });
    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      input: {
        ...VALID_INPUT,
        empresa: {
          ...VALID_INPUT.empresa,
          address: { ...VALID_INPUT.empresa.address, number: null, postalCode: null },
        },
      },
    });
    expect(result.empresa.id).toBe('e');
  });

  it('throw "Insert user returned no row" si INSERT user falla', async () => {
    const db = makeDb({
      selects: [[], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[]], // user insert returns vacío
    });
    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(/Insert user returned no row/);
  });
});
