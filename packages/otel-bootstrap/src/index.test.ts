import { metrics } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METRIC_EXPORT_INTERVAL_MS, initOtel, shutdownOtelForTests } from './index.js';

describe('initOtel (gating + idempotencia)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(async () => {
    await shutdownOtelForTests();
    vi.unstubAllEnvs();
  });

  it('sin GOOGLE_CLOUD_PROJECT → no-op limpio (T1)', () => {
    // stubEnv con '' deja la var falsy para el guard (sin delete: noDelete).
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', '');
    const result = initOtel({ serviceName: 'test-svc' });
    expect(result).toEqual({ started: false, reason: 'no_google_cloud_project' });
  });

  it('con exporter inyectado → arranca; segundo init es no-op idempotente (T2)', () => {
    const exporter = new InMemorySpanExporter();
    const first = initOtel({ serviceName: 'test-svc', serviceVersion: '1.2.3', exporter });
    expect(first.started).toBe(true);

    const second = initOtel({ serviceName: 'otro' });
    expect(second).toEqual({ started: true, reason: 'already_started' });
  });
});

describe('initOtel (arranque real y shutdown)', () => {
  afterEach(async () => {
    await shutdownOtelForTests();
    vi.unstubAllEnvs();
  });

  it('con GOOGLE_CLOUD_PROJECT y sin exporter → usa el exporter de Cloud Trace', () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'booster-test');
    vi.stubEnv('SERVICE_VERSION', '9.9.9');
    const result = initOtel({ serviceName: 'test-svc' });
    expect(result).toEqual({ started: true });
  });

  it('registra un handler SIGTERM que hace shutdown best-effort del SDK', async () => {
    const before = process.listeners('SIGTERM');
    initOtel({ serviceName: 'test-svc', exporter: new InMemorySpanExporter() });
    const nuevos = process.listeners('SIGTERM').filter((l) => !before.includes(l));
    expect(nuevos).toHaveLength(1);

    const handler = nuevos[0] as () => void;
    process.removeListener('SIGTERM', handler);
    expect(() => handler()).not.toThrow();
    await shutdownOtelForTests();
  });

  it('un shutdown que falla nunca propaga (SIGTERM y reset de tests)', async () => {
    const failing: SpanExporter = {
      export: (_spans, cb) => cb({ code: 0 }),
      shutdown: () => Promise.reject(new Error('exporter caído')),
    };
    const before = process.listeners('SIGTERM');
    initOtel({ serviceName: 'test-svc', exporter: failing });
    const handler = process.listeners('SIGTERM').find((l) => !before.includes(l)) as () => void;
    process.removeListener('SIGTERM', handler);

    handler();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(shutdownOtelForTests()).resolves.toBeUndefined();
  });

  it('shutdownOtelForTests sin SDK iniciado es no-op', async () => {
    await expect(shutdownOtelForTests()).resolves.toBeUndefined();
  });
});

describe('initOtel (métricas a Cloud Monitoring, T10-15)', () => {
  afterEach(async () => {
    await shutdownOtelForTests();
    vi.unstubAllEnvs();
  });

  it('registra un MeterProvider global: un contador de negocio llega al exporter', async () => {
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    initOtel({
      serviceName: 'test-svc',
      exporter: new InMemorySpanExporter(),
      metricExporter,
      metricExportIntervalMs: 50,
    });

    metrics.getMeter('booster-test/business').createCounter('viajes_entregados_total').add(2, {
      resultado: 'ok',
    });

    metrics.getMeter('@opentelemetry/instrumentation-http').createCounter('http_ruido').add(1);

    await vi.waitFor(
      () => {
        const nombres = metricExporter
          .getMetrics()
          .flatMap((rm) => rm.scopeMetrics)
          .flatMap((sm) => sm.metrics)
          .map((m) => m.descriptor.name);
        expect(nombres).toContain('viajes_entregados_total');
        expect(nombres).not.toContain('http_ruido');
      },
      { timeout: 2_000, interval: 25 },
    );
  });

  it('el intervalo por defecto es 60 s', () => {
    expect(DEFAULT_METRIC_EXPORT_INTERVAL_MS).toBe(60_000);
  });
});
