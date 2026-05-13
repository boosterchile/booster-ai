import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComputeRouteEtaInput,
  RouteEtaCacheStore,
} from '../../src/services/compute-route-eta.js';
import { _resetDefaultCache, computeRouteEta } from '../../src/services/compute-route-eta.js';

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
} as unknown as ComputeRouteEtaInput['logger'];

function makeCache(): RouteEtaCacheStore {
  const store = new Map<string, { distanceKm: number; fetchedAt: number }>();
  return {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
    prune: () => undefined,
  };
}

/**
 * Helper para construir un fetch mock que devuelve un response shape de Routes API.
 */
function makeFetchOk(distanceMeters: number, durationS = 7200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        routes: [
          {
            distanceMeters,
            duration: `${durationS}s`,
            polyline: { encodedPolyline: 'fake_polyline_xyz' },
          },
        ],
      }),
  } as unknown as Response) as typeof fetch;
}

function makeFetchEmpty(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ routes: [] }),
  } as unknown as Response) as typeof fetch;
}

function makeFetchHttp500(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: () => Promise.resolve('Internal'),
  } as unknown as Response) as typeof fetch;
}

function makeFetchNetworkError(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as typeof fetch;
}

const baseInput = (over: Partial<ComputeRouteEtaInput> = {}): ComputeRouteEtaInput => ({
  logger: noopLogger,
  tripId: 'trip-1',
  currentLat: -33.45,
  currentLng: -70.66,
  destinationAddress: 'Av Ejemplo 123, Concepción',
  avgSpeedKmh: 60,
  fallbackEtaMinutes: 500,
  routesProjectId: 'test-project',
  ...over,
});

beforeEach(() => {
  _resetDefaultCache();
  vi.clearAllMocks();
});

describe('computeRouteEta — fallback paths (no Routes API call)', () => {
  it('sin routesApiKey → devuelve fallback con source=centroide', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await computeRouteEta(baseInput({ routesProjectId: undefined, fetchImpl }));
    expect(res).toEqual({ etaMinutes: 500, source: 'centroide' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sin posición actual → fallback (sin call)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await computeRouteEta(baseInput({ currentLat: null, currentLng: null, fetchImpl }));
    expect(res.source).toBe('centroide');
    expect(res.etaMinutes).toBe(500);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('avgSpeed null o cero → fallback (sin call)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r1 = await computeRouteEta(baseInput({ avgSpeedKmh: null, fetchImpl }));
    const r2 = await computeRouteEta(baseInput({ avgSpeedKmh: 0, fetchImpl }));
    expect(r1.source).toBe('centroide');
    expect(r2.source).toBe('centroide');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('destinationAddress vacío → fallback (sin call)', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r1 = await computeRouteEta(baseInput({ destinationAddress: '', fetchImpl }));
    const r2 = await computeRouteEta(baseInput({ destinationAddress: '   ', fetchImpl }));
    expect(r1.source).toBe('centroide');
    expect(r2.source).toBe('centroide');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fallback null preservado como unavailable', async () => {
    const res = await computeRouteEta(
      baseInput({ routesProjectId: undefined, fallbackEtaMinutes: null }),
    );
    expect(res).toEqual({ etaMinutes: null, source: 'unavailable' });
  });
});

describe('computeRouteEta — Routes API happy paths', () => {
  it('llamada exitosa → ETA recalculado con distancia real y avgSpeed actual', async () => {
    // distanceMeters = 200_000 (200km), avgSpeedKmh = 60 → ETA = 200/60*60 = 200min
    const fetchImpl = makeFetchOk(200_000);
    const cache = makeCache();
    const res = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(res.source).toBe('routes_api');
    expect(res.etaMinutes).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('segunda llamada misma posición → cache hit (sin fetch)', async () => {
    const fetchImpl = makeFetchOk(150_000); // 150km → @60kmh = 150min
    const cache = makeCache();
    const first = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    const second = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(first.source).toBe('routes_api');
    expect(second.source).toBe('routes_api_cached');
    expect(second.etaMinutes).toBe(150);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cache hit usa avgSpeed actual (no el del primer fetch)', async () => {
    // distance=120km cacheada → al cambiar avgSpeed de 60 a 30, ETA dobla.
    const fetchImpl = makeFetchOk(120_000);
    const cache = makeCache();
    const first = await computeRouteEta(
      baseInput({ fetchImpl, cacheStore: cache, avgSpeedKmh: 60 }),
    );
    const second = await computeRouteEta(
      baseInput({ fetchImpl, cacheStore: cache, avgSpeedKmh: 30 }),
    );
    expect(first.etaMinutes).toBe(120); // 120km / 60kmh = 2h
    expect(second.etaMinutes).toBe(240); // 120km / 30kmh = 4h
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cache expira tras TTL 5min → refetch', async () => {
    const fetchImpl = makeFetchOk(100_000);
    const cache = makeCache();
    const t0 = 1_000_000;
    const first = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache, nowMs: t0 }));
    // Simular paso de 6min
    const second = await computeRouteEta(
      baseInput({ fetchImpl, cacheStore: cache, nowMs: t0 + 6 * 60 * 1000 }),
    );
    expect(first.source).toBe('routes_api');
    expect(second.source).toBe('routes_api'); // re-fetched, not cached
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('grid de cache 0.01°: movimiento <0.01° → mismo grid (cache hit)', async () => {
    const fetchImpl = makeFetchOk(50_000);
    const cache = makeCache();
    // -33.45 vs -33.453 → toFixed(2) === '-33.45' para ambos
    await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache, currentLat: -33.45 }));
    const second = await computeRouteEta(
      baseInput({ fetchImpl, cacheStore: cache, currentLat: -33.453 }),
    );
    expect(second.source).toBe('routes_api_cached');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('grid de cache 0.01°: movimiento ≥0.01° → grid distinto (cache miss)', async () => {
    const fetchImpl = makeFetchOk(50_000);
    const cache = makeCache();
    await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache, currentLat: -33.45 }));
    const second = await computeRouteEta(
      baseInput({ fetchImpl, cacheStore: cache, currentLat: -33.46 }),
    );
    expect(second.source).toBe('routes_api');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('computeRouteEta — Routes API failure paths', () => {
  it('HTTP 500 → fallback centroide', async () => {
    const fetchImpl = makeFetchHttp500();
    const cache = makeCache();
    const res = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(res.source).toBe('centroide');
    expect(res.etaMinutes).toBe(500); // del fallback
  });

  it('network error → fallback centroide', async () => {
    const fetchImpl = makeFetchNetworkError();
    const cache = makeCache();
    const res = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(res.source).toBe('centroide');
    expect(res.etaMinutes).toBe(500);
  });

  it('Routes API devuelve sin routes → fallback centroide', async () => {
    const fetchImpl = makeFetchEmpty();
    const cache = makeCache();
    const res = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(res.source).toBe('centroide');
  });

  it('failure no cachea — siguiente call vuelve a intentar', async () => {
    const cache = makeCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('boom'),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            routes: [
              { distanceMeters: 90_000, duration: '3600s', polyline: { encodedPolyline: 'p' } },
            ],
          }),
      } as unknown as Response) as unknown as typeof fetch;
    const first = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    const second = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(first.source).toBe('centroide');
    expect(second.source).toBe('routes_api');
    expect(second.etaMinutes).toBe(90); // 90km / 60kmh = 90min
  });
});

describe('computeRouteEta — ETA edge cases', () => {
  it('distancia muy corta → min 1 min (no zero)', async () => {
    // 100m a 60kmh = 0.1min → clamped a 1
    const fetchImpl = makeFetchOk(100);
    const cache = makeCache();
    const res = await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache }));
    expect(res.etaMinutes).toBe(1);
  });

  it('cache por tripId — trips distintos no comparten cache', async () => {
    const fetchImpl = makeFetchOk(100_000);
    const cache = makeCache();
    await computeRouteEta(baseInput({ fetchImpl, cacheStore: cache, tripId: 'trip-A' }));
    const second = await computeRouteEta(
      baseInput({ fetchImpl, cacheStore: cache, tripId: 'trip-B' }),
    );
    expect(second.source).toBe('routes_api'); // not cached
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
