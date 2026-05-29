import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

vi.mock('../../src/services/onboarding.js', () => {
  return {
    onboardEmpresa: vi.fn(),
    UserAlreadyExistsError: class UserAlreadyExistsError extends Error {
      constructor(public readonly firebaseUid: string) {
        super(`User with firebase_uid=${firebaseUid} already exists`);
        this.name = 'UserAlreadyExistsError';
      }
    },
    EmpresaRutDuplicateError: class EmpresaRutDuplicateError extends Error {
      constructor(public readonly rut: string) {
        super(`Empresa with rut=${rut} already exists`);
        this.name = 'EmpresaRutDuplicateError';
      }
    },
    EmailAlreadyInUseError: class EmailAlreadyInUseError extends Error {
      constructor(public readonly email: string) {
        super(`User with email=${email} already exists`);
        this.name = 'EmailAlreadyInUseError';
      }
    },
    PlanNotFoundError: class PlanNotFoundError extends Error {
      constructor(public readonly slug: string) {
        super(`Plan with slug=${slug} not found`);
        this.name = 'PlanNotFoundError';
      }
    },
    SelfOnboardingDisabledError: class SelfOnboardingDisabledError extends Error {
      constructor() {
        super('Self-service company onboarding is disabled');
        this.name = 'SelfOnboardingDisabledError';
      }
    },
  };
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/empresas.js').createEmpresaRoutes
>[0]['logger'];

const stubDb = {} as Db;

const validBody = {
  user: {
    full_name: 'Felipe Vicencio',
    phone: '+56912345678',
    whatsapp_e164: '+56912345678',
  },
  empresa: {
    legal_name: 'Booster Chile SpA',
    rut: '76.123.456-0',
    contact_email: 'contacto@booster.cl',
    contact_phone: '+56912345678',
    address: {
      street: 'Av. Apoquindo 5550',
      commune: 'Las Condes',
      city: 'Santiago',
      region: 'XIII',
      country: 'CL',
    },
    is_generador_carga: false,
    is_transportista: true,
  },
  plan_slug: 'gratis',
};

async function buildApp(selfOnboardingEnabled = true) {
  const { createEmpresaRoutes } = await import('../../src/routes/empresas.js');
  const app = new Hono();
  app.use('/empresas/*', async (c, next) => {
    const claimsHeader = c.req.header('x-test-claims');
    if (claimsHeader) {
      const parsed = JSON.parse(claimsHeader) as {
        uid: string;
        email?: string;
        emailVerified?: boolean;
      };
      c.set('firebaseClaims', {
        uid: parsed.uid,
        email: parsed.email,
        emailVerified: parsed.emailVerified ?? false,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.route(
    '/empresas',
    createEmpresaRoutes({ db: stubDb, logger: noopLogger, selfOnboardingEnabled }),
  );
  return app;
}

describe('POST /empresas/onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza body sin campos requeridos con 400 (zod)', async () => {
    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'a@b.com' }),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza body sin user.whatsapp_e164 con 400', async () => {
    const app = await buildApp();
    const body = {
      ...validBody,
      user: {
        full_name: validBody.user.full_name,
        phone: validBody.user.phone,
      },
    };
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza user.whatsapp_e164 con formato no chileno con 400', async () => {
    const app = await buildApp();
    const body = {
      ...validBody,
      user: {
        ...validBody.user,
        whatsapp_e164: '+1555111222',
      },
    };
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza empresa sin is_generador_carga ni is_transportista (refine)', async () => {
    const app = await buildApp();
    const body = {
      ...validBody,
      empresa: { ...validBody.empresa, is_generador_carga: false, is_transportista: false },
    };
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'a@b.com' }),
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it('devuelve 400 si claims no tiene email', async () => {
    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1' }),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'firebase_email_missing',
      code: 'firebase_email_missing',
    });
  });

  it('devuelve 500 si no hay firebaseClaims (orden middlewares mal)', async () => {
    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(500);
  });

  it('happy path: 201 con user+empresa+membership', async () => {
    const { onboardEmpresa } = await import('../../src/services/onboarding.js');
    vi.mocked(onboardEmpresa).mockResolvedValueOnce({
      user: {
        id: 'u1',
        firebaseUid: 'fb-1',
        email: 'felipe@boosterchile.com',
        fullName: 'Felipe Vicencio',
        phone: '+56912345678',
        whatsappE164: '+56912345678',
        rut: null,
        status: 'activo',
        isPlatformAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      },
      empresa: {
        id: 'e1',
        legalName: 'Booster Chile SpA',
        rut: '76.123.456-0',
        contactEmail: 'contacto@booster.cl',
        contactPhone: '+56912345678',
        addressStreet: 'Av. Apoquindo 5550',
        addressCity: 'Santiago',
        addressRegion: 'XIII',
        addressPostalCode: null,
        isGeneradorCarga: false,
        isTransportista: true,
        planId: 'plan-gratis',
        status: 'pendiente_verificacion',
        timezone: 'America/Santiago',
        maxConcurrentOffersOverride: null,
        carbonReductionTargetPct: null,
        carbonReductionTargetYear: null,
        priorCertifications: [],
        requiredReportingStandards: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        id: 'm1',
        userId: 'u1',
        empresaId: 'e1',
        role: 'dueno',
        status: 'activa',
        invitedByUserId: null,
        invitedAt: new Date(),
        joinedAt: new Date(),
        removedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string; email: string };
      empresa: { id: string; rut: string; is_transportista: boolean };
      membership: { role: string; status: string };
    };
    expect(body.user.email).toBe('felipe@boosterchile.com');
    expect(body.empresa.rut).toBe('76.123.456-0');
    expect(body.empresa.is_transportista).toBe(true);
    expect(body.membership.role).toBe('dueno');
    expect(body.membership.status).toBe('activa');
  });

  it('mapea UserAlreadyExistsError a 409', async () => {
    const onboarding = await import('../../src/services/onboarding.js');
    vi.mocked(onboarding.onboardEmpresa).mockRejectedValueOnce(
      new onboarding.UserAlreadyExistsError('fb-1'),
    );

    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'user_already_registered',
      code: 'user_already_registered',
    });
  });

  it('mapea EmpresaRutDuplicateError a 409', async () => {
    const onboarding = await import('../../src/services/onboarding.js');
    vi.mocked(onboarding.onboardEmpresa).mockRejectedValueOnce(
      new onboarding.EmpresaRutDuplicateError('76.123.456-0'),
    );

    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'rut_already_registered',
      code: 'rut_already_registered',
    });
  });

  it('mapea EmailAlreadyInUseError a 409', async () => {
    const onboarding = await import('../../src/services/onboarding.js');
    vi.mocked(onboarding.onboardEmpresa).mockRejectedValueOnce(
      new onboarding.EmailAlreadyInUseError('felipe@boosterchile.com'),
    );

    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'email_in_use', code: 'email_in_use' });
  });

  it('mapea PlanNotFoundError a 400', async () => {
    const onboarding = await import('../../src/services/onboarding.js');
    vi.mocked(onboarding.onboardEmpresa).mockRejectedValueOnce(
      new onboarding.PlanNotFoundError('gratis'),
    );

    const app = await buildApp();
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_plan', code: 'invalid_plan' });
  });
});

// SEC-001 hotfix — SC-4 durable backstop: the gate, exercised behaviourally.
// If a future PR deletes the route gate, these fail. This is the regression
// guard the spec relies on (NOT a static route-wiring parser).
describe('POST /empresas/onboarding — self-service gate (EMPRESA_SELF_ONBOARDING_ENABLED)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flag OFF → 403 onboarding_disabled and onboardEmpresa NEVER called (no DB write path)', async () => {
    const { onboardEmpresa } = await import('../../src/services/onboarding.js');
    const app = await buildApp(false); // self-onboarding disabled

    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-attacker', email: 'unapproved@example.com' }),
      },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: 'onboarding_disabled',
      code: 'onboarding_disabled',
    });
    // The vector is closed BEFORE any provisioning: the service is never invoked.
    expect(vi.mocked(onboardEmpresa)).not.toHaveBeenCalled();
  });

  it('flag ON → onboardEmpresa IS called with authorizedBy=self_service', async () => {
    const { onboardEmpresa } = await import('../../src/services/onboarding.js');
    vi.mocked(onboardEmpresa).mockResolvedValueOnce({
      // minimal shape; the route only reads ids/fields it echoes back
      user: {
        id: 'u1',
        firebaseUid: 'fb-1',
        email: 'felipe@boosterchile.com',
        fullName: 'Felipe Vicencio',
        phone: null,
        whatsappE164: null,
        rut: null,
        status: 'activo',
        isPlatformAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      },
      empresa: {
        id: 'e1',
        legalName: 'X',
        rut: '76.123.456-0',
        contactEmail: 'c@x.cl',
        contactPhone: '+56912345678',
        addressStreet: 'A',
        addressCity: 'S',
        addressRegion: 'XIII',
        addressPostalCode: null,
        isGeneradorCarga: false,
        isTransportista: true,
        planId: 'p1',
        status: 'pendiente_verificacion',
        timezone: 'America/Santiago',
        maxConcurrentOffersOverride: null,
        carbonReductionTargetPct: null,
        carbonReductionTargetYear: null,
        priorCertifications: [],
        requiredReportingStandards: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        id: 'm1',
        userId: 'u1',
        empresaId: 'e1',
        role: 'dueno',
        status: 'activa',
        invitedByUserId: null,
        invitedAt: new Date(),
        joinedAt: new Date(),
        removedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const app = await buildApp(true);
    const res = await app.request('/empresas/onboarding', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' }),
      },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(201);
    expect(vi.mocked(onboardEmpresa)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onboardEmpresa).mock.calls[0]?.[0]).toMatchObject({
      authorizedBy: 'self_service',
      selfServiceEnabled: true,
    });
  });
});
