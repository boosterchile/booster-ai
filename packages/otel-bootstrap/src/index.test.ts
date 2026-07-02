import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initOtel, shutdownOtelForTests } from './index.js';

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
