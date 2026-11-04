import { describe, expect, it } from 'vitest';
import { getBusinessCounter, getBusinessGauge, getBusinessHistogram } from './business-metrics.js';

describe('instrumentos de negocio', () => {
  it('reutiliza el counter y el histogram por nombre', () => {
    expect(getBusinessCounter('gps_scorecard_test_counter')).toBe(
      getBusinessCounter('gps_scorecard_test_counter'),
    );
    const histograma = getBusinessHistogram('gps_scorecard_test_hist', {
      description: 'prueba',
      unit: '%',
    });
    expect(getBusinessHistogram('gps_scorecard_test_hist')).toBe(histograma);
    expect(getBusinessHistogram('gps_scorecard_test_hist_bare')).toBe(
      getBusinessHistogram('gps_scorecard_test_hist_bare'),
    );
    expect(() =>
      getBusinessHistogram('gps_scorecard_test_hist_unit', { unit: '%' }).record(1),
    ).not.toThrow();
    expect(() => histograma.record(12)).not.toThrow();
  });

  it('reutiliza el gauge por nombre y acepta record sin MeterProvider (ADR-080 §2)', () => {
    const gauge = getBusinessGauge('caja_test_gauge', { description: 'prueba', unit: 'CLP' });
    expect(getBusinessGauge('caja_test_gauge')).toBe(gauge);
    expect(getBusinessGauge('caja_test_gauge_bare')).toBe(getBusinessGauge('caja_test_gauge_bare'));
    expect(() => gauge.record(1_000_000)).not.toThrow();
  });
});
