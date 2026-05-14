import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityCache } from '../../../src/services/observability/cache.js';
import { MonitoringService } from '../../../src/services/observability/monitoring-service.js';

/**
 * Tests del MonitoringService — mock de Cloud Monitoring API v3 con
 * respuestas simuladas. No requiere ADC.
 */

class InMemoryCacheStub {
  private readonly store = new Map<string, unknown>();
  async getOrFetch<T>(key: string, _ttl: number, fetcher: () => Promise<T>): Promise<T> {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }
    const value = await fetcher();
    this.store.set(key, value);
    return value;
  }
  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }
}

const fakeLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => fakeLogger,
} as unknown as Logger;

function makeFetch(responseByFilter: Record<string, unknown>): typeof fetch {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const filter = u.searchParams.get('filter') ?? '';
    const key = Object.keys(responseByFilter).find((k) => filter.includes(k)) ?? '__default__';
    const payload = responseByFilter[key] ?? { timeSeries: [] };
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => payload,
    };
  }) as unknown as typeof fetch;
}

function buildService(fetchImpl: typeof fetch): MonitoringService {
  return new MonitoringService({
    cache: new InMemoryCacheStub() as unknown as ObservabilityCache,
    logger: fakeLogger,
    projectId: 'booster-ai-494222',
    fetchImpl,
    getAccessToken: async () => 'fake-token',
  });
}

describe('MonitoringService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getUptimeSnapshot: agrega series y reporta uptime%', async () => {
    const fetchImpl = makeFetch({
      uptime_check: {
        timeSeries: [
          {
            points: [
              { interval: { endTime: '2026-05-13T20:00:00Z' }, value: { doubleValue: 1.0 } },
              { interval: { endTime: '2026-05-13T19:59:00Z' }, value: { doubleValue: 1.0 } },
              { interval: { endTime: '2026-05-13T19:58:00Z' }, value: { doubleValue: 0.0 } },
            ],
          },
          {
            points: [
              { interval: { endTime: '2026-05-13T20:00:00Z' }, value: { doubleValue: 1.0 } },
            ],
          },
        ],
      },
    });
    const svc = buildService(fetchImpl);
    const result = await svc.getUptimeSnapshot();
    // 3 successes / 4 samples = 75%
    expect(result.uptimePercent).toBe(75);
    expect(result.totalChecks).toBe(2);
    expect(result.lastSampleAt).toBe('2026-05-13T20:00:00Z');
  });

  it('getUptimeSnapshot: sin series → 100% / 0 checks', async () => {
    const fetchImpl = makeFetch({ uptime_check: { timeSeries: [] } });
    const svc = buildService(fetchImpl);
    const result = await svc.getUptimeSnapshot();
    expect(result.uptimePercent).toBe(100);
    expect(result.totalChecks).toBe(0);
    expect(result.lastSampleAt).toBeNull();
  });

  it('getCloudRunMetrics: agrega 4 métricas en paralelo', async () => {
    const fetchImpl = makeFetch({
      request_latencies: {
        timeSeries: [
          { points: [{ value: { distributionValue: { mean: 120 } } }] },
          { points: [{ value: { distributionValue: { mean: 180 } } }] },
        ],
      },
      'container/cpu/utilizations': {
        timeSeries: [{ points: [{ value: { doubleValue: 0.45 } }] }],
      },
      'container/memory/utilizations': {
        timeSeries: [{ points: [{ value: { doubleValue: 0.6 } }] }],
      },
      request_count: {
        timeSeries: [{ points: [{ value: { doubleValue: 12.5 } }] }],
      },
    });
    const svc = buildService(fetchImpl);
    const result = await svc.getCloudRunMetrics();
    expect(result.latencyP95Ms).toBe(150); // avg(120, 180)
    expect(result.cpuUtilization).toBe(0.45);
    expect(result.ramUtilization).toBe(0.6);
    expect(result.rps).toBe(12.5);
  });

  it('getCloudRunMetrics: métricas vacías → null', async () => {
    const fetchImpl = makeFetch({});
    const svc = buildService(fetchImpl);
    const result = await svc.getCloudRunMetrics();
    expect(result.latencyP95Ms).toBeNull();
    expect(result.cpuUtilization).toBeNull();
    expect(result.ramUtilization).toBeNull();
    expect(result.rps).toBeNull();
  });

  it('getCloudSqlMetrics: conexiones se mapea a ratio /100', async () => {
    const fetchImpl = makeFetch({
      'cpu/utilization': { timeSeries: [{ points: [{ value: { doubleValue: 0.3 } }] }] },
      'memory/utilization': { timeSeries: [{ points: [{ value: { doubleValue: 0.5 } }] }] },
      'disk/utilization': { timeSeries: [{ points: [{ value: { doubleValue: 0.25 } }] }] },
      num_backends: { timeSeries: [{ points: [{ value: { doubleValue: 30 } }] }] },
    });
    const svc = buildService(fetchImpl);
    const result = await svc.getCloudSqlMetrics();
    expect(result.cpuUtilization).toBe(0.3);
    expect(result.ramUtilization).toBe(0.5);
    expect(result.diskUtilization).toBe(0.25);
    expect(result.connectionsUsedRatio).toBeCloseTo(0.3); // 30/100
  });

  it('getCloudSqlMetrics: 200 conexiones se clampa a ratio=1', async () => {
    const fetchImpl = makeFetch({
      num_backends: { timeSeries: [{ points: [{ value: { doubleValue: 200 } }] }] },
    });
    const svc = buildService(fetchImpl);
    const result = await svc.getCloudSqlMetrics();
    expect(result.connectionsUsedRatio).toBe(1);
  });

  it('fetchTimeSeries: error HTTP → loggea warn y retorna []', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const svc = buildService(fetchImpl);
    const result = await svc.getCloudRunMetrics();
    expect(result.cpuUtilization).toBeNull();
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('getUptimeSnapshot: maneja bool values además de double', async () => {
    const fetchImpl = makeFetch({
      uptime_check: {
        timeSeries: [
          {
            points: [
              { value: { boolValue: true } },
              { value: { boolValue: true } },
              { value: { boolValue: false } },
              { value: { boolValue: true } },
            ],
          },
        ],
      },
    });
    const svc = buildService(fetchImpl);
    const result = await svc.getUptimeSnapshot();
    expect(result.uptimePercent).toBe(75); // 3/4
  });
});
