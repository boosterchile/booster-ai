import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityCache } from '../../../src/services/observability/cache.js';
import { HealthChecksService } from '../../../src/services/observability/health-checks-service.js';
import type { MonitoringService } from '../../../src/services/observability/monitoring-service.js';

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

function buildMonitoring(opts: {
  uptime?: { uptimePercent: number; totalChecks: number; lastSampleAt: string | null };
  cloudRun?: {
    cpuUtilization: number | null;
    ramUtilization: number | null;
    latencyP95Ms: number | null;
    rps: number | null;
  } | null;
  cloudSql?: {
    cpuUtilization: number | null;
    ramUtilization: number | null;
    diskUtilization: number | null;
    connectionsUsedRatio: number | null;
  } | null;
}): MonitoringService {
  return {
    getUptimeSnapshot: vi.fn(
      async () => opts.uptime ?? { uptimePercent: 100, totalChecks: 0, lastSampleAt: null },
    ),
    getCloudRunMetrics: vi.fn(async () => {
      if (opts.cloudRun === null) {
        throw new Error('mock-fail');
      }
      return (
        opts.cloudRun ?? { cpuUtilization: 0.4, ramUtilization: 0.5, latencyP95Ms: 100, rps: 5 }
      );
    }),
    getCloudSqlMetrics: vi.fn(async () => {
      if (opts.cloudSql === null) {
        throw new Error('mock-fail');
      }
      return (
        opts.cloudSql ?? {
          cpuUtilization: 0.3,
          ramUtilization: 0.4,
          diskUtilization: 0.5,
          connectionsUsedRatio: 0.2,
        }
      );
    }),
  } as unknown as MonitoringService;
}

function build(monitoring: MonitoringService): HealthChecksService {
  return new HealthChecksService({
    cache: new InMemoryCacheStub() as unknown as ObservabilityCache,
    monitoringService: monitoring,
    logger: fakeLogger,
  });
}

describe('HealthChecksService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('healthy: uptime >99.5 + CPU<0.7 + RAM<0.8 → overall healthy', async () => {
    const svc = build(
      buildMonitoring({
        uptime: { uptimePercent: 99.9, totalChecks: 3, lastSampleAt: 'now' },
        cloudRun: { cpuUtilization: 0.3, ramUtilization: 0.4, latencyP95Ms: 120, rps: 8 },
        cloudSql: {
          cpuUtilization: 0.2,
          ramUtilization: 0.3,
          diskUtilization: 0.4,
          connectionsUsedRatio: 0.1,
        },
      }),
    );
    const result = await svc.getSnapshot();
    expect(result.overall).toBe('healthy');
    expect(result.components).toHaveLength(3);
  });

  it('degraded: CPU=0.75 (>=0.7) → degraded', async () => {
    const svc = build(
      buildMonitoring({
        uptime: { uptimePercent: 99.9, totalChecks: 1, lastSampleAt: 'now' },
        cloudRun: { cpuUtilization: 0.75, ramUtilization: 0.5, latencyP95Ms: 200, rps: 8 },
      }),
    );
    const result = await svc.getSnapshot();
    expect(result.overall).toBe('degraded');
    const cloudRunComp = result.components.find((c) => c.name === 'cloud-run');
    expect(cloudRunComp?.level).toBe('degraded');
  });

  it('critical: uptime=95% → critical', async () => {
    const svc = build(
      buildMonitoring({
        uptime: { uptimePercent: 95, totalChecks: 2, lastSampleAt: 'now' },
        cloudRun: { cpuUtilization: 0.3, ramUtilization: 0.3, latencyP95Ms: 100, rps: 5 },
      }),
    );
    const result = await svc.getSnapshot();
    expect(result.overall).toBe('critical');
  });

  it('monitoringService falla → componente queda como unknown', async () => {
    const svc = build(
      buildMonitoring({
        uptime: { uptimePercent: 100, totalChecks: 2, lastSampleAt: 'now' },
        cloudRun: null,
        cloudSql: null,
      }),
    );
    const result = await svc.getSnapshot();
    const cloudRunComp = result.components.find((c) => c.name === 'cloud-run');
    expect(cloudRunComp?.level).toBe('unknown');
    // uptime healthy + run/sql unknown → no 'critical' ni 'degraded', no 'all unknown' → 'healthy'
    expect(result.overall).toBe('healthy');
  });

  it('todos los componentes unknown → overall=unknown', async () => {
    const svc = build(
      buildMonitoring({
        uptime: { uptimePercent: 100, totalChecks: 0, lastSampleAt: null },
        cloudRun: null,
        cloudSql: null,
      }),
    );
    const result = await svc.getSnapshot();
    expect(result.overall).toBe('unknown');
  });
});
