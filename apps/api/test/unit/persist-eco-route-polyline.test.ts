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
const { persistEcoRoutePolyline } = await import(
  '../../src/services/persist-eco-route-polyline.js'
);

const ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000a01';

interface JoinRow {
  assignmentId: string;
  originAddress: string;
  destinationAddress: string;
}

function makeDb(row: JoinRow | null) {
  const updateSpy = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  }));
  const limitFn = vi.fn().mockResolvedValue(row ? [row] : []);
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const innerJoinFn = vi.fn(() => ({ where: whereFn }));
  const fromFn = vi.fn(() => ({ innerJoin: innerJoinFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return { db: { select: selectFn, update: updateSpy } as never, updateSpy };
}

const validRow: JoinRow = {
  assignmentId: ASSIGNMENT_ID,
  originAddress: 'Av Origen 123, Santiago',
  destinationAddress: 'Av Destino 456, Concepción',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistEcoRoutePolyline', () => {
  it('sin routesApiKey → attempted=false reason=no_routes_api_key (sin DB call)', async () => {
    const { db, updateSpy } = makeDb(validRow);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
    });
    expect(result).toEqual({
      attempted: false,
      persisted: false,
      reason: 'no_routes_api_key',
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(computeRoutes).not.toHaveBeenCalled();
  });

  it('assignment no existe → assignment_not_found', async () => {
    const { db, updateSpy } = makeDb(null);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      routesProjectId: 'test-project',
    });
    expect(result).toEqual({
      attempted: true,
      persisted: false,
      reason: 'assignment_not_found',
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('Routes API exitosa → persisted=true + UPDATE con polyline', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 350, durationS: 12_600, fuelL: 70, polylineEncoded: 'route_polyline_xyz' },
    ]);
    const { db, updateSpy } = makeDb(validRow);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      routesProjectId: 'test-project',
    });
    expect(result).toEqual({ attempted: true, persisted: true });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('Routes API devuelve [] → route_empty (no UPDATE)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const { db, updateSpy } = makeDb(validRow);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      routesProjectId: 'test-project',
    });
    expect(result.reason).toBe('route_empty');
    expect(result.persisted).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('Routes API devuelve route con polyline vacío → route_empty (defensivo)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { distanceKm: 100, durationS: 3000, fuelL: null, polylineEncoded: '' },
    ]);
    const { db, updateSpy } = makeDb(validRow);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      routesProjectId: 'test-project',
    });
    expect(result.reason).toBe('route_empty');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('Routes API tira RoutesApiError → routes_api_failed (no throw)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new (RoutesApiError as never as new (m: string, c: string, h: number | null) => Error)(
        'quota',
        'quota_exceeded',
        429,
      ),
    );
    const { db, updateSpy } = makeDb(validRow);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      routesProjectId: 'test-project',
    });
    expect(result.reason).toBe('routes_api_failed');
    expect(result.persisted).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('Routes API error genérico → routes_api_failed (no throw)', async () => {
    (computeRoutes as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('weird'));
    const { db, updateSpy } = makeDb(validRow);
    const result = await persistEcoRoutePolyline({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      routesProjectId: 'test-project',
    });
    expect(result.reason).toBe('routes_api_failed');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
