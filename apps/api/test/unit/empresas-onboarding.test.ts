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

// Mock del service de onboarding — testeamos solo el route layer (mapping
// de errores → HTTP status, shape de response). La lógica de la
// transacción DB queda cubierta por integration tests post-piloto.
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
  };
});

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/empresas.js').createEmpresaRoutes
>[0]['logger'];

const stubDb = {} as Db;

const validBody = {
  user: {
    full_name: 'Felipe Vicencio',
    phone: '+56912345678',
  },
  empresa: {
    legal_name: 'Booster Chile SpA',
    rut: '76.123.456-K',
    contact_email: 'contacto@booster.cl',
    contact_phone: '+56912345678',
    address: {
      street: 'Av. Apoquindo 5550',
      commune: 'Las Condes',
      city: 'Santiago',
      region: 'XIII',
      country: 'CL',
    },
    is_shipper: false,
    is_carrier: true,
  },
  plan_slug: 'free',
};

async function buildApp() {
  const { createEmpresaRoutes } = await import('../../src/routes/empresas.js');
  const app = new Hono();
  app.use('/empresas/*', async (c, next) => {
    // Simular firebaseAuth middleware: setea claims del header X-Test-Claims
    // (sólo para tests). El header viene como JSON con { uid, email, ... }.
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
  app.route('/empresas', createEmpresaRoutes({ db: stubDb, logger: noopLogger }));
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

  it('rechaza empresa sin is_shipper ni is_carrier (refine)', async () => {
    const app = await buildApp();
    const body = {
      ...validBody,
      empresa: { ...validBody.empresa, is_shipper: false, is_carrier: false },
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
        'x-test-claims': JSON.stringify({ uid: 'fb-1' }), // sin email
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
      headers: { 'content-type': 'application/json' }, // sin x-test-claims
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
        rut: null,
        status: 'active',
        isPlatformAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
      },
      empresa: {
        id: 'e1',
        legalName: 'Booster Chile SpA',
        rut: '76.123.456-K',
        contactEmail: 'contacto@booster.cl',
        contactPhone: '+56912345678',
        addressStreet: 'Av. Apoquindo 5550',
        addressCity: 'Santiago',
        addressRegion: 'XIII',
        addressPostalCode: null,
        isShipper: false,
        isCarrier: true,
        planId: 'plan-free',
        status: 'pending_verification',
        timezone: 'America/Santiago',
        maxConcurrentOffersOverride: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        id: 'm1',
        userId: 'u1',
        empresaId: 'e1',
        role: 'owner',
        status: 'active',
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
      empresa: { id: string; rut: string; is_carrier: boolean };
      membership: { role: string; status: string };
    };
    expect(body.user.email).toBe('felipe@boosterchile.com');
    expect(body.empresa.rut).toBe('76.123.456-K');
    expect(body.empresa.is_carrier).toBe(true);
    expect(body.membership.role).toBe('owner');
    expect(body.membership.status).toBe('active');
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
      new onboarding.EmpresaRutDuplicateError('76.123.456-K'),
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
      new onboarding.PlanNotFoundError('free'),
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
