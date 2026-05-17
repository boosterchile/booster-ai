import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
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
} as unknown as Parameters<
  typeof import('../../src/routes/stakeholder.js').createStakeholderRoutes
>[0]['logger'];

/**
 * Mock DB: queue de 4 selects en orden:
 *   1. users by firebase_uid
 *   2. memberships (rol stakeholder activa)
 *   3. zonas activas
 *   4. viajes joined con tripMetrics
 */
function makeDb(opts: {
  user?: Record<string, unknown> | null;
  member?: Record<string, unknown> | null;
  zonas?: Record<string, unknown>[];
  viajes?: Record<string, unknown>[];
}) {
  const queue: unknown[][] = [
    opts.user ? [opts.user] : [],
    opts.member ? [opts.member] : [],
    opts.zonas ?? [],
    opts.viajes ?? [],
  ];
  const shift = () => queue.shift() ?? [];
  const limit = vi.fn(() => Promise.resolve(shift()));
  const where = vi.fn(() => ({
    limit,
    then: (resolve: (v: unknown) => void) => resolve(shift()),
  }));
  const leftJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, leftJoin }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as Parameters<
    typeof import('../../src/routes/stakeholder.js').createStakeholderRoutes
  >[0]['db'];
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/stakeholder.js').createStakeholderRoutes>[0]['db'],
) {
  const { createStakeholderRoutes } = await import('../../src/routes/stakeholder.js');
  const app = new Hono();
  app.use('/stakeholder/*', async (c, next) => {
    const claimsHeader = c.req.header('x-test-claims');
    if (claimsHeader) {
      c.set('firebaseClaims', {
        uid: (JSON.parse(claimsHeader) as { uid: string }).uid,
        email: undefined,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.route('/stakeholder', createStakeholderRoutes({ db, logger: noopLogger }));
  return app;
}

describe('GET /stakeholder/zonas/:slug/agregaciones', () => {
  // El endpoint hace 4 selects en orden: user, member, zona, viajes.
  // Reusamos makeDb pero el orden de fields para zonas debe coincidir.
  it('window != 30d → 400 invalid_window', async () => {
    const app = await buildApp(
      makeDb({
        user: { id: 'u-s', firebaseUid: 'fb-s' },
        member: { id: 'm-1' },
      }),
    );
    const res = await app.request('/stakeholder/zonas/puerto-valparaiso/agregaciones?window=7d', {
      headers: { 'x-test-claims': JSON.stringify({ uid: 'fb-s' }) },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_window' });
  });

  it('zona inexistente → 404', async () => {
    const app = await buildApp(
      makeDb({
        user: { id: 'u-s', firebaseUid: 'fb-s' },
        member: { id: 'm-1' },
        zonas: [], // sin matches
      }),
    );
    const res = await app.request('/stakeholder/zonas/no-existe/agregaciones', {
      headers: { 'x-test-claims': JSON.stringify({ uid: 'fb-s' }) },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /stakeholder/zonas', () => {
  it('sin firebaseClaims → 401', async () => {
    const app = await buildApp(makeDb({}));
    const res = await app.request('/stakeholder/zonas');
    expect(res.status).toBe(401);
  });

  it('user con rol distinto → 403 forbidden_stakeholder_role', async () => {
    const app = await buildApp(makeDb({ user: { id: 'u-1', firebaseUid: 'fb-1' }, member: null }));
    const res = await app.request('/stakeholder/zonas', {
      headers: { 'x-test-claims': JSON.stringify({ uid: 'fb-1' }) },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toEqual({
      error: 'forbidden_stakeholder_role',
    });
  });

  it('stakeholder con zona <5 viajes → insufficient_data:true, numéricos null', async () => {
    const viaje = {
      pickup_at: new Date(),
      origin_lat: '-33.04',
      origin_lng: '-71.62',
      actual: '50',
      estimated: null,
    };
    const app = await buildApp(
      makeDb({
        user: { id: 'u-s', firebaseUid: 'fb-s' },
        member: { id: 'm-1' },
        zonas: [
          {
            id: 'z-1',
            slug: 'puerto-valparaiso',
            nombre: 'Puerto Valparaíso',
            regionCode: 'CL-VS',
            tipo: 'puerto',
            latMin: '-33.0501',
            latMax: '-33.0252',
            lngMin: '-71.645',
            lngMax: '-71.61',
          },
        ],
        viajes: [viaje, viaje, viaje], // 3 viajes — <5 trigger k-anon
      }),
    );
    const res = await app.request('/stakeholder/zonas', {
      headers: { 'x-test-claims': JSON.stringify({ uid: 'fb-s' }) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { zonas: Array<Record<string, unknown>> };
    expect(body.zonas).toHaveLength(1);
    expect(body.zonas[0]).toMatchObject({
      slug: 'puerto-valparaiso',
      insufficient_data: true,
      viajes_30d: null,
      co2e_total_kg: null,
    });
  });
});
