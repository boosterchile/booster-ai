import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailAlreadyInUseError,
  EmpresaRutDuplicateError,
  OnboardingTokenNotConsumableError,
  OnboardingTokenRequiredError,
  PlanNotFoundError,
  RutAlreadyRegisteredError,
  SelfOnboardingDisabledError,
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
  updates?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];
  const updates = [...(opts.updates ?? [])];

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

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => updates.shift() ?? []),
      })),
    })),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
  };

  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  };
}

const FB_UID = 'fb-uid-1';
const FB_EMAIL = 'felipe@boosterchile.com';

const CLAVE = '482915';

const CONSUMPTION = {
  solicitudId: '11111111-1111-4111-8111-111111111111',
  tokenHash: 'a'.repeat(64),
};

const VALID_INPUT = {
  user: {
    full_name: 'Felipe Vicencio',
    phone: '+56912345678',
    whatsapp_e164: '+56912345678',
    rut: '11111111-1', // ya normalizado por rutSchema en el route
    clave_numerica: CLAVE,
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
        [], // user by rut → libre (SC6)
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
      authorizedBy: 'self_service',
      selfServiceEnabled: true,
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
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
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
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(EmailAlreadyInUseError);
  });

  it('throw EmpresaRutDuplicateError si el RUT ya existe', async () => {
    const db = makeDb({
      selects: [
        [], // por firebase_uid
        [], // por email
        [], // por rut del usuario → libre
        [{ id: 'existing-empresa' }], // por rut de la empresa → existe
      ],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(EmpresaRutDuplicateError);
  });

  it('throw PlanNotFoundError si el plan_slug no existe', async () => {
    const db = makeDb({
      selects: [
        [], // por firebase_uid
        [], // por email
        [], // por rut del usuario
        [], // por rut de la empresa
        [], // plan no existe
      ],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
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
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(PlanNotFoundError);
  });

  // Reemplaza al test previo "rut del usuario opcional (null)": bajo ADR-035 el
  // RUT es la credencial de acceso, así que el alta SIEMPRE lo persiste. Un
  // usuario sin RUT no podría volver a entrar (`login-rut` lo busca por ahí).
  it('persiste el rut del usuario — es su credencial, no un dato opcional', async () => {
    const db = makeDb({
      selects: [[], [], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[{ id: 'user-uuid' }], [{ id: 'empresa-uuid' }], [{ id: 'membership-uuid' }]],
    });

    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      authorizedBy: 'self_service',
      selfServiceEnabled: true,
      input: VALID_INPUT,
    });

    expect(result.user.id).toBe('user-uuid');
    const userInsert = db.insert.mock.results[0]?.value as {
      values: { mock: { calls: unknown[][] } };
    };
    const values = userInsert.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.rut).toBe('11111111-1');
  });

  it('addressNumber opcional (null) — concatena solo street', async () => {
    const db = makeDb({
      selects: [[], [], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[{ id: 'u' }], [{ id: 'e' }], [{ id: 'm' }]],
    });
    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      authorizedBy: 'self_service',
      selfServiceEnabled: true,
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
      selects: [[], [], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[]], // user insert returns vacío
    });
    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(/Insert user returned no row/);
  });

  // SEC-001 hotfix — SC-2b service-layer invariant (defense in depth).
  it('throw SelfOnboardingDisabledError si authorizedBy=self_service y el flag está OFF — sin tocar la DB', async () => {
    const db = makeDb();

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'self_service',
        selfServiceEnabled: false,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(SelfOnboardingDisabledError);

    // El invariant rechaza ANTES de abrir transacción: cero escrituras.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // T1.5a — admin_provisioned: no lo bloquea el flag self-service, PERO ahora
  // exige consumir el token one-shot (paso 0 atómico). `CONSUMPTION` es de
  // módulo: lo comparten los describes de abajo.

  it('admin_provisioned NO se ve afectado por el flag self-service OFF y consume el token', async () => {
    const db = makeDb({
      updates: [[{ id: 'sig-uuid' }]], // consume del token OK (1 fila)
      selects: [[], [], [], [], [{ id: 'plan-uuid', slug: 'gratis', isActive: true }]],
      inserts: [[{ id: 'user-uuid' }], [{ id: 'empresa-uuid' }], [{ id: 'membership-uuid' }]],
    });

    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      authorizedBy: 'admin_provisioned',
      selfServiceEnabled: false,
      input: VALID_INPUT,
      onboardingTokenConsumption: CONSUMPTION,
    });

    expect(result.user.id).toBe('user-uuid');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1); // consumió el token (paso 0)
  });

  it('admin_provisioned con token NO consumible (UPDATE 0 filas) => OnboardingTokenNotConsumableError, sin crear user', async () => {
    const db = makeDb({ updates: [[]] }); // 0 filas: consumido / expirado / no existe / hash-mismatch
    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'admin_provisioned',
        selfServiceEnabled: false,
        input: VALID_INPUT,
        onboardingTokenConsumption: CONSUMPTION,
      }),
    ).rejects.toThrow(OnboardingTokenNotConsumableError);
    expect(db.insert).not.toHaveBeenCalled(); // rollback: no creó user/empresa/membership
  });

  it('admin_provisioned SIN token de consumo => OnboardingTokenRequiredError (sin tocar la DB)', async () => {
    const db = makeDb();
    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'admin_provisioned',
        selfServiceEnabled: false,
        input: VALID_INPUT,
      }),
    ).rejects.toThrow(OnboardingTokenRequiredError);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// alta-cliente-autocontenida — la persona queda con credencial propia
// ---------------------------------------------------------------------------
// Antes el alta terminaba sin credencial usable: la cuenta Firebase quedaba
// sin contraseña y el producto pide RUT + clave numérica (ADR-035), así que
// el recién dado de alta no podía volver a entrar sin pasar por el login
// legacy. Ahora la clave se define en el mismo acto y nadie más la conoce.
describe('onboardEmpresa — credencial propia (alta-cliente-autocontenida)', () => {
  it('persiste la clave numérica HASHEADA, nunca en claro', async () => {
    const db = makeDb({
      selects: [
        [], // user by firebase_uid
        [], // user by email
        [], // user by rut → libre
        [], // empresa by rut
        [{ id: 'plan-1', slug: 'gratis', isActive: true }],
      ],
      inserts: [
        [{ id: 'user-1', email: FB_EMAIL, fullName: 'Felipe Vicencio' }],
        [{ id: 'empresa-1', isTransportista: false }],
        [{ id: 'membership-1', role: 'dueno', status: 'activa' }],
      ],
      updates: [[{ id: 'sol-1' }]],
    });

    await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      authorizedBy: 'admin_provisioned',
      selfServiceEnabled: false,
      input: VALID_INPUT,
      onboardingTokenConsumption: CONSUMPTION,
    });

    const userInsert = db.insert.mock.results[0]?.value as {
      values: { mock: { calls: unknown[][] } };
    };
    const values = userInsert.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.claveNumericaHash).toBeDefined();
    expect(values.claveNumericaHash).not.toBe(CLAVE);
    expect(JSON.stringify(values)).not.toContain(CLAVE);
    // El RUT queda persistido: es la otra mitad de la credencial.
    expect(values.rut).toBe('11111111-1');
  });

  it('rechaza el alta si el RUT ya pertenece a otra persona — sin crear nada', async () => {
    const db = makeDb({
      selects: [
        [], // user by firebase_uid
        [], // user by email
        [{ id: 'otro-user' }], // user by rut → TOMADO
      ],
      updates: [[{ id: 'sol-1' }]],
    });

    await expect(
      onboardEmpresa({
        db: db as never,
        logger: noopLogger,
        firebaseUid: FB_UID,
        firebaseEmail: FB_EMAIL,
        authorizedBy: 'admin_provisioned',
        selfServiceEnabled: false,
        input: VALID_INPUT,
        onboardingTokenConsumption: CONSUMPTION,
      }),
    ).rejects.toThrow(RutAlreadyRegisteredError);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('toma identidad de la solicitud consumida, no de una sesión del caller', async () => {
    // El alta ya no depende de que la persona traiga sesión Firebase: la
    // fuente autorizada es la solicitud que el admin aprobó. El email y el uid
    // salen del RETURNING del consumo, así que un caller no puede alterarlos.
    const db = makeDb({
      selects: [[], [], [], [], [{ id: 'plan-1', slug: 'gratis', isActive: true }]],
      inserts: [
        [{ id: 'user-1' }],
        [{ id: 'empresa-1', isTransportista: false }],
        [{ id: 'membership-1' }],
      ],
      updates: [[{ id: 'sol-1', email: 'aprobado@cliente.cl', firebaseUid: 'uid-del-approve' }]],
    });

    const result = await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      authorizedBy: 'admin_provisioned',
      selfServiceEnabled: false,
      input: VALID_INPUT,
      onboardingTokenConsumption: CONSUMPTION,
    });

    const userInsert = db.insert.mock.results[0]?.value as {
      values: { mock: { calls: unknown[][] } };
    };
    const values = userInsert.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(values.email).toBe('aprobado@cliente.cl');
    expect(values.firebaseUid).toBe('uid-del-approve');
    // El uid queda disponible para que el route mintee el custom token.
    expect(result.firebaseUid).toBe('uid-del-approve');
  });

  it('conserva el email REAL de la persona, no un sintético', async () => {
    const db = makeDb({
      selects: [[], [], [], [], [{ id: 'plan-1', slug: 'gratis', isActive: true }]],
      inserts: [
        [{ id: 'user-1', email: FB_EMAIL, fullName: 'Felipe Vicencio' }],
        [{ id: 'empresa-1', isTransportista: false }],
        [{ id: 'membership-1', role: 'dueno', status: 'activa' }],
      ],
      updates: [[{ id: 'sol-1' }]],
    });

    await onboardEmpresa({
      db: db as never,
      logger: noopLogger,
      firebaseUid: FB_UID,
      firebaseEmail: FB_EMAIL,
      authorizedBy: 'admin_provisioned',
      selfServiceEnabled: false,
      input: VALID_INPUT,
      onboardingTokenConsumption: CONSUMPTION,
    });

    const userInsert = db.insert.mock.results[0]?.value as {
      values: { mock: { calls: unknown[][] } };
    };
    const values = userInsert.values.mock.calls[0]?.[0] as Record<string, unknown>;
    // El sintético (`users+<rut>@…invalid`) es identificador interno de
    // Firebase; el canal de comunicación con la persona es su email real.
    expect(values.email).toBe(FB_EMAIL);
    expect(String(values.email)).not.toContain('invalid');
  });
});
