import { describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_METER_NAME,
  ENTREGAS_METRIC_NAME,
  createRegistrarEntrega,
} from './business-metrics.js';

describe('createRegistrarEntrega', () => {
  it('suma 1 a documentos_entregas_total con transporte y resultado como atributos', () => {
    const add = vi.fn();
    const createCounter = vi.fn(() => ({ add }));
    const registrar = createRegistrarEntrega({ createCounter } as never);

    registrar({ transporte: 'push', resultado: 'decodificado' });
    registrar({ transporte: 'pull', resultado: 'error_transitorio' });

    expect(createCounter).toHaveBeenCalledTimes(1);
    expect(createCounter).toHaveBeenCalledWith(ENTREGAS_METRIC_NAME, {
      description: expect.any(String),
    });
    expect(add).toHaveBeenNthCalledWith(1, 1, { transporte: 'push', resultado: 'decodificado' });
    expect(add).toHaveBeenNthCalledWith(2, 1, {
      transporte: 'pull',
      resultado: 'error_transitorio',
    });
  });

  it('usa un meter /business, el único scope que otel-bootstrap exporta', () => {
    expect(BUSINESS_METER_NAME.endsWith('/business')).toBe(true);
    // Sin MeterProvider registrado (tests) el meter global es no-op y no lanza.
    expect(() =>
      createRegistrarEntrega()({ transporte: 'push', resultado: 'no_autorizado' }),
    ).not.toThrow();
  });
});
