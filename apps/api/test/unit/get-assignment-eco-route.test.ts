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
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
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
};

vi.mock('../../src/services/routes-api.js', () => ({
  RoutesApiError: class RoutesApiError extends Error {
    code: string;
    httpStatus: number | null;
    constructor(message: string, code: string, httpStatus: number | null) {
      super(message);
      this.code = code;
      this.httpStatus = httpStatus;
    }
  },
  computeRoutes: vi.fn(),
}));

const { computeRoutes, RoutesApiError } = await import('../../src/services/routes-api.js');
const { getAssignmentEcoRoute } = await import('../../src/services/get-assignment-eco-route.js');

const ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000a01';
const EMPRESA_ID = '00000000-0000-0000-0000-000000000e01';
const OTHER_EMPRESA_ID = '00000000-0000-0000-0000-000000000e02';

interface JoinRow {
  assignmentId: string;
  assignmentEmpresaId: string;
  originAddress: string;
  destinationAddress: string;
}

function makeDb(row: JoinRow | null) {
  const limitFn = vi.fn().mockResolvedValue(row ? [row] : []);
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const innerJoinFn = vi.fn(() => ({ where: whereFn }));
  const fromFn = vi.fn(() => ({ innerJoin: innerJoinFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return { select: selectFn } as never;
}

const validRow: JoinRow = {
  assignmentId: ASSIGNMENT_ID,
  assignmentEmpresaId: EMPRESA_ID,
  originAddress: 'Av Origen 123, Santiago',
  destinationAddress: 'Av Destino 456, Concepción',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAssignmentEcoRoute', () => {
  it('assignment no existe → not_found', async () => {
    const db = makeDb(null);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
    });
    expect(result.kind).toBe('not_found');
  });

  it('ownership mismatch → forbidden', async () => {
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: OTHER_EMPRESA_ID,
    });
    expect(result.kind).toBe('forbidden');
  });

  it('sin routesApiKey → ok con status=no_routes_api_key + polyline null', async () => {
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data).toEqual({
        polylineEncoded: null,
        distanceKm: null,
        durationS: null,
        status: 'no_routes_api_key',
      });
    }
    expect(computeRoutes).not.toHaveBeenCalled();
  });

  it('Routes API exitosa → polyline + distance + duration', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        distanceKm: 350.2,
        durationS: 12_600,
        fuelL: 70.4,
        polylineEncoded: 'route_xyz',
      },
    ]);
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'fake-key',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data).toEqual({
        polylineEncoded: 'route_xyz',
        distanceKm: 350.2,
        durationS: 12_600,
        status: 'ok',
      });
    }
    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'fake-key',
        origin: validRow.originAddress,
        destination: validRow.destinationAddress,
        computeAlternatives: false,
      }),
    );
  });

  it('Routes API devuelve [] → status=route_empty', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'fake-key',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.status).toBe('route_empty');
      expect(result.data.polylineEncoded).toBeNull();
    }
  });

  it('Routes API devuelve route con distance 0 → route_empty', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 0, durationS: 0, fuelL: null, polylineEncoded: 'x' },
    ]);
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'fake-key',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.status).toBe('route_empty');
    }
  });

  it('Routes API devuelve polyline vacío → route_empty (defensivo)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 100, durationS: 3000, fuelL: null, polylineEncoded: '' },
    ]);
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'fake-key',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.status).toBe('route_empty');
      expect(result.data.polylineEncoded).toBeNull();
    }
  });

  it('Routes API tira RoutesApiError → routes_api_failed (no throw)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new (RoutesApiError as never as new (m: string, c: string, h: number | null) => Error)(
        'quota',
        'quota_exceeded',
        429,
      ),
    );
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'fake-key',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.status).toBe('routes_api_failed');
      expect(result.data.polylineEncoded).toBeNull();
    }
  });

  it('error genérico de Routes API → routes_api_failed (no throw)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('weird network'));
    const db = makeDb(validRow);
    const result = await getAssignmentEcoRoute({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      empresaId: EMPRESA_ID,
      routesApiKey: 'fake-key',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.status).toBe('routes_api_failed');
    }
  });
});
