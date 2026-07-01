import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_SPAN_TRACER,
  setResultAttributes,
  withBusinessSpan,
} from '../../src/observability/business-span.js';

/**
 * Crea un Span fake con los métodos que usa el helper, todos espiables.
 * Modela el contrato mínimo de `@opentelemetry/api` que tocamos.
 */
function makeFakeSpan() {
  const span = {
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  };
  return span as typeof span & Span;
}

/**
 * Instala un tracer fake como global para que `trace.getTracer(...)` lo
 * devuelva y `startActiveSpan(name, cb)` ejecute el callback con nuestro span.
 */
function stubTracer(span: ReturnType<typeof makeFakeSpan>) {
  const startActiveSpan = vi.fn((_name: string, cb: (s: Span) => unknown) => cb(span));
  const getTracer = vi.fn(() => ({ startActiveSpan }) as never);
  const spy = vi.spyOn(trace, 'getTracer').mockImplementation(getTracer);
  return { startActiveSpan, getTracer, spy };
}

describe('withBusinessSpan', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('usa el tracer de negocio y nombra el span', async () => {
    const span = makeFakeSpan();
    const { startActiveSpan, getTracer } = stubTracer(span);

    await withBusinessSpan({ name: 'matching.run' }, async () => 42);

    expect(getTracer).toHaveBeenCalledWith(BUSINESS_SPAN_TRACER);
    expect(startActiveSpan).toHaveBeenCalledWith('matching.run', expect.any(Function));
  });

  it('aplica atributos iniciales descartando undefined', async () => {
    const span = makeFakeSpan();
    stubTracer(span);

    await withBusinessSpan(
      {
        name: 'offer.accept',
        attributes: {
          'booster.trip_id': 'trip-1',
          'booster.empresa_id': undefined,
          'booster.count': 3,
        },
      },
      async () => undefined,
    );

    expect(span.setAttributes).toHaveBeenCalledWith({
      'booster.trip_id': 'trip-1',
      'booster.count': 3,
    });
    expect(span.setAttributes).not.toHaveBeenCalledWith(
      expect.objectContaining({ 'booster.empresa_id': undefined }),
    );
  });

  it('retorna el valor del callback y cierra el span (happy path)', async () => {
    const span = makeFakeSpan();
    stubTracer(span);

    const result = await withBusinessSpan({ name: 'op' }, async (s) => {
      setResultAttributes(s, { 'booster.result': 'ok' });
      return { value: 7 };
    });

    expect(result).toEqual({ value: 7 });
    expect(span.setAttributes).toHaveBeenCalledWith({ 'booster.result': 'ok' });
    expect(span.setStatus).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('en error: recordException + status ERROR + re-throw + end', async () => {
    const span = makeFakeSpan();
    stubTracer(span);
    const boom = new Error('explota');

    await expect(
      withBusinessSpan({ name: 'op' }, async () => {
        throw boom;
      }),
    ).rejects.toThrow('explota');

    expect(span.recordException).toHaveBeenCalledWith(boom);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'explota',
    });
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it('normaliza throws no-Error a Error para recordException', async () => {
    const span = makeFakeSpan();
    stubTracer(span);

    const nonErrorThrow = (): never => {
      // biome-ignore lint/style/useThrowOnlyError: probamos a propósito el path de normalizar un throw no-Error.
      throw 'string-failure';
    };

    await expect(withBusinessSpan({ name: 'op' }, async () => nonErrorThrow())).rejects.toBe(
      'string-failure',
    );

    expect(span.recordException).toHaveBeenCalledWith(expect.any(Error));
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'string-failure',
    });
  });
});

describe('setResultAttributes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('setea atributos descartando undefined', () => {
    const span = makeFakeSpan();

    setResultAttributes(span, {
      'booster.a': 1,
      'booster.b': undefined,
      'booster.c': 'x',
    });

    expect(span.setAttributes).toHaveBeenCalledWith({ 'booster.a': 1, 'booster.c': 'x' });
  });
});
