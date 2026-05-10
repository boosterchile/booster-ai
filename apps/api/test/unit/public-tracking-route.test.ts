import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  process.env.ALLOWED_CALLER_SA = 'test-sa@test.iam.gserviceaccount.com';
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
  typeof import('../../src/routes/public-tracking.js').createPublicTrackingRoutes
>[0]['logger'];

const VALID_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

describe('GET /public/tracking/:token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('token desconocido (UUID válido pero sin row) → 404 not_found', async () => {
    vi.doMock('../../src/services/get-public-tracking.js', () => ({
      getPublicTracking: vi.fn().mockResolvedValue({ status: 'not_found' }),
    }));
    const { createPublicTrackingRoutes } = await import('../../src/routes/public-tracking.js');
    const app = createPublicTrackingRoutes({ db: {} as never, logger: noopLogger });
    const res = await app.request(`/${VALID_TOKEN}`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'not_found' });
  });

  it('token con formato inválido → 404 (mismo neutro que not found en DB)', async () => {
    vi.doMock('../../src/services/get-public-tracking.js', () => ({
      getPublicTracking: vi.fn().mockResolvedValue({ status: 'not_found' }),
    }));
    const { createPublicTrackingRoutes } = await import('../../src/routes/public-tracking.js');
    const app = createPublicTrackingRoutes({ db: {} as never, logger: noopLogger });
    const res = await app.request('/not-a-token');
    expect(res.status).toBe(404);
  });

  it('token válido + row → 200 con shape esperado + Cache-Control', async () => {
    vi.doMock('../../src/services/get-public-tracking.js', () => ({
      getPublicTracking: vi.fn().mockResolvedValue({
        status: 'found',
        trip: {
          tracking_code: 'BOO-X1',
          status: 'en_proceso',
          origin_address: 'A',
          destination_address: 'B',
          cargo_type: 'carga_seca',
        },
        vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
        position: null,
        eta_minutes: null,
      }),
    }));
    const { createPublicTrackingRoutes } = await import('../../src/routes/public-tracking.js');
    const app = createPublicTrackingRoutes({ db: {} as never, logger: noopLogger });
    const res = await app.request(`/${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=30');
    const body = (await res.json()) as { trip: { tracking_code: string } };
    expect(body.trip.tracking_code).toBe('BOO-X1');
  });

  it('handler no recibe driver_name ni precio (defensa privacy via service shape)', async () => {
    vi.doMock('../../src/services/get-public-tracking.js', () => ({
      getPublicTracking: vi.fn().mockResolvedValue({
        status: 'found',
        trip: {
          tracking_code: 'BOO-X',
          status: 'asignado',
          origin_address: 'A',
          destination_address: 'B',
          cargo_type: 'carga_seca',
        },
        vehicle: { type: 'camion_3_4', plate_partial: '***1234' },
        position: null,
        eta_minutes: null,
      }),
    }));
    const { createPublicTrackingRoutes } = await import('../../src/routes/public-tracking.js');
    const app = createPublicTrackingRoutes({ db: {} as never, logger: noopLogger });
    const res = await app.request(`/${VALID_TOKEN}`);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('driver_name');
    expect(body).not.toContain('agreed_price');
    expect(body).not.toContain('precio');
  });
});
