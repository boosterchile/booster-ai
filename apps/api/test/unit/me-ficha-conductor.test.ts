import { getTableName } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /me expone `tiene_ficha_conductor` para la empresa activa.
 * No cambia quién puede aceptar una oferta: el booleano solo dice si
 * este usuario tiene fila viva en `conductores` de esa empresa.
 */

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
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'admin@boosterchile.com';
});

afterEach(() => {
  vi.resetModules();
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
} as unknown as Parameters<typeof import('../../src/routes/me.js').createMeRoutes>[0]['logger'];

const USER_ID = 'user-test';
const EMPRESA_ID = 'empresa-test';

function userRow() {
  return {
    id: USER_ID,
    firebaseUid: 'fb-dueno',
    email: 'dueno@example.com',
    fullName: 'Usuario Sintético',
    phone: null,
    whatsappE164: null,
    rut: '11.111.111-1',
    status: 'activo',
    isPlatformAdmin: false,
    claveNumericaHash: null,
  };
}

function membershipRow(role: 'dueno' | 'admin' | 'conductor') {
  return {
    membership: {
      id: 'm-test',
      role,
      status: 'activa',
      joinedAt: new Date('2026-10-01T00:00:00Z'),
      empresaId: EMPRESA_ID,
    },
    empresa: {
      id: EMPRESA_ID,
      legalName: 'Transportes Ejemplo SpA',
      rut: '11.111.111-1',
      isGeneradorCarga: false,
      isTransportista: true,
      status: 'activa',
    },
  };
}

function makeDbStub(opts: { role: 'dueno' | 'admin' | 'conductor'; ficha: { id: string }[] }) {
  const selectResults: unknown[][] = [[userRow()], [membershipRow(opts.role)], []];
  let fichaWhere: unknown;
  const limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  const innerJoin = vi.fn(() => ({
    where: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
  }));
  const where = vi.fn(() => ({ limit, innerJoin }));
  const from = vi.fn((table: unknown) => {
    // `vi.resetModules()` recarga el schema dentro de `me.ts`. La identidad
    // del objeto no sobrevive; el nombre de tabla sí.
    const nombre =
      table && typeof table === 'object' ? getTableName(table as Record<string, unknown>) : '';
    if (nombre === 'conductores') {
      return {
        where: vi.fn((clause: unknown) => {
          fichaWhere = clause;
          return { limit: vi.fn(() => Promise.resolve(opts.ficha)) };
        }),
      };
    }
    return { where, innerJoin };
  });
  const select = vi.fn(() => ({ from }));
  return {
    db: { select } as unknown as Parameters<
      typeof import('../../src/routes/me.js').createMeRoutes
    >[0]['db'],
    fichaWhere: () => fichaWhere,
    from,
  };
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/me.js').createMeRoutes>[0]['db'],
) {
  const { createMeRoutes } = await import('../../src/routes/me.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    c.set('firebaseClaims', {
      uid: 'fb-dueno',
      email: 'dueno@example.com',
      emailVerified: true,
      name: undefined,
      picture: undefined,
      custom: {},
    });
    await next();
  });
  app.route('/me', createMeRoutes({ db, logger: noopLogger }));
  return app;
}

function nombresDeColumna(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null || typeof value !== 'object') {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  const rec = value as Record<string, unknown>;
  const out: string[] = [];
  if (typeof rec.name === 'string') {
    out.push(rec.name);
  }
  for (const child of Object.values(rec)) {
    if (child && typeof child === 'object') {
      out.push(...nombresDeColumna(child, seen));
    }
  }
  return out;
}

describe('GET /me — ficha de conductor de la empresa activa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dueño con fila en conductores → tiene_ficha_conductor true, filtrada por empresa y no eliminada', async () => {
    const stub = makeDbStub({ role: 'dueno', ficha: [{ id: 'cond-test' }] });
    const app = await buildApp(stub.db);
    const res = await app.request('/me', {
      headers: { 'x-empresa-id': EMPRESA_ID },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tiene_ficha_conductor?: boolean };
    expect(body.tiene_ficha_conductor).toBe(true);
    expect(stub.from.mock.calls.some((call) => getTableName(call[0]) === 'conductores')).toBe(true);
    const columnas = nombresDeColumna(stub.fichaWhere());
    expect(columnas).toEqual(expect.arrayContaining(['usuario_id', 'empresa_id', 'eliminado_en']));
  });

  it('dueño sin fila → tiene_ficha_conductor false', async () => {
    const stub = makeDbStub({ role: 'dueno', ficha: [] });
    const app = await buildApp(stub.db);
    const res = await app.request('/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tiene_ficha_conductor?: boolean };
    expect(body.tiene_ficha_conductor).toBe(false);
  });

  it('admin con ficha sigue recibiendo el booleano true (la autorización de aceptar no mira este flag)', async () => {
    const stub = makeDbStub({ role: 'admin', ficha: [{ id: 'cond-test' }] });
    const app = await buildApp(stub.db);
    const res = await app.request('/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tiene_ficha_conductor?: boolean;
      active_membership: { role: string } | null;
    };
    expect(body.active_membership?.role).toBe('admin');
    expect(body.tiene_ficha_conductor).toBe(true);
  });
});
