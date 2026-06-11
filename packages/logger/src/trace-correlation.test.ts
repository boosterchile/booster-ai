import { type SpanContext, TraceFlags, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './createLogger.js';

/**
 * Spec feat-otel-bootstrap T3/T4: el mixin correlaciona trace_id/span_id
 * + campos nativos de Cloud Logging cuando hay span activo, y NO agrega
 * ruido sin span. Usa @opentelemetry/api puro (NonRecordingSpan vía
 * wrapSpanContext) — sin SDK, como un servicio donde initOtel fue no-op.
 */

const SPAN_CONTEXT: SpanContext = {
  traceId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  spanId: '1234567890abcdef',
  traceFlags: TraceFlags.SAMPLED,
};

describe('correlación de traces en createLogger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const captured: string[] = [];

  beforeEach(() => {
    captured.length = 0;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  /**
   * Sin SDK no hay context manager (context.with es no-op con la API
   * pura) — stubeamos getActiveSpan, que es exactamente lo que el mixin
   * consume. El comportamiento end-to-end con SDK real se valida en el
   * paso post-deploy de la spec §11.
   */
  function withActiveSpan(fn: () => void) {
    const span = trace.wrapSpanContext(SPAN_CONTEXT);
    const spy = vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
    try {
      fn();
    } finally {
      spy.mockRestore();
    }
  }

  function lastLog(): Record<string, unknown> {
    const line = captured[captured.length - 1];
    if (!line) {
      throw new Error('no log captured');
    }
    return JSON.parse(line);
  }

  it('con span activo: trace_id/span_id + logging.googleapis.com/trace (T3)', () => {
    const logger = createLogger({ service: 'svc-test', gcpProjectId: 'booster-test' });
    withActiveSpan(() => {
      logger.info('dentro del span');
    });

    const log = lastLog();
    expect(log.trace_id).toBe(SPAN_CONTEXT.traceId);
    expect(log.span_id).toBe(SPAN_CONTEXT.spanId);
    expect(log['logging.googleapis.com/trace']).toBe(
      `projects/booster-test/traces/${SPAN_CONTEXT.traceId}`,
    );
    expect(log['logging.googleapis.com/spanId']).toBe(SPAN_CONTEXT.spanId);
  });

  it('gcpProjectId default desde GOOGLE_CLOUD_PROJECT del env', () => {
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'booster-env');
    const logger = createLogger({ service: 'svc-test' });
    withActiveSpan(() => {
      logger.info('con env');
    });

    expect(lastLog()['logging.googleapis.com/trace']).toBe(
      `projects/booster-env/traces/${SPAN_CONTEXT.traceId}`,
    );
  });

  it('sin span activo: cero campos de trace (T4)', () => {
    const logger = createLogger({ service: 'svc-test', gcpProjectId: 'booster-test' });
    logger.info('sin span');

    const log = lastLog();
    expect(log.trace_id).toBeUndefined();
    expect(log.span_id).toBeUndefined();
    expect(log['logging.googleapis.com/trace']).toBeUndefined();
  });

  it('los campos de trace sobreviven la redacción PII (no se redactan)', () => {
    const logger = createLogger({ service: 'svc-test', gcpProjectId: 'p' });
    withActiveSpan(() => {
      logger.info({ email: 'a@b.cl' }, 'pii + trace');
    });
    const log = lastLog();
    expect(log.trace_id).toBe(SPAN_CONTEXT.traceId);
    expect(String(log.email)).not.toBe('a@b.cl'); // redactado
  });
});
